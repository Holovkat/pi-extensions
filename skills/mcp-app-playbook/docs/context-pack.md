# MCP App Context Pack

## What This Pack Assumes

An MCP app has at least four moving parts:

1. server tools/resources
2. transport/runtime hosting
3. widget hydration and host bridge behavior
4. validation against the real served endpoint

## Core Rules

### 1. Model the identities explicitly

Keep these separate in code and in UI:

- connector/app identity
- MCP transport session ID
- app/business session ID

If they happen to match, treat that as incidental rather than guaranteed.

### 2. Decide endpoint shape before implementation

Choose one of:

- single endpoint / single app namespace / multiple tools
- multiple endpoints / multiple app namespaces

If the user expectation is “this should be part of the same app”, start with one endpoint.

### 3. Design for both host types if external use is possible

At minimum, plan for:

- local host bridge such as `window.app` / `window.mcp?.app`
- external/OpenAI host bridge such as `window.openai`
- late host initialization (`openai:set_globals`, delayed globals, delayed tool output)

### 4. Treat hosting as a product surface

The app is not done when the code compiles. It is done when:

- the real served endpoint responds correctly
- the external client sees the right tools
- the widget hydrates with live data
- close/delete cleanup behaves correctly

### 5. Add observability early

For externally hosted apps, add:

- live connection/session visibility
- endpoint verification
- tool-list verification
- payload/session tracing where safe

### 6. Design the data contract before code

Define these explicitly:

- what data enters the app
- what data stays server-side
- what data can leave the app
- who owns each shape
- who is allowed to mutate it
- what the lane/model gets by default vs only on demand

Large raw datasets should stay behind query tools, cached state, and targeted computations rather than being pushed wholesale into the lane.

### 7. Treat token economy as a product requirement

The best integration is not the one that returns the most data. It is the one that returns the smallest useful data shape for the current action.

Prefer:

- narrow queries
- summaries
- derived answers
- paged or filtered results
- compact structured payloads

Avoid flooding the lane or model context with thousands of elements unless the user explicitly asked for raw bulk output.

## Recommended Build Sequence

1. capture product shape
2. define external contract
3. define data contract
4. define session model
5. build server tools and resources
6. build widget hydration
7. expose through intended runtime
8. run smoke tests
9. verify live/public route

## Minimal Done Criteria

An MCP app should not be considered done until all of these are true:

- `initialize` works
- `tools/list` shows the expected tools
- open-tool call returns structured content
- widget renders the returned state
- widget can act back through the host bridge if applicable
- app-visible session IDs align with operator-visible diagnostics
- delete/close behavior leaves no misleading active session state
- lane-facing outputs stay compact, scoped, and intentional
