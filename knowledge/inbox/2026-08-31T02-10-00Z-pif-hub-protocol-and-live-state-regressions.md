---
type: Inbox
title: pif hub protocol and live-state regression coverage under test ticket 160
description: Focused regression evidence for app build replies, manifest identity and publication, and hub-authoritative dev mode, including real control and WebSocket connections across restart
tags: [pi-extensions, pif, testing, protocol, manifest, dev-mode]
timestamp: 2026-08-31T02:10:00Z
generated_at: 2026-08-31T02:10:00Z
generated_by: codex-orchestrator
session_id: pending
commit_sha: []
branch: codex/pif-app-builder-154
issue_refs: [160, 192, 193, 194, 208]
capture_tier: session
---

# What Was Done

Extended the existing Node unit and integration suites under the sole T2 owner, #160. Unit coverage exercises correlated, exactly-once app build result envelopes for successful, failed and spawn-error children while the hub remains responsive. It checks the output tail bound and restores patched process bindings. Manifest coverage includes block and inline lists with `settings`, `search` and other s-prefixed identifiers, invalid controls, and render/parse round trips.

Integration coverage checks that init/page publication waits for the install gate and that failed gates do not expose speculative manifests. The live app-init fixture connects before initialization, observes init/page/home changes on the same WebSocket without requesting a snapshot, uses `settings` as home, and verifies that home and dev mode survive an owned hub restart. It exercises the actual control socket and WebSocket dev-mode commands. Bounded in-process checks additionally cover invalid values, preservation of other shell preferences, and redacted malformed-JSON failures.

# Decisions Made

- Reuse the existing isolated test harness and disposable app/catalog/model/workspace roots.
- Keep fake-child process outcomes separate from real process cleanup evidence.
- Use the real package/analyzer/install path in one live fixture; stub only the explicit install gate for failure/publication tests.
- Remove message, close and error listeners and their timer when a socket wait settles, including failure paths.

# What Was Deprecated

The app-init regression's reconnect/snapshot-request crutch no longer masks missing live manifest publication.

# Lessons Learned

Focused fake-peer checks and a real connected-client test prove different boundaries. A restart assertion is necessary to detect persisted manifest identity or shell-preference regressions.

# Current State and Evidence

At source HEAD `3e791100` with concurrent in-progress remediation files present, the focused combined command passed 7 tests, 0 failed, in 29.645 seconds:

```sh
node --test --test-concurrency=1 --test-name-pattern='pif envelope codec|parseAppManifest|app manifest updates|pif_app.build|manifest publication waits|dev mode synchronizes|pif_app_init scaffolds' extensions/pif.test.mjs extensions/pif.integration.test.mjs
```

Run log: `/tmp/pif-remediation-2026-08-31/first-hub-regressions.log`. This is interim development evidence, not a clean final candidate. The live fixture starts an isolated Pi/hub and runs Flutter package/analyzer work; it does not launch a Flutter application, obtain a provider answer, or prove installed-bundle integrity. Malformed shell state was tested; actual permission-denied state was not. Complete `npm run test:pif` gate runs remain zero. #160 acceptance and owner gates remain open.
