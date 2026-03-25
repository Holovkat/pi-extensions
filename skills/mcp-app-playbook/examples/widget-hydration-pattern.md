# Example: Dual-Host Widget Hydration Pattern

Use this when the same widget may run in both a local host shell and an external/OpenAI-style host.

```js
function getOpenAI() {
  try {
    return window.openai || null;
  } catch {
    return null;
  }
}

function getLocalHost() {
  try {
    return window.app || window.mcp?.app || null;
  } catch {
    return null;
  }
}

function hydrateFromGlobals(globals) {
  if (!globals || typeof globals !== "object") return false;
  if (globals.widgetState) applyPayload(globals.widgetState);
  if (globals.toolOutput) applyPayload({ structuredContent: globals.toolOutput });
  return Boolean(globals.widgetState || globals.toolOutput || globals.toolInput);
}

function attachLocalBridge() {
  const app = getLocalHost();
  if (!app) return false;

  app.ontoolinput = async (input) => applyPayload(input);
  app.ontoolresult = async (result) => applyPayload(result);
  return true;
}

function hydrateCurrentHostState() {
  const openai = getOpenAI();
  if (openai) {
    return hydrateFromGlobals({
      theme: openai.theme,
      widgetState: openai.widgetState,
      toolInput: openai.toolInput,
      toolOutput: openai.toolOutput,
    });
  }

  return attachLocalBridge();
}

window.addEventListener("openai:set_globals", (event) => {
  hydrateFromGlobals(event.detail?.globals || {});
});

hydrateCurrentHostState();
```

## Important Notes

- initialize once, but poll briefly for late host setup
- do not assume `window.openai` exists at page load
- do not assume local bridge callbacks fire before initial render
