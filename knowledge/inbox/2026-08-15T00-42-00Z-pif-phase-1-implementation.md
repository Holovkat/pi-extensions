---
type: Inbox
title: pif Phase 1 Implementation Reached T2

description: Implemented and verified the Pi-hosted Flutter agentic IDE primitives for epic 120, including the hub, shell, base widgets, tools, and Diff Viewer dogfood
tags: [pi-extensions, pif, flutter, implementation, verification, github]
timestamp: 2026-08-15T00:42:00Z
generated_at: 2026-08-15T00:42:00Z
generated_by: coding-session
session_id: 01a0029a-47bf-70f4-af7a-5c71e930a5bb
commit_sha: []
branch: feat/pif-phase1
issue_refs: [120, 121, 122, 123, 124, 125, 126, 127, 128, 129]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Implemented the Phase 1 pif system: a Pi extension hub with authoritative WebSocket and control-socket state, host and child session routing, Flutter machine-protocol supervision, analyze-gated widget lifecycle, generated registry, and eight Pi tools. Added the macOS Flutter shell, docking layout, common widget contract, five core widgets, local catalog example, and non-core Diff Viewer dogfood widget.

Added Node unit/integration coverage and Flutter widget/integration coverage. The integration path runs a real Pi-hosted hub and real macOS Flutter shell, checks child lifecycle, snapshot recovery, dependency rollback, catalog and registry behavior, layout persistence, and reload. Existing council tests and packaging remain green. A combined fresh review found no remaining material findings and judged the epic ready for Dev UAT at T2.

# Decisions Made

- Kept the hub authoritative while allowing the Flutter shell to apply idempotent deltas and recover complete session transcripts, registry, catalog, and layout from snapshots.
- Used Pi extension events for host delta fidelity; the documented JSONL fallback was not needed because current events expose message and tool streaming updates.
- Kept invalid in-place widget source editable but outside the generated registry; registry analysis validates the enabled import closure without allowing one unfinished source folder to block all later installs.
- Made dependency-bearing installs transactional by restoring `pubspec.yaml` and `pubspec.lock` when pub resolution or analysis fails.
- Represented panel visibility independently from widget enablement so layout open, focus, move, and close survive reconnects without uninstalling or disabling widgets.
- Kept pif outside the existing `@holovkat/pi-council` package entrypoint to avoid changing that package's published extension contract; pif remains a repo extension and source-run Flutter app.

# What Was Deprecated

Nothing. The implementation adds the approved pif surface without replacing `pi-dev`, Toolshed, council, or other existing extensions.

# Lessons Learned

- Flutter's machine protocol expects request arrays even when sending one JSON-RPC request; object-shaped requests cause reload timeouts.
- RPC process EOF is not a safe shutdown assertion while an extension owns open servers. `/pif-stop` must close hub resources and children before terminating the host process.
- Snapshot recovery must hydrate the renderer's view model, not only its backing session registry, or conversation history appears lost after reconnect.
- Widget enabled state and panel open state are separate concepts and must not be collapsed.
- Integration tests that launch Flutter and run Dart analysis must execute serially to avoid toolchain lock contention and false timeouts.

# Current State

Tasks #122-#129 are implementation-complete and their T2 evidence is recorded in `pif/VERIFICATION.md` and `pif/DOGFOOD.md`. The complete pif and existing council validation gates pass, the macOS debug app builds, and independent re-review scores the delivery 97/100 with no blocking findings. The remaining stage is owner-led Dev UAT (T3) in the canonical local macOS shell; no push, merge, deployment, or release action has been performed.
