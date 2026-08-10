#!/usr/bin/env bash
#
# Agent Harness Code Review Checkpoint Hook
#
# Runs a second droid session to review code changes.
# Provides an independent "second opinion" on the work done.
#
# Place in: hooks/code-review-checkpoint.sh
# Make executable: chmod +x hooks/code-review-checkpoint.sh
#
# Can be triggered:
# - Manually: ./code-review-checkpoint.sh
# - As a /command in Factory
# - At end of session via /end-session hook

set -euo pipefail

PROJECT_DIR="${WORKFLOW_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-$(pwd)}}"
cd "$PROJECT_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Code Review Checkpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get recent changes
CHANGES=$(git diff HEAD~1 --stat 2>/dev/null || git diff --stat 2>/dev/null || echo "No git changes detected")
DIFF=$(git diff HEAD~1 2>/dev/null || git diff 2>/dev/null || echo "")

if [[ -z "$DIFF" ]]; then
    echo "ℹ️  No changes to review"
    exit 0
fi

echo "Changes to review:"
echo "$CHANGES"
echo ""

# Check if droid CLI is available
if ! command -v droid &> /dev/null; then
    echo "⚠️  droid CLI not found - skipping AI review"
    exit 0
fi

# Model for review - can be customized
REVIEW_MODEL="${WORKFLOW_REVIEW_MODEL:-${FACTORY_REVIEW_MODEL:-custom:gemini-3-pro-high-[Antigravity]-1}}"

echo "🤖 Requesting code review from: $REVIEW_MODEL"
echo ""

# Create a focused review prompt
REVIEW_PROMPT="You are a code reviewer. Review the following git diff for:

1. **Bugs/Errors**: Logic errors, null checks, off-by-one, race conditions
2. **Security**: Exposed secrets, injection vulnerabilities, unsafe operations
3. **Best Practices**: Code style, naming, modularity, DRY violations
4. **Completeness**: Missing error handling, edge cases, incomplete implementations

Be concise. Only report actual issues, not style preferences.
If the code looks good, just say 'LGTM - no issues found'.

Format your response as:
- [CRITICAL] for blocking issues
- [WARNING] for should-fix issues
- [INFO] for suggestions

Here's the diff:

\`\`\`diff
$DIFF
\`\`\`"

# Run the review
REVIEW_OUTPUT=$(echo "$REVIEW_PROMPT" | droid exec \
    --model "$REVIEW_MODEL" \
    --auto high \
    --print \
    2>&1) || true

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Code Review Results:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "$REVIEW_OUTPUT"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for critical issues
if echo "$REVIEW_OUTPUT" | grep -qi "\[CRITICAL\]"; then
    echo ""
    echo "❌ CRITICAL issues found - please address before proceeding"
    exit 1
fi

echo "✅ Code review complete"
exit 0
