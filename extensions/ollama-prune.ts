import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const OLLAMA_PROVIDER = "ollama";
const MAX_TOOL_RESULT_CHARS = 400;

type JsonRecord = Record<string, unknown>;

type OpenAIChatPayload = {
	model?: string;
	messages?: unknown[];
	tools?: unknown[];
	[key: string]: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateText(value: string, max = MAX_TOOL_RESULT_CHARS): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}\n...[omitted ${value.length - max} chars]`;
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({ notice: "[unserializable arguments omitted]" });
	}
}

function summarizeToolCall(name: string, args: JsonRecord): JsonRecord {
	if (name === "write") {
		const content = typeof args.content === "string" ? args.content : "";
		return {
			path: args.path,
			content: `[omitted previous write content: ${content.length} chars]`,
		};
	}
	if (name === "edit") {
		const edits = Array.isArray(args.edits) ? args.edits.length : undefined;
		return {
			path: args.path,
			edits: edits !== undefined ? `[omitted previous edit payload: ${edits} edit(s)]` : "[omitted previous edit payload]",
		};
	}
	if (name === "read") {
		return {
			path: args.path,
			offset: args.offset,
			limit: args.limit,
		};
	}
	if (name === "bash") {
		const command = typeof args.command === "string" ? args.command : "";
		return {
			command: truncateText(command, 160),
			timeout: args.timeout,
		};
	}

	const summarized: JsonRecord = {};
	for (const [key, value] of Object.entries(args)) {
		if (typeof value === "string") summarized[key] = truncateText(value, 120);
		else summarized[key] = value;
	}
	return summarized;
}

function summarizeAssistantContent(message: JsonRecord): string | null {
	const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const summarizedCalls = toolCalls
		.map((call) => {
			if (!isRecord(call)) return null;
			const fn = isRecord(call.function) ? call.function : null;
			const name = typeof fn?.name === "string" ? fn.name : "tool";
			let target = "";
			if (typeof fn?.arguments === "string") {
				const parsed = safeJsonParse(fn.arguments);
				if (isRecord(parsed) && typeof parsed.path === "string") target = parsed.path;
			}
			return target ? `${name}(${target})` : name;
		})
		.filter((value): value is string => Boolean(value));
	if (summarizedCalls.length === 0) return null;
	return `Previous step completed: ${summarizedCalls.join(", ")}.`;
}

function pruneAssistantMessage(message: JsonRecord, preserveFullToolCalls: boolean): JsonRecord {
	const next = { ...message };
	delete next.reasoning;
	delete next.reasoning_details;
	delete next.thinking;
	delete next.signature;

	if (!Array.isArray(next.tool_calls) || preserveFullToolCalls) return next;

	const summary = summarizeAssistantContent(next);
	if (summary) next.content = summary;

	next.tool_calls = next.tool_calls.map((call) => {
		if (!isRecord(call)) return call;
		const fn = isRecord(call.function) ? { ...call.function } : null;
		if (!fn || typeof fn.name !== "string") return call;
		const parsed = typeof fn.arguments === "string" ? safeJsonParse(fn.arguments) : null;
		if (isRecord(parsed)) {
			fn.arguments = safeJsonStringify(summarizeToolCall(fn.name, parsed));
		}
		return { ...call, function: fn };
	});

	return next;
}

function pruneToolMessage(message: JsonRecord, preserveFullToolResult: boolean): JsonRecord {
	if (preserveFullToolResult) return message;
	const next = { ...message };
	if (typeof next.content === "string") {
		next.content = truncateText(next.content);
		return next;
	}
	if (Array.isArray(next.content)) {
		next.content = next.content.map((item) => {
			if (!isRecord(item)) return item;
			if (item.type === "text" && typeof item.text === "string") {
				return { ...item, text: truncateText(item.text) };
			}
			return item;
		});
	}
	return next;
}

function prunePayload(payload: OpenAIChatPayload): OpenAIChatPayload {
	if (!Array.isArray(payload.messages)) return payload;

	const assistantToolCallIndexes = payload.messages
		.map((message, index) => ({ message, index }))
		.filter(({ message }) => isRecord(message) && message.role === "assistant" && Array.isArray(message.tool_calls))
		.map(({ index }) => index);
	const toolIndexes = payload.messages
		.map((message, index) => ({ message, index }))
		.filter(({ message }) => isRecord(message) && message.role === "tool")
		.map(({ index }) => index);

	const lastAssistantToolCallIndex = assistantToolCallIndexes.length > 0 ? assistantToolCallIndexes.at(-1)! : -1;
	const keepFullToolResultFrom = toolIndexes.length > 0 ? Math.max(0, toolIndexes.length - 2) : 0;
	let seenToolResults = 0;

	const nextMessages = payload.messages.map((message, index) => {
		if (!isRecord(message)) return message;
		if (message.role === "assistant") {
			return pruneAssistantMessage(message, index === lastAssistantToolCallIndex);
		}
		if (message.role === "tool") {
			const preserveFullToolResult = seenToolResults >= keepFullToolResultFrom;
			seenToolResults += 1;
			return pruneToolMessage(message, preserveFullToolResult);
		}
		return message;
	});

	return {
		...payload,
		messages: nextMessages,
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== OLLAMA_PROVIDER) return;
		if (!isRecord(event.payload)) return;
		const payload = event.payload as OpenAIChatPayload;
		if (!Array.isArray(payload.messages)) return;
		return prunePayload(payload);
	});
}
