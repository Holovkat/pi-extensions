---
type: session-synthesis
title: Installed pif builder kit implementation for integration
description: Versioned self-contained builder resources, portable runtime resolution, immutable kit copies, and writable source staging for tasks 218 and 220.
tags: [pi-extensions, pif, app-builder, packaging, installed-builder]
timestamp: 2026-08-31T09:39:37Z
status: pending
resource: scripts/pif-builder-kit.mjs
---

## What was done

Task #218 now packages one complete builder at `Contents/Resources/builder/`.
The canonical stock and project build scripts use the same dependency-free
`scripts/pif-builder-kit.mjs` helper. The kit contains the version-matched
scripts, pif extension modules, package manifests, complete Flutter/macOS
source, widget/catalog/template inputs, app design/build skills, and portable
Node/Pi resources. Only declared input trees are copied; generated apps,
developer caches, native build state, profiles and project history are excluded.

The manifest has schema version 1, a content-derived `builderVersion`, app and
runtime versions, explicit relative layout paths, prerequisites, and per-file
integrity records. Consumers validate the kit and the existing secret policy
before use. Both builders retain the source-checkout entry path and accept
`PIF_BUILDER_ROOT`, `PIF_BUILDER_VERSION`, and `PIF_APP_TEMPLATE_DIR` for installed
or provisioned environments. Kit paths never fall back to global Pi/Node.

## Decisions

- Installed resources are read-only. `copy-kit` creates an independently
  verifiable read-only kit; `copy-template` produces a writable Flutter tree
  outside it. Destination collisions and signed-bundle write targets fail.
- The environment lane uses `.pif/builder` for the kit and `pif` for writable
  source. Environment identity and persistence remain #219 ownership.
- Export stages are unique owned directories, so a build never clears another
  staging tree. Both installed stock builds and exports restore/build only in
  writable locations. No recursive bundle copying is used.
- The established export scanner is now a shared helper and also scans every
  kit input. There is no trusted-build-input exemption. Auth/credentials JSON
  filenames are additionally rejected. Binary/compressed/encrypted payload
  limitations remain explicit.
- Packaging deep-signs nested binaries, refreshes manifest checksums, then
  signs only the outer app. A second deep-sign must not rewrite files after
  their integrity records are sealed.
- Flutter/Dart, full selected Xcode, Git and CocoaPods are explicit development
  prerequisites, not bundled toolchains. No tools or credentials are installed.

## Superseded assumptions

The source-checkout-only export resource assumption is superseded by an
explicit installed kit contract. This session does not claim that installed
authoring is accepted: hub wiring, environment UI integration, and #160 gates
are separate work.

## Evidence and current state

- `bash -n` passes for the three owned shell scripts; `node --check` passes
  for the helper; `git diff --check` passes.
- A task-owned artifact diagnostic created/validated an approximately 203 MB,
  8,350-file kit with Node v22.22.0 and Pi 0.84.2, then copied a second
  generation kit and writable template. No forbidden cache/user-state paths
  or developer home paths were found in its inspected source/configuration.
- Version mismatch, changed-file integrity, destination collision,
  signed-bundle output and credential-shaped input diagnostics rejected.
- A minimal `/tmp/pif-builder-kit-t1.fcLm7M/KitDiagnostic.app` wrapper passed
  strict codesign verification and post-sign kit integrity. It was not a pif
  build and was never launched. Minor later helper CLI/output refinements
  were syntax-checked; #160 must build the final integrated source.
- No tests were added/run, full pif build performed, installed app changed,
  process launched/stopped, tracker mutated, repository created, or commit made.

## Integration and verification handoff

The root hub consumes asynchronous helper `resolve` output and supplies the
chosen kit and writable source roots. #219 consumes `validate`, `copy-kit`,
and `copy-template`; staged read-only kit directories must be made writable
only within the owned staging area before rollback removal.

#160 owns scanner harness updates (the scanner moved out of an inline shell
heredoc), source/installed export regression, final app signing/relaunch,
clean-toolchain setup, and two-generation installed environment UAT. Per-kit
storage is approximately 203 MB; full-kit checks read that data and should run
off the hub/UI event loop. Final build/runtime acceptance remains unproven.
