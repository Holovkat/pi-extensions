---
type: Inbox
title: Central pif Settings and shared application appearance T1
description: Added the small Appearance and environment GitHub Settings surface, shared theme preference, and persistent central tab lifecycle for issue 223.
tags: [pif, settings, appearance, github, shell, theme, t1]
timestamp: 2026-08-31T09:40:16Z
generated_at: 2026-08-31T09:40:16Z
generated_by: codex-central-settings
branch: codex/pif-app-builder-154
issue_refs: [223, 221, 219, 160]
epic_refs: [152]
capture_tier: session
commit_sha: []
---

## What was done

Prepared #223's core `pif_settings` center tab with exactly Appearance and GitHub groups. The grouping borrows the approved Mercury heading, icon, help text and rounded section pattern while retaining pif's typography, green accent and docking shell. The appearance choice sits beside its description at wide widths and stacks at narrow widths. The GitHub group uses #221's `GithubConnectionScope` and service; it masks and clears transient token input, clears drafts when environment identity changes, and renders actual native status instead of inventing saved or connected results. Without an environment, token controls are disabled.

`PifAppearanceService` owns only non-secret `~/.pi/pif/preferences.json` data. System is the default. Root MaterialApp Light/Dark/System selection applies immediately and delegates OS brightness response to Flutter. Serialized atomic writes preserve other preference keys and show a visible error if persistence fails; `flush()` lets the root app exit wait for a just-requested write. Generated export mode does not instantiate or read this personal preference, preserving the existing product theme path. Export or sample appearance approval is not implied.

The shared `PifTheme` now provides light and dark shell colors. Small readability changes cover the console, terminal chrome, session selection, status bar, widget-store diagnostics, diff surfaces and error controls; terminal output retains its own terminal theme. No widget redesign was performed.

Settings opens through the existing layout action and canonical generated registry and remains closeable even though it is a core widget. Existing focus-keyed tab controllers would have destroyed live tab content on Settings navigation, so the docking controller now preserves keyed panel elements with an IndexedStack across open, focus and close changes. The optional shell callback `onOpenProject` exposes the root-owned New/Open environment action without controlling session lifecycle itself.

## Decisions and rejected paths

- Kept application preferences separate from environment-scoped secure credentials. There is no global token, browser sign-in, OAuth, credential bus payload or fake save result in this surface.
- Used the reserved `pif_settings` center widget ID, distinct from a generated product's `settings` page.
- Kept one existing docking/registry mechanism. Regenerated `widget_registry.g.dart` with `parseWidgetManifest` and `generateWidgetRegistry` from `extensions/pif-shared.ts`; did not hand-maintain another registry.
- Preserved the host/session object while updating its shared theme; rebuilding the host on theme changes was rejected because it could lose live state.
- Root owns hub enable/open/reserved-ID behavior, GitHub scope/environment binding, app-exit flushing and later tracker call-to-action integration. This slice does not claim those integrations independently complete.

## T1 evidence and remaining gates

The targeted `dart analyze` pass covered appearance, plugin, docking, panel error boundary, Settings, generated registry and each touched built-in widget, and returned `No issues found!` after #221's service landed. `git diff --check` passed. No source tests were added, and no full test suite, build, app process, install, commit, push or tracker mutation was performed by this slice.

The bounded source-contract/contrast diagnostic is `/tmp/pif-installed-builder-execution-2026-08-31/check-223-settings.mjs`, with results in `223-settings-diagnostic.json`. It checked the nine-widget canonical registry, reserved center Settings contract, open/close hooks, persistent panel stack, System default, atomic preference path, export guard and transient token clearing. Shared foreground/background contrast ratios range from 4.90 to 13.83 across Light and Dark. These are source and palette assertions, not runtime accessibility or navigation proof.

#160 still owns added widget/integration tests and combined review: Settings open/focus/close/reopen with live console/tracker state, keyboard/focus/scroll/narrow-window behavior, immediate Light/Dark/System with actual OS brightness changes, persistence after restart, generated-product theme isolation, native failure states and two-environment GitHub operations without state bleed. Installed `/Applications/pif.app` UAT and all release gates remain separate.
