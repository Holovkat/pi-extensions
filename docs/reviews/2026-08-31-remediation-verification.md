**pif remediation verification — 31 August 2026**

**The complete automated gate and the native workflows below passed on `dc45ff40`. Full epic sign-off remains open.** This report covers the owner's fresh end-to-end request and supersedes the earlier remediation status. The [original three-day review](./2026-08-31-three-day-work-review.md) remains the dated baseline; the previous report is preserved in Git at `bdfe5bb4`.

The tested code is pushed on `codex/pif-app-builder-154`. Stock is installed at `/Applications/pif.app`, left at the clean project picker as **PID 81004**; its workflow ran as PID 76691. The canonical export is `/tmp/pif160-ui-31x_h8mg/build/UI Workflow Check.app`; final restart ran as PID 80355 and was normally quit after verification. No merge, release or hosted deployment was performed.

**What this end-to-end run found and fixed**

| Finding | Actual cause | Repair and proof |
|---|---|---|
| Empty-profile Send produced “Unknown provider: unknown” (#201) | Host input bypassed native model readiness; the dropdown changed only preferences, not Pi's active model. | `62f86b07`: block unavailable models before dispatch, show the actual native-profile setup command, and activate host selections through native Pi. Three regressions fail on the old candidate and pass on the fix; real hub smoke passes. Final UI shows actionable `/login` and `/model` guidance. The rejected prompt never reaches native history. |
| A successful response became red “failed” after restart (#215) | An earlier empty failed turn retained its failure flag and start time when the next ordinary prompt arrived. | `f1fdd926`: reset ordinary turn boundaries even when the earlier answer was empty; preserve queued Steer. The new regression fails on the old candidate; all nine focused transcript cases pass. The actual formerly tainted answer now reopens green at 11 seconds, and a fresh successful answer remains green at 13 seconds after restart. |
| Session paths used literal `Application%20Support` (#201) | URI `.path` was used as a filesystem path; spaces were encoded and literal `%`/`#` could change the path. | `dc45ff40`: use filesystem conversions and copy only a matching legacy host transcript into a missing canonical destination, without overwriting either source or existing history. Path regression fails on the old candidate; two path/migration checks pass. Real launch copied the 10,450-byte history exactly; its legacy SHA-256 remains unchanged after later activity. |

Earlier repaired UI findings remain evidenced: #214 compact composer overflow, #215 streaming duplication, #216 ticket request correlation, and #217 nonportable Homebrew Node. The original export launch failed because copied Node required an unbundled `libnode.147.dylib`; both builders now validate a portable runtime before and after packaging. The final artifacts use Node 22.22.0 and launch successfully.

**Automated and build evidence**

| Check | Result |
|---|---|
| Historical full gate 1, `d1ee4e7a` | Failed Node 61/63; Flutter not reached. Native control metadata and canonical-path fixture mismatch were corrected. |
| Historical full gate 2, `4972a603` | Node 63/63 passed; analysis failed because dependencies had not been restored in the clean checkout, producing 4,140 cascading diagnostics. The subsequent unchanged-source analysis and 77 Flutter tests passed separately. Those separate stages were never represented as a combined pass. |
| Fresh owner-authorized full gate, `bdfe5bb4` | **63 Node tests + clean Dart analysis + 78 Flutter tests**, one `npm run test:pif`, exit 0. Later UI testing found the three defects above. |
| Final clean-checkout full gate, `dc45ff40` | **66 Node tests + clean Dart analysis + 81 Flutter tests**, one `npm run test:pif`, exit 0; 07:00:46–07:02:53 UTC. Checkout `/tmp/pif-final-d1ee4e7a` remained clean. |
| Independent review | No concrete blockers in `bdfe5bb4..dc45ff40`, including history migration and no-overwrite behavior. |
| Canonical stock build/install | `scripts/build-pif-app.sh` passed; installed launcher and console source match the tested checkout. Actual launch and picker verified. |
| Public native export tool | A real native agent called `pif_app_build`; buildId `10fbe4f6-ca1b-4c6b-8262-9f23d8476f62` matched the final success result. The hub answered another request during compilation. Credential scan passed. |
| Post-UI stock integrity | **13,263 files unchanged**; `codesign --verify --deep --strict` exit 0. |
| Post-UI export integrity | **10,327 files unchanged**; strict deep signature verification exit 0; bundled launcher and hub source match the tested checkout. |

Build logs still include Xcode warnings about the passcode-locked attached device and a run-script phase. These are not represented as warning-free builds. No device security settings were changed. Final exported-runtime logs contain no unknown-provider exception, unhandled exception, RenderFlex overflow or widget exception diagnostic on the exercised paths.

**Actual final-candidate Computer Use walkthrough**

All final UI actions used `@oai/sky`. Native answers used the existing `openai-codex/gpt-5.6-sol` profile; no answer was mocked and no credentials were copied into the export or the empty test profile.

| Workflow on `dc45ff40` | Observed result | UI evidence |
|---|---|---|
| Installed picker → prepared Recent Project → connected IDE | Passed in a disposable repository with no remote. | 15–17 |
| New Session with valid default directory → native answer | `FINAL_CHILD_READY`, green completion. | 18–22 |
| Steer during a streamed answer → complete → reopen | Queued while count was at 159; one complete 1–200 answer, one steering input, `FINAL_STEER_OK`, one final footer; same result after reopening. | 23–24, 29–30 |
| Abort → next normal request → actual bash tool | Aborted at 30, returned idle, then `FINAL_AFTER_ABORT_OK` with a successful tool card and green footer. The deliberate cancellation remains labelled aborted. | 31–32, 34, 38 |
| Stock widget off/on | Workspace Clock disappears and returns; signed bundle unchanged. | 39–40 |
| Export launch with empty profile and credential environment omitted | Settings home opens; model sentinel is not displayed; console explains the correct native profile and setup command. Send is safely rejected before provider dispatch. | 25–28 |
| Legacy history migration and failure → success history | Exact copy to the real-space path; legacy unchanged; earlier error remains historical, but subsequent successful turns have correct green footers. | 27, 45; migration JSON |
| Export relaunch with configured profile → native write | Created `e2e-final-persistence.txt` with `FINAL_PERSISTED_OK`; real `FINAL_EXPORT_RECOVERED` response. | 33, 35–37 |
| Quit/restart → Home/Settings navigation → persisted history → real read | Home/Settings navigation works; successful history reopens green; native file read returns `FINAL_RESTART_VERIFIED`. | 41–46, 48 |
| Clean handback | Stock reopened at clean picker; test Recent Project entry removed while preserving the original entry; export normally quit. | 47 |

[Final UI evidence](/tmp/pif-e2e-2026-08-31/ui/) includes [Steer completion](/tmp/pif-e2e-2026-08-31/ui/29-final-steer-result.jpeg), [setup guidance](/tmp/pif-e2e-2026-08-31/ui/28-final-empty-profile-send-guard.jpeg), [reopened successful history](/tmp/pif-e2e-2026-08-31/ui/45-final-restored-success-footer.jpeg), and [restart/file verification](/tmp/pif-e2e-2026-08-31/ui/48-final-restart-verified.jpeg).

Earlier tracker title/tag/image write/readback checks, exported widget toggles and conversational scaffold init/page-add/home-change proof remain in `/tmp/pif-remediation-2026-08-31/` and the prior report at `bdfe5bb4`. They were not all repeated as final-candidate live writes. Their automated regressions did run in the final complete gate. The disposable tracker fixture #213 remains closed.

**Atomic remediation status**

Live readback confirms [#160](https://github.com/Holovkat/pi-extensions/issues/160) has **27 native children: 24 implementation tasks in Review and three blocked owner gates**. All remain open; developer implementation and bounded verification do not constitute owner acceptance.

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
| [#204](https://github.com/Holovkat/pi-extensions/issues/204) | pif requirements — reconcile app-builder contract deviations | Owner gate |
| [#205](https://github.com/Holovkat/pi-extensions/issues/205) | pif handoff — align knowledge indexes and candidate evidence links | Implementation in Review |
| [#206](https://github.com/Holovkat/pi-extensions/issues/206) | pif sample — complete the missing Mercury build-flow acceptance proof | Owner gate |
| [#187](https://github.com/Holovkat/pi-extensions/issues/187) | pif runtime — keep widget registry writes outside signed app bundles | Implementation in Review |
| [#207](https://github.com/Holovkat/pi-extensions/issues/207) | pif sources — restore catalog-over-base widget resolution | Implementation in Review |
| [#208](https://github.com/Holovkat/pi-extensions/issues/208) | pif shell — synchronize dev mode through hub control | Implementation in Review |
| [#209](https://github.com/Holovkat/pi-extensions/issues/209) | pif app — validate required widgets before export | Implementation in Review |
| [#210](https://github.com/Holovkat/pi-extensions/issues/210) | pif Store — display the actual source of archived widgets | Implementation in Review |
| [#211](https://github.com/Holovkat/pi-extensions/issues/211) | pif export — use the settled release entrypoint and pinned widget set | Implementation in Review |
| [#212](https://github.com/Holovkat/pi-extensions/issues/212) | pif app mode — apply pinned template appearance without changing the IDE | Owner gate |
| [#214](https://github.com/Holovkat/pi-extensions/issues/214) | pif console — prevent compact composer control overflow | Implementation in Review |
| [#215](https://github.com/Holovkat/pi-extensions/issues/215) | pif console — render each live message once | Implementation in Review |
| [#216](https://github.com/Holovkat/pi-extensions/issues/216) | pif tracker — correlate ticket operation results to the requesting dialog | Implementation in Review |
| [#217](https://github.com/Holovkat/pi-extensions/issues/217) | pif packaging — bundle a self-contained Node runtime | Implementation in Review |

**What still prevents full sign-off**

- **#204 — support boundary:** decide whether this release may author/export only from a source checkout or must also author/export from installed pif. The latter is not currently delivered. No scope waiver has been inferred.
- **#206/#212 — actual Mercury sample:** approve the existing Team Pulse design and unresolved appearance choice, then implement and verify the designed Home/Metrics cards and real widget extension through the intended conversational child workflow. `skills/pif-app-builder/SKILL.md` requires explicit design approval before that implementation. The current Home/Settings export is a technical fixture, not that product acceptance sample.
- **Native Select Project Folder:** the osascript-owned chooser could not be addressed by Computer Use. A user handoff was requested but no completed selection was observed. The prepared Recent Project path is proven; native chooser completion is not.
- **Authentication boundary:** empty-profile guidance/rejection and existing-profile recovery are proven. No new OAuth account/login, denied macOS secret-store permission, or clean physical machine was exercised. No credentials or access protections were modified.

The tested workflows had no unexpected application error after repair. This is bounded evidence, not a promise that every possible workflow is defect-free. #160 stays open until the remaining required behavior and owner acceptance are resolved.

**Evidence and test hygiene**

Current raw evidence: `/tmp/pif-e2e-2026-08-31/`. Key records: `execution.json`, `full-gate-dc45ff40-result.json`, `full-gate-dc45ff40.log`, `stock-build-dc45ff40-result.json`, `public-export-dc45ff40-result.json`, `native-build-tool-result-prepared.json`, `live-history-migration-result.json`, `missing-profile-send-guard.json`, `final-runtime-verification.json`, `final-stock-integrity.json`, `final-export-integrity.json`, `final-export-log-check.json`, and `final-children.json`.

The first direct native export harness attempt on `bdfe5bb4` omitted the canonical launcher's precreated empty session file and hit EEXIST. Matching PiLauncher initialization fixed the harness; the failed attempt is retained and is not described as a product fix. Earlier test setup failures, the invalid-directory operator mistake, transient screen-capture failures and an agent's unrelated Mercury debugger-process termination remain documented in the prior report; they have not been erased or converted into passes. This run's process actions were limited to positively identified owned pif apps. Existing legacy history, unrelated projects, the unrelated historical Team Pulse process and the attached device were preserved.
