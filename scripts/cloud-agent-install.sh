#!/usr/bin/env bash
#
# Cloud Agent install phase for the Pattern-Like Astrology monorepo.
#
# Idempotent, non-interactive repository bootstrap run after checkout. It only
# prepares durable state (dependencies, ephemeris data, the local D1 database,
# and a seeded local-dev user); long-running dev servers live in `terminals`
# in .cursor/environment.json, never here.
#
# Safe to run repeatedly: npm ci is deterministic, the ephemeris download
# re-verifies existing files by digest, the D1 migrations are IF NOT EXISTS, and
# the dev-user seed uses INSERT OR IGNORE.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# 1. `python` shim. The contract lane (npm run test:contracts) and the reading
#    engine's allowlist generator invoke bare `python`; the base image ships
#    only `python3`. /usr/local/bin is on PATH, so a symlink there is enough.
if ! command -v python >/dev/null 2>&1; then
  sudo ln -sf "$(command -v python3)" /usr/local/bin/python
fi

# 2. Python contract-validation dependencies (JSON Schema + OpenAPI + fixtures).
#    --break-system-packages installs into the user site on this externally
#    managed interpreter; the modules only need to be importable by `python`.
python -m pip install --user --break-system-packages \
  jsonschema referencing pyyaml openapi-spec-validator

# 3. Node workspace dependencies, pinned by package-lock.json.
npm ci

# 4. Swiss Ephemeris data files (pinned commit + SHA-256 in ephemeris.lock.json).
npm run ephe:download -w @patternlike/calc-stub

# 5. Apply the ordered D1 migrations to the local (default) database. Durable
#    file state under apps/api/.wrangler that `wrangler dev` reuses at runtime.
npm run db:local -w @patternlike/api

# 6. Seed the AUTH_STUB local-dev user (usr_local_dev_0001). The X-User-Id header
#    names an existing user but no longer creates one, so the local birth->chart
#    curl flow and the PWA both need this row + wrapped DEK to exist.
node scripts/dev/seed-dev-user.mjs

echo "cloud-agent install complete"
