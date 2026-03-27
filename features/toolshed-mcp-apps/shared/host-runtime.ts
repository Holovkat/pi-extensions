export const hostRuntimeScript = String.raw`<script>
  (function(){
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

    function normalizeMessageText(input) {
      if (!input) return "";
      if (typeof input === "string") return input.trim();
      if (typeof input.prompt === "string" && input.prompt.trim()) return input.prompt.trim();
      if (typeof input.text === "string" && input.text.trim()) return input.text.trim();
      if (Array.isArray(input.content)) {
        return input.content
          .map((item) => item && item.type === "text" ? String(item.text || "") : "")
          .join("\n")
          .trim();
      }
      if (typeof input.content === "string") return input.content.trim();
      return "";
    }

    function getInitialTheme() {
      try {
        return new URLSearchParams(window.location.search).get("theme") || "";
      } catch {
        return "";
      }
    }

    function createHostRuntime(config) {
      const options = config && typeof config === "object" ? config : {};
      let legacyBridgeAttached = false;
      let globalsListenerAttached = false;
      let displayModeListenerAttached = false;
      let bootstrapStarted = false;
      let bootstrapTimer = 0;

      function applyGlobals(globals) {
        if (!globals || typeof globals !== "object") return false;
        if (typeof options.applyGlobals === "function") {
          return Boolean(options.applyGlobals(globals));
        }
        return false;
      }

      function notifyReady(reason) {
        if (typeof options.onReady === "function") options.onReady(reason);
      }

      function handleLegacyDisplayMode(detail) {
        if (typeof options.onDisplayMode === "function") {
          options.onDisplayMode(detail || {});
        }
      }

      function attachLegacyBridge() {
        const app = getToolshedApp();
        if (!app || legacyBridgeAttached) return Boolean(app);
        legacyBridgeAttached = true;

        if (typeof options.onDisplayMode === "function") {
          app.ondisplaymodechange = function(detail) {
            handleLegacyDisplayMode(detail);
          };
        }

        if (typeof options.onToolInput === "function") {
          app.ontoolinput = async function(input) {
            await options.onToolInput(input);
            notifyReady("toolinput");
          };
        }

        if (typeof options.onToolResult === "function") {
          app.ontoolresult = async function(result) {
            await options.onToolResult(result);
            notifyReady("toolresult");
          };
        }

        return true;
      }

      function hydrateOpenAIState() {
        const openai = getOpenAI();
        const hasGlobals = Boolean(openai && (openai.toolInput || openai.toolOutput || openai.widgetState));
        if (hasGlobals) {
          const updated = applyGlobals({
            theme: openai.theme,
            widgetState: openai.widgetState,
            toolInput: openai.toolInput,
            toolOutput: openai.toolOutput,
          });
          if (updated) notifyReady("globals");
          return updated || Boolean(openai.toolInput || openai.toolOutput || openai.widgetState);
        }

        if (openai && openai.theme && typeof options.updateTheme === "function") {
          options.updateTheme(openai.theme);
        }
        return false;
      }

      function hydrateCurrentHostState() {
        if (hydrateOpenAIState()) return true;
        if (attachLegacyBridge()) return true;
        return false;
      }

      function attachEventListeners() {
        if (!globalsListenerAttached) {
          window.addEventListener("openai:set_globals", function(event) {
            const updated = applyGlobals(event?.detail?.globals || {});
            if (updated) notifyReady("globals-event");
          }, { passive: true });
          globalsListenerAttached = true;
        }
        if (!displayModeListenerAttached && typeof options.onDisplayMode === "function") {
          window.addEventListener("toolshed-display-mode", function(event) {
            handleLegacyDisplayMode(event?.detail || {});
          });
          displayModeListenerAttached = true;
        }
      }

      function onUnavailable() {
        if (typeof options.onUnavailable === "function") {
          options.onUnavailable();
        }
      }

      return {
        getOpenAI,
        getToolshedApp,
        getHost() {
          return getOpenAI() || getToolshedApp();
        },
        applyInitialTheme() {
          const initialTheme = getInitialTheme();
          if (initialTheme && typeof options.updateTheme === "function") {
            options.updateTheme(initialTheme);
          }
        },
        attachEventListeners,
        onUnavailable,
        attachLegacyBridge,
        hydrateCurrentState: hydrateCurrentHostState,
        hydrateCurrentHostState,
        bootstrap() {
          if (bootstrapStarted) {
            return this.hydrateCurrentState();
          }
          bootstrapStarted = true;
          this.attachEventListeners();
          const ready = this.hydrateCurrentState();
          let attempts = 0;
          const maxAttempts = Number.isFinite(Number(options.maxAttempts)) ? Number(options.maxAttempts) : 20;
          const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 100;
          if (!ready) {
            const self = this;
            bootstrapTimer = window.setInterval(function() {
              attempts += 1;
              if (self.hydrateCurrentState() || attempts >= maxAttempts) {
                window.clearInterval(bootstrapTimer);
                bootstrapTimer = 0;
                if (attempts >= maxAttempts && !getOpenAI() && !getToolshedApp()) {
                  self.onUnavailable();
                }
              }
            }, intervalMs);
          }
          return ready;
        },
        async callTool(name, args) {
          const host = this.getHost();
          if (host?.callTool) return await host.callTool(name, args);
          if (host?.callServerTool) return await host.callServerTool({ name, arguments: args });
          const app = getToolshedApp();
          if (app?.callServerTool) {
            return await app.callServerTool({ name, arguments: args });
          }
          throw new Error("No host tool bridge is available.");
        },
        async sendFollowUpMessage(input) {
          const host = this.getHost();
          if (host?.sendFollowUpMessage) return await host.sendFollowUpMessage(input);
          if (host?.sendMessage) {
            const text = normalizeMessageText(input);
            if (!text) return { success: false, error: "No message text provided." };
            return await host.sendMessage({
              role: "user",
              content: [{ type: "text", text }],
            });
          }
          const app = getToolshedApp();
          if (app?.sendMessage) {
            const text = normalizeMessageText(input);
            if (!text) return { success: false, error: "No message text provided." };
            return await app.sendMessage({
              role: "user",
              content: [{ type: "text", text }],
            });
          }
          throw new Error("No host messaging bridge is available.");
        },
        async updateModelContext(input) {
          const host = this.getHost();
          if (!host?.updateModelContext) return null;
          return await host.updateModelContext(input);
        },
        async requestDisplayMode(input) {
          const host = this.getHost();
          if (!host?.requestDisplayMode) throw new Error("Display mode bridge unavailable.");
          return await host.requestDisplayMode(input);
        },
        async syncToolshedSession(input) {
          const app = getToolshedApp();
          if (!app?.syncToolshedSession) return { ok: false };
          return await app.syncToolshedSession(input);
        },
        async openLink(input) {
          const host = this.getHost();
          if (host?.openLink) return await host.openLink(input);
          if (input && input.url) window.open(input.url, "_blank", "noopener,noreferrer");
          return { ok: true };
        },
      };
    }

    window.__toolshedHostRuntime = {
      createHostRuntime,
    };
  })();
</script>`;
