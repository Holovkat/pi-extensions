# MCP App Maintainer

Use this skill when an MCP-style app or widget already exists and the user wants an enhancement, external exposure change, bug fix, or production-style troubleshooting pass.

## Goal

Reproduce the real failure, identify the owning layer, fix the smallest correct layer, and verify the result on the actual served runtime.

## Read First

- `../mcp-app-playbook/docs/context-pack.md`
- `../mcp-app-playbook/references/common-failure-modes.md`
- `../mcp-app-playbook/references/lessons-learned.md`
- `../mcp-app-playbook/examples/widget-hydration-pattern.md`
- `../mcp-app-playbook/tasks/enhancement-bugfix-checklist.md`

## Required Process

1. Reproduce the issue on the real runtime the user is actually consuming.
2. Decide which layer owns the bug:
   - config
   - runtime/process
   - transport/session
   - tool payload
   - widget hydration
   - UI rendering
3. Compare local vs public tool availability when external use is involved.
4. Inspect both transport session IDs and app/business session IDs before changing diagnostics.
5. Restart and re-verify the actual serving process after the fix.
6. Use these scripts whenever applicable:
   - `../mcp-app-playbook/scripts/smoke_test_mcp_http.py`
   - `../mcp-app-playbook/scripts/compare_mcp_tool_lists.py`

## Guardrails

- Do not “fix” a backend/session bug with a misleading UI patch.
- Do not assume stale runtime behavior reflects current code.
- Do not create a separate external app endpoint when the real issue is missing feature registration in the existing endpoint.

## Deliverables

- confirmed owning layer
- exact fix applied
- validation evidence on the served runtime
- remaining risks, cleanup, or follow-up work
