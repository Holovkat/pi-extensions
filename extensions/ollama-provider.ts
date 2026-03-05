/**
 * Ollama Provider Extension for pi
 *
 * Registers local and cloud-proxied Ollama models.
 * Defaults to localhost:11434. Set OLLAMA_HOST to override.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const host = process.env.OLLAMA_HOST || "http://localhost:11434";

	pi.registerProvider("ollama", {
		baseUrl: host,
		apiKey: "ollama",
		api: "anthropic-messages",

		models: [
			{
				id: "qwen3-coder-next:latest",
				name: "Qwen3 Coder Next (local, 235B)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "nemotron-3-nano:latest",
				name: "Nemotron 3 Nano (local)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 32768,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "granite4:latest",
				name: "Granite 4 (local)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 32768,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "qwen2.5-coder:7b",
				name: "Qwen 2.5 Coder 7B (local)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 32768,
				maxTokens: 16384,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "qwen3:latest",
				name: "Qwen 3 (local)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 32768,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "deepseek-v3.1:671b-cloud",
				name: "DeepSeek V3.1 671B (cloud)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "glm-5:cloud",
				name: "GLM-5 (cloud proxy)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 131072,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "minimax-m2.5:cloud",
				name: "MiniMax M2.5 (cloud proxy)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "qwen3-vl:235b-cloud",
				name: "Qwen3 VL 235B (cloud proxy)",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 32768,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
		],
	});
}
