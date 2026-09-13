---
type: Inbox
title: PIF app mode applies pinned template appearance
description: A manifest-pinned template id now swaps the app-mode Material theme for the template's paired semantic tokens; the IDE theme and untemplated projects are untouched.
tags: [pif, app-mode, theming, mercury, templates]
timestamp: 2026-09-13T00:00:00Z
generated_by: zcode-orchestrator
branch: codex/pif-app-builder-154
epic_refs: [152]
issue_refs: [212, 160, 158, 206]
capture_tier: session
---

# What Was Done

Task #212 implemented the optional pinned-template appearance binding at the
existing app-mode boundary. `pif/lib/core/template_appearance.dart` adds
`templateAppearanceFor`, which maps a manifest template id to a
`TemplateAppearance`; `mercury` resolves to the documented FMS Mercury palette
(design.json authority chain — light/dark pairs for page, surface,
surface_raised, navigation, accent, accent_soft, divider, text roles,
error, plus brightness-paired success/warning helpers for #206 status
components). Typography applies the template roles at 400/500 with the
No-Bold cap; component themes set navigation backgrounds, accent_soft
indicators, radius 12 controls, radius 20 cards, hairline dividers and the
2px accent focus outline.

`DockingShell._appScaffold` resolves `_appManifest['template']` and wraps the
app-mode Scaffold in a `Theme` when the id is recognized. The wrapper covers
the page stage, navigation rail/bottom bar and status dock. The title bar,
agent-console chrome and the IDE scaffold stay on `PifTheme`. Brightness
follows the IDE's effective theme, so Settings System/Light/Dark flows into
app mode; System remains the initial appearance.

# Decisions Made

The binding rides the existing Material `Theme` mechanism rather than a
sample-specific override or a second design system. Unknown or absent
template ids return null and keep the stock appearance (safe fallback).
Success/warning have no Material ColorScheme slot, so they are exposed as
static brightness-paired helpers on `MercuryTemplateAppearance` for the
Team Pulse status work under #206 instead of being misused as Material roles.
The console overlay deliberately keeps pif chrome: it is the authoring
agent-console surface slid over the app, so covering it would contradict the
"does not alter PIF's IDE appearance" rule; the ticket's "console surfaces as
appropriate" is read as page, navigation and status being bound, console
staying pif.

# What Was Deprecated

Nothing. Wrapping only sample page bodies was never shipped; this replaces
the planned per-page approach with the boundary binding the ticket asked for.

# Lessons Learned

The hub already ships the parsed app manifest (including `template`) inside
the snapshot, so the shell needs no new channel or file access to know the
pinned template. `Theme.of(context).brightness` at the boundary is the
correct pairing source because it reflects the resolved themeMode rather
than the raw platform setting.

# Current State

#212 is development complete (T1): clean `flutter analyze` and the focused
app-mode plus appearance-settings suites pass (29 tests). Per the ticket, #160
owns regression test additions and the final gate. Next: rebuild and install
pif for owner Dev UAT, then #206 authors the approved Team Pulse pages on
this theme foundation.
