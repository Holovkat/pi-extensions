/**
 * Bailian model catalog manager for pi
 *
 * Keeps a curated Bailian Coding Plan catalog available at runtime and lets
 * users persist that catalog into ~/.pi/agent/models.json so Pi's model list
 * can be refreshed without depending on static provider-only registration.
 *
 * Commands:
 * - /bailian-refresh-models
 * - /bailian-sync
 *
 * Note: the coding-intl Bailian endpoint used here does not currently expose a
 * usable public /models catalog, so refresh syncs the curated catalog below.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const BAILIAN_PROVIDER = "bailian";
const DEFAULT_BASE_URL = process.env.BAILIAN_BASE_URL || "https://coding-intl.dashscope.aliyuncs.com/v1";
const MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

type ModelCompat = {
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	maxTokensField?: "max_completion_tokens" | "max_tokens";
};

type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
	compat?: ModelCompat;
};

type ModelsFile = {
	providers?: Record<string, any>;
};

const CURATED_MODELS: ProviderModel[] = [
	{
		id: "qwen3.5-plus",
		name: "Qwen 3.5 Plus",
		reasoning: true,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "qwen3-coder-plus",
		name: "Qwen3 Coder Plus",
		reasoning: true,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "qwen3-coder-next",
		name: "Qwen3 Coder Next",
		reasoning: true,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "qwen3-max-2026-01-23",
		name: "Qwen3 Max",
		reasoning: true,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: true,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "glm-4.7",
		name: "GLM-4.7",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131_072,
		maxTokens: 131_072,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "glm-5",
		name: "GLM-5",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 200_000,
		maxTokens: 131_072,
		compat: {
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
		},
	},
	{
		id: "MiniMax-M2.5",
		name: "MiniMax M2.5",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	},
	{
		id: "kimi-k2.5",
		name: "Kimi K2.5",
		reasoning: false,
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow: 131_072,
		maxTokens: 65_536,
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

function loadBailianApiKey(): string {
	const candidates = [
		findSecureEnvPath(process.cwd()),
		join(process.env.HOME || "", ".pi", ".secure", ".env"),
		join(process.env.HOME || "", "workspace", "pi-extensions", ".secure", ".env"),
		join(process.env.HOME || "", ".secure", ".env"),
	];
	for (const envPath of candidates) {
		if (!envPath || !existsSync(envPath)) continue;
		const value = readKeyFromEnvFile(envPath, "bailian");
		if (value) return value;
	}
	return process.env.BAILIAN_API_KEY || "";
}

function cloneModel(model: ProviderModel): ProviderModel {
	return {
		...model,
		input: [...model.input],
		cost: { ...model.cost },
		...(model.compat ? { compat: { ...model.compat } } : {}),
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

function createProviderConfig(models: ProviderModel[], apiKey = loadBailianApiKey() || "BAILIAN_API_KEY") {
	return {
		baseUrl: DEFAULT_BASE_URL,
		apiKey,
		api: "openai-completions" as const,
		models: cloneModels(models),
	};
}

function loadManagedModels(): ProviderModel[] | null {
	if (!existsSync(MODELS_PATH)) return null;
	try {
		const payload = JSON.parse(readFileSync(MODELS_PATH, "utf8")) as ModelsFile;
		const models = payload.providers?.[BAILIAN_PROVIDER]?.models;
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

async function syncBailianModels(pi: ExtensionAPI, ctx: ExtensionContext, notify = true): Promise<ProviderModel[]> {
	const models = cloneModels(CURATED_MODELS);
	const current = await readJsonFile<ModelsFile>(MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[BAILIAN_PROVIDER]: createProviderConfig(models),
		},
	};

	await writeJsonFile(MODELS_PATH, next);
	pi.registerProvider(BAILIAN_PROVIDER, createProviderConfig(models));

	if (notify) {
		ctx.ui.notify(`Synced ${models.length} Bailian models → ${MODELS_PATH}`, "success");
	}

	return models;
}

export default function (pi: ExtensionAPI) {
	const initialModels = loadManagedModels() || cloneModels(CURATED_MODELS);
	pi.registerProvider(BAILIAN_PROVIDER, createProviderConfig(initialModels));

	let syncPromise: Promise<void> | null = null;
	const runSync = async (ctx: ExtensionContext, notify = true) => {
		if (!syncPromise) {
			syncPromise = syncBailianModels(pi, ctx, notify).finally(() => {
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

	pi.registerCommand("bailian-refresh-models", {
		description: "Sync the curated Bailian model catalog into ~/.pi/agent/models.json and the current session",
		handler: refreshHandler,
	});

	pi.registerCommand("bailian-sync", {
		description: "Alias for /bailian-refresh-models",
		handler: refreshHandler,
	});
}
