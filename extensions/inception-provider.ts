/**
 * Inception (Mercury-2) Provider Extension for pi
 *
 * Registers the Mercury-2 model directly against the Inception Labs
 * OpenAI-compatible API (no proxy).
 *
 * Auth loading order:
 * 1. ./ .secure/.env entry named `mercury-2`
 * 2. INCEPTION_API_KEY env var
 * 3. MERCURY_2_API_KEY env var
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
	const baseUrl = process.env.INCEPTION_BASE_URL || "https://api.inceptionlabs.ai/v1";
	const apiKey = loadMercuryApiKey();

	pi.registerProvider("inception", {
		baseUrl,
		apiKey: apiKey || "INCEPTION_API_KEY",
		authHeader: true,
		api: "openai-completions",
		models: [
			{
				id: "mercury-2",
				name: "Mercury 2",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 65536,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: true,
					reasoningEffortMap: {
						minimal: "instant",
						low: "low",
						medium: "medium",
						high: "high",
						xhigh: "high",
					},
					maxTokensField: "max_tokens",
				},
			},
		],
	});
}
