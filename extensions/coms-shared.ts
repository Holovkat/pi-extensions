// Shared helpers for local coms and coms-net.

export function byteLength(s: string): number {
	return Buffer.byteLength(s, "utf-8");
}

export function jsonByteLength(value: unknown): number {
	try {
		return byteLength(JSON.stringify(value));
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function takeUtf8Prefix(s: string, maxBytes: number): string {
	let out = "";
	let used = 0;
	for (const ch of s) {
		const n = byteLength(ch);
		if (used + n > maxBytes) break;
		out += ch;
		used += n;
	}
	return out;
}

export function truncateUtf8(
	s: string,
	maxBytes: number,
	label = "coms",
): { text: string; truncated: boolean } {
	if (byteLength(s) <= maxBytes) return { text: s, truncated: false };
	const suffix = `\n\n[${label}: response truncated to ${maxBytes} bytes]`;
	const budget = maxBytes - byteLength(suffix);
	if (budget <= 0) {
		return { text: takeUtf8Prefix(suffix, Math.max(0, maxBytes)), truncated: true };
	}
	return { text: takeUtf8Prefix(s, budget) + suffix, truncated: true };
}

export function sanitizePathSegment(value: string, fallback = "default"): string {
	const trimmed = value.trim();
	if (!trimmed) return `%00${encodeURIComponent(fallback)}`;
	if (trimmed === ".") return "%2E";
	if (trimmed === "..") return "%2E%2E";
	return encodeURIComponent(trimmed).slice(0, 160);
}

function assistantTextFromMessage(m: any): string {
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) {
		return m.content
			.filter((b: any) => b && b.type === "text")
			.map((b: any) => b.text)
			.join("\n");
	}
	return "";
}

export function latestAssistantTextAfterBoundary(branch: any[], triggerLeafId?: string | null): string {
	let lastAssistantText = "";
	let afterBoundary = triggerLeafId == null;
	for (const entry of branch) {
		if (!afterBoundary) {
			if (entry?.id === triggerLeafId) afterBoundary = true;
			continue;
		}
		if (entry?.type === "message" && entry?.message?.role === "assistant") {
			lastAssistantText = assistantTextFromMessage(entry.message);
		}
	}
	return lastAssistantText;
}

export const __test = {
	byteLength,
	jsonByteLength,
	truncateUtf8,
	sanitizePathSegment,
	latestAssistantTextAfterBoundary,
};
