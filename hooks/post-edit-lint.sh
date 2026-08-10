#!/usr/bin/env bash
#
# Agent Harness Post-Edit Lint Hook
#
# Triggers after Edit/Create/MultiEdit tools to run incremental linting
# on the modified file. Catches errors early during agent development.
#
# Place in: hooks/post-edit-lint.sh
# Make executable: chmod +x hooks/post-edit-lint.sh

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract tool name and file path
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Only process Edit, Create, MultiEdit tools
case "$TOOL_NAME" in
    Edit|Create|MultiEdit|Write) ;;
    *) exit 0 ;;
esac

# Skip if no file path
[[ -z "$FILE_PATH" ]] && exit 0

# Check if tool succeeded
EXIT_CODE=$(echo "$INPUT" | jq -r '.tool_response.exit_code // .tool_response.success // "true"')
if [[ "$EXIT_CODE" == "false" ]] || [[ "$EXIT_CODE" != "0" && "$EXIT_CODE" != "true" ]]; then
    exit 0
fi

# Get file extension
EXT="${FILE_PATH##*.}"

# Get the project directory
PROJECT_DIR="${WORKFLOW_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-$(pwd)}}"
cd "$PROJECT_DIR"

echo ""
echo "🔍 Running lint check on: $(basename "$FILE_PATH")"

# Track if we found issues
LINT_ISSUES=0

# Run appropriate linter based on file type
case "$EXT" in
    ts|tsx|js|jsx|mjs|cjs)
        if [[ -f "package.json" ]]; then
            # Try ESLint first
            if [[ -f "node_modules/.bin/eslint" ]]; then
                echo "   eslint $FILE_PATH"
                npx eslint "$FILE_PATH" --max-warnings 0 2>&1 | head -20 || LINT_ISSUES=1
            elif command -v eslint &> /dev/null; then
                eslint "$FILE_PATH" --max-warnings 0 2>&1 | head -20 || LINT_ISSUES=1
            fi

            # Also run TypeScript check for TS files
            if [[ "$EXT" == "ts" || "$EXT" == "tsx" ]] && [[ -f "tsconfig.json" ]]; then
                echo "   tsc --noEmit (type check)"
                npx tsc --noEmit 2>&1 | grep -E "error TS|$FILE_PATH" | head -10 || true
            fi
        fi
        ;;
    py)
        if command -v ruff &> /dev/null; then
            echo "   ruff check $FILE_PATH"
            ruff check "$FILE_PATH" 2>&1 | head -20 || LINT_ISSUES=1
        elif command -v flake8 &> /dev/null; then
            echo "   flake8 $FILE_PATH"
            flake8 "$FILE_PATH" 2>&1 | head -20 || LINT_ISSUES=1
        elif command -v pylint &> /dev/null; then
            echo "   pylint $FILE_PATH"
            pylint "$FILE_PATH" --max-line-length=120 2>&1 | head -20 || LINT_ISSUES=1
        fi

        # Type check with mypy/pyright if available
        if command -v mypy &> /dev/null; then
            mypy "$FILE_PATH" 2>&1 | head -10 || true
        fi
        ;;
    rs)
        echo "   cargo clippy (checking file)"
        cargo clippy -- -D warnings 2>&1 | grep -E "error|warning|$FILE_PATH" | head -20 || LINT_ISSUES=1
        ;;
    go)
        echo "   go vet / golangci-lint"
        go vet "$FILE_PATH" 2>&1 | head -10 || LINT_ISSUES=1
        if command -v golangci-lint &> /dev/null; then
            golangci-lint run "$FILE_PATH" 2>&1 | head -10 || true
        fi
        ;;
    css|scss|less)
        if [[ -f "node_modules/.bin/stylelint" ]]; then
            echo "   stylelint $FILE_PATH"
            npx stylelint "$FILE_PATH" 2>&1 | head -10 || LINT_ISSUES=1
        fi
        ;;
    *)
        # No linter for this file type
        exit 0
        ;;
esac

if [[ $LINT_ISSUES -eq 1 ]]; then
    echo ""
    echo "⚠️  Lint issues detected - please fix before continuing"
    echo ""
fi

exit 0
