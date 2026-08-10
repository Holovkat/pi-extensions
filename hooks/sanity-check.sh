#!/usr/bin/env bash
#
# Agent Harness Sanity Check Hook
#
# Verifies the application can start/load without errors.
# Useful to run before marking a phase complete.
#
# For web apps: starts dev server, checks for errors, then stops
# For CLI apps: runs with --help or --version
# For libraries: runs basic import test
#
# Place in: hooks/sanity-check.sh
# Make executable: chmod +x hooks/sanity-check.sh
#
# Can be triggered manually: ./sanity-check.sh
# Or via Factory command hook

set -euo pipefail

PROJECT_DIR="${WORKFLOW_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-$(pwd)}}"
cd "$PROJECT_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Running sanity check..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

SANITY_OK=true

# ============================================================
# Node.js / Web App Sanity Check
# ============================================================
if [[ -f "package.json" ]]; then
    echo "📦 Detected Node.js project"

    # Check if node_modules exists
    if [[ ! -d "node_modules" ]]; then
        echo "⚠️  node_modules missing - running install..."
        if command -v pnpm &> /dev/null; then
            pnpm install 2>&1 | tail -10
        elif command -v yarn &> /dev/null; then
            yarn install 2>&1 | tail -10
        else
            npm install 2>&1 | tail -10
        fi
    fi

    # Try to start dev server briefly to check for startup errors
    if grep -q '"dev"' package.json 2>/dev/null; then
        echo "🚀 Testing dev server startup..."

        # Start dev server in background, capture output
        DEV_LOG="/tmp/factory-dev-check-$$.log"

        # Determine package manager
        if [[ -f "pnpm-lock.yaml" ]]; then
            PM="pnpm"
        elif [[ -f "yarn.lock" ]]; then
            PM="yarn"
        else
            PM="npm"
        fi

        # Start dev server
        timeout 15s $PM run dev > "$DEV_LOG" 2>&1 &
        DEV_PID=$!

        # Wait a bit for server to start
        sleep 5

        # Check for common error patterns in output
        if grep -qiE "error|failed|cannot find|module not found|syntaxerror|typeerror" "$DEV_LOG" 2>/dev/null; then
            echo ""
            echo "❌ Dev server errors detected:"
            grep -iE "error|failed|cannot find|module not found|syntaxerror|typeerror" "$DEV_LOG" | head -15
            SANITY_OK=false
        else
            # Try to hit the dev server
            if command -v curl &> /dev/null; then
                # Get port from vite config or default
                PORT=$(grep -oP 'port:\s*\K\d+' vite.config.ts 2>/dev/null || echo "5173")

                if curl -s --max-time 5 "http://localhost:$PORT" > /dev/null 2>&1; then
                    echo "✅ Dev server responding on port $PORT"
                else
                    echo "ℹ️  Server starting (may need more time)"
                fi
            fi
        fi

        # Cleanup
        kill $DEV_PID 2>/dev/null || true
        rm -f "$DEV_LOG"
    fi

    # Run type check
    if [[ -f "tsconfig.json" ]]; then
        echo "📝 Running TypeScript check..."
        npx tsc --noEmit 2>&1 | tail -20 || SANITY_OK=false
    fi
fi

# ============================================================
# Python Sanity Check
# ============================================================
if [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]]; then
    echo "🐍 Detected Python project"

    # Try to import the main module
    if [[ -f "pyproject.toml" ]]; then
        PKG_NAME=$(grep -oP 'name\s*=\s*"\K[^"]+' pyproject.toml 2>/dev/null | head -1 || true)
    fi

    if [[ -n "${PKG_NAME:-}" ]]; then
        echo "Testing import of $PKG_NAME..."
        python3 -c "import $PKG_NAME" 2>&1 || SANITY_OK=false
    fi

    # Run type check if available
    if command -v mypy &> /dev/null; then
        echo "Running mypy..."
        mypy . --ignore-missing-imports 2>&1 | tail -15 || true
    fi
fi

# ============================================================
# Rust Sanity Check
# ============================================================
if [[ -f "Cargo.toml" ]]; then
    echo "🦀 Detected Rust project"

    echo "Running cargo check..."
    cargo check 2>&1 | tail -20 || SANITY_OK=false
fi

# ============================================================
# Go Sanity Check
# ============================================================
if [[ -f "go.mod" ]]; then
    echo "🐹 Detected Go project"

    echo "Running go build..."
    go build ./... 2>&1 | tail -15 || SANITY_OK=false
fi

# ============================================================
# Summary
# ============================================================
echo ""
if [[ "$SANITY_OK" == "true" ]]; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Sanity check PASSED - application loads correctly"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
else
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "❌ Sanity check FAILED - please fix errors before continuing"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
