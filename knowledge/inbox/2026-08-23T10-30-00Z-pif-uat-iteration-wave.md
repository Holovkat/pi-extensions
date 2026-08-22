---
type: Inbox
title: pif UAT Iteration Wave — Docking UX, Console Polish, Standalone Resilience
description: Eight installed-app UAT rounds (#139-#149) covering draggable tabs, turn footers, preference persistence, the snapshot race root-cause, responsive/resizable docks, and pin/unpin overlays
tags: [pi-extensions, pif, flutter, uat, docking, resilience]
timestamp: 2026-08-23T10:30:00Z
generated_at: 2026-08-23T10:30:00Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: master
issue_refs: [139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Iterated on the installed standalone app with the user testing each build from /Applications (#139–#149, all closed). The docking system reached feature completeness: draggable tabbed panels, layout reset, collapsing/responsive docks, center takeover, resizable dividers with persisted sizes, and pin/unpin slide-in overlays with edge grabbers for the Widget Store and Session Rail.

## Product changes

- **Docking**: tab labels are draggable (tabbed slots previously had no drag handle at all); Status Bar reset restores the default design; empty docks collapse and neighbours reclaim the space (with 7px drop edges so collapsed slots stay droppable); an empty center lets the bottom dock (Terminal) expand into the stage; dividers resize docks with clamped bounds; pin/unpin moves side panels to slide-in overlays triggered from viewport-edge grabbers.
- **Agent Console**: turns pair start/end with a footer showing duration plus copy-response/copy-code-blocks icons (Codex-style); host conversation text is unboxed, 13px, w300, #c9d3df.
- **Preferences**: model/thinking persist per project (.pi/pif/prefs.json), restore at hub start, and seed child-session defaults; the dropdown resolves provider-less ids by suffix match and shows set-but-unknown models instead of falling back to "Default".
- **Standalone resilience**: the app owns the pi lifecycle — a 12s watchdog restarts the pi session when state is missing or the connection drops (3 attempts, then back to the picker); adopted standalone hubs are shut down over the bus on quit; PifBus re-resolves the token each reconnect attempt.

# Decisions Made

- Snapshot delivery is re-requested in DockingShell.initState after subscribing, rather than caching/replaying envelopes in the bus — the shell is the only state consumer that matters and the request-after-subscribe pattern is race-free by construction.
- Terminal takeover of an empty center keeps a center drop edge rather than hiding the slot entirely.
- Pin/unpin is gated to widget_store and session_rail while docked left/right; pin state lives in layout.json panel entries (pinned flag) alongside slots and sizes.
- Dock sizes persist via a dedicated shell/layout resize action rather than layout_change, which wholesale replaces the layout object.

# Lessons Learned

- **The snapshot race (#144)**: hub-side diagnostics can be completely healthy (110 models, ESTABLISHED socket) while the UI sits empty — broadcast streams don't replay events missed before subscription. Verify the subscription window, not just the data. The Resync button in the title bar is the manual escape hatch for this class.
- **Orphaned pi processes**: pkill of the Flutter app leaves the pi child alive holding :31415; relaunches then connect to a stale hub with a mismatched token. Apps that spawn subprocesses must own their full lifecycle (watchdog + adopted-hub shutdown), not rely on clean exits.
- dart:io server.close(force) does not terminate upgraded WebSockets; unix-socket clients need UnixDomainAddress (not always available) — shutting hubs down over the authenticated WS bus avoids both.
- Widget-test drag gestures lose ~20px to touch slop; assert relative changes for drags and exact values via snapshot restores.

# Current State

- master at 41124b1, all UAT tickets closed, build/pif.app (293MB, valid signature) installed in /Applications.
- npm run test:pif green end to end (7 node unit + 2 integration + dart analyze + 25 Flutter tests).
- Known follow-ups not yet built: dismiss overlay on outside tap, double-click divider to reset size to default.
