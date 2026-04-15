/**
 * Gemini model catalog manager for pi
 *
 * Registers Gemini/Gemma models through Google's OpenAI-compatible endpoint
 * and lets users refresh the provider catalog into ~/.pi/agent/models.json.
 *
 * Commands:
 * - /gemini-refresh-models
 * - /gemini-sync
 *
 * Auth loading order for runtime and discovery requests:
 * 1. nearest ./.secure/.env entry named `gemini`
 * 2. ~/.pi/.secure/.env entry named `gemini`
 * 3. ~/workspace/pi-extensions/.secure/.env entry named `gemini`
 * 4. ~/.secure/.env entry named `gemini`
 * 5. GEMINI_API_KEY env var
 * 6. GOOGLE_API_KEY env var
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	calculateCost,
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type ImageContent,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const GEMINI_PROVIDER = "google-gemini-cli";
const DEFAULT_BASE_URL = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
const DISCOVERY_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const CACHE_DIR = join(process.env.HOME || "", ".pi", "agent", "cache");
const CACHE_PATH = join(CACHE_DIR, "gemini-models.json");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const MODEL_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens" as const,
};

type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
	compat?: typeof MODEL_COMPAT;
};

type ModelsFile = {
	providers?: Record<string, any>;
};

type GeminiModelsResponse = {
	models?: GeminiModelEntry[];
};

type GeminiModelEntry = {
	name?: string;
	displayName?: string;
	description?: string;
	inputTokenLimit?: number;
	outputTokenLimit?: number;
	supportedGenerationMethods?: string[];
};

const FALLBACK_MODELS: ProviderModel[] = [
	{
		id: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		reasoning: true,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		compat: { ...MODEL_COMPAT },
	},
	{
		id: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		reasoning: true,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		compat: { ...MODEL_COMPAT },
	},
	{
		id: "gemini-2.0-flash",
		name: "Gemini 2.0 Flash",
		reasoning: false,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 8_192,
		compat: { ...MODEL_COMPAT },
	},
	{
		id: "gemini-3-pro-preview",
		name: "Gemini 3 Pro Preview",
		reasoning: true,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		compat: { ...MODEL_COMPAT },
	},
	{
		id: "gemini-3-flash-preview",
		name: "Gemini 3 Flash Preview",
		reasoning: true,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		compat: { ...MODEL_COMPAT },
	},
	{
		id: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro Preview",
		reasoning: true,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		compat: { ...MODEL_COMPAT },
	},
];

function findSecureEnvPath(startDir: string): string | null {
	let dir = resolve(startDir || process.cwd());
	while (true) {
		const candidate = join(dir, ".secure", ".env");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function readKeyFromEnvFile(envPath: string, wantedKey: string): string {
	const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (key === wantedKey && value) return value;
	}
	return "";
}

function loadGeminiApiKey(): string {
	const candidates = [
		findSecureEnvPath(process.cwd()),
		join(process.env.HOME || "", ".pi", ".secure", ".env"),
		join(process.env.HOME || "", "workspace", "pi-extensions", ".secure", ".env"),
		join(process.env.HOME || "", ".secure", ".env"),
	];
	for (const envPath of candidates) {
		if (!envPath || !existsSync(envPath)) continue;
		const value = readKeyFromEnvFile(envPath, "gemini");
		if (value) return value;
	}
	return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function getPersistedApiKeyReference(): string {
	return loadGeminiApiKey() || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "GEMINI_API_KEY";
}

function cloneModel(model: ProviderModel): ProviderModel {
	return {
		...model,
		input: [...model.input],
		cost: { ...model.cost },
		compat: model.compat ? { ...model.compat } : undefined,
	};
}

function cloneModels(models: ProviderModel[]): ProviderModel[] {
	return models.map(cloneModel);
}

function isProviderModel(value: unknown): value is ProviderModel {
	if (!value || typeof value !== "object") return false;
	const model = value as Partial<ProviderModel>;
	return (
		typeof model.id === "string" &&
		typeof model.name === "string" &&
		typeof model.reasoning === "boolean" &&
		Array.isArray(model.input) &&
		typeof model.contextWindow === "number" &&
		typeof model.maxTokens === "number" &&
		!!model.cost
	);
}

function stripModelPrefix(name: string | undefined): string {
	return String(name || "")
		.replace(/^models\//, "")
		.trim();
}

function titleCaseModelName(id: string): string {
	return id
		.split(/[-_]+/)
		.map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
		.join(" ")
		.replace(/\bIt\b/g, "IT")
		.replace(/\bTts\b/g, "TTS");
}

function isRunnableModel(entry: GeminiModelEntry): boolean {
	const id = stripModelPrefix(entry.name).toLowerCase();
	const methods = (entry.supportedGenerationMethods || []).map((value) => String(value).toLowerCase());
	if (!id) return false;
	if (!methods.includes("generatecontent")) return false;
	if (!/^(gemini|gemma)-/.test(id)) return false;
	if (/(tts|image|audio|speech|transcribe|embedding|embed|aqa|lyria|veo|nano-banana|clip)/.test(id)) return false;
	return true;
}

function supportsReasoning(id: string): boolean {
	return /^(gemini-(2\.5|3(\.1)?)(-|$)|gemini-(flash|pro)-latest$)/.test(id);
}

function supportsImageInput(id: string): boolean {
	return id.startsWith("gemini-") || id.startsWith("gemini");
}

function buildDiscoveredModel(entry: GeminiModelEntry): ProviderModel | null {
	if (!isRunnableModel(entry)) return null;
	const id = stripModelPrefix(entry.name);
	const contextWindow = Number(entry.inputTokenLimit) || 131_072;
	const maxTokens = Number(entry.outputTokenLimit) || Math.max(4096, Math.min(65_536, Math.floor(contextWindow / 4)));
	return {
		id,
		name: String(entry.displayName || "").trim() || titleCaseModelName(id),
		reasoning: supportsReasoning(id),
		input: supportsImageInput(id) ? ["text", "image"] : ["text"],
		cost: { ...ZERO_COST },
		contextWindow,
		maxTokens,
		compat: { ...MODEL_COMPAT },
	};
}

function normalizeDiscoveredModels(payload: GeminiModelsResponse): ProviderModel[] {
	const byId = new Map<string, ProviderModel>();
	for (const entry of payload.models || []) {
		const model = buildDiscoveredModel(entry);
		if (model) byId.set(model.id, model);
	}
	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function getChatCompletionsUrl(baseUrl: string): string {
	return new URL("chat/completions", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

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

function splitTextAndImages(content: string | Array<TextContent | ImageContent>) {
	if (typeof content === "string") {
		return {
			text: content,
			parts: [{ type: "text", text: content }],
		};
	}

	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	const parts = content.map((block) =>
		block.type === "text"
			? { type: "text", text: block.text }
			: {
					type: "image_url",
					image_url: {
						url: `data:${block.mimeType};base64,${block.data}`,
					},
			  },
	);

	return { text, parts };
}

function assistantContentToOpenAIMessage(content: Array<TextContent | ThinkingContent | ToolCall>) {
	const text = content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	const toolCalls = content
		.filter((block): block is ToolCall => block.type === "toolCall")
		.map((block) => ({
			id: block.id,
			type: "function",
			function: {
				name: block.name,
				arguments: JSON.stringify(block.arguments ?? {}),
			},
		}));

	const message: Record<string, unknown> = {
		role: "assistant",
		content: text,
	};
	if (toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}
	return message;
}

function toolResultToOpenAIMessage(message: ToolResultMessage) {
	const { text } = splitTextAndImages(message.content);
	return {
		role: "tool",
		tool_call_id: message.toolCallId,
		content: text || (message.isError ? "Tool execution failed." : "Tool execution completed."),
	};
}

function contextToOpenAIMessages(context: Context): Array<Record<string, unknown>> {
	const messages: Array<Record<string, unknown>> = [];

	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}

	for (const message of context.messages) {
		if (message.role === "user") {
			const { parts } = splitTextAndImages(message.content);
			messages.push({ role: "user", content: parts });
			continue;
		}

		if (message.role === "assistant") {
			messages.push(assistantContentToOpenAIMessage(message.content));
			continue;
		}

		messages.push(toolResultToOpenAIMessage(message));
	}

	return messages;
}

function toolToOpenAI(tool: Tool) {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
			strict: false,
		},
	};
}

function isGemma4Model(id: string): boolean {
	return /(^|[-_])gemma[-_]?4([-.]|$)|\bgemma(?:\s*|[-_]?)(?:4|four)\b/i.test(id);
}

function isGeminiFlashLiteModel(id: string): boolean {
	return /gemini-(?:2\.5|3(?:\.1)?)-(?:flash-lite|flash-lite-preview)/i.test(id);
}

function isGeminiReasoningModel(id: string): boolean {
	const lower = id.toLowerCase();
	return lower.startsWith("gemini-") || lower.startsWith("gemma-") || lower.startsWith("gemma");
}

function mapGeminiReasoningEffort(model: Model<Api>, reasoning?: SimpleStreamOptions["reasoning"]): "none" | "low" | "medium" | "high" | undefined {
	if (!reasoning || !isGeminiReasoningModel(model.id)) return undefined;
	if (reasoning === "off") return "none";
	if (isGemma4Model(model.id)) {
		if (reasoning === "minimal" || reasoning === "low") return "low";
		if (reasoning === "medium") return "medium";
		return "high";
	}
	if (reasoning === "minimal") return "low";
	if (reasoning === "low") return "low";
	if (reasoning === "medium") return "medium";
	return "high";
}

function getReasoningBudgetForLevel(reasoning?: SimpleStreamOptions["reasoning"]): number | undefined {
	if (!reasoning || reasoning === "off") return undefined;
	if (reasoning === "minimal") return 1024;
	if (reasoning === "low") return 4096;
	if (reasoning === "medium") return 10240;
	return 32768;
}

function getGeminiReasoningBudget(model: Model<Api>, reasoning?: SimpleStreamOptions["reasoning"]): number | undefined {
	const budget = getReasoningBudgetForLevel(reasoning);
	if (budget == null) return undefined;
	if (isGeminiFlashLiteModel(model.id)) {
		return Math.max(512, budget);
	}
	return budget;
}

function buildChatPayload(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		model: model.id,
		messages: contextToOpenAIMessages(context),
		max_tokens: typeof options?.maxTokens === "number" && options.maxTokens > 0 ? options.maxTokens : model.maxTokens,
	};

	if (typeof options?.temperature === "number") {
		payload.temperature = options.temperature;
	}

	const reasoningEffort = mapGeminiReasoningEffort(model, options?.reasoning);
	if (reasoningEffort === "none") {
		payload.reasoning = { effort: "none" };
	} else if (reasoningEffort) {
		const budget = getGeminiReasoningBudget(model, options?.reasoning);
		payload.reasoning = budget != null
			? { effort: reasoningEffort, budget_tokens: budget }
			: { effort: reasoningEffort };
	}

	if (context.tools && context.tools.length > 0) {
		payload.tools = context.tools.map(toolToOpenAI);
	}

	return payload;
}

type OpenAIChoice = {
	finish_reason?: string;
	message?: {
		content?: string | null;
		tool_calls?: Array<{
			id?: string;
			type?: string;
			function?: {
				name?: string;
				arguments?: string;
			};
		}>;
	};
};

type OpenAIUsage = {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
};

type OpenAIChatResponse = {
	choices?: OpenAIChoice[];
	usage?: OpenAIUsage;
	error?: {
		message?: string;
	};
};

function parseToolArguments(value: string | undefined): Record<string, unknown> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function mapStopReason(reason: string | undefined, output: AssistantMessage): "stop" | "length" | "toolUse" {
	if (output.content.some((block) => block.type === "toolCall")) return "toolUse";
	const normalized = String(reason || "").toLowerCase();
	if (normalized === "length" || normalized === "max_tokens") return "length";
	return "stop";
}

type ParsedAssistantBlock =
	| { type: "thinking"; thinking: string }
	| { type: "text"; text: string };

function parseThoughtTaggedContent(content: string): ParsedAssistantBlock[] {
	const blocks: ParsedAssistantBlock[] = [];
	const pattern = /<thought>([\s\S]*?)<\/thought>/gi;
	let lastIndex = 0;
	let match: RegExpExecArray | null = null;

	while ((match = pattern.exec(content)) !== null) {
		const before = content.slice(lastIndex, match.index);
		if (before.trim()) {
			blocks.push({ type: "text", text: before.trim() });
		}

		const thinking = match[1]?.trim();
		if (thinking) {
			blocks.push({ type: "thinking", thinking });
		}

		lastIndex = match.index + match[0].length;
	}

	const tail = content.slice(lastIndex);
	if (tail.trim()) {
		blocks.push({ type: "text", text: tail.trim() });
	}

	return blocks.length > 0 ? blocks : [{ type: "text", text: content }];
}

async function parseErrorResponse(response: Response): Promise<string> {
	const text = await response.text();
	if (!text.trim()) {
		return `${response.status} status code (no body)`;
	}
	try {
		const parsed = JSON.parse(text) as OpenAIChatResponse | Array<{ error?: { message?: string } }>;
		const message = Array.isArray(parsed) ? parsed[0]?.error?.message : parsed.error?.message;
		if (message) return message;
	} catch {}
	return `${response.status} ${text}`;
}

function streamGeminiOpenAICompat(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createEmptyOutput(model);
		stream.push({ type: "start", partial: output });

		try {
			const apiKey = options?.apiKey || loadGeminiApiKey();
			if (!apiKey) {
				throw new Error("Gemini API key not found. Add `gemini=...` to .secure/.env or set GEMINI_API_KEY.");
			}

			const response = await fetch(getChatCompletionsUrl(model.baseUrl), {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					...(options?.headers || {}),
				},
				body: JSON.stringify(buildChatPayload(model, context, options)),
				signal: options?.signal,
			});

			if (!response.ok) {
				throw new Error(await parseErrorResponse(response));
			}

			const payload = (await response.json()) as OpenAIChatResponse;
			const choice = payload.choices?.[0];
			const text = choice?.message?.content || "";
			const toolCalls = choice?.message?.tool_calls || [];

			for (const block of parseThoughtTaggedContent(text)) {
				const contentIndex = output.content.length;
				if (block.type === "thinking") {
					output.content.push({ type: "thinking", thinking: block.thinking });
					stream.push({ type: "thinking_start", contentIndex, partial: output });
					stream.push({ type: "thinking_delta", contentIndex, delta: block.thinking, partial: output });
					stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
					continue;
				}

				output.content.push({ type: "text", text: block.text });
				stream.push({ type: "text_start", contentIndex, partial: output });
				stream.push({ type: "text_delta", contentIndex, delta: block.text, partial: output });
				stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
			}

			for (const toolCall of toolCalls) {
				const name = toolCall.function?.name?.trim();
				if (!name) continue;
				const normalized: ToolCall = {
					type: "toolCall",
					id: toolCall.id?.trim() || `call_${output.content.length}`,
					name,
					arguments: parseToolArguments(toolCall.function?.arguments),
				};
				const contentIndex = output.content.length;
				output.content.push(normalized);
				stream.push({ type: "toolcall_start", contentIndex, partial: output });
				stream.push({
					type: "toolcall_delta",
					contentIndex,
					delta: JSON.stringify(normalized.arguments),
					partial: output,
				});
				stream.push({ type: "toolcall_end", contentIndex, toolCall: normalized, partial: output });
			}

			output.usage.input = payload.usage?.prompt_tokens || 0;
			output.usage.output = payload.usage?.completion_tokens || 0;
			output.usage.totalTokens = payload.usage?.total_tokens || output.usage.input + output.usage.output;
			calculateCost(model, output.usage);
			output.stopReason = mapStopReason(choice?.finish_reason, output);

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

function createProviderConfig(models: ProviderModel[], apiKey = loadGeminiApiKey() || getPersistedApiKeyReference()) {
	return {
		baseUrl: DEFAULT_BASE_URL,
		apiKey,
		api: "openai-completions" as const,
		streamSimple: streamGeminiOpenAICompat,
		compat: { ...MODEL_COMPAT },
		models: cloneModels(models),
	};
}

function readCachedModels(): ProviderModel[] {
	if (!existsSync(CACHE_PATH)) return [];
	try {
		const payload = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as { models?: ProviderModel[] } | ProviderModel[];
		const models = Array.isArray(payload) ? payload : payload.models || [];
		return models.filter(isProviderModel).map(cloneModel);
	} catch {
		return [];
	}
}

function writeCachedModels(models: ProviderModel[]): void {
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(CACHE_PATH, JSON.stringify({ models: cloneModels(models) }, null, 2));
}

function loadManagedModels(): ProviderModel[] | null {
	if (!existsSync(MODELS_PATH)) return null;
	try {
		const payload = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as ModelsFile;
		const models = payload.providers?.[GEMINI_PROVIDER]?.models;
		if (!Array.isArray(models)) return null;
		const valid = models.filter(isProviderModel).map(cloneModel);
		return valid.length > 0 ? valid : null;
	} catch {
		return null;
	}
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildDiscoveryUrl(apiKey: string): string {
	const url = new URL(DISCOVERY_BASE_URL);
	url.searchParams.set("key", apiKey);
	url.searchParams.set("pageSize", "1000");
	return url.toString();
}

async function fetchGeminiModels(): Promise<ProviderModel[]> {
	const apiKey = loadGeminiApiKey();
	if (!apiKey) {
		throw new Error("Gemini API key not found. Add `gemini=...` to .secure/.env or set GEMINI_API_KEY.");
	}
	const response = await fetch(buildDiscoveryUrl(apiKey), {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Gemini model catalog request failed: ${response.status} ${await response.text()}`);
	}
	const models = normalizeDiscoveredModels((await response.json()) as GeminiModelsResponse);
	if (models.length === 0) {
		throw new Error("Gemini model catalog returned no runnable text models.");
	}
	return models;
}

async function syncGeminiModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = true): Promise<ProviderModel[]> {
	const models = await fetchGeminiModels();
	writeCachedModels(models);

	const current = await readJsonFile<ModelsFile>(MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[GEMINI_PROVIDER]: createProviderConfig(models, getPersistedApiKeyReference()),
		},
	};

	await writeJsonFile(MODELS_PATH, next);
	pi.registerProvider(GEMINI_PROVIDER, createProviderConfig(models));

	if (notify) {
		ctx.ui.notify(`Synced ${models.length} Gemini models → ${MODELS_PATH}`, "success");
	}

	return models;
}

export const __test = {
	buildDiscoveryUrl,
	buildChatPayload,
	normalizeDiscoveredModels,
	parseThoughtTaggedContent,
	mapGeminiReasoningEffort,
	getGeminiReasoningBudget,
	isGemma4Model,
	isGeminiFlashLiteModel,
};

export default function (pi: ExtensionAPI) {
	const initialModels = loadManagedModels() || readCachedModels() || cloneModels(FALLBACK_MODELS);
	pi.registerProvider(GEMINI_PROVIDER, createProviderConfig(initialModels));

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = true) => {
		if (!syncPromise) {
			syncPromise = syncGeminiModels(pi, ctx, notify).finally(() => {
				syncPromise = null;
			});
		}
		return syncPromise;
	};

	const refreshHandler = async (_args: string, ctx: ExtensionContext) => {
		try {
			await runSync(ctx, true);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	};

	pi.registerCommand("gemini-refresh-models", {
		description: "Refresh Gemini models into ~/.pi/agent/models.json and the current session",
		handler: refreshHandler,
	});

	pi.registerCommand("gemini-sync", {
		description: "Alias for /gemini-refresh-models",
		handler: refreshHandler,
	});
}
