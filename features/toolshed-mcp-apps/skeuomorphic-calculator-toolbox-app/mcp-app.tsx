import { hostRuntimeScript } from "../shared/host-runtime.ts";

export const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Skeuomorphic Calculator</title>
    <style>
      :root {
        color-scheme: dark;
        --background: oklch(0.145 0 0);
        --foreground: oklch(0.985 0 0);
        --card: oklch(0.205 0 0);
        --card-foreground: oklch(0.985 0 0);
        --popover: oklch(0.205 0 0);
        --popover-foreground: oklch(0.985 0 0);
        --primary: oklch(0.922 0 0);
        --primary-foreground: oklch(0.205 0 0);
        --secondary: oklch(0.269 0 0);
        --secondary-foreground: oklch(0.985 0 0);
        --muted: oklch(0.269 0 0);
        --muted-foreground: oklch(0.708 0 0);
        --accent: oklch(0.269 0 0);
        --accent-foreground: oklch(0.985 0 0);
        --destructive: oklch(0.704 0.191 22.216);
        --destructive-foreground: oklch(1 0 0);
        --border: oklch(1 0 0 / 10%);
        --input: oklch(1 0 0 / 15%);
        --ring: oklch(0.556 0 0);
        --chart-1: oklch(0.87 0 0);
        --chart-2: oklch(0.556 0 0);
        --chart-3: oklch(0.439 0 0);
        --chart-4: oklch(0.371 0 0);
        --chart-5: oklch(0.269 0 0);
        --font-sans: Geist, ui-sans-serif, sans-serif, system-ui;
        --font-serif: "Playfair Display", ui-serif, serif;
        --font-mono: "IBM Plex Mono", ui-monospace, monospace;
        --radius: 0.05rem;
        --bg: var(--background);
        --panel: var(--card);
        --panel-2: var(--secondary);
        --bevel-hi: color-mix(in oklch, var(--foreground) 8%, transparent);
        --bevel-lo: color-mix(in oklch, black 72%, transparent);
        --metal: linear-gradient(180deg, color-mix(in oklch, var(--secondary) 82%, white 18%) 0%, var(--card) 100%);
        --screen: linear-gradient(180deg, color-mix(in oklch, var(--chart-5) 62%, white 38%) 0%, color-mix(in oklch, var(--chart-4) 72%, var(--chart-5) 28%) 100%);
        --screen-foreground: color-mix(in oklch, var(--background) 64%, var(--chart-5) 36%);
        --digit: linear-gradient(180deg, color-mix(in oklch, var(--foreground) 92%, var(--background) 8%) 0%, color-mix(in oklch, var(--muted-foreground) 70%, var(--card) 30%) 100%);
        --operator: linear-gradient(180deg, color-mix(in oklch, var(--primary) 78%, white 22%) 0%, color-mix(in oklch, var(--accent) 88%, black 12%) 100%);
        --action: linear-gradient(180deg, color-mix(in oklch, var(--secondary) 84%, white 16%) 0%, var(--card) 100%);
        --digit-foreground: color-mix(in oklch, var(--background) 74%, var(--foreground) 26%);
        --operator-foreground: color-mix(in oklch, var(--background) 78%, var(--destructive) 22%);
        --action-foreground: color-mix(in oklch, var(--background) 76%, var(--chart-2) 24%);
        --history-accent: color-mix(in oklch, var(--chart-5) 58%, white 42%);
        --button-height-sm: 32px;
        --button-padding-x-sm: 10px;
        --button-border: var(--border);
        --button-ring: var(--ring);
        --button-bg: var(--secondary);
        --button-bg-hover: color-mix(in oklch, var(--secondary) 78%, white 22%);
        --button-fg: var(--secondary-foreground);
        --button-radius: max(calc(var(--radius) + 8px), 0.5rem);
        --button-radius-sm: max(calc(var(--radius) + 6px), 0.45rem);
        --shadow: 0px 9px 50px 0px hsl(228.4211 36.7742% 69.6078% / 0.21), 0px 1px 2px -1px hsl(228.4211 36.7742% 69.6078% / 0.21);
        --mono: var(--font-mono);
        --sans: var(--font-sans);
        --serif: var(--font-serif);
      }

      body.light {
        color-scheme: light;
        --background: oklch(1 0 0);
        --foreground: oklch(0.145 0 0);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.145 0 0);
        --popover: oklch(1 0 0);
        --popover-foreground: oklch(0.145 0 0);
        --primary: oklch(0.205 0 0);
        --primary-foreground: oklch(0.985 0 0);
        --secondary: oklch(0.97 0 0);
        --secondary-foreground: oklch(0.205 0 0);
        --muted: oklch(0.97 0 0);
        --muted-foreground: oklch(0.556 0 0);
        --accent: oklch(0.97 0 0);
        --accent-foreground: oklch(0.205 0 0);
        --destructive: oklch(0.577 0.245 27.325);
        --destructive-foreground: oklch(1 0 0);
        --border: oklch(0.922 0 0);
        --input: oklch(0.922 0 0);
        --ring: oklch(0.708 0 0);
        --chart-1: oklch(0.87 0 0);
        --chart-2: oklch(0.556 0 0);
        --chart-3: oklch(0.439 0 0);
        --chart-4: oklch(0.371 0 0);
        --chart-5: oklch(0.269 0 0);
        --radius: 0.625rem;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: var(--sans);
        background:
          radial-gradient(circle at top, color-mix(in oklch, var(--foreground) 8%, transparent), transparent 30%),
          linear-gradient(180deg, color-mix(in oklch, var(--bg) 92%, white 8%) 0%, var(--bg) 100%);
        color: var(--foreground);
      }

      .shell {
        width: min(100%, 920px);
        margin: 0 auto;
        padding: 18px;
      }

      .frame {
        display: grid;
        grid-template-columns: minmax(280px, 1.15fr) minmax(220px, 0.85fr);
        gap: 18px;
        background: linear-gradient(180deg, color-mix(in oklch, var(--panel) 88%, white 12%) 0%, var(--panel) 100%);
        border-radius: 32px;
        padding: 18px;
        box-shadow: var(--shadow), inset 1px 1px 0 var(--bevel-hi), inset -2px -2px 0 var(--bevel-lo);
        border: 1px solid var(--button-border);
      }

      .calculator,
      .sidebar {
        border-radius: 26px;
        padding: 16px;
        background: linear-gradient(180deg, color-mix(in oklch, var(--panel-2) 92%, white 8%), var(--panel) 100%);
        box-shadow: inset 1px 1px 0 var(--bevel-hi), inset -2px -2px 0 var(--bevel-lo);
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 14px;
      }

      .brand {
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-size: 12px;
        opacity: 0.84;
      }

      .pill-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }

      .pill {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 11px;
        color: var(--foreground);
        background: color-mix(in oklch, var(--panel-2) 90%, white 10%);
        border: 1px solid var(--button-border);
      }

      .screen {
        border-radius: 18px;
        padding: 16px;
        margin-bottom: 14px;
        min-height: 134px;
        background: var(--screen);
        color: var(--screen-foreground);
        box-shadow: inset 0 2px 12px color-mix(in oklch, black 25%, transparent), inset 1px 1px 0 color-mix(in oklch, white 35%, transparent);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 8px;
      }

      .screen-banner-badge {
        align-self: flex-start;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 10px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        background: color-mix(in oklch, var(--foreground) 12%, transparent);
        color: color-mix(in oklch, var(--screen-foreground) 72%, white 28%);
        border: 1px solid color-mix(in oklch, var(--foreground) 16%, transparent);
      }

      .screen-banner {
        font-size: 13px;
        line-height: 1.5;
        color: color-mix(in oklch, var(--screen-foreground) 80%, white 20%);
        text-wrap: balance;
      }

      .expression {
        min-height: 20px;
        font-size: 14px;
        opacity: 0.7;
        text-align: right;
        font-family: var(--mono);
      }

      .display {
        font-size: clamp(32px, 7vw, 52px);
        line-height: 1;
        text-align: right;
        font-family: var(--mono);
        word-break: break-all;
      }

      .subdisplay {
        min-height: 18px;
        font-size: 12px;
        text-align: right;
        opacity: 0.8;
      }

      .keypad {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .keypad button {
        appearance: none;
        border: none;
        cursor: pointer;
        min-height: 62px;
        border-radius: 18px;
        font-size: 20px;
        font-weight: 700;
        color: var(--digit-foreground);
        background: var(--digit);
        box-shadow: 0 8px 14px color-mix(in oklch, black 22%, transparent), inset 1px 1px 0 color-mix(in oklch, white 70%, transparent), inset -2px -4px 0 color-mix(in oklch, var(--background) 22%, transparent);
        transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
      }

      .keypad button:hover { filter: brightness(1.03); }
      .keypad button:active {
        transform: translateY(2px);
        box-shadow: 0 4px 8px color-mix(in oklch, black 26%, transparent), inset 1px 1px 0 color-mix(in oklch, white 42%, transparent);
      }

      .keypad button.operator { background: var(--operator); color: var(--operator-foreground); }
      .keypad button.action { background: var(--action); color: var(--action-foreground); }
      .keypad button.equals { grid-column: span 2; }
      .keypad button.zero { grid-column: span 2; }

      .ui-button {
        appearance: none;
        border: 1px solid transparent;
        background: transparent;
        color: var(--foreground);
        border-radius: var(--button-radius);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--button-height-sm);
        padding: 0 var(--button-padding-x-sm);
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: none;
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease, color 120ms ease;
      }

      .ui-button:hover {
        background: var(--muted);
        color: var(--foreground);
      }

      .ui-button:active { transform: translateY(1px); }
      .ui-button[data-variant="outline"] {
        border-color: var(--border);
        background: var(--background);
      }
      body:not(.light) .ui-button[data-variant="outline"] {
        border-color: var(--input);
        background: color-mix(in oklch, var(--input) 30%, transparent);
      }
      .ui-button[data-variant="secondary"] {
        background: var(--secondary);
        color: var(--secondary-foreground);
      }
      .ui-button[data-variant="secondary"]:hover {
        background: color-mix(in oklch, var(--secondary) 84%, var(--background) 16%);
      }
      .ui-button[data-variant="default"] {
        background: var(--primary);
        color: var(--primary-foreground);
      }
      .ui-button[data-variant="default"]:hover {
        background: color-mix(in oklch, var(--primary) 84%, var(--background) 16%);
      }
      .ui-button[data-state="active"] {
        background: var(--background);
        border-color: var(--input);
        color: var(--foreground);
        box-shadow: var(--shadow);
      }
      body:not(.light) .ui-button[data-state="active"] {
        background: color-mix(in oklch, var(--input) 30%, transparent);
      }
      .ui-button:focus-visible {
        outline: none;
        border-color: var(--ring);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent);
      }
      .ui-button:disabled { opacity: 0.55; cursor: not-allowed; }

      .sidebar {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .card {
        border-radius: 18px;
        padding: 14px;
        background: color-mix(in oklch, var(--panel) 94%, black 6%);
        border: 1px solid var(--button-border);
        box-shadow: inset 1px 1px 0 color-mix(in oklch, var(--foreground) 4%, transparent), inset -1px -1px 0 color-mix(in oklch, black 18%, transparent);
      }

      .card h3 {
        margin: 0 0 10px;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.85;
      }

      .session-id,
      .hint,
      .history-item,
      .status-line {
        font-size: 13px;
        line-height: 1.45;
      }

      .history {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 220px;
        overflow: auto;
      }

      .history-item {
        border-radius: 12px;
        padding: 10px;
        background: color-mix(in oklch, var(--foreground) 5%, transparent);
      }

      .history-item strong {
        display: block;
        font-family: var(--mono);
        color: var(--history-accent);
      }

      .toolbar {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .toolbar .ui-button {
        width: 100%;
      }

      .muted { opacity: 0.72; }
      .status-ok { color: var(--chart-2); }

      @media (max-width: 760px) {
        .frame { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div class="frame">
        <section class="calculator">
          <div class="topbar">
            <div>
              <div class="brand">Skeuomorphic Calculator</div>
              <div class="muted">Toolbox app · inline-ready surface</div>
            </div>
            <div class="pill-row">
              <div class="pill">Basic arithmetic</div>
              <div class="pill">Session-only state</div>
            </div>
          </div>

          <div class="screen">
            <div id="panelBadge" class="screen-banner-badge" hidden></div>
            <div id="panelMessage" class="screen-banner" hidden></div>
            <div id="expression" class="expression"></div>
            <div id="display" class="display">0</div>
            <div id="subdisplay" class="subdisplay">Ready</div>
          </div>

          <div class="keypad" id="keypad">
            <button class="action" data-key="C">C</button>
            <button class="action" data-key="⌫">⌫</button>
            <button class="operator" data-key="÷">÷</button>
            <button class="operator" data-key="×">×</button>
            <button data-key="7">7</button>
            <button data-key="8">8</button>
            <button data-key="9">9</button>
            <button class="operator" data-key="-">−</button>
            <button data-key="4">4</button>
            <button data-key="5">5</button>
            <button data-key="6">6</button>
            <button class="operator" data-key="+">+</button>
            <button data-key="1">1</button>
            <button data-key="2">2</button>
            <button data-key="3">3</button>
            <button class="operator" data-key="=">=</button>
            <button class="zero" data-key="0">0</button>
            <button data-key=".">.</button>
          </div>
        </section>

        <aside class="sidebar">
          <div class="card">
            <h3>Session</h3>
            <div id="sessionId" class="session-id muted">Waiting for session…</div>
            <div id="status" class="status-line">Connecting to host bridge…</div>
          </div>

          <div class="card">
            <h3>Toolbox actions</h3>
            <div class="toolbar">
              <button class="ui-button" data-variant="secondary" id="sendCurrent">Ask chat about current value</button>
              <button class="ui-button" data-variant="outline" id="sendRecent">Ask chat about recent calculation</button>
            </div>
          </div>

          <div class="card">
            <h3>Step memory</h3>
            <div id="steps" class="history">
              <div class="hint muted">No calculation steps yet.</div>
            </div>
          </div>

          <div class="card">
            <h3>Recent history</h3>
            <div id="history" class="history">
              <div class="hint muted">No completed calculations yet.</div>
            </div>
          </div>
        </aside>
      </div>
    </div>

    ${hostRuntimeScript}
    <script>
      const state = {
        sessionId: "",
        display: "0",
        expression: "",
        panelLabel: "",
        panelMessage: "",
        history: [],
        steps: [],
        updatedAt: "",
      };

      const $panelBadge = document.getElementById("panelBadge");
      const $panelMessage = document.getElementById("panelMessage");
      const $display = document.getElementById("display");
      const $expression = document.getElementById("expression");
      const $subdisplay = document.getElementById("subdisplay");
      const $history = document.getElementById("history");
      const $steps = document.getElementById("steps");
      const $status = document.getElementById("status");
      const $sessionId = document.getElementById("sessionId");
      let sessionSyncTimer = 0;

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function updateTheme(theme) {
        if (theme === "light") document.body.classList.add("light");
        else if (theme === "dark") document.body.classList.remove("light");
      }

      const host = window.__toolshedHostRuntime.createHostRuntime({
        updateTheme,
        applyGlobals: hydrateFromGlobals,
        onToolInput(input) {
          applyPayload(input);
          setOkStatus("Host attached", "waiting for result");
        },
        onToolResult(result) {
          applyPayload(result);
          setOkStatus("Ready", "calculator connected");
        },
        onUnavailable() {
          if (!state.sessionId) {
            $status.textContent = "Host bridge unavailable.";
          }
        },
      });
      host.applyInitialTheme();

      function setOkStatus(label, detail) {
        const suffix = detail ? " · " + escapeHtml(detail) : "";
        $status.innerHTML = '<span class="status-ok">' + escapeHtml(label) + "</span>" + suffix;
      }

      function renderList(container, items, emptyText, buildItem) {
        if (!Array.isArray(items) || items.length === 0) {
          container.innerHTML = '<div class="hint muted">' + escapeHtml(emptyText) + "</div>";
          return;
        }
        container.innerHTML = items.map(buildItem).join("");
      }

      function buildSessionSnapshot() {
        return {
          sessionId: state.sessionId,
          display: state.display,
          expression: state.expression,
          panelLabel: state.panelLabel || null,
          panelMessage: state.panelMessage || null,
          history: Array.isArray(state.history) ? state.history : [],
          steps: Array.isArray(state.steps) ? state.steps : [],
          updatedAt: state.updatedAt || "",
        };
      }

      function scheduleSessionSync() {
        if (!state.sessionId) return;
        if (sessionSyncTimer) clearTimeout(sessionSyncTimer);
        sessionSyncTimer = window.setTimeout(async () => {
          sessionSyncTimer = 0;
          try {
            await host.syncToolshedSession({
              adapter: "calculator",
              title: "Skeuomorphic Calculator Toolbox App",
              sessionId: state.sessionId,
              appState: buildSessionSnapshot(),
            });
          } catch {}
        }, 60);
      }

      function render() {
        if (state.panelLabel) {
          $panelBadge.hidden = false;
          $panelBadge.textContent = state.panelLabel;
        } else {
          $panelBadge.hidden = true;
          $panelBadge.textContent = "";
        }

        if (state.panelMessage) {
          $panelMessage.hidden = false;
          $panelMessage.textContent = state.panelMessage;
        } else {
          $panelMessage.hidden = true;
          $panelMessage.textContent = "";
        }

        $display.textContent = state.display || "0";
        $expression.textContent = state.expression || "";
        $subdisplay.textContent = state.updatedAt ? "Updated " + new Date(state.updatedAt).toLocaleTimeString() : "Ready";
        $sessionId.textContent = state.sessionId ? "Session: " + state.sessionId : "Waiting for session…";

        renderList($steps, state.steps, "No calculation steps yet.", (entry) => {
          return '<div class="history-item"><strong>' + escapeHtml(entry?.label || entry?.key || "") + "</strong><div>" + escapeHtml(entry?.expression || entry?.display || "") + "</div><div>= " + escapeHtml(entry?.display || "") + "</div></div>";
        });

        renderList($history, state.history, "No completed calculations yet.", (entry) => {
          return '<div class="history-item"><strong>' + escapeHtml(entry?.expression || "") + "</strong><div>= " + escapeHtml(entry?.result || "") + "</div></div>";
        });
      }

      function normalizePayload(payload) {
        const source = payload?.structuredContent || payload || null;
        if (!source || typeof source !== "object") return null;
        if (source.session && typeof source.session === "object") {
          return source.session;
        }
        return source;
      }

      function applyPayload(payload) {
        const next = normalizePayload(payload);
        if (!next) return false;

        if (typeof next.sessionId === "string" && next.sessionId) {
          state.sessionId = next.sessionId;
        }
        if (Object.prototype.hasOwnProperty.call(next, "display")) {
          state.display = String(next.display ?? "0");
        }
        if (Object.prototype.hasOwnProperty.call(next, "expression")) {
          state.expression = next.expression ? String(next.expression) : "";
        }
        if (Object.prototype.hasOwnProperty.call(next, "panelLabel")) {
          state.panelLabel = next.panelLabel ? String(next.panelLabel) : "";
        }
        if (Object.prototype.hasOwnProperty.call(next, "panelMessage")) {
          state.panelMessage = next.panelMessage ? String(next.panelMessage) : "";
        }
        if (Array.isArray(next.history)) {
          state.history = next.history;
        }
        if (Array.isArray(next.steps)) {
          state.steps = next.steps;
        }
        if (typeof next.updatedAt === "string") {
          state.updatedAt = next.updatedAt;
        }

        render();
        scheduleSessionSync();
        return true;
      }

      function hydrateFromGlobals(globals) {
        if (!globals || typeof globals !== "object") return false;
        updateTheme(globals.theme);

        let updated = false;
        if (globals.widgetState) {
          updated = applyPayload(globals.widgetState) || updated;
        }
        if (globals.toolInput && !globals.toolOutput) {
          updated = applyPayload(globals.toolInput) || updated;
          setOkStatus("Host attached", "waiting for result");
        }
        if (globals.toolOutput) {
          updated = applyPayload({ structuredContent: globals.toolOutput }) || updated;
          setOkStatus("Ready", "calculator connected");
        }
        return updated;
      }

      async function press(key) {
        if (!state.sessionId) return;
        $status.textContent = "Applying " + key + "…";

        try {
          const result = await host.callTool("calculator_press_key", { sessionId: state.sessionId, key });
          applyPayload(result);
          setOkStatus("Ready", key + " applied");
        } catch (error) {
          $status.textContent = "Unable to apply key: " + (error?.message || String(error));
        }
      }

      async function sendQuestion(text) {
        try {
          await host.sendFollowUpMessage({ prompt: text, scrollToBottom: true });
        } catch (error) {
          $status.textContent = "Unable to message chat: " + (error?.message || String(error));
        }
      }

      function normalizeKeyboardKey(key) {
        if (!key) return null;
        if (/^[0-9]$/.test(key)) return key;
        if (key === ".") return ".";
        if (key === "+" || key === "-") return key;
        if (key === "*" || key === "x" || key === "X") return "×";
        if (key === "/") return "÷";
        if (key === "=" || key === "Enter") return "=";
        if (key === "Backspace") return "⌫";
        if (key === "Delete" || key === "Escape" || key === "c" || key === "C") return "C";
        return null;
      }

      function shouldIgnoreKeyboardEvent(target) {
        if (!target || typeof target.closest !== "function") return false;
        return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
      }

      document.getElementById("keypad").addEventListener("click", (event) => {
        const target = event.target.closest("button[data-key]");
        if (!target) return;
        press(target.getAttribute("data-key"));
      });

      window.addEventListener("keydown", (event) => {
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (shouldIgnoreKeyboardEvent(event.target)) return;
        const normalizedKey = normalizeKeyboardKey(event.key);
        if (!normalizedKey) return;
        event.preventDefault();
        press(normalizedKey);
      });

      document.getElementById("sendCurrent").addEventListener("click", () => {
        if (!state.sessionId) return;
        sendQuestion("Using calculator session " + state.sessionId + ", what value is currently displayed?");
      });

      document.getElementById("sendRecent").addEventListener("click", () => {
        if (!state.sessionId) return;
        sendQuestion("Using calculator session " + state.sessionId + ", what is the most recent completed calculation and result?");
      });

      render();

      const ready = host.bootstrap();
      if (!ready) {
        $status.textContent = "Waiting for host bridge…";
      }
    </script>
  </body>
</html>`;
