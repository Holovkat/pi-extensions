---
type: Inbox
title: pif Model Manager — Provider Config UI and Model Dropdown
description: Added a model manager dialog for configuring pi model providers and a model dropdown in Session Rail, with hub-side read/write to models.json
tags: [pi-extensions, pif, flutter, models, model-manager, configuration]
timestamp: 2026-08-15T06:03:10Z
generated_at: 2026-08-15T06:03:10Z
generated_by: dev-session
session_id: pending
commit_sha: []
branch: master
issue_refs: [130]
epic_refs: [120]
capture_tier: session
---

# What Was Done

Added a model manager to pif so users can configure model providers and see available models from within the app, without editing `~/.pi/agent/models.json` by hand.

## Hub (pif.ts)

- Added `modelProviders` to `HubState` — included in every snapshot so the Flutter app has the full provider config.
- Added `modelsPath` (resolves to `~/.pi/agent/models.json`).
- Added `readModelsConfig()` — reads models.json and returns the `providers` object.
- Added `refreshModels()` — re-reads `modelRegistry.getAvailable()` for the model list, re-reads models.json for providers, broadcasts a new snapshot.
- Added `modelsAction(type, payload)` — handles `save` (writes providers to models.json, refreshes) and `refresh`.
- Added `models/` channel handling in the WebSocket `receive` method.
- Added `models.save` and `models.refresh` to the control socket method switch.

## Flutter

- **`model_manager.dart`** (new): A dialog launched from Session Rail. Shows:
  - Available models (read-only list from `host.models`)
  - Custom providers (editable, from `host.modelProviders`) — each as an expandable card with models list, add/remove buttons
  - Add Provider form (name, base URL, API key, API type)
  - Add Model form (model ID, display name) per provider
  - Note: "Restart pi for new providers to take effect"
  - Save sends `models/save` to the hub, which writes to models.json and broadcasts a new snapshot

- **`session_rail.dart`**: Added a "Model Manager" icon button (tune icon) in the SESSIONS header, next to the New Session button. Opens the model manager dialog.

- **`plugin.dart`**: Added `modelProviders` field to `PifHost`.

- **`docking_shell.dart`**: Reads `modelProviders` from the snapshot and populates `host.modelProviders`.

# Decisions Made

- Include full provider config (including API keys) in the snapshot. The WebSocket is localhost-only (127.0.0.1), so the security risk is minimal. This avoids a separate request-response roundtrip for the model manager.
- The model manager is a dialog launched from Session Rail, not a separate panel widget. This keeps it close to where models are selected (the New Session dialog dropdown).
- After saving, the hub writes to models.json and calls `refreshModels()`. The model registry may not pick up changes without a pi restart — the dialog notes this.
- The New Session dialog's model dropdown (already implemented) will show updated models after the hub refreshes and broadcasts a new snapshot.

# What Was Deprecated

Nothing deprecated. The existing model dropdown in the New Session dialog continues to work — it reads from `host.models` which is populated from the snapshot.

# Lessons Learned

- Pi stores model configuration in `~/.pi/agent/models.json` with a `providers` object. Each provider has `baseUrl`, `apiKey`, `api` type, and a `models` array.
- The `modelRegistry.getAvailable()` may not re-read models.json at runtime — a pi restart may be needed for new providers to appear in the registry.
- Including configuration data in the hub snapshot is a simple pattern for read-only display in the Flutter app. Writes go through a separate `models/save` channel.

# Current State

All code is on `master`. Tests pass (5 Node, 11 Flutter, dart analyze clean). The model manager is accessible from Session Rail via the tune icon. Hub-side changes require a pi session restart to take effect.
