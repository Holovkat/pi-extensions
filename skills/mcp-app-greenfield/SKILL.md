# MCP App Greenfield

Use this skill when the user wants a new MCP-style app built from scratch.

## Goal

Take a greenfield app from vague idea to a working MCP server + widget + validation path, with external readiness designed in from the start if needed.

## Read First

- `../mcp-app-playbook/docs/context-pack.md`
- `../mcp-app-playbook/docs/external-contract.md`
- `../mcp-app-playbook/references/lessons-learned.md`
- `../mcp-app-playbook/examples/combined-server-pattern.md`
- `../mcp-app-playbook/examples/widget-hydration-pattern.md`
- `../mcp-app-playbook/tasks/greenfield-checklist.md`

## Required Process

1. Clarify whether the feature belongs inside an existing app endpoint or needs a new endpoint.
2. Write down the contract before implementation:
   - tools
   - resources
   - transport
   - data scope in/out of the app
   - ownership and mutation authority
   - default lane-facing result shape
   - transfer size / token budget limits
   - session model
   - cleanup behavior
3. Build the server with reusable registration functions if multiple features may share one endpoint.
4. Build the widget with dual-host hydration if external use is possible.
5. Add a smoke-test path before calling the feature complete.
6. If the app is externally exposed, run:
   - `../mcp-app-playbook/scripts/smoke_test_mcp_http.py`
   - `../mcp-app-playbook/scripts/compare_mcp_tool_lists.py`

## Guardrails

- Prefer one endpoint when the product expectation is one app.
- Do not bolt on external support after the fact if you already know the app must run externally.
- Do not ship without session alignment and delete/cleanup verification.
- Keep large raw datasets behind narrow query paths instead of pushing them into lane context by default.

## Deliverables

- app contract summary
- implemented server/widget surface
- smoke-test evidence
- remaining follow-ups or risks
