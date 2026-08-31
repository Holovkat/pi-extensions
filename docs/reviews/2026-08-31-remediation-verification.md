**pif remediation verification — 31 August 2026**

**The repaired stock and exported apps passed the valid-workspace UI paths listed below. Full epic acceptance is still blocked.** The tested code candidate is `3bc8e1fc`, pushed on `codex/pif-app-builder-154`. Parent [#160](https://github.com/Holovkat/pi-extensions/issues/160) has **27 native remediation children: 24 implementation tasks in Review and three owner decision gates**. Implementation completion is not release acceptance.

The installed app is `/Applications/pif.app`, left running at the clean project picker as **PID 52706**. Its actual workflow test ran as PID 49898. The exported artifact is `/tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app`; it ran as PID 49906 and was normally quit after verification. The original installed bundle is backed up at `/tmp/pif-remediation-2026-08-31/installed-pif-before-abd1ea78.app`.

The [original three-day review](./2026-08-31-three-day-work-review.md) is preserved as the dated baseline. This report supersedes the earlier remediation status, not that historical review.

**Two defects found by actual UI testing and repaired**

1. **Export launch failure — [#217](https://github.com/Holovkat/pi-extensions/issues/217), fixed in `abd1ea78`.** The first signed export on `4972a603` aborted before showing a window because copied Homebrew Node required an unbundled `libnode.147.dylib`. Both canonical builders now validate a portable Node runtime before building, check the copied runtime with an empty environment and validate again after signing. The selected Node 22.22.0 has only system-library dependencies. Both final artifacts now launch and obtain real native-provider answers. Build and signature success alone had missed this failure.
2. **Steer transcript duplication — [#215](https://github.com/Holovkat/pi-extensions/issues/215), fixed in `3bc8e1fc`.** Queuing Steer during streaming split one assistant answer into a partial prefix and a second complete answer, with an early completion footer. Queued Steer/follow-up input now preserves the active assistant slot and real turn boundary. A regression fails on the previous candidate and passes on the fix; all eight focused transcript cases pass. The rebuilt installed app passed the same live operation and transcript reopen with one complete answer, one steering input and one final footer.

Earlier UI findings also produced #214 (compact composer overflow) and #216 (ticket operation correlation and busy-dialog dismissal). Their implementation and focused regression evidence remain linked under #160.

**Actual Computer Use walkthrough**

Computer Use operated the native apps through `@oai/sky`. Responses below came from the existing authenticated native Pi profile and `openai-codex/gpt-5.6-sol`; they were not mocked. Credentials were neither copied into bundles nor included in this report. The public export fixture is intentionally two scaffold pages, not the approved Mercury sample.

| Workflow | Observed result | Candidate / evidence |
|---|---|---|
| Installed app → Recent Project → connected IDE | Passed in a disposable workspace; normal restart returns to the project picker | `abd1ea78`, then `3bc8e1fc`; evidence 20–21 and 52 |
| New Session → valid default workspace → initial prompt | Passed; real `FINAL_NEW_SESSION_OK` answer and normal completion | `3bc8e1fc`; evidence 50–51 |
| Resume an existing child → Send | Passed; the resumed native child accepted another prompt | `3bc8e1fc`; evidence 35–38 |
| Steer while assistant is visibly streaming | Passed; one 1–300 response, one queued instruction, `FINAL_STEER_OK`, no premature footer | `3bc8e1fc`; evidence 35–36 |
| Switch away → reopen → scroll to latest transcript | Passed; the same complete response appears once with one final footer | `3bc8e1fc`; evidence 37–38 |
| Abort a live response → send a normal next request | Passed; response stopped at 32, marked aborted, returned idle; next answer `FINAL_AFTER_ABORT_OK` | `3bc8e1fc`; evidence 39 and 42 |
| Export launch / restart with Settings as home | Passed; Settings opens directly in app mode, including after earlier dev-mode use | `3bc8e1fc`; evidence 34 |
| Export console → Send → real bash tool → answer | Passed; one tool card expands to `FINAL_EXPORT_TOOL_OK`, followed by `FINAL_EXPORT_OK` | `3bc8e1fc`; evidence 40–41 |
| Export dev mode → widget off/on → app mode | Passed; Diff Viewer disappears and returns; app returns to Settings | `3bc8e1fc`; evidence 47–48 |
| Stock widget off/on | Passed; Workspace Clock disappears and returns | `3bc8e1fc`; evidence 43–44 |
| Tracker fixture reopen | Passed; saved title, bug/pif tags, image and surrounding paragraphs remain; width 520 confirmed by GitHub readback | `3bc8e1fc`; evidence 45–46 and disposable #213 |
| Tracker title-only edit; intentional tag change; image resize in read mode → Save → reopen | Passed on the earlier source walkthrough; GitHub readback verified preservation and intended changes | Source `9f11e564` plus reviewed overlays; evidence 03–04; not represented as final-candidate write repetition |
| Compact IDE composer and 440px console overlay | Passed after #214 with real responses and no observed overflow; wide layout also inspected | Earlier source and `abd1ea78`; evidence 06–07, 21, 27–30; layout code unchanged by the final reducer fix |
| Conversational init → add Settings → change home → fresh hub launch | Passed for the technical scaffold fixture, with live navigation updates | Earlier source walkthrough; evidence 08–13; not Mercury sample acceptance |

Screenshots and accessibility text are retained in [the local evidence folder](/tmp/pif-remediation-2026-08-31/ui-evidence/). Useful final captures: [Steer reopened](/tmp/pif-remediation-2026-08-31/ui-evidence/38-final-stock-reopened-latest.jpeg), [export tool response](/tmp/pif-remediation-2026-08-31/ui-evidence/41-final-export-tool-expanded.jpeg), [tracker reopen](/tmp/pif-remediation-2026-08-31/ui-evidence/45-final-tracker-reopen.jpeg), [clean picker](/tmp/pif-remediation-2026-08-31/ui-evidence/52-final-clean-project-picker.jpeg). Early files ending `.png` contain JPEG bytes; later files use `.jpeg`.

**Build, test and integrity evidence**

| Check | Result and practical limit |
|---|---|
| Full gate 1, `d1ee4e7a` | Failed: Node 61/63; Flutter not reached. Native control metadata and a canonical-path fixture mismatch were corrected; three affected integration cases then passed. |
| Full gate 2, `4972a603` | Node **63/63 passed**; analysis failed because root omitted Flutter dependency restoration in the clean checkout. The missing package configuration produced 4,140 cascading diagnostics. Flutter tests were not reached in this combined run. |
| Setup correction, unchanged `4972a603` | `flutter pub get` succeeds, then Dart analysis reports **No issues found**. |
| Previously unrun Flutter stage after recorded replan | **77/77 passed** on unchanged `4972a603`. This is a separate stage, not a third combined gate. |
| Final #215 regression on `3bc8e1fc` | New queued-input case fails on `abd1ea78`; all **8 focused cases pass** after the fix; targeted Dart analysis clean. |
| #217 packaging diagnostics | Portable-runtime selection/copy succeeds; nonexistent explicit override and the actual nonportable Homebrew runtime fail before build output. All three cases pass. |
| Final stock build | Canonical `scripts/build-pif-app.sh` succeeds from clean checkout `/tmp/pif-final-d1ee4e7a` at `3bc8e1fc`; installed bundle console source matches. |
| Final public export | Real `pif_app.build` control path succeeds with correlated buildId `dd9077f7-aac6-45b7-afd6-8248e936d3f0`; the hub remains responsive during compilation. Credential scan passes. |
| Export composition | Explicit release entrypoint; pinned Home and Settings; explicitly required global-catalog Diff Viewer included; unrequired Workspace Clock excluded from the compiled set. |
| Post-UI stock integrity | **13,263 files unchanged**; `codesign --verify --deep --strict` exits 0; console source matches `3bc8e1fc`. |
| Post-UI export integrity | **10,327 files unchanged**; strict deep signature verification exits 0; console source matches `3bc8e1fc`. |
| Final independent source reviews | No blocker in queued-input fix or portable runtime selector on the current supported Mac host. |
| Combined full gate at final tip | **Not passed / not rerun.** Two complete attempts failed; the orchestrate/delivery-verification stop-and-replan rule was observed. Earlier full stages plus final focused checks are not a full gate at tip. |

Build logs include Xcode warnings about a passcode-locked attached device and a run-script phase; they are not represented as warning-free builds. The attached device was not unlocked or modified. Captured final app logs show no product exception/overflow diagnostic on the successful paths; this does not prove every background or failure path is error-free.

Raw evidence root: `/tmp/pif-remediation-2026-08-31/`. Key files: `full-gate-1-d1ee4e7a.log`, `full-gate-2-4972a603.log`, `clean-checkout-analysis-diagnostic.log`, `flutter-stage-4972a603.log`, `verification-replan-after-gate2.md`, `215-queued-input-baseline.log`, `215-queued-input-regressions.log`, `217-root-runtime-checks.json`, `stock-build-3bc8e1fc.log`, `public-export-3bc8e1fc.log`, `public-export-3bc8e1fc-result.json`, `3bc8e1fc-post-widget-signatures.json`, `final-handback-integrity.json`.

**Atomic remediation status**

| Task | Scope | Disposition |
|---|---|---|
| [#191](https://github.com/Holovkat/pi-extensions/issues/191) | pif tracker — preserve existing labels on first ticket edit | Implementation in Review |
| [#192](https://github.com/Holovkat/pi-extensions/issues/192) | pif export — deliver build results on a supported protocol channel | Implementation in Review |
| [#193](https://github.com/Holovkat/pi-extensions/issues/193) | pif app manifest — preserve page IDs beginning with s on reload | Implementation in Review |
| [#194](https://github.com/Holovkat/pi-extensions/issues/194) | pif app tools — publish manifest changes to the connected shell | Implementation in Review |
| [#195](https://github.com/Holovkat/pi-extensions/issues/195) | pif app init — preserve pinned templates during retry | Implementation in Review |
| [#196](https://github.com/Holovkat/pi-extensions/issues/196) | pif page-add — reject collisions without overwriting widget source | Implementation in Review |
| [#197](https://github.com/Holovkat/pi-extensions/issues/197) | pif tracker — finish tag and image saves from view mode | Implementation in Review |
| [#198](https://github.com/Holovkat/pi-extensions/issues/198) | pif app shell — support a one-page app in a narrow window | Implementation in Review |
| [#199](https://github.com/Holovkat/pi-extensions/issues/199) | pif export — implement the claimed credential scan coverage | Implementation in Review |
| [#200](https://github.com/Holovkat/pi-extensions/issues/200) | pif build runbook — allow agent implementation through the analyzer gate | Implementation in Review |
| [#201](https://github.com/Holovkat/pi-extensions/issues/201) | pif export — provision the supported runtime and prove one agent response | Implementation in Review |
| [#202](https://github.com/Holovkat/pi-extensions/issues/202) | pif export launcher — apply manifest updates on re-export | Implementation in Review |
| [#203](https://github.com/Holovkat/pi-extensions/issues/203) | pif sample — remove workstation-specific package paths | Implementation in Review |
| [#204](https://github.com/Holovkat/pi-extensions/issues/204) | pif requirements — reconcile app-builder contract deviations | Owner decision |
| [#205](https://github.com/Holovkat/pi-extensions/issues/205) | pif handoff — align knowledge indexes and candidate evidence links | Implementation in Review |
| [#206](https://github.com/Holovkat/pi-extensions/issues/206) | pif sample — complete the missing Mercury build-flow acceptance proof | Owner decision |
| [#187](https://github.com/Holovkat/pi-extensions/issues/187) | pif runtime — keep widget registry writes outside signed app bundles | Implementation in Review |
| [#207](https://github.com/Holovkat/pi-extensions/issues/207) | pif sources — restore catalog-over-base widget resolution | Implementation in Review |
| [#208](https://github.com/Holovkat/pi-extensions/issues/208) | pif shell — synchronize dev mode through hub control | Implementation in Review |
| [#209](https://github.com/Holovkat/pi-extensions/issues/209) | pif app — validate required widgets before export | Implementation in Review |
| [#210](https://github.com/Holovkat/pi-extensions/issues/210) | pif Store — display the actual source of archived widgets | Implementation in Review |
| [#211](https://github.com/Holovkat/pi-extensions/issues/211) | pif export — use the settled release entrypoint and pinned widget set | Implementation in Review |
| [#212](https://github.com/Holovkat/pi-extensions/issues/212) | pif app mode — apply pinned template appearance without changing the IDE | Owner decision |
| [#214](https://github.com/Holovkat/pi-extensions/issues/214) | pif console — prevent compact composer control overflow | Implementation in Review |
| [#215](https://github.com/Holovkat/pi-extensions/issues/215) | pif console — render each live message once | Implementation in Review |
| [#216](https://github.com/Holovkat/pi-extensions/issues/216) | pif tracker — correlate ticket operation results to the requesting dialog | Implementation in Review |
| [#217](https://github.com/Holovkat/pi-extensions/issues/217) | pif packaging — bundle a self-contained Node runtime | Implementation in Review |

Historical owner-approved closures #154/#155/#156/#157/#178/#188/#189 remain unchanged. #158/#159 remain open in Review. No owner approval has been inferred from unlocking the Mac.

**Remaining acceptance gaps**

- **#204:** resolve whether export authoring is supported only from a source checkout or must also work from installed pif. A written limitation is not an approved contract amendment.
- **#206 and #212:** approve the concrete Team Pulse/Mercury design and appearance proposal, then complete the actual designed Home/Metrics sample with a real widget extension through the intended conversational child workflow. The technical Home/Settings fixture does not satisfy this requirement.
- **#160:** execute the agreed final combined clean-checkout gate after those remaining changes, and complete combined requirement acceptance. Preserve both failed runs in the record.
- Native **Select Project Folder** chooser completion was not verified: the application's osascript chooser could not be addressed by Computer Use. Only its owned chooser process was canceled, then the prepared Recent Project path was used. No folder-picker pass is claimed.
- Existing-profile provider success is proven. A clean machine with missing/denied authentication has not been demonstrated by this UI pass. Latest tracker write correlation is regression-tested, but the final UI pass only reopened the saved fixture.

The successful paths above had no observed application error or overflow. This is bounded workflow evidence, not a promise of zero defects or approval of the entire epic.

**Test hygiene and operational record**

- One extra fresh-session attempt contained an operator mistake: text intended as a name was entered into the Working directory field (its label was absent from the accessibility text). The invalid directory produced a stopped red session in the disposable fixture. Inspecting the visible form and retaining the valid default workspace produced `FINAL_NEW_SESSION_OK`. That invalid-input attempt is not counted as a successful workflow. Its evidence is retained in 49–50.
- Computer Use screen capture twice returned a transient native capture error; retrying after inspecting Finder succeeded. No OS security settings were changed.
- Both owned workflow app process trees were normally quit and confirmed gone. Only the owned Recent Project fixture entry was removed, preserving the original project entry. Stock pif was then normally reopened at the clean project picker as PID 52706. No persistent child is left in the test fixture.
- Disposable GitHub #213 is closed after retaining final readback evidence; it is not a remediation child. Fixture files and logs remain locally for audit.
- Earlier during orchestration, an agent killed unrelated Mercury/triplogger DDS PID 50734. Root notified the owner and stopped that agent's process work. A debugger connection may have been interrupted; there is no evidence of source/application-data changes and no repair is claimed. Later cleanup was restricted to positively identified owned pif processes. The unrelated historical Team Pulse process was not touched.
- No merge, release, or hosted deployment was performed. The locally installed app is a tested remediation candidate; the parent verification ticket remains blocked.
