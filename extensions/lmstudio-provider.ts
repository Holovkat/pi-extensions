/**
 * LM Studio Provider Extension for pi
 *
 * Registers models exposed by a local LM Studio OpenAI-compatible server.
 * Defaults to http://127.0.0.1:1234/v1.
 *
 * Environment overrides:
 * - LMSTUDIO_BASE_URL / LM_STUDIO_BASE_URL
 * - LMSTUDIO_HOST / LM_STUDIO_HOST
 * - LMSTUDIO_API_KEY / LM_STUDIO_API_KEY (optional; LM Studio usually ignores it)
 *
 * Commands:
 * - /lmstudio-refresh-models — reload available LM Studio models from /v1/models
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const LMSTUDIO_PROVIDER = "lmstudio";
const DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_COMPAT = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	maxTokensField: "max_tokens",
};
const CACHE_DIR = join(process.env.HOME || "", ".pi", "agent", "cache");
const CACHE_PATH = join(CACHE_DIR, "lmstudio-models.json");

type LMStudioModelsResponse = {
	data?: LMStudioModelEntry[];
};

type LMStudioModelEntry = {
	id?: string;
	object?: string;
	type?: string;
	owned_by?: string;
	max_context_length?: number;
	context_length?: number;
	vision?: boolean;
	architecture?: {
		type?: string;
		input_modalities?: string[];
	};
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

function resolveBaseUrl(): string {
	const explicitBaseUrl = process.env.LMSTUDIO_BASE_URL || process.env.LM_STUDIO_BASE_URL;
	const host = process.env.LMSTUDIO_HOST || process.env.LM_STUDIO_HOST;
	const raw = explicitBaseUrl || host || DEFAULT_BASE_URL;
	try {
		const url = new URL(raw);
		const path = url.pathname.replace(/\/+$/, "");
		url.pathname = !path || path === "/" ? "/v1" : path;
		return url.toString().replace(/\/+$/, "");
	} catch {
		return raw.replace(/\/+$/, "");
	}
}

function getApiKey(): string {
	return process.env.LMSTUDIO_API_KEY || process.env.LM_STUDIO_API_KEY || "lm-studio";
}

function getModelsUrl(baseUrl: string): string {
	return new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

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

function isEmbeddingModel(entry: LMStudioModelEntry): boolean {
	const haystack = [entry.id, entry.object, entry.type, entry.architecture?.type]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /embed|embedding|rerank|bge|e5|gte|nomic-embed|mxbai-embed/.test(haystack);
}

function isVisionModel(entry: LMStudioModelEntry): boolean {
	if (entry.vision) return true;
	const modalities = entry.architecture?.input_modalities?.map((value) => value.toLowerCase()) || [];
	if (modalities.includes("image")) return true;
	const haystack = [entry.id, entry.object, entry.type, entry.architecture?.type]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /(vision|vl|llava|bakllava|minicpm-v|gemma3|gemma4|qwen.?vl|moondream|vila|paligemma|mllama)/i.test(haystack);
}

function supportsReasoning(entry: LMStudioModelEntry): boolean {
	const haystack = [entry.id, entry.object, entry.type, entry.architecture?.type]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /(r1|qwq|thinking|reason)/i.test(haystack);
}

function inferContextWindow(entry: LMStudioModelEntry): number {
	const explicit = entry.max_context_length || entry.context_length;
	if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
		return explicit;
	}
	const id = String(entry.id || "").toLowerCase();
	if (id.includes("1m") || id.includes("1000k")) return 1_000_000;
	if (id.includes("200k")) return 200_000;
	if (id.includes("128k")) return 128_000;
	return 131_072;
}

function inferMaxTokens(contextWindow: number): number {
	return Math.max(4096, Math.min(65536, Math.floor(contextWindow / 4)));
}

function createProviderConfig(baseUrl: string, models: ProviderModel[]) {
	return {
		baseUrl,
		apiKey: getApiKey(),
		api: "openai-completions" as const,
		models,
	};
}

function buildDiscoveredModel(entry: LMStudioModelEntry): ProviderModel | null {
	const id = String(entry.id || "").trim();
	if (!id || isEmbeddingModel(entry)) return null;
	const contextWindow = inferContextWindow(entry);
	return {
		id,
		name: `${formatModelName(id)} (LM Studio)`,
		reasoning: supportsReasoning(entry),
		input: isVisionModel(entry) ? ["text", "image"] : ["text"],
		cost: { ...ZERO_COST },
		contextWindow,
		maxTokens: inferMaxTokens(contextWindow),
		compat: { ...DEFAULT_COMPAT },
	};
}

function readCachedModels(): ProviderModel[] {
	if (!existsSync(CACHE_PATH)) return [];
	try {
		const payload = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as { models?: ProviderModel[] } | ProviderModel[];
		const models = Array.isArray(payload) ? payload : payload.models || [];
		return models.filter(
			(model): model is ProviderModel =>
				Boolean(model) && typeof model.id === "string" && model.id.trim().length > 0 && Array.isArray(model.input),
		);
	} catch {
		return [];
	}
}

function writeCachedModels(models: ProviderModel[]): void {
	mkdirSync(CACHE_DIR, { recursive: true });
	writeFileSync(CACHE_PATH, JSON.stringify({ models }, null, 2));
}

function normalizeDiscoveredModels(payload: LMStudioModelsResponse): ProviderModel[] {
	const discovered = (payload.data || [])
		.map(buildDiscoveredModel)
		.filter((model): model is ProviderModel => Boolean(model));

	const byId = new Map<string, ProviderModel>();
	for (const model of discovered) {
		byId.set(model.id, model);
	}
	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function loadInitialModels(baseUrl: string): ProviderModel[] {
	try {
		const stdout = execFileSync(
			"curl",
			["-fsSL", getModelsUrl(baseUrl), "-H", "Accept: application/json", "-H", `Authorization: Bearer ${getApiKey()}`],
			{ encoding: "utf8", timeout: 1500 },
		);
		const models = normalizeDiscoveredModels(JSON.parse(stdout) as LMStudioModelsResponse);
		writeCachedModels(models);
		return models;
	} catch {
		return readCachedModels();
	}
}

async function fetchLMStudioModels(baseUrl: string): Promise<ProviderModel[]> {
	const modelsUrl = getModelsUrl(baseUrl);
	const response = await fetch(modelsUrl, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${getApiKey()}`,
		},
	});
	if (!response.ok) {
		throw new Error(`LM Studio model catalog request failed: ${response.status} ${await response.text()}`);
	}

	return normalizeDiscoveredModels((await response.json()) as LMStudioModelsResponse);
}

async function syncLMStudioModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = false) {
	const baseUrl = resolveBaseUrl();
	const models = await fetchLMStudioModels(baseUrl);
	pi.registerProvider(LMSTUDIO_PROVIDER, createProviderConfig(baseUrl, models));
	writeCachedModels(models);
	if (notify) {
		ctx.ui.notify(`Loaded ${models.length} LM Studio models`, "success");
	}
}

export default function (pi: ExtensionAPI) {
	const baseUrl = resolveBaseUrl();
	const initialModels = loadInitialModels(baseUrl);
	pi.registerProvider(LMSTUDIO_PROVIDER, createProviderConfig(baseUrl, initialModels));

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = false) => {
		if (!syncPromise) {
			syncPromise = syncLMStudioModels(pi, ctx, notify).finally(() => {
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

	const refreshHandler = async (_args: unknown, ctx: ExtensionContext) => {
		try {
			await runSync(ctx, true);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
		}
	};

	pi.registerCommand("lmstudio-refresh-models", {
		description: "Refresh LM Studio models from the live /v1/models catalog",
		handler: refreshHandler,
	});

	pi.registerCommand("lm-studio-refresh-models", {
		description: "Refresh LM Studio models from the live /v1/models catalog",
		handler: refreshHandler,
	});
}
