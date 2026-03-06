/**
 * Requirements Q&A — Interactive human-in-the-loop requirements discovery
 *
 * The orchestrator (pi session) drives an interview loop with the user.
 * Specialist agents are consulted on demand for deep analysis.
 * Nothing gets finalized without user sign-off.
 *
 * Tools:
 *   consult_specialist  — call a specialist agent for focused analysis
 *   generate_artifacts  — produce PRD + checklist (only after user sign-off)
 *
 * Flow:
 *   1. Interview: discover what the user wants (one question at a time)
 *   2. Consult: call specialists for technical, UX, scenario, requirements analysis
 *   3. Review: present findings, get feedback, loop back for refinement
 *   4. Finalize: user signs off, then generate PRD + implementation checklist
 *
 * Usage: pi -ne -e extensions/req-qa.ts -e extensions/theme-cycler.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
}

type Phase = "interview" | "consulting" | "review" | "finalizing" | "done" | "idle";

interface ConsultRecord {
	specialist: string;
	question: string;
	response: string;
	timestamp: number;
	iteration: number;
}

const SPECIALISTS: Record<string, { label: string; color: string }> = {
	"req-analyst":      { label: "Requirements",  color: "accent" },
	"tech-analyst":     { label: "Technical",      color: "success" },
	"ux-analyst":       { label: "UX & Workflows", color: "warning" },
	"scenario-analyst": { label: "Scenarios",      color: "error" },
};

// ── Helpers ──────────────────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function parseAgentFile(filePath: string): AgentDef | null {
	try {
		const raw = readFileSync(filePath, "utf-8");
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) return null;
		const fm: Record<string, string> = {};
		for (const line of match[1].split("\n")) {
			const idx = line.indexOf(":");
			if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
		}
		if (!fm.name) return null;
		return {
			name: fm.name,
			description: fm.description || "",
			tools: fm.tools || "read,grep,find,ls",
			systemPrompt: match[2].trim(),
		};
	} catch { return null; }
}

function scanAgents(cwd: string): Map<string, AgentDef> {
	const dirs = [
		join(cwd, ".pi", "agents"),
		join(homedir(), ".pi", "agent", "agents"),
		join(homedir(), ".pi-init", "agents"),
	];
	const agents = new Map<string, AgentDef>();
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				const def = parseAgentFile(resolve(dir, file));
				if (def && !agents.has(def.name.toLowerCase())) {
					agents.set(def.name.toLowerCase(), def);
				}
			}
		} catch {}
	}
	return agents;
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let agents: Map<string, AgentDef> = new Map();
	let logDir = "";
	let sessionDir = "";
	let widgetCtx: ExtensionContext | null = null;

	// Session state
	let phase: Phase = "idle";
	let consultations: ConsultRecord[] = [];
	let iteration = 0;
	let activeConsultant = "";
	let consultStartTime = 0;
	let sessionStateFile = "";

	// ── Session Persistence ──────────────────────

	interface PersistedState {
		phase: Phase;
		consultations: ConsultRecord[];
		iteration: number;
		timestamp: number;
	}

	function saveSessionState() {
		if (!sessionStateFile) return;
		try {
			const state: PersistedState = {
				phase: phase === "consulting" ? "review" : phase,
				consultations,
				iteration,
				timestamp: Date.now(),
			};
			writeFileSync(sessionStateFile, JSON.stringify(state, null, 2), "utf-8");
		} catch {}
	}

	function loadSessionState(): PersistedState | null {
		if (!sessionStateFile || !existsSync(sessionStateFile)) return null;
		try {
			const raw = readFileSync(sessionStateFile, "utf-8");
			return JSON.parse(raw) as PersistedState;
		} catch { return null; }
	}

	function restoreState(saved: PersistedState) {
		consultations = saved.consultations;
		iteration = saved.iteration;
		phase = saved.phase === "done" ? "done" : "review";
		updateWidget();
	}

	function buildResumeSummary(saved: PersistedState, hasPrd: boolean, hasChecklist: boolean): string {
		const specsCovered = new Set(saved.consultations.map(c => c.specialist));
		const lines = [
			`Previous session found (${new Date(saved.timestamp).toLocaleString()}):`,
			`  Phase: ${saved.phase} | Iterations: ${saved.iteration}`,
			`  Consultations: ${saved.consultations.length} across ${specsCovered.size} specialist(s)`,
			`  Specialists: ${Array.from(specsCovered).map(displayName).join(", ") || "none"}`,
		];
		if (hasPrd) lines.push(`  PRD: docs/PRD.md exists`);
		if (hasChecklist) lines.push(`  Checklist: features/00-IMPLEMENTATION-CHECKLIST.md exists`);

		lines.push("");
		if (saved.consultations.length > 0) {
			lines.push("Last 3 consultations:");
			for (const c of saved.consultations.slice(-3)) {
				lines.push(`  [${displayName(c.specialist)}] iter ${c.iteration}: ${c.question.slice(0, 80)}`);
			}
		}
		return lines.join("\n");
	}

	function logFile(key: string): string { return join(logDir, `req-${key}.log`); }
	function writeLog(key: string, text: string) {
		if (!logDir) return;
		try { appendFileSync(logFile(key), text); } catch {}
	}
	function isInTmux(): boolean { return !!process.env.TMUX; }

	// ── Specialist Session Reuse ─────────────────
	// Keep one session file per specialist so subsequent consultations
	// of the same specialist continue the conversation (warm context).
	const specialistSessions = new Map<string, string>();

	function getSpecialistSessionFile(agentName: string): { path: string; isNew: boolean } {
		const existing = specialistSessions.get(agentName);
		if (existing && existsSync(existing)) {
			return { path: existing, isNew: false };
		}
		const path = join(sessionDir, `req-${agentName}.json`);
		specialistSessions.set(agentName, path);
		return { path, isNew: !existsSync(path) };
	}

	// ── Subprocess Runner ────────────────────────

	function runAgent(
		agentDef: AgentDef,
		task: string,
		sessionKey: string,
		ctx: ExtensionContext,
		options?: { noTools?: boolean; reuseSession?: boolean },
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const model = ctx.model
			? `${ctx.model.provider}/${ctx.model.id}`
			: "anthropic/claude-sonnet-4-20250514";

		const currentLogFile = logFile(sessionKey);
		try {
			appendFileSync(currentLogFile, `\n── ${agentDef.name} | ${new Date().toISOString()} ──\n\n`);
		} catch {}

		const args = [
			"--mode", "json",
			"-p",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--model", model,
			"--thinking", "off",
			"--system-prompt", agentDef.systemPrompt,
		];

		// Tools: use --no-tools for pure analysis, or minimal tool set
		if (options?.noTools) {
			args.push("--no-tools");
		} else {
			args.push("--tools", agentDef.tools);
		}

		// Session: reuse per-specialist for warm context, or ephemeral
		if (options?.reuseSession) {
			const { path, isNew } = getSpecialistSessionFile(sessionKey);
			args.push("--session", path);
			if (!isNew) args.push("-c");
		} else {
			args.push("--no-session");
		}

		args.push(task);

		const textChunks: string[] = [];
		const startTime = Date.now();

		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env },
			});

			let buffer = "";

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const event = JSON.parse(line);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") {
								textChunks.push(delta.delta || "");
								writeLog(sessionKey, delta.delta || "");
							}
						} else if (event.type === "tool_execution_start") {
							writeLog(sessionKey, `\n[TOOL] ${event.toolName || "tool"}\n`);
						} else if (event.type === "tool_execution_end") {
							writeLog(sessionKey, `\n[/TOOL]\n`);
						}
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", (chunk: string) => { writeLog(sessionKey, `[stderr] ${chunk}`); });

			proc.on("close", (code) => {
				if (buffer.trim()) {
					try {
						const event = JSON.parse(buffer);
						if (event.type === "message_update") {
							const delta = event.assistantMessageEvent;
							if (delta?.type === "text_delta") {
								textChunks.push(delta.delta || "");
								writeLog(sessionKey, delta.delta || "");
							}
						}
					} catch {}
				}
				writeLog(sessionKey, `\n── exit ${code} | ${Math.round((Date.now() - startTime) / 1000)}s ──\n`);
				resolve({ output: textChunks.join(""), exitCode: code ?? 1, elapsed: Date.now() - startTime });
			});

			proc.on("error", (err) => {
				resolve({ output: `Error: ${err.message}`, exitCode: 1, elapsed: Date.now() - startTime });
			});
		});
	}

	// ── Widget ───────────────────────────────────

	function renderSpecialistCard(name: string, record: ConsultRecord | null, colWidth: number, theme: any): string[] {
		const w = colWidth - 2;
		const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + "..." : s;
		const spec = SPECIALISTS[name] || { label: displayName(name), color: "dim" };

		const isActive = activeConsultant === name;
		const hasConsulted = record !== null;

		const statusIcon = isActive ? "●" : hasConsulted ? "✓" : "○";
		const statusColor = isActive ? "accent" : hasConsulted ? "success" : "dim";
		const statusText = isActive ? "consulting..." : hasConsulted ? `done (iter ${record!.iteration})` : "standby";

		const nameStr = theme.fg(spec.color, theme.bold(truncate(spec.label, w)));
		const nameVisible = Math.min(spec.label.length, w);

		const statusLine = theme.fg(statusColor, `${statusIcon} ${statusText}`);
		const statusVisible = statusIcon.length + 1 + statusText.length;

		const lastQ = record ? truncate(record.question, w - 1) : "—";
		const workLine = theme.fg("muted", lastQ);
		const workVisible = lastQ.length;

		const top = "┌" + "─".repeat(w) + "┐";
		const bot = "└" + "─".repeat(w) + "┘";
		const border = (content: string, visLen: number) =>
			theme.fg("dim", "│") + content + " ".repeat(Math.max(0, w - visLen)) + theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			border(" " + nameStr, 1 + nameVisible),
			border(" " + statusLine, 1 + statusVisible),
			border(" " + workLine, 1 + workVisible),
			theme.fg("dim", bot),
		];
	}

	function updateWidget() {
		if (!widgetCtx) return;

		widgetCtx.ui.setWidget("req-qa", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					const phaseLabel = phase === "idle" ? "Describe what you want to build."
						: phase === "interview" ? "Discovery interview in progress..."
						: phase === "consulting" ? `Consulting ${displayName(activeConsultant)}...`
						: phase === "review" ? "Reviewing findings — provide feedback or approve."
						: phase === "finalizing" ? "Generating artifacts..."
						: "Requirements discovery complete.";

					const headerLine = theme.fg("accent", theme.bold("Requirements Q&A")) +
						theme.fg("muted", ` · `) +
						theme.fg(phase === "idle" ? "dim" : "accent", phaseLabel) +
						theme.fg("muted", ` · Iteration ${iteration}`);

					const specialistNames = Object.keys(SPECIALISTS);
					const arrowWidth = 3;
					const totalArrow = arrowWidth * (specialistNames.length - 1);
					const colWidth = Math.max(14, Math.floor((width - totalArrow) / specialistNames.length));

					const lastConsultBySpec = new Map<string, ConsultRecord>();
					for (const c of consultations) {
						lastConsultBySpec.set(c.specialist, c);
					}

					const cards = specialistNames.map(name =>
						renderSpecialistCard(name, lastConsultBySpec.get(name) || null, colWidth, theme)
					);
					const cardHeight = cards[0]?.length || 0;

					const outputLines = [headerLine, ""];

					for (let line = 0; line < cardHeight; line++) {
						let row = cards[0][line];
						for (let c = 1; c < specialistNames.length; c++) {
							row += " ".repeat(arrowWidth);
							row += cards[c][line];
						}
						outputLines.push(row);
					}

					const consultCount = consultations.length;
					const specsCovered = new Set(consultations.map(c => c.specialist)).size;
					outputLines.push("");
					outputLines.push(
						theme.fg("dim", `  ${consultCount} consultation${consultCount !== 1 ? "s" : ""}`) +
						theme.fg("muted", " · ") +
						theme.fg("dim", `${specsCovered}/${specialistNames.length} specialists consulted`)
					);

					text.setText(outputLines.join("\n"));
					return text.render(width);
				},
				invalidate() { text.invalidate(); },
			};
		});
	}

	// ── Tool: Consult Specialist ──────────────────

	pi.registerTool({
		name: "consult_specialist",
		label: "Consult Specialist",
		description:
			`Consult a specialist agent for focused analysis on a specific aspect of the requirements. ` +
			`Available specialists: req-analyst (requirements gaps, functional/non-functional), ` +
			`tech-analyst (technical feasibility, stack, deployment), ux-analyst (user journeys, workflows, edge cases), ` +
			`scenario-analyst (failure modes, stress tests, edge scenarios). ` +
			`Provide a focused question or topic. The specialist will analyze and return structured findings. ` +
			`You can consult the same specialist multiple times with refined questions. ` +
			`Include any prior context or user feedback in your question so the specialist has full context. ` +
			`Set deep=true ONLY if the specialist needs to read/search the actual codebase (slower).`,
		parameters: Type.Object({
			specialist: Type.String({
				description: "Which specialist to consult: req-analyst, tech-analyst, ux-analyst, or scenario-analyst",
			}),
			question: Type.String({
				description: "The focused question or analysis request. Include relevant context from the interview and any prior specialist findings that should inform this consultation.",
			}),
			context: Type.Optional(Type.String({
				description: "Optional: accumulated requirements/decisions so far, to give the specialist full picture",
			})),
			deep: Type.Optional(Type.Boolean({
				description: "If true, specialist gets file-reading tools and session persistence (slower but can examine codebase). Default: false (fast prompt-only analysis).",
			})),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { specialist, question, context, deep } = params as {
				specialist: string;
				question: string;
				context?: string;
				deep?: boolean;
			};

			const agentName = specialist.toLowerCase();
			if (!SPECIALISTS[agentName]) {
				return {
					content: [{ type: "text" as const, text: `Unknown specialist "${specialist}". Available: ${Object.keys(SPECIALISTS).join(", ")}` }],
					details: { status: "error" },
				};
			}

			const agentDef = agents.get(agentName);
			if (!agentDef) {
				return {
					content: [{ type: "text" as const, text: `Specialist "${specialist}" agent definition not found. Check ~/.pi-init/agents/${specialist}.md exists.` }],
					details: { status: "error" },
				};
			}

			phase = "consulting";
			activeConsultant = agentName;
			consultStartTime = Date.now();
			updateWidget();

			if (onUpdate) {
				onUpdate({
					content: [{ type: "text" as const, text: `Consulting ${displayName(agentName)}...` }],
					details: { status: "running", specialist: agentName },
				});
			}

			const fullPrompt = [
				`You are being consulted as a ${displayName(agentName)} specialist.`,
				``,
				`## Question / Analysis Request`,
				question,
				"",
				...(context ? [`## Context (accumulated requirements and decisions so far)`, context, ""] : []),
				"",
				`Provide your analysis. Be specific, reference actual files if relevant.`,
				`Focus on answering the specific question asked.`,
				`If you identify issues, gaps, or risks, be concrete about what's missing and suggest solutions.`,
			].join("\n");

			const useDeep = deep === true;
			const timer = setInterval(() => updateWidget(), 1000);

			const result = await runAgent(agentDef, fullPrompt, agentName, ctx as ExtensionContext, {
				noTools: !useDeep,
				reuseSession: useDeep,
			});
			clearInterval(timer);

			iteration++;
			const record: ConsultRecord = {
				specialist: agentName,
				question: question.slice(0, 200),
				response: result.output,
				timestamp: Date.now(),
				iteration,
			};
			consultations.push(record);

			activeConsultant = "";
			phase = "review";
			updateWidget();
			saveSessionState();

			const elapsed = Math.round(result.elapsed / 1000);

			return {
				content: [{ type: "text" as const, text: result.output }],
				details: {
					status: result.exitCode === 0 ? "done" : "error",
					specialist: agentName,
					elapsed: result.elapsed,
					iteration,
				},
			};
		},

		renderCall(args, theme) {
			const a = args as any;
			const spec = SPECIALISTS[a.specialist] || { label: a.specialist, color: "dim" };
			const preview = (a.question || "").length > 60 ? (a.question || "").slice(0, 57) + "..." : (a.question || "");
			return new Text(
				theme.fg("toolTitle", theme.bold("consult_specialist ")) +
				theme.fg(spec.color, `[${spec.label}] `) +
				theme.fg("muted", preview),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.status === "running") {
				const spec = SPECIALISTS[details.specialist] || { label: details.specialist, color: "dim" };
				return new Text(theme.fg("accent", `● Consulting ${spec.label}...`), 0, 0);
			}
			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const elapsed = Math.round((details.elapsed || 0) / 1000);
			const spec = SPECIALISTS[details.specialist] || { label: details.specialist };
			const header = theme.fg(color, `${icon} ${spec.label}`) + theme.fg("dim", ` ${elapsed}s · iter ${details.iteration}`);
			if (options.expanded) {
				const t = result.content[0];
				return new Text(header + "\n" + (t?.type === "text" ? t.text : ""), 0, 0);
			}
			return new Text(header, 0, 0);
		},
	});

	// ── Tool: Generate Artifacts ──────────────────

	pi.registerTool({
		name: "generate_artifacts",
		label: "Generate PRD & Checklist",
		description:
			`Generate the final PRD document and implementation checklist. ` +
			`ONLY call this after the user has explicitly signed off on the requirements. ` +
			`Provide the complete, consolidated requirements specification that has been agreed upon. ` +
			`This will dispatch the prd-writer agent to produce docs/PRD.md and a features/00-IMPLEMENTATION-CHECKLIST.md.`,
		parameters: Type.Object({
			specification: Type.String({
				description: "The complete, consolidated requirements specification — all functional requirements, non-functional requirements, technical decisions, UX workflows, scenarios, and agreed-upon scope. This is the single source of truth for the PRD writer.",
			}),
			projectName: Type.String({
				description: "Name of the project/feature being spec'd",
			}),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { specification, projectName } = params as { specification: string; projectName: string };

			phase = "finalizing";
			updateWidget();

			if (onUpdate) {
				onUpdate({
					content: [{ type: "text" as const, text: "Generating PRD and implementation checklist..." }],
					details: { status: "running" },
				});
			}

			const prdWriter = agents.get("prd-writer");
			if (!prdWriter) {
				phase = "review";
				updateWidget();
				return {
					content: [{ type: "text" as const, text: "Error: prd-writer agent not found. Check ~/.pi-init/agents/prd-writer.md exists." }],
					details: { status: "error" },
				};
			}

			const docsDir = join((ctx as ExtensionContext).cwd, "docs");
			const featuresDir = join((ctx as ExtensionContext).cwd, "features");
			if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
			if (!existsSync(featuresDir)) mkdirSync(featuresDir, { recursive: true });

			const prdPath = join(docsDir, "PRD.md");
			const checklistPath = join(featuresDir, "00-IMPLEMENTATION-CHECKLIST.md");

			const prdPrompt = [
				`Write a comprehensive PRD for "${projectName}" based on the specification below.`,
				``,
				`Write the PRD to: ${prdPath}`,
				`Write the implementation checklist to: ${checklistPath}`,
				``,
				`## Agreed Specification`,
				specification,
				``,
				`## Previous Specialist Consultations`,
				...consultations.map(c =>
					`### ${displayName(c.specialist)} (iteration ${c.iteration})\n**Q:** ${c.question}\n**A:** ${c.response}\n`
				),
				``,
				`IMPORTANT:`,
				`- Write the PRD to ${prdPath}`,
				`- Write the implementation checklist to ${checklistPath}`,
				`- The checklist must have atomic tasks sized for a single agent session`,
				`- Each task: title, description, files to create/modify, acceptance criteria, dependencies`,
				``,
				`CHECKLIST FORMAT (MANDATORY — the pipeline parser requires this exact structure):`,
				``,
				`## Epic 1: Epic Title Here`,
				``,
				`- [ ] **1.1 — Task title here**`,
				`  - **Description:** What to implement...`,
				`  - **Files to create/modify:** file.ts`,
				`  - **Acceptance criteria:**`,
				`    - Criterion 1`,
				`    - Criterion 2`,
				`  - **Dependencies:** None (or 1.1, 1.2)`,
				``,
				`## Epic 2: Next Epic Title`,
				``,
				`- [ ] **2.1 — First task of epic 2**`,
				`  ...`,
				``,
				`RULES:`,
				`- MUST use "## Epic N:" headers to group tasks into epics (at least one epic required)`,
				`- MUST use dotted task IDs: N.M where N = epic number, M = task sequence (1.1, 1.2, 2.1, etc.)`,
				`- MUST use bold + em-dash format: - [ ] **N.M — Title**`,
				`- Tasks must be ordered by dependency within each epic`,
				`- Keep epics to 3-7 tasks each; split larger scopes into multiple epics`,
			].join("\n");

			const timer = setInterval(() => updateWidget(), 1000);
			const result = await runAgent(prdWriter, prdPrompt, "prd-writer", ctx as ExtensionContext, {
				noTools: false,
				reuseSession: true,
			});
			clearInterval(timer);

			const prdExists = existsSync(prdPath);
			const checklistExists = existsSync(checklistPath);

			// Publish to GitHub if repo is ready
			const cwd = (ctx as ExtensionContext).cwd;
			const ghStatus = isGitHubReady(cwd);
			let ghSummary = "";

			if (ghStatus.ready && prdExists && checklistExists) {
				const pub = await publishToGitHub(cwd, checklistPath, prdPath, ctx as ExtensionContext);
				if (pub.tasksCreated > 0) {
					const epicList = Array.from(pub.epicIssueNumbers.entries())
						.map(([id, num]) => `  #${num} — ${id}`)
						.join("\n");
					ghSummary = [
						``,
						`GitHub Issues:`,
						`  ✓ ${pub.epicsCreated} epic(s) created`,
						epicList,
						`  ✓ ${pub.tasksCreated} task(s) created` + (pub.tasksFailed > 0 ? ` (${pub.tasksFailed} failed)` : ""),
						`  ✓ Checklist updated with issue numbers`,
						pub.repoUrl ? `  View: ${pub.repoUrl}/issues` : "",
					].filter(Boolean).join("\n");
				}
			} else if (!ghStatus.ready) {
				ghSummary = `\nGitHub: skipped (${ghStatus.reason}). Use /req-rebuild-issues later.`;
			}

			phase = "done";
			updateWidget();
			saveSessionState();

			const summary = [
				prdExists ? `✓ PRD written to: ${prdPath}` : `✗ PRD not found at ${prdPath}`,
				checklistExists ? `✓ Checklist written to: ${checklistPath}` : `✗ Checklist not found at ${checklistPath}`,
				ghSummary,
				``,
				`${consultations.length} specialist consultations across ${new Set(consultations.map(c => c.specialist)).size} specialists`,
				`${iteration} iterations of refinement`,
				``,
				`Next steps:`,
				`  • Review the PRD: docs/PRD.md`,
				`  • Review the checklist: features/00-IMPLEMENTATION-CHECKLIST.md`,
				!ghStatus.ready ? `  • Set up GitHub repo then /req-rebuild-issues` : "",
				`  • Start development: pi-dev`,
			].filter(Boolean).join("\n");

			return {
				content: [{ type: "text" as const, text: summary + "\n\n" + result.output }],
				details: {
					status: prdExists ? "done" : "error",
					prdPath: prdExists ? prdPath : "",
					checklistPath: checklistExists ? checklistPath : "",
				},
			};
		},

		renderCall(args, theme) {
			const a = args as any;
			return new Text(
				theme.fg("toolTitle", theme.bold("generate_artifacts ")) +
				theme.fg("accent", a.projectName || ""),
				0, 0,
			);
		},

		renderResult(result, options, theme) {
			const details = result.details as any;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.status === "running") {
				return new Text(theme.fg("accent", "● Generating PRD..."), 0, 0);
			}
			const icon = details.status === "done" ? "✓" : "✗";
			const color = details.status === "done" ? "success" : "error";
			const header = theme.fg(color, `${icon} Artifacts ${details.status}`);
			if (options.expanded) {
				const t = result.content[0];
				return new Text(header + "\n" + (t?.type === "text" ? t.text : ""), 0, 0);
			}
			return new Text(header, 0, 0);
		},
	});

	// ── Commands ─────────────────────────────────

	pi.registerCommand("req-status", {
		description: "Show current requirements discovery status",
		handler: async (_args, ctx) => {
			const specsCovered = new Set(consultations.map(c => c.specialist));
			const lines = [
				`Phase: ${phase}`,
				`Iteration: ${iteration}`,
				`Consultations: ${consultations.length}`,
				`Specialists consulted: ${Array.from(specsCovered).map(displayName).join(", ") || "none yet"}`,
				``,
				`Available specialists:`,
				...Object.entries(SPECIALISTS).map(([name, spec]) => {
					const consulted = specsCovered.has(name);
					const count = consultations.filter(c => c.specialist === name).length;
					return `  ${consulted ? "✓" : "○"} ${spec.label} (${name}) — ${count} consultation${count !== 1 ? "s" : ""}`;
				}),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("req-history", {
		description: "Show consultation history",
		handler: async (_args, ctx) => {
			if (consultations.length === 0) {
				ctx.ui.notify("No consultations yet.", "info");
				return;
			}
			const lines = consultations.map((c, i) => {
				const spec = SPECIALISTS[c.specialist] || { label: c.specialist };
				const time = new Date(c.timestamp).toLocaleTimeString();
				return `${i + 1}. [${spec.label}] iter ${c.iteration} @ ${time}\n   Q: ${c.question.slice(0, 100)}`;
			});
			ctx.ui.notify(`Consultation History:\n\n${lines.join("\n\n")}`, "info");
		},
	});

	// Track tmux pane IDs so we can manage layout
	let watchPaneIds: string[] = [];

	function openTmuxTail(logPath: string, label: string, ctx: ExtensionContext): boolean {
		try {
			// Capture current (pi) pane ID before splitting
			const piPaneId = execSync("tmux display-message -p '#{pane_id}'", { encoding: "utf-8" }).trim();

			let splitCmd: string;

			if (watchPaneIds.length === 0) {
				// First pane: split right, 40% width
				splitCmd = `tmux split-window -h -l 40% "echo '── ${label} ──' && tail -f '${logPath}'"`;
			} else {
				// Subsequent: split the last watch pane vertically (stacks below)
				const lastPane = watchPaneIds[watchPaneIds.length - 1];
				splitCmd = `tmux split-window -v -t ${lastPane} -l 50% "echo '── ${label} ──' && tail -f '${logPath}'"`;
			}

			execSync(splitCmd, { stdio: "ignore" });

			// New pane is now active — capture its ID
			const newPaneId = execSync("tmux display-message -p '#{pane_id}'", { encoding: "utf-8" }).trim();
			watchPaneIds.push(newPaneId);

			// Refocus back to the pi pane
			execSync(`tmux select-pane -t ${piPaneId}`, { stdio: "ignore" });

			ctx.ui.notify(`Watching: ${label}`, "success");
			return true;
		} catch (err: any) {
			ctx.ui.notify(`Failed to open tmux pane: ${err.message}`, "error");
			return false;
		}
	}

	function findLatestLog(specialistName: string): string | null {
		if (!logDir || !existsSync(logDir)) return null;
		const logs = readdirSync(logDir)
			.filter(f => f.startsWith(`req-${specialistName}`) && f.endsWith(".log"))
			.sort();
		return logs.length > 0 ? logs[logs.length - 1] : null;
	}

	pi.registerCommand("req-logs", {
		description: "Open latest log for each specialist that has one (tmux panes)",
		handler: async (_args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux. Run pi inside tmux to use /req-logs.", "warning");
				return;
			}
			if (!logDir || !existsSync(logDir)) {
				ctx.ui.notify("No logs yet. Consult a specialist first.", "info");
				return;
			}

			// Close existing watch panes first
			for (const paneId of watchPaneIds) {
				try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
			}
			watchPaneIds = [];

			let opened = 0;
			const status: string[] = [];

			for (const [name, spec] of Object.entries(SPECIALISTS)) {
				const latest = findLatestLog(name);
				if (latest) {
					const logPath = join(logDir, latest);
					if (openTmuxTail(logPath, spec.label, ctx)) {
						opened++;
						status.push(`  ✓ ${spec.label} → ${latest}`);
					}
				} else {
					status.push(`  ○ ${spec.label} — no log yet`);
				}
			}

			// Also check prd-writer
			const prdLog = findLatestLog("prd-writer");
			if (prdLog) {
				if (openTmuxTail(join(logDir, prdLog), "PRD Writer", ctx)) {
					opened++;
					status.push(`  ✓ PRD Writer → ${prdLog}`);
				}
			}

			ctx.ui.notify(
				`Opened ${opened} watch pane${opened !== 1 ? "s" : ""}:\n\n${status.join("\n")}`,
				opened > 0 ? "success" : "info",
			);
		},
	});

	pi.registerCommand("req-watch", {
		description: "Open a tmux pane tailing a specific specialist's latest log",
		handler: async (args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux. Run pi inside tmux to use /req-watch.", "warning");
				return;
			}
			if (!args || !args.trim()) {
				ctx.ui.notify(
					"Usage: /req-watch <specialist>\n" +
					"Available: " + Object.keys(SPECIALISTS).join(", ") + ", prd-writer\n\n" +
					"Or use /req-logs to open all at once.",
					"info",
				);
				return;
			}

			const pattern = args.trim().toLowerCase();
			const latest = findLatestLog(pattern);
			if (!latest) {
				// Try partial match
				const allLogs = existsSync(logDir) ? readdirSync(logDir)
					.filter(f => f.endsWith(".log") && f.toLowerCase().includes(pattern))
					.sort() : [];
				const match = allLogs.pop();
				if (!match) {
					ctx.ui.notify(`No log matching "${args}". Available: ${Object.keys(SPECIALISTS).join(", ")}`, "warning");
					return;
				}
				const label = match.replace(/^req-/, "").replace(/-\d+/, "").replace(/\.log$/, "");
				openTmuxTail(join(logDir, match), displayName(label), ctx);
				return;
			}

			const spec = SPECIALISTS[pattern];
			openTmuxTail(join(logDir, latest), spec ? spec.label : displayName(pattern), ctx);
		},
	});

	pi.registerCommand("req-close-panes", {
		description: "Close all specialist watch panes",
		handler: async (_args, ctx) => {
			let closed = 0;
			for (const paneId of watchPaneIds) {
				try {
					execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" });
					closed++;
				} catch {}
			}
			watchPaneIds = [];
			if (prdPaneId) {
				try { execSync(`tmux kill-pane -t ${prdPaneId}`, { stdio: "ignore" }); closed++; } catch {}
				prdPaneId = "";
			}
			ctx.ui.notify(closed > 0 ? `Closed ${closed} pane${closed !== 1 ? "s" : ""}.` : "No panes open.", "info");
		},
	});

	let prdPaneId = "";

	pi.registerCommand("req-prd", {
		description: "Open PRD rendered with glow in a tmux pane to the right",
		handler: async (_args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not running inside tmux — cannot open pane.", "warning");
				return;
			}
			const prdPath = join(ctx.cwd, "docs", "PRD.md");
			if (!existsSync(prdPath)) {
				ctx.ui.notify("No PRD found at docs/PRD.md — generate artifacts first.", "warning");
				return;
			}
			if (prdPaneId) {
				try { execSync(`tmux kill-pane -t ${prdPaneId}`, { stdio: "ignore" }); } catch {}
				prdPaneId = "";
			}
			try {
				const out = execSync(`tmux split-window -h -p 45 -P -F '#{pane_id}' "glow -p ${prdPath}"`, { encoding: "utf-8" }).trim();
				prdPaneId = out;
				execSync(`tmux last-pane`, { stdio: "ignore" });
				ctx.ui.notify(`PRD opened with glow (pane ${prdPaneId}). Press q to close.`, "info");
			} catch (err: any) {
				ctx.ui.notify(`Failed to open PRD pane: ${err.message}`, "error");
			}
		},
	});

	// ── GitHub Publishing ────────────────────────

	function shellExec(cmd: string): { ok: boolean; stdout: string; stderr: string } {
		try {
			const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();
			return { ok: true, stdout, stderr: "" };
		} catch (err: any) {
			return { ok: false, stdout: err.stdout?.toString().trim() || "", stderr: err.stderr?.toString().trim() || err.message };
		}
	}

	interface ParsedTask {
		id: string;
		title: string;
		body: string;
		epic: string;
		epicNum: string;
		dependencies: string[];
	}

	interface ParsedEpic {
		id: string;
		title: string;
		prdBody: string;
	}

	function parseChecklist(checklistPath: string): { epics: Map<string, string>; tasks: ParsedTask[] } {
		const raw = readFileSync(checklistPath, "utf-8");
		const epics = new Map<string, string>();
		const tasks: ParsedTask[] = [];

		let currentEpic = "";
		let currentEpicId = "";
		let currentEpicNum = "";
		let currentTask: ParsedTask | null = null;
		let bodyLines: string[] = [];

		function flushTask() {
			if (currentTask) {
				currentTask.body = bodyLines.join("\n").trim();
				tasks.push(currentTask);
				currentTask = null;
				bodyLines = [];
			}
		}

		for (const line of raw.split("\n")) {
			// Epic header: ## Epic N: Title
			const epicMatch = line.match(/^##\s+(Epic\s+(\d+))[:\s—-]+(.+)/i);
			if (epicMatch) {
				flushTask();
				currentEpicId = epicMatch[1].trim();
				currentEpicNum = epicMatch[2].trim();
				currentEpic = epicMatch[3].trim();
				epics.set(currentEpicId, currentEpic);
				continue;
			}

			// Task line: - [ ] **1.1 — Title**
			const taskMatch = line.match(/^-\s+\[[ x]\]\s+\*\*(.+?)\s*[—–-]+\s*(.+?)\*\*/);
			if (taskMatch) {
				flushTask();
				const id = taskMatch[1].trim();
				const title = taskMatch[2].trim();
				currentTask = { id, title, body: "", epic: currentEpicId || "Tasks", epicNum: currentEpicNum, dependencies: [] };
				bodyLines = [];
				continue;
			}

			// Dependency line inside a task
			if (currentTask) {
				const depMatch = line.match(/^\s+[-*]\s+\*\*Dependencies?:\*\*\s*(.+)/i);
				if (depMatch) {
					const deps = depMatch[1].replace(/None/i, "").trim();
					if (deps) {
						currentTask.dependencies = deps.split(/[,;]/).map(d => d.trim()).filter(Boolean);
					}
				}
				bodyLines.push(line);
			}
		}
		flushTask();
		return { epics, tasks };
	}

	function parsePrdEpics(prdPath: string): Map<string, ParsedEpic> {
		const raw = readFileSync(prdPath, "utf-8");
		const result = new Map<string, ParsedEpic>();

		// Extract the Epics section (## 13. Epics or ### Epic N:)
		// Split PRD into sections by ## headers
		const lines = raw.split("\n");
		let inEpicsSection = false;
		let currentEpicId = "";
		let currentEpic: ParsedEpic | null = null;
		let epicLines: string[] = [];

		function flushEpic() {
			if (currentEpic) {
				currentEpic.prdBody = epicLines.join("\n").trim();
				result.set(currentEpicId, currentEpic);
				currentEpic = null;
				epicLines = [];
			}
		}

		for (const line of lines) {
			// Detect start of Epics section
			if (line.match(/^#{1,3}\s+\d+\.\s+Epics/i) || line.match(/^#{1,3}\s+Epics$/i)) {
				inEpicsSection = true;
				continue;
			}

			// Detect end of Epics section (next top-level section)
			if (inEpicsSection && line.match(/^#{1,2}\s+\d+\.\s+/) && !line.match(/epic/i)) {
				flushEpic();
				inEpicsSection = false;
				continue;
			}

			if (!inEpicsSection) continue;

			// Epic sub-header: ### Epic N: Title
			const epicMatch = line.match(/^###\s+(Epic\s+(\d+))[:\s—-]+(.+)/i);
			if (epicMatch) {
				flushEpic();
				currentEpicId = epicMatch[1].trim();
				currentEpic = { id: currentEpicId, title: epicMatch[3].trim(), prdBody: "" };
				epicLines = [];
				continue;
			}

			if (currentEpic) {
				epicLines.push(line);
			}
		}
		flushEpic();

		return result;
	}

	interface PublishResult {
		success: boolean;
		epicsCreated: number;
		tasksCreated: number;
		tasksFailed: number;
		epicIssueNumbers: Map<string, number>;
		taskIssueNumbers: Map<string, number>;
		repoUrl: string;
	}

	async function publishToGitHub(
		cwd: string,
		checklistPath: string,
		prdPath: string,
		ctx: ExtensionContext,
	): Promise<PublishResult> {
		const { epics, tasks } = parseChecklist(checklistPath);
		const hasPrd = existsSync(prdPath);
		const prdEpics = hasPrd ? parsePrdEpics(prdPath) : new Map<string, ParsedEpic>();

		// Create labels
		ctx.ui.setStatus("req-qa", "Creating labels...");
		for (const label of ["epic", "phase", "task", "sub-task"]) {
			const colors: Record<string, string> = { epic: "7057ff", phase: "0e8a16", task: "1d76db", "sub-task": "c5def5" };
			shellExec(`cd '${cwd}' && gh label create "${label}" --color "${colors[label]}" --force 2>/dev/null`);
		}

		// Create epic issues — enriched with PRD content
		const epicIssueNumbers = new Map<string, number>();
		let epicIdx = 0;
		for (const [epicId, epicTitle] of epics) {
			epicIdx++;
			ctx.ui.setStatus("req-qa", `Creating epic ${epicIdx}/${epics.size}: ${epicId}...`);
			const epicTasks = tasks.filter(t => t.epic === epicId);
			const taskList = epicTasks.map(t => `- [ ] **${t.id}** — ${t.title}`).join("\n");

			const prdEpic = prdEpics.get(epicId);
			const prdContent = prdEpic ? prdEpic.prdBody : "";

			const body = [
				`## ${epicId}: ${epicTitle}`,
				"",
				`### Reference`,
				hasPrd ? `- **PRD:** [docs/PRD.md](docs/PRD.md)` : "",
				`- **Checklist:** [features/00-IMPLEMENTATION-CHECKLIST.md](features/00-IMPLEMENTATION-CHECKLIST.md)`,
				"",
				prdContent ? `### Epic Scope (from PRD)\n${prdContent}` : "",
				"",
				`### Tasks (${epicTasks.length})`,
				taskList,
				"",
				`---`,
				`*Created by req-qa*`,
			].filter(Boolean).join("\n");

			const tmpFile = join(logDir, `_epic_body_${epicId.replace(/\s+/g, "_")}.md`);
			writeFileSync(tmpFile, body, "utf-8");

			const result = shellExec(
				`cd '${cwd}' && gh issue create --title "${epicId}: ${epicTitle}" --label "epic" --body-file '${tmpFile}'`
			);
			try { unlinkSync(tmpFile); } catch {}

			if (result.ok) {
				const num = parseInt(result.stdout.split("/").pop() || "0", 10);
				epicIssueNumbers.set(epicId, num);
			}
		}

		// Create task issues — full body from checklist, linked to epic and PRD
		const taskIssueNumbers = new Map<string, number>();
		let tasksCreated = 0;
		let tasksFailed = 0;

		let taskIdx = 0;
		for (const task of tasks) {
			taskIdx++;
			ctx.ui.setStatus("req-qa", `Creating task ${taskIdx}/${tasks.length}: ${task.id}...`);
			const epicNum = epicIssueNumbers.get(task.epic);
			const depRefs = task.dependencies
				.map(d => {
					const num = taskIssueNumbers.get(d);
					return num ? `#${num}` : d;
				})
				.join(", ");

			const body = [
				`## Task: ${task.id} — ${task.title}`,
				"",
				`### Reference`,
				epicNum ? `- **Epic:** #${epicNum} (${task.epic})` : `- **Epic:** ${task.epic}`,
				hasPrd ? `- **PRD:** [docs/PRD.md](docs/PRD.md)` : "",
				depRefs ? `- **Dependencies:** ${depRefs}` : "- **Dependencies:** None",
				"",
				`### Task Detail`,
				task.body,
				"",
				`---`,
				`*Created by req-qa*`,
			].filter(Boolean).join("\n");

			const issueTitle = `[${task.id}] ${task.title}`;
			const tmpFile = join(logDir, `_task_body_${task.id.replace(/\./g, "_")}.md`);
			writeFileSync(tmpFile, body, "utf-8");

			const result = shellExec(
				`cd '${cwd}' && gh issue create --title "${issueTitle.replace(/"/g, '\\"')}" --label "task" --body-file '${tmpFile}'`
			);
			try { unlinkSync(tmpFile); } catch {}

			if (result.ok) {
				const num = parseInt(result.stdout.split("/").pop() || "0", 10);
				taskIssueNumbers.set(task.id, num);
				tasksCreated++;
			} else {
				tasksFailed++;
			}
		}

		// Update checklist with issue numbers
		ctx.ui.setStatus("req-qa", "Updating checklist with issue numbers...");
		if (taskIssueNumbers.size > 0) {
			let checklist = readFileSync(checklistPath, "utf-8");
			for (const [taskId, issueNum] of taskIssueNumbers) {
				const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const re = new RegExp(`(\\*\\*${escaped}\\s*[—–-]+\\s*.+?\\*\\*)(?!\\s*\\(#)`, "g");
				checklist = checklist.replace(re, `$1 (#${issueNum})`);
			}
			writeFileSync(checklistPath, checklist, "utf-8");
		}

		const remoteCheck = shellExec(`git -C '${cwd}' remote get-url origin`);
		const repoUrl = remoteCheck.ok ? remoteCheck.stdout.replace(/\.git$/, "") : "";

		return {
			success: tasksFailed === 0,
			epicsCreated: epicIssueNumbers.size,
			tasksCreated,
			tasksFailed,
			epicIssueNumbers,
			taskIssueNumbers,
			repoUrl,
		};
	}

	function isGhAuthenticated(): boolean {
		const r = shellExec("gh auth status 2>&1");
		return (r.stdout + r.stderr).includes("Logged in");
	}

	function isGitHubReady(cwd: string): { ready: boolean; reason?: string } {
		if (!isGhAuthenticated()) return { ready: false, reason: "gh not authenticated" };

		const topLevel = shellExec(`git -C '${cwd}' rev-parse --show-toplevel`);
		if (!topLevel.ok || topLevel.stdout !== cwd) return { ready: false, reason: "not a git repo" };

		const remoteCheck = shellExec(`git -C '${cwd}' remote get-url origin`);
		if (!remoteCheck.ok) return { ready: false, reason: "no remote" };

		return { ready: true };
	}

	function extractPrdSectionSnippet(prdPath: string, sectionPattern: RegExp, maxLines: number = 40): string {
		const raw = readFileSync(prdPath, "utf-8");
		const lines = raw.split("\n");
		let capturing = false;
		let captured: string[] = [];

		for (const line of lines) {
			if (line.match(sectionPattern)) {
				capturing = true;
				captured = [line];
				continue;
			}
			if (capturing) {
				// Stop at next same-level or higher header
				if (line.match(/^#{1,2}\s+\d+\.\s+/) && captured.length > 1) break;
				captured.push(line);
				if (captured.length >= maxLines) {
					captured.push("*(truncated — see full PRD)*");
					break;
				}
			}
		}
		return captured.join("\n").trim();
	}

	pi.registerCommand("req-rebuild-issues", {
		description: "Rebuild GitHub issues from PRD + checklist (use when issues weren't created during generate_artifacts)",
		handler: async (_args, ctx) => {
			const cwd = (ctx as any).cwd || process.cwd();

			// Check gh CLI
			if (!isGhAuthenticated()) {
				ctx.ui.notify("GitHub CLI not authenticated. Run `gh auth login` first.", "error");
				return;
			}

			// Check/create git repo — cwd must be the repo root (not a subdir of another repo)
			const topLevel = shellExec(`git -C '${cwd}' rev-parse --show-toplevel`);
			const hasRepo = topLevel.ok && topLevel.stdout === cwd;

			if (!hasRepo) {
				const create = await ctx.ui.confirm(
					"No Git Repository",
					"This folder isn't a git repo. Create one and a GitHub remote?",
				);
				if (!create) {
					ctx.ui.notify("Initialize a repo first, then re-run /req-rebuild-issues.", "info");
					return;
				}

				shellExec(`git -C '${cwd}' init`);
				shellExec(`git -C '${cwd}' add -A`);
				shellExec(`git -C '${cwd}' commit -m "Initial commit: PRD and implementation checklist"`);

				const folderName = cwd.split("/").pop() || "project";
				const repoName = await ctx.ui.input("GitHub repo name", folderName);
				if (!repoName) {
					ctx.ui.notify("Repo created locally. Add a remote manually, then re-run.", "info");
					return;
				}

				const visibility = await ctx.ui.select("Repository visibility", ["private", "public"]);
				const visFlag = visibility === "public" ? "--public" : "--private";

				const ghCreate = shellExec(`gh repo create '${repoName}' ${visFlag} --source '${cwd}' --push`);
				if (!ghCreate.ok) {
					ctx.ui.notify(`Failed to create repo: ${ghCreate.stderr}`, "error");
					return;
				}
				ctx.ui.notify(`Created GitHub repo: ${repoName}`, "success");
			}

			// Check for remote — create GitHub repo if missing
			const remoteCheck = shellExec(`git -C '${cwd}' remote get-url origin`);
			if (!remoteCheck.ok) {
				const createRemote = await ctx.ui.confirm(
					"No GitHub Remote",
					"This repo has no remote. Create a GitHub repo and push?",
				);
				if (!createRemote) {
					ctx.ui.notify("Add a remote with `git remote add origin <url>`, then re-run.", "info");
					return;
				}

				// Ensure there's at least one commit
				ctx.ui.setStatus("req-qa", "Initializing git repo...");
				const logCheck = shellExec(`git -C '${cwd}' log --oneline -1`);
				if (!logCheck.ok) {
					shellExec(`git -C '${cwd}' add -A`);
					shellExec(`git -C '${cwd}' commit -m "Initial commit: PRD and implementation checklist"`);
				}

				const folderName = cwd.split("/").pop() || "project";
				let repoName: string | undefined;
				ctx.ui.setStatus("req-qa", "");
				try {
					repoName = await ctx.ui.input("GitHub repo name", folderName);
				} catch { repoName = folderName; }
				if (!repoName) repoName = folderName;

				ctx.ui.setStatus("req-qa", `Creating GitHub repo '${repoName}' and pushing...`);
				const ghCreate = shellExec(`gh repo create '${repoName}' --private --source '${cwd}' --push`);
				ctx.ui.setStatus("req-qa", "");
				if (!ghCreate.ok) {
					ctx.ui.notify(`Failed to create repo: ${ghCreate.stderr}`, "error");
					return;
				}
				ctx.ui.notify(`Created GitHub repo: ${repoName}`, "success");
			}

			// Find artifacts
			const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
			const prdPath = join(cwd, "docs", "PRD.md");

			if (!existsSync(checklistPath)) {
				ctx.ui.notify("No checklist at features/00-IMPLEMENTATION-CHECKLIST.md. Run generate_artifacts first.", "error");
				return;
			}

			const { epics, tasks } = parseChecklist(checklistPath);
			if (tasks.length === 0) {
				ctx.ui.notify("No tasks found in checklist.", "error");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Rebuild GitHub Issues",
				`Found ${epics.size} epic(s) and ${tasks.length} task(s). Create GitHub issues from PRD + checklist?`,
			);
			if (!confirm) return;

			ctx.ui.setStatus("req-qa", `Publishing ${epics.size} epics and ${tasks.length} tasks to GitHub...`);

			const pub = await publishToGitHub(cwd, checklistPath, prdPath, ctx as ExtensionContext);
			ctx.ui.setStatus("req-qa", "");

			const epicList = Array.from(pub.epicIssueNumbers.entries())
				.map(([id, num]) => `  #${num} — ${id}`)
				.join("\n");

			ctx.ui.notify(
				`GitHub Issues Created!\n\n` +
				`Epics: ${pub.epicsCreated}\n` +
				epicList + "\n\n" +
				`Tasks: ${pub.tasksCreated}` + (pub.tasksFailed > 0 ? ` (${pub.tasksFailed} failed)` : "") + "\n\n" +
				`Checklist updated with issue numbers.\n` +
				(pub.repoUrl ? `View: ${pub.repoUrl}/issues` : ""),
				"success",
			);
		},
	});

	pi.registerCommand("req-reset", {
		description: "Reset the requirements session (start fresh)",
		handler: async (_args, ctx) => {
			consultations = [];
			iteration = 0;
			activeConsultant = "";
			phase = "idle";
			// Clear specialist session files
			for (const [, path] of specialistSessions) {
				try { if (existsSync(path)) unlinkSync(path); } catch {}
			}
			specialistSessions.clear();
			// Clear persisted session state
			if (sessionStateFile && existsSync(sessionStateFile)) {
				try { unlinkSync(sessionStateFile); } catch {}
			}
			updateWidget();
			ctx.ui.notify("Requirements session reset. Describe what you want to build.", "info");
		},
	});

	// ── Tool Gate ────────────────────────────────

	pi.on("tool_call", async (event, _ctx) => {
		const allowed = ["consult_specialist", "generate_artifacts"];
		if (allowed.includes(event.toolName)) return { block: false };

		return {
			block: true,
			reason: `BLOCKED: You are a requirements discovery coordinator. You can ONLY use: consult_specialist (to get specialist analysis) and generate_artifacts (to produce PRD after user sign-off). You CANNOT use "${event.toolName}". Do NOT write code, create files, or implement anything. Your job is to INTERVIEW the user, CONSULT specialists, PRESENT findings, and LOOP until the user signs off.`,
		};
	});

	// ── System Prompt ────────────────────────────

	let resumeContext = "";

	pi.on("before_agent_start", async (_event, ctx) => {
		const basePrompt = `You are a REQUIREMENTS DISCOVERY COORDINATOR running an interactive human-in-the-loop process.

## YOUR ROLE
You interview the user to understand what they want to build. You consult specialist agents for deep analysis. You present findings, gather feedback, and iterate until the user is satisfied. ONLY then do you generate artifacts.

## YOUR TOOLS
1. **consult_specialist** — Call a specialist for focused analysis. Available specialists:
   - req-analyst: Requirements gaps, functional/non-functional requirements
   - tech-analyst: Technical feasibility, stack decisions, deployment
   - ux-analyst: User journeys, workflows, edge cases, interaction design
   - scenario-analyst: Failure modes, stress tests, edge scenarios
2. **generate_artifacts** — Produce the final PRD + implementation checklist (ONLY after user explicitly approves)

## INTERVIEW PROCESS (follow this flow)

### Phase 1: Discovery (ONE question at a time)
- Ask what the user wants to build
- Ask clarifying questions ONE AT A TIME
- Cover: what, why, who, how, scope, constraints
- Do NOT dump a list of questions — have a conversation

### Phase 2: Specialist Consultation (iterate with user)
After you have enough context from the interview:
- Tell the user which specialist you want to consult and why
- Call consult_specialist with a focused question and accumulated context
- Present the specialist's findings to the user in a clear summary
- Ask: "Does this align with your vision? Any corrections or additions?"
- If the user has feedback, incorporate it and re-consult if needed
- Repeat for other specialists as the conversation naturally evolves
- You do NOT need to consult all specialists — only those relevant to the discussion

### Phase 3: Alignment Check
After consulting specialists:
- Present a consolidated summary of all findings
- Highlight any conflicts between specialists
- Highlight decisions that need user input
- Ask: "Are we aligned on all of this? Anything to change?"
- If user wants changes, loop back to Phase 2

### Phase 4: Sign-off & Artifact Generation
ONLY when the user explicitly says they're happy / ready / "looks good" / "generate it":
- Call generate_artifacts with the complete consolidated specification
- Present the results

## RULES — ABSOLUTE
- ONE question at a time during interview
- WAIT for user response before proceeding
- NEVER skip ahead or assume answers
- NEVER generate artifacts without explicit user approval
- ALWAYS present specialist findings and ask for feedback
- ALWAYS include accumulated context when consulting specialists so they have the full picture
- If the user changes direction, adapt — the conversation drives everything
- You are NOT a developer — you do not write code or create files
- Keep your responses concise and focused — no walls of text

## CONVERSATION STYLE
- Be direct and professional
- Ask smart, probing questions that uncover hidden requirements
- Challenge vague answers — "Can you be more specific about X?"
- When presenting findings, use bullet points not paragraphs
- Reference specific findings by specialist when discussing trade-offs`;

		// Build context from session state
		let contextBlock = "";

		if (consultations.length > 0) {
			const historyLines = consultations.map(c =>
				`### ${displayName(c.specialist)} (iteration ${c.iteration})\n**Q:** ${c.question}\n**Summary:** ${c.response.slice(0, 500)}${c.response.length > 500 ? "..." : ""}\n`
			);
			contextBlock += `\n\n## SESSION HISTORY\nYou are RESUMING a previous session. Here is what was discussed:\n\n${historyLines.join("\n")}`;
			contextBlock += `\n\nYou are at iteration ${iteration}, phase: ${phase}.`;
			contextBlock += `\nStart by summarizing what was covered so far and ask the user what they'd like to do next.`;
		}

		// If PRD exists and we're in enhance mode — derive cwd from sessionDir
		const cwd = sessionDir ? dirname(dirname(sessionDir)) : ".";
		const prdPath = join(cwd, "docs", "PRD.md");
		if (existsSync(prdPath) && phase !== "idle") {
			try {
				const prdContent = readFileSync(prdPath, "utf-8");
				const prdExcerpt = prdContent.slice(0, 3000) + (prdContent.length > 3000 ? "\n\n*(PRD truncated — read docs/PRD.md for full content)*" : "");
				contextBlock += `\n\n## EXISTING PRD\nA PRD already exists. The user may want to enhance, modify, or add to it:\n\n${prdExcerpt}`;
				contextBlock += `\n\nIf the user wants changes, consult specialists about the proposed changes and their impact on existing requirements. When generating artifacts, the PRD should be UPDATED (not replaced from scratch) unless the user explicitly wants a rewrite.`;
			} catch {}
		}

		if (resumeContext) {
			contextBlock += `\n\n${resumeContext}`;
		}

		return { systemPrompt: basePrompt + contextBlock };
	});

	// ── Session Lifecycle ────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
		widgetCtx = ctx;

		sessionDir = join(ctx.cwd, ".pi", "agent-sessions");
		logDir = join(ctx.cwd, ".pi", "pipeline-logs");
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

		sessionStateFile = join(sessionDir, "req-qa-state.json");

		agents = scanAgents(ctx.cwd);
		consultations = [];
		iteration = 0;
		phase = "idle";

		pi.setActiveTools(["consult_specialist", "generate_artifacts"]);

		const available = Object.keys(SPECIALISTS).filter(a => agents.has(a));
		const missing = Object.keys(SPECIALISTS).filter(a => !agents.has(a));

		if (missing.length > 0) {
			ctx.ui.notify(`Missing specialist agents: ${missing.join(", ")}`, "warning");
		}

		// ── Resume / Enhance Detection (auto-detect, use /req-reset for fresh) ──
		let resumeMode: "fresh" | "resume" | "enhance" = "fresh";

		try {
			const savedState = loadSessionState();
			const hasPrd = existsSync(join(ctx.cwd, "docs", "PRD.md"));
			const hasHistory = savedState && savedState.consultations.length > 0;

			if (hasHistory && savedState) {
				restoreState(savedState);
				resumeMode = "resume";
			} else if (hasPrd) {
				phase = "review";
				resumeMode = "enhance";
			}
		} catch (err: any) {
			ctx.ui.notify(`Resume detection error: ${err.message}`, "error");
		}

		updateWidget();

		if (resumeMode === "resume") {
			ctx.ui.notify(
				`Session resumed — ${consultations.length} consultations, iteration ${iteration}\n` +
				`You're in the ${phase} phase. Continue where you left off.\n` +
				`Use /req-reset to start fresh instead.`,
				"success",
			);
		} else if (resumeMode === "enhance") {
			saveSessionState();
			ctx.ui.notify(
				`Existing PRD detected — enhancement mode.\n` +
				`Tell me what you'd like to change, add, or refine.\n` +
				`Use /req-reset to start fresh instead.`,
				"success",
			);
		} else {
			ctx.ui.notify(
				`Requirements Q&A — Interactive Discovery Mode\n\n` +
				`Specialists available: ${available.map(a => SPECIALISTS[a].label).join(", ")}\n\n` +
				`Describe what you want to build. I'll interview you, consult specialists\n` +
				`for deep analysis, and iterate until you're satisfied.`,
				"info",
			);
		}

		ctx.ui.notify(
			`Commands:\n` +
			`  /req-status       Current session status\n` +
			`  /req-history      Consultation history\n` +
			`  /req-logs         Open all specialist logs in tmux\n` +
			`  /req-watch <name> Tail one specialist's log\n` +
			`  /req-close-panes  Close all watch panes\n` +
			`  /req-prd          View rendered PRD in a tmux pane\n` +
			`  /req-rebuild-issues  Rebuild GitHub issues from artifacts\n` +
			`  /req-reset        Start fresh`,
			"info",
		);

		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id || "no-model";
				const usage = ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);
				const phaseStr = phase === "consulting"
					? theme.fg("accent", `consulting ${displayName(activeConsultant)}`)
					: theme.fg(phase === "idle" ? "dim" : "accent", phase);
				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", "req-qa") +
					theme.fg("muted", " · ") + phaseStr +
					theme.fg("muted", ` · iter ${iteration}`);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
