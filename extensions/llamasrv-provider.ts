import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

const execFileAsync = promisify(execFile);

const LLAMASRV_PROVIDER = "llamasrv";
const DEFAULT_HOST = process.env.LLAMASRV_HOST || process.env.LLAMA_SERVER_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.LLAMASRV_PORT || process.env.LLAMA_SERVER_PORT || "48080") || 48080;
const DEFAULT_BASE_URL = resolveBaseUrl(DEFAULT_PORT);
const DEFAULT_SETTINGS_PATH = join(process.env.HOME || "", ".pi", "agent", "settings.json");
const DEFAULT_MODELS_PATH = join(process.env.HOME || "", ".pi", "agent", "models.json");
const DEFAULT_CONFIG_PATH = join(process.env.HOME || "", ".config", "llamasrv", "models.conf");
const LLAMASRV_BIN = process.env.LLAMASRV_BIN || join(process.env.HOME || "", "scripts", "llamasrv");
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	supportsStrictMode: false,
	maxTokensField: "max_tokens",
};

type LlamasrvConfigEntry = {
	alias: string;
	path: string;
	port: number;
	contextWindow: number;
	preset: string;
	extraArgs: string[];
	baseUrl: string;
};

type SettingsFile = Record<string, any>;

type ModelsFile = {
	providers?: Record<string, any>;
};

type OpenAIModelsResponse = {
	data?: Array<{
		id?: string;
		object?: string;
	}>;
};

type ProviderModel = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
	compat: typeof DEFAULT_COMPAT & Record<string, unknown>;
	baseUrl: string;
};

function resolveBaseUrl(port = DEFAULT_PORT): string {
	const explicit = process.env.LLAMASRV_BASE_URL || process.env.LLAMA_SERVER_BASE_URL;
	if (explicit) {
		try {
			const url = new URL(explicit);
			url.port = String(port);
			const path = url.pathname.replace(/\/+$/, "");
			url.pathname = !path || path === "/" ? "/v1" : path;
			url.search = "";
			url.hash = "";
			return url.toString().replace(/\/+$/, "");
		} catch {
			return explicit.replace(/\/+$/, "");
		}
	}
	return `http://${DEFAULT_HOST}:${port}/v1`;
}

function lower(value: string): string {
	return value.toLowerCase();
}

function trim(value: string): string {
	return value.trim();
}

function formatNamePart(value: string): string {
	return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatModelName(value: string): string {
	const raw = value.replace(/\.gguf$/i, "");
	return raw
		.split("/")
		.flatMap((part) => part.split(":"))
		.map(formatNamePart)
		.join(" ");
}

function inferReasoning(entry: Pick<LlamasrvConfigEntry, "alias" | "path" | "preset">): boolean {
	const haystack = lower(`${entry.alias} ${entry.path} ${entry.preset}`);
	return /(qwen|qwq|r1|thinking|reason|gemma\s*4|gemma-4)/i.test(haystack);
}

function detectCompat(entry: Pick<LlamasrvConfigEntry, "alias" | "path" | "preset">) {
	const haystack = lower(`${entry.alias} ${entry.path} ${entry.preset}`);
	if (haystack.includes("qwen")) {
		return { ...DEFAULT_COMPAT, supportsReasoningEffort: true, thinkingFormat: "qwen-chat-template" };
	}
	return { ...DEFAULT_COMPAT };
}

function inferContextWindow(entry: Pick<LlamasrvConfigEntry, "contextWindow" | "alias" | "path">): number {
	if (entry.contextWindow > 0) return entry.contextWindow;
	const haystack = lower(`${entry.alias} ${entry.path}`);
	if (haystack.includes("1m") || haystack.includes("1000k")) return 1_000_000;
	if (haystack.includes("262144") || haystack.includes("262k")) return 262_144;
	if (haystack.includes("200k")) return 200_000;
	if (haystack.includes("128k")) return 128_000;
	return 32_768;
}

function inferMaxTokens(contextWindow: number): number {
	return Math.max(4096, Math.min(65536, Math.floor(contextWindow / 4)));
}

function createProviderModel(entry: LlamasrvConfigEntry): ProviderModel {
	const contextWindow = inferContextWindow(entry);
	return {
		id: entry.alias,
		name: `${entry.alias} — ${formatModelName(entry.path)} (llamasrv)`,
		reasoning: inferReasoning(entry),
		input: ["text"],
		cost: { ...ZERO_COST },
		contextWindow,
		maxTokens: inferMaxTokens(contextWindow),
		compat: detectCompat(entry),
		baseUrl: entry.baseUrl,
	};
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

async function loadConfigEntries(configPath = DEFAULT_CONFIG_PATH): Promise<LlamasrvConfigEntry[]> {
	const raw = await readFile(configPath, "utf8");
	const entries: LlamasrvConfigEntry[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const [rawAlias = "", rawPath = "", rawPort = "", rawCtx = "", rawPreset = "", rawExtra = ""] = line.split("|");
		const alias = trim(rawAlias);
		const path = trim(rawPath);
		if (!alias || !path) continue;
		const port = Number.parseInt(trim(rawPort || String(DEFAULT_PORT)), 10);
		const contextWindow = Number.parseInt(trim(rawCtx || "32768"), 10);
		const preset = lower(trim(rawPreset || "all")) || "all";
		const extraArgs = trim(rawExtra)
			.split(/\s+/)
			.filter(Boolean);
		entries.push({
			alias,
			path,
			port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
			contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 32_768,
			preset,
			extraArgs,
			baseUrl: resolveBaseUrl(Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT),
		});
	}
	return entries.sort((a, b) => a.alias.localeCompare(b.alias));
}

function createProviderConfig(models: ProviderModel[]) {
	return {
		baseUrl: DEFAULT_BASE_URL,
		apiKey: "llamasrv",
		api: "openai-completions" as const,
		models,
	};
}

async function updateModelsFile(models: ProviderModel[]): Promise<string> {
	const current = await readJsonFile<ModelsFile>(DEFAULT_MODELS_PATH, {});
	const next: ModelsFile = {
		...current,
		providers: {
			...(current.providers || {}),
			[LLAMASRV_PROVIDER]: createProviderConfig(models),
		},
	};
	await writeJsonFile(DEFAULT_MODELS_PATH, next);
	return DEFAULT_MODELS_PATH;
}

async function updateSettingsFile(modelId: string): Promise<string> {
	const current = await readJsonFile<SettingsFile>(DEFAULT_SETTINGS_PATH, {});
	const enabledModels = Array.isArray(current.enabledModels) ? [...current.enabledModels] : [];
	const qualified = `${LLAMASRV_PROVIDER}/${modelId}`;
	if (!enabledModels.includes(qualified)) enabledModels.push(qualified);

	const next: SettingsFile = {
		...current,
		defaultProvider: LLAMASRV_PROVIDER,
		defaultModel: modelId,
		enabledModels,
	};
	await writeJsonFile(DEFAULT_SETTINGS_PATH, next);
	return DEFAULT_SETTINGS_PATH;
}

async function syncProvider(pi: ExtensionAPI, ctx?: ExtensionContext, notify = false): Promise<ProviderModel[]> {
	const entries = await loadConfigEntries();
	const models = entries.map(createProviderModel);
	await updateModelsFile(models);
	pi.registerProvider(LLAMASRV_PROVIDER, createProviderConfig(models));
	if (notify && ctx) {
		ctx.ui.notify(`Loaded ${models.length} llamasrv models`, "success");
	}
	return models;
}

function formatModelSummary(entries: LlamasrvConfigEntry[], activeAliases = new Set<string>()): string[] {
	return entries.map((entry) => {
		const marker = activeAliases.has(entry.alias) ? "*" : " ";
		return `${marker} ${entry.alias} — port ${entry.port} — ctx ${entry.contextWindow} — ${entry.path}`;
	});
}

async function fetchLiveModels(baseUrl: string): Promise<string[]> {
	const response = await fetch(new URL("models", `${baseUrl.replace(/\/+$/, "")}/`).toString(), {
		headers: { Accept: "application/json", Authorization: "Bearer llamasrv" },
	});
	if (!response.ok) {
		throw new Error(`llamasrv /v1/models failed: ${response.status} ${await response.text()}`);
	}
	const payload = (await response.json()) as OpenAIModelsResponse;
	return (payload.data || [])
		.map((item) => String(item.id || "").trim())
		.filter(Boolean);
}

async function discoverActiveAliases(entries: LlamasrvConfigEntry[]): Promise<Set<string>> {
	const byBaseUrl = new Map<string, string[]>();
	for (const entry of entries) {
		const list = byBaseUrl.get(entry.baseUrl) || [];
		list.push(entry.alias);
		byBaseUrl.set(entry.baseUrl, list);
	}
	const active = new Set<string>();
	for (const [baseUrl, aliases] of byBaseUrl.entries()) {
		try {
			const live = await fetchLiveModels(baseUrl);
			for (const id of live) {
				if (aliases.includes(id)) active.add(id);
			}
		} catch {}
	}
	return active;
}

async function resolveAliasChoice(ctx: ExtensionContext, entries: LlamasrvConfigEntry[], rawArgs: string): Promise<string | null> {
	const arg = rawArgs.trim();
	if (arg) return arg;
	if (!ctx.hasUI) return null;
	const selected = await ctx.ui.select("Select llamasrv model", entries.map((entry) => entry.alias));
	return selected ? String(selected).trim() : null;
}

function findEntry(entries: LlamasrvConfigEntry[], alias: string): LlamasrvConfigEntry | undefined {
	return entries.find((entry) => entry.alias === alias);
}

function formatExecError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const anyErr = error as Error & { stdout?: string; stderr?: string; code?: number | string; signal?: string };
	const parts = [error.message];
	if (anyErr.code !== undefined) parts.push(`code=${anyErr.code}`);
	if (anyErr.signal) parts.push(`signal=${anyErr.signal}`);
	const stderr = String(anyErr.stderr || "").trim();
	const stdout = String(anyErr.stdout || "").trim();
	if (stderr) parts.push(`stderr:\n${stderr}`);
	if (stdout) parts.push(`stdout:\n${stdout}`);
	return parts.join("\n\n");
}

async function runLlamasrv(args: string[], timeoutMs = 120_000) {
	try {
		return await execFileAsync(LLAMASRV_BIN, args, {
			timeout: timeoutMs,
			maxBuffer: 1024 * 1024 * 8,
		});
	} catch (error) {
		throw new Error(formatExecError(error));
	}
}

async function startServiceForAlias(alias: string, entry: LlamasrvConfigEntry): Promise<void> {
	await runLlamasrv([
		"--restart",
		"--background",
		"--yes",
		"--kill-port",
		"--port",
		String(entry.port),
		"--model",
		alias,
		"--",
		"--alias",
		alias,
	]);
}

async function stopServiceForPort(port: number): Promise<void> {
	await runLlamasrv(["--port", String(port), "--stop"], 30_000);
}

async function getServiceStatus(port: number): Promise<string> {
	const { stdout } = await runLlamasrv(["--port", String(port), "--status"], 30_000);
	return stdout.trim();
}

async function waitForAlias(alias: string, baseUrl: string, timeoutMs = 120_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const ids = await fetchLiveModels(baseUrl);
			if (ids.includes(alias)) return;
		} catch {}
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
	throw new Error(`Timed out waiting for llamasrv model ${alias} at ${baseUrl}`);
}

async function setCurrentModel(pi: ExtensionAPI, ctx: ExtensionContext, modelId: string): Promise<boolean> {
	const model = ctx.modelRegistry.find(LLAMASRV_PROVIDER, modelId) as Model | undefined;
	if (!model) return false;
	return await pi.setModel(model);
}

export const __test = {
	createProviderModel,
	loadConfigEntriesText(text: string) {
		return text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.map((line) => {
				const [alias, path, port, ctx, preset = "all", extra = ""] = line.split("|");
				return {
					alias,
					path,
					port: Number.parseInt(port, 10),
					contextWindow: Number.parseInt(ctx, 10),
					preset,
					extraArgs: extra.split(/\s+/).filter(Boolean),
					baseUrl: resolveBaseUrl(Number.parseInt(port, 10)),
				} satisfies LlamasrvConfigEntry;
			});
	},
	detectCompat,
	inferReasoning,
	resolveBaseUrl,
};

export default async function (pi: ExtensionAPI) {
	let syncPromise: Promise<ProviderModel[]> | null = null;
	let switchPromise: Promise<void> | null = null;
	let activeAlias: string | null = null;

	const initialEntries = await loadConfigEntries().catch(() => [] as LlamasrvConfigEntry[]);
	const initialModels = initialEntries.map(createProviderModel);
	if (initialModels.length > 0) {
		await updateModelsFile(initialModels).catch(() => undefined);
	}
	pi.registerProvider(LLAMASRV_PROVIDER, createProviderConfig(initialModels));

	const runSync = async (ctx?: ExtensionContext, notify = false) => {
		if (!syncPromise) {
			syncPromise = syncProvider(pi, ctx, notify).finally(() => {
				syncPromise = null;
			});
		}
		return await syncPromise;
	};

	const ensureServing = async (alias: string, ctx?: ExtensionContext) => {
		const entries = await loadConfigEntries();
		const entry = findEntry(entries, alias);
		if (!entry) throw new Error(`Unknown llamasrv alias: ${alias}`);

		if (activeAlias === alias) return;
		try {
			const ids = await fetchLiveModels(entry.baseUrl);
			if (ids.includes(alias)) {
				activeAlias = alias;
				return;
			}
		} catch {}

		if (switchPromise) await switchPromise;
		switchPromise = (async () => {
			ctx?.ui.notify(`Starting llamasrv/${alias}...`, "info");
			try {
				await startServiceForAlias(alias, entry);
				await waitForAlias(alias, entry.baseUrl);
				activeAlias = alias;
			} catch (error) {
				throw new Error(`Failed to start llamasrv/${alias} on ${entry.baseUrl}\n\n${formatExecError(error)}`);
			}
		})().finally(() => {
			switchPromise = null;
		});
		await switchPromise;
	};

	pi.on("session_start", async (_event, ctx) => {
		try {
			await runSync(ctx, false);
			const entries = await loadConfigEntries();
			const active = await discoverActiveAliases(entries);
			activeAlias = active.size > 0 ? Array.from(active)[0] || null : null;
		} catch {}
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const payload = event.payload as { model?: string };
		const alias = String(payload?.model || "").trim();
		if (!alias) return;
		try {
			const entries = await loadConfigEntries();
			if (!findEntry(entries, alias)) return;
			await ensureServing(alias, ctx);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			throw error;
		}
	});

	pi.registerCommand("llamasrv-models", {
		description: "List configured llamasrv models from ~/.config/llamasrv/models.conf",
		handler: async (_args, ctx) => {
			try {
				const entries = await loadConfigEntries();
				const active = await discoverActiveAliases(entries);
				if (active.size > 0) activeAlias = Array.from(active)[0] || activeAlias;
				ctx.ui.notify(`llamasrv models:\n\n${formatModelSummary(entries, active).join("\n")}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("llamasrv-refresh-models", {
		description: "Refresh llamasrv provider models from ~/.config/llamasrv/models.conf",
		handler: async (_args, ctx) => {
			try {
				await runSync(ctx, true);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("llamasrv-start", {
		description: "Start or restart llamasrv on a configured model alias",
		handler: async (args, ctx) => {
			try {
				const entries = await loadConfigEntries();
				const alias = await resolveAliasChoice(ctx, entries, args);
				if (!alias) {
					ctx.ui.notify("Usage: /llamasrv-start <alias>", "info");
					return;
				}
				const entry = findEntry(entries, alias);
				if (!entry) {
					ctx.ui.notify(`Unknown llamasrv alias: ${alias}`, "error");
					return;
				}
				await ensureServing(alias, ctx);
				ctx.ui.notify(`llamasrv/${alias} is ready on ${entry.baseUrl}`, "success");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("llamasrv-stop", {
		description: "Stop the managed llamasrv service on the default/configured port",
		handler: async (args, ctx) => {
			try {
				const entries = await loadConfigEntries();
				const alias = args.trim();
				const entry = alias ? findEntry(entries, alias) : undefined;
				const port = entry?.port || DEFAULT_PORT;
				await stopServiceForPort(port);
				if (!alias || alias === activeAlias) activeAlias = null;
				ctx.ui.notify(`Stopped llamasrv on port ${port}`, "success");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("llamasrv-status", {
		description: "Show current llamasrv service status",
		handler: async (args, ctx) => {
			try {
				const entries = await loadConfigEntries();
				const alias = args.trim();
				const entry = alias ? findEntry(entries, alias) : undefined;
				const port = entry?.port || DEFAULT_PORT;
				const status = await getServiceStatus(port);
				ctx.ui.notify(status || `No llamasrv status output for port ${port}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("llamasrv-use", {
		description: "Set Pi to a configured llamasrv model alias and start the service",
		handler: async (args, ctx) => {
			try {
				const entries = await loadConfigEntries();
				const alias = await resolveAliasChoice(ctx, entries, args);
				if (!alias) {
					ctx.ui.notify("Usage: /llamasrv-use <alias>", "info");
					return;
				}
				const entry = findEntry(entries, alias);
				if (!entry) {
					ctx.ui.notify(`Unknown llamasrv alias: ${alias}`, "error");
					return;
				}
				await runSync(ctx, false);
				await updateSettingsFile(alias);
				await ensureServing(alias, ctx);
				const activated = await setCurrentModel(pi, ctx, alias);
				ctx.ui.notify(
					activated
						? `Now using llamasrv/${alias}`
						: `Saved llamasrv/${alias} as default. Re-open /model if it does not appear immediately.`,
					"success",
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
