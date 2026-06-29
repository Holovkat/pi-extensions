/**
 * Apfel Provider Extension for pi
 *
 * Registers Apple's local FoundationModels service as an OpenAI-compatible
 * provider via `apfel --serve`.
 *
 * Defaults to http://127.0.0.1:11434/v1, matching `apfel --serve`.
 * If you put apfel behind a different local port or proxy, set APFEL_HOST or
 * APFEL_BASE_URL before starting pi.
 *
 * Environment overrides:
 * - APFEL_BASE_URL — full OpenAI-compatible API base, e.g. http://127.0.0.1:11435/v1
 * - APFEL_HOST — root server URL, e.g. http://127.0.0.1:11435
 * - APFEL_API_KEY — optional; apfel usually ignores auth, so a dummy key is used
 * - APFEL_BIN — apfel executable path for CLI helper commands
 *
 * Commands:
 * - /apfel-status — show health from /health
 * - /apfel-info — show `apfel --model-info`
 * - /apfel-count <prompt> — preflight token count with `apfel --count-tokens`
 * - /apfel-models — list live models from /v1/models
 * - /apfel-sync — sync live models into ~/.pi/agent/models.json
 * - /apfel-use [model] — sync and select an apfel model
 */

import { execFile, execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

const execFileAsync = promisify(execFile);

const APFEL_PROVIDER = "apfel";
const APFEL_BIN = process.env.APFEL_BIN || "apfel";
const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const DEFAULT_SETTINGS_PATH = join(process.env.HOME || "", ".pi", "agent", "settings.json");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const PROVIDER_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsStrictMode: false,
	supportsUsageInStreaming: true,
	maxTokensField: "max_tokens",
};

const FALLBACK_MODELS: ManagedModel[] = [
	{
		id: "apple-foundationmodel",
		name: "Apple Foundation Model (local via apfel)",
		reasoning: false,
		input: ["text"],
		contextWindow: 4096,
		maxTokens: 1024,
		cost: { ...ZERO_COST },
	},
];

type ApfelHealth = {
	status?: string;
	model?: string;
	model_available?: boolean;
	context_window?: number;
	version?: string;
	supported_languages?: string[];
};

type ApfelModelsResponse = {
	data?: ApfelModelEntry[];
};

type ApfelModelEntry = {
	id?: string;
	object?: string;
	owned_by?: string;
	context_window?: number;
	max_tokens?: number;
	max_output_tokens?: number;
	notes?: string;
	supported_parameters?: string[];
	unsupported_parameters?: string[];
};

type ManagedModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	contextWindow: number;
	maxTokens: number;
	cost: typeof ZERO_COST;
	compat?: typeof PROVIDER_COMPAT;
};

type ModelsFile = {
	providers?: Record<string, any>;
};

type SettingsFile = Record<string, any>;

function getApiKey(): string {
	return process.env.APFEL_API_KEY || "apfel";
}

function resolveBaseUrl(): string {
	const raw = (process.env.APFEL_BASE_URL || process.env.APFEL_HOST || DEFAULT_HOST).trim() || DEFAULT_HOST;
	try {
		const url = new URL(raw);
		const path = url.pathname.replace(/\/+$/, "");
		url.pathname = !path || path === "/" ? "/v1" : path.endsWith("/v1") ? path : `${path}/v1`;
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return raw.replace(/\/+$/, "").endsWith("/v1") ? raw.replace(/\/+$/, "") : `${raw.replace(/\/+$/, "")}/v1`;
	}
}

function resolveRootUrl(baseUrl = resolveBaseUrl()): string {
	try {
		const url = new URL(baseUrl);
		url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "") || "/";
		url.search = "";
		url.hash = "";
		return url.toString().replace(/\/+$/, "");
	} catch {
		return baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
	}
}

function getModelsUrl(baseUrl = resolveBaseUrl()): string {
	return new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function getHealthUrl(baseUrl = resolveBaseUrl()): string {
	return new URL("health", `${resolveRootUrl(baseUrl).replace(/\/+$/, "")}/`).toString();
}

function formatNamePart(value: string): string {
	return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatModelName(id: string): string {
	if (id === "apple-foundationmodel") return "Apple Foundation Model";
	return id
		.split("/")
		.flatMap((part) => part.split(":"))
		.map(formatNamePart)
		.join(" / ");
}

function inferMaxTokens(entry: ApfelModelEntry, contextWindow: number): number {
	const explicit = entry.max_output_tokens || entry.max_tokens;
	if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;
	return Math.max(256, Math.min(1024, Math.floor(contextWindow / 4)));
}

function toManagedModel(entry: ApfelModelEntry): ManagedModel | null {
	const id = String(entry.id || "").trim();
	if (!id) return null;
	const contextWindow = typeof entry.context_window === "number" && entry.context_window > 0 ? entry.context_window : 4096;
	return {
		id,
		name: `${formatModelName(id)} (local via apfel)`,
		reasoning: false,
		input: ["text"],
		contextWindow,
		maxTokens: inferMaxTokens(entry, contextWindow),
		cost: { ...ZERO_COST },
		compat: { ...PROVIDER_COMPAT },
	};
}

function dedupeModels(models: ManagedModel[]): ManagedModel[] {
	const byId = new Map<string, ManagedModel>();
	for (const model of models) byId.set(model.id, model);
	return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeDiscoveredModels(payload: ApfelModelsResponse, health?: ApfelHealth): ManagedModel[] {
	const models = dedupeModels((payload.data || []).map(toManagedModel).filter((model): model is ManagedModel => Boolean(model)));
	if (models.length > 0) return models;
	if (health?.model) {
		const contextWindow = typeof health.context_window === "number" && health.context_window > 0 ? health.context_window : 4096;
		return [
			{
				id: health.model,
				name: `${formatModelName(health.model)} (local via apfel)`,
				reasoning: false,
				input: ["text"],
				contextWindow,
				maxTokens: Math.max(256, Math.min(1024, Math.floor(contextWindow / 4))),
				cost: { ...ZERO_COST },
				compat: { ...PROVIDER_COMPAT },
			},
		];
	}
	return FALLBACK_MODELS.map((model) => ({ ...model, cost: { ...ZERO_COST }, compat: { ...PROVIDER_COMPAT } }));
}

async function fetchApfelHealth(baseUrl = resolveBaseUrl()): Promise<ApfelHealth> {
	const response = await fetch(getHealthUrl(baseUrl), { headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`apfel /health failed: ${response.status} ${await response.text()}`);
	const health = (await response.json()) as ApfelHealth;
	if (health.status && health.status !== "ok") throw new Error(`apfel health status is ${health.status}`);
	return health;
}

async function fetchApfelModels(baseUrl = resolveBaseUrl()): Promise<ManagedModel[]> {
	const health = await fetchApfelHealth(baseUrl);
	const response = await fetch(getModelsUrl(baseUrl), {
		headers: { Accept: "application/json", Authorization: `Bearer ${getApiKey()}` },
	});
	if (!response.ok) throw new Error(`apfel /v1/models failed: ${response.status} ${await response.text()}`);
	return normalizeDiscoveredModels((await response.json()) as ApfelModelsResponse, health);
}

function loadInitialModels(baseUrl = resolveBaseUrl()): ManagedModel[] {
	try {
		const healthRaw = execFileSync("curl", ["-fsSL", getHealthUrl(baseUrl), "-H", "Accept: application/json"], {
			encoding: "utf8",
			timeout: 1500,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const modelsRaw = execFileSync("curl", ["-fsSL", getModelsUrl(baseUrl), "-H", "Accept: application/json", "-H", `Authorization: Bearer ${getApiKey()}`], {
			encoding: "utf8",
			timeout: 1500,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return normalizeDiscoveredModels(JSON.parse(modelsRaw) as ApfelModelsResponse, JSON.parse(healthRaw) as ApfelHealth);
	} catch {
		return FALLBACK_MODELS.map((model) => ({ ...model, cost: { ...ZERO_COST }, compat: { ...PROVIDER_COMPAT } }));
	}
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
		apiKey: getApiKey(),
		api: "openai-completions" as const,
		compat: { ...PROVIDER_COMPAT },
		models: models.map((model) => ({ ...model, compat: { ...PROVIDER_COMPAT } })),
	};
}

async function updateModelsFile(models: ManagedModel[], baseUrl: string): Promise<string> {
	const current = await readJsonFile<ModelsFile>(DEFAULT_MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[APFEL_PROVIDER]: createProviderConfig(baseUrl, models),
		},
	};
	await writeJsonFile(DEFAULT_MODELS_PATH, next);
	return DEFAULT_MODELS_PATH;
}

async function updateSettingsFile(modelId: string): Promise<string> {
	const current = await readJsonFile<SettingsFile>(DEFAULT_SETTINGS_PATH, {});
	const enabledModels = Array.isArray(current.enabledModels) ? [...current.enabledModels] : [];
	const qualified = `${APFEL_PROVIDER}/${modelId}`;
	if (!enabledModels.includes(qualified)) enabledModels.push(qualified);
	const next: SettingsFile = {
		...current,
		defaultProvider: APFEL_PROVIDER,
		defaultModel: modelId,
		enabledModels,
	};
	await writeJsonFile(DEFAULT_SETTINGS_PATH, next);
	return DEFAULT_SETTINGS_PATH;
}

async function syncModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = true): Promise<ManagedModel[]> {
	const baseUrl = resolveBaseUrl();
	const models = await fetchApfelModels(baseUrl);
	await updateModelsFile(models, baseUrl);
	pi.registerProvider(APFEL_PROVIDER, createProviderConfig(baseUrl, models));
	if (notify) ctx.ui.notify(`Synced ${models.length} apfel model(s) → ${DEFAULT_MODELS_PATH}`, "success");
	return models;
}

function formatModelSummary(models: ManagedModel[]): string[] {
	return models.map((model) => `${model.id} — ctx ${model.contextWindow} — max ${model.maxTokens} — ${model.input.join(",")}`);
}

async function resolveModelChoice(ctx: ExtensionContext, models: ManagedModel[], rawArgs: string): Promise<string | null> {
	const arg = rawArgs.trim();
	if (arg) return arg;
	if (!ctx.hasUI) return null;
	const selected = await ctx.ui.select("Select apfel model", models.map((model) => model.id));
	return selected ? String(selected).trim() : null;
}

async function setCurrentModel(pi: ExtensionAPI, ctx: ExtensionContext, modelId: string): Promise<boolean> {
	const model = ctx.modelRegistry.find(APFEL_PROVIDER, modelId) as Model | undefined;
	if (!model) return false;
	return await pi.setModel(model);
}

async function runApfelCommand(args: string[]): Promise<string> {
	const { stdout, stderr } = await execFileAsync(APFEL_BIN, args, {
		encoding: "utf8",
		timeout: 30_000,
		maxBuffer: 1024 * 1024,
	});
	return [stdout, stderr].map((value) => String(value || "").trim()).filter(Boolean).join("\n");
}

export const __test = {
	formatModelName,
	inferMaxTokens,
	normalizeDiscoveredModels,
	resolveBaseUrl,
	resolveRootUrl,
	toManagedModel,
};

export default function (pi: ExtensionAPI) {
	const baseUrl = resolveBaseUrl();
	pi.registerProvider(APFEL_PROVIDER, createProviderConfig(baseUrl, loadInitialModels(baseUrl)));

	let syncPromise: Promise<ManagedModel[]> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = false) => {
		if (!syncPromise) {
			syncPromise = syncModels(pi, ctx, notify).finally(() => {
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

	pi.registerCommand("apfel-status", {
		description: "Show apfel local Apple Foundation Model service health",
		handler: async (_args, ctx) => {
			try {
				const health = await fetchApfelHealth(resolveBaseUrl());
				ctx.ui.notify(
					[
						`apfel status: ${health.status || "unknown"}`,
						`model: ${health.model || "unknown"}`,
						`available: ${health.model_available === false ? "no" : "yes"}`,
						`context: ${health.context_window || "unknown"}`,
						`version: ${health.version || "unknown"}`,
					].join("\n"),
					"info",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("apfel-info", {
		description: "Show apfel --model-info output",
		handler: async (_args, ctx) => {
			try {
				ctx.ui.notify(await runApfelCommand(["--no-color", "--model-info"]), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("apfel-count", {
		description: "Count Apple Foundation Model tokens for a prompt: /apfel-count <prompt>",
		handler: async (args, ctx) => {
			try {
				const prompt = args.trim() || (ctx.hasUI ? String((await ctx.ui.input("Prompt to count", "")) || "").trim() : "");
				if (!prompt) {
					ctx.ui.notify("Usage: /apfel-count <prompt>", "info");
					return;
				}
				ctx.ui.notify(await runApfelCommand(["--no-color", "--count-tokens", prompt]), "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("apfel-models", {
		description: "List live apfel models from /v1/models",
		handler: async (_args, ctx) => {
			try {
				const models = await fetchApfelModels(resolveBaseUrl());
				ctx.ui.notify(`apfel models:\n\n${formatModelSummary(models).join("\n")}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("apfel-sync", {
		description: "Sync live apfel models into ~/.pi/agent/models.json and register them now",
		handler: async (_args, ctx) => {
			try {
				await runSync(ctx, true);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("apfel-use", {
		description: "Set the default Pi model from live apfel models",
		handler: async (args, ctx) => {
			try {
				let models = await fetchApfelModels(resolveBaseUrl());
				const modelId = await resolveModelChoice(ctx, models, args);
				if (!modelId) {
					ctx.ui.notify("Usage: /apfel-use <model>", "info");
					return;
				}
				if (!models.some((model) => model.id === modelId)) {
					ctx.ui.notify(`apfel model not found: ${modelId}`, "error");
					return;
				}
				models = await syncModels(pi, ctx, false);
				await updateSettingsFile(modelId);
				const activated = await setCurrentModel(pi, ctx, modelId);
				pi.setActiveTools([]);
				pi.setThinkingLevel("off");
				ctx.ui.notify(
					activated
						? `Now using apfel/${modelId} with tools disabled for the 4K local context`
						: `Saved apfel/${modelId} as default. Re-open /model if it does not appear immediately. Tools were disabled for the 4K local context.`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
