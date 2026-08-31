# Installed pif builder remediation — 31 August 2026

This report covers #204 and #218–#223 under epic #152, sprint #153 and final verification ticket #160. It extends, rather than replaces, the [earlier remediation report](./2026-08-31-remediation-verification.md). The earlier `dc45ff40` results do not establish acceptance of this additional scope.

## Implemented scope

| Ticket | Implementation |
|---|---|
| #218 | Versioned, integrity-checked builder kit bundled with stock and exported apps; explicit resource resolution, portable Node/Pi and a writable template copy. |
| #219 | New/open local development environments with stable UUIDs, independent source/state/cache, toolchain readiness, recovery and repeatable child creation. |
| #220 | Installed-resource export through the existing asynchronous, correlated build lifecycle; compiled exports remain runtime products. |
| #221 | Environment-scoped macOS Keychain token storage, native bounded GitHub adapter and a metadata-only local bridge; no global GitHub login fallback. |
| #222 | Explicit Create/Connect/Local-only onboarding, repository verification, durable creation recovery and environment-bound asynchronous tracker CRUD/native parent links. |
| #223 | One central Settings surface with Appearance (Light/Dark/System) and GitHub, available before project launch and from the shell. |
| #204 | Canonical spec, support instructions and project-state reconciliation for the settled installed-builder requirement. |

## Verification and repairs

- Dart analysis passed. The complete Flutter suite passed **129 tests** after a focused repair preserving the existing dark-console text colour.
- The final affected Node gate passed **79 tests**, including real Pi hub controls, analyzer gates, project/catalog resolution, Flutter supervisor launch and machine-protocol reload. This includes two added output-publication regressions.
- After the real-runtime copy finding, **four focused packaging checks pass** (the two publication cases, exact runtime/kit copying and the canonical empty-profile Pi smoke). The 129 Flutter tests remain applicable; no Dart/native UI source changed during these packaging repairs.
- Added regression coverage includes secure-token UI/service boundaries, environment switching, rejected secure storage, stale results, local identity/path validation, repository recovery, ancestor-repository isolation, and Settings preserving a live console draft in tabbed and split layouts.
- The real-hub smoke initially read preferences before asynchronous native model validation completed. Waiting for its actual completion event fixes the harness race without weakening persistence assertions; the targeted smoke passed.
- Combined source review led to repairs for crash-recoverable locks, inaccessible Keychain recovery, stale panel focus, source ownership during runtime-only fallback and definitive repository rejection recovery.
- Widget tests exposed a New Project dropdown overflow. Expanding the control and truncating long selected labels resolves the three onboarding cases.
- The first stock macOS build passed, including kit validation, secrets scan and strict signing. Rebuilding exposed a genuine readonly-kit output replacement failure. Both builders now stage and validate first, publish with rollback and clean old output without following symlinks. The repaired build and a subsequent repeat build pass; both produce the same builder version.
- The first real child-kit Pi launch failed before export: the generic source filter removed 1,979 runtime files in dependency folders named `build`, including TypeBox's required module. Source-cache filtering now applies only to source inputs; runtime packages retain executable build directories and copied kits preserve their exact inventory. Both builders additionally run the copied Pi CLI in an empty profile before publication. The failed service-proof fixture and logs are preserved; fresh-candidate proof follows below.

Test doubles and disposable local Git fixtures do not prove real Keychain authorization or live GitHub permissions.

## Installed candidate

- Installed path: `/Applications/pif.app`; launched process **48193**.
- Bundle size: approximately **526MB**, including the immutable kit.
- Strict deep signatures pass for the installed app and repeated build output.
- **51 source comparisons** match the checkout to installed app/hub/builder resources, covering Dart widgets/core, catalog/templates, hub modules, packaging scripts and the native Keychain implementation. The kit contains **10,333 verified files**.
- Builder version: `38599d45c7dbff7e2a6c89210213d82d534f7a9ae3f1da1e126dc887874513cd`.
- Previous installed app preserved at `/tmp/pif160-installed.oHQBm9/previous-pif.app`; no unrelated app was stopped.
- Computer Use could not inspect the app because macOS was locked. The user was asked to unlock it. Launch/signature evidence is **not** a completed native UI walkthrough.

## Installed-resource environment proof (non-UI)

The canonical Dart provisioning service was loaded from the installed kit
to create `/tmp/pif160-installed.oHQBm9/service-proof/first`. A second
process loaded the copied service and kit from that first environment to
create `service-proof/child`; neither used checkout resources as inputs.
Both reported build readiness on Flutter 3.44.8, Dart 3.12.2, Git 2.54.0,
CocoaPods 1.16.2 and Xcode 26.6.

Checks passed for distinct persisted UUIDs, the same verified builder
version, absent parent credential/state/history/remote data, absence of
parent source edits in the child, preservation of independent edits on
reopen, and reopening after the creator service process exited. This is
real filesystem/toolchain provisioning evidence; it does not replace
picker interactions, visual preview or active GUI process-ownership tests.

## Remaining acceptance boundaries

- #160 remains open until installed stock → editable environment → child environment → export workflows have current evidence.
- A user-authorized token and disposable GitHub repository are required for live Save/Validate/Replace/Remove, repository creation, issue hierarchy and restart/isolation checks. No actual token was read or remote repository created by the automated tests.
- #206/#212 remain independent owner gates for the Mercury sample design/appearance. These remediations do not approve that sample or close the epic.
- No merge, hosted deployment or release acceptance is implied by local implementation or tests.

Raw logs and bounded diagnostic artifacts are in `/tmp/pif-installed-builder-execution-2026-08-31/`. Failed attempts are retained alongside passing reruns.
