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
        --card-radius: 16px;
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

      .identity p {
        margin: 6px 0 0;
        color: var(--text-muted);
        max-width: none;
        line-height: 1.45;
      }

      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 10px;
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

      .actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
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
        padding: 10px 22px 56px;
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

      .column.drag-over .column-shell {
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
        border: 1px solid color-mix(in oklch, var(--foreground) 8%, transparent);
        background: linear-gradient(180deg, color-mix(in oklch, var(--card) 92%, transparent 8%), color-mix(in oklch, var(--card) 80%, var(--background) 20%));
        border-radius: var(--card-radius);
        padding: 14px;
        box-shadow: 0 10px 24px color-mix(in oklch, var(--background) 28%, transparent);
        display: flex;
        flex-direction: column;
        gap: 10px;
        user-select: none;
      }

      .card[draggable="true"] { cursor: grab; }
      .card.dragging { opacity: 0.5; transform: scale(0.99); }

      .card-top {
        display: flex;
        gap: 10px;
        align-items: start;
        justify-content: space-between;
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
      }

      .card-meta,
      .labels,
      .assignees {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .mini {
        font-size: 11px;
        color: var(--text-muted);
        border: 1px solid color-mix(in oklch, var(--foreground) 6%, transparent);
        border-radius: 999px;
        padding: 5px 8px;
      }

      .label {
        font-size: 11px;
        border-radius: 999px;
        padding: 5px 8px;
        border: 1px solid color-mix(in oklch, var(--foreground) 8%, transparent);
        background: color-mix(in oklch, var(--foreground) 3%, transparent);
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

      .statusbar {
        position: absolute;
        left: 22px;
        right: 22px;
        bottom: 14px;
        display: flex;
        justify-content: center;
        pointer-events: none;
      }

      .statuspill {
        pointer-events: auto;
        border-radius: 999px;
        padding: 9px 14px;
        background: color-mix(in oklch, var(--background) 78%, transparent);
        border: 1px solid color-mix(in oklch, var(--foreground) 9%, transparent);
        color: var(--text-muted);
        backdrop-filter: blur(12px);
        font-size: 12px;
      }

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
        .actions { justify-content: flex-start; }
        .header { padding: 16px 14px 10px; }
        .notice-stack { padding: 0 14px 10px; }
        .board { padding: 8px 14px 52px; }
        .column { flex-basis: min(88vw, 320px); }
        .statusbar { left: 14px; right: 14px; }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="shell">
        <header class="header">
          <div class="identity">
            <h1 id="title">GitHub Project Kanban Board</h1>
            <p id="description">Loading project…</p>
            <div class="meta" id="meta"></div>
          </div>
          <div class="actions">
            <button id="refreshBtn" class="ui-button" data-variant="secondary">Refresh</button>
            <button id="fullscreenBtn" class="ui-button" data-variant="outline" data-state="inactive">Fullscreen</button>
          </div>
        </header>

        <section class="notice-stack" id="notices"></section>

        <section class="board-wrap">
          <div class="board" id="board"></div>
          <div class="statusbar"><div class="statuspill" id="status">Connecting to host bridge…</div></div>
        </section>
      </div>
    </div>

    <div class="modal-backdrop" id="modalBackdrop" aria-hidden="true">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h2 id="modalTitle">Close issue?</h2>
        <p id="modalText">Would you like to close this issue on GitHub too?</p>
        <div class="modal-actions">
          <button id="modalSkip" class="ui-button" data-variant="secondary">Keep issue open</button>
          <button id="modalConfirm" class="ui-button" data-variant="outline">Close issue</button>
        </div>
      </div>
    </div>

    <script>
      const COLUMNS = ["Backlog", "In Progress", "Review", "Done"];
      const state = {
        sessionId: "",
        repo: null,
        project: null,
        columns: COLUMNS.map((title) => ({ id: title, title, cards: [] })),
        counts: { Backlog: 0, "In Progress": 0, Review: 0, Done: 0 },
        updatedAt: "",
        warnings: [],
        error: "",
        renderInline: true,
        draggingIssueNumber: null,
        pendingClose: null,
        displayMode: "inline",
      };

      const app = window.openai || window.app || window.mcp?.app;
      const initialTheme = new URLSearchParams(window.location.search).get('theme');
      if (initialTheme === 'light') {
        document.body.classList.add('light');
      }
      const $title = document.getElementById("title");
      const $description = document.getElementById("description");
      const $meta = document.getElementById("meta");
      const $notices = document.getElementById("notices");
      const $board = document.getElementById("board");
      const $status = document.getElementById("status");
      const $fullscreenBtn = document.getElementById("fullscreenBtn");
      const $modalBackdrop = document.getElementById("modalBackdrop");
      const $modalText = document.getElementById("modalText");

      function escapeHtml(value) {
        return String(value || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function initials(name) {
        const text = String(name || "?").trim();
        if (!text) return "?";
        return text.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
      }

      function applyPayload(payload) {
        const next = payload?.structuredContent || payload || {};
        if (!next || typeof next !== "object") return;
        state.sessionId = next.sessionId || state.sessionId;
        state.repo = next.repo || state.repo;
        state.project = next.project || state.project;
        state.columns = Array.isArray(next.columns) ? next.columns : state.columns;
        state.counts = next.counts || state.counts;
        state.updatedAt = next.updatedAt || "";
        state.warnings = Array.isArray(next.warnings) ? next.warnings : [];
        state.error = next.error || "";
        state.renderInline = Boolean(next.renderInline);
        render();
      }

      function render() {
        const repoName = state.repo?.nameWithOwner || "Current repository";
        const repoDescription = state.project?.shortDescription || state.repo?.description || "GitHub project board for the current repo.";
        $title.textContent = state.project?.title || "GitHub Project Kanban Board";
        $description.textContent = repoDescription;
        $fullscreenBtn.textContent = state.displayMode === "fullscreen" ? "Exit viewport" : "Fullscreen";
        $fullscreenBtn.setAttribute("data-state", state.displayMode === "fullscreen" ? "active" : "inactive");

        const meta = [];
        meta.push('<span class="chip">' + escapeHtml(repoName) + '</span>');
        if (state.project?.number) meta.push('<span class="chip">Project #' + escapeHtml(state.project.number) + '</span>');
        if (state.updatedAt) meta.push('<span class="chip">Updated ' + escapeHtml(new Date(state.updatedAt).toLocaleTimeString()) + '</span>');
        if (!state.projectScopeReady) meta.push('<span class="chip">Read-only fallback</span>');
        meta.push('<span class="chip">Open issues sync</span>');
        $meta.innerHTML = meta.join("");

        const notices = [];
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
        const draggable = state.projectScopeReady ? 'true' : 'false';
        return [
          '<article class="card" draggable="' + draggable + '" data-issue-number="' + escapeHtml(card.number) + '">',
            '<div class="card-top">',
              '<div>',
                '<a class="issue-ref" href="' + escapeHtml(card.url) + '" data-open-link="' + escapeHtml(card.url) + '">#' + escapeHtml(card.number) + '</a>',
                '<div class="issue-title">' + escapeHtml(card.title) + '</div>',
              '</div>',
            '</div>',
            '<div class="card-meta">',
              '<span class="mini">' + escapeHtml(card.state || 'OPEN') + '</span>',
              card.updatedAt ? '<span class="mini">' + escapeHtml(new Date(card.updatedAt).toLocaleDateString()) + '</span>' : '',
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
        $status.textContent = text;
      }

      function applyDisplayMode(mode) {
        state.displayMode = mode === "fullscreen" ? "fullscreen" : "inline";
        render();
      }

      async function syncModelContext() {
        if (!app?.updateModelContext) return;
        try {
          const summary = state.columns.map((column) => column.title + ': ' + (column.cards?.length || 0)).join(' · ');
          await app.updateModelContext({ text: 'GitHub Project Kanban Board for ' + (state.repo?.nameWithOwner || 'current repo') + '. ' + summary + '.' });
        } catch {}
      }

      async function callTool(name, args, successText) {
        if (!app?.callServerTool) return null;
        const result = await app.callServerTool({ name, arguments: args });
        applyPayload(result);
        if (successText) setStatus(successText);
        await syncModelContext();
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

      async function moveCard(issueNumber, toColumn) {
        if (!state.sessionId) return;
        if (!state.projectScopeReady) {
          setStatus('Project scopes are missing. Board is read-only until gh auth is refreshed.');
          return;
        }
        setStatus('Moving #' + issueNumber + ' to ' + toColumn + '…');
        try {
          await callTool('github_project_kanban_move_issue', { sessionId: state.sessionId, issueNumber, toColumn }, '#' + issueNumber + ' moved to ' + toColumn);
          if (toColumn === 'Done') openDoneModal(issueNumber);
        } catch (error) {
          setStatus('Move failed: ' + (error?.message || String(error)));
        }
      }

      function openDoneModal(issueNumber) {
        state.pendingClose = issueNumber;
        $modalText.textContent = 'Issue #' + issueNumber + ' is now in Done. Close it on GitHub too?';
        $modalBackdrop.classList.add('open');
        $modalBackdrop.setAttribute('aria-hidden', 'false');
      }

      function closeDoneModal() {
        state.pendingClose = null;
        $modalBackdrop.classList.remove('open');
        $modalBackdrop.setAttribute('aria-hidden', 'true');
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
        $board.querySelectorAll('.card[draggable="true"]').forEach((card) => {
          card.addEventListener('dragstart', (event) => {
            const issueNumber = Number(card.getAttribute('data-issue-number'));
            state.draggingIssueNumber = issueNumber;
            card.classList.add('dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(issueNumber));
          });
          card.addEventListener('dragend', () => {
            state.draggingIssueNumber = null;
            card.classList.remove('dragging');
            document.querySelectorAll('.column').forEach((column) => column.classList.remove('drag-over'));
          });
        });

        $board.querySelectorAll('[data-dropzone]').forEach((zone) => {
          zone.addEventListener('dragover', (event) => {
            event.preventDefault();
            zone.closest('.column')?.classList.add('drag-over');
          });
          zone.addEventListener('dragleave', () => {
            zone.closest('.column')?.classList.remove('drag-over');
          });
          zone.addEventListener('drop', async (event) => {
            event.preventDefault();
            const toColumn = zone.getAttribute('data-dropzone');
            const issueNumber = state.draggingIssueNumber || Number(event.dataTransfer.getData('text/plain'));
            zone.closest('.column')?.classList.remove('drag-over');
            if (!issueNumber || !toColumn) return;
            const currentColumn = findIssueColumn(issueNumber);
            if (currentColumn === toColumn) return;
            await moveCard(issueNumber, toColumn);
          });
        });
      }

      function findIssueColumn(issueNumber) {
        for (const column of state.columns || []) {
          if ((column.cards || []).some((card) => Number(card.number) === Number(issueNumber))) return column.id;
        }
        return null;
      }

      document.getElementById('refreshBtn').addEventListener('click', refreshBoard);
      $fullscreenBtn.addEventListener('click', async () => {
        if (!app?.requestDisplayMode) return;
        const previousMode = state.displayMode;
        const nextMode = previousMode === 'fullscreen' ? 'inline' : 'fullscreen';
        try {
          applyDisplayMode(nextMode);
          await app.requestDisplayMode({ mode: nextMode });
        } catch (error) {
          applyDisplayMode(previousMode);
          setStatus('Fullscreen unavailable: ' + (error?.message || String(error)));
        }
      });

      document.getElementById('modalSkip').addEventListener('click', () => {
        closeDoneModal();
        setStatus('Done status saved. Issue left open.');
      });

      document.getElementById('modalConfirm').addEventListener('click', async () => {
        const issueNumber = state.pendingClose;
        closeDoneModal();
        if (!issueNumber) return;
        await closeIssue(issueNumber);
      });

      $modalBackdrop.addEventListener('click', (event) => {
        if (event.target === $modalBackdrop) closeDoneModal();
      });

      $board.addEventListener('click', async (event) => {
        const link = event.target.closest('[data-open-link]');
        if (!link) return;
        const href = link.getAttribute('data-open-link');
        if (!href) return;
        event.preventDefault();
        if (app?.openLink) {
          try {
            await app.openLink({ url: href });
            return;
          } catch {}
        }
        window.open(href, '_blank', 'noopener,noreferrer');
      });

      if (app) {
        app.ondisplaymodechange = (detail) => {
          applyDisplayMode(detail?.mode);
        };
        app.ontoolinput = async (input) => {
          applyPayload(input);
          setStatus('Board attached');
          attachDragHandlers();
        };

        app.ontoolresult = async (result) => {
          applyPayload(result);
          setStatus('Board ready');
          attachDragHandlers();
          await syncModelContext();
        };
      } else {
        setStatus('Host bridge unavailable. Open this from Pi Toolshed.');
      }

      window.addEventListener('toolshed-display-mode', (event) => {
        applyDisplayMode(event?.detail?.mode);
      });

      const observer = new MutationObserver(() => attachDragHandlers());
      observer.observe($board, { childList: true, subtree: true });
      render();
    </script>
  </body>
</html>`;
