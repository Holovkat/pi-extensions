# MCP App Playbook

Use this skill when the user wants to build, expose, extend, or repair an MCP-style app, especially when the app may need to work both inside a local host and in external clients such as ChatGPT/OpenAI Apps.

## Goal

Drive the work with an explicit app contract, session model, hosting plan, and smoke-test loop so the app works in the real runtime rather than only on disk.

## Included Context Pack

- `docs/context-pack.md` — core architecture and delivery model
- `docs/external-contract.md` — decisions that must be made before exposing an app externally
- `references/lessons-learned.md` — distilled lessons from a real app rollout
- `references/common-failure-modes.md` — symptom → cause → first-check mapping
- `examples/combined-server-pattern.md` — pattern for one endpoint exposing multiple app features
- `examples/widget-hydration-pattern.md` — dual-host widget hydration pattern
- `tasks/greenfield-checklist.md` — required steps for a new app
- `tasks/enhancement-bugfix-checklist.md` — required steps for enhancement or bugfix work
- `scripts/smoke_test_mcp_http.py` — initialize/list/open/delete smoke test
- `scripts/compare_mcp_tool_lists.py` — diff tools across two MCP endpoints

## Method

1. Classify the request:
   - greenfield app
   - enhancement
   - bug fix
   - external exposure / deployment hardening
2. Read the relevant checklist and context docs before editing code.
3. Make the contract explicit:
   - endpoint shape
   - tool names
   - widget/resource URIs
   - transport mode
   - transport session vs app session model
   - cleanup and close behavior
4. Build or fix the server and widget with the shared patterns in this pack.
5. Validate on the real served runtime, not only the file system.
6. For externally exposed apps, verify:
   - `initialize`
   - `tools/list`
   - open-tool call
   - widget hydration
   - session alignment
   - delete/cleanup

## Guardrails

- Never assume the transport session ID is the same as the app/business session ID.
- Never assume changing files means the live runtime changed; restart and re-verify.
- If the user expects one app, prefer one MCP endpoint with multiple tools over multiple separate app connectors.
- Treat external widget hydration as first-class work, not a follow-up polish step.
- Prefer small, verifiable loops over large speculative rewrites.

## Output Discipline

When using this skill, always return:

1. current phase
2. key contract decisions
3. validation status
4. remaining risk or follow-up
