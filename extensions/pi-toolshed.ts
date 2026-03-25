import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn, execSync, execFileSync } from "child_process";
import { createConnection, type Socket } from "net";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync, openSync } from "fs";
import { join, resolve, dirname, basename } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { runInNewContext } from "vm";
import { applyExtensionDefaults } from "./themeMap.ts";

type WidgetPlacement = "float";
type WidgetRenderMode = "builder" | "extension" | "workflow";
type LaneItemKind = "system" | "user" | "assistant" | "tool" | "packet" | "card";
type Tone = "info" | "success" | "warning" | "error" | "neutral";
type CardSourceKind = "system" | "extension" | "session" | "project";
type CardPersistKind = "system" | "session" | "project";
type GeneratedCardKind = "workflow" | "mcp-app";

interface SessionHistorySegment {
	role: "user" | "assistant" | "tool";
	timestamp: string;
	title: string;
	content: string;
}

interface ToolshedCalculatorHistoryEntry {
	expression: string;
	result: string;
	timestamp: string;
}

interface ToolshedCalculatorStepEntry {
	key: string;
	label: string;
	display: string;
	expression: string;
	timestamp: string;
}

interface ToolshedInlineCalculatorSession {
	itemId: string;
	cardId?: string;
	title: string;
	sessionId: string;
	display: string;
	expression: string;
	history: ToolshedCalculatorHistoryEntry[];
	steps: ToolshedCalculatorStepEntry[];
	updatedAt: string;
	syncedAt: string;
}

interface ToolshedGithubBoardCardEntry {
	number: number;
	title: string;
	url: string;
	column: string;
	state: string;
	labels: string[];
	type: "task" | "epic" | "sprint" | "other";
	order: number;
	parentSprintNumber?: number;
	taskBreakdownIssueNumbers?: number[];
	sprintOrdinal?: number;
}

interface ToolshedGithubBoardColumnEntry {
	id: string;
	title: string;
	cards: ToolshedGithubBoardCardEntry[];
}

interface ToolshedInlineGithubBoardSession {
	itemId: string;
	cardId?: string;
	title: string;
	sessionId: string;
	repoNameWithOwner: string;
	projectTitle: string;
	projectNumber?: number;
	projectScopeReady: boolean;
	columns: ToolshedGithubBoardColumnEntry[];
	updatedAt: string;
	syncedAt: string;
}

interface ParsedSlashCommand {
	name: string;
	args: string;
	raw: string;
}

interface ParsedSkillInvocation {
	name: string;
	location: string | null;
	prompt: string;
}

interface PendingToolshedAppApproval {
	command: string;
	brief: string;
}

interface ToolshedQuickAction {
	id: string;
	label: string;
	type:
		| "send-message"
		| "submit-slash-command"
		| "launch-skill"
		| "inject-packet"
		| "freeze-frontier"
		| "switch-workspace"
		| "open-mcp-tool"
		| "open-blueprint-web"
		| "run-card"
		| "create-custom-card"
		| "delete-custom-card"
		| "seed-mermaid-card"
		| "abort-run"
		| "reset-layout";
	payload?: Record<string, any>;
	variant?: "primary" | "secondary" | "ghost";
	display?: "icon" | "pill";
}

interface ToolshedWorkspacePreset {
	id: string;
	title: string;
	description: string;
	widgetIds: string[];
	statusChips: string[];
	quickActions: ToolshedQuickAction[];
}

interface ToolshedWidgetDefinition {
	id: string;
	title: string;
	workspaceIds: string[];
	placement: WidgetPlacement;
	purpose: string;
	defaultPinned: boolean;
	defaultCollapsed?: boolean;
	removable: boolean;
	sourceKind: CardSourceKind;
	persistKind: CardPersistKind;
	renderMode: WidgetRenderMode;
}

interface ToolshedWidgetPreference {
	collapsed?: boolean;
}

interface ToolshedWidgetCardState extends ToolshedWidgetDefinition {
	pinned: boolean;
	collapsed: boolean;
	size: "regular";
	badge?: string;
	tone: Tone;
	summary: string;
	lines: string[];
	footer?: string;
	actions: ToolshedQuickAction[];
	builderExamples?: ToolshedBuilderExample[];
	inputPlaceholder?: string;
	builderDefaults?: {
		title: string;
		description: string;
		promptTemplate: string;
		inputPlaceholder: string;
	};
	promptTemplate?: string;
	statusLabel?: string;
	metadata?: Array<{ label: string; value: string }>;
	runLabel?: string;
	cardKind?: GeneratedCardKind;
	appRuntime?: {
		kind: "generated-mcp-app";
		adapter: "calculator" | "generic";
		cardId: string;
		title: string;
		brief: string;
		ready: boolean;
		serverId?: string;
		toolName?: string;
		resourceUri?: string;
		viewFile?: string;
		fingerprint?: string;
		versionTag?: string;
	};
}

interface ToolshedRegistryEntry {
	cardId: string;
	title: string;
	brief: string;
	starterTitle: string;
	artifactDir: string | null;
	serverFile: string | null;
	viewFile: string | null;
	serverId: string | null;
	toolName: string | null;
	resourceUri: string | null;
	trackedStatus: "draft" | "ready" | "failed" | "building";
	trackedLabel: string;
	trackedSummary: string;
	liveStatus: "inactive" | "live" | "stale";
	liveLabel: string;
	liveSummary: string;
	publishedStatus: "missing" | "published";
	publishedLabel: string;
	publishedSummary: string;
	updatedAt: string;
	lastRunAt: string | null;
	lastRunInput: string | null;
	pendingBuildAt: string | null;
	verificationStatus: "idle" | "pending" | "passed" | "failed";
	verificationSummary: string | null;
	verificationUpdatedAt: string | null;
	liveDeployedAt: string | null;
	liveDeploymentFingerprint: string | null;
}

interface ToolshedRegistryState {
	summary: string;
	liveCount: number;
	staleCount: number;
	publishedCount: number;
	entries: ToolshedRegistryEntry[];
}

interface ToolshedGeneratedCard {
	id: string;
	title: string;
	description: string;
	promptTemplate: string;
	kind?: GeneratedCardKind;
	persist: Extract<CardPersistKind, "session" | "project">;
	createdAt: string;
	updatedAt: string;
	inputPlaceholder?: string;
	generatedFrom?: string;
	lastRunAt?: string | null;
	lastRunInput?: string | null;
	starterId?: string;
	appBrief?: string;
	artifactDir?: string;
	serverFile?: string;
	viewFile?: string;
	resourceUri?: string;
	serverId?: string;
	toolName?: string;
	verificationStatus?: "idle" | "pending" | "passed" | "failed";
	verificationSummary?: string | null;
	verificationDetails?: string[];
	verificationUpdatedAt?: string | null;
	verificationSourceResultAt?: string | null;
	pendingBuildAt?: string | null;
	liveDeployedAt?: string | null;
	liveDeploymentFingerprint?: string | null;
	liveDeploymentSummary?: string | null;
}

interface ToolshedBlueprintSnapshot {
	phaseLabel: string;
	scoreLabel: string;
	gateLabel: string;
	assetStatus: string;
	webUrl: string;
	prdPath: string | null;
	checklistPath: string | null;
	active: boolean;
}

interface McpAppVerificationResult {
	status: "idle" | "pending" | "passed" | "failed";
	summary: string;
	details: string[];
	verifiedAt: string | null;
	sourceResultAt: string | null;
	pendingBuildAt: string | null;
}

interface ToolshedBuilderExampleSource {
	label: string;
	url: string;
}

interface ToolshedBuilderExamplePreset {
	title: string;
	description: string;
	promptTemplate: string;
	inputPlaceholder: string;
	generatedFrom: string;
	preferredId?: string;
}

interface ToolshedBuilderExample {
	id: string;
	title: string;
	summary: string;
	sources: ToolshedBuilderExampleSource[];
	compliance: string[];
	howItWorks: string[];
	notes?: string[];
	toolSnippet: string;
	viewSnippet: string;
	preset: ToolshedBuilderExamplePreset;
	laneTitle: string;
	laneSummary: string;
	laneContent: string;
}

interface ToolshedPacket {
	id: string;
	title: string;
	summary: string;
	body: string;
	source: "tool" | "mcp" | "rfc" | "manual";
	status: "staged" | "injected" | "archived";
	createdAt: string;
	injectedAt?: string | null;
}

interface ToolshedMcpServerState {
	id: string;
	label: string;
	transport: string;
	detail: string;
	status: "ready" | "configured" | "needs-attention";
	tone: Tone;
	authConfigured: boolean;
	toolHints: string[];
}

interface ToolshedMcpState {
	configured: boolean;
	count: number;
	summary: string;
	filePath: string;
	servers: ToolshedMcpServerState[];
}

interface ToolshedSkillState {
	id: string;
	label: string;
	description: string;
	sourcePath: string;
	sourceKind: "project-runtime" | "project-repo" | "extension-repo";
}

interface ToolshedSlashCommand {
	id: string;
	label: string;
	command: string;
	description: string;
	category: "toolshed" | "mcp";
}

interface ToolshedDocumentState {
	id: string;
	label: string;
	path: string;
	exists: boolean;
}

interface ToolshedRepositoryState {
	branch: string;
	dirty: boolean;
	changed: number;
	ahead: number;
	behind: number;
}

interface ToolshedLaneItem {
	id: string;
	kind: LaneItemKind;
	title: string;
	content: string;
	summary: string;
	timestamp: string;
	state: "active" | "frozen" | "historical";
	tone: Tone;
	packetId?: string;
	cardId?: string;
	meta?: string;
}

interface PersistedLaneEvent {
	id: string;
	kind: Extract<LaneItemKind, "system" | "user" | "assistant" | "packet" | "card">;
	title: string;
	content: string;
	summary: string;
	timestamp: string;
	tone: Tone;
	packetId?: string;
	cardId?: string;
}

interface ToolshedStatusChip {
	id: string;
	label: string;
	tone: Tone;
}

interface ToolshedStatusState {
	connection: "connected" | "reconnecting" | "offline";
	session: "idle" | "ready" | "streaming" | "running" | "error";
	model?: string;
	provider?: string;
	frontierId?: string | null;
	chips: ToolshedStatusChip[];
}

interface ToolshedState {
	sessionId: string;
	projectDir: string;
	projectName: string;
	workspaceId: string;
	workspaces: ToolshedWorkspacePreset[];
	status: ToolshedStatusState;
	frontier: {
		id: string | null;
		title: string;
		summary: string;
		kind: LaneItemKind | null;
		timestamp: string | null;
	};
	lane: ToolshedLaneItem[];
	packets: ToolshedPacket[];
	widgets: ToolshedWidgetCardState[];
	mcp: ToolshedMcpState;
	skills: ToolshedSkillState[];
	slashCommands: ToolshedSlashCommand[];
	documents: ToolshedDocumentState[];
	repository: ToolshedRepositoryState | null;
	registry: ToolshedRegistryState;
	dashboardMeta: {
		webUrl: string;
		stateFile: string;
		sessionStateFile: string;
		controlPort: number;
		liveSessionConnected: boolean;
		extensionRepoRoot: string;
		lastTranscriptChangeAt: string | null;
	};
	updatedAt: string;
}

interface PersistedToolshedState {
	sessionId: string;
	workspaceId: string;
	widgetPrefs: Record<string, ToolshedWidgetPreference>;
	sessionCards: ToolshedGeneratedCard[];
	packets: ToolshedPacket[];
	laneEvents: PersistedLaneEvent[];
	inlineCalculatorSessions: ToolshedInlineCalculatorSession[];
	inlineGithubBoardSessions: ToolshedInlineGithubBoardSession[];
	lastInlineGithubBoardFocus?: {
		sessionId: string;
		column?: string;
		requestedTypes?: Array<"task" | "epic" | "sprint">;
		relation?: "tasks_for_sprints";
		matchedIssueNumbers?: number[];
		askedAt: string;
	};
	timestamp: number;
}

const TOOLSHED_WEB_PORT = 3161;
const TOOLSHED_WEB_CONTROL_PORT = 3162;
const MAX_PACKETS = 30;
const MAX_LANE_EVENTS = 60;

const WORKSPACE_PRESETS_STATIC: Array<{ id: string; title: string; description: string; widgetIds: string[] }> = [
	{
		id: "all-cards",
		title: "All Cards",
		description: "System, extension-backed, and reusable workflow cards in one float rail.",
		widgetIds: ["component-builder", "blueprint-bridge"],
	},
	{
		id: "built-ins",
		title: "Built-ins",
		description: "System cards and imported extension tools without custom clutter.",
		widgetIds: ["component-builder", "blueprint-bridge"],
	},
	{
		id: "custom-cards",
		title: "Custom Cards",
		description: "Generated session and project workflow cards created inside Toolshed.",
		widgetIds: ["component-builder"],
	},
];

const WIDGET_DEFINITIONS: ToolshedWidgetDefinition[] = [
	{
		id: "component-builder",
		title: "Component Builder",
		workspaceIds: ["all-cards", "built-ins", "custom-cards"],
		placement: "float",
		purpose: "Launch lane-first MCP app creation or create reusable workflow cards inside Toolshed.",
		defaultPinned: true,
		defaultCollapsed: false,
		removable: false,
		sourceKind: "system",
		persistKind: "system",
		renderMode: "builder",
	},
	{
		id: "blueprint-bridge",
		title: "Pi Blueprint",
		workspaceIds: ["all-cards", "built-ins"],
		placement: "float",
		purpose: "Expose the Blueprint planning extension as a reusable Toolshed card.",
		defaultPinned: true,
		defaultCollapsed: false,
		removable: false,
		sourceKind: "extension",
		persistKind: "system",
		renderMode: "extension",
	},
];

const STATIC_SLASH_COMMANDS: ToolshedSlashCommand[] = [
	{ id: "mcp", label: "/mcp", command: "/mcp", description: "Inspect configured MCP servers and tools.", category: "mcp" },
	{ id: "blueprint-web", label: "/blueprint-web", command: "/blueprint-web", description: "Open the Pi Blueprint web mirror.", category: "toolshed" },
	{ id: "blueprint-status", label: "/blueprint-status", command: "/blueprint-status", description: "Show current Blueprint planning state.", category: "toolshed" },
	{ id: "blueprint-prd", label: "/blueprint-prd", command: "/blueprint-prd", description: "Open the current PRD from Blueprint.", category: "toolshed" },
	{ id: "toolshed-web", label: "/toolshed-web", command: "/toolshed-web", description: "Open the Toolshed web workspace.", category: "toolshed" },
	{ id: "toolshed-status", label: "/toolshed-status", command: "/toolshed-status", description: "Show Toolshed session status in the terminal.", category: "toolshed" },
	{ id: "toolshed-app", label: "/toolshed-app", command: "/toolshed-app", description: "Create or update a tracked MCP app through a guided wizard.", category: "toolshed" },
	{ id: "toolshed-freeze", label: "/toolshed-freeze", command: "/toolshed-freeze", description: "Freeze the current frontier into a packet.", category: "toolshed" },
	{ id: "toolshed-packets", label: "/toolshed-packets", command: "/toolshed-packets", description: "List the current packet queue.", category: "toolshed" },
	{ id: "toolshed-workspace", label: "/toolshed-workspace", command: "/toolshed-workspace", description: "Switch the active Toolshed workspace preset.", category: "toolshed" },
	{ id: "toolshed-reset-layout", label: "/toolshed-reset-layout", command: "/toolshed-reset-layout", description: "Reset card collapse state.", category: "toolshed" },
];

function listFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const results: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...listFilesRecursive(entryPath));
			continue;
		}
		results.push(entryPath);
	}
	return results;
}

function slugify(value: string): string {
	return String(value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "item";
}

function humanize(value: string): string {
	return String(value || "")
		.split(/[\-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function nowIso(): string {
	return new Date().toISOString();
}

function excerptText(value: string, maxChars: number = 180): string {
	const text = String(value || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
	if (!text) return "—";
	if (text.length <= maxChars) return text;
	const clipped = text.slice(0, maxChars - 1).replace(/\s+\S*$/, "").trimEnd();
	return (clipped || text.slice(0, maxChars - 1)).replace(/[,:;.\-–—\s]+$/, "") + "…";
}

function normalizeCalculatorHistoryEntry(value: any): ToolshedCalculatorHistoryEntry | null {
	if (!value || typeof value !== "object") return null;
	const expression = String(value.expression || "").trim();
	const result = String(value.result || "").trim();
	if (!expression || !result) return null;
	return {
		expression,
		result,
		timestamp: String(value.timestamp || nowIso()),
	};
}

function normalizeCalculatorStepEntry(value: any): ToolshedCalculatorStepEntry | null {
	if (!value || typeof value !== "object") return null;
	const key = String(value.key || "").trim();
	const label = String(value.label || "").trim();
	const display = String(value.display || "").trim();
	if (!key && !label && !display) return null;
	return {
		key,
		label,
		display,
		expression: String(value.expression || "").trim(),
		timestamp: String(value.timestamp || nowIso()),
	};
}

function normalizeInlineCalculatorSession(value: any): ToolshedInlineCalculatorSession | null {
	if (!value || typeof value !== "object") return null;
	const itemId = String(value.itemId || "").trim();
	const title = String(value.title || "").trim();
	const sessionId = String(value.sessionId || "").trim();
	const display = String(value.display || "").trim();
	if (!itemId || !sessionId || !display) return null;
	return {
		itemId,
		cardId: String(value.cardId || "").trim() || undefined,
		title: title || "Inline calculator",
		sessionId,
		display,
		expression: String(value.expression || "").trim(),
		history: Array.isArray(value.history) ? value.history.map(normalizeCalculatorHistoryEntry).filter(Boolean) as ToolshedCalculatorHistoryEntry[] : [],
		steps: Array.isArray(value.steps) ? value.steps.map(normalizeCalculatorStepEntry).filter(Boolean) as ToolshedCalculatorStepEntry[] : [],
		updatedAt: String(value.updatedAt || nowIso()),
		syncedAt: String(value.syncedAt || nowIso()),
	};
}

function getLatestCalculatorHistoryEntry(session: ToolshedInlineCalculatorSession | null | undefined): ToolshedCalculatorHistoryEntry | null {
	if (!session || !Array.isArray(session.history) || session.history.length === 0) return null;
	return session.history[0] || null;
}

function formatInlineCalculatorHistory(session: ToolshedInlineCalculatorSession, limit: number = 8): string {
	const history = Array.isArray(session.history) ? session.history.slice(0, limit) : [];
	if (history.length === 0) return "No completed calculations yet.";
	return history.map((entry) => `- ${entry.expression} = ${entry.result}`).join("\n");
}

function formatInlineCalculatorSteps(session: ToolshedInlineCalculatorSession, limit: number = 12): string {
	const steps = Array.isArray(session.steps) ? session.steps.slice(0, limit) : [];
	if (steps.length === 0) return "No step memory yet.";
	return steps.map((entry) =>
		`- ${entry.label || entry.key}${entry.expression ? ` | ${entry.expression}` : ""} | display ${entry.display}`
	).join("\n");
}

function answerInlineCalculatorQuestion(question: string, session: ToolshedInlineCalculatorSession): string {
	const normalized = normalizeInlineText(question).toLowerCase();
	const latest = getLatestCalculatorHistoryEntry(session);
	const asksForSteps = /(step|steps|log)/.test(normalized);
	const asksForMemory = /\bmemory\b/.test(normalized);
	const asksForHistoryList = (/(list|show|all|full)/.test(normalized) && /(calculation|calculations|history|result|results|memory)/.test(normalized))
		|| /(memory values|memory value|calc memory|calculator memory|what(?:'s| is) in (?:the )?(?:calculator )?memory)/.test(normalized)
		|| (asksForMemory && !asksForSteps);
	const asksForStepList = (/(list|show|all|full)/.test(normalized) && asksForSteps)
		|| /(step memory|memory steps)/.test(normalized);
	if (!normalized) {
		return latest
			? `Current display: ${session.display}. Most recent calculation: ${latest.expression} = ${latest.result}.`
			: `Current display: ${session.display}. No completed calculations yet in this session.`;
	}
	if (asksForHistoryList) {
		return [
			"Calculations in calculator history:",
			formatInlineCalculatorHistory(session),
			`Current display: ${session.display}.`,
		].join("\n");
	}
	if (asksForStepList) {
		return [
			"Calculator step memory:",
			formatInlineCalculatorSteps(session),
			`Current display: ${session.display}.`,
		].join("\n");
	}
	if (asksForSteps) {
		const latestStep = Array.isArray(session.steps) && session.steps.length > 0 ? session.steps[0] : null;
		return latestStep
			? `Latest calculator step: ${latestStep.label || latestStep.key}. Display: ${latestStep.display}.${latestStep.expression ? ` Expression: ${latestStep.expression}.` : ""}`
			: `There is no step memory yet. Current display: ${session.display}.`;
	}
	if (/(history|recent|latest|last calculation|last result)/.test(normalized)) {
		return latest
			? `Most recent calculation: ${latest.expression} = ${latest.result}. Current display: ${session.display}.`
			: `There is no completed calculation history yet. Current display: ${session.display}.`;
	}
	if (/(expression|formula|equation)/.test(normalized)) {
		return latest
			? `Most recent expression: ${latest.expression}. Result: ${latest.result}.`
			: session.expression
				? `Current expression: ${session.expression}. Current display: ${session.display}.`
				: `There is no completed expression yet. Current display: ${session.display}.`;
	}
	if (/(current|display|screen|value|shown|total)/.test(normalized)) {
		return `The calculator is currently showing ${session.display}.`;
	}
	return latest
		? `Current display: ${session.display}. Most recent calculation: ${latest.expression} = ${latest.result}.`
		: `Current display: ${session.display}. No completed calculations yet in this session.`;
}

function isInlineCalculatorQuestion(value: string): boolean {
	const text = normalizeInlineText(value).toLowerCase();
	if (!text) return false;
	if (text.startsWith("/")) return false;
	return /(calculator|inline calculator|calc|display|screen|shown|showing|current value|current total|recent result|recent calculation|last result|last calculation|value calculated|what(?:'s| is) the value|what(?:'s| is) the total|what did i calculate|use the calculator|step memory|latest step|last step|memory value|memory values|what(?:'s| is) in memory)/.test(text);
}

function buildInlineCalculatorPrompt(userText: string, session: ToolshedInlineCalculatorSession): string {
	const latest = getLatestCalculatorHistoryEntry(session);
	return [
		"The user is referring to the active Toolshed inline calculator session.",
		'Use the `toolshed_calculator_session` tool if you need the live session snapshot. Do not ask the user to paste the expression again, and do not say the calculator MCP is unavailable.',
		`Known session id: ${session.sessionId}`,
		`Known current display: ${session.display}`,
		latest ? `Known most recent calculation: ${latest.expression} = ${latest.result}` : "Known most recent calculation: none yet",
		`Original user message: ${String(userText || "").trim()}`,
	].join("\n\n");
}

function normalizeGithubBoardCardEntry(value: any, fallbackColumn: string): ToolshedGithubBoardCardEntry | null {
	if (!value || typeof value !== "object") return null;
	const number = Number(value.number);
	const title = String(value.title || "").trim();
	if (!Number.isFinite(number) || !title) return null;
	const labels = Array.isArray(value.labels)
		? value.labels
			.map((entry: any) => typeof entry === "string" ? entry : String(entry?.name || ""))
			.map((entry: string) => entry.trim())
			.filter(Boolean)
		: [];
	return {
		number,
		title,
		url: String(value.url || "").trim(),
		column: String(value.column || fallbackColumn || "").trim(),
		state: String(value.state || "").trim(),
		labels,
		type: ["task", "epic", "sprint", "other"].includes(String(value.type || "").trim().toLowerCase())
			? String(value.type || "").trim().toLowerCase() as "task" | "epic" | "sprint" | "other"
			: inferGithubBoardCardType({
				number,
				title,
				url: String(value.url || "").trim(),
				column: String(value.column || fallbackColumn || "").trim(),
				state: String(value.state || "").trim(),
				labels,
				type: "other",
				order: 0,
			}),
		order: Number.isFinite(Number(value.order)) && Number(value.order) > 0 ? Number(value.order) : 0,
		parentSprintNumber: Number.isFinite(Number(value.parentSprintNumber)) ? Number(value.parentSprintNumber) : undefined,
		taskBreakdownIssueNumbers: Array.isArray(value.taskBreakdownIssueNumbers)
			? value.taskBreakdownIssueNumbers
				.map((entry: any) => Number(entry))
				.filter((entry: number) => Number.isFinite(entry))
			: undefined,
		sprintOrdinal: Number.isFinite(Number(value.sprintOrdinal)) ? Number(value.sprintOrdinal) : undefined,
	};
}

function normalizeGithubBoardColumnEntry(value: any): ToolshedGithubBoardColumnEntry | null {
	if (!value || typeof value !== "object") return null;
	const id = String(value.id || value.title || "").trim();
	const title = String(value.title || value.id || "").trim();
	if (!id || !title) return null;
	return {
		id,
		title,
		cards: Array.isArray(value.cards) ? value.cards.map((card: any) => normalizeGithubBoardCardEntry(card, id)).filter(Boolean) as ToolshedGithubBoardCardEntry[] : [],
	};
}

function normalizeInlineGithubBoardSession(value: any): ToolshedInlineGithubBoardSession | null {
	if (!value || typeof value !== "object") return null;
	const itemId = String(value.itemId || "").trim();
	const sessionId = String(value.sessionId || "").trim();
	if (!itemId || !sessionId) return null;
	return {
		itemId,
		cardId: String(value.cardId || "").trim() || undefined,
		title: String(value.title || "GitHub Project Board").trim(),
		sessionId,
		repoNameWithOwner: String(value.repoNameWithOwner || "").trim(),
		projectTitle: String(value.projectTitle || "").trim(),
		projectNumber: Number.isFinite(Number(value.projectNumber)) ? Number(value.projectNumber) : undefined,
		projectScopeReady: Boolean(value.projectScopeReady),
		columns: Array.isArray(value.columns) ? value.columns.map((column: any) => normalizeGithubBoardColumnEntry(column)).filter(Boolean) as ToolshedGithubBoardColumnEntry[] : [],
		updatedAt: String(value.updatedAt || nowIso()),
		syncedAt: String(value.syncedAt || nowIso()),
	};
}

function getGithubBoardColumnCards(session: ToolshedInlineGithubBoardSession, columnId: string): ToolshedGithubBoardCardEntry[] {
	const normalized = String(columnId || "").trim().toLowerCase();
	const column = (session.columns || []).find((entry) =>
		String(entry.id || "").trim().toLowerCase() === normalized
		|| String(entry.title || "").trim().toLowerCase() === normalized
	);
	return Array.isArray(column?.cards) ? column!.cards : [];
}

function detectGithubBoardColumn(question: string): string | null {
	const normalized = normalizeInlineText(question).toLowerCase();
	if (/\bin progress\b/.test(normalized)) return "In Progress";
	if (/\bbacklog\b/.test(normalized)) return "Backlog";
	if (/\breview\b/.test(normalized)) return "Review";
	if (/\bdone\b/.test(normalized)) return "Done";
	return null;
}

function formatGithubBoardCards(cards: ToolshedGithubBoardCardEntry[], limit: number = 12): string {
	if (!cards.length) return "- None";
	return cards.slice(0, limit).map((card) => `- #${card.number} ${card.title}`).join("\n");
}

function detectGithubBoardRequestedTypes(question: string): Array<"task" | "epic" | "sprint"> {
	const normalized = normalizeInlineText(question).toLowerCase();
	const requested: Array<"task" | "epic" | "sprint"> = [];
	if (/\btask(?:s)?\b/.test(normalized)) requested.push("task");
	if (/\bepic(?:s)?\b/.test(normalized)) requested.push("epic");
	if (/\bsprint(?:s)?\b/.test(normalized)) requested.push("sprint");
	return requested;
}

function isInlineGithubBoardListIntent(question: string): boolean {
	const normalized = normalizeInlineText(question).toLowerCase();
	return /(what are they|which ones|which are they|list (?:them|those|the(?:se)?|the cards|the items|the tasks|the epics|the sprints)|show (?:me )?(?:them|those|the cards|the items|the tasks|the epics|the sprints)|which (?:tasks|cards|issues|epics|sprints)|what (?:tasks|cards|issues|epics|sprints))/i.test(normalized);
}

function isInlineGithubBoardTableIntent(question: string): boolean {
	const normalized = normalizeInlineText(question).toLowerCase();
	return /\btable\b|\btabular\b|as a table|in a table|table of/.test(normalized);
}

function isInlineGithubBoardAssociationIntent(question: string): boolean {
	const normalized = normalizeInlineText(question).toLowerCase();
	return /(associated with|belong(?:s|ing)? to|for sprint|for the sprint|under sprint|in sprint)/.test(normalized);
}

function isInlineGithubBoardBareSprintReference(question: string): boolean {
	return /^sprint\s+\d+\??$/i.test(normalizeInlineText(question));
}

function detectGithubBoardSprintOrdinals(question: string): number[] {
	const matches = Array.from(normalizeInlineText(question).matchAll(/\bsprint\s+(\d+)\b/gi));
	return Array.from(new Set(matches
		.map((match) => Number(match[1]))
		.filter((value) => Number.isFinite(value) && value > 0)));
}

function getGithubBoardAllCards(session: ToolshedInlineGithubBoardSession): ToolshedGithubBoardCardEntry[] {
	return (session.columns || []).flatMap((column) => Array.isArray(column.cards) ? column.cards : []);
}

function getGithubBoardCardsByNumbers(session: ToolshedInlineGithubBoardSession, numbers: number[]): ToolshedGithubBoardCardEntry[] {
	if (!Array.isArray(numbers) || numbers.length === 0) return [];
	const wanted = new Set(numbers.map((value) => Number(value)).filter((value) => Number.isFinite(value)));
	return getGithubBoardAllCards(session).filter((card) => wanted.has(Number(card.number)));
}

function extractGithubBoardSprintOrdinal(card: ToolshedGithubBoardCardEntry): number | null {
	if (Number.isFinite(Number(card.sprintOrdinal)) && Number(card.sprintOrdinal) > 0) return Number(card.sprintOrdinal);
	const match = String(card.title || "").match(/\bsprint\s+(\d+)\b/i);
	return match ? Number(match[1]) : null;
}

function getGithubBoardSprintCardsByOrdinals(session: ToolshedInlineGithubBoardSession, ordinals: number[]): ToolshedGithubBoardCardEntry[] {
	if (!Array.isArray(ordinals) || ordinals.length === 0) return [];
	const wanted = new Set(ordinals.map((value) => Number(value)).filter((value) => Number.isFinite(value)));
	return getGithubBoardAllCards(session).filter((card) => inferGithubBoardCardType(card) === "sprint" && wanted.has(Number(extractGithubBoardSprintOrdinal(card))));
}

function getGithubBoardTasksAssociatedWithSprintCards(session: ToolshedInlineGithubBoardSession, sprintCards: ToolshedGithubBoardCardEntry[]): ToolshedGithubBoardCardEntry[] {
	if (!Array.isArray(sprintCards) || sprintCards.length === 0) return [];
	const allCards = getGithubBoardAllCards(session);
	const byNumber = new Map(allCards.map((card) => [Number(card.number), card]));
	const associated = new Map<number, ToolshedGithubBoardCardEntry>();
	for (const sprint of sprintCards) {
		const taskNumbers = Array.isArray(sprint.taskBreakdownIssueNumbers)
			? sprint.taskBreakdownIssueNumbers.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
			: [];
		for (const taskNumber of taskNumbers) {
			const taskCard = byNumber.get(taskNumber);
			if (taskCard && inferGithubBoardCardType(taskCard) === "task") associated.set(Number(taskCard.number), taskCard);
		}
		for (const card of allCards) {
			if (inferGithubBoardCardType(card) !== "task") continue;
			if (Number(card.parentSprintNumber) === Number(sprint.number)) associated.set(Number(card.number), card);
		}
	}
	return Array.from(associated.values()).sort((a, b) => {
		const columnOrder = ["Backlog", "In Progress", "Review", "Done"];
		const columnDiff = columnOrder.indexOf(String(a.column || "")) - columnOrder.indexOf(String(b.column || ""));
		if (columnDiff !== 0) return columnDiff;
		return Number(a.order || 0) - Number(b.order || 0);
	});
}

function formatGithubBoardCardsTable(cards: ToolshedGithubBoardCardEntry[], limit: number = 12): string {
	if (!cards.length) return "No matching cards.";
	return [
		"| Issue | Title | Column | Type |",
		"| --- | --- | --- | --- |",
		...cards.slice(0, limit).map((card) => `| #${card.number} | ${String(card.title || "").replace(/\|/g, "\\|")} | ${String(card.column || "").replace(/\|/g, "\\|")} | ${humanize(inferGithubBoardCardType(card))} |`),
	].join("\n");
}

function inferGithubBoardCardType(card: ToolshedGithubBoardCardEntry): "task" | "epic" | "sprint" | "other" {
	const title = String(card.title || "").trim().toLowerCase();
	const labels = Array.isArray(card.labels) ? card.labels.map((label) => String(label || "").trim().toLowerCase()) : [];
	if (labels.includes("task") || /^task\b/.test(title)) return "task";
	if (labels.includes("epic") || /^epic\b/.test(title)) return "epic";
	if (labels.includes("sprint") || /^sprint\b/.test(title)) return "sprint";
	return "other";
}

function countGithubBoardCardTypes(cards: ToolshedGithubBoardCardEntry[]): Record<"task" | "epic" | "sprint", number> {
	const counts = { task: 0, epic: 0, sprint: 0 };
	for (const card of cards) {
		const type = inferGithubBoardCardType(card);
		if (type === "task" || type === "epic" || type === "sprint") counts[type] += 1;
	}
	return counts;
}

function normalizeGithubBoardQueryColumn(value: any): "Backlog" | "In Progress" | "Review" | "Done" | null {
	const normalized = String(value || "").trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === "backlog") return "Backlog";
	if (normalized === "in progress" || normalized === "in-progress") return "In Progress";
	if (normalized === "review") return "Review";
	if (normalized === "done") return "Done";
	return null;
}

function normalizeGithubBoardQueryTypes(value: any): Array<"task" | "epic" | "sprint" | "other"> {
	const raw = Array.isArray(value)
		? value
		: String(value || "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	const normalized = raw
		.map((entry) => String(entry || "").trim().toLowerCase())
		.filter((entry): entry is "task" | "epic" | "sprint" | "other" => entry === "task" || entry === "epic" || entry === "sprint" || entry === "other");
	return Array.from(new Set(normalized));
}

function normalizeGithubBoardQueryView(value: any): "summary" | "counts" | "cards" {
	const normalized = String(value || "").trim().toLowerCase();
	if (normalized === "counts") return "counts";
	if (normalized === "cards") return "cards";
	return "summary";
}

function buildInlineGithubBoardSnapshot(session: ToolshedInlineGithubBoardSession) {
	const columns = (session.columns || []).map((column) => {
		const orderedCards = (column.cards || []).map((card, index) => {
			const normalizedType = ["task", "epic", "sprint", "other"].includes(String(card.type || "").trim().toLowerCase())
				? String(card.type || "").trim().toLowerCase() as "task" | "epic" | "sprint" | "other"
				: inferGithubBoardCardType(card);
			return {
				number: Number(card.number),
				title: String(card.title || "").trim(),
				url: String(card.url || "").trim(),
				column: String(column.title || card.column || "").trim(),
				state: String(card.state || "").trim(),
				labels: Array.isArray(card.labels) ? card.labels.map((label) => String(label || "").trim()).filter(Boolean) : [],
				type: normalizedType,
				order: Number.isFinite(Number(card.order)) && Number(card.order) > 0 ? Number(card.order) : index + 1,
				parentSprintNumber: Number.isFinite(Number((card as any).parentSprintNumber)) ? Number((card as any).parentSprintNumber) : undefined,
				taskBreakdownIssueNumbers: Array.isArray((card as any).taskBreakdownIssueNumbers)
					? (card as any).taskBreakdownIssueNumbers
						.map((entry: any) => Number(entry))
						.filter((entry: number) => Number.isFinite(entry))
					: undefined,
				sprintOrdinal: Number.isFinite(Number((card as any).sprintOrdinal)) ? Number((card as any).sprintOrdinal) : undefined,
			};
		});
		return {
			id: String(column.id || column.title || "").trim(),
			title: String(column.title || column.id || "").trim(),
			cards: orderedCards,
		};
	});
	return {
		sessionId: String(session.sessionId || "").trim(),
		title: String(session.title || "").trim(),
		repo: {
			nameWithOwner: String(session.repoNameWithOwner || "").trim(),
		},
		project: {
			title: String(session.projectTitle || "").trim(),
			number: Number.isFinite(Number(session.projectNumber)) ? Number(session.projectNumber) : null,
		},
		projectScopeReady: Boolean(session.projectScopeReady),
		updatedAt: String(session.updatedAt || session.syncedAt || nowIso()),
		columns,
		cards: columns.flatMap((column) => column.cards),
	};
}

function buildInlineGithubBoardQueryResult(
	snapshot: ReturnType<typeof buildInlineGithubBoardSnapshot>,
	options?: {
		view?: "summary" | "counts" | "cards";
		column?: string | null;
		types?: Array<"task" | "epic" | "sprint" | "other">;
		limit?: number;
	},
) {
	const view = normalizeGithubBoardQueryView(options?.view);
	const column = normalizeGithubBoardQueryColumn(options?.column);
	const types = normalizeGithubBoardQueryTypes(options?.types);
	const limit = Math.max(1, Math.min(30, Number.isFinite(Number(options?.limit)) ? Number(options?.limit) : 10));
	const cards = (snapshot.cards || []).filter((card) => {
		const cardType = ["task", "epic", "sprint", "other"].includes(String(card.type || "").trim().toLowerCase())
			? String(card.type || "").trim().toLowerCase() as "task" | "epic" | "sprint" | "other"
			: inferGithubBoardCardType(card);
		if (column && String(card.column || "").trim() !== column) return false;
		if (types.length > 0 && !types.includes(cardType)) return false;
		return true;
	});
	const cardsToReturn = cards
		.slice()
		.sort((a, b) => {
			const columnOrder = ["Backlog", "In Progress", "Review", "Done"];
			const columnDiff = columnOrder.indexOf(String(a.column || "")) - columnOrder.indexOf(String(b.column || ""));
			if (columnDiff !== 0) return columnDiff;
			return Number(a.order || 0) - Number(b.order || 0);
		})
		.slice(0, limit)
		.map((card) => ({
			number: Number(card.number),
			title: String(card.title || "").trim(),
			column: String(card.column || "").trim(),
			type: ["task", "epic", "sprint", "other"].includes(String(card.type || "").trim().toLowerCase())
				? String(card.type || "").trim().toLowerCase() as "task" | "epic" | "sprint" | "other"
				: inferGithubBoardCardType(card),
			state: String(card.state || "").trim(),
			order: Number(card.order || 0),
			url: String(card.url || "").trim(),
		}));
	return {
		view,
		board: {
			title: snapshot.project?.title || snapshot.title || "GitHub Project Board",
			repoNameWithOwner: snapshot.repo?.nameWithOwner || "",
			projectNumber: snapshot.project?.number ?? null,
			updatedAt: snapshot.updatedAt,
			projectScopeReady: Boolean(snapshot.projectScopeReady),
		},
		filters: {
			column,
			types,
		},
		total: cards.length,
		counts: {
			boardByColumn: {
				Backlog: snapshot.columns.find((entry) => entry.title === "Backlog")?.cards.length || 0,
				"In Progress": snapshot.columns.find((entry) => entry.title === "In Progress")?.cards.length || 0,
				Review: snapshot.columns.find((entry) => entry.title === "Review")?.cards.length || 0,
				Done: snapshot.columns.find((entry) => entry.title === "Done")?.cards.length || 0,
			},
			matchingByType: cards.reduce<Record<"task" | "epic" | "sprint" | "other", number>>((acc, card) => {
				const cardType = ["task", "epic", "sprint", "other"].includes(String(card.type || "").trim().toLowerCase())
					? String(card.type || "").trim().toLowerCase() as "task" | "epic" | "sprint" | "other"
					: inferGithubBoardCardType(card);
				acc[cardType] += 1;
				return acc;
			}, { task: 0, epic: 0, sprint: 0, other: 0 }),
		},
		cards: view === "cards" || types.length > 0 || Boolean(column) ? cardsToReturn : [],
	};
}

function formatInlineGithubBoardQueryResult(result: ReturnType<typeof buildInlineGithubBoardQueryResult>): string {
	const boardLabel = `${result.board.title || "GitHub Project Board"}${result.board.projectNumber ? ` (#${result.board.projectNumber})` : ""}`;
	const boardCounts = [
		`Backlog: ${result.counts.boardByColumn.Backlog}`,
		`In Progress: ${result.counts.boardByColumn["In Progress"]}`,
		`Review: ${result.counts.boardByColumn.Review}`,
		`Done: ${result.counts.boardByColumn.Done}`,
	].join(" · ");
	const lines = [
		`${boardLabel}${result.board.repoNameWithOwner ? ` · ${result.board.repoNameWithOwner}` : ""}`,
		`Board counts: ${boardCounts}`,
	];
	if (result.filters.column || result.filters.types.length > 0) {
		lines.push(
			`Matching cards: ${result.total}`
			+ `${result.filters.column ? ` · column ${result.filters.column}` : ""}`
			+ `${result.filters.types.length > 0 ? ` · types ${result.filters.types.join(", ")}` : ""}`,
		);
	}
	if (result.view === "counts" || result.filters.types.length > 0) {
		lines.push(
			`Type counts: task ${result.counts.matchingByType.task} · epic ${result.counts.matchingByType.epic} · sprint ${result.counts.matchingByType.sprint} · other ${result.counts.matchingByType.other}`,
		);
	}
	if (result.cards.length > 0) {
		lines.push(
			"Cards:",
			...result.cards.map((card) => `- #${card.number} ${card.title}${card.column ? ` · ${card.column}` : ""}${card.type ? ` · ${card.type}` : ""}`),
		);
	}
	lines.push(
		`Board updated: ${relativeTimeStamp(result.board.updatedAt)}.`,
		result.board.projectScopeReady ? "Source: active inline board session." : "Source: read-only fallback session.",
	);
	return lines.join("\n");
}

function executeGithubBoardSnapshotCode(snapshot: ReturnType<typeof buildInlineGithubBoardSnapshot>, code: string) {
	const source = String(code || "").trim();
	if (!source) throw new Error("Board computation code is required.");
	const sandbox = {
		snapshot: JSON.parse(JSON.stringify(snapshot)),
		Math,
		Number,
		String,
		Boolean,
		Array,
		Object,
		JSON,
	};
	return runInNewContext(
		`
			const __candidate = (${source});
			if (typeof __candidate !== "function") {
				throw new Error("Code must evaluate to a function like (snapshot) => result.");
			}
			__candidate(snapshot);
		`,
		sandbox,
		{ timeout: 1000 },
	);
}

function resolveInlineGithubBoardMatchedCards(
	session: ToolshedInlineGithubBoardSession,
	question: string,
	options?: {
		targetColumn?: string | null;
		requestedTypes?: Array<"task" | "epic" | "sprint">;
		preferList?: boolean;
		renderMode?: "list" | "table";
		relation?: "tasks_for_sprints";
		sprintOrdinals?: number[];
		sprintIssueNumbers?: number[];
		matchedIssueNumbers?: number[];
	},
): ToolshedGithubBoardCardEntry[] {
	const normalized = normalizeInlineText(question).toLowerCase();
	const targetColumn = options?.targetColumn ?? detectGithubBoardColumn(normalized);
	const requestedTypes = options?.requestedTypes && options.requestedTypes.length > 0
		? options.requestedTypes
		: detectGithubBoardRequestedTypes(normalized);
	if (options?.relation === "tasks_for_sprints") {
		const sprintCards = options?.sprintIssueNumbers && options.sprintIssueNumbers.length > 0
			? getGithubBoardCardsByNumbers(session, options.sprintIssueNumbers).filter((card) => inferGithubBoardCardType(card) === "sprint")
			: getGithubBoardSprintCardsByOrdinals(session, options?.sprintOrdinals || []);
		let associatedTasks = getGithubBoardTasksAssociatedWithSprintCards(session, sprintCards);
		if (targetColumn) associatedTasks = associatedTasks.filter((card) => String(card.column || "").trim() === targetColumn);
		return associatedTasks;
	}
	const scopeCards = options?.matchedIssueNumbers && options.matchedIssueNumbers.length > 0
		? getGithubBoardCardsByNumbers(session, options.matchedIssueNumbers)
		: targetColumn
			? getGithubBoardColumnCards(session, targetColumn)
			: getGithubBoardAllCards(session);
	if (requestedTypes.length > 0) {
		return scopeCards.filter((card) => requestedTypes.includes(inferGithubBoardCardType(card)));
	}
	if (options?.matchedIssueNumbers && options.matchedIssueNumbers.length > 0) return scopeCards;
	if (targetColumn) return scopeCards;
	return [];
}

function answerInlineGithubBoardQuestion(
	question: string,
	session: ToolshedInlineGithubBoardSession,
	options?: {
		targetColumn?: string | null;
		requestedTypes?: Array<"task" | "epic" | "sprint">;
		preferList?: boolean;
		renderMode?: "list" | "table";
		relation?: "tasks_for_sprints";
		sprintOrdinals?: number[];
		sprintIssueNumbers?: number[];
		matchedIssueNumbers?: number[];
	},
): string {
	const normalized = normalizeInlineText(question).toLowerCase();
	const targetColumn = options?.targetColumn ?? detectGithubBoardColumn(normalized);
	const requestedTypes = options?.requestedTypes && options.requestedTypes.length > 0
		? options.requestedTypes
		: detectGithubBoardRequestedTypes(normalized);
	const asksForCount = /(how many|count|counts|number of)/.test(normalized);
	const renderMode = options?.renderMode || (isInlineGithubBoardTableIntent(normalized) ? "table" : "list");
	const asksForList = Boolean(options?.preferList) || isInlineGithubBoardListIntent(normalized) || renderMode === "table";
	if (options?.relation === "tasks_for_sprints") {
		const sprintCards = options?.sprintIssueNumbers && options.sprintIssueNumbers.length > 0
			? getGithubBoardCardsByNumbers(session, options.sprintIssueNumbers).filter((card) => inferGithubBoardCardType(card) === "sprint")
			: getGithubBoardSprintCardsByOrdinals(session, options?.sprintOrdinals || []);
		if (sprintCards.length === 0) {
			return `No matching sprint was found on ${session.projectTitle || "the current board"}.`;
		}
		const matchingCards = resolveInlineGithubBoardMatchedCards(session, question, options);
		if (asksForCount && !asksForList) {
			return [
				`Task count${targetColumn ? ` in ${targetColumn}` : ""} for ${sprintCards.length === 1 ? sprintCards[0].title : "the selected sprints"} on ${session.projectTitle || "the current board"}:`,
				`- Tasks: ${matchingCards.length}`,
				`Board updated: ${relativeTimeStamp(session.updatedAt)}.`,
			].join("\n");
		}
		return [
			`Tasks${targetColumn ? ` in ${targetColumn}` : ""} for ${sprintCards.length === 1 ? sprintCards[0].title : "the selected sprints"} on ${session.projectTitle || "the current board"}:`,
			renderMode === "table" ? formatGithubBoardCardsTable(matchingCards) : formatGithubBoardCards(matchingCards),
			`Board updated: ${relativeTimeStamp(session.updatedAt)}.`,
		].join("\n");
	}
	const scopeCards = targetColumn
		? getGithubBoardColumnCards(session, targetColumn)
		: getGithubBoardAllCards(session);
	if (requestedTypes.length > 0) {
		if (asksForCount && !asksForList) {
			const counts = countGithubBoardCardTypes(scopeCards);
			return [
				`${targetColumn || "Current"} ${targetColumn ? "type counts" : "board type counts"} on ${session.projectTitle || "the current board"}:`,
				...requestedTypes.map((type) => `- ${humanize(type)}s: ${counts[type]}`),
				`Board updated: ${relativeTimeStamp(session.updatedAt)}.`,
			].join("\n");
		}
		const matchingCards = resolveInlineGithubBoardMatchedCards(session, question, options);
		const typedLabel = requestedTypes.map((type) => `${humanize(type)}s`).join(" / ");
		return [
			`${typedLabel}${targetColumn ? ` in ${targetColumn}` : ""} on ${session.projectTitle || "the current board"}:`,
			renderMode === "table" ? formatGithubBoardCardsTable(matchingCards) : formatGithubBoardCards(matchingCards),
			`Board updated: ${relativeTimeStamp(session.updatedAt)}.`,
		].join("\n");
	}
	if (targetColumn) {
		return [
			`${targetColumn} items on ${session.projectTitle || "the current board"}:`,
			renderMode === "table" ? formatGithubBoardCardsTable(scopeCards) : formatGithubBoardCards(scopeCards),
			`Board updated: ${relativeTimeStamp(session.updatedAt)}.`,
		].join("\n");
	}
	const summary = (session.columns || []).map((column) => `${column.title}: ${Array.isArray(column.cards) ? column.cards.length : 0}`).join(" · ");
	return [
		`${session.projectTitle || "GitHub Project Board"} status: ${summary || "No columns available."}`,
		session.projectScopeReady ? "This answer is from the active inline board session." : "Board is currently in read-only fallback mode.",
	].join("\n");
}

function isInlineGithubBoardQuestion(value: string): boolean {
	const text = normalizeInlineText(value).toLowerCase();
	if (!text || text.startsWith("/")) return false;
	const mentionsBoard = /(github app|github board|project board|kanban|github project|board\b|based on the github app|based on the board)/.test(text);
	const asksBoardState = /(in progress|backlog|review|done|board status|what(?:'s| is) on the board|what(?:'s| is) in progress|what(?:'s| is) in review|what(?:'s| is) in backlog|what(?:'s| is) done)/.test(text);
	const asksTypedCount = /(how many|count|counts|number of|each type|of each type)/.test(text) && /\b(task|tasks|epic|epics|sprint|sprints)\b/.test(text);
	return (mentionsBoard && asksBoardState) || (mentionsBoard && asksTypedCount);
}

function buildInlineGithubBoardPrompt(userText: string, session: ToolshedInlineGithubBoardSession): string {
	return [
		"The user is referring to the active Toolshed inline GitHub project board session.",
		'Use the `toolshed_github_board_query` tool first for compact counts, filtering, and card lists from the cached board session. Do not claim the board is unavailable, and do not fall back to raw GitHub unless the board session is missing.',
		'If the user asks for exact grouping or ordering beyond the query tool, use `toolshed_github_board_compute` with a pure synchronous JavaScript function like `(snapshot) => ...`.',
		'Use `toolshed_github_board_session` only when you truly need the raw snapshot in structured content for debugging or traceability.',
		"Do not answer from canned board summaries when live board data is available.",
		`Known session id: ${session.sessionId}`,
		`Known board: ${session.projectTitle || "GitHub Project Board"}${session.projectNumber ? ` (#${session.projectNumber})` : ""}`,
		session.repoNameWithOwner ? `Known repository: ${session.repoNameWithOwner}` : "Known repository: current repo",
		`Original user message: ${String(userText || "").trim()}`,
	].join("\n\n");
}

function relativeTimeStamp(value: string | null | undefined): string {
	if (!value) return "now";
	const when = Date.parse(String(value));
	if (!Number.isFinite(when)) return String(value);
	const diffMs = Date.now() - when;
	const diffSec = Math.max(0, Math.round(diffMs / 1000));
	if (diffSec < 60) return `${diffSec}s ago`;
	const diffMin = Math.round(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.round(diffHr / 24);
	return `${diffDay}d ago`;
}

function ensureSlashCommand(value: string): string {
	const command = String(value || "").trim();
	if (!command) return "";
	return command.startsWith("/") ? command : `/${command}`;
}

function parseSlashCommandLine(value: string): ParsedSlashCommand | null {
	const raw = ensureSlashCommand(value);
	if (!raw) return null;
	const match = raw.match(/^\/([a-z0-9][a-z0-9\-]*)(?:\s+([\s\S]*))?$/i);
	if (!match) return null;
	return {
		name: String(match[1] || "").trim().toLowerCase(),
		args: String(match[2] || "").trim(),
		raw,
	};
}

function parseSkillInvocation(value: string): ParsedSkillInvocation | null {
	const text = String(value || "").trim();
	if (!text.startsWith("<skill ")) return null;
	const match = text.match(/^<skill name="([^"]+)"(?: location="([^"]+)")?>[\s\S]*?<\/skill>\s*([\s\S]*)$/i);
	if (!match) return null;
	return {
		name: String(match[1] || "").trim(),
		location: match[2] ? String(match[2]).trim() : null,
		prompt: String(match[3] || "").trim(),
	};
}

function normalizeInlineText(value: string): string {
	return String(value || "")
		.replace(/\r/g, "")
		.replace(/\n[ \t]+/g, " ")
		.replace(/[ \t]+/g, " ")
		.trim();
}

function parsePendingToolshedAppApproval(value: string): PendingToolshedAppApproval | null {
	const text = normalizeInlineText(value);
	if (!text || !/\/toolshed-app\b/i.test(text)) return null;
	if (!/\b(is that ok(?:ay)?|reply yes|say yes|confirm|approve|if that looks good|if that's ok(?:ay)?|if this looks good)\b/i.test(text)) return null;
	const match = text.match(/(\/toolshed-app(?:\s+.+?))(?=(?:\s+(?:is that ok(?:ay)?|reply yes|say yes|confirm|approve|if that looks good|if that's ok(?:ay)?|if this looks good)\b)|$)/i);
	if (!match) return null;
	const parsed = parseSlashCommandLine(match[1]);
	if (!parsed || parsed.name !== "toolshed-app" || !parsed.args) return null;
	return {
		command: parsed.raw,
		brief: parsed.args,
	};
}

function isApprovalReply(value: string): boolean {
	const text = normalizeInlineText(value).toLowerCase().replace(/[.!?]+$/g, "");
	if (!text) return false;
	return [
		"yes",
		"y",
		"ok",
		"okay",
		"yep",
		"yeah",
		"sure",
		"sounds good",
		"looks good",
		"that looks good",
		"that is fine",
		"that's fine",
		"approved",
		"go ahead",
		"do it",
		"build it",
		"please build it",
		"please do",
		"ship it",
	].includes(text);
}

function getPendingToolshedAppApprovalFromLane(lane: ToolshedLaneItem[]): PendingToolshedAppApproval | null {
	const latestAssistant = [...lane].reverse().find((item) => item.kind === "assistant");
	if (!latestAssistant) return null;
	return parsePendingToolshedAppApproval(latestAssistant.content || latestAssistant.summary || latestAssistant.title || "");
}

function generateId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferMcpAppTitle(brief: string, fallback: string = "New MCP App"): string {
	const normalized = String(brief || "")
		.replace(/[\r\n]+/g, " ")
		.replace(/[^a-zA-Z0-9\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) return fallback;
	const base = normalized.split(" ").slice(0, 4).join(" ").trim();
	if (!base) return fallback;
	const title = humanize(slugify(base));
	return /app$/i.test(title) ? title : `${title} App`;
}

function buildTrackedMcpAppFiles(title: string) {
	const slug = slugify(title || "mcp-app");
	const artifactDir = join("features", "toolshed-mcp-apps", slug).replace(/\\/g, "/");
	const serverFile = `${artifactDir}/server.ts`;
	const viewFile = `${artifactDir}/mcp-app.tsx`;
	const serverId = `toolshed-${slug}`;
	const toolName = `open_${slug.replace(/-/g, "_")}`;
	const resourceUri = `ui://toolshed/${slug}/mcp-app.html`;
	return { slug, artifactDir, serverFile, viewFile, serverId, toolName, resourceUri };
}

function hasDetailedAppBrief(value: string): boolean {
	const normalized = String(value || "").replace(/\s+/g, " ").trim();
	if (!normalized) return false;
	if (normalized.length >= 120) return true;
	const words = normalized.split(/\s+/).filter(Boolean).length;
	const clauses = normalized.split(/[.!?]/).filter((part) => part.trim()).length;
	return words >= 18 || clauses >= 2;
}

function shouldAskAppDataQuestion(goal: string, scope?: string): boolean {
	const combined = `${String(goal || "")} ${String(scope || "")}`.toLowerCase();
	return !/(file|files|folder|folders|repo|repository|workspace|package|packages|dependency|dependencies|api|server|database|db|json|markdown|pdf|map|video|wiki|tool|tools|mcp|lane|chat)/.test(combined);
}

function buildWizardAppBrief(goal: string, scope?: string, dataSources?: string): string {
	return [
		`App goal: ${String(goal || "").trim()}`,
		scope ? `First version: ${String(scope || "").trim()}` : "",
		dataSources ? `Use these files, tools, or data sources when relevant: ${String(dataSources || "").trim()}` : "",
	].filter(Boolean).join("\n\n");
}

function buildAppWizardPlanContent(starterTitle: string, goal: string, scope?: string, dataSources?: string): string {
	return [
		`Goal: ${String(goal || "").trim()}`,
		scope ? `First version: ${String(scope || "").trim()}` : "",
		dataSources ? `Data and tools: ${String(dataSources || "").trim()}` : "",
		`Starter pattern: ${starterTitle}`,
		"Toolshed will create a tracked project card and build the first version in the lane.",
	].filter(Boolean).join("\n\n");
}

function buildInitialAppBuildRequest(goal: string, scope?: string): string {
	if (scope) return `Build the first usable version of this app. Initial scope: ${String(scope || "").trim()}`;
	return `Build the first usable version of this app for: ${String(goal || "").trim()}`;
}

function getExtensionRepoRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function getToolshedWebScriptPath(sourceRoot: string): string {
	return join(sourceRoot, "bin", "toolshed-dashboard-web");
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

function collapseSkillInvocationForLane(content: string): { title: string; content: string } | null {
	const parsed = parseSkillInvocation(content);
	if (!parsed) return null;
	const label = humanize(parsed.name);
	return {
		title: `Skill Launch · ${label}`,
		content: parsed.prompt || `Using the ${label} skill.`,
	};
}

function collectSessionHistoryFromFilePaths(paths: string[]): SessionHistorySegment[] {
	const segments: SessionHistorySegment[] = [];
	for (const filePath of paths) {
		try {
			const raw = readFileSync(filePath, "utf-8");
			for (const line of raw.split("\n")) {
				if (!line.trim()) continue;
				const entry = JSON.parse(line);
				if (entry.type !== "message" || !entry.message) continue;
				const msg = entry.message;
				const content = extractPersistedMessageContent(msg).trim();
				if (!content) continue;
				if (msg.role === "user") {
					const skillLaunch = collapseSkillInvocationForLane(content);
					segments.push({
						role: "user",
						timestamp: String(entry.timestamp || msg.timestamp || nowIso()),
						title: skillLaunch?.title || "User Prompt",
						content: skillLaunch?.content || content,
					});
				} else if (msg.role === "assistant") {
					segments.push({ role: "assistant", timestamp: String(entry.timestamp || msg.timestamp || nowIso()), title: "Assistant Response", content });
				} else if (msg.role === "toolResult") {
					segments.push({ role: "tool", timestamp: String(entry.timestamp || msg.timestamp || nowIso()), title: `Tool Result: ${msg.toolName || "tool"}`, content });
				}
			}
		} catch {}
	}
	return segments.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function collectSessionHistoryFromFiles(sessionDir: string, excludeFiles: string[] = []): SessionHistorySegment[] {
	if (!sessionDir || !existsSync(sessionDir)) return [];
	const files = readdirSync(sessionDir)
		.filter((file) => (file.endsWith(".json") || file.endsWith(".jsonl")) && !excludeFiles.includes(file))
		.sort();
	return collectSessionHistoryFromFilePaths(files.map((file) => join(sessionDir, file)));
}

function getGlobalSessionDirsForCwd(cwd: string): string[] {
	const base = join(homedir(), ".pi", "agent", "sessions");
	if (!existsSync(base)) return [];
	const normalized = cwd.replace(/[\\/]+/g, "-").replace(/^-+|-+$/g, "");
	try {
		return readdirSync(base)
			.map((name) => join(base, name))
			.filter((dirPath) => {
				const name = basename(dirPath);
				return existsSync(dirPath) && name.includes(normalized);
			})
			.sort();
	} catch {
		return [];
	}
}

function getLatestGlobalSessionFilesForCwd(cwd: string, limit: number = 1): string[] {
	const files = getGlobalSessionDirsForCwd(cwd)
		.flatMap((dirPath) => {
			try {
				return readdirSync(dirPath)
					.filter((file) => file.endsWith(".jsonl"))
					.map((file) => join(dirPath, file));
			} catch {
				return [];
			}
		})
		.map((filePath) => {
			try {
				return { filePath, mtimeMs: statSync(filePath).mtimeMs };
			} catch {
				return null;
			}
		})
		.filter(Boolean) as Array<{ filePath: string; mtimeMs: number }>;
	return files
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, Math.max(1, limit))
		.map((entry) => entry.filePath);
}

function normalizeSessionHistoryTimestamp(timestamp: string): string {
	const parsed = Date.parse(timestamp);
	if (!Number.isFinite(parsed)) return timestamp;
	return new Date(Math.floor(parsed / 1000) * 1000).toISOString();
}

function normalizeSessionHistoryContent(content: string): string {
	return String(content || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function dedupeSessionHistory(segments: SessionHistorySegment[]): SessionHistorySegment[] {
	const seen = new Set<string>();
	const deduped: SessionHistorySegment[] = [];
	for (const segment of segments.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
		const key = `${normalizeSessionHistoryTimestamp(segment.timestamp)}|${segment.role}|${segment.title}|${normalizeSessionHistoryContent(segment.content)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(segment);
	}
	return deduped;
}

function extractSkillDescription(markdown: string): string {
	const lines = String(markdown || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("#") && !line.startsWith(">") && !/^[-*]/.test(line));
	return excerptText(lines[0] || "Local skill.", 180);
}

function scanSkillCatalog(cwd: string, extensionRepoRoot: string): ToolshedSkillState[] {
	const roots: Array<{ path: string; sourceKind: ToolshedSkillState["sourceKind"] }> = [];
	const rootSet = new Set<string>();
	for (const candidate of [
		{ path: join(cwd, ".pi", "skills"), sourceKind: "project-runtime" as const },
		{ path: join(cwd, "skills"), sourceKind: "project-repo" as const },
		{ path: join(extensionRepoRoot, "skills"), sourceKind: "extension-repo" as const },
	]) {
		if (rootSet.has(candidate.path)) continue;
		rootSet.add(candidate.path);
		roots.push(candidate);
	}
	const skills = new Map<string, ToolshedSkillState>();
	for (const root of roots) {
		if (!existsSync(root.path)) continue;
		for (const filePath of listFilesRecursive(root.path)) {
			if (basename(filePath).toUpperCase() !== "SKILL.MD") continue;
			const dirPath = dirname(filePath);
			const relativeDir = dirPath.slice(root.path.length + 1) || basename(dirPath);
			const skillId = slugify(relativeDir.replace(/[\\/]+/g, "-"));
			if (skills.has(skillId)) continue;
			let description = "Local skill.";
			try { description = extractSkillDescription(readFileSync(filePath, "utf-8")); } catch {}
			skills.set(skillId, {
				id: skillId,
				label: humanize(basename(dirPath)),
				description,
				sourcePath: filePath,
				sourceKind: root.sourceKind,
			});
		}
	}
	return [...skills.values()].sort((a, b) => a.label.localeCompare(b.label));
}

const PROJECT_MCP_CONFIG_RELATIVE_PATH = join(".factory", "mcp.json").replace(/\\/g, "/");
const LEGACY_PROJECT_MCP_CONFIG_RELATIVE_PATH = ".mcp.json";

function getProjectMcpConfigSources(cwd: string): Array<{
	filePath: string;
	relativePath: string;
	exists: boolean;
	raw: any;
	servers: Record<string, any>;
	parseError: boolean;
}> {
	return [
		{ filePath: join(cwd, LEGACY_PROJECT_MCP_CONFIG_RELATIVE_PATH), relativePath: LEGACY_PROJECT_MCP_CONFIG_RELATIVE_PATH },
		{ filePath: join(cwd, PROJECT_MCP_CONFIG_RELATIVE_PATH), relativePath: PROJECT_MCP_CONFIG_RELATIVE_PATH },
	].map((candidate) => {
		if (!existsSync(candidate.filePath)) {
			return {
				...candidate,
				exists: false,
				raw: null,
				servers: {},
				parseError: false,
			};
		}
		try {
			const raw = JSON.parse(readFileSync(candidate.filePath, "utf-8"));
			const servers = raw?.mcpServers && typeof raw.mcpServers === "object" ? { ...raw.mcpServers } : {};
			return {
				...candidate,
				exists: true,
				raw,
				servers,
				parseError: false,
			};
		} catch {
			return {
				...candidate,
				exists: true,
				raw: null,
				servers: {},
				parseError: true,
			};
		}
	});
}

function writeProjectMcpConfigFile(filePath: string, raw: any) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
}

function readProjectMcpState(cwd: string): ToolshedMcpState {
	const sources = getProjectMcpConfigSources(cwd);
	const preferredFilePath = join(cwd, PROJECT_MCP_CONFIG_RELATIVE_PATH);
	const mergedSource = Object.assign({}, ...sources.map((source) => source.servers));
	const servers = Object.entries(mergedSource).map(([id, config]: [string, any]) => {
		const transport = config?.url ? "remote-http" : config?.command ? "stdio" : "configured";
		const detail = config?.url || [config?.command, ...(Array.isArray(config?.args) ? config.args : [])].filter(Boolean).join(" ") || "Configured";
		const authConfigured = Boolean(config?.env || config?.headers || config?.bearerToken || config?.apiKey);
		const toolHints = Array.isArray(config?.tools) ? config.tools.map((tool: any) => String(tool)) : [];
		const status = authConfigured || transport === "stdio" ? "ready" : "configured";
		return {
			id,
			label: humanize(id),
			transport,
			detail: excerptText(detail, 120),
			status,
			tone: status === "ready" ? "success" : "info",
			authConfigured,
			toolHints,
		} as ToolshedMcpServerState;
	});
	const parseErrors = sources.filter((source) => source.parseError).map((source) => source.relativePath);
	if (!sources.some((source) => source.exists)) {
		return {
			configured: false,
			count: 0,
			summary: "No project MCP configuration detected.",
			filePath: preferredFilePath,
			servers: [],
		};
	}
	const hasProjectConfig = sources.some((source) => source.exists);
	return {
		configured: hasProjectConfig,
		count: servers.length,
		summary: parseErrors.length > 0
			? servers.length > 0
				? `${servers.length} MCP server${servers.length === 1 ? "" : "s"} configured. Unable to parse ${parseErrors.join(" and ")}.`
				: `Unable to parse ${parseErrors.join(" and ")}.`
			: servers.length > 0
				? `${servers.length} MCP server${servers.length === 1 ? "" : "s"} configured in project MCP config.`
				: "Project MCP config found but no servers were configured.",
		filePath: preferredFilePath,
		servers: servers.sort((a, b) => a.label.localeCompare(b.label)),
	};
}

function buildTrackedMcpServerRegistration(card: ToolshedGeneratedCard): Record<string, any> | null {
	const serverFile = String(card.serverFile || "").trim();
	if (!serverFile) return null;
	return {
		type: "stdio",
		command: "npx",
		args: [
			"-y",
			"-p",
			"tsx",
			"-p",
			"zod",
			"-p",
			"@modelcontextprotocol/sdk",
			"tsx",
			serverFile,
		],
	};
}

function upsertTrackedMcpAppRegistration(card: ToolshedGeneratedCard, cwd: string): { changed: boolean; summary: string } {
	const serverId = String(card.serverId || "").trim();
	const registration = buildTrackedMcpServerRegistration(card);
	const serverFile = String(card.serverFile || "").trim();
	if (!serverId) {
		return { changed: false, summary: "Tracked app is missing a server id." };
	}
	if (!registration) {
		return { changed: false, summary: "Tracked app is missing a server file." };
	}
	if (!serverFile || !existsSync(join(cwd, serverFile))) {
		return { changed: false, summary: `Tracked server file is missing: ${serverFile || "not configured"}.` };
	}
	const sources = getProjectMcpConfigSources(cwd);
	const legacySource = sources.find((source) => source.relativePath === LEGACY_PROJECT_MCP_CONFIG_RELATIVE_PATH);
	const preferredSource = sources.find((source) => source.relativePath === PROJECT_MCP_CONFIG_RELATIVE_PATH);
	if (!legacySource || !preferredSource) {
		return { changed: false, summary: "Project MCP config locations are unavailable." };
	}
	if (preferredSource.parseError) {
		return { changed: false, summary: `Unable to parse ${preferredSource.relativePath}.` };
	}
	if (!preferredSource.exists && legacySource.parseError) {
		return { changed: false, summary: `Unable to parse ${legacySource.relativePath}.` };
	}
	const nextPreferred = preferredSource.exists
		? preferredSource.raw && typeof preferredSource.raw === "object" ? { ...preferredSource.raw } : {}
		: { mcpServers: { ...legacySource.servers } };
	const nextPreferredServers = nextPreferred.mcpServers && typeof nextPreferred.mcpServers === "object" ? { ...nextPreferred.mcpServers } : {};
	const preferredPreviousJson = JSON.stringify(nextPreferredServers[serverId] || null);
	nextPreferred.mcpServers = {
		...nextPreferredServers,
		[serverId]: registration,
	};
	const preferredChanged = preferredPreviousJson !== JSON.stringify(registration) || !preferredSource.exists;
	if (preferredChanged) writeProjectMcpConfigFile(preferredSource.filePath, nextPreferred);
	let legacyChanged = false;
	if (legacySource.exists) {
		if (legacySource.parseError) {
			return {
				changed: preferredChanged,
				summary: preferredChanged
					? `Updated ${preferredSource.relativePath} registration for ${serverId}, but ${legacySource.relativePath} could not be parsed.`
					: `Unable to parse ${legacySource.relativePath}.`,
			};
		}
		const nextLegacy = legacySource.raw && typeof legacySource.raw === "object" ? { ...legacySource.raw } : {};
		const existingSettings = nextLegacy.settings && typeof nextLegacy.settings === "object" ? nextLegacy.settings : {};
		const nextLegacyServers = nextLegacy.mcpServers && typeof nextLegacy.mcpServers === "object" ? { ...nextLegacy.mcpServers } : {};
		const legacyPreviousJson = JSON.stringify(nextLegacyServers[serverId] || null);
		nextLegacy.settings = {
			toolPrefix: "server",
			idleTimeout: 10,
			...existingSettings,
		};
		nextLegacy.mcpServers = {
			...nextLegacyServers,
			[serverId]: registration,
		};
		legacyChanged = legacyPreviousJson !== JSON.stringify(registration);
		if (legacyChanged) writeProjectMcpConfigFile(legacySource.filePath, nextLegacy);
	}
	const changed = preferredChanged || legacyChanged;
	return {
		changed,
		summary: changed ? `Updated project MCP registration for ${serverId}.` : `Project MCP registration already matches ${serverId}.`,
	};
}

function readProjectDocuments(cwd: string): ToolshedDocumentState[] {
	return [
		{ id: "prd", label: "PRD", path: join(cwd, "PRD-PI-TOOLSHED.md"), exists: existsSync(join(cwd, "PRD-PI-TOOLSHED.md")) },
		{ id: "instructions", label: "Implementation Instructions", path: join(cwd, "TOOLSHED-IMPLEMENTATION-INSTRUCTIONS.md"), exists: existsSync(join(cwd, "TOOLSHED-IMPLEMENTATION-INSTRUCTIONS.md")) },
		{ id: "checklist", label: "Implementation Checklist", path: join(cwd, "00-IMPLEMENTATION-CHECKLIST.md"), exists: existsSync(join(cwd, "00-IMPLEMENTATION-CHECKLIST.md")) },
		{ id: "readme", label: "README", path: join(cwd, "README.md"), exists: existsSync(join(cwd, "README.md")) },
	];
}

function readGitSummary(cwd: string): ToolshedRepositoryState | null {
	try {
		const raw = execSync("git status --porcelain=v1 --branch", {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 3000,
		}).trimEnd();
		if (!raw) return null;
		const lines = raw.split(/\r?\n/);
		const branchLine = lines[0] || "";
		const branch = branchLine.replace(/^##\s+/, "").split("...")[0] || "HEAD";
		const aheadMatch = branchLine.match(/ahead (\d+)/);
		const behindMatch = branchLine.match(/behind (\d+)/);
		const changed = lines.slice(1).filter(Boolean).length;
		return {
			branch,
			dirty: changed > 0,
			changed,
			ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
			behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
		};
	} catch {
		return null;
	}
}

function actionSend(label: string, text: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "send-message", payload: { text }, variant };
}

function actionSlash(command: string, label?: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label || command), label: label || command, type: "submit-slash-command", payload: { command: ensureSlashCommand(command) }, variant };
}

function actionSkill(label: string, skill?: string, prompt?: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "launch-skill", payload: { skill, prompt }, variant };
}

function actionFreeze(label: string = "Freeze frontier", summary?: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "freeze-frontier", payload: summary ? { summary } : {}, variant };
}

function actionInject(label: string = "Inject latest packet", packetId?: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "inject-packet", payload: packetId ? { packetId } : {}, variant };
}

function actionWorkspace(workspaceId: string, label: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(`${workspaceId}-${label}`), label, type: "switch-workspace", payload: { workspaceId }, variant };
}

function actionMcp(label: string = "Open MCP", serverId?: string, toolName?: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "open-mcp-tool", payload: { serverId, toolName }, variant };
}

function actionOpenBlueprintWeb(label: string = "Open Blueprint", variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "open-blueprint-web", payload: {}, variant };
}

function actionRunCard(label: string, cardId: string, variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(`${cardId}-${label}`), label, type: "run-card", payload: { cardId }, variant };
}

function actionDeleteCard(label: string, cardId: string, variant: ToolshedQuickAction["variant"] = "ghost"): ToolshedQuickAction {
	return { id: slugify(`${cardId}-${label}-delete`), label, type: "delete-custom-card", payload: { cardId }, variant };
}

function actionSeedMermaidCard(label: string = "Seed Mermaid", variant: ToolshedQuickAction["variant"] = "secondary"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "seed-mermaid-card", payload: {}, variant };
}

function actionAbort(label: string = "Request stop", variant: ToolshedQuickAction["variant"] = "ghost"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "abort-run", payload: {}, variant };
}

function actionResetLayout(label: string = "Reset layout", variant: ToolshedQuickAction["variant"] = "ghost"): ToolshedQuickAction {
	return { id: slugify(label), label, type: "reset-layout", payload: {}, variant };
}

export default function (pi: ExtensionAPI) {
	let widgetCtx: ExtensionContext | null = null;
	let sessionDir = "";
	let logDir = "";
	let sessionStateFile = "";
	let toolshedWebUrl = "";
		let toolshedControlSocket: Socket | null = null;
		let toolshedControlConnected = false;
		let toolshedStateFlushTimer: ReturnType<typeof setTimeout> | null = null;
		let transcriptWatchTimer: ReturnType<typeof setInterval> | null = null;
		let mcpAppVerifyTimer: ReturnType<typeof setTimeout> | null = null;
		let mcpAppVerifyRunning = false;
		let lastTranscriptSignature = "";
	let lastStateJson = "";
	let lastTranscriptChangeAt = 0;
	const extensionRepoRoot = getExtensionRepoRoot();
	let persistedState: PersistedToolshedState = createDefaultPersistedState();
	let projectCards: ToolshedGeneratedCard[] = [];

	function createDefaultPersistedState(): PersistedToolshedState {
		return {
			sessionId: generateId("toolshed-session"),
			workspaceId: "all-cards",
			widgetPrefs: {},
			sessionCards: [],
			packets: [],
			laneEvents: [],
			inlineCalculatorSessions: [],
			inlineGithubBoardSessions: [],
			lastInlineGithubBoardFocus: undefined,
			timestamp: Date.now(),
		};
	}

	function getToolshedStateFile(): string {
		return join(logDir || join(widgetCtx?.cwd || process.cwd(), ".pi", "pipeline-logs"), "toolshed-state.json");
	}

	function getProjectCardsFile(cwd: string): string {
		return join(cwd, ".pi", "toolshed-custom-cards.json");
	}

	function normalizeGeneratedCard(value: any, persist: Extract<CardPersistKind, "session" | "project">): ToolshedGeneratedCard | null {
		if (!value || typeof value !== "object") return null;
		const title = String(value.title || "").trim();
		const description = String(value.description || "").trim();
		const promptTemplate = String(value.promptTemplate || "").trim();
		if (!title || !promptTemplate) return null;
		return {
			id: String(value.id || generateId(slugify(title) || "card")).trim(),
			title,
			description,
			promptTemplate,
			kind: String(value.kind || "").trim() === "mcp-app" ? "mcp-app" : "workflow",
			persist,
			createdAt: String(value.createdAt || nowIso()),
			updatedAt: String(value.updatedAt || nowIso()),
			inputPlaceholder: String(value.inputPlaceholder || "").trim() || "What should this card do right now?",
			generatedFrom: String(value.generatedFrom || "").trim() || undefined,
			lastRunAt: value.lastRunAt ? String(value.lastRunAt) : null,
			lastRunInput: value.lastRunInput ? String(value.lastRunInput) : null,
			starterId: String(value.starterId || "").trim() || undefined,
			appBrief: String(value.appBrief || "").trim() || undefined,
			artifactDir: String(value.artifactDir || "").trim() || undefined,
			serverFile: String(value.serverFile || "").trim() || undefined,
			viewFile: String(value.viewFile || "").trim() || undefined,
			resourceUri: String(value.resourceUri || "").trim() || undefined,
			serverId: String(value.serverId || "").trim() || undefined,
			toolName: String(value.toolName || "").trim() || undefined,
			verificationStatus: value.verificationStatus === "pending" || value.verificationStatus === "passed" || value.verificationStatus === "failed"
				? value.verificationStatus
				: "idle",
			verificationSummary: value.verificationSummary ? String(value.verificationSummary) : null,
			verificationDetails: Array.isArray(value.verificationDetails) ? value.verificationDetails.map((line: any) => String(line || "").trim()).filter(Boolean) : [],
			verificationUpdatedAt: value.verificationUpdatedAt ? String(value.verificationUpdatedAt) : null,
			verificationSourceResultAt: value.verificationSourceResultAt ? String(value.verificationSourceResultAt) : null,
			pendingBuildAt: value.pendingBuildAt ? String(value.pendingBuildAt) : null,
			liveDeployedAt: value.liveDeployedAt ? String(value.liveDeployedAt) : null,
			liveDeploymentFingerprint: value.liveDeploymentFingerprint ? String(value.liveDeploymentFingerprint) : null,
			liveDeploymentSummary: value.liveDeploymentSummary ? String(value.liveDeploymentSummary) : null,
		};
	}

	function loadProjectCards(cwd: string): ToolshedGeneratedCard[] {
		const filePath = getProjectCardsFile(cwd);
		if (!existsSync(filePath)) return [];
		try {
			const raw = JSON.parse(readFileSync(filePath, "utf-8"));
			const items = Array.isArray(raw) ? raw : Array.isArray(raw?.cards) ? raw.cards : [];
			return items
				.map((item: any) => normalizeGeneratedCard(item, "project"))
				.filter(Boolean) as ToolshedGeneratedCard[];
		} catch {
			return [];
		}
	}

	function saveProjectCards(cwd: string) {
		try {
			mkdirSync(dirname(getProjectCardsFile(cwd)), { recursive: true });
			writeFileSync(getProjectCardsFile(cwd), JSON.stringify({ version: 1, cards: projectCards }, null, 2), "utf-8");
		} catch {}
		scheduleToolshedStateWrite();
	}

	function listAllCards(): ToolshedGeneratedCard[] {
		return [...projectCards, ...persistedState.sessionCards].sort((a, b) => String(a.title).localeCompare(String(b.title)));
	}

	function findStoredCard(cardId: string): { card: ToolshedGeneratedCard; scope: "session" | "project" } | null {
		const projectCard = projectCards.find((card) => card.id === cardId);
		if (projectCard) return { card: projectCard, scope: "project" };
		const sessionCard = persistedState.sessionCards.find((card) => card.id === cardId);
		return sessionCard ? { card: sessionCard, scope: "session" } : null;
	}

	function nextCardId(title: string): string {
		const base = slugify(title || "card");
		const taken = new Set<string>([
			...WIDGET_DEFINITIONS.map((card) => card.id),
			...listAllCards().map((card) => card.id),
		]);
		if (!taken.has(base)) return base;
		let index = 2;
		while (taken.has(`${base}-${index}`)) index++;
		return `${base}-${index}`;
	}

	function loadSessionState(): PersistedToolshedState | null {
		if (!sessionStateFile || !existsSync(sessionStateFile)) return null;
		try {
			return JSON.parse(readFileSync(sessionStateFile, "utf-8")) as PersistedToolshedState;
		} catch {
			return null;
		}
	}

	function restoreSessionState(state: PersistedToolshedState | null) {
		persistedState = createDefaultPersistedState();
		if (!state || typeof state !== "object") return;
		persistedState.sessionId = typeof state.sessionId === "string" && state.sessionId ? state.sessionId : persistedState.sessionId;
		persistedState.workspaceId = typeof state.workspaceId === "string" && WORKSPACE_PRESETS_STATIC.some((workspace) => workspace.id === state.workspaceId)
			? state.workspaceId
			: persistedState.workspaceId;
		persistedState.widgetPrefs = state.widgetPrefs && typeof state.widgetPrefs === "object" ? state.widgetPrefs : {};
		persistedState.sessionCards = Array.isArray(state.sessionCards)
			? state.sessionCards.map((card: any) => normalizeGeneratedCard(card, "session")).filter(Boolean) as ToolshedGeneratedCard[]
			: [];
		persistedState.packets = Array.isArray(state.packets) ? state.packets.slice(0, MAX_PACKETS) : [];
		persistedState.laneEvents = Array.isArray(state.laneEvents) ? state.laneEvents.slice(-MAX_LANE_EVENTS) : [];
		persistedState.inlineCalculatorSessions = Array.isArray((state as any).inlineCalculatorSessions)
			? (state as any).inlineCalculatorSessions.map((session: any) => normalizeInlineCalculatorSession(session)).filter(Boolean) as ToolshedInlineCalculatorSession[]
			: [];
		persistedState.inlineGithubBoardSessions = Array.isArray((state as any).inlineGithubBoardSessions)
			? (state as any).inlineGithubBoardSessions.map((session: any) => normalizeInlineGithubBoardSession(session)).filter(Boolean) as ToolshedInlineGithubBoardSession[]
			: [];
		persistedState.lastInlineGithubBoardFocus = state.lastInlineGithubBoardFocus && typeof state.lastInlineGithubBoardFocus === "object"
			? {
				sessionId: String((state as any).lastInlineGithubBoardFocus.sessionId || "").trim(),
				column: String((state as any).lastInlineGithubBoardFocus.column || "").trim() || undefined,
				requestedTypes: Array.isArray((state as any).lastInlineGithubBoardFocus.requestedTypes)
					? (state as any).lastInlineGithubBoardFocus.requestedTypes
						.map((entry: any) => String(entry || "").trim().toLowerCase())
						.filter((entry: string) => entry === "task" || entry === "epic" || entry === "sprint") as Array<"task" | "epic" | "sprint">
					: undefined,
				relation: String((state as any).lastInlineGithubBoardFocus.relation || "").trim() === "tasks_for_sprints"
					? "tasks_for_sprints"
					: undefined,
				matchedIssueNumbers: Array.isArray((state as any).lastInlineGithubBoardFocus.matchedIssueNumbers)
					? (state as any).lastInlineGithubBoardFocus.matchedIssueNumbers
						.map((entry: any) => Number(entry))
						.filter((entry: number) => Number.isFinite(entry))
					: undefined,
				askedAt: String((state as any).lastInlineGithubBoardFocus.askedAt || nowIso()),
			}
			: undefined;
		persistedState.timestamp = typeof state.timestamp === "number" ? state.timestamp : Date.now();
	}

	function saveSessionState() {
		if (!sessionStateFile) return;
		try {
			persistedState.timestamp = Date.now();
			writeFileSync(sessionStateFile, JSON.stringify(persistedState, null, 2), "utf-8");
		} catch {}
		scheduleToolshedStateWrite();
	}

	function listInlineCalculatorSessions(): ToolshedInlineCalculatorSession[] {
		return [...persistedState.inlineCalculatorSessions].sort((a, b) =>
			String(b.updatedAt || b.syncedAt || "").localeCompare(String(a.updatedAt || a.syncedAt || ""))
		);
	}

	function getInlineCalculatorSession(match?: { itemId?: string; cardId?: string; sessionId?: string }): ToolshedInlineCalculatorSession | null {
		const itemId = String(match?.itemId || "").trim();
		if (itemId) {
			const exact = persistedState.inlineCalculatorSessions.find((session) => session.itemId === itemId);
			if (exact) return exact;
		}
		const sessionId = String(match?.sessionId || "").trim();
		if (sessionId) {
			const exact = persistedState.inlineCalculatorSessions.find((session) => session.sessionId === sessionId);
			if (exact) return exact;
		}
		const cardId = String(match?.cardId || "").trim();
		if (cardId) {
			const exact = listInlineCalculatorSessions().find((session) => session.cardId === cardId);
			if (exact) return exact;
		}
		return listInlineCalculatorSessions()[0] || null;
	}

	function syncInlineCalculatorSession(value: any): ToolshedInlineCalculatorSession | null {
		const normalized = normalizeInlineCalculatorSession(value);
		if (!normalized) return null;
		persistedState.inlineCalculatorSessions = [
			normalized,
			...persistedState.inlineCalculatorSessions.filter((session) => session.itemId !== normalized.itemId),
		].slice(0, 8);
		saveSessionState();
		return normalized;
	}

	function removeInlineCalculatorSession(itemId: string): boolean {
		const normalizedItemId = String(itemId || "").trim();
		if (!normalizedItemId) return false;
		const before = persistedState.inlineCalculatorSessions.length;
		persistedState.inlineCalculatorSessions = persistedState.inlineCalculatorSessions.filter((session) => session.itemId !== normalizedItemId);
		if (persistedState.inlineCalculatorSessions.length === before) return false;
		saveSessionState();
		return true;
	}

	function listInlineGithubBoardSessions(): ToolshedInlineGithubBoardSession[] {
		return [...persistedState.inlineGithubBoardSessions].sort((a, b) =>
			String(b.updatedAt || b.syncedAt || "").localeCompare(String(a.updatedAt || a.syncedAt || ""))
		);
	}

	function getInlineGithubBoardSession(match?: { itemId?: string; cardId?: string; sessionId?: string }): ToolshedInlineGithubBoardSession | null {
		const itemId = String(match?.itemId || "").trim();
		if (itemId) {
			const exact = persistedState.inlineGithubBoardSessions.find((session) => session.itemId === itemId);
			if (exact) return exact;
		}
		const sessionId = String(match?.sessionId || "").trim();
		if (sessionId) {
			const exact = persistedState.inlineGithubBoardSessions.find((session) => session.sessionId === sessionId);
			if (exact) return exact;
		}
		const cardId = String(match?.cardId || "").trim();
		if (cardId) {
			const exact = listInlineGithubBoardSessions().find((session) => session.cardId === cardId);
			if (exact) return exact;
		}
		return listInlineGithubBoardSessions()[0] || null;
	}

	function syncInlineGithubBoardSession(value: any): ToolshedInlineGithubBoardSession | null {
		const normalized = normalizeInlineGithubBoardSession(value);
		if (!normalized) return null;
		persistedState.inlineGithubBoardSessions = [
			normalized,
			...persistedState.inlineGithubBoardSessions.filter((session) => session.itemId !== normalized.itemId),
		].slice(0, 6);
		saveSessionState();
		return normalized;
	}

	function removeInlineGithubBoardSession(itemId: string): boolean {
		const normalizedItemId = String(itemId || "").trim();
		if (!normalizedItemId) return false;
		const before = persistedState.inlineGithubBoardSessions.length;
		persistedState.inlineGithubBoardSessions = persistedState.inlineGithubBoardSessions.filter((session) => session.itemId !== normalizedItemId);
		if (persistedState.inlineGithubBoardSessions.length === before) return false;
		saveSessionState();
		return true;
	}

	function maybeBuildInlineCalculatorPrompt(userText: string, match?: { itemId?: string; cardId?: string; sessionId?: string }): string | null {
		if (!isInlineCalculatorQuestion(userText)) return null;
		const session = getInlineCalculatorSession(match);
		if (!session) return null;
		return buildInlineCalculatorPrompt(userText, session);
	}

	function maybeBuildInlineGithubBoardPrompt(userText: string, match?: { itemId?: string; cardId?: string; sessionId?: string }): string | null {
		const session = getInlineGithubBoardSession(match);
		if (!session) return null;
		const focus = resolveInlineGithubBoardFocus(userText, session);
		const requestedTypes = focus.requestedTypes && focus.requestedTypes.length > 0 ? focus.requestedTypes : detectGithubBoardRequestedTypes(userText);
		const isBoardQuestion = isInlineGithubBoardQuestion(userText)
			|| Boolean(focus.targetColumn)
			|| requestedTypes.length > 0
			|| Boolean(focus.preferList)
			|| Boolean(focus.relation);
		if (!isBoardQuestion) return null;
		return buildInlineGithubBoardPrompt(userText, session);
	}

	function resolveInlineGithubBoardFocus(
		userText: string,
		session: ToolshedInlineGithubBoardSession,
	): {
		targetColumn?: string | null;
		requestedTypes?: Array<"task" | "epic" | "sprint">;
		preferList?: boolean;
		renderMode?: "list" | "table";
		relation?: "tasks_for_sprints";
		sprintOrdinals?: number[];
		sprintIssueNumbers?: number[];
		matchedIssueNumbers?: number[];
	} {
		const normalized = normalizeInlineText(userText).toLowerCase();
		const targetColumn = detectGithubBoardColumn(normalized);
		const requestedTypes = detectGithubBoardRequestedTypes(normalized);
		const sprintOrdinals = detectGithubBoardSprintOrdinals(normalized);
		const wantsTable = isInlineGithubBoardTableIntent(normalized);
		const focus = persistedState.lastInlineGithubBoardFocus;
		const recentFocusMatches = Boolean(
			focus
			&& focus.sessionId === session.sessionId
			&& Number.isFinite(Date.parse(String(focus.askedAt || "")))
			&& (Date.now() - Date.parse(String(focus.askedAt))) <= 10 * 60 * 1000,
		);
		if (isInlineGithubBoardBareSprintReference(normalized) && recentFocusMatches && focus?.relation === "tasks_for_sprints") {
			return {
				targetColumn: focus.column || null,
				requestedTypes: focus.requestedTypes && focus.requestedTypes.length > 0 ? focus.requestedTypes : ["task"],
				preferList: true,
				renderMode: wantsTable ? "table" : "list",
				relation: "tasks_for_sprints",
				sprintOrdinals,
				matchedIssueNumbers: Array.isArray(focus.matchedIssueNumbers) ? focus.matchedIssueNumbers : undefined,
			};
		}
		if (isInlineGithubBoardAssociationIntent(normalized) && /\btask(?:s)?\b/.test(normalized)) {
			return {
				targetColumn,
				requestedTypes: ["task"],
				preferList: true,
				renderMode: wantsTable ? "table" : "list",
				relation: "tasks_for_sprints",
				sprintOrdinals: sprintOrdinals.length > 0 ? sprintOrdinals : undefined,
				sprintIssueNumbers: sprintOrdinals.length === 0 && recentFocusMatches && focus?.requestedTypes?.includes("sprint") && Array.isArray(focus.matchedIssueNumbers)
					? focus.matchedIssueNumbers
					: undefined,
			};
		}
		if (targetColumn || requestedTypes.length > 0) {
			return {
				targetColumn,
				requestedTypes: requestedTypes.length > 0 ? requestedTypes : undefined,
				renderMode: wantsTable ? "table" : "list",
			};
		}
		const isTypeFollowUp = /(each type|of each type|off each type|count(?:s)? by type|type count(?:s)?)/.test(normalized);
		const isListFollowUp = isInlineGithubBoardListIntent(normalized);
		const isTableFollowUp = wantsTable;
		if (
			(isTypeFollowUp || isListFollowUp || isTableFollowUp)
			&& recentFocusMatches
			&& focus
		) {
			return {
				targetColumn: focus.column || null,
				requestedTypes: Array.isArray(focus.requestedTypes) && focus.requestedTypes.length > 0 ? focus.requestedTypes : undefined,
				preferList: (isListFollowUp || isTableFollowUp) ? true : undefined,
				renderMode: wantsTable ? "table" : "list",
				relation: focus.relation,
				matchedIssueNumbers: Array.isArray(focus.matchedIssueNumbers) ? focus.matchedIssueNumbers : undefined,
			};
		}
		return {};
	}

	function answerInlineGithubBoardQuestionFromMatch(userText: string, match?: { itemId?: string; cardId?: string; sessionId?: string }): string | null {
		const session = getInlineGithubBoardSession(match);
		if (!session) return null;
		const focus = resolveInlineGithubBoardFocus(userText, session);
		const requestedTypes = focus.requestedTypes && focus.requestedTypes.length > 0 ? focus.requestedTypes : detectGithubBoardRequestedTypes(userText);
		const isBoardQuestion = isInlineGithubBoardQuestion(userText)
			|| Boolean(focus.targetColumn)
			|| requestedTypes.length > 0
			|| Boolean(focus.relation);
		if (!isBoardQuestion) return null;
		const answer = answerInlineGithubBoardQuestion(userText, session, focus);
		if (focus.targetColumn || (focus.requestedTypes && focus.requestedTypes.length > 0) || focus.relation) {
			const matchedCards = resolveInlineGithubBoardMatchedCards(session, userText, focus);
			persistedState.lastInlineGithubBoardFocus = {
				sessionId: session.sessionId,
				column: focus.targetColumn || undefined,
				requestedTypes: focus.requestedTypes && focus.requestedTypes.length > 0 ? focus.requestedTypes : undefined,
				relation: focus.relation,
				matchedIssueNumbers: matchedCards.length > 0 ? matchedCards.map((card) => Number(card.number)) : undefined,
				askedAt: nowIso(),
			};
			saveSessionState();
		}
		return answer;
	}

	function appendLocalLaneExchange(userText: string, answerText: string, options?: { cardId?: string; tone?: Tone }) {
		const userContent = String(userText || "").trim();
		const assistantContent = String(answerText || "").trim();
		if (!userContent || !assistantContent) return;
		const userTimestamp = nowIso();
		const assistantTimestamp = new Date(Date.now() + 1).toISOString();
		addLaneEvent({
			kind: "user",
			title: "User Prompt",
			content: userContent,
			summary: excerptText(userContent, 180),
			timestamp: userTimestamp,
			tone: "neutral",
			cardId: options?.cardId,
		});
		addLaneEvent({
			kind: "assistant",
			title: "Assistant Response",
			content: assistantContent,
			summary: excerptText(assistantContent, 220),
			timestamp: assistantTimestamp,
			tone: options?.tone || "success",
			cardId: options?.cardId,
		});
		updateWidget();
	}

	function getTranscriptSignature(ctx: ExtensionContext): string {
		try {
			const branch = ctx.sessionManager.getBranch();
			const last = branch.length > 0 ? branch[branch.length - 1] : null;
			return `${branch.length}:${JSON.stringify(last ?? null).slice(0, 800)}`;
		} catch {
			return "";
		}
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
			const timestamp = String((entry as any).timestamp || msg.timestamp || nowIso());
			if (msg.role === "user") {
				const skillLaunch = collapseSkillInvocationForLane(content);
				branchSegments.push({
					role: "user",
					timestamp,
					title: skillLaunch?.title || "User Prompt",
					content: skillLaunch?.content || content,
				});
			} else if (msg.role === "assistant") {
				branchSegments.push({ role: "assistant", timestamp, title: "Assistant Response", content });
			} else if (msg.role === "toolResult") {
				branchSegments.push({ role: "tool", timestamp, title: `Tool Result: ${(msg as any).toolName || "tool"}`, content });
			}
		}
		const localSegments = collectSessionHistoryFromFiles(sessionDir, ["pi-toolshed-state.json"]);
		const globalSegments = branchSegments.length > 0 || localSegments.length > 0
			? []
			: collectSessionHistoryFromFilePaths(getLatestGlobalSessionFilesForCwd(ctx.cwd));
		return dedupeSessionHistory([
			...globalSegments,
			...localSegments,
			...branchSegments,
		]);
	}

	function addLaneEvent(event: Omit<PersistedLaneEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }) {
		persistedState.laneEvents.push({
			id: event.id || generateId("toolshed-event"),
			timestamp: event.timestamp || nowIso(),
			...event,
		});
		persistedState.laneEvents = persistedState.laneEvents.slice(-MAX_LANE_EVENTS);
		saveSessionState();
	}

	function buildLane(ctx: ExtensionContext): ToolshedLaneItem[] {
		const lane: ToolshedLaneItem[] = collectSessionHistory(ctx).map((segment, index) => {
			const summary = excerptText(segment.content, segment.role === "tool" ? 180 : 220);
			const tone: Tone = segment.role === "tool" ? (/(error|fail|warning)/i.test(segment.content) ? "warning" : "info") : segment.role === "assistant" ? "success" : "neutral";
			return {
				id: `${normalizeSessionHistoryTimestamp(segment.timestamp)}-${segment.role}-${index}`,
				kind: segment.role === "tool" ? "tool" : segment.role,
				title: segment.title,
				content: segment.content,
				summary,
				timestamp: segment.timestamp,
				state: "historical",
				tone,
				meta: segment.role === "tool" ? excerptText(segment.title, 120) : undefined,
			};
		});
		for (const event of persistedState.laneEvents) {
			lane.push({
				id: event.id,
				kind: event.kind,
				title: event.title,
				content: event.content,
				summary: event.summary,
				timestamp: event.timestamp,
				state: "historical",
				tone: event.tone,
				packetId: event.packetId,
				cardId: event.cardId,
				meta: event.kind === "packet" ? "Packet event" : event.kind === "card" ? "Card run" : event.kind === "system" ? "Toolshed event" : undefined,
			});
		}
		lane.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
		const capped = lane.slice(-120);
		if (capped.length === 0) {
			capped.push({
				id: generateId("toolshed-empty"),
				kind: "system",
				title: "Toolshed ready",
				content: "Open the web workspace or send a prompt to begin a lane-first session.",
				summary: "Toolshed is ready.",
				timestamp: nowIso(),
				state: "active",
				tone: "info",
			});
			return capped;
		}
		for (let index = 0; index < capped.length; index++) {
			capped[index].state = index === capped.length - 1 ? "active" : capped[index].kind === "packet" ? "frozen" : "historical";
		}
		return capped;
	}

	function getActiveFrontierItem(lane: ToolshedLaneItem[]): ToolshedLaneItem | null {
		return [...lane].reverse().find((item) => item.kind !== "system") || lane[lane.length - 1] || null;
	}

	function readBlueprintSnapshot(cwd: string): ToolshedBlueprintSnapshot | null {
		const filePath = join(cwd, ".pi", "pipeline-logs", "blueprint-state.json");
		if (!existsSync(filePath)) return null;
		try {
			const raw = JSON.parse(readFileSync(filePath, "utf-8"));
			const widgetMirror = raw?.widgetMirror || {};
			const scoreCard = widgetMirror?.scoreCard || {};
			const assetCard = widgetMirror?.assetCard || {};
			return {
				phaseLabel: String(widgetMirror?.phaseLabel || raw?.phase || "Blueprint ready").trim() || "Blueprint ready",
				scoreLabel: String(scoreCard?.label || raw?.reviewScore?.label || "Planning not started").trim() || "Planning not started",
				gateLabel: String(scoreCard?.gateLabel || "Open Blueprint to start planning.").trim() || "Open Blueprint to start planning.",
				assetStatus: String(assetCard?.statusText || assetCard?.stateText || "Blueprint assets unavailable").trim() || "Blueprint assets unavailable",
				webUrl: String(raw?.webUrl || "http://127.0.0.1:3151").trim() || "http://127.0.0.1:3151",
				prdPath: raw?.prdPath ? String(raw.prdPath) : null,
				checklistPath: raw?.checklistPath ? String(raw.checklistPath) : null,
				active: String(raw?.phase || "idle") !== "idle" || Number(raw?.consultationCount || 0) > 0,
			};
		} catch {
			return null;
		}
	}

	function defaultPromptTemplate(title: string, description: string): string {
		return [
			`Workflow: ${title}`,
			description ? `Goal: ${description}` : "Goal: produce a focused result for the current task.",
			"Operator request: {{input}}",
			"Current frontier: {{frontier}}",
			"Latest user ask: {{latestUser}}",
			"Project: {{projectName}} ({{projectDir}})",
			"Return a concise result with the next action.",
		].join("\n\n");
	}

	function buildBuilderExamples(ctx: ExtensionContext): ToolshedBuilderExample[] {
		const projectName = basename(ctx.cwd) || ctx.cwd;
		const makeExample = (config: {
			id: string;
			title: string;
			summary: string;
			sources: ToolshedBuilderExampleSource[];
			compliance: string[];
			description: string;
			promptTemplate: string;
			inputPlaceholder: string;
			generatedFrom: string;
			preferredId: string;
			laneTitle: string;
			laneSummary: string;
			howItWorks: string[];
			toolSnippet?: string;
			viewSnippet?: string;
			toolLabel?: string;
			viewLabel?: string;
			notes?: string[];
		}): ToolshedBuilderExample => {
			const laneParts = [
				`## ${config.title}`,
				"",
				config.summary,
				"",
				"### How it operates",
				"",
				...config.howItWorks.map((line) => `- ${line}`),
				"",
				"### Source files",
				"",
				...config.sources.map((source) => `- [${source.label}](${source.url})`),
			];
			if (config.toolSnippet) {
				laneParts.push("", `### ${config.toolLabel || "Server pattern"}`, "", "```ts", config.toolSnippet, "```");
			}
			if (config.viewSnippet) {
				laneParts.push("", `### ${config.viewLabel || "View bridge"}`, "", "```ts", config.viewSnippet, "```");
			}
			laneParts.push("", "### Compliance checklist", "", ...config.compliance.map((line) => `- ${line}`));
			if (Array.isArray(config.notes) && config.notes.length > 0) {
				laneParts.push("", "### Notes", "", ...config.notes.map((line) => `- ${line}`));
			}
			return {
				id: config.id,
				title: config.title,
				summary: config.summary,
				sources: config.sources,
				compliance: config.compliance,
				howItWorks: config.howItWorks,
				notes: config.notes,
				toolSnippet: config.toolSnippet || "",
				viewSnippet: config.viewSnippet || "",
				preset: {
					title: config.title,
					description: config.description,
					promptTemplate: config.promptTemplate,
					inputPlaceholder: config.inputPlaceholder,
					generatedFrom: config.generatedFrom,
					preferredId: config.preferredId,
				},
				laneTitle: config.laneTitle,
				laneSummary: config.laneSummary,
				laneContent: laneParts.join("\n"),
			};
		};

		return [
			makeExample({
				id: "basic-server-react",
				title: "Basic Server React",
				summary: "Smallest end-to-end MCP App: tool metadata, `ui://` resource, React host bridge, and inline-ready lane behavior.",
				sources: [
					{ label: "MCP Apps quickstart", url: "https://modelcontextprotocol.io/extensions/apps/build" },
					{ label: "basic-server-react/server.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-react/server.ts" },
					{ label: "basic-server-react/src/mcp-app.tsx", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-server-react/src/mcp-app.tsx" },
					{ label: "basic-host/src/implementation.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-host/src/implementation.ts" },
				],
				compliance: [
					"Tool points to `ui://` resource via `_meta.ui.resourceUri`.",
					"Resource is returned with `RESOURCE_MIME_TYPE`.",
					"Host can render the view inline in the lane.",
					"View handles `ontoolinput` and `ontoolresult`.",
					"Follow-ups use `sendMessage` or `openLink` explicitly.",
				],
				description: `Draft a basic React MCP App for ${projectName} using the official inline starter pattern.`,
				promptTemplate: [
					"Build a React-based MCP App starter for this request: {{input}}",
					"Follow the `basic-server-react` example and keep the primary experience inline.",
					"Register the tool with `_meta.ui.resourceUri`, return the paired `ui://` resource with `RESOURCE_MIME_TYPE`, and wire `ontoolinput` / `ontoolresult` in the View.",
					"Current frontier: {{frontier}}",
					"Latest user ask: {{latestUser}}",
					"Project: {{projectName}} ({{projectDir}})",
					"Return server code, view code, and short host notes for inline display.",
				].join("\n\n"),
				inputPlaceholder: "What should the basic React MCP app do?",
				generatedFrom: "basic-server-react",
				preferredId: "basic-server-react-builder",
				laneTitle: "MCP Example · Basic Server React",
				laneSummary: "Basic Server React example added to the lane.",
				howItWorks: [
					"The host calls a tool such as `get-time`.",
					"The tool metadata links to a `ui://...` resource, so the host also fetches the UI resource and renders it inline.",
					"The React View receives input and results through `ontoolinput` and `ontoolresult`.",
					"The View can send explicit follow-up messages or open external links without taking over the entire chat.",
				],
				toolLabel: "Tool + resource linkage",
				toolSnippet: [
					'const resourceUri = "ui://get-time/mcp-app.html";',
					"",
					'registerAppTool(server, "get-time", {',
					'  title: "Get Time",',
					'  description: "Returns the current server time.",',
					"  inputSchema: {},",
					"  _meta: { ui: { resourceUri } },",
					"}, async () => ({",
					'  content: [{ type: "text", text: new Date().toISOString() }],',
					"}));",
					"",
					"registerAppResource(server, resourceUri, resourceUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({",
					"  contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],",
					"}));",
				].join("\n"),
				viewSnippet: [
					"app.ontoolinput = async (input) => {",
					'  console.info("Received tool call input:", input);',
					"};",
					"",
					"app.ontoolresult = async (result) => {",
					'  console.info("Received tool call result:", result);',
					"  setToolResult(result);",
					"};",
					"",
					"await app.sendMessage({ role: \"user\", content: [{ type: \"text\", text: messageText }] });",
				].join("\n"),
			}),
			makeExample({
				id: "pdf-server",
				title: "PDF Server",
				summary: "Chunked PDF viewer pattern: a UI tool opens the app, an app-only helper tool streams byte ranges, and the View can update model context or request fullscreen.",
				sources: [
					{ label: "pdf-server/README.md", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/pdf-server/README.md" },
					{ label: "pdf-server/server.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/pdf-server/server.ts" },
					{ label: "pdf-server/src/mcp-app.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/pdf-server/src/mcp-app.ts" },
				],
				compliance: [
					"Main UI tool stays inline and points at a `ui://` resource.",
					"Large payloads stay out of the first response; the View pulls chunks on demand.",
					"App-only helper tools remain private to the iframe experience.",
					"Visible page or selection can be mirrored back with `updateModelContext`.",
					"The View can request fullscreen for long-form reading when the host allows it.",
				],
				description: `Draft a PDF-style MCP App for ${projectName} that streams large content in chunks and mirrors reader state back to the model.`,
				promptTemplate: [
					"Build a PDF-style MCP App for this request: {{input}}",
					"Follow the `pdf-server` pattern: a UI tool opens the viewer, a private app-only helper tool streams byte ranges on demand, and the View updates model context as the reader moves.",
					"Keep the default display inline, but note how fullscreen escalation should work.",
					"Current frontier: {{frontier}}",
					"Latest user ask: {{latestUser}}",
					"Project: {{projectName}} ({{projectDir}})",
					"Return server code, View logic, chunk-loading flow, and model-context notes.",
				].join("\n\n"),
				inputPlaceholder: "What document flow should the PDF app support?",
				generatedFrom: "pdf-server",
				preferredId: "pdf-server-builder",
				laneTitle: "MCP Example · PDF Server",
				laneSummary: "PDF Server example added to the lane.",
				howItWorks: [
					"A primary UI tool opens the reader and passes the initial resource handle into the iframe app.",
					"The View then calls a hidden app-only helper tool repeatedly to fetch byte ranges instead of loading the whole PDF at once.",
					"As the reader changes page or selection, the app can push a compact summary back to the model with `updateModelContext`.",
					"When the document needs more space, the app can request fullscreen without abandoning the inline lane entry.",
				],
				toolLabel: "Chunk-loading server pattern",
				toolSnippet: [
					'const resourceUri = "ui://pdf-viewer/mcp-app.html";',
					"",
					'registerAppTool(server, "open-pdf", {',
					'  title: "Open PDF",',
					"  inputSchema: { uri: z.string() },",
					"  _meta: { ui: { resourceUri } },",
					"}, async ({ uri }) => ({ structuredContent: { uri, viewUUID: crypto.randomUUID() } }));",
					"",
					'registerAppTool(server, "read_pdf_bytes", {',
					'  title: "Read PDF Bytes",',
					"  inputSchema: { uri: z.string(), offset: z.number(), byteCount: z.number() },",
					"  _meta: { ui: { visibility: [\"app\"] } },",
					"}, async ({ uri, offset, byteCount }) => ({",
					"  structuredContent: { bytes, offset, byteCount, totalBytes, hasMore },",
					"}));",
				].join("\n"),
				viewSnippet: [
					"const chunk = await app.callServerTool({",
					'  name: "read_pdf_bytes",',
					"  arguments: { uri, offset, byteCount },",
					"});",
					"",
					"await app.updateModelContext({",
					'  text: `Reader is on page ${pageNumber} of ${pageCount}.`,',
					"});",
					"",
					"await app.requestDisplayMode({ mode: \"fullscreen\" });",
				].join("\n"),
				notes: ["The official example also persists per-view state with a `viewUUID` so the reader can resume where it left off."],
			}),
			makeExample({
				id: "map-server",
				title: "Map Server",
				summary: "Inline-first map/globe pattern: the View boots from tool input, can restore camera state per view, and may mirror visible map state back to the model.",
				sources: [
					{ label: "map-server/README.md", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/map-server/README.md" },
					{ label: "map-server/server.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/map-server/server.ts" },
					{ label: "map-server/src/mcp-app.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/map-server/src/mcp-app.ts" },
				],
				compliance: [
					"Default experience stays inline and can escalate only when needed.",
					"CSP/resource domains are declared for external tiles or scripts.",
					"Per-view state is keyed so the host can restore the same map session.",
					"The app can send the visible selection back with `updateModelContext`.",
					"Host context changes keep the embedded view aligned with lane layout.",
				],
				description: `Draft a map-style MCP App for ${projectName} that starts inline, preserves view state, and mirrors visible selections back to the model.`,
				promptTemplate: [
					"Build a map-style MCP App for this request: {{input}}",
					"Follow the `map-server` pattern: start inline, pass initial location through tool input, keep per-view state keyed by view UUID, and use `updateModelContext` when the visible map selection changes.",
					"Mention any CSP/resource domains required for external map assets.",
					"Current frontier: {{frontier}}",
					"Latest user ask: {{latestUser}}",
					"Project: {{projectName}} ({{projectDir}})",
					"Return server code, View logic, state persistence notes, and host display guidance.",
				].join("\n\n"),
				inputPlaceholder: "What location or geography workflow should the map app support?",
				generatedFrom: "map-server",
				preferredId: "map-server-builder",
				laneTitle: "MCP Example · Map Server",
				laneSummary: "Map Server example added to the lane.",
				howItWorks: [
					"The tool opens the map UI and passes the initial location into the View through tool input.",
					"The View restores any stored camera state for the same `viewUUID` and stays inline by default.",
					"Secondary tools such as geocoding can be called from within the app as the user searches or expands context.",
					"When the visible region or selected place changes, the View can summarize that state back to the model.",
				],
				toolLabel: "Inline map launch pattern",
				toolSnippet: [
					'const resourceUri = "ui://show-map/mcp-app.html";',
					"",
					'registerAppTool(server, "show-map", {',
					'  title: "Show Map",',
					"  inputSchema: { query: z.string() },",
					"  _meta: { ui: { resourceUri } },",
					"}, async ({ query }) => ({ structuredContent: { query, viewUUID: crypto.randomUUID() } }));",
					"",
					'registerTool(server, "geocode", { inputSchema: { query: z.string() } }, async ({ query }) => ({ structuredContent: await geocode(query) }));',
				].join("\n"),
				viewSnippet: [
					"app.ontoolinput = async (input) => {",
					"  setInitialLocation(input.structuredContent?.query);",
					"};",
					"",
					"const geocodeResult = await app.callServerTool({ name: \"geocode\", arguments: { query } });",
					"",
					"await app.updateModelContext({",
					'  text: `Map focused on ${selectedPlace.label}.`,',
					"});",
					"",
					"await app.requestDisplayMode({ mode: \"fullscreen\" });",
				].join("\n"),
				notes: ["The official example declares CSP/resource domains for the external mapping stack and persists camera state per view."],
			}),
			makeExample({
				id: "video-resource-server",
				title: "Video Resource",
				summary: "Binary resource pattern: the tool hands the View a URI, the app reads a server resource blob, and the browser turns it into playable media inline.",
				sources: [
					{ label: "video-resource-server/README.md", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/video-resource-server/README.md" },
					{ label: "video-resource-server/server.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/video-resource-server/server.ts" },
					{ label: "video-resource-server/src/mcp-app.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/video-resource-server/src/mcp-app.ts" },
				],
				compliance: [
					"Binary media is exposed as a resource, not embedded in the first tool response.",
					"The tool returns a URI that the View can resolve with `readServerResource`.",
					"The server returns a `blob` plus MIME type for the View to decode.",
					"The inline lane entry can mirror a short markdown summary beside the media preview.",
				],
				description: `Draft a binary-resource MCP App for ${projectName} that previews media inline using a resource URI and browser object URL.`,
				promptTemplate: [
					"Build a media-preview MCP App for this request: {{input}}",
					"Follow the `video-resource-server` pattern: return a resource URI from the tool, fetch the binary payload in the View with `readServerResource`, and convert it into a browser object URL for inline playback.",
					"Keep the first lane response small and lane-friendly.",
					"Current frontier: {{frontier}}",
					"Latest user ask: {{latestUser}}",
					"Project: {{projectName}} ({{projectDir}})",
					"Return server code, resource handling code, and inline preview notes.",
				].join("\n\n"),
				inputPlaceholder: "What media should the resource preview app support?",
				generatedFrom: "video-resource-server",
				preferredId: "video-resource-server-builder",
				laneTitle: "MCP Example · Video Resource",
				laneSummary: "Video Resource example added to the lane.",
				howItWorks: [
					"The first tool call returns a `videoUri` instead of pushing binary bytes directly into the lane.",
					"The iframe app then reads that URI as a server resource when it is ready to display the asset.",
					"The server returns a base64 `blob` plus MIME type, and the browser converts it to an object URL for the `<video>` element.",
					"That keeps the lane response lightweight while still allowing a rich inline preview.",
				],
				toolLabel: "Binary resource server pattern",
				toolSnippet: [
					'registerResource(server, new ResourceTemplate("videos://{id}"), async ({ id }) => ({',
					"  contents: [{",
					'    uri: `videos://${id}`,',
					'    mimeType: "video/mp4",',
					"    blob: base64VideoBytes,",
					"  }],",
					"}));",
					"",
					'registerAppTool(server, "play_video", { _meta: { ui: { resourceUri } } }, async () => ({',
					'  structuredContent: { videoUri: "videos://demo" },',
					"}));",
				].join("\n"),
				viewSnippet: [
					"const resource = await app.readServerResource({ uri: videoUri });",
					"const file = resource.contents[0];",
					"const bytes = decodeBase64(file.blob);",
					"const objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));",
					"videoEl.src = objectUrl;",
				].join("\n"),
			}),
			makeExample({
				id: "wiki-explorer-server",
				title: "Wiki Explorer",
				summary: "Recursive exploration pattern: the View seeds a graph from the first result, then keeps calling tools from inside the iframe as the operator expands nodes.",
				sources: [
					{ label: "wiki-explorer-server/README.md", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/wiki-explorer-server/README.md" },
					{ label: "wiki-explorer-server/server.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/wiki-explorer-server/server.ts" },
					{ label: "wiki-explorer-server/src/mcp-app.ts", url: "https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/wiki-explorer-server/src/mcp-app.ts" },
				],
				compliance: [
					"Initial tool result seeds the interactive graph in the lane.",
					"The View can call the same or related tools recursively as the user explores.",
					"Structured graph data stays inside `structuredContent` rather than raw prose.",
					"External navigation is explicit through `openLink`.",
				],
				description: `Draft a recursive explorer MCP App for ${projectName} that expands graph nodes from within the View and keeps the lane summary concise.`,
				promptTemplate: [
					"Build a recursive explorer MCP App for this request: {{input}}",
					"Follow the `wiki-explorer-server` pattern: seed the UI from the initial tool result, keep graph data in `structuredContent`, and let the View call tools again as the user expands nodes.",
					"Use `openLink` only for explicit handoffs out of the embedded experience.",
					"Current frontier: {{frontier}}",
					"Latest user ask: {{latestUser}}",
					"Project: {{projectName}} ({{projectDir}})",
					"Return server code, recursive View logic, and lane summary guidance.",
				].join("\n\n"),
				inputPlaceholder: "What graph or explorer flow should this app support?",
				generatedFrom: "wiki-explorer-server",
				preferredId: "wiki-explorer-server-builder",
				laneTitle: "MCP Example · Wiki Explorer",
				laneSummary: "Wiki Explorer example added to the lane.",
				howItWorks: [
					"The first tool call returns the root page and its first-degree links as structured graph data.",
					"The View uses that result to seed the visual graph inside the inline lane surface.",
					"When the user expands a node, the View calls the tool again with the selected page to fetch the next ring of data.",
					"The user can open a chosen article explicitly with `openLink` without losing the current graph state.",
				],
				toolLabel: "Recursive graph tool pattern",
				toolSnippet: [
					'const resourceUri = "ui://wiki-explorer/mcp-app.html";',
					"",
					'registerAppTool(server, "get-first-degree-links", {',
					'  title: "Get First Degree Links",',
					"  inputSchema: { page: z.string() },",
					"  _meta: { ui: { resourceUri } },",
					"}, async ({ page }) => ({",
					"  structuredContent: { page, links, error: null },",
					"}));",
				].join("\n"),
				viewSnippet: [
					"app.ontoolresult = async (result) => {",
					"  seedGraph(result.structuredContent);",
					"};",
					"",
					"const next = await app.callServerTool({",
					'  name: "get-first-degree-links",',
					"  arguments: { page: node.title },",
					"});",
					"appendGraph(next.structuredContent);",
					"await app.openLink({ url: selectedArticleUrl });",
				].join("\n"),
			}),
		];
	}

	function getBuilderExample(exampleId: string, ctx: ExtensionContext): ToolshedBuilderExample | null {
		const normalized = exampleId === "mcp-ui-inline" ? "basic-server-react" : exampleId;
		return buildBuilderExamples(ctx).find((example) => example.id === normalized) || null;
	}

	function listTrackedMcpAppCards(): ToolshedGeneratedCard[] {
		return listAllCards()
			.filter((card) => card.kind === "mcp-app")
			.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
	}

	async function selectAppStarterPattern(ctx: ExtensionContext): Promise<ToolshedBuilderExample | null> {
		const examples = buildBuilderExamples(ctx);
		if (examples.length === 0) return null;
		if (!ctx.hasUI) return examples[0] || null;
		const options = examples.map((example) => ({
			example,
			label: `${example.title} — ${example.summary}`,
		}));
		const selected = await ctx.ui.select("Choose MCP app starter", options.map((option) => option.label));
		if (!selected) return null;
		return options.find((option) => option.label === selected)?.example || null;
	}

	function buildMcpAppPromptTemplate(card: ToolshedGeneratedCard, starter: ToolshedBuilderExample): string {
		return [
			`Build or extend the MCP app "${card.title}".`,
			"Requested change:",
			"{{input}}",
			"Original app brief:",
			"{{appBrief}}",
			`Starter pattern: {{starterTitle}} — {{starterSummary}}`,
			"Tracked files:",
			"- {{serverFile}}",
			"- {{viewFile}}",
			"- {{artifactDir}}",
			"Keep the experience inline-first and extend the existing app instead of rebuilding it.",
			"If runtime wiring is ready, register server id {{serverId}} in the project MCP config (.factory/mcp.json).",
			"Project:",
			"{{projectName}} ({{projectDir}})",
			"Return:",
			"1. files created or updated",
			"2. registration/runtime status",
			"3. the next additions the user can ask for",
		].join("\n\n");
	}

	function createMcpAppCard(input: {
		title?: string;
		brief: string;
		starterId?: string;
		persist?: Extract<CardPersistKind, "session" | "project">;
		runNow?: boolean;
	}, silent?: boolean): ToolshedGeneratedCard | null {
		const ctx = widgetCtx;
		if (!ctx) return null;
		try {
			const brief = String(input.brief || "").trim();
			if (!brief) {
				addLaneEvent({
					kind: "system",
					title: "App prompt required",
					content: "Toolshed needs an app prompt before it can create a tracked MCP app.\n\nUse /toolshed-app to start the guided wizard, or launch the Toolshed App Builder skill first.",
					summary: "App prompt required. Run /toolshed-app.",
					tone: "warning",
				});
				ctx.ui.notify("An app prompt is required. Run /toolshed-app to start the wizard.", "warning");
				return null;
			}
			const starterId = String(input.starterId || "basic-server-react").trim() || "basic-server-react";
			const starter = getBuilderExample(starterId, ctx) || getBuilderExample("basic-server-react", ctx);
			if (!starter) return null;
			const title = String(input.title || "").trim() || inferMcpAppTitle(brief, `${starter.title} App`);
			const tracked = buildTrackedMcpAppFiles(title);
			const card = createGeneratedCard({
				title,
				description: excerptText(brief, 180),
				promptTemplate: buildMcpAppPromptTemplate({
					id: `mcp-app-${tracked.slug}`,
					title,
					description: brief,
					promptTemplate: "",
					kind: "mcp-app",
					persist: input.persist || "project",
					createdAt: nowIso(),
					updatedAt: nowIso(),
					inputPlaceholder: "What should this app add next?",
					generatedFrom: `mcp-app:${starter.id}:${tracked.slug}`,
					lastRunAt: null,
					lastRunInput: null,
					starterId: starter.id,
					appBrief: brief,
					artifactDir: tracked.artifactDir,
					serverFile: tracked.serverFile,
					viewFile: tracked.viewFile,
					resourceUri: tracked.resourceUri,
					serverId: tracked.serverId,
					toolName: tracked.toolName,
				}, starter),
				kind: "mcp-app",
				persist: input.persist || "project",
				inputPlaceholder: "What should this app add next?",
				preferredId: `mcp-app-${tracked.slug}`,
				generatedFrom: `mcp-app:${starter.id}:${tracked.slug}`,
				starterId: starter.id,
				appBrief: brief,
				artifactDir: tracked.artifactDir,
				serverFile: tracked.serverFile,
				viewFile: tracked.viewFile,
				resourceUri: tracked.resourceUri,
				serverId: tracked.serverId,
				toolName: tracked.toolName,
			}, silent);
			if (card && input.runNow) runGeneratedCard(card.id, brief);
			return card;
		} catch (error) {
			console.error("[pi-toolshed] createMcpAppCard failed", error);
			ctx.ui.notify("Unable to create the MCP app card. Check the Pi log for details.", "warning");
			return null;
		}
	}

	async function runToolshedAppWizard(ctx: ExtensionContext, seedBrief?: string) {
		const seeded = String(seedBrief || "").trim();
		const trackedCards = listTrackedMcpAppCards();
		if (!seeded && ctx.hasUI && trackedCards.length > 0) {
			const options = [
				{ mode: "create" as const, label: "Create new app — ask a few questions and build the first version" },
				...trackedCards.map((card) => ({
					mode: "update" as const,
					card,
					label: `Update ${card.title} — ${excerptText(card.appBrief || card.description || "Tracked MCP app", 84)}`,
				})),
			];
			const selected = await ctx.ui.select("Toolshed app flow", options.map((option) => option.label));
			if (!selected) return;
			const choice = options.find((option) => option.label === selected);
			if (!choice) return;
			if (choice.mode === "update" && choice.card) {
				const request = String(await ctx.ui.input(`What should ${choice.card.title} add next?`, "") || "").trim();
				if (!request) {
					ctx.ui.notify("Toolshed app update cancelled.", "info");
					return;
				}
				runGeneratedCard(choice.card.id, request);
				ctx.ui.notify(`Queued update for ${choice.card.title}`, "info");
				return;
			}
		}

		let goal = seeded;
		if (!goal && ctx.hasUI) {
			goal = String(await ctx.ui.input("What should this app help with?", "") || "").trim();
		}
		if (!goal) {
			addLaneEvent({
				kind: "system",
				title: "App wizard needs a prompt",
				content: "Start with a short app goal, for example: `/toolshed-app build a package health dashboard for this workspace`.",
				summary: "Toolshed app wizard needs an app goal.",
				tone: "warning",
			});
			if (ctx.hasUI) ctx.ui.notify("Add a short app goal to continue. Example: /toolshed-app build a package health dashboard for this workspace", "warning");
			return;
		}

		let scope = "";
		if (ctx.hasUI) {
			const scopePrompt = hasDetailedAppBrief(goal)
				? "First version scope (optional)"
				: "What should the first version do first?";
			scope = String(await ctx.ui.input(scopePrompt, "") || "").trim();
		}

		let dataSources = "";
		if (ctx.hasUI && shouldAskAppDataQuestion(goal, scope)) {
			dataSources = String(await ctx.ui.input("What files, tools, or data should it use? (optional)", "") || "").trim();
		}

		const starter = await selectAppStarterPattern(ctx);
		if (!starter) {
			if (ctx.hasUI) ctx.ui.notify("No starter selected. Toolshed app wizard cancelled.", "info");
			return;
		}

		const inferredTitle = inferMcpAppTitle([goal, scope].filter(Boolean).join(" "), `${starter.title} App`);
		const title = ctx.hasUI
			? (String(await ctx.ui.input("App name", inferredTitle) || "").trim() || inferredTitle)
			: inferredTitle;
		const brief = buildWizardAppBrief(goal, scope, dataSources);
		const card = createMcpAppCard({
			title,
			brief,
			starterId: starter.id,
			persist: "project",
			runNow: false,
		}, true);
		if (!card) return;

		addLaneEvent({
			kind: "system",
			title: `App plan captured · ${card.title}`,
			content: buildAppWizardPlanContent(starter.title, goal, scope, dataSources),
			summary: `Captured app plan for ${card.title}`,
			tone: "info",
			cardId: card.id,
		});
		runGeneratedCard(card.id, buildInitialAppBuildRequest(goal, scope));
		if (ctx.hasUI) ctx.ui.notify(`Started tracked app: ${card.title}`, "info");
	}

	function renderGeneratedCardPrompt(card: ToolshedGeneratedCard, ctx: ExtensionContext, lane: ToolshedLaneItem[], inputText?: string): string {
		const frontier = getActiveFrontierItem(lane);
		const latestUser = [...lane].reverse().find((item) => item.kind === "user") || null;
		const latestAssistant = [...lane].reverse().find((item) => item.kind === "assistant") || null;
		const latestTool = [...lane].reverse().find((item) => item.kind === "tool") || null;
		const starter = card.starterId ? getBuilderExample(card.starterId, ctx) : null;
		const replacements: Record<string, string> = {
			input: String(inputText || "").trim(),
			frontier: frontier?.summary || frontier?.title || "No frontier yet.",
			latestUser: latestUser?.summary || latestUser?.content || "No user prompt captured yet.",
			latestAssistant: latestAssistant?.summary || latestAssistant?.content || "No assistant response captured yet.",
			latestTool: latestTool?.summary || latestTool?.content || "No tool result captured yet.",
			projectDir: ctx.cwd,
			projectName: basename(ctx.cwd) || ctx.cwd,
			appBrief: card.appBrief || card.description || "No app brief recorded.",
			starterTitle: starter?.title || humanize(card.starterId || "workflow"),
			starterSummary: starter?.summary || card.description || "No starter summary recorded.",
			artifactDir: card.artifactDir || "No tracked app folder yet.",
			serverFile: card.serverFile || card.artifactDir || "No tracked server file yet.",
			viewFile: card.viewFile || card.artifactDir || "No tracked view file yet.",
			resourceUri: card.resourceUri || "ui://toolshed/mcp-app.html",
			serverId: card.serverId || "toolshed-mcp-app",
			toolName: card.toolName || "open_toolshed_mcp_app",
		};
		let output = card.promptTemplate || defaultPromptTemplate(card.title, card.description);
		for (const [key, value] of Object.entries(replacements)) {
			output = output.replace(new RegExp(`{{\\s*${key}\\s*}}`, "g"), value);
		}
		return output.replace(/\n{3,}/g, "\n\n").trim();
	}

	function getLatestResultForCard(card: ToolshedGeneratedCard, lane: ToolshedLaneItem[], sinceTimestamp?: string | null): ToolshedLaneItem | null {
		const since = String(sinceTimestamp || card.pendingBuildAt || card.lastRunAt || "").trim();
		if (!since) return null;
		return [...lane].reverse().find((item) => {
			if (!["assistant", "tool", "packet"].includes(item.kind)) return false;
			return String(item.timestamp) >= since;
		}) || null;
	}

	function getTrackedCardFileState(card: ToolshedGeneratedCard, ctx: ExtensionContext): {
		serverPath: string;
		viewPath: string;
		serverExists: boolean;
		viewExists: boolean;
	} {
		const serverPath = card.serverFile ? join(ctx.cwd, card.serverFile) : "";
		const viewPath = card.viewFile ? join(ctx.cwd, card.viewFile) : "";
		return {
			serverPath,
			viewPath,
			serverExists: Boolean(serverPath && existsSync(serverPath)),
			viewExists: Boolean(viewPath && existsSync(viewPath)),
		};
	}

	function buildTrackedMcpDeploymentFingerprint(card: ToolshedGeneratedCard, ctx: ExtensionContext, mcp: ToolshedMcpState): string {
		const fileState = getTrackedCardFileState(card, ctx);
		const serverMtime = fileState.serverExists ? String(statSync(fileState.serverPath).mtimeMs) : "missing";
		const viewMtime = fileState.viewExists ? String(statSync(fileState.viewPath).mtimeMs) : "missing";
		const registered = isTrackedMcpCardRegistered(card, mcp) ? "registered" : "unregistered";
		return [
			String(card.serverId || "").trim(),
			String(card.serverFile || "").trim(),
			serverMtime,
			String(card.viewFile || "").trim(),
			viewMtime,
			registered,
			String(card.verificationStatus || "idle"),
		].join("|");
	}

	function getTrackedMcpLiveState(card: ToolshedGeneratedCard, ctx: ExtensionContext, mcp: ToolshedMcpState): {
		status: "inactive" | "live" | "stale";
		label: string;
		summary: string;
		deployedAt: string | null;
		fingerprint: string | null;
	} {
		const deployedAt = card.liveDeployedAt || null;
		if (!deployedAt) {
			return {
				status: "inactive",
				label: "Not live",
				summary: "Not deployed into the live Toolshed catalog yet.",
				deployedAt: null,
				fingerprint: null,
			};
		}
		const currentFingerprint = buildTrackedMcpDeploymentFingerprint(card, ctx, mcp);
		if ((card.verificationStatus || "idle") !== "passed") {
			return {
				status: "stale",
				label: "Stale",
				summary: "The last verified build is not currently passing.",
				deployedAt,
				fingerprint: currentFingerprint,
			};
		}
		if ((card.pendingBuildAt || null) && String(card.pendingBuildAt) >= deployedAt) {
			return {
				status: "stale",
				label: "Stale",
				summary: "A newer build request is queued after the last live deploy.",
				deployedAt,
				fingerprint: currentFingerprint,
			};
		}
		if ((card.liveDeploymentFingerprint || "") !== currentFingerprint) {
			return {
				status: "stale",
				label: "Stale",
				summary: "Tracked files or registration changed after the last live deploy.",
				deployedAt,
				fingerprint: currentFingerprint,
			};
		}
		return {
			status: "live",
			label: "Live",
			summary: card.liveDeploymentSummary || "Deployed into the live Toolshed catalog.",
			deployedAt,
			fingerprint: currentFingerprint,
		};
	}

	function runEsbuildSyntaxCheck(entryPath: string, platform: "node" | "browser"): string | null {
		if (!entryPath || !existsSync(entryPath)) return "File is missing.";
		try {
			execFileSync("npx", [
				"-y",
				"-p",
				"esbuild",
				"esbuild",
				entryPath,
				"--bundle",
				`--platform=${platform}`,
				"--format=esm",
				"--packages=external",
				"--log-level=error",
				"--outfile=/dev/null",
			], {
				cwd: widgetCtx?.cwd || process.cwd(),
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 15000,
				encoding: "utf-8",
			});
			return null;
		} catch (error: any) {
			const stderr = typeof error?.stderr === "string"
				? error.stderr
				: Buffer.isBuffer(error?.stderr)
					? error.stderr.toString("utf-8")
					: "";
			const stdout = typeof error?.stdout === "string"
				? error.stdout
				: Buffer.isBuffer(error?.stdout)
					? error.stdout.toString("utf-8")
					: "";
			return excerptText((stderr || stdout || error?.message || "Unknown esbuild error.").trim(), 220);
		}
	}

	function verifyTrackedMcpApp(card: ToolshedGeneratedCard, ctx: ExtensionContext, lane: ToolshedLaneItem[], mcp: ToolshedMcpState): McpAppVerificationResult {
		const finalizeVerification = (verification: McpAppVerificationResult): McpAppVerificationResult => {
			const unchanged = (card.verificationStatus || "idle") === verification.status
				&& (card.verificationSummary || null) === verification.summary
				&& JSON.stringify(card.verificationDetails || []) === JSON.stringify(verification.details || [])
				&& (card.pendingBuildAt || null) === verification.pendingBuildAt;
			if (!unchanged) return verification;
			return {
				...verification,
				verifiedAt: card.verificationUpdatedAt || verification.verifiedAt || null,
			};
		};
		const latestResult = getLatestResultForCard(card, lane, card.pendingBuildAt || card.lastRunAt || null);
		const fileState = getTrackedCardFileState(card, ctx);
		const registered = isTrackedMcpCardRegistered(card, mcp);
		const details: string[] = [];
		const failures: string[] = [];
		if (fileState.serverExists) details.push(`Server file present: ${card.serverFile}`);
		else failures.push(`Missing server file: ${card.serverFile || "not configured"}`);
		if (fileState.viewExists) details.push(`View file present: ${card.viewFile}`);
		else failures.push(`Missing view file: ${card.viewFile || "not configured"}`);
		let serverCheckError: string | null = null;
		let viewCheckError: string | null = null;
		if (fileState.serverExists) {
			serverCheckError = runEsbuildSyntaxCheck(fileState.serverPath, "node");
			if (serverCheckError) failures.push(`Server syntax check failed: ${serverCheckError}`);
			else details.push(`Server syntax check passed: ${card.serverFile}`);
		}
		if (fileState.viewExists) {
			viewCheckError = runEsbuildSyntaxCheck(fileState.viewPath, "browser");
			if (viewCheckError) failures.push(`View syntax check failed: ${viewCheckError}`);
			else details.push(`View syntax check passed: ${card.viewFile}`);
		}
		if (registered) details.push(`Registered in project MCP config as ${card.serverId || "tracked server"}`);
		else failures.push(`Missing project MCP registration for ${card.serverId || "tracked server"}`);

		const anyArtifactsPresent = fileState.serverExists || fileState.viewExists || registered;
		if (card.pendingBuildAt && !latestResult) {
			if (failures.length === 0 && anyArtifactsPresent) {
				return finalizeVerification({
					status: "passed",
					summary: "Verified tracked files, syntax checks, and MCP registration.",
					details,
					verifiedAt: nowIso(),
					sourceResultAt: card.verificationSourceResultAt || null,
					pendingBuildAt: null,
				});
			}
			if (card.verificationStatus === "passed") {
				return finalizeVerification({
					status: "passed",
					summary: card.verificationSummary || "Verified build ready.",
					details: card.verificationDetails || details,
					verifiedAt: card.verificationUpdatedAt || null,
					sourceResultAt: card.verificationSourceResultAt || null,
					pendingBuildAt: card.pendingBuildAt,
				});
			}
			return finalizeVerification({
				status: anyArtifactsPresent ? "pending" : "pending",
				summary: "Awaiting the latest lane result before verifying the build.",
				details,
				verifiedAt: card.verificationUpdatedAt || null,
				sourceResultAt: card.verificationSourceResultAt || null,
				pendingBuildAt: card.pendingBuildAt,
			});
		}

		if (!anyArtifactsPresent && !card.pendingBuildAt) {
			return finalizeVerification({
				status: "idle",
				summary: "No verified build artifacts yet.",
				details: [],
				verifiedAt: null,
				sourceResultAt: null,
				pendingBuildAt: null,
			});
		}

		if (failures.length === 0) {
			return finalizeVerification({
				status: "passed",
				summary: "Verified tracked files, syntax checks, and MCP registration.",
				details,
				verifiedAt: nowIso(),
				sourceResultAt: latestResult?.timestamp || null,
				pendingBuildAt: null,
			});
		}

		return finalizeVerification({
			status: "failed",
			summary: failures[0],
			details: [...details, ...failures],
			verifiedAt: nowIso(),
			sourceResultAt: latestResult?.timestamp || null,
			pendingBuildAt: null,
		});
	}

	function applyTrackedMcpAppVerification(cardId: string, verification: McpAppVerificationResult): ToolshedGeneratedCard | null {
		return updateStoredCard(cardId, (next) => {
			next.verificationStatus = verification.status;
			next.verificationSummary = verification.summary;
			next.verificationDetails = verification.details;
			next.verificationUpdatedAt = verification.verifiedAt;
			next.verificationSourceResultAt = verification.sourceResultAt;
			next.pendingBuildAt = verification.pendingBuildAt;
		});
	}

	function refreshTrackedMcpAppVerification(cardId: string, ctx: ExtensionContext, options?: {
		registerInMcp?: boolean;
		notify?: boolean;
		laneEventTitle?: string;
	}): ToolshedGeneratedCard | null {
		const found = findStoredCard(cardId);
		if (!found || found.card.kind !== "mcp-app") return null;
		if (options?.registerInMcp) {
			const registration = upsertTrackedMcpAppRegistration(found.card, ctx.cwd);
			if (options.notify) {
				const tone = /missing|unable/i.test(registration.summary) ? "warning" : "info";
				ctx.ui.notify(registration.summary, tone);
			}
		}
		const lane = buildLane(ctx);
		const mcp = readProjectMcpState(ctx.cwd);
		const verification = verifyTrackedMcpApp(found.card, ctx, lane, mcp);
		const next = applyTrackedMcpAppVerification(cardId, verification);
		if (!next) return null;
		if (options?.laneEventTitle) {
			addLaneEvent({
				kind: "system",
				title: `${options.laneEventTitle} · ${next.title}`,
				content: verification.details.length > 0 ? verification.details.join("\n") : verification.summary,
				summary: verification.summary,
				tone: verification.status === "passed" ? "success" : verification.status === "failed" ? "warning" : "info",
				cardId,
			});
		}
		updateWidget();
		return next;
	}

	function rebuildTrackedMcpApp(cardId: string, ctx: ExtensionContext) {
		const found = findStoredCard(cardId);
		if (!found || found.card.kind !== "mcp-app") return;
		runGeneratedCard(cardId, "Rebuild the tracked app from the current files, refresh the runtime wiring, and keep the MCP registration current.");
		ctx.ui.notify(`Requested a rebuild for ${found.card.title}.`, "info");
	}

	function redeployTrackedMcpAppLive(cardId: string, ctx: ExtensionContext) {
		const found = findStoredCard(cardId);
		if (!found || found.card.kind !== "mcp-app") return;
		const refreshed = refreshTrackedMcpAppVerification(cardId, ctx, { registerInMcp: true });
		if (!refreshed) return;
		const mcp = readProjectMcpState(ctx.cwd);
		const liveState = getTrackedMcpLiveState(refreshed, ctx, mcp);
		if ((refreshed.verificationStatus || "idle") !== "passed") {
			addLaneEvent({
				kind: "system",
				title: `Live deploy blocked · ${refreshed.title}`,
				content: refreshed.verificationDetails && refreshed.verificationDetails.length > 0
					? refreshed.verificationDetails.join("\n")
					: (refreshed.verificationSummary || "Verification failed."),
				summary: refreshed.verificationSummary || "Verification failed.",
				tone: "warning",
				cardId,
			});
			ctx.ui.notify(`Live deploy blocked for ${refreshed.title}. Fix verification first.`, "warning");
			updateWidget();
			return;
		}
		const deployedAt = nowIso();
		const currentFingerprint = liveState.fingerprint || buildTrackedMcpDeploymentFingerprint(refreshed, ctx, mcp);
		const deployed = updateStoredCard(cardId, (next) => {
			next.liveDeployedAt = deployedAt;
			next.liveDeploymentFingerprint = currentFingerprint;
			next.liveDeploymentSummary = "Deployed live from the Toolshed registry.";
		});
		if (!deployed) return;
		addLaneEvent({
			kind: "system",
			title: `App deployed live · ${deployed.title}`,
			content: [
				"Toolshed marked this app as live for the current workspace catalog.",
				`Server: ${deployed.serverId || "not configured"}`,
				`Tool: ${deployed.toolName || "not configured"}`,
				`Published: ${isTrackedMcpCardRegistered(deployed, mcp) ? "registered in project MCP config" : "missing project MCP registration"}`,
			].join("\n"),
			summary: `${deployed.title} is now live in the Toolshed registry.`,
			tone: "success",
			cardId,
		});
		ctx.ui.notify(`Deployed ${deployed.title} into the live Toolshed catalog.`, "info");
		updateWidget();
	}

	function scheduleTrackedMcpAppVerification(ctx: ExtensionContext, delay: number = 1200) {
		if (mcpAppVerifyTimer) clearTimeout(mcpAppVerifyTimer);
		mcpAppVerifyTimer = setTimeout(() => {
			mcpAppVerifyTimer = null;
			if (mcpAppVerifyRunning) return;
			mcpAppVerifyRunning = true;
			try {
				const lane = buildLane(ctx);
				const mcp = readProjectMcpState(ctx.cwd);
				let changed = false;
				for (const card of listTrackedMcpAppCards()) {
					const verification = verifyTrackedMcpApp(card, ctx, lane, mcp);
					const previousStatus = card.verificationStatus || "idle";
					const previousPending = card.pendingBuildAt || null;
					const previousUpdatedAt = card.verificationUpdatedAt || null;
					if (
						previousStatus === verification.status
						&& (card.verificationSummary || null) === verification.summary
						&& JSON.stringify(card.verificationDetails || []) === JSON.stringify(verification.details)
						&& previousPending === verification.pendingBuildAt
						&& previousUpdatedAt === verification.verifiedAt
					) {
						continue;
					}
					applyTrackedMcpAppVerification(card.id, verification);
					if (previousPending && !verification.pendingBuildAt && (verification.status === "passed" || verification.status === "failed")) {
						addLaneEvent({
							kind: "system",
							title: `${verification.status === "passed" ? "App build verified" : "App build verification failed"} · ${card.title}`,
							content: verification.details.length > 0 ? verification.details.join("\n") : verification.summary,
							summary: verification.summary,
							tone: verification.status === "passed" ? "success" : "warning",
							cardId: card.id,
						});
					}
					changed = true;
				}
				if (changed) updateWidget();
			} finally {
				mcpAppVerifyRunning = false;
			}
		}, delay);
	}

	function updateStoredCard(cardId: string, mutator: (card: ToolshedGeneratedCard) => void): ToolshedGeneratedCard | null {
		const found = findStoredCard(cardId);
		if (!found || !widgetCtx) return null;
		mutator(found.card);
		found.card.updatedAt = nowIso();
		if (found.scope === "project") saveProjectCards(widgetCtx.cwd);
		else saveSessionState();
		return found.card;
	}

	function createGeneratedCard(input: {
		title: string;
		description: string;
		promptTemplate?: string;
		kind?: GeneratedCardKind;
		persist: Extract<CardPersistKind, "session" | "project">;
		inputPlaceholder?: string;
		preferredId?: string;
		generatedFrom?: string;
		starterId?: string;
		appBrief?: string;
		artifactDir?: string;
		serverFile?: string;
		viewFile?: string;
		resourceUri?: string;
		serverId?: string;
		toolName?: string;
	}, silent?: boolean): ToolshedGeneratedCard | null {
		const ctx = widgetCtx;
		const title = String(input.title || "").trim();
		if (!ctx) return null;
		if (!title) {
			ctx.ui.notify("Card title is required.", "warning");
			return null;
		}
		const preferredId = String(input.preferredId || "").trim();
		if (preferredId) {
			const existingPreferred = listAllCards().find((card) => card.id === preferredId);
			if (existingPreferred) {
				if (!silent) ctx.ui.notify(`${existingPreferred.title} is already available.`, "info");
				return existingPreferred;
			}
		}
		const description = String(input.description || "").trim();
		const promptTemplate = String(input.promptTemplate || "").trim() || defaultPromptTemplate(title, description);
			const card: ToolshedGeneratedCard = {
				id: preferredId && !new Set([...WIDGET_DEFINITIONS.map((card) => card.id), ...listAllCards().map((card) => card.id)]).has(preferredId)
					? preferredId
				: nextCardId(title),
			title,
			description,
			promptTemplate,
			kind: input.kind === "mcp-app" ? "mcp-app" : "workflow",
			persist: input.persist,
			createdAt: nowIso(),
			updatedAt: nowIso(),
			inputPlaceholder: String(input.inputPlaceholder || "").trim() || "What should this card do right now?",
			generatedFrom: String(input.generatedFrom || "").trim() || undefined,
			lastRunAt: null,
			lastRunInput: null,
			starterId: String(input.starterId || "").trim() || undefined,
			appBrief: String(input.appBrief || "").trim() || undefined,
			artifactDir: String(input.artifactDir || "").trim() || undefined,
			serverFile: String(input.serverFile || "").trim() || undefined,
				viewFile: String(input.viewFile || "").trim() || undefined,
				resourceUri: String(input.resourceUri || "").trim() || undefined,
				serverId: String(input.serverId || "").trim() || undefined,
				toolName: String(input.toolName || "").trim() || undefined,
				verificationStatus: "idle",
				verificationSummary: null,
				verificationDetails: [],
				verificationUpdatedAt: null,
				verificationSourceResultAt: null,
				pendingBuildAt: null,
				liveDeployedAt: null,
				liveDeploymentFingerprint: null,
				liveDeploymentSummary: null,
			};
		if (card.persist === "project") {
			projectCards = [card, ...projectCards];
			saveProjectCards(ctx.cwd);
		} else {
			persistedState.sessionCards = [card, ...persistedState.sessionCards];
			saveSessionState();
		}
		if (!silent) {
			const createdContent = card.kind === "mcp-app"
				? [
					`Brief: ${card.appBrief || card.description || "No brief yet."}`,
					`Starter: ${humanize(card.starterId || "basic-server-react")}`,
					"Use this card to build the app once, then keep adding features from the same place.",
				].filter(Boolean).join("\n\n")
				: [`Description: ${card.description || "No description."}`, `Persistence: ${humanize(card.persist)}`, `Prompt template:\n\n${card.promptTemplate}`].join("\n\n");
			addLaneEvent({
				kind: "system",
				title: `${card.kind === "mcp-app" ? "MCP app card" : "Card"} created · ${card.title}`,
				content: createdContent,
				summary: `${card.kind === "mcp-app" ? "MCP app card" : "Card"} created: ${card.title}`,
				tone: "success",
				cardId: card.id,
			});
			ctx.ui.notify(`Created ${card.persist} card: ${card.title}`, "info");
		}
		updateWidget();
		return card;
	}

	function seedMermaidCard(silent?: boolean): ToolshedGeneratedCard | null {
		const existing = listAllCards().find((card) => card.id === "mermaid-diagrammer" || slugify(card.title) === "mermaid-diagrammer");
		if (existing) {
			if (!silent && widgetCtx) widgetCtx.ui.notify(`Mermaid Diagrammer already exists as a ${existing.persist} card.`, "info");
			return existing;
		}
		const card = createGeneratedCard({
			title: "Mermaid Diagrammer",
			description: "Generate Mermaid diagrams for the current codebase or frontier.",
			promptTemplate: [
				"Create a Mermaid diagram for this request: {{input}}",
				"Current frontier: {{frontier}}",
				"Latest user ask: {{latestUser}}",
				"Project: {{projectName}} ({{projectDir}})",
				"Return a short explanation followed by a fenced mermaid code block and note any assumptions.",
			].join("\n\n"),
			persist: "session",
			inputPlaceholder: "What should the diagram cover?",
			preferredId: "mermaid-diagrammer",
			generatedFrom: "toolshed-seed",
		}, silent);
		return card;
	}

	function seedBuilderExampleCard(exampleId: string, silent?: boolean): ToolshedGeneratedCard | null {
		const ctx = widgetCtx;
		if (!ctx) return null;
		const example = getBuilderExample(exampleId, ctx);
		if (!example) return null;
		const existing = listAllCards().find((card) => card.generatedFrom === example.preset.generatedFrom || card.id === example.preset.preferredId);
		if (existing) {
			if (!silent) ctx.ui.notify(`${example.title} already exists as a ${existing.persist} card.`, "info");
			return existing;
		}
		return createGeneratedCard({
			title: example.preset.title,
			description: example.preset.description,
			promptTemplate: example.preset.promptTemplate,
			persist: "session",
			inputPlaceholder: example.preset.inputPlaceholder,
			preferredId: example.preset.preferredId,
			generatedFrom: example.preset.generatedFrom,
		}, silent);
	}

	function addBuilderExampleToLane(exampleId: string) {
		const ctx = widgetCtx;
		if (!ctx) return;
		const example = getBuilderExample(exampleId, ctx);
		if (!example) return;
		addLaneEvent({
			kind: "card",
			title: example.laneTitle,
			content: example.laneContent,
			summary: example.laneSummary,
			tone: "info",
			cardId: example.preset.preferredId || example.id,
		});
		ctx.ui.notify(`Added ${example.title} to the lane.`, "info");
		updateWidget();
	}

	function deleteGeneratedCard(cardId: string) {
		const ctx = widgetCtx;
		const found = findStoredCard(cardId);
		if (!ctx || !found) return;
		if (found.scope === "project") {
			projectCards = projectCards.filter((card) => card.id !== cardId);
			saveProjectCards(ctx.cwd);
		} else {
			persistedState.sessionCards = persistedState.sessionCards.filter((card) => card.id !== cardId);
			saveSessionState();
		}
		delete persistedState.widgetPrefs[cardId];
		addLaneEvent({
			kind: "system",
			title: `Card removed · ${found.card.title}`,
			content: `${found.card.title} was removed from the ${found.scope} card library.`,
			summary: `Removed ${found.card.title}`,
			tone: "warning",
			cardId,
		});
		ctx.ui.notify(`Removed ${found.card.title}`, "info");
		updateWidget();
	}

	function openBlueprintWeb() {
		const ctx = widgetCtx;
		if (!ctx) return;
		const snapshot = readBlueprintSnapshot(ctx.cwd);
		const url = snapshot?.webUrl || "http://127.0.0.1:3151";
		try { execSync(`open '${url}'`, { stdio: "ignore" }); } catch {}
		addLaneEvent({
			kind: "system",
			title: "Blueprint opened",
			content: `Opened Pi Blueprint at ${url}.`,
			summary: `Blueprint web: ${url}`,
			tone: "info",
			cardId: "blueprint-bridge",
		});
		ctx.ui.notify(`Pi Blueprint: ${url}`, "info");
		updateWidget();
	}

	function runGeneratedCard(cardId: string, inputText?: string) {
		const ctx = widgetCtx;
		const found = findStoredCard(cardId);
		if (!ctx || !found) return;
		const lane = buildLane(ctx);
		const prompt = renderGeneratedCardPrompt(found.card, ctx, lane, inputText);
		const requestText = String(inputText || "").trim();
		const hadRun = Boolean(found.card.lastRunAt);
		const requestedAt = nowIso();
		updateStoredCard(cardId, (card) => {
			card.lastRunAt = requestedAt;
			card.lastRunInput = requestText || null;
			if (card.kind === "mcp-app") {
				card.pendingBuildAt = requestedAt;
				if (card.verificationStatus !== "passed") {
					card.verificationStatus = "pending";
					card.verificationSummary = "Awaiting the latest lane result before verifying the build.";
					card.verificationDetails = [];
					card.verificationUpdatedAt = card.verificationUpdatedAt || null;
					card.verificationSourceResultAt = card.verificationSourceResultAt || null;
				}
			}
		});
		addLaneEvent({
			kind: "card",
			title: `${found.card.kind === "mcp-app" ? (hadRun ? "MCP app update" : "MCP app build") : "Card run"} · ${found.card.title}`,
			content: found.card.kind === "mcp-app"
				? [
					`Request: ${requestText || (hadRun ? "Continue extending the tracked app." : "Build the tracked app from its saved brief.")}`,
					`Starter: ${humanize(found.card.starterId || "basic-server-react")}`,
				].join("\n\n")
				: [
					`Input: ${requestText || "No explicit input."}`,
					"Prompt:",
					prompt,
				].join("\n\n"),
			summary: requestText ? excerptText(requestText, 120) : (found.card.kind === "mcp-app" ? `${hadRun ? "Update" : "Build"} ${found.card.title}` : excerptText(prompt, 160)),
			tone: "info",
			cardId,
		});
		pi.sendUserMessage(prompt);
		ctx.ui.notify(`Ran card: ${found.card.title}`, "info");
		updateWidget();
		if (found.card.kind === "mcp-app") scheduleTrackedMcpAppVerification(ctx, 1500);
	}

	function getLatestPacket(packetId?: string): ToolshedPacket | null {
		if (packetId) {
			const exact = persistedState.packets.find((packet) => packet.id === packetId);
			if (exact) return exact;
		}
		return persistedState.packets.find((packet) => packet.status === "staged") || persistedState.packets[0] || null;
	}

	function freezeFrontier(summaryOverride?: string) {
		const ctx = widgetCtx;
		if (!ctx) return;
		const lane = buildLane(ctx);
		const frontier = getActiveFrontierItem(lane);
		if (!frontier) {
			ctx.ui.notify("No frontier is available to freeze yet.", "warning");
			return;
		}
		const summary = excerptText(summaryOverride || frontier.summary || frontier.content || frontier.title, 180);
		const packet: ToolshedPacket = {
			id: generateId("packet"),
			title: frontier.title || `${humanize(frontier.kind)} packet`,
			summary,
			body: frontier.content || frontier.summary || frontier.title,
			source: frontier.kind === "tool" ? "tool" : frontier.kind === "packet" ? "rfc" : "manual",
			status: "staged",
			createdAt: nowIso(),
			injectedAt: null,
		};
		persistedState.packets.unshift(packet);
		persistedState.packets = persistedState.packets.slice(0, MAX_PACKETS);
		addLaneEvent({
			kind: "packet",
			title: `Packet frozen · ${packet.title}`,
			content: `Frozen summary:\n\n${packet.summary}`,
			summary: packet.summary,
			tone: "warning",
			packetId: packet.id,
		});
		ctx.ui.notify(`Frozen packet: ${packet.title}`, "info");
		updateWidget();
	}

	function injectPacket(packetId?: string) {
		const ctx = widgetCtx;
		if (!ctx) return;
		const packet = getLatestPacket(packetId);
		if (!packet) {
			ctx.ui.notify("No packet is available to inject.", "warning");
			return;
		}
		packet.status = "injected";
		packet.injectedAt = nowIso();
		const body = [
			`Pi Toolshed packet injection — ${packet.title}`,
			"",
			packet.body,
		].join("\n");
		pi.sendUserMessage(body);
		addLaneEvent({
			kind: "packet",
			title: `Packet injected · ${packet.title}`,
			content: packet.body,
			summary: packet.summary,
			tone: "success",
			packetId: packet.id,
		});
		ctx.ui.notify(`Injected packet: ${packet.title}`, "info");
		updateWidget();
	}

	function updateWidgetPreference(widgetId: string, patch: Partial<ToolshedWidgetPreference>) {
		const current = persistedState.widgetPrefs[widgetId] || {};
		persistedState.widgetPrefs[widgetId] = { ...current, ...patch };
		saveSessionState();
		updateWidget();
	}

	function switchWorkspace(workspaceId: string) {
		if (!WORKSPACE_PRESETS_STATIC.some((workspace) => workspace.id === workspaceId)) return;
		persistedState.workspaceId = workspaceId;
		addLaneEvent({
			kind: "system",
			title: `Workspace switched · ${humanize(workspaceId)}`,
			content: `Toolshed workspace switched to ${humanize(workspaceId)}.`,
			summary: `Workspace: ${humanize(workspaceId)}`,
			tone: "info",
		});
		updateWidget();
	}

	function resetLayout() {
		persistedState.widgetPrefs = {};
		addLaneEvent({
			kind: "system",
			title: "Layout reset",
			content: "Card collapse preferences returned to the Toolshed defaults.",
			summary: "Layout reset to defaults.",
			tone: "info",
		});
		updateWidget();
	}

	function findToolshedSkill(ctx: ExtensionContext, skillId: string): ToolshedSkillState | null {
		const normalized = slugify(skillId);
		return scanSkillCatalog(ctx.cwd, extensionRepoRoot).find((skill) =>
			skill.id === normalized || slugify(skill.label) === normalized || slugify(basename(dirname(skill.sourcePath))) === normalized
		) || null;
	}

	function buildSkillInvocationMessage(skill: ToolshedSkillState, prompt?: string): string | null {
		try {
			const markdown = readFileSync(skill.sourcePath, "utf-8");
			const promptText = String(prompt || "").trim();
			return [
				`<skill name="${skill.id}" location="${skill.sourcePath}">`,
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

	function launchSkillIntoLane(ctx: ExtensionContext, skillId: string, prompt?: string): boolean {
		const skill = findToolshedSkill(ctx, skillId);
		if (!skill) return false;
		const message = buildSkillInvocationMessage(skill, prompt);
		if (!message) return false;
		pi.sendUserMessage(message);
		ctx.ui.notify(`Toolshed launched ${skill.label}.`, "info");
		updateWidget();
		return true;
	}

	function openToolshedWeb(ctx: ExtensionContext) {
		ensureToolshedWebServer(ctx);
		if (!toolshedWebUrl) toolshedWebUrl = `http://127.0.0.1:${TOOLSHED_WEB_PORT}`;
		try { execSync(`open '${toolshedWebUrl}'`, { stdio: "ignore" }); } catch {}
		ctx.ui.notify(`Pi Toolshed web UI: ${toolshedWebUrl}`, "info");
		updateWidget();
	}

	function showToolshedStatus(ctx: ExtensionContext) {
		const state = buildToolshedState(ctx);
		const lines = [
			`Workspace: ${humanize(state.workspaceId)}`,
			`Frontier: ${state.frontier.summary}`,
			`Cards: ${listAllCards().length} reusable`,
			`Registry: ${state.registry.summary}`,
			`Packets: ${state.packets.filter((packet) => packet.status === "staged").length} staged / ${state.packets.length} total`,
			`MCP: ${state.mcp.summary}`,
			`Skills: ${state.skills.length}`,
			`Bridge: ${state.status.connection}`,
			`Web: ${state.dashboardMeta.webUrl || "not started"}`,
		];
		ctx.ui.notify(lines.join("\n"), "info");
	}

	function showToolshedPackets(ctx: ExtensionContext) {
		if (persistedState.packets.length === 0) {
			ctx.ui.notify("No Toolshed packets are staged yet.", "info");
			return;
		}
		const lines = persistedState.packets.slice(0, 12).map((packet, index) =>
			`${index + 1}. [${packet.status}] ${packet.title}\n   ${packet.summary}`
		);
		ctx.ui.notify(`Toolshed packets:\n\n${lines.join("\n\n")}`, "info");
	}

	async function handleToolshedWorkspaceCommand(args: string, ctx: ExtensionContext) {
		const raw = String(args || "").trim();
		if (raw) {
			const normalized = slugify(raw);
			const match = WORKSPACE_PRESETS_STATIC.find((workspace) => workspace.id === normalized || slugify(workspace.title) === normalized);
			if (!match) {
				ctx.ui.notify(`Unknown workspace: ${raw}`, "warning");
				return;
			}
			switchWorkspace(match.id);
			ctx.ui.notify(`Toolshed workspace: ${match.title}`, "info");
			return;
		}
		const items = WORKSPACE_PRESETS_STATIC.map((workspace) => `${workspace.title} — ${workspace.description}`);
		const selected = await ctx.ui.select("Pi Toolshed workspace", items);
		if (!selected) return;
		const title = selected.split(" — ")[0];
		const match = WORKSPACE_PRESETS_STATIC.find((workspace) => workspace.title === title);
		if (!match) return;
		switchWorkspace(match.id);
		ctx.ui.notify(`Toolshed workspace: ${match.title}`, "info");
	}

	function showBlueprintStatus(ctx: ExtensionContext) {
		const snapshot = readBlueprintSnapshot(ctx.cwd);
		if (!snapshot) {
			ctx.ui.notify("Blueprint is not active in this workspace.", "warning");
			return;
		}
		const lines = [
			`Phase: ${snapshot.phaseLabel}`,
			`Review: ${snapshot.scoreLabel}`,
			`Gate: ${snapshot.gateLabel}`,
			`Assets: ${snapshot.assetStatus}`,
			`Web: ${snapshot.webUrl}`,
			`PRD: ${snapshot.prdPath || "not generated"}`,
		];
		ctx.ui.notify(lines.join("\n"), "info");
	}

	function openBlueprintPrd(ctx: ExtensionContext) {
		const snapshot = readBlueprintSnapshot(ctx.cwd);
		const prdPath = snapshot?.prdPath ? String(snapshot.prdPath).trim() : "";
		if (!prdPath || !existsSync(prdPath)) {
			ctx.ui.notify("Blueprint PRD is not available yet.", "warning");
			return;
		}
		try { execSync(`open '${prdPath}'`, { stdio: "ignore" }); } catch {}
		ctx.ui.notify(`Blueprint PRD: ${prdPath}`, "info");
	}

	function startToolshedAppLaneInterview(ctx: ExtensionContext, seedBrief?: string) {
		const prompt = String(seedBrief || "").trim()
			? [
				'Use the skill "toolshed-app-builder".',
				"Help me define a new tracked Toolshed MCP app.",
				"Ask one question at a time, keep the first version small, and stay inline-first.",
				"Ask your questions directly in the conversation lane. Do not use terminal UI prompts, selects, or slash-command wizards for the interview.",
				"For app chrome and operator controls, use shared semantic button primitives with tokenized sizing and variants instead of custom fixed pixel button widths.",
				"Reuse the active Toolshed theme tokens for app backgrounds, borders, text, and controls instead of inventing a local palette unless the app explicitly needs its own visual identity.",
				"Treat next-app/app/globals.css as the canonical shadcn theme source and mirror its token values when building inline app chrome.",
				`Seed brief: ${String(seedBrief || "").trim()}`,
				"When the plan is sharp enough, summarize the app goal, starter pattern, likely files/data sources, and include the exact /toolshed-app <brief> command that should be used.",
				'Then ask "Is that okay?" and wait for my approval. After I approve, move straight into the build.',
			].join(" ")
			: 'Use the skill "toolshed-app-builder". Help me define a new tracked Toolshed MCP app. Ask one question at a time, keep the first version small, and stay inline-first. Ask your questions directly in the conversation lane. Do not use terminal UI prompts, selects, or slash-command wizards for the interview. For app chrome and operator controls, use shared semantic button primitives with tokenized sizing and variants instead of custom fixed pixel button widths. Reuse the active Toolshed theme tokens for app backgrounds, borders, text, and controls instead of inventing a local palette unless the app explicitly needs its own visual identity. Treat next-app/app/globals.css as the canonical shadcn theme source and mirror its token values when building inline app chrome. When the plan is sharp enough, summarize the app goal, starter pattern, likely files/data sources, and include the exact /toolshed-app <brief> command that should be used. Then ask "Is that okay?" and wait for my approval. After I approve, move straight into the build.';
		if (launchSkillIntoLane(ctx, "toolshed-app-builder", prompt)) return;
		pi.sendUserMessage(prompt);
		ctx.ui.notify("Started the Toolshed app interview in the lane.", "info");
		updateWidget();
	}

	async function dispatchLocalSlashCommand(commandLine: string, ctx: ExtensionContext, source: "terminal" | "web" = "terminal"): Promise<boolean> {
		const parsed = parseSlashCommandLine(commandLine);
		if (!parsed) return false;
		switch (parsed.name) {
			case "toolshed-web":
				openToolshedWeb(ctx);
				return true;
			case "toolshed-status":
				showToolshedStatus(ctx);
				return true;
			case "toolshed-app":
				if (source === "web" && !parsed.args) {
					startToolshedAppLaneInterview(ctx);
					updateWidget();
					return true;
				}
				if (source === "web" && parsed.args) {
					const created = createMcpAppCard({
						brief: parsed.args,
						persist: "project",
						runNow: true,
					});
					if (!created) startToolshedAppLaneInterview(ctx, parsed.args);
					updateWidget();
					return true;
				}
				await runToolshedAppWizard(ctx, parsed.args);
				updateWidget();
				return true;
			case "toolshed-workspace":
				await handleToolshedWorkspaceCommand(parsed.args, ctx);
				return true;
			case "toolshed-freeze":
				freezeFrontier(parsed.args || undefined);
				return true;
			case "toolshed-packets":
				showToolshedPackets(ctx);
				return true;
			case "toolshed-reset-layout":
				resetLayout();
				ctx.ui.notify("Toolshed card layout reset to defaults.", "info");
				return true;
			case "blueprint-web":
				openBlueprintWeb();
				return true;
			case "blueprint-status":
				showBlueprintStatus(ctx);
				return true;
			case "blueprint-prd":
				openBlueprintPrd(ctx);
				return true;
			default:
				return false;
		}
	}

	function buildFrontierPrompt(prefix: string, fallback: string, lane: ToolshedLaneItem[]): string {
		const frontier = getActiveFrontierItem(lane);
		const focus = frontier ? frontier.summary || frontier.title : fallback;
		return `${prefix}${focus ? `\n\nCurrent frontier: ${focus}` : ""}`;
	}

	async function handleToolshedForwardedCommand(msg: any) {
		const ctx = widgetCtx;
		if (!ctx) return;
		const type = String(msg?.type || "").trim();
		const lane = buildLane(ctx);
		const calculatorMatch = {
			itemId: String(msg.inlineAppItemId || msg.itemId || "").trim() || undefined,
			cardId: String(msg.cardId || "").trim() || undefined,
			sessionId: String(msg.sessionId || "").trim() || undefined,
		};
		if (["chat", "send-message", "steer", "follow_up"].includes(type)) {
			const text = String(msg.message || msg.text || "").trim();
			if (!text) return;
			const pendingApproval = isApprovalReply(text) ? getPendingToolshedAppApprovalFromLane(lane) : null;
			if (pendingApproval) {
				addLaneEvent({
					kind: "system",
					title: "App plan approved",
					content: `Confirmed build for:\n\n${pendingApproval.command}`,
					summary: `Approved app build · ${excerptText(pendingApproval.brief, 96)}`,
					tone: "info",
				});
				if (await dispatchLocalSlashCommand(pendingApproval.command, ctx, "web")) {
					ctx.ui.notify(`Building tracked app from approval: ${excerptText(pendingApproval.brief, 96)}`, "info");
					return;
				}
			}
			if (await dispatchLocalSlashCommand(text, ctx, "web")) return;
			const inlineGithubBoardAnswer = answerInlineGithubBoardQuestionFromMatch(text, calculatorMatch);
			if (inlineGithubBoardAnswer) {
				const session = getInlineGithubBoardSession(calculatorMatch);
				appendLocalLaneExchange(text, inlineGithubBoardAnswer, {
					cardId: session?.cardId || calculatorMatch.cardId,
					tone: "success",
				});
				return;
			}
			pi.sendUserMessage(
				maybeBuildInlineGithubBoardPrompt(text, calculatorMatch)
				|| maybeBuildInlineCalculatorPrompt(text, calculatorMatch)
				|| text
			);
			ctx.ui.notify("Toolshed web injected a new turn.", "info");
			return;
		}
		switch (type) {
			case "sync-inline-app-state": {
				const adapter = String(msg.adapter || msg.appRuntime?.adapter || "").trim();
				if (adapter === "calculator") {
					const session = syncInlineCalculatorSession({
						itemId: String(msg.itemId || "").trim(),
						cardId: String(msg.cardId || "").trim(),
						title: String(msg.title || msg.appRuntime?.title || "Inline calculator").trim(),
						sessionId: String(msg.appState?.sessionId || msg.sessionId || "").trim(),
						display: String(msg.appState?.display || "").trim(),
						expression: String(msg.appState?.expression || "").trim(),
						history: Array.isArray(msg.appState?.history) ? msg.appState.history : [],
						steps: Array.isArray(msg.appState?.steps) ? msg.appState.steps : [],
						updatedAt: String(msg.appState?.updatedAt || nowIso()),
						syncedAt: nowIso(),
					});
					if (session) updateWidget();
					return;
				}
				if (adapter === "github-project-kanban") {
					const session = syncInlineGithubBoardSession({
						itemId: String(msg.itemId || "").trim(),
						cardId: String(msg.cardId || "").trim(),
						title: String(msg.title || msg.appRuntime?.title || "GitHub Project Board").trim(),
						sessionId: String(msg.appState?.sessionId || msg.sessionId || "").trim(),
						repoNameWithOwner: String(msg.appState?.repo?.nameWithOwner || msg.appState?.repoNameWithOwner || "").trim(),
						projectTitle: String(msg.appState?.project?.title || msg.appState?.projectTitle || "").trim(),
						projectNumber: msg.appState?.project?.number ?? msg.appState?.projectNumber,
						projectScopeReady: Boolean(msg.appState?.projectScopeReady),
						columns: Array.isArray(msg.appState?.columns) ? msg.appState.columns : [],
						updatedAt: String(msg.appState?.updatedAt || nowIso()),
						syncedAt: nowIso(),
					});
					if (session) updateWidget();
					return;
				}
				return;
			}
			case "clear-inline-app-state":
				if (removeInlineCalculatorSession(String(msg.itemId || "").trim()) || removeInlineGithubBoardSession(String(msg.itemId || "").trim())) updateWidget();
				return;
			case "submit-slash-command": {
				const command = ensureSlashCommand(String(msg.command || msg.message || "").trim());
				if (!command) return;
				if (await dispatchLocalSlashCommand(command, ctx, "web")) return;
				pi.sendUserMessage(command);
				ctx.ui.notify(`Toolshed ran ${command}`, "info");
				return;
			}
			case "launch-skill": {
				const skills = scanSkillCatalog(ctx.cwd, extensionRepoRoot);
				const skill = String(msg.skill || skills[0]?.id || "").trim();
				const prompt = String(msg.prompt || buildFrontierPrompt(`Use the skill ${skill ? `"${skill}"` : "that best matches this task"} and return the next high-signal result.`, "Describe the best next move.", lane)).trim();
				if (skill && launchSkillIntoLane(ctx, skill, prompt)) return;
				pi.sendUserMessage(prompt);
				ctx.ui.notify(`Toolshed launched ${skill || "a skill prompt"}.`, "info");
				return;
			}
			case "inject-packet":
				injectPacket(String(msg.packetId || "").trim() || undefined);
				return;
			case "freeze-frontier":
				freezeFrontier(String(msg.summary || "").trim() || undefined);
				return;
			case "switch-workspace":
				switchWorkspace(String(msg.workspaceId || "").trim());
				return;
			case "run-card":
				runGeneratedCard(String(msg.cardId || "").trim(), String(msg.inputText || "").trim() || undefined);
				return;
			case "rebuild-mcp-app":
				rebuildTrackedMcpApp(String(msg.cardId || "").trim(), ctx);
				return;
			case "refresh-mcp-app":
				refreshTrackedMcpAppVerification(String(msg.cardId || "").trim(), ctx, {
					registerInMcp: Boolean(msg.registerInMcp),
					notify: true,
					laneEventTitle: "App status refreshed",
				});
				return;
			case "redeploy-mcp-app":
				redeployTrackedMcpAppLive(String(msg.cardId || "").trim(), ctx);
				return;
			case "create-custom-card": {
				const persist = String(msg.persist || "session").trim() === "project" ? "project" : "session";
				createGeneratedCard({
					title: String(msg.title || "").trim(),
					description: String(msg.description || "").trim(),
					promptTemplate: String(msg.promptTemplate || "").trim(),
					persist,
					inputPlaceholder: String(msg.inputPlaceholder || "").trim(),
					preferredId: String(msg.preferredId || "").trim() || undefined,
					generatedFrom: String(msg.generatedFrom || "builder").trim() || "builder",
				});
				return;
			}
			case "create-mcp-app-card": {
				const persist = String(msg.persist || "project").trim() === "session" ? "session" : "project";
				createMcpAppCard({
					title: String(msg.title || "").trim() || undefined,
					brief: String(msg.brief || msg.prompt || "").trim(),
					starterId: String(msg.starterId || "basic-server-react").trim() || "basic-server-react",
					persist,
					runNow: Boolean(msg.runNow),
				});
				return;
			}
			case "delete-custom-card":
				deleteGeneratedCard(String(msg.cardId || "").trim());
				return;
			case "seed-mermaid-card":
				seedMermaidCard();
				return;
			case "seed-builder-example-card":
				seedBuilderExampleCard(String(msg.exampleId || "").trim());
				return;
			case "add-builder-example-to-lane":
				addBuilderExampleToLane(String(msg.exampleId || "").trim());
				return;
			case "open-blueprint-web":
				openBlueprintWeb();
				return;
			case "collapse-widget":
				updateWidgetPreference(String(msg.widgetId || "").trim(), { collapsed: true });
				return;
			case "expand-widget":
				updateWidgetPreference(String(msg.widgetId || "").trim(), { collapsed: false });
				return;
			case "open-mcp-tool": {
				const serverId = String(msg.serverId || "").trim();
				const toolName = String(msg.toolName || "").trim();
				const prompt = serverId || toolName
					? buildFrontierPrompt(`Use the MCP server ${serverId ? `"${serverId}"` : ""}${toolName ? ` tool "${toolName}"` : ""} if appropriate and report the result.`, "Open MCP and inspect the configured servers.", lane)
					: "/mcp";
				pi.sendUserMessage(prompt);
				ctx.ui.notify(serverId || toolName ? "Toolshed requested an MCP-assisted step." : "Toolshed ran /mcp", "info");
				return;
			}
			case "abort-run": {
				const prompt = String(msg.message || "").trim() || "Please stop the current task as soon as possible and summarize current progress, blockers, and safe next steps.";
				pi.sendUserMessage(prompt);
				ctx.ui.notify("Toolshed sent a stop request into the lane.", "warning");
				return;
			}
			case "reset-layout":
				resetLayout();
				return;
		}
	}

	function registerToolshedOnControl() {
		if (!toolshedControlSocket || !toolshedControlConnected) return;
		try {
			toolshedControlSocket.write(JSON.stringify({
				type: "register",
				agentId: "toolshed-main",
				sessionKey: "toolshed-main",
				info: {
					name: "pi-toolshed",
					workspaceId: persistedState.workspaceId,
					url: toolshedWebUrl,
				},
			}) + "\n");
		} catch {}
	}

	function connectToolshedControlSocket() {
		if (toolshedControlSocket) return;
		try {
			toolshedControlSocket = createConnection(TOOLSHED_WEB_CONTROL_PORT, "127.0.0.1");
			toolshedControlSocket.setEncoding("utf-8");
			let buffer = "";
			toolshedControlSocket.on("data", (chunk: string) => {
				buffer += chunk;
				let nl = -1;
				while ((nl = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, nl).trim();
					buffer = buffer.slice(nl + 1);
					if (!line) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.forward) void handleToolshedForwardedCommand(msg);
					} catch (error) {
						console.error("[pi-toolshed] control command failed", error);
					}
				}
			});
			toolshedControlSocket.on("connect", () => {
				toolshedControlConnected = true;
				registerToolshedOnControl();
			});
			toolshedControlSocket.on("error", () => {
				toolshedControlSocket = null;
				toolshedControlConnected = false;
			});
			toolshedControlSocket.on("close", () => {
				toolshedControlSocket = null;
				toolshedControlConnected = false;
			});
		} catch {
			toolshedControlSocket = null;
			toolshedControlConnected = false;
		}
	}

	function ensureToolshedWebServer(ctx: ExtensionContext) {
		const scriptPath = getToolshedWebScriptPath(extensionRepoRoot);
		toolshedWebUrl = `http://127.0.0.1:${TOOLSHED_WEB_PORT}`;
		if (!existsSync(scriptPath)) {
			toolshedWebUrl = "";
			ctx.ui.notify(`Toolshed web UI script missing: ${scriptPath}`, "warning");
			scheduleToolshedStateWrite();
			return;
		}
		const scriptVersion = String(statSync(scriptPath).mtimeMs);
		const localProjectDir = resolve(ctx.cwd);
		let needsRestart = false;
		try {
			const raw = execSync(`curl -fsS '${toolshedWebUrl}/api/version'`, { encoding: "utf-8" }).trim();
			const parsed = JSON.parse(raw || "{}");
			const remoteVersion = parsed?.version ? String(parsed.version) : "";
			const remoteProjectDir = parsed?.projectDir ? resolve(String(parsed.projectDir)) : "";
			needsRestart = remoteVersion !== scriptVersion || remoteProjectDir !== localProjectDir;
		} catch {
			needsRestart = true;
		}
		if (needsRestart) {
			try { execSync(`pids=$(lsof -ti tcp:${TOOLSHED_WEB_PORT} -sTCP:LISTEN 2>/dev/null); if [ -n "$pids" ]; then kill $pids; fi`, { stdio: "ignore" }); } catch {}
			try { execSync(`pids=$(lsof -ti tcp:${TOOLSHED_WEB_CONTROL_PORT} -sTCP:LISTEN 2>/dev/null); if [ -n "$pids" ]; then kill $pids; fi`, { stdio: "ignore" }); } catch {}
			try {
				const webLogPath = join(logDir || join(ctx.cwd, ".pi", "pipeline-logs"), "toolshed-dashboard-web.log");
				mkdirSync(dirname(webLogPath), { recursive: true });
				const logFd = openSync(webLogPath, "a");
				const proc = spawn(process.execPath, [scriptPath, ctx.cwd, "--port", String(TOOLSHED_WEB_PORT), "--control-port", String(TOOLSHED_WEB_CONTROL_PORT)], {
					detached: true,
					stdio: ["ignore", logFd, logFd],
					env: process.env,
				});
				proc.unref();
			} catch (err: any) {
				ctx.ui.notify(`Failed to start Toolshed web UI: ${err.message}`, "warning");
			}
		}
		connectToolshedControlSocket();
		scheduleToolshedStateWrite();
	}

		function startTranscriptWatch(ctx: ExtensionContext) {
			lastTranscriptSignature = getTranscriptSignature(ctx);
			lastTranscriptChangeAt = Date.now();
			if (transcriptWatchTimer) clearInterval(transcriptWatchTimer);
			transcriptWatchTimer = setInterval(() => {
				const nextSignature = getTranscriptSignature(ctx);
				if (nextSignature !== lastTranscriptSignature) {
					lastTranscriptSignature = nextSignature;
					lastTranscriptChangeAt = Date.now();
					scheduleToolshedStateWrite();
					scheduleTrackedMcpAppVerification(ctx, 900);
				}
			}, 750);
		}

	function stopTranscriptWatch() {
		if (transcriptWatchTimer) {
			clearInterval(transcriptWatchTimer);
			transcriptWatchTimer = null;
		}
	}

	function buildWorkspacePresets(
		ctx: ExtensionContext,
		lane: ToolshedLaneItem[],
		packets: ToolshedPacket[],
		mcp: ToolshedMcpState,
		skills: ToolshedSkillState[],
		repository: ToolshedRepositoryState | null,
	): ToolshedWorkspacePreset[] {
		const stagedCount = packets.filter((packet) => packet.status === "staged").length;
		const customCount = listAllCards().length;
		const liveCount = listTrackedMcpAppCards().filter((card) => getTrackedMcpLiveState(card, ctx, mcp).status === "live").length;
		const repoChip = repository ? `git ${repository.branch}${repository.dirty ? ` · ${repository.changed} dirty` : " · clean"}` : "git unknown";
		return WORKSPACE_PRESETS_STATIC.map((workspace) => {
			const quickActions: ToolshedQuickAction[] = (() => {
				switch (workspace.id) {
					case "built-ins":
						return [
							{ ...actionOpenBlueprintWeb("Open Blueprint", "primary"), display: "pill" },
							{ ...actionFreeze("Freeze frontier"), display: "pill" },
							{ ...actionSend("Ask Blueprint to plan", buildFrontierPrompt("Use pi-blueprint for the current task and tell me the next planning step.", "Use pi-blueprint for the current task.", lane)), display: "pill" },
						];
					case "custom-cards":
						return [
							{ ...actionSeedMermaidCard("Seed Mermaid", "primary"), display: "pill" },
							{ ...actionFreeze("Freeze frontier"), display: "pill" },
							{ ...actionSend("Propose a card", buildFrontierPrompt("Propose a reusable Toolshed workflow card for this frontier with a title, goal, and prompt template.", "Propose a reusable Toolshed workflow card.", lane)), display: "pill" },
						];
					default:
						return [
							{ ...actionSeedMermaidCard("Seed Mermaid", "primary"), display: "pill" },
							{ ...actionOpenBlueprintWeb("Open Blueprint"), display: "pill" },
							{ ...actionFreeze("Freeze frontier"), display: "pill" },
						];
				}
			})();
			return {
				id: workspace.id,
				title: workspace.title,
				description: workspace.description,
				widgetIds: workspace.widgetIds,
				statusChips: [
					customCount === 1 ? "1 custom card" : `${customCount} custom cards`,
					liveCount === 1 ? "1 live app" : `${liveCount} live apps`,
					stagedCount === 1 ? "1 staged packet" : `${stagedCount} staged packets`,
					mcp.configured ? `MCP ${mcp.count}` : "MCP off",
					skills.length === 1 ? "1 skill" : `${skills.length} skills`,
					repoChip,
				],
				quickActions,
			};
		});
	}

	function buildWidgetCard(def: ToolshedWidgetDefinition, extras: Omit<ToolshedWidgetCardState, keyof ToolshedWidgetDefinition | "pinned" | "collapsed" | "size">): ToolshedWidgetCardState {
		const pref = persistedState.widgetPrefs[def.id] || {};
		const collapsed = def.id === "component-builder"
			? false
			: (typeof pref.collapsed === "boolean" ? pref.collapsed : Boolean(def.defaultCollapsed));
		return {
			...def,
			pinned: def.defaultPinned,
			collapsed,
			size: "regular",
			...extras,
		};
	}

	function cardVisibleInWorkspace(card: ToolshedWidgetCardState): boolean {
		if (card.id === "component-builder") return true;
		if (persistedState.workspaceId === "built-ins") return card.sourceKind === "system" || card.sourceKind === "extension";
		if (persistedState.workspaceId === "custom-cards") return card.sourceKind === "system" || card.sourceKind === "session" || card.sourceKind === "project";
		return true;
	}

	function isTrackedMcpCardRegistered(card: ToolshedGeneratedCard, mcp: ToolshedMcpState): boolean {
		const serverId = String(card.serverId || "").trim();
		if (!serverId) return false;
		return mcp.servers.some((server) => server.id === serverId || slugify(server.label) === slugify(serverId));
	}

	function buildGeneratedCardState(card: ToolshedGeneratedCard, lane: ToolshedLaneItem[], mcp: ToolshedMcpState, ctx: ExtensionContext): ToolshedWidgetCardState {
		const latestResult = getLatestResultForCard(card, lane, card.pendingBuildAt || card.lastRunAt || null);
		const starter = card.kind === "mcp-app" && card.starterId ? getBuilderExample(card.starterId, ctx) : null;
		const registered = card.kind === "mcp-app" ? isTrackedMcpCardRegistered(card, mcp) : false;
		const fileState = card.kind === "mcp-app" ? getTrackedCardFileState(card, ctx) : { serverExists: false, viewExists: false, serverPath: "", viewPath: "" };
		const trackedFilesPresent = Boolean(card.kind === "mcp-app" && fileState.serverExists && fileState.viewExists);
			const liveState = card.kind === "mcp-app" ? getTrackedMcpLiveState(card, ctx, mcp) : null;
			const runtimeFingerprint = card.kind === "mcp-app"
				? buildTrackedMcpDeploymentFingerprint(card, ctx, mcp)
				: "";
			const verificationStatus = card.verificationStatus || "idle";
		const verificationSummary = card.verificationSummary || (verificationStatus === "passed"
			? "Verified build ready."
			: verificationStatus === "failed"
				? "Verification failed."
				: verificationStatus === "pending"
					? "Awaiting build verification."
					: "No verified build artifacts yet.");
		const verificationDetails = Array.isArray(card.verificationDetails) ? card.verificationDetails : [];
		const builtReady = Boolean(card.kind === "mcp-app" && verificationStatus === "passed");
		const queuedRequest = Boolean(card.kind === "mcp-app" && card.pendingBuildAt && builtReady);
		const waiting = Boolean(card.kind === "mcp-app" && card.pendingBuildAt && !builtReady);
		const latestFailed = Boolean(card.kind === "mcp-app" && verificationStatus === "failed");
		const inlineReady = Boolean(card.kind === "mcp-app" && builtReady);
		const runtimeAdapter: "calculator" | "generic" = /calculator/i.test([card.title, card.appBrief, card.toolName, card.viewFile].filter(Boolean).join(" "))
			? "calculator"
			: "generic";
		return buildWidgetCard({
			id: card.id,
			title: card.title,
			workspaceIds: ["all-cards", "custom-cards"],
			placement: "float",
			purpose: card.kind === "mcp-app"
				? excerptText(card.appBrief || card.description || "Tracked MCP app", 140)
				: (card.description || "Reusable workflow card"),
			defaultPinned: true,
			defaultCollapsed: false,
			removable: true,
			sourceKind: card.persist,
			persistKind: card.persist,
			renderMode: "workflow",
		}, {
				badge: card.kind === "mcp-app"
					? "MCP app"
					: (card.persist === "project" ? "Project card" : "Session card"),
				tone: waiting ? "warning" : latestFailed ? "warning" : builtReady ? "success" : latestResult ? latestResult.tone : "info",
				summary: waiting
					? (card.kind === "mcp-app" ? "Pi is building this app." : "Waiting for the lane response to this card run.")
					: queuedRequest
						? "Latest app request is queued in the lane. The current build remains available."
					: latestFailed
						? verificationSummary
					: builtReady
						? "Verified build ready. Use this card to refactor the app or open it inline."
					: latestResult
						? (card.kind === "mcp-app" ? (latestFailed ? "Latest build needs attention before the next change." : "App updated. Use this card to keep adding features.") : `Last result: ${latestResult.summary}`)
						: (card.kind === "mcp-app"
							? "Create the app once, then keep extending it from this card."
							: card.description || "Reusable workflow card ready to run."),
					lines: card.kind === "mcp-app"
					? [
							`Starter: ${starter?.title || humanize(card.starterId || "basic-server-react")}`,
						`Status: ${waiting ? "Building in Pi" : queuedRequest ? "Queued in lane" : builtReady ? "Verified" : latestFailed ? "Verification failed" : verificationStatus === "pending" ? "Verifying build" : registered ? "Registered in MCP config" : trackedFilesPresent ? "Files created" : "Ready to build"}`,
						`Live: ${liveState ? `${liveState.label} · ${liveState.summary}` : "Not live yet"}`,
						`Last verification: ${card.verificationUpdatedAt ? relativeTimeStamp(card.verificationUpdatedAt) : trackedFilesPresent ? "Files present, not verified" : "Not verified yet"}`,
						`Verification: ${excerptText(verificationSummary, 120)}`,
							`Mode: ${inlineReady ? "Refactor from this card or execute inline." : "Build once, then open inline from this card."}`,
						]
						: [
							`Last input: ${card.lastRunInput || "No run yet."}`,
							`Lane result: ${latestResult ? latestResult.summary : waiting ? "Awaiting response from Pi…" : "No result yet."}`,
						],
				actions: [],
				inputPlaceholder: card.inputPlaceholder || (card.kind === "mcp-app" ? "What should this app add next?" : "What should this card do right now?"),
				promptTemplate: card.promptTemplate,
				statusLabel: waiting
					? (card.kind === "mcp-app" ? "Building" : "Running")
					: card.kind === "mcp-app"
						? (queuedRequest ? "Queued" : builtReady ? "Verified" : latestFailed ? "Needs attention" : verificationStatus === "pending" ? "Verifying" : trackedFilesPresent || registered ? "Built" : latestResult ? `Updated ${relativeTimeStamp(latestResult.timestamp)}` : "Draft")
						: (latestResult ? `Updated ${relativeTimeStamp(latestResult.timestamp)}` : "Ready"),
				metadata: [
					{ label: "Source", value: humanize(card.persist) },
					{ label: "Updated", value: relativeTimeStamp(card.updatedAt) },
					...(card.kind === "mcp-app" && liveState ? [{ label: "Live", value: liveState.label }] : []),
				],
				runLabel: card.kind === "mcp-app" ? (waiting ? "Building…" : builtReady ? "Refactor app" : latestFailed ? "Repair app" : "Build app") : "Run in lane",
				cardKind: card.kind || "workflow",
					appRuntime: card.kind === "mcp-app"
						? {
							kind: "generated-mcp-app",
							adapter: runtimeAdapter,
							cardId: card.id,
						title: card.title,
						brief: card.appBrief || card.description || "",
						ready: inlineReady,
							serverId: card.serverId,
							toolName: card.toolName,
							resourceUri: card.resourceUri,
							viewFile: card.viewFile,
							fingerprint: runtimeFingerprint,
							versionTag: [
								card.liveDeployedAt || "",
								runtimeFingerprint,
							].filter(Boolean).join("|") || runtimeFingerprint,
						}
						: undefined,
				});
	}

	function buildToolshedRegistryState(ctx: ExtensionContext, lane: ToolshedLaneItem[], mcp: ToolshedMcpState): ToolshedRegistryState {
		const entries = listTrackedMcpAppCards().map((card) => {
			const starter = card.starterId ? getBuilderExample(card.starterId, ctx) : null;
			const verificationStatus = card.verificationStatus || "idle";
			const liveState = getTrackedMcpLiveState(card, ctx, mcp);
			const published = isTrackedMcpCardRegistered(card, mcp);
			const trackedStatus: ToolshedRegistryEntry["trackedStatus"] = card.pendingBuildAt
				? "building"
				: verificationStatus === "passed"
					? "ready"
					: verificationStatus === "failed"
						? "failed"
						: "draft";
			const trackedLabel = trackedStatus === "building"
				? "Building"
				: trackedStatus === "ready"
					? "Verified"
					: trackedStatus === "failed"
						? "Needs attention"
						: "Draft";
			const trackedSummary = trackedStatus === "building"
				? "Waiting for Pi to finish the latest tracked build."
				: card.verificationSummary || (trackedStatus === "ready"
					? "Tracked files and registration are verified."
					: trackedStatus === "failed"
						? "Tracked build verification failed."
						: "Tracked files are not verified yet.");
			return {
				cardId: card.id,
				title: card.title,
				brief: card.appBrief || card.description || "",
				starterTitle: starter?.title || humanize(card.starterId || "basic-server-react"),
				artifactDir: card.artifactDir || null,
				serverFile: card.serverFile || null,
				viewFile: card.viewFile || null,
				serverId: card.serverId || null,
				toolName: card.toolName || null,
				resourceUri: card.resourceUri || null,
				trackedStatus,
				trackedLabel,
				trackedSummary,
				liveStatus: liveState.status,
				liveLabel: liveState.label,
				liveSummary: liveState.summary,
				publishedStatus: published ? "published" : "missing",
				publishedLabel: published ? "Published" : "Not published",
				publishedSummary: published
					? `Registered in project MCP config as ${card.serverId || "tracked server"}.`
					: `Missing project MCP registration for ${card.serverId || "tracked server"}.`,
				updatedAt: card.updatedAt,
				lastRunAt: card.lastRunAt || null,
				lastRunInput: card.lastRunInput || null,
				pendingBuildAt: card.pendingBuildAt || null,
				verificationStatus,
				verificationSummary: card.verificationSummary || null,
				verificationUpdatedAt: card.verificationUpdatedAt || null,
				liveDeployedAt: card.liveDeployedAt || null,
				liveDeploymentFingerprint: card.liveDeploymentFingerprint || null,
			} as ToolshedRegistryEntry;
		});
		const liveCount = entries.filter((entry) => entry.liveStatus === "live").length;
		const staleCount = entries.filter((entry) => entry.liveStatus === "stale").length;
		const publishedCount = entries.filter((entry) => entry.publishedStatus === "published").length;
		const summary = entries.length === 0
			? "No tracked MCP apps are in the registry yet."
			: `${entries.length} tracked app${entries.length === 1 ? "" : "s"} · ${liveCount} live · ${staleCount} stale · ${publishedCount} published`;
		return { summary, liveCount, staleCount, publishedCount, entries };
	}

	function formatRegistryEntriesForPrompt(entries: ToolshedRegistryEntry[], limit: number = 8): string {
		const visible = entries.slice(0, Math.max(1, limit));
		if (visible.length === 0) return "- none";
		return visible.map((entry) => {
			const details = [
				entry.liveLabel,
				entry.publishedLabel,
				entry.serverId ? `server ${entry.serverId}` : "",
				entry.toolName ? `tool ${entry.toolName}` : "",
			].filter(Boolean).join(" · ");
			return `- ${entry.title}: ${details}`;
		}).join("\n");
	}

	function buildWidgets(
		ctx: ExtensionContext,
		lane: ToolshedLaneItem[],
		packets: ToolshedPacket[],
		mcp: ToolshedMcpState,
		skills: ToolshedSkillState[],
		slashCommands: ToolshedSlashCommand[],
		documents: ToolshedDocumentState[],
		repository: ToolshedRepositoryState | null,
	): ToolshedWidgetCardState[] {
		const frontier = getActiveFrontierItem(lane);
		const blueprint = readBlueprintSnapshot(ctx.cwd);
		const docsReady = documents.filter((doc) => doc.exists).length;
		const cards: ToolshedWidgetCardState[] = [];

		cards.push(buildWidgetCard(WIDGET_DEFINITIONS[0], {
			badge: listAllCards().length === 1 ? "1 reusable card" : `${listAllCards().length} reusable cards`,
			tone: listAllCards().length > 0 ? "success" : "info",
			summary: "Use the lane-first app flow for tracked MCP apps, or create reusable workflow cards here.",
			lines: [
				`Library: ${persistedState.sessionCards.length} session · ${projectCards.length} project`,
				"App flow: /toolshed-app asks a few questions, then creates or updates tracked apps.",
			],
			footer: "Use the app wizard or app-builder skill for MCP apps. Open the custom-card fields only when you need a pure workflow template.",
			actions: [
				{ ...actionSeedMermaidCard("Seed Mermaid", "secondary"), display: "pill" },
				{ ...actionOpenBlueprintWeb("Open Blueprint", "ghost"), display: "pill" },
			],
			builderExamples: buildBuilderExamples(ctx),
			builderDefaults: {
				title: frontier ? `${humanize(slugify(frontier.summary).split("-").slice(0, 3).join("-"))} Card` : "New Workflow Card",
				description: frontier ? `Turn ${frontier.summary} into a reusable workflow tool.` : "Describe what this card should do.",
				promptTemplate: frontier
					? [
						`Workflow: ${frontier.title || "Reusable workflow card"}`,
						"Operator request: {{input}}",
						`Current frontier: {{frontier}}`,
						"Project: {{projectName}} ({{projectDir}})",
						"Return a concise result with the next recommended action.",
					].join("\n\n")
					: defaultPromptTemplate("New Workflow Card", "Describe what this card should do."),
				inputPlaceholder: "What should this card do right now?",
			},
			statusLabel: "System card",
			metadata: [
				{ label: "Scope", value: humanize(persistedState.workspaceId) },
				{ label: "Project", value: basename(ctx.cwd) || ctx.cwd },
			],
		}));

		cards.push(buildWidgetCard(WIDGET_DEFINITIONS[1], {
			badge: blueprint?.active ? "Live extension" : "Imported tool",
			tone: blueprint?.active ? "success" : blueprint ? "info" : "warning",
			summary: blueprint
				? blueprint.gateLabel
				: "Pi Blueprint is available as a built-in card when the planning extension is running.",
			lines: [
				`Phase: ${blueprint?.phaseLabel || "Blueprint not running"}`,
				`Review: ${blueprint?.scoreLabel || "No blueprint score available yet."}`,
				`Assets: ${blueprint?.assetStatus || "Load pi-blueprint to mirror its state here."}`,
			],
			footer: blueprint?.webUrl ? `Web: ${blueprint.webUrl}` : "Open /blueprint-web after loading the pi-blueprint extension.",
			actions: [
				{ ...actionOpenBlueprintWeb("Open Blueprint", "primary"), display: "pill" },
				{ ...actionSend("Use Blueprint in lane", buildFrontierPrompt("Use the pi-blueprint planning workflow for this task and tell me the next artifact or question to resolve.", "Use pi-blueprint for this task.", lane)), display: "pill" },
				{ ...actionFreeze("Freeze planning packet"), display: "pill" },
			],
			statusLabel: blueprint?.active ? "Connected" : "Standby",
			metadata: [
				{ label: "Source", value: "pi-blueprint" },
				{ label: "Docs", value: `${docsReady}/${documents.length} present` },
			],
		}));

		for (const card of listAllCards().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))) {
			cards.push(buildGeneratedCardState(card, lane, mcp, ctx));
		}

		return cards.filter(cardVisibleInWorkspace);
	}

	function buildStatus(ctx: ExtensionContext, lane: ToolshedLaneItem[], packets: ToolshedPacket[], mcp: ToolshedMcpState, skills: ToolshedSkillState[], repository: ToolshedRepositoryState | null): ToolshedStatusState {
		const frontier = getActiveFrontierItem(lane);
		const transcriptFreshMs = Date.now() - lastTranscriptChangeAt;
		const session: ToolshedStatusState["session"] = frontier
			? transcriptFreshMs < 2500
				? frontier.kind === "tool" || frontier.kind === "card"
					? "running"
					: "streaming"
				: "ready"
			: "idle";
		const chips: ToolshedStatusChip[] = [
			{ id: "workspace", label: humanize(persistedState.workspaceId), tone: "info" },
			{ id: "frontier", label: frontier ? `${humanize(frontier.kind)} frontier` : "No frontier", tone: frontier ? frontier.tone : "neutral" },
			{ id: "packets", label: `${packets.filter((packet) => packet.status === "staged").length} staged packets`, tone: packets.some((packet) => packet.status === "staged") ? "warning" : "neutral" },
			{ id: "cards", label: `${listAllCards().length} cards`, tone: listAllCards().length > 0 ? "success" : "neutral" },
			{ id: "mcp", label: mcp.configured ? `MCP ${mcp.count}` : "MCP off", tone: mcp.configured ? "success" : "warning" },
			{ id: "skills", label: `${skills.length} skills`, tone: skills.length > 0 ? "info" : "neutral" },
		];
		if (repository) {
			chips.push({ id: "git", label: `${repository.branch}${repository.dirty ? ` · ${repository.changed} dirty` : " · clean"}`, tone: repository.dirty ? "warning" : "success" });
		}
		return {
			connection: toolshedControlConnected ? "connected" : (toolshedWebUrl ? "reconnecting" : "offline"),
			session,
			model: ctx.model?.id,
			provider: ctx.model?.provider,
			frontierId: frontier?.id || null,
			chips,
		};
	}

	function buildToolshedState(ctx: ExtensionContext): ToolshedState {
		const lane = buildLane(ctx);
		const packets = [...persistedState.packets].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
		const mcp = readProjectMcpState(ctx.cwd);
		const skills = scanSkillCatalog(ctx.cwd, extensionRepoRoot);
		const documents = readProjectDocuments(ctx.cwd);
		const repository = readGitSummary(ctx.cwd);
		const workspaces = buildWorkspacePresets(ctx, lane, packets, mcp, skills, repository);
		const slashCommands = STATIC_SLASH_COMMANDS;
		const widgets = buildWidgets(ctx, lane, packets, mcp, skills, slashCommands, documents, repository);
		const registry = buildToolshedRegistryState(ctx, lane, mcp);
		const frontier = getActiveFrontierItem(lane);
		return {
			sessionId: persistedState.sessionId,
			projectDir: ctx.cwd,
			projectName: basename(ctx.cwd) || ctx.cwd,
			workspaceId: persistedState.workspaceId,
			workspaces,
			status: buildStatus(ctx, lane, packets, mcp, skills, repository),
			frontier: {
				id: frontier?.id || null,
				title: frontier?.title || "No frontier",
				summary: frontier?.summary || "Toolshed is ready.",
				kind: frontier?.kind || null,
				timestamp: frontier?.timestamp || null,
			},
			lane,
			packets,
			widgets,
			mcp,
			skills,
			slashCommands,
			documents,
			repository,
			registry,
			dashboardMeta: {
				webUrl: toolshedWebUrl,
				stateFile: getToolshedStateFile(),
				sessionStateFile,
				controlPort: TOOLSHED_WEB_CONTROL_PORT,
				liveSessionConnected: toolshedControlConnected,
				extensionRepoRoot,
				lastTranscriptChangeAt: lastTranscriptChangeAt > 0 ? new Date(lastTranscriptChangeAt).toISOString() : null,
			},
			updatedAt: nowIso(),
		};
	}

	function flushToolshedState() {
		if (!widgetCtx || !logDir) return;
		try {
			const json = JSON.stringify(buildToolshedState(widgetCtx), null, 2);
			if (json === lastStateJson) return;
			writeFileSync(getToolshedStateFile(), json, "utf-8");
			lastStateJson = json;
		} catch {}
	}

	function scheduleToolshedStateWrite() {
		if (toolshedStateFlushTimer) return;
		toolshedStateFlushTimer = setTimeout(() => {
			toolshedStateFlushTimer = null;
			flushToolshedState();
		}, 75);
	}

	function updateWidget() {
		if (!widgetCtx) return;
		registerToolshedOnControl();
		scheduleToolshedStateWrite();
		const state = buildToolshedState(widgetCtx);
		widgetCtx.ui.setStatus("toolshed", `${state.projectName} · ${humanize(state.workspaceId)} · ${listAllCards().length} cards · ${state.packets.filter((packet) => packet.status === "staged").length} pkt`);
		widgetCtx.ui.setWidget("pi-toolshed", (_tui: any, theme: any) => {
			const text = new Text("", 0, 1);
			return {
				render(width: number): string[] {
					const frontier = state.frontier.summary;
					const header = theme.fg("accent", theme.bold("Pi Toolshed")) +
						theme.fg("muted", " · ") +
						theme.fg("accent", humanize(state.workspaceId));
					const lines = [
						header,
						"",
						`${theme.fg("dim", "Frontier")}: ${frontier}`,
						`${theme.fg("dim", "Cards")}: ${listAllCards().length} reusable`,
						`${theme.fg("dim", "Packets")}: ${state.packets.filter((packet) => packet.status === "staged").length} staged / ${state.packets.length} total`,
						`${theme.fg("dim", "MCP")}: ${state.mcp.summary}`,
						`${theme.fg("dim", "Bridge")}: ${state.status.connection}`,
						`${theme.fg("dim", "Web")}: ${state.dashboardMeta.webUrl || "not started"}`,
					];
					text.setText(lines.join("\n"));
					return text.render(width);
				},
				invalidate() { text.invalidate(); },
			};
		});
	}

	setTimeout(connectToolshedControlSocket, 1500);
	setInterval(() => {
		if (!toolshedControlConnected) connectToolshedControlSocket();
	}, 10000);

	pi.registerTool({
		name: "toolshed_live_apps",
		label: "Toolshed Live Apps",
		description: "List tracked Toolshed MCP apps and their live, tracked, and published status for this workspace. Use this when the user asks what Toolshed apps are available right now.",
		parameters: Type.Object({
			status: Type.Optional(Type.String({
				description: "Optional filter: live, stale, draft, published, or all.",
			})),
			query: Type.Optional(Type.String({
				description: "Optional case-insensitive filter for the app title, server id, or tool name.",
			})),
		}),
		async execute(_toolCallId, params) {
			const ctx = widgetCtx;
			if (!ctx) {
				return {
					content: [{ type: "text", text: "Toolshed is not initialized in this session yet." }],
					details: { status: "missing" },
				};
			}
			const registry = buildToolshedRegistryState(ctx, buildLane(ctx), readProjectMcpState(ctx.cwd));
			const statusFilter = String((params as any).status || "all").trim().toLowerCase();
			const query = String((params as any).query || "").trim().toLowerCase();
			let entries = registry.entries.slice();
			if (statusFilter && statusFilter !== "all") {
				entries = entries.filter((entry) =>
					entry.liveStatus === statusFilter
					|| entry.trackedStatus === statusFilter
					|| entry.publishedStatus === statusFilter
					|| (statusFilter === "published" && entry.publishedStatus === "published")
				);
			}
			if (query) {
				entries = entries.filter((entry) =>
					[entry.title, entry.serverId || "", entry.toolName || "", entry.brief].some((value) => value.toLowerCase().includes(query))
				);
			}
			const lines = entries.length > 0
				? entries.map((entry) => [
					`- ${entry.title}`,
					`  tracked: ${entry.trackedLabel}`,
					`  live: ${entry.liveLabel}`,
					`  published: ${entry.publishedLabel}`,
					entry.serverId ? `  server: ${entry.serverId}` : "",
					entry.toolName ? `  tool: ${entry.toolName}` : "",
				].filter(Boolean).join("\n")).join("\n")
				: "No tracked Toolshed apps match that filter.";
			return {
				content: [{ type: "text", text: `${registry.summary}\n${lines}` }],
				details: {
					status: "ok",
					summary: registry.summary,
					entries,
				},
			};
		},
	});

	pi.registerTool({
		name: "toolshed_github_board_query",
		label: "Toolshed GitHub Board Query",
		description: "Query the active inline Toolshed GitHub project board session without dumping the full snapshot into the conversation. Use this first for counts, filtered card lists, and compact board summaries.",
		parameters: Type.Object({
			question: Type.Optional(Type.String({
				description: "Optional original user question for traceability only.",
			})),
			view: Type.Optional(Type.String({
				description: "Optional response shape: `summary`, `counts`, or `cards`. Defaults to `summary`.",
			})),
			column: Type.Optional(Type.String({
				description: "Optional column filter such as `Backlog`, `In Progress`, `Review`, or `Done`.",
			})),
			types: Type.Optional(Type.Array(Type.String({
				description: "Optional card type filter such as `task`, `epic`, `sprint`, or `other`.",
			}))),
			limit: Type.Optional(Type.Number({
				description: "Optional maximum number of cards to return for card views. Defaults to 10 and is capped at 30.",
			})),
			itemId: Type.Optional(Type.String({
				description: "Optional inline lane item id when a specific board session should be used.",
			})),
			cardId: Type.Optional(Type.String({
				description: "Optional Toolshed card id when the board belongs to a specific generated app card.",
			})),
			sessionId: Type.Optional(Type.String({
				description: "Optional board session id when the caller already knows it.",
			})),
		}),
		async execute(_toolCallId, params) {
			const session = getInlineGithubBoardSession({
				itemId: String((params as any).itemId || "").trim() || undefined,
				cardId: String((params as any).cardId || "").trim() || undefined,
				sessionId: String((params as any).sessionId || "").trim() || undefined,
			});
			if (!session) {
				return {
					content: [{ type: "text", text: "No active Toolshed inline GitHub board session is available right now." }],
					details: { status: "missing" },
				};
			}
			const snapshot = buildInlineGithubBoardSnapshot(session);
			const result = buildInlineGithubBoardQueryResult(snapshot, {
				view: normalizeGithubBoardQueryView((params as any).view),
				column: normalizeGithubBoardQueryColumn((params as any).column),
				types: normalizeGithubBoardQueryTypes((params as any).types),
				limit: Number((params as any).limit || 10),
			});
			return {
				content: [{ type: "text", text: formatInlineGithubBoardQueryResult(result) }],
				details: {
					status: "ok",
					question: String((params as any).question || "").trim(),
					itemId: session.itemId,
					cardId: session.cardId,
					title: session.title,
					sessionId: session.sessionId,
					result,
				},
				structuredContent: result,
			};
		},
	});

	pi.registerTool({
		name: "toolshed_github_board_session",
		label: "Toolshed GitHub Board Session",
		description: "Read the active inline Toolshed GitHub project board session. Prefer `toolshed_github_board_query` for compact counts and filtering; use this when you need the raw snapshot attached in structured content.",
		parameters: Type.Object({
			question: Type.Optional(Type.String({
				description: "Optional original user question. The text response stays compact, while the raw snapshot is attached in structured content.",
			})),
			itemId: Type.Optional(Type.String({
				description: "Optional inline lane item id when a specific board session should be used.",
			})),
			cardId: Type.Optional(Type.String({
				description: "Optional Toolshed card id when the board belongs to a specific generated app card.",
			})),
			sessionId: Type.Optional(Type.String({
				description: "Optional board session id when the caller already knows it.",
			})),
		}),
		async execute(_toolCallId, params) {
			const session = getInlineGithubBoardSession({
				itemId: String((params as any).itemId || "").trim() || undefined,
				cardId: String((params as any).cardId || "").trim() || undefined,
				sessionId: String((params as any).sessionId || "").trim() || undefined,
			});
			if (!session) {
				return {
					content: [{ type: "text", text: "No active Toolshed inline GitHub board session is available right now." }],
					details: { status: "missing" },
				};
			}
			const snapshot = buildInlineGithubBoardSnapshot(session);
			const focus = resolveInlineGithubBoardFocus(String((params as any).question || ""), session);
			return {
				content: [{ type: "text", text: answerInlineGithubBoardQuestion(String((params as any).question || ""), session, focus) }],
				details: {
					status: "ok",
					question: String((params as any).question || "").trim(),
					itemId: session.itemId,
					cardId: session.cardId,
					title: session.title,
					sessionId: session.sessionId,
					snapshot,
				},
				structuredContent: snapshot,
			};
		},
	});

	pi.registerTool({
		name: "toolshed_github_board_compute",
		label: "Toolshed GitHub Board Compute",
		description: "Run a pure synchronous JavaScript function over the active inline GitHub board snapshot. Prefer `toolshed_github_board_query` for common counts and lists; use this for exact custom grouping, ordering, or calculations.",
		parameters: Type.Object({
			code: Type.String({
				description: "A pure synchronous JavaScript function source like `(snapshot) => snapshot.columns.find(c => c.title === \"In Progress\")?.cards.filter(card => card.type === \"task\").length ?? 0`.",
			}),
			itemId: Type.Optional(Type.String({
				description: "Optional inline lane item id when a specific board session should be used.",
			})),
			cardId: Type.Optional(Type.String({
				description: "Optional Toolshed card id when the board belongs to a specific generated app card.",
			})),
			sessionId: Type.Optional(Type.String({
				description: "Optional board session id when the caller already knows it.",
			})),
		}),
		async execute(_toolCallId, params) {
			const session = getInlineGithubBoardSession({
				itemId: String((params as any).itemId || "").trim() || undefined,
				cardId: String((params as any).cardId || "").trim() || undefined,
				sessionId: String((params as any).sessionId || "").trim() || undefined,
			});
			if (!session) {
				return {
					content: [{ type: "text", text: "No active Toolshed inline GitHub board session is available right now." }],
					details: { status: "missing" },
				};
			}
			const snapshot = buildInlineGithubBoardSnapshot(session);
			const result = executeGithubBoardSnapshotCode(snapshot, String((params as any).code || ""));
			const resultPayload = result !== null && typeof result === "object"
				? result
				: { value: result };
			const text = typeof result === "string"
				? result
				: JSON.stringify(resultPayload, null, 2);
			return {
				content: [{ type: "text", text }],
				details: {
					status: "ok",
					itemId: session.itemId,
					cardId: session.cardId,
					title: session.title,
					sessionId: session.sessionId,
					result,
				},
				structuredContent: { result: resultPayload },
			};
		},
	});

	pi.registerTool({
		name: "toolshed_calculator_session",
		label: "Toolshed Calculator Session",
		description: "Read the active inline Toolshed calculator session and answer questions about the current display, recent result, or recent expression. Use this when the user refers to the inline calculator or asks for the current/recent calculated value.",
		parameters: Type.Object({
			question: Type.Optional(Type.String({
				description: "Optional question about the active calculator session, for example 'what is the current value?' or 'what was the last result?'",
			})),
			itemId: Type.Optional(Type.String({
				description: "Optional inline lane item id when a specific calculator session should be used.",
			})),
			cardId: Type.Optional(Type.String({
				description: "Optional Toolshed card id when the calculator belongs to a specific generated app card.",
			})),
			sessionId: Type.Optional(Type.String({
				description: "Optional calculator session id when the caller already knows it.",
			})),
		}),
		async execute(_toolCallId, params) {
			const session = getInlineCalculatorSession({
				itemId: String((params as any).itemId || "").trim() || undefined,
				cardId: String((params as any).cardId || "").trim() || undefined,
				sessionId: String((params as any).sessionId || "").trim() || undefined,
			});
			if (!session) {
				return {
					content: [{ type: "text", text: "No active Toolshed inline calculator session is available right now." }],
					details: { status: "missing" },
				};
			}
			const latest = getLatestCalculatorHistoryEntry(session);
			const question = String((params as any).question || "").trim();
			return {
				content: [{ type: "text", text: answerInlineCalculatorQuestion(question, session) }],
				details: {
					status: "ok",
					itemId: session.itemId,
					cardId: session.cardId,
					title: session.title,
					sessionId: session.sessionId,
					display: session.display,
					expression: session.expression,
					lastExpression: latest?.expression || null,
					lastResult: latest?.result || null,
					lastStep: Array.isArray(session.steps) && session.steps.length > 0 ? session.steps[0] : null,
					updatedAt: session.updatedAt,
					history: session.history,
					steps: session.steps,
				},
			};
		},
	});

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" as const };
		const transformed = maybeBuildInlineGithubBoardPrompt(event.text) || maybeBuildInlineCalculatorPrompt(event.text);
		if (!transformed || transformed === event.text) return { action: "continue" as const };
		return {
			action: "transform" as const,
			text: transformed,
			images: event.images,
		};
	});

	pi.on("before_agent_start", async (event) => {
		const session = getInlineCalculatorSession();
		const githubBoardSession = getInlineGithubBoardSession();
		const ctx = widgetCtx;
		const guidanceBlocks: string[] = [];
		if (ctx) {
			const registry = buildToolshedRegistryState(ctx, buildLane(ctx), readProjectMcpState(ctx.cwd));
			const liveEntries = registry.entries.filter((entry) => entry.liveStatus === "live");
			if (liveEntries.length > 0) {
				guidanceBlocks.push([
					"## Toolshed Live App Registry",
					"There are tracked Toolshed apps deployed live in this workspace.",
					'If the user asks what Toolshed apps are available right now, use the `toolshed_live_apps` tool.',
					"Do not claim a deployed Toolshed app is unavailable without checking the live registry first.",
					formatRegistryEntriesForPrompt(liveEntries),
				].join("\n"));
			}
		}
		if (session) {
			const latest = getLatestCalculatorHistoryEntry(session);
			guidanceBlocks.push([
				"## Toolshed Inline Calculator",
				"There is an active Toolshed inline calculator session in this conversation context.",
				'If the user asks about the calculator, the displayed value, the recent result, or what was just calculated, use the `toolshed_calculator_session` tool.',
				"Do not ask the user to paste the formula again and do not claim the calculator MCP/tool is unavailable when this session exists.",
				`Current known display: ${session.display}`,
				latest ? `Current known recent calculation: ${latest.expression} = ${latest.result}` : "Current known recent calculation: none yet",
			].join("\n"));
		}
			if (githubBoardSession) {
				guidanceBlocks.push([
					"## Toolshed Inline GitHub Board",
					"There is an active Toolshed inline GitHub project board session in this conversation context.",
					'Use the `toolshed_github_board_query` tool first for compact counts, filtering, and card lists from the cached board session.',
					'If the user needs exact grouping or ordering beyond the query tool, use `toolshed_github_board_compute` with a pure synchronous JavaScript function over the snapshot.',
					'Use `toolshed_github_board_session` only when you truly need the raw snapshot attached in structured content.',
					"Do not claim the board is unavailable, do not fall back to raw GitHub if this session exists, and do not answer from canned board summaries when live board data is available.",
					`Current known board: ${githubBoardSession.projectTitle || "GitHub Project Board"}${githubBoardSession.projectNumber ? ` (#${githubBoardSession.projectNumber})` : ""}`,
					`Current known repo: ${githubBoardSession.repoNameWithOwner || "current repo"}`,
				].join("\n"));
			}
		if (guidanceBlocks.length === 0) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${guidanceBlocks.join("\n\n")}` };
	});

	pi.registerCommand("toolshed-web", {
		description: "Start or reuse the Pi Toolshed web workspace and open it in the default browser",
		handler: async (_args, ctx) => {
			openToolshedWeb(ctx);
		},
	});

	pi.registerCommand("toolshed-status", {
		description: "Show the current Pi Toolshed state summary",
		handler: async (_args, ctx) => {
			showToolshedStatus(ctx);
		},
	});

	pi.registerCommand("toolshed-app", {
		description: "Create or update a tracked MCP app through a guided wizard",
		handler: async (args, ctx) => {
			widgetCtx = ctx;
			await runToolshedAppWizard(ctx, String(args || "").trim());
			updateWidget();
		},
	});

	pi.registerCommand("toolshed-workspace", {
		description: "Switch the active Toolshed workspace: /toolshed-workspace or /toolshed-workspace <id>",
		handler: async (args, ctx) => {
			await handleToolshedWorkspaceCommand(String(args || "").trim(), ctx);
		},
	});

	pi.registerCommand("toolshed-freeze", {
		description: "Freeze the current frontier into a Toolshed packet",
		handler: async (args, _ctx) => {
			freezeFrontier(String(args || "").trim() || undefined);
		},
	});

	pi.registerCommand("toolshed-packets", {
		description: "Show the current packet queue",
		handler: async (_args, ctx) => {
			showToolshedPackets(ctx);
		},
	});

	pi.registerCommand("toolshed-reset-layout", {
		description: "Reset Toolshed card collapse preferences",
		handler: async (_args, ctx) => {
			resetLayout();
			ctx.ui.notify("Toolshed card layout reset to defaults.", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		applyExtensionDefaults(import.meta.url, ctx);
		widgetCtx = ctx;
		sessionDir = join(ctx.cwd, ".pi", "agent-sessions");
		logDir = join(ctx.cwd, ".pi", "pipeline-logs");
		if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
		if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
		sessionStateFile = join(sessionDir, "pi-toolshed-state.json");
		toolshedWebUrl = `http://127.0.0.1:${TOOLSHED_WEB_PORT}`;
		restoreSessionState(loadSessionState());
			projectCards = loadProjectCards(ctx.cwd);
			if (listAllCards().length === 0) seedMermaidCard(true);
			ensureToolshedWebServer(ctx);
			startTranscriptWatch(ctx);
			scheduleTrackedMcpAppVerification(ctx, 300);
			updateWidget();

		ctx.ui.notify(
			[
				"Pi Toolshed — lane-first web workspace",
				"",
				"Commands:",
				"  /toolshed-web          Open the web workspace",
				"  /toolshed-status       Show current Toolshed state",
				"  /toolshed-app          Create or update a tracked MCP app through a guided wizard",
				"  /toolshed-workspace    Switch card decks",
				"  /toolshed-freeze       Freeze the current frontier into a packet",
				"  /toolshed-packets      Inspect the packet queue",
				"  /toolshed-reset-layout Reset card collapse state",
				"  Built-ins: Component Builder, Pi Blueprint, Mermaid Diagrammer seed",
				"  /mcp                   Inspect configured MCP servers and tools",
			].join("\n"),
			"info",
		);

		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
				const packets = persistedState.packets.filter((packet) => packet.status === "staged").length;
					const cards = listAllCards().length;
				const usage = ctx.getContextUsage();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);
				const left = theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", "toolshed") +
					theme.fg("muted", " · ") +
					theme.fg("accent", humanize(persistedState.workspaceId)) +
						theme.fg("muted", ` · ${cards} cards · ${packets} pkt`);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});

		pi.on("session_shutdown", async () => {
			stopTranscriptWatch();
			if (toolshedStateFlushTimer) {
				clearTimeout(toolshedStateFlushTimer);
				toolshedStateFlushTimer = null;
			}
			if (mcpAppVerifyTimer) {
				clearTimeout(mcpAppVerifyTimer);
				mcpAppVerifyTimer = null;
			}
			try { toolshedControlSocket?.end(); } catch {}
			toolshedControlSocket = null;
			toolshedControlConnected = false;
		});
}
