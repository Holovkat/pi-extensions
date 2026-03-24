---
name: design-rounds
description: Orchestrate parallel UI design rounds from a shared baseline, then compare and vote on the results. Use when the user wants multiple variants, a shortlist, or a winner chosen from likes and dislikes.
---

# Design Rounds

Use this skill when a user wants several UI directions explored in parallel and then narrowed down.

## Inputs to collect

- Baseline repo/worktree and exact file paths to change
- Visual target: screenshots, URLs, reference repo, or design language description
- Variant count and any requested model split
- Constraints to preserve
- What success means for the vote (for example: “closest to Craft”, “least noisy”, “best mobile fit”)

## Workflow

1. Create a todo list for the round.
2. Lock the baseline first: identify the current best variant and preserve its worktree or file snapshot.
3. Create one isolated worktree per candidate.
4. Delegate each candidate to the project droid `design-variant-builder` with:
   - the exact worktree path
   - the baseline files
   - the target reference
   - one distinct variant brief
   - required validation commands
5. Keep the prompts meaningfully different so the round explores multiple directions instead of near-duplicates.
6. Validate every finished candidate before presenting it.
7. Return a compact comparison table with variant names, model, key idea, and preview path or URL.
8. If the user wants help choosing, delegate the review step to `design-vote-critic` and present the resulting ranking.

## Guardrails

- Do not overwrite the currently preferred baseline.
- Do not merge or delete variants until the user picks a winner.
- Prefer reversible changes and isolated worktrees.
- Preserve behavior unless the round explicitly targets interaction changes.

## Output contract

Return:

- `Round summary` — what was explored
- `Variants` — model, path, and one-line description for each option
- `Vote summary` — winner, runner-up, and why
- `Next round` — prompt-ready instructions based on likes and dislikes
