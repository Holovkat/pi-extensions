/**
 * Ollama Provider Extension for pi
 *
 * Registers local and cloud-proxied Ollama models.
 * Defaults to localhost:11434. Set OLLAMA_HOST to override.
 *
 * This provider now uses Ollama's native /api/chat semantics instead of the
 * OpenAI-compatible /v1/chat/completions path so that local Ollama controls
 * such as think=false and options.num_ctx behave according to Ollama docs.
 *
 * Commands:
 * - /ollama-refresh-models — reload installed Ollama models from /api/tags
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
	calculateCost,
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	type ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const OLLAMA_PROVIDER = "ollama";
const OLLAMA_NATIVE_API = "ollama-native-api" as const;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_CLOUD_HOST = process.env.OLLAMA_CLOUD_HOST || "https://ollama.com";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const OLLAMA_DISABLE_CLOUD_DISCOVERY = /^(1|true|yes)$/i.test(process.env.OLLAMA_DISABLE_CLOUD_DISCOVERY || "");
const OLLAMA_CATALOG_TIMEOUT_MS = Number(process.env.OLLAMA_CATALOG_TIMEOUT_MS || 1500);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE_OVERRIDE || "";
const OLLAMA_EAGER_MODEL_REFRESH = /^(1|true|yes)$/i.test(process.env.OLLAMA_EAGER_MODEL_REFRESH || "");
const OLLAMA_FETCH_SHOW_METADATA = /^(1|true|yes)$/i.test(process.env.OLLAMA_FETCH_SHOW_METADATA || "");
const OLLAMA_NUM_CTX_OVERRIDE_RAW = process.env.OLLAMA_NUM_CTX_OVERRIDE || "";
const OLLAMA_NUM_CTX_OVERRIDE = /^\d+$/.test(OLLAMA_NUM_CTX_OVERRIDE_RAW) ? Number(OLLAMA_NUM_CTX_OVERRIDE_RAW) : null;
const CACHE_DIR = join(process.env.HOME || "", ".pi", "agent", "cache");
const SHOW_CACHE_PATH = join(CACHE_DIR, "ollama-show-cache.json");
const OLLAMA_LOG_DIR = join(process.env.HOME || "", ".ollama", "logs");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type OllamaTagResponse = {
	models?: OllamaTagModel[];
};

type OllamaTagModel = {
	name?: string;
	model?: string;
	remote_model?: string | null;
	remote_host?: string | null;
	capabilities?: string[] | null;
	details?: {
		family?: string;
		families?: string[] | null;
		parameter_size?: string;
		quantization_level?: string;
		parent_model?: string;
	};
};

type OllamaShowResponse = {
	capabilities?: string[] | null;
	details?: OllamaTagModel["details"];
	parameters?: string;
	model_info?: Record<string, unknown>;
};

type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
};

type OllamaShowCache = Record<string, OllamaShowResponse>;

type OllamaNativeToolCall = {
	id?: string;
	function?: {
		index?: number;
		name?: string;
		arguments?: Record<string, unknown>;
	};
};

type OllamaNativeChatChunk = {
	message?: {
		role?: string;
		content?: string;
		thinking?: string;
		tool_calls?: OllamaNativeToolCall[];
	};
	done?: boolean;
	done_reason?: string;
	prompt_eval_count?: number;
	eval_count?: number;
};

const STATIC_MODELS: ProviderModel[] = [
	{
		id: "qwen3-coder-next:latest",
		name: "Qwen3 Coder Next (local, 235B)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 65536,
	},
	{
		id: "nemotron-3-nano:latest",
		name: "Nemotron 3 Nano (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
	},
	{
		id: "granite4:latest",
		name: "Granite 4 (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
	},
	{
		id: "qwen2.5-coder:7b",
		name: "Qwen 2.5 Coder 7B (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 32768,
		maxTokens: 16384,
	},
	{
		id: "qwen3:latest",
		name: "Qwen 3 (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
	},
	{
		id: "deepseek-v3.1:671b-cloud",
		name: "DeepSeek V3.1 671B (cloud)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 65536,
	},
	{
		id: "glm-5:cloud",
		name: "GLM-5 (cloud proxy)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 200000,
		maxTokens: 131072,
	},
	{
		id: "minimax-m2.5:cloud",
		name: "MiniMax M2.5 (cloud proxy)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1000000,
		maxTokens: 65536,
	},
	{
		id: "qwen3-vl:235b-cloud",
		name: "Qwen3 VL 235B (cloud proxy)",
		reasoning: false,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
	},
];

function formatNamePart(value: string): string {
	return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatModelName(id: string): string {
	const [base, tag] = id.split(":");
	const baseName = base
		.split("/")
		.map(formatNamePart)
		.join(" / ");
	return tag ? `${baseName} (${tag})` : baseName;
}

function hasCapability(entry: OllamaTagModel, capability: string): boolean {
	return (entry.capabilities || []).some((value) => String(value).toLowerCase() === capability.toLowerCase());
}

function isEmbeddingModel(entry: OllamaTagModel): boolean {
	const id = String(entry.model || entry.name || "").toLowerCase();
	const families = [entry.details?.family, ...(entry.details?.families || [])]
		.filter(Boolean)
		.map((value) => String(value).toLowerCase());
	return id.includes("embed") || families.some((family) => family.includes("bert") || family.includes("embed"));
}

function isVisionModel(entry: OllamaTagModel): boolean {
	if (hasCapability(entry, "vision")) return true;
	const haystack = [
		entry.model,
		entry.name,
		entry.remote_model,
		entry.details?.family,
		...(entry.details?.families || []),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /(vision|vl|llava|bakllava|minicpm-v|gemma3|qwen.?vl|moondream|vila|paligemma|mllama)/i.test(haystack);
}

function isGemmaThinkingModel(haystack: string): boolean {
	return /\bgemma(?:\s*|[-_]?)(?:4|four)\b/i.test(haystack);
}

function supportsReasoning(entry: OllamaTagModel): boolean {
	if (hasCapability(entry, "thinking")) return true;
	const haystack = [
		entry.model,
		entry.name,
		entry.remote_model,
		entry.details?.family,
		...(entry.details?.families || []),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return isGemmaThinkingModel(haystack) || /(r1|qwq|thinking|reason)/i.test(haystack);
}

function inferContextWindow(id: string): number {
	const lower = id.toLowerCase();
	if (lower.includes("minimax-m2.5")) return 1_000_000;
	if (lower.includes("glm-5")) return 200_000;
	if (lower.includes("gemma4:31b")) return 262_144;
	return 131_072;
}

function inferMaxTokens(id: string): number {
	const lower = id.toLowerCase();
	if (lower.includes("glm-5")) return 131_072;
	if (lower.includes("deepseek-v3.1") || lower.includes("qwen3-coder-next")) return 65_536;
	return 32_768;
}

function createProviderConfig(models: ProviderModel[]) {
	return {
		baseUrl: OLLAMA_HOST,
		apiKey: OLLAMA_API_KEY || "ollama",
		api: OLLAMA_NATIVE_API,
		models,
		streamSimple: streamOllamaNative,
	};
}

function getCatalogUrl(baseUrl: string): string {
	return new URL("/api/tags", baseUrl).toString();
}

function getShowUrl(baseUrl: string): string {
	return new URL("/api/show", baseUrl).toString();
}

function getChatUrl(baseUrl: string): string {
	return new URL("/api/chat", baseUrl).toString();
}

function getCatalogHeaders(apiKey?: string): Record<string, string> {
	return apiKey
		? {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
			}
		: {
				Accept: "application/json",
			};
}

function getCurlHeaderArgs(apiKey?: string): string[] {
	const args = ["-H", "Accept: application/json"];
	if (apiKey) {
		args.push("-H", `Authorization: Bearer ${apiKey}`);
	}
	return args;
}

function buildCloudProxyId(modelId: string): string {
	const trimmed = modelId.trim();
	if (!trimmed) return trimmed;
	if (trimmed.endsWith(":cloud") || trimmed.endsWith("-cloud")) return trimmed;
	const colonIndex = trimmed.lastIndexOf(":");
	if (colonIndex === -1) return `${trimmed}:cloud`;
	const base = trimmed.slice(0, colonIndex);
	const tag = trimmed.slice(colonIndex + 1);
	return `${base}:${tag}-cloud`;
}

function mergeShowMetadata(entry: OllamaTagModel, showPayload: OllamaShowResponse | null): OllamaTagModel {
	if (!showPayload) return entry;
	return {
		...entry,
		capabilities: showPayload.capabilities || entry.capabilities,
		details: {
			...entry.details,
			...showPayload.details,
		},
	};
}

function readShowMetadataCache(): OllamaShowCache {
	if (!existsSync(SHOW_CACHE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(SHOW_CACHE_PATH, "utf8")) as OllamaShowCache;
	} catch {
		return {};
	}
}

function writeShowMetadataCache(cache: OllamaShowCache): void {
	try {
		mkdirSync(CACHE_DIR, { recursive: true });
		writeFileSync(SHOW_CACHE_PATH, JSON.stringify(cache, null, 2));
	} catch {}
}

async function fetchShowMetadata(modelId: string): Promise<OllamaShowResponse | null> {
	try {
		const response = await fetch(getShowUrl(OLLAMA_HOST), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({ model: modelId }),
		});
		if (!response.ok) return null;
		const payload = (await response.json()) as OllamaShowResponse;
		return {
			capabilities: payload.capabilities || [],
			details: payload.details,
			parameters: payload.parameters,
			model_info: payload.model_info,
		};
	} catch {
		return null;
	}
}

function readServerContextLengthFromLog(filePath: string): number | null {
	if (!existsSync(filePath)) return null;
	try {
		const contents = readFileSync(filePath, "utf8");
		const envMatches = Array.from(contents.matchAll(/OLLAMA_CONTEXT_LENGTH:(\d+)/g));
		const envMatch = envMatches.at(-1);
		if (envMatch) return Number(envMatch[1]);

		const defaultMatches = Array.from(contents.matchAll(/default_num_ctx=(\d+)/g));
		const defaultMatch = defaultMatches.at(-1);
		if (defaultMatch) return Number(defaultMatch[1]);
	} catch {}
	return null;
}

function readServerContextLength(): number | null {
	const primary = readServerContextLengthFromLog(join(OLLAMA_LOG_DIR, "server.log"));
	if (primary) return primary;
	for (let i = 1; i <= 5; i++) {
		const value = readServerContextLengthFromLog(join(OLLAMA_LOG_DIR, `server-${i}.log`));
		if (value) return value;
	}
	return null;
}

function parseParameterInt(parameters: string | undefined, name: string): number | null {
	if (!parameters) return null;
	const match = parameters.match(new RegExp(`(?:^|\\n)\\s*${name}\\s+(-?\\d+)(?:\\s|$)`, "i"));
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : null;
}

function getModelInfoContextWindow(showPayload: OllamaShowResponse | null): number | null {
	if (!showPayload?.model_info) return null;
	for (const [key, value] of Object.entries(showPayload.model_info)) {
		if (!/\.context_length$/i.test(key)) continue;
		const numeric = typeof value === "number" ? value : Number(value);
		if (Number.isFinite(numeric) && numeric > 0) return numeric;
	}
	return null;
}

function resolveEffectiveContextWindow(
	id: string,
	showPayload: OllamaShowResponse | null,
	serverContextLength: number | null,
): number {
	const modelCapability = getModelInfoContextWindow(showPayload) ?? inferContextWindow(id);
	const configuredModelContext = parseParameterInt(showPayload?.parameters, "num_ctx");
	const requestedContext = configuredModelContext ?? serverContextLength ?? modelCapability;
	return Math.max(2048, Math.min(modelCapability, requestedContext));
}

function resolveMaxTokens(id: string, showPayload: OllamaShowResponse | null): number {
	const configuredNumPredict = parseParameterInt(showPayload?.parameters, "num_predict");
	if (configuredNumPredict && configuredNumPredict > 0) return configuredNumPredict;
	return inferMaxTokens(id);
}

function enrichTagModelSync(entry: OllamaTagModel, showCache: OllamaShowCache): OllamaTagModel {
	const modelId = String(entry.model || entry.name || "").trim();
	if (!modelId || isEmbeddingModel(entry)) return entry;
	return mergeShowMetadata(entry, showCache[modelId] || null);
}

async function enrichTagModel(entry: OllamaTagModel, showCache: OllamaShowCache): Promise<OllamaTagModel> {
	const modelId = String(entry.model || entry.name || "").trim();
	if (!modelId || isEmbeddingModel(entry)) return entry;
	if (!OLLAMA_FETCH_SHOW_METADATA) {
		return mergeShowMetadata(entry, showCache[modelId] || null);
	}
	const showMetadata = await fetchShowMetadata(modelId);
	if (showMetadata) {
		showCache[modelId] = showMetadata;
	}
	return mergeShowMetadata(entry, showMetadata || showCache[modelId] || null);
}

function buildDiscoveredModel(
	entry: OllamaTagModel,
	showCache: OllamaShowCache,
	serverContextLength: number | null,
): ProviderModel | null {
	const id = String(entry.model || entry.name || "").trim();
	if (!id || isEmbeddingModel(entry)) return null;
	const showPayload = showCache[id] || null;
	return {
		id,
		name: `${formatModelName(id)}${entry.remote_model ? " (cloud)" : " (local)"}`,
		reasoning: supportsReasoning(entry),
		input: isVisionModel(entry) ? ["text", "image"] : ["text"],
		cost: { ...ZERO_COST },
		contextWindow: resolveEffectiveContextWindow(id, showPayload, serverContextLength),
		maxTokens: resolveMaxTokens(id, showPayload),
	};
}

function normalizeLocalModels(
	payload: OllamaTagResponse,
	showCache: OllamaShowCache,
	serverContextLength: number | null,
): ProviderModel[] {
	return (payload.models || [])
		.map((entry) => enrichTagModelSync(entry, showCache))
		.map((entry) => buildDiscoveredModel(entry, showCache, serverContextLength))
		.filter((model): model is ProviderModel => Boolean(model));
}

async function normalizeLocalModelsAsync(
	payload: OllamaTagResponse,
	showCache: OllamaShowCache,
	serverContextLength: number | null,
): Promise<ProviderModel[]> {
	const enriched = await Promise.all((payload.models || []).map((entry) => enrichTagModel(entry, showCache)));
	return enriched
		.map((entry) => buildDiscoveredModel(entry, showCache, serverContextLength))
		.filter((model): model is ProviderModel => Boolean(model));
}

function normalizeCloudCatalogModels(
	payload: OllamaTagResponse,
	showCache: OllamaShowCache,
	serverContextLength: number | null,
): ProviderModel[] {
	return (payload.models || [])
		.map((entry) => {
			const remoteId = String(entry.model || entry.name || "").trim();
			if (!remoteId) return null;
			const cloudEntry: OllamaTagModel = {
				...entry,
				name: buildCloudProxyId(remoteId),
				model: buildCloudProxyId(remoteId),
				remote_model: remoteId,
				remote_host: OLLAMA_CLOUD_HOST,
			};
			const enriched = enrichTagModelSync(cloudEntry, showCache);
			return buildDiscoveredModel(enriched, showCache, serverContextLength);
		})
		.filter((model): model is ProviderModel => Boolean(model));
}

async function normalizeCloudCatalogModelsAsync(
	payload: OllamaTagResponse,
	showCache: OllamaShowCache,
	serverContextLength: number | null,
): Promise<ProviderModel[]> {
	const enriched = await Promise.all(
		(payload.models || []).map(async (entry) => {
			const remoteId = String(entry.model || entry.name || "").trim();
			if (!remoteId) return null;
			const cloudEntry: OllamaTagModel = {
				...entry,
				name: buildCloudProxyId(remoteId),
				model: buildCloudProxyId(remoteId),
				remote_model: remoteId,
				remote_host: OLLAMA_CLOUD_HOST,
			};
			return enrichTagModel(cloudEntry, showCache);
		}),
	);
	return enriched
		.map((entry) => (entry ? buildDiscoveredModel(entry, showCache, serverContextLength) : null))
		.filter((model): model is ProviderModel => Boolean(model));
}

function applyRuntimeContextClamp(model: ProviderModel, serverContextLength: number | null): ProviderModel {
	if (!serverContextLength) return model;
	return {
		...model,
		contextWindow: Math.min(model.contextWindow, serverContextLength),
	};
}

function mergeDiscoveredModels(
	localModels: ProviderModel[],
	cloudModels: ProviderModel[],
	serverContextLength: number | null,
): ProviderModel[] {
	const byId = new Map<string, ProviderModel>();
	for (const model of cloudModels) byId.set(model.id, model);
	for (const model of localModels) byId.set(model.id, model);
	for (const staticModel of STATIC_MODELS) {
		if (byId.has(staticModel.id)) {
			const discoveredModel = byId.get(staticModel.id)!;
			byId.set(staticModel.id, {
				...discoveredModel,
				name: staticModel.name,
				maxTokens: staticModel.maxTokens,
			});
		}
	}
	if (byId.size === 0) {
		return STATIC_MODELS.map((model) => applyRuntimeContextClamp(model, serverContextLength));
	}
	return Array.from(byId.values())
		.map((model) => applyRuntimeContextClamp(model, serverContextLength))
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchTagCatalog(url: string, headers: Record<string, string>): Promise<OllamaTagResponse> {
	const response = await fetch(url, {
		headers,
	});
	if (!response.ok) {
		throw new Error(`Ollama model catalog request failed: ${response.status} ${await response.text()}`);
	}
	return (await response.json()) as OllamaTagResponse;
}

function loadTagCatalogSync(url: string, headerArgs: string[]): OllamaTagResponse | null {
	try {
		const stdout = execFileSync("curl", ["-fsSL", url, ...headerArgs], {
			encoding: "utf8",
			timeout: OLLAMA_CATALOG_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return JSON.parse(stdout) as OllamaTagResponse;
	} catch {
		return null;
	}
}

function loadInitialModels(): ProviderModel[] {
	const showCache = readShowMetadataCache();
	const serverContextLength = readServerContextLength();
	const localPayload = loadTagCatalogSync(getCatalogUrl(OLLAMA_HOST), getCurlHeaderArgs());
	const localModels = localPayload ? normalizeLocalModels(localPayload, showCache, serverContextLength) : [];

	const cloudPayload = OLLAMA_DISABLE_CLOUD_DISCOVERY
		? null
		: loadTagCatalogSync(getCatalogUrl(OLLAMA_CLOUD_HOST), getCurlHeaderArgs(OLLAMA_API_KEY));
	const cloudModels = cloudPayload ? normalizeCloudCatalogModels(cloudPayload, showCache, serverContextLength) : [];

	const models = mergeDiscoveredModels(localModels, cloudModels, serverContextLength);
	return models.length > 0 ? models : STATIC_MODELS;
}

async function fetchOllamaModels(): Promise<ProviderModel[]> {
	const showCache = readShowMetadataCache();
	const serverContextLength = readServerContextLength();
	const localPayload = await fetchTagCatalog(getCatalogUrl(OLLAMA_HOST), getCatalogHeaders());
	const localModels = await normalizeLocalModelsAsync(localPayload, showCache, serverContextLength);

	let cloudModels: ProviderModel[] = [];
	if (!OLLAMA_DISABLE_CLOUD_DISCOVERY) {
		try {
			const cloudPayload = await fetchTagCatalog(getCatalogUrl(OLLAMA_CLOUD_HOST), getCatalogHeaders(OLLAMA_API_KEY));
			cloudModels = await normalizeCloudCatalogModelsAsync(cloudPayload, showCache, serverContextLength);
		} catch {}
	}

	writeShowMetadataCache(showCache);
	const models = mergeDiscoveredModels(localModels, cloudModels, serverContextLength);
	return models.length > 0 ? models : STATIC_MODELS;
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

function splitTextAndImages(content: string | (TextContent | ImageContent)[]): { content: string; images?: string[] } {
	if (typeof content === "string") {
		return { content };
	}

	const textParts: string[] = [];
	const images: string[] = [];
	for (const block of content) {
		if (block.type === "text") textParts.push(block.text);
		else images.push(block.data);
	}

	return {
		content: textParts.join("\n\n"),
		...(images.length > 0 ? { images } : {}),
	};
}

function assistantContentToNativeMessage(content: Array<TextContent | ThinkingContent | ToolCall>) {
	const textParts: string[] = [];
	const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: Record<string, unknown> } }> = [];

	for (const block of content) {
		if (block.type === "text") {
			textParts.push(block.text);
		} else if (block.type === "toolCall") {
			toolCalls.push({
				id: block.id,
				type: "function",
				function: {
					name: block.name,
					arguments: block.arguments,
				},
			});
		}
	}

	// Important: do NOT replay previous thinking blocks back into Ollama history.
	// Ollama/Gemma reasoning guidance says historical thoughts should be omitted
	// on subsequent turns. Re-sending them explodes prompt size and can cause
	// severe follow-up latency, tool-call churn, and apparent hangs on long sessions.
	const message: Record<string, unknown> = {
		role: "assistant",
		content: textParts.join(""),
	};
	if (toolCalls.length > 0) message.tool_calls = toolCalls;
	return message;
}

function toolResultToNativeMessage(message: ToolResultMessage) {
	const parts = splitTextAndImages(message.content);
	return {
		role: "tool",
		tool_name: message.toolName,
		content: parts.content,
		...(parts.images ? { images: parts.images } : {}),
	};
}

function contextToOllamaMessages(context: Context): Array<Record<string, unknown>> {
	const messages: Array<Record<string, unknown>> = [];

	if (context.systemPrompt) {
		messages.push({ role: "system", content: context.systemPrompt });
	}

	for (const message of context.messages) {
		if (message.role === "user") {
			const parts = splitTextAndImages(message.content);
			messages.push({
				role: "user",
				content: parts.content,
				...(parts.images ? { images: parts.images } : {}),
			});
			continue;
		}

		if (message.role === "assistant") {
			messages.push(assistantContentToNativeMessage(message.content));
			continue;
		}

		messages.push(toolResultToNativeMessage(message));
	}

	return messages;
}

function toolToOllamaTool(tool: Tool) {
	return {
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		},
	};
}

function mapReasoningToThink(model: Model<Api>, reasoning?: SimpleStreamOptions["reasoning"]): boolean | "low" | "medium" | "high" | undefined {
	const lowerId = model.id.toLowerCase();
	const isGptOss = lowerId.includes("gpt-oss");
	const isGemmaThinking = isGemmaThinkingModel(lowerId);
	const supportsThinkToggle = model.reasoning || isGemmaThinking || isGptOss;
	if (!supportsThinkToggle) return undefined;

	if (!reasoning || reasoning === "off") {
		return false;
	}

	if (isGptOss || isGemmaThinking) {
		if (reasoning === "minimal" || reasoning === "low") return "low";
		if (reasoning === "medium") return "medium";
		return "high";
	}

	return true;
}

function buildChatPayload(model: Model<Api>, context: Context, options?: SimpleStreamOptions) {
	const payload: Record<string, unknown> = {
		model: model.id,
		messages: contextToOllamaMessages(context),
		stream: true,
	};

	if (context.tools && context.tools.length > 0) {
		payload.tools = context.tools.map(toolToOllamaTool);
	}

	const think = mapReasoningToThink(model, options?.reasoning);
	if (think !== undefined) {
		payload.think = think;
	}

	const nativeOptions: Record<string, unknown> = {};
	if (typeof OLLAMA_NUM_CTX_OVERRIDE === "number" && OLLAMA_NUM_CTX_OVERRIDE > 0) {
		nativeOptions.num_ctx = OLLAMA_NUM_CTX_OVERRIDE;
	}
	if (typeof options?.maxTokens === "number" && options.maxTokens > 0) {
		nativeOptions.num_predict = options.maxTokens;
	}
	if (typeof options?.temperature === "number") {
		nativeOptions.temperature = options.temperature;
	}
	if (Object.keys(nativeOptions).length > 0) {
		payload.options = nativeOptions;
	}

	if (OLLAMA_KEEP_ALIVE) {
		payload.keep_alive = /^-?\d+(?:\.\d+)?$/.test(OLLAMA_KEEP_ALIVE) ? Number(OLLAMA_KEEP_ALIVE) : OLLAMA_KEEP_ALIVE;
	}

	return payload;
}

async function* parseNdjson(response: Response): AsyncGenerator<OllamaNativeChatChunk> {
	const reader = response.body?.getReader();
	if (!reader) return;

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (line) yield JSON.parse(line) as OllamaNativeChatChunk;
			newlineIndex = buffer.indexOf("\n");
		}
	}

	buffer += decoder.decode();
	const trailing = buffer.trim();
	if (trailing) {
		yield JSON.parse(trailing) as OllamaNativeChatChunk;
	}
}

function endTextBlock(output: AssistantMessage, stream: AssistantMessageEventStream, contentIndex: number | null) {
	if (contentIndex == null) return;
	const block = output.content[contentIndex];
	if (block?.type === "text") {
		stream.push({ type: "text_end", contentIndex, content: block.text, partial: output });
	}
}

function endThinkingBlock(output: AssistantMessage, stream: AssistantMessageEventStream, contentIndex: number | null) {
	if (contentIndex == null) return;
	const block = output.content[contentIndex];
	if (block?.type === "thinking") {
		stream.push({ type: "thinking_end", contentIndex, content: block.thinking, partial: output });
	}
}

function normalizeToolCall(toolCall: OllamaNativeToolCall, fallbackIndex: number): ToolCall | null {
	const name = toolCall.function?.name?.trim();
	if (!name) return null;
	const args = toolCall.function?.arguments;
	return {
		type: "toolCall",
		id: toolCall.id?.trim() || `call_${fallbackIndex}`,
		name,
		arguments: args && typeof args === "object" ? args : {},
	};
}

function mapDoneReason(doneReason: string | undefined, output: AssistantMessage): "stop" | "length" | "toolUse" {
	const normalized = String(doneReason || "").toLowerCase();
	if (normalized === "length" || normalized === "max_tokens" || normalized === "max_tokens_exceeded") {
		return "length";
	}
	if (output.content.some((block) => block.type === "toolCall")) {
		return "toolUse";
	}
	return "stop";
}

export function streamOllamaNative(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createEmptyOutput(model);
		let textIndex: number | null = null;
		let thinkingIndex: number | null = null;

		try {
			stream.push({ type: "start", partial: output });

			const headers: Record<string, string> = {
				Accept: "application/x-ndjson, application/json",
				"Content-Type": "application/json",
				...(options?.headers || {}),
			};
			if (options?.apiKey && options.apiKey !== "ollama" && !headers.Authorization) {
				headers.Authorization = `Bearer ${options.apiKey}`;
			}

			const response = await fetch(getChatUrl(model.baseUrl), {
				method: "POST",
				headers,
				body: JSON.stringify(buildChatPayload(model, context, options)),
				signal: options?.signal,
			});

			if (!response.ok) {
				throw new Error(`Ollama chat request failed: ${response.status} ${await response.text()}`);
			}

			for await (const chunk of parseNdjson(response)) {
				const message = chunk.message || {};
				const thinkingDelta = typeof message.thinking === "string" ? message.thinking : "";
				const textDelta = typeof message.content === "string" ? message.content : "";
				const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

				if (thinkingDelta) {
					endTextBlock(output, stream, textIndex);
					textIndex = null;
					if (thinkingIndex == null) {
						thinkingIndex = output.content.length;
						output.content.push({ type: "thinking", thinking: "" });
						stream.push({ type: "thinking_start", contentIndex: thinkingIndex, partial: output });
					}
					const block = output.content[thinkingIndex];
					if (block?.type === "thinking") {
						block.thinking += thinkingDelta;
						stream.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta: thinkingDelta, partial: output });
					}
				}

				if (textDelta) {
					endThinkingBlock(output, stream, thinkingIndex);
					thinkingIndex = null;
					if (textIndex == null) {
						textIndex = output.content.length;
						output.content.push({ type: "text", text: "" });
						stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
					}
					const block = output.content[textIndex];
					if (block?.type === "text") {
						block.text += textDelta;
						stream.push({ type: "text_delta", contentIndex: textIndex, delta: textDelta, partial: output });
					}
				}

				if (toolCalls.length > 0) {
					endTextBlock(output, stream, textIndex);
					textIndex = null;
					endThinkingBlock(output, stream, thinkingIndex);
					thinkingIndex = null;

					for (let i = 0; i < toolCalls.length; i++) {
						const normalized = normalizeToolCall(toolCalls[i], i);
						if (!normalized) continue;
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
				}

				if (chunk.done) {
					endTextBlock(output, stream, textIndex);
					textIndex = null;
					endThinkingBlock(output, stream, thinkingIndex);
					thinkingIndex = null;

					output.usage.input = chunk.prompt_eval_count || 0;
					output.usage.output = chunk.eval_count || 0;
					output.usage.cacheRead = 0;
					output.usage.cacheWrite = 0;
					output.usage.totalTokens = output.usage.input + output.usage.output;
					calculateCost(model, output.usage);
					output.stopReason = mapDoneReason(chunk.done_reason, output);
				}
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (error) {
			endTextBlock(output, stream, textIndex);
			endThinkingBlock(output, stream, thinkingIndex);
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

async function syncOllamaModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = false) {
	const models = await fetchOllamaModels();
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(models) as any);
	if (notify) {
		ctx.ui.notify(`Loaded ${models.length} Ollama models`, "info");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(loadInitialModels()) as any);

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = false) => {
		if (!syncPromise) {
			syncPromise = syncOllamaModels(pi, ctx, notify).finally(() => {
				syncPromise = null;
			});
		}
		return syncPromise;
	};

	if (OLLAMA_EAGER_MODEL_REFRESH) {
		pi.on("session_start", async (_event, ctx) => {
			try {
				await runSync(ctx, false);
			} catch {}
		});
	}

	pi.registerCommand("ollama-refresh-models", {
		description: "Refresh Ollama models from the live /api/tags catalog",
		handler: async (_args, ctx) => {
			try {
				await runSync(ctx, true);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
