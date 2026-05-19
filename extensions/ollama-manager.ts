import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

const execFileAsync = promisify(execFile);

const OLLAMA_PROVIDER = "ollama";
const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const DEFAULT_MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const DEFAULT_SETTINGS_PATH = join(process.env.HOME || "", ".pi", "agent", "settings.json");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const PROVIDER_COMPAT = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens",
};

type OllamaTagResponse = {
	models?: OllamaTagModel[];
};

type OllamaTagModel = {
	name?: string;
	model?: string;
	capabilities?: string[] | null;
	details?: {
		family?: string;
		families?: string[] | null;
		parameter_size?: string;
		quantization_level?: string;
	};
};

type ManagedModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	cost: typeof ZERO_COST;
	compat: typeof PROVIDER_COMPAT;
};

type ModelsFile = {
	providers?: Record<string, any>;
};

type SettingsFile = Record<string, any>;

function normalizeApiBaseUrl(raw: string): string {
	const trimmed = raw.trim() || DEFAULT_OLLAMA_HOST;
	try {
		const url = new URL(trimmed);
		url.pathname = "/v1";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return `${trimmed.replace(/\/+$/, "")}/v1`;
	}
}

function getTagsUrl(rawHost: string): string {
	return new URL("/api/tags", rawHost).toString();
}

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
	const haystack = [entry.model, entry.name, entry.details?.family, ...(entry.details?.families || [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /embed|embedding|rerank|bge|e5|gte|nomic-embed|mxbai-embed/.test(haystack);
}

function isVisionModel(entry: OllamaTagModel): boolean {
	if (hasCapability(entry, "vision")) return true;
	const haystack = [entry.model, entry.name, entry.details?.family, ...(entry.details?.families || [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return /(vision|vl|llava|bakllava|minicpm-v|gemma3|gemma4|qwen.?vl|moondream|vila|paligemma|mllama)/i.test(haystack);
}

function isGemmaThinkingModel(haystack: string): boolean {
	return /\bgemma(?:\s*|[-_]?)(?:4|four)\b/i.test(haystack);
}

function supportsReasoning(entry: OllamaTagModel): boolean {
	if (hasCapability(entry, "thinking")) return true;
	const haystack = [entry.model, entry.name, entry.details?.family, ...(entry.details?.families || [])]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return isGemmaThinkingModel(haystack) || /(r1|qwq|thinking|reason)/i.test(haystack);
}

function inferContextWindow(id: string): number {
	const lower = id.toLowerCase();
	if (lower.includes("1m")) return 1_000_000;
	if (lower.includes("200k")) return 200_000;
	if (lower.includes("128k")) return 128_000;
	if (lower.includes("gemma4:31b")) return 262_144;
	return 131_072;
}

function inferMaxTokens(contextWindow: number): number {
	return Math.max(4096, Math.min(65536, Math.floor(contextWindow / 4)));
}

function toManagedModel(entry: OllamaTagModel): ManagedModel | null {
	const id = String(entry.model || entry.name || "").trim();
	if (!id || isEmbeddingModel(entry)) return null;
	const contextWindow = inferContextWindow(id);
	return {
		id,
		name: `${formatModelName(id)} (Ollama)`,
		reasoning: supportsReasoning(entry),
		input: isVisionModel(entry) ? ["text", "image"] : ["text"],
		contextWindow,
		maxTokens: inferMaxTokens(contextWindow),
		cost: { ...ZERO_COST },
		compat: { ...PROVIDER_COMPAT },
	};
}

function dedupeModels(models: ManagedModel[]): ManagedModel[] {
	const byId = new Map<string, ManagedModel>();
	for (const model of models) byId.set(model.id, model);
	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOllamaModels(rawHost = DEFAULT_OLLAMA_HOST): Promise<ManagedModel[]> {
	const response = await fetch(getTagsUrl(rawHost), {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`Ollama catalog request failed: ${response.status} ${await response.text()}`);
	}
	const payload = (await response.json()) as OllamaTagResponse;
	return dedupeModels((payload.models || []).map(toManagedModel).filter((model): model is ManagedModel => Boolean(model)));
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
	if (!(await fileExists(path))) return fallback;
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

function createProviderConfig(baseUrl: string, models: ManagedModel[]) {
	return {
		baseUrl,
		apiKey: "ollama",
		api: "openai-completions" as const,
		compat: { ...PROVIDER_COMPAT },
		models: models.map((model) => ({ ...model })),
	};
}

async function updateModelsFile(models: ManagedModel[], baseUrl: string): Promise<string> {
	const current = await readJsonFile<ModelsFile>(DEFAULT_MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[OLLAMA_PROVIDER]: createProviderConfig(baseUrl, models),
		},
	};
	await writeJsonFile(DEFAULT_MODELS_PATH, next);
	return DEFAULT_MODELS_PATH;
}

async function updateSettingsFile(modelId: string): Promise<string> {
	const current = await readJsonFile<SettingsFile>(DEFAULT_SETTINGS_PATH, {});
	const enabledModels = Array.isArray(current.enabledModels) ? [...current.enabledModels] : [];
	if (!enabledModels.includes(`${OLLAMA_PROVIDER}/${modelId}`)) enabledModels.push(`${OLLAMA_PROVIDER}/${modelId}`);

	const next: SettingsFile = {
		...current,
		defaultProvider: OLLAMA_PROVIDER,
		defaultModel: modelId,
		enabledModels,
	};
	await writeJsonFile(DEFAULT_SETTINGS_PATH, next);
	return DEFAULT_SETTINGS_PATH;
}

async function applyProvider(pi: ExtensionAPI, models: ManagedModel[], baseUrl: string): Promise<void> {
	pi.registerProvider(OLLAMA_PROVIDER, createProviderConfig(baseUrl, models));
}

async function syncModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = true): Promise<ManagedModel[]> {
	const baseUrl = normalizeApiBaseUrl(DEFAULT_OLLAMA_HOST);
	const models = await fetchOllamaModels(DEFAULT_OLLAMA_HOST);
	await updateModelsFile(models, baseUrl);
	await applyProvider(pi, models, baseUrl);
	if (notify) {
		ctx.ui.notify(`Synced ${models.length} Ollama models → ${DEFAULT_MODELS_PATH}`, "success");
	}
	return models;
}

function formatModelSummary(models: ManagedModel[]): string[] {
	return models.map((model) => {
		const inputs = model.input.join(",");
		const reasoning = model.reasoning ? "reasoning" : "standard";
		return `${model.id} — ${inputs} — ${reasoning} — ctx ${model.contextWindow}`;
	});
}

async function resolveModelChoice(ctx: ExtensionContext, models: ManagedModel[], rawArgs: string): Promise<string | null> {
	const arg = rawArgs.trim();
	if (arg) return arg;
	if (!ctx.hasUI) return null;
	const selected = await ctx.ui.select("Select Ollama model", models.map((model) => model.id));
	return selected ? String(selected).trim() : null;
}

async function setCurrentModel(pi: ExtensionAPI, ctx: ExtensionContext, modelId: string): Promise<boolean> {
	const model = ctx.modelRegistry.find(OLLAMA_PROVIDER, modelId) as Model | undefined;
	if (!model) return false;
	return await pi.setModel(model);
}

async function pullModel(modelId: string): Promise<void> {
	await execFileAsync("ollama", ["pull", modelId], {
		timeout: 1000 * 60 * 30,
		maxBuffer: 1024 * 1024 * 8,
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ollama-models", {
		description: "List locally installed Ollama models",
		handler: async (_args, ctx) => {
			try {
				const models = await fetchOllamaModels(DEFAULT_OLLAMA_HOST);
				if (models.length === 0) {
					ctx.ui.notify("No local Ollama models found.", "warning");
					return;
				}
				ctx.ui.notify(`Ollama models:\n\n${formatModelSummary(models).join("\n")}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ollama-sync", {
		description: "Sync local Ollama models into ~/.pi/agent/models.json and register them now",
		handler: async (_args, ctx) => {
			try {
				await syncModels(pi, ctx, true);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ollama-use", {
		description: "Set the default Pi model from local Ollama models",
		handler: async (args, ctx) => {
			try {
				let models = await fetchOllamaModels(DEFAULT_OLLAMA_HOST);
				if (models.length === 0) {
					ctx.ui.notify("No local Ollama models found.", "warning");
					return;
				}
				const modelId = await resolveModelChoice(ctx, models, args);
				if (!modelId) {
					ctx.ui.notify("Usage: /ollama-use <model>", "info");
					return;
				}
				if (!models.some((model) => model.id === modelId)) {
					ctx.ui.notify(`Model not found locally: ${modelId}`, "error");
					return;
				}
				models = await syncModels(pi, ctx, false);
				await updateSettingsFile(modelId);
				const activated = await setCurrentModel(pi, ctx, modelId);
				ctx.ui.notify(
					activated
						? `Now using ollama/${modelId}`
						: `Saved ollama/${modelId} as default. Re-open /model if it does not appear immediately.`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("ollama-pull", {
		description: "Pull an Ollama model, sync it into Pi, and optionally make it the default",
		handler: async (args, ctx) => {
			try {
				const initial = args.trim() || (ctx.hasUI ? String((await ctx.ui.input("Ollama model to pull", "")) || "").trim() : "");
				if (!initial) {
					ctx.ui.notify("Usage: /ollama-pull <model>", "info");
					return;
				}
				ctx.ui.notify(`Pulling ${initial}...`, "info");
				await pullModel(initial);
				const models = await syncModels(pi, ctx, false);
				if (!models.some((model) => model.id === initial)) {
					ctx.ui.notify(`Pulled ${initial}, but it did not appear in /api/tags yet. Run /ollama-sync in a moment.`, "warning");
					return;
				}
				const makeDefault = ctx.hasUI ? await ctx.ui.confirm("Use as default?", `Switch Pi to ollama/${initial}?`) : false;
				if (makeDefault) {
					await updateSettingsFile(initial);
					await setCurrentModel(pi, ctx, initial);
				}
				ctx.ui.notify(
					makeDefault ? `Pulled and selected ollama/${initial}` : `Pulled and synced ollama/${initial}`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
