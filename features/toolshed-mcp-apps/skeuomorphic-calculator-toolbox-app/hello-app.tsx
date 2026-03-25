export const helloHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Toolshed Hello World</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(236, 72, 153, 0.24), transparent 32%),
          radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.26), transparent 28%),
          linear-gradient(180deg, #111827 0%, #030712 100%);
        color: #f9fafb;
      }

      .card {
        width: min(100%, 680px);
        border-radius: 28px;
        padding: 28px;
        background: rgba(17, 24, 39, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow:
          0 20px 70px rgba(15, 23, 42, 0.42),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #fbcfe8;
        background: rgba(236, 72, 153, 0.14);
        border: 1px solid rgba(244, 114, 182, 0.28);
      }

      h1 {
        margin: 18px 0 10px;
        font-size: clamp(42px, 9vw, 72px);
        line-height: 0.95;
        letter-spacing: -0.05em;
      }

      p {
        margin: 0;
        font-size: 18px;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.92);
      }

      .meta {
        margin-top: 18px;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.68);
      }

      code {
        font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.95em;
        padding: 2px 6px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
      }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="badge">Toolshed MCP Demo</div>
      <h1>Hello world</h1>
      <p id="message">If you can read this panel, ChatGPT rendered a custom widget served by your MCP server.</p>
      <p class="meta" id="openedAt">Waiting for tool payload…</p>
      <p class="meta">Expected tool: <code>open_toolshed_hello_world_demo</code></p>
    </main>

    <script>
      const $message = document.getElementById("message");
      const $openedAt = document.getElementById("openedAt");

      function applyPayload(payload) {
        const source = payload?.structuredContent || payload || null;
        if (!source || typeof source !== "object") return;

        if (source.message) {
          $message.textContent = String(source.message);
        }

        if (source.openedAt) {
          const openedAt = new Date(source.openedAt);
          $openedAt.textContent = Number.isNaN(openedAt.getTime())
            ? String(source.openedAt)
            : "Opened at " + openedAt.toLocaleString();
        }
      }

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

      const openai = getOpenAI();
      if (openai?.widgetState) {
        applyPayload(openai.widgetState);
      }
      if (openai?.toolOutput) {
        applyPayload({ structuredContent: openai.toolOutput });
      }

      const toolshedApp = getToolshedApp();
      if (toolshedApp) {
        toolshedApp.ontoolinput = (input) => applyPayload(input);
        toolshedApp.ontoolresult = (result) => applyPayload(result);
      }

      window.addEventListener("openai:set_globals", (event) => {
        const globals = event.detail?.globals || {};
        if (globals.widgetState) applyPayload(globals.widgetState);
        if (globals.toolOutput) applyPayload({ structuredContent: globals.toolOutput });
      }, { passive: true });
    </script>
  </body>
</html>`;
