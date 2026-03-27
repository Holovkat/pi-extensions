import { hostRuntimeScript } from "../shared/host-runtime.ts";

export const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GitHub Project Kanban Board</title>
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
        --font-mono: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
        --radius: 0.05rem;
        --bg: var(--background);
        --surface: var(--card);
        --surface-strong: var(--secondary);
        --text: var(--foreground);
        --text-muted: var(--muted-foreground);
        --button-height-sm: 32px;
        --button-padding-x-sm: 10px;
        --button-border: var(--border);
        --button-ring: var(--ring);
        --button-bg: var(--secondary);
        --button-bg-hover: color-mix(in oklch, var(--secondary) 78%, white 22%);
        --button-fg: var(--secondary-foreground);
        --button-radius: max(calc(var(--radius) + 8px), 0.5rem);
        --button-radius-sm: max(calc(var(--radius) + 6px), 0.45rem);
        --success: var(--chart-2);
        --danger: var(--destructive);
        --shadow: 0px 9px 50px 0px hsl(228.4211 36.7742% 69.6078% / 0.21), 0px 1px 2px -1px hsl(228.4211 36.7742% 69.6078% / 0.21);
        --card-radius: max(var(--radius), 0.75rem);
        --lane-padding: 18px;
        --column-width: 320px;
        --sans: var(--font-sans);
        --serif: var(--font-serif);
        --mono: var(--font-mono);
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
      html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }
      body {
        background:
          radial-gradient(circle at top left, color-mix(in oklch, var(--chart-5) 22%, transparent) 0%, transparent 24%),
          radial-gradient(circle at top right, color-mix(in oklch, var(--chart-2) 18%, transparent) 0%, transparent 22%),
          linear-gradient(180deg, color-mix(in oklch, var(--background) 92%, black 8%) 0%, var(--background) 100%);
      }

      .app {
        min-height: 100vh;
        padding: 0;
      }

      .shell {
        width: 100%;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .header {
        position: sticky;
        top: 0;
        z-index: 8;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 14px;
        align-items: start;
        padding: 18px 22px 12px;
        background: linear-gradient(180deg, color-mix(in oklch, var(--background) 94%, black 6%) 0%, color-mix(in oklch, var(--background) 88%, transparent 12%) 68%, transparent 100%);
        backdrop-filter: blur(18px);
      }

      .identity h1 {
        margin: 0;
        font-size: clamp(20px, 3vw, 30px);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 8px;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: transparent;
        border-radius: 0;
        padding: 0;
        color: var(--text-muted);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .header-tools {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 6px;
      }

      .icon-action {
        appearance: none;
        width: 28px;
        height: 28px;
        padding: 0;
        border: none;
        background: transparent;
        color: var(--muted-foreground);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: min(var(--radius-md), 12px);
        cursor: pointer;
        transition: background 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      }

      .icon-action:hover {
        background: color-mix(in oklch, var(--muted) 70%, transparent);
        color: var(--foreground);
      }

      .icon-action:active {
        transform: translateY(1px);
      }

      .icon-action:focus-visible {
        outline: none;
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 45%, transparent);
        color: var(--foreground);
      }

      .icon-action svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        stroke-width: 1.9;
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

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

      .modal-actions .ui-button {
        min-width: 132px;
      }

      .notice-stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 0 22px 12px;
      }

      .notice {
        border: none;
        border-left: 3px solid color-mix(in oklch, var(--foreground) 16%, transparent);
        background: color-mix(in oklch, var(--card) 84%, transparent);
        padding: 10px 12px;
        border-radius: 10px;
        color: var(--text-muted);
        line-height: 1.45;
      }

      .notice.error {
        border-left-color: color-mix(in oklch, var(--destructive) 76%, transparent);
        color: color-mix(in oklch, var(--destructive-foreground) 84%, var(--destructive) 16%);
        background: color-mix(in oklch, var(--destructive) 12%, transparent);
      }
      .notice.warning { border-left-color: color-mix(in oklch, var(--chart-5) 72%, transparent); }
      .notice.done-prompt {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
      }

      .notice-copy {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .notice-copy strong {
        font-size: 13px;
        color: var(--foreground);
      }

      .notice-copy span {
        color: var(--text-muted);
        font-size: 12px;
        line-height: 1.4;
      }

      .notice-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        flex: 0 0 auto;
      }

      .chip.meta-status {
        color: var(--accent);
        font-weight: 600;
      }

      .board-wrap {
        position: relative;
        flex: 1;
        min-height: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        overflow: hidden;
      }

      .board {
        display: flex;
        align-items: stretch;
        gap: 20px;
        overflow-x: auto;
        overflow-y: hidden;
        min-height: 100%;
        height: 100%;
        padding: 10px 22px 28px;
        scroll-snap-type: x proximity;
        scrollbar-width: none;
      }
      .board::-webkit-scrollbar { display: none; }

      .column {
        flex: 0 0 min(84vw, var(--column-width));
        min-width: 280px;
        max-width: 360px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scroll-snap-align: start;
      }

      .column-shell {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        border-radius: 0;
        background: transparent;
        border: none;
        border-left: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
        padding: 0 0 0 14px;
      }

      .column-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 0 12px;
      }

      .column-title {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }

      .column-count {
        min-width: 30px;
        text-align: center;
        border-radius: 999px;
        padding: 5px 9px;
        background: color-mix(in oklch, var(--foreground) 6%, transparent);
        color: var(--text);
        font-size: 12px;
      }

      .column-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
        padding-right: 8px;
        scrollbar-width: none;
        transition: box-shadow 140ms ease, background 140ms ease;
      }
      .column-body::-webkit-scrollbar { width: 0; height: 0; }
      .column-shell:hover .column-body,
      .column-shell:focus-within .column-body,
      .column.drag-over .column-body {
        scrollbar-width: thin;
      }
      .column-shell:hover .column-body::-webkit-scrollbar,
      .column-shell:focus-within .column-body::-webkit-scrollbar,
      .column.drag-over .column-body::-webkit-scrollbar {
        width: 8px;
      }
      .column-shell:hover .column-body::-webkit-scrollbar-thumb,
      .column-shell:focus-within .column-body::-webkit-scrollbar-thumb,
      .column.drag-over .column-body::-webkit-scrollbar-thumb {
        background: color-mix(in oklch, var(--foreground) 16%, transparent);
        border-radius: 999px;
      }

      .column.drag-over .column-shell,
      .column.drop-target .column-shell {
        border-left-color: color-mix(in oklch, var(--ring) 42%, transparent);
      }

      .empty {
        min-height: 120px;
        display: grid;
        place-items: center;
        text-align: center;
        padding: 16px;
        color: color-mix(in oklch, var(--foreground) 45%, transparent);
        border-top: 1px dashed color-mix(in oklch, var(--foreground) 8%, transparent);
        border-bottom: 1px dashed color-mix(in oklch, var(--foreground) 8%, transparent);
        border-radius: 0;
      }

      .card {
        border: none;
        background: var(--card);
        color: var(--card-foreground);
        border-radius: var(--card-radius);
        padding: 16px;
        box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--foreground) 10%, transparent);
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: hidden;
        user-select: none;
        transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease, border-color 140ms ease;
      }

      .card.movable { cursor: default; }
      .card.drag-source {
        opacity: 0.18;
        transition: opacity 90ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }
      .card.pending {
        opacity: 0.72;
        box-shadow:
          inset 0 0 0 1px color-mix(in oklch, var(--ring) 26%, transparent),
          0 0 0 3px color-mix(in oklch, var(--ring) 10%, transparent);
      }

      .card.drop-before {
        box-shadow:
          inset 0 3px 0 color-mix(in oklch, var(--ring) 72%, transparent),
          inset 0 0 0 1px color-mix(in oklch, var(--foreground) 10%, transparent);
      }

      .card.drop-after {
        box-shadow:
          inset 0 -3px 0 color-mix(in oklch, var(--ring) 72%, transparent),
          inset 0 0 0 1px color-mix(in oklch, var(--foreground) 10%, transparent);
      }

      .card-top {
        display: flex;
        gap: 10px;
        align-items: start;
        justify-content: space-between;
      }

      .card-main {
        flex: 1;
        min-width: 0;
      }

      .drag-handle {
        appearance: none;
        width: 32px;
        height: 32px;
        flex: 0 0 auto;
        border: 1px solid transparent;
        border-radius: var(--button-radius-sm);
        background: transparent;
        color: var(--text-muted);
        font: inherit;
        font-size: 15px;
        line-height: 1;
        cursor: grab;
        touch-action: none;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
      }

      .drag-handle:hover {
        background: var(--muted);
        color: var(--foreground);
      }

      .drag-handle:active {
        cursor: grabbing;
        transform: scale(0.98);
      }

      .drag-handle:focus-visible {
        outline: none;
        border-color: var(--ring);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 50%, transparent);
      }

      .drag-ghost {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 80;
        margin: 0;
        pointer-events: none;
        opacity: 0.96;
        transform-origin: top left;
        transform: translate3d(0, 0, 0);
        transition: none !important;
        will-change: transform;
        box-shadow:
          inset 0 0 0 1px color-mix(in oklch, var(--foreground) 10%, transparent),
          0 18px 38px color-mix(in oklch, var(--background) 30%, transparent);
      }

      .issue-ref {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--primary);
        text-decoration: none;
      }

      .issue-title {
        margin: 4px 0 0;
        font-size: 15px;
        line-height: 1.35;
        color: var(--card-foreground);
      }

      .labels,
      .assignees {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .issue-meta-line {
        margin-top: 6px;
        color: var(--text-muted);
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .label {
        font-size: 11px;
        border-radius: 999px;
        padding: 5px 8px;
        border: 1px solid color-mix(in oklch, var(--foreground) 8%, transparent);
        background: color-mix(in oklch, var(--muted) 75%, transparent);
        color: var(--muted-foreground);
      }

      .avatar {
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: linear-gradient(135deg, color-mix(in oklch, var(--chart-2) 28%, transparent), color-mix(in oklch, var(--primary) 28%, transparent));
        border: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
        display: grid;
        place-items: center;
        overflow: hidden;
        color: var(--text);
        font-size: 11px;
        text-decoration: none;
      }
      .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

      .modal-backdrop {
        position: fixed;
        inset: 0;
        background: color-mix(in oklch, var(--background) 72%, transparent);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .modal-backdrop.open { display: flex; }

      .modal {
        width: min(100%, 460px);
        border-radius: 24px;
        border: 1px solid color-mix(in oklch, var(--foreground) 10%, transparent);
        background: linear-gradient(180deg, color-mix(in oklch, var(--card) 92%, var(--background) 8%) 0%, color-mix(in oklch, var(--card) 74%, var(--background) 26%) 100%);
        box-shadow: var(--shadow);
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .modal h2 {
        margin: 0;
        font-size: 20px;
      }

      .modal p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
      }

      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      @media (max-width: 720px) {
        .header { grid-template-columns: 1fr; }
        .header-tools {
          align-items: flex-start;
        }
        .actions { justify-content: flex-start; }
        .header { padding: 16px 14px 10px; }
        .notice-stack { padding: 0 14px 10px; }
        .board { padding: 8px 14px 22px; }
        .column { flex-basis: min(88vw, 320px); }
      }
    </style>
    ${hostRuntimeScript}
  </head>
  <body>
    <div class="app">
      <div class="shell">
        <header class="header">
          <div class="identity">
            <h1 id="title">GitHub Project Kanban Board</h1>
            <div class="meta" id="meta"></div>
          </div>
          <div class="header-tools">
            <div class="actions">
              <button id="refreshBtn" class="icon-action" type="button" title="Refresh board" aria-label="Refresh board"></button>
              <button id="fullscreenBtn" class="icon-action" type="button" data-state="inactive" title="Fullscreen" aria-label="Fullscreen"></button>
            </div>
          </div>
        </header>

        <section class="notice-stack" id="notices"></section>

        <section class="board-wrap">
          <div class="board" id="board"></div>
        </section>
      </div>
    </div>

    <script>
      const COLUMNS = ["Backlog", "In Progress", "Review", "Done"];
      const state = {
        sessionId: "",
        repo: null,
        project: null,
        projectScopeReady: false,
        columns: COLUMNS.map((title) => ({ id: title, title, cards: [] })),
        counts: { Backlog: 0, "In Progress": 0, Review: 0, Done: 0 },
        updatedAt: "",
        warnings: [],
        error: "",
        statusText: "Connecting to host bridge…",
        renderInline: true,
        draggingIssueNumber: null,
        pendingCloseQueue: [],
        displayMode: "inline",
      };
      let authoritativeColumns = cloneColumns(state.columns);
      const pendingMoves = new Set();
      const pendingMoveQueue = [];
      let nextMoveToken = 1;
      let processingMoveQueue = false;
      let pendingRefreshTimer = 0;
      let pendingRefreshAttempt = 0;
      let activePointerDrag = null;
      let dragFrameHandle = 0;
      let queuedPointerPoint = null;
      let sessionSyncTimer = 0;
      let toolshedBridgeAttached = false;

      const initialTheme = new URLSearchParams(window.location.search).get('theme');
      const $title = document.getElementById("title");
      const $meta = document.getElementById("meta");
      const $notices = document.getElementById("notices");
      const $board = document.getElementById("board");
      const $refreshBtn = document.getElementById("refreshBtn");
      const $fullscreenBtn = document.getElementById("fullscreenBtn");

      function getOpenAI() {
        try {
          return window.openai || null;
        } catch {
          return null;
        }
      }

      function getToolshedApp() {
        try {
          return window.app || window.mcp?.app || null;
        } catch {
          return null;
        }
      }

      function getHostApp() {
        return getOpenAI() || getToolshedApp();
      }

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function updateTheme(theme) {
        if (theme === 'light') document.body.classList.add('light');
        else if (theme === 'dark') document.body.classList.remove('light');
      }

      updateTheme(initialTheme);

      function refreshIcon() {
        return [
          '<svg viewBox="0 0 24 24" aria-hidden="true">',
            '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path>',
            '<path d="M21 3v6h-6"></path>',
          '</svg>',
        ].join('');
      }

      function fullscreenIcon(mode) {
        if (mode === 'fullscreen') {
          return [
            '<svg viewBox="0 0 24 24" aria-hidden="true">',
              '<path d="M9 4H4v5"></path>',
              '<path d="M4 4l6 6"></path>',
              '<path d="M15 20h5v-5"></path>',
              '<path d="M20 20l-6-6"></path>',
              '<path d="M20 9V4h-5"></path>',
              '<path d="M20 4l-6 6"></path>',
              '<path d="M4 15v5h5"></path>',
              '<path d="M4 20l6-6"></path>',
            '</svg>',
          ].join('');
        }
        return [
          '<svg viewBox="0 0 24 24" aria-hidden="true">',
            '<path d="M9 4H4v5"></path>',
            '<path d="M15 4h5v5"></path>',
            '<path d="M20 15v5h-5"></path>',
            '<path d="M4 15v5h5"></path>',
          '</svg>',
        ].join('');
      }

      function syncHeaderActions() {
        if ($refreshBtn && !$refreshBtn.innerHTML) {
          $refreshBtn.innerHTML = refreshIcon();
        }
        if ($fullscreenBtn) {
          const isFullscreen = state.displayMode === "fullscreen";
          const label = isFullscreen ? "Exit viewport" : "Fullscreen";
          $fullscreenBtn.innerHTML = fullscreenIcon(state.displayMode);
          $fullscreenBtn.title = label;
          $fullscreenBtn.setAttribute("aria-label", label);
          $fullscreenBtn.setAttribute("data-state", isFullscreen ? "active" : "inactive");
        }
      }

      function initials(name) {
        const text = String(name || "?").trim();
        if (!text) return "?";
        return text.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      }

      function findIssueCardIn(columns, issueNumber) {
        for (const column of columns || []) {
          const match = (column.cards || []).find((card) => Number(card.number) === Number(issueNumber));
          if (match) return match;
        }
        return null;
      }

      function applyPayload(payload) {
        const next = payload?.structuredContent || payload || {};
        if (!next || typeof next !== "object") return;
        state.sessionId = next.sessionId || state.sessionId;
        state.repo = next.repo || state.repo;
        state.project = next.project || state.project;
        if (Array.isArray(next.columns)) {
          authoritativeColumns = cloneColumns(next.columns);
          settlePendingMoves(authoritativeColumns);
          recomputeDisplayedColumns();
        } else {
          state.columns = state.columns;
          state.counts = state.counts;
        }
        state.updatedAt = next.updatedAt || "";
        state.warnings = Array.isArray(next.warnings) ? next.warnings : [];
        state.error = next.error || "";
        state.projectScopeReady = Boolean(next.projectScopeReady);
        state.renderInline = Boolean(next.renderInline);
        if (!pendingMoveQueue.length) {
          if (pendingRefreshTimer) {
            clearTimeout(pendingRefreshTimer);
            pendingRefreshTimer = 0;
          }
          pendingRefreshAttempt = 0;
        }
        render();
        scheduleSessionSync();
      }

      function hydrateFromGlobals(globals) {
        if (!globals || typeof globals !== "object") return false;
        updateTheme(globals.theme);

        let updated = false;
        if (globals.widgetState) {
          applyPayload(globals.widgetState);
          updated = true;
        }
        if (globals.toolInput && !globals.toolOutput) {
          applyPayload(globals.toolInput);
          setStatus('Host attached');
          updated = true;
        }
        if (globals.toolOutput) {
          applyPayload({ structuredContent: globals.toolOutput });
          if (!hasPendingMoves()) setStatus('Board ready');
          updated = true;
        }
        return updated;
      }

      function attachToolshedBridge() {
        const app = getToolshedApp();
        if (!app || toolshedBridgeAttached) return Boolean(app);
        toolshedBridgeAttached = true;

        app.ondisplaymodechange = (detail) => {
          applyDisplayMode(detail?.mode);
        };
        app.ontoolinput = async (input) => {
          applyPayload(input);
          if (!hasPendingMoves()) setStatus('Board attached');
          attachDragHandlers();
        };

        app.ontoolresult = async (result) => {
          applyPayload(result);
          if (hasPendingMoves()) {
            setStatus('Saving board changes…');
            schedulePendingRefresh();
          } else {
            setStatus('Board ready');
          }
          attachDragHandlers();
          await syncModelContext();
        };

        return true;
      }

      function cloneColumns(columns) {
        return (columns || []).map((column) => ({
          ...column,
          cards: Array.isArray(column.cards) ? column.cards.map((card) => ({ ...card })) : [],
        }));
      }

      function countColumns(columns) {
        return {
          Backlog: columns.find((column) => column.id === "Backlog")?.cards?.length || 0,
          "In Progress": columns.find((column) => column.id === "In Progress")?.cards?.length || 0,
          Review: columns.find((column) => column.id === "Review")?.cards?.length || 0,
          Done: columns.find((column) => column.id === "Done")?.cards?.length || 0,
        };
      }

      function syncPendingMoveMarkers() {
        pendingMoves.clear();
        for (const move of pendingMoveQueue) pendingMoves.add(Number(move.issueNumber));
      }

      function queueDonePrompt(issueNumber) {
        const target = Number(issueNumber);
        if (!target || state.pendingCloseQueue.includes(target)) return;
        state.pendingCloseQueue.push(target);
        render();
      }

      function dropDonePrompt(issueNumber) {
        const target = Number(issueNumber);
        const nextQueue = state.pendingCloseQueue.filter((entry) => Number(entry) !== target);
        if (nextQueue.length === state.pendingCloseQueue.length) return;
        state.pendingCloseQueue = nextQueue;
        render();
      }

      function snapshotBoardState() {
        return {
          columns: cloneColumns(state.columns),
          counts: { ...state.counts },
        };
      }

      function restoreBoardState(snapshot) {
        if (!snapshot) return;
        state.columns = cloneColumns(snapshot.columns);
        state.counts = { ...snapshot.counts };
        render();
      }

      function findIssueColumnIn(columns, issueNumber) {
        for (const column of columns || []) {
          if ((column.cards || []).some((card) => Number(card.number) === Number(issueNumber))) return column.id;
        }
        return null;
      }

      function buildReorderedColumnsFor(columns, issueNumber, toColumn, afterIssueNumber) {
        const fromColumn = findIssueColumnIn(columns, issueNumber);
        if (!fromColumn) return null;
        const nextColumns = cloneColumns(columns);
        let movedCard = null;
        for (const column of nextColumns) {
          const cards = Array.isArray(column.cards) ? column.cards : [];
          const index = cards.findIndex((card) => Number(card.number) === Number(issueNumber));
          if (index >= 0) {
            movedCard = { ...cards[index], column: toColumn };
            cards.splice(index, 1);
            break;
          }
        }
        if (!movedCard) return null;
        const targetColumn = nextColumns.find((column) => column.id === toColumn);
        if (!targetColumn) return null;
        const targetCards = Array.isArray(targetColumn.cards) ? targetColumn.cards : [];
        let insertIndex = 0;
        if (typeof afterIssueNumber === "number") {
          const afterIndex = targetCards.findIndex((card) => Number(card.number) === Number(afterIssueNumber));
          insertIndex = afterIndex >= 0 ? afterIndex + 1 : targetCards.length;
        }
        targetCards.splice(insertIndex, 0, movedCard);
        return nextColumns;
      }

      function buildReorderedColumns(issueNumber, toColumn, afterIssueNumber) {
        return buildReorderedColumnsFor(state.columns, issueNumber, toColumn, afterIssueNumber);
      }

      function recomputeDisplayedColumns() {
        let nextColumns = cloneColumns(authoritativeColumns);
        for (const move of pendingMoveQueue) {
          const reordered = buildReorderedColumnsFor(nextColumns, move.issueNumber, move.toColumn, move.afterIssueNumber);
          if (reordered) nextColumns = reordered;
        }
        state.columns = nextColumns;
        state.counts = countColumns(nextColumns);
      }

      function moveSatisfiedByColumns(columns, move) {
        const targetColumn = columns.find((column) => column.id === move.toColumn);
        const cards = targetColumn?.cards || [];
        const issueIndex = cards.findIndex((card) => Number(card.number) === Number(move.issueNumber));
        if (issueIndex < 0) return false;
        if (typeof move.afterIssueNumber === "number") {
          const afterIndex = cards.findIndex((card) => Number(card.number) === Number(move.afterIssueNumber));
          return afterIndex >= 0 && issueIndex === afterIndex + 1;
        }
        return issueIndex === 0;
      }

      function settlePendingMoves(columns) {
        const latestMoveByIssue = new Map();
        for (const move of pendingMoveQueue) {
          latestMoveByIssue.set(Number(move.issueNumber), move);
        }
        const satisfiedIssues = new Set();
        for (const [issueNumber, move] of latestMoveByIssue.entries()) {
          if (moveSatisfiedByColumns(columns, move)) {
            satisfiedIssues.add(issueNumber);
          }
        }
        if (!satisfiedIssues.size) {
          syncPendingMoveMarkers();
          return;
        }
        for (let index = pendingMoveQueue.length - 1; index >= 0; index -= 1) {
          if (satisfiedIssues.has(Number(pendingMoveQueue[index].issueNumber))) {
            pendingMoveQueue.splice(index, 1);
          }
        }
        syncPendingMoveMarkers();
      }

	      function buildSessionSnapshot() {
	        function extractParentSprintNumber(body) {
	          const match = String(body || "").match(/parent sprint[^#]*#(\d+)/i);
	          return match ? Number(match[1]) : null;
	        }

	        function extractTaskBreakdownIssueNumbers(body) {
	          const text = String(body || "");
	          const sectionMatch = text.match(/##\s*Task Breakdown\s*([\s\S]*?)(?:\n##\s+|$)/i);
	          const target = sectionMatch ? sectionMatch[1] : "";
	          return Array.from(target.matchAll(/#(\d+)/g))
	            .map((match) => Number(match[1]))
	            .filter((value) => Number.isFinite(value));
	        }

	        function extractSprintOrdinal(title) {
	          const match = String(title || "").match(/\bsprint\s+(\d+)\b/i);
	          return match ? Number(match[1]) : null;
	        }

	        return {
	          sessionId: state.sessionId,
	          repo: state.repo ? { nameWithOwner: state.repo.nameWithOwner || "" } : null,
	          project: state.project ? { title: state.project.title || "", number: state.project.number ?? null } : null,
          projectScopeReady: Boolean(state.projectScopeReady),
          updatedAt: state.updatedAt || "",
          statusText: state.statusText || "",
	          columns: (state.columns || []).map((column) => ({
	            id: column.id,
	            title: column.title,
	            cards: Array.isArray(column.cards) ? column.cards.map((card, index) => ({
	              number: card.number,
	              title: card.title,
	              url: card.url,
	              column: column.id,
	              state: card.state,
	              labels: Array.isArray(card.labels) ? card.labels.map((label) => label?.name).filter(Boolean) : [],
	              type: typeof card.type === "string" && card.type ? card.type : (
	                Array.isArray(card.labels) && card.labels.some((label) => String(label?.name || "").toLowerCase() === "task")
	                  ? "task"
	                  : Array.isArray(card.labels) && card.labels.some((label) => String(label?.name || "").toLowerCase() === "epic")
	                    ? "epic"
	                    : Array.isArray(card.labels) && card.labels.some((label) => String(label?.name || "").toLowerCase() === "sprint")
	                      ? "sprint"
	                      : /^task\b/i.test(String(card.title || ""))
	                        ? "task"
	                        : /^epic\b/i.test(String(card.title || ""))
	                          ? "epic"
	                          : /^sprint\b/i.test(String(card.title || ""))
	                            ? "sprint"
	                            : "other"
	              ),
	              order: Number.isFinite(Number(card.order)) && Number(card.order) > 0 ? Number(card.order) : index + 1,
	              parentSprintNumber: extractParentSprintNumber(card.body),
	              taskBreakdownIssueNumbers: extractTaskBreakdownIssueNumbers(card.body),
	              sprintOrdinal: extractSprintOrdinal(card.title),
	            })) : [],
	          })),
	        };
	      }

      function scheduleSessionSync() {
        if (sessionSyncTimer) clearTimeout(sessionSyncTimer);
        sessionSyncTimer = window.setTimeout(async () => {
          sessionSyncTimer = 0;
          try {
            await host.syncToolshedSession({
              adapter: "github-project-kanban",
              title: state.project?.title || "GitHub Project Board",
              sessionId: state.sessionId || "",
              appState: buildSessionSnapshot(),
            });
          } catch {}
        }, 90);
      }

      function queueOptimisticMove(issueNumber, toColumn, afterIssueNumber) {
        const snapshot = snapshotBoardState();
        const nextColumns = buildReorderedColumns(issueNumber, toColumn, afterIssueNumber);
        if (!nextColumns) return null;
        const previousOrder = snapshot.columns.map((column) => column.cards.map((card) => Number(card.number)).join(",")).join("|");
        const nextOrder = nextColumns.map((column) => column.cards.map((card) => Number(card.number)).join(",")).join("|");
        if (previousOrder === nextOrder) return null;
        pendingMoveQueue.push({
          token: nextMoveToken++,
          issueNumber: Number(issueNumber),
          toColumn,
          afterIssueNumber: typeof afterIssueNumber === "number" ? afterIssueNumber : null,
          status: "queued",
        });
        syncPendingMoveMarkers();
        recomputeDisplayedColumns();
        render();
        return true;
      }

      function removePendingMovesForIssue(issueNumber) {
        for (let index = pendingMoveQueue.length - 1; index >= 0; index -= 1) {
          if (Number(pendingMoveQueue[index].issueNumber) === Number(issueNumber)) {
            pendingMoveQueue.splice(index, 1);
          }
        }
        dropDonePrompt(issueNumber);
        syncPendingMoveMarkers();
        recomputeDisplayedColumns();
        render();
      }

      function hasPendingMoves() {
        return pendingMoveQueue.length > 0;
      }

      async function requestTool(name, args) {
        const result = await host.callTool(name, args);
        applyPayload(result);
        await syncModelContext();
        return result;
      }

      function schedulePendingRefresh() {
        if (pendingRefreshTimer || processingMoveQueue || !hasPendingMoves() || !state.sessionId) return;
        const delayMs = Math.min(600 + pendingRefreshAttempt * 600, 3200);
        pendingRefreshTimer = window.setTimeout(async () => {
          pendingRefreshTimer = 0;
          pendingRefreshAttempt += 1;
          try {
            await requestTool('github_project_kanban_refresh', { sessionId: state.sessionId });
          } catch {}
          if (hasPendingMoves()) {
            setStatus('Saving board changes…');
            schedulePendingRefresh();
          } else {
            pendingRefreshAttempt = 0;
          }
        }, delayMs);
      }

      async function flushPendingMoveQueue() {
        if (processingMoveQueue) return;
        processingMoveQueue = true;
        try {
          while (true) {
            const move = pendingMoveQueue.find((entry) => entry.status === "queued");
            if (!move) break;
            move.status = "inflight";
            setStatus('Saving #' + move.issueNumber + '…');
            try {
              await requestTool('github_project_kanban_move_issue', {
                sessionId: state.sessionId,
                issueNumber: move.issueNumber,
                toColumn: move.toColumn,
                afterIssueNumber: typeof move.afterIssueNumber === "number" ? move.afterIssueNumber : null,
              });
              if (!pendingMoveQueue.includes(move)) continue;
              if (move.status === "inflight") {
                move.status = "settling";
              }
            } catch (error) {
              removePendingMovesForIssue(move.issueNumber);
              setStatus('Move failed: ' + (error?.message || String(error)));
            }
          }
        } finally {
          processingMoveQueue = false;
          if (hasPendingMoves()) {
            setStatus('Saving board changes…');
            schedulePendingRefresh();
          } else {
            pendingRefreshAttempt = 0;
          }
        }
      }

      function clearDropTargets() {
        if (activePointerDrag?.targetElement) {
          activePointerDrag.targetElement.classList.remove('drop-target');
          activePointerDrag.targetElement = null;
        }
        if (activePointerDrag?.targetCardElement && activePointerDrag?.targetCardHintClass) {
          activePointerDrag.targetCardElement.classList.remove(activePointerDrag.targetCardHintClass);
          activePointerDrag.targetCardElement = null;
          activePointerDrag.targetCardHintClass = null;
        }
      }

      function createDragGhost(card, rect) {
        const ghost = card.cloneNode(true);
        ghost.classList.remove('pending', 'drag-source');
        ghost.classList.add('drag-ghost');
        ghost.style.width = rect.width + 'px';
        ghost.style.height = rect.height + 'px';
        document.body.appendChild(ghost);
        return ghost;
      }

      function positionDragGhost(clientX, clientY) {
        if (!activePointerDrag?.ghost) return;
        const x = clientX - activePointerDrag.offsetX;
        const y = clientY - activePointerDrag.offsetY;
        activePointerDrag.ghost.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0)';
      }

      function updateDropTarget(clientX, clientY) {
        const zone = document.elementFromPoint(clientX, clientY)?.closest('[data-dropzone]');
        const targetColumn = zone?.getAttribute('data-dropzone') || null;
        const targetElement = targetColumn ? zone.closest('.column') : null;
        let targetCardElement = null;
        let targetCardHintClass = null;
        let afterIssueNumber = null;
        if (zone && targetColumn) {
          const columnCards = Array.from(zone.querySelectorAll('.card[data-issue-number]')).filter((card) => Number(card.getAttribute('data-issue-number')) !== Number(activePointerDrag?.issueNumber));
          let previousIssueNumber = null;
          for (const cardElement of columnCards) {
            const issueNumber = Number(cardElement.getAttribute('data-issue-number'));
            const rect = cardElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            targetCardElement = cardElement;
            if (clientY < midpoint) {
              afterIssueNumber = previousIssueNumber;
              targetCardHintClass = 'drop-before';
              break;
            }
            previousIssueNumber = issueNumber;
            afterIssueNumber = issueNumber;
            targetCardHintClass = 'drop-after';
          }
        }
        if (activePointerDrag?.targetElement !== targetElement) {
          clearDropTargets();
          if (targetElement) targetElement.classList.add('drop-target');
          if (activePointerDrag) activePointerDrag.targetElement = targetElement;
        }
        if (activePointerDrag?.targetCardElement !== targetCardElement || activePointerDrag?.targetCardHintClass !== targetCardHintClass) {
          if (activePointerDrag?.targetCardElement && activePointerDrag?.targetCardHintClass) {
            activePointerDrag.targetCardElement.classList.remove(activePointerDrag.targetCardHintClass);
          }
          if (targetCardElement && targetCardHintClass) targetCardElement.classList.add(targetCardHintClass);
          if (activePointerDrag) {
            activePointerDrag.targetCardElement = targetCardElement;
            activePointerDrag.targetCardHintClass = targetCardHintClass;
          }
        }
        if (activePointerDrag) {
          activePointerDrag.targetColumn = targetColumn;
          activePointerDrag.afterIssueNumber = afterIssueNumber;
        }
        return targetColumn;
      }

      function autoScrollBoardDuringDrag(clientX) {
        const rect = $board.getBoundingClientRect();
        if (!rect.width) return;
        const edgePadding = 96;
        if (clientX < rect.left + edgePadding) {
          $board.scrollLeft -= 18;
        } else if (clientX > rect.right - edgePadding) {
          $board.scrollLeft += 18;
        }
      }

      function cleanupPointerDrag() {
        if (!activePointerDrag) return null;
        const drag = activePointerDrag;
        activePointerDrag = null;
        if (dragFrameHandle) {
          cancelAnimationFrame(dragFrameHandle);
          dragFrameHandle = 0;
        }
        queuedPointerPoint = null;
        state.draggingIssueNumber = null;
        try {
          drag.handle?.releasePointerCapture?.(drag.pointerId);
        } catch {}
        drag.card?.classList.remove('drag-source');
        drag.ghost?.remove();
        clearDropTargets();
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        return drag;
      }

      function flushPointerDragFrame() {
        dragFrameHandle = 0;
        if (!activePointerDrag || !queuedPointerPoint) return;
        const { clientX, clientY } = queuedPointerPoint;
        positionDragGhost(clientX, clientY);
        autoScrollBoardDuringDrag(clientX);
        updateDropTarget(clientX, clientY);
      }

      function schedulePointerDragFrame(clientX, clientY) {
        queuedPointerPoint = { clientX, clientY };
        if (dragFrameHandle) return;
        dragFrameHandle = requestAnimationFrame(flushPointerDragFrame);
      }

      function beginPointerDrag(handle, event) {
        if (!state.projectScopeReady) return;
        if (event.button !== 0) return;
        const issueNumber = Number(handle.getAttribute('data-drag-issue'));
        const card = handle.closest('.card');
        const fromColumn = findIssueColumn(issueNumber);
        if (!issueNumber || !card || !fromColumn) return;
        const rect = card.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        event.preventDefault();
        cleanupPointerDrag();
        const ghost = createDragGhost(card, rect);
        activePointerDrag = {
          issueNumber,
          pointerId: event.pointerId,
          fromColumn,
          targetColumn: fromColumn,
          afterIssueNumber: null,
          handle,
          card,
          ghost,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
        };
        state.draggingIssueNumber = issueNumber;
        card.classList.add('drag-source');
        try {
          handle.setPointerCapture?.(event.pointerId);
        } catch {}
        schedulePointerDragFrame(event.clientX, event.clientY);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerCancel);
        setStatus('Drag #' + issueNumber + ' to a lane');
      }

      function onPointerMove(event) {
        if (!activePointerDrag || event.pointerId !== activePointerDrag.pointerId) return;
        schedulePointerDragFrame(event.clientX, event.clientY);
      }

      async function finalizePointerDrag(event, cancelled) {
        if (!activePointerDrag || event.pointerId !== activePointerDrag.pointerId) return;
        queuedPointerPoint = { clientX: event.clientX, clientY: event.clientY };
        flushPointerDragFrame();
        const drag = cleanupPointerDrag();
        if (!drag) return;
        if (cancelled) {
          setStatus('Move cancelled');
          return;
        }
        const toColumn = drag.targetColumn;
        if (!toColumn) {
          setStatus('#' + drag.issueNumber + ' stayed in ' + drag.fromColumn);
          return;
        }
        if (toColumn === drag.fromColumn) {
          const currentColumn = state.columns.find((column) => column.id === drag.fromColumn);
          const cards = currentColumn?.cards || [];
          const currentIndex = cards.findIndex((card) => Number(card.number) === Number(drag.issueNumber));
          const afterIndex = typeof drag.afterIssueNumber === 'number'
            ? cards.findIndex((card) => Number(card.number) === Number(drag.afterIssueNumber))
            : -1;
          if (afterIndex === currentIndex - 1 || (afterIndex === -1 && currentIndex === 0)) {
            setStatus('#' + drag.issueNumber + ' stayed in place');
            return;
          }
        }
        await moveCard(drag.issueNumber, toColumn, drag.afterIssueNumber);
      }

      async function onPointerUp(event) {
        await finalizePointerDrag(event, false);
      }

      async function onPointerCancel(event) {
        await finalizePointerDrag(event, true);
      }

      function render() {
        const repoName = state.repo?.nameWithOwner || "Current repository";
        $title.textContent = (state.project?.title || "GitHub") + " - Project Board";
        syncHeaderActions();

        const meta = [];
        meta.push('<span class="chip">' + escapeHtml(repoName) + '</span>');
        if (state.updatedAt) meta.push('<span class="chip">Updated ' + escapeHtml(new Date(state.updatedAt).toLocaleTimeString()) + '</span>');
        if (state.statusText) meta.push('<span class="chip meta-status" id="statusText">' + escapeHtml(state.statusText) + '</span>');
        if (!state.projectScopeReady) meta.push('<span class="chip">Read-only fallback</span>');
        $meta.innerHTML = meta.join("");

        const notices = [];
        const pendingDoneIssue = state.pendingCloseQueue[0];
        if (typeof pendingDoneIssue === "number") {
          const doneCard = findIssueCardIn(state.columns, pendingDoneIssue) || findIssueCardIn(authoritativeColumns, pendingDoneIssue);
          const extraCount = Math.max(state.pendingCloseQueue.length - 1, 0);
          const extraLabel = extraCount > 0 ? ' +' + extraCount + ' more ready to close' : '';
          notices.push([
            '<div class="notice done-prompt">',
              '<div class="notice-copy">',
                '<strong>#' + escapeHtml(pendingDoneIssue) + ' moved to Done</strong>',
                '<span>' + escapeHtml(doneCard?.title || 'Close this issue on GitHub?') + escapeHtml(extraLabel) + '</span>',
              '</div>',
              '<div class="notice-actions">',
                '<button class="ui-button" data-variant="secondary" data-done-action="keep" data-issue-number="' + escapeHtml(pendingDoneIssue) + '">Keep open</button>',
                '<button class="ui-button" data-variant="outline" data-done-action="close" data-issue-number="' + escapeHtml(pendingDoneIssue) + '">Close issue</button>',
              '</div>',
            '</div>',
          ].join(''));
        }
        if (state.error) notices.push('<div class="notice error">' + escapeHtml(state.error) + '</div>');
        for (const warning of state.warnings || []) notices.push('<div class="notice warning">' + escapeHtml(warning) + '</div>');
        $notices.innerHTML = notices.join("");

        $board.innerHTML = (state.columns || []).map((column) => {
          const cards = Array.isArray(column.cards) ? column.cards : [];
          const emptyLabel = state.projectScopeReady ? 'Drop a card here' : 'No cards';
          return [
            '<div class="column" data-column="' + escapeHtml(column.id) + '">',
              '<div class="column-shell">',
                '<div class="column-head">',
                  '<div class="column-title">' + escapeHtml(column.title) + '</div>',
                  '<div class="column-count">' + escapeHtml(cards.length) + '</div>',
                '</div>',
                '<div class="column-body" data-dropzone="' + escapeHtml(column.id) + '">',
                  cards.length
                    ? cards.map(renderCard).join("")
                    : '<div class="empty">' + emptyLabel + '</div>',
                '</div>',
              '</div>',
            '</div>'
          ].join("");
        }).join("");
      }

      function renderCard(card) {
        const labels = Array.isArray(card.labels) ? card.labels : [];
        const assignees = Array.isArray(card.assignees) ? card.assignees : [];
        const canMove = Boolean(state.projectScopeReady);
        const pending = pendingMoves.has(Number(card.number));
        const metaBits = [String(card.state || 'OPEN').toUpperCase()];
        if (card.updatedAt) metaBits.push(new Date(card.updatedAt).toLocaleDateString());
        return [
          '<article class="card' + (canMove ? ' movable' : '') + (pending ? ' pending' : '') + '" draggable="false" data-issue-number="' + escapeHtml(card.number) + '">',
            '<div class="card-top">',
              '<div class="card-main">',
                '<a class="issue-ref" href="' + escapeHtml(card.url) + '" data-open-link="' + escapeHtml(card.url) + '">#' + escapeHtml(card.number) + '</a>',
                '<div class="issue-title">' + escapeHtml(card.title) + '</div>',
                '<div class="issue-meta-line">' + escapeHtml(metaBits.join(' · ')) + '</div>',
              '</div>',
              canMove
                ? '<button type="button" class="drag-handle" data-drag-issue="' + escapeHtml(card.number) + '" aria-label="Move issue #' + escapeHtml(card.number) + '" title="Drag to move">⋮⋮</button>'
                : '',
            '</div>',
            labels.length ? '<div class="labels">' + labels.slice(0, 5).map((label) => '<span class="label">' + escapeHtml(label.name) + '</span>').join('') + '</div>' : '',
            assignees.length ? '<div class="assignees">' + assignees.slice(0, 6).map((assignee) => {
              const avatar = assignee.avatarUrl
                ? '<img src="' + escapeHtml(assignee.avatarUrl) + '" alt="' + escapeHtml(assignee.login) + '" />'
                : escapeHtml(initials(assignee.name || assignee.login));
              return '<a class="avatar" href="' + escapeHtml(assignee.url || '#') + '" title="' + escapeHtml(assignee.login) + '" data-open-link="' + escapeHtml(assignee.url || '') + '">' + avatar + '</a>';
            }).join('') + '</div>' : '',
          '</article>'
        ].join('');
      }

      function setStatus(text) {
        state.statusText = text;
        const node = document.getElementById("statusText");
        if (node) node.textContent = text;
      }

      function applyDisplayMode(mode) {
        state.displayMode = mode === "fullscreen" ? "fullscreen" : "inline";
        render();
      }

      async function syncModelContext() {
        try {
          const summary = state.columns.map((column) => column.title + ': ' + (column.cards?.length || 0)).join(' · ');
          await host.updateModelContext({ text: 'GitHub Project Kanban Board for ' + (state.repo?.nameWithOwner || 'current repo') + '. ' + summary + '.' });
        } catch {}
      }

      async function callTool(name, args, successText) {
        const result = await requestTool(name, args);
        if (successText) setStatus(successText);
        return result;
      }

      async function refreshBoard() {
        if (!state.sessionId) return;
        setStatus('Refreshing board…');
        try {
          await callTool('github_project_kanban_refresh', { sessionId: state.sessionId }, 'Board refreshed');
        } catch (error) {
          setStatus('Refresh failed: ' + (error?.message || String(error)));
        }
      }

      async function moveCard(issueNumber, toColumn, afterIssueNumber) {
        if (!state.sessionId) return;
        if (!state.projectScopeReady) {
          setStatus('Project scopes are missing. Board is read-only until gh auth is refreshed.');
          return;
        }
        const queued = queueOptimisticMove(issueNumber, toColumn, afterIssueNumber);
        if (!queued) return;
        if (toColumn === 'Done') {
          queueDonePrompt(issueNumber);
        } else {
          dropDonePrompt(issueNumber);
        }
        setStatus('Moving #' + issueNumber + ' to ' + toColumn + (typeof afterIssueNumber === 'number' ? ' after #' + afterIssueNumber : ' at the top') + '…');
        scheduleSessionSync();
        flushPendingMoveQueue();
      }

      async function closeIssue(issueNumber) {
        if (!state.sessionId) return;
        setStatus('Closing issue #' + issueNumber + '…');
        try {
          await callTool('github_project_kanban_close_issue', { sessionId: state.sessionId, issueNumber }, 'Issue #' + issueNumber + ' closed');
        } catch (error) {
          setStatus('Close failed: ' + (error?.message || String(error)));
        }
      }

      function attachDragHandlers() {
        if (!state.projectScopeReady) return;
        $board.querySelectorAll('[data-drag-issue]').forEach((handle) => {
          if (handle.dataset.boundPointer === 'true') return;
          handle.dataset.boundPointer = 'true';
          handle.addEventListener('pointerdown', (event) => beginPointerDrag(handle, event));
        });

        $board.querySelectorAll('[data-move-issue]').forEach((select) => {
          if (select.dataset.boundMove === 'true') return;
          select.dataset.boundMove = 'true';
          select.addEventListener('change', async () => {
            const issueNumber = Number(select.getAttribute('data-move-issue'));
            const toColumn = select.value;
            const currentColumn = findIssueColumn(issueNumber);
            if (!issueNumber || !toColumn || currentColumn === toColumn) return;
            await moveCard(issueNumber, toColumn, null);
          });
        });
      }

      function findIssueColumn(issueNumber) {
        return findIssueColumnIn(state.columns, issueNumber);
      }

      syncHeaderActions();

      $refreshBtn.addEventListener('click', refreshBoard);
      $fullscreenBtn.addEventListener('click', async () => {
        const previousMode = state.displayMode;
        const nextMode = previousMode === 'fullscreen' ? 'inline' : 'fullscreen';
        try {
          applyDisplayMode(nextMode);
          await host.requestDisplayMode({ mode: nextMode });
        } catch (error) {
          applyDisplayMode(previousMode);
          setStatus('Fullscreen unavailable: ' + (error?.message || String(error)));
        }
      });

      $board.addEventListener('click', async (event) => {
        const link = event.target.closest('[data-open-link]');
        if (!link) return;
        const href = link.getAttribute('data-open-link');
        if (!href) return;
        event.preventDefault();
        try {
          await host.openLink({ url: href });
          return;
        } catch {}
        window.open(href, '_blank', 'noopener,noreferrer');
      });

      $notices.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-done-action]');
        if (!action) return;
        const issueNumber = Number(action.getAttribute('data-issue-number'));
        if (!issueNumber) return;
        const mode = action.getAttribute('data-done-action');
        dropDonePrompt(issueNumber);
        if (mode === 'close') {
          await closeIssue(issueNumber);
        } else {
          setStatus('Done status saved. Issue left open.');
        }
      });

      function hydrateCurrentHostState() {
        const openai = getOpenAI();
        const hasOpenAIGlobals = Boolean(openai && (openai.toolInput || openai.toolOutput || openai.widgetState));
        if (hasOpenAIGlobals) {
          const updated = hydrateFromGlobals({
            theme: openai.theme,
            widgetState: openai.widgetState,
            toolInput: openai.toolInput,
            toolOutput: openai.toolOutput,
          });
          if (updated) attachDragHandlers();
          return updated || Boolean(openai.toolInput || openai.toolOutput || openai.widgetState);
        }

        if (attachToolshedBridge()) {
          return true;
        }

        if (openai?.theme) updateTheme(openai.theme);

        return false;
      }

      const sharedHost = window.__toolshedHostRuntime?.createHostRuntime({
        updateTheme,
        applyGlobals(globals) {
          const updated = hydrateFromGlobals(globals);
          if (updated) attachDragHandlers();
          return updated;
        },
        onDisplayMode(detail) {
          applyDisplayMode(detail?.mode);
        },
        onUnavailable() {
          if (!state.sessionId && !getOpenAI() && !getToolshedApp()) {
            setStatus('Host bridge unavailable.');
          }
        },
      }) || null;

      const host = {
        hydrateCurrentState: hydrateCurrentHostState,
        async callTool(name, args) {
          const openai = getOpenAI();
          if (openai?.callTool) {
            return await openai.callTool(name, args);
          }
          const app = getToolshedApp();
          if (!app?.callServerTool) return null;
          return await app.callServerTool({ name, arguments: args });
        },
        async syncToolshedSession(input) {
          const app = getToolshedApp();
          if (!app?.syncToolshedSession) return { ok: false };
          return await app.syncToolshedSession(input);
        },
        async updateModelContext(input) {
          const app = getHostApp();
          if (!app?.updateModelContext) return null;
          return await app.updateModelContext(input);
        },
        async requestDisplayMode(input) {
          const app = getHostApp();
          if (!app?.requestDisplayMode) throw new Error('Display mode bridge unavailable.');
          return await app.requestDisplayMode(input);
        },
        async openLink(input) {
          if (sharedHost?.openLink) return await sharedHost.openLink(input);
          const app = getHostApp();
          if (app?.openLink) return await app.openLink(input);
          if (input && input.url) window.open(input.url, '_blank', 'noopener,noreferrer');
          return { ok: true };
        },
        attachEventListeners() {
          window.addEventListener('toolshed-display-mode', (event) => {
            applyDisplayMode(event?.detail?.mode);
          });

          window.addEventListener('openai:set_globals', (event) => {
            const updated = hydrateFromGlobals(event.detail?.globals || {});
            if (updated) attachDragHandlers();
          }, { passive: true });
        },
        onUnavailable() {
          if (!state.sessionId && !getOpenAI() && !getToolshedApp()) {
            setStatus('Host bridge unavailable.');
          }
        },
        bootstrap() {
          host.attachEventListeners();
          const ready = host.hydrateCurrentState();
          if (!ready) {
            setStatus('Waiting for host bridge…');
          }
          let bootstrapAttempts = 0;
          const bootstrapTimer = setInterval(() => {
            bootstrapAttempts += 1;
            if (host.hydrateCurrentState() || bootstrapAttempts >= 20) {
              clearInterval(bootstrapTimer);
              if (bootstrapAttempts >= 20) host.onUnavailable();
            }
          }, 100);
          return ready;
        },
      };

      const observer = new MutationObserver(() => attachDragHandlers());
      observer.observe($board, { childList: true, subtree: true });
      render();

      host.bootstrap();
    </script>
  </body>
</html>`;
