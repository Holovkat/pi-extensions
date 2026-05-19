import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const STATE_TYPE = "ollama-ralph-state";
const TOOL_NAME = "ralph_step";
const PLANNER_TOOLS = ["read", "bash"];
const DEFAULT_EXECUTOR_TOOLS = ["read", "bash", "edit", "write"];
const DEFAULT_MAX_STEP_ATTEMPTS = 3;
const DEFAULT_BASH_TIMEOUT_SECONDS = 90;
const OLLAMA_PROVIDER = "ollama";

type StepStatus = "pending" | "in_progress" | "completed" | "blocked";
type RalphMode = "idle" | "planning" | "executing" | "blocked" | "completed";

interface RalphStep {
	step: number;
	text: string;
	status: StepStatus;
	notes: string[];
	attempts: number;
}

interface RalphState {
	mode: RalphMode;
	goal: string;
	originSessionFile?: string;
	previousTools: string[];
	steps: RalphStep[];
	currentStep: number;
	blockedReason?: string;
	autoLoop: boolean;
	maxStepAttempts: number;
	triggerOnStart?: boolean;
	lastAutoPrompt?: string;
	repeatedAutoPromptCount: number;
	lastAssistantText?: string;
	repeatedAssistantCount: number;
}

interface RalphToolDetails {
	ok: boolean;
	action: "complete" | "block" | "note" | "status";
	step: number;
	note: string;
}

type CommandCapableContext = ExtensionContext & {
	newSession?: (options: { parentSession: string; setup: (sm: any) => Promise<void> | void }) => Promise<{ cancelled?: boolean }>;
};

function createEmptyState(): RalphState {
	return {
		mode: "idle",
		goal: "",
		previousTools: [],
		steps: [],
		currentStep: 1,
		autoLoop: true,
		maxStepAttempts: DEFAULT_MAX_STEP_ATTEMPTS,
		triggerOnStart: false,
		repeatedAutoPromptCount: 0,
		repeatedAssistantCount: 0,
	};
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
	if (cleaned.length > 0) cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
	return cleaned;
}

function extractPlanSteps(message: string): RalphStep[] {
	const steps: RalphStep[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return steps;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = cleanStepText(match[2] || "");
		if (!text || text.startsWith("-") || text.length < 4) continue;
		steps.push({
			step: steps.length + 1,
			text,
			status: "pending",
			notes: [],
			attempts: 0,
		});
	}

	return steps;
}

function getCurrentStep(state: RalphState): RalphStep | undefined {
	return state.steps.find((step) => step.step === state.currentStep);
}

function getNextPendingStep(state: RalphState): RalphStep | undefined {
	return state.steps.find((step) => step.status === "pending" || step.status === "in_progress");
}

function isOllamaModel(ctx: ExtensionContext): boolean {
	return ctx.model?.provider === OLLAMA_PROVIDER;
}

function isGemmaLike(ctx: ExtensionContext): boolean {
	const haystack = `${ctx.model?.provider || ""}/${ctx.model?.id || ""}`.toLowerCase();
	return /ollama\/.*gemma(?:\s*|[-_]?)(?:4|four)/i.test(haystack);
}

function shouldUseRalphModelHints(ctx: ExtensionContext): boolean {
	return isOllamaModel(ctx) || isGemmaLike(ctx);
}

function buildPlannerPrompt(goal: string): string {
	return [
		`Create an execution queue for this task: ${goal}`,
		"Return a compact numbered plan under a literal 'Plan:' header.",
		"Requirements:",
		"1. Use 3-10 concrete steps.",
		"2. Each step should be a small executable unit for a code-churner model.",
		"3. Do not make edits yet unless inspection absolutely requires it.",
		"4. Prefer read/inspect commands only.",
		"5. Keep each step outcome-focused and easy to mark complete.",
	].join("\n");
}

function buildExecutionPrompt(state: RalphState, retry = false): string {
	const current = getCurrentStep(state);
	if (!current) return "Summarize the completed work.";
	const remaining = state.steps
		.filter((step) => step.status !== "completed")
		.map((step) => `${step.step}. ${step.text}${step.step === current.step ? " [CURRENT]" : ""}`)
		.join("\n");
	const retryLine = retry
		? "This is a retry on the same step. Do less at once, choose the smallest next action, and checkpoint progress."
		: "Execute only the current step, not the whole queue.";
	return [
		`Goal: ${state.goal}`,
		"Ralph executor loop is active.",
		retryLine,
		"Queue:",
		remaining,
		`Current step ${current.step}: ${current.text}`,
		"Rules:",
		"- Keep tool use tight and bounded.",
		"- If the step is finished, call ralph_step with action='complete'.",
		"- If blocked, call ralph_step with action='block' and include a short reason.",
		"- If you made progress but need another turn, call ralph_step with action='note' and describe the next smallest move.",
		"- After the tool call, give a very short final response.",
	].join("\n");
}

function normalizeLoopText(text: string | undefined): string {
	return String(text || "").replace(/\s+/g, " ").trim();
}

function clipText(text: string | undefined, max = 220): string {
	const normalized = normalizeLoopText(text);
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 3)}...`;
}

function getCustomType(message: unknown): string {
	return typeof message === "object" && message !== null && "customType" in message ? String((message as { customType?: string }).customType || "") : "";
}

function filterRalphExecutionContextMessages(messages: unknown[]): unknown[] {
	const lastExecutionPromptIndex = messages.reduce<number>((index, message, currentIndex) => {
		return getCustomType(message) === "ollama-ralph-auto-execute" ? currentIndex : index;
	}, -1);

	return messages.filter((message, index) => {
		const customType = getCustomType(message);
		if (customType === "ollama-ralph-context" || customType === "ollama-ralph") return false;
		if (lastExecutionPromptIndex >= 0 && index < lastExecutionPromptIndex) return false;
		return true;
	});
}

function queueExecutionPrompt(pi: ExtensionAPI, state: RalphState, prompt: string): boolean {
	const normalized = normalizeLoopText(prompt);
	const last = normalizeLoopText(state.lastAutoPrompt);
	if (normalized && normalized === last) {
		state.repeatedAutoPromptCount += 1;
	} else {
		state.lastAutoPrompt = prompt;
		state.repeatedAutoPromptCount = 1;
	}

	if (state.repeatedAutoPromptCount > 2) {
		state.mode = "blocked";
		state.blockedReason = `Detected repeated auto-loop payload for step ${state.currentStep}. Stopping to avoid an infinite retry loop.`;
		return false;
	}

	setTimeout(() => {
		pi.sendMessage(
			{
				customType: "ollama-ralph-auto-execute",
				content: prompt,
				display: false,
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
	}, 0);
	return true;
}

function persistState(pi: ExtensionAPI, state: RalphState): void {
	pi.appendEntry<RalphState>(STATE_TYPE, {
		...state,
		steps: state.steps.map((step) => ({ ...step, notes: [...step.notes] })),
		previousTools: [...state.previousTools],
	});
}

function restoreState(ctx: ExtensionContext): RalphState {
	const entry = ctx.sessionManager
		.getEntries()
		.filter((value: { type: string; customType?: string }) => value.type === "custom" && value.customType === STATE_TYPE)
		.pop() as { data?: RalphState } | undefined;
	return entry?.data ? { ...createEmptyState(), ...entry.data } : createEmptyState();
}

function formatWidgetLines(state: RalphState, ctx: ExtensionContext): string[] | undefined {
	if (state.mode === "idle") return undefined;
	const icon = state.mode === "planning" ? "🧭" : state.mode === "completed" ? "✅" : state.mode === "blocked" ? "⛔" : "🔁";
	const header = `${icon} Ralph ${state.mode} · ${state.steps.filter((step) => step.status === "completed").length}/${state.steps.length}`;
	const lines = [ctx.ui.theme.fg("accent", header)];
	for (const step of state.steps) {
		const marker =
			step.status === "completed"
				? ctx.ui.theme.fg("success", "✓")
				: step.status === "blocked"
					? ctx.ui.theme.fg("error", "!")
					: step.step === state.currentStep && state.mode === "executing"
						? ctx.ui.theme.fg("accent", ">")
						: ctx.ui.theme.fg("muted", "·");
		lines.push(`${marker} ${step.step}. ${step.text}`);
	}
	if (state.blockedReason) lines.push(ctx.ui.theme.fg("error", `Blocked: ${state.blockedReason}`));
	return lines;
}

function updateUi(state: RalphState, ctx: ExtensionContext): void {
	if (state.mode === "idle") {
		ctx.ui.setStatus("ollama-ralph", undefined);
		ctx.ui.setWidget("ollama-ralph", undefined);
		return;
	}
	const completed = state.steps.filter((step) => step.status === "completed").length;
	ctx.ui.setStatus("ollama-ralph", `Ralph ${state.mode} ${completed}/${state.steps.length}`);
	ctx.ui.setWidget("ollama-ralph", formatWidgetLines(state, ctx));
}

function applyPlannerTools(pi: ExtensionAPI): void {
	pi.setActiveTools(PLANNER_TOOLS);
}

function applyExecutorTools(pi: ExtensionAPI, previousTools: string[]): void {
	const baseTools = previousTools.length > 0 ? previousTools.filter((tool) => tool !== TOOL_NAME) : DEFAULT_EXECUTOR_TOOLS;
	pi.setActiveTools(Array.from(new Set([...baseTools, TOOL_NAME])));
}

function clearLoopState(pi: ExtensionAPI, state: RalphState, ctx: ExtensionContext): RalphState {
	const tools = state.previousTools.length > 0 ? state.previousTools : DEFAULT_EXECUTOR_TOOLS;
	pi.setActiveTools(tools.filter((tool) => tool !== TOOL_NAME));
	const next = createEmptyState();
	persistState(pi, next);
	updateUi(next, ctx);
	return next;
}

async function maybeStartExecutionSession(pi: ExtensionAPI, ctx: CommandCapableContext, state: RalphState): Promise<RalphState> {
	const currentSessionFile = ctx.sessionManager.getSessionFile();
	const executionState: RalphState = {
		...state,
		mode: "executing",
		currentStep: 1,
		blockedReason: undefined,
		triggerOnStart: true,
		lastAutoPrompt: undefined,
		repeatedAutoPromptCount: 0,
		lastAssistantText: undefined,
		repeatedAssistantCount: 0,
		steps: state.steps.map((step, index) => ({
			...step,
			status: index === 0 ? "in_progress" : "pending",
			attempts: 0,
			notes: [],
		})),
	};

	if (!currentSessionFile || typeof ctx.newSession !== "function") {
		ctx.ui.notify("Ralph new-session support is unavailable here. Continuing execution in the current session.", "warning");
		applyExecutorTools(pi, executionState.previousTools);
		persistState(pi, executionState);
		updateUi(executionState, ctx);
		const queued = queueExecutionPrompt(pi, executionState, buildExecutionPrompt(executionState));
		persistState(pi, executionState);
		updateUi(executionState, ctx);
		if (!queued) ctx.ui.notify(executionState.blockedReason || "Ralph blocked repeated payload loop.", "warning");
		return executionState;
	}

	await ctx.newSession({
		parentSession: currentSessionFile,
		setup: async (sm) => {
			sm.appendCustomEntry(STATE_TYPE, executionState);
			sm.appendCustomMessageEntry(
				"ollama-ralph",
				`Ralph execution queue created for: ${executionState.goal}\n\n${executionState.steps.map((step) => `${step.step}. ${step.text}`).join("\n")}`,
				true,
				{ phase: "execution" },
			);
		},
	});
	return executionState;
}

export default function ollamaRalphExtension(pi: ExtensionAPI): void {
	let state = createEmptyState();

	pi.registerTool({
		name: TOOL_NAME,
		label: "Ralph Step",
		description: "Checkpoint progress for the current Ralph execution step.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("complete"),
				Type.Literal("block"),
				Type.Literal("note"),
				Type.Literal("status"),
			]),
			note: Type.Optional(Type.String({ description: "Short note, reason, or next action." })),
		}),
		promptGuidelines: [
			"When Ralph executor mode is active, call ralph_step exactly once near the end of a step attempt.",
			"Use action='complete' only when the current queued step is genuinely done.",
			"Use action='block' with a concise reason when you cannot proceed safely.",
			"Use action='note' when partial progress was made but another turn is needed.",
		],
		async execute(_toolCallId, params) {
			const current = getCurrentStep(state);
			if (!current) {
				return {
					content: [{ type: "text", text: "No active Ralph step." }],
					details: { ok: false, action: params.action, step: -1, note: "" } as RalphToolDetails,
				};
			}

			const note = String(params.note || "").trim();
			if (note) current.notes.push(note);

			switch (params.action) {
				case "complete":
					current.status = "completed";
					state.blockedReason = undefined;
					break;
				case "block":
					current.status = "blocked";
					state.mode = "blocked";
					state.blockedReason = note || `Step ${current.step} blocked.`;
					break;
				case "note":
				case "status":
				default:
					current.status = "in_progress";
					break;
			}

			persistState(pi, state);
			return {
				content: [
					{
						type: "text",
						text:
							params.action === "complete"
								? `Marked step ${current.step} complete.`
								: params.action === "block"
									? `Marked step ${current.step} blocked.`
									: `Recorded Ralph progress for step ${current.step}.`,
					},
				],
				details: { ok: true, action: params.action, step: current.step, note } as RalphToolDetails,
			};
		},
	});

	pi.registerCommand("ollama-ralph", {
		description: "Split Ollama work into a planning session and an auto-loop execution session",
		handler: async (args, ctx) => {
			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /ollama-ralph <goal>", "info");
				return;
			}
			if (!shouldUseRalphModelHints(ctx)) {
				ctx.ui.notify("Ralph is intended for Ollama/Gemma-style sessions. Current model is not Ollama, but continuing anyway.", "warning");
			}
			state = {
				mode: "planning",
				goal,
				originSessionFile: ctx.sessionManager.getSessionFile() || undefined,
				previousTools: pi.getActiveTools(),
				steps: [],
				currentStep: 1,
				blockedReason: undefined,
				autoLoop: true,
				maxStepAttempts: DEFAULT_MAX_STEP_ATTEMPTS,
				triggerOnStart: false,
				lastAutoPrompt: undefined,
				repeatedAutoPromptCount: 0,
				lastAssistantText: undefined,
				repeatedAssistantCount: 0,
			};
			applyPlannerTools(pi);
			persistState(pi, state);
			updateUi(state, ctx);
			pi.sendUserMessage(buildPlannerPrompt(goal));
		},
	});

	pi.registerCommand("ollama-ralph-status", {
		description: "Show Ralph loop status",
		handler: async (_args, ctx) => {
			if (state.mode === "idle") {
				ctx.ui.notify("Ralph is idle.", "info");
				return;
			}
			const lines = [
				`Mode: ${state.mode}`,
				`Goal: ${state.goal}`,
				...state.steps.map((step) => `${step.step}. [${step.status}] ${step.text}${step.notes.length ? ` — ${step.notes.at(-1)}` : ""}`),
			];
			if (state.blockedReason) lines.push(`Blocked: ${state.blockedReason}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("ollama-ralph-stop", {
		description: "Stop Ralph loop and restore normal tools",
		handler: async (_args, ctx) => {
			state = clearLoopState(pi, state, ctx);
			ctx.ui.notify("Ralph loop stopped.", "info");
		},
	});

	pi.registerCommand("ollama-ralph-debug", {
		description: "Show Ralph loop debug state and loop-detection counters",
		handler: async (_args, ctx) => {
			const current = getCurrentStep(state);
			const lines = [
				`Mode: ${state.mode}`,
				`Goal: ${state.goal || "(none)"}`,
				`Current step: ${current ? `${current.step} — ${current.text}` : "(none)"}`,
				`Step attempts: ${current?.attempts ?? 0}/${state.maxStepAttempts}`,
				`Repeated auto prompt count: ${state.repeatedAutoPromptCount}`,
				`Repeated assistant count: ${state.repeatedAssistantCount}`,
				`Last auto prompt: ${clipText(state.lastAutoPrompt) || "(none)"}`,
				`Last assistant text: ${clipText(state.lastAssistantText) || "(none)"}`,
				`Blocked reason: ${state.blockedReason || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), state.mode === "blocked" ? "warning" : "info");
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (state.mode === "planning") {
			return {
				message: {
					customType: "ollama-ralph-context",
					content: [
						"[RALPH PLANNER MODE]",
						"You are creating a queue for a smaller or stall-prone Ollama execution model.",
						"Do not do the full implementation now.",
						"Inspect only as needed and return a concise numbered Plan: with atomic steps.",
						"Avoid speculative extra work and avoid repeating long context.",
					].join("\n"),
					display: false,
				},
			};
		}

		if (state.mode === "executing") {
			const current = getCurrentStep(state);
			if (!current) return;
			return {
				message: {
					customType: "ollama-ralph-context",
					content: [
						"[RALPH EXECUTOR MODE]",
						`Goal: ${state.goal}`,
						`Current step ${current.step}: ${current.text}`,
						"Only work on the current step.",
						"Keep bash calls bounded and short.",
						"Call ralph_step before finishing the turn to checkpoint this step.",
					].join("\n"),
					display: false,
				},
			};
		}
	});

	(pi as any).on("context", async (event: { messages: unknown[] }) => {
		if (state.mode !== "executing" && state.mode !== "blocked" && state.mode !== "completed") return;
		return {
			messages: filterRalphExecutionContextMessages(event.messages),
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (state.mode !== "executing") return;
		if (event.toolName !== "bash") return;
		if (!shouldUseRalphModelHints(ctx)) return;
		const timeout = Number((event.input as { timeout?: number }).timeout || 0);
		if (!timeout || timeout > DEFAULT_BASH_TIMEOUT_SECONDS) {
			(event.input as { timeout?: number }).timeout = DEFAULT_BASH_TIMEOUT_SECONDS;
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		const lastAssistantText = lastAssistant ? normalizeLoopText(getAssistantText(lastAssistant)) : "";
		if (lastAssistantText) {
			if (lastAssistantText === normalizeLoopText(state.lastAssistantText)) {
				state.repeatedAssistantCount += 1;
			} else {
				state.lastAssistantText = lastAssistantText;
				state.repeatedAssistantCount = 1;
			}
		}

		if (state.mode === "planning") {
			if (!lastAssistant) return;
			const steps = extractPlanSteps(getAssistantText(lastAssistant));
			if (steps.length === 0) {
				ctx.ui.notify("Ralph could not extract a numbered Plan:. Refine the prompt or try again.", "warning");
				return;
			}
			state.steps = steps;
			persistState(pi, state);
			updateUi(state, ctx);
			ctx.ui.notify(`Ralph captured ${steps.length} steps. Starting execution...`, "info");
			state = await maybeStartExecutionSession(pi, ctx as CommandCapableContext, state);
			return;
		}

		if (state.mode !== "executing" && state.mode !== "blocked") return;
		if (state.mode === "blocked") {
			persistState(pi, state);
			updateUi(state, ctx);
			ctx.ui.notify(`Ralph blocked on step ${state.currentStep}: ${state.blockedReason || "unknown reason"}`, "warning");
			return;
		}

		const current = getCurrentStep(state);
		if (!current) return;

		if (current.status === "completed") {
			state.lastAutoPrompt = undefined;
			state.repeatedAutoPromptCount = 0;
			state.lastAssistantText = undefined;
			state.repeatedAssistantCount = 0;
			const next = getNextPendingStep(state);
			if (!next) {
				state.mode = "completed";
				persistState(pi, state);
				updateUi(state, ctx);
				ctx.ui.notify("Ralph execution queue completed.", "info");
				return;
			}
			state.currentStep = next.step;
			next.status = "in_progress";
			persistState(pi, state);
			updateUi(state, ctx);
			if (state.autoLoop) {
				const queued = queueExecutionPrompt(pi, state, buildExecutionPrompt(state));
				persistState(pi, state);
				updateUi(state, ctx);
				if (!queued) ctx.ui.notify(state.blockedReason || "Ralph blocked repeated payload loop.", "warning");
			}
			return;
		}

		current.attempts += 1;
		persistState(pi, state);
		updateUi(state, ctx);

		if (!state.autoLoop) return;
		if (state.repeatedAssistantCount > 2) {
			state.mode = "blocked";
			state.blockedReason = `Detected repeated assistant output for step ${current.step}. Stopping to avoid an infinite loop.`;
			persistState(pi, state);
			updateUi(state, ctx);
			ctx.ui.notify(state.blockedReason, "warning");
			return;
		}
		if (current.attempts >= state.maxStepAttempts) {
			state.mode = "blocked";
			state.blockedReason = `Step ${current.step} stalled after ${current.attempts} attempts.`;
			persistState(pi, state);
			updateUi(state, ctx);
			ctx.ui.notify(state.blockedReason, "warning");
			return;
		}

		const queued = queueExecutionPrompt(pi, state, buildExecutionPrompt(state, true));
		persistState(pi, state);
		updateUi(state, ctx);
		if (!queued) ctx.ui.notify(state.blockedReason || "Ralph blocked repeated payload loop.", "warning");
	});

	pi.on("session_start", async (event, ctx) => {
		state = restoreState(ctx);
		if (state.mode === "planning") {
			applyPlannerTools(pi);
		} else if (state.mode === "executing" || state.mode === "blocked" || state.mode === "completed") {
			applyExecutorTools(pi, state.previousTools);
		}
		updateUi(state, ctx);

		const reason = String((event as { reason?: string }).reason || "");
		if (reason === "new" && state.mode === "executing" && state.triggerOnStart) {
			state.triggerOnStart = false;
			persistState(pi, state);
			setTimeout(() => {
				const queued = queueExecutionPrompt(pi, state, buildExecutionPrompt(state));
				persistState(pi, state);
				updateUi(state, ctx);
				if (!queued) ctx.ui.notify(state.blockedReason || "Ralph blocked repeated payload loop.", "warning");
			}, 0);
		}
	});

	pi.on("model_select", async (_event, ctx) => {
		updateUi(state, ctx);
	});
}
