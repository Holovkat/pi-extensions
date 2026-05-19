/**
 * Inception model catalog manager for pi
 *
 * Discovers available Inception models from the public /v1/models catalog,
 * caches them, and lets users persist the catalog into ~/.pi/agent/models.json
 * so Pi can refresh its model list without depending on a static single-model
 * provider definition.
 *
 * Commands:
 * - /inception-refresh-models
 * - /inception-sync
 *
 * Auth loading order for runtime requests:
 * 1. nearest ./.secure/.env entry named `mercury-2`
 * 2. ~/.pi/.secure/.env entry named `mercury-2`
 * 3. ~/workspace/pi-extensions/.secure/.env entry named `mercury-2`
 * 4. ~/.secure/.env entry named `mercury-2`
 * 5. INCEPTION_API_KEY env var
 * 6. MERCURY_2_API_KEY env var
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const INCEPTION_PROVIDER = "inception";
const DEFAULT_BASE_URL = process.env.INCEPTION_BASE_URL || "https://api.inceptionlabs.ai/v1";
const MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const CACHE_DIR = join(process.env.HOME || "", ".pi", "agent", "cache");
const CACHE_PATH = join(CACHE_DIR, "inception-models.json");
const DISCOVERY_TIMEOUT_MS = Number(process.env.INCEPTION_MODELS_TIMEOUT_MS || 1500);
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const PROVIDER_COMPAT = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: true,
	reasoningEffortMap: {
		minimal: "instant",
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: "high",
	},
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
};

type ModelsFile = {
	providers?: Record<string, any>;
};

type InceptionModelsResponse = {
	data?: InceptionModelEntry[];
};

type InceptionModelEntry = {
	id?: string;
	name?: string;
	input_modalities?: string[];
	output_modalities?: string[];
	context_length?: number;
	max_output_length?: number;
	pricing?: {
		prompt?: string | number;
		completion?: string | number;
		image?: string | number;
		request?: string | number;
		input_cache_reads?: string | number;
		input_cache_writes?: string | number;
	};
};

const FALLBACK_MODELS: ProviderModel[] = [
	{
		id: "mercury-2",
		name: "Mercury 2",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 50_000,
	},
	{
		id: "mercury",
		name: "Mercury",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
	},
	{
		id: "mercury-edit-2",
		name: "Mercury Edit 2",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
	},
	{
		id: "mercury-coder",
		name: "Mercury Coder",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
	},
	{
		id: "mercury-edit",
		name: "Mercury Edit",
		reasoning: false,
		input: ["text"],
		cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 32_000,
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

function loadMercuryApiKey(): string {
	const candidates = [
		findSecureEnvPath(process.cwd()),
		join(process.env.HOME || "", ".pi", ".secure", ".env"),
		join(process.env.HOME || "", "workspace", "pi-extensions", ".secure", ".env"),
		join(process.env.HOME || "", ".secure", ".env"),
	];
	for (const envPath of candidates) {
		if (!envPath || !existsSync(envPath)) continue;
		const value = readKeyFromEnvFile(envPath, "mercury-2");
		if (value) return value;
	}
	return process.env.INCEPTION_API_KEY || process.env.MERCURY_2_API_KEY || "";
}

function getPersistedApiKeyReference(): string {
	return loadMercuryApiKey() || process.env.INCEPTION_API_KEY || process.env.MERCURY_2_API_KEY || "INCEPTION_API_KEY";
}

function cloneModel(model: ProviderModel): ProviderModel {
	return {
		...model,
		input: [...model.input],
		cost: { ...model.cost },
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

function createProviderConfig(models: ProviderModel[], apiKey = loadMercuryApiKey() || getPersistedApiKeyReference()) {
	const registeredModels = cloneModels(models).map((model) => ({
		...model,
		compat: { ...PROVIDER_COMPAT },
	}));
	return {
		baseUrl: DEFAULT_BASE_URL,
		apiKey,
		authHeader: true,
		api: "openai-completions" as const,
		compat: { ...PROVIDER_COMPAT },
		models: registeredModels,
	};
}

function getModelsUrl(baseUrl: string): string {
	return new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString();
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
		const models = payload.providers?.[INCEPTION_PROVIDER]?.models;
		if (!Array.isArray(models)) return null;
		const valid = models.filter(isProviderModel).map(cloneModel);
		return valid.length > 0 ? valid : null;
	} catch {
		return null;
	}
}

function numberOrNull(value: unknown): number | null {
	const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pricePerMillion(value: string | number | undefined): number {
	const numeric = numberOrNull(value);
	if (numeric == null) return 0;
	return Number((numeric * 1_000_000).toFixed(6));
}

function formatModelName(name: string | undefined, id: string): string {
	const cleaned = String(name || "").replace(/^Inception:\s*/i, "").trim();
	if (cleaned) return cleaned;
	return id
		.split(/[-_]+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function supportsReasoning(entry: InceptionModelEntry): boolean {
	return String(entry.id || "").trim().toLowerCase() === "mercury-2";
}

function buildDiscoveredModel(entry: InceptionModelEntry): ProviderModel | null {
	const id = String(entry.id || "").trim();
	if (!id) return null;

	const contextWindow = numberOrNull(entry.context_length) ?? 128_000;
	const maxTokens = numberOrNull(entry.max_output_length) ?? Math.max(4096, Math.min(65_536, Math.floor(contextWindow / 4)));
	const modalities = (entry.input_modalities || []).map((value) => String(value).toLowerCase());
	const input: ("text" | "image")[] = modalities.includes("image") ? ["text", "image"] : ["text"];

	return {
		id,
		name: formatModelName(entry.name, id),
		reasoning: supportsReasoning(entry),
		input,
		cost: {
			input: pricePerMillion(entry.pricing?.prompt),
			output: pricePerMillion(entry.pricing?.completion),
			cacheRead: pricePerMillion(entry.pricing?.input_cache_reads),
			cacheWrite: pricePerMillion(entry.pricing?.input_cache_writes),
		},
		contextWindow,
		maxTokens,
	};
}

function normalizeDiscoveredModels(payload: InceptionModelsResponse): ProviderModel[] {
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
	const managedModels = loadManagedModels();
	if (managedModels?.length) return managedModels;

	try {
		const curlArgs = ["-fsSL", getModelsUrl(baseUrl), "-H", "Accept: application/json"];
		const apiKey = loadMercuryApiKey();
		if (apiKey) {
			curlArgs.push("-H", `Authorization: Bearer ${apiKey}`);
		}
		const stdout = execFileSync("curl", curlArgs, {
			encoding: "utf8",
			timeout: DISCOVERY_TIMEOUT_MS,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const models = normalizeDiscoveredModels(JSON.parse(stdout) as InceptionModelsResponse);
		if (models.length > 0) {
			writeCachedModels(models);
			return models;
		}
	} catch {}

	const cached = readCachedModels();
	return cached.length > 0 ? cached : cloneModels(FALLBACK_MODELS);
}

function getDiscoveryHeaders(): Record<string, string> {
	const apiKey = loadMercuryApiKey();
	return apiKey
		? {
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
		  }
		: {
				Accept: "application/json",
		  };
}

async function fetchInceptionModels(baseUrl: string): Promise<ProviderModel[]> {
	const response = await fetch(getModelsUrl(baseUrl), {
		headers: getDiscoveryHeaders(),
	});
	if (!response.ok) {
		throw new Error(`Inception model catalog request failed: ${response.status} ${await response.text()}`);
	}
	return normalizeDiscoveredModels((await response.json()) as InceptionModelsResponse);
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

async function syncInceptionModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = true): Promise<ProviderModel[]> {
	const baseUrl = DEFAULT_BASE_URL;
	const models = await fetchInceptionModels(baseUrl);
	writeCachedModels(models);

	const current = await readJsonFile<ModelsFile>(MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[INCEPTION_PROVIDER]: createProviderConfig(models, getPersistedApiKeyReference()),
		},
	};

	await writeJsonFile(MODELS_PATH, next);
	pi.registerProvider(INCEPTION_PROVIDER, createProviderConfig(models));

	if (notify) {
		ctx.ui.notify(`Synced ${models.length} Inception models → ${MODELS_PATH}`, "success");
	}

	return models;
}

export default function (pi: ExtensionAPI) {
	const initialModels = loadInitialModels(DEFAULT_BASE_URL);
	pi.registerProvider(INCEPTION_PROVIDER, createProviderConfig(initialModels));

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = true) => {
		if (!syncPromise) {
			syncPromise = syncInceptionModels(pi, ctx, notify).finally(() => {
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

	pi.registerCommand("inception-refresh-models", {
		description: "Refresh Inception models from /v1/models into ~/.pi/agent/models.json and the current session",
		handler: refreshHandler,
	});

	pi.registerCommand("inception-sync", {
		description: "Alias for /inception-refresh-models",
		handler: refreshHandler,
	});
}
