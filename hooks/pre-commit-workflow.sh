#!/usr/bin/env bash
#
# Agent Harness Pre-Commit Workflow Hook
#
# This hook intercepts git commit commands and runs:
# 1. Lint on changed files
# 2. Build the project
# 3. Code review with a custom model
# 4. Allows commit, then pushes to main
#
# Place in: hooks/pre-commit-workflow.sh
# Make executable: chmod +x hooks/pre-commit-workflow.sh

set -euo pipefail

# Read the hook input from stdin
INPUT=$(cat)

# Extract the command being executed
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only process git commit commands
if [[ ! "$COMMAND" =~ ^git[[:space:]]+commit ]]; then
    # Not a commit command, allow it to proceed
    exit 0
fi

echo "🔄 Pre-commit workflow triggered..."

# Get the project directory
PROJECT_DIR="${WORKFLOW_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-$(pwd)}}"
cd "$PROJECT_DIR"

# ============================================================
# STEP 1: Lint changed files
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 STEP 1: Running lint on changed files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

if [[ -z "$STAGED_FILES" ]]; then
    echo "⚠️  No staged files found"
else
    echo "Files to lint:"
    echo "$STAGED_FILES" | sed 's/^/  - /'

    # Detect and run appropriate linter
    if [[ -f "package.json" ]]; then
        # Node.js project
        if command -v npm &> /dev/null; then
            if grep -q '"lint"' package.json 2>/dev/null; then
                echo "Running: npm run lint"
                npm run lint -- $STAGED_FILES 2>&1 || {
                    echo "❌ Lint failed! Please fix errors before committing."
                    exit 2
                }
            elif [[ -f "node_modules/.bin/eslint" ]]; then
                echo "Running: eslint"
                npx eslint $STAGED_FILES 2>&1 || {
                    echo "❌ ESLint failed! Please fix errors before committing."
                    exit 2
                }
            fi
        fi
    elif [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]]; then
        # Python project
        if command -v ruff &> /dev/null; then
            echo "Running: ruff check"
            ruff check $STAGED_FILES 2>&1 || {
                echo "❌ Ruff lint failed!"
                exit 2
            }
        elif command -v flake8 &> /dev/null; then
            echo "Running: flake8"
            flake8 $STAGED_FILES 2>&1 || {
                echo "❌ Flake8 failed!"
                exit 2
            }
        fi
    elif [[ -f "Cargo.toml" ]]; then
        # Rust project
        echo "Running: cargo clippy"
        cargo clippy -- -D warnings 2>&1 || {
            echo "❌ Clippy failed!"
            exit 2
        }
    elif [[ -f "go.mod" ]]; then
        # Go project
        echo "Running: golangci-lint"
        golangci-lint run 2>&1 || {
            echo "❌ Go lint failed!"
            exit 2
        }
    fi

    echo "✅ Lint passed!"
fi

# ============================================================
# STEP 2: Build the project
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔨 STEP 2: Building the project..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Detect and run appropriate build command
BUILD_SUCCESS=false

if [[ -f "package.json" ]]; then
    if grep -q '"build"' package.json 2>/dev/null; then
        echo "Running: npm run build"
        npm run build 2>&1 && BUILD_SUCCESS=true
    elif grep -q '"tsc"' package.json 2>/dev/null || [[ -f "tsconfig.json" ]]; then
        echo "Running: npx tsc --noEmit"
        npx tsc --noEmit 2>&1 && BUILD_SUCCESS=true
    else
        echo "ℹ️  No build script found, skipping..."
        BUILD_SUCCESS=true
    fi
elif [[ -f "Makefile" ]]; then
    echo "Running: make"
    make 2>&1 && BUILD_SUCCESS=true
elif [[ -f "Cargo.toml" ]]; then
    echo "Running: cargo build"
    cargo build 2>&1 && BUILD_SUCCESS=true
elif [[ -f "go.mod" ]]; then
    echo "Running: go build"
    go build ./... 2>&1 && BUILD_SUCCESS=true
elif [[ -f "pyproject.toml" ]]; then
    if grep -q 'build-backend' pyproject.toml 2>/dev/null; then
        echo "Running: python -m build"
        python -m build 2>&1 && BUILD_SUCCESS=true
    else
        echo "ℹ️  No build required for this Python project"
        BUILD_SUCCESS=true
    fi
else
    echo "ℹ️  No build system detected, skipping..."
    BUILD_SUCCESS=true
fi

if [[ "$BUILD_SUCCESS" != "true" ]]; then
    echo "❌ Build failed! Please fix errors before committing."
    exit 2
fi

echo "✅ Build passed!"

# ============================================================
# STEP 3: Code review with custom model
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 STEP 3: Running code review..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Model: custom:gemini-3-pro-high-[Antigravity]-1"

if command -v droid &> /dev/null; then
    echo "Requesting review from AI model..."

    REVIEW_OUTPUT=$(droid exec --model "custom:gemini-3-pro-high-[Antigravity]-1" --auto high "Review the code changes for issues" 2>&1) || true

    echo ""
    echo "📝 Code Review Results:"
    echo "─────────────────────────────────────────────────────"
    echo "$REVIEW_OUTPUT"
    echo "─────────────────────────────────────────────────────"

    # Check for critical issues (exit code 2 blocks the commit)
    if echo "$REVIEW_OUTPUT" | grep -qi "CRITICAL\|BLOCKER\|SECURITY VULNERABILITY"; then
        echo ""
        echo "❌ Critical issues found! Please address before committing."
        echo "   (To bypass, use: git commit --no-verify)"
        exit 2
    fi

    echo "✅ Code review complete!"
else
    echo "⚠️  droid CLI not found, skipping AI review"
fi

# ============================================================
# STEP 4: Allow commit (exit 0) - push happens in PostToolUse
# ============================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All checks passed! Proceeding with commit..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Exit 0 allows the command to proceed
exit 0
