/**
 * Dev Pipeline — 3-Wave diffusion-inspired development lifecycle
 *
 * Flow per epic:
 *   Foundations Council:
 *     1. 3 architect models run in parallel → produce design briefs
 *     2. Orchestrator consolidates briefs into unified Foundations Spec
 *
 *   Wave 0 — Prototype POC (~2-3 min):
 *     1. Gemini one-shots the full build from consolidated spec
 *     2. Haiku reviews and enhances with a fresh perspective
 *     3. Qwen 3.5 Plus fine-tunes and polishes further
 *     Result: working end-to-end prototype
 *
 *   Wave 1 — Review & TODO Placement:
 *     1. Reviews what Wave 0 built against the spec
 *     2. Places TODO markers for gaps, issues, and refinements
 *     3. Compliance check on TODO coverage
 *
 *   Wave 2 — Parallel Dev Sprint (~2-3 min):
 *     1. N dev agents run in parallel (one per task)
 *        Each sees full codebase + their TODO markers + acceptance criteria
 *     2. Per-task compliance scoring
 *     3. Targeted fixes for any <95% tasks (max 2 retries)
 *     4. Quality gates: review → build/lint → test (each with dev remediation)
 *     5. Update checklist + GitHub issues
 *
 * Target: <5 min per epic, 95% compliance, repeatable every time.
 *
 * Commands:
 *   /pipeline-start     — Show plan, create branch, start session
 *   /pipeline-next      — Run next phase through full 2-wave loop
 *   /pipeline-end       — UAT sign-off, squash merge to main, push, clean up
 *   /pipeline-status    — Show progress
 *   /pipeline-logs      — Open all agent logs in tmux
 *   /pipeline-watch     — Tail one agent's log
 *   /pipeline-close-panes — Close tmux panes
 *
 * Usage: pi -ne -e extensions/dev-pipeline.ts -e extensions/theme-cycler.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth, SettingsList, SelectList, getEditorKeybindings } from "@mariozechner/pi-tui";
import type { SettingItem, SettingsListTheme, SelectItem, SelectListTheme } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, createWriteStream } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { homedir, tmpdir } from "os";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	model?: string;
}

type TaskStatus = "pending" | "building" | "scoring" | "passed" | "failed";
type PhaseGate = "idle" | "wave1-council" | "wave1-consolidate" | "wave0-proto-1" | "wave0-proto-2" | "wave0-proto-3" | "wave1-review" | "wave1-compliance" | "wave2-parallel" | "wave2-compliance" | "wave2-fix" | "wave2-blocked" | "review" | "build-lint" | "test" | "done" | "error";

interface Checkpoint {
	version: number;
	phaseIdx: number;
	phaseName: string;
	branch: string;
	completedGate: PhaseGate;
	foundationsSpec: string;
	tasks: { id: string; title: string; body: string; epic: string; status: TaskStatus; complianceScore: number; attempts: number; issueNum?: number }[];
	timestamp: number;
}

interface TaskState {
	id: string;
	title: string;
	body: string;
	epic: string;
	status: TaskStatus;
	complianceScore: number;
	attempts: number;
	issueNum?: number;
}

interface PhaseState {
	name: string;
	tasks: TaskState[];
	gate: PhaseGate;
	gateAttempts: number;
	startTime: number;
	elapsed: number;
}

interface PipelineState {
	phases: string[];
	currentPhase: number;
	phaseStates: Map<string, PhaseState>;
	branch: string;
	running: boolean;
}

const COMPLIANCE_THRESHOLD = 95;
const MAX_LOOPS = 5; // More attempts before giving up
const MAX_SUBTASK_DEPTH = 5; // Max decomposition levels for fast track

type PipelineMode = "3wave" | "fast";

interface UatScenario {
	id: string;
	title: string;
	epic: string;
	inputs: string;
	steps: string[];
	expectedOutcomes: string[];
	issueNum?: number;
	result?: "pass" | "fail" | "pending";
	evidence?: string;
}

interface UatState {
	epicIssueNum?: number;
	scenarios: UatScenario[];
	awaitingApproval: boolean;
	approved: boolean;
	rejectionNotes?: string;
}

// ── Pipeline Config ──────────────────────────────

type ThinkingLevelOption = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const THINKING_LEVELS: ThinkingLevelOption[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

interface RoleConfig {
	model: string;
	thinking: ThinkingLevelOption;
}

interface PipelineModelConfig {
	fast: {
		build: RoleConfig;
		eval: RoleConfig;
		fix: RoleConfig;
		fixEscalation: RoleConfig[];
		uat: RoleConfig;
	};
	multiwave: {
		council1: RoleConfig;
		council2: RoleConfig;
		council3: RoleConfig;
		proto1: RoleConfig;
		proto2: RoleConfig;
		proto3: RoleConfig;
		dev: RoleConfig;
		compliance: RoleConfig;
		orchestrator: RoleConfig;
	};
}

const DEFAULT_CONFIG: PipelineModelConfig = {
	fast: {
		build: { model: "google-gemini-cli/gemini-3-pro-preview", thinking: "high" },
		eval: { model: "anthropic/claude-opus-4-6", thinking: "high" },
		fix: { model: "bailian/qwen3.5-plus", thinking: "high" },
		fixEscalation: [
			{ model: "anthropic/claude-sonnet-4-6", thinking: "high" },
			{ model: "anthropic/claude-opus-4-6", thinking: "xhigh" },
		],
		uat: { model: "google-gemini-cli/gemini-3-pro-preview", thinking: "medium" },
	},
	multiwave: {
		council1: { model: "anthropic/claude-opus-4-6", thinking: "medium" },
		council2: { model: "bailian/qwen3.5-plus", thinking: "medium" },
		council3: { model: "google-gemini-cli/gemini-3-pro-preview", thinking: "medium" },
		proto1: { model: "google-gemini-cli/gemini-3-pro-preview", thinking: "medium" },
		proto2: { model: "anthropic/claude-haiku-4-5", thinking: "medium" },
		proto3: { model: "bailian/qwen3.5-plus", thinking: "medium" },
		dev: { model: "anthropic/claude-haiku-4-5", thinking: "medium" },
		compliance: { model: "bailian/qwen3.5-plus", thinking: "medium" },
		orchestrator: { model: "anthropic/claude-opus-4-6", thinking: "medium" },
	},
};

function getConfigPath(): string {
	return join(homedir(), ".pi", "agent", "pipeline-config.json");
}

function migrateRole(saved: any, fallback: RoleConfig): RoleConfig {
	if (!saved) return { ...fallback };
	if (typeof saved === "string") return { model: saved, thinking: fallback.thinking };
	return { model: saved.model || fallback.model, thinking: saved.thinking || fallback.thinking };
}

function loadPipelineConfig(): PipelineModelConfig {
	const configPath = getConfigPath();
	if (!existsSync(configPath)) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf-8"));
		const fast = raw.fast || {};
		const mw = raw.multiwave || {};
		return {
			fast: {
				build: migrateRole(fast.build, DEFAULT_CONFIG.fast.build),
				eval: migrateRole(fast.eval, DEFAULT_CONFIG.fast.eval),
				fix: migrateRole(fast.fix, DEFAULT_CONFIG.fast.fix),
				fixEscalation: Array.isArray(fast.fixEscalation)
					? fast.fixEscalation.map((e: any, i: number) => migrateRole(e, DEFAULT_CONFIG.fast.fixEscalation[i] || DEFAULT_CONFIG.fast.fix))
					: JSON.parse(JSON.stringify(DEFAULT_CONFIG.fast.fixEscalation)),
				uat: migrateRole(fast.uat, DEFAULT_CONFIG.fast.uat),
			},
			multiwave: {
				council1: migrateRole(mw.council1, DEFAULT_CONFIG.multiwave.council1),
				council2: migrateRole(mw.council2, DEFAULT_CONFIG.multiwave.council2),
				council3: migrateRole(mw.council3, DEFAULT_CONFIG.multiwave.council3),
				proto1: migrateRole(mw.proto1, DEFAULT_CONFIG.multiwave.proto1),
				proto2: migrateRole(mw.proto2, DEFAULT_CONFIG.multiwave.proto2),
				proto3: migrateRole(mw.proto3, DEFAULT_CONFIG.multiwave.proto3),
				dev: migrateRole(mw.dev, DEFAULT_CONFIG.multiwave.dev),
				compliance: migrateRole(mw.compliance, DEFAULT_CONFIG.multiwave.compliance),
				orchestrator: migrateRole(mw.orchestrator, DEFAULT_CONFIG.multiwave.orchestrator),
			},
		};
	} catch {
		return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
	}
}

function savePipelineConfig(config: PipelineModelConfig): void {
	const configPath = getConfigPath();
	const dir = join(homedir(), ".pi", "agent");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function shortModelName(fullId: string): string {
	const parts = fullId.split("/");
	return parts.length > 1 ? parts[1] : fullId;
}

function pingModel(modelId: string): boolean {
	try {
		const providerExtDir = join(homedir(), ".pi", "agent", "extensions");
		const providerExts: string[] = [];
		if (existsSync(providerExtDir)) {
			for (const f of readdirSync(providerExtDir)) {
				if (f.endsWith("-provider.ts")) providerExts.push("-e", join(providerExtDir, f));
			}
		}
		const args = [
			"--mode", "print",
			"-p",
			"--no-extensions",
			...providerExts,
			"--no-skills",
			"--no-prompt-templates",
			"--no-session",
			"--model", modelId,
			"--thinking", "off",
			"--no-tools",
			"Say OK",
		];
		execSync(`pi ${args.map(a => `'${a}'`).join(" ")}`, {
			encoding: "utf-8",
			timeout: 15000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

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
			model: fm.model || undefined,
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

function shellExec(cmd: string, cwd?: string): { ok: boolean; stdout: string; stderr: string } {
	try {
		const stdout = execSync(cmd, { encoding: "utf-8", timeout: 30000, cwd }).trim();
		return { ok: true, stdout, stderr: "" };
	} catch (err: any) {
		return { ok: false, stdout: err.stdout?.toString().trim() || "", stderr: err.stderr?.toString().trim() || err.message };
	}
}

// ── Checklist Parser ─────────────────────────────

interface ParsedPhase {
	name: string;
	tasks: { id: string; title: string; body: string; epic: string; done: boolean; issueNum?: number }[];
}

function parseChecklist(checklistPath: string): ParsedPhase[] {
	const raw = readFileSync(checklistPath, "utf-8");
	const phases: ParsedPhase[] = [];
	let currentEpic = "";
	let currentPhase: ParsedPhase | null = null;

	// Parse "Phase N" or "Epic N" sections
	for (const line of raw.split("\n")) {
		const epicMatch = line.match(/^##+ (?:Epic|Phase) (\d+):\s*(.+)/);
		if (epicMatch) {
			currentEpic = `Epic ${epicMatch[1]}`;
			currentPhase = { name: `${currentEpic}: ${epicMatch[2].trim()}`, tasks: [] };
			phases.push(currentPhase);
			continue;
		}

		if (!currentPhase) continue;

		// Format A: - [ ] **1.1 — Title** (#N)
		// Format B: - [ ] #56 - 1.1 Title
		let taskMatch = line.match(/^- \[([ x])\] \*\*(\d+\.\d+)\s*[—–-]+\s*(.+?)\*\*(?:\s*\(#(\d+)\))?/);
		if (!taskMatch) {
			taskMatch = line.match(/^- \[([ x])\] #(\d+)\s*-\s*(\d+\.\d+)\s+(.+)/);
			if (taskMatch) {
				// Reorder captures: [full, done, issueNum, id, title] -> normalize to [full, done, id, title, issueNum]
				taskMatch = [taskMatch[0], taskMatch[1], taskMatch[3], taskMatch[4], taskMatch[2]];
			}
		}
		if (taskMatch) {
			const done = taskMatch[1] === "x";
			const id = taskMatch[2];
			const title = taskMatch[3].trim();
			const issueNum = taskMatch[4] ? parseInt(taskMatch[4], 10) : undefined;

			// Collect body (indented lines after task)
			const bodyLines: string[] = [];
			const startIdx = raw.split("\n").indexOf(line);
			const allLines = raw.split("\n");
			for (let i = startIdx + 1; i < allLines.length; i++) {
				if (allLines[i].match(/^- \[/) || allLines[i].match(/^## /)) break;
				if (allLines[i].startsWith("  ")) bodyLines.push(allLines[i]);
			}

			currentPhase.tasks.push({
				id,
				title,
				body: bodyLines.join("\n").trim(),
				epic: currentEpic,
				done,
				issueNum,
			});
		}
	}

	return phases;
}

function enrichTaskBodiesFromGitHub(phases: ParsedPhase[], cwd: string): void {
	for (const phase of phases) {
		for (const task of phase.tasks) {
			if (!task.issueNum) continue;
			try {
				const result = execSync(
					`gh issue view ${task.issueNum} --json body -q '.body'`,
					{ cwd, encoding: "utf-8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
				).trim();
				if (result && result.length > task.body.length) {
					task.body = result;
				}
			} catch {}
		}
	}
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let agents: Map<string, AgentDef> = new Map();
	let sessionDir = "";
	let logDir = "";
	let activeLogFile = "";
	let activeAgent: { name: string; model: string; hint: string } | null = null;
	const activeAgents = new Map<string, { name: string; model: string; hint: string; logFile: string }>();
	let widgetCtx: ExtensionContext | null = null;
	let cwd = "";
	let pipelineMode: PipelineMode = "fast";
	let uatState: UatState = { scenarios: [], awaitingApproval: false, approved: false };
	let observerMode = false; // true when another pipeline instance is already running

	// Fast track stage tracking for widget
	type FastStage = "idle" | "build" | "eval" | "fix" | "uat-gen" | "uat-exec" | "uat-approval";
	let fastStage: FastStage = "idle";
	let fastStageTask = ""; // current task being processed in fix stage

	// Pipeline state
	let pipeline: PipelineState = {
		phases: [],
		currentPhase: -1,
		phaseStates: new Map(),
		branch: "",
		running: false,
	};
	let parsedPhases: ParsedPhase[] = [];
	let pipelineLog: string[] = [];

	function log(msg: string) {
		pipelineLog.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
		writeStateFile();
	}

	function logFile(key: string): string { return join(logDir, `${key}.log`); }
	function writeLog(key: string, text: string) {
		if (!logDir) return;
		try { appendFileSync(logFile(key), text); } catch {}
	}
	function isInTmux(): boolean { return !!process.env.TMUX; }

	function isObserverBlocked(ctx: ExtensionContext): boolean {
		if (!observerMode) return false;
		ctx.ui.notify("Observer mode: another pipeline instance is running.\nThis session is read-only. Use /pipeline-status to view progress.", "warning");
		return true;
	}

	function readStateFile(): any | null {
		if (!logDir) return null;
		try {
			const stateFile = join(logDir, "pipeline-state.json");
			if (!existsSync(stateFile)) return null;
			return JSON.parse(readFileSync(stateFile, "utf-8"));
		} catch { return null; }
	}

	let observerPollInterval: ReturnType<typeof setInterval> | null = null;

	function startObserverPolling() {
		if (observerPollInterval) return;
		observerPollInterval = setInterval(() => {
			const state = readStateFile();
			if (!state) return;
			// If the other instance stopped, exit observer mode
			if (!state.running) {
				observerMode = false;
				if (observerPollInterval) { clearInterval(observerPollInterval); observerPollInterval = null; }
				updateWidget();
				return;
			}
			updateWidget();
		}, 3000);
	}

	function stopObserverPolling() {
		if (observerPollInterval) { clearInterval(observerPollInterval); observerPollInterval = null; }
	}

	function writeStateFile() {
		if (!logDir || observerMode) return;
		try {
			const stateFile = join(logDir, "pipeline-state.json");
			const phaseArr: any[] = [];
			for (let i = 0; i < parsedPhases.length; i++) {
				const phase = parsedPhases[i];
				const ps = pipeline.phaseStates.get(phase.name);
				phaseArr.push({
					name: phase.name,
					isCurrent: i === pipeline.currentPhase,
					allDone: phase.tasks.every(t => t.done),
					pending: phase.tasks.filter(t => !t.done).length,
					total: phase.tasks.length,
					gate: ps?.gate || "idle",
					gateAttempts: ps?.gateAttempts || 0,
					startTime: ps?.startTime || 0,
					elapsed: ps ? Date.now() - ps.startTime : 0,
					tasks: ps?.tasks.map(t => ({
						id: t.id,
						title: t.title,
						status: t.status,
						complianceScore: t.complianceScore,
						attempts: t.attempts,
					})) || phase.tasks.map(t => ({
						id: t.id,
						title: t.title,
						status: t.done ? "passed" : "pending",
						complianceScore: t.done ? 100 : 0,
						attempts: 0,
					})),
				});
			}
			const state = {
				ts: Date.now(),
				running: pipeline.running,
				branch: pipeline.branch,
				currentPhase: pipeline.currentPhase,
				phases: phaseArr,
				log: pipelineLog.slice(-50),
				activeLogFile,
				activeAgent,
				activeAgents: Array.from(activeAgents.values()),
			};
			writeFileSync(stateFile, JSON.stringify(state, null, 2));
		} catch {}
	}

	// ── Checkpoint save/load ──
	function checkpointPath(): string { return join(logDir, "checkpoint.json"); }

	function saveCheckpoint(phaseIdx: number, completedGate: PhaseGate, ps: PhaseState, foundationsSpec: string) {
		try {
			const cp: Checkpoint = {
				version: 1,
				phaseIdx,
				phaseName: ps.name,
				branch: pipeline.branch,
				completedGate,
				foundationsSpec,
				tasks: ps.tasks.map(t => ({ id: t.id, title: t.title, body: t.body, epic: t.epic, status: t.status, complianceScore: t.complianceScore, attempts: t.attempts, issueNum: t.issueNum })),
				timestamp: Date.now(),
			};
			writeFileSync(checkpointPath(), JSON.stringify(cp, null, 2));
		} catch {}
	}

	function loadCheckpoint(): Checkpoint | null {
		try {
			if (!existsSync(checkpointPath())) return null;
			const raw = readFileSync(checkpointPath(), "utf-8");
			const cp = JSON.parse(raw) as Checkpoint;
			if (cp.version !== 1) return null;
			return cp;
		} catch { return null; }
	}

	function clearCheckpoint() {
		try { if (existsSync(checkpointPath())) unlinkSync(checkpointPath()); } catch {}
	}

	// ── Subprocess Runner (optimized) ────────────

	const agentSessions = new Map<string, string>();

	interface RunAgentOpts {
		fast?: boolean;
		reuse?: boolean;
		ephemeral?: boolean;
		model?: string;
		thinking?: string;
		worktreeCwd?: string;
	}

	// ── Worktree helpers ──
	const WORKTREE_BASE = ".pi/worktrees";

	function createWorktree(branchName: string): string {
		const wtPath = join(cwd, WORKTREE_BASE, branchName);
		// Aggressively clean up any remnants from previous runs
		if (existsSync(wtPath)) {
			shellExec(`git worktree remove --force '${wtPath}'`, cwd);
		}
		shellExec(`git worktree prune`, cwd);
		shellExec(`git branch -D '${branchName}'`, cwd); // delete stale branch if exists
		mkdirSync(join(cwd, WORKTREE_BASE), { recursive: true });
		const result = shellExec(`git worktree add '${wtPath}' -b '${branchName}' HEAD`, cwd);
		if (!result.ok) {
			// Last resort: force remove everything and retry
			shellExec(`rm -rf '${wtPath}'`, cwd);
			shellExec(`git worktree prune`, cwd);
			shellExec(`git branch -D '${branchName}'`, cwd);
			shellExec(`git worktree add '${wtPath}' -b '${branchName}' HEAD`, cwd);
		}
		return wtPath;
	}

	function mergeWorktree(branchName: string): { ok: boolean; conflicts: string } {
		const result = shellExec(`git merge --no-edit '${branchName}'`, cwd);
		if (!result.ok) {
			// Attempt auto-resolve: take theirs for conflicts (the agent's work wins)
			const autoResolve = shellExec(`git checkout --theirs . && git add -A && git -c core.editor=true merge --continue`, cwd);
			if (!autoResolve.ok) {
				shellExec(`git merge --abort`, cwd);
				return { ok: false, conflicts: result.stderr };
			}
		}
		return { ok: true, conflicts: "" };
	}

	function removeWorktree(branchName: string): void {
		const wtPath = join(cwd, WORKTREE_BASE, branchName);
		try { shellExec(`git worktree remove --force '${wtPath}'`, cwd); } catch {}
		try { shellExec(`git branch -D '${branchName}'`, cwd); } catch {}
	}

	function cleanupAllWorktrees(): void {
		try { shellExec(`git worktree prune`, cwd); } catch {}
		const wtDir = join(cwd, WORKTREE_BASE);
		if (existsSync(wtDir)) {
			try {
				for (const entry of readdirSync(wtDir)) {
					const wtPath = join(wtDir, entry);
					try { shellExec(`git worktree remove --force '${wtPath}'`, cwd); } catch {}
				}
			} catch {}
		}
	}

	// Model tiers (loaded from config, mutable)
	let pipelineConfig = loadPipelineConfig();
	const getDevModel = () => pipelineConfig.multiwave.dev.model;
	const getDevThinking = () => pipelineConfig.multiwave.dev.thinking;
	const getFastModel = () => pipelineConfig.multiwave.compliance.model;
	const getFastThinking = () => pipelineConfig.multiwave.compliance.thinking;
	const getFinalDevModel = () => pipelineConfig.multiwave.orchestrator.model;
	const getFinalDevThinking = () => pipelineConfig.multiwave.orchestrator.thinking;
	const getProtoModels = (): string[] => [pipelineConfig.multiwave.proto1.model, pipelineConfig.multiwave.proto2.model, pipelineConfig.multiwave.proto3.model];
	const getProtoThinking = (i: number): string => [pipelineConfig.multiwave.proto1.thinking, pipelineConfig.multiwave.proto2.thinking, pipelineConfig.multiwave.proto3.thinking][i] || "medium";
	const getCouncilModels = (): string[] => [pipelineConfig.multiwave.council1.model, pipelineConfig.multiwave.council2.model, pipelineConfig.multiwave.council3.model];
	const getCouncilThinking = (i: number): string => [pipelineConfig.multiwave.council1.thinking, pipelineConfig.multiwave.council2.thinking, pipelineConfig.multiwave.council3.thinking][i] || "medium";

	// Backward-compat aliases
	const DEV_MODEL = pipelineConfig.multiwave.dev.model;
	const FAST_MODEL = pipelineConfig.multiwave.compliance.model;
	const BUILDER_MODEL = pipelineConfig.multiwave.compliance.model;
	const FINAL_DEV_MODEL = pipelineConfig.multiwave.orchestrator.model;
	const PROTO_MODELS = getProtoModels();
	const FOUNDATIONS_COUNCIL_MODELS = getCouncilModels();

	function runAgent(
		agentDef: AgentDef,
		task: string,
		sessionKey: string,
		ctx: ExtensionContext,
		opts: RunAgentOpts = {},
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		const isDev = agentDef.name === "dev" || agentDef.name === "foundations-builder";
		const model = opts.model || agentDef.model || (isDev ? DEV_MODEL : FAST_MODEL);

		const providerExtDir = join(homedir(), ".pi", "agent", "extensions");
		const providerExts: string[] = [];
		if (existsSync(providerExtDir)) {
			for (const f of readdirSync(providerExtDir)) {
				if (f.endsWith("-provider.ts")) providerExts.push("-e", join(providerExtDir, f));
			}
		}

		const args = [
			"--mode", "json",
			"-p",
			"--no-extensions",
			...providerExts,
			"--no-skills",
			"--no-prompt-templates",
			"--model", model,
			"--thinking", opts.thinking || "medium",
			"--system-prompt", agentDef.systemPrompt,
		];

		if (opts.fast) {
			args.push("--no-tools");
		} else {
			args.push("--tools", agentDef.tools);
		}

		if (opts.ephemeral) {
			args.push("--no-session");
		} else if (opts.reuse) {
			let sessionFile = agentSessions.get(agentDef.name);
			if (!sessionFile) {
				sessionFile = join(sessionDir, `pipeline-${agentDef.name}.json`);
				agentSessions.set(agentDef.name, sessionFile);
			}
			args.push("--session", sessionFile);
			if (existsSync(sessionFile)) args.push("-c");
		} else {
			const agentSessionFile = join(sessionDir, `pipeline-${sessionKey}.json`);
			args.push("--session", agentSessionFile);
			if (existsSync(agentSessionFile)) args.push("-c");
		}

		args.push(task);

		const startTime = Date.now();
		const currentLogFile = logFile(sessionKey);
		activeLogFile = currentLogFile;
		activeAgent = { name: agentDef.name, model: model.split("/").pop() || model, hint: task.slice(0, 120) };
		activeAgents.set(sessionKey, { name: agentDef.name, model: model.split("/").pop() || model, hint: task.slice(0, 120), logFile: currentLogFile });
		writeStateFile();

		try {
			writeFileSync(currentLogFile, `── ${agentDef.name} | ${sessionKey} | ${new Date().toISOString()} ──\n\n`);
		} catch {}

		const agentCwd = opts.worktreeCwd || cwd || undefined;

		// ── Run agent headless + show live tail in tmux pane ──
		// Agent runs as a child process (piped stdio, --mode json).
		// If in tmux, a pane shows `tail -f` of the log file.
		// Pane auto-closes when agent finishes.
		if (useTmuxPanes && isInTmux()) {
			const label = `${displayName(agentDef.name)} (${model.split("/").pop()})`;
			const existingPane = agentPanes.get(sessionKey);
			if (existingPane) {
				try { execSync(`tmux kill-pane -t ${existingPane}`, { stdio: "ignore" }); } catch {}
				watchPaneIds = watchPaneIds.filter(id => id !== existingPane);
				agentPanes.delete(sessionKey);
			}

			// Sentinel file: agent writes when done, tail pane watches for it
			const sentinelFile = join(logDir, `${sessionKey}.done`);
			try { if (existsSync(sentinelFile)) unlinkSync(sentinelFile); } catch {}

			// Open a tail pane that filters JSON → readable text, auto-closes when done
			const filterScript = join(logDir, "json-filter.py");
			const tailCmd = `echo '── ${label.replace(/'/g, "\\'")} ──' && tail -f '${currentLogFile}' | '${filterScript}' &` +
				` TAIL_PID=$! && while [ ! -f '${sentinelFile}' ]; do sleep 1; done && kill $TAIL_PID 2>/dev/null; sleep 2`;
			const paneId = allocateTmuxPane(tailCmd, label);
			if (paneId) agentPanes.set(sessionKey, paneId);

			// Run agent headless, write sentinel on completion
			return new Promise((resolve) => {
				const headlessPromise = runAgentHeadless(args, task, sessionKey, currentLogFile, agentCwd, startTime);
				headlessPromise.then((result) => {
					// Write sentinel to signal tail pane to close
					try { writeFileSync(sentinelFile, String(result.exitCode)); } catch {}

					// Clean up pane reference after it auto-closes
					if (paneId) {
						setTimeout(() => {
							try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
							watchPaneIds = watchPaneIds.filter(id => id !== paneId);
							agentPanes.delete(sessionKey);
							try { unlinkSync(sentinelFile); } catch {}
						}, 4000);
					}

					resolve(result);
				});
			});
		}

		// ── Headless mode (no tmux or tmux disabled) ──
		return runAgentHeadless(args, task, sessionKey, currentLogFile, agentCwd, startTime);
	}

	function runAgentHeadless(
		args: string[],
		task: string,
		sessionKey: string,
		currentLogFile: string,
		agentCwd: string | undefined,
		startTime: number,
	): Promise<{ output: string; exitCode: number; elapsed: number }> {
		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				stdio: ["ignore", "pipe", "pipe"],
				env: process.env,
				cwd: agentCwd || cwd || undefined,
			});

			const textParts: string[] = [];
			let lineBuf = "";
			const logStream = existsSync(logDir) ? createWriteStream(currentLogFile, { flags: "a" }) : null;

			proc.stdout!.setEncoding("utf-8");
			proc.stdout!.on("data", (chunk: string) => {
				logStream?.write(chunk);
				lineBuf += chunk;
				const lines = lineBuf.split("\n");
				lineBuf = lines.pop() || "";
				for (const line of lines) {
					if (!line.includes("text_delta")) continue;
					try {
						const e = JSON.parse(line);
						if (e.assistantMessageEvent?.delta) textParts.push(e.assistantMessageEvent.delta);
					} catch {}
				}
			});

			proc.stderr!.setEncoding("utf-8");
			proc.stderr!.on("data", (chunk: string) => {
				logStream?.write(chunk);
			});

			proc.on("close", (code) => {
				const elapsed = Date.now() - startTime;
				if (lineBuf && lineBuf.includes("text_delta")) {
					try {
						const e = JSON.parse(lineBuf);
						if (e.assistantMessageEvent?.delta) textParts.push(e.assistantMessageEvent.delta);
					} catch {}
				}
				logStream?.write(`\n── exit ${code} | ${Math.round(elapsed / 1000)}s ──\n`);
				logStream?.end();
				activeAgents.delete(sessionKey);
				if (activeAgents.size === 0) { activeLogFile = ""; activeAgent = null; }
				writeStateFile();

				const output = textParts.join("") || `(no text output, exit code ${code})`;
				resolve({ output, exitCode: code ?? 1, elapsed });
			});

			proc.on("error", (err) => {
				logStream?.end();
				activeAgents.delete(sessionKey);
				if (activeAgents.size === 0) { activeLogFile = ""; activeAgent = null; }
				writeStateFile();
				resolve({
					output: `Error: ${err.message}`,
					exitCode: 1,
					elapsed: Date.now() - startTime,
				});
			});
		});
	}

	function extractJson(text: string): any | null {
		const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
		const raw = jsonMatch ? jsonMatch[1] : text;
		try {
			return JSON.parse(raw.trim());
		} catch {
			// Try matching a JSON object {...}
			const braceMatch = raw.match(/\{[\s\S]*\}/);
			if (braceMatch) {
				try { return JSON.parse(braceMatch[0]); } catch {}
			}
			// Try matching a JSON array [...]
			const bracketMatch = raw.match(/\[[\s\S]*\]/);
			if (bracketMatch) {
				try { return JSON.parse(bracketMatch[0]); } catch {}
			}
			return null;
		}
	}

	// ── Phase Runner ─────────────────────────────

	// Gate ordering for checkpoint resume
	const GATE_ORDER: PhaseGate[] = [
		"wave1-council", "wave1-consolidate",
		"wave0-proto-1", "wave0-proto-2", "wave0-proto-3",
		"wave1-review", "wave1-compliance",
		"wave2-parallel", "wave2-compliance", "wave2-fix", "wave2-blocked",
		"review", "build-lint", "test", "done",
	];

	function shouldSkip(currentGate: PhaseGate, resumeAfter: PhaseGate | null): boolean {
		if (!resumeAfter) return false;
		const resumeIdx = GATE_ORDER.indexOf(resumeAfter);
		const currentIdx = GATE_ORDER.indexOf(currentGate);
		return currentIdx >= 0 && resumeIdx >= 0 && currentIdx <= resumeIdx;
	}

	async function runPhase(phaseIdx: number, ctx: ExtensionContext): Promise<{ success: boolean; summary: string }> {
		const phase = parsedPhases[phaseIdx];
		if (!phase) return { success: false, summary: "Phase not found" };

		const pendingTasks = phase.tasks.filter(t => !t.done);
		if (pendingTasks.length === 0) return { success: true, summary: "All tasks already complete" };

		// Check for checkpoint to resume from
		const checkpoint = loadCheckpoint();
		let resumeAfterGate: PhaseGate | null = null;
		let foundationsSpec = "";

		let ps: PhaseState;
		if (checkpoint && checkpoint.phaseIdx === phaseIdx && checkpoint.phaseName === phase.name) {
			// Resume from checkpoint
			log(`[Resume] Restoring checkpoint from gate "${checkpoint.completedGate}" (${new Date(checkpoint.timestamp).toLocaleTimeString()})`);
			resumeAfterGate = checkpoint.completedGate;
			foundationsSpec = checkpoint.foundationsSpec || "";
			ps = {
				name: phase.name,
				tasks: checkpoint.tasks.map(t => ({ ...t })),
				gate: checkpoint.completedGate,
				gateAttempts: 0,
				startTime: Date.now(),
				elapsed: 0,
			};
		} else {
			ps = {
				name: phase.name,
				tasks: pendingTasks.map(t => ({
					id: t.id,
					title: t.title,
					body: t.body,
					epic: t.epic,
					status: "pending" as TaskStatus,
					complianceScore: 0,
					attempts: 0,
					issueNum: t.issueNum,
				})),
				gate: "wave1-council",
				gateAttempts: 0,
				startTime: Date.now(),
				elapsed: 0,
			};
		}
		pipeline.phaseStates.set(phase.name, ps);
		pipeline.running = true;
		let wave1Elapsed = 0;
		let parallelElapsed = 0;

		// Wave 0 only runs for the FIRST epic (initial prototype).
		// After that, the codebase exists and subsequent epics use Wave 1 + Wave 2 only.
		const isFirstEpic = phaseIdx === 0 || parsedPhases.slice(0, phaseIdx).every(p => p.tasks.every(t => !t.done));
		const skipWave0 = !isFirstEpic;

		updateWidget();

		log(`=== Phase: ${phase.name} (${pendingTasks.length} tasks) ===`);

		// ══════════════════════════════════════════
		// WAVE 1 — Foundations Council
		// ══════════════════════════════════════════

		// Step 1: Foundations Council — 3 architects in parallel produce design briefs
		if (shouldSkip("wave1-council", resumeAfterGate)) {
			log(`[Resume] Skipping wave1-council (already completed)`);
		} else {
		ps.gate = "wave1-council";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 1: Foundations Council for ${phase.name}...`);
		log(`[Wave 1] Foundations Council convening (3 architects in parallel)...`);

		const taskListText = ps.tasks.map(t =>
			`### Task ${t.id}: ${t.title}\n${t.body}`
		).join("\n\n");

		const architectPrompt = [
			`# Foundations Architecture Brief — DEEP ANALYSIS MODE`,
			``,
			`## Epic: ${phase.name}`,
			``,
			`## All Tasks in This Epic`,
			taskListText,
			``,
			`## Analysis Protocol`,
			`You are operating in DEEP ANALYSIS mode. Apply maximum reasoning depth.`,
			`If your reasoning feels easy or surface-level, you are not thinking hard enough — dig deeper.`,
			``,
			`Before producing your design brief, work through this reasoning chain:`,
			`1. **Read the existing codebase** — understand every file, pattern, and convention already in place`,
			`2. **Map dependencies** — which tasks depend on which? What must exist before what?`,
			`3. **Identify constraint conflicts** — where do two tasks' requirements contradict or interact?`,
			`4. **Evaluate trade-offs** — for every design choice, what are you gaining and what are you sacrificing?`,
			`5. **Stress-test your design** — what happens at edge cases? What breaks first?`,
			`6. **Consider scalability** — will this design hold up as future epics build on top of it?`,
			``,
			`## Required Output`,
			`Produce a comprehensive foundational design brief covering:`,
			`- File layout (exact files, directory structure)`,
			`- Data structures (exact field names + types, with rationale for each choice)`,
			`- State machines (states + transitions, with edge case handling)`,
			`- Algorithm choices (PICK ONE approach per algorithm, justify WHY with trade-off analysis)`,
			`- Integration points (how this connects to existing code, and how future epics will connect to this)`,
			`- Task TODO markers (which functions each task needs to implement)`,
			`- Design decisions (hard calls that prevent constraint conflicts between tasks)`,
			`- Dependency map (which tasks/features are blocked until future epics provide upstream code)`,
			``,
			`CRITICAL: Consider ALL tasks together as a unified system. Design decisions must`,
			`prevent conflicts between tasks. If task A's requirements interact with task B's,`,
			`solve that interaction in the design brief — not later during implementation.`,
			``,
			...(skipWave0 ? [
				`CRITICAL: Previous epics have already built working code in this project.`,
				`Your design MUST:`,
				`- EXTEND existing files and data structures, NOT replace them`,
				`- Build ON TOP of existing code, NOT redesign what already works`,
				`- Reference which existing functions/structures your design depends on`,
				`- NEVER propose deleting, renaming, or restructuring code from previous epics`,
			] : []),
		].join("\n");

		// Commit current state so architect worktrees have the codebase
		shellExec(`git add -A && git commit -m "Pre-council snapshot" --allow-empty`, cwd);

		const councilWorktrees: string[] = [];
		const councilResults = await Promise.all(
			FOUNDATIONS_COUNCIL_MODELS.map((model, idx) => {
				const architectAgent: AgentDef = {
					name: "foundations-architect",
					description: "Foundations council architect",
					tools: "read,grep,find,ls",
					systemPrompt: agents.get("foundations-architect")?.systemPrompt ||
						"You are a foundations architect. Return ONLY valid JSON. Produce comprehensive design briefs. Do NOT write implementation code. Do NOT modify files.",
				};
				const wtBranch = `wt-architect-${idx}`;
				councilWorktrees.push(wtBranch);
				const wtPath = createWorktree(wtBranch);

				return runAgent(
					architectAgent,
					architectPrompt,
					`architect-${phaseIdx}-${idx}-${model.split("/")[1]}`,
					ctx,
					{ model, ephemeral: true, thinking: getCouncilThinking(idx), worktreeCwd: wtPath },
				);
			})
		);

		// Clean up architect worktrees (read-only, nothing to merge)
		for (const wtBranch of councilWorktrees) {
			removeWorktree(wtBranch);
		}
		cleanupAllWorktrees();

		// Step 2: Orchestrator consolidates design briefs
		ps.gate = "wave1-consolidate";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 1: Consolidating architect briefs...`);
		log(`[Wave 1] Consolidating ${FOUNDATIONS_COUNCIL_MODELS.length} architect briefs...`);

		const briefs: any[] = [];
		const rawBriefs: string[] = [];
		for (let i = 0; i < councilResults.length; i++) {
			const modelName = FOUNDATIONS_COUNCIL_MODELS[i].split("/")[1];
			const data = extractJson(councilResults[i].output);
			if (data) {
				briefs.push({ model: modelName, ...data });
				rawBriefs.push(`## Architect: ${modelName}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``);
				log(`Architect (${modelName}): ${data.files?.length || 0} files, ${data.data_structures?.length || 0} structures, ${data.algorithms?.length || 0} algorithms, ${data.task_todos?.length || 0} task mappings`);
			} else {
				rawBriefs.push(`## Architect: ${modelName}\n${councilResults[i].output.slice(0, 2000)}`);
				log(`Architect (${modelName}): raw response (no JSON parsed)`);
			}
		}

		// Consolidate: merge all briefs into unified spec
		// The orchestrator (this code) extracts the best from each:
		// - Files: union of all proposed files
		// - Data structures: prefer Opus, fill gaps from others
		// - Algorithms: majority vote or Opus tiebreak
		// - Task TODOs: union (every task must be covered)
		// - Design decisions: all included (no conflicts allowed)

		const consolidatedSpec = {
			epic: phase.name,
			tasks: ps.tasks.map(t => ({ id: t.id, title: t.title, requirements: t.body })),
			architect_briefs: rawBriefs.join("\n\n"),
			consolidation_instructions: [
				"You have received design briefs from 3 architects above.",
				"Merge them into ONE unified Foundations Spec by:",
				"1. UNION of all proposed files — include every file any architect suggested",
				"2. Data structures: use the most complete/detailed version. If fields conflict, prefer the one with more type specificity.",
				"3. Algorithms: if architects disagree, pick the approach with the clearest justification. Document WHY.",
				"4. Task TODOs: EVERY task must have at least one TODO marker. Union all suggestions.",
				"5. Design decisions: include ALL decisions from all architects. Flag any contradictions.",
				"6. Integration points: union, verify they reference real existing code.",
				"",
				"Output the unified spec as a single prompt for the Foundations Builder agent.",
				"The builder needs EXACT instructions: what files to create, what code to write,",
				"what TODO markers to place, and where.",
				"",
				"Format: plain text instructions, NOT JSON. The builder is a coding agent.",
				"Be extremely specific — file paths, function names, data structure fields, algorithm steps.",
			].join("\n"),
		};

		// Use Opus to do the consolidation (it's the orchestrator's brain for this step)
		const consolidationAgent: AgentDef = {
			name: "consolidator",
			description: "Merges architect briefs into unified foundations spec",
			tools: "read,grep,find,ls",
			systemPrompt: "You are a technical lead consolidating architect proposals into a single unified spec. Your output is consumed by a builder agent. Return detailed, specific building instructions — NOT JSON. Include exact file paths, function signatures, data structures, and TODO markers. Be exhaustive.",
		};

		const consolidationResult = await runAgent(
			consolidationAgent,
			JSON.stringify(consolidatedSpec, null, 2),
			`consolidate-${phaseIdx}`,
			ctx,
			{ model: FOUNDATIONS_COUNCIL_MODELS[0], ephemeral: true, thinking: getCouncilThinking(0) },
		);

		foundationsSpec = consolidationResult.output;
		log(`[Wave 1] Consolidation complete (${foundationsSpec.length} chars)`);
		saveCheckpoint(phaseIdx, "wave1-consolidate", ps, foundationsSpec);
		} // end skip council+consolidate

		// ══════════════════════════════════════════
		// WAVE 0 — Prototype POC (progressive refinement chain)
		// ══════════════════════════════════════════

		const taskListForBuild = ps.tasks.map(t =>
			`### Task ${t.id}: ${t.title}\n${t.body}`
		).join("\n\n");

		const wave0BuildPrompt = (stepNum: number, stepRole: string) => [
			`# ${stepRole} — ${phase.name}`,
			``,
			`## Unified Foundations Spec (from architect council)`,
			foundationsSpec,
			``,
			`## All Tasks`,
			taskListForBuild,
			``,
			`## Instructions`,
			stepNum === 1
				? [
					`You are building the COMPLETE implementation from scratch based on the spec above.`,
					`This is a one-shot full build — implement EVERYTHING the spec describes.`,
					``,
					`1. Create all files, data structures, functions, and integrations described in the spec`,
					`2. Implement ALL task requirements — not stubs, not TODOs, actual working code`,
					`3. The result must be a fully functional, runnable end-to-end prototype`,
					`4. Follow existing codebase patterns and conventions`,
					`5. ZERO comments except where logic is genuinely complex`,
					`6. Do NOT create documentation files`,
				].join("\n")
				: [
					`A previous model has already built the initial implementation.`,
					`Your job is to REVIEW what exists and ENHANCE it.`,
					``,
					`1. Read the entire codebase carefully — understand what's been built`,
					`2. Compare against the spec and task requirements above`,
					`3. Fix any bugs, missing features, or incomplete implementations you find`,
					`4. Add polish: better error handling, edge cases, smoother UX`,
					`5. DO NOT delete or rewrite working code — only add and improve`,
					`6. DO NOT create documentation files`,
					`7. The result should be a more complete, polished version of what exists`,
				].join("\n"),
			``,
			`When done, commit all your changes with: git add -A && git commit -m "Wave 0 step ${stepNum}: ${stepRole}"`,
		].join("\n");

		if (skipWave0) {
			log(`[Wave 0] Skipping — codebase already exists (Epic ${phaseIdx + 1}). Jumping to Wave 1.`);
		}

		// Step 1: Gemini one-shot full build
		if (skipWave0 || shouldSkip("wave0-proto-1", resumeAfterGate)) {
			if (!skipWave0) log(`[Resume] Skipping wave0-proto-1 (already completed)`);
		} else {
		ps.gate = "wave0-proto-1";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 0: Prototype step 1 (${PROTO_MODELS[0].split("/").pop()})...`);
		log(`[Wave 0] Step 1: Full build with ${PROTO_MODELS[0]}...`);

		shellExec(`git add -A && git commit -m "Pre-wave0 snapshot" --allow-empty`, cwd);

		await runAgent(
			agents.get("foundations-builder") || agents.get("dev")!,
			wave0BuildPrompt(1, "Full Prototype Build"),
			`wave0-step1-${phaseIdx}`,
			ctx,
			{ model: PROTO_MODELS[0], ephemeral: true, thinking: getProtoThinking(0) },
		);

		shellExec(`git add -A && git commit -m "Wave 0 step 1: prototype build (${PROTO_MODELS[0].split("/").pop()})" --allow-empty`, cwd);
		log(`[Wave 0] Step 1 complete`);
		saveCheckpoint(phaseIdx, "wave0-proto-1", ps, foundationsSpec);
		} // end skip wave0-proto-1

		// Step 2: Haiku enhance & polish
		if (skipWave0 || shouldSkip("wave0-proto-2", resumeAfterGate)) {
			if (!skipWave0) log(`[Resume] Skipping wave0-proto-2 (already completed)`);
		} else {
		ps.gate = "wave0-proto-2";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 0: Prototype step 2 (${PROTO_MODELS[1].split("/").pop()})...`);
		log(`[Wave 0] Step 2: Enhance with ${PROTO_MODELS[1]}...`);

		await runAgent(
			agents.get("foundations-builder") || agents.get("dev")!,
			wave0BuildPrompt(2, "Enhancement Pass"),
			`wave0-step2-${phaseIdx}`,
			ctx,
			{ model: PROTO_MODELS[1], ephemeral: true, thinking: getProtoThinking(1) },
		);

		shellExec(`git add -A && git commit -m "Wave 0 step 2: enhance (${PROTO_MODELS[1].split("/").pop()})" --allow-empty`, cwd);
		log(`[Wave 0] Step 2 complete`);
		saveCheckpoint(phaseIdx, "wave0-proto-2", ps, foundationsSpec);
		} // end skip wave0-proto-2

		// Step 3: Qwen fine-tune & refine
		if (skipWave0 || shouldSkip("wave0-proto-3", resumeAfterGate)) {
			if (!skipWave0) log(`[Resume] Skipping wave0-proto-3 (already completed)`);
		} else {
		ps.gate = "wave0-proto-3";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 0: Prototype step 3 (${PROTO_MODELS[2].split("/").pop()})...`);
		log(`[Wave 0] Step 3: Fine-tune with ${PROTO_MODELS[2]}...`);

		await runAgent(
			agents.get("foundations-builder") || agents.get("dev")!,
			wave0BuildPrompt(3, "Fine-Tuning & Refinement Pass"),
			`wave0-step3-${phaseIdx}`,
			ctx,
			{ model: PROTO_MODELS[2], ephemeral: true, thinking: getProtoThinking(2) },
		);

		shellExec(`git add -A && git commit -m "Wave 0 step 3: refine (${PROTO_MODELS[2].split("/").pop()})" --allow-empty`, cwd);
		log(`[Wave 0] Step 3 complete — prototype ready`);
		saveCheckpoint(phaseIdx, "wave0-proto-3", ps, foundationsSpec);
		} // end skip wave0-proto-3

		// ══════════════════════════════════════════
		// WAVE 1 — Review & TODO Placement
		// ══════════════════════════════════════════

		if (shouldSkip("wave1-review", resumeAfterGate) && shouldSkip("wave1-compliance", resumeAfterGate)) {
			log(`[Resume] Skipping wave1-review/compliance (already completed)`);
		} else {
		ps.gate = "wave1-review";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 1: Reviewing prototype and placing TODOs...`);
		log(`[Wave 1] Reviewing Wave 0 prototype — identifying gaps and placing TODOs...`);

		await runAgent(
			agents.get("foundations-builder") || agents.get("dev")!,
			[
				`# Wave 1: Review & TODO Placement`,
				``,
				`## Epic: ${phase.name}`,
				``,
				`## Unified Foundations Spec (what should have been built)`,
				foundationsSpec,
				``,
				`## All Tasks and Requirements`,
				taskListForBuild,
				``,
				`## Instructions`,
				skipWave0
					? `The codebase has been built across previous epics. This epic adds NEW functionality on top.`
					: `A prototype has been built by Wave 0 (3 progressive model passes).`,
				`Your job is to REVIEW what exists and place TODO markers for anything that needs further work.`,
				skipWave0
					? `CRITICAL: Do NOT touch code from previous epics. Only review code relevant to THIS epic's tasks.`
					: ``,
				``,
				`1. Read the ENTIRE codebase — understand what ${skipWave0 ? "already exists and what this epic needs to add" : "Wave 0 actually built"}`,
				`2. Compare each task's requirements against what's implemented`,
				`3. For anything that is:`,
				`   - Missing entirely → place TODO(task-X.Y): [full requirement description]`,
				`   - Partially implemented → place TODO(task-X.Y): [what's missing specifically]`,
				`   - Has bugs or issues → place TODO(task-X.Y): [describe the bug and expected behavior]`,
				`   - Could be significantly improved → place TODO(task-X.Y): [describe the improvement]`,
				`4. If a task's implementation is COMPLETE and CORRECT, do NOT add a TODO for it`,
				`5. Format: // TODO(task-X.Y): [specific actionable description]`,
				``,
				`DO NOT implement fixes yourself — only place TODO markers.`,
				`DO NOT delete or modify any working code.`,
				`DO NOT create documentation files.`,
				``,
				`When done, commit: git add -A && git commit -m "Wave 1: review and TODO placement"`,
			].join("\n"),
			`wave1-review-${phaseIdx}`,
			ctx,
			{ model: FOUNDATIONS_COUNCIL_MODELS[0], ephemeral: true, thinking: getCouncilThinking(0) },
		);

		shellExec(`git add -A && git commit -m "Wave 1: review and TODO placement" --allow-empty`, cwd);
		log(`[Wave 1] Review complete — moving to Wave 2`);

		wave1Elapsed = Math.round((Date.now() - ps.startTime) / 1000);
		log(`[Wave 1] Complete in ${wave1Elapsed}s. Handing over to Wave 2.`);
		saveCheckpoint(phaseIdx, "wave1-compliance", ps, foundationsSpec);
		} // end skip wave1-review/compliance

		// ══════════════════════════════════════════
		// WAVE 2 — Parallel Dev Sprint
		// ══════════════════════════════════════════

		if (shouldSkip("wave2-parallel", resumeAfterGate)) {
			log(`[Resume] Skipping wave2-parallel (already completed)`);
		} else {
		ps.gate = "wave2-parallel";
		updateWidget();
		ctx.ui.setStatus("pipeline", `Wave 2: Sequential dev sprint (${ps.tasks.length} tasks)...`);
		log(`[Wave 2] Running ${ps.tasks.length} dev agents sequentially (single-file project)...`);

		const wave2Start = Date.now();

		for (const task of ps.tasks) {
			task.status = "building";
			task.attempts = 1;
		}
		updateWidget();

		// Commit foundations so devs start from current state
		shellExec(`git add -A && git commit -m "Wave 1: review complete for ${phase.name}" --allow-empty`, cwd);

		// Run devs SEQUENTIALLY — each sees the previous task's committed output
		// This prevents merge conflicts on single-file projects (all tasks touch index.html)
		for (const task of ps.tasks) {
			log(`[Wave 2] Dev ${task.id}: ${task.title}...`);
			ctx.ui.setStatus("pipeline", `Wave 2: Dev ${task.id} (${task.title})...`);

			const devPrompt = [
				`# Task ${task.id}: ${task.title}`,
				``,
				`## Requirements`,
				task.body,
				``,
				`## Instructions`,
				skipWave0
					? `The codebase has been built across previous epics and reviewed for this epic.`
					: `A working prototype has been built (Wave 0) and reviewed (Wave 1).`,
				`Find and complete ALL TODO(task-${task.id}) markers in the codebase.`,
				`If no TODOs exist for your task, the implementation may already be complete — verify it meets requirements.`,
				``,
				`1. Search for: TODO(task-${task.id})`,
				`2. Read each TODO's acceptance criteria`,
				`3. Implement the required functionality at each marker`,
				`4. Remove the TODO comment after implementing`,
				`5. Verify your implementation meets the acceptance criteria`,
				``,
				`BOUNDARIES:`,
				`- You own ONLY the functions marked with TODO(task-${task.id})`,
				`- Do NOT modify functions owned by other tasks (TODO(task-X.Y) where X.Y != ${task.id})`,
				`- Do NOT delete or rewrite existing working code from previous tasks or epics`,
				`- Do NOT change data structures, signatures, or integration points — they are finalized`,
				`- If a TODO references a function you need that isn't implemented yet, stub it and move on`,
				``,
				`When done, commit all your changes with: git add -A && git commit -m "Task ${task.id}: ${task.title}"`,
			].join("\n");

			await runAgent(
				agents.get("dev")!,
				devPrompt,
				`dev-${task.id}-1`,
				ctx,
				{ model: DEV_MODEL, ephemeral: true, thinking: getDevThinking() },
			);

			// Commit after each task so the next task sees this task's output
			shellExec(`git add -A && git commit -m "Task ${task.id}: ${task.title}" --allow-empty`, cwd);
			log(`[Wave 2] Dev ${task.id} complete`);
		}

		parallelElapsed = Math.round((Date.now() - wave2Start) / 1000);
		log(`[Wave 2] All devs complete in ${parallelElapsed}s`);
		saveCheckpoint(phaseIdx, "wave2-parallel", ps, foundationsSpec);
		} // end skip wave2-parallel

		// Compliance AFTER all devs finish — single check across all tasks
		let wave2Passed = shouldSkip("wave2-blocked", resumeAfterGate);
		const taskFailures = new Map<string, any[]>();

		for (let compRound = 1; compRound <= MAX_LOOPS; compRound++) {
			ps.gate = "wave2-compliance";
			ps.gateAttempts = compRound;
			updateWidget();
			ctx.ui.setStatus("pipeline", `Wave 2: Compliance check ${compRound} (all ${ps.tasks.length} tasks)...`);
			log(`[Wave 2] Compliance check ${compRound} — scoring all tasks together...`);

			// Commit current state so compliance sees latest code
			shellExec(`git add -A && git commit -m "Wave 2: pre-compliance round ${compRound}" --allow-empty`, cwd);

			const failedTasks: TaskState[] = [];
			const blockedItems: { taskId: string; items: any[] }[] = [];

			// Score each task sequentially (no worktrees needed — codebase is on main branch)
			for (const task of ps.tasks) {
				const compResult = await runAgent(
					agents.get("compliance")!,
					[
						`Score this task implementation out of 100.`,
						``,
						`Task: ${task.id} — ${task.title}`,
						``,
						`Requirements:`,
						task.body,
						``,
						`## All tasks in this epic (for dependency context):`,
						ps.tasks.map(t => `- ${t.id}: ${t.title}`).join("\n"),
						``,
						`## SCORING RULES (MANDATORY — violations will be rejected):`,
						`- Score ONLY against the explicit requirements listed in the task description above`,
						`- Each requirement in the task body is worth equal points`,
						`- A requirement PASSES if code exists that implements it, even if imperfect`,
						`- A requirement FAILS only if it is completely missing or demonstrably broken`,
						`- Do NOT invent requirements not in the task description`,
						`- Do NOT penalize for code style, naming, comments, or "could be better" opinions`,
						`- Do NOT penalize for missing features from OTHER tasks or OTHER epics`,
						`- Do NOT reduce score for theoretical edge cases unless the task explicitly requires them`,
						`- If you previously scored something as failed and it has been fixed, it PASSES now`,
						``,
						`If a requirement depends on a task/epic not yet built, mark it "blocked" not "failed". Blocked items do NOT reduce the score.`,
						``,
						`Return JSON: {"score": N, "passed": [{"requirement": "...", "evidence": "..."}], "failed": [{"requirement": "...", "gap": "...", "fix": "..."}], "blocked": [{"requirement": "...", "dependency": "which task/epic", "todo": "TODO marker text"}]}`,
					].join("\n"),
					`compliance-${task.id}-${compRound}`,
					ctx,
					{ ephemeral: true, thinking: getFastThinking() },
				);

				const compData = extractJson(compResult.output);
				task.complianceScore = compData?.score ?? 0;
				const blocked = compData?.blocked || [];
				if (blocked.length > 0) {
					blockedItems.push({ taskId: task.id, items: blocked });
					log(`[${task.id}] Score: ${task.complianceScore}% (${blocked.length} blocked by dependencies)`);
				} else {
					log(`[${task.id}] Score: ${task.complianceScore}%`);
				}

				if (task.complianceScore >= COMPLIANCE_THRESHOLD) {
					task.status = "passed";
				} else if (task.complianceScore >= 90) {
					// Orchestrator override: if score is 90-94%, review the failures
					// and override if the deductions are invented/pedantic
					const failures = compData?.failed || [];
					const failSummary = failures.map((f: any) => `- ${f.requirement}: ${f.gap}`).join("\n");
					log(`[${task.id}] Near-pass (${task.complianceScore}%) — orchestrator reviewing ${failures.length} deduction(s)...`);

					const overrideResult = await runAgent(
						agents.get("compliance") || agents.get("dev")!,
						[
							`# Orchestrator Override Review`,
							``,
							`Task ${task.id}: ${task.title} scored ${task.complianceScore}% (needs ${COMPLIANCE_THRESHOLD}%).`,
							``,
							`## Task Requirements (the ONLY things that matter):`,
							task.body,
							``,
							`## Compliance Agent's Deductions:`,
							failSummary,
							``,
							`## Your Job:`,
							`Read the actual code and check each deduction. For each one, decide:`,
							`- VALID: The code genuinely does not implement this stated requirement`,
							`- INVALID: The requirement IS implemented (agent was wrong) or the deduction is for something NOT in the requirements`,
							``,
							`Be strict about what counts as a real requirement. If the task description doesn't explicitly ask for it, the deduction is INVALID.`,
							``,
							`Return JSON: {"override": true/false, "final_score": N, "verdicts": [{"deduction": "...", "valid": true/false, "reason": "..."}]}`,
							`Set override=true and final_score=100 if all deductions are invalid.`,
						].join("\n"),
						`override-${task.id}-${compRound}`,
						ctx,
						{ model: FOUNDATIONS_COUNCIL_MODELS[0], ephemeral: true, thinking: getCouncilThinking(0) },
					);

					const overrideData = extractJson(overrideResult.output);
					if (overrideData?.override && overrideData.final_score >= COMPLIANCE_THRESHOLD) {
						task.complianceScore = overrideData.final_score;
						task.status = "passed";
						log(`[${task.id}] Orchestrator OVERRIDE: ${overrideData.final_score}% — deductions were invalid`);
					} else {
						task.status = "building";
						// Only keep the valid failures
						const validFailures = (overrideData?.verdicts || [])
							.filter((v: any) => v.valid)
							.map((v: any) => failures.find((f: any) => f.requirement === v.deduction) || { requirement: v.deduction, gap: v.reason, fix: "" });
						taskFailures.set(task.id, validFailures.length > 0 ? validFailures : failures);
						failedTasks.push(task);
						log(`[${task.id}] Orchestrator confirmed: ${validFailures.length} valid deduction(s) remain`);
					}
				} else {
					task.status = "building";
					taskFailures.set(task.id, compData?.failed || []);
					failedTasks.push(task);
				}
			}
			updateWidget();

			if (blockedItems.length > 0) {
				log(`[Wave 2] ${blockedItems.reduce((n, b) => n + b.items.length, 0)} requirement(s) blocked by dependencies — not counted as failures`);
			}

			if (failedTasks.length === 0) {
				log(`[Wave 2] All tasks PASSED compliance`);
				wave2Passed = true;
				break;
			}

			if (compRound >= MAX_LOOPS) {
				for (const t of failedTasks) t.status = "failed";
				log(`[Wave 2] ${failedTasks.length} task(s) still failing after ${MAX_LOOPS} rounds`);
				break;
			}

			// ── Orchestrator Triage ──
			// Before dispatching fixes, the orchestrator analyzes failures,
			// enriches task bodies with accumulated context, and splits complex tasks.
			ps.gate = "wave2-fix";
			updateWidget();
			const fixRound = compRound + 1;
			ctx.ui.setStatus("pipeline", `Wave 2: Orchestrator triage for ${failedTasks.length} failed task(s)...`);
			log(`[Wave 2] Orchestrator triaging ${failedTasks.length} failed task(s) before fix round ${fixRound}...`);

			// Build triage context for each failed task
			const triagePrompts: { task: TaskState; failures: any[] }[] = [];
			for (const task of failedTasks) {
				triagePrompts.push({ task, failures: taskFailures.get(task.id) || [] });
			}

			const triageInput = triagePrompts.map(({ task, failures }) => {
				const failDetails = failures.map((f: any) =>
					`  - REQUIREMENT: ${f.requirement}\n    GAP: ${f.gap}\n    FIX SUGGESTION: ${f.fix}`
				).join("\n");
				return [
					`### Task ${task.id}: ${task.title}`,
					`Score: ${task.complianceScore}% (attempt ${task.attempts})`,
					``,
					`Original requirements:`,
					task.body,
					``,
					`Compliance failures:`,
					failDetails,
				].join("\n");
			}).join("\n\n---\n\n");

			const triageAgent: AgentDef = {
				name: "orchestrator-triage",
				description: "Analyzes compliance failures and produces enriched fix instructions",
				tools: "read,grep,find,ls",
				systemPrompt: [
					"You are a senior technical lead triaging failed tasks.",
					"You have the compliance committee's findings. Your job is to:",
					"1. Read the actual codebase to understand what was built and what's wrong",
					"2. Produce SPECIFIC, ACTIONABLE fix instructions for each task",
					"3. Include exact file paths, line numbers, function names, and code snippets",
					"4. If a task has 3+ distinct unrelated failures, split it into subtasks",
					"5. Your output is consumed directly by a developer — be precise, not vague",
				].join(" "),
			};

			const triageResult = await runAgent(
				triageAgent,
				[
					`# Orchestrator Triage — Fix Round ${fixRound}`,
					``,
					`The compliance committee scored these tasks below ${COMPLIANCE_THRESHOLD}%.`,
					`Read the codebase, understand what was built, and produce enriched fix instructions.`,
					``,
					`## Failed Tasks`,
					triageInput,
					``,
					`## Your Job`,
					`For EACH failed task, produce a JSON object with enriched instructions:`,
					``,
					`Return JSON array:`,
					`[`,
					`  {`,
					`    "task_id": "X.Y",`,
					`    "enriched_body": "Full rewritten task body with: original requirements + what was already built + specific fix instructions with file paths, line numbers, code changes needed",`,
					`    "split": false,`,
					`    "subtasks": []`,
					`  }`,
					`]`,
					``,
					`If a task needs splitting (3+ distinct failures), set split=true and provide subtasks:`,
					`[`,
					`  {`,
					`    "task_id": "X.Y",`,
					`    "enriched_body": "Updated parent task summary",`,
					`    "split": true,`,
					`    "subtasks": [`,
					`      {"id": "X.Y.1", "title": "Subtask title", "body": "Specific focused instructions for this subtask"}`,
					`    ]`,
					`  }`,
					`]`,
					``,
					`CRITICAL: Include exact file paths, function names, line references, and code snippets in every enriched body.`,
					`The developer who reads this must know EXACTLY what to change without guessing.`,
				].join("\n"),
				`triage-${phaseIdx}-${fixRound}`,
				ctx,
				{ model: FOUNDATIONS_COUNCIL_MODELS[0], ephemeral: true, thinking: getCouncilThinking(0) },
			);

			// Parse triage results and update task bodies / create subtasks
			const triageData = extractJson(triageResult.output);
			const triageItems: any[] = Array.isArray(triageData) ? triageData : (triageData?.tasks || triageData?.items || [triageData]);
			const newSubtasks: TaskState[] = [];

			for (const item of triageItems) {
				if (!item?.task_id) continue;
				const task = ps.tasks.find(t => t.id === item.task_id);
				if (!task) continue;

				// Enrich the task body with accumulated context
				if (item.enriched_body) {
					task.body = item.enriched_body;
					log(`[Triage] ${task.id}: body enriched (${item.enriched_body.length} chars)`);
				}

				// Split into subtasks if needed
				if (item.split && Array.isArray(item.subtasks) && item.subtasks.length > 0) {
					log(`[Triage] ${task.id}: splitting into ${item.subtasks.length} subtask(s)`);
					task.status = "passed"; // Parent is "done" — subtasks carry the work
					task.complianceScore = 100;

					for (const sub of item.subtasks) {
						const subtask: TaskState = {
							id: sub.id || `${task.id}.${newSubtasks.length + 1}`,
							title: sub.title || `Subtask of ${task.id}`,
							body: sub.body || item.enriched_body,
							epic: task.epic,
							status: "building",
							complianceScore: 0,
							attempts: fixRound,
							issueNum: undefined,
						};
						newSubtasks.push(subtask);

						// Create GitHub sub-issue if parent has one
						if (task.issueNum) {
							const issueResult = shellExec(
								`gh issue create --title "${subtask.id}: ${subtask.title}" --body "Subtask of #${task.issueNum}\n\n${subtask.body.slice(0, 3000)}" --label "subtask"`,
								cwd,
							);
							if (issueResult.ok) {
								const issueUrl = issueResult.stdout.trim();
								const issueMatch = issueUrl.match(/\/(\d+)$/);
								if (issueMatch) {
									subtask.issueNum = parseInt(issueMatch[1], 10);
									log(`[Triage] Created sub-issue #${subtask.issueNum} for ${subtask.id}`);
								}
							}
						}
					}
				}
			}

			// Add new subtasks to the task list
			if (newSubtasks.length > 0) {
				ps.tasks.push(...newSubtasks);
				log(`[Triage] Added ${newSubtasks.length} subtask(s) to the sprint`);
			}

			// Determine which tasks need fixing (failed originals + new subtasks)
			const tasksToFix = ps.tasks.filter(t => t.status === "building" && t.complianceScore < COMPLIANCE_THRESHOLD);
			ctx.ui.setStatus("pipeline", `Wave 2: Fix round ${fixRound} (${tasksToFix.length} tasks)...`);
			log(`[Wave 2] Dispatching ${tasksToFix.length} task(s) for fix round ${fixRound}...`);

			// Commit current state before fixes
			shellExec(`git add -A && git commit -m "Wave 2: pre-fix round ${fixRound}" --allow-empty`, cwd);

			// Run fix agents SEQUENTIALLY — each sees previous fix's output (single-file safety)
			for (const task of tasksToFix) {
				task.attempts = fixRound;
				const model = fixRound === 3 ? FINAL_DEV_MODEL : DEV_MODEL;

				log(`[Wave 2] Fix ${task.id} round ${fixRound}...`);

				await runAgent(
					agents.get("dev")!,
					[
						`# Task ${task.id}: ${task.title}`,
						``,
						`Current score: ${task.complianceScore}% — needs >= ${COMPLIANCE_THRESHOLD}%`,
						`This is attempt ${fixRound} of 3.${fixRound === 3 ? " FINAL ATTEMPT — use maximum reasoning depth." : ""}`,
						``,
						`## Full Task Brief (enriched by orchestrator)`,
						task.body,
						``,
						`## Instructions`,
						`Implement everything described in the task brief above.`,
						`The brief contains specific file paths, function names, and code changes — follow them exactly.`,
						`Do NOT break anything that already works.`,
						`Do NOT delete or rewrite existing working code from previous tasks or epics.`,
						`Do NOT modify code owned by other tasks.`,
						``,
						`When done, commit all your changes with: git add -A && git commit -m "Fix ${task.id} round ${fixRound}"`,
					].join("\n"),
					`dev-${task.id}-${fixRound}`,
					ctx,
					{ model, ephemeral: true, thinking: getDevThinking() },
				);

				shellExec(`git add -A && git commit -m "Fix ${task.id} round ${fixRound}" --allow-empty`, cwd);
			}
		}

		// ── Blocked TODO Resolution ──
		// After all tasks pass, check if any blocked items are now resolvable
		// (their dependency was in this epic and has been completed)
		if (wave2Passed) {
			// Gather all blocked items from the last compliance round
			// Re-run a single compliance check to find remaining blocked TODOs
			log(`[Wave 2] Checking for resolvable blocked TODOs...`);
			ps.gate = "wave2-blocked";
			updateWidget();
			ctx.ui.setStatus("pipeline", `Wave 2: Resolving blocked TODOs...`);

			const blockedCheckResult = await runAgent(
				agents.get("compliance")!,
				[
					`# Blocked TODO Resolution Check`,
					``,
					`All tasks in this epic have passed compliance. Now check for any remaining blocked TODOs in the codebase.`,
					``,
					`## Tasks in this epic (all completed):`,
					ps.tasks.map(t => `- ${t.id}: ${t.title}`).join("\n"),
					``,
					`## Instructions:`,
					`1. Search the codebase for any remaining TODO comments that were blocked by dependencies`,
					`2. For each blocked TODO, determine if the dependency has NOW been built by another task in this epic`,
					`3. If the dependency IS available (another task in this epic built it), mark it as "resolvable"`,
					`4. If the dependency is from a FUTURE epic that hasn't been built, mark it as "deferred"`,
					``,
					`Return JSON: {"resolvable": [{"task_id": "X.Y", "todo": "the TODO text", "dependency": "what was blocking it", "fix": "what to implement now"}], "deferred": [{"task_id": "X.Y", "todo": "the TODO text", "dependency": "which future epic/task"}]}`,
				].join("\n"),
				`blocked-check-${phaseIdx}`,
				ctx,
				{ ephemeral: true, thinking: getFinalDevThinking() },
			);

			const blockedData = extractJson(blockedCheckResult.output);
			const resolvable = blockedData?.resolvable || [];
			const deferred = blockedData?.deferred || [];

			if (deferred.length > 0) {
				log(`[Wave 2] ${deferred.length} TODO(s) deferred to future epics`);
			}

			if (resolvable.length > 0) {
				log(`[Wave 2] ${resolvable.length} blocked TODO(s) are now resolvable — dispatching fixes...`);

				// Commit current state before blocked-fix worktrees
				shellExec(`git add -A && git commit -m "Wave 2: pre-blocked-fix" --allow-empty`, cwd);

				// Group resolvable items by task
				const byTask = new Map<string, any[]>();
				for (const item of resolvable) {
					const list = byTask.get(item.task_id) || [];
					list.push(item);
					byTask.set(item.task_id, list);
				}

				// Run blocked-fix agents SEQUENTIALLY (single-file safety)
				for (const [taskId, items] of byTask.entries()) {
					const fixDetails = items.map((item: any) =>
						`- TODO: ${item.todo}\n  Was blocked by: ${item.dependency}\n  Now fix: ${item.fix}`
					).join("\n\n");

					log(`[Wave 2] Resolving blocked TODOs for ${taskId}...`);

					await runAgent(
						agents.get("dev")!,
						[
							`# Resolve Blocked TODOs for Task ${taskId}`,
							``,
							`These TODOs were previously blocked by dependencies that are now available.`,
							`The dependency code has been built by other tasks in this epic.`,
							``,
							`## TODOs to resolve:`,
							fixDetails,
							``,
							`## Instructions:`,
							`1. Find each TODO in the codebase`,
							`2. Implement the required functionality — the dependency code now exists`,
							`3. Remove the TODO comment after implementing`,
							`4. Do NOT break any existing functionality`,
							`5. Do NOT delete or rewrite existing working code`,
							``,
							`When done, commit: git add -A && git commit -m "Resolve blocked TODOs for ${taskId}"`,
						].join("\n"),
						`blocked-fix-${taskId}`,
						ctx,
						{ model: DEV_MODEL, ephemeral: true, thinking: getDevThinking() },
					);

					shellExec(`git add -A && git commit -m "Resolve blocked TODOs for ${taskId}" --allow-empty`, cwd);
				}

				log(`[Wave 2] Blocked TODO resolution complete`);
			} else {
				log(`[Wave 2] No resolvable blocked TODOs`);
			}
		}

		// Mark any remaining non-passed tasks as failed
		for (const task of ps.tasks) {
			if (task.status !== "passed") {
				task.status = "failed";
			}
		}
		updateWidget();

		// Hard stop if any task failed
		if (!wave2Passed) {
			const tasksFailed = ps.tasks.filter(t => t.status === "failed");
			const failSummary = tasksFailed.map(t =>
				`Task ${t.id}: ${t.title} — best score ${t.complianceScore}%`
			).join("\n");

			log(`HARD STOP: ${tasksFailed.length} task(s) failed after Wave 2 fix attempts`);

			ctx.ui.notify(
				`Pipeline HALTED\n${"─".repeat(30)}\n\n${tasksFailed.length} task(s) could not reach ${COMPLIANCE_THRESHOLD}%.\n\n${failSummary}\n\nRevise the checklist tasks, then run /pipeline-next again.`,
				"warning",
			);

			ps.gate = "error";
			ps.elapsed = Date.now() - ps.startTime;
			pipeline.running = false;
			updateWidget();
			ctx.ui.setStatus("pipeline", "");
			return {
				success: false,
				summary: [
					`${tasksFailed.length} task(s) failed:`,
					failSummary,
					``,
					`Wave 1 (foundations): ${wave1Elapsed}s`,
					`Wave 2 (parallel dev): ${parallelElapsed}s`,
					``,
					`Next: revise the tasks in the checklist, then run /pipeline-next again.`,
				].join("\n"),
			};
		}

		saveCheckpoint(phaseIdx, "wave2-blocked", ps, foundationsSpec);

		// ── Quality Gates (same as before) ────────────

		if (shouldSkip("review", resumeAfterGate)) {
			log(`[Resume] Skipping review (already completed)`);
		} else {
		// Code Review
		ps.gate = "review";
		updateWidget();
		for (let attempt = 1; attempt <= MAX_LOOPS; attempt++) {
			ps.gateAttempts = attempt;
			ctx.ui.setStatus("pipeline", `Code review (attempt ${attempt})...`);
			log(`Code review attempt ${attempt}`);

			const reviewOutput = await runAgent(
				agents.get("reviewer")!,
				`Quick code review of these completed tasks. Focus ONLY on real bugs, security vulnerabilities, or broken logic. Ignore style, naming, minor improvements.\n\n` +
				`Tasks completed:\n${ps.tasks.map(t => `- ${t.id}: ${t.title}`).join("\n")}\n\n` +
				`Return JSON: {"pass": true/false, "blockers": [{"file": "...", "line": N, "severity": "critical|high", "issue": "..."}]}\n` +
				`Set pass=true if no critical/high severity issues. Do NOT fail for style, naming, or optional improvements.`,
				`review-${phaseIdx}-${attempt}`,
				ctx,
				{ ephemeral: true },
			);

			const reviewData = extractJson(reviewOutput.output);
			const hasIssues = reviewData?.pass === false && (reviewData?.blockers?.length > 0);

			if (!hasIssues) {
				log(`Code review: clean`);
				break;
			}

			if (attempt >= MAX_LOOPS) {
				log(`Code review: issues remain after ${MAX_LOOPS} attempts`);
				break;
			}

			log(`Code review: issues found, routing to dev`);
			await runAgent(
				agents.get("dev")!,
				`Fix these code review issues:\n\n${reviewOutput.output}`,
				`dev-review-fix-${phaseIdx}-${attempt}`,
				ctx,
				{ reuse: true },
			);
		}

		saveCheckpoint(phaseIdx, "review", ps, foundationsSpec);
		} // end skip review

		if (shouldSkip("build-lint", resumeAfterGate)) {
			log(`[Resume] Skipping build-lint (already completed)`);
		} else {
		// Build & Lint
		ps.gate = "build-lint";
		updateWidget();
		for (let attempt = 1; attempt <= MAX_LOOPS; attempt++) {
			ps.gateAttempts = attempt;
			ctx.ui.setStatus("pipeline", `Build & lint (attempt ${attempt})...`);
			log(`Build & lint attempt ${attempt}`);

			const buildOutput = await runAgent(
				agents.get("lint-build")!,
				"Run lint and build commands for this project. Report all errors. Return JSON: {\"overall_pass\": true/false, \"lint\": {\"errors\": [...]}, \"build\": {\"errors\": [...]}}",
				`build-${phaseIdx}-${attempt}`,
				ctx,
				{ ephemeral: true },
			);

			const buildData = extractJson(buildOutput.output);
			const pass = buildData?.overall_pass === true;

			if (pass) {
				log(`Build & lint: pass`);
				break;
			}

			if (attempt >= MAX_LOOPS) {
				log(`Build & lint: errors remain after ${MAX_LOOPS} attempts`);
				break;
			}

			const errors = [
				...(buildData?.lint?.errors || []),
				...(buildData?.build?.errors || []),
			].map((e: any) => `- ${e.file || ""}:${e.line || ""} ${e.description || e}`).join("\n");

			log(`Build & lint: errors, routing to dev`);
			await runAgent(
				agents.get("dev")!,
				`Fix these build/lint errors:\n\n${errors || buildOutput.output}`,
				`dev-build-fix-${phaseIdx}-${attempt}`,
				ctx,
				{ reuse: true },
			);
		}

		saveCheckpoint(phaseIdx, "build-lint", ps, foundationsSpec);
		} // end skip build-lint

		if (shouldSkip("test", resumeAfterGate)) {
			log(`[Resume] Skipping test (already completed)`);
		} else {
		// Test / Scenarios
		ps.gate = "test";
		updateWidget();
		for (let attempt = 1; attempt <= MAX_LOOPS; attempt++) {
			ps.gateAttempts = attempt;
			ctx.ui.setStatus("pipeline", `Testing (attempt ${attempt})...`);
			log(`Test attempt ${attempt}`);

			const testOutput = await runAgent(
				agents.get("tester")!,
				"Run the full test suite and report results. Return JSON: {\"pass\": true/false, \"passed\": N, \"failed\": N, \"total\": N, \"failures\": [{\"test\": \"...\", \"file\": \"...\", \"error\": \"...\", \"fix_hint\": \"...\"}]}",
				`test-${phaseIdx}-${attempt}`,
				ctx,
				{ ephemeral: true },
			);

			const testData = extractJson(testOutput.output);
			const pass = testData?.pass === true;

			if (pass) {
				log(`Test: pass`);
				break;
			}

			if (attempt >= MAX_LOOPS) {
				log(`Test: failures remain after ${MAX_LOOPS} attempts`);
				break;
			}

			const failures = (testData?.failures || [])
				.map((f: any) => `- ${f.test} (${f.file}): ${f.error}\n  Hint: ${f.fix_hint}`)
				.join("\n");

			log(`Test: failures, routing to dev`);
			await runAgent(
				agents.get("dev")!,
				`Fix these test failures:\n\n${failures || testOutput.output}`,
				`dev-test-fix-${phaseIdx}-${attempt}`,
				ctx,
				{ reuse: true },
			);
		}

		saveCheckpoint(phaseIdx, "test", ps, foundationsSpec);
		} // end skip test

		// ── Update Checklist + GitHub Issues ──────
		ps.gate = "done";
		ps.elapsed = Date.now() - ps.startTime;
		updateWidget();
		ctx.ui.setStatus("pipeline", "Updating checklist and issues...");

		const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
		if (existsSync(checklistPath)) {
			let checklist = readFileSync(checklistPath, "utf-8");
			for (const task of ps.tasks) {
				if (task.status === "passed") {
					const escaped = task.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					checklist = checklist.replace(
						new RegExp(`- \\[ \\] (\\*\\*${escaped}\\s*[—–-]+)`),
						`- [x] $1`,
					);
				}
			}
			writeFileSync(checklistPath, checklist, "utf-8");
			// Sync in-memory parsedPhases so auto-chain loop sees completed tasks
			for (const task of ps.tasks) {
				if (task.status === "passed") {
					const parsed = parsedPhases[phaseIdx]?.tasks.find(t => t.id === task.id);
					if (parsed) parsed.done = true;
				}
			}
			log(`Checklist updated`);
		}

		for (const task of ps.tasks) {
			if (task.status === "passed" && task.issueNum) {
				shellExec(`gh issue close ${task.issueNum} --comment "Implementation complete. Compliance: ${task.complianceScore}%."`, cwd);
				log(`Closed issue #${task.issueNum} (${task.id})`);
			}
		}

		pipeline.running = false;
		ctx.ui.setStatus("pipeline", "");
		updateWidget();
		clearCheckpoint();

		const totalElapsed = Math.round(ps.elapsed / 1000);
		const passed = ps.tasks.filter(t => t.status === "passed").length;
		const summary = [
			`Phase complete: ${phase.name}`,
			`Tasks: ${passed}/${ps.tasks.length} passed`,
			`Time: ${totalElapsed}s (Wave 1: ${wave1Elapsed}s, Wave 2: ${parallelElapsed}s)`,
			``,
			...ps.tasks.map(t => {
				const icon = t.status === "passed" ? "+" : "-";
				return `  ${icon} ${t.id}: ${t.title} (${t.complianceScore}%, ${t.attempts} attempt${t.attempts > 1 ? "s" : ""})`;
			}),
		].join("\n");

		log(summary);
		return { success: passed === ps.tasks.length, summary };
	}

	// ══════════════════════════════════════════════
	// FAST TRACK PIPELINE
	// ══════════════════════════════════════════════

	const getFastBuildModel = () => pipelineConfig.fast.build.model;
	const getFastEvalModel = () => pipelineConfig.fast.eval.model;
	const getFastFixModel = () => pipelineConfig.fast.fix.model;
	const getFastUatModel = () => pipelineConfig.fast.uat.model;

	// Backward-compat aliases (used in string templates, re-evaluated on access)
	let FAST_BUILD_MODEL = pipelineConfig.fast.build.model;
	let FAST_EVAL_MODEL = pipelineConfig.fast.eval.model;
	let FAST_FIX_MODEL = pipelineConfig.fast.fix.model;

	function updateChecklistForTask(taskId: string, taskIssueNum?: number) {
		const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
		if (!existsSync(checklistPath)) return;
		let checklist = readFileSync(checklistPath, "utf-8");
		const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		// Format A: - [ ] **1.1 — Title**
		checklist = checklist.replace(
			new RegExp(`- \\[ \\] (\\*\\*${escaped}\\s*[—–-]+)`),
			`- [x] $1`,
		);
		// Format B: - [ ] #N - 1.1 Title
		checklist = checklist.replace(
			new RegExp(`- \\[ \\] (#\\d+\\s*-\\s*${escaped}\\s)`),
			`- [x] $1`,
		);
		writeFileSync(checklistPath, checklist, "utf-8");
	}

	async function runPhaseFast(phaseIdx: number, ctx: ExtensionContext): Promise<{ success: boolean; summary: string }> {
		const phase = parsedPhases[phaseIdx];
		if (!phase) return { success: false, summary: "Phase not found" };

		const pendingTasks = phase.tasks.filter(t => !t.done);
		if (pendingTasks.length === 0) return { success: true, summary: "All tasks already complete" };

		const ps: PhaseState = {
			name: phase.name,
			tasks: pendingTasks.map(t => ({
				id: t.id, title: t.title, body: t.body, epic: t.epic,
				status: "pending" as TaskStatus, complianceScore: 0, attempts: 0, issueNum: t.issueNum,
			})),
			gate: "wave2-parallel",
			gateAttempts: 0,
			startTime: Date.now(),
			elapsed: 0,
		};
		pipeline.phaseStates.set(phase.name, ps);
		pipeline.running = true;
		updateWidget();

		log(`=== [FAST] Phase: ${phase.name} (${pendingTasks.length} tasks) ===`);

		// Read existing codebase for context
		const targetFile = join(cwd, "index.html");
		let existingCode = "";
		if (existsSync(targetFile)) {
			existingCode = readFileSync(targetFile, "utf-8");
		}

		// ── STEP 1: BUILD — Single model, entire epic ──
		ps.gate = "wave2-parallel";
		fastStage = "build";
		fastStageTask = "";
		for (const t of ps.tasks) t.status = "building";
		updateWidget();
		ctx.ui.setStatus("pipeline", `[FAST] Building ${phase.name}...`);
		log(`[FAST] BUILD: ${FAST_BUILD_MODEL} building entire epic...`);

		const taskListText = ps.tasks.map(t =>
			`### Task ${t.id}: ${t.title}\n${t.body}`
		).join("\n\n");

		const isFirstEpic = phaseIdx === 0 || parsedPhases.slice(0, phaseIdx).every(p => p.tasks.every(t => !t.done));

		const buildPrompt = [
			`# Build Epic: ${phase.name}`,
			``,
			`## Tasks to implement`,
			taskListText,
			``,
			`## Instructions`,
			isFirstEpic
				? `Build the COMPLETE implementation for all tasks above from scratch in index.html.`
				: `EXTEND the existing codebase to implement all tasks above. Do NOT delete or rewrite existing working code from previous epics. Add new code that integrates with what already exists.`,
			``,
			`Target file: index.html (single self-contained HTML file with inline CSS/JS)`,
			``,
			`Requirements:`,
			`- Implement ALL tasks listed above completely`,
			`- Each task's acceptance criteria must be fully met`,
			`- Code must be production quality, no stubs or TODOs`,
			`- All new code must integrate with existing classes and systems`,
			``,
			`IMPORTANT: Write the COMPLETE updated file. Do not use placeholders like "// ... existing code ..."`,
		].join("\n");

		const builderAgent: AgentDef = {
			name: "dev",
			description: "Fast track builder",
			tools: "read,write,edit,grep,find,ls,bash",
			systemPrompt: "You are a senior developer. Implement the requested features completely and correctly. Write production-quality code.",
			model: FAST_BUILD_MODEL,
		};

		const buildResult = await runAgent(builderAgent, buildPrompt, `fast-build-${phaseIdx}`, ctx, { ephemeral: true, model: FAST_BUILD_MODEL, thinking: pipelineConfig.fast.build.thinking });

		shellExec(`git -C '${cwd}' add -A && git -C '${cwd}' commit -m "Fast track: build ${phase.name}"`, cwd);
		log(`[FAST] BUILD complete (${Math.round(buildResult.elapsed / 1000)}s)`);

		// ── STEP 2: EVALUATE — Stronger model scores per-task ──
		ps.gate = "wave2-compliance";
		fastStage = "eval";
		fastStageTask = "";
		for (const t of ps.tasks) t.status = "scoring";
		updateWidget();
		ctx.ui.setStatus("pipeline", `[FAST] Evaluating ${phase.name}...`);
		log(`[FAST] EVALUATE: ${FAST_EVAL_MODEL} scoring per-task...`);

		const currentCode = existsSync(targetFile) ? readFileSync(targetFile, "utf-8") : "(file not found)";

		const evalPrompt = [
			`# Compliance Evaluation — ${phase.name}`,
			``,
			`## Tasks to evaluate`,
			taskListText,
			``,
			`## Current implementation`,
			`The code is in index.html. Read the file and evaluate each task.`,
			``,
			`## Scoring rules`,
			`For each task, score 0-100:`,
			`- 100: All acceptance criteria met, code is correct and complete`,
			`- 95-99: Minor issues (style, comments) but functionally complete`,
			`- 80-94: Mostly complete but missing some criteria`,
			`- 50-79: Partially implemented`,
			`- 0-49: Barely started or fundamentally broken`,
			``,
			`Only deduct points for REAL, VERIFIABLE issues. Do NOT deduct for:`,
			`- Stylistic preferences`,
			`- Features not listed in the acceptance criteria`,
			`- Code that works differently than you'd write it but still meets requirements`,
			``,
			`## Required output format (JSON)`,
			'```json',
			`{`,
			`  "tasks": [`,
			`    {`,
			`      "id": "1.1",`,
			`      "score": 100,`,
			`      "passed": true,`,
			`      "issues": [],`,
			`      "summary": "All criteria met"`,
			`    }`,
			`  ]`,
			`}`,
			'```',
		].join("\n");

		const evalAgent: AgentDef = {
			name: "compliance",
			description: "Fast track evaluator",
			tools: "read,grep,find,ls",
			systemPrompt: "You are a strict but fair code reviewer. Evaluate implementations against their acceptance criteria. Be precise — only flag real issues.",
			model: FAST_EVAL_MODEL,
		};

		const evalResult = await runAgent(evalAgent, evalPrompt, `fast-eval-${phaseIdx}`, ctx, { ephemeral: true, model: FAST_EVAL_MODEL, thinking: pipelineConfig.fast.eval.thinking });

		const evalJson = extractJson(evalResult.output);
		const taskScores = new Map<string, { score: number; issues: string[]; summary: string }>();

		if (evalJson?.tasks) {
			for (const t of evalJson.tasks) {
				taskScores.set(t.id, { score: t.score || 0, issues: t.issues || [], summary: t.summary || "" });
			}
		}

		// Update task states with scores
		const failedTasks: TaskState[] = [];
		for (const t of ps.tasks) {
			const score = taskScores.get(t.id);
			t.complianceScore = score?.score ?? 0;
			t.attempts = 1;
			if (t.complianceScore >= COMPLIANCE_THRESHOLD) {
				t.status = "passed";
			} else {
				t.status = "failed";
				failedTasks.push(t);
			}
		}
		updateWidget();

		log(`[FAST] EVALUATE complete: ${ps.tasks.filter(t => t.status === "passed").length}/${ps.tasks.length} passed`);
		for (const t of ps.tasks) {
			const scoreInfo = taskScores.get(t.id);
			log(`  ${t.status === "passed" ? "+" : "-"} ${t.id}: ${t.complianceScore}% — ${scoreInfo?.summary || ""}`);
		}

		// ── STEP 3: SUBTASK DECOMPOSITION for failed tasks ──
		if (failedTasks.length > 0) {
			fastStage = "fix";
			log(`[FAST] ${failedTasks.length} task(s) below ${COMPLIANCE_THRESHOLD}%. Starting subtask decomposition...`);

			for (const failedTask of failedTasks) {
				fastStageTask = `${failedTask.id}: ${failedTask.title}`;
				let depth = 0;
				let currentScore = failedTask.complianceScore;
				const issues = taskScores.get(failedTask.id)?.issues || [];

				while (currentScore < COMPLIANCE_THRESHOLD && depth < MAX_SUBTASK_DEPTH) {
					depth++;

					// Escalation: depth 1 = fix, depth 2+ = fixEscalation[depth-2] (clamped to last entry)
					const esc = pipelineConfig.fast.fixEscalation;
					const fixRole = depth === 1 ? pipelineConfig.fast.fix
						: esc.length > 0 ? esc[Math.min(depth - 2, esc.length - 1)]
						: pipelineConfig.fast.fix;
					const fixModelForDepth = fixRole.model;
					const fixThinkingForDepth = fixRole.thinking;
					const escalated = depth > 1 && esc.length > 0;

					ctx.ui.setStatus("pipeline", `[FAST] Fixing ${failedTask.id} (depth ${depth}/${MAX_SUBTASK_DEPTH}, ${currentScore}%${escalated ? ` · ${shortModelName(fixModelForDepth)}:${fixThinkingForDepth}` : ""})...`);
					log(`[FAST] Subtask fix depth ${depth} for ${failedTask.id} (${currentScore}%)${escalated ? ` [escalated → ${shortModelName(fixModelForDepth)}:${fixThinkingForDepth}]` : ""}...`);
					failedTask.status = "building";
					updateWidget();

					const fixPrompt = [
						`# Fix Task ${failedTask.id}: ${failedTask.title}`,
						``,
						`## Current score: ${currentScore}%`,
						`## Issues found:`,
						...issues.map((iss, i) => `${i + 1}. ${iss}`),
						``,
						`## Task requirements`,
						failedTask.body,
						``,
						`## Instructions`,
						`Fix the issues listed above. Do NOT rewrite the entire file.`,
						`Make TARGETED, SURGICAL edits to address each issue.`,
						`Preserve all existing working code from this and previous epics.`,
						``,
						`Focus only on what's broken or missing for task ${failedTask.id}.`,
						...(escalated ? [``, `This is an ESCALATED attempt (depth ${depth}). Previous fixes were insufficient. Apply maximum care and deeper reasoning.`] : []),
					].join("\n");

					const fixResult = await runAgent(builderAgent, fixPrompt, `fast-fix-${failedTask.id}-d${depth}`, ctx, { ephemeral: true, model: fixModelForDepth, thinking: fixThinkingForDepth });
					shellExec(`git -C '${cwd}' add -A && git -C '${cwd}' commit -m "Fast track: fix ${failedTask.id} (depth ${depth})"`, cwd);

					// Re-evaluate this specific task
					failedTask.status = "scoring";
					updateWidget();

					const reEvalPrompt = [
						`# Re-evaluate Task ${failedTask.id}: ${failedTask.title}`,
						``,
						`## Task requirements`,
						failedTask.body,
						``,
						`Read index.html and score this specific task (0-100).`,
						`Previous issues were: ${issues.join("; ")}`,
						``,
						`## Required output format (JSON)`,
						'```json',
						`{ "id": "${failedTask.id}", "score": 100, "passed": true, "issues": [], "summary": "Fixed" }`,
						'```',
					].join("\n");

					const reEvalResult = await runAgent(evalAgent, reEvalPrompt, `fast-reeval-${failedTask.id}-d${depth}`, ctx, { ephemeral: true, model: FAST_EVAL_MODEL, thinking: pipelineConfig.fast.eval.thinking });
					const reEvalJson = extractJson(reEvalResult.output);

					if (reEvalJson) {
						currentScore = reEvalJson.score || currentScore;
						failedTask.complianceScore = currentScore;
						if (reEvalJson.issues) issues.length = 0, issues.push(...reEvalJson.issues);
					}

					failedTask.attempts = depth + 1;

					if (currentScore >= COMPLIANCE_THRESHOLD) {
						failedTask.status = "passed";
						log(`[FAST] ${failedTask.id} fixed at depth ${depth}: ${currentScore}%`);
						break;
					}
				}

				if (currentScore < COMPLIANCE_THRESHOLD) {
					failedTask.status = "failed";
					log(`[FAST] ${failedTask.id} could not reach ${COMPLIANCE_THRESHOLD}% after ${MAX_SUBTASK_DEPTH} depths (final: ${currentScore}%)`);
				}
				updateWidget();
			}
		}

		// ── STEP 4: PARALLEL — Generate/update UAT scenarios for this epic ──
		fastStage = "uat-gen";
		fastStageTask = "";
		updateWidget();
		ctx.ui.setStatus("pipeline", `[FAST] Generating UAT scenarios for ${phase.name}...`);
		log(`[FAST] Generating UAT scenarios...`);
		await generateUatScenarios(phase, ps, ctx);

		// ── STEP 5: Update checklist + GitHub issues ──
		ps.gate = "done";
		ps.elapsed = Date.now() - ps.startTime;
		updateWidget();

		for (const task of ps.tasks) {
			if (task.status === "passed") {
				updateChecklistForTask(task.id, task.issueNum);
				const parsed = parsedPhases[phaseIdx]?.tasks.find(t => t.id === task.id);
				if (parsed) parsed.done = true;
				if (task.issueNum) {
					shellExec(`gh issue close ${task.issueNum} --comment "Fast track: ${task.complianceScore}% compliance."`, cwd);
				}
			}
		}

		pipeline.running = false;
		ctx.ui.setStatus("pipeline", "");
		updateWidget();

		const passed = ps.tasks.filter(t => t.status === "passed").length;
		const totalElapsed = Math.round((Date.now() - ps.startTime) / 1000);
		const summary = [
			`[FAST] Phase complete: ${phase.name}`,
			`Tasks: ${passed}/${ps.tasks.length} passed (${totalElapsed}s)`,
			``,
			...ps.tasks.map(t => {
				const icon = t.status === "passed" ? "+" : "-";
				return `  ${icon} ${t.id}: ${t.title} (${t.complianceScore}%, ${t.attempts} attempt${t.attempts > 1 ? "s" : ""})`;
			}),
		].join("\n");

		log(summary);
		return { success: passed === ps.tasks.length, summary };
	}

	// ── UAT Scenario Generation ──────────────────

	async function ensureUatEpic(): Promise<number | undefined> {
		if (uatState.epicIssueNum) return uatState.epicIssueNum;

		// Check if UAT epic already exists
		const search = shellExec(`gh issue list --label "uat" --state open --json number,title -q '.[0].number'`, cwd);
		if (search.ok && search.stdout) {
			uatState.epicIssueNum = parseInt(search.stdout, 10);
			if (!isNaN(uatState.epicIssueNum)) {
				log(`[UAT] Found existing UAT epic: #${uatState.epicIssueNum}`);
				return uatState.epicIssueNum;
			}
		}

		// Create UAT epic
		const title = parsedPhases.length > 0
			? `UAT Test Suite — ${parsedPhases[0].name.split(":")[0].replace("Epic 1", "").trim() || "Project"}`
			: "UAT Test Suite";
		const body = [
			`# User Acceptance Testing`,
			``,
			`Automated UAT scenarios generated by the fast track pipeline.`,
			`Each child issue is a test scenario with:`,
			`- **Body**: Test instructions (inputs, steps, expected outcomes)`,
			`- **Comments**: Execution results (pass/fail + evidence)`,
			``,
			`## Status`,
			`- Created by pipeline, updated each UAT session`,
			`- Epic closed ONLY when user approves UAT via \`/pipeline-approve\``,
		].join("\n");

		const create = shellExec(`gh issue create --title "${title}" --body "${body.replace(/"/g, '\\"')}" --label "uat"`, cwd);
		if (create.ok) {
			const numMatch = create.stdout.match(/(\d+)/);
			if (numMatch) {
				uatState.epicIssueNum = parseInt(numMatch[1], 10);
				log(`[UAT] Created UAT epic: #${uatState.epicIssueNum}`);
				// Ensure uat label exists
				shellExec(`gh label create uat --color "FBCA04" --description "User Acceptance Testing" --force`, cwd);
				shellExec(`gh label create uat-pass --color "0E8A16" --description "UAT scenario passed" --force`, cwd);
				shellExec(`gh label create uat-fail --color "D93F0B" --description "UAT scenario failed" --force`, cwd);
				shellExec(`gh label create uat-pending --color "FBCA04" --description "UAT scenario pending" --force`, cwd);
				return uatState.epicIssueNum;
			}
		}
		log(`[UAT] Failed to create UAT epic: ${create.stderr}`);
		return undefined;
	}

	async function generateUatScenarios(phase: ParsedPhase, ps: PhaseState, ctx: ExtensionContext) {
		const epicNum = phase.name.match(/Epic (\d+)/)?.[1] || "0";

		const scenarioPrompt = [
			`# Generate UAT Test Scenarios — ${phase.name}`,
			``,
			`## Tasks implemented in this epic`,
			...ps.tasks.map(t => `- ${t.id}: ${t.title}\n  ${t.body.split("\n").slice(0, 3).join("\n  ")}`),
			``,
			`## Instructions`,
			`Generate user acceptance test scenarios for the features built in this epic.`,
			`Each scenario should be a concrete user workflow that can be automated with browser testing.`,
			``,
			`For each scenario provide:`,
			`1. **title**: Short descriptive name`,
			`2. **inputs**: What user inputs are needed (keyboard, mouse, seed text, etc.)`,
			`3. **steps**: Ordered list of actions to perform (navigate, click, type, wait, etc.)`,
			`4. **expectedOutcomes**: What should be observable after each step`,
			``,
			`Focus on:`,
			`- Happy path workflows (most important)`,
			`- Edge cases specific to this epic's features`,
			`- Integration with previous epics' features`,
			``,
			`## Required output format (JSON)`,
			'```json',
			`{`,
			`  "scenarios": [`,
			`    {`,
			`      "title": "Start game with random seed",`,
			`      "inputs": "Space key, arrow keys",`,
			`      "steps": ["Navigate to localhost:8080", "Press Space to start", "Verify maze renders", "Press arrow key to move"],`,
			`      "expectedOutcomes": ["Title screen visible", "Maze generates successfully", "Pac-Man moves in direction"]`,
			`    }`,
			`  ]`,
			`}`,
			'```',
		].join("\n");

		const scenarioAgent: AgentDef = {
			name: "compliance",
			description: "UAT scenario generator",
			tools: "read,grep,find,ls",
			systemPrompt: "You are a QA engineer. Generate thorough, automatable test scenarios for user acceptance testing.",
		};

		const result = await runAgent(scenarioAgent, scenarioPrompt, `fast-uat-scenarios-${epicNum}`, ctx, { ephemeral: true, model: FAST_EVAL_MODEL, thinking: pipelineConfig.fast.uat.thinking });
		const scenarioJson = extractJson(result.output);

		if (!scenarioJson?.scenarios) {
			log(`[UAT] Failed to parse scenarios for ${phase.name}`);
			return;
		}

		// Create GitHub issues for each scenario
		const uatEpicNum = await ensureUatEpic();
		const epicLabel = `epic-${epicNum}`;
		shellExec(`gh label create "${epicLabel}" --color "C5DEF5" --description "Epic ${epicNum}" --force`, cwd);

		for (const scenario of scenarioJson.scenarios) {
			const scenarioId = `uat-${epicNum}-${scenarioJson.scenarios.indexOf(scenario) + 1}`;
			const existingScenario = uatState.scenarios.find(s => s.title === scenario.title && s.epic === phase.name);
			if (existingScenario) {
				log(`[UAT] Scenario already exists: ${scenario.title}`);
				continue;
			}

			const body = [
				`## Test Scenario: ${scenario.title}`,
				``,
				`**Epic:** ${phase.name}`,
				`**Inputs:** ${scenario.inputs}`,
				``,
				`### Steps`,
				...scenario.steps.map((s: string, i: number) => `${i + 1}. ${s}`),
				``,
				`### Expected Outcomes`,
				...scenario.expectedOutcomes.map((o: string, i: number) => `${i + 1}. ${o}`),
			].join("\n");

			const createResult = shellExec(
				`gh issue create --title "UAT: ${scenario.title}" --body "${body.replace(/"/g, '\\"')}" --label "uat-pending,${epicLabel}"`,
				cwd,
			);

			let issueNum: number | undefined;
			if (createResult.ok) {
				const numMatch = createResult.stdout.match(/(\d+)/);
				if (numMatch) issueNum = parseInt(numMatch[1], 10);
			}

			uatState.scenarios.push({
				id: scenarioId,
				title: scenario.title,
				epic: phase.name,
				inputs: scenario.inputs,
				steps: scenario.steps,
				expectedOutcomes: scenario.expectedOutcomes,
				issueNum,
				result: "pending",
			});

			log(`[UAT] Created scenario: ${scenario.title}${issueNum ? ` (#${issueNum})` : ""}`);
		}
	}

	async function runUatExecution(ctx: ExtensionContext): Promise<{ passed: number; failed: number; total: number }> {
		fastStage = "uat-exec";
		fastStageTask = "";
		updateWidget();
		log(`[UAT] Starting UAT execution with Playwright...`);
		ctx.ui.setStatus("pipeline", "Running UAT scenarios via Playwright...");

		// Start local server if not running
		const serverCheck = shellExec(`curl -s -o /dev/null -w "%{http_code}" http://localhost:8080`, cwd);
		if (!serverCheck.ok || serverCheck.stdout !== "200") {
			log(`[UAT] Starting local HTTP server...`);
			shellExec(`python3 -m http.server 8080 &`, cwd);
			await new Promise(r => setTimeout(r, 2000));
		}

		let passed = 0, failed = 0;
		const pendingScenarios = uatState.scenarios.filter(s => s.result === "pending" || s.result === "fail");

		for (const scenario of pendingScenarios) {
			ctx.ui.setStatus("pipeline", `[UAT] Running: ${scenario.title}...`);
			log(`[UAT] Executing: ${scenario.title}`);

			const playwrightPrompt = [
				`# Execute UAT Scenario: ${scenario.title}`,
				``,
				`## Inputs`,
				scenario.inputs,
				``,
				`## Steps to execute`,
				...scenario.steps.map((s, i) => `${i + 1}. ${s}`),
				``,
				`## Expected outcomes to verify`,
				...scenario.expectedOutcomes.map((o, i) => `${i + 1}. ${o}`),
				``,
				`## Instructions`,
				`Use the Playwright browser tools to execute this test scenario:`,
				`1. Navigate to http://localhost:8080`,
				`2. Execute each step using browser_click, browser_type, browser_press_key, etc.`,
				`3. After each step, take a snapshot or screenshot to verify the expected outcome`,
				`4. Report PASS or FAIL for each expected outcome`,
				``,
				`## Required output format (JSON)`,
				'```json',
				`{`,
				`  "overallResult": "pass",`,
				`  "stepResults": [`,
				`    { "step": 1, "result": "pass", "evidence": "Screenshot shows maze rendered" }`,
				`  ]`,
				`}`,
				'```',
			].join("\n");

			const uatAgent: AgentDef = {
				name: "tester",
				description: "UAT browser tester",
				tools: "read,bash,browser_navigate,browser_snapshot,browser_take_screenshot,browser_click,browser_type,browser_press_key,browser_wait_for,browser_evaluate",
				systemPrompt: "You are a QA tester. Execute test scenarios using Playwright browser tools. Be thorough and report pass/fail with evidence.",
				model: pipelineConfig.fast.uat.model,
			};

			const uatResult = await runAgent(uatAgent, playwrightPrompt, `fast-uat-exec-${scenario.id}`, ctx, { ephemeral: true, thinking: pipelineConfig.fast.uat.thinking });
			const resultJson = extractJson(uatResult.output);

			const scenarioResult = resultJson?.overallResult === "pass" ? "pass" : "fail";
			scenario.result = scenarioResult as "pass" | "fail";
			scenario.evidence = uatResult.output.slice(0, 2000);

			if (scenarioResult === "pass") passed++;
			else failed++;

			// Post results as comment on GitHub issue
			if (scenario.issueNum) {
				const comment = [
					`## UAT Result: ${scenarioResult.toUpperCase()}`,
					``,
					`**Executed:** ${new Date().toISOString()}`,
					``,
					resultJson?.stepResults
						? resultJson.stepResults.map((sr: any) => `- Step ${sr.step}: ${sr.result} — ${sr.evidence || ""}`).join("\n")
						: `Raw output: ${uatResult.output.slice(0, 500)}`,
				].join("\n");
				shellExec(`gh issue comment ${scenario.issueNum} --body "${comment.replace(/"/g, '\\"')}"`, cwd);

				// Update labels
				const labelToAdd = scenarioResult === "pass" ? "uat-pass" : "uat-fail";
				const labelToRemove = scenarioResult === "pass" ? "uat-fail" : "uat-pass";
				shellExec(`gh issue edit ${scenario.issueNum} --add-label "${labelToAdd}" --remove-label "uat-pending,${labelToRemove}"`, cwd);
			}

			log(`[UAT] ${scenario.title}: ${scenarioResult.toUpperCase()}`);
		}

		ctx.ui.setStatus("pipeline", "");
		return { passed, failed, total: pendingScenarios.length };
	}

	async function runNextPhaseFast(ctx: any) {
		if (pipeline.running) {
			ctx.ui.notify("Pipeline is already running.", "warning");
			return;
		}

		if (pipeline.currentPhase < 0 || parsedPhases.length === 0) {
			ctx.ui.notify("Run /pipeline-start first to initialize.", "warning");
			return;
		}

		// ── Auto-chain loop: run all remaining epics ──
		while (true) {
			let phaseIdx = pipeline.currentPhase;
			while (phaseIdx < parsedPhases.length && parsedPhases[phaseIdx].tasks.every(t => t.done)) {
				phaseIdx++;
			}

			if (phaseIdx >= parsedPhases.length) {
				// All epics done — run UAT execution
				log(`[FAST] All epics complete. Running UAT execution...`);
				ctx.ui.notify("All epics complete! Running UAT test suite...", "info");

				const uatResults = await runUatExecution(ctx);

				log(`[UAT] Results: ${uatResults.passed} passed, ${uatResults.failed} failed out of ${uatResults.total}`);

				// Enter approval wait state
				fastStage = "uat-approval";
				uatState.awaitingApproval = true;
				updateWidget();

				ctx.ui.notify(
					[
						`UAT Execution Complete`,
						`──────────────────────`,
						`Passed: ${uatResults.passed}/${uatResults.total}`,
						`Failed: ${uatResults.failed}/${uatResults.total}`,
						``,
						uatResults.failed > 0
							? `${uatResults.failed} scenario(s) failed. Review results in GitHub issues.`
							: `All scenarios passed!`,
						``,
						`Awaiting your approval:`,
						`  /pipeline-approve  — Approve UAT, close epic, proceed to merge`,
						`  /pipeline-reject   — Reject with notes, loop back for fixes`,
					].join("\n"),
					uatResults.failed > 0 ? "warning" : "success",
				);
				return;
			}

			pipeline.currentPhase = phaseIdx;
			updateWidget();

			const phase = parsedPhases[phaseIdx];

			// Auto-create branch
			const currentBranch = shellExec("git branch --show-current", cwd);
			const expectedEpicNum = phase.name.match(/Epic (\d+)/)?.[1];
			const alreadyOnBranch = currentBranch.ok && expectedEpicNum && currentBranch.stdout.includes(`epic-${expectedEpicNum}`);

			if (!alreadyOnBranch) {
				for (const paneId of watchPaneIds) {
					try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
				}
				watchPaneIds = [];
				tmuxColumns.length = 0;
				agentPanes.clear();

				log(`[FAST] Creating branch for ${phase.name}...`);
				if (!createEpicBranch(phase, ctx)) {
					ctx.ui.notify(`Failed to create branch for ${phase.name}. Stopping.`, "error");
					return;
				}
			}

			ctx.ui.notify(`[FAST] Starting: ${phase.name} (${phase.tasks.filter(t => !t.done).length} tasks)`, "info");

			const result = await runPhaseFast(phaseIdx, ctx);
			ctx.ui.notify(result.summary, result.success ? "success" : "error");

			if (!result.success) {
				log(`[FAST] HALTED: ${phase.name} failed.`);
				ctx.ui.notify(`Pipeline halted: ${phase.name} failed. Fix issues and run /pipeline-next to retry.`, "error");
				return;
			}

			pipeline.currentPhase = phaseIdx + 1;
			updateWidget();

			const remaining = parsedPhases.slice(phaseIdx + 1).filter(p => p.tasks.some(t => !t.done));
			if (remaining.length > 0) {
				log(`[FAST] ${phase.name} done. ${remaining.length} epic(s) remaining — continuing in 3s...`);
				ctx.ui.notify(`[FAST] ${phase.name} complete. Auto-chaining... (${remaining.length} remaining)`, "info");
				await new Promise(r => setTimeout(r, 3000));
			}
		}
	}

	// ── Widget ───────────────────────────────────

	function updateWidget() {
		if (!widgetCtx) return;
		writeStateFile();

		widgetCtx.ui.setWidget("dev-pipeline", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					// Observer mode: render from state file
					if (observerMode) {
						const state = readStateFile();
						if (!state) {
							text.setText(theme.fg("dim", "Observer mode — no state file found."));
							return text.render(width);
						}
						const lines: string[] = [];
						lines.push(theme.fg("warning", theme.bold("OBSERVER MODE")) + theme.fg("dim", " — another pipeline instance is running"));
						lines.push("");
						if (state.phases) {
							for (const phase of state.phases) {
								const icon = phase.allDone ? "✓" : phase.isCurrent ? "●" : "○";
								const color = phase.allDone ? "success" : phase.isCurrent ? "accent" : "dim";
								const pending = phase.pending > 0 ? ` (${phase.pending} remaining)` : "";
								const gate = phase.gate && phase.gate !== "idle" && phase.gate !== "done" ? ` [${phase.gate}]` : "";
								lines.push(
									phase.isCurrent
										? theme.fg(color, theme.bold(`${icon} ${phase.name}${pending}${gate}`))
										: theme.fg(color, `${icon} ${phase.name}${pending}${gate}`)
								);
								if (phase.isCurrent && phase.tasks) {
									for (const t of phase.tasks) {
										const tIcon = t.status === "passed" ? "✓" : t.status === "building" ? "●" : t.status === "scoring" ? "◉" : t.status === "failed" ? "✗" : "○";
										const tColor = t.status === "passed" ? "success" : t.status === "building" || t.status === "scoring" ? "accent" : t.status === "failed" ? "error" : "dim";
										const score = t.complianceScore > 0 ? ` ${t.complianceScore}%` : "";
										lines.push(theme.fg(tColor, `  ${tIcon} ${t.id}: ${t.title}${score}`));
									}
								}
							}
						}
						if (state.log && state.log.length > 0) {
							lines.push("");
							const recentLogs = state.log.slice(-5);
							for (const entry of recentLogs) {
								lines.push(theme.fg("dim", `  ${entry}`));
							}
						}
						lines.push("", theme.fg("dim", "Refreshing every 3s. Pipeline commands are disabled."));
						text.setText(lines.join("\n"));
						return text.render(width);
					}

					if (parsedPhases.length === 0) {
						text.setText(theme.fg("dim", "No checklist loaded. Run /pipeline-start to start."));
						return text.render(width);
					}

					const lines: string[] = [];

					// ── Fast Track pipeline stage bar ──
					if (pipelineMode === "fast" && pipeline.running) {
						const sn = (id: string) => shortModelName(id).slice(0, 10);
						const stages: { label: string; model: string; stage: FastStage; taskLine: string }[] = [
							{ label: "Build", model: sn(pipelineConfig.fast.build.model), stage: "build", taskLine: "" },
							{ label: "Eval", model: sn(pipelineConfig.fast.eval.model), stage: "eval", taskLine: "" },
							{ label: "Fix", model: sn(pipelineConfig.fast.fix.model), stage: "fix", taskLine: fastStageTask },
							{ label: "UAT Auto", model: sn(pipelineConfig.fast.uat.model), stage: "uat-exec", taskLine: "" },
							{ label: "UAT", model: "User", stage: "uat-approval", taskLine: "" },
						];

						// Map uat-gen to between fix and uat-exec visually
						const stageOrder: FastStage[] = ["build", "eval", "fix", "uat-exec", "uat-approval"];
						const activeIdx = stageOrder.indexOf(fastStage === "uat-gen" ? "uat-exec" : fastStage);

						const boxParts: string[] = [];
						for (let s = 0; s < stages.length; s++) {
							const st = stages[s];
							const isActive = s === activeIdx;
							const isDone = s < activeIdx;
							const isWaiting = s > activeIdx;

							const icon = isDone ? "✓" : isActive ? "●" : "○";
							const statusText = isDone ? "Done" : isActive ? (fastStage === "uat-gen" ? "Generating..." : "Running...") : "Waiting...";
							const taskInfo = isActive && st.taskLine ? st.taskLine.slice(0, 14) : statusText;

							const inner = ` ${st.label.padEnd(9)} ${st.model.padEnd(6)} [${icon}] ${taskInfo} `;
							const boxWidth = Math.max(inner.length, 20);
							const padded = inner.padEnd(boxWidth);

							if (isDone) {
								boxParts.push(theme.fg("success", `|${padded}|`));
							} else if (isActive) {
								boxParts.push(theme.fg("accent", theme.bold(`|${padded}|`)));
							} else {
								boxParts.push(theme.fg("dim", `|${padded}|`));
							}
						}

						lines.push(boxParts.join(" "));
						lines.push("");
					} else if (pipelineMode === "fast" && !pipeline.running && fastStage !== "idle") {
						// Show completed state
						const allDone = fastStage === "uat-approval" && uatState.approved;
						const sn2 = (id: string) => shortModelName(id).slice(0, 10);
						const stageLabels = ["Build", "Eval", "Fix", "UAT Auto", "UAT"];
						const models = [sn2(pipelineConfig.fast.build.model), sn2(pipelineConfig.fast.eval.model), sn2(pipelineConfig.fast.fix.model), sn2(pipelineConfig.fast.uat.model), "User"];
						const boxParts: string[] = [];
						for (let s = 0; s < stageLabels.length; s++) {
							const icon = allDone ? "✓" : (s <= 4 ? "✓" : "○");
							const inner = ` ${stageLabels[s].padEnd(9)} ${models[s].padEnd(6)} [${icon}] `;
							boxParts.push(theme.fg(allDone ? "success" : "dim", `|${inner}|`));
						}
						lines.push(boxParts.join(" "));
						lines.push("");
					}
					for (let i = 0; i < parsedPhases.length; i++) {
						const phase = parsedPhases[i];
						const ps = pipeline.phaseStates.get(phase.name);
						const isCurrent = i === pipeline.currentPhase;
						const allDone = phase.tasks.every(t => t.done);

						let icon = "○";
						let color: string = "dim";
						if (allDone) { icon = "✓"; color = "success"; }
						else if (ps?.gate === "error") { icon = "✗"; color = "error"; }
						else if (ps?.gate === "done") { icon = "✓"; color = "success"; }
						else if (isCurrent && pipeline.running) { icon = "●"; color = "accent"; }

						const pending = phase.tasks.filter(t => !t.done).length;
						const label = `${icon} ${phase.name}`;
						const detail = allDone ? "" : ` (${pending} remaining)`;
						const gate = ps && ps.gate !== "idle" && ps.gate !== "done" ? ` [${ps.gate}]` : "";

						lines.push(
							isCurrent
								? theme.fg(color, theme.bold(label + detail + gate))
								: theme.fg(color, label + detail + gate)
						);

						// Show task details for current phase
						if (isCurrent && ps) {
							for (const t of ps.tasks) {
								const tIcon = t.status === "passed" ? "✓"
									: t.status === "building" ? "●"
									: t.status === "scoring" ? "◉"
									: t.status === "failed" ? "✗"
									: "○";
								const tColor = t.status === "passed" ? "success"
									: t.status === "building" || t.status === "scoring" ? "accent"
									: t.status === "failed" ? "error"
									: "dim";
								const score = t.complianceScore > 0 ? ` ${t.complianceScore}%` : "";
								const att = t.attempts > 1 ? ` x${t.attempts}` : "";
								lines.push(theme.fg(tColor, `  ${tIcon} ${t.id}: ${t.title}${score}${att}`));
							}
						}
					}

					// UAT status line
					if (uatState.awaitingApproval) {
						const flash = Math.floor(Date.now() / 500) % 2 === 0;
						const uatLine = flash
							? theme.fg("warning", theme.bold("⚠ AWAITING UAT APPROVAL — /pipeline-approve or /pipeline-reject"))
							: theme.fg("warning", "  AWAITING UAT APPROVAL — /pipeline-approve or /pipeline-reject");
						lines.push("", uatLine);
					} else if (uatState.scenarios.length > 0) {
						const p = uatState.scenarios.filter(s => s.result === "pass").length;
						const f = uatState.scenarios.filter(s => s.result === "fail").length;
						const pend = uatState.scenarios.filter(s => s.result === "pending").length;
						lines.push(theme.fg("dim", `  UAT: ${p} pass, ${f} fail, ${pend} pending`));
					}

					// Mode indicator
					lines.push("", theme.fg("dim", `Mode: ${pipelineMode === "fast" ? "Fast Track" : "3-Wave"}`));

					text.setText(lines.join("\n"));
					return text.render(width);
				},
				invalidate() { text.invalidate(); },
			};
		});
	}

	// ── Tmux Log Panes ──────────────────────────

	let watchPaneIds: string[] = [];
	const agentPanes = new Map<string, string>(); // agent role → pane ID
	let useTmuxPanes = true; // run agents interactively in tmux panes (watch-only, auto-closes)

	// ── Tmux column management ──
	// Each column is a vertical split to the right of the main window.
	// Max MAX_PANES_PER_COL vertical splits per column, up to MAX_COLUMNS columns.
	const MAX_COLUMNS = 5;
	const MAX_PANES_PER_COL = 4;
	const tmuxColumns: { columnPaneId: string; panes: string[] }[] = []; // tracks columns and their child panes

	function paneExists(paneId: string): boolean {
		try {
			execSync(`tmux display-message -p -t ${paneId} '#{pane_id}'`, { stdio: ["ignore", "pipe", "ignore"] });
			return true;
		} catch { return false; }
	}

	function cleanStalePanes(): void {
		watchPaneIds = watchPaneIds.filter(id => paneExists(id));
		for (const col of tmuxColumns) {
			col.panes = col.panes.filter(id => paneExists(id));
		}
		// Remove empty columns
		for (let i = tmuxColumns.length - 1; i >= 0; i--) {
			if (tmuxColumns[i].panes.length === 0 && !paneExists(tmuxColumns[i].columnPaneId)) {
				tmuxColumns.splice(i, 1);
			}
		}
	}

	function getActivePanesInColumn(col: { columnPaneId: string; panes: string[] }): number {
		return col.panes.filter(id => paneExists(id)).length;
	}

	function allocateTmuxPane(shellCmd: string, label: string): string | null {
		try {
			const piPaneId = execSync("tmux display-message -p '#{pane_id}'", { encoding: "utf-8" }).trim();
			cleanStalePanes();

			let splitCmd: string;

			// Find a column with room
			let targetCol = tmuxColumns.find(col => paneExists(col.columnPaneId) && getActivePanesInColumn(col) < MAX_PANES_PER_COL);

			if (!targetCol) {
				// Need a new column — horizontal split from main pane
				if (tmuxColumns.length >= MAX_COLUMNS) {
					// All columns full — reuse the column with the most closed panes
					cleanStalePanes();
					targetCol = tmuxColumns.find(col => paneExists(col.columnPaneId) && getActivePanesInColumn(col) < MAX_PANES_PER_COL);
					if (!targetCol) {
						// Truly full — fall back to last column, will be cramped
						targetCol = tmuxColumns[tmuxColumns.length - 1];
						if (!targetCol || !paneExists(targetCol.columnPaneId)) return null;
					}
				}

				if (!targetCol) {
					// Create new column (horizontal split right)
					const colWidth = Math.max(20, Math.round(80 / (tmuxColumns.length + 2)));
					splitCmd = `tmux split-window -h -l ${colWidth}% -P -F '#{pane_id}' "${shellCmd}"`;
					const newPaneId = execSync(splitCmd, { encoding: "utf-8" }).trim();
					const newCol = { columnPaneId: newPaneId, panes: [newPaneId] };
					tmuxColumns.push(newCol);
					watchPaneIds.push(newPaneId);
					execSync(`tmux select-pane -t ${piPaneId}`, { stdio: "ignore" });
					return newPaneId;
				}
			}

			// Split vertically within the target column
			const splitTarget = targetCol!.panes.length > 0
				? targetCol!.panes[targetCol!.panes.length - 1]
				: targetCol!.columnPaneId;
			const activePanes = getActivePanesInColumn(targetCol!);
			const splitPct = Math.max(20, Math.round(100 / (activePanes + 1)));

			splitCmd = `tmux split-window -v -t ${splitTarget} -l ${splitPct}% -P -F '#{pane_id}' "${shellCmd}"`;
			const newPaneId = execSync(splitCmd, { encoding: "utf-8" }).trim();
			targetCol!.panes.push(newPaneId);
			watchPaneIds.push(newPaneId);
			execSync(`tmux select-pane -t ${piPaneId}`, { stdio: "ignore" });
			return newPaneId;
		} catch {
			return null;
		}
	}

	function openTmuxTail(logPath: string, label: string, _ctx: ExtensionContext, role?: string): boolean {
		try {
			// If a pane for this role already exists, kill it first
			if (role) {
				const existingPane = agentPanes.get(role);
				if (existingPane) {
					try { execSync(`tmux kill-pane -t ${existingPane}`, { stdio: "ignore" }); } catch {}
					watchPaneIds = watchPaneIds.filter(id => id !== existingPane);
					agentPanes.delete(role);
				}
			}

			const filterScript = join(logDir, "json-filter.py");
			const shellCmd = `echo '── ${label} ──' && tail -f '${logPath}' | '${filterScript}'`;
			const paneId = allocateTmuxPane(shellCmd, label);
			if (!paneId) return false;
			if (role) agentPanes.set(role, paneId);
			return true;
		} catch {
			return false;
		}
	}

	function findLatestLog(agentName: string): string | null {
		if (!logDir || !existsSync(logDir)) return null;
		const logs = readdirSync(logDir)
			.filter(f => f.includes(agentName) && f.endsWith(".log"))
			.sort();
		return logs.length > 0 ? logs[logs.length - 1] : null;
	}

	// ── Commands ─────────────────────────────────

	pi.registerCommand("pipeline-start", {
		description: "Initialize pipeline: read checklist, show plan, create branch. Use --multiwave for 3-Wave mode.",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			// Detect --multiwave flag (fast track is default)
			const rawArgs = typeof _args === "string" ? _args : (_args?.join?.(" ") || "");
			const isMultiwave = rawArgs.includes("--multiwave");
			if (isMultiwave) {
				pipelineMode = "3wave";
				log(`[Mode] 3-Wave pipeline selected`);
			} else {
				pipelineMode = "fast";
			}

			const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
			if (!existsSync(checklistPath)) {
				ctx.ui.notify("No checklist found at features/00-IMPLEMENTATION-CHECKLIST.md\nRun /req-qa to generate one first.", "error");
				return;
			}

			parsedPhases = parseChecklist(checklistPath);
			if (parsedPhases.length === 0) {
				ctx.ui.notify("Checklist has no parseable phases/epics.", "error");
				return;
			}

			// Enrich task bodies from GitHub issue details (full acceptance criteria)
			ctx.ui.setStatus("pipeline", "Fetching task details from GitHub issues...");
			enrichTaskBodiesFromGitHub(parsedPhases, cwd);
			ctx.ui.setStatus("pipeline", "");

			// Find first phase with incomplete tasks
			let nextPhaseIdx = parsedPhases.findIndex(p => p.tasks.some(t => !t.done));
			if (nextPhaseIdx === -1) {
				ctx.ui.notify("All phases complete! Nothing left to build.", "success");
				return;
			}

			// Build summary
			const totalTasks = parsedPhases.reduce((n, p) => n + p.tasks.length, 0);
			const doneTasks = parsedPhases.reduce((n, p) => n + p.tasks.filter(t => t.done).length, 0);
			const nextPhase = parsedPhases[nextPhaseIdx];
			const pendingInPhase = nextPhase.tasks.filter(t => !t.done);

			const lines = [
				`Pipeline Plan (${isMultiwave ? "3-Wave" : "FAST TRACK"})`,
				`─────────────`,
				`Checklist: ${totalTasks} tasks across ${parsedPhases.length} epics (${doneTasks} done)`,
				``,
				`Next: ${nextPhase.name}`,
				`Tasks to build (${pendingInPhase.length}):`,
				...pendingInPhase.map(t => `  - ${t.id}: ${t.title}${t.issueNum ? ` (#${t.issueNum})` : ""}`),
				``,
				...(isMultiwave ? [
					`Council: 3 architects → consolidate spec`,
					`Wave 0: Prototype POC (${shortModelName(pipelineConfig.multiwave.proto1.model)} → ${shortModelName(pipelineConfig.multiwave.proto2.model)} → ${shortModelName(pipelineConfig.multiwave.proto3.model)}) → working prototype`,
					`Wave 1: Review prototype → place TODOs for gaps → compliance`,
					`Wave 2: Parallel dev sprint → compliance → targeted fixes`,
					`Gates: review → build/lint → test (max ${MAX_LOOPS} retries each)`,
					`Compliance threshold: ${COMPLIANCE_THRESHOLD}%`,
				] : [
					`Build: ${shortModelName(pipelineConfig.fast.build.model)} (entire epic at once)`,
					`Evaluate: ${shortModelName(pipelineConfig.fast.eval.model)} (per-task scoring)`,
					`Fix: ${shortModelName(pipelineConfig.fast.fix.model)} (subtask decomposition, up to ${MAX_SUBTASK_DEPTH} depths)${pipelineConfig.fast.fixEscalation.length > 0 ? ` → escalation: ${pipelineConfig.fast.fixEscalation.map(e => `${shortModelName(e.model)}:${e.thinking}`).join(" → ")}` : ""}`,
					`UAT: Scenario generation → Playwright execution → approval gate`,
					`Compliance threshold: ${COMPLIANCE_THRESHOLD}%`,
				]),
			];

			// Branch suggestion — each epic branches from current (chains off previous)
			const epicNum = nextPhase.name.match(/Epic (\d+)/)?.[1] || nextPhaseIdx + 1;
			const branchName = `feature/epic-${epicNum}-${nextPhase.name.replace(/^Epic \d+:\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

			const currentBranch = shellExec("git branch --show-current", cwd);
			const onMain = currentBranch.ok && (currentBranch.stdout === "main" || currentBranch.stdout === "master");
			const onFeature = currentBranch.ok && currentBranch.stdout.startsWith("feature/");

			if (onFeature) {
				lines.push(``, `Current branch: ${currentBranch.stdout}`, `New branch (from current): ${branchName}`);
			} else {
				lines.push(``, `Branch: ${branchName} (from ${currentBranch.stdout || "HEAD"})`);
			}

			ctx.ui.notify(lines.join("\n"), "info");

			// Confirm
			const proceed = await ctx.ui.confirm(
				"Start Pipeline",
				`Build ${pendingInPhase.length} tasks in ${nextPhase.name}?`,
			);
			if (!proceed) {
				ctx.ui.notify("Pipeline start cancelled.", "info");
				return;
			}

			// Create branch from current HEAD (chains epics together)
			ctx.ui.setStatus("pipeline", "Creating branch...");

			// Clean up stale worktrees and pipeline files from previous runs
			cleanupAllWorktrees();
			const stateFile = join(logDir, "pipeline-state.json");
			if (existsSync(stateFile)) {
				try { unlinkSync(stateFile); } catch {}
			}

			const branchExists = shellExec(`git rev-parse --verify '${branchName}'`, cwd);
			if (branchExists.ok) {
				const checkout = shellExec(`git checkout '${branchName}'`, cwd);
				if (checkout.ok) {
					pipeline.branch = branchName;
					ctx.ui.notify(`Switched to existing branch: ${branchName}`, "success");
				} else {
					ctx.ui.notify(`Failed to checkout branch: ${checkout.stderr}`, "error");
					ctx.ui.setStatus("pipeline", "");
					return;
				}
			} else {
				// Commit any pending changes before branching
				shellExec(`git -C '${cwd}' add -A`, cwd);
				const hasPending = shellExec(`git -C '${cwd}' diff --cached --quiet`, cwd);
				if (!hasPending.ok) {
					shellExec(`git -C '${cwd}' commit -m "WIP: pre-branch checkpoint"`, cwd);
				}

				const branchResult = shellExec(`git checkout -b '${branchName}'`, cwd);
				if (branchResult.ok) {
					pipeline.branch = branchName;
					ctx.ui.notify(`Created branch: ${branchName} (from ${currentBranch.stdout || "HEAD"})`, "success");
				} else {
					ctx.ui.notify(`Failed to create branch: ${branchResult.stderr}`, "error");
					ctx.ui.setStatus("pipeline", "");
					return;
				}
			}
			ctx.ui.setStatus("pipeline", "");

			pipeline.currentPhase = nextPhaseIdx;
			pipeline.phases = parsedPhases.map(p => p.name);
			updateWidget();

			ctx.ui.notify(
				`Pipeline initialized. Starting first phase...\n` +
				`Use /pipeline-logs to open agent logs in tmux.`,
				"success",
			);

			// Auto-chain into running the first phase
			if (pipelineMode === "fast") {
				await runNextPhaseFast(ctx);
			} else {
				await runNextPhase(ctx);
			}
		},
	});

	function createEpicBranch(phase: any, ctx: any): boolean {
		const epicNum = phase.name.match(/Epic (\d+)/)?.[1] || "0";
		const branchName = `feature/epic-${epicNum}-${phase.name.replace(/^Epic \d+:\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`;

		// Commit any pending changes before branching
		shellExec(`git -C '${cwd}' add -A`, cwd);
		const hasPending = shellExec(`git -C '${cwd}' diff --cached --quiet`, cwd);
		if (!hasPending.ok) {
			shellExec(`git -C '${cwd}' commit -m "WIP: pre-branch checkpoint"`, cwd);
		}

		// Clean up stale worktrees and pipeline files
		cleanupAllWorktrees();
		const stateFile = join(logDir, "pipeline-state.json");
		if (existsSync(stateFile)) {
			try { unlinkSync(stateFile); } catch {}
		}

		const branchExists = shellExec(`git rev-parse --verify '${branchName}'`, cwd);
		if (branchExists.ok) {
			const checkout = shellExec(`git checkout '${branchName}'`, cwd);
			if (checkout.ok) {
				pipeline.branch = branchName;
				log(`[Auto-chain] Switched to existing branch: ${branchName}`);
				return true;
			}
			log(`[Auto-chain] Failed to checkout branch: ${checkout.stderr}`);
			return false;
		}

		const branchResult = shellExec(`git checkout -b '${branchName}'`, cwd);
		if (branchResult.ok) {
			pipeline.branch = branchName;
			log(`[Auto-chain] Created branch: ${branchName}`);
			return true;
		}
		log(`[Auto-chain] Failed to create branch: ${branchResult.stderr}`);
		return false;
	}

	async function runNextPhase(ctx: any) {
		if (pipeline.running) {
			ctx.ui.notify("Pipeline is already running.", "warning");
			return;
		}

		if (pipeline.currentPhase < 0 || parsedPhases.length === 0) {
			ctx.ui.notify("Run /pipeline-start first to initialize.", "warning");
			return;
		}

		// Check for checkpoint — auto-resume without prompting
		const checkpoint = loadCheckpoint();
		if (checkpoint && checkpoint.phaseIdx < parsedPhases.length) {
			const cpPhase = parsedPhases[checkpoint.phaseIdx];
			if (cpPhase && cpPhase.name === checkpoint.phaseName) {
				pipeline.currentPhase = checkpoint.phaseIdx;
				if (checkpoint.branch) pipeline.branch = checkpoint.branch;
				updateWidget();
				log(`[Auto-chain] Resuming ${cpPhase.name} from "${checkpoint.completedGate}"`);
				ctx.ui.notify(`Resuming: ${cpPhase.name} from "${checkpoint.completedGate}"`, "info");
			}
		}

		// ── Auto-chain loop: run all remaining epics sequentially ──
		while (true) {
			// Find next phase with work
			let phaseIdx = pipeline.currentPhase;
			while (phaseIdx < parsedPhases.length && parsedPhases[phaseIdx].tasks.every(t => t.done)) {
				phaseIdx++;
			}

			if (phaseIdx >= parsedPhases.length) {
				ctx.ui.notify(
					"All phases complete! Ready for UAT.\n" +
					"Review the implementation and run your acceptance tests.",
					"success",
				);
				return;
			}

			pipeline.currentPhase = phaseIdx;
			updateWidget();

			const phase = parsedPhases[phaseIdx];

			// Auto-create branch for this epic if we're not already on it
			const currentBranch = shellExec("git branch --show-current", cwd);
			const expectedEpicNum = phase.name.match(/Epic (\d+)/)?.[1];
			const alreadyOnBranch = currentBranch.ok && expectedEpicNum && currentBranch.stdout.includes(`epic-${expectedEpicNum}`);

			if (!alreadyOnBranch) {
				// Reset tmux state between epics — kill stale panes, clear tracking
				for (const paneId of watchPaneIds) {
					try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
				}
				watchPaneIds = [];
				tmuxColumns.length = 0;
				agentPanes.clear();

				log(`[Auto-chain] Creating branch for ${phase.name}...`);
				ctx.ui.notify(`Auto-chaining: creating branch for ${phase.name}...`, "info");
				if (!createEpicBranch(phase, ctx)) {
					ctx.ui.notify(`Failed to create branch for ${phase.name}. Stopping.`, "error");
					return;
				}
			}

			ctx.ui.notify(`Starting: ${phase.name} (${phase.tasks.filter(t => !t.done).length} tasks)`, "info");

			const result = await runPhase(phaseIdx, ctx);
			ctx.ui.notify(result.summary, result.success ? "success" : "error");

			if (!result.success) {
				log(`[Auto-chain] HALTED: ${phase.name} failed. Not advancing to next epic.`);
				ctx.ui.notify(`Pipeline halted: ${phase.name} failed. Fix issues and run /pipeline-next to retry.`, "error");
				return;
			}

			// Advance to next phase
			pipeline.currentPhase = phaseIdx + 1;
			updateWidget();

			// Brief pause between epics
			const remaining = parsedPhases.slice(phaseIdx + 1).filter(p => p.tasks.some(t => !t.done));
			if (remaining.length > 0) {
				log(`[Auto-chain] ${phase.name} done. ${remaining.length} epic(s) remaining — continuing in 5s...`);
				ctx.ui.notify(`${phase.name} complete. Auto-chaining to next epic in 5s... (${remaining.length} remaining)`, "info");
				await new Promise(r => setTimeout(r, 5000));
			}
			// Loop continues to next epic automatically
		}
	}

	pi.registerCommand("pipeline-next", {
		description: "Run the next phase: dev loop + quality gates",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			if (pipelineMode === "fast") {
				await runNextPhaseFast(ctx);
			} else {
				await runNextPhase(ctx);
			}
		},
	});

	pi.registerCommand("pipeline-status", {
		description: "Show current pipeline execution status",
		handler: async (_args, ctx) => {
			if (parsedPhases.length === 0) {
				ctx.ui.notify("No pipeline initialized. Run /pipeline-start first.", "info");
				return;
			}

			const lines: string[] = [];
			for (let i = 0; i < parsedPhases.length; i++) {
				const phase = parsedPhases[i];
				const ps = pipeline.phaseStates.get(phase.name);
				const done = phase.tasks.filter(t => t.done).length;
				const total = phase.tasks.length;
				const isCurrent = i === pipeline.currentPhase;

				const icon = done === total ? "✓"
					: ps?.gate === "error" ? "✗"
					: isCurrent && pipeline.running ? "●"
					: "○";

				const gate = ps ? ` [${ps.gate}${ps.elapsed ? ` ${Math.round(ps.elapsed / 1000)}s` : ""}]` : "";
				lines.push(`${icon} ${i + 1}. ${phase.name} (${done}/${total})${gate}`);

				if (ps) {
					for (const t of ps.tasks) {
						const tIcon = t.status === "passed" ? "✓" : t.status === "failed" ? "✗" : "○";
						const score = t.complianceScore > 0 ? ` ${t.complianceScore}%` : "";
						lines.push(`  ${tIcon} ${t.id}: ${t.title}${score}`);
					}
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("pipeline-logs", {
		description: "Open latest log for every pipeline agent in tmux panes to the right",
		handler: async (_args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux.", "warning");
				return;
			}
			if (!logDir || !existsSync(logDir)) {
				ctx.ui.notify("No logs yet. Run /pipeline-next first.", "info");
				return;
			}

			for (const paneId of watchPaneIds) {
				try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
			}
			watchPaneIds = [];

			let opened = 0;
			const status: string[] = [];
			const agentNames = ["dev", "compliance", "reviewer", "lint-build", "tester"];

			for (const name of agentNames) {
				const latest = findLatestLog(name);
				if (latest) {
					if (openTmuxTail(join(logDir, latest), displayName(name), ctx)) {
						opened++;
						status.push(`  + ${displayName(name)} -> ${latest}`);
					}
				}
			}

			ctx.ui.notify(
				opened > 0
					? `Opened ${opened} pane${opened !== 1 ? "s" : ""}:\n\n${status.join("\n")}`
					: "No logs yet.",
				opened > 0 ? "success" : "info",
			);
		},
	});

	pi.registerCommand("pipeline-watch", {
		description: "Open a tmux pane tailing a specific agent's log",
		handler: async (args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux.", "warning");
				return;
			}

			let target = activeLogFile;

			if (args && args.trim()) {
				const latest = findLatestLog(args.trim().toLowerCase());
				if (latest) {
					target = join(logDir, latest);
				} else {
					ctx.ui.notify(`No log matching "${args}".`, "warning");
					return;
				}
			}

			if (!target) {
				ctx.ui.notify("No active agent log. Specify: /pipeline-watch dev", "info");
				return;
			}

			const label = target.split("/").pop()?.replace(".log", "") || "agent";
			if (openTmuxTail(target, label, ctx)) {
				ctx.ui.notify(`Watching: ${label}`, "success");
			}
		},
	});

	let dashboardPaneId = "";

	pi.registerCommand("pipeline-dashboard", {
		description: "Open live dashboard in a tmux pane",
		handler: async (_args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify(`Not in tmux. Run directly:\n  ~/.pi-init/bin/pipeline-dashboard '${cwd}'`, "info");
				return;
			}
			if (dashboardPaneId) {
				try { execSync(`tmux kill-pane -t ${dashboardPaneId}`, { stdio: "ignore" }); } catch {}
				dashboardPaneId = "";
			}
			try {
				const piPaneId = execSync("tmux display-message -p '#{pane_id}'", { encoding: "utf-8" }).trim();
				const paneId = execSync(
					`tmux split-window -h -l 45% -P -F '#{pane_id}' "~/.pi-init/bin/pipeline-dashboard '${cwd}'"`,
					{ encoding: "utf-8" },
				).trim();
				dashboardPaneId = paneId;
				execSync(`tmux select-pane -t ${piPaneId}`, { stdio: "ignore" });
				ctx.ui.notify("Dashboard opened.", "success");
			} catch (err: any) {
				ctx.ui.notify(`Failed: ${err.message}`, "error");
			}
		},
	});

	pi.registerCommand("pipeline-close-panes", {
		description: "Close all pipeline watch panes",
		handler: async (_args, ctx) => {
			let closed = 0;
			for (const paneId of watchPaneIds) {
				try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); closed++; } catch {}
			}
			watchPaneIds = [];
			tmuxColumns.length = 0;
			agentPanes.clear();
			if (dashboardPaneId) {
				try { execSync(`tmux kill-pane -t ${dashboardPaneId}`, { stdio: "ignore" }); closed++; } catch {}
				dashboardPaneId = "";
			}
			ctx.ui.notify(closed > 0 ? `Closed ${closed} pane${closed !== 1 ? "s" : ""}.` : "No panes open.", "info");
		},
	});

	// ── Pipeline Reset ───────────────────────────

	pi.registerCommand("pipeline-reset", {
		description: "Full reset: checkout main, delete feature branches, uncheck checklist, reopen GitHub issues",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			if (pipeline.running) {
				ctx.ui.notify("Pipeline is running. Wait for it to finish first.", "warning");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Pipeline Reset",
				"This will:\n" +
				"- Checkout main/master\n" +
				"- Delete ALL feature/* and epic-* branches\n" +
				"- Uncheck ALL items in the checklist\n" +
				"- Reopen ALL GitHub issues (tasks + epics + UAT)\n" +
				"- Clear pipeline state and logs\n\n" +
				"This is IRREVERSIBLE. Continue?",
			);
			if (!confirm) {
				ctx.ui.notify("Reset cancelled.", "info");
				return;
			}

			ctx.ui.setStatus("pipeline", "Resetting pipeline...");
			log(`[RESET] Starting full pipeline reset...`);

			// ── 1. Git: checkout main, delete feature branches ──
			const defaultBranch = shellExec("git rev-parse --verify main", cwd).ok ? "main" : "master";

			// Stash any uncommitted changes
			shellExec(`git stash --include-untracked`, cwd);

			// Checkout default branch
			const checkout = shellExec(`git checkout ${defaultBranch}`, cwd);
			if (!checkout.ok) {
				ctx.ui.notify(`Failed to checkout ${defaultBranch}: ${checkout.stderr}`, "error");
				ctx.ui.setStatus("pipeline", "");
				return;
			}
			log(`[RESET] Checked out ${defaultBranch}`);

			// Clean up worktrees first
			cleanupAllWorktrees();

			// Delete all feature/* branches
			const branches = shellExec(`git branch --list "feature/*" "epic-*"`, cwd);
			if (branches.ok && branches.stdout) {
				const branchNames = branches.stdout.split("\n").map(b => b.trim().replace(/^\* /, "")).filter(Boolean);
				let deleted = 0;
				for (const branch of branchNames) {
					if (branch === defaultBranch) continue;
					const del = shellExec(`git branch -D "${branch}"`, cwd);
					if (del.ok) deleted++;
					else log(`[RESET] Failed to delete branch ${branch}: ${del.stderr}`);
				}
				log(`[RESET] Deleted ${deleted} branch(es)`);
			}

			// ── 2. Checklist: uncheck all items ──
			const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
			if (existsSync(checklistPath)) {
				let checklist = readFileSync(checklistPath, "utf-8");
				checklist = checklist.replace(/- \[x\]/g, "- [ ]");
				writeFileSync(checklistPath, checklist, "utf-8");
				log(`[RESET] Checklist: all items unchecked`);
			}

			// ── 3. GitHub: reopen all task/epic/UAT issues ──
			ctx.ui.setStatus("pipeline", "Reopening GitHub issues...");

			// Re-parse checklist to get issue numbers
			if (existsSync(checklistPath)) {
				parsedPhases = parseChecklist(checklistPath);
			}

			let reopened = 0;
			const issueNums: number[] = [];

			for (const phase of parsedPhases) {
				for (const task of phase.tasks) {
					if (task.issueNum) issueNums.push(task.issueNum);
				}
			}

			// Also find epic-level issues and UAT issues
			const closedIssues = shellExec(
				`gh issue list --state closed --label "uat,uat-pass,uat-fail" --json number -q '.[].number' --limit 200`,
				cwd,
			);
			if (closedIssues.ok && closedIssues.stdout) {
				for (const num of closedIssues.stdout.split("\n").filter(Boolean)) {
					const n = parseInt(num, 10);
					if (!isNaN(n) && !issueNums.includes(n)) issueNums.push(n);
				}
			}

			for (const num of issueNums) {
				const reopen = shellExec(`gh issue reopen ${num}`, cwd);
				if (reopen.ok) reopened++;
			}
			log(`[RESET] Reopened ${reopened} GitHub issue(s)`);

			// Remove UAT labels from all scenarios
			for (const scenario of uatState.scenarios) {
				if (scenario.issueNum) {
					shellExec(`gh issue edit ${scenario.issueNum} --add-label "uat-pending" --remove-label "uat-pass,uat-fail"`, cwd);
				}
			}

			// ── 4. Clear pipeline state ──
			pipeline = {
				phases: [],
				currentPhase: -1,
				phaseStates: new Map(),
				branch: "",
				running: false,
			};
			parsedPhases = [];
			pipelineLog = [];
			pipelineMode = "fast";
			uatState = { scenarios: [], awaitingApproval: false, approved: false };

			// Clear state files
			if (logDir) {
				const stateFile = join(logDir, "pipeline-state.json");
				if (existsSync(stateFile)) try { unlinkSync(stateFile); } catch {}
				const cpFile = join(logDir, "checkpoint.json");
				if (existsSync(cpFile)) try { unlinkSync(cpFile); } catch {}
			}

			// Kill any tmux panes
			for (const paneId of watchPaneIds) {
				try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
			}
			watchPaneIds = [];
			tmuxColumns.length = 0;
			agentPanes.clear();

			updateWidget();
			ctx.ui.setStatus("pipeline", "");

			ctx.ui.notify(
				[
					`Pipeline Reset Complete`,
					`───────────────────────`,
					`Branch: ${defaultBranch}`,
					`Feature branches: deleted`,
					`Checklist: all items unchecked`,
					`GitHub issues: ${reopened} reopened`,
					`Pipeline state: cleared`,
					``,
					`Ready for a fresh run with /pipeline-start`,
				].join("\n"),
				"success",
			);
			log(`[RESET] Complete`);
		},
	});

	// ── Pipeline Config Command ──────────────────

	pi.registerCommand("pipeline-config", {
		description: "Configure model assignments for Fast Track and 3-Wave pipeline modes",
		handler: async (_args, ctx) => {
			if (pipeline.running) {
				ctx.ui.notify("Pipeline is running. Stop it first before changing config.", "warning");
				return;
			}

			const config = loadPipelineConfig();
			const allModels = ctx.modelRegistry.getAll();
			const availableSet = new Set(ctx.modelRegistry.getAvailable().map(m => `${m.provider}/${m.id}`));

			function buildModelItems(onlyAvailable: boolean): SelectItem[] {
				return allModels
					.filter(m => !onlyAvailable || availableSet.has(`${m.provider}/${m.id}`))
					.map(m => ({
						value: `${m.provider}/${m.id}`,
						label: `  ${m.provider}/${m.id}`,
						description: m.name,
					}))
					.sort((a, b) => a.value.localeCompare(b.value));
			}

			type ConfigTab = "fast" | "multiwave";
			let activeTab: ConfigTab = pipelineMode === "fast" ? "fast" : "multiwave";

			const fastRoles: { id: string; label: string; description: string; key: keyof PipelineModelConfig["fast"] }[] = [
				{ id: "fast.build", label: "Builder", description: "Builds the entire epic in one shot", key: "build" },
				{ id: "fast.eval", label: "Evaluator", description: "Scores each task against acceptance criteria", key: "eval" },
				{ id: "fast.fix", label: "Fixer", description: "Surgical subtask fixes for failed tasks", key: "fix" },
				{ id: "fast.uat", label: "UAT Tester", description: "Runs Playwright browser automation for UAT scenarios", key: "uat" },
			];

			const multiwaveRoles: { id: string; label: string; description: string; key: keyof PipelineModelConfig["multiwave"] }[] = [
				{ id: "mw.council1", label: "Council Architect 1", description: "First independent design brief", key: "council1" },
				{ id: "mw.council2", label: "Council Architect 2", description: "Second independent design brief", key: "council2" },
				{ id: "mw.council3", label: "Council Architect 3", description: "Third independent design brief", key: "council3" },
				{ id: "mw.proto1", label: "Prototype Step 1", description: "Full one-shot build from spec", key: "proto1" },
				{ id: "mw.proto2", label: "Prototype Step 2", description: "Enhancement pass", key: "proto2" },
				{ id: "mw.proto3", label: "Prototype Step 3", description: "Fine-tuning pass", key: "proto3" },
				{ id: "mw.dev", label: "Dev Agent", description: "Task implementation in Wave 2 sprint", key: "dev" },
				{ id: "mw.compliance", label: "Compliance", description: "Per-task compliance scoring", key: "compliance" },
				{ id: "mw.orchestrator", label: "Orchestrator", description: "Reviews pedantic deductions, overrides scores", key: "orchestrator" },
			];

			function buildModelSubmenu(currentModelId: string, done: (selectedValue?: string) => void) {
				const listTheme: SelectListTheme = {
					selectedPrefix: (t: string) => ctx.ui.theme.fg("accent", t),
					selectedText: (t: string) => ctx.ui.theme.fg("accent", ctx.ui.theme.bold(t)),
					description: (t: string) => ctx.ui.theme.fg("dim", t),
					scrollInfo: (t: string) => ctx.ui.theme.fg("dim", t),
					noMatch: (t: string) => ctx.ui.theme.fg("warning", t),
				};

				let modelTab: "available" | "all" = "available";
				let searchText = "";
				let items = buildModelItems(true);
				let list = new SelectList(items, 20, listTheme);
				const currentIdx = items.findIndex(m => m.value === currentModelId);
				if (currentIdx >= 0) list.setSelectedIndex(currentIdx);

				function applyFilter() {
					if (searchText) list.setFilter(searchText);
					else {
						// Reset filter by rebuilding
						const newItems = buildModelItems(modelTab === "available");
						items = newItems;
						list = new SelectList(items, 20, listTheme);
						const idx = items.findIndex(m => m.value === currentModelId);
						if (idx >= 0) list.setSelectedIndex(idx);
						list.onSelect = onSelect;
						list.onCancel = () => { done(undefined); };
					}
				}

				function rebuildList() {
					items = buildModelItems(modelTab === "available");
					list = new SelectList(items, 20, listTheme);
					if (searchText) list.setFilter(searchText);
					else {
						const idx = items.findIndex(m => m.value === currentModelId);
						if (idx >= 0) list.setSelectedIndex(idx);
					}
					list.onSelect = onSelect;
					list.onCancel = () => { done(undefined); };
				}

				function renderTabBar(): string {
					const avCount = buildModelItems(true).length;
					const allCount = buildModelItems(false).length;
					const avLabel = modelTab === "available"
						? ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`[Available (${avCount})]`))
						: ctx.ui.theme.fg("dim", ` Available (${avCount}) `);
					const allLabel = modelTab === "all"
						? ctx.ui.theme.fg("accent", ctx.ui.theme.bold(`[All (${allCount})]`))
						: ctx.ui.theme.fg("dim", ` All (${allCount}) `);
					return `  ${avLabel}  ${allLabel}    ${ctx.ui.theme.fg("dim", "Tab to switch")}`;
				}

				const normalRender = (width: number): string[] => {
					const border = ctx.ui.theme.fg("dim", "─".repeat(width));
					const lines: string[] = [];
					lines.push(border);
					lines.push("");
					lines.push(ctx.ui.theme.fg("accent", ctx.ui.theme.bold("  Select Model")));
					lines.push(ctx.ui.theme.fg("dim", `  Current: ${shortModelName(currentModelId)}`));
					lines.push("");
					lines.push(renderTabBar());
					if (searchText) {
						lines.push(ctx.ui.theme.fg("accent", `  Search: ${searchText}█`));
					} else {
						lines.push(ctx.ui.theme.fg("dim", `  Type to search...`));
					}
					lines.push("");
					lines.push(border);
					lines.push("");
					lines.push(...list.render(width));
					lines.push("");
					lines.push(ctx.ui.theme.fg("dim", "  Type to filter · Enter to select · Tab to switch · Esc to cancel"));
					lines.push(border);
					return lines;
				};

				const normalInput = (data: string) => {
					if (data === "\t") {
						modelTab = modelTab === "available" ? "all" : "available";
						rebuildList();
						wrapper.invalidate();
						return;
					}
					// Backspace: remove last char from search
					if (data === "\x7f" || data === "\b") {
						if (searchText.length > 0) {
							searchText = searchText.slice(0, -1);
							applyFilter();
							wrapper.invalidate();
						}
						return;
					}
					// Printable characters: add to search filter
					if (data.length === 1 && data >= " " && data <= "~" && data !== "\r" && data !== "\n") {
						searchText += data;
						applyFilter();
						wrapper.invalidate();
						return;
					}
					list.handleInput(data);
				};

				const wrapper: any = {
					invalidate() { list.invalidate(); },
					render: normalRender,
					handleInput: normalInput,
				};

				const onSelect = (item: SelectItem) => {
					const selectedModel = item.value;
					wrapper.render = (_width: number): string[] => {
						const lines: string[] = [];
						lines.push(ctx.ui.theme.fg("accent", ctx.ui.theme.bold("  Select Model")));
						lines.push("");
						lines.push(ctx.ui.theme.fg("warning", `  Pinging ${shortModelName(selectedModel)}...`));
						return lines;
					};
					wrapper.invalidate();

					setTimeout(() => {
						const ok = pingModel(selectedModel);
						if (ok) {
							done(selectedModel);
						} else {
							wrapper.render = (_width: number): string[] => {
								const lines: string[] = [];
								lines.push(ctx.ui.theme.fg("accent", ctx.ui.theme.bold("  Select Model")));
								lines.push("");
								lines.push(ctx.ui.theme.fg("error", `  ${shortModelName(selectedModel)} failed ping test`));
								lines.push(ctx.ui.theme.fg("dim", "  Press any key to go back"));
								return lines;
							};
							wrapper.invalidate();
							wrapper.handleInput = (_data: string) => {
								wrapper.render = normalRender;
								wrapper.handleInput = normalInput;
								wrapper.invalidate();
							};
						}
					}, 50);
				};

				list.onSelect = onSelect;
				list.onCancel = () => { done(undefined); };

				return wrapper;
			}

			function formatRoleValue(role: RoleConfig): string {
				return `${shortModelName(role.model)} · ${role.thinking}`;
			}

			function cycleThinking(role: RoleConfig): void {
				const idx = THINKING_LEVELS.indexOf(role.thinking);
				role.thinking = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
			}

			function getSettingItems(): SettingItem[] {
				const tabHeader: SettingItem = {
					id: "__tab",
					label: activeTab === "fast" ? "[Fast Track]  3-Wave" : " Fast Track  [3-Wave]",
					currentValue: "Tab/← → to switch",
					description: "Switch between pipeline mode configurations",
				};

				if (activeTab === "fast") {
					const items: SettingItem[] = [tabHeader];
					for (const r of fastRoles) {
						items.push({
							id: r.id,
							label: r.label,
							currentValue: formatRoleValue(config.fast[r.key]),
							description: `${r.description} · Space to cycle thinking`,
							submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
								const fullId = config.fast[r.key].model;
								return buildModelSubmenu(fullId, done);
							},
						});
						// After "fix", insert escalation entries
						if (r.key === "fix") {
							for (let i = 0; i < config.fast.fixEscalation.length; i++) {
								const esc = config.fast.fixEscalation[i];
								items.push({
									id: `fast.esc.${i}`,
									label: `  ↳ Escalation ${i + 1}`,
									currentValue: formatRoleValue(esc),
									description: `Depth ${i + 2} fix · Space to cycle thinking · Del to remove`,
									submenu: (_currentValue: string, done: (selectedValue?: string) => void) => {
										return buildModelSubmenu(esc.model, done);
									},
								});
							}
							items.push({
								id: "__add_esc",
								label: "  ↳ + Add escalation step",
								currentValue: "",
								description: "Add another escalation depth with a stronger model",
							});
						}
					}
					return items;
				} else {
					return [
						tabHeader,
						...multiwaveRoles.map(r => ({
							id: r.id,
							label: r.label,
							currentValue: formatRoleValue(config.multiwave[r.key]),
							description: `${r.description} · Space to cycle thinking`,
							submenu: (currentValue: string, done: (selectedValue?: string) => void) => {
								const fullId = config.multiwave[r.key].model;
								return buildModelSubmenu(fullId, done);
							},
						})),
					];
				}
			}

			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const settingsTheme: SettingsListTheme = {
					label: (text: string, selected: boolean) => selected ? theme.fg("accent", theme.bold(text)) : text,
					value: (text: string, selected: boolean) => selected ? theme.fg("success", text) : theme.fg("dim", text),
					description: (text: string) => theme.fg("dim", text),
					cursor: theme.fg("accent", "→ "),
					hint: (text: string) => theme.fg("dim", text),
				};

			function saveAndReload() {
					savePipelineConfig(config);
					pipelineConfig = config;
					FAST_BUILD_MODEL = config.fast.build.model;
					FAST_EVAL_MODEL = config.fast.eval.model;
					FAST_FIX_MODEL = config.fast.fix.model;
				}

				let items = getSettingItems();
				const settingsList = new SettingsList(
					items,
					16,
					settingsTheme,
					(id: string, newValue: string) => {
						if (id.startsWith("fast.esc.")) {
							const escIdx = parseInt(id.slice(9), 10);
							if (config.fast.fixEscalation[escIdx]) config.fast.fixEscalation[escIdx].model = newValue;
						} else if (id.startsWith("fast.")) {
							const key = id.slice(5) as keyof PipelineModelConfig["fast"];
							if (key !== "fixEscalation") (config.fast[key] as RoleConfig).model = newValue;
						} else if (id.startsWith("mw.")) {
							const key = id.slice(3) as keyof PipelineModelConfig["multiwave"];
							config.multiwave[key].model = newValue;
						}
						saveAndReload();
					},
					() => { done(); }, // Esc exits
				);

				const origHandleInput = settingsList.handleInput.bind(settingsList);

				const component = {
					dispose() {},
					invalidate() { settingsList.invalidate(); },
					render(width: number): string[] {
						const border = theme.fg("dim", "─".repeat(width));
						const lines: string[] = [];
						lines.push(border);
						lines.push("");
						lines.push(theme.fg("accent", theme.bold("  Pipeline Configuration")));
						lines.push(theme.fg("dim", "  Model assignments for each pipeline role"));
						lines.push("");
						lines.push(border);
						lines.push("");
						lines.push(...settingsList.render(width));
						lines.push("");
						lines.push(theme.fg("dim", "  Enter: change model · Space: cycle thinking · Del: remove escalation · Esc: close"));
						lines.push(border);
						return lines;
					},
					handleInput(data: string) {
						const kb = getEditorKeybindings();
						const selected = items[(settingsList as any).selectedIndex];
						// Tab header: switch pipeline mode tabs
						if (selected?.id === "__tab" && (data === "\t" || kb.matches(data, "selectConfirm") || data === " ")) {
							activeTab = activeTab === "fast" ? "multiwave" : "fast";
							items = getSettingItems();
							(settingsList as any).items = items;
							(settingsList as any).filteredItems = items;
							(settingsList as any).selectedIndex = 0;
							settingsList.invalidate();
							return;
						}
						// Enter on __add_esc: add a new escalation step
						if (selected?.id === "__add_esc" && kb.matches(data, "selectConfirm")) {
							const lastEsc = config.fast.fixEscalation.length > 0
								? config.fast.fixEscalation[config.fast.fixEscalation.length - 1]
								: config.fast.fix;
							config.fast.fixEscalation.push({ model: lastEsc.model, thinking: lastEsc.thinking });
							saveAndReload();
							const idx = (settingsList as any).selectedIndex;
							items = getSettingItems();
							(settingsList as any).items = items;
							(settingsList as any).filteredItems = items;
							(settingsList as any).selectedIndex = idx;
							settingsList.invalidate();
							return;
						}
						// Delete/Backspace on fast.esc.N: remove that escalation step
						if (selected?.id.startsWith("fast.esc.") && (data === "\x7f" || data === "\b" || data === "\x1b[3~")) {
							const escIdx = parseInt(selected.id.slice(9), 10);
							config.fast.fixEscalation.splice(escIdx, 1);
							saveAndReload();
							const idx = Math.min((settingsList as any).selectedIndex, 0);
							items = getSettingItems();
							(settingsList as any).items = items;
							(settingsList as any).filteredItems = items;
							(settingsList as any).selectedIndex = Math.min(idx, items.length - 1);
							settingsList.invalidate();
							return;
						}
						// Space on a role item: cycle thinking level
						if (selected && selected.id !== "__tab" && selected.id !== "__add_esc" && data === " ") {
							if (selected.id.startsWith("fast.esc.")) {
								const escIdx = parseInt(selected.id.slice(9), 10);
								if (config.fast.fixEscalation[escIdx]) cycleThinking(config.fast.fixEscalation[escIdx]);
							} else if (selected.id.startsWith("fast.")) {
								const key = selected.id.slice(5) as keyof PipelineModelConfig["fast"];
								if (key !== "fixEscalation") cycleThinking(config.fast[key] as RoleConfig);
							} else if (selected.id.startsWith("mw.")) {
								const key = selected.id.slice(3) as keyof PipelineModelConfig["multiwave"];
								cycleThinking(config.multiwave[key]);
							}
							saveAndReload();
							items = getSettingItems();
							const idx = (settingsList as any).selectedIndex;
							(settingsList as any).items = items;
							(settingsList as any).filteredItems = items;
							(settingsList as any).selectedIndex = idx;
							settingsList.invalidate();
							return;
						}
						origHandleInput(data);
					},
				};

				return component;
			});

			updateWidget();
		},
	});

	// ── UAT Approval Commands ────────────────────

	pi.registerCommand("pipeline-approve", {
		description: "Approve UAT results, close UAT epic, proceed to merge",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			if (!uatState.awaitingApproval) {
				ctx.ui.notify("No UAT awaiting approval. Run the pipeline first.", "warning");
				return;
			}

			uatState.approved = true;
			uatState.awaitingApproval = false;
			updateWidget();

			// Close UAT epic on GitHub
			if (uatState.epicIssueNum) {
				shellExec(`gh issue close ${uatState.epicIssueNum} --comment "UAT approved by user."`, cwd);
				log(`[UAT] Closed UAT epic #${uatState.epicIssueNum}`);
			}

			// Close all passed scenario issues
			for (const scenario of uatState.scenarios) {
				if (scenario.result === "pass" && scenario.issueNum) {
					shellExec(`gh issue close ${scenario.issueNum}`, cwd);
				}
			}

			const passed = uatState.scenarios.filter(s => s.result === "pass").length;
			const total = uatState.scenarios.length;

			ctx.ui.notify(
				[
					`UAT Approved`,
					`────────────`,
					`${passed}/${total} scenarios passed`,
					`UAT epic closed.`,
					``,
					`Run /pipeline-end to squash merge and push.`,
				].join("\n"),
				"success",
			);
			log(`[UAT] Approved by user. ${passed}/${total} passed.`);
		},
	});

	pi.registerCommand("pipeline-reject", {
		description: "Reject UAT results with notes, loop back for fixes",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			if (!uatState.awaitingApproval) {
				ctx.ui.notify("No UAT awaiting approval.", "warning");
				return;
			}

			// Prompt for rejection notes
			const notes = await ctx.ui.input("Rejection Notes", "Describe what needs to be fixed:");
			if (!notes) {
				ctx.ui.notify("Rejection cancelled (no notes provided).", "info");
				return;
			}

			uatState.rejectionNotes = notes;
			uatState.awaitingApproval = false;
			updateWidget();

			// Post rejection notes to failed scenario issues
			const failedScenarios = uatState.scenarios.filter(s => s.result === "fail");
			for (const scenario of failedScenarios) {
				if (scenario.issueNum) {
					shellExec(`gh issue comment ${scenario.issueNum} --body "**UAT Rejected**\n\n${notes.replace(/"/g, '\\"')}"`, cwd);
					// Reset to pending for re-run
					scenario.result = "pending";
					shellExec(`gh issue edit ${scenario.issueNum} --add-label "uat-pending" --remove-label "uat-fail"`, cwd);
				}
			}

			// Add rejection notes to the task bodies for the builder
			log(`[UAT] Rejected. Notes: ${notes}`);
			ctx.ui.notify(
				[
					`UAT Rejected`,
					`────────────`,
					`Notes: ${notes}`,
					``,
					`${failedScenarios.length} failed scenario(s) updated with rejection notes.`,
					`Run /pipeline-next to re-build and re-test.`,
				].join("\n"),
				"warning",
			);
		},
	});

	// ── End Session ──────────────────────────────

	pi.registerCommand("pipeline-end", {
		description: "End session: confirm UAT, check off completed items, squash merge to main, push, clean up",
		handler: async (_args, ctx) => {
			if (isObserverBlocked(ctx)) return;
			if (pipeline.running) {
				ctx.ui.notify("Pipeline is still running. Wait for it to finish.", "warning");
				return;
			}

			// Ensure cwd and logDir are set
			if (!cwd) cwd = ctx.cwd;
			if (!logDir) {
				logDir = join(cwd, ".pi", "pipeline-logs");
				if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
			}

			// Re-parse checklist if we don't have phases loaded (fresh session restart)
			if (parsedPhases.length === 0) {
				const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
				if (existsSync(checklistPath)) {
					parsedPhases = parseChecklist(checklistPath);
				}
			}

			// Show what was completed
			const completedTasks: string[] = [];
			const failedTasks: string[] = [];
			for (const phase of parsedPhases) {
				const ps = pipeline.phaseStates.get(phase.name);
				if (ps) {
					for (const t of ps.tasks) {
						if (t.status === "passed") completedTasks.push(`  + ${t.id}: ${t.title} (${t.complianceScore}%)`);
						else if (t.status === "failed") failedTasks.push(`  - ${t.id}: ${t.title} (${t.complianceScore}%)`);
					}
				} else {
					// Derive from checklist marks (fresh restart)
					for (const t of phase.tasks) {
						if (t.done) completedTasks.push(`  + ${t.id}: ${t.title}`);
					}
				}
			}

			const currentBranch = shellExec("git branch --show-current", cwd);
			const branch = currentBranch.ok ? currentBranch.stdout : pipeline.branch || "unknown";
			const onMain = branch === "main" || branch === "master";

			const summary = [
				`Session Summary`,
				`───────────────`,
				`Branch: ${branch}`,
				``,
				completedTasks.length > 0 ? `Completed (${completedTasks.length}):` : "",
				...completedTasks,
				failedTasks.length > 0 ? `\nFailed (${failedTasks.length}):` : "",
				...failedTasks,
			].filter(Boolean).join("\n");

			ctx.ui.notify(summary, "info");

			if (failedTasks.length > 0) {
				ctx.ui.notify(
					`${failedTasks.length} task(s) failed. Fix them before ending the session.`,
					"warning",
				);
			}

			// ── UAT sign-off ──
			const uatApproved = await ctx.ui.confirm(
				"UAT Sign-off",
				"All tests passing. Has UAT been completed and approved? This will squash merge to main.",
			);
			if (!uatApproved) {
				ctx.ui.notify("Session end cancelled. Continue testing or run /pipeline-next.", "info");
				return;
			}

			// Ensure all changes are committed
			ctx.ui.setStatus("pipeline", "Committing final changes...");
			shellExec(`git -C '${cwd}' add -A`, cwd);
			const hasPending = shellExec(`git -C '${cwd}' diff --cached --quiet`, cwd);
			if (!hasPending.ok) {
				const commitMsg = completedTasks.length > 0
					? `feat: complete ${completedTasks.length} task(s)\n\n${completedTasks.join("\n")}`
					: "chore: final session changes";
				const tmpFile = join(tmpdir(), `pi-pipeline-commit-${Date.now()}.txt`);
				writeFileSync(tmpFile, commitMsg, "utf-8");
				shellExec(`git -C '${cwd}' commit --file '${tmpFile}'`, cwd);
				try { unlinkSync(tmpFile); } catch {}
			}

			if (onMain) {
				// Already on main, just push
				ctx.ui.setStatus("pipeline", "Pushing to remote...");
				const pushResult = shellExec(`git -C '${cwd}' push`, cwd);
				ctx.ui.setStatus("pipeline", "");
				if (pushResult.ok) {
					ctx.ui.notify("Changes pushed to main.", "success");
				} else {
					ctx.ui.notify(`Push failed: ${pushResult.stderr}`, "error");
				}
				return;
			}

			// Squash merge to main
			ctx.ui.setStatus("pipeline", "Squash merging to main...");

			// Collect all feature branches created during this build cycle
			const featureBranches = shellExec(
				`git -C '${cwd}' branch --list 'feature/epic-*'`,
				cwd,
			);
			const branches = featureBranches.ok
				? featureBranches.stdout.split("\n").map(b => b.trim().replace(/^\* /, "")).filter(Boolean)
				: [branch];

			// Switch to main
			const mainBranch = shellExec(`git -C '${cwd}' rev-parse --verify main`, cwd).ok ? "main" : "master";
			const checkoutMain = shellExec(`git -C '${cwd}' checkout ${mainBranch}`, cwd);
			if (!checkoutMain.ok) {
				ctx.ui.setStatus("pipeline", "");
				ctx.ui.notify(`Failed to checkout ${mainBranch}: ${checkoutMain.stderr}`, "error");
				return;
			}

			// Squash merge the current feature branch (which has all the work chained)
			const mergeMsg = `feat: pipeline build - ${completedTasks.length} task(s) completed\n\n${completedTasks.join("\n")}`;
			const tmpMergeFile = join(tmpdir(), `pi-pipeline-merge-${Date.now()}.txt`);
			writeFileSync(tmpMergeFile, mergeMsg, "utf-8");

			const mergeResult = shellExec(
				`git -C '${cwd}' merge --squash '${branch}'`,
				cwd,
			);
			if (!mergeResult.ok) {
				ctx.ui.setStatus("pipeline", "");
				ctx.ui.notify(`Squash merge failed: ${mergeResult.stderr}\nResolve conflicts and try again.`, "error");
				// Go back to the feature branch
				shellExec(`git -C '${cwd}' checkout '${branch}'`, cwd);
				try { unlinkSync(tmpMergeFile); } catch {}
				return;
			}

			const commitResult = shellExec(
				`git -C '${cwd}' commit --file '${tmpMergeFile}'`,
				cwd,
			);
			try { unlinkSync(tmpMergeFile); } catch {}

			if (!commitResult.ok) {
				ctx.ui.setStatus("pipeline", "");
				ctx.ui.notify(`Commit after squash merge failed: ${commitResult.stderr}`, "error");
				return;
			}

			// Push to remote
			ctx.ui.setStatus("pipeline", "Pushing to remote...");
			const pushResult = shellExec(`git -C '${cwd}' push`, cwd);
			if (!pushResult.ok) {
				// Try setting upstream
				const pushUp = shellExec(`git -C '${cwd}' push -u origin ${mainBranch}`, cwd);
				if (!pushUp.ok) {
					ctx.ui.setStatus("pipeline", "");
					ctx.ui.notify(`Push failed: ${pushUp.stderr}`, "error");
					return;
				}
			}

			// Delete feature branches (local)
			ctx.ui.setStatus("pipeline", "Cleaning up branches...");
			const deletedBranches: string[] = [];
			for (const b of branches) {
				const del = shellExec(`git -C '${cwd}' branch -D '${b}'`, cwd);
				if (del.ok) deletedBranches.push(b);
				// Also delete remote branch
				shellExec(`git -C '${cwd}' push origin --delete '${b}'`, cwd);
			}

			// Clean up pipeline logs and sessions
			if (existsSync(logDir)) {
				for (const f of readdirSync(logDir)) {
					if (f.endsWith(".log")) {
						try { unlinkSync(join(logDir, f)); } catch {}
					}
				}
			}
			if (existsSync(sessionDir)) {
				for (const f of readdirSync(sessionDir)) {
					if (f.startsWith("pipeline-") && f.endsWith(".json")) {
						try { unlinkSync(join(sessionDir, f)); } catch {}
					}
				}
			}

			// Reset pipeline state
			pipeline = {
				phases: [],
				currentPhase: -1,
				phaseStates: new Map(),
				branch: "",
				running: false,
			};
			agentSessions.clear();
			pipelineLog = [];

			// Close any open tmux panes
			for (const paneId of watchPaneIds) {
				try { execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" }); } catch {}
			}
			watchPaneIds = [];
			tmuxColumns.length = 0;
			agentPanes.clear();

			ctx.ui.setStatus("pipeline", "");
			updateWidget();

			ctx.ui.notify(
				[
					`Session Complete`,
					`────────────────`,
					`Squash merged to ${mainBranch} and pushed.`,
					``,
					deletedBranches.length > 0 ? `Deleted branches:\n${deletedBranches.map(b => `  - ${b}`).join("\n")}` : "",
					``,
					`Completed ${completedTasks.length} task(s).`,
					`Logs and sessions cleaned up.`,
					`You are now on ${mainBranch}.`,
				].filter(Boolean).join("\n"),
				"success",
			);
		},
	});

	// ── Session Lifecycle ────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
		widgetCtx = ctx;
		cwd = ctx.cwd;

		// Reload pipeline config on session start
		pipelineConfig = loadPipelineConfig();
		FAST_BUILD_MODEL = pipelineConfig.fast.build.model;
		FAST_EVAL_MODEL = pipelineConfig.fast.eval.model;
		FAST_FIX_MODEL = pipelineConfig.fast.fix.model;

		sessionDir = join(ctx.cwd, ".pi", "agent-sessions");
		logDir = join(ctx.cwd, ".pi", "pipeline-logs");
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

		// Detect if another pipeline instance is already running
		const existingState = readStateFile();
		if (existingState?.running) {
			// Check if a pi process is actually running a pipeline (not just stale state)
			let pipelineProcessAlive = false;
			try {
				const psOutput = execSync(`ps aux | grep -E 'pi.*(-e|--extension)' | grep -v grep`, { encoding: "utf-8", timeout: 3000 }).trim();
				// Count pi processes (excluding this one)
				const myPid = process.pid;
				const lines = psOutput.split("\n").filter(l => l.trim());
				const otherPiProcesses = lines.filter(l => {
					const parts = l.trim().split(/\s+/);
					const pid = parseInt(parts[1], 10);
					return pid !== myPid;
				});
				pipelineProcessAlive = otherPiProcesses.length > 0;
			} catch {
				pipelineProcessAlive = false;
			}

			if (!pipelineProcessAlive) {
				// Stale state -- ask user
				const staleAge = Date.now() - (existingState.ts || 0);
				const staleMin = Math.round(staleAge / 60000);
				const answer = await ctx.ui.select(
					`Pipeline state shows "running" but no active pipeline process found (last updated ${staleMin}m ago). Likely a crashed session.`,
					["Clear stale state and start fresh", "Enter observer mode anyway"],
				);
				if (answer === "Clear stale state and start fresh") {
					existingState.running = false;
					writeStateFile();
					ctx.ui.notify("Stale pipeline state cleared. You can now run commands normally.", "success");
					// Fall through to normal startup below
				} else {
					// Fall through to observer mode
				}
			}

			if (existingState.running) {
				observerMode = true;
				// Load checklist for widget context but don't write state
				const checklistPath = join(ctx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
				if (existsSync(checklistPath)) {
					parsedPhases = parseChecklist(checklistPath);
				}
				agents = scanAgents(ctx.cwd);
				updateWidget();
				startObserverPolling();
				ctx.ui.notify(
					"Observer mode: another pipeline instance is running.\n" +
					"This session is read-only — the widget shows live progress from the active pipeline.\n" +
					"Pipeline commands (start, next, reset, etc.) are disabled.\n\n" +
					"Available: /pipeline-status, /pipeline-config, /pipeline-logs, /pipeline-watch, /pipeline-dashboard",
					"warning",
				);

				ctx.ui.setFooter((_tui, theme, _footerData) => ({
					dispose: () => {},
					invalidate() {},
					render(width: number): string[] {
						const left = theme.fg("dim", ` observer`) +
							theme.fg("muted", " · ") +
							theme.fg("warning", "read-only");
						const right = theme.fg("dim", `pipeline running elsewhere `);
						const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
						return [truncateToWidth(left + pad + right, width)];
					},
				}));
				return;
			}
		}

		observerMode = false;
		stopObserverPolling();

		// Write JSON→text filter script once, reuse in all tmux panes
		const filterScript = join(logDir, "json-filter.py");
		writeFileSync(filterScript, [
			`#!/usr/bin/env python3`,
			`import sys, json`,
			`for line in sys.stdin:`,
			`    line = line.strip()`,
			`    if not line: continue`,
			`    try:`,
			`        e = json.loads(line)`,
			`        d = e.get('assistantMessageEvent', {}).get('delta', '')`,
			`        if d: print(d, end='', flush=True)`,
			`    except:`,
			`        if not line.startswith('{'): print(line, flush=True)`,
		].join("\n") + "\n", { mode: 0o755 });

		agents = scanAgents(ctx.cwd);
		agentSessions.clear();

		// Auto-load checklist if it exists
		const checklistPath = join(ctx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
		if (existsSync(checklistPath)) {
			parsedPhases = parseChecklist(checklistPath);
		}

		updateWidget();

		const required = ["dev", "compliance", "reviewer", "lint-build", "tester", "foundations-architect", "foundations-builder"];
		const missing = required.filter(a => !agents.has(a));
		if (missing.length > 0) {
			ctx.ui.notify(`Missing agents: ${missing.join(", ")}\nAdd .md files to ~/.pi-init/agents/`, "warning");
		}

		const available = required.filter(a => agents.has(a)).map(displayName).join(", ");

		// ── Auto-detect pending work ─────────────
		if (parsedPhases.length > 0 && missing.length === 0) {
			const totalTasks = parsedPhases.reduce((n, p) => n + p.tasks.length, 0);
			const doneTasks = parsedPhases.reduce((n, p) => n + p.tasks.filter(t => t.done).length, 0);
			const nextPhaseIdx = parsedPhases.findIndex(p => p.tasks.some(t => !t.done));

			if (nextPhaseIdx >= 0) {
				const nextPhase = parsedPhases[nextPhaseIdx];
				const pending = nextPhase.tasks.filter(t => !t.done).length;

				ctx.ui.notify(
					`Checklist detected: ${totalTasks} tasks, ${doneTasks} done, ${totalTasks - doneTasks} remaining\n` +
					`Next: ${nextPhase.name} (${pending} tasks)\n\n` +
					`Type /pipeline-start to begin.`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`All ${totalTasks} tasks complete! Run /pipeline-end for UAT sign-off.`,
					"success",
				);
				return;
			}
		}

		ctx.ui.notify(
			`Dev Pipeline ready (Fast Track + 3-Wave)\nAgents: ${available}\n\n` +
			`/pipeline-start            Initialize (Fast Track: build → evaluate → UAT)\n` +
			`/pipeline-start --multiwave Initialize (3-Wave: council → prototype → review → sprint)\n` +
			`/pipeline-next        Run next epic\n` +
			`/pipeline-approve     Approve UAT results (fast track)\n` +
			`/pipeline-reject      Reject UAT with notes (fast track)\n` +
			`/pipeline-reset       Full reset: main, delete branches, uncheck, reopen issues\n` +
			`/pipeline-end         UAT sign-off → squash merge → push → clean up\n` +
			`/pipeline-status      Show progress\n` +
			`/pipeline-dashboard   Open live dashboard in tmux pane\n` +
			`/pipeline-logs        Open all agent logs in tmux\n` +
			`/pipeline-watch <name> Tail one agent's log\n` +
			`/pipeline-close-panes Close all watch panes`,
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

				const phaseInfo = pipeline.currentPhase >= 0 && parsedPhases[pipeline.currentPhase]
					? parsedPhases[pipeline.currentPhase].name.slice(0, 30)
					: "idle";

				const status = pipeline.running
					? theme.fg("accent", phaseInfo)
					: theme.fg("dim", phaseInfo);

				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", "pipeline") +
					theme.fg("muted", " · ") +
					status;
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});

	pi.on("session_shutdown", async () => {
		stopObserverPolling();
	});
}
