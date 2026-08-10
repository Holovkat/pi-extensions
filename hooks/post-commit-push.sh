#!/usr/bin/env bash
#
# Agent Harness Post-Commit Push Hook
#
# This hook runs after a git commit succeeds and pushes the current branch.
#
# Place in: hooks/post-commit-push.sh
# Make executable: chmod +x hooks/post-commit-push.sh

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract the command that was executed
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process git commit commands
if [[ ! "$COMMAND" =~ ^git[[:space:]]+commit ]]; then
    exit 0
fi

# Check if the tool succeeded
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_response.exit_code // 0')
if [[ "$EXIT_CODE" != "0" ]]; then
    echo "⚠️  Commit failed, skipping push"
    exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 STEP 4: Pushing current branch..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get the project directory
PROJECT_DIR="${WORKFLOW_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-$(pwd)}}"
cd "$PROJECT_DIR"

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [[ "$CURRENT_BRANCH" == "HEAD" ]]; then
    echo "❌ Detached HEAD; skipping automatic push"
    exit 1
fi

UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)

if [[ -n "$UPSTREAM" ]]; then
    echo "Pushing $CURRENT_BRANCH to $UPSTREAM..."
    git push 2>&1 || {
        echo "❌ Push failed!"
        exit 1
    }
else
    echo "No upstream found. Pushing $CURRENT_BRANCH to origin and setting upstream..."
    git push -u origin "$CURRENT_BRANCH" 2>&1 || {
        echo "❌ Push failed!"
        exit 1
    }
fi

echo "✅ Successfully pushed $CURRENT_BRANCH!"
echo ""
exit 0
