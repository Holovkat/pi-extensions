import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerCalculatorAggregateFeatures } from "../skeuomorphic-calculator-toolbox-app/server.ts";
import { registerGithubProjectKanbanBoardFeatures } from "../github-project-kanban-board-app/server.ts";

type ActiveTransport =
  | { kind: "streamable"; server: McpServer; transport: StreamableHTTPServerTransport }
  | { kind: "sse"; server: McpServer; transport: SSEServerTransport };

const activeTransports = new Map<string, ActiveTransport>();

export function createToolshedAppServer() {
  const server = new McpServer({
    name: "toolshed-app",
    version: "0.1.0",
  });
  registerCalculatorAggregateFeatures(server);
  registerGithubProjectKanbanBoardFeatures(server);
  return server;
}

function getStringArg(name: string): string | null {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function isHttpMode() {
  const transportMode = String(process.env.MCP_TRANSPORT || "").trim().toLowerCase();
  return process.argv.includes("--http")
    || process.argv.includes("--streamable-http")
    || transportMode === "http"
    || transportMode === "streamable-http";
}

function getHttpHost() {
  return String(process.env.MCP_HOST || getStringArg("host") || "127.0.0.1").trim() || "127.0.0.1";
}

function getHttpPort() {
  const value = String(process.env.MCP_PORT || process.env.PORT || getStringArg("port") || "3000").trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

async function readJsonBody(req: IncomingMessage) {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function writeJsonRpcError(res: ServerResponse, statusCode: number, message: string) {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code: statusCode === 400 ? -32000 : -32603,
      message,
    },
    id: null,
  });
}

function writeText(res: ServerResponse, statusCode: number, content: string) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(content);
}

async function closeActiveTransports() {
  const entries = [...activeTransports.entries()];
  activeTransports.clear();
  for (const [, entry] of entries) {
    try {
      await entry.transport.close();
    } catch {}
  }
}

function registerActiveTransport(sessionId: string, entry: ActiveTransport) {
  activeTransports.set(sessionId, entry);
}

async function createStreamableTransport() {
  const server = createToolshedAppServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      registerActiveTransport(sessionId, { kind: "streamable", server, transport });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) activeTransports.delete(transport.sessionId);
  };
  await server.connect(transport);
  return transport;
}

async function handleStreamableRequest(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = getHeaderValue(req, "mcp-session-id");
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (existing) {
    if (existing.kind !== "streamable") {
      writeJsonRpcError(res, 400, "Bad Request: Session exists but uses a different transport protocol.");
      return;
    }
    await existing.transport.handleRequest(req, res, body);
    return;
  }
  if (req.method !== "POST" || !body || !isInitializeRequest(body)) {
    writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided.");
    return;
  }
  const transport = await createStreamableTransport();
  await transport.handleRequest(req, res, body);
}

async function handleLegacySseStart(req: IncomingMessage, res: ServerResponse) {
  const server = createToolshedAppServer();
  const transport = new SSEServerTransport("/messages", res);
  registerActiveTransport(transport.sessionId, { kind: "sse", server, transport });
  res.on("close", () => {
    activeTransports.delete(transport.sessionId);
  });
  await server.connect(transport);
}

async function handleLegacySseMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
  const sessionId = String(requestUrl.searchParams.get("sessionId") || "").trim();
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (!existing || existing.kind !== "sse") {
    writeJsonRpcError(res, 400, "Bad Request: No SSE session found for that session ID.");
    return;
  }
  await existing.transport.handlePostMessage(req, res, body);
}

async function runHttpServer() {
  const host = getHttpHost();
  const port = getHttpPort();
  const httpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
      const body = await readJsonBody(req);
      if (requestUrl.pathname === "/mcp" && ["GET", "POST", "DELETE"].includes(req.method || "")) {
        await handleStreamableRequest(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/sse" && req.method === "GET") {
        await handleLegacySseStart(req, res);
        return;
      }
      if (requestUrl.pathname === "/messages" && req.method === "POST") {
        await handleLegacySseMessage(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/" && req.method === "GET") {
        writeJson(res, 200, {
          name: "toolshed-app",
          streamableHttpUrl: "/mcp",
          legacySseUrl: "/sse",
        });
        return;
      }
      writeText(res, 404, "Not found.");
    } catch (error) {
      console.error(error);
      writeJsonRpcError(res, 500, "Internal server error.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.log(`Toolshed app MCP server listening on http://${host}:${port}/mcp`);
  console.log(`Legacy SSE compatibility is available at http://${host}:${port}/sse`);

  const shutdown = async () => {
    await closeActiveTransports();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function runStdioServer() {
  const server = createToolshedAppServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  if (isHttpMode()) {
    await runHttpServer();
    return;
  }
  await runStdioServer();
}

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
