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
- The affected Node gate before the later native bootstrap/portability findings passed **79 tests**, including real Pi hub controls, analyzer gates, project/catalog resolution, Flutter supervisor launch and machine-protocol reload. This includes two added output-publication regressions.
- After the native findings, **eight focused packaging checks pass**, covering runtime copying, portable retained kits, publication, source filtering and resource resolution. The fresh headless app-init integration regression also passes. The 129 Flutter tests remain applicable; no Dart/native UI source changed during these packaging repairs.
- Added regression coverage includes secure-token UI/service boundaries, environment switching, rejected secure storage, stale results, local identity/path validation, repository recovery, ancestor-repository isolation, and Settings preserving a live console draft in tabbed and split layouts.
- The real-hub smoke initially read preferences before asynchronous native model validation completed. Waiting for its actual completion event fixes the harness race without weakening persistence assertions; the targeted smoke passed.
- Combined source review led to repairs for crash-recoverable locks, inaccessible Keychain recovery, stale panel focus, source ownership during runtime-only fallback and definitive repository rejection recovery.
- Widget tests exposed a New Project dropdown overflow. Expanding the control and truncating long selected labels resolves the three onboarding cases.
- The first stock macOS build passed, including kit validation, secrets scan and strict signing. Rebuilding exposed a genuine readonly-kit output replacement failure. Both builders now stage and validate first, publish with rollback and clean old output without following symlinks. The repaired build and a subsequent repeat build pass; both produce the same builder version.
- The first real child-kit Pi launch failed before export: the generic source filter removed 1,979 runtime files in dependency folders named `build`, including TypeBox's required module. Source-cache filtering now applies only to source inputs; runtime packages retain executable build directories and copied kits preserve their exact inventory. Both builders additionally run the copied Pi CLI in an empty profile before publication. The failed service-proof fixture and logs are preserved; fresh-candidate proof follows below.
- Fresh headless `pif_app.init` then exposed a package-preparation race: only the overlay package was restored, leaving the writable host package without its Dart package identity. Manual host restoration confirmed the diagnosis; the public tool now restores the host before the overlay, retaining the analyzer gate and removing its dependency on preview startup. The original failed attempt remains recorded separately from the diagnostic retry.
- The diagnostic export signed successfully but its retained kit contained the creator's generated registry with absolute page imports. Installed builds now copy their canonical immutable kit instead of the mutable project template; source builds regenerate a base-only registry from included widget files. Runtime export staging remains project-specific. The failed portability evidence is retained and the final proof checks a further environment from the exported kit.

Test doubles and disposable local Git fixtures do not prove real Keychain authorization or live GitHub permissions.

## Installed candidate

- Installed path: `/Applications/pif.app`; launched process **53246**.
- Bundle size: approximately **526MB**, including the immutable kit.
- Strict deep signatures pass for the final installed app. Repeat-publication checks passed on the earlier repaired candidate; the latest stock build also passes the copied-Pi startup gate.
- **51 source comparisons** match the checkout to installed app/hub/builder resources, covering Dart widgets/core, catalog/templates, hub modules, packaging scripts and the native Keychain implementation. The kit contains **10,333 verified files**. The source-template registry is regenerated from included base widgets; runtime source comparisons remain exact.
- Builder version: `b0b9f4ff418e6cde292e3b7f47cd602a702419ebd3b13b95724edf02ad599465`.
- Final install evidence: `/tmp/pif-installed-builder-execution-2026-08-31/installed-portable-evidence.json`; build log: `stock-portable-final.log` in that same directory.
- Previous installed app preserved at `/tmp/pif160-installed.oHQBm9/previous-pif.app`; no unrelated app was stopped.
- Computer Use could not inspect the app because macOS was locked. The user was asked to unlock it. Launch/signature evidence is **not** a completed native UI walkthrough.

## Installed-resource environment and export proof (non-UI)

The final clean run is `/tmp/pif160-installed.oHQBm9/service-proof-v3`.
Its first Dart process imports the provisioning service from the installed
kit; its second process imports the copied service and kit from the first
environment. Neither uses checkout resources as inputs. Both report build
readiness on Flutter 3.44.8, Dart 3.12.2, Git 2.54.0, CocoaPods 1.16.2 and
Xcode 26.6.

- First environment UUID: `f0692629-3241-4985-bd92-66bc278261e8`.
- Child environment UUID: `6070efa1-653a-41e5-9387-66a78a3f4de2`.
- Both preserve their UUIDs and independent edits on reopen. Parent source
  edits, state, history, remote data and credential files are absent from
  the child. Reopen also works after the creator service process exits.
- The actual copied Pi runtime executes public `pif_app.init`, `page_add`
  and `build`, producing `home` and `details` pages. The host package
  configuration is absent before launch and no manual dependency
  restoration is performed.
- Successful build ID: `cc73ab2d-3b6d-4e81-9d43-9e67b0d7c0bc`.
- Export: `/private/tmp/pif160-installed.oHQBm9/service-proof-v3/child/build/Installed Build Proof.app`.
- The export passes strict deep signature verification. Owned headless Pi
  process **53893** exits cleanly; the harness also exits zero.
- The exported kit matches the input version and **all 10,333 files
  exactly**, with no additions, removals or changed bytes. It contains no
  creator page imports or project overlay.
- A process importing the exported kit's Dart service creates a third
  environment, UUID `ce612a75-b984-4903-8f1d-467d5d423c54`. It reports build
  readiness and preserves its own edits on reopen with the creator
  unavailable, without inheriting creator source/state.
- Final evidence: `service-proof-v3/evidence/final-proof-summary.json`.
  All nine recorded owned hub/build processes are confirmed stopped.

This is real filesystem, toolchain and build-path evidence. It does not
replace picker interactions, visual preview, configured agent responses,
Keychain authorization or active GUI process-ownership checks. The earlier
`service-proof` and `service-proof-v2` failures remain preserved; the V2
manual dependency restoration was diagnostic and is not a clean pass.

## Remaining acceptance boundaries

- #160 remains open for the native walkthrough of installed stock → editable environment → child environment → export, including Settings, preview, restart and configured agent interaction. The automated/non-UI evidence above does not close that gate.
- A user-authorized token and disposable GitHub repository are required for live Save/Validate/Replace/Remove, repository creation, issue hierarchy and restart/isolation checks. No actual token was read or remote repository created by the automated tests.
- The export filename and app manifest carry `Installed Build Proof`, but native `CFBundleName` remains `pif` and `CFBundleDisplayName` is absent. Native naming/branding must be checked during the remaining export walkthrough; the build proof does not establish that UI detail.
- #206/#212 remain independent owner gates for the Mercury sample design/appearance. These remediations do not approve that sample or close the epic.
- No merge, hosted deployment or release acceptance is implied by local implementation or tests.

Raw logs and bounded diagnostic artifacts are in `/tmp/pif-installed-builder-execution-2026-08-31/`. Failed attempts are retained alongside passing reruns.


## Owner follow-up: New Project workflow simplified

The owner found the saved-project recovery surface confusing. Live evidence
showed `pif-test-app-1` already had a linked GitHub repository and saved local
identity, but no editable source or private builder kit. The picker inspected
that state without continuing preparation; the repository dialog also gated
preparation on whether the identity was created in that particular dialog.

The corrected flow is name/location → relevant repository connection/review →
automatic workspace preparation → open. Saved local/linked decisions skip
repeated repository operations. Settings is a quiet, stable header reference;
returning preserves drafts and the active step. The normal picker no longer
shows Retry setup, SDK selection or Open without preview. Only a detected
failure exposes Review setup, and the Flutter locator appears only when
Flutter discovery fails. Existing repository-only Settings operations remain
available without requiring the authoring preparation gate.

Validation for this follow-up:

- Dart analysis is clean; the complete Flutter suite passes **142 tests**.
  This includes **10 onboarding and six picker workflow regressions** for
  staged fields, Settings return, saved decisions, partial setup, preservation,
  relevant recovery and ready-project reopening.
- The required Node hub integration suite passes **15/15**. No Node product
  code changed in this follow-up. One analyzer style warning was corrected;
  initial test-harness fake/real event-loop stalls were repaired without
  weakening the behavior assertions.
- Final stock build and strict deep signature pass. Installed at
  `/Applications/pif.app`, launched as **PID 69833**. All four changed Dart
  product files match the installed resources. Builder version:
  `eba148290911035dff9d53479eb5abf0ccd0ae37b858ab71027bc5467fde84d2`
  (**10,333 files**). This supersedes PID53246 for the installed candidate.
- Computer Use verified the simplified landing page, name/location-first
  dialog and preservation of the entered name after Settings. The native
  chooser opened as a separate `osascript`-owned dialog outside the captured
  PIF window, confirmed by the owner's screenshot. Computer Use could not
  address that helper, so fresh-project folder selection/full creation was
  not completed through GUI automation; widget tests cover that progression.
- On the final installation, clicking the existing `pif-test-app-1` recent
  entry automatically created the missing editable workspace and opened
  the shell with **Hub connected**. Its UUID and repository-decision file
  remained unchanged; the source and private kit now exist with the final
  builder version. No token was read, re-entered or changed by the agent, and
  no repository create/update/delete operation was requested by this check.

Evidence is in `/tmp/pif-new-project-workflow/`, including before/after
preservation checks, installed/build/test logs and native screenshots. The
previous app is retained at `previous-pif.app` in that directory. PIF is left
open on the owner's project. This scoped workflow repair does not close #160,
replace live credential lifecycle verification or approve #206/#212.

## Owner follow-up: GitHub Settings has one validation action

The GitHub card now uses plain repository-access wording, without an environment
UUID or a claim that the token grants access to only one repository. Saved
credentials appear as a fixed masked placeholder; the actual token is never
returned to the UI. Typing replaces the placeholder. Remove is an inline close
icon shown only for a confirmed saved token. The sole button, **Validate**, sits
below the field on the right. When neither a saved nor entered token exists,
both actions are hidden and entry guidance remains.

Validate uses the entered candidate, or the existing Keychain token when the
field is blank. Native validation-before-replacement and environment isolation
are unchanged. A failed replacement preserves the saved credential and shows
the actual safe error. Locked/unknown Keychain status keeps explicit Validate
available without falsely claiming a saved token or offering removal.

Every successful validation now refreshes repository/tracker access, including
repeat checks and replacements for the same account. This reuses the existing
read-only repository checks; it never creates a repository or changes origin.
The separate repository setup action was removed from Settings and retained in
the Tracker only for local-only projects with no linked repository.

Evidence for this follow-up:

- Flutter analysis is clean; **151/151 Flutter tests** and **15/15 Node
  integration tests** pass. Token/UI regressions cover empty, typed, stored,
  failed replacement, removal, busy, keyboard, locked Keychain and environment
  switching. Service tests cover repeated same-account validation and stale
  results. Tracker coverage preserves the local-only setup route. Independent
  production diff review found no remaining actionable findings.
- Stock build, strict deep signature and installation passed. Installed at
  `/Applications/pif.app`, running as **PID 83021**. All four changed Dart
  product files match installed resources. Builder version is
  `51b92859504060b1ffb80475d8ecf9447446a0ff72a45c6e16cb2e2787f47ba1`
  with **10,333 files**. The prior installation is retained at
  `/tmp/pif-settings-workflow/previous-pif.app`.
- Computer Use visually confirmed the simplified Settings card on the owner's
  `pif-test-app-1`. Clicking Validate with the field blank completed successfully
  and showed **Connected to GitHub as Holovkat.** The tracker cache's successful
  fetch timestamp advanced from `2026-08-31T12:24:24.479Z` to
  `2026-08-31T12:25:07.931Z`, proving the existing repository access path refreshed.
  Project identity and repository-decision SHA-256 values are unchanged. No
  token was extracted, re-entered, replaced or removed by the agent.
- Native automation has a separate limitation: Flutter emitted AXTree update
  diagnostics and Computer Use returned intermittent `AXError.failure` while
  its accessibility tree lagged the visible screen. Visual inspection and one
  live validation succeeded, but the attempted second native click did not
  establish another refresh. Repeated validation, replacement and removal are
  covered by synthetic regressions, not claimed as live credential-lifecycle
  proof. This run is not described as warning/error-free. The macOS build also
  retained the non-fatal attached-iPhone passcode diagnostic.

Logs, installed-source checks, screenshots and timestamp/preservation evidence
are in `/tmp/pif-settings-workflow/`. PIF is left open on Settings with a validated
connection. #160 remains the acceptance owner; the accessibility diagnostic,
fresh-project chooser completion, broader credential lifecycle and independent
#206/#212 sample acceptance remain outside this completed Settings correction.
