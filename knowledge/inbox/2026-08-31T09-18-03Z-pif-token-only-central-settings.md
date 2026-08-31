---
type: Inbox
title: Token-only GitHub access and small central Settings area
description: Owner narrows GitHub authentication to environment-scoped secure tokens and adds a Mercury-inspired Settings tab with basic appearance.
tags: [pif, planning, settings, github, authentication, appearance]
timestamp: 2026-08-31T09:18:03Z
generated_at: 2026-08-31T09:18:03Z
generated_by: codex-root
branch: codex/pif-app-builder-154
issue_refs: [152, 153, 160, 204, 219, 221, 222, 223]
capture_tier: session
---

## What changed

Updated [#221](https://github.com/Holovkat/pi-extensions/issues/221) to token-only GitHub authentication. The token belongs to the current environment's secure store, implemented through macOS Keychain namespaced by environment UUID. No browser/device/OAuth flow, ambient global-login fallback or inherited parent credentials. Save/Validate/Replace/Remove must be masked, recover safely and preserve environment isolation. No token is stored in the workspace or export.

Created [#223](https://github.com/Holovkat/pi-extensions/issues/223), a native child of existing verification #160, for one central Settings tab/page with only Appearance and GitHub groups. Appearance has Light/Dark/System, System default, immediate application, OS response and non-secret local preference persistence. GitHub embeds #221's environment token controls/status. Do not import Mercury's additional navigation levels, advanced colour sliders, org/fleet/map/voice settings, authentication services or a new settings framework.

## Source and decisions

An independent read-only source pass verified Mercury's settings navigation, rounded section/row components and theme page/service at clean reference commit 499de88aa012d861499dc817af4a1e1ff90c972c. The source/UX pass confirmed the small two-group scope matches the user request. pif retains its own visual identity and existing central docking/registry pattern; application Appearance must not override generated products' pinned themes or imply #212 sample design approval.

The previous browser-first/shared-account proposal is superseded. Allocate local environment identity before token setup; GitHub creation follows using that environment's credential without waiting for Flutter build readiness. #223 UI can be prepared independently; #221 integrates after #219 identity and #223; #222 then uses that adapter. Updated epic #152, sprint #153, verification #160, matrix #204 and #219/#222 to match. The tracker is authoritative for the detailed acceptance packets.

## Current state

#160 has 33 native remediation children, including seven To Do tasks, 24 in Review and the two independent sample design/appearance blockers #206/#212. #221/#223 are planned, not implemented. This session changed tracker requirements and project notes only: no application code, runtime testing, credential entries, repositories, toolchains or deployment changed.
