---
description: Verify implementation meets spec requirements and Definition of Done before UAT
---

You are performing a **Compliance Review** to verify the implementation meets all requirements defined in the approved requirements source. This is also the **Definition of Done (DoD) gate**: compare approved requirements against delivered build outcomes, verification evidence, and known gaps before handover or UAT.

**THIS IS A BLOCKING GATE** - The session cannot end, move to UAT, or be handed to the user until compliance is achieved, the DoD rank passes, or the user explicitly accepts a documented exception.

**OUTPUT PRINCIPLE** - Keep user-facing output brief: rank result, failed items, next action. All detailed compliance matrices, evidence, and remediation plans go into GitHub issues and comments. Do not repeat to the user what has been written to GitHub.

---

## Step 1: Identify Current Phase

**ACTION REQUIRED:**

1. Locate and read the active epic and its task issues from GitHub
2. Identify the current sprint/phase being worked on
3. Find the corresponding requirements source from the task issue body

```bash
# Identify the active epic from the current branch
gh issue list --label "epic" --state open --json number,title

# Read the epic and its linked task issues
gh issue view [EPIC_NUMBER] --json number,title,body,comments
gh issue view [TASK_NUMBER] --json number,title,body,labels,state
```

---

## Step 2: Extract Acceptance Criteria

**ACTION REQUIRED:**

1. Read the requirements source completely
2. Extract ALL acceptance criteria, deliverables, and requirements
3. Create a compliance checklist from the task issue body:
   - **Deliverables** - Components/files that must exist
   - **Acceptance Criteria** - Functional requirements that must be met
   - **Implementation Details** - Specific patterns/APIs required
   - **Props/Interfaces** - Type definitions required
   - **Test Requirements** - Tests that must pass

Present the extracted requirements:

```markdown
## Compliance Checklist for Phase [X]: [Name]

### Deliverables
- [ ] [Component/file 1] - [location]
- [ ] [Component/file 2] - [location]

### Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]

### Implementation Requirements
- [ ] [Specific pattern/API requirement]
- [ ] [Type definition requirement]

### Test Requirements
- [ ] [Test 1]
- [ ] [Test 2]
```

---

## Step 3: Verify Each Requirement

**ACTION REQUIRED:** For EACH item in the compliance checklist:

### 3.1 File/Component Existence
```bash
# Check if required files exist
ls -la src/components/[expected-path]/
```

### 3.2 Implementation Verification
Read each file and verify:
- Component implements required props interface
- Required functions/methods are present
- Expected behavior is implemented
- Code matches spec patterns

### 3.3 Functional Verification
If possible, verify functionality:
- Run the dev server: `pnpm dev`
- Check browser console for errors
- Verify component renders correctly

### 3.4 Type Check
```bash
pnpm tsc --noEmit
```

### 3.5 Lint Check
```bash
pnpm lint
```

### 3.6 Build Verification
```bash
pnpm build
```

### 3.7 Requirements vs Build Outcome
Map every accepted requirement to the delivered implementation:

- Delivered files, behavior, configuration, migration, or documentation
- Verification evidence such as tests, lint, build, smoke checks, code review, or screenshots
- Release vector readiness: code, data, config, service, provider, deployment, verification, cleanup, and closeout rows that apply
- Known defects, skipped checks, caveats, waivers, and residual risks
- Scope drift where the build no longer matches the approved plan

If the work has no traceable approved requirements, assign `D - Replan`.

---

## Step 4: Generate Compliance and DoD Report

**ACTION REQUIRED:** Create a detailed compliance report:

```markdown
# Compliance and Definition of Done Report: Phase [X] - [Name]

**Date**: [TODAY]
**Reviewer**: Compliance reviewer
**Requirements Document**: `[REQUIREMENTS_SOURCE]`
**Requirements Source**: [issue/epic refs]
**Build Source**: [branch/commit/deployment refs]
**Release Vectors**: [active rows / deferred rows / not applicable]
**DoD Rank**: A/B/C/D
**Decision**: Handover allowed / Owner caveat decision / Rework / Replan

## Summary
- **Total Requirements**: [N]
- **Passed**: [N] ✅
- **Failed**: [N] ❌
- **Partial**: [N] ⚠️

## Requirements vs Build Matrix

| Requirement | Delivered outcome | Evidence | Status |
|-------------|-------------------|----------|--------|
| [accepted requirement] | [file/behavior/build result] | [test/review/smoke link] | Pass/Partial/Fail |

## Detailed Results

### Deliverables
| Item | Status | Notes |
|------|--------|-------|
| [Component] | ✅/❌/⚠️ | [Details] |

### Acceptance Criteria
| Criterion | Status | Evidence |
|-----------|--------|----------|
| [Criterion] | ✅/❌/⚠️ | [How verified] |

### Implementation Requirements
| Requirement | Status | Notes |
|-------------|--------|-------|
| [Requirement] | ✅/❌/⚠️ | [Details] |

## Gate Results

| Gate | Result | Evidence |
|------|--------|----------|
| Code review | Pass/Fail/Not run | [evidence] |
| Test review | Pass/Fail/Not run | [evidence] |
| Compliance review | Pass/Fail/Not run | [evidence] |
| Smoke/UAT readiness | Pass/Fail/Not run | [evidence] |
| Release vector readiness | Pass/Fail/Not run | [evidence] |

## Failed Items Detail

### [Failed Item 1]
**Expected**: [What the spec requires]
**Actual**: [What was found]
**Gap**: [What's missing]

## DoD Ranking

| Rank | Meaning | Decision |
|------|---------|----------|
| `A - Done` | All must-have requirements pass, evidence is complete, and risks are acceptable. | Handover/UAT may proceed. |
| `B - Done with caveats` | Minor non-critical gaps remain and are documented with owner acceptance needed. | Ask for owner waiver or create follow-up tasks before UAT. |
| `C - Not done` | One or more must-have requirements, tests, or evidence gates are incomplete. | Return to build rework. |
| `D - Replan` | Delivered work no longer matches the approved plan or hidden prerequisites changed scope. | Stop and rerun planning. |

Only `A` is a clean Definition of Done pass. `B` is not complete until the owner accepts the caveats or the gaps are resolved.

## Overall Status: [PASS/FAIL]
```

---

## Step 5: Handle Compliance Result

### If ALL requirements PASS and DoD rank is `A - Done`:

```markdown
✅ **COMPLIANCE PASSED**

All requirements from `[REQUIREMENTS_SOURCE]` have been verified and the DoD rank is `A - Done`.
The implementation is ready for integration.

Proceeding with `/end-session` workflow...
```

**Continue to Step 6 (proceed with end-session).**

---

### If DoD rank is `B - Done with caveats`:

```markdown
⚠️ **COMPLIANCE CONDITIONAL**

Minor non-critical gaps remain and require owner acceptance before handover or UAT.

## Caveats:
1. [Caveat 1] - [Owner decision needed]
2. [Caveat 2] - [Owner decision needed]
```

Ask the user whether to accept the caveats, create follow-up tasks, or return to build rework.

---

### If ANY requirements FAIL or DoD rank is `C - Not done`:

```markdown
❌ **COMPLIANCE FAILED**

[N] requirements did not pass verification.

## Failed Requirements:
1. [Requirement 1] - [Brief reason]
2. [Requirement 2] - [Brief reason]

## Recommended Actions:
1. [Specific fix needed]
2. [Specific fix needed]
```

**DO NOT proceed with end-session. Instead:**

1. **Inform the user:**
   > "Compliance review found [N] unmet requirements. The implementation does not fully meet the phase specifications.
   >
   > Would you like to:
   > 1. **Fix and retry** - I'll analyze gaps, create additional requirements updates if needed, and implement fixes
   > 2. **Waive compliance** - Proceed with end-session despite gaps (not recommended)
   > 3. **Review details** - Show full compliance report and discuss
   >
   > Reply 1, 2, or 3."

2. **If user chooses FIX AND RETRY (option 1):**
   - Proceed to Step 6A

3. **If user chooses WAIVE (option 2):**
   - Log the waiver in session log
   - Add failed items to BACKLOG.md with "Compliance Gap" tag
   - Continue with end-session

4. **If user chooses REVIEW (option 3):**
   - Present full compliance report
   - Discuss each failure
   - Then re-ask options 1 or 2

---

## Step 6A: Gap Analysis and Remediation Loop

**This step initiates an implementation loop until compliance is achieved.**

### 6A.1 Activate King Mode Analysis

Execute `/kingmode` for deep analysis:

```markdown
/kingmode

Analyze the compliance gaps for Phase [X]:

## Failed Requirements:
[List each failed requirement]

## Questions to Answer:
1. What is the root cause of each gap?
2. What specific code changes are needed?
3. Are there architectural issues to address?
4. What new issue/spec updates are needed?
5. What's the estimated effort to fix?
6. Are there dependencies or blockers?

## Analysis Scope:
- Review the requirements source: `[REQUIREMENTS_SOURCE]`
- Review the current implementation
- Identify exact files needing changes
- Determine if scope was underestimated
```

### 6A.2 Create Remediation Specs (if needed)

If the analysis reveals missing specifications:

1. Create or update the repo-standard remediation issue.
   Use a GitHub issue linked to the epic with a `remediation` label.

2. Include:
   - Specific gaps being addressed
   - Detailed implementation requirements
   - Code examples where helpful
   - Acceptance criteria for the fix

### 6A.3 Update Implementation Checklist

Create a GitHub remediation issue linked to the epic:

```bash
gh issue create \
  --title "Remediation: [Phase Name] - Compliance Gaps" \
  --label "task,remediation,sprint-[N]" \
  --body "## Remediation Tasks

### Additional Tasks (Remediation)
- [ ] [Gap fix 1]
- [ ] [Gap fix 2]
- [ ] Re-run compliance review

**Status**: [in-progress]
**Source Epic**: #[EPIC_NUMBER]
"
```

### 6A.4 Get User Approval

Present the remediation plan to the user:

```markdown
## Remediation Plan

**Compliance Gaps Identified**: [N]

### New/Updated Requirements:
- `[REMEDIATION_SOURCE]`

### Implementation Tasks:
1. [Task 1] - Est. [time]
2. [Task 2] - Est. [time]

### Updated GitHub Issues:
- #[NN] - [New remediation task 1]
- #[NN] - [New remediation task 2]

**Total Estimated Effort**: [time]

Do you approve this remediation plan? (yes/no)
```

### 6A.5 Implement Fixes

If approved:

1. Implement each remediation task
2. Run quality checks after each significant change:
   ```bash
   pnpm lint
   pnpm tsc --noEmit
   ```
3. Mark remediation issue tasks as complete via GitHub labels

### 6A.6 Re-run Compliance Review

After implementation:

```markdown
Remediation implementation complete. Re-running compliance review...
```

**GO BACK TO STEP 2** and repeat the compliance review.

**This loop continues until:**
- All requirements pass, OR
- User explicitly waives compliance

---

## Step 6: Proceed with End-Session (on PASS only)

Once compliance passes:

```markdown
✅ **COMPLIANCE VERIFIED**

Phase [X] implementation meets all specification requirements.
Proceeding with standard end-session workflow...
```

**Execute the standard `/end-session` workflow.**

---

## Compliance Review Notes

### What Gets Checked:
- File existence and location
- Component props match spec interfaces
- Required functionality is implemented
- TypeScript compiles without errors
- Lint passes
- Build succeeds
- Dev server starts without errors
- Requirements map to delivered files, behavior, tests, and evidence
- Known gaps, waivers, and residual risks are documented
- Definition of Done rank supports the handover decision

### What Does NOT Get Checked (UAT covers these):
- Visual appearance matches design
- User experience quality
- Edge case handling completeness
- Cross-browser compatibility
- Performance benchmarks

### Severity Levels:
- **CRITICAL**: Missing core deliverable - blocks compliance
- **MAJOR**: Missing acceptance criterion - blocks compliance
- **MINOR**: Implementation differs from spec but functional - warning only
- **INFO**: Suggestion for improvement - does not block

---

**BEGIN NOW: Start with Step 1 - Identify Current Phase.**
