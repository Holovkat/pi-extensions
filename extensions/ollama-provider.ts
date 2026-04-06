/**
 * Ollama Provider Extension for pi
 *
 * Registers local and cloud-proxied Ollama models.
 * Defaults to localhost:11434. Set OLLAMA_HOST to override.
 *
 * Commands:
 * - /ollama-refresh-models — reload installed Ollama models from /api/tags
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const OLLAMA_PROVIDER = "ollama";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_COMPAT = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	maxTokensField: "max_tokens",
};

type OllamaTagResponse = {
	models?: OllamaTagModel[];
};

type OllamaTagModel = {
	name?: string;
	model?: string;
	remote_model?: string;
	remote_host?: string;
	details?: {
		family?: string;
		families?: string[] | null;
		parameter_size?: string;
		quantization_level?: string;
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

function isEmbeddingModel(entry: OllamaTagModel): boolean {
	const id = String(entry.model || entry.name || "").toLowerCase();
	const families = [entry.details?.family, ...(entry.details?.families || [])]
		.filter(Boolean)
		.map((value) => String(value).toLowerCase());
	return id.includes("embed") || families.some((family) => family.includes("bert") || family.includes("embed"));
}

function isVisionModel(entry: OllamaTagModel): boolean {
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
	return /(vision|vl|llava|bakllava|minicpm-v|gemma3|gemma4|qwen.?vl|moondream|vila|paligemma|mllama)/i.test(haystack);
}

function supportsReasoning(entry: OllamaTagModel): boolean {
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
		apiKey: "ollama",
		api: "anthropic-messages" as const,
		models,
	};
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

async function fetchOllamaModels(): Promise<ProviderModel[]> {
	const response = await fetch(new URL("/api/tags", OLLAMA_HOST), {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Ollama model catalog request failed: ${response.status} ${await response.text()}`);
	}

	const payload = (await response.json()) as OllamaTagResponse;
	const discovered = (payload.models || [])
		.map(buildDiscoveredModel)
		.filter((model): model is ProviderModel => Boolean(model));

	const byId = new Map<string, ProviderModel>();
	for (const model of discovered) byId.set(model.id, model);
	for (const staticModel of STATIC_MODELS) {
		if (byId.has(staticModel.id)) {
			const discoveredModel = byId.get(staticModel.id)!;
			byId.set(staticModel.id, { ...discoveredModel, name: staticModel.name, contextWindow: staticModel.contextWindow, maxTokens: staticModel.maxTokens });
		}
	}

	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function syncOllamaModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = false) {
	const models = await fetchOllamaModels();
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(models));
	if (notify) {
		ctx.ui.notify(`Loaded ${models.length} Ollama models`, "success");
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(STATIC_MODELS));

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
