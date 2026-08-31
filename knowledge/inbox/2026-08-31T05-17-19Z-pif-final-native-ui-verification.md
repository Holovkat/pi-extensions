---
type: Inbox
title: Final native pif UI verification retains explicit acceptance gaps
description: Rebuilt stock and exported apps pass bounded real UI checks at 3bc8e1fc; parent 160 remains blocked on remaining requirements and final combined gate.
tags: [pi-extensions, pif, verification, computer-use, export, transcript, packaging]
timestamp: 2026-08-31T05:17:19Z
generated_at: 2026-08-31T05:17:19Z
generated_by: codex
session_id: 01a0551f-90d2-79c0-9204-ce670574b247
commit_sha: [3bc8e1fc, abd1ea78]
branch: codex/pif-app-builder-154
issue_refs: [160, 187, 201, 204, 205, 206, 212, 215, 217]
capture_tier: session
---

# Work and decisions

Actual Computer Use found a nonportable Node export crash and a queued-Steer transcript duplication that build success and earlier checks had missed. Both canonical builders now preflight a portable runtime; the console preserves an active streaming message across queued Steer/follow-up. Final code candidate 3bc8e1fc was rebuilt into stock and exported artifacts and tested through real native provider calls.

The installed app passed valid New Session, resumed child Send, live Steer, transcript reopen, Abort and subsequent recovery. The export reopened at Settings, produced a real tool result and assistant answer, and returned from dev mode to app mode. Widget off/on operations left all 13,263 stock and 10,327 export bundle files unchanged; strict deep code signatures remained valid. Tracker fixture title/tags/image persisted on final reopen. The report distinguishes those final checks from earlier source UI mutation and compact-layout evidence.

# Lessons and superseded assumptions

- A successful signed build does not establish portable launch; execute the actual installed/exported artifact.
- Queued user input is not a native assistant-turn boundary. Compare live and reopened transcripts.
- Preserve candidate-specific results: Node 63/63, clean analysis and Flutter 77/77 are separate stages on 4972a603; the final queued-input change has eight passing focused tests and live UI proof. There is no passing combined gate at tip.
- Do not turn owner unlock into design approval or contract waiver. Three owner gates remain under #204/#206/#212.
- Inspect visible form labels when accessibility labels are missing. An operator-invalid working-directory attempt was retained in the evidence, corrected using the default, and not counted as a successful test.

# Current state

There are 27 native remediation children under #160: 24 implementation tasks in Review and three blocked owner decisions. The parent remains blocked. Stock is installed at /Applications/pif.app and left at its clean project picker as PID 52706; workflow test PID 49898 and export PID 49906 were normally quit with all owned descendants gone. Only the disposable Recent Project entry was removed. The original installed bundle and local test evidence are retained.

Full evidence and remaining limits: [remediation verification report](../../docs/reviews/2026-08-31-remediation-verification.md). This session updates the dated review reports, state snapshot and indexes only; no product source changes, merge or hosted release are included in this documentation handoff.

Documentation validation also found 35 pre-existing inbox files absent from the index. Their existing frontmatter was used to restore links and the root count now matches all 61 inbox files; no historical inbox content was modified or curated.
