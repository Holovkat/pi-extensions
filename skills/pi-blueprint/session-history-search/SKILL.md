# Session History Search

Use this skill when a transcript-backed reviewer needs to verify what was actually decided in a Pi planning session.

## Goal

Extract reliable decision evidence from the provided session transcript so the reviewer can:
- confirm whether a proposed specification is aligned
- find the most relevant transcript segments for a query
- identify contradictions, corrections, and unresolved gaps

## Method

1. Read the full transcript provided in the prompt.
2. Identify explicit user decisions, constraints, approvals, corrections, and rejections.
3. Prefer the latest user correction over earlier conflicting statements.
4. Separate confirmed decisions from assistant assumptions or summaries.
5. Return only claims that can be supported by the transcript text.

## Review Rules

- Do not treat assistant summaries as source-of-truth unless the user explicitly confirms them.
- If a decision is implied but not clearly stated, mark it as missing or ambiguous.
- If later transcript content changes an earlier decision, flag the earlier decision as superseded.
- Keep evidence concise and specific.
- When in doubt, fail toward `needs-review`, not `pass`.

## Output Discipline

Return JSON only when the calling prompt requires JSON.
Do not add markdown fences or explanatory prose outside the required structure.
