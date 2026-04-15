/**
 * Factory Droid CLI Provider Extension for pi
 *
 * Bridges pi model requests through the local `droid` CLI.
 *
 * Current scope:
 * - Exposes Factory's built-in/core models only
 * - Intentionally excludes `custom:*` Droid models for now
 * - Uses the stable `droid exec -o json` bridge rather than Droid's
 *   ACP daemon/session protocol because Pi already owns conversation state
 *   and tool execution for this provider path
 * - Keeps pi in charge of tool execution by disabling Droid's own tools and
 *   asking the selected model to emit pi-compatible JSON blocks
 *
 * Notes:
 * - This first pass is text-first. The Droid CLI itself supports richer
 *   multimodal/session flows, but this bridge currently serializes images as
 *   placeholders in the prompt instead of true multimodal passthrough.
 * - If you need a specific binary path, set FACTORY_DROID_PATH or DROID_PATH.
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "@mariozechner/pi-ai";
import { calculateCost, createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER_NAME = "factory-droid";
const DROID_EXECUTABLE = process.env.FACTORY_DROID_PATH || process.env.DROID_PATH || "droid";
const DROID_TIMEOUT_MS = Number(process.env.FACTORY_DROID_TIMEOUT_MS || 180_000);
const TOOL_DISCOVERY_MODEL = "glm-4.7";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const TEXT_INPUT = ["text"] as const;

type DroidExecJson = {
	type?: string;
	subtype?: string;
	is_error?: boolean;
	result?: string;
	session_id?: string;
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
};

type BridgeTextBlock = { type: "text"; text: string };
type BridgeToolCallBlock = { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };
type BridgeBlock = BridgeTextBlock | BridgeToolCallBlock;

type CoreModelConfig = {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
};

const CORE_MODELS: CoreModelConfig[] = [
	{ id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5", reasoning: true, contextWindow: 200_000, maxTokens: 32_768 },
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6", reasoning: true, contextWindow: 200_000, maxTokens: 32_768 },
	{ id: "claude-opus-4-6-fast", name: "Claude Opus 4.6 Fast", reasoning: true, contextWindow: 200_000, maxTokens: 32_768 },
	{ id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", reasoning: true, contextWindow: 200_000, maxTokens: 32_768 },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", reasoning: true, contextWindow: 200_000, maxTokens: 32_768 },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", reasoning: true, contextWindow: 200_000, maxTokens: 16_384 },
	{ id: "gpt-5.2", name: "GPT-5.2", reasoning: true, contextWindow: 400_000, maxTokens: 128_000 },
	{ id: "gpt-5.2-codex", name: "GPT-5.2 Codex", reasoning: true, contextWindow: 400_000, maxTokens: 128_000 },
	{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex", reasoning: true, contextWindow: 400_000, maxTokens: 128_000 },
	{ id: "gpt-5.4", name: "GPT-5.4", reasoning: true, contextWindow: 922_000, maxTokens: 128_000 },
	{ id: "gpt-5.4-fast", name: "GPT-5.4 Fast", reasoning: true, contextWindow: 922_000, maxTokens: 128_000 },
	{ id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true, contextWindow: 256_000, maxTokens: 64_000 },
	{ id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", reasoning: true, contextWindow: 1_000_000, maxTokens: 65_536 },
	{ id: "gemini-3-flash-preview", name: "Gemini 3 Flash", reasoning: true, contextWindow: 1_000_000, maxTokens: 65_536 },
	{ id: "glm-4.7", name: "Droid Core (GLM-4.7)", reasoning: false, contextWindow: 131_072, maxTokens: 65_536 },
	{ id: "glm-5", name: "Droid Core (GLM-5)", reasoning: false, contextWindow: 200_000, maxTokens: 131_072 },
	{ id: "kimi-k2.5", name: "Droid Core (Kimi K2.5)", reasoning: false, contextWindow: 131_072, maxTokens: 65_536 },
	{ id: "minimax-m2.5", name: "Droid Core (MiniMax M2.5)", reasoning: true, contextWindow: 1_000_000, maxTokens: 65_536 },
];

let discoveredDisabledToolsArg: string | null = null;
let discoverDisabledToolsPromise: Promise<string> | null = null;

function createEmptyOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match ? match[1].trim() : trimmed;
}

function extractJsonCandidates(text: string): string[] {
	const candidates = new Set<string>();
	const direct = stripCodeFences(text);

	for (const line of direct.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) candidates.add(trimmed);
	}

	for (let start = 0; start < direct.length; start++) {
		const opener = direct[start];
		if (opener !== "{" && opener !== "[") continue;

		let depth = 0;
		let inString = false;
		let escaped = false;

		for (let end = start; end < direct.length; end++) {
			const char = direct[end];

			if (escaped) {
				escaped = false;
				continue;
			}

			if (inString) {
				if (char === "\\") escaped = true;
				else if (char === '"') inString = false;
				continue;
			}

			if (char === '"') {
				inString = true;
				continue;
			}

			if (char === "{" || char === "[") depth++;
			else if (char === "}" || char === "]") {
				depth--;
				if (depth === 0) {
					candidates.add(direct.slice(start, end + 1));
					break;
				}
				if (depth < 0) break;
			}
		}
	}

	return Array.from(candidates);
}

function tryParseJson(text: string): unknown {
	const direct = stripCodeFences(text);
	for (const candidate of [direct, ...extractJsonCandidates(direct)]) {
		try {
			return JSON.parse(candidate);
		} catch {}
	}
	return undefined;
}

function coerceArguments(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	if (typeof value === "string") {
		const parsed = tryParseJson(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	}
	return {};
}

function normalizeBridgeBlocks(rawResult: string): BridgeBlock[] {
	const parsed = tryParseJson(rawResult) as { content?: unknown } | undefined;
	const rawBlocks = Array.isArray(parsed?.content) ? parsed!.content : undefined;

	if (!rawBlocks) {
		return [{ type: "text", text: stripCodeFences(rawResult) }];
	}

	const blocks: BridgeBlock[] = [];
	for (const rawBlock of rawBlocks) {
		if (!rawBlock || typeof rawBlock !== "object") continue;
		const block = rawBlock as Record<string, unknown>;

		if (block.type === "text" && typeof block.text === "string") {
			blocks.push({ type: "text", text: block.text });
			continue;
		}

		if (block.type === "toolCall" && typeof block.name === "string") {
			blocks.push({
				type: "toolCall",
				id: typeof block.id === "string" && block.id.trim() ? block.id : `call_${randomUUID()}`,
				name: block.name,
				arguments: coerceArguments(block.arguments),
			});
		}
	}

	if (blocks.length === 0) {
		return [{ type: "text", text: stripCodeFences(rawResult) }];
	}

	return blocks;
}

function simplifyUserContent(content: string | Array<TextContent | ImageContent>): unknown {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}

	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		return {
			type: "image",
			note: "Image omitted by Factory Droid bridge (true multimodal passthrough not implemented yet).",
			mimeType: block.mimeType,
			sizeBytes: block.data.length,
		};
	});
}

function simplifyAssistantContent(content: Array<TextContent | ThinkingContent | ToolCall>): unknown {
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		if (block.type === "thinking") {
			return { type: "thinking", text: block.thinking };
		}
		return { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
	});
}

function simplifyToolResultContent(content: Array<TextContent | ImageContent>): unknown {
	return content.map((block) => {
		if (block.type === "text") {
			return { type: "text", text: block.text };
		}
		return {
			type: "image",
			note: "Tool result image omitted by Factory Droid bridge.",
			mimeType: block.mimeType,
			sizeBytes: block.data.length,
		};
	});
}

function simplifyMessages(messages: Message[]): unknown[] {
	const simplified: unknown[] = [];

	for (const message of messages) {
		if (message.role === "user") {
			simplified.push({
				role: "user",
				content: simplifyUserContent(message.content),
			});
			continue;
		}

		if (message.role === "assistant") {
			simplified.push({
				role: "assistant",
				content: simplifyAssistantContent(message.content),
			});
			continue;
		}

		const toolResult = message as ToolResultMessage & { toolName?: string };
		simplified.push({
			role: "toolResult",
			toolCallId: toolResult.toolCallId,
			toolName: toolResult.toolName,
			isError: toolResult.isError,
			content: simplifyToolResultContent(toolResult.content),
		});
	}

	return simplified;
}

function simplifyTools(tools?: Tool[]): unknown[] {
	if (!tools?.length) {
		return [];
	}

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

function buildBridgePrompt(model: Model<Api>, context: Context): string {
	const conversation = simplifyMessages(context.messages);
	const tools = simplifyTools(context.tools);
	const workingDirectory = process.cwd();

	return [
		"You are acting as the raw language model backend for another agent runtime named pi.",
		"",
		"Follow these rules exactly:",
		"1. Do not behave like Droid or mention Factory unless the user explicitly asks about them.",
		"2. Do not use any internal tools. They are unavailable for this request.",
		"3. Your entire response must be exactly one JSON object with no markdown fences and no extra prose.",
		"4. The object must have a single top-level field named `content`.",
		"5. `content` must be an ordered array of blocks.",
		"6. Allowed block shapes:",
		"   - { \"type\": \"text\", \"text\": string }",
		"   - { \"type\": \"toolCall\", \"id\": string, \"name\": string, \"arguments\": object }",
		"7. If tool use is required, emit toolCall blocks instead of pretending the tool already ran.",
		"8. Tool call ids must be unique within the response.",
		"9. Tool arguments must be valid JSON matching the tool schema as closely as possible.",
		"10. If no tool is needed, return one or more text blocks.",
		"11. If the user asks about previous tool results, use the provided conversation context.",
		"",
		`Active model: ${model.id}`,
		`Current working directory: ${workingDirectory}`,
		context.systemPrompt ? `System prompt:\n${context.systemPrompt}` : "System prompt: (none)",
		`Available tools:\n${JSON.stringify(tools, null, 2)}`,
		`Conversation:\n${JSON.stringify(conversation, null, 2)}`,
		"",
		"Return the JSON object now.",
	].join("\n");
}

function mapReasoning(model: Model<Api>, reasoning?: string): string | undefined {
	if (!model.reasoning) {
		return undefined;
	}
	if (!reasoning) {
		return undefined;
	}

	const id = model.id.toLowerCase();
	const isOpenAiStyle = id.startsWith("gpt-") || id.includes("codex") || id.startsWith("glm-") || id.startsWith("kimi-");
	const isGemma4 = /(^|[-_])gemma[-_]?4([-.]|$)|\bgemma(?:\s*|[-_]?)(?:4|four)\b/i.test(id);

	switch (reasoning) {
		case "off":
			return isOpenAiStyle ? "none" : "off";
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return isGemma4 ? "medium" : "medium";
		case "high":
		case "xhigh":
			return "high";
		default:
			return undefined;
	}
}

function applyUsage(output: AssistantMessage, model: Model<Api>, usage?: DroidExecJson["usage"]): void {
	output.usage.input = usage?.input_tokens ?? 0;
	output.usage.output = usage?.output_tokens ?? 0;
	output.usage.cacheRead = usage?.cache_read_input_tokens ?? 0;
	output.usage.cacheWrite = usage?.cache_creation_input_tokens ?? 0;
	output.usage.totalTokens =
		output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
	calculateCost(model, output.usage);
}

async function runDroid(args: string[], input: string, signal?: AbortSignal, timeoutMs = DROID_TIMEOUT_MS): Promise<{ stdout: string; stderr: string; code: number }> {
	if (signal?.aborted) {
		throw new Error("Factory Droid request aborted before start");
	}

	return await new Promise((resolve, reject) => {
		const child = spawn(DROID_EXECUTABLE, args, {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let settled = false;
		let abortTimer: NodeJS.Timeout | undefined;
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish(() => reject(new Error(`Factory Droid request timed out after ${timeoutMs}ms`)));
		}, timeoutMs);

		const cleanup = () => {
			clearTimeout(timeout);
			if (abortTimer) clearTimeout(abortTimer);
			signal?.removeEventListener("abort", onAbort);
		};

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};

		const onAbort = () => {
			child.kill("SIGTERM");
			abortTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
			finish(() => reject(new Error("Factory Droid request aborted")));
		};

		signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			finish(() => reject(error));
		});
		child.on("close", (code) => {
			finish(() => resolve({ stdout, stderr, code: code ?? 1 }));
		});

		if (input) {
			child.stdin.write(input);
		}
		child.stdin.end();
	});
}

async function getDisabledToolsArg(signal?: AbortSignal): Promise<string> {
	if (discoveredDisabledToolsArg) {
		return discoveredDisabledToolsArg;
	}

	if (!discoverDisabledToolsPromise) {
		discoverDisabledToolsPromise = (async () => {
			try {
				const { stdout, stderr, code } = await runDroid(
					["exec", "--list-tools", "-m", TOOL_DISCOVERY_MODEL, "-o", "json"],
					"",
					signal,
					30_000,
				);

				if (code !== 0) {
					throw new Error(`Failed to discover Droid tools (${code}): ${stderr || stdout}`);
				}

				const parsed = tryParseJson(stdout);
				if (!Array.isArray(parsed)) {
					throw new Error("Unexpected `droid exec --list-tools` output");
				}

				const llmIds = Array.from(
					new Set(
						parsed
							.map((tool) => (tool && typeof tool === "object" ? String((tool as { llmId?: string }).llmId || "") : ""))
							.filter(Boolean),
					),
				);

				discoveredDisabledToolsArg = llmIds.join(",");
				return discoveredDisabledToolsArg;
			} catch (error) {
				discoverDisabledToolsPromise = null;
				throw error;
			}
		})();
	}

	return await discoverDisabledToolsPromise;
}

function buildDroidArgs(model: Model<Api>, disabledToolsArg: string, reasoning?: string): string[] {
	const args = ["exec", "-m", model.id, "-o", "json"];
	if (reasoning) {
		args.push("-r", reasoning);
	}
	if (disabledToolsArg) {
		args.push("--disabled-tools", disabledToolsArg);
	}
	return args;
}

function parseDroidExecOutput(stdout: string, stderr: string, code: number): DroidExecJson {
	if (code !== 0) {
		throw new Error(`Factory Droid exited with code ${code}: ${stderr || stdout || "no output"}`);
	}

	const parsed = tryParseJson(stdout) as DroidExecJson | undefined;
	if (!parsed || typeof parsed !== "object") {
		throw new Error(`Factory Droid returned non-JSON output: ${stdout || stderr || "<empty>"}`);
	}

	if (parsed.is_error) {
		throw new Error(`Factory Droid returned an error: ${parsed.result || stderr || stdout}`);
	}

	return parsed;
}

async function requestFactoryDroidCompletion(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<{ response: DroidExecJson; blocks: BridgeBlock[] }> {
	const disabledToolsArg = await getDisabledToolsArg(options?.signal);
	const reasoning = mapReasoning(model, options?.reasoning);
	const prompt = buildBridgePrompt(model, context);
	const args = buildDroidArgs(model, disabledToolsArg, reasoning);
	const { stdout, stderr, code } = await runDroid(args, prompt, options?.signal);
	const response = parseDroidExecOutput(stdout, stderr, code);
	const resultText = typeof response.result === "string" ? response.result : "";
	const blocks = normalizeBridgeBlocks(resultText);
	return { response, blocks };
}

function emitBlocks(stream: AssistantMessageEventStream, output: AssistantMessage, blocks: BridgeBlock[]): void {
	for (const block of blocks) {
		if (block.type === "text") {
			output.content.push({ type: "text", text: block.text } as any);
			const contentIndex = output.content.length - 1;
			stream.push({ type: "text_start", contentIndex, partial: output });
			if (block.text) {
				stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: output });
			}
			stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
			continue;
		}

		const toolCall = {
			type: "toolCall",
			id: block.id,
			name: block.name,
			arguments: block.arguments,
		} as const;
		output.content.push(toolCall as any);
		const contentIndex = output.content.length - 1;
		stream.push({ type: "toolcall_start", contentIndex, partial: output });
		stream.push({
			type: "toolcall_delta",
			contentIndex,
			delta: JSON.stringify(block.arguments),
			partial: output,
		});
		stream.push({ type: "toolcall_end", contentIndex, toolCall: toolCall as any, partial: output });
	}
}

function streamFactoryDroid(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createEmptyOutput(model);
		stream.push({ type: "start", partial: output });

		try {
			const { response, blocks } = await requestFactoryDroidCompletion(model, context, options);
			emitBlocks(stream, output, blocks);
			applyUsage(output, model, response.usage);
			output.stopReason = blocks.some((block) => block.type === "toolCall") ? "toolUse" : "stop";
			stream.push({ type: "done", reason: output.stopReason === "toolUse" ? "toolUse" : "stop", message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			(output as AssistantMessage & { errorMessage?: string }).errorMessage =
				error instanceof Error ? error.message : String(error);
			stream.push({
				type: "error",
				reason: output.stopReason,
				error: output as AssistantMessage & { errorMessage?: string },
			});
			stream.end();
		}
	})();

	return stream;
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(PROVIDER_NAME, {
		baseUrl: "droid://local-cli",
		apiKey: "droid-cli-session",
		api: "openai-completions",
		streamSimple: streamFactoryDroid,
		models: CORE_MODELS.map((model) => ({
			id: model.id,
			name: `${model.name} (via Droid CLI)`,
			reasoning: model.reasoning,
			input: [...TEXT_INPUT],
			cost: { ...ZERO_COST },
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
		})),
	});
}
