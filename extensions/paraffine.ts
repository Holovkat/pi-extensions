/**
 * PARAFFINE — Pi bridge for AFFiNE-backed PARA curation workflows
 *
 * Loads only when explicitly passed via `-e`, so it remains dormant otherwise.
 *
 * Recommended launch:
 *   pi -e extensions/ollama-provider.ts -e extensions/paraffine.ts --model ollama/gemma4:31b-cloud
 *
 * Commands:
 *   /paraffine <request>
 *   /paraffine-status
 *   /paraffine-retrieve <query> [--limit N] [--statuses a,b,c]
 *   /paraffine-cycle [query] [--limit N]
 *   /paraffine-review [query] [--limit N] [--statuses a,b,c]
 *   /paraffine-contract
 */

import { existsSync, readFileSync } from "fs";
import { basename, dirname, join } from "path";
import { spawn } from "child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { applyExtensionDefaults } from "./themeMap.ts";

const PREFERRED_MODEL = "ollama/gemma4:31b-cloud";
const DEFAULT_LIMIT = 10;
const PARAFFINE_OPERATOR_BRIEF = `
PARAFFINE operator brief

- Treat Inbox as a staging surface, not the final home.
- Detect whether a set of notes is a standalone note or a related knowledge pack.
- Preserve or create parent-child structure for related notes instead of flattening them.
- The permanent home of reusable explainer material is usually Resources, even when the active project is currently shaping it.
- Use the active project as a linkage point, not as the only home, when material is both reusable and project-relevant.
- If notes conflict, are malformed, or have no safe canonical target, move them to Inbox/Quarantine rather than forcing placement.
- Do not invent new PARA buckets. Quarantine is an Inbox workflow folder, not a fifth PARA category.
- Prefer deterministic CLI actions and auditable outcomes over speculative rewriting.
`.trim();

type RunnerSpec = {
	root: string;
	scriptPath: string;
};

type SkillSpec = {
	id: string;
	sourcePath: string;
	label: string;
};

function parseCommandArgs(input: string): { query: string; flags: Record<string, string | boolean> } {
	const tokens = input.match(/"[^"]*"|'[^']*'|\S+/g) || [];
	const flags: Record<string, string | boolean> = {};
	const parts: string[] = [];
	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		if (token.startsWith("--")) {
			const key = token.slice(2);
			const next = tokens[i + 1];
			if (!next || next.startsWith("--")) {
				flags[key] = true;
				continue;
			}
			flags[key] = stripQuotes(next);
			i += 1;
			continue;
		}
		parts.push(stripQuotes(token));
	}
	return { query: parts.join(" ").trim(), flags };
}

function stripQuotes(value: string): string {
	return value.replace(/^["']|["']$/g, "");
}

function resolveParaffineRunner(ctx: ExtensionContext): RunnerSpec | null {
	const envScript = process.env.PARAFFINE_CLI_PATH?.trim();
	const envRoot = process.env.PARAFFINE_ROOT?.trim();
	const cwd = ctx.cwd || process.cwd();
	const candidates = [
		envScript || "",
		envRoot ? join(envRoot, "scripts", "paraffine-affine-inbox.js") : "",
		join(cwd, "scripts", "paraffine-affine-inbox.js"),
		"/Users/tonyholovka/workspace/PARA/scripts/paraffine-affine-inbox.js",
	].filter(Boolean);
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return { scriptPath: candidate, root: dirname(dirname(candidate)) };
		}
	}
	return null;
}

function slugify(input: string): string {
	return String(input || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function resolveParaffineSkill(ctx: ExtensionContext): SkillSpec | null {
	const cwd = ctx.cwd || process.cwd();
	const candidates = [
		join(cwd, ".pi", "skills", "paraffine", "SKILL.md"),
		join(cwd, "skills", "paraffine", "SKILL.md"),
		join("/Users/tonyholovka/workspace/PARA", ".pi", "skills", "paraffine", "SKILL.md"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return {
				id: "paraffine",
				sourcePath: candidate,
				label: basename(dirname(candidate)) || "paraffine",
			};
		}
	}
	return null;
}

function buildSkillInvocationMessage(skill: SkillSpec, prompt?: string): string | null {
	try {
		const markdown = readFileSync(skill.sourcePath, "utf-8");
		const promptText = String(prompt || "").trim();
		return [
			`<skill name="${slugify(skill.id)}" location="${skill.sourcePath}">`,
			`References are relative to ${dirname(skill.sourcePath)}.`,
			"",
			markdown.trim(),
			"</skill>",
			promptText ? `\n${promptText}` : "",
		].join("\n");
	} catch {
		return null;
	}
}

function launchParaffineSkill(pi: ExtensionAPI, ctx: ExtensionContext, prompt?: string): boolean {
	const skill = resolveParaffineSkill(ctx);
	if (!skill) return false;
	const message = buildSkillInvocationMessage(skill, prompt);
	if (!message) return false;
	pi.sendUserMessage(message);
	if (ctx.hasUI) ctx.ui.notify(`PARAFFINE launched ${skill.label}.`, "info");
	return true;
}

function buildArgs(
	command: "retrieve-notes" | "run-cycle" | "review-queue",
	query: string,
	flags: Record<string, string | boolean>,
): string[] {
	const args = [command];
	if (query) {
		args.push("--query", query);
	}
	const limit = typeof flags.limit === "string" && flags.limit ? flags.limit : String(DEFAULT_LIMIT);
	args.push("--limit", limit);
	if (typeof flags.statuses === "string" && flags.statuses.trim()) {
		args.push("--statuses", flags.statuses.trim());
	}
	return args;
}

async function runParaffineCommand(
	ctx: ExtensionContext,
	command: "retrieve-notes" | "run-cycle" | "review-queue",
	rawArgs: string,
): Promise<{ ok: boolean; stdout?: string; stderr?: string; status?: number; runner?: RunnerSpec }> {
	const runner = resolveParaffineRunner(ctx);
	if (!runner) {
		return {
			ok: false,
			stderr: "PARAFFINE CLI not found. Set PARAFFINE_CLI_PATH or PARAFFINE_ROOT, or run Pi from the PARA workspace with the repo-owned script present.",
		};
	}
	const parsed = parseCommandArgs(rawArgs);
	const nodeArgs = [runner.scriptPath, ...buildArgs(command, parsed.query, parsed.flags)];
	return new Promise((resolvePromise) => {
		const proc = spawn(process.execPath, nodeArgs, {
			cwd: runner.root,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("close", (code) => {
			resolvePromise({
				ok: code === 0,
				status: code ?? 0,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				runner,
			});
		});
	});
}

function formatModelLine(ctx: ExtensionContext): string {
	const provider = ctx.model?.provider || "none";
	const id = ctx.model?.id || "none";
	const active = `${provider}/${id}`;
	const suffix = active === PREFERRED_MODEL ? " (preferred)" : ` (preferred: ${PREFERRED_MODEL})`;
	return `${active}${suffix}`;
}

function summarizeJsonOutput(stdout: string): string {
	if (!stdout) return "No output returned.";
	try {
		const payload = JSON.parse(stdout);
		if (Array.isArray(payload)) {
			return `Returned ${payload.length} items.`;
		}
		if (payload && typeof payload === "object") {
			const bits: string[] = [];
			if (typeof payload.action === "string") bits.push(`action=${payload.action}`);
			if (typeof payload.command === "string") bits.push(`command=${payload.command}`);
			if (typeof payload.count === "number") bits.push(`count=${payload.count}`);
			if (typeof payload.processedInbox === "number") bits.push(`processedInbox=${payload.processedInbox}`);
			if (Array.isArray(payload.reviewed)) bits.push(`reviewed=${payload.reviewed.length}`);
			if (typeof payload.reviewed === "number") bits.push(`reviewed=${payload.reviewed}`);
			if (payload.retrieval && typeof payload.retrieval.count === "number") bits.push(`retrieved=${payload.retrieval.count}`);
			if (typeof payload.retrieved === "number") bits.push(`retrieved=${payload.retrieved}`);
			return bits.length > 0 ? bits.join(" · ") : JSON.stringify(payload, null, 2);
		}
	} catch {}
	return stdout;
}

function setParaffineStatus(ctx: ExtensionContext, message: string): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("paraffine", message);
}

function emitRuntimeMessage(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info"): void {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	const output = level === "error" ? console.error : console.log;
	output(message);
}

function emitCommandResult(ctx: ExtensionContext, stdout: string): void {
	const message = summarizeJsonOutput(stdout);
	emitRuntimeMessage(ctx, message, "info");
}

export default function paraffineExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyExtensionDefaults(import.meta.url, ctx);
		const runner = resolveParaffineRunner(ctx);
		const status = runner ? `PARAFFINE ready · ${formatModelLine(ctx)}` : "PARAFFINE unavailable · CLI not found";
		setParaffineStatus(ctx, status);
		if (ctx.model && `${ctx.model.provider}/${ctx.model.id}` !== PREFERRED_MODEL) {
			ctx.ui.notify(`PARAFFINE prefers ${PREFERRED_MODEL}. Current model: ${ctx.model.provider}/${ctx.model.id}`, "warning");
		}
	});

	pi.registerCommand("paraffine", {
		description: "Launch the PARAFFINE assistant surface for writing, retrieval, or curation",
		handler: async (args, ctx) => {
			const prompt = String(args || "").trim() || [
				"Use the PARAFFINE skill.",
				"Interpret this request using the PARAFFINE operating model.",
				"If the task is note-taking, write or update a working note in Inbox.",
				"If the task is retrieval, search the PARAFFINE corpus and return the best match.",
				"If the task is background maintenance, generate executor actions for curation.",
			].join(" ");
			if (!launchParaffineSkill(pi, ctx, prompt)) {
				emitRuntimeMessage(ctx, "PARAFFINE skill not found. Ensure .pi/skills/paraffine/SKILL.md is available in the workspace.", "error");
				return;
			}
			setParaffineStatus(ctx, `PARAFFINE assistant launched · ${formatModelLine(ctx)}`);
		},
	});

	pi.registerCommand("paraffine-status", {
		description: "Show PARAFFINE extension status, runner path, and preferred model",
		handler: async (_args, ctx) => {
			const runner = resolveParaffineRunner(ctx);
			const skill = resolveParaffineSkill(ctx);
			const lines = [
				`Workspace: ${ctx.cwd || process.cwd()}`,
				`Model: ${formatModelLine(ctx)}`,
				`CLI: ${runner?.scriptPath || "not found"}`,
				`Skill: ${skill?.sourcePath || "not found"}`,
				`Root: ${runner?.root || "not found"}`,
				`Launch: pi -e extensions/ollama-provider.ts -e extensions/paraffine.ts --model ${PREFERRED_MODEL}`,
				"Guidance: /paraffine-contract",
			];
			emitRuntimeMessage(ctx, lines.join("\n"), runner ? "info" : "warning");
			setParaffineStatus(ctx, runner ? `PARAFFINE status ok · ${formatModelLine(ctx)}` : "PARAFFINE unavailable · CLI not found");
		},
	});

	pi.registerCommand("paraffine-contract", {
		description: "Show the PARAFFINE pack-aware and quarantine-aware operator brief",
		handler: async (_args, ctx) => {
			emitRuntimeMessage(ctx, PARAFFINE_OPERATOR_BRIEF, "info");
			setParaffineStatus(ctx, `PARAFFINE contract loaded · ${formatModelLine(ctx)}`);
		},
	});

	pi.registerCommand("paraffine-retrieve", {
		description: "Retrieve curated PARAFFINE notes: /paraffine-retrieve <query> [--limit N] [--statuses a,b,c]",
		handler: async (args, ctx) => {
			setParaffineStatus(ctx, "PARAFFINE retrieve running...");
			const result = await runParaffineCommand(ctx, "retrieve-notes", args);
			if (!result.ok) {
				setParaffineStatus(ctx, "PARAFFINE retrieve failed");
				emitRuntimeMessage(ctx, result.stderr || "PARAFFINE retrieve failed.", "error");
				return;
			}
			setParaffineStatus(ctx, `PARAFFINE retrieve ok · ${summarizeJsonOutput(result.stdout || "")}`);
			emitCommandResult(ctx, result.stdout || "");
		},
	});

	pi.registerCommand("paraffine-cycle", {
		description: "Run PARAFFINE curation/review cycle: /paraffine-cycle [query] [--limit N]",
		handler: async (args, ctx) => {
			setParaffineStatus(ctx, "PARAFFINE cycle running...");
			const result = await runParaffineCommand(ctx, "run-cycle", args);
			if (!result.ok) {
				setParaffineStatus(ctx, "PARAFFINE cycle failed");
				emitRuntimeMessage(ctx, result.stderr || "PARAFFINE cycle failed.", "error");
				return;
			}
			setParaffineStatus(ctx, `PARAFFINE cycle ok · ${summarizeJsonOutput(result.stdout || "")}`);
			emitCommandResult(ctx, result.stdout || "");
		},
	});

	pi.registerCommand("paraffine-review", {
		description: "Run PARAFFINE review queue: /paraffine-review [query] [--limit N] [--statuses a,b,c]",
		handler: async (args, ctx) => {
			setParaffineStatus(ctx, "PARAFFINE review running...");
			const result = await runParaffineCommand(ctx, "review-queue", args);
			if (!result.ok) {
				setParaffineStatus(ctx, "PARAFFINE review failed");
				emitRuntimeMessage(ctx, result.stderr || "PARAFFINE review failed.", "error");
				return;
			}
			setParaffineStatus(ctx, `PARAFFINE review ok · ${summarizeJsonOutput(result.stdout || "")}`);
			emitCommandResult(ctx, result.stdout || "");
		},
	});
}
