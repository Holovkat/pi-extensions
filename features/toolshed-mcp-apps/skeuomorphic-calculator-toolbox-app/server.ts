import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { html } from "./mcp-app.tsx";

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
  accumulator: number | null;
  pendingOperator: Operator;
  waitingForOperand: boolean;
  history: HistoryEntry[];
  steps: StepEntry[];
  updatedAt: string;
};

const RESOURCE_MIME_TYPE = "text/html+skybridge";
const resourceUri = "ui://toolshed/skeuomorphic-calculator-toolbox-app/mcp-app.html";
const toolName = "open_skeuomorphic_calculator_toolbox_app";
const sessions = new Map<string, CalculatorSession>();

function nowIso() {
  return new Date().toISOString();
}

function createSession(sessionId: string = randomUUID()): CalculatorSession {
  return {
    sessionId,
    display: "0",
    expression: "",
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

const server = new McpServer({
  name: "toolshed-skeuomorphic-calculator-toolbox-app",
  version: "0.1.0",
});

server.registerTool(
  toolName,
  {
    title: "Open Skeuomorphic Calculator",
    description: "Open a skeuomorphic calculator in the toolbox or inline lane with session-only state.",
    inputSchema: z.object({
      sessionId: z.string().optional(),
      renderInline: z.boolean().optional(),
      prompt: z.string().optional(),
    }),
    _meta: {
      ui: {
        resourceUri,
        inlinePreferred: true,
        toolbox: true,
      },
    },
  },
  async ({ sessionId, renderInline, prompt }) => {
    const session = persist(getSession(sessionId));
    return {
      content: [
        {
          type: "text",
          text: `Opened the skeuomorphic calculator${renderInline ? " inline" : " in the toolbox"}. Current display: ${session.display}.`,
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
  "calculator_press_key",
  {
    title: "Calculator Press Key",
    description: "Apply a calculator key press and return the updated session state.",
    inputSchema: z.object({
      sessionId: z.string(),
      key: z.string(),
    }),
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
      structuredContent: snapshot(session),
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
  },
  async ({ sessionId }) => {
    const session = persist(getSession(sessionId));
    return {
      content: [{ type: "text", text: buildAnswer("", session) }],
      structuredContent: snapshot(session),
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
  },
  async ({ sessionId, question }) => {
    const session = persist(getSession(sessionId));
    return {
      content: [{ type: "text", text: buildAnswer(question, session) }],
      structuredContent: snapshot(session),
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
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
