---
type: Process
title: Toolshed Implementation
description: Implementation instructions for the pi-toolshed lane-first web workspace — files, reference implementations, state model, widget contract, and build order.
resource: ./TOOLSHED-IMPLEMENTATION-INSTRUCTIONS.md
tags: [pi-extensions, process, toolshed, implementation, lane, widgets, workspace, build-order]
timestamp: 2026-06-29T15:00:00Z
status: active
---

# Toolshed Implementation

Implementation instructions for the pi-toolshed extension and browser host, delivering the PRD using existing repo patterns plus FMS-GLM lane discipline.

## Files to Create

- `extensions/pi-toolshed.ts` — extension with command surface, web host management, runtime state, control channel
- `bin/toolshed-dashboard-web` — single-page UI shell with SSE, control endpoint, state restoration
- Optional helper modules in `extensions/lib/` if needed

## Reference Implementations

- `extensions/pi-blueprint.ts` — session management, web host orchestration, state persistence
- `bin/blueprint-dashboard-web` — SSE state broadcast, widget/overlay patterns, control socket
- `extensions/dev-pipeline.ts` — operator control actions, command steering, approval patterns
- `../fms-glm` — UX reference for single centered lane, floating header, freeze/inject discipline

## State Model

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

## Widget Contract

```ts
type WidgetPlacement = "inline" | "left-dock" | "right-dock" | "float";
interface WidgetDefinition {
  id: string; title: string; workspaceId: string;
  placement: WidgetPlacement; purpose: string;
  defaultPinned: boolean; renderMode: "summary" | "interactive" | "packet-staging";
  actions: Array<{ id: string; label: string }>;
}
```

## Build Order

1. Shell and state plumbing (SSE, port discovery)
2. Lane-first UI (centered lane, floating header, bottom composer)
3. Core controls (send, steer, abort, slash commands, skills)
4. Workspace and widget registry (10 presets, 30 widgets)
5. MCP and RFC flows (server visibility, packet injection)
6. Hardening (reconnect, long transcript, empty states)

## Lane Rules

- Keep one centered scrollable lane
- Allow only one active frontier
- Freeze resolved work into packets
- Inject packets intentionally, never implicitly
- Never create a permanent multi-column dashboard as primary UI

## Definition of Done

1. Extension and web host exist and work together
2. Lane-first UI can chat with Pi in real time
3. Slash commands, skills, RFC actions, and MCP summaries visible
4. All 10 workspace presets and 30 widgets registered
5. Validation and smoke checks pass

## Related Concepts

- [Pi-Toolshed Extension](../components/pi-toolshed-extension.md)
- [Pi-Blueprint Extension](../components/pi-blueprint-extension.md)
- [Current Repo State](../state/current-repo-state.md)
