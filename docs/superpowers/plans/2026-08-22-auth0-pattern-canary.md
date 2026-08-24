# Auth0 Pattern Canary Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `hello@hperkins.blog` as one authenticated, product-ready Pattern canary without exposing credentials, pre-granting Pattern consent, reserving a claim, or enabling generation.

**Architecture:** The official Auth0 CLI and Universal Login create or reuse the identity and obtain a short-lived ID token. That token is piped into the production Worker's existing session endpoint, and all product preparation uses either the normal same-origin UI or authenticated product APIs; read-only D1 queries verify opaque eligibility facts that are not exposed while rollout is off.

**Tech Stack:** Auth0 CLI 1.33.0, Auth0 Universal Login, curl, jq, Cloudflare Wrangler/D1, the local Vite web client, production Hono Worker

**Spec:** `docs/superpowers/specs/2026-08-22-auth0-react-canary-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-22-auth0-react-sdk.md` first.
- Use tenant `dev-lqmwkyo17nm5mdjz.us.auth0.com`, SPA client `bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ`, and canary email `hello@hperkins.blog` exactly.
- Use the official Auth0 CLI and Universal Login; never use a password grant or hand-written OAuth/OIDC exchange.
- The human enters all Auth0 credentials only in Auth0-hosted pages. Never request or display a password in chat or a shell argument.
- Permit the official CLI's temporary `http://localhost:8484` callback only during `auth0 test login`, then prove the application's callbacks, logout URLs, and web origins are restored.
- Keep every token-bearing file, cookie jar, and native Worker session response in one mode-0700 temporary directory under `/tmp` with `umask 077`.
- Never print an ID/access/refresh/Worker session token, cookie, authorization code, state, birth value, chart fingerprint, generated content, or decrypted artifact.
- Use production origin `https://patternlike-api-production.lfd.workers.dev` for shell API checks.
- Use `http://127.0.0.1:5173/` for the interactive product UI and proxy `/v1` to production; do not make cross-origin browser API calls.
- Do not directly mutate production D1. Read-only eligibility queries are allowed; chart and locale writes must use the normal product UI/API.
- Do not call `POST /v1/pattern-generations`, grant Pattern consent directly, change `PATTERN_INTERNAL_ACCOUNT_IDS`, change `PATTERN_AI_ROLLOUT`, activate an ontology, deploy a Worker, or invoke a provider.
- Stop on duplicate Auth0 identities, callback drift, an unexpected existing Pattern claim/document/generation, a non-active account, or any response that would require printing private data to diagnose.
- On any failure after the temporary directory exists, stop forward progress but
  still execute the applicable restoration and cleanup in Task 6. In
  particular, inspect and restore callbacks after an interrupted
  `auth0 test login`; never abandon the operation with `localhost:8484` or a
  token-bearing file left behind.

## File Map

- `docs/deploy/openai-pattern-rollout.md`: update only with safe facts actually observed.
- `/tmp/patternlike-auth0-canary.*`: owner-only operational files; delete after checks.
- No application source, schema, migration, Worker configuration, or Auth0 secret file is changed by this plan.

---

### Task 1: Install isolated official tooling and authenticate the operator

**Files:**
- Create temporarily: `/tmp/patternlike-auth0-canary.*/install.sh`
- Create temporarily: `/tmp/patternlike-auth0-canary.*/bin/auth0`

**Interfaces:**
- Consumes: Auth0's checksum-verifying official installer and the operator's interactive tenant authorization.
- Produces: an isolated `auth0` binary and an authenticated Management API CLI session for the configured tenant.

- [ ] **Step 1: Confirm the repository and rollout are in the expected safe state**

Run:

```bash
git status --short
rg -n 'PATTERN_AI_ROLLOUT = "off"|PATTERN_INTERNAL_ACCOUNT_IDS = ""' apps/api/wrangler.toml
```

Expected: only planned repository changes and the pre-existing archive are present; the committed production rollout is still `off` and the committed allowlist is empty. This is a static preflight, not proof of deployed configuration.

- [ ] **Step 2: Create an owner-only working directory**

In one persistent terminal session, run:

```bash
umask 077
CANARY_DIR="$(mktemp -d /tmp/patternlike-auth0-canary.XXXXXX)"
chmod 700 "$CANARY_DIR"
mkdir "$CANARY_DIR/bin"
AUTH0="$CANARY_DIR/bin/auth0"
TENANT="dev-lqmwkyo17nm5mdjz.us.auth0.com"
CLIENT_ID="bW9j2G79rWfKg2WDuAZdvi4EsS75ajcZ"
CANARY_EMAIL="hello@hperkins.blog"
PRODUCTION_ORIGIN="https://patternlike-api-production.lfd.workers.dev"
```

Expected: `CANARY_DIR` begins with `/tmp/patternlike-auth0-canary.` and is mode 0700. Keep this terminal open so these variables are never reconstructed from unsafe output.

- [ ] **Step 3: Download and run the pinned official Auth0 CLI installer**

Run:

```bash
curl -sSfL \
  https://raw.githubusercontent.com/auth0/auth0-cli/v1.33.0/install.sh \
  --output "$CANARY_DIR/install.sh"
sh "$CANARY_DIR/install.sh" -b "$CANARY_DIR/bin" v1.33.0
"$AUTH0" --version
```

Expected: the installer verifies the release checksum and the last command reports Auth0 CLI `1.33.0`. Nothing is installed into the repository or a system-wide binary directory.

- [ ] **Step 4: Authenticate to Auth0 through the official interactive flow**

Run:

```bash
"$AUTH0" login
```

Human handoff: authorize the CLI as a user in the Auth0-hosted device flow and select `dev-lqmwkyo17nm5mdjz.us.auth0.com`. Do not paste a device code, password, or token into chat.

Then run:

```bash
"$AUTH0" tenants list --json > "$CANARY_DIR/tenants.json"
jq -e --arg tenant "$TENANT" \
  'map(select(.name == $tenant)) | length == 1' \
  "$CANARY_DIR/tenants.json" >/dev/null
```

Expected: the assertion exits zero. If it does not, stop before reading or changing the SPA application.

---

### Task 2: Reuse or create exactly one canary through Universal Login

**Files:**
- Create temporarily: `app-before.json`, `user-before.json`, `login.json`, `user-after.json`, `app-after.json` under `CANARY_DIR`.

**Interfaces:**
- Consumes: the authenticated Auth0 CLI session from Task 1.
- Produces: exactly one Auth0 identity for the canary email and a protected official-login token response.

- [ ] **Step 1: Snapshot public application URLs before the login test**

Run:

```bash
"$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
  > "$CANARY_DIR/app-before.json"
jq -e \
  '.app_type == "spa"
   and .token_endpoint_auth_method == "none"
   and (.callbacks | index("http://127.0.0.1:5173/")) != null
   and (.allowed_logout_urls | index("http://127.0.0.1:5173/")) != null
   and (.web_origins | index("http://127.0.0.1:5173/")) != null' \
  "$CANARY_DIR/app-before.json" >/dev/null
```

Expected: the assertion exits zero. Do not continue if the supplied Auth0 configuration has drifted.

- [ ] **Step 2: Search by exact email before any creation path**

Run:

```bash
"$AUTH0" users search-by-email "$CANARY_EMAIL" \
  --tenant "$TENANT" --json > "$CANARY_DIR/user-before.json"
CANARY_MATCHES="$(jq 'length' "$CANARY_DIR/user-before.json")"
test "$CANARY_MATCHES" -le 1
```

Expected: zero or one match. If the count is greater than one, stop and report the duplicate identity condition without deleting either account.

- [ ] **Step 3: Complete the official login test with a protected JSON destination**

Run with an explicit interrupted-login repair branch:

```bash
LOGIN_FAILED="0"
if ! "$AUTH0" test login "$CLIENT_ID" \
  --tenant "$TENANT" \
  --scopes openid,email \
  --force \
  --json > "$CANARY_DIR/login.json"; then
  LOGIN_FAILED="1"
  "$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
    > "$CANARY_DIR/app-failed-login.json"
  if ! jq -e --slurpfile before "$CANARY_DIR/app-before.json" \
    '(.callbacks | sort) == ($before[0].callbacks | sort)' \
    "$CANARY_DIR/app-failed-login.json" >/dev/null; then
    ORIGINAL_CALLBACKS="$(jq -r '.callbacks | join(",")' \
      "$CANARY_DIR/app-before.json")"
    "$AUTH0" apps update "$CLIENT_ID" \
      --tenant "$TENANT" --no-input --callbacks "$ORIGINAL_CALLBACKS"
  fi
  "$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
    > "$CANARY_DIR/app-restored-after-failure.json"
  jq -e --slurpfile before "$CANARY_DIR/app-before.json" \
    '(.callbacks | sort) == ($before[0].callbacks | sort)
     and (.allowed_logout_urls | sort) == ($before[0].allowed_logout_urls | sort)
     and (.web_origins | sort) == ($before[0].web_origins | sort)
     and (.callbacks | index("http://localhost:8484")) == null' \
    "$CANARY_DIR/app-restored-after-failure.json" >/dev/null
fi
test "$LOGIN_FAILED" = "0"
```

Human handoff:

- If `CANARY_MATCHES` is `0`, choose **Sign up** in Universal Login and create the account using `hello@hperkins.blog`.
- If `CANARY_MATCHES` is `1`, sign in to that existing identity.
- Enter the password and any verification code only on Auth0-hosted pages.
- The browser must run on the same machine/loopback namespace as the CLI listener on `localhost:8484`. If that is impossible, stop; do not substitute a password grant.

Expected: the command exits zero and no token JSON reaches terminal output.

- [ ] **Step 4: Validate identity and token presence without printing either**

On normal completion, run:

```bash
jq -e --arg email "$CANARY_EMAIL" \
  '.user_info.email == $email
   and (.tokens.id_token | type == "string" and length > 100)
   and (.tokens.refresh_token == null or .tokens.refresh_token == "")' \
  "$CANARY_DIR/login.json" >/dev/null

"$AUTH0" users search-by-email "$CANARY_EMAIL" \
  --tenant "$TENANT" --json > "$CANARY_DIR/user-after.json"
test "$(jq 'length' "$CANARY_DIR/user-after.json")" -eq 1
```

Expected: both assertions exit zero. Do not inspect the token payload in terminal output.

- [ ] **Step 5: Prove the CLI restored every application URL list**

Run:

```bash
"$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
  > "$CANARY_DIR/app-after.json"
jq -e --slurpfile before "$CANARY_DIR/app-before.json" \
  '(.callbacks | sort) == ($before[0].callbacks | sort)
   and (.allowed_logout_urls | sort) == ($before[0].allowed_logout_urls | sort)
   and (.web_origins | sort) == ($before[0].web_origins | sort)
   and (.callbacks | index("http://localhost:8484")) == null' \
  "$CANARY_DIR/app-after.json" >/dev/null
```

Expected: the assertion exits zero.

If it fails, restore only the callback list from the protected before-snapshot:

```bash
ORIGINAL_CALLBACKS="$(jq -r '.callbacks | join(",")' "$CANARY_DIR/app-before.json")"
"$AUTH0" apps update "$CLIENT_ID" \
  --tenant "$TENANT" --no-input --callbacks "$ORIGINAL_CALLBACKS"
"$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
  > "$CANARY_DIR/app-restored.json"
jq -e --slurpfile before "$CANARY_DIR/app-before.json" \
  '(.callbacks | sort) == ($before[0].callbacks | sort)
   and (.allowed_logout_urls | sort) == ($before[0].allowed_logout_urls | sort)
   and (.web_origins | sort) == ($before[0].web_origins | sort)
   and (.callbacks | index("http://localhost:8484")) == null' \
  "$CANARY_DIR/app-restored.json" >/dev/null
```

Expected: restoration exits zero. If it does not, stop all product calls and report the tenant-configuration incident.

---

### Task 3: Exchange the ID token for a production Worker session

**Files:**
- Create temporarily: `worker-session.json` and `worker-cookies.txt` under `CANARY_DIR`.

**Interfaces:**
- Consumes: `.tokens.id_token` from the protected official CLI response.
- Produces: an HTTP-only `pl_session` cookie captured by curl without printing its value.

- [ ] **Step 1: Pipe the ID token into the existing session endpoint**

Run with `pipefail` enabled:

```bash
set -o pipefail
SESSION_STATUS="$(
  jq -c '{id_token: .tokens.id_token}' "$CANARY_DIR/login.json" |
    curl --silent --show-error \
      --cookie-jar "$CANARY_DIR/worker-cookies.txt" \
      --output "$CANARY_DIR/worker-session.json" \
      --write-out '%{http_code}' \
      --header 'content-type: application/json' \
      --data-binary @- \
      "$PRODUCTION_ORIGIN/v1/sessions"
)"
test "$SESSION_STATUS" = "201"
```

Expected: HTTP 201. The token is standard input to curl, never a command argument or terminal value.

- [ ] **Step 2: Validate the cookie jar without revealing the cookie**

Run:

```bash
test "$(awk '$6 == "pl_session" { count++ } END { print count + 0 }' \
  "$CANARY_DIR/worker-cookies.txt")" -eq 1
test "$(jq -r '(.token | type == "string") and (.expires_at | type == "string")' \
  "$CANARY_DIR/worker-session.json")" = "true"
```

Expected: both assertions exit zero.

- [ ] **Step 3: Remove the native session response as soon as the cookie is confirmed**

Run:

```bash
unlink "$CANARY_DIR/worker-session.json"
```

Expected: the response body containing the native bearer no longer exists. Keep `login.json` and the cookie jar only until all authenticated checks finish.

---

### Task 4: Inspect and complete product onboarding through the normal UI

**Files:**
- Create temporarily: protected API response files under `CANARY_DIR`.
- No repository files change.

**Interfaces:**
- Consumes: the production curl cookie plus the completed local Auth0 React integration.
- Produces: an active synthetic chart, confirmed `en-US` locale, and the opaque product user ID, or a precise stop condition.

- [ ] **Step 1: Probe chart and Pattern endpoints without printing response bodies**

Run:

```bash
CHART_STATUS="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/chart-before.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/chart")"

STATE_STATUS="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-state-before.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/pattern-state")"

CONSENT_STATUS="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-consent-before.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/consents/pattern-generation")"

test "$CHART_STATUS" = "200" || test "$CHART_STATUS" = "404"
test "$STATE_STATUS" = "200"
test "$CONSENT_STATUS" = "200"
jq -e '.status == "not_granted"' \
  "$CANARY_DIR/pattern-consent-before.json" >/dev/null
INITIAL_CHART_STATUS="$CHART_STATUS"
NEEDS_UI="0"

if test "$INITIAL_CHART_STATUS" = "404"; then
  NEEDS_UI="1"
else
  jq -e \
    '.status == "active"
     and (.user_id | type == "string" and test("^usr_[A-Za-z0-9_-]+$"))' \
    "$CANARY_DIR/chart-before.json" >/dev/null
  CANARY_USER_ID="$(jq -r '.user_id' "$CANARY_DIR/chart-before.json")"
  CANARY_PRECHECK_SQL="SELECT
    u.status AS account_status,
    u.locale AS locale,
    u.locale_source AS locale_source,
    (SELECT COUNT(*) FROM pattern_generation_claims pc
      WHERE pc.user_id = u.id) AS pattern_claim_count
  FROM users u WHERE u.id = '$CANARY_USER_ID'"
  npx wrangler d1 execute patternlike-ops \
    --config apps/api/wrangler.toml \
    --env production \
    --remote \
    --json \
    --command "$CANARY_PRECHECK_SQL" \
    > "$CANARY_DIR/canary-precheck.json"
  jq -e \
    '.[0].results | length == 1
     and .[0].account_status == "active"
     and .[0].pattern_claim_count == 0' \
    "$CANARY_DIR/canary-precheck.json" >/dev/null
  if ! jq -e \
    '.[0].results[0].locale == "en-US"
     and .[0].results[0].locale_source == "user_confirmed"' \
    "$CANARY_DIR/canary-precheck.json" >/dev/null; then
    NEEDS_UI="1"
  fi
fi
```

Expected: the session is authenticated, Pattern consent is not granted, and chart status is either ready (200) or unfinished onboarding (404). Do not print any response body.

- [ ] **Step 2: If onboarding is incomplete, start the exact-origin UI against production**

If `NEEDS_UI` is `1`, start this in a second terminal from the repository root,
leaving the protected canary terminal and its variables intact:

```bash
VITE_API_PROXY_TARGET="$PRODUCTION_ORIGIN" npm run web:dev
```

Expected: Vite starts at `http://127.0.0.1:5173/` and refuses to select another port.

Human handoff:

1. Open `http://127.0.0.1:5173/`.
2. Click the existing **Sign in** button and authenticate as `hello@hperkins.blog` through Universal Login.
3. If `INITIAL_CHART_STATUS` is `404`, complete onboarding with explicitly synthetic data: date `2000-01-01`, exact local time `12:00`, label `Greenwich synthetic canary`, latitude `51.4779`, longitude `-0.0015`, and the UI-derived `Europe/London` timezone.
4. For new onboarding, accept only the account/chart processing confirmation required by the form. Preserve any existing chart when `INITIAL_CHART_STATUS` is `200`.
5. Navigate to **Today**. If the first gate is **Scheduling time zone**,
   enter `UTC` and click **Confirm time zone** so the sequential preference
   flow can reach its language gate.
6. Enter `en-US` in **Content language** and click **Confirm language**.
7. Do not confirm Pattern generation and do not click a Pattern-generation action.
8. Tell the executor that onboarding and language confirmation are complete.

If `NEEDS_UI` is `0`, skip the browser handoff entirely: the existing active chart and confirmed locale are already valid and remain untouched.

- [ ] **Step 3: Re-read the chart safely and capture only opaque identifiers**

After the human handoff, run:

```bash
CHART_STATUS="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/chart-after.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/chart")"
test "$CHART_STATUS" = "200"
jq -e \
  '.status == "active"
   and (.id | type == "string" and startswith("cht_"))
   and (.user_id | type == "string" and startswith("usr_"))' \
  "$CANARY_DIR/chart-after.json" >/dev/null
CANARY_USER_ID="$(jq -r '.user_id' "$CANARY_DIR/chart-after.json")"
if [[ ! "$CANARY_USER_ID" =~ ^usr_[A-Za-z0-9_-]+$ ]]; then
  exit 1
fi
```

Expected: an active chart and validated opaque user ID. Never output `.birth` or `.fingerprint`.

- [ ] **Step 4: Use one read-only D1 query to verify eligibility facts hidden while rollout is off**

Run:

```bash
CANARY_SQL="SELECT
  u.id AS user_id,
  u.status AS account_status,
  u.locale AS locale,
  u.locale_source AS locale_source,
  (SELECT COUNT(*) FROM chart_snapshots c
    WHERE c.user_id = u.id AND c.status = 'active') AS active_chart_count,
  (SELECT COUNT(*) FROM pattern_generation_claims pc
    WHERE pc.user_id = u.id) AS pattern_claim_count,
  (SELECT COUNT(*) FROM pattern_generation_jobs pj
    WHERE pj.user_id = u.id) AS pattern_generation_count,
  (SELECT COUNT(*) FROM pattern_documents pd
    WHERE pd.user_id = u.id) AS pattern_document_count,
  (SELECT COUNT(*) FROM consents co
    WHERE co.user_id = u.id AND co.kind = 'pattern_generation'
      AND co.status = 'granted') AS pattern_grant_count
FROM users u WHERE u.id = '$CANARY_USER_ID'"

npx wrangler d1 execute patternlike-ops \
  --config apps/api/wrangler.toml \
  --env production \
  --remote \
  --json \
  --command "$CANARY_SQL" > "$CANARY_DIR/canary-eligibility.json"

jq -e \
  '.[0].results | length == 1
   and .[0].account_status == "active"
   and .[0].locale == "en-US"
   and .[0].locale_source == "user_confirmed"
   and .[0].active_chart_count == 1
   and .[0].pattern_claim_count == 0
   and .[0].pattern_generation_count == 0
   and .[0].pattern_document_count == 0
   and .[0].pattern_grant_count == 0' \
  "$CANARY_DIR/canary-eligibility.json" >/dev/null
```

Expected: the assertion exits zero. This query reads only opaque IDs, coarse status, locale, and counts; it does not select birth data, fingerprints, prompts, prose, tokens, or encrypted columns.

- [ ] **Step 5: Recheck public Pattern state without reserving anything**

Run:

```bash
curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-state-after.json" \
  "$PRODUCTION_ORIGIN/v1/pattern-state"
curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-consent-after.json" \
  "$PRODUCTION_ORIGIN/v1/consents/pattern-generation"

jq -e \
  '.consent.status == "not_granted"
   and .generation == null
   and .pattern == null' \
  "$CANARY_DIR/pattern-state-after.json" >/dev/null
jq -e '.status == "not_granted"' \
  "$CANARY_DIR/pattern-consent-after.json" >/dev/null
```

Expected: no grant, generation, or generated Pattern exists. Under rollout `off`, `state` may remain `editorial_catalog`; the read-only D1 assertion is the authoritative unused-claim check.

---

### Task 5: Capture safe gate evidence without overstating completion

**Files:**
- Modify conditionally: `docs/deploy/openai-pattern-rollout.md`

**Interfaces:**
- Consumes: safe HTTP statuses, opaque IDs, URL restoration proof, and eligibility counts from Tasks 2–4.
- Produces: a truthful rollout-ledger update that leaves unrelated gates open.

- [ ] **Step 1: Capture an authenticated Pattern-read baseline**

Run twice, keeping bodies protected:

```bash
PATTERN_STATUS_ONE="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-read-one.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/pattern")"
PATTERN_STATUS_TWO="$(curl --silent --show-error \
  --cookie "$CANARY_DIR/worker-cookies.txt" \
  --output "$CANARY_DIR/pattern-read-two.json" \
  --write-out '%{http_code}' \
  "$PRODUCTION_ORIGIN/v1/pattern")"
test "$PATTERN_STATUS_ONE" = "$PATTERN_STATUS_TWO"
```

Expected: stable authenticated behavior. Record only the status and, when the body is an error envelope, its request ID and error code. Do not record or hash a successful content body.

This is a reusable authenticated baseline. It does **not** by itself close Gate 3's before/after-deployment requirement; closing that gate still requires a separately authorized deployment with one read on each side.

- [ ] **Step 2: Update the rollout runbook only with observed safe facts**

In `docs/deploy/openai-pattern-rollout.md`:

- update Gate 3 to say a reusable authenticated canary and baseline now exist, while leaving the gate open until an actual before/after deployment pair is recorded;
- update Gate 8 to record the opaque `CANARY_USER_ID` as the candidate, one active chart, confirmed `en-US`, zero Pattern claims/generations/documents/grants, and no reservation;
- keep Gate 8 blocked on the active ontology, rollout/allowlist deployment, first-use confirmation, and every other prerequisite already listed;
- append one evidence-ledger row with the Auth0 callback-restoration result, Worker-session acceptance, safe endpoint statuses, and eligibility counts; and
- do not include the email password, any token/cookie, Auth0 subject, birth data, chart fingerprint, response content, or temporary file path.

- [ ] **Step 3: Review and commit only truthful evidence**

Run:

```bash
git diff --check
git diff -- docs/deploy/openai-pattern-rollout.md
git status --short
```

Expected: the runbook claims only observed canary preparation, not an enabled generator or completed Gate 7/8/9/10.

Commit:

```bash
git add docs/deploy/openai-pattern-rollout.md
git commit -m "docs: record Pattern canary preflight"
```

Do not add any file from `CANARY_DIR` or `pattern-ontology-corpus.zip`.

---

### Task 6: Revoke sessions and destroy temporary credential material

**Files:**
- Delete: the exact `CANARY_DIR` created in Task 1.
- No repository file changes.

**Interfaces:**
- Consumes: the temporary Worker cookie jar and Auth0 CLI session.
- Produces: a revoked Worker session, no retained token/cookie files, and a persistent canary identity ready for a separately authorized Gate 8 operation.

- [ ] **Step 1: Revoke the Worker session before deleting the cookie jar**

Run:

```bash
if test -f "$CANARY_DIR/worker-cookies.txt"; then
  LOGOUT_STATUS="$(curl --silent --show-error \
    --cookie "$CANARY_DIR/worker-cookies.txt" \
    --output /dev/null \
    --write-out '%{http_code}' \
    --request DELETE \
    "$PRODUCTION_ORIGIN/v1/sessions/current")"
  test "$LOGOUT_STATUS" = "204"
fi
```

Expected: when a cookie jar existed, HTTP 204. On an earlier failure with no
Worker session, there is nothing to revoke and the conditional does nothing.

- [ ] **Step 2: Perform one final callback-restoration check, then log the CLI out**

If `app-before.json` exists and the CLI is still authenticated, run the URL
comparison before logout. On an early failure before that snapshot, skip only
the comparison and still log the CLI out:

```bash
if test -f "$CANARY_DIR/app-before.json"; then
  "$AUTH0" apps show "$CLIENT_ID" --tenant "$TENANT" --json \
    > "$CANARY_DIR/app-final.json"
  jq -e --slurpfile before "$CANARY_DIR/app-before.json" \
    '(.callbacks | sort) == ($before[0].callbacks | sort)
     and (.allowed_logout_urls | sort) == ($before[0].allowed_logout_urls | sort)
     and (.web_origins | sort) == ($before[0].web_origins | sort)
     and (.callbacks | index("http://localhost:8484")) == null' \
    "$CANARY_DIR/app-final.json" >/dev/null
fi
"$AUTH0" logout
```

Expected: URL configuration matches the before-snapshot and the temporary Management API CLI session is removed.

- [ ] **Step 3: Validate and remove only the temporary directory**

Run:

```bash
case "$CANARY_DIR" in
  /tmp/patternlike-auth0-canary.*) ;;
  *) exit 1 ;;
esac
rm -rf -- "$CANARY_DIR"
test ! -e "$CANARY_DIR"
```

Expected: only the exact owner-only temporary directory is deleted. The Auth0 canary identity and product account/chart remain; tokens, cookie jars, API bodies, and the isolated CLI binary do not.

- [ ] **Step 4: Report the remaining blockers**

Report:

- whether the Auth0 identity was reused or created;
- the opaque product canary ID and coarse eligibility status;
- callback restoration and Worker-session acceptance;
- the runbook commit ID, if evidence was committed;
- that Pattern consent remains ungranted and no claim was consumed or reserved; and
- every remaining rollout blocker, especially the eligible active ontology, allowlist/rollout deployment, Gate 8 first-use confirmation, and later Gate 9 certification.

Do not claim that Pattern generation is on. It remains off at the end of this plan.
