# pif export pipeline (#159)

- date: 2026-08-30
- type: architecture
- tags: pi-extensions, pif, export, packaging, app-builder
- status: current
- resource: scripts/build-pif-project-app.sh

## What was done

`scripts/build-pif-project-app.sh <project-dir>` exports a pif project as a standalone macOS app: stages the app source, pins the project's widget set into `lib/widgets/`, generates the **pinned registry**, builds AOT, bundles Node/pi/extensions, ships the app manifest for first-run workspace bootstrap, writes a **launcher** (`PIF_EXPORTED=1` + per-app support dir + `PIF_APP_DIR` → bundled app source) that boots the app straight to its declared home page — no project picker — then re-signs and runs a **secrets scan** (models.json/.env/key-shaped material fail the export). `pif_app_build` is wired to it (async dispatch, result on the `app/build` channel). The Flutter shell skips the picker when `PIF_EXPORTED=1`.

**Proof:** the Mercury sample ("Team Pulse", from the #158 fixture) exported, launched, and verified live: boots to its Home page in app mode, hub connected, bottom-nav (Home | Metrics), workspace at `~/Library/Application Support/pif-apps/team-pulse`.

## Decisions

- AOT-frozen widget set: exported apps run the widget set compiled at export; rebuild to change it (documented in the script + spec).
- Manifest truth at runtime stays workspace-based: the launcher copies the bundled app.yaml into the per-app support dir on first run — the hub needs no new manifest-path logic.
- Export requires the dev checkout (the script ships in `scripts/`); the installed hub returns a clear error otherwise.
- Secrets policy enforced by scan step; first-run model provisioning documented in the script summary.

## Lessons

- **Generation/export runs with PIF_APP_DIR pointing at the repo's app source write the repo's widget registry** — the #158 fixture run committed a polluted registry and every flutter run after failed until it was regenerated. Restore/regenerate the registry after any such run; better, run generation against a staged copy.
- Multi-word names break `read`-splitting — parse JSON, not positional fields.
