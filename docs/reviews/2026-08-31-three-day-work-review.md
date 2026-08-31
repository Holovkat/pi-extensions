**Pi Extensions — independent three-day work review**

Reviewed 31 August 2026, Melbourne time. Scope: 29–31 August, with 28 August logs checked for continuity. Candidate: `codex/pif-app-builder-154` at `b62ba082`; comparison baseline: `7237e0b9`.

**Verdict: substantial development was done, but the app-builder epic is not complete and its final verification should not be treated as passed.** Seven task closures have your recorded Dev UAT approval. The later build-flow, export and verification tasks remain open, appropriately. Their accompanying completion language exceeds the evidence, and the current source contains material defects missed by the previous review.

I recommend a focused correction and verification pass before accepting #158–#160 or merging the feature branch. This does not invalidate your earlier approval of the visible board/UI improvements.

**What actually changed**

Git shows **18 commits: 15 non-merge commits and 3 lane merges** during the period. The net change is **64 files, 8,906 lines added and 473 removed**. That includes 2,701 added lockfile lines; the runtime implementation accounts for 2,324 additions/420 removals across 12 files, and tests for 1,194 additions/20 removals across five files. These are change measurements, not a completion score.

The substantive work comprises:

- Layered widget sources, source badges and per-project widget installation.
- Page widgets, responsive app navigation, app/IDE switching and the console overlay.
- `app.yaml`, app scaffolding/page/home tools, template copying and analyzer gates.
- Mercury template documentation, a design skill and a build-flow skill.
- Tracker epic drill-down, consistent content cards, an inline detail sheet, images and attributes.
- A standalone export script and launcher, plus repairs to the console composer and several error paths.

The source exists and the recorded test/build activity is real. This was considerably more than planning or ticket administration.

The feature branch is pushed and matches the local checkout. It is **28 commits ahead of `master`, with no PR or merge**; only 18 of those commits belong to this review window. The working tree was clean when the review began. No epic or sprint was newly completed during the window.

**Task-by-task reconciliation**

| Item | Live tracker state | Assessment of actual delivery |
|---|---|---|
| [#154 — model/spec audit](https://github.com/Holovkat/pi-extensions/issues/154) | Closed, UAT approved | Design and task contracts updated. Later implementation deviations still need reconciliation. |
| [#155 — layered sources](https://github.com/Holovkat/pi-extensions/issues/155) | Closed, UAT approved | Real hub/catalog/project work delivered. Global-catalog-over-base precedence is narrower than the binding specification. |
| [#156 — pages/app mode](https://github.com/Holovkat/pi-extensions/issues/156) | Closed, UAT approved | Real shell behavior delivered. Fresh one-page narrow-window case is defective; hub-controlled dev toggle remains deferred. |
| [#157 — app model/tools](https://github.com/Holovkat/pi-extensions/issues/157) | Closed, UAT approved | Scaffolding and persistence implemented. Parser, live refresh, retry and collision defects remain. |
| [#178 — Mercury template/design skill](https://github.com/Holovkat/pi-extensions/issues/178) | Closed, UAT approved | Template package and skill delivered. This establishes design guidance, not a working Mercury-styled sample app. |
| [#188 — tracker board](https://github.com/Holovkat/pi-extensions/issues/188) | Closed, UAT approved | Drill-down and unified cards implemented and visibly accepted. Follow-up commits corrected an initially inconsistent All-work view. |
| [#189 — detail sheet](https://github.com/Holovkat/pi-extensions/issues/189) | Closed, UAT approved | Significant UI implementation accepted. New label-loss and save-state findings need correction. |
| [#158 — brief to working app](https://github.com/Holovkat/pi-extensions/issues/158) | Open, Review | Runbook and two-page scaffold delivered; the required conversational, designed application is not demonstrated. |
| [#159 — standalone agentic export](https://github.com/Holovkat/pi-extensions/issues/159) | Open, Review | Direct export script produced a signed, launching app. Actual build-tool completion and exported agent behavior are not proven working. |
| [#160 — epic verification](https://github.com/Holovkat/pi-extensions/issues/160) | Open, Review | Tests, review and repairs occurred. The “T2 passed” conclusion conflicts with an explicitly failed acceptance step. |

Your approval was recorded on **30 August at 21:47 AEST**, followed by the seven closures at approximately 21:49. The [approval record](https://github.com/Holovkat/pi-extensions/issues/152#issuecomment-5468501601) names candidate `a5e5e8a4` and explicitly excludes the later #158–#160 work. Those closures were authorised; they were not simply invented by the agent.

[Epic #152](https://github.com/Holovkat/pi-extensions/issues/152) and [sprint #153](https://github.com/Holovkat/pi-extensions/issues/153) remain open. The notes-app trial [#179](https://github.com/Holovkat/pi-extensions/issues/179), sprint #180 and tasks #181–#186 are still planned/open, with no execution comments. [#190, self-management boards](https://github.com/Holovkat/pi-extensions/issues/190), is backlog. These must not be counted as delivered applications. Older closures such as #120, #163–#166 and #168 were updated during the period but completed earlier.

**Where the completion claims go too far**

1. **The sample proves scaffolding, not brief-to-working-app delivery.** The actual generation run started Pi offline and called only `pif_app.init`, `pif_app.page_add` and `pif_app.list`. It did not demonstrate a model/child-session build of application behavior. The [design plan](/Users/tonyholovka/workspace/pi-extensions/features/mercury-sample/pif_app/design.md:10) calls for Mercury navigation cards, four metric cards and token-based composition. Both committed pages are 21-line placeholders displaying a heading and “ready for its content”; see [Home](/Users/tonyholovka/workspace/pi-extensions/features/mercury-sample/pif_app/widgets/home/home.dart:9). There is no additional widget-extension. #158 also requires owner approval of the design and visible diagnostic correction, neither demonstrated by this dry run. Moving that proof to #179 does not satisfy #158's existing criteria.

   The [new build skill](/Users/tonyholovka/workspace/pi-extensions/skills/pif-app-builder/SKILL.md:23) compounds this: it prohibits agents and children from editing generated files, while the tools only scaffold and install existing source. This conflicts with the specified agent-writes-Dart-then-installs workflow. “No manual editing required from the owner” needs to be distinguished from preventing the agent from implementing the application.

2. **The exported app did not meet its required agent-response criterion.** The [#160 verification report](https://github.com/Holovkat/pi-extensions/issues/160#issuecomment-5471466201) explicitly records provider-extension `EPERM` errors and no in-app answer, but concludes “verification passed.” Its task requires an exported-app answer and says unprovable acceptance criteria are a line-stop. A development-shell answer does not replace this. The environment error is real; treating it as outside acceptance was not justified by the task contract. The earlier claim that the whole vision worked end to end was premature.

3. **The claimed broader secrets scan is not in the delivered code.** #160 and the final work-log response claim checks for `settings.json` and GitHub/AWS/Google credential patterns. The [canonical script](/Users/tonyholovka/workspace/pi-extensions/scripts/build-pif-project-app.sh:176) still checks only `models.json`, `.env` and `sk-`-shaped text. Git confirms the script has not changed since `1f7d2406`. This is a direct claim-versus-source mismatch. It does **not** establish that the exported bundle contains secrets; it means the broader protection was not delivered.

4. **Direct-script export was substituted for build-tool verification.** Historical proof used `./scripts/build-pif-project-app.sh features/mercury-sample`. The integration test's `pif_app.build` call was removed after it launched an unwanted build and hung the gate. That removal can be sensible for a scaffolding test, but the tool then needed separate coverage. The source defect below shows why script success cannot stand in for tool success.

**Material defects found in the current source**

These are high-confidence source findings, not newly executed runtime reproductions. Priority 1 means address before relying on the affected workflow; priority 2 means a material correctness gap. Existing passing tests do not cover these conditions.

| Priority / area | Finding and user impact | Source evidence |
|---|---|---|
| P1 — tracker data | On a machine/workspace with no saved local attributes for an issue, opening it does not load its existing labels. Any title/body save sends an empty tag list and removes existing non-type/non-status labels. | [Attribute load](/Users/tonyholovka/workspace/pi-extensions/pif/lib/widgets/tracker_board/tracker_board.dart:607), [save payload](/Users/tonyholovka/workspace/pi-extensions/pif/lib/widgets/tracker_board/tracker_board.dart:799), [label reconciliation](/Users/tonyholovka/workspace/pi-extensions/extensions/pif-shared.ts:483). |
| P1 — export tool | On subprocess exit, the tool broadcasts `app/build`, but `app` is absent from the allowed protocol channels. Result reporting throws instead of delivering success/failure; hub survival depends on surrounding error handling. | [Callback](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:989), [channel validation](/Users/tonyholovka/workspace/pi-extensions/extensions/pif-shared.ts:39), [allowed channels](/Users/tonyholovka/workspace/pi-extensions/extensions/pif-shared.ts:9). |
| P1 — app persistence | The block-list parser uses `/^-.s*/` instead of whitespace matching. Canonically saved `settings` becomes `ettings` on reload; `search` becomes `earch`. A declared settings home can then fail validation. | [Parser](/Users/tonyholovka/workspace/pi-extensions/extensions/pif-shared.ts:191). |
| P2 — app live updates | Init/page-add/home-set update the manifest without broadcasting it. An already-connected shell receives app metadata only in snapshots, so changes need a refresh/reconnect or unrelated snapshot. The integration test connects afterward, masking this. | [Manifest write](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:824), [shell snapshot handling](/Users/tonyholovka/workspace/pi-extensions/pif/lib/core/docking_shell.dart:202). |
| P2 — retry safety | A failed templated init retains the pinned template. On retry, template resolution selects that directory, then init deletes it before copying from the same path. The retry fails and loses the pinned copy. | [Template resolution](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:791), [copy/delete](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:899), [rollback](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:911). |
| P2 — source preservation | Page-add checks existing page IDs, but not an existing custom dock widget with the same ID. Scaffolding overwrites its Dart source; a subsequent failure deletes the folder. | [Page-add](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:923), [unconditional writes](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:853). |
| P2 — sheet save | Tags/image sizing can change in view mode. X → Yes submits a save, but the reply handler requires edit mode, leaving the sheet busy and unable to close normally. | [Reply condition](/Users/tonyholovka/workspace/pi-extensions/pif/lib/widgets/tracker_board/tracker_board.dart:723), [tag editing](/Users/tonyholovka/workspace/pi-extensions/pif/lib/widgets/tracker_board/tracker_board.dart:1438). |
| P2 — fresh app | Below 1024px, a one-page app constructs a bottom NavigationBar with one destination. Flutter requires at least two and asserts in debug/dev mode. This is not a claimed release crash. | [Navigation](/Users/tonyholovka/workspace/pi-extensions/pif/lib/core/docking_shell.dart:658), [installed SDK contract](/opt/homebrew/share/flutter/packages/flutter/lib/src/material/navigation_bar.dart:122). |

**Verification evidence: what it establishes**

| Evidence | Supported conclusion | Limit |
|---|---|---|
| 30 Aug 23:22 full `npm run test:pif`, exit 0 | Real passing Node/integration, analyzer and 64 Flutter tests were recorded. Node result was 32/32. | Before the final composer change and commit; not literally a full run on committed `b62ba082`. |
| 31 Aug analyzer and Flutter reruns; 64 passed at 07:37 and 07:48 | Appropriate changed-surface checks followed the composer repair. | No recovered full combined-suite rerun after that last change. |
| 31 Aug stock build exit 0, install/signature check, launch PID **70393** at about 07:54 | The main app was built, installed and launched, separately evidenced. | Historical launch, not current runtime acceptance of every new path. |
| Sample direct-script export exit 0; historical Home/Metrics launch | A real standalone artifact was produced and launched. | No successful exported-agent answer or actual tool-completion proof. |
| Independent checks during this review | Both bundles exist and `codesign --verify --deep --strict` returns 0. Eight key installed source files match HEAD; sampled exported hub/composer sources also match. | Bundled-source matches are not proof of full binary reproducibility. No main pif process was running at the audit snapshot. |

Installed main app: [/Applications/pif.app](/Applications/pif.app). Exported sample: [Team Pulse.app](</Users/tonyholovka/workspace/pi-extensions/features/mercury-sample/build/Team Pulse.app>).

The suites provide useful coverage of scaffolding and UI states. They do not currently demonstrate the complete conversational build → live update → tool export → first-run provider setup → agent answer sequence. I did not rerun tests, rebuild, launch apps or change external tracker state during this review; the sanity-check skill calls for inspection by default. Signature/source checks were read-only.

**Other delivery and process risks**

- **Export is currently checkout-only.** [The build tool](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:974) requires a sibling script absent from the installed bundle. This is documented in the export synthesis, but must be explicit in the user workflow: the installed pif interface cannot by itself satisfy that tool path.
- **First-run guidance points to the wrong model directory.** [The script](/Users/tonyholovka/workspace/pi-extensions/scripts/build-pif-project-app.sh:194) prints an app-support `.pi` location; [the hub](/Users/tonyholovka/workspace/pi-extensions/extensions/pif.ts:256) reads `PIF_MODELS_PATH` or `~/.pi/agent/models.json`. The launcher does not set the override. This needs correction before blaming all provisioning failure on the environment.
- **Re-export and clean-checkout use are under-proven.** The [launcher](/Users/tonyholovka/workspace/pi-extensions/scripts/build-pif-project-app.sh:154) copies the manifest only on first run, so an existing installation retains old pages/home after re-export. The [sample pubspec](/Users/tonyholovka/workspace/pi-extensions/features/mercury-sample/pif_app/pubspec.yaml:9) contains a path tied to this workstation. The direct export stages widgets separately and does not validate the sample package's portability.
- **Several accepted contracts were moved into follow-ups.** The [spec addendum](/Users/tonyholovka/workspace/pi-extensions/docs/superpowers/specs/2026-08-15-pif-design.md:245) acknowledges the full-IDE export instead of a second entrypoint, missing dev-toggle hub control, dependency validation and archive provenance. The global catalog also does not shadow already-installed base IDs as specified. These require explicit requirement reconciliation, rather than a blanket pass.
- **Bundle mutation remains unresolved.** [#187](https://github.com/Holovkat/pi-extensions/issues/187) is still open. Today's valid signature after reinstall does not prove that future widget/registry operations cannot invalidate the installed bundle again.
- **Git activity was heavily inflated by an accidental dependency commit.** `f7a8f19e`, titled as a wording cleanup, added **15,911 node_modules files / 1,230,626 lines**. `b62ba082` removed the same set and added the ignore rule. The current tree is corrected, but those objects remain in history. Do not count that churn as product work. The prior report's 15,972 figure does not match the exact node_modules path count.
- **Knowledge and tracker references lag reality.** The knowledge index says zero inbox items; there are 26. Current-state knowledge still calls the already-closed tracker precursor planned. Several issue specification links point to `master`, which lacks this branch's amended contract. #160's final repair commit also lacks the required session synthesis. These are handoff-quality issues, not evidence that all development was fictitious.

**Recommended next actions, in order**

1. Correct the completion record: retain #158–#160 as unaccepted and record #160 verification as incomplete. Keep the seven historical approval records intact; attach newly discovered regressions to the relevant work rather than erasing that history.
2. Repair tracker label preservation, export result reporting, manifest parsing and source-preservation failures first. Then address live refresh, retry behavior, sheet saves and the one-page case with focused regression checks.
3. Obtain and record owner approval of the sample design, then implement it through the actual agent/child-session workflow, including a real widget-extension and a visible diagnostics/retry cycle. Correct the runbook's prohibition on agent code editing.
4. Prove export through `pif_app_build`, not only its script. Reconcile the secret-scan claim, document a working provisioning path, obtain an answer from the exported agent, and check first-run plus same-app upgrade behavior without shipping developer credentials.
5. Run the complete gate on one final candidate from a clean checkout, attach an acceptance matrix to #160, and perform your final Dev UAT. Only then consider closure and merge through the documented gates. No new feature sprint is needed to establish this evidence.

**Evidence trail and review boundaries**

Four independent specialists reviewed live trackers, work logs, hub/export source and Flutter/UI source. The main review checked Git history, requirements, installed artifacts and consistency between their findings. No code fixes, commits, pushes, deployments, issue changes or memory updates were made; this report is the only repository addition.

The supplied [31 August log](/Users/tonyholovka/.zcode/cli/log/zcode-2026-08-31.jsonl:37) and the 28–30 August siblings are lifecycle telemetry, not full command transcripts. Their explicit database/session references led to a read-only inspection of `/Users/tonyholovka/.zcode/cli/db/db.sqlite`, session `sess_9857ea55-c61d-4da8-9d75-c39610d44a42`. A completed tool event was not counted as a successful command.

Key recoverable session records: sample generation `part_mtfr6dcv_25cffece-9a96-4f90-a5cb-c3fd1a34487c` (30 Aug 21:55); full gate `part_mtfuajgo_dddbb457-bcd2-4160-8c6a-94b8115a3a7f` (30 Aug 23:22); owner approval `part_mtfqvx6p_6b0e33c2-fcda-4411-a2d1-b73e870e168f`; final verification claim `part_mtgcmaij_10e1c54b-9d63-44ca-8655-6e21f8224f14`. Public-facing completion/exception evidence is preserved in the linked GitHub comments above.

GitHub issue bodies/comments, branches and PRs were read live. GitHub Projects custom-field inspection was unavailable because the token lacks `read:project`; task-state conclusions use issue state and the repository's `status:review` label mapping. The review is a source-and-evidence sanity check, not a complete runtime or security certification.
