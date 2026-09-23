#!/usr/bin/env bash
#
# Cloud Agent install phase for the Pattern-Like Astrology monorepo.
#
# Idempotent, non-interactive repository bootstrap run after checkout. It only
# prepares durable state (dependencies and the repo-local .venv, ephemeris data,
# the local D1 database, and a seeded local-dev user); long-running dev servers
# live in `terminals` in .cursor/environment.json, never here.
#
# Safe to run repeatedly: pip skips satisfied requirements and an existing .venv
# is reused, npm ci is deterministic, the ephemeris download re-verifies existing
# files by digest, the D1 migrations are IF NOT EXISTS, and the dev-user seed
# uses INSERT OR IGNORE.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# 1. `python` shim. The contract lane (npm run test:contracts) and the reading
#    engine's allowlist generator invoke bare `python`; the base image ships
#    only `python3`. /usr/local/bin is on PATH, so a symlink there is enough.
if ! command -v python >/dev/null 2>&1; then
  sudo ln -sf "$(command -v python3)" /usr/local/bin/python
fi

# 2. Python dependencies: the contract validators plus the spec renderer's pins,
#    the same set .github/workflows/ci.yml installs. They go into the user site
#    for bare `python` (--break-system-packages, because this interpreter is
#    externally managed) and into the repo-local .venv that scripts/ci-local.sh
#    requires. The image has no ensurepip, so the venv's pip comes from get-pip.
python_deps=(jsonschema referencing pyyaml openapi-spec-validator
  -r spec-bundle/render_v0_5.requirements.txt)
python -m pip install --user --break-system-packages "${python_deps[@]}"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv --without-pip .venv
fi
if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  curl -fsS https://bootstrap.pypa.io/get-pip.py | .venv/bin/python -
fi
.venv/bin/python -m pip install "${python_deps[@]}"

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
