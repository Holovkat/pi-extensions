/** Trusted environment GitHub adapter. No token, ambient gh profile or generic
 * process runner is accepted here. The native broker owns secure storage and
 * validates the complete command vocabulary before starting gh. */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

export interface EnvironmentGithubResult { status: number | null; stdout: string; stderr: string; code?: string; }
export interface EnvironmentGithubOptions { timeout?: number; input?: string; }

const failed = (code: string, message: string): EnvironmentGithubResult => ({ status: 1, stdout: "", stderr: message, code });

export async function runEnvironmentGithub(workspace: string, args: string[], options: EnvironmentGithubOptions = {}): Promise<EnvironmentGithubResult> {
  let root: string; let environmentId: string;
  try {
    root = fs.realpathSync(workspace);
    const identity = JSON.parse(fs.readFileSync(path.join(root, ".pi", "pif", "environment.json"), "utf8"));
    if (identity.schemaVersion !== 1 || typeof identity.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identity.id)) throw new Error("identity");
    environmentId = identity.id.toLowerCase();
  } catch {
    return failed("environment_required", "Select or create a local environment before connecting GitHub.");
  }
  if (!Array.isArray(args) || args.length > 100 || args.some((arg) => typeof arg !== "string" || arg.includes("\0")) || !["issue", "api"].includes(args[0])) {
    return failed("unsupported_operation", "This GitHub operation is not supported by the environment connection.");
  }
  const body = JSON.stringify({ workspace: root, environmentId, args, ...(options.input === undefined ? {} : { input: options.input }) });
  if (Buffer.byteLength(body) > 128 * 1024) return failed("request_too_large", "The GitHub request is too large.");
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result: EnvironmentGithubResult) => { if (!finished) { finished = true; resolve(result); } };
    const request = http.request({ socketPath: path.join(root, ".pi", "pif", "github.sock"), path: "/github", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) { response.destroy(); finish(failed("response_too_large", "GitHub returned too much data. Narrow the request and try again.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.statusCode !== 200 || !Number.isInteger(value.status) || typeof value.stdout !== "string" || typeof value.stderr !== "string") throw new Error("response");
          finish({ status: value.status, stdout: value.stdout, stderr: value.stderr, ...(typeof value.code === "string" ? { code: value.code } : {}) });
        } catch { finish(failed("invalid_response", "The native GitHub connection returned an unreadable response.")); }
      });
      response.on("error", () => finish(failed("connection_lost", "The native GitHub connection closed. Reopen this environment and try again.")));
    });
    request.setTimeout(Math.min(60_000, Math.max(1_000, options.timeout ?? 35_000)), () => {
      request.destroy();
      finish(failed("timeout", "GitHub did not respond in time. Check the connection before retrying a write."));
    });
    request.on("error", () => finish(failed("connection_unavailable", "Open this environment in pif and configure its GitHub token in Settings. No ambient GitHub login will be used.")));
    request.end(body);
  });
}
