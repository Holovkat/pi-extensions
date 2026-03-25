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

## Recommended Build Sequence

1. capture product shape
2. define external contract
3. define session model
4. build server tools and resources
5. build widget hydration
6. expose through intended runtime
7. run smoke tests
8. verify live/public route

## Minimal Done Criteria

An MCP app should not be considered done until all of these are true:

- `initialize` works
- `tools/list` shows the expected tools
- open-tool call returns structured content
- widget renders the returned state
- widget can act back through the host bridge if applicable
- app-visible session IDs align with operator-visible diagnostics
- delete/close behavior leaves no misleading active session state
