/**
 * Ollama Provider Extension for pi
 *
 * Registers local and cloud-proxied Ollama models.
 * Defaults to localhost:11434. Set OLLAMA_HOST to override.
 *
 * Commands:
 * - /ollama-refresh-models — reload installed Ollama models from /api/tags
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const OLLAMA_PROVIDER = "ollama";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_CLOUD_HOST = process.env.OLLAMA_CLOUD_HOST || "https://ollama.com";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const OLLAMA_DISABLE_CLOUD_DISCOVERY = /^(1|true|yes)$/i.test(process.env.OLLAMA_DISABLE_CLOUD_DISCOVERY || "");
const OLLAMA_CATALOG_TIMEOUT_MS = Number(process.env.OLLAMA_CATALOG_TIMEOUT_MS || 1500);
const CACHE_DIR = join(process.env.HOME || "", ".pi", "agent", "cache");
const SHOW_CACHE_PATH = join(CACHE_DIR, "ollama-show-cache.json");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	reasoningEffortMap: {
		minimal: "low",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "high",
	},
	supportsStrictMode: false,
	maxTokensField: "max_tokens",
};

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
};

type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
	compat: typeof DEFAULT_COMPAT;
};

type OllamaShowCache = Record<string, OllamaShowResponse>;

const STATIC_MODELS: ProviderModel[] = [
	{
		id: "qwen3-coder-next:latest",
		name: "Qwen3 Coder Next (local, 235B)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 65536,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "nemotron-3-nano:latest",
		name: "Nemotron 3 Nano (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "granite4:latest",
		name: "Granite 4 (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "qwen2.5-coder:7b",
		name: "Qwen 2.5 Coder 7B (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 32768,
		maxTokens: 16384,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "qwen3:latest",
		name: "Qwen 3 (local)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "deepseek-v3.1:671b-cloud",
		name: "DeepSeek V3.1 671B (cloud)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 65536,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "glm-5:cloud",
		name: "GLM-5 (cloud proxy)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 200000,
		maxTokens: 131072,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "minimax-m2.5:cloud",
		name: "MiniMax M2.5 (cloud proxy)",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1000000,
		maxTokens: 65536,
		compat: { ...DEFAULT_COMPAT },
	},
	{
		id: "qwen3-vl:235b-cloud",
		name: "Qwen3 VL 235B (cloud proxy)",
		reasoning: false,
		input: ["text", "image"],
		cost: { ...ZERO_COST },
		contextWindow: 131072,
		maxTokens: 32768,
		compat: { ...DEFAULT_COMPAT },
	},
];

function formatNamePart(value: string): string {
	return value
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
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
	return /(r1|qwq|thinking|reason)/i.test(haystack);
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

function resolveOllamaApiBaseUrl(rawBaseUrl: string): string {
	try {
		const url = new URL(rawBaseUrl);
		const path = url.pathname.replace(/\/+$/, "");
		if (!path || path === "/") {
			url.pathname = "/v1";
		} else if (!path.endsWith("/v1")) {
			url.pathname = `${path}/v1`;
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		const trimmed = rawBaseUrl.replace(/\/+$/, "");
		return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
	}
}

function createProviderConfig(models: ProviderModel[]) {
	return {
		baseUrl: resolveOllamaApiBaseUrl(OLLAMA_HOST),
		apiKey: "ollama",
		api: "openai-completions" as const,
		models,
	};
}

function getCatalogUrl(baseUrl: string): string {
	return new URL("/api/tags", baseUrl).toString();
}

function getShowUrl(baseUrl: string): string {
	return new URL("/api/show", baseUrl).toString();
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
		};
	} catch {
		return null;
	}
}

function enrichTagModelSync(entry: OllamaTagModel, showCache: OllamaShowCache): OllamaTagModel {
	const modelId = String(entry.model || entry.name || "").trim();
	if (!modelId || isEmbeddingModel(entry)) return entry;
	return mergeShowMetadata(entry, showCache[modelId] || null);
}

async function enrichTagModel(entry: OllamaTagModel, showCache: OllamaShowCache): Promise<OllamaTagModel> {
	const modelId = String(entry.model || entry.name || "").trim();
	if (!modelId || isEmbeddingModel(entry)) return entry;
	const showMetadata = await fetchShowMetadata(modelId);
	if (showMetadata) {
		showCache[modelId] = showMetadata;
	}
	return mergeShowMetadata(entry, showMetadata || showCache[modelId] || null);
}

function buildDiscoveredModel(entry: OllamaTagModel): ProviderModel | null {
	const id = String(entry.model || entry.name || "").trim();
	if (!id || isEmbeddingModel(entry)) return null;
	return {
		id,
		name: `${formatModelName(id)}${entry.remote_model ? " (cloud)" : " (local)"}`,
		reasoning: supportsReasoning(entry),
		input: isVisionModel(entry) ? ["text", "image"] : ["text"],
		cost: { ...ZERO_COST },
		contextWindow: inferContextWindow(id),
		maxTokens: inferMaxTokens(id),
		compat: { ...DEFAULT_COMPAT },
	};
}

function normalizeLocalModels(payload: OllamaTagResponse, showCache: OllamaShowCache): ProviderModel[] {
	return (payload.models || [])
		.map((entry) => enrichTagModelSync(entry, showCache))
		.map(buildDiscoveredModel)
		.filter((model): model is ProviderModel => Boolean(model));
}

async function normalizeLocalModelsAsync(payload: OllamaTagResponse, showCache: OllamaShowCache): Promise<ProviderModel[]> {
	const enriched = await Promise.all((payload.models || []).map((entry) => enrichTagModel(entry, showCache)));
	return enriched.map(buildDiscoveredModel).filter((model): model is ProviderModel => Boolean(model));
}

function normalizeCloudCatalogModels(payload: OllamaTagResponse, showCache: OllamaShowCache): ProviderModel[] {
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
			return buildDiscoveredModel(enrichTagModelSync(cloudEntry, showCache));
		})
		.filter((model): model is ProviderModel => Boolean(model));
}

async function normalizeCloudCatalogModelsAsync(payload: OllamaTagResponse, showCache: OllamaShowCache): Promise<ProviderModel[]> {
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
	return enriched.map((entry) => (entry ? buildDiscoveredModel(entry) : null)).filter((model): model is ProviderModel => Boolean(model));
}

function mergeDiscoveredModels(localModels: ProviderModel[], cloudModels: ProviderModel[]): ProviderModel[] {
	const byId = new Map<string, ProviderModel>();
	for (const model of cloudModels) byId.set(model.id, model);
	for (const model of localModels) byId.set(model.id, model);
	for (const staticModel of STATIC_MODELS) {
		if (byId.has(staticModel.id)) {
			const discoveredModel = byId.get(staticModel.id)!;
			byId.set(staticModel.id, {
				...discoveredModel,
				name: staticModel.name,
				contextWindow: staticModel.contextWindow,
				maxTokens: staticModel.maxTokens,
			});
		}
	}
	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
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
	const localPayload = loadTagCatalogSync(getCatalogUrl(OLLAMA_HOST), getCurlHeaderArgs());
	const localModels = localPayload ? normalizeLocalModels(localPayload, showCache) : [];

	const cloudPayload = OLLAMA_DISABLE_CLOUD_DISCOVERY
		? null
		: loadTagCatalogSync(getCatalogUrl(OLLAMA_CLOUD_HOST), getCurlHeaderArgs(OLLAMA_API_KEY));
	const cloudModels = cloudPayload ? normalizeCloudCatalogModels(cloudPayload, showCache) : [];

	const models = mergeDiscoveredModels(localModels, cloudModels);
	return models.length > 0 ? models : STATIC_MODELS;
}

async function fetchOllamaModels(): Promise<ProviderModel[]> {
	const showCache = readShowMetadataCache();
	const localPayload = await fetchTagCatalog(getCatalogUrl(OLLAMA_HOST), getCatalogHeaders());
	const localModels = await normalizeLocalModelsAsync(localPayload, showCache);

	let cloudModels: ProviderModel[] = [];
	if (!OLLAMA_DISABLE_CLOUD_DISCOVERY) {
		try {
			const cloudPayload = await fetchTagCatalog(getCatalogUrl(OLLAMA_CLOUD_HOST), getCatalogHeaders(OLLAMA_API_KEY));
			cloudModels = await normalizeCloudCatalogModelsAsync(cloudPayload, showCache);
		} catch {}
	}

	writeShowMetadataCache(showCache);
	const models = mergeDiscoveredModels(localModels, cloudModels);
	return models.length > 0 ? models : STATIC_MODELS;
}

async function syncOllamaModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = false) {
	const models = await fetchOllamaModels();
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(models));
	if (notify) {
		ctx.ui.notify(`Loaded ${models.length} Ollama models`, "success");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(loadInitialModels()));

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = false) => {
		if (!syncPromise) {
			syncPromise = syncOllamaModels(pi, ctx, notify).finally(() => {
				syncPromise = null;
			});
		}
		return syncPromise;
	};

	pi.on("session_start", async (_event, ctx) => {
		try {
			await runSync(ctx, false);
		} catch {}
	});

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
