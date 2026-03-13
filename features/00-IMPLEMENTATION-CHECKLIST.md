# Implementation Checklist

Repository: `Holovkat/pi-extensions`

This checklist is the local sign-off view for the new extension rebuild:
- `pi-blueprint` replaces `pi-req` over time, but ships alongside it first.
- `pi-builder` replaces `pi-dev` over time, but ships alongside it first.
- GitHub issues remain the source of truth for specification content.
- No execution-ready task should exceed complexity score `5/10`.
- Any task at complexity score `8/10` or higher is treated as complexity creep / planning failure.

## Reference Documents

- Whitepaper: `docs/pi-dev-production-line-whitepaper.md`
- Planning PRD: `docs/pi-req-planning-prd.md`
- Build PRD: `docs/pi-dev-build-prd.md`

## Epic 1: pi-blueprint

- [x] [#1 Epic: Build pi-blueprint planning engine](https://github.com/Holovkat/pi-extensions/issues/1)
  - [x] [#3 Sprint 1: pi-blueprint hierarchy and execution-grain model](https://github.com/Holovkat/pi-extensions/issues/3)
    - [x] [#4 Task: create pi-blueprint extension entrypoint](https://github.com/Holovkat/pi-extensions/issues/4)
    - [x] [#5 Task: implement hierarchy and execution-grain classifier](https://github.com/Holovkat/pi-extensions/issues/5)
    - [x] [#6 Task: define blueprint task-packet publication shape](https://github.com/Holovkat/pi-extensions/issues/6)
  - [x] [#7 Sprint 2: pi-blueprint complexity, prerequisites, and routing](https://github.com/Holovkat/pi-extensions/issues/7)
    - [x] [#8 Task: implement complexity scoring model and gating rubric](https://github.com/Holovkat/pi-extensions/issues/8)
    - [x] [#9 Task: add prerequisite and dependency modeling](https://github.com/Holovkat/pi-extensions/issues/9)
    - [x] [#10 Task: implement execution lane routing metadata](https://github.com/Holovkat/pi-extensions/issues/10)
  - [x] [#11 Sprint 3: pi-blueprint GitHub publication and checklist enrichment](https://github.com/Holovkat/pi-extensions/issues/11)
    - [x] [#12 Task: enrich GitHub issue publication for blueprint metadata](https://github.com/Holovkat/pi-extensions/issues/12)
    - [x] [#13 Task: enrich checklist generation for execution-ready planning](https://github.com/Holovkat/pi-extensions/issues/13)
    - [x] [#14 Task: define replan and split sync conventions](https://github.com/Holovkat/pi-extensions/issues/14)
  - [x] [#15 Sprint 4: pi-blueprint planning quality gate and rejection rules](https://github.com/Holovkat/pi-extensions/issues/15)
    - [x] [#16 Task: enforce hard complexity-based execution ceiling](https://github.com/Holovkat/pi-extensions/issues/16)
    - [x] [#17 Task: implement high-complexity red-flag behavior](https://github.com/Holovkat/pi-extensions/issues/17)
    - [x] [#18 Task: finalize operator planning flows for enhancement, PRD, and bugfix modes](https://github.com/Holovkat/pi-extensions/issues/18)

## Epic 2: pi-builder

- [ ] [#2 Epic: Build pi-builder execution engine](https://github.com/Holovkat/pi-extensions/issues/2)
  - [ ] [#19 Sprint 1: pi-builder intake and task packet runtime](https://github.com/Holovkat/pi-extensions/issues/19)
    - [ ] [#20 Task: create pi-builder extension entrypoint](https://github.com/Holovkat/pi-extensions/issues/20)
    - [ ] [#21 Task: implement runtime task-packet reconstruction](https://github.com/Holovkat/pi-extensions/issues/21)
    - [ ] [#22 Task: enforce execution-readiness checks at intake](https://github.com/Holovkat/pi-extensions/issues/22)
  - [ ] [#23 Sprint 2: pi-builder warm builder continuity and change snapshots](https://github.com/Holovkat/pi-extensions/issues/23)
    - [ ] [#24 Task: implement task-local warm builder continuity](https://github.com/Holovkat/pi-extensions/issues/24)
    - [ ] [#25 Task: emit narrow change snapshots](https://github.com/Holovkat/pi-extensions/issues/25)
    - [ ] [#26 Task: implement correction-packet injection](https://github.com/Holovkat/pi-extensions/issues/26)
  - [ ] [#27 Sprint 3: pi-builder diff review and targeted testing](https://github.com/Holovkat/pi-extensions/issues/27)
    - [ ] [#28 Task: implement diff-reviewer lane](https://github.com/Holovkat/pi-extensions/issues/28)
    - [ ] [#29 Task: implement layered targeted testing](https://github.com/Holovkat/pi-extensions/issues/29)
    - [ ] [#30 Task: define promotion-gate handoff behavior](https://github.com/Holovkat/pi-extensions/issues/30)
  - [ ] [#31 Sprint 4: pi-builder tracker sync and line-stop handling](https://github.com/Holovkat/pi-extensions/issues/31)
    - [ ] [#32 Task: implement tracker-sync GitHub write-backs](https://github.com/Holovkat/pi-extensions/issues/32)
    - [ ] [#33 Task: implement line-stop and replanning handoff](https://github.com/Holovkat/pi-extensions/issues/33)
    - [ ] [#34 Task: expose builder runtime lane and readiness visibility](https://github.com/Holovkat/pi-extensions/issues/34)
  - [ ] [#35 Sprint 5: pi-builder end-to-end pilots and UAT-ready validation](https://github.com/Holovkat/pi-extensions/issues/35)
    - [ ] [#36 Task: pilot greenfield end-to-end flow](https://github.com/Holovkat/pi-extensions/issues/36)
    - [ ] [#37 Task: pilot enhancement end-to-end flow](https://github.com/Holovkat/pi-extensions/issues/37)
    - [ ] [#38 Task: pilot bugfix root-cause-to-regression flow](https://github.com/Holovkat/pi-extensions/issues/38)
