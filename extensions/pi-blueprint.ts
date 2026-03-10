/**
 * Pi Blueprint — Interactive human-in-the-loop planning discovery
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
 * Usage: pi -ne -e extensions/pi-blueprint.ts -e extensions/theme-cycler.ts
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text, truncateToWidth, visibleWidth, matchesKey, Key } from "@mariozechner/pi-tui";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, statSync, openSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { createConnection, Socket } from "net";
import { applyExtensionDefaults } from "./themeMap.ts";

// ── Types ────────────────────────────────────────

interface AgentDef {
	name: string;
	description: string;
	tools: string;
	systemPrompt: string;
}

interface SessionHistorySegment {
	role: "user" | "assistant" | "tool";
	timestamp: string;
	title: string;
	content: string;
}

interface AlignmentCheckResult {
	status: "pass" | "needs-review" | "error";
	score: number;
	summary: string;
	missingDecisions: string[];
	contradictions: string[];
	evidence: string[];
}

type AlignmentTruthSource = "transcript" | "artifacts";

interface LocalAssetSyncResult {
	namespace: string;
	required: number;
	present: number;
	created: string[];
	updated: string[];
	missingSources: string[];
	status: "ready" | "partial" | "error";
	syncedAt: string;
}

interface PendingRevisionPrompt {
	score: number;
	scoreBand: "green" | "yellow" | "red";
	message: string;
}

type WidgetCheck = "alignment" | "assets";

interface RebuildProgressState {
	active: boolean;
	stage: string;
	detail: string;
	current: number;
	total: number;
}

interface BlueprintReviewScoreSummary {
	score: number;
	covered: number;
	missing: string[];
	ready: boolean;
	source: "specialists" | "artifacts";
	label: string;
	coverageScore: number;
	coverageMissing: string[];
	alignmentScore: number | null;
	alignmentStatus: AlignmentCheckResult["status"] | "not-run";
	effortTarget: string;
	effortKind: "required" | "none";
}

interface BlueprintWebSpecialistCardState {
	id: string;
	label: string;
	color: string;
	statusIcon: string;
	statusTone: "active" | "done" | "idle";
	statusText: string;
	detail: string;
	question: string;
	response: string;
	timestamp: string | null;
	isActive: boolean;
	isRebuildLane: boolean;
	iteration: number | null;
}

interface BlueprintWebScoreCardState {
	score: number;
	label: string;
	tone: "success" | "warning" | "error";
	active: boolean;
	prdExists: boolean;
	checklistExists: boolean;
	gateLabel: string;
	coverageLabel: string;
	alignmentLabel: string;
	effortLabel: string;
	revisionRequired: boolean;
	revisionLabel: string;
	revisionSummary: string;
	revisionActions: string;
	openMode: string;
}

interface BlueprintWebInfoCardState {
	title: string;
	score: number;
	statusText: string;
	summary: string;
	evidence: string;
	commandLine: string;
	tone: "success" | "warning" | "error";
	active: boolean;
	statusIcon: string;
}

interface BlueprintWebAssetCardState {
	title: string;
	statusText: string;
	stateText: string;
	sourceLine: string;
	warning: string;
	commandLine: string;
	tone: "success" | "warning" | "error";
	active: boolean;
	statusIcon: string;
	status: "ready" | "partial" | "error" | "not-checked";
}

interface BlueprintWebWidgetMirrorState {
	phaseLabel: string;
	specialists: BlueprintWebSpecialistCardState[];
	scoreCard: BlueprintWebScoreCardState;
	alignmentCard: BlueprintWebInfoCardState;
	assetCard: BlueprintWebAssetCardState;
	consultationCount: number;
	specialistsCovered: number;
	totalSpecialists: number;
}

interface BlueprintWebState {
	phase: Phase;
	iteration: number;
	activeConsultant: string;
	consultationCount: number;
	specialistsCovered: number;
	rebuildProgress: RebuildProgressState | null;
	lastAlignmentCheck: AlignmentCheckResult | null;
	localAssetSync: LocalAssetSyncResult | null;
	pendingRevisionPrompt: PendingRevisionPrompt | null;
	reviewScore: BlueprintReviewScoreSummary | null;
	webUrl: string;
	prdPath: string | null;
	checklistPath: string | null;
	widgetMirror: BlueprintWebWidgetMirrorState;
	chatHistory: Array<{ role: string; timestamp: string; title: string; content: string }>;
	updatedAt: string;
}

const BLUEPRINT_WEB_PORT = 3151;
const BLUEPRINT_WEB_CONTROL_PORT = 3152;

class BlueprintOverlayUI {
	private scrollOffset = 0;

	constructor(private lines: string[], private onDone: () => void) {}

	handleInput(data: string, tui: any): void {
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
		} else if (matchesKey(data, Key.down) || data === "j") {
			this.scrollOffset = Math.min(Math.max(0, this.lines.length - 1), this.scrollOffset + 1);
		} else if (matchesKey(data, Key.pageUp)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 10);
		} else if (matchesKey(data, Key.pageDown) || data === " ") {
			this.scrollOffset = Math.min(Math.max(0, this.lines.length - 1), this.scrollOffset + 10);
		} else if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c") || matchesKey(data, Key.enter)) {
			this.onDone();
			return;
		}
		tui.requestRender();
	}

	render(width: number, height: number, theme: any): string[] {
		const innerWidth = Math.max(20, width - 4);
		const bodyHeight = Math.max(8, height - 6);
		const clampedOffset = Math.min(this.scrollOffset, Math.max(0, this.lines.length - bodyHeight));
		this.scrollOffset = clampedOffset;
		const visible = this.lines.slice(clampedOffset, clampedOffset + bodyHeight);
		const border = (s: string) => theme.fg("accent", s);
		const padLine = (line: string) => border("│") + truncateToWidth(line, innerWidth) + " ".repeat(Math.max(0, innerWidth - visibleWidth(truncateToWidth(line, innerWidth)))) + border("│");
		const footer = `↑/↓ scroll  PgUp/PgDn page  Enter/Esc close`;
		const header = ` Blueprint Details `;
		const lines = [
			border("┌" + "─".repeat(innerWidth) + "┐"),
			padLine(theme.fg("accent", header) + theme.fg("dim", `${this.scrollOffset + 1}-${Math.min(this.lines.length, this.scrollOffset + bodyHeight)}/${this.lines.length}`)),
		];
		for (const line of visible) lines.push(padLine(line));
		for (let i = visible.length; i < bodyHeight; i++) lines.push(padLine(""));
		lines.push(padLine(theme.fg("dim", footer)));
		lines.push(border("└" + "─".repeat(innerWidth) + "┘"));
		return lines;
	}
}

type Phase = "interview" | "consulting" | "review" | "finalizing" | "done" | "idle";

type HierarchyLevel = "application" | "domain" | "phase" | "epic" | "task" | "atomic-step";
type ExecutionGrain = "planning-only" | "task-ready" | "sub-task-ready" | "atomic-step-ready";
type PrerequisiteStatus = "satisfied" | "missing" | "waived";
type ExecutionLane = "feature-construction" | "fast-corrective" | "broader-promotion" | "blocked-replan";
type UatScope = "local" | "epic" | "milestone";

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

interface BlueprintPrerequisite {
	id: string;
	status: PrerequisiteStatus;
}

interface BlueprintVerificationIntent {
	validators: string[];
	uatScope: UatScope;
	regressionSurface: string[];
}

interface BlueprintTaskPacket {
	hierarchyLevel: HierarchyLevel;
	complexityScore: number;
	executionGrain: ExecutionGrain;
	executionReady: boolean;
	lane: ExecutionLane;
	executionWave: number | null;
	parallelGroup: string | null;
	workerProfile: string | null;
	parallelizable: boolean;
	serialReason: string | null;
	suggestedMaxConcurrency: number | null;
	prerequisites: BlueprintPrerequisite[];
	upstreamDependencies: string[];
	downstreamDependencies: string[];
	acceptanceCriteria: string[];
	ownedAreas: string[];
	verificationIntent: BlueprintVerificationIntent;
}

type BlueprintSyncEvent = "replan" | "split" | "reprioritize";
type PlanningGateStatus = "execution-ready" | "rejected-decompose" | "red-flag-complexity-creep";

interface ParsedTask {
	id: string;
	title: string;
	body: string;
	epic: string;
	epicNum: string;
	issueNumber: number | null;
	dependencies: string[];
	complexityScore: number | null;
	prerequisiteState: PrerequisiteStatus | null;
	ownedAreas: string[];
	laneHint: ExecutionLane | null;
	executionWave: number | null;
	parallelGroup: string | null;
	workerProfile: string | null;
	parallelizable: boolean | null;
	serialReason: string | null;
	suggestedMaxConcurrency: number | null;
	validators: string[];
	regressionSurface: string[];
}

interface ParsedEpicChecklistEntry {
	title: string;
	issueNumber: number | null;
}

const CHECKLIST_PUBLISH_METADATA_PREFIXES = [
	"  - **GitHub Issue:**",
	"  - **Complexity Score:**",
	"  - **Prerequisite State:**",
	"  - **Owned Areas:**",
	"  - **Planning Gate:**",
	"  - **Gate Reason:**",
	"  - **Execution Wave:**",
	"  - **Parallel Group:**",
	"  - **Worker Profile:**",
	"  - **Parallelizable:**",
	"  - **Suggested Max Concurrency:**",
	"  - **Serial Reason:**",
];

interface ExistingIssueSummary {
	number: number;
	title: string;
	labels: string[];
}

interface ParsedEpic {
	id: string;
	title: string;
	prdBody: string;
}

// ── Helpers ──────────────────────────────────────

function displayName(name: string): string {
	return name.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function inferExecutionGrain(task: { title: string; body: string }): ExecutionGrain {
	const text = `${task.title}\n${task.body}`.toLowerCase();
	if (text.includes("atomic")) return "atomic-step-ready";
	if (text.includes("sub-task") || text.includes("subtask")) return "sub-task-ready";
	if (text.includes("epic")) return "planning-only";
	return "task-ready";
}

function needsExternalResearch(question: string, context?: string): boolean {
	const text = `${question}\n${context ?? ""}`.toLowerCase();
	const markers = [
		"check the web",
		"search the web",
		"look on the web",
		"look it up",
		"verify online",
		"original behavior",
		"used to do in the original",
		"legacy behavior",
		"historical behavior",
		"reference behavior",
		"canon",
		"official docs",
	];
	return markers.some(marker => text.includes(marker));
}

function deriveHierarchyLevel(task: { id: string; body: string }): HierarchyLevel {
	if (/^\d+\.\d+\.\d+$/.test(task.id)) return "atomic-step";
	if (/^\d+\.\d+$/.test(task.id)) return "task";
	if (/^\d+$/.test(task.id)) return "epic";
	const text = task.body.toLowerCase();
	if (text.includes("phase")) return "phase";
	if (text.includes("domain")) return "domain";
	return "task";
}

function inferComplexityScore(task: { id: string; title: string; body: string; dependencies: string[] }): number {
	const text = `${task.title}\n${task.body}`.toLowerCase();
	if (text.includes("epic") || text.includes("architecture rewrite")) return 10;
	if (text.includes("phase") || text.includes("domain")) return 8;
	if (text.includes("task-packet") || text.includes("dependency") || task.dependencies.length >= 2) return 6;
	if (text.includes("entrypoint") || text.includes("routing") || text.includes("score")) return 4;
	if (text.includes("atomic") || task.dependencies.length === 0) return 3;
	return 5;
}

function describeComplexityBand(score: number): string {
	if (score >= 8) return "red-flag";
	if (score >= 6) return "split-required";
	if (score >= 4) return "execution-ready";
	return "atomic-ready";
}

function inferPrerequisiteStatus(task: { body: string }, dependencyId: string): PrerequisiteStatus {
	const text = task.body.toLowerCase();
	if (text.includes(`waive ${dependencyId.toLowerCase()}`) || text.includes("waived prerequisite")) return "waived";
	if (text.includes(`missing ${dependencyId.toLowerCase()}`) || text.includes("missing prerequisite")) return "missing";
	return "satisfied";
}

function parseChecklistStatus(value: string): PrerequisiteStatus | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "satisfied" || normalized === "missing" || normalized === "waived") return normalized;
	return null;
}

function parseChecklistLane(value: string): ExecutionLane | null {
	const normalized = value.trim().toLowerCase();
	if (
		normalized === "feature-construction" ||
		normalized === "fast-corrective" ||
		normalized === "broader-promotion" ||
		normalized === "blocked-replan"
	) return normalized;
	return null;
}

function determineLane(score: number, prerequisites: BlueprintPrerequisite[], grain: ExecutionGrain): ExecutionLane {
	if (prerequisites.some(prereq => prereq.status === "missing") || score > 5) return "blocked-replan";
	if (grain === "atomic-step-ready" || score <= 3) return "fast-corrective";
	return "feature-construction";
}

function extractAcceptanceCriteria(taskBody: string): string[] {
	const lines = taskBody.split("\n");
	const criteria: string[] = [];
	let inAcceptanceBlock = false;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (/^\*\*Acceptance criteria:\*\*/i.test(line)) {
			inAcceptanceBlock = true;
			continue;
		}
		if (!inAcceptanceBlock) continue;
		if (/^\*\*[A-Za-z]/.test(line) || /^-\s+\*\*[A-Za-z]/.test(line)) break;
		if (/^-\s+/.test(line)) {
			criteria.push(line.replace(/^- /, "").trim());
			continue;
		}
		if (line.length === 0 && criteria.length > 0) break;
	}
	return criteria;
}

function extractOwnedAreas(taskBody: string): string[] {
	const matches = taskBody.match(/[A-Za-z0-9_./-]+\.(ts|tsx|md|json)/g) || [];
	return Array.from(new Set(matches));
}

function isChecklistMetadataLine(line: string): boolean {
	return CHECKLIST_PUBLISH_METADATA_PREFIXES.some(prefix => line.startsWith(prefix));
}

function inferWorkerProfile(packet: Pick<BlueprintTaskPacket, "lane" | "ownedAreas">): string {
	const joined = packet.ownedAreas.join(" ").toLowerCase();
	if (joined.includes("ui") || joined.includes("scene")) return "ui-gameplay";
	if (joined.includes("ghost") || joined.includes("entity") || joined.includes("system")) return "gameplay-systems";
	if (joined.includes("config") || joined.includes("type") || joined.includes("data")) return "foundation-config";
	if (joined.includes("test") || joined.includes("docs") || joined.includes("readme")) return "validation-docs";
	switch (packet.lane) {
		case "fast-corrective": return "corrective";
		case "broader-promotion": return "integration-validation";
		case "blocked-replan": return "replan";
		default: return "feature-implementation";
	}
}

function isGlobalOwnedArea(path: string): boolean {
	const normalized = path.toLowerCase();
	return normalized === "package.json" ||
		normalized === "tsconfig.json" ||
		normalized === "readme.md" ||
		normalized === "docs/prd.md" ||
		normalized === "features/00-implementation-checklist.md" ||
		normalized === "src/main.ts";
}

function buildParallelExecutionPlan(tasks: ParsedTask[]): Map<string, {
	executionWave: number;
	parallelGroup: string;
	workerProfile: string;
	parallelizable: boolean;
	serialReason: string | null;
	suggestedMaxConcurrency: number;
}> {
	const packets = new Map<string, BlueprintTaskPacket>();
	for (const task of tasks) packets.set(task.id, buildBlueprintTaskPacket(task));
	const downstream = new Map<string, string[]>();
	const indegree = new Map<string, number>();
	for (const task of tasks) {
		indegree.set(task.id, task.dependencies.length);
		for (const dep of task.dependencies) {
			if (!downstream.has(dep)) downstream.set(dep, []);
			downstream.get(dep)!.push(task.id);
		}
	}
	for (const task of tasks) {
		const packet = packets.get(task.id)!;
		packet.downstreamDependencies = downstream.get(task.id) ?? [];
	}
	const plan = new Map<string, {
		executionWave: number;
		parallelGroup: string;
		workerProfile: string;
		parallelizable: boolean;
		serialReason: string | null;
		suggestedMaxConcurrency: number;
	}>();
	let ready = tasks.filter(task => (indegree.get(task.id) ?? 0) === 0).map(task => task.id).sort();
	let wave = 1;
	const remaining = new Set(tasks.map(task => task.id));
	while (ready.length > 0) {
		const waveTasks = ready
			.map(id => tasks.find(task => task.id === id)!)
			.filter(Boolean);
		const groups: string[][] = [];
		for (const task of waveTasks) {
			const packet = packets.get(task.id)!;
			const owned = new Set(packet.ownedAreas.map(area => area.toLowerCase()));
			const inherentlySerial = packet.lane === "broader-promotion" ||
				packet.lane === "blocked-replan" ||
				packet.ownedAreas.some(isGlobalOwnedArea);
			let placed = false;
			if (!inherentlySerial) {
				for (const group of groups) {
					const conflict = group.some(existingId => {
						const existing = packets.get(existingId)!;
						return existing.ownedAreas.some(area => owned.has(area.toLowerCase()));
					});
					if (!conflict) {
						group.push(task.id);
						placed = true;
						break;
					}
				}
			}
			if (!placed) groups.push([task.id]);
		}
		const waveConcurrency = Math.min(Math.max(groups.length, 1), 4);
		groups.forEach((group, index) => {
			const groupId = `wave-${wave}-group-${index + 1}`;
			for (const taskId of group) {
				const packet = packets.get(taskId)!;
				const serialReason = group.length === 1
					? packet.ownedAreas.some(isGlobalOwnedArea)
						? "global foundation surface"
						: packet.lane === "broader-promotion" || packet.lane === "blocked-replan"
							? `lane ${packet.lane} is serialized`
							: waveTasks.length === 1
								? "dependency-gated wave"
								: "shared owned area"
					: null;
				plan.set(taskId, {
					executionWave: wave,
					parallelGroup: groupId,
					workerProfile: inferWorkerProfile(packet),
					parallelizable: group.length > 1 || groups.length > 1,
					serialReason,
					suggestedMaxConcurrency: waveConcurrency,
				});
			}
		});
		for (const taskId of ready) {
			remaining.delete(taskId);
			for (const child of downstream.get(taskId) ?? []) {
				indegree.set(child, Math.max(0, (indegree.get(child) ?? 0) - 1));
			}
		}
		ready = Array.from(remaining)
			.filter(id => (indegree.get(id) ?? 0) === 0)
			.sort();
		wave += 1;
	}
	return plan;
}

function buildBlueprintTaskPacket(task: ParsedTask): BlueprintTaskPacket {
	const hierarchyLevel = deriveHierarchyLevel(task);
	const executionGrain = inferExecutionGrain(task);
	const complexityScore = task.complexityScore ?? inferComplexityScore(task);
	const prerequisites = task.dependencies.map(id => ({
		id,
		status: task.prerequisiteState ?? inferPrerequisiteStatus(task, id),
	}));
	const lane = task.laneHint ?? determineLane(complexityScore, prerequisites, executionGrain);
	const executionReady = executionGrain !== "planning-only" &&
		complexityScore <= 5 &&
		!prerequisites.some(prereq => prereq.status === "missing") &&
		lane !== "blocked-replan";
	return {
		hierarchyLevel,
		complexityScore,
		executionGrain,
		executionReady,
		lane,
		executionWave: task.executionWave,
		parallelGroup: task.parallelGroup,
		workerProfile: task.workerProfile ?? inferWorkerProfile({ lane, ownedAreas: task.ownedAreas.length > 0 ? task.ownedAreas : extractOwnedAreas(task.body) }),
		parallelizable: task.parallelizable ?? false,
		serialReason: task.serialReason,
		suggestedMaxConcurrency: task.suggestedMaxConcurrency,
		prerequisites,
		upstreamDependencies: task.dependencies,
		downstreamDependencies: [],
		acceptanceCriteria: extractAcceptanceCriteria(task.body),
		ownedAreas: task.ownedAreas.length > 0 ? task.ownedAreas : extractOwnedAreas(task.body),
		verificationIntent: {
			validators: task.validators.length > 0
				? task.validators
				: complexityScore >= 6 ? ["planning-review", "dependency-review"] : ["planning-review"],
			uatScope: lane === "broader-promotion" ? "milestone" : "epic",
			regressionSurface: task.regressionSurface.length > 0 ? task.regressionSurface : task.dependencies,
		},
	};
}

function renderBlueprintTaskPacket(packet: BlueprintTaskPacket): string {
	const prerequisites = packet.prerequisites.length > 0
		? packet.prerequisites.map(prereq => `  - ${prereq.id}: ${prereq.status}`).join("\n")
		: "  - none";
	const ownedAreas = packet.ownedAreas.length > 0 ? packet.ownedAreas.join(", ") : "none declared yet";
	const acceptance = packet.acceptanceCriteria.length > 0
		? packet.acceptanceCriteria.map(item => `  - ${item}`).join("\n")
		: "  - derive from task detail";
	return [
		"### Blueprint Task Packet",
		`- **Hierarchy Level:** ${packet.hierarchyLevel}`,
		`- **Complexity Score:** ${packet.complexityScore}/10`,
		`- **Complexity Band:** ${describeComplexityBand(packet.complexityScore)}`,
		`- **Execution Grain:** ${packet.executionGrain}`,
		`- **Execution Ready:** ${packet.executionReady ? "yes" : "no"}`,
		`- **Execution Lane:** ${packet.lane}`,
		`- **Execution Wave:** ${packet.executionWave ?? "unassigned"}`,
		`- **Parallel Group:** ${packet.parallelGroup ?? "unassigned"}`,
		`- **Worker Profile:** ${packet.workerProfile ?? "unassigned"}`,
		`- **Parallelizable:** ${packet.parallelizable ? "yes" : "no"}`,
		`- **Suggested Max Concurrency:** ${packet.suggestedMaxConcurrency ?? "n/a"}`,
		`- **Serial Reason:** ${packet.serialReason ?? "n/a"}`,
		`- **Owned Areas:** ${ownedAreas}`,
		`- **Upstream Dependencies:** ${packet.upstreamDependencies.length > 0 ? packet.upstreamDependencies.join(", ") : "none"}`,
		`- **Downstream Dependencies:** ${packet.downstreamDependencies.length > 0 ? packet.downstreamDependencies.join(", ") : "none declared yet"}`,
		"- **Prerequisites:**",
		prerequisites,
		"- **Acceptance Criteria:**",
		acceptance,
		`- **Verification Intent:** validators=${packet.verificationIntent.validators.join(", ")}, uatScope=${packet.verificationIntent.uatScope}`,
	].join("\n");
}

function evaluatePlanningGate(packet: BlueprintTaskPacket): { status: PlanningGateStatus; reason: string } {
	if (packet.complexityScore >= 8) {
		return {
			status: "red-flag-complexity-creep",
			reason: `Complexity score ${packet.complexityScore}/10 is in the red-flag range. This is planning failure and must be decomposed or redesigned before execution.`,
		};
	}
	if (packet.executionGrain !== "planning-only" && packet.complexityScore > 5) {
		return {
			status: "rejected-decompose",
			reason: `Complexity score ${packet.complexityScore}/10 exceeds the execution-ready ceiling. Split it into smaller tasks before publication.`,
		};
	}
	if (!packet.executionReady) {
		return {
			status: "rejected-decompose",
			reason: "Task is not execution-ready. Replan prerequisites, scope, or execution grain before handing to pi-builder.",
		};
	}
	return { status: "execution-ready", reason: "Task is execution-ready for pi-builder." };
}

function renderReferenceIndex(task: ParsedTask, packet: BlueprintTaskPacket, epicNum?: number): string {
	const lines = [
		"### Reference Index",
		epicNum ? `- **Parent Epic:** #${epicNum} (${task.epic})` : `- **Parent Epic:** ${task.epic}`,
		`- **Task ID:** ${task.id}`,
		`- **Complexity Score:** ${packet.complexityScore}/10`,
		`- **Execution Lane:** ${packet.lane}`,
		`- **Execution Wave:** ${packet.executionWave ?? "unassigned"}`,
		`- **Parallel Group:** ${packet.parallelGroup ?? "unassigned"}`,
		`- **Worker Profile:** ${packet.workerProfile ?? "unassigned"}`,
		`- **Execution Ready:** ${packet.executionReady ? "yes" : "no"}`,
	];
	if (task.dependencies.length > 0) lines.push(`- **Depends On:** ${task.dependencies.join(", ")}`);
	return lines.join("\n");
}

function renderSyncEventTemplate(event: BlueprintSyncEvent): string {
	switch (event) {
		case "replan":
			return [
				"```md",
				"### Blueprint Sync Event",
				"- **Event:** replan",
				"- **Reason:** <why the task must be replanned>",
				"- **Superseded Issue:** #<current-issue>",
				"- **Replacement Issue(s):** #<new-issue>",
				"- **Carry Forward Notes:** <state, prerequisites, files, blockers>",
				"```",
			].join("\n");
		case "split":
			return [
				"```md",
				"### Blueprint Sync Event",
				"- **Event:** split",
				"- **Reason:** <why the task was too large or mixed>",
				"- **Source Issue:** #<current-issue>",
				"- **Child Issue(s):** #<child-1>, #<child-2>",
				"- **Allocation:** <what moved to each child>",
				"```",
			].join("\n");
		case "reprioritize":
			return [
				"```md",
				"### Blueprint Sync Event",
				"- **Event:** reprioritize",
				"- **Reason:** <why the order changed>",
				"- **Issue:** #<current-issue>",
				"- **Previous Lane / Target Sprint:** <old value>",
				"- **New Lane / Target Sprint:** <new value>",
				"```",
			].join("\n");
	}
}

function renderBlueprintSyncContract(): string {
	return [
		"### Blueprint Sync Contract",
		"- `replan`: create replacement issue(s), post the replan event comment, then close the superseded issue once lineage is recorded.",
		"- `split`: create child issue(s), post the split event comment on the source issue, then keep the source open only as a tracker or close it once children fully replace it.",
		"- `reprioritize`: keep the issue open, post the reprioritize event comment, and update target sprint or lane without rewriting history.",
		"",
		"#### Replan Comment Template",
		renderSyncEventTemplate("replan"),
		"",
		"#### Split Comment Template",
		renderSyncEventTemplate("split"),
		"",
		"#### Reprioritize Comment Template",
		renderSyncEventTemplate("reprioritize"),
	].join("\n");
}

function renderPlanningGateComment(task: ParsedTask, packet: BlueprintTaskPacket, gate: { status: PlanningGateStatus; reason: string }): string {
	return [
		"### Blueprint Planning Gate",
		`- **Task:** ${task.id} — ${task.title}`,
		`- **Gate Status:** ${gate.status}`,
		`- **Complexity Score:** ${packet.complexityScore}/10`,
		`- **Execution Grain:** ${packet.executionGrain}`,
		`- **Execution Lane:** ${packet.lane}`,
		`- **Reason:** ${gate.reason}`,
		`- **Required Action:** ${gate.status === "red-flag-complexity-creep" ? "Treat as complexity creep. Split or redesign before republishing." : "Decompose and republish as smaller execution-ready tasks."}`,
	].join("\n");
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

function listFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...listFilesRecursive(path));
			continue;
		}
		results.push(path);
	}
	return results;
}

function readRelativePaths(dir: string): string[] {
	return listFilesRecursive(dir).map(path => path.slice(dir.length + 1));
}

function collectSessionHistoryFromFiles(sessionDir: string): SessionHistorySegment[] {
	if (!sessionDir || !existsSync(sessionDir)) return [];
	const files = readdirSync(sessionDir)
		.filter(file => (file.endsWith(".json") || file.endsWith(".jsonl")) && file !== "pi-blueprint-state.json")
		.sort();
	return collectSessionHistoryFromFilePaths(files.map(file => join(sessionDir, file)));
}

function collectSessionHistoryFromFilePaths(paths: string[]): SessionHistorySegment[] {
	const segments: SessionHistorySegment[] = [];
	for (const path of paths) {
		try {
			const raw = readFileSync(path, "utf-8");
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				const entry = JSON.parse(line);
				if (entry.type !== "message" || !entry.message) continue;
				const msg = entry.message;
				const content = extractPersistedMessageContent(msg).trim();
				if (!content) continue;
				if (msg.role === "user") {
					segments.push({
						role: "user",
						timestamp: String(entry.timestamp || msg.timestamp || new Date().toISOString()),
						title: "User Prompt",
						content,
					});
				} else if (msg.role === "assistant") {
					segments.push({
						role: "assistant",
						timestamp: String(entry.timestamp || msg.timestamp || new Date().toISOString()),
						title: "Assistant Response",
						content,
					});
				} else if (msg.role === "toolResult") {
					segments.push({
						role: "tool",
						timestamp: String(entry.timestamp || msg.timestamp || new Date().toISOString()),
						title: `Tool Result: ${msg.toolName || "tool"}`,
						content,
					});
				}
			}
		} catch {}
	}
	return segments.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function getGlobalSessionDirsForCwd(cwd: string): string[] {
	const base = join(homedir(), ".pi", "agent", "sessions");
	if (!existsSync(base)) return [];
	const normalized = cwd.replace(/[\\/]+/g, "-").replace(/^-+|-+$/g, "");
	try {
		return readdirSync(base)
			.map(name => join(base, name))
			.filter(path => {
				const name = path.split("/").pop() || "";
				return existsSync(path) && name.includes(normalized);
			})
			.sort();
	} catch {
		return [];
	}
}

function getLatestGlobalSessionFilesForCwd(cwd: string, limit: number = 1): string[] {
	const files = getGlobalSessionDirsForCwd(cwd)
		.flatMap(dir => {
			try {
				return readdirSync(dir)
					.filter(file => file.endsWith(".jsonl"))
					.map(file => join(dir, file));
			} catch {
				return [];
			}
		})
		.map(path => {
			try {
				return { path, mtimeMs: statSync(path).mtimeMs };
			} catch {
				return null;
			}
		})
		.filter(Boolean) as Array<{ path: string; mtimeMs: number }>;
	return files
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, Math.max(1, limit))
		.map(item => item.path);
}

function dedupeSessionHistory(segments: SessionHistorySegment[]): SessionHistorySegment[] {
	const seen = new Set<string>();
	const deduped: SessionHistorySegment[] = [];
	for (const segment of segments.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
		const key = `${segment.timestamp}|${segment.role}|${segment.title}|${segment.content}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(segment);
	}
	return deduped;
}

function extractPersistedMessageContent(msg: any): string {
	const content = msg?.content;
	if (!content) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((item: any) => {
				if (item?.type === "text") return item.text || "";
				if (item?.type === "toolCall") return `Tool: ${item.name}(${JSON.stringify(item.arguments).slice(0, 200)})`;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return JSON.stringify(content).slice(0, 1000);
}

function renderFramedLine(content: string, innerWidth: number, borderRenderer: (s: string) => string): string {
	const clipped = truncateToWidth(content, innerWidth);
	return borderRenderer("│") + clipped + " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped))) + borderRenderer("│");
}

function padRenderedLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function getExtensionRepoRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function getBlueprintWebScriptPath(sourceRoot: string): string {
	return join(sourceRoot, "bin", "blueprint-dashboard-web");
}

function syncProjectAssets(cwd: string, namespace: string, sourceRoot: string): LocalAssetSyncResult {
	const sourceRoots = [
		{ source: join(sourceRoot, "agents", namespace), target: join(cwd, ".pi", "agents") },
		{ source: join(sourceRoot, "skills", namespace), target: join(cwd, ".pi", "skills") },
	];

	const created: string[] = [];
	const updated: string[] = [];
	const missingSources: string[] = [];
	let required = 0;
	let present = 0;

	for (const root of sourceRoots) {
		if (!existsSync(root.source)) {
			missingSources.push(root.source.slice(cwd.length + 1));
			continue;
		}
		const relativePaths = readRelativePaths(root.source);
		required += relativePaths.length;
		for (const relativePath of relativePaths) {
			const sourcePath = join(root.source, relativePath);
			const targetPath = join(root.target, relativePath);
			const targetDir = dirname(targetPath);
			if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
			const sourceContent = readFileSync(sourcePath, "utf-8");
			if (!existsSync(targetPath)) {
				writeFileSync(targetPath, sourceContent, "utf-8");
				created.push(relativePath);
				present++;
				continue;
			}
			const targetContent = readFileSync(targetPath, "utf-8");
			if (targetContent !== sourceContent) {
				writeFileSync(targetPath, sourceContent, "utf-8");
				updated.push(relativePath);
			}
			present++;
		}
	}

	const status = missingSources.length > 0
		? "partial"
		: present === required
			? "ready"
			: "error";

	return {
		namespace,
		required,
		present,
		created,
		updated,
		missingSources,
		status,
		syncedAt: new Date().toISOString(),
	};
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
	let lastAlignmentCheck: AlignmentCheckResult | null = null;
	let localAssetSync: LocalAssetSyncResult | null = null;
	let pendingRevisionPrompt: PendingRevisionPrompt | null = null;
	const extensionRepoRoot = getExtensionRepoRoot();
	let activeWidgetCheck: WidgetCheck | null = null;
	let widgetPulseTimer: ReturnType<typeof setInterval> | null = null;

	// Session state
	let phase: Phase = "idle";
	let consultations: ConsultRecord[] = [];
	let iteration = 0;
	let activeConsultant = "";
	let consultStartTime = 0;
	let sessionStateFile = "";
	let rebuildProgress: RebuildProgressState | null = null;
	let blueprintWebUrl = "";
	let blueprintControlSocket: Socket | null = null;
	let blueprintControlConnected = false;
	let blueprintStateFlushTimer: ReturnType<typeof setTimeout> | null = null;
	let lastBlueprintStateJson = "";
	let transcriptWatchTimer: ReturnType<typeof setInterval> | null = null;
	let lastTranscriptSignature = "";

	function getBlueprintStateFile(): string {
		return join(logDir, "blueprint-state.json");
	}

	function collectBlueprintChatHistory(ctx: ExtensionContext, maxEntries: number = 120) {
		const transcriptEntries = collectSessionHistory(ctx).map(segment => ({
			role: segment.role,
			timestamp: segment.timestamp,
			title: segment.title,
			content: segment.content,
		}));
		const consultationEntries = consultations.map(record => ({
			role: "assistant",
			timestamp: new Date(record.timestamp).toISOString(),
			title: `${displayName(record.specialist)} (iteration ${record.iteration})`,
			content: `${displayName(record.specialist)} (iteration ${record.iteration})\n\nQ: ${record.question}\n\nA: ${record.response}`,
		}));
		return [...transcriptEntries, ...consultationEntries]
			.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
			.slice(-maxEntries);
	}

	function getTranscriptSignature(ctx: ExtensionContext): string {
		try {
			const branch = ctx.sessionManager.getBranch();
			const last = branch.length > 0 ? branch[branch.length - 1] : null;
			return `${branch.length}:${JSON.stringify(last ?? null).slice(0, 500)}`;
		} catch {
			return "";
		}
	}

	function buildBlueprintWebState(ctx: ExtensionContext): BlueprintWebState {
		const specialistNames = Object.keys(SPECIALISTS);
		const reviewScore = getBlueprintReviewScore(specialistNames);
		const prdPath = join(ctx.cwd, "docs", "PRD.md");
		const checklistPath = join(ctx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
		const widgetMirror = buildBlueprintWidgetMirrorState(ctx);
		return {
			phase,
			iteration,
			activeConsultant,
			consultationCount: consultations.length,
			specialistsCovered: new Set(consultations.map(c => c.specialist)).size,
			rebuildProgress,
			lastAlignmentCheck,
			localAssetSync,
			pendingRevisionPrompt,
			reviewScore,
			webUrl: blueprintWebUrl,
			prdPath: existsSync(prdPath) ? prdPath : null,
			checklistPath: existsSync(checklistPath) ? checklistPath : null,
			widgetMirror,
			chatHistory: collectBlueprintChatHistory(ctx),
			updatedAt: new Date().toISOString(),
		};
	}

	function flushBlueprintState() {
		if (!widgetCtx || !logDir) return;
		try {
			const json = JSON.stringify(buildBlueprintWebState(widgetCtx), null, 2);
			if (json === lastBlueprintStateJson) return;
			writeFileSync(getBlueprintStateFile(), json, "utf-8");
			lastBlueprintStateJson = json;
		} catch {}
	}

	function scheduleBlueprintStateWrite() {
		if (blueprintStateFlushTimer) return;
		blueprintStateFlushTimer = setTimeout(() => {
			blueprintStateFlushTimer = null;
			flushBlueprintState();
		}, 75);
	}

	function registerBlueprintOnControl() {
		if (!blueprintControlSocket || !blueprintControlConnected) return;
		try {
			blueprintControlSocket.write(JSON.stringify({
				type: "register",
				agentId: "blueprint-main",
				sessionKey: "blueprint-main",
				info: {
					name: "pi-blueprint",
					phase,
					iteration,
					url: blueprintWebUrl,
				},
			}) + "\n");
		} catch {}
	}

	function handleBlueprintForwardedCommand(msg: any) {
		if (!msg?.forward) return;
		const body = String(msg.message || "").trim();
		if ((msg.type === "chat" || msg.type === "follow_up" || msg.type === "steer") && body) {
			pi.sendUserMessage(body);
			widgetCtx?.ui.notify(`Blueprint web chat injected a new turn.`, "info");
		}
	}

	function connectBlueprintControlSocket() {
		if (blueprintControlSocket) return;
		try {
			blueprintControlSocket = createConnection(BLUEPRINT_WEB_CONTROL_PORT, "127.0.0.1");
			blueprintControlSocket.setEncoding("utf-8");
			let buffer = "";
			blueprintControlSocket.on("data", (chunk: string) => {
				buffer += chunk;
				let nl;
				while ((nl = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, nl).trim();
					buffer = buffer.slice(nl + 1);
					if (!line) continue;
					try {
						handleBlueprintForwardedCommand(JSON.parse(line));
					} catch {}
				}
			});
			blueprintControlSocket.on("connect", () => {
				blueprintControlConnected = true;
				registerBlueprintOnControl();
			});
			blueprintControlSocket.on("error", () => {
				blueprintControlSocket = null;
				blueprintControlConnected = false;
			});
			blueprintControlSocket.on("close", () => {
				blueprintControlSocket = null;
				blueprintControlConnected = false;
			});
		} catch {
			blueprintControlSocket = null;
			blueprintControlConnected = false;
		}
	}

	function ensureBlueprintWebServer(ctx: ExtensionContext) {
		const scriptPath = getBlueprintWebScriptPath(extensionRepoRoot);
		const scriptVersion = String(statSync(scriptPath).mtimeMs);
		blueprintWebUrl = `http://127.0.0.1:${BLUEPRINT_WEB_PORT}`;
		let needsRestart = false;
		try {
			const raw = execSync(`curl -fsS '${blueprintWebUrl}/api/version'`, { encoding: "utf-8" }).trim();
			const parsed = JSON.parse(raw || "{}");
			const remoteVersion = parsed?.version ? String(parsed.version) : "";
			needsRestart = remoteVersion !== scriptVersion;
		} catch {
			needsRestart = true;
		}
		if (needsRestart) {
			try { execSync(`pids=$(lsof -ti tcp:${BLUEPRINT_WEB_PORT} -sTCP:LISTEN 2>/dev/null); if [ -n "$pids" ]; then kill $pids; fi`, { stdio: "ignore" }); } catch {}
			try { execSync(`pids=$(lsof -ti tcp:${BLUEPRINT_WEB_CONTROL_PORT} -sTCP:LISTEN 2>/dev/null); if [ -n "$pids" ]; then kill $pids; fi`, { stdio: "ignore" }); } catch {}
			try {
				const webLogPath = join(logDir || join(ctx.cwd, ".pi", "pipeline-logs"), "blueprint-dashboard-web.log");
				mkdirSync(dirname(webLogPath), { recursive: true });
				const logFd = openSync(webLogPath, "a");
				const proc = spawn(process.execPath, [scriptPath, ctx.cwd, "--port", String(BLUEPRINT_WEB_PORT), "--control-port", String(BLUEPRINT_WEB_CONTROL_PORT)], {
					detached: true,
					stdio: ["ignore", logFd, logFd],
					env: process.env,
				});
				proc.unref();
			} catch (err: any) {
				ctx.ui.notify(`Failed to start blueprint web UI: ${err.message}`, "warning");
			}
		}
		connectBlueprintControlSocket();
		scheduleBlueprintStateWrite();
	}

	function startTranscriptWatch(ctx: ExtensionContext) {
		lastTranscriptSignature = getTranscriptSignature(ctx);
		if (transcriptWatchTimer) clearInterval(transcriptWatchTimer);
		transcriptWatchTimer = setInterval(() => {
			const nextSignature = getTranscriptSignature(ctx);
			if (nextSignature !== lastTranscriptSignature) {
				lastTranscriptSignature = nextSignature;
				scheduleBlueprintStateWrite();
			}
		}, 750);
	}

	function stopTranscriptWatch() {
		if (transcriptWatchTimer) {
			clearInterval(transcriptWatchTimer);
			transcriptWatchTimer = null;
		}
	}

	setTimeout(connectBlueprintControlSocket, 1500);
	setInterval(() => {
		if (!blueprintControlConnected) connectBlueprintControlSocket();
	}, 10000);

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
		scheduleBlueprintStateWrite();
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
		scheduleBlueprintStateWrite();
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

	function logFile(key: string): string { return join(logDir, `blueprint-${key}.log`); }
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
		const path = join(sessionDir, `blueprint-${agentName}.json`);
		specialistSessions.set(agentName, path);
		return { path, isNew: !existsSync(path) };
	}

	// ── Subprocess Runner ────────────────────────

	function runAgent(
		agentDef: AgentDef,
		task: string,
		sessionKey: string,
		ctx: ExtensionContext,
		options?: { noTools?: boolean; reuseSession?: boolean; skillPaths?: string[] },
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
			"--no-prompt-templates",
			"--model", model,
			"--thinking", "off",
			"--system-prompt", agentDef.systemPrompt,
		];

		if (options?.skillPaths && options.skillPaths.length > 0) {
			for (const skillPath of options.skillPaths) {
				args.push("--skill", skillPath);
			}
		} else {
			args.push("--no-skills");
		}

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

		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const isRebuildLane = name === "req-analyst" && rebuildProgress?.active;
		const isActive = activeConsultant === name || !!isRebuildLane;
		const hasConsulted = record !== null;

		const statusIcon = isRebuildLane
			? (pulseOn ? "●" : "○")
			: isActive ? "●" : hasConsulted ? "✓" : "○";
		const statusColor = isActive ? "accent" : hasConsulted ? "success" : "dim";
		const statusText = isRebuildLane
			? `${rebuildProgress!.stage} ${rebuildProgress!.current}/${rebuildProgress!.total}`
			: activeConsultant === name ? "consulting..." : hasConsulted ? `done (iter ${record!.iteration})` : "standby";

		const nameStr = theme.fg(spec.color, theme.bold(truncate(spec.label, w)));
		const nameVisible = Math.min(spec.label.length, w);

		const statusLine = theme.fg(statusColor, `${statusIcon} ${statusText}`);
		const statusVisible = statusIcon.length + 1 + statusText.length;

		const lastQ = isRebuildLane
			? truncate(rebuildProgress!.detail || "Publishing GitHub issues...", w - 1)
			: record ? truncate(record.question, w - 1) : "—";
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

	function getBlueprintReviewScore(specialistNames: string[] = Object.keys(SPECIALISTS)): {
		score: number;
		covered: number;
		missing: string[];
		ready: boolean;
		source: "specialists" | "artifacts";
		label: string;
		coverageScore: number;
		coverageMissing: string[];
		alignmentScore: number | null;
		alignmentStatus: AlignmentCheckResult["status"] | "not-run";
		effortTarget: string;
		effortKind: "required" | "none";
	} {
		const coveredSet = new Set(consultations.map(c => c.specialist));
		const covered = specialistNames.filter(name => coveredSet.has(name)).length;
		const coverageMissing = specialistNames.filter(name => !coveredSet.has(name));
		const coverageScore = specialistNames.length > 0 ? Math.round((covered / specialistNames.length) * 100) : 0;
		const artifactSpec = widgetCtx ? loadArtifactAlignmentSpec(widgetCtx.cwd) : null;
		if (artifactSpec && lastAlignmentCheck) {
			const alignmentReady = lastAlignmentCheck.status === "pass";
			const coverageReady = coverageScore > 95;
			const artifactMissing = lastAlignmentCheck.status === "pass"
				? []
				: [
					...lastAlignmentCheck.missingDecisions,
					...lastAlignmentCheck.contradictions,
				].slice(0, 3);
			const coverageGap = coverageMissing.length > 0
				? `Missing specialist coverage: ${coverageMissing.map(displayName).join(", ")}`
				: null;
			const combinedMissing = [
				...artifactMissing,
				...(coverageGap ? [coverageGap] : []),
			];
			const combinedScore = Math.min(lastAlignmentCheck.score, coverageScore);
			return {
				score: combinedScore,
				covered,
				missing: combinedMissing,
				ready: alignmentReady && coverageReady,
				source: "artifacts",
				label: alignmentReady && coverageReady
					? "review gate"
					: !alignmentReady
						? "artifact review"
						: "planning coverage",
				coverageScore,
				coverageMissing,
				alignmentScore: lastAlignmentCheck.score,
				alignmentStatus: lastAlignmentCheck.status,
				effortTarget: !alignmentReady
					? (artifactMissing[0] || "Resolve artifact review gaps")
					: !coverageReady
						? `Consult ${coverageMissing.map(displayName).join(", ")}`
						: "No immediate effort required",
				effortKind: !alignmentReady || !coverageReady
					? "required"
					: "none",
			};
		}
		const score = coverageScore;
		const missing = coverageMissing;
		return {
			score,
			covered,
			missing,
			ready: score > 95,
			source: "specialists",
			label: `${covered}/${specialistNames.length} specialists`,
			coverageScore,
			coverageMissing,
			alignmentScore: lastAlignmentCheck?.score ?? null,
			alignmentStatus: lastAlignmentCheck?.status ?? "not-run",
			effortTarget: missing.length > 0
				? `Consult ${missing.map(displayName).join(", ")}`
				: "Run artifact alignment review",
			effortKind: missing.length > 0 ? "required" : "required",
		};
	}

	function getBlueprintPhaseLabel(): string {
		return rebuildProgress?.active
			? `Rebuilding GitHub issues — ${rebuildProgress.stage} ${rebuildProgress.current}/${rebuildProgress.total}`
			: phase === "idle" ? "Describe what you want to build."
			: phase === "interview" ? "Discovery interview in progress..."
			: phase === "consulting" ? `Consulting ${displayName(activeConsultant)}...`
			: phase === "review" ? "Reviewing findings — provide feedback or approve."
			: phase === "finalizing" ? "Generating artifacts..."
			: "Requirements discovery complete.";
	}

	function buildWebSpecialistCardState(name: string, record: ConsultRecord | null): BlueprintWebSpecialistCardState {
		const spec = SPECIALISTS[name] || { label: displayName(name), color: "dim" };
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const isRebuildLane = name === "req-analyst" && rebuildProgress?.active;
		const isActive = activeConsultant === name || !!isRebuildLane;
		const hasConsulted = record !== null;

		const statusIcon = isRebuildLane
			? (pulseOn ? "●" : "○")
			: isActive ? "●" : hasConsulted ? "✓" : "○";
		const statusText = isRebuildLane
			? `${rebuildProgress!.stage} ${rebuildProgress!.current}/${rebuildProgress!.total}`
			: activeConsultant === name ? "consulting..." : hasConsulted ? `done (iter ${record!.iteration})` : "standby";
		const detail = isRebuildLane
			? rebuildProgress!.detail || "Publishing GitHub issues..."
			: record ? record.question : "—";

		return {
			id: name,
			label: spec.label,
			color: spec.color,
			statusIcon,
			statusTone: isActive ? "active" : hasConsulted ? "done" : "idle",
			statusText,
			detail,
			question: record?.question || "",
			response: record?.response || "",
			timestamp: record?.timestamp ? new Date(record.timestamp).toISOString() : null,
			isActive,
			isRebuildLane,
			iteration: record?.iteration ?? null,
		};
	}

	function buildWebScoreCardState(ctx: ExtensionContext, specialistNames: string[]): BlueprintWebScoreCardState {
		const reviewScore = getBlueprintReviewScore(specialistNames);
		const prdExists = existsSync(join(ctx.cwd, "docs", "PRD.md"));
		const checklistExists = existsSync(join(ctx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md"));
		const tone: "success" | "warning" | "error" = reviewScore.score > 95 ? "success" : reviewScore.score > 85 ? "warning" : "error";
		const gateLabel = reviewScore.ready
			? "Review gate: pass"
			: reviewScore.source === "artifacts" && reviewScore.alignmentStatus === "pass" && reviewScore.coverageMissing.length > 0
				? `Review needed: ${reviewScore.coverageMissing.map(displayName).join(", ")}`
				: reviewScore.source === "artifacts"
					? "Review needed: artifact gaps"
					: `Review needed: ${reviewScore.missing.map(displayName).join(", ")}`;
		const revisionRequired = !!pendingRevisionPrompt && !reviewScore.ready;
		return {
			score: reviewScore.score,
			label: reviewScore.label,
			tone,
			active: !!activeWidgetCheck,
			prdExists,
			checklistExists,
			gateLabel,
			coverageLabel: `Planning coverage: ${reviewScore.coverageScore}/100`,
			alignmentLabel: reviewScore.alignmentStatus === "not-run"
				? "Artifact alignment: not run"
				: `Artifact alignment: ${reviewScore.alignmentScore}/100 · ${reviewScore.alignmentStatus}`,
			effortLabel: `${reviewScore.effortKind === "none" ? "Next step" : "Required next step"}: ${reviewScore.effortTarget}`,
			revisionRequired,
			revisionLabel: revisionRequired ? "Revision required" : "Revision clear",
			revisionSummary: revisionRequired ? pendingRevisionPrompt!.message : "",
			revisionActions: revisionRequired ? "/blueprint-revise [reason]  ·  /blueprint-dismiss-revision" : "",
			openMode: isInTmux() ? "tmux+nano" : "antigravity",
		};
	}

	function buildWebAlignmentCardState(): BlueprintWebInfoCardState {
		const status = lastAlignmentCheck?.status ?? "needs-review";
		const score = lastAlignmentCheck?.score ?? 0;
		const statusText = status === "pass"
			? "Alignment: pass"
			: status === "error"
				? "Alignment: error"
				: "Alignment: review needed";
		const summary = lastAlignmentCheck?.summary || "Run alignment to verify transcript-backed decisions.";
		const evidence = lastAlignmentCheck?.evidence?.[0] || "No transcript evidence pinned yet.";
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const statusIcon = activeWidgetCheck === "alignment"
			? (pulseOn ? "●" : "○")
			: status === "pass"
				? "✓"
				: status === "error"
					? "✗"
					: "○";
		return {
			title: "Alignment Review",
			score,
			statusText,
			summary,
			evidence,
			commandLine: "/blueprint-details  ·  /blueprint-check-alignment",
			tone: status === "pass" ? "success" : status === "error" ? "error" : "warning",
			active: activeWidgetCheck === "alignment",
			statusIcon,
		};
	}

	function buildWebAssetCardState(): BlueprintWebAssetCardState {
		const sync = localAssetSync;
		const changed = sync
			? [
				sync.created.length > 0 ? `created ${sync.created.length}` : "",
				sync.updated.length > 0 ? `updated ${sync.updated.length}` : "",
			].filter(Boolean).join(" · ") || "no local changes needed"
			: "Run /blueprint-sync-assets";
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const statusIcon = activeWidgetCheck === "assets"
			? (pulseOn ? "●" : "○")
			: sync?.status === "ready"
				? "✓"
				: sync?.status === "partial"
					? "!"
					: "○";
		return {
			title: "Local Assets",
			statusText: sync ? `${sync.present}/${sync.required} synced` : "not checked",
			stateText: sync?.status === "ready"
				? "Project assets: ready"
				: sync?.status === "partial"
					? "Project assets: partial"
					: "Project assets: review needed",
			sourceLine: "Repo source: agents/pi-blueprint + skills/pi-blueprint",
			warning: sync?.missingSources?.length
				? `Missing repo sources: ${sync.missingSources.join(", ")}`
				: changed,
			commandLine: "/blueprint-details  ·  /blueprint-sync-assets",
			tone: sync?.status === "ready" ? "success" : sync?.status === "partial" ? "warning" : "error",
			active: activeWidgetCheck === "assets",
			statusIcon,
			status: sync?.status ?? "not-checked",
		};
	}

	function buildBlueprintWidgetMirrorState(ctx: ExtensionContext): BlueprintWebWidgetMirrorState {
		const specialistNames = Object.keys(SPECIALISTS);
		const lastConsultBySpec = new Map<string, ConsultRecord>();
		for (const c of consultations) lastConsultBySpec.set(c.specialist, c);
		return {
			phaseLabel: getBlueprintPhaseLabel(),
			specialists: specialistNames.map(name => buildWebSpecialistCardState(name, lastConsultBySpec.get(name) || null)),
			scoreCard: buildWebScoreCardState(ctx, specialistNames),
			alignmentCard: buildWebAlignmentCardState(),
			assetCard: buildWebAssetCardState(),
			consultationCount: consultations.length,
			specialistsCovered: new Set(consultations.map(c => c.specialist)).size,
			totalSpecialists: specialistNames.length,
		};
	}

	function extractSessionMessageContent(entry: any): string {
		const msg = entry.message;
		if (!msg?.content) return "";
		if (typeof msg.content === "string") return msg.content;
		if (Array.isArray(msg.content)) {
			return msg.content
				.map((item: any) => {
					if (item?.type === "text") return item.text || "";
					if (item?.type === "toolCall") return `Tool: ${item.name}(${JSON.stringify(item.arguments).slice(0, 200)})`;
					return "";
				})
				.filter(Boolean)
				.join("\n");
		}
		return JSON.stringify(msg.content).slice(0, 1000);
	}

	function collectSessionHistory(ctx: ExtensionContext): SessionHistorySegment[] {
		const branch = ctx.sessionManager.getBranch();
		const branchSegments: SessionHistorySegment[] = [];
		for (const entry of branch) {
			if (entry.type !== "message" || !entry.message) continue;
			const msg = entry.message;
			const content = extractSessionMessageContent(entry).trim();
			if (!content) continue;
			if (msg.role === "user") {
				branchSegments.push({
					role: "user",
					timestamp: String(msg.timestamp || new Date().toISOString()),
					title: "User Prompt",
					content,
				});
			} else if (msg.role === "assistant") {
				branchSegments.push({
					role: "assistant",
					timestamp: String(msg.timestamp || new Date().toISOString()),
					title: "Assistant Response",
					content,
				});
			} else if (msg.role === "toolResult") {
				branchSegments.push({
					role: "tool",
					timestamp: String(msg.timestamp || new Date().toISOString()),
					title: `Tool Result: ${(msg as any).toolName || "tool"}`,
					content,
				});
			}
		}
		const globalSegments = collectSessionHistoryFromFilePaths(getLatestGlobalSessionFilesForCwd(ctx.cwd));
		const localSegments = collectSessionHistoryFromFiles(sessionDir);
		const merged = dedupeSessionHistory([
			...globalSegments,
			...localSegments,
			...branchSegments,
		]);
		return merged;
	}

	function buildSessionTranscript(ctx: ExtensionContext, maxSegments: number = 40): string {
		const segments = collectSessionHistory(ctx).slice(-maxSegments);
		return segments.map((segment, index) =>
			`[${index + 1}] ${segment.timestamp} | ${segment.title}\n${segment.content}`
		).join("\n\n");
	}

	function extractJsonObject(raw: string): any | null {
		const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
		const candidate = fenced ? fenced[1] : raw;
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start === -1 || end === -1 || end <= start) return null;
		try {
			return JSON.parse(candidate.slice(start, end + 1));
		} catch {
			return null;
		}
	}

function loadArtifactAlignmentSpec(cwd: string): { truthSource: AlignmentTruthSource; sourceLabel: string; specification: string } | null {
	const prdPath = join(cwd, "docs", "PRD.md");
	const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
	if (!existsSync(prdPath) && !existsSync(checklistPath)) return null;
	const sections: string[] = [];
	if (existsSync(prdPath)) {
		const prd = readFileSync(prdPath, "utf-8");
		sections.push(`## PRD\n${prd}`);
	}
	if (existsSync(checklistPath)) {
		const checklist = readFileSync(checklistPath, "utf-8");
		sections.push(`## Implementation Checklist\n${checklist}`);
	}
		return {
			truthSource: "artifacts",
			sourceLabel: "PRD + Implementation Checklist",
			specification: sections.join("\n\n"),
		};
	}

	function getAlignmentSkillPath(cwd: string): string | null {
		const path = join(cwd, ".pi", "skills", "session-history-search", "SKILL.md");
		return existsSync(path) ? path : null;
	}

	async function runAlignmentCheck(
		ctx: ExtensionContext,
		specification: string,
		query?: string,
	): Promise<AlignmentCheckResult> {
		const reviewer = agents.get("history-alignment-reviewer");
		const transcript = buildSessionTranscript(ctx);
		const artifactSpec = loadArtifactAlignmentSpec(ctx.cwd);
		const truthSource: AlignmentTruthSource = query ? "transcript" : artifactSpec ? "artifacts" : "transcript";
		const sourceLabel = truthSource === "artifacts" ? artifactSpec!.sourceLabel : "session transcript";
		const effectiveSpecification = truthSource === "artifacts" ? artifactSpec!.specification : specification;
		if (!transcript.trim()) {
			return {
				status: "error",
				score: 0,
				summary: "No session transcript is available for alignment review.",
				missingDecisions: [],
				contradictions: [],
				evidence: [],
			};
		}
		if (!reviewer) {
			return {
				status: "error",
				score: 0,
				summary: "history-alignment-reviewer agent is not available.",
				missingDecisions: [],
				contradictions: [],
				evidence: [],
			};
		}

		const skillPath = getAlignmentSkillPath(ctx.cwd);
		const prompt = [
			query
				? `Search the transcript for the user's query and return the most relevant evidence.`
				: truthSource === "artifacts"
					? `Review the generated planning artifacts using the PRD and implementation checklist as the primary source of truth. Use the session transcript only as a secondary audit trail if an artifact is ambiguous or internally inconsistent.`
					: `Check whether the proposed consolidated specification is aligned with what was actually decided in the session transcript.`,
			"",
			"Return JSON only with this shape:",
			`{"status":"pass|needs-review|error","score":0,"summary":"","missingDecisions":[],"contradictions":[],"evidence":[]}`,
			"",
			query ? `## Query\n${query}` : `## Source of Truth\n${sourceLabel}\n\n## Proposed Specification\n${effectiveSpecification}`,
			"",
			"## Session Transcript",
			transcript,
		].join("\n");

		const result = await runAgent(
			reviewer,
			prompt,
			query ? "history-search" : "history-alignment",
			ctx,
			{ noTools: true, reuseSession: false, skillPaths: skillPath ? [skillPath] : [] },
		);

		const parsed = extractJsonObject(result.output);
		if (!parsed) {
			return {
				status: "error",
				score: 0,
				summary: "Alignment reviewer returned non-JSON output.",
				missingDecisions: [],
				contradictions: [],
				evidence: [result.output.slice(0, 1000)],
			};
		}

		return {
			status: parsed.status === "pass" ? "pass" : parsed.status === "needs-review" ? "needs-review" : "error",
			score: typeof parsed.score === "number" ? parsed.score : 0,
			summary: typeof parsed.summary === "string" ? parsed.summary : "No summary returned.",
			missingDecisions: Array.isArray(parsed.missingDecisions) ? parsed.missingDecisions.map(String) : [],
			contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions.map(String) : [],
			evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 5) : [],
		};
	}

	function renderBlueprintScoreCard(width: number, theme: any, specialistNames: string[]): string[] {
		const reviewScore = getBlueprintReviewScore(specialistNames);
		const innerWidth = Math.max(20, width - 2);
		const prdExists = widgetCtx ? existsSync(join(widgetCtx.cwd, "docs", "PRD.md")) : false;
		const checklistExists = widgetCtx ? existsSync(join(widgetCtx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md")) : false;
		const openMode = isInTmux() ? "tmux+nano" : "antigravity";
		const compact = innerWidth < 56;
		const medium = innerWidth < 84;
		const scoreColor = reviewScore.score > 95 ? "success" : reviewScore.score > 85 ? "warning" : "error";
		const border = (content: string) => renderFramedLine(content, innerWidth, (s) => theme.fg(scoreColor, s));
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const scoreIcon = activeWidgetCheck
			? (pulseOn ? "●" : "○")
			: reviewScore.ready && !pendingRevisionPrompt
				? "✓"
				: "●";

		const titleLabel = ` ${scoreIcon} Blueprint Score `;
		const titleSuffix = compact
			? `${reviewScore.score}/100`
			: activeWidgetCheck
				? `${reviewScore.score}/100 · checking...`
				: `${reviewScore.score}/100 · ${reviewScore.label}`;
		const prdCommand = compact ? "/prd" : "/blueprint-prd";
		const checklistCommand = compact ? "/checklist" : "/blueprint-checklist";
		const modeLabel = medium ? `Mode: ${openMode}` : `Open mode: ${openMode}`;
		const coverageLabel = compact
			? `Coverage: ${reviewScore.coverageScore}/100`
			: `Planning coverage: ${reviewScore.coverageScore}/100`;
		const alignmentLabel = reviewScore.alignmentStatus === "not-run"
			? (compact ? "Align: not run" : "Artifact alignment: not run")
			: compact
				? `Align: ${reviewScore.alignmentScore}/100 ${reviewScore.alignmentStatus}`
				: `Artifact alignment: ${reviewScore.alignmentScore}/100 · ${reviewScore.alignmentStatus}`;
		const effortPrefix = reviewScore.effortKind === "none"
				? (compact ? "Next" : "Next step")
				: (compact ? "Next" : "Required next step");
		const effortLabel = compact
			? truncateToWidth(`${effortPrefix}: ${reviewScore.effortTarget}`, innerWidth - 2)
			: truncateToWidth(`${effortPrefix}: ${reviewScore.effortTarget}`, innerWidth - 2);
		const gateLabel = reviewScore.ready
			? "Review gate: pass"
			: compact
				? `Review needed: ${reviewScore.missing.length}`
				: reviewScore.source === "artifacts" && reviewScore.alignmentStatus === "pass" && reviewScore.coverageMissing.length > 0
					? `Review needed: ${reviewScore.coverageMissing.map(displayName).join(", ")}`
					: reviewScore.source === "artifacts"
						? `Review needed: artifact gaps`
						: `Review needed: ${reviewScore.missing.map(displayName).join(", ")}`;
		const revisionRequired = !!pendingRevisionPrompt && !reviewScore.ready;
		const revisionIcon = revisionRequired ? "●" : "✓";
		const revisionColor = revisionRequired ? "error" : "success";
		const revisionLabel = revisionRequired ? "Revision required" : "Revision clear";
		const revisionSummary = revisionRequired
			? truncateToWidth(pendingRevisionPrompt.message, innerWidth - 2)
			: "";
		const revisionActions = revisionRequired
			? (compact
				? "/blueprint-revise · /dismiss"
				: "/blueprint-revise [reason]  ·  /blueprint-dismiss-revision")
			: "";

		const lines = [
			theme.fg(scoreColor, "┌" + "─".repeat(innerWidth) + "┐"),
			border(
				theme.fg(scoreColor, theme.bold(titleLabel)) + theme.fg("dim", titleSuffix),
			),
			border(
				theme.fg(prdExists ? "success" : "dim", ` PRD ${prdExists ? "✓" : "○"}`) + theme.fg("muted", `  ${prdCommand}`),
			),
			border(
				theme.fg(checklistExists ? "success" : "dim", ` Checklist ${checklistExists ? "✓" : "○"}`) + theme.fg("muted", `  ${checklistCommand}`),
			),
			border(
				theme.fg(scoreColor, ` ${gateLabel}`),
			),
			border(theme.fg("warning", ` ${coverageLabel}`)),
			border(theme.fg(reviewScore.alignmentStatus === "pass" ? "success" : reviewScore.alignmentStatus === "not-run" ? "dim" : "warning", ` ${alignmentLabel}`)),
			border(theme.fg(reviewScore.effortKind === "required" ? "accent" : "dim", ` ${effortLabel}`)),
			border(
				theme.fg(revisionColor, ` ${revisionIcon} ${revisionLabel}`),
			),
			border(theme.fg("dim", ` ${modeLabel}`)),
		];
		if (revisionRequired) {
			lines.push(
				border(theme.fg(scoreColor, " Revision decision required")),
				border(theme.fg("muted", ` ${revisionSummary}`)),
				border(theme.fg(scoreColor, ` ${revisionActions}`)),
			);
		}
		lines.push(theme.fg(scoreColor, "└" + "─".repeat(innerWidth) + "┘"));
		return lines;
	}

	function renderAlignmentCard(width: number, theme: any): string[] {
		const innerWidth = Math.max(20, width - 2);
		const compact = innerWidth < 72;
		const border = (content: string) => renderFramedLine(content, innerWidth, (s) => theme.fg("dim", s));

		const status = lastAlignmentCheck?.status ?? "needs-review";
		const score = lastAlignmentCheck?.score ?? 0;
		const statusText = status === "pass"
			? "Alignment: pass"
			: status === "error"
				? "Alignment: error"
				: "Alignment: review needed";
		const summary = lastAlignmentCheck?.summary
			? truncateToWidth(lastAlignmentCheck.summary, Math.min(innerWidth - 2, 72))
			: "Run alignment to verify transcript-backed decisions.";
		const commandLine = compact
			? "/blueprint-details"
			: "/blueprint-details  ·  /blueprint-check-alignment";
		const evidence = lastAlignmentCheck?.evidence?.[0]
			? truncateToWidth(lastAlignmentCheck.evidence[0], Math.min(innerWidth - 2, 56))
			: "No transcript evidence pinned yet.";
		const statusColor = status === "pass" ? "success" : status === "error" ? "error" : "warning";
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const statusIcon = activeWidgetCheck === "alignment"
			? (pulseOn ? "●" : "○")
			: status === "pass"
				? "✓"
				: status === "error"
					? "✗"
					: "○";
		const title = ` ${statusIcon} Alignment Review `;

		return [
			theme.fg("dim", "┌" + "─".repeat(innerWidth) + "┐"),
			border(theme.fg(statusColor, theme.bold(title)) + theme.fg("dim", activeWidgetCheck === "alignment" ? `${score}/100 · checking...` : `${score}/100 · ${statusText}`)),
			border(theme.fg("muted", ` ${summary}`)),
			border(theme.fg("dim", ` Evidence: ${evidence}`)),
			border(theme.fg("muted", ` ${commandLine}`)),
			theme.fg("dim", "└" + "─".repeat(innerWidth) + "┘"),
		];
	}

	function renderLocalAssetCard(width: number, theme: any): string[] {
		const innerWidth = Math.max(20, width - 2);
		const compact = innerWidth < 76;
		const border = (content: string) => renderFramedLine(content, innerWidth, (s) => theme.fg("dim", s));

		const sync = localAssetSync;
		const statusText = sync
			? `${sync.present}/${sync.required} synced`
			: "not checked";
		const stateText = sync?.status === "ready"
			? "Project assets: ready"
			: sync?.status === "partial"
				? "Project assets: partial"
				: "Project assets: review needed";
		const stateColor = sync?.status === "ready" ? "success" : sync?.status === "partial" ? "warning" : "error";
		const changed = sync
			? [
				sync.created.length > 0 ? `created ${sync.created.length}` : "",
				sync.updated.length > 0 ? `updated ${sync.updated.length}` : "",
			].filter(Boolean).join(" · ") || "no local changes needed"
			: "Run /blueprint-sync-assets";
		const sourceLine = compact
			? "Repo: agents + skills"
			: "Repo source: agents/pi-blueprint + skills/pi-blueprint";
		const warning = sync?.missingSources?.length
			? truncateToWidth(`Missing repo sources: ${sync.missingSources.join(", ")}`, innerWidth - 2)
			: changed;
		const pulseOn = Math.floor(Date.now() / 450) % 2 === 0;
		const statusIcon = activeWidgetCheck === "assets"
			? (pulseOn ? "●" : "○")
			: sync?.status === "ready"
				? "✓"
				: sync?.status === "partial"
					? "!"
					: "○";
		const title = ` ${statusIcon} Local Assets `;

			return [
			theme.fg("dim", "┌" + "─".repeat(innerWidth) + "┐"),
			border(theme.fg(stateColor, theme.bold(title)) + theme.fg("dim", activeWidgetCheck === "assets" ? `${statusText} · syncing...` : statusText)),
			border(theme.fg("muted", ` ${sourceLine}`)),
			border(theme.fg(sync?.missingSources?.length ? "warning" : "dim", ` ${truncateToWidth(warning, innerWidth - 2)}`)),
			border(theme.fg("muted", compact ? " /blueprint-details" : " /blueprint-details  ·  /blueprint-sync-assets")),
			theme.fg("dim", "└" + "─".repeat(innerWidth) + "┘"),
			];
	}

	function buildBlueprintOverlayLines(): string[] {
		const reviewScore = getBlueprintReviewScore();
		const lines: string[] = [];
		lines.push(`Blueprint Score: ${reviewScore.score}/100`);
		lines.push(`Planning Coverage: ${reviewScore.coverageScore}/100 (${reviewScore.covered}/${Object.keys(SPECIALISTS).length} specialists)`);
		lines.push(`Artifact Alignment: ${reviewScore.alignmentStatus === "not-run" ? "not run" : `${reviewScore.alignmentScore}/100 · ${reviewScore.alignmentStatus}`}`);
		lines.push(`Review Gate: ${reviewScore.ready ? "pass" : "review needed"}`);
		lines.push(`${reviewScore.effortKind === "none" ? "Next Step" : "Required Next Step"}: ${reviewScore.effortTarget}`);
		if (reviewScore.coverageMissing.length > 0) lines.push(`Missing Specialists: ${reviewScore.coverageMissing.map(displayName).join(", ")}`);
		if (pendingRevisionPrompt) {
			lines.push("");
			lines.push("Revision Decision");
			lines.push(pendingRevisionPrompt.message);
			lines.push("Actions: /blueprint-revise [reason] | /blueprint-dismiss-revision");
		}
		lines.push("");
		lines.push("Alignment Review");
		if (lastAlignmentCheck) {
			lines.push(`Status: ${lastAlignmentCheck.status}`);
			lines.push(`Score: ${lastAlignmentCheck.score}/100`);
			lines.push(`Summary: ${lastAlignmentCheck.summary}`);
			if (lastAlignmentCheck.missingDecisions.length > 0) {
				lines.push("Missing Decisions:");
				for (const item of lastAlignmentCheck.missingDecisions) lines.push(`- ${item}`);
			}
			if (lastAlignmentCheck.contradictions.length > 0) {
				lines.push("Contradictions:");
				for (const item of lastAlignmentCheck.contradictions) lines.push(`- ${item}`);
			}
			if (lastAlignmentCheck.evidence.length > 0) {
				lines.push("Evidence:");
				for (const item of lastAlignmentCheck.evidence) lines.push(`- ${item}`);
			}
		} else {
			lines.push("No alignment review has been run yet.");
		}
		lines.push("");
		lines.push("Local Assets");
		if (localAssetSync) {
			lines.push(`Status: ${localAssetSync.status}`);
			lines.push(`Synced: ${localAssetSync.present}/${localAssetSync.required}`);
			lines.push(`Repo Source: ${join(extensionRepoRoot, "agents", "pi-blueprint")} + ${join(extensionRepoRoot, "skills", "pi-blueprint")}`);
			if (localAssetSync.created.length > 0) {
				lines.push("Created:");
				for (const item of localAssetSync.created) lines.push(`- ${item}`);
			}
			if (localAssetSync.updated.length > 0) {
				lines.push("Updated:");
				for (const item of localAssetSync.updated) lines.push(`- ${item}`);
			}
			if (localAssetSync.missingSources.length > 0) {
				lines.push("Missing Repo Sources:");
				for (const item of localAssetSync.missingSources) lines.push(`- ${item}`);
			}
		} else {
			lines.push("No asset sync has been recorded yet.");
		}
		lines.push("");
		lines.push("Commands");
		lines.push("- /blueprint-check-alignment");
		lines.push("- /blueprint-search-history <query>");
		lines.push("- /blueprint-sync-assets");
		lines.push("- /blueprint-revise [reason]");
		lines.push("- /blueprint-prd");
		lines.push("- /blueprint-checklist");
		return lines;
	}

	async function openBlueprintDetailsOverlay(ctx: ExtensionContext) {
		const lines = buildBlueprintOverlayLines();
		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const component = new BlueprintOverlayUI(lines, () => done());
			return {
				render: (width: number) => component.render(width, 36, theme),
				handleInput: (data: string) => component.handleInput(data, tui),
				invalidate() {},
			};
		}, {
			overlay: true,
			overlayOptions: { width: "95%", anchor: "center" },
		});
	}

	function updateWidget() {
		if (!widgetCtx) return;
		registerBlueprintOnControl();
		scheduleBlueprintStateWrite();

		widgetCtx.ui.setWidget("pi-blueprint", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);

			return {
				render(width: number): string[] {
					const phaseLabel = getBlueprintPhaseLabel();

					const headerLine = theme.fg("accent", theme.bold("Pi Blueprint")) +
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

						outputLines.push("");
						const scoreCard = renderBlueprintScoreCard(width, theme, specialistNames);
						for (const line of scoreCard) outputLines.push(line);

						outputLines.push("");
						const secondaryGap = 3;
						const secondaryColWidth = Math.floor((width - secondaryGap) / 2);
						const useSideBySide = secondaryColWidth >= 34;
							if (useSideBySide) {
								const alignmentCard = renderAlignmentCard(secondaryColWidth, theme);
								const assetCard = renderLocalAssetCard(secondaryColWidth, theme);
								const rowCount = Math.max(alignmentCard.length, assetCard.length);
								for (let line = 0; line < rowCount; line++) {
									const left = padRenderedLine(alignmentCard[line] || "", secondaryColWidth);
									const right = padRenderedLine(assetCard[line] || "", secondaryColWidth);
									outputLines.push(left + " ".repeat(secondaryGap) + right);
								}
							} else {
							const alignmentCard = renderAlignmentCard(width, theme);
							for (const line of alignmentCard) outputLines.push(line);

							outputLines.push("");
							const assetCard = renderLocalAssetCard(width, theme);
							for (const line of assetCard) outputLines.push(line);
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

	function reconcileRevisionPrompt() {
		const reviewScore = getBlueprintReviewScore();
		if (reviewScore.ready) {
			pendingRevisionPrompt = null;
		}
	}

	function startWidgetCheck(name: WidgetCheck) {
		activeWidgetCheck = name;
		if (!widgetPulseTimer) {
			widgetPulseTimer = setInterval(() => updateWidget(), 450);
		}
		updateWidget();
	}

	function stopWidgetCheck(name?: WidgetCheck) {
		if (!name || activeWidgetCheck === name) activeWidgetCheck = null;
		if (widgetPulseTimer) {
			clearInterval(widgetPulseTimer);
			widgetPulseTimer = null;
		}
		updateWidget();
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
				description: "If true, specialist gets tools and session persistence for codebase inspection or external research (slower). Default: false, but research questions may still auto-enable tools.",
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

			const useResearch = needsExternalResearch(question, context);
			const useDeep = deep === true;
			const allowTools = useDeep || useResearch;
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
				...(useResearch
					? [
						`External verification is required for this question.`,
						`Use available web/tools to verify original or reference behavior instead of asking the operator to browse for you.`,
						`If sources disagree, summarize the disagreement and recommend the safest v1 decision.`,
					]
					: []),
			].join("\n");
			const timer = setInterval(() => updateWidget(), 1000);

			const result = await runAgent(agentDef, fullPrompt, agentName, ctx as ExtensionContext, {
				noTools: !allowTools,
				reuseSession: useDeep,
			});
			clearInterval(timer);

			iteration++;
			const record: ConsultRecord = {
				specialist: agentName,
				question,
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
			const spec = SPECIALISTS[a.specialist] || { label: a.specialist, color: "dim" as const };
			const preview = (a.question || "").length > 60 ? (a.question || "").slice(0, 57) + "..." : (a.question || "");
			return new Text(
				theme.fg("toolTitle", theme.bold("consult_specialist ")) +
				theme.fg(spec.color as any, `[${spec.label}] `) +
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

			const reviewScore = getBlueprintReviewScore();
			if (!reviewScore.ready) {
				phase = "review";
				updateWidget();
				const missingList = reviewScore.source === "specialists"
					? reviewScore.missing.map(displayName).join(", ")
					: reviewScore.missing.join(", ");
				const missingLabel = reviewScore.source === "specialists"
					? "Missing specialist coverage"
					: "Outstanding review gaps";
				return {
					content: [{
						type: "text" as const,
						text:
							`Blueprint score is ${reviewScore.score}/100. ` +
							`Another review cycle is required before artifact generation.\n\n` +
							`${missingLabel}: ${missingList || "unknown review gap"}\n` +
							`Address the required review gaps, then retry generation.`,
					}],
					details: { status: "error", score: reviewScore.score, missing: reviewScore.missing },
				};
			}

			startWidgetCheck("alignment");
			try {
				lastAlignmentCheck = await runAlignmentCheck(ctx as ExtensionContext, specification);
				reconcileRevisionPrompt();
				updateWidget();
			} finally {
				stopWidgetCheck("alignment");
			}
			if (lastAlignmentCheck.status !== "pass") {
				phase = "review";
				updateWidget();
				return {
					content: [{
						type: "text" as const,
						text:
							`Transcript alignment check failed (${lastAlignmentCheck.score}/100).\n\n` +
							`${lastAlignmentCheck.summary}\n\n` +
							(lastAlignmentCheck.missingDecisions.length > 0
								? `Missing decisions:\n- ${lastAlignmentCheck.missingDecisions.join("\n- ")}\n\n`
								: "") +
							(lastAlignmentCheck.contradictions.length > 0
								? `Contradictions:\n- ${lastAlignmentCheck.contradictions.join("\n- ")}\n\n`
								: "") +
							`Run another review cycle before generating artifacts.`,
					}],
					details: { status: "error", alignment: lastAlignmentCheck },
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
				`- Each execution-ready task must include enough metadata for pi-builder to reconstruct context from GitHub issue content alone`,
				``,
				`CHECKLIST FORMAT (MANDATORY — the pipeline parser requires this exact structure):`,
				``,
				`## Epic 1: Epic Title Here`,
				``,
				`- [ ] **1.1 — Task title here**`,
				`  - **Description:** What to implement...`,
				`  - **Complexity Score:** 4/10`,
				`  - **Prerequisite State:** satisfied`,
				`  - **Execution Lane:** feature-construction`,
				`  - **Owned Areas:** src/example.ts, docs/example.md`,
				`  - **Files to create/modify:** file.ts`,
				`  - **Acceptance criteria:**`,
				`    - Criterion 1`,
				`    - Criterion 2`,
				`  - **Dependencies:** None (or 1.1, 1.2)`,
				`  - **Validators:** planning-review`,
				`  - **Regression Surface:** file.ts`,
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
				`- Complexity score is the canonical planning budget on a 1-10 scale`,
				`- Score bands: 1-3 = atomic-ready, 4-5 = execution-ready, 6-7 = split-required, 8-10 = red-flag complexity creep`,
				`- Checklist entries must remain human-scannable even with metadata; keep values short and operational`,
			].join("\n");

			const timer = setInterval(() => updateWidget(), 1000);
			const result = await runAgent(prdWriter, prdPrompt, "prd-writer", ctx as ExtensionContext, {
				noTools: false,
				reuseSession: true,
			});
			clearInterval(timer);

			const prdExists = existsSync(prdPath);
			const checklistExists = existsSync(checklistPath);
			if (checklistExists) {
				setRebuildProgress("parallel", 0, 1, "Planning execution waves and parallel groups");
				await applyParallelExecutionPlanToChecklist(checklistPath, ctx as ExtensionContext);
				clearRebuildProgress();
			}

			// Publish to GitHub if repo is ready
			const cwd = (ctx as ExtensionContext).cwd;
			const ghStatus = isGitHubReady(cwd);
			let ghSummary = "";

			if (ghStatus.ready && prdExists && checklistExists) {
				const pub = await publishToGitHub(cwd, checklistPath, prdPath, ctx as ExtensionContext, { skipParallelPlanning: true });
				if (pub.tasksCreated > 0 || pub.tasksUpdated > 0 || pub.epicsUpdated > 0 || pub.tasksRejected > 0) {
					const epicList = Array.from(pub.epicIssueNumbers.entries())
						.map(([id, num]) => `  #${num} — ${id}`)
						.join("\n");
					const rejectedSummary = pub.rejectedTasks.length > 0
						? [
							`  ! ${pub.tasksRejected} task(s) rejected by planning gate`,
							...pub.rejectedTasks.map(task => `    - ${task.taskId}: ${task.status} — ${task.reason}`),
						].join("\n")
						: "";
					ghSummary = [
						``,
						`GitHub Issues:`,
						`  ✓ ${pub.epicsCreated} epic(s) created` + (pub.epicsUpdated > 0 ? `, ${pub.epicsUpdated} updated` : ""),
						epicList,
						`  ✓ ${pub.tasksCreated} task(s) created` + (pub.tasksUpdated > 0 ? `, ${pub.tasksUpdated} updated` : "") + (pub.tasksFailed > 0 ? ` (${pub.tasksFailed} failed)` : ""),
						rejectedSummary,
						`  ✓ Checklist updated with issue numbers`,
						pub.repoUrl ? `  View: ${pub.repoUrl}/issues` : "",
					].filter(Boolean).join("\n");
				}
			} else if (!ghStatus.ready) {
				ghSummary = `\nGitHub: skipped (${ghStatus.reason}). Use /blueprint-rebuild-issues later.`;
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
				!ghStatus.ready ? `  • Set up GitHub repo then /blueprint-rebuild-issues` : "",
				`  • Start development: pi-builder`,
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

	pi.registerCommand("blueprint-status", {
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

	pi.registerCommand("blueprint-history", {
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

				ctx.ui.notify(`Watching: ${label}`, "info");
			return true;
		} catch (err: any) {
			ctx.ui.notify(`Failed to open tmux pane: ${err.message}`, "error");
			return false;
		}
	}

	function findLatestLog(specialistName: string): string | null {
		if (!logDir || !existsSync(logDir)) return null;
		const logs = readdirSync(logDir)
			.filter(f => f.startsWith(`blueprint-${specialistName}`) && f.endsWith(".log"))
			.sort();
		return logs.length > 0 ? logs[logs.length - 1] : null;
	}

	pi.registerCommand("blueprint-logs", {
		description: "Open latest log for each specialist that has one (tmux panes)",
		handler: async (_args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux. Run pi inside tmux to use /blueprint-logs.", "warning");
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
					"info",
			);
		},
	});

	pi.registerCommand("blueprint-watch", {
		description: "Open a tmux pane tailing a specific specialist's latest log",
		handler: async (args, ctx) => {
			if (!isInTmux()) {
				ctx.ui.notify("Not inside tmux. Run pi inside tmux to use /blueprint-watch.", "warning");
				return;
			}
			if (!args || !args.trim()) {
				ctx.ui.notify(
					"Usage: /blueprint-watch <specialist>\n" +
					"Available: " + Object.keys(SPECIALISTS).join(", ") + ", prd-writer\n\n" +
					"Or use /blueprint-logs to open all at once.",
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
				const label = match.replace(/^blueprint-/, "").replace(/-\d+/, "").replace(/\.log$/, "");
				openTmuxTail(join(logDir, match), displayName(label), ctx);
				return;
			}

			const spec = SPECIALISTS[pattern];
			openTmuxTail(join(logDir, latest), spec ? spec.label : displayName(pattern), ctx);
		},
	});

	pi.registerCommand("blueprint-close-panes", {
		description: "Close all specialist watch panes and document panes",
		handler: async (_args, ctx) => {
			let closed = 0;
			for (const paneId of watchPaneIds) {
				try {
					execSync(`tmux kill-pane -t ${paneId}`, { stdio: "ignore" });
					closed++;
				} catch {}
			}
			watchPaneIds = [];
			if (documentPaneId) {
				try { execSync(`tmux kill-pane -t ${documentPaneId}`, { stdio: "ignore" }); closed++; } catch {}
				documentPaneId = "";
			}
			ctx.ui.notify(closed > 0 ? `Closed ${closed} pane${closed !== 1 ? "s" : ""}.` : "No panes open.", "info");
		},
	});

	let documentPaneId = "";

	function openBlueprintDocument(filePath: string, label: string, ctx: ExtensionContext) {
		if (!existsSync(filePath)) {
			ctx.ui.notify(`No ${label} found at ${filePath}. Generate artifacts first.`, "warning");
			return;
		}

		if (isInTmux()) {
			if (documentPaneId) {
				try { execSync(`tmux kill-pane -t ${documentPaneId}`, { stdio: "ignore" }); } catch {}
				documentPaneId = "";
			}
			try {
				const out = execSync(
					`tmux split-window -h -p 45 -P -F '#{pane_id}' "nano '${filePath.replace(/'/g, `'\"'\"'`)}'"`,
					{ encoding: "utf-8" },
				).trim();
				documentPaneId = out;
				execSync(`tmux last-pane`, { stdio: "ignore" });
				ctx.ui.notify(`${label} opened in nano (pane ${documentPaneId}). Exit nano to close or use /blueprint-close-panes.`, "info");
				return;
			} catch (err: any) {
				ctx.ui.notify(`Failed to open ${label} in tmux pane: ${err.message}`, "error");
				return;
			}
		}

		const antigravityBin = "/Users/tonyholovka/.antigravity/antigravity/bin/antigravity";
		try {
			execSync(`'${antigravityBin}' -r '${filePath.replace(/'/g, `'\"'\"'`)}'`, { stdio: "ignore" });
			ctx.ui.notify(`${label} opened in Antigravity.`, "info");
		} catch (err: any) {
			try {
				execSync(`open -a Antigravity '${filePath.replace(/'/g, `'\"'\"'`)}'`, { stdio: "ignore" });
				ctx.ui.notify(`${label} opened in Antigravity.`, "info");
			} catch (fallbackErr: any) {
				ctx.ui.notify(`Failed to open ${label}: ${fallbackErr.message || err.message}`, "error");
			}
		}
	}

	pi.registerCommand("blueprint-prd", {
		description: "Open the PRD in nano inside tmux, or Antigravity outside tmux",
		handler: async (_args, ctx) => {
			openBlueprintDocument(join(ctx.cwd, "docs", "PRD.md"), "PRD", ctx);
		},
	});

	pi.registerCommand("blueprint-checklist", {
		description: "Open the implementation checklist in nano inside tmux, or Antigravity outside tmux",
		handler: async (_args, ctx) => {
			openBlueprintDocument(join(ctx.cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md"), "implementation checklist", ctx);
		},
	});

	pi.registerCommand("blueprint-web", {
		description: "Start or reuse the Blueprint web mirror and open it in the default browser",
		handler: async (_args, ctx) => {
			ensureBlueprintWebServer(ctx);
			if (!blueprintWebUrl) blueprintWebUrl = `http://127.0.0.1:${BLUEPRINT_WEB_PORT}`;
			try {
				execSync(`open '${blueprintWebUrl}'`, { stdio: "ignore" });
			} catch {}
			ctx.ui.notify(`Blueprint web UI: ${blueprintWebUrl}`, "info");
			updateWidget();
		},
	});

	pi.registerCommand("blueprint-sync-assets", {
		description: "Sync repo-managed pi-blueprint agents and skills into the local project .pi runtime",
		handler: async (_args, ctx) => {
			startWidgetCheck("assets");
			try {
				localAssetSync = syncProjectAssets(ctx.cwd, "pi-blueprint", extensionRepoRoot);
				agents = scanAgents(ctx.cwd);
				updateWidget();
				const summary = [
					`Local asset sync: ${localAssetSync.status}`,
					`Present: ${localAssetSync.present}/${localAssetSync.required}`,
					localAssetSync.created.length > 0 ? `Created:\n- ${localAssetSync.created.join("\n- ")}` : "",
					localAssetSync.updated.length > 0 ? `Updated:\n- ${localAssetSync.updated.join("\n- ")}` : "",
					localAssetSync.missingSources.length > 0 ? `Missing repo sources:\n- ${localAssetSync.missingSources.join("\n- ")}` : "",
				].filter(Boolean).join("\n\n");
				ctx.ui.notify(summary, localAssetSync.status === "ready" ? "info" : "warning");
			} finally {
				stopWidgetCheck("assets");
			}
		},
	});

		pi.registerCommand("blueprint-check-alignment", {
			description: "Run a transcript-backed alignment review against the current planning state",
			handler: async (_args, ctx) => {
				const artifactSpec = loadArtifactAlignmentSpec(ctx.cwd);
				const specification = artifactSpec
					? artifactSpec.specification
					: consultations.length > 0
						? consultations
							.map(c => `### ${displayName(c.specialist)}\nQ: ${c.question}\nA: ${c.response}`)
							.join("\n\n")
						: "No consolidated consultation summary is available yet.";
			startWidgetCheck("alignment");
			try {
				lastAlignmentCheck = await runAlignmentCheck(ctx, specification);
				reconcileRevisionPrompt();
				updateWidget();
			} finally {
				stopWidgetCheck("alignment");
			}
			const details = [
				`Alignment score: ${lastAlignmentCheck.score}/100`,
				`Status: ${lastAlignmentCheck.status}`,
				`Summary: ${lastAlignmentCheck.summary}`,
				lastAlignmentCheck.missingDecisions.length > 0 ? `Missing decisions:\n- ${lastAlignmentCheck.missingDecisions.join("\n- ")}` : "",
				lastAlignmentCheck.contradictions.length > 0 ? `Contradictions:\n- ${lastAlignmentCheck.contradictions.join("\n- ")}` : "",
				lastAlignmentCheck.evidence.length > 0 ? `Evidence:\n- ${lastAlignmentCheck.evidence.join("\n- ")}` : "",
			].filter(Boolean).join("\n\n");
			ctx.ui.notify(details, lastAlignmentCheck.status === "pass" ? "info" : "warning");
		},
	});

	pi.registerCommand("blueprint-search-history", {
		description: "Search the current session transcript for relevant decision segments",
		handler: async (args, ctx) => {
			const query = args?.trim();
			if (!query) {
				ctx.ui.notify("Usage: /blueprint-search-history <query>", "info");
				return;
			}
			let result;
			startWidgetCheck("alignment");
			try {
				result = await runAlignmentCheck(ctx, "", query);
				lastAlignmentCheck = result.status === "error" ? lastAlignmentCheck : {
					...result,
					status: result.status === "pass" ? "pass" : "needs-review",
				};
				reconcileRevisionPrompt();
				updateWidget();
			} finally {
				stopWidgetCheck("alignment");
			}
			const output = [
				`History search: ${query}`,
				`Summary: ${result.summary}`,
				result.evidence.length > 0 ? `Relevant segments:\n- ${result.evidence.join("\n- ")}` : "No relevant segments returned.",
			].join("\n\n");
			ctx.ui.notify(output, result.status === "error" ? "error" : "info");
		},
	});

	pi.registerCommand("blueprint-details", {
		description: "Open a full-screen scrollable overlay with blueprint score, alignment, and asset details",
		handler: async (_args, ctx) => {
			await openBlueprintDetailsOverlay(ctx);
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

	function shellExecAsync(cmd: string, cwd?: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
		return new Promise((resolveResult) => {
			const proc = spawn("zsh", ["-lc", cmd], {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: process.env,
			});
			let stdout = "";
			let stderr = "";
			proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
			proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
			proc.on("error", (error) => {
				resolveResult({ ok: false, stdout: stdout.trim(), stderr: error.message || stderr.trim() });
			});
			proc.on("close", (code) => {
				resolveResult({
					ok: code === 0,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
				});
			});
		});
	}

	function parseChecklist(checklistPath: string): { epics: Map<string, ParsedEpicChecklistEntry>; tasks: ParsedTask[] } {
		const raw = readFileSync(checklistPath, "utf-8");
		const epics = new Map<string, ParsedEpicChecklistEntry>();
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
				epics.set(currentEpicId, { title: currentEpic, issueNumber: null });
				continue;
			}

			const epicIssueMatch = line.match(/^\s*-\s+\[[ x]\]\s+\[#(\d+)\s+Epic:/i);
			if (epicIssueMatch && currentEpicId && !currentTask) {
				const epicEntry = epics.get(currentEpicId);
				if (epicEntry && epicEntry.issueNumber == null) {
					epicEntry.issueNumber = parseInt(epicIssueMatch[1], 10);
				}
				continue;
			}

			// Task line: - [ ] **1.1 — Title**
			const taskMatch = line.match(/^-\s+\[[ x]\]\s+\*\*(.+?)\s*[—–-]+\s*(.+?)\*\*(?:\s+\(#(\d+)\))?/);
			if (taskMatch) {
				flushTask();
				const id = taskMatch[1].trim();
				const title = taskMatch[2].trim();
				currentTask = {
					id,
					title,
					body: "",
					epic: currentEpicId || "Tasks",
					epicNum: currentEpicNum,
					issueNumber: taskMatch[3] ? parseInt(taskMatch[3], 10) : null,
					dependencies: [],
					complexityScore: null,
					prerequisiteState: null,
					ownedAreas: [],
					laneHint: null,
					executionWave: null,
					parallelGroup: null,
					workerProfile: null,
					parallelizable: null,
					serialReason: null,
					suggestedMaxConcurrency: null,
					validators: [],
					regressionSurface: [],
				};
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
				const scoreMatch = line.match(/^\s+[-*]\s+\*\*Complexity(?: Score)?:\*\*\s*(\d+)/i);
				if (scoreMatch) currentTask.complexityScore = parseInt(scoreMatch[1], 10);
				const prerequisiteMatch = line.match(/^\s+[-*]\s+\*\*Prerequisite State:\*\*\s*(.+)/i);
				if (prerequisiteMatch) currentTask.prerequisiteState = parseChecklistStatus(prerequisiteMatch[1]);
				const ownedAreasMatch = line.match(/^\s+[-*]\s+\*\*Owned Areas:\*\*\s*(.+)/i);
				if (ownedAreasMatch) {
					currentTask.ownedAreas = ownedAreasMatch[1]
						.split(/[,;]/)
						.map(item => item.trim())
						.filter(Boolean);
				}
				const laneMatch = line.match(/^\s+[-*]\s+\*\*Execution Lane:\*\*\s*(.+)/i);
				if (laneMatch) currentTask.laneHint = parseChecklistLane(laneMatch[1]);
				const waveMatch = line.match(/^\s+[-*]\s+\*\*Execution Wave:\*\*\s*(\d+)/i);
				if (waveMatch) currentTask.executionWave = parseInt(waveMatch[1], 10);
				const parallelGroupMatch = line.match(/^\s+[-*]\s+\*\*Parallel Group:\*\*\s*(.+)/i);
				if (parallelGroupMatch) currentTask.parallelGroup = parallelGroupMatch[1].trim();
				const workerProfileMatch = line.match(/^\s+[-*]\s+\*\*Worker Profile:\*\*\s*(.+)/i);
				if (workerProfileMatch) currentTask.workerProfile = workerProfileMatch[1].trim();
				const parallelizableMatch = line.match(/^\s+[-*]\s+\*\*Parallelizable:\*\*\s*(yes|no)/i);
				if (parallelizableMatch) currentTask.parallelizable = parallelizableMatch[1].toLowerCase() === "yes";
				const serialReasonMatch = line.match(/^\s+[-*]\s+\*\*Serial Reason:\*\*\s*(.+)/i);
				if (serialReasonMatch) currentTask.serialReason = serialReasonMatch[1].trim();
				const concurrencyMatch = line.match(/^\s+[-*]\s+\*\*Suggested Max Concurrency:\*\*\s*(\d+)/i);
				if (concurrencyMatch) currentTask.suggestedMaxConcurrency = parseInt(concurrencyMatch[1], 10);
				const githubIssueMatch = line.match(/^\s+[-*]\s+\*\*GitHub Issue:\*\*\s*#(\d+)/i);
				if (githubIssueMatch) currentTask.issueNumber = parseInt(githubIssueMatch[1], 10);
				const validationMatch = line.match(/^\s+[-*]\s+\*\*Validators:\*\*\s*(.+)/i);
				if (validationMatch) {
					currentTask.validators = validationMatch[1]
						.split(/[,;]/)
						.map(item => item.trim())
						.filter(Boolean);
				}
				const regressionMatch = line.match(/^\s+[-*]\s+\*\*Regression Surface:\*\*\s*(.+)/i);
				if (regressionMatch) {
					currentTask.regressionSurface = regressionMatch[1]
						.split(/[,;]/)
						.map(item => item.trim())
						.filter(Boolean);
				}
				if (!isChecklistMetadataLine(line)) bodyLines.push(line);
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
		epicsUpdated: number;
		tasksCreated: number;
		tasksUpdated: number;
		tasksFailed: number;
		tasksRejected: number;
		epicIssueNumbers: Map<string, number>;
		taskIssueNumbers: Map<string, number>;
		repoUrl: string;
		rejectedTasks: Array<{ taskId: string; title: string; status: PlanningGateStatus; reason: string }>;
	}

	function upsertChecklistTaskMetadata(checklist: string, taskId: string, metadataLines: string[], replacePrefixes?: string[]): string {
		const escaped = taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const lines = checklist.split("\n");
		const headingRe = new RegExp(`^-\\s+\\[[ x]\\]\\s+\\*\\*${escaped}\\s*[—–-]+\\s*.+?\\*\\*(?:\\s*\\(#\\d+\\))?$`);
		const metadataPrefixes = replacePrefixes ?? CHECKLIST_PUBLISH_METADATA_PREFIXES;
		for (let index = 0; index < lines.length; index++) {
			if (!headingRe.test(lines[index])) continue;
			let insertAt = index + 1;
			while (insertAt < lines.length && metadataPrefixes.some(prefix => lines[insertAt].startsWith(prefix))) {
				lines.splice(insertAt, 1);
			}
			lines.splice(insertAt, 0, ...metadataLines);
			return lines.join("\n");
		}
		return checklist;
	}

	async function loadExistingIssues(cwd: string): Promise<ExistingIssueSummary[]> {
		const result = await shellExecAsync(`cd '${cwd}' && gh issue list --state all --limit 500 --json number,title,labels`);
		if (!result.ok || !result.stdout) return [];
		try {
			const parsed = JSON.parse(result.stdout);
			if (!Array.isArray(parsed)) return [];
			return parsed.map((issue: any) => ({
				number: Number(issue.number),
				title: String(issue.title || ""),
				labels: Array.isArray(issue.labels) ? issue.labels.map((label: any) => String(label?.name || "")).filter(Boolean) : [],
			})).filter((issue: ExistingIssueSummary) => Number.isFinite(issue.number) && issue.title);
		} catch {
			return [];
		}
	}

	function findExistingIssueNumber(existingIssues: ExistingIssueSummary[], title: string, label: string): number | null {
		const match = existingIssues.find(issue => issue.title === title && issue.labels.includes(label));
		return match ? match.number : null;
	}

	function startUiSpinner(ctx: ExtensionContext, key: string, initialMessage: string) {
		const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
		let index = 0;
		let message = initialMessage;
		ctx.ui.setStatus(key, `${frames[index]} ${message}`);
		const timer = setInterval(() => {
			index = (index + 1) % frames.length;
			ctx.ui.setStatus(key, `${frames[index]} ${message}`);
		}, 120);
		return {
			update(nextMessage: string) {
				message = nextMessage;
				ctx.ui.setStatus(key, `${frames[index]} ${message}`);
			},
			stop(finalMessage?: string) {
				clearInterval(timer);
				ctx.ui.setStatus(key, finalMessage ? `✓ ${finalMessage}` : "");
			},
		};
	}

	function setRebuildProgress(stage: string, current: number, total: number, detail: string) {
		rebuildProgress = {
			active: true,
			stage,
			current,
			total,
			detail,
		};
		updateWidget();
	}

	function clearRebuildProgress() {
		rebuildProgress = null;
		updateWidget();
	}

	async function applyParallelExecutionPlanToChecklist(checklistPath: string, ctx: ExtensionContext) {
		const { tasks } = parseChecklist(checklistPath);
		const plan = buildParallelExecutionPlan(tasks);
		let checklist = readFileSync(checklistPath, "utf-8");
		let index = 0;
		for (const task of tasks) {
			index++;
			const item = plan.get(task.id);
			if (!item) continue;
			setRebuildProgress("parallel", index, tasks.length, `${task.id} — ${task.title}`);
			const metadataBlock = [
				`  - **Execution Wave:** ${item.executionWave}`,
				`  - **Parallel Group:** ${item.parallelGroup}`,
				`  - **Worker Profile:** ${item.workerProfile}`,
				`  - **Parallelizable:** ${item.parallelizable ? "yes" : "no"}`,
				`  - **Suggested Max Concurrency:** ${item.suggestedMaxConcurrency}`,
				`  - **Serial Reason:** ${item.serialReason ?? "n/a"}`,
			];
			checklist = upsertChecklistTaskMetadata(
				checklist,
				task.id,
				metadataBlock,
				[
					"  - **Execution Wave:**",
					"  - **Parallel Group:**",
					"  - **Worker Profile:**",
					"  - **Parallelizable:**",
					"  - **Suggested Max Concurrency:**",
					"  - **Serial Reason:**",
				],
			);
			if (index % 10 === 0) {
				writeFileSync(checklistPath, checklist, "utf-8");
				await new Promise(resolve => setTimeout(resolve, 0));
			}
		}
		writeFileSync(checklistPath, checklist, "utf-8");
		ctx.ui.notify("Parallel execution plan applied to checklist.", "info");
	}

	async function publishToGitHub(
		cwd: string,
		checklistPath: string,
		prdPath: string,
		ctx: ExtensionContext,
		options?: { skipParallelPlanning?: boolean },
	): Promise<PublishResult> {
		const spinner = startUiSpinner(ctx, "pi-blueprint", "Preparing GitHub rebuild...");

		try {
			if (!options?.skipParallelPlanning) {
				setRebuildProgress("parallel", 0, 1, "Planning execution waves and parallel groups");
				await applyParallelExecutionPlanToChecklist(checklistPath, ctx);
			}
			const { epics, tasks } = parseChecklist(checklistPath);
			const hasPrd = existsSync(prdPath);
			const prdEpics = hasPrd ? parsePrdEpics(prdPath) : new Map<string, ParsedEpic>();
			const existingIssues = await loadExistingIssues(cwd);

			// Create labels
			ctx.ui.notify("GitHub rebuild started. Creating labels, then epics, tasks, and checklist links.", "info");
			spinner.update("Creating GitHub labels...");
			const labels = ["epic", "phase", "task", "sub-task"];
			for (const [labelIdx, label] of labels.entries()) {
				setRebuildProgress("labels", labelIdx + 1, labels.length, `Creating label: ${label}`);
				const colors: Record<string, string> = { epic: "7057ff", phase: "0e8a16", task: "1d76db", "sub-task": "c5def5" };
				await shellExecAsync(`cd '${cwd}' && gh label create "${label}" --color "${colors[label]}" --force 2>/dev/null`);
			}

			// Create epic issues — enriched with PRD content
			const epicIssueNumbers = new Map<string, number>();
			let epicsCreated = 0;
			let epicsUpdated = 0;
			let epicIdx = 0;
			ctx.ui.notify(`Publishing ${epics.size} epic issue${epics.size !== 1 ? "s" : ""}...`, "info");
			for (const [epicId, epicEntry] of epics) {
				const epicTitle = epicEntry.title;
				epicIdx++;
				spinner.update(`Creating epic ${epicIdx}/${epics.size}: ${epicId}`);
				setRebuildProgress("epics", epicIdx, epics.size, `${epicId}: ${epicTitle}`);
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
					`*Created by pi-blueprint*`,
				].filter(Boolean).join("\n");

				const tmpFile = join(logDir, `_epic_body_${epicId.replace(/\s+/g, "_")}.md`);
				writeFileSync(tmpFile, body, "utf-8");

				const existingEpicIssueNumber = epicEntry.issueNumber ?? findExistingIssueNumber(existingIssues, `${epicId}: ${epicTitle}`, "epic");
				const result = existingEpicIssueNumber
					? await shellExecAsync(
						`cd '${cwd}' && gh issue edit ${existingEpicIssueNumber} --title "${epicId}: ${epicTitle}" --add-label "epic" --body-file '${tmpFile}'`
					)
					: await shellExecAsync(
						`cd '${cwd}' && gh issue create --title "${epicId}: ${epicTitle}" --label "epic" --body-file '${tmpFile}'`
					);
				try { unlinkSync(tmpFile); } catch {}

				if (result.ok) {
					const num = existingEpicIssueNumber || parseInt(result.stdout.split("/").pop() || "0", 10);
					epicIssueNumbers.set(epicId, num);
					if (existingEpicIssueNumber) epicsUpdated++;
					else epicsCreated++;
				}
			}

			// Create task issues — full body from checklist, linked to epic and PRD
			const taskIssueNumbers = new Map<string, number>();
			let tasksCreated = 0;
			let tasksUpdated = 0;
			let tasksFailed = 0;
			const rejectedTasks: Array<{ taskId: string; title: string; status: PlanningGateStatus; reason: string }> = [];

			let taskIdx = 0;
			ctx.ui.notify(`Publishing ${tasks.length} task issue${tasks.length !== 1 ? "s" : ""}...`, "info");
			for (const task of tasks) {
				taskIdx++;
				spinner.update(`Creating task ${taskIdx}/${tasks.length}: ${task.id}`);
				setRebuildProgress("tasks", taskIdx, tasks.length, `${task.id} — ${task.title}`);
				const epicNum = epicIssueNumbers.get(task.epic);
				const packet = buildBlueprintTaskPacket(task);
				const gate = evaluatePlanningGate(packet);
				if (gate.status !== "execution-ready") {
					rejectedTasks.push({ taskId: task.id, title: task.title, status: gate.status, reason: gate.reason });
					const metadataBlock = [
						`  - **Planning Gate:** ${gate.status}`,
						`  - **Gate Reason:** ${gate.reason}`,
					];
					let checklist = readFileSync(checklistPath, "utf-8");
					checklist = upsertChecklistTaskMetadata(checklist, task.id, metadataBlock);
					writeFileSync(checklistPath, checklist, "utf-8");
					const parentEpicIssue = epicNum ? `#${epicNum}` : task.epic;
					await shellExecAsync(`cd '${cwd}' && gh issue comment '${parentEpicIssue}' --body-file - <<'EOF'
${renderPlanningGateComment(task, packet, gate)}
EOF`);
					continue;
				}
				const depRefs = task.dependencies
					.map(d => {
						const num = taskIssueNumbers.get(d);
						return num ? `#${num}` : d;
					})
					.join(", ");

				const body = [
					`## Task: ${task.id} — ${task.title}`,
					"",
					renderReferenceIndex(task, packet, epicNum),
					hasPrd ? `- **PRD:** [docs/PRD.md](docs/PRD.md)` : "",
					`- **Checklist Source:** [features/00-IMPLEMENTATION-CHECKLIST.md](features/00-IMPLEMENTATION-CHECKLIST.md)`,
					depRefs ? `- **GitHub Dependency Links:** ${depRefs}` : "- **GitHub Dependency Links:** none",
					"",
					renderBlueprintTaskPacket(packet),
					"",
					renderBlueprintSyncContract(),
					"",
					`### Task Detail`,
					task.body,
					"",
					`---`,
					`*Created by pi-blueprint*`,
				].filter(Boolean).join("\n");

				const issueTitle = `[${task.id}] ${task.title}`;
				const tmpFile = join(logDir, `_task_body_${task.id.replace(/\./g, "_")}.md`);
				writeFileSync(tmpFile, body, "utf-8");

				const existingTaskIssueNumber = task.issueNumber ?? findExistingIssueNumber(existingIssues, issueTitle, "task");
				const result = existingTaskIssueNumber
					? await shellExecAsync(
						`cd '${cwd}' && gh issue edit ${existingTaskIssueNumber} --title "${issueTitle.replace(/"/g, '\\"')}" --add-label "task" --body-file '${tmpFile}'`
					)
					: await shellExecAsync(
						`cd '${cwd}' && gh issue create --title "${issueTitle.replace(/"/g, '\\"')}" --label "task" --body-file '${tmpFile}'`
					);
				try { unlinkSync(tmpFile); } catch {}

				if (result.ok) {
					const num = existingTaskIssueNumber || parseInt(result.stdout.split("/").pop() || "0", 10);
					taskIssueNumbers.set(task.id, num);
					if (existingTaskIssueNumber) tasksUpdated++;
					else tasksCreated++;
				} else {
					tasksFailed++;
				}
			}

			// Update checklist with issue numbers
			spinner.update("Updating checklist with issue numbers...");
			ctx.ui.notify("Updating checklist with issue links and planning metadata...", "info");
			setRebuildProgress("checklist", 1, 1, "Linking issue numbers and planning metadata");
			if (taskIssueNumbers.size > 0) {
				let checklist = readFileSync(checklistPath, "utf-8");
				for (const [taskId, issueNum] of taskIssueNumbers) {
					const task = tasks.find(candidate => candidate.id === taskId);
					if (!task) continue;
					const packet = buildBlueprintTaskPacket(task);
					const ownedAreas = packet.ownedAreas.length > 0 ? packet.ownedAreas.join(", ") : "none declared yet";
					const prerequisiteState = task.prerequisiteState ??
						(packet.prerequisites.some(prereq => prereq.status === "missing")
							? "missing"
							: packet.prerequisites.some(prereq => prereq.status === "waived")
								? "waived"
								: "satisfied");
					const metadataBlock = [
						`  - **GitHub Issue:** #${issueNum}`,
						`  - **Complexity Score:** ${packet.complexityScore}/10`,
						`  - **Prerequisite State:** ${prerequisiteState}`,
						`  - **Owned Areas:** ${ownedAreas}`,
						`  - **Planning Gate:** execution-ready`,
					];
					checklist = upsertChecklistTaskMetadata(checklist, taskId, metadataBlock);
				}
				writeFileSync(checklistPath, checklist, "utf-8");
			}

			const remoteCheck = await shellExecAsync(`git -C '${cwd}' remote get-url origin`);
			const repoUrl = remoteCheck.ok ? remoteCheck.stdout.replace(/\.git$/, "") : "";

			spinner.stop(`GitHub rebuild complete: ${epicsCreated} created, ${epicsUpdated} updated, ${tasksCreated} tasks created, ${tasksUpdated} updated`);
			clearRebuildProgress();
			return {
				success: tasksFailed === 0 && rejectedTasks.length === 0,
				epicsCreated,
				epicsUpdated,
				tasksCreated,
				tasksUpdated,
				tasksFailed,
				tasksRejected: rejectedTasks.length,
				epicIssueNumbers,
				taskIssueNumbers,
				repoUrl,
				rejectedTasks,
			};
		} catch (error) {
			spinner.stop("GitHub rebuild failed");
			clearRebuildProgress();
			throw error;
		}
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

	pi.registerCommand("blueprint-rebuild-issues", {
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
					ctx.ui.notify("Initialize a repo first, then re-run /blueprint-rebuild-issues.", "info");
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
				ctx.ui.notify(`Created GitHub repo: ${repoName}`, "info");
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
				ctx.ui.setStatus("pi-blueprint", "Initializing git repo...");
				const logCheck = shellExec(`git -C '${cwd}' log --oneline -1`);
				if (!logCheck.ok) {
					shellExec(`git -C '${cwd}' add -A`);
					shellExec(`git -C '${cwd}' commit -m "Initial commit: PRD and implementation checklist"`);
				}

				const folderName = cwd.split("/").pop() || "project";
				let repoName: string | undefined;
				ctx.ui.setStatus("pi-blueprint", "");
				try {
					repoName = await ctx.ui.input("GitHub repo name", folderName);
				} catch { repoName = folderName; }
				if (!repoName) repoName = folderName;

				ctx.ui.setStatus("pi-blueprint", `Creating GitHub repo '${repoName}' and pushing...`);
				const ghCreate = shellExec(`gh repo create '${repoName}' --private --source '${cwd}' --push`);
				ctx.ui.setStatus("pi-blueprint", "");
				if (!ghCreate.ok) {
					ctx.ui.notify(`Failed to create repo: ${ghCreate.stderr}`, "error");
					return;
				}
				ctx.ui.notify(`Created GitHub repo: ${repoName}`, "info");
			}

			// Find artifacts
			const checklistPath = join(cwd, "features", "00-IMPLEMENTATION-CHECKLIST.md");
			const prdPath = join(cwd, "docs", "PRD.md");

			if (!existsSync(checklistPath)) {
				const generate = await ctx.ui.confirm(
					"No Checklist Found",
					"No checklist at features/00-IMPLEMENTATION-CHECKLIST.md.\nGenerate artifacts (PRD + checklist) first?",
				);
				if (!generate) return;

				// Queue a message to the agent to call generate_artifacts
				ctx.ui.notify(
					"Tell the agent what you want to build, or if you've already discussed requirements,\n" +
					"ask it to: \"Please generate the artifacts now.\"",
					"info",
				);
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

			ctx.ui.setStatus("pi-blueprint", `Publishing ${epics.size} epics and ${tasks.length} tasks to GitHub...`);

				const pub = await publishToGitHub(cwd, checklistPath, prdPath, ctx as ExtensionContext);
			ctx.ui.setStatus("pi-blueprint", "");

			const epicList = Array.from(pub.epicIssueNumbers.entries())
				.map(([id, num]) => `  #${num} — ${id}`)
				.join("\n");

			ctx.ui.notify(
				`GitHub Issues Synced!\n\n` +
				`Epics: ${pub.epicsCreated} created` + (pub.epicsUpdated > 0 ? `, ${pub.epicsUpdated} updated` : "") + "\n" +
				epicList + "\n\n" +
				`Tasks: ${pub.tasksCreated} created` + (pub.tasksUpdated > 0 ? `, ${pub.tasksUpdated} updated` : "") + (pub.tasksFailed > 0 ? ` (${pub.tasksFailed} failed)` : "") + "\n\n" +
				`Checklist updated with issue numbers.\n` +
				(pub.repoUrl ? `View: ${pub.repoUrl}/issues` : ""),
					"info",
			);
		},
	});

	pi.registerCommand("blueprint-revise", {
		description: "Reopen the current blueprint in manual review mode and trigger another requirements review cycle",
		handler: async (args, ctx) => {
			const reviewScore = getBlueprintReviewScore();
			const reason = args?.trim();
			const derivedReason = !reason && lastAlignmentCheck
				? [
					lastAlignmentCheck.summary ? `Review summary: ${lastAlignmentCheck.summary}` : "",
					lastAlignmentCheck.missingDecisions.length > 0
						? `Missing decisions: ${lastAlignmentCheck.missingDecisions.join("; ")}`
						: "",
					lastAlignmentCheck.contradictions.length > 0
						? `Contradictions: ${lastAlignmentCheck.contradictions.join("; ")}`
						: "",
				].filter(Boolean).join("\n")
				: "";
			const effectiveReason = reason || derivedReason;
			const missingList = reviewScore.source === "specialists"
				? reviewScore.missing.map(displayName)
				: reviewScore.missing;
			const revisionRequest = [
				"## MANUAL REVISION REQUEST",
				"The operator explicitly requested another requirements review cycle.",
				effectiveReason ? `Reason:\n${effectiveReason}` : "",
				missingList.length > 0
					? reviewScore.source === "specialists"
						? `Missing specialist coverage: ${missingList.join(", ")}`
						: `Outstanding review gaps: ${missingList.join(", ")}`
					: "",
				"Build a short review task list for yourself and execute it immediately.",
				"If specialist coverage is missing, start with that specialist without asking the operator to choose the next step.",
				"Only ask the operator a question if there is a genuine ambiguity that changes scope, behavior, or acceptance.",
				"After each consultation, summarize the delta, continue the next required review task, and only stop when all required review gaps are closed or a real ambiguity blocks progress.",
			].filter(Boolean).join("\n");
			activeConsultant = "";
			phase = "review";
			lastAlignmentCheck = null;
			pendingRevisionPrompt = null;
			resumeContext = "";
			saveSessionState();
			updateWidget();
			const lines = [
				"Blueprint review reopened.",
				`Current blueprint score: ${reviewScore.score}/100`,
				missingList.length > 0
					? reviewScore.source === "specialists"
						? `Missing specialist coverage: ${missingList.join(", ")}`
						: `Outstanding review gaps: ${missingList.join(", ")}`
					: reviewScore.source === "specialists"
						? "All specialist lanes currently covered."
						: "No outstanding review gaps recorded.",
				effectiveReason ? `Revision reason:\n${effectiveReason}` : "",
				"Revision cycle is being kicked off now.",
			].filter(Boolean).join("\n\n");
			ctx.ui.notify(lines, reviewScore.ready ? "info" : "warning");
			pi.sendUserMessage(revisionRequest);
		},
	});

	pi.registerCommand("blueprint-dismiss-revision", {
		description: "Dismiss the pending startup revision prompt and continue without reopening review",
		handler: async (_args, ctx) => {
			pendingRevisionPrompt = null;
			updateWidget();
			ctx.ui.notify("Startup revision prompt dismissed. Continue when ready, or run /blueprint-revise later.", "info");
		},
	});

	pi.registerCommand("blueprint-reset", {
		description: "Reset the requirements session (start fresh)",
		handler: async (_args, ctx) => {
			consultations = [];
			iteration = 0;
			activeConsultant = "";
			phase = "idle";
			lastAlignmentCheck = null;
			pendingRevisionPrompt = null;
			resumeContext = "";
			stopWidgetCheck();
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

	pi.on("input", async (event: any, ctx) => {
		const data = event?.data ?? event?.input ?? "";
		if (
			data === "\u000f" ||
			matchesKey(data, "ctrl+o") ||
			matchesKey(data, "f2") ||
			data === "\u001bOQ" ||
			data === "\u001b[12~" ||
			data === "\u001b[1;2P" ||
			data === "\u001bo" ||
			matchesKey(data, "alt+o") ||
			(typeof data === "string" && data.toLowerCase() === "ctrl+o")
		) {
			await openBlueprintDetailsOverlay(ctx);
			return { action: "handled" as const };
		}
		return { action: "continue" as const };
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

### Step 0: Classify the entry mode before detailed planning
- Determine whether the request is:
  - greenfield build
  - enhancement to an existing PRD or implementation
  - PRD-driven planning refinement
  - bugfix / root-cause / regression planning
- State the chosen mode back to the user in one line before continuing.
- Use the mode to decide what to ask next and what evidence must be gathered.

### Phase 1: Discovery (ONE question at a time)
- Ask what the user wants to build
- Ask clarifying questions ONE AT A TIME
- Cover: what, why, who, how, scope, constraints
- Do NOT dump a list of questions — have a conversation

#### Mode-specific discovery requirements
- **Greenfield:** identify domains, phases, epics, major prerequisites, and delivery slices.
- **Enhancement:** identify what already exists, what changes, what stays untouched, and what compatibility risks must be preserved.
- **PRD-driven:** treat the PRD as baseline truth, ask only for missing execution data, and focus on decomposition, dependencies, and operator acceptance.
- **Bugfix:** capture current behavior, expected behavior, reproduction path, suspected surface area, root-cause clues, and regression expectations.

### Phase 2: Specialist Consultation (iterate with user)
After you have enough context from the interview:
- Tell the user which specialist you want to consult and why
- Call consult_specialist with a focused question and accumulated context
- Present the specialist's findings to the user in a clear summary
- Ask: "Does this align with your vision? Any corrections or additions?"
- If the user has feedback, incorporate it and re-consult if needed
- Repeat for other specialists as the conversation naturally evolves
- You do NOT need to consult all specialists — only those relevant to the discussion

### Autonomous Revision Handling
- If a revision request or explicit review gap already identifies the missing work, do NOT ask the user to pick the obvious next step.
- Instead, create a short internal task list for yourself, execute the required specialist consultations in order, and drive the review loop forward.
- Only ask the user a question when:
  - there is a genuine product ambiguity,
  - specialists disagree on a decision that changes scope or behavior, or
  - explicit operator approval is required before artifact generation.
- If the missing work is specialist coverage, start with that specialist immediately.
- After each consultation, summarize what changed and either continue the next required task or ask only the minimal blocking question.
- If resolving a requirement depends on original, historical, or externally verifiable behavior, use a specialist consultation that performs external research. Do not ask the operator to search the web for you unless the runtime truly cannot access tools.

### Phase 3: Alignment Check
After consulting specialists:
- Present a consolidated summary of all findings
- Highlight any conflicts between specialists
- Highlight decisions that need user input
- Ask: "Are we aligned on all of this? Anything to change?"
- If user wants changes, loop back to Phase 2

### Phase 4: Sign-off & Artifact Generation
ONLY when the user explicitly says they're happy / ready / "looks good" / "generate it":
- Confirm the blueprint score is above 95 before final generation
- Call generate_artifacts with the complete consolidated specification
- Present the results

## PLANNING GATE RULES
- Your output must decompose work into execution-ready tasks for pi-builder.
- Complexity score is the canonical planning budget on a 1-10 scale.
- Score bands: 1-3 = atomic-ready, 4-5 = execution-ready, 6-7 = split-required, 8-10 = red-flag complexity creep.
- No execution-ready task may exceed complexity score 5/10.
- If a task scores 6 or 7, it must be decomposed further before publication.
- If a task scores 8 or higher, call it out as complexity creep / planning failure.
- Make prerequisites explicit. If prerequisites are missing, route the task back to replanning instead of pretending it is ready.
- The final output must make it obvious why each task entered the line, was rejected, or was flagged.
- If blueprint score is 95 or below, run another review cycle before generating artifacts.
- If a required review gap is already known, do not pause to ask what should be reviewed first; execute the required review work.

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
			contextBlock += `\nStart by summarizing what was covered so far. If there is an explicit pending revision request or known required review gap, drive that work forward immediately instead of asking the user what to do next.`;
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
			resumeContext = "";
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

		sessionStateFile = join(sessionDir, "pi-blueprint-state.json");
		blueprintWebUrl = `http://127.0.0.1:${BLUEPRINT_WEB_PORT}`;
		ensureBlueprintWebServer(ctx);
		startTranscriptWatch(ctx);

		localAssetSync = syncProjectAssets(ctx.cwd, "pi-blueprint", extensionRepoRoot);
		agents = scanAgents(ctx.cwd);
		consultations = [];
		iteration = 0;
		phase = "idle";
		lastAlignmentCheck = null;
		pendingRevisionPrompt = null;
		resumeContext = "";
		stopWidgetCheck();

		pi.setActiveTools(["consult_specialist", "generate_artifacts"]);

		const available = Object.keys(SPECIALISTS).filter(a => agents.has(a));
		const missing = Object.keys(SPECIALISTS).filter(a => !agents.has(a));

		if (missing.length > 0) {
			ctx.ui.notify(`Missing specialist agents: ${missing.join(", ")}`, "warning");
		}
		if (localAssetSync && (localAssetSync.created.length > 0 || localAssetSync.updated.length > 0 || localAssetSync.missingSources.length > 0)) {
			const assetLines = [
				`Local pi-blueprint assets: ${localAssetSync.status}`,
				localAssetSync.created.length > 0 ? `Created: ${localAssetSync.created.join(", ")}` : "",
				localAssetSync.updated.length > 0 ? `Updated: ${localAssetSync.updated.join(", ")}` : "",
				localAssetSync.missingSources.length > 0 ? `Missing repo sources: ${localAssetSync.missingSources.join(", ")}` : "",
			].filter(Boolean).join("\n");
			ctx.ui.notify(assetLines, localAssetSync.status === "ready" ? "info" : "warning");
		}

		// ── Resume / Enhance Detection (auto-detect, use /blueprint-reset for fresh) ──
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
			const reviewScore = getBlueprintReviewScore();
			if (!reviewScore.ready) {
				const scoreBand: "yellow" | "red" = reviewScore.score > 85 ? "yellow" : "red";
				const missingList = reviewScore.source === "specialists"
					? reviewScore.missing.map(displayName)
					: reviewScore.missing;
				pendingRevisionPrompt = {
					score: reviewScore.score,
					scoreBand,
					message: missingList.length > 0
						? reviewScore.source === "specialists"
							? `Blueprint is not compliant. Missing specialist coverage: ${missingList.join(", ")}.`
							: `Blueprint is not compliant. Outstanding review gaps: ${missingList.join(", ")}.`
						: "Blueprint is not compliant. Run a revision cycle before finalization.",
				};
				updateWidget();
			}
		}

		if (resumeMode === "resume") {
			const reviewScore = getBlueprintReviewScore();
			ctx.ui.notify(
				`Session resumed — ${consultations.length} consultations, iteration ${iteration}\n` +
				`Blueprint score: ${reviewScore.score}/100\n` +
				`You're in the ${phase} phase. ${pendingRevisionPrompt ? "Revision prompt is active. Use /blueprint-revise or /blueprint-dismiss-revision.\n" : resumeContext ? "Revision is queued for the next turn.\n" : "Continue where you left off.\n"}` +
				`Use /blueprint-reset to start fresh instead.`,
					"info",
			);
		} else if (resumeMode === "enhance") {
			saveSessionState();
			ctx.ui.notify(
				`Existing PRD detected — enhancement mode.\n` +
				`Tell me what you'd like to change, add, or refine.\n` +
				`I will replan only the affected slices and reject anything that is not execution-ready for pi-builder.\n` +
				`Use /blueprint-reset to start fresh instead.`,
					"info",
			);
		} else {
			ctx.ui.notify(
				`Pi Blueprint — Interactive Planning Mode\n\n` +
				`Specialists available: ${available.map(a => SPECIALISTS[a].label).join(", ")}\n\n` +
				`Describe what you want to build, change, or fix.\n` +
				`Entry modes: greenfield, enhancement, PRD-driven, bugfix.\n` +
				`I'll interview you, consult specialists, and only publish execution-ready work for pi-builder.`,
				"info",
			);
		}

		ctx.ui.notify(
			`Commands:\n` +
			`  /blueprint-status       Current session status\n` +
			`  /blueprint-history      Consultation history\n` +
			`  /blueprint-logs         Open all specialist logs in tmux\n` +
			`  /blueprint-watch <name> Tail one specialist's log\n` +
			`  /blueprint-close-panes  Close all watch panes\n` +
			`  /blueprint-prd          Open PRD in nano or Antigravity\n` +
			`  /blueprint-checklist    Open checklist in nano or Antigravity\n` +
			`  /blueprint-web          Open the live Blueprint web mirror\n` +
			`  /blueprint-details      Open scrollable blueprint details overlay\n` +
			`  /blueprint-sync-assets  Sync repo-managed agents and skills into .pi\n` +
			`  /blueprint-check-alignment  Verify transcript-backed decisions\n` +
			`  /blueprint-search-history <query>  Search transcript evidence\n` +
			`  /blueprint-revise [reason]  Reopen manual requirements review\n` +
			`  /blueprint-dismiss-revision  Continue without revising now\n` +
			`  /blueprint-rebuild-issues  Rebuild GitHub issues from artifacts\n` +
			`  /blueprint-reset        Start fresh`,
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
					theme.fg("accent", "pi-blueprint") +
					theme.fg("muted", " · ") + phaseStr +
					theme.fg("muted", ` · iter ${iteration}`) +
					theme.fg("muted", " · ") +
					theme.fg("dim", blueprintWebUrl || "web: off") +
					theme.fg("dim", " · /blueprint-details");
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});

	pi.on("session_shutdown", async () => {
		stopTranscriptWatch();
		if (blueprintStateFlushTimer) {
			clearTimeout(blueprintStateFlushTimer);
			blueprintStateFlushTimer = null;
		}
		try { blueprintControlSocket?.end(); } catch {}
		blueprintControlSocket = null;
		blueprintControlConnected = false;
	});
}
