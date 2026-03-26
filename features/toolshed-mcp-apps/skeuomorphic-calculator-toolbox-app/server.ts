import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { html } from "./mcp-app.tsx";
import { helloHtml } from "./hello-app.tsx";

type Operator = "+" | "-" | "×" | "÷" | null;

type HistoryEntry = {
  expression: string;
  result: string;
  timestamp: string;
};

type StepEntry = {
  key: string;
  label: string;
  display: string;
  expression: string;
  timestamp: string;
};

type CalculatorSession = {
  sessionId: string;
  display: string;
  expression: string;
  panelLabel: string | null;
  panelMessage: string | null;
  accumulator: number | null;
  pendingOperator: Operator;
  waitingForOperand: boolean;
  history: HistoryEntry[];
  steps: StepEntry[];
  updatedAt: string;
};

const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const resourceUri = "ui://widget/toolshed-analog-math-console-v4.html";
const helloWorldResourceUri = "ui://widget/toolshed-hello-world-v1.html";
const DEFAULT_WIDGET_DOMAIN = "https://advanced-petra-uncorrelatively.ngrok-free.dev";
const toolName = "open_skeuomorphic_calculator_toolbox_app";
const chatgptToolName = "open_toolshed_analog_math_console";
const helloWorldToolName = "open_toolshed_hello_world_demo";
const helloWorldCalculatorToolName = "open_toolshed_hello_world_calculator_panel";
const sessions = new Map<string, CalculatorSession>();

function getWidgetDomain() {
  return String(
    process.env.OPENAI_WIDGET_DOMAIN
      || process.env.TOOLSHED_PUBLIC_BASE_URL
      || process.env.PUBLIC_BASE_URL
      || DEFAULT_WIDGET_DOMAIN,
  ).trim().replace(/\/+$/, "") || DEFAULT_WIDGET_DOMAIN;
}

function buildWidgetMeta(description: string) {
  const widgetDomain = getWidgetDomain();
  return {
    ui: {
      prefersBorder: true,
    },
    "openai/widgetDescription": description,
    "openai/widgetPrefersBorder": true,
    "openai/widgetDomain": widgetDomain,
    "openai/widgetCSP": {
      connect_domains: [widgetDomain],
      resource_domains: [widgetDomain],
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function createSession(sessionId: string = randomUUID()): CalculatorSession {
  return {
    sessionId,
    display: "0",
    expression: "",
    panelLabel: null,
    panelMessage: null,
    accumulator: null,
    pendingOperator: null,
    waitingForOperand: false,
    history: [],
    steps: [],
    updatedAt: nowIso(),
  };
}

function resetWorkingState(session: CalculatorSession): CalculatorSession {
  session.display = "0";
  session.expression = "";
  session.accumulator = null;
  session.pendingOperator = null;
  session.waitingForOperand = false;
  return session;
}

function getSession(sessionId?: string | null): CalculatorSession {
  const key = String(sessionId || "").trim() || randomUUID();
  const existing = sessions.get(key);
  if (existing) return existing;
  const created = createSession(key);
  sessions.set(key, created);
  return created;
}

function persist(session: CalculatorSession): CalculatorSession {
  session.updatedAt = nowIso();
  sessions.set(session.sessionId, session);
  return session;
}

function normalizeHistoryEntry(value: any): HistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const expression = String(value.expression || "").trim();
  const result = String(value.result || "").trim();
  if (!expression || !result) return null;
  return {
    expression,
    result,
    timestamp: String(value.timestamp || nowIso()),
  };
}

function normalizeStepEntry(value: any): StepEntry | null {
  if (!value || typeof value !== "object") return null;
  const key = String(value.key || "").trim();
  const label = String(value.label || "").trim();
  const display = String(value.display || "").trim();
  if (!key && !label && !display) return null;
  return {
    key,
    label,
    display,
    expression: String(value.expression || "").trim(),
    timestamp: String(value.timestamp || nowIso()),
  };
}

function hydrateSession(session: CalculatorSession, value: any): CalculatorSession {
  if (!value || typeof value !== "object") return session;
  if (Object.prototype.hasOwnProperty.call(value, "display")) {
    session.display = String(value.display ?? "0").trim() || "0";
  }
  if (Object.prototype.hasOwnProperty.call(value, "expression")) {
    session.expression = value.expression ? String(value.expression) : "";
  }
  if (Object.prototype.hasOwnProperty.call(value, "panelLabel")) {
    session.panelLabel = value.panelLabel ? String(value.panelLabel) : null;
  }
  if (Object.prototype.hasOwnProperty.call(value, "panelMessage")) {
    session.panelMessage = value.panelMessage ? String(value.panelMessage) : null;
  }
  if (Object.prototype.hasOwnProperty.call(value, "accumulator")) {
    session.accumulator = Number.isFinite(Number(value.accumulator)) ? Number(value.accumulator) : null;
  }
  if (["+", "-", "×", "÷", null].includes(value.pendingOperator)) {
    session.pendingOperator = value.pendingOperator as Operator;
  }
  if (Object.prototype.hasOwnProperty.call(value, "waitingForOperand")) {
    session.waitingForOperand = Boolean(value.waitingForOperand);
  }
  if (Array.isArray(value.history)) {
    session.history = value.history.map(normalizeHistoryEntry).filter(Boolean) as HistoryEntry[];
  }
  if (Array.isArray(value.steps)) {
    session.steps = value.steps.map(normalizeStepEntry).filter(Boolean) as StepEntry[];
  }
  if (typeof value.updatedAt === "string" && value.updatedAt.trim()) {
    session.updatedAt = value.updatedAt;
  }
  return session;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "Error";
  const normalized = Number(value.toFixed(12));
  return String(normalized);
}

function applyOperator(left: number, right: number, operator: Exclude<Operator, null>): number {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "×":
      return left * right;
    case "÷":
      return right === 0 ? Number.NaN : left / right;
    default:
      return right;
  }
}

function getVisibleExpression(session: CalculatorSession): string {
  if (session.pendingOperator && session.accumulator !== null) {
    return session.waitingForOperand
      ? `${formatNumber(session.accumulator)} ${session.pendingOperator}`
      : `${formatNumber(session.accumulator)} ${session.pendingOperator} ${session.display}`;
  }
  return session.expression;
}

function snapshot(session: CalculatorSession) {
  const visibleExpression = getVisibleExpression(session);
  return {
    sessionId: session.sessionId,
    display: session.display,
    expression: visibleExpression,
    panelLabel: session.panelLabel,
    panelMessage: session.panelMessage,
    history: session.history,
    steps: session.steps,
    updatedAt: session.updatedAt,
    hasHistory: session.history.length > 0,
    hasSteps: session.steps.length > 0,
    lastResult: session.history[0]?.result || session.display,
    lastExpression: session.history[0]?.expression || visibleExpression || session.display,
    lastStep: session.steps[0] || null,
  };
}

function buildWidgetState(session: CalculatorSession) {
  return {
    widgetKind: "toolshed-analog-math-console",
    session: snapshot(session),
  };
}

function buildHelloWorldState(message?: string) {
  return {
    widgetKind: "toolshed-hello-world",
    message: String(message || "Hello world from Toolshed. This widget is coming from your MCP server."),
    openedAt: nowIso(),
    source: "toolshed-skeuomorphic-calculator-toolbox-app",
  };
}

function setPanelContent(session: CalculatorSession, label?: string | null, message?: string | null) {
  session.panelLabel = label ? String(label) : null;
  session.panelMessage = message ? String(message) : null;
  return session;
}

function recordStep(session: CalculatorSession, key: string, label: string) {
  session.steps = [{
    key,
    label,
    display: session.display,
    expression: getVisibleExpression(session),
    timestamp: nowIso(),
  }, ...session.steps].slice(0, 24);
}

function formatHistory(session: CalculatorSession, limit: number = 8): string {
  const history = Array.isArray(session.history) ? session.history.slice(0, limit) : [];
  if (history.length === 0) return "No completed calculations yet.";
  return history.map((entry) => `- ${entry.expression} = ${entry.result}`).join("\n");
}

function formatSteps(session: CalculatorSession, limit: number = 12): string {
  const steps = Array.isArray(session.steps) ? session.steps.slice(0, limit) : [];
  if (steps.length === 0) return "No step memory yet.";
  return steps.map((entry) =>
    `- ${entry.label || entry.key}${entry.expression ? ` | ${entry.expression}` : ""} | display ${entry.display}`
  ).join("\n");
}

function buildAnswer(question: string, session: CalculatorSession): string {
  const normalized = String(question || "").trim().toLowerCase();
  const latest = session.history[0];
  const asksForSteps = /(step|steps|log)/.test(normalized);
  const asksForMemory = /\bmemory\b/.test(normalized);
  const asksForHistoryList = (/(list|show|all|full)/.test(normalized) && /(calculation|calculations|history|result|results|memory)/.test(normalized))
    || /(memory values|memory value|calc memory|calculator memory|what(?:'s| is) in (?:the )?(?:calculator )?memory)/.test(normalized)
    || (asksForMemory && !asksForSteps);
  const asksForStepList = (/(list|show|all|full)/.test(normalized) && asksForSteps)
    || /(step memory|memory steps)/.test(normalized);

  if (!normalized) {
    return latest
      ? `Current display: ${session.display}. Most recent calculation: ${latest.expression} = ${latest.result}.`
      : `Current display: ${session.display}. No completed calculations yet in this session.`;
  }

  if (asksForHistoryList) {
    return [
      "Calculations in calculator history:",
      formatHistory(session),
      `Current display: ${session.display}.`,
    ].join("\n");
  }

  if (asksForStepList) {
    return [
      "Calculator step memory:",
      formatSteps(session),
      `Current display: ${session.display}.`,
    ].join("\n");
  }

  if (asksForSteps) {
    const latestStep = session.steps[0];
    return latestStep
      ? `Latest calculator step: ${latestStep.label || latestStep.key}. Display: ${latestStep.display}.${latestStep.expression ? ` Expression: ${latestStep.expression}.` : ""}`
      : `There is no step memory yet. Current display: ${session.display}.`;
  }

  if (/(history|recent|latest|last calculation|last result)/.test(normalized)) {
    return latest
      ? `Most recent calculation: ${latest.expression} = ${latest.result}. Current display: ${session.display}.`
      : `There is no completed calculation history yet. Current display: ${session.display}.`;
  }

  if (/(current|display|screen|value|shown)/.test(normalized)) {
    return `The calculator is currently showing ${session.display}.`;
  }

  return latest
    ? `Current display: ${session.display}. Most recent calculation: ${latest.expression} = ${latest.result}.`
    : `Current display: ${session.display}. No completed calculations yet in this session.`;
}

function pressDigit(session: CalculatorSession, key: string) {
  if (session.waitingForOperand) {
    session.display = key === "." ? "0." : key;
    session.waitingForOperand = false;
    return;
  }

  if (key === ".") {
    if (!session.display.includes(".")) session.display += ".";
    return;
  }

  session.display = session.display === "0" ? key : `${session.display}${key}`;
}

function pressKey(session: CalculatorSession, key: string) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return persist(session);

  if (/^[0-9]$/.test(trimmed) || trimmed === ".") {
    pressDigit(session, trimmed);
    recordStep(session, trimmed, `Entered ${trimmed}`);
    return persist(session);
  }

  if (trimmed === "C") {
    resetWorkingState(session);
    recordStep(session, trimmed, "Cleared current calculation");
    return persist(session);
  }

  if (trimmed === "⌫") {
    if (!session.waitingForOperand) {
      session.display = session.display.length > 1 ? session.display.slice(0, -1) : "0";
    }
    recordStep(session, trimmed, "Backspaced current entry");
    return persist(session);
  }

  if (["+", "-", "×", "÷"].includes(trimmed)) {
    const operator = trimmed as Exclude<Operator, null>;
    if (session.pendingOperator && !session.waitingForOperand) {
      const left = session.accumulator ?? 0;
      const right = toNumber(session.display);
      const expression = `${formatNumber(left)} ${session.pendingOperator} ${formatNumber(right)}`;
      const result = applyOperator(left, right, session.pendingOperator);
      session.display = formatNumber(result);
      session.accumulator = Number.isFinite(result) ? result : null;
      session.expression = expression;
      recordStep(session, trimmed, `Applied ${expression} = ${session.display}, then selected ${operator}`);
    } else {
      session.accumulator = toNumber(session.display);
      session.expression = session.display;
      recordStep(session, trimmed, `Selected ${operator}`);
    }
    session.pendingOperator = operator;
    session.waitingForOperand = true;
    return persist(session);
  }

  if (trimmed === "=") {
    if (!session.pendingOperator || session.accumulator === null) return persist(session);
    const left = session.accumulator;
    const right = toNumber(session.display);
    const expression = `${formatNumber(left)} ${session.pendingOperator} ${formatNumber(right)}`;
    const result = applyOperator(left, right, session.pendingOperator);
    const formatted = formatNumber(result);
    session.display = formatted;
    session.expression = expression;
    session.accumulator = Number.isFinite(result) ? result : null;
    session.pendingOperator = null;
    session.waitingForOperand = true;
    session.history = [{ expression, result: formatted, timestamp: nowIso() }, ...session.history].slice(0, 8);
    recordStep(session, trimmed, `Evaluated ${expression} = ${formatted}`);
    return persist(session);
  }

  return persist(session);
}

type ActiveTransport =
  | { kind: "streamable"; server: McpServer; transport: StreamableHTTPServerTransport }
  | { kind: "sse"; server: McpServer; transport: SSEServerTransport };

const activeTransports = new Map<string, ActiveTransport>();

export function registerCalculatorFeatures(server: McpServer) {
  server.registerTool(
    helloWorldToolName,
    {
      title: "Open Toolshed Hello World Demo",
      description: "Open a very obvious hello-world widget from the Toolshed MCP server so the user can verify that a custom widget rendered.",
      inputSchema: z.object({
        message: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: {
          resourceUri: helloWorldResourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": helloWorldResourceUri,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening hello world demo…",
        "openai/toolInvocation/invoked": "Hello world demo ready.",
      },
    },
    async ({ message }) => {
      const payload = buildHelloWorldState(message);
      return {
        content: [
          {
            type: "text",
            text: `${payload.message} If the custom widget rendered correctly, you should see a large Toolshed hello-world panel rather than a native ChatGPT instrument.`,
          },
        ],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    helloWorldCalculatorToolName,
    {
      title: "Open Toolshed Hello World Calculator Panel",
      description: "Open the analog math console and stamp a hello-world message inside the calculator panel so the user can verify the calculator widget itself rendered.",
      inputSchema: z.object({
        sessionId: z.string().optional(),
        renderInline: z.boolean().optional(),
        message: z.string().optional(),
        sessionState: z.any().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: {
          resourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": resourceUri,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening hello-world calculator panel…",
        "openai/toolInvocation/invoked": "Hello-world calculator panel ready.",
      },
    },
    async ({ sessionId, renderInline, message, sessionState }) => {
      const session = persist(setPanelContent(
        hydrateSession(getSession(sessionId || sessionState?.sessionId), sessionState),
        "Hello World",
        message || "Hello world from Toolshed. This text is being rendered inside the calculator panel from your MCP server.",
      ));
      return {
        content: [
          {
            type: "text",
            text: "Opened the calculator widget with a hello-world banner inside the panel. If this renders, the calculator surface is coming from your MCP server.",
          },
        ],
        structuredContent: {
          ...buildWidgetState(session),
          renderInline: Boolean(renderInline),
        },
      };
    },
  );

  server.registerTool(
    toolName,
    {
      title: "Open Toolshed Skeuomorphic Calculator (Local)",
      description: "Open the local Toolshed skeuomorphic calculator session for the inline Toolshed host.",
      inputSchema: z.object({
        sessionId: z.string().optional(),
        renderInline: z.boolean().optional(),
        prompt: z.string().optional(),
        sessionState: z.any().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          resourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["app"],
        },
        "openai/outputTemplate": resourceUri,
        "openai/toolInvocation/invoking": "Opening calculator…",
        "openai/toolInvocation/invoked": "Calculator ready.",
      },
    },
    async ({ sessionId, renderInline, prompt, sessionState }) => {
      const session = persist(setPanelContent(hydrateSession(getSession(sessionId || sessionState?.sessionId), sessionState), null, null));
      return {
        content: [
          {
            type: "text",
            text: `Opened the custom Toolshed skeuomorphic calculator${renderInline ? " inline" : " in the toolbox"}. Current display: ${session.display}.`,
          },
        ],
        structuredContent: {
          ...snapshot(session),
          renderInline: Boolean(renderInline),
          prompt: prompt || "",
        },
      };
    },
  );

  server.registerTool(
    chatgptToolName,
    {
      title: "Open Toolshed Analog Math Console",
      description: "Use this when the user wants the custom Toolshed calculator experience or metallic analog math console widget. Open the distinctive custom widget instead of any generic built-in calculator or instrument.",
      inputSchema: z.object({
        sessionId: z.string().optional(),
        renderInline: z.boolean().optional(),
        prompt: z.string().optional(),
        sessionState: z.any().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: {
          resourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": resourceUri,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening math console…",
        "openai/toolInvocation/invoked": "Math console ready.",
      },
    },
    async ({ sessionId, renderInline, prompt, sessionState }) => {
      const session = persist(setPanelContent(hydrateSession(getSession(sessionId || sessionState?.sessionId), sessionState), null, null));
      return {
        content: [
          {
            type: "text",
            text: `Opened the custom Toolshed analog math console${renderInline ? " inline" : ""}. Current display: ${session.display}.`,
          },
        ],
        structuredContent: {
          ...buildWidgetState(session),
          renderInline: Boolean(renderInline),
          prompt: prompt || "",
        },
      };
    },
  );

  server.registerTool(
    "calculator_press_key",
    {
      title: "Calculator Press Key",
      description: "Apply a calculator key press and return the updated session state.",
      inputSchema: z.object({
        sessionId: z.string(),
        key: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sessionId, key }) => {
      const session = pressKey(getSession(sessionId), key);
      return {
        content: [{ type: "text", text: `Key ${key} applied. Display now shows ${session.display}.` }],
        structuredContent: buildWidgetState(session),
      };
    },
  );

  server.registerTool(
    "get_calculator_session_state",
    {
      title: "Get Calculator Session State",
      description: "Return the calculator's current display and recent results for chat follow-up questions.",
      inputSchema: z.object({
        sessionId: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ sessionId }) => {
      const session = persist(getSession(sessionId));
      return {
        content: [{ type: "text", text: buildAnswer("", session) }],
        structuredContent: buildWidgetState(session),
      };
    },
  );

  server.registerTool(
    "answer_calculator_question",
    {
      title: "Answer Calculator Question",
      description: "Answer a natural-language question using the calculator's current display and recent session history.",
      inputSchema: z.object({
        sessionId: z.string(),
        question: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ sessionId, question }) => {
      const session = persist(getSession(sessionId));
      return {
        content: [{ type: "text", text: buildAnswer(question, session) }],
        structuredContent: buildWidgetState(session),
      };
    },
  );

  server.registerResource(
    "hello-world-ui",
    helloWorldResourceUri,
    {
      title: "Toolshed Hello World UI",
      description: "Highly visible hello-world widget used to verify custom MCP widget rendering.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: helloWorldResourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: helloHtml,
          _meta: buildWidgetMeta("A loud hello-world demo panel used to verify that ChatGPT rendered a custom Toolshed widget."),
        },
      ],
    }),
  );

  server.registerResource(
    "calculator-ui",
    resourceUri,
    {
      title: "Skeuomorphic Calculator UI",
      description: "Inline-ready calculator interface for toolbox and lane rendering.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: buildWidgetMeta("Interactive metallic Toolshed math console with a live display, step memory, and recent history."),
        },
      ],
    }),
  );

  return server;
}

export function registerCalculatorAggregateFeatures(server: McpServer) {
  server.registerTool(
    toolName,
    {
      title: "Open Toolshed Skeuomorphic Calculator",
      description: "Open the custom Toolshed skeuomorphic calculator session.",
      inputSchema: z.object({
        sessionId: z.string().optional(),
        renderInline: z.boolean().optional(),
        prompt: z.string().optional(),
        sessionState: z.any().optional(),
      }),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      securitySchemes: [{ type: "noauth" }],
      _meta: {
        securitySchemes: [{ type: "noauth" }],
        ui: {
          resourceUri,
          inlinePreferred: true,
          toolbox: true,
          visibility: ["model", "app"],
        },
        "openai/outputTemplate": resourceUri,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening calculator…",
        "openai/toolInvocation/invoked": "Calculator ready.",
      },
    },
    async ({ sessionId, renderInline, prompt, sessionState }) => {
      const session = persist(setPanelContent(hydrateSession(getSession(sessionId || sessionState?.sessionId), sessionState), null, null));
      return {
        content: [
          {
            type: "text",
            text: `Opened the custom Toolshed skeuomorphic calculator${renderInline ? " inline" : ""}. Current display: ${session.display}.`,
          },
        ],
        structuredContent: {
          ...buildWidgetState(session),
          renderInline: Boolean(renderInline),
          prompt: prompt || "",
        },
      };
    },
  );

  server.registerTool(
    "calculator_press_key",
    {
      title: "Calculator Press Key",
      description: "Apply a calculator key press and return the updated session state.",
      inputSchema: z.object({
        sessionId: z.string(),
        key: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
        destructiveHint: false,
      },
      _meta: {
        ui: {
          visibility: ["app"],
        },
      },
    },
    async ({ sessionId, key }) => {
      const session = pressKey(getSession(sessionId), key);
      return {
        content: [{ type: "text", text: `Key ${key} applied. Display now shows ${session.display}.` }],
        structuredContent: buildWidgetState(session),
      };
    },
  );

  server.registerResource(
    "calculator-ui",
    resourceUri,
    {
      title: "Skeuomorphic Calculator UI",
      description: "Inline-ready calculator interface for toolbox and lane rendering.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          _meta: buildWidgetMeta("Interactive metallic Toolshed math console with a live display, step memory, and recent history."),
        },
      ],
    }),
  );

  return server;
}

export function createCalculatorServer() {
  const server = new McpServer({
    name: "toolshed-skeuomorphic-calculator-toolbox-app",
    version: "0.1.0",
  });
  registerCalculatorFeatures(server);
  return server;
}

function getStringArg(name: string): string | null {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function isHttpMode() {
  const transportMode = String(process.env.MCP_TRANSPORT || "").trim().toLowerCase();
  return process.argv.includes("--http")
    || process.argv.includes("--streamable-http")
    || transportMode === "http"
    || transportMode === "streamable-http";
}

function getHttpHost() {
  return String(process.env.MCP_HOST || getStringArg("host") || "127.0.0.1").trim() || "127.0.0.1";
}

function getHttpPort() {
  const value = String(process.env.MCP_PORT || process.env.PORT || getStringArg("port") || "3000").trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function getHeaderValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

async function readJsonBody(req: IncomingMessage) {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function writeJsonRpcError(res: ServerResponse, statusCode: number, message: string) {
  writeJson(res, statusCode, {
    jsonrpc: "2.0",
    error: {
      code: statusCode === 400 ? -32000 : -32603,
      message,
    },
    id: null,
  });
}

function writeText(res: ServerResponse, statusCode: number, content: string) {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(content);
}

async function closeActiveTransports() {
  const entries = [...activeTransports.entries()];
  activeTransports.clear();
  for (const [, entry] of entries) {
    try {
      await entry.transport.close();
    } catch {}
  }
}

function registerActiveTransport(sessionId: string, entry: ActiveTransport) {
  activeTransports.set(sessionId, entry);
}

async function createStreamableTransport() {
  const server = createCalculatorServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      registerActiveTransport(sessionId, { kind: "streamable", server, transport });
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) activeTransports.delete(transport.sessionId);
  };
  await server.connect(transport);
  return transport;
}

async function handleStreamableRequest(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = getHeaderValue(req, "mcp-session-id");
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (existing) {
    if (existing.kind !== "streamable") {
      writeJsonRpcError(res, 400, "Bad Request: Session exists but uses a different transport protocol.");
      return;
    }
    await existing.transport.handleRequest(req, res, body);
    return;
  }
  if (req.method !== "POST" || !body || !isInitializeRequest(body)) {
    writeJsonRpcError(res, 400, "Bad Request: No valid session ID provided.");
    return;
  }
  const transport = await createStreamableTransport();
  await transport.handleRequest(req, res, body);
}

async function handleLegacySseStart(req: IncomingMessage, res: ServerResponse) {
  const server = createCalculatorServer();
  const transport = new SSEServerTransport("/messages", res);
  registerActiveTransport(transport.sessionId, { kind: "sse", server, transport });
  res.on("close", () => {
    activeTransports.delete(transport.sessionId);
  });
  await server.connect(transport);
}

async function handleLegacySseMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
  const sessionId = String(requestUrl.searchParams.get("sessionId") || "").trim();
  const existing = sessionId ? activeTransports.get(sessionId) : null;
  if (!existing || existing.kind !== "sse") {
    writeJsonRpcError(res, 400, "Bad Request: No SSE session found for that session ID.");
    return;
  }
  await existing.transport.handlePostMessage(req, res, body);
}

async function runHttpServer() {
  const host = getHttpHost();
  const port = getHttpPort();
  const httpServer = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${getHeaderValue(req, "host") || "localhost"}`);
      const body = await readJsonBody(req);
      if (requestUrl.pathname === "/mcp" && ["GET", "POST", "DELETE"].includes(req.method || "")) {
        await handleStreamableRequest(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/sse" && req.method === "GET") {
        await handleLegacySseStart(req, res);
        return;
      }
      if (requestUrl.pathname === "/messages" && req.method === "POST") {
        await handleLegacySseMessage(req, res, body);
        return;
      }
      if (requestUrl.pathname === "/" && req.method === "GET") {
        writeJson(res, 200, {
          name: "toolshed-skeuomorphic-calculator-toolbox-app",
          streamableHttpUrl: "/mcp",
          legacySseUrl: "/sse",
        });
        return;
      }
      writeText(res, 404, "Not found.");
    } catch (error) {
      console.error(error);
      writeJsonRpcError(res, 500, "Internal server error.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  console.log(`Calculator MCP server listening on http://${host}:${port}/mcp`);
  console.log(`Legacy SSE compatibility is available at http://${host}:${port}/sse`);

  const shutdown = async () => {
    await closeActiveTransports();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

async function runStdioServer() {
  const server = createCalculatorServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function main() {
  if (isHttpMode()) {
    await runHttpServer();
    return;
  }
  await runStdioServer();
}

const isMainModule = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
