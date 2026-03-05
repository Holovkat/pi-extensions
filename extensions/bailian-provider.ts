/**
 * Bailian Coding Plan Provider Extension for pi
 *
 * Registers all Bailian Coding Plan models via DashScope API.
 * Set BAILIAN_API_KEY env var or it falls back to hardcoded key.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("bailian", {
		baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
		apiKey: "BAILIAN_API_KEY",
		api: "openai-completions",

		models: [
			{
				id: "qwen3.5-plus",
				name: "Qwen 3.5 Plus",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "qwen3-coder-plus",
				name: "Qwen3 Coder Plus",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "qwen3-coder-next",
				name: "Qwen3 Coder Next",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "qwen3-max-2026-01-23",
				name: "Qwen3 Max",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "glm-4.7",
				name: "GLM-4.7",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 131072,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "glm-5",
				name: "GLM-5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 131072,
				compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" },
			},
			{
				id: "MiniMax-M2.5",
				name: "MiniMax M2.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000000,
				maxTokens: 65536,
			},
			{
				id: "kimi-k2.5",
				name: "Kimi K2.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
			},
		],
	});
}
