# External MCP App Contract

Use this as the required contract before exposing an MCP app outside the local host.

## Required Decisions

### Product Shape

- What should the connector/app be called?
- Should this feature live under an existing app endpoint or a new one?
- Is the widget read-only, interactive, or both?

### Endpoint Contract

- base endpoint URL
- local verification URL
- public verification URL
- transport mode (`stdio`, streamable HTTP, SSE compatibility)
- whether multiple tools will share one endpoint

### Tool Contract

For each tool, define:

- tool name
- purpose
- required arguments
- whether it returns widget-opening structured content
- whether it mutates app state

### Resource Contract

- widget/resource URI
- MIME type
- external widget metadata
- whether the widget must work in multiple hosts

### Data Contract

- input scope
- output scope
- default lane-facing response shape
- on-demand query shapes for deeper reads
- ownership of each structure
- mutation authority
- transfer size limits / token budget expectations
- what stays server-side instead of entering conversation context

### Session Contract

- transport session ID source
- app/business session ID source
- which ID is shown in diagnostics
- cleanup trigger (`DELETE`, close callback, idle timeout, explicit teardown)

### Validation Contract

Must pass:

1. `initialize`
2. `tools/list`
3. open-tool call
4. widget hydration from real host globals
5. session alignment check
6. delete/cleanup check
7. local vs public tool-list comparison if a public route exists
8. compact lane-facing output check for high-volume data paths

## Anti-Patterns

- adding a second endpoint when the user wanted one app
- showing raw transport IDs to operators when the app session is what they care about
- assuming the public connector reloaded just because the local process changed
- testing only localhost while the user consumes the public route
- streaming bulk raw state into the lane when a summary or query tool would do
