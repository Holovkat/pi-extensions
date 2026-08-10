#!/usr/bin/env bash
set -euo pipefail

BASE_REF="${1:-}"

if [[ "${BASE_REF}" == "-h" || "${BASE_REF}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/release-vector-assess.sh [base-ref]

Creates a provider-neutral release/change vector matrix from the current git
diff. The output is a starter assessment for the release owner and specialists;
project-local adapters remain authoritative for exact commands and evidence.
USAGE
  exit 0
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "release-vector-assess: not inside a git repository" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -z "$BASE_REF" ]]; then
  if git rev-parse --verify main >/dev/null 2>&1; then
    BASE_REF="$(git merge-base HEAD main)"
  elif git rev-parse --verify origin/main >/dev/null 2>&1; then
    BASE_REF="$(git merge-base HEAD origin/main)"
  else
    BASE_REF="HEAD~1"
  fi
fi

changed_files="$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || git diff --name-only "$BASE_REF" HEAD 2>/dev/null || true)"
staged_files="$(git diff --cached --name-only 2>/dev/null || true)"
unstaged_files="$(git diff --name-only 2>/dev/null || true)"
untracked_files="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

all_files="$(
  {
    printf '%s\n' "$changed_files"
    printf '%s\n' "$staged_files"
    printf '%s\n' "$unstaged_files"
    printf '%s\n' "$untracked_files"
  } | sed '/^$/d' | sort -u
)"

has_match() {
  local pattern="$1"
  printf '%s\n' "$all_files" | grep -E "$pattern" >/dev/null 2>&1
}

mark_vector() {
  local vector="$1"
  local changed="$2"
  local owner="$3"
  local default_evidence="$4"
  local notes="$5"
  printf '| `%s` | %s | %s | %s | %s | pending |\n' "$vector" "$changed" "$owner" "$default_evidence" "$notes"
}

branch="$(git branch --show-current 2>/dev/null || true)"
head_sha="$(git rev-parse --short HEAD 2>/dev/null || true)"

cat <<EOF
# Release Vector Assessment

- Repository: \`$(basename "$repo_root")\`
- Branch: \`${branch:-detached}\`
- Head: \`${head_sha:-unknown}\`
- Base: \`${BASE_REF}\`

## Intent And Confidence

- Inferred intent: [state what the user is trying to achieve]
- Confidence: high | medium | low
- Trajectory checked: git state, recent issues/docs, project instructions, and changed files
- Decision rule: proceed when confidence is high; proceed with named assumptions when medium; ask one focused question when low or when a high-risk vector is unknown.

## Changed Files

EOF

if [[ -n "$all_files" ]]; then
  printf '%s\n' "$all_files" | sed 's/^/- `/' | sed 's/$/`/'
else
  echo "- No changed files detected."
fi

cat <<'EOF'

## Vector Matrix

| Vector | Changed | Owner | Evidence Required | Notes | Status |
| --- | --- | --- | --- | --- | --- |
EOF

code_changed="no"
data_shape_changed="no"
data_content_changed="unknown"
config_changed="no"
service_changed="no"
provider_changed="unknown"
deployment_changed="unknown"
verification_changed="unknown"
cleanup_changed="unknown"
closeout_changed="unknown"

if has_match '(^|/)(src|app|lib|components|server|packages|apps|cmd|internal|pkg|api|routes)/|[.](ts|tsx|js|jsx|py|go|rs|rb|java|cs|php|swift|kt)$'; then
  code_changed="yes"
fi

if has_match '(^|/)(migrations|schema|prisma|db|database|models|generated|bindings)/|schema|migration|[.]sql$'; then
  data_shape_changed="yes"
fi

if has_match '(^|/)(seed|seeds|fixtures|data|backfill|cleanup|scripts)/|seed|fixture|backfill|cleanup'; then
  data_content_changed="yes/confirm"
fi

if has_match '(^|/)(config|configs|infra|environments|.github/workflows)/|(^|/)(Dockerfile|docker-compose|compose)[^/]*$|[.]env[.]|settings|feature-flag|flags'; then
  config_changed="yes"
fi

if has_match '(^|/)(infra|compose|docker|k8s|helm|terraform|pulumi|queues|workers|services)/|broker|queue|cache|storage|tunnel'; then
  service_changed="yes/confirm"
fi

if has_match 'auth|oauth|sso|payment|billing|email|map|provider|webhook|callback|redirect'; then
  provider_changed="yes/confirm"
fi

if has_match 'deploy|release|vercel|netlify|render|fly|railway|dokku|kubernetes|helm|terraform|cloudflare|alias|domain|workflow'; then
  deployment_changed="yes/confirm"
fi

if has_match '(^|/)(test|tests|spec|e2e|playwright|cypress|vitest|jest|pytest|__tests__)/|[.]test[.]|[.]spec[.]|smoke|uat'; then
  verification_changed="yes"
fi

if has_match 'cleanup|prune|remove|delete|deprecate|archive|closeout'; then
  cleanup_changed="yes/confirm"
fi

if has_match 'README|CHANGELOG|docs/|designs/|features/|checklist|release-notes|closeout|lessons'; then
  closeout_changed="yes"
fi

mark_vector "code" "$code_changed" "implementation specialist" "diff review, targeted tests, user-visible or API smoke" "UI/backend/runtime behavior"
mark_vector "data-shape" "$data_shape_changed" "data specialist" "migration/contract plan, backup when data can be affected, readback proof" "schema, migrations, generated contracts"
mark_vector "data-content" "$data_content_changed" "data specialist" "backup or snapshot when mutable data changes, cleanup/backfill command, readback proof" "seeds, cleanup, backfill, tenant/customer records"
mark_vector "config" "$config_changed" "environment specialist" "source-of-truth check, drift check, redacted before/after values" "env vars, feature flags, app config, secrets location"
mark_vector "service" "$service_changed" "service/infrastructure specialist" "restart/change evidence, health check, contract check" "queues, brokers, caches, storage, workers, tunnels"
mark_vector "provider" "$provider_changed" "provider/access specialist" "provider boundary tuple, callback/webhook/role evidence, scoped smoke" "auth, payments, email, maps, dashboards, third parties"
mark_vector "deployment" "$deployment_changed" "deployment specialist" "artifact/commit identity, canonical target, promotion path, alias/domain mapping" "build, release, promotion, hosted target"
mark_vector "verification" "$verification_changed" "testing specialist" "scenario list, pass/fail evidence, known limits" "unit, integration, UAT, smoke, monitoring"
mark_vector "cleanup" "$cleanup_changed" "deployment or repo-maintenance specialist" "exact inventory, explicit approval, retained canonical resources" "stale deployments, branches, obsolete config"
mark_vector "closeout" "$closeout_changed" "orchestrator/knowledge specialist" "issue/checklist/docs/notes updated, lessons captured" "release notes, docs, durable learnings"

cat <<'EOF'

## Execution Order

1. Confirm intent and release scope.
2. Resolve unknown or yes/confirm vectors with the owning specialist or project adapter.
3. Order active vectors by dependency before execution.
4. Run only the gates required by active vectors.
5. Record evidence per vector before approval or closeout.

## Project Adapter Hook

- Adapter source: [project docs, scripts, workflow files, or owner instruction]
- Commands to run: [project-specific]
- Stop conditions: [project-specific]
EOF
