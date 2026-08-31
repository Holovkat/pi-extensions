---
type: Inbox
title: pif app build bus result proof and bounded export diagnostics (#192)
description: Proved the async pif app export path correlates ack and build_result with buildId, publishes success/nonzero/spawn-error results once, caps streamed output, and keeps the hub responsive
tags: [pi-extensions, pif, app-build, websocket, diagnostics, okf]
timestamp: 2026-08-31T01:36:43Z
generated_at: 2026-08-31T01:36:43Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [192]
capture_tier: session
---

# What Was Done

Validated the `pif_app.build` path in `extensions/pif.ts` with a bounded stubbed diagnostic against the live `PifHub` class. The diagnostic exercised three cases in a temp workspace — success, nonzero exit, and spawn error — while stubbing the spawned child process so the real export script never ran.

The diagnostic proved that:

- the ack returns a `buildId`
- the `app/build` `build_result` carries the same `buildId`
- `shell.status` remains responsive after the request returns
- success and nonzero exits publish exactly one build result
- spawn errors also publish a single build result instead of only failing the ack

## Decisions Made

- `pif_app.build` now treats `buildId` as the correlation key between the request ack and the broadcast result.
- Build children are tracked in `hub.children` under `app-build:<buildId>` so shutdown can terminate them.
- Build output is bounded to the last 4000 characters so the result envelope does not grow without limit.
- The previous ack-only build shape is superseded by a success/nonzero/spawn-error `build_result` broadcast on `app/build`.

## Lessons Learned

- A seeded `pif_app/app.yaml` plus a child-process stub is enough to exercise the live hub control path without starting Flutter or the real export script.
- The websocket broadcast path can be verified independently of the export binary by watching for the `app/build` envelope.
- `PIF_CHANNELS` must include `app`; otherwise the shared envelope validator rejects the broadcast channel.

## Current State

- `extensions/pif.ts` and `extensions/pif-shared.ts` carry the implementation already in the worktree.
- Diagnostic evidence:
  - success: `started=true`, `ok=true`, matching `buildId`, `code=0`, output length `4000`
  - nonzero exit: `started=true`, `ok=true`, matching `buildId`, `code=7`
  - spawn error: `started=false`, `ok=false`, matching `buildId`, `error=spawn boom`
- No real export ran. T2/T3 validation remains with the later integration and verification packets.
