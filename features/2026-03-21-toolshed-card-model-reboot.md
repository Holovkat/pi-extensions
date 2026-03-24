You're right — I was still talking about the old widget taxonomy instead of reframing cards as generated workflow tools.

# Reset the card model around real MCP workflows

## What I found
- GitHub does not currently hold meaningful Toolshed planning history.
- The local PRD actually matches your direction: the lane is sacred, widgets are support surfaces, and MCP should feel native.
- The drift came from the static `10 workspaces / 30 widgets` registry. In code, most current cards are just wrappers around a few generic actions: `send-message`, `launch-skill`, `open-mcp-tool`, `freeze-frontier`, `inject-packet`, and `switch-workspace`.

## Corrected interpretation of what you want
- Stop treating cards as static dashboard widgets.
- Cards should be front-end MCP/workflow tools that Pi can create from the conversation.
- Card runs must appear as first-class conversational items in the lane, while also being mirrored in the panel.
- Start with one permanent non-removable system card: `Component Builder`.
- Built-in extension-backed cards such as `pi-blueprint` should be available inside the same toolshed ecosystem.
- Custom cards should be removable; system cards should not.
- Default card home should be the right floating rail, not noisy side gutters.

## Proposed rebuild
1. Simplify the layout to `lane + right float rail + selector`, and stop using left/right gutters as the default card model.
2. Replace the static widget registry with a real `CardManifest / CardInstance / CardRun` model.
3. Make every card execution create a lane-native item with states like `request -> running -> result -> follow-up`; the panel mirrors state but never owns the canonical output.
4. Add a permanent `Component Builder` system card that can:
   - derive a new card from the current conversation
   - preview its inputs/actions/result shape
   - save it as a session card or project-reusable card
5. Import extension-backed tools as cards instead of abstract widgets. First target: `pi-blueprint`.
6. Treat examples like “give me a mermaid diagram of this codebase” as generated reusable cards/workflows, not hard-coded themed widgets.
7. Keep `freeze/inject` as a workflow primitive, not the identity of every card.

## Minimal model
```ts
type CardManifest = {
  id: string;
  title: string;
  source: "system" | "extension" | "generated";
  removable: boolean;
  persist: "session" | "project";
  inputs: CardInputSchema[];
  run: CardRunContract;
  render: CardRenderContract;
};

type CardRun = {
  id: string;
  cardId: string;
  status: "idle" | "configuring" | "running" | "result";
  laneEventId: string;
  panelState: unknown;
  result: unknown;
};
```

## First implementation slice
- `Component Builder` system card
- `Blueprint` extension-backed card
- generated `Mermaid Diagrammer` as the first proof that conversation can create reusable tools

## Migration strategy
- Remove the 30-card static workspace registry from the primary UI.
- Keep only a minimal compatibility adapter if needed for existing commands, but do not preserve the current abstract cards as the main interaction model.

## Validation
- create a card from a conversational prompt
- show its run in both lane and panel
- surface `pi-blueprint` as a reusable built-in card
- allow deleting custom cards while preventing deletion of system cards

If you approve this, I’ll implement the clean reboot instead of continuing to patch the current widget model.