# Enhancement / Bugfix MCP App Checklist

## Reproduce

- [ ] Reproduce on the real served endpoint
- [ ] Check whether the bug exists locally, publicly, or both
- [ ] Identify whether the failure is server, transport, widget, config, or runtime-state related

## Inspect

- [ ] Compare `tools/list` across relevant endpoints if external use is involved
- [ ] Inspect transport session IDs vs app session IDs
- [ ] Inspect structured content, warnings, and errors from the real tool response
- [ ] Inspect data scope, ownership, mutation points, and transfer size on the failing path
- [ ] Check for stale processes serving old code

## Fix

- [ ] Patch the smallest layer that actually owns the bug
- [ ] Avoid compensating UI changes for a backend/session-model bug
- [ ] Avoid creating a second endpoint unless separation is intentional
- [ ] Avoid flooding the lane with raw state when the fix should be a narrower query or summary contract

## Verify

- [ ] Re-run the failing scenario on the real runtime
- [ ] Verify widget hydration
- [ ] Verify session alignment
- [ ] Verify close/delete cleanup
- [ ] Verify external/public behavior if applicable
- [ ] Verify lane-facing payloads stay compact after the change
