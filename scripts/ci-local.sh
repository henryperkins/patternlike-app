#!/usr/bin/env bash
#
# Local stand-in for .github/workflows/ci.yml.
#
# GitHub Actions is unavailable on this account, and `main` is not branch
# protected, so nothing mechanical stops an unverified merge. This script is the
# replacement gate: it runs the same steps ci.yml runs, in the same order, on
# the same Node, and prints a paste-ready result block for the PR.
#
# It is a gate, not a formality. Run it before merging and paste the summary.
#
# Usage:
#   scripts/ci-local.sh              # lockfile checked with `npm ci --dry-run`
#   scripts/ci-local.sh --clean      # full `npm ci`, exactly as Workers Builds does
#   scripts/ci-local.sh --skip-ephe  # skip the ephemeris download (needs network)
#
# Exit code is 0 only when every required step passed.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
REPO="$PWD"

CLEAN_INSTALL=0
SKIP_EPHE=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN_INSTALL=1 ;;
    --skip-ephe) SKIP_EPHE=1 ;;
    -h|--help) sed -n '3,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# Toolchain. ci.yml pins Node from .nvmrc and Workers Builds reads the same
# file, so a local run on a different major does not prove what deploys.
# ---------------------------------------------------------------------------
WANT_NODE="$(tr -d '[:space:]' < .nvmrc)"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use "$WANT_NODE" >/dev/null 2>&1 || true
fi

HAVE_NODE="$(node -v 2>/dev/null)"
HAVE_MAJOR="${HAVE_NODE#v}"; HAVE_MAJOR="${HAVE_MAJOR%%.*}"
if [ "$HAVE_MAJOR" != "$WANT_NODE" ]; then
  red "Node ${HAVE_NODE} does not match .nvmrc (${WANT_NODE})."
  red "ci.yml and Workers Builds both read .nvmrc. Install it first:"
  red "    nvm install ${WANT_NODE}"
  exit 2
fi

# ci.yml's contracts job pip-installs into a clean runner. Locally that needs a
# venv: this host has an externally managed Python with no ensurepip, so
# `python3 -m venv` alone fails and a bare `pip install` is refused by PEP 668.
if [ -x "$REPO/.venv/bin/python" ]; then
  PATH="$REPO/.venv/bin:$PATH"
  export PATH
else
  red "No .venv found. The contracts job cannot run without it."
  red "Bootstrap it (this host has no ensurepip, so pip is fetched directly):"
  red "    python3 -m venv --without-pip .venv"
  red "    curl -sS https://bootstrap.pypa.io/get-pip.py | .venv/bin/python -"
  red "    .venv/bin/python -m pip install pyyaml jsonschema referencing \\"
  red "        openapi-spec-validator -r spec-bundle/render_v0_5.requirements.txt"
  exit 2
fi

HAVE_PY="$(python --version 2>&1)"
CI_PY="3.12"
PY_NOTE=""
case "$HAVE_PY" in
  *"$CI_PY"*) ;;
  *) PY_NOTE="local ${HAVE_PY#Python }, ci.yml pinned ${CI_PY}" ;;
esac

# ---------------------------------------------------------------------------
# Step runner. Runs everything rather than stopping at the first failure, so one
# run tells you the whole story.
# ---------------------------------------------------------------------------
STEP_NAMES=()
STEP_RESULTS=()
FAILED=0

run_step() {
  local name="$1"; shift
  bold ""
  bold "──── ${name}"
  "$@" 2>&1 | sed 's/^/  /'
  local rc=${PIPESTATUS[0]}
  STEP_NAMES+=("$name")
  if [ "$rc" -eq 0 ]; then
    STEP_RESULTS+=("pass"); green "  ✓ ${name}"
  else
    STEP_RESULTS+=("FAIL"); red "  ✗ ${name} (exit ${rc})"; FAILED=1
  fi
}

bold "Local CI — mirrors .github/workflows/ci.yml"
echo "  node    $(node -v)   (.nvmrc ${WANT_NODE})"
echo "  npm     $(npm -v)"
echo "  python  ${HAVE_PY#Python }${PY_NOTE:+   [${PY_NOTE}]}"
echo "  commit  $(git rev-parse --short HEAD)  $(git rev-parse --abbrev-ref HEAD)"

# ---- job: contracts -------------------------------------------------------
run_step "contracts: npm run test:contracts" npm run test:contracts

# ---- job: monorepo --------------------------------------------------------
if [ "$CLEAN_INSTALL" -eq 1 ]; then
  run_step "monorepo: npm ci" npm ci
else
  # Workers Builds runs `npm clean-install`, which fails on a lockfile that
  # disagrees with package.json. This proves that would succeed without paying
  # for a full reinstall.
  run_step "monorepo: npm ci --dry-run (lockfile agrees with package.json)" \
    npm ci --dry-run
fi

if [ "$SKIP_EPHE" -eq 0 ]; then
  run_step "monorepo: ephemeris download" \
    npm run ephe:download -w @patternlike/calc-stub
else
  yellow "  … skipped ephemeris download (--skip-ephe)"
fi

run_step "monorepo: npm run typecheck" npm run typecheck
run_step "monorepo: test @patternlike/shared"          npm run test -w @patternlike/shared
run_step "monorepo: test @patternlike/reading-engine"  npm run test -w @patternlike/reading-engine
run_step "monorepo: test @patternlike/calc-stub"       npm run test -w @patternlike/calc-stub
run_step "monorepo: test @patternlike/ontology-signer" npm run test -w @patternlike/ontology-signer
run_step "monorepo: test @patternlike/api"             npm run test -w @patternlike/api
run_step "monorepo: test @patternlike/web"             npm run test -w @patternlike/web
run_step "monorepo: npm run build" npm run build

# ---- beyond ci.yml --------------------------------------------------------
# ci.yml's monorepo job never listed these, so they shipped with no CI coverage.
# Reported separately so the "same as CI" claim above stays exactly true.
bold ""
bold "══ Beyond ci.yml (workspaces the workflow never listed) ══"
run_step "extra: test @patternlike/pattern-engine" npm run test -w @patternlike/pattern-engine
run_step "extra: test @patternlike/codex-runner"   npm run test -w @patternlike/codex-runner
run_step "extra: npm run test:content"             npm run test:content

# ---- summary --------------------------------------------------------------
bold ""
bold "════════════════════ SUMMARY ════════════════════"
echo "commit  $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"
echo "node    $(node -v)   npm $(npm -v)   python ${HAVE_PY#Python }"
[ -n "$PY_NOTE" ] && yellow "note    ${PY_NOTE}"
echo
for i in "${!STEP_NAMES[@]}"; do
  printf '  %-6s %s\n' "${STEP_RESULTS[$i]}" "${STEP_NAMES[$i]}"
done
echo
if [ "$FAILED" -eq 0 ]; then
  green "ALL STEPS PASSED — safe to merge on local evidence."
else
  red "AT LEAST ONE STEP FAILED — do not merge."
fi
exit "$FAILED"
