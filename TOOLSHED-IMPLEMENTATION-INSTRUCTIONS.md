# Pi Toolshed — Implementation Instructions

## Goal

Implement a new Pi extension and browser host that deliver the PRD in `PRD-PI-TOOLSHED.md` using existing repo patterns plus FMS-GLM lane discipline.

## Files To Create

### Required

- `extensions/pi-toolshed.ts`
- `bin/toolshed-dashboard-web`

### Optional helper modules if the implementation needs them

- `extensions/lib/toolshed-types.ts`
- `extensions/lib/toolshed-widgets.ts`
- `extensions/lib/toolshed-workspaces.ts`
- `extensions/lib/toolshed-state.ts`

Use helper modules only if they materially improve maintainability. Do not introduce a new dependency stack unless the repo already uses it.

## Reference Implementations To Follow

### In this repository

- `extensions/pi-blueprint.ts`
  - session management
  - web host orchestration
  - runtime state persistence
  - browser launch flow
- `bin/blueprint-dashboard-web`
  - SSE state broadcast
  - client state normalization
  - widget / drawer / overlay patterns
  - control socket coordination
- `extensions/dev-pipeline.ts` and related web host patterns if needed
  - operator control actions
  - command steering
  - approval / run-state patterns

### In `../fms-glm`

Use FMS-GLM as the UX reference for:

- single centered lane
- floating header
- bottom composer
- freeze / inject packet discipline
- one active frontier at a time

Do not copy FMS-GLM blindly; adapt its interaction model to Pi's runtime and extension architecture.

## Architecture Requirements

## 1. Extension responsibilities (`extensions/pi-toolshed.ts`)

The extension should:

1. register a `pi-toolshed` command surface
2. start or reuse the browser host process
3. manage runtime state written to disk for the web client
4. expose a control channel for:
   - send message
   - inject packet
   - run slash command
   - steer / follow-up
   - abort / stop
   - switch workspace
   - pin / unpin widget
   - move / collapse widget
5. normalize session history into lane-safe items
6. publish structured widget state, status state, and MCP summaries

## 2. Web host responsibilities (`bin/toolshed-dashboard-web`)

The web host should:

1. serve a single-page UI shell
2. stream updates over SSE
3. accept control actions over a local control endpoint or socket
4. restore persisted state on refresh
5. render the lane, composer, status surface, docked widgets, and floating widgets
6. keep the lane primary even when widgets are active

## 3. State model

Keep the state model explicit and serializable. At minimum, support:

```ts
interface ToolshedState {
  sessionId: string;
  projectDir: string;
  workspaceId: string;
  status: ToolshedStatus;
  lane: LaneItem[];
  packets: ToolshedPacket[];
  widgets: WidgetInstanceState[];
  mcp: McpSummaryState;
  composer: ComposerState;
  updatedAt: string;
}
```

Suggested supporting structures:

- `LaneItem`
- `ToolshedPacket`
- `WidgetDefinition`
- `WidgetInstanceState`
- `WorkspacePreset`
- `StatusChip`
- `McpServerSummary`

## 4. Lane rules

The lane must remain the source of truth.

### Always do

- keep one centered scrollable lane
- allow only one active frontier
- freeze resolved work into packets or summaries
- inject packets back intentionally, never implicitly

### Never do

- create a permanent multi-column dashboard as the primary UI
- allow floating widgets to obscure the composer by default
- make widgets the only place where important state exists

## Workspace Registry

Implement a static registry for the initial release.

Each workspace entry should include:

- `id`
- `title`
- `description`
- `defaultWidgets`
- `statusChips`
- optional `quickActions`

Seed the registry with these 10 workspaces and 30 widgets exactly:

1. Toolshed Core
   - Intent Forge
   - Toolmesh Radar
   - Frontier Rack
2. RFC Studio
   - RFC Frontier Ledger
   - Evidence Weave
   - Command Orbit
3. MCP Lab
   - Schema Radar
   - Operator Deck
   - Capsule Tray
4. Pair Programmer
   - Frontier Stack
   - Action Router
   - Injection Tray
5. Mission Control
   - Frontier Rail
   - Capability Orbit
   - RFC Flight Deck
6. Research Desk
   - Evidence Ledger
   - Hypothesis Board
   - Probe Palette
7. Incident Ops
   - Signal Mesh
   - Freeze Ledger
   - Mitigation RFC Deck
8. Design Review
   - Frontier Lock
   - Evidence Rail
   - RFC Slate
9. Release Center
   - Release Radar
   - Gate Lattice
   - Rollback Orbit
10. Automation Workbench
   - Frontier Control
   - Capability Atlas
   - RFC Staging

## Widget Contract

Use a stable contract so widgets can render from structured state instead of bespoke branches.

```ts
type WidgetPlacement = "inline" | "left-dock" | "right-dock" | "float";

interface WidgetDefinition {
  id: string;
  title: string;
  workspaceId: string;
  placement: WidgetPlacement;
  purpose: string;
  defaultPinned: boolean;
  defaultCollapsed?: boolean;
  remembersPlacement?: boolean;
  remembersSize?: boolean;
  renderMode: "summary" | "interactive" | "packet-staging";
  actions: Array<{ id: string; label: string }>;
}
```

Implementation guidance:

- `summary` widgets surface state without taking over the workflow
- `interactive` widgets can launch actions or change filters
- `packet-staging` widgets gather material that later injects into the lane

## Control Actions

Support a bounded action protocol instead of ad hoc commands.

Suggested actions:

- `send-message`
- `submit-slash-command`
- `launch-skill`
- `inject-packet`
- `freeze-frontier`
- `switch-workspace`
- `pin-widget`
- `unpin-widget`
- `move-widget`
- `collapse-widget`
- `expand-widget`
- `open-mcp-tool`
- `abort-run`

Keep all actions project-local and reversible where possible.

## Recommended Build Order

## Phase 1 — Shell and state plumbing

1. Copy the safe startup / restart approach from `pi-blueprint`.
2. Create `pi-toolshed` runtime state paths.
3. Start the web host and expose URL / port discovery.
4. Implement SSE push and state snapshot delivery.

## Phase 2 — Lane-first UI

1. Build a single centered lane.
2. Add floating header and bottom composer.
3. Render user, assistant, tool, and packet lane items.
4. Add freeze/inject controls.

## Phase 3 — Core controls

1. Send message to Pi from the composer.
2. Support follow-up / steer / abort.
3. Surface slash commands and skills.
4. Show session/model/run-state chips.

## Phase 4 — Workspace and widget registry

1. Implement the workspace switcher.
2. Register all 10 workspace presets.
3. Register all 30 widgets.
4. Add pin/collapse/float behavior and persistence.

## Phase 5 — MCP and RFC flows

1. Surface MCP servers, health, and tool summaries.
2. Convert MCP outputs into packets or widget summaries.
3. Add RFC actions for drafting, revise, split, and inject.

## Phase 6 — Hardening

1. Reconnect handling.
2. Long transcript performance.
3. State normalization / dedupe.
4. Empty-state and degraded-state UX.

## UI Guidance

### Header

Include:

- workspace selector
- session title or session id
- model/provider chip if available
- MCP chip
- run-state chip
- connection chip

### Composer

Include:

- plain text input
- slash command affordance
- skills affordance
- inject packet affordance
- stop / abort when active

### Docks

- left dock: context and planning surfaces
- right dock: telemetry and state surfaces
- float: transient staging / action surfaces

### Packet handling

Packets should be visually distinct from normal turns and should support:

- preview
- inject
- discard
- refreeze into a smaller summary

## Persistence Rules

Persist only what the web client needs to restore the current workspace cleanly:

- lane items
- packet summaries
- widget placement / collapse / pin state
- workspace selection
- MCP summary state

Avoid persisting ephemeral hover-only or animation-only state.

## Validation Commands

Determine the exact commands from the repo before finalizing implementation. If no repo-level package script exists, use direct validation similar to the existing blueprint workflow.

Minimum expected checks after implementation:

```bash
node --check "/Users/tonyholovka/workspace/pi-extensions/bin/toolshed-dashboard-web"
npx -y -p esbuild esbuild "/Users/tonyholovka/workspace/pi-extensions/extensions/pi-toolshed.ts" --platform=node --format=esm --log-level=error >/dev/null
```

If helper modules are added, validate them through the extension bundle/transpile path as well.

Then run a smoke test that:

1. launches the extension host flow
2. starts the toolshed web process
3. confirms the state endpoint or SSE stream responds
4. confirms at least one message can be submitted and reflected in state

## Manual Acceptance Checklist

Before calling the feature done, verify:

1. The browser loads and shows the centered lane.
2. The composer can send a real Pi message.
3. A streamed response appears in the lane.
4. The workspace selector changes visible widgets.
5. Widgets can pin, collapse, and float.
6. A packet can be frozen and later injected.
7. Slash commands and skills are visible from the web UI.
8. MCP state appears when available.
9. Refresh restores the last workspace and widget layout.
10. Disconnect/reconnect recovers without corrupting lane state.

## Guardrails

1. Match existing repo coding conventions and naming patterns.
2. Prefer existing libraries and local patterns over new dependencies.
3. Keep comments minimal.
4. Do not update `README.md` unless explicitly requested.
5. Keep the implementation lane-first even when it is tempting to make it dashboard-first.

## Definition of Done

The work is done when:

1. `extensions/pi-toolshed.ts` and `bin/toolshed-dashboard-web` exist and work together.
2. The lane-first Toolshed UI can chat with Pi in real time.
3. Slash commands, skills, RFC actions, and MCP summaries are visible.
4. All 10 workspace presets and 30 widgets are registered.
5. Validation and smoke checks pass.
