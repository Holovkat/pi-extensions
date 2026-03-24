# PRD — Pi Toolshed Web Workspace

## Document Status

- Status: Draft for implementation
- Scope: Pi extension + web host in this repository
- Primary reference model: FMS-GLM conversation lane

## Product Summary

Pi Toolshed is a real-time web workspace for the Pi CLI. It brings Pi into a browser-hosted, chat-first interface while preserving Pi's operator-driven workflow, slash commands, skills, RFC actions, and MCP integrations.

The experience must be built around the FMS-GLM conversation-lane model:

- one centered lane
- thin gutters
- floating header / status surface
- infinite vertical scroll
- single active frontier
- freeze / summarize / inject progression

Widgets support the lane; they do not replace it.

## Problem Statement

Pi already has strong extension patterns for:

- web mirrors
- control sockets
- SSE state sync
- command injection
- widget summaries

But the current surfaces are dashboard-first. The requested Toolshed experience needs to be lane-first, real-time, MCP-aware, and suitable for long-running operator conversations without fragmenting attention across many fixed panes.

## Vision

Create a browser-native Pi workspace that feels like:

- the focus and calm density of Codex app
- the command and transcript discipline of Claude Code
- the tool / MCP composability of Droid
- the polished docked utilities of Craft Agents

while remaining structurally faithful to FMS-GLM's single-lane interaction model.

## Goals

1. Support real-time conversations with the Pi CLI through a web interface.
2. Expose slash commands, skills, and RFC-style actions as first-class UI affordances.
3. Provide a persistent status surface for model, session, MCP, and run-state visibility.
4. Allow MCP-driven widgets to render inline, docked, or floating without breaking the lane.
5. Ship 10 distinct workspace presets with 30 unique widgets total.
6. Preserve one active conversational frontier at a time.
7. Maintain a full scrollback history where previous work freezes into stable summaries or packets.

## Non-Goals

1. Replacing the terminal UI entirely.
2. Building a classic multi-column dashboard as the primary interaction model.
3. Turning every widget interaction into a permanent lane item.
4. Reworking existing `pi-blueprint` or `dev-pipeline` semantics beyond what is needed to create a reusable toolshed foundation.

## Primary Users

### 1. Operator

Uses Pi directly, launches commands, watches progress, injects follow-ups, and manages MCP context.

### 2. Planner / Architect

Uses workspace presets to draft, review, and revise RFC-like planning artifacts.

### 3. Builder / Reviewer

Uses the lane for implementation guidance, diff review, evidence gathering, release work, and incident handling.

## Experience Principles

### 1. One lane is sacred

The centered conversation lane is the source of truth. Everything important must either:

- appear in the lane, or
- explicitly inject back into the lane.

### 2. Single active frontier

Only one turn, packet, or interactive lane component is active at a time.

### 3. Freeze before branching

If the operator wants to preserve context, a result, or a decision, it freezes into a summary or packet before a new active step begins.

### 4. Widgets are support surfaces

Docked and floating widgets are supporting instruments. They must not create a second competing workflow.

### 5. MCP should feel native

MCP state, tools, and mini-app surfaces should be visible and operable from inside the Toolshed experience without degrading the lane.

## Core Interaction Model

## Layout

- Floating header at the top for session identity, status, and workspace context
- One centered conversation lane with small gutters
- Bottom composer as the only text-input surface
- Optional left / right dock areas for pinned widgets
- Optional floating widgets that can collapse into gutter chips

## Lane item classes

1. User turns
2. Assistant turns
3. Tool events / tool results
4. RFC packets / decision packets
5. Widget-backed inline packets
6. System notices

## Freeze / Inject discipline

- Tool-heavy outputs should be freezable into packets
- MCP lookups may produce packets that require explicit injection
- Transient drill-ins should remain transient unless promoted into the lane

## Functional Requirements

## FR-1 Real-time Pi chat

The web surface must support:

- sending user messages to Pi in real time
- receiving streamed assistant responses
- handling follow-up, steer, and abort interactions
- showing connection state and degraded / disconnected state clearly

## FR-2 Slash command support

The composer and related widgets must expose slash commands with:

- visibility
- quick insertion
- click-to-run where safe
- context-sensitive suggestions

## FR-3 Skills support

The UI must surface skills as a first-class capability, including:

- visible skills relevant to the current frontier
- quick launch actions
- indication when a skill is recommended versus available

## FR-4 RFC support

The UI must support RFC-like actions for:

- drafting
- revising
- splitting
- reprioritizing
- approving
- staging for injection

## FR-5 Status surface

The status surface must show at minimum:

- workspace preset
- session state
- model / provider identity when available
- MCP health / count
- current run state
- pending approvals / queued packets when relevant

## FR-6 MCP UI inside the chat experience

The system must support MCP as a visible, interactive part of the toolshed with:

- server visibility
- tool visibility
- health / auth status
- packetized results
- dockable or floating mini-app widgets

## FR-7 Widget system

Widgets must support these placements:

- `inline`
- `left-dock`
- `right-dock`
- `float`

Widgets must support these behaviors:

- pinned
- collapsed
- detached / floating
- remembered size
- remembered placement

## FR-8 Workspace presets

The system must ship 10 workspace presets, each with 3 unique widgets.

## FR-9 History and replay

The system must preserve enough structured state to:

- reconstruct recent turns
- rebuild packets and widget summaries
- restore workspace selection and pinning preferences

## FR-10 Accessibility and keyboard support

The experience must support:

- keyboard-first usage
- tab/focus discipline
- clear status labels
- reduced interference from floating widgets

## Non-Functional Requirements

1. Web chat should feel responsive during streaming and command execution.
2. State writes should be debounced and deterministic.
3. The web host should tolerate disconnects and reconnect gracefully.
4. Large transcripts should remain usable over long sessions.
5. Widget presence must not materially harm the primary lane's scroll and focus behavior.

## Widget Contract

Each widget definition should support:

```ts
type WidgetPlacement = "inline" | "left-dock" | "right-dock" | "float";

interface ToolshedWidgetDefinition {
  id: string;
  title: string;
  workspaceId: string;
  placement: WidgetPlacement;
  defaultPinned: boolean;
  defaultCollapsed?: boolean;
  remembersSize?: boolean;
  remembersPlacement?: boolean;
  purpose: string;
  actions: Array<{ id: string; label: string }>;
}
```

## Workspace Presets

| Workspace | Purpose | Widgets |
|---|---|---|
| Toolshed Core | Everyday operator cockpit for commands, skills, MCP, and packets | Intent Forge, Toolmesh Radar, Frontier Rack |
| RFC Studio | Draft, review, split, and approve planning / decision packets | RFC Frontier Ledger, Evidence Weave, Command Orbit |
| MCP Lab | Inspect MCP servers, schemas, results, and packet injection flows | Schema Radar, Operator Deck, Capsule Tray |
| Pair Programmer | Code-focused lane for scoped implementation and validation work | Frontier Stack, Action Router, Injection Tray |
| Mission Control | Multi-agent / multi-stream steering around one active frontier | Frontier Rail, Capability Orbit, RFC Flight Deck |
| Research Desk | Evidence-led investigation and source synthesis | Evidence Ledger, Hypothesis Board, Probe Palette |
| Incident Ops | Live debugging, mitigation, and status management | Signal Mesh, Freeze Ledger, Mitigation RFC Deck |
| Design Review | Critique UI/output against intent with frozen evidence | Frontier Lock, Evidence Rail, RFC Slate |
| Release Center | Promotion, gates, rollout watch, and rollback posture | Release Radar, Gate Lattice, Rollback Orbit |
| Automation Workbench | Slash / skill / MCP / RFC automation orchestration | Frontier Control, Capability Atlas, RFC Staging |

## Widget Inventory

| Widget | Workspace | Placement | Purpose |
|---|---|---|---|
| Intent Forge | Toolshed Core | left-dock | Turn context into slash / skill / RFC launch options |
| Toolmesh Radar | Toolshed Core | right-dock | Show active tool/MCP readiness for the current frontier |
| Frontier Rack | Toolshed Core | inline | Manage frozen packets and active frontier state |
| RFC Frontier Ledger | RFC Studio | right-dock | Track active RFC section, readiness, and pending decision |
| Evidence Weave | RFC Studio | left-dock | Gather MCP, repo, and doc evidence for RFC work |
| Command Orbit | RFC Studio | float | Present RFC-aware commands and actions near the composer |
| Schema Radar | MCP Lab | right-dock | Surface server schemas, tools, auth, and active tool calls |
| Operator Deck | MCP Lab | left-dock | Suggest the best slash / skill / RFC move for the current context |
| Capsule Tray | MCP Lab | float | Hold frozen MCP result capsules for later injection |
| Frontier Stack | Pair Programmer | left-dock | Keep task, files, symbols, and validators visible |
| Action Router | Pair Programmer | right-dock | Suggest coding commands, skills, and RFC routing actions |
| Injection Tray | Pair Programmer | float | Stage patch/test packets before injecting them back |
| Frontier Rail | Mission Control | left-dock | Show live frontier, pending injections, and stream state |
| Capability Orbit | Mission Control | right-dock | Surface commands, skills, and MCP server readiness |
| RFC Flight Deck | Mission Control | float | Hold approvals, revisions, and operator decisions |
| Evidence Ledger | Research Desk | right-dock | Curate trusted sources and claim-level evidence |
| Hypothesis Board | Research Desk | left-dock | Track open questions and contested explanations |
| Probe Palette | Research Desk | float | Launch the best next source / query / RFC action |
| Signal Mesh | Incident Ops | right-dock | Normalize alerts, deploys, logs, and blast radius |
| Freeze Ledger | Incident Ops | left-dock | Preserve verified facts and comms-ready status lines |
| Mitigation RFC Deck | Incident Ops | float | Stage reversible mitigations and approvals |
| Frontier Lock | Design Review | inline | Lock the active review target and acceptance slice |
| Evidence Rail | Design Review | right-dock | Hold screenshots, transcript quotes, and DOM evidence |
| RFC Slate | Design Review | float | Route findings into RFC actions and summaries |
| Release Radar | Release Center | inline | Show candidate, route, owner, and release freeze state |
| Gate Lattice | Release Center | right-dock | Display blocking gates, approvals, and MCP health |
| Rollback Orbit | Release Center | float | Track rollout probes and safe rollback posture |
| Frontier Control | Automation Workbench | right-dock | Show active run, queue, and next injectable action |
| Capability Atlas | Automation Workbench | left-dock | Show matched slash commands, skills, and MCP servers |
| RFC Staging | Automation Workbench | float | Hold draft command / follow-up / tool RFC actions |

## Technical Approach Summary

The implementation should combine:

- `pi-blueprint`'s web-shell and widget-mirror patterns
- `dev-pipeline`'s control-socket and steer/follow-up/abort patterns
- FMS-GLM's lane discipline and freeze/inject semantics

## Acceptance Criteria

1. A user can open a browser-based Pi chat session and converse with Pi in real time.
2. The UI uses one centered conversation lane as the primary surface.
3. Slash commands, skills, and RFC actions are visible and usable from the web UI.
4. MCP state is visible and widgets can attach to lane context.
5. Widgets can pin, collapse, float, and remember placement.
6. The system includes the 10 workspace presets and 30 unique widgets listed above.
7. Prior outputs can freeze into packets and re-enter the lane only via explicit injection.

## Delivery Recommendation

Build in this order:

1. Toolshed Core shell
2. Shared widget contract and packet model
3. MCP Lab surfaces
4. RFC Studio surfaces
5. Remaining workspace presets

## Open Decisions

1. Whether packets should be restorable across sessions or only within the current session.
2. Whether some widget actions may run immediately or must always stage through the frontier.
3. Whether MCP widgets should be workspace-specific, global, or both.
