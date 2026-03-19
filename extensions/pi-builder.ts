/**
 * pi-builder — task-first production-line execution extension
 *
 * Flow:
 *   /builder-start <issue>  -> reconstruct task packet + readiness gate
 *   /builder-next           -> build -> review -> test -> compliance -> sync
 *   /builder-status         -> show packet/lane summary
 *   /builder-sync           -> write current state back to GitHub
 *   /builder-promote        -> run final compliance gate and mark ready for UAT
 *
 * Usage: pi -ne -e extensions/pi-builder.ts -e extensions/theme-cycler.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, join } from "path";
import { execSync } from "child_process";
import { applyExtensionDefaults } from "./themeMap.ts";

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
	model?: string;
}

interface IssueComment {
	body: string;
	author?: { login?: string };
	createdAt?: string;
}

interface IssueRecord {
	number: number;
	title: string;
	body: string;
	state: string;
	url: string;
	labels?: { name: string }[];
	comments?: IssueComment[];
}

interface ChangeSnapshot {
	changedFiles: string[];
	touchedInterfaces: string[];
	touchedAcceptanceCriteria: string[];
	summary: string;
}

interface ReadinessResult {
	pass: boolean;
	complexityScore: number | null;
	reasons: string[];
	lineStop: string[];
	dependencyRefs: number[];
}

interface TaskPacket {
	taskId: string;
	issueRefs: number[];
	goal: string;
	ownedFiles: string[];
	inputContracts: string[];
	outputContracts: string[];
	requiredSchema: string[];
	requiredTestData: string[];
	requiredArtifacts: string[];
	preloadSteps: string[];
	fixtureLocations: string[];
	validationScope: string[];
	regressionSurface: string[];
	blockers: string[];
	lessonsLearned: string[];
	nextLane: BuilderLane;
	lineStopConditions: string[];
	expectedOutput: string;
	acceptanceCriteria: string[];
	complexityScore: number | null;
	dependencies: number[];
	taskBranch?: string;
	baseBranch?: string;
	worktreePath?: string;
	mergeStrategy?: string;
	issue: IssueRecord;
	changeSnapshot: ChangeSnapshot;
	readiness: ReadinessResult;
}

type BuilderLane = "idle" | "intake" | "build" | "review" | "test" | "sync" | "promotion" | "blocked" | "ready";

interface BuilderState {
	activeIssue?: number;
	lane: BuilderLane;
	packet?: TaskPacket;
	lastReview?: any;
	lastTests?: any;
	lastCompliance?: any;
	lastSyncAt?: string;
	lastUpdatedAt: string;
	history: string[];
}

interface AgentResult {
	output: string;
	exitCode: number;
	elapsed: number;
}

interface RunAgentOpts {
	model?: string;
	thinking?: string;
	reuse?: boolean;
	fast?: boolean;
	worktreeCwd?: string;
}

const DEFAULT_DEV_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_REVIEW_MODEL = "anthropic/claude-opus-4-6";
const DEFAULT_TEST_MODEL = "google-gemini-cli/gemini-3-pro";
const DEFAULT_COMPLIANCE_MODEL = "anthropic/claude-opus-4-6";
const COMPLIANCE_THRESHOLD = 95;
const MAX_REPAIR_LOOPS = 3;

export default function (pi: ExtensionAPI) {
	let widgetCtx: ExtensionContext | null = null;
	let cwd = process.cwd();
	let logDir = "";
	let sessionDir = "";
	let stateFile = "";
	let builderState: BuilderState = emptyState();
	const agentSessions = new Map<string, string>();
	const agentProcesses = new Map<string, ChildProcess>();

	function emptyState(): BuilderState {
		return {
			lane: "idle",
			lastUpdatedAt: new Date().toISOString(),
			history: [],
		};
	}

	function ensureDirs() {
		if (!logDir) logDir = join(cwd, ".pi", "builder-logs");
		if (!sessionDir) sessionDir = join(cwd, ".pi", "builder-sessions");
		if (!stateFile) stateFile = join(cwd, ".pi", "builder-state.json");
		if (!existsSync(join(cwd, ".pi"))) mkdirSync(join(cwd, ".pi"), { recursive: true });
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
	}

	function loadState() {
		ensureDirs();
		if (existsSync(stateFile)) {
			try {
				builderState = JSON.parse(readFileSync(stateFile, "utf8"));
			} catch {
				builderState = emptyState();
			}
		}
	}

	function saveState(note?: string) {
		ensureDirs();
		builderState.lastUpdatedAt = new Date().toISOString();
		if (note) builderState.history.push(`[${builderState.lastUpdatedAt}] ${note}`);
		writeFileSync(stateFile, JSON.stringify(builderState, null, 2));
		updateStatus();
	}

	function updateStatus() {
		if (!widgetCtx?.hasUI) return;
		const issueText = builderState.activeIssue ? `#${builderState.activeIssue}` : "(none)";
		widgetCtx.ui.setStatus("builder", `${builderState.lane} ${issueText}`);
	}

	function shell(command: string, runCwd: string = cwd): string {
		return execSync(command, {
			cwd: runCwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		}).trim();
	}

	function shellSafe(command: string, runCwd: string = cwd): string {
		try {
			return shell(command, runCwd);
		} catch {
			return "";
		}
	}

	function ghIssueView(issueNumber: number): IssueRecord {
		const raw = shell(`gh issue view ${issueNumber} --json number,title,body,state,url,labels,comments`, cwd);
		return JSON.parse(raw);
	}

	function ghIssueState(issueNumber: number): string {
		const raw = shellSafe(`gh issue view ${issueNumber} --json state`, cwd);
		if (!raw) return "UNKNOWN";
		try { return JSON.parse(raw).state || "UNKNOWN"; } catch { return "UNKNOWN"; }
	}

	function ghIssueComment(issueNumber: number, body: string) {
		const tempPath = join(tmpdir(), `pi-builder-comment-${issueNumber}-${Date.now()}.md`);
		writeFileSync(tempPath, body);
		shell(`gh issue comment ${issueNumber} --body-file ${JSON.stringify(tempPath)}`, cwd);
	}

	function readAgent(agentName: string): AgentDef {
		const searchRoots = [
			join(cwd, "agents", "dev-pipeline"),
			join(cwd, ".pi", "agents"),
			join(homedir(), ".pi", "agent", "agents"),
			join(homedir(), ".pi-init", "agents"),
		];
		for (const root of searchRoots) {
			const path = join(root, `${agentName}.md`);
			if (!existsSync(path)) continue;
			const raw = readFileSync(path, "utf8");
			const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
			const front = m?.[1] || "";
			const systemPrompt = (m?.[2] || raw).trim();
			const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim() || agentName;
			const description = front.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "";
			const tools = front.match(/^tools:\s*(.+)$/m)?.[1]?.trim() || "read,bash,grep,find,ls";
			return { name, description, tools, systemPrompt };
		}
		throw new Error(`Agent not found: ${agentName}`);
	}

	function logFile(sessionKey: string): string {
		ensureDirs();
		return join(logDir, `${sessionKey}.log`);
	}

	function runAgent(agentDef: AgentDef, task: string, sessionKey: string, opts: RunAgentOpts = {}): Promise<AgentResult> {
		const model = opts.model || agentDef.model || (agentDef.name === "dev" ? DEFAULT_DEV_MODEL : DEFAULT_REVIEW_MODEL);
		const providerExtDir = join(homedir(), ".pi", "agent", "extensions");
		const providerExts: string[] = [];
		if (existsSync(providerExtDir)) {
			for (const f of readdirSync(providerExtDir)) {
				if (f.endsWith("-provider.ts")) providerExts.push("-e", join(providerExtDir, f));
			}
		}

		const args = [
			"--mode", "rpc",
			"--no-extensions",
			...providerExts,
			"--no-skills",
			"--no-prompt-templates",
			"--model", model,
			"--thinking", opts.thinking || "medium",
			"--system-prompt", agentDef.systemPrompt,
		];
		if (opts.fast) args.push("--no-tools");
		else args.push("--tools", agentDef.tools);

		let sessionPath: string;
		if (opts.reuse) {
			sessionPath = agentSessions.get(agentDef.name) || join(sessionDir, `builder-${agentDef.name}.json`);
			agentSessions.set(agentDef.name, sessionPath);
		} else {
			sessionPath = join(sessionDir, `builder-${sessionKey}.json`);
		}
		args.push("--session", sessionPath);
		if (existsSync(sessionPath)) args.push("-c");

		const started = Date.now();
		const outLog = logFile(sessionKey);
		return new Promise((resolve) => {
			const proc = spawn("pi", args, {
				cwd: opts.worktreeCwd || cwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: process.env,
			});
			agentProcesses.set(sessionKey, proc);
			proc.stdin!.write(JSON.stringify({ type: "prompt", message: task }) + "\n");
			const textParts: string[] = [];
			let lineBuf = "";
			proc.stdout!.setEncoding("utf8");
			proc.stdout!.on("data", (chunk: string) => {
				appendFileSync(outLog, chunk);
				lineBuf += chunk;
				const lines = lineBuf.split("\n");
				lineBuf = lines.pop() || "";
				for (const line of lines) {
					if (!line) continue;
					try {
						const evt = JSON.parse(line);
						if (evt.type === "message_update" && evt.assistantMessageEvent?.type === "text_delta") {
							textParts.push(evt.assistantMessageEvent.delta);
						}
					} catch {}
				}
			});
			proc.stderr!.setEncoding("utf8");
			proc.stderr!.on("data", (chunk: string) => appendFileSync(outLog, chunk));
			proc.on("close", (code) => {
				agentProcesses.delete(sessionKey);
				resolve({ output: textParts.join("") || `(exit ${code ?? 1})`, exitCode: code ?? 1, elapsed: Date.now() - started });
			});
			proc.on("error", (err) => {
				agentProcesses.delete(sessionKey);
				resolve({ output: `Error: ${err.message}`, exitCode: 1, elapsed: Date.now() - started });
			});
		});
	}

	function extractJson(text: string): any | null {
		const fenced = text.match(/```json\s*([\s\S]*?)\s*```/);
		const raw = fenced ? fenced[1] : text;
		try { return JSON.parse(raw.trim()); } catch {}
		const obj = raw.match(/\{[\s\S]*\}/);
		if (obj) {
			try { return JSON.parse(obj[0]); } catch {}
		}
		const arr = raw.match(/\[[\s\S]*\]/);
		if (arr) {
			try { return JSON.parse(arr[0]); } catch {}
		}
		return null;
	}

	function extractChecklistItems(body: string, heading: string): string[] {
		const rx = new RegExp(`##\\s+${heading}([\\s\\S]*?)(?:\\n##\\s+|$)`, "i");
		const m = body.match(rx);
		if (!m) return [];
		return m[1]
			.split("\n")
			.map(line => line.trim())
			.filter(line => /^- \[.?\]/.test(line))
			.map(line => line.replace(/^- \[[ xX]?\]\s*/, "").trim())
			.filter(Boolean);
	}

	function extractReferencedPaths(body: string): string[] {
		const matches = body.match(/(?:extensions|docs|agents|bin)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) || [];
		return unique(matches);
	}

	function extractIssueNumbers(body: string, label: string): number[] {
		const matches: number[] = [];
		const rx = new RegExp(`${label}[^#\n]*#(\\d+)`, "ig");
		let m: RegExpExecArray | null;
		while ((m = rx.exec(body))) matches.push(Number(m[1]));
		return unique(matches);
	}

	function extractAnyIssueRefs(body: string): number[] {
		const matches = [...body.matchAll(/#(\d+)/g)].map(m => Number(m[1]));
		return unique(matches);
	}

	function extractMetadata(body: string, key: string): string | undefined {
		const rx = new RegExp(`^[-*]?\\s*\\*?\\*?${key}\\*?\\*?:\\s*(.+)$`, "im");
		return body.match(rx)?.[1]?.trim();
	}

	function deriveComplexityScore(issue: IssueRecord): number | null {
		const body = issue.body;
		const explicit = body.match(/complexity(?: score)?[^\d]*(\d+)\s*\/\s*10/i);
		if (explicit) return Number(explicit[1]);
		const ceiling15 = /15-minute ceiling|15 minute ceiling|>15 minute tasks/i.test(body);
		if (ceiling15) return 5;
		if (/create .*entrypoint|entrypoint/i.test(issue.title)) return 3;
		if (/runtime task-packet reconstruction/i.test(issue.title)) return 5;
		if (/execution-readiness/i.test(issue.title)) return 4;
		if (/task:/i.test(issue.title)) return 5;
		return null;
	}

	function collectCurrentDiff(runCwd: string): string[] {
		const staged = shellSafe("git diff --name-only --cached", runCwd).split("\n").filter(Boolean);
		const unstaged = shellSafe("git diff --name-only", runCwd).split("\n").filter(Boolean);
		const tracked = shellSafe("git ls-files", runCwd).split("\n").filter(Boolean);
		return unique([...staged, ...unstaged, ...tracked.slice(0, 0)]);
	}

	function collectTouchedInterfaces(files: string[], runCwd: string): string[] {
		const touched: string[] = [];
		for (const file of files.filter(f => /\.(ts|tsx|js|jsx|md)$/.test(f)).slice(0, 20)) {
			const full = join(runCwd, file);
			if (!existsSync(full)) continue;
			const raw = readFileSync(full, "utf8");
			for (const m of raw.matchAll(/export\s+(?:default\s+)?(?:function|class|const|type|interface)\s+([A-Za-z0-9_]+)/g)) {
				touched.push(`${file}#${m[1]}`);
			}
		}
		return unique(touched);
	}

	function inferTouchedCriteria(criteria: string[], files: string[]): string[] {
		const names = files.map(f => basename(f).toLowerCase());
		return criteria.filter(c => names.some(n => c.toLowerCase().includes(n.replace(/\.[^.]+$/, "")))).slice(0, 10);
	}

	function checkDependencies(depRefs: number[]): { unresolved: number[]; resolved: number[] } {
		const unresolved: number[] = [];
		const resolved: number[] = [];
		for (const ref of depRefs) {
			const state = ghIssueState(ref);
			if (state === "CLOSED") resolved.push(ref);
			else unresolved.push(ref);
		}
		return { unresolved, resolved };
	}

	function evaluateReadiness(issue: IssueRecord, body: string, acceptanceCriteria: string[], depRefs: number[]): ReadinessResult {
		const complexityScore = deriveComplexityScore(issue);
		const reasons: string[] = [];
		const lineStop: string[] = [];
		if (acceptanceCriteria.length === 0) lineStop.push("Missing acceptance criteria in issue body");
		if (complexityScore == null) lineStop.push("Missing or unparseable complexity score");
		else if (complexityScore > 5) lineStop.push(`Complexity ${complexityScore}/10 exceeds execution ceiling 5/10`);
		const depState = checkDependencies(depRefs);
		if (depState.unresolved.length > 0) lineStop.push(`Unresolved dependencies: ${depState.unresolved.map(n => `#${n}`).join(", ")}`);
		if (/missing prerequisite|prerequisite/i.test(body)) reasons.push("Issue mentions prerequisites explicitly");
		if (/execution-ready|execution ready/i.test(body)) reasons.push("Issue references execution-readiness");
		if (complexityScore != null && complexityScore <= 5) reasons.push(`Complexity ${complexityScore}/10 is within execution ceiling`);
		if (acceptanceCriteria.length > 0) reasons.push(`Acceptance criteria found (${acceptanceCriteria.length})`);
		return {
			pass: lineStop.length === 0,
			complexityScore,
			reasons,
			lineStop,
			dependencyRefs: depRefs,
		};
	}

	function reconstructTaskPacket(issueNumber: number): TaskPacket {
		const issue = ghIssueView(issueNumber);
		const body = issue.body || "";
		const acceptanceCriteria = extractChecklistItems(body, "Acceptance Criteria");
		const ownedFiles = extractReferencedPaths(body);
		const dependencies = unique([
			...extractIssueNumbers(body, "Depends on"),
			...extractIssueNumbers(body, "Dependency"),
		]);
		const changeFiles = unique([...collectCurrentDiff(cwd), ...ownedFiles]);
		const changeSnapshot: ChangeSnapshot = {
			changedFiles: changeFiles,
			touchedInterfaces: collectTouchedInterfaces(changeFiles, cwd),
			touchedAcceptanceCriteria: inferTouchedCriteria(acceptanceCriteria, changeFiles),
			summary: changeFiles.length > 0
				? `Changed surfaces: ${changeFiles.join(", ")}`
				: `No working diff yet. Owned files inferred from issue body: ${ownedFiles.join(", ") || "none"}`,
		};
		const lessonsLearned = (issue.comments || [])
			.map(c => c.body || "")
			.filter(Boolean)
			.filter(body => /learning|builder handoff|blocked|line stop/i.test(body))
			.slice(-10);
		const validationScope = unique([
			...acceptanceCriteria,
			...(extractChecklistItems(body, "Done When")),
		]);
		const regressionSurface = unique([
			...changeSnapshot.changedFiles,
			...changeSnapshot.touchedInterfaces,
		]);
		const readiness = evaluateReadiness(issue, body, acceptanceCriteria, dependencies);

		return {
			taskId: `issue-${issue.number}`,
			issueRefs: unique([issue.number, ...extractAnyIssueRefs(body)]),
			goal: issue.title,
			ownedFiles,
			inputContracts: unique([
				...acceptanceCriteria.filter(c => /input|accept|issue body|comment|diff|checklist/i.test(c)),
			]),
			outputContracts: unique([
				...acceptanceCriteria.filter(c => /output|emit|write back|comment|status|snapshot/i.test(c)),
			]),
			requiredSchema: unique([
				extractMetadata(body, "Required Schema") || "",
			].filter(Boolean)),
			requiredTestData: unique([
				extractMetadata(body, "Required Test Data") || "",
			].filter(Boolean)),
			requiredArtifacts: unique([
				extractMetadata(body, "Required Artifacts") || "",
				...extractReferencedPaths(body).filter(p => p.startsWith("docs/")),
			].filter(Boolean)),
			preloadSteps: unique([
				"Read the issue body and issue comments",
				"Inspect current git diff and owned files",
				"Load prior learnings from GitHub comments",
			]),
			fixtureLocations: unique([
				extractMetadata(body, "Fixture Locations") || "",
			].filter(Boolean)),
			validationScope,
			regressionSurface,
			blockers: [...readiness.lineStop],
			lessonsLearned,
			nextLane: readiness.pass ? "build" : "blocked",
			lineStopConditions: unique([
				"missing substantial schema/test-data/fixture/artifact prerequisites",
				"complexity score above 5/10",
				"unresolved dependencies",
				"scope drift 8/10 or higher",
			]),
			expectedOutput: acceptanceCriteria.join("; ") || issue.title,
			acceptanceCriteria,
			complexityScore: readiness.complexityScore,
			dependencies,
			taskBranch: extractMetadata(body, "Task Branch"),
			baseBranch: extractMetadata(body, "Base Branch"),
			worktreePath: extractMetadata(body, "Worktree Path"),
			mergeStrategy: extractMetadata(body, "Merge Strategy"),
			issue,
			changeSnapshot,
			readiness,
		};
	}

	function packetSummary(packet: TaskPacket): string {
		return [
			`Task: #${packet.issue.number} ${packet.issue.title}`,
			`Lane: ${builderState.lane}`,
			`Readiness: ${packet.readiness.pass ? "PASS" : "BLOCKED"}`,
			`Complexity: ${packet.complexityScore == null ? "unknown" : `${packet.complexityScore}/10`}`,
			`Owned files: ${packet.ownedFiles.join(", ") || "(none)"}`,
			`Changed files: ${packet.changeSnapshot.changedFiles.join(", ") || "(none)"}`,
			`Touched interfaces: ${packet.changeSnapshot.touchedInterfaces.join(", ") || "(none)"}`,
			`Acceptance criteria: ${packet.acceptanceCriteria.length}`,
			packet.blockers.length > 0 ? `Blockers: ${packet.blockers.join("; ")}` : `Blockers: none`,
		].join("\n");
	}

	function buildPrompt(packet: TaskPacket): string {
		return [
			`Implement task #${packet.issue.number}: ${packet.issue.title}`,
			``,
			`Goal: ${packet.goal}`,
			`Expected output: ${packet.expectedOutput}`,
			``,
			`Owned files:`,
			...packet.ownedFiles.map(f => `- ${f}`),
			packet.ownedFiles.length === 0 ? `- Infer the minimal owned file set from existing patterns` : "",
			``,
			`Acceptance criteria:`,
			...packet.acceptanceCriteria.map(c => `- ${c}`),
			``,
			`Validation scope:`,
			...packet.validationScope.map(c => `- ${c}`),
			``,
			`Regression surface:`,
			...packet.regressionSurface.map(c => `- ${c}`),
			``,
			`Current change snapshot: ${packet.changeSnapshot.summary}`,
			``,
			`Rules:`,
			`- Keep the packet frozen unless a real blocker forces line-stop`,
			`- Prefer surgical edits over broad rewrites`,
			`- Update only files needed for the acceptance criteria`,
			`- Be ready for diff-scoped review and targeted testing after implementation`,
		].filter(Boolean).join("\n");
	}

	function reviewPrompt(packet: TaskPacket): string {
		return [
			`Review task #${packet.issue.number}: ${packet.issue.title}`,
			``,
			`This is a diff-scoped review. Focus on:`,
			...packet.changeSnapshot.changedFiles.map(f => `- changed file: ${f}`),
			...packet.changeSnapshot.touchedInterfaces.map(i => `- touched interface: ${i}`),
			...packet.acceptanceCriteria.map(c => `- acceptance criterion: ${c}`),
			``,
			`Return valid JSON:`,
			`{`,
			`  "pass": true,`,
			`  "issues": [`,
			`    {"severity": "P0|P1|P2", "summary": "...", "fix": "..."}`,
			`  ]`,
			`}`,
		].join("\n");
	}

	function testPrompt(packet: TaskPacket): string {
		return [
			`Run targeted validation for task #${packet.issue.number}: ${packet.issue.title}`,
			``,
			`Prioritize:`,
			`1. Changed-file checks`,
			`2. Task acceptance checks`,
			`3. Selected regression surface`,
			``,
			`Changed files: ${packet.changeSnapshot.changedFiles.join(", ") || "(none)"}`,
			`Regression surface: ${packet.regressionSurface.join(", ") || "(none)"}`,
			``,
			`If no formal test command exists, run the fastest meaningful verification available and report that precisely.`,
		].join("\n");
	}

	function compliancePrompt(packet: TaskPacket): string {
		return [
			`Score implementation for task #${packet.issue.number}: ${packet.issue.title}`,
			``,
			`Acceptance criteria:`,
			...packet.acceptanceCriteria.map(c => `- ${c}`),
			``,
			`Also verify these epic-aligned properties when relevant:`,
			`- task-first intake rather than epic-first execution`,
			`- GitHub-backed reconstruction and restartability`,
			`- execution-readiness gating`,
			`- builder behavior stays narrow and machine-usable`,
		].join("\n");
	}

	function shouldLineStopFromText(text: string): boolean {
		return /missing prerequisite|fixture|seed data|schema|database|artifact|scope drift|replan|blocked by dependency/i.test(text);
	}

	async function applyRepairLoop(packet: TaskPacket, feedback: string, loop: number) {
		const dev = readAgent("dev");
		const prompt = [
			`Repair task #${packet.issue.number}: ${packet.issue.title}`,
			``,
			`Apply the following findings without broadening scope:`,
			feedback,
			``,
			`Packet remains frozen. Stay within: ${packet.ownedFiles.join(", ") || "minimal owned files only"}`,
		].join("\n");
		return runAgent(dev, prompt, `builder-repair-${packet.issue.number}-${loop}`, {
			model: DEFAULT_DEV_MODEL,
			thinking: "high",
			reuse: true,
			worktreeCwd: cwd,
		});
	}

	async function runBuilderLoop(packet: TaskPacket, ctx: ExtensionContext): Promise<boolean> {
		const dev = readAgent("dev");
		const reviewer = readAgent("reviewer");
		const tester = readAgent("tester");
		const compliance = readAgent("compliance");

		builderState.packet = packet;
		builderState.activeIssue = packet.issue.number;

		for (let loop = 0; loop < MAX_REPAIR_LOOPS; loop++) {
			builderState.lane = "build";
			saveState(`Build loop ${loop + 1} started for #${packet.issue.number}`);
			const buildRes = await runAgent(dev, buildPrompt(packet), `builder-build-${packet.issue.number}-${loop}`, {
				model: DEFAULT_DEV_MODEL,
				thinking: "high",
				reuse: true,
				worktreeCwd: cwd,
			});
			if (buildRes.exitCode !== 0 && shouldLineStopFromText(buildRes.output)) {
				builderState.lane = "blocked";
				packet.blockers.push(`Build line-stop: ${buildRes.output.slice(0, 500)}`);
				saveState(`Build line-stop for #${packet.issue.number}`);
				return false;
			}

			packet.changeSnapshot = {
				changedFiles: unique([...collectCurrentDiff(cwd), ...packet.ownedFiles]),
				touchedInterfaces: collectTouchedInterfaces(unique([...collectCurrentDiff(cwd), ...packet.ownedFiles]), cwd),
				touchedAcceptanceCriteria: inferTouchedCriteria(packet.acceptanceCriteria, unique([...collectCurrentDiff(cwd), ...packet.ownedFiles])),
				summary: `Post-build changed files: ${unique([...collectCurrentDiff(cwd), ...packet.ownedFiles]).join(", ") || "(none)"}`,
			};

			builderState.lane = "review";
			saveState(`Diff-scoped review for #${packet.issue.number}`);
			const reviewRes = await runAgent(reviewer, reviewPrompt(packet), `builder-review-${packet.issue.number}-${loop}`, {
				model: DEFAULT_REVIEW_MODEL,
				thinking: "high",
				worktreeCwd: cwd,
			});
			const reviewJson = extractJson(reviewRes.output) || { pass: true, issues: [] };
			builderState.lastReview = reviewJson;
			const reviewIssues = Array.isArray(reviewJson.issues) ? reviewJson.issues : [];
			const blockingReview = reviewIssues.filter((i: any) => /P0|P1/i.test(String(i?.severity || "")));
			if (blockingReview.length > 0) {
				const feedback = blockingReview.map((i: any) => `- [${i.severity}] ${i.summary} :: ${i.fix}`).join("\n");
				if (shouldLineStopFromText(feedback)) {
					builderState.lane = "blocked";
					packet.blockers.push(`Review line-stop: ${feedback}`);
					saveState(`Review line-stop for #${packet.issue.number}`);
					return false;
				}
				await applyRepairLoop(packet, feedback, loop);
				continue;
			}

			builderState.lane = "test";
			saveState(`Targeted testing for #${packet.issue.number}`);
			const testRes = await runAgent(tester, testPrompt(packet), `builder-test-${packet.issue.number}-${loop}`, {
				model: DEFAULT_TEST_MODEL,
				thinking: "medium",
				worktreeCwd: cwd,
			});
			const testJson = extractJson(testRes.output) || { pass: testRes.exitCode === 0, failures: [] };
			builderState.lastTests = testJson;
			const failures = Array.isArray(testJson.failures) ? testJson.failures : [];
			if (testJson.pass === false || failures.length > 0 || testRes.exitCode !== 0) {
				const feedback = failures.length > 0
					? failures.map((f: any) => `- ${f.test || f.file || "failure"}: ${f.error || f.fix_hint || "test failure"}`).join("\n")
					: `Test failure:\n${testRes.output.slice(0, 800)}`;
				if (shouldLineStopFromText(feedback)) {
					builderState.lane = "blocked";
					packet.blockers.push(`Test line-stop: ${feedback}`);
					saveState(`Test line-stop for #${packet.issue.number}`);
					return false;
				}
				await applyRepairLoop(packet, feedback, loop);
				continue;
			}

			builderState.lane = "promotion";
			saveState(`Compliance gate for #${packet.issue.number}`);
			const complianceRes = await runAgent(compliance, compliancePrompt(packet), `builder-compliance-${packet.issue.number}-${loop}`, {
				model: DEFAULT_COMPLIANCE_MODEL,
				thinking: "high",
				worktreeCwd: cwd,
			});
			const complianceJson = extractJson(complianceRes.output) || { score: 0, failed: [] };
			builderState.lastCompliance = complianceJson;
			const score = Number(complianceJson.score || 0);
			const failedReqs = Array.isArray(complianceJson.failed) ? complianceJson.failed : [];
			if (score >= COMPLIANCE_THRESHOLD) {
				builderState.lane = "ready";
				saveState(`Task #${packet.issue.number} reached ready state with compliance ${score}`);
				return true;
			}
			const feedback = failedReqs.length > 0
				? failedReqs.map((f: any) => `- ${f.requirement}: ${f.gap} :: ${f.fix}`).join("\n")
				: `Compliance score ${score}/100 below threshold ${COMPLIANCE_THRESHOLD}`;
			if (shouldLineStopFromText(feedback) || /8\/10|scope drift/i.test(feedback)) {
				builderState.lane = "blocked";
				packet.blockers.push(`Compliance line-stop: ${feedback}`);
				saveState(`Compliance line-stop for #${packet.issue.number}`);
				return false;
			}
			await applyRepairLoop(packet, feedback, loop);
		}

		builderState.lane = "blocked";
		packet.blockers.push(`Exceeded ${MAX_REPAIR_LOOPS} repair loop(s) without reaching compliance threshold`);
		saveState(`Repair loops exhausted for #${packet.issue.number}`);
		return false;
	}

	function renderState(): string {
		const p = builderState.packet;
		if (!p) {
			return [
				`pi-builder`,
				`──────────`,
				`Lane: ${builderState.lane}`,
				`No active task packet.`,
				`Use /builder-start <issue-number> to reconstruct one from GitHub.`,
			].join("\n");
		}
		return [
			`pi-builder`,
			`──────────`,
			packetSummary(p),
			``,
			`Last compliance: ${builderState.lastCompliance ? JSON.stringify(builderState.lastCompliance) : "(none)"}`,
		].join("\n");
	}

	pi.registerCommand("builder-start", {
		description: "Reconstruct builder task packet from a GitHub issue: /builder-start <issue-number>",
		handler: async (args, ctx) => {
			const issueNumber = Number(args.trim());
			if (!issueNumber) {
				ctx.ui.notify("Usage: /builder-start <issue-number>", "warning");
				return;
			}
			builderState.lane = "intake";
			const packet = reconstructTaskPacket(issueNumber);
			builderState.packet = packet;
			builderState.activeIssue = issueNumber;
			builderState.lane = packet.readiness.pass ? "build" : "blocked";
			saveState(`Task packet reconstructed for #${issueNumber}`);
			ctx.ui.notify(packetSummary(packet), packet.readiness.pass ? "success" : "warning");
		},
	});

	pi.registerCommand("builder-status", {
		description: "Show the current builder packet and lane state",
		handler: async (_args, ctx) => {
			ctx.ui.notify(renderState(), "info");
		},
	});

	pi.registerCommand("builder-sync", {
		description: "Write the current builder state back to the active GitHub issue",
		handler: async (_args, ctx) => {
			const packet = builderState.packet;
			if (!packet) {
				ctx.ui.notify("No active builder packet. Run /builder-start <issue-number> first.", "warning");
				return;
			}
			const lines = [
				`## Builder Sync`,
				``,
				`- Lane: ${builderState.lane}`,
				`- Task: #${packet.issue.number} ${packet.issue.title}`,
				`- Complexity: ${packet.complexityScore == null ? "unknown" : `${packet.complexityScore}/10`}`,
				`- Readiness: ${packet.readiness.pass ? "PASS" : "BLOCKED"}`,
				`- Changed Files: ${packet.changeSnapshot.changedFiles.join(", ") || "(none)"}`,
				`- Touched Interfaces: ${packet.changeSnapshot.touchedInterfaces.join(", ") || "(none)"}`,
				builderState.lastCompliance ? `- Compliance: ${JSON.stringify(builderState.lastCompliance)}` : "- Compliance: (not run)",
				packet.blockers.length > 0 ? `- Blockers: ${packet.blockers.join("; ")}` : `- Blockers: none`,
			];
			ghIssueComment(packet.issue.number, lines.join("\n"));
			builderState.lastSyncAt = new Date().toISOString();
			builderState.lane = builderState.lane === "ready" ? "ready" : "sync";
			saveState(`Synced builder state to GitHub for #${packet.issue.number}`);
			ctx.ui.notify(`Builder state synced to issue #${packet.issue.number}`, "success");
		},
	});

	pi.registerCommand("builder-next", {
		description: "Run the governed builder loop for the active task packet",
		handler: async (_args, ctx) => {
			const packet = builderState.packet;
			if (!packet) {
				ctx.ui.notify("No active builder packet. Run /builder-start <issue-number> first.", "warning");
				return;
			}
			if (!packet.readiness.pass) {
				builderState.lane = "blocked";
				saveState(`Cannot start builder loop for #${packet.issue.number}: readiness blocked`);
				ctx.ui.notify(`Task packet is blocked:\n${packet.blockers.join("\n")}`, "error");
				return;
			}
			const ok = await runBuilderLoop(packet, ctx);
			if (ok) {
				ctx.ui.notify(`Task #${packet.issue.number} is ready for broader validation/UAT.`, "success");
			} else {
				ctx.ui.notify(`Task #${packet.issue.number} blocked. Check /builder-status and /builder-sync.`, "warning");
			}
		},
	});

	pi.registerCommand("builder-promote", {
		description: "Run final sync and mark the active task as ready for UAT if green",
		handler: async (_args, ctx) => {
			const packet = builderState.packet;
			if (!packet) {
				ctx.ui.notify("No active builder packet. Run /builder-start <issue-number> first.", "warning");
				return;
			}
			if (builderState.lane !== "ready") {
				ctx.ui.notify("Task is not ready yet. Run /builder-next first.", "warning");
				return;
			}
			const lines = [
				`## Promotion Gate`,
				``,
				`Task #${packet.issue.number} is considered UAT-ready by pi-builder.`,
				``,
				`- Lane: ready`,
				`- Compliance threshold: ${COMPLIANCE_THRESHOLD}`,
				`- Last compliance: ${JSON.stringify(builderState.lastCompliance || {})}`,
				`- Regression surface: ${packet.regressionSurface.join(", ") || "(none)"}`,
				`- Change snapshot: ${packet.changeSnapshot.summary}`,
				`- Packet reconstruction source: GitHub issue body + comments + repo diff`,
			];
			ghIssueComment(packet.issue.number, lines.join("\n"));
			builderState.lastSyncAt = new Date().toISOString();
			saveState(`Promotion gate recorded for #${packet.issue.number}`);
			ctx.ui.notify(`Promotion gate recorded for issue #${packet.issue.number}`, "success");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		widgetCtx = ctx;
		cwd = ctx.cwd;
		applyExtensionDefaults(import.meta.url, ctx);
		ensureDirs();
		loadState();
		updateStatus();
		ctx.ui.notify(
			[
				`pi-builder ready`,
				``,
				`Commands:`,
				`  /builder-start <issue>`,
				`  /builder-next`,
				`  /builder-status`,
				`  /builder-sync`,
				`  /builder-promote`,
			].join("\n"),
			"info",
		);
	});

	pi.on("session_shutdown", async () => {
		for (const proc of agentProcesses.values()) {
			try { proc.kill("SIGTERM"); } catch {}
		}
	});
}

function unique<T>(items: T[]): T[] {
	return [...new Set(items.filter(Boolean as any))];
}
