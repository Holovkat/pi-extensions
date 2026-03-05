/**
 * GLM Provider Extension for pi
 *
 * Registers GLM-5, GLM-4.7, and GLM-4.7-flash via Z.AI Coding Plan API.
 * Uses OpenAI-compatible chat completions endpoint.
 *
 * Set GLM_API_KEY env var or it uses the hardcoded key from Z.AI Coding Plan.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("glm", {
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		apiKey: "GLM_API_KEY",
		api: "openai-completions",

		models: [
			{
				id: "glm-5",
				name: "GLM-5",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 131072,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
				},
			},
			{
				id: "glm-4.7",
				name: "GLM-4.7",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 131072,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
				},
			},
			{
				id: "glm-4.7-flash",
				name: "GLM-4.7 Flash",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 131072,
				maxTokens: 65536,
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
				},
			},
		],
	});
}
