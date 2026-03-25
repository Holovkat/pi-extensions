# Pi Toolshed Retrospective

Date: 2026-03-26

## Scope

This note summarizes the project work to date across the current `pi-blueprint` and `pi-toolshed` effort, with emphasis on live MCP app hosting, external app exposure, the calculator app, and the GitHub project kanban board.

## What Has Been Achieved

### Foundation

- Restored `pi-blueprint` and its web dashboard.
- Added session-history and issue-tree support for planning/execution workflows.
- Added project MCP wiring and aligned repo state around `.factory/mcp.json`.
- Established `pi-toolshed` as the main card/workspace shell for live app work.

### Toolshed Runtime

- Added a live Toolshed web workspace and lane-first UI.
- Added app/workspace cards, quick actions, packets, and web surfaces.
- Moved MCP app hosting into the PI-managed runtime rather than a separate standalone host.
- Added a live connections roster in web UI and terminal (`/toolshed-connections`).

### MCP Apps

- Built a custom skeuomorphic calculator app.
- Built a custom GitHub project kanban board app.
- Added inline-app reopen/archive behavior so the lane stays coherent.
- Added board interrogation support, follow-up preservation, sprint/task association extraction, and markdown table rendering.

### External Exposure

- Exposed Toolshed apps through PI-managed MCP routes (`/mcp/servers/:serverId`).
- Verified external access through the live ngrok endpoint.
- Consolidated external tools so calculator and GitHub board now sit under the same Toolshed app endpoint for external clients.
- Aligned external session reporting with the app-visible session IDs rather than raw transport IDs.

## Issues Raised

| Issue                                     | What Happened                                                                       | Outcome                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Board interrogation was unstable          | The inline board could reload or lose context while being queried                   | Interrogation flow was stabilized and follow-up context was preserved         |
| Follow-up questions lost meaning          | Pronoun/list follow-ups did not keep focus on prior board state                     | Focus state and follow-up intent handling were added                          |
| Sprint/task associations were wrong       | Tasks were not being matched back to their parent sprint structure                  | Parent/child extraction was added to board snapshots                          |
| Markdown tables rendered badly            | Lane output lost table structure                                                    | Lightweight GFM table rendering was added                                     |
| Reopening inline apps was confusing       | Old app state stayed visually active                                                | Older instances were archived as placeholders                                 |
| MCP tools were missing in-session         | Toolshed wrote to legacy `.mcp.json` while the runtime expected `.factory/mcp.json` | Canonical config handling was added with legacy fallback                      |
| ChatGPT required a public MCP endpoint    | Stdio-only apps could not be used externally                                        | HTTP/SSE hosting support was added                                            |
| ChatGPT used the generic calculator       | ChatGPT favored its built-in calculator instead of the custom widget                | Distinct tool naming and OpenAI widget metadata were added                    |
| Widget runtime errors appeared in ChatGPT | The original bridge logic assumed too much about host timing                        | Widget hydration was simplified and made defensive                            |
| PI did not own the app hosting path       | External hosting initially bypassed PI runtime ownership                            | Hosting was moved into `toolshed-dashboard-web`                               |
| No live connection visibility existed     | We could not easily see who/what was connected                                      | Connection roster UI and slash command were added                             |
| Session counts looked wrong               | Raw MCP transport sessions were being treated as user-visible sessions              | Session tracking was reduced to the active app-visible session                |
| GitHub board appeared as a separate app   | External exposure initially created a second endpoint/namespace                     | A combined Toolshed app server was introduced                                 |
| GitHub board opened but showed no cards   | The board widget did not hydrate correctly in ChatGPT/OpenAI                        | The widget was updated to support OpenAI globals and late host initialization |

## Approaches

### What Worked

- Small patch/validate/retest loops.
- Verifying behavior against the real PI-managed host and public ngrok route, not only local assumptions.
- Treating PI as the owner of MCP hosting rather than keeping parallel standalone servers.
- Using `.factory/mcp.json` as the canonical config with legacy compatibility.
- Building widgets to support both `window.openai` and `window.app`.
- Adding observability inside the product (`/connections`) instead of guessing from logs.
- Combining external Toolshed features behind one endpoint when the user expectation was “part of Toolshed”.

### What Did Not Work

- Treating every `Mcp-Session-Id` as a real end-user session.
- Assuming the MCP transport session ID and the app/business session ID were the same thing.
- Exposing the GitHub board as a separate external app after the requirement was a single Toolshed app.
- Relying on stale runtime processes while debugging; old processes repeatedly made results look inconsistent.
- Carrying Pi-only widget-bridge assumptions into external ChatGPT/OpenAI use.

## Lessons Learned

1. There are multiple identities in play and they must stay explicit:
   - connector/app identity
   - MCP transport session
   - app/business session
2. If multiple features should appear under one external app entry, they should start in a combined MCP server from day one.
3. External widget support should be treated as a first-class requirement, not a post-hoc adapter.
4. The live runtime must be restarted and re-verified after fixes; code on disk is not the same thing as code actually being served.
5. Session alignment often requires inspecting structured tool payloads, not just headers.
6. Connection tracing should be built early whenever external clients are involved.
7. Data scoping, ownership, transfer, and mutation rules must be designed up front:
   - define what data enters the app, who owns it, who can mutate it, and what leaves the app
   - keep the lane conversation contract compact and intentional rather than flooding context with raw board/app state
   - prefer narrow queries, summaries, cached views, and targeted computations over shipping entire datasets through the conversation
   - treat data structures as an integration surface, because good data contracts are what make the app behave like a good citizen instead of overwhelming the runtime, the operator, or the model context window

## Outcomes

- Toolshed now has a PI-owned hosting path for MCP apps.
- The calculator and GitHub board are both externally available from the same Toolshed app endpoint.
- The connections view reports the active session in the same terms the app uses.
- The GitHub board can now return real board data and hydrate correctly for external use.
- The project has moved from a planning/dashboard foundation into a working live-tools platform with custom external apps.

## How To Do Better Next Time

### External App Build Rules

1. Start with one shared external app template:
   - Streamable HTTP + SSE support
   - OpenAI-compatible widget metadata
   - dual bridge hydration (`window.openai` + `window.app`)
   - explicit session cleanup path
2. Decide connector shape up front:
   - one endpoint if the user expects one app
   - separate endpoints only when isolation is intentional
3. Keep transport session and app session separate in code and in UI labels.
4. Add a required smoke-test matrix before calling an app “done”:
   - initialize
   - tools/list
   - open widget
   - verify widget hydrates from host globals
   - verify connections page shows the same app session
   - verify DELETE/close cleanup
5. Standardize a shared utility layer for:
   - HTTP transport scaffolding
   - OpenAI/Pi widget hydration
   - session extraction from MCP payloads
   - connection roster tracking
6. Clean up temporary runtimes aggressively during debugging so stale processes do not distort conclusions.
7. Add a required data-contract pass before implementation:
   - input scope
   - output scope
   - ownership
   - mutation authority
   - transfer size limits
   - lane-facing summary/query shapes
8. Design every lane/app integration for token economy:
   - never stream large raw collections into the lane unless explicitly required
   - add query tools for narrow reads and derived answers
   - move heavy data handling behind cached server-side state and compact result structures
   - optimize for developer/operator usefulness per token, not just raw completeness

### Specific Guidance For Future External Apps Like Git Kanban

- Build them as Toolshed features first, not separate “trial” endpoints.
- Define the external contract before implementation:
  - endpoint
  - tool names
  - resource URIs
  - session model
  - cleanup behavior
- Define the data contract before implementation:
  - what the lane can ask for
  - what the app returns by default
  - what remains server-side
  - which mutations are allowed and where they occur
- Verify the actual public endpoint before announcing deployment.
- Add the retrospective/troubleshooting note at the same time as the feature so the next iteration starts with the hard-earned context instead of rediscovering it.
