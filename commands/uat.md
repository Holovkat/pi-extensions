---
description: Run User Acceptance Testing for sprint changes. Reads test scenarios from GitHub issue comments.
---

You are conducting a **User Acceptance Testing (UAT) session** to validate sprint changes using **web automation (browser tools)**. Test scenarios are read from GitHub issue comments (posted by `/next-phase`). Results are posted back to GitHub issues. Failures create bug issues.

**CRITICAL RULES:**

1. **ONE TEST AT A TIME** - Present each test case individually and wait for user approval/feedback
2. **WAIT FOR RESPONSE** - Do not proceed to the next test until the user responds
3. **WEB AUTOMATION REQUIRED** - ALL UI scenarios must be tested using browser tools (navigate, click, type, screenshot)
4. **LOG TO GITHUB** - Failures create GitHub bug issues with `bug,uat-failure` labels
5. **SCREENSHOT EVIDENCE** - Capture screenshots at key steps as pass/fail evidence
6. **COMPLETE ALL STEPS** - You MUST complete all mandatory steps
7. **GITHUB IS THE SOURCE OF TRUTH** - Task state is tracked on GitHub issues (labels, state), not a local checklist
8. **KEEP USER-FACING OUTPUT BRIEF** - Present test results concisely. All detailed evidence, screenshots, and rework documentation go into GitHub issues and comments. Do not repeat to the user what has been written to GitHub. Final summary: tests passed/failed, issues updated, next steps.

---

## MANDATORY WORKFLOW OVERVIEW

| Step | Description             | Required?     |
| ---- | ----------------------- | ------------- |
| 1    | Identify Current Sprint | **MANDATORY** |
| 2    | Analyze Sprint Changes  | **MANDATORY** |
| 3    | Generate Test Scenarios | **MANDATORY** |
| 4    | Run Test Suite          | **MANDATORY** |
| 5    | Handle Failures/Rework  | IF FAILURES   |
| 6    | Update Checklist        | **MANDATORY** |
| 7    | UAT Summary             | **MANDATORY** |

---

## Step 1: Identify Current Epic and Tasks

**ACTION REQUIRED:** Identify the active epic from the current branch and find its task issues on GitHub.

### 1.1 Identify the Active Epic

Parse the current branch name (strip harness prefix like `codex/` or `feature/`),
extract the slug, and match against open epics:

```bash
gh issue list --label "epic" --state open --json number,title --jq '.[] | "\(.number) \(.title)"'
```

If the branch maps to an epic, use it. If not, use the oldest open epic. If
ambiguous, ask the user.

### 1.2 Find Task Issues for the Epic

Query GitHub for issues linked to the epic:

```bash
gh api graphql -f query='query {
  repository(owner: "[OWNER]", name: "[REPO]") {
    issue(number: [EPIC]) {
      trackedIssues(first: 100) {
        nodes {
          number
          title
          state
          labels(first: 20) { nodes { name } }
        }
      }
    }
  }
}'
```

Identify tasks that have been implemented (labeled `ready-for-integration` or
similar) but not yet closed. These are the tasks under test.

### 1.3 Read Specs from GitHub Issues

Read the epic and task issues for detailed requirements and test scenarios:

```bash
# Read epic for overall acceptance criteria
gh issue view [EPIC_NUMBER] --json number,title,body,comments

# Read each task issue for specific acceptance criteria and test scenarios
gh issue view [TASK_NUMBER] --json number,title,body,comments
```

Look for comments with "## Test Scenarios (Approved)" header (posted by `/next-phase`).

---

## Step 2: Analyze Sprint Changes

**ACTION REQUIRED:** Understand what was implemented in this sprint.

### 2.1 Review Git Changes

```bash
# Recent commits for this sprint
git log --oneline -20

# Files changed in the current branch
git diff $(git merge-base HEAD main)..HEAD --name-only 2>/dev/null || git diff --name-only HEAD~10..HEAD

# Summary of changes
git diff $(git merge-base HEAD main)..HEAD --stat 2>/dev/null || git diff --stat HEAD~10..HEAD
```

### 2.2 Extract Acceptance Criteria

From the GitHub issue bodies, extract:

- All acceptance criteria (from task issues)
- User-facing functionality
- UI/UX expectations
- Integration points
- Previously approved test scenarios (from issue comments)

### 2.3 Compile Changes Summary

Create a summary of what was implemented:

```markdown
## Sprint Changes Summary: Sprint [N] - [Name]

### Features Implemented

- [Feature 1] - [Brief description]
- [Feature 2] - [Brief description]

### Components Created/Modified

- [Component 1] - [Changes]
- [Component 2] - [Changes]

### Key Files Changed

- `[path/to/file.ts]` - [What changed]
- `[path/to/file.ts]` - [What changed]
```

---

## Step 3: Generate Test Scenarios

**ACTION REQUIRED:** Create comprehensive test scenarios from the acceptance criteria.

### 3.1 Map Requirements to Test Cases

For EACH acceptance criterion, create a test scenario:

```markdown
## UAT Test Scenarios

### Test [N]: [Test Name]

**Feature**: [Feature being tested]
**Criteria**: [Acceptance criterion being validated]

**Preconditions**:

- [Any setup required before testing]
- [State the app should be in]

**Steps**:

1. [Specific action step 1]
2. [Specific action step 2]
3. [Specific action step 3]

**Expected Result**:

- [What the user should see/experience]

**Verification**:

- [ ] [Specific thing to verify]
- [ ] [Specific thing to verify]
```

### 3.2 Categorize Test Scenarios

Group tests by category:

- **Functional Tests** - Core feature functionality
- **UI/UX Tests** - Visual and interaction validation
- **Integration Tests** - How features work together
- **Edge Cases** - Boundary conditions and error handling

### 3.3 Present Test Overview

Show the user the complete test suite before starting:

> "I've identified **[N] test scenarios** for Sprint [N] - [Name]:
>
> **Functional Tests**: [N]
>
> 1. [Test name 1]
> 2. [Test name 2]
>
> **UI/UX Tests**: [N]
>
> 1. [Test name 1]
> 2. [Test name 2]
>
> **Integration Tests**: [N]
>
> 1. [Test name 1]
>
> **Ready to begin UAT? I'll walk you through each test one at a time.**"

**Wait for user confirmation before proceeding.**

---

## Step 4: Run Test Suite via Web Automation

**ACTION REQUIRED:** Execute each test scenario using browser tools, then present results to the user.

### 4.0 Web Automation Execution (MANDATORY for UI scenarios)

For EACH UI test scenario, execute using browser tools:

```
1. browser_navigate → http://localhost:4000/[route]
2. browser_snapshot → understand current page state
3. browser_click / browser_type / browser_fill_form → interact with UI elements
4. browser_wait_for → wait for expected outcomes
5. browser_snapshot → verify the result
6. browser_take_screenshot → capture evidence as [scenario-id]-result.png
```

**Chain multi-page workflows**: navigate through the full user journey, capturing screenshots at each key transition.

**For non-UI scenarios** (API, data): use Execute tool to run commands and verify.

### 4.1 Present Each Test

After executing via browser tools, present results to the user:

```markdown
---

## 🧪 Test [X/Total]: [Test Name]

**Feature**: [Feature being tested]
**Criteria**: [What we're validating]

### What Changed
[Brief description of the implementation change related to this test]

### Preconditions
- [ ] [Setup step 1]
- [ ] [Setup step 2]

### Test Steps
1. **[Action]** - [Specific instruction]
2. **[Action]** - [Specific instruction]
3. **[Action]** - [Specific instruction]

### Expected Outcome
- [Exactly what should happen]
- [Visual/functional expectations]

### Verification Checklist
- [ ] [Thing to check 1]
- [ ] [Thing to check 2]
- [ ] [Thing to check 3]

---

**Please run through these steps and reply:**

- ✅ **PASS** - Everything works as expected
- ❌ **FAIL** - [Describe what went wrong]
- ⏭️ **SKIP** - [Reason for skipping]
```

### 4.2 Record Test Results

After each user response:

**If PASS:**

- Log: "✅ Test [X] passed"
- Proceed to next test

**If FAIL:**

- Log the failure details
- Ask clarifying questions if needed
- Add to rework list
- **Continue with remaining tests** (don't stop on first failure)

**If SKIP:**

- Log the skip reason
- Note in summary
- Proceed to next test

### 4.3 Track Progress

Maintain a running status:

```markdown
### UAT Progress

- Test 1: [Test Name] - ✅ PASS
- Test 2: [Test Name] - ❌ FAIL - [Brief issue]
- Test 3: [Test Name] - ⏭️ SKIP - [Reason]
- Test 4: [Test Name] - ⏳ PENDING
```

---

## Step 5: Handle Failures/Rework

**ACTION REQUIRED (IF ANY FAILURES):** Create a rework document for failed tests.

### 5.1 Create GitHub Bug Issues for Failures

For each failure, create a GitHub bug issue:

```bash
gh issue create \
  --title "UAT Failure: [Scenario ID] - [Description]" \
  --label "bug,uat-failure,sprint-[N]" \
  --body "## UAT Failure

**Source Task Issue**: #[TASK_NUMBER]
**Scenario**: [ID] - [Name]
**Epic**: #[EPIC_NUMBER]

### Expected
[What should happen]

### Actual
[What happened]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]

*Created by /uat on [DATE]*"
```

### 5.1b (Optional) Create Local Rework Document

Optionally, also create a local rework summary:

```bash
mkdir -p [PLAN_ROOT]/UAT
```

```markdown
# UAT Rework: Sprint [N] - [Sprint Name]

## Document Metadata

- **Sprint**: Sprint [N] - [Sprint Name]
- **UAT Date**: [TODAY'S DATE]
- **Status**: Rework Required
- **Total Tests**: [N]
- **Passed**: [N] ✅
- **Failed**: [N] ❌
- **Skipped**: [N] ⏭️

---

## 📋 Rework Checklist

### High Priority (Blocking Issues)

- [ ] [Issue 1 - brief description]
- [ ] [Issue 2 - brief description]

### Medium Priority

- [ ] [Issue 3 - brief description]

### Low Priority / Nice to Have

- [ ] [Issue 4 - brief description]

---

## 🔴 Failed Test Details

### Failure [N]: [Test Name]

**Test Scenario Reference**: Test [X] from UAT run

**What Changed (Implementation)**:
[Description of the implementation that was being tested]

**Test Criteria**:
[The acceptance criterion that was being validated]

**Test Steps Performed**:

1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Result**:
[What should have happened]

**Actual Result**:
[What actually happened - user's feedback]

**Root Cause Analysis**:

- [ ] Logic error in implementation
- [ ] Missing edge case handling
- [ ] UI/UX issue
- [ ] Integration issue
- [ ] Requirements misunderstanding
- [ ] Other: [Describe]

**Proposed Fix**:
[Brief description of how to fix]

**Related Files**:

- `[path/to/file.ts]` - [What needs to change]

**Checklist Reference**: _(GitHub issue #[TASK_NUMBER] is the source of truth)_

---

## References

- **Requirements Source**: [`[REQUIREMENTS_SOURCE]`]([REQUIREMENTS_SOURCE])
- **Implementation Checklist**: _(legacy — GitHub issues are the source of truth)_

---

_Generated by /uat on [TODAY'S DATE]_
```

### 5.2 Create GitHub Issues for Rework Items

Create GitHub issues for each rework item, linked to the epic:

```bash
gh issue create \
  --title "UAT Rework: [item description]" \
  --label "task,uat-rework,sprint-[N]" \
  --body "## UAT Rework Task

**Epic**: #[EPIC_NUMBER]
**Source Task**: #[TASK_NUMBER]
**UAT Failure**: [failure description]

### What
[What needs to be fixed]

### Acceptance Criteria
- [ ] [Criterion from UAT failure]

*Created by /uat on [DATE]*"
```

### 5.3 Link to Epics

If the sprint has associated epic documents, update them with rework references:

1. Read the epic file
2. Add a reference to the rework document in the epic's status/tracking section

---

## Step 6: Update GitHub Issue State

**ACTION REQUIRED:** Update task issues on GitHub with UAT results.

### 6.1 Mark Tasks as UAT-Passed

For each task that passed UAT, apply the `uat-passed` label:

```bash
gh issue edit [TASK_NUMBER] --add-label "uat-passed"
```

If all tasks for the epic have passed UAT, the epic is ready for final sign-off.
Do not close task issues here unless explicitly instructed by the user —
final closure happens through orchestration/closeout.

### 6.2 Mark Tasks as UAT-Failed

For tasks that failed UAT, apply the `uat-failed` label:

```bash
gh issue edit [TASK_NUMBER] --add-label "uat-failed"
```

The rework issues created in Step 5.2 will be picked up by `/next-phase` as the
next tasks in the queue.

---

## Step 7: UAT Summary

**ACTION REQUIRED:** Present the final UAT summary.

### 7.1 If ALL Tests PASSED

```markdown
## ✅ UAT COMPLETE - ALL TESTS PASSED

**Sprint**: Sprint [N] - [Name]
**Date**: [TODAY'S DATE]

### Test Results

| Category    | Passed  | Failed | Skipped |
| ----------- | ------- | ------ | ------- |
| Functional  | [N]     | 0      | [N]     |
| UI/UX       | [N]     | 0      | [N]     |
| Integration | [N]     | 0      | [N]     |
| **Total**   | **[N]** | **0**  | **[N]** |

### Verified Features

- ✅ [Feature 1]
- ✅ [Feature 2]
- ✅ [Feature 3]

### Next Steps

The sprint implementation has been validated by UAT. Task issues have been
labeled `uat-passed`. You may now:

- Run `/end-session` to close out the sprint
- Continue to the next sprint with `/next-phase`
```

### 7.2 If ANY Tests FAILED

```markdown
## ⚠️ UAT COMPLETE - REWORK REQUIRED

**Sprint**: Sprint [N] - [Name]
**Date**: [TODAY'S DATE]

### Test Results

| Category    | Passed  | Failed  | Skipped |
| ----------- | ------- | ------- | ------- |
| Functional  | [N]     | [N]     | [N]     |
| UI/UX       | [N]     | [N]     | [N]     |
| Integration | [N]     | [N]     | [N]     |
| **Total**   | **[N]** | **[N]** | **[N]** |

### Failures Summary

1. ❌ [Test Name] - [Brief issue description]
2. ❌ [Test Name] - [Brief issue description]

### Documents Created

- **Rework Document**: `[PLAN_ROOT]/UAT/[sprint-name]-rework.UAT.md`

### Rework Issues Created on GitHub

- #[NN] - [Rework item 1]
- #[NN] - [Rework item 2]

---

### Next Steps

To address the rework items, choose one of the following:

1. **Run `/next-phase`** to pick up the rework issues from GitHub and fix them
2. **Run `/plan-feature`** if issues need more detailed technical planning
3. **Run `/plan-bugfix`** if issues are bugs requiring investigation

After fixing issues, run `/uat` again to re-validate the fixes.
```

---

## Handling Edge Cases

### If no sprint is in progress:

> "No active sprint found. No open epics with tasks were found on GitHub. Please run `/plan-feature` to plan a new feature, or check that GitHub issues are properly linked to an epic."

### If sprint has no completed items:

> "The current sprint has no completed items yet. UAT should be run after implementation is complete.
>
> Would you like to:
>
> 1. Run `/next-phase` to continue implementation
> 2. Proceed with UAT anyway (test what exists so far)"

### If user wants to abort mid-UAT:

> "UAT session paused. Current progress:
>
> - Tests completed: [N]/[Total]
> - Failures logged: [N]
>
> To resume UAT later, run `/uat` again. Partial results have NOT been saved."

### If the project UAT notes directory doesn't exist:

```bash
mkdir -p [PLAN_ROOT]/UAT
```

---

## UAT Best Practices

### What UAT Covers:

- Visual appearance matches expectations
- User experience quality
- User flow completeness
- Real-world usage scenarios
- Edge case handling
- Cross-browser/device compatibility (if applicable)

### What UAT Does NOT Cover (Compliance covers these):

- TypeScript compilation
- Lint checks
- Build success
- Code patterns matching spec

### Test Writing Guidelines:

- **Be Specific** - "Click the blue 'Submit' button" not "Click submit"
- **Include Context** - What screen/state should the user be on
- **Clear Expected Results** - Exactly what should happen
- **Verification Steps** - How to confirm success

---

**BEGIN NOW: Start with Step 1 - Identify Current Epic and Tasks.**
