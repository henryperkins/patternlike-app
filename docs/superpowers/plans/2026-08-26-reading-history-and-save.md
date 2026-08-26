# Reading History and Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let readers revisit past daily chapters and explicitly save or unsave a specific reading revision without changing the existing Today, evidence, feedback, or generation semantics.

**Architecture:** Add an owner-scoped reading-by-id projection and a cursor-paginated library with two views: canonical history (one best artifact per local date) and Saved (every explicitly saved revision). A small `reading_saves` relation stores portable user intent. The web extracts the existing reading renderer into a reusable article, adds History navigation, and uses one idempotent HTTP resource for Save state.

**Tech Stack:** TypeScript strict ESM, Hono, Cloudflare Workers, D1/SQLite window functions, user-DEK decryption, React 19, Vite, Vitest/Testing Library/workerd, JSON Schema/OpenAPI

## Global Constraints

- Daily reading prose remains in `daily_readings.reading_enc`; Save never copies or rewrites it.
- Save is keyed by `(user_id, reading_id)` and therefore names one immutable revision.
- `PUT /v1/readings/{reading_id}/save` and DELETE are idempotent by HTTP resource semantics; do not add `jobs` rows or require `Idempotency-Key`.
- General History returns one canonical artifact per `local_date`: published first, otherwise highest-revision invalidated, otherwise highest-revision superseded.
- Saved view returns every saved revision, including superseded/invalidated revisions hidden by canonical collapse.
- Pending/failed/no-ciphertext rows are never readable, listable, or saveable.
- Reading-by-id, evidence, feedback, and Save require both owned ciphertext and
  `status IN ('published','superseded','invalidated')`; ciphertext alone is not
  proof of publication/readability.
- A foreign id and an unknown id remain the same 404 where a response is required; idempotent DELETE returns 204 for either.
- Keep the v5 active-chart gate only on Today. Historical artifacts remain readable after chart correction.
- Load the user DEK once per request and keep ownership in SQL predicates.
- Saved metadata is portable. Account export emits `saved_at` on the corresponding reading item.
- No new encrypted column is introduced by this workstream.
- Cursor mode/filter is bound into the cursor; a cursor from History cannot be replayed against Saved.
- Preserve existing M3/M5 reading artifacts and schemas. M8 defines only the new library/save envelopes and an M8 account-export successor.

## File Map

- `apps/api/src/services/reading-product-projection.ts`: shared v3/v5 product projection.
- `apps/api/src/db/readings.ts`: readable-by-id and paginated library queries.
- `apps/api/src/db/reading-saves.ts`: idempotent Save resource.
- `apps/api/src/routes/readings.ts`: new list/detail/save handlers.
- `apps/web/src/components/ReadingArticle.tsx`: shared Today/history rendering.
- `apps/web/src/components/HistoryView.tsx`: history/saved lists and detail.
- `apps/web/src/components/ReadingSaveButton.tsx`: accessible Save state.
- `db/d1/0019_reading_saves.sql`: portable revision-specific state.

---

### Task 1: Extend M8 contracts for history, Save, and portable export

**Files:**
- Create: `contracts/m8/reading-history.schema.json`
- Create: `contracts/m8/reading-save-state.schema.json`
- Create: `contracts/m8/account-export.schema.json`
- Create: `contracts/m8/fixtures/valid/reading-history.page.json`
- Create: `contracts/m8/fixtures/valid/reading-history.saved-revision.json`
- Create: `contracts/m8/fixtures/valid/reading-save-state.saved.json`
- Create: `contracts/m8/fixtures/valid/account-export.saved-reading.json`
- Create: `contracts/m8/fixtures/invalid/reading-history.cursor-mode-mismatch.json`
- Create: `contracts/m8/fixtures/invalid/reading-save-state.extra-property.json`
- Modify: `contracts/m8/openapi/openapi.yaml`
- Modify: `contracts/m8/SCHEMA_MANIFEST.json`
- Modify: `contracts/validate_schemas.py`
- Create: `packages/shared/src/m8-reading-history-types.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `ReadingHistoryView`, `ReadingHistoryItem`, `ReadingHistoryResponse`, `ReadingSaveState`.
- Consumed by: API and web tasks.

- [ ] **Step 1: Write failing M8 schema and OpenAPI checks**

Freeze:

```ts
export type ReadingHistoryView = "history" | "saved";

export interface ReadingHistoryItem {
  reading_id: string;
  local_date: string;
  revision: number;
  revision_reason:
    | "initial"
    | "chart_recalculated"
    | "consent_revoked"
    | "safety_correction"
    | "defect_repair";
  status: "published" | "superseded" | "invalidated";
  assembly_mode: "deterministic" | "constrained_model";
  headline: string | null;
  saved: boolean;
  saved_at: string | null;
  evidence_url: string;
}

export interface ReadingHistoryResponse {
  schema_version: "0.8.0";
  view: ReadingHistoryView;
  items: ReadingHistoryItem[];
  next_cursor: string | null;
}

export interface ReadingSaveState {
  schema_version: "0.8.0";
  reading_id: string;
  saved: boolean;
  saved_at: string | null;
}
```

M8 OpenAPI adds:

```text
GET    /v1/readings?view=history|saved&limit=1..50&cursor=...
GET    /v1/readings/{reading_id}
GET    /v1/readings/{reading_id}/save
PUT    /v1/readings/{reading_id}/save
DELETE /v1/readings/{reading_id}/save
```

`GET /v1/readings/{reading_id}` is a `oneOf` reference to the frozen M3 and M5 Today success envelopes.

- [ ] **Step 2: Run contracts and verify RED**

```bash
npm run test:contracts
```

Expected: missing reading schemas/routes/fixtures.

- [ ] **Step 3: Add the M8 account-export successor**

Copy the M7 section model, set `schema_version` to 0.8.0, and define reading items with their existing metadata/artifact/evidence plus:

```json
"saved_at": {
  "type": ["string", "null"],
  "format": "date-time"
}
```

Record M7 account export as the predecessor/superseded family. Stored M7 exports remain valid under M7.

- [ ] **Step 4: Add schemas, fixtures, types, and validation**

Objects are closed, ids/dates reference existing common definitions, list max is 50, and cursor max length is bounded. The invalid fixtures prove unknown fields, pending status, and `saved: false` with non-null `saved_at` are rejected.

- [ ] **Step 5: Verify and commit**

```bash
npm run test:contracts
npm test -w @patternlike/shared
npm run typecheck -w @patternlike/shared
```

```bash
git add contracts/m8 contracts/validate_schemas.py packages/shared/src/m8-place-types.ts packages/shared/src/m8-reading-history-types.ts packages/shared/src/index.ts
git commit -m "contracts: add M8 core-loop amendments"
```

---

### Task 2: Add owner-scoped reading detail and shared projection

**Files:**
- Create: `apps/api/src/services/reading-product-projection.ts`
- Create: `apps/api/src/services/reading-product-projection.test.ts`
- Modify: `apps/api/src/db/readings.ts`
- Modify: `apps/api/src/db/feedback.ts`
- Modify: `apps/api/src/routes/readings.ts`
- Modify: `apps/api/src/routes/readings.integration.test.ts`

**Interfaces:**
- Produces: `loadReadableReadingById`, `projectReadingResponse`.
- Consumed by: Today and History.

- [ ] **Step 1: Write failing detail/projection tests**

Prove:

- Owned published v3/v5 returns the same envelope shape as Today.
- Owned superseded and invalidated rows with ciphertext return 200.
- Pending, failed, missing ciphertext, foreign id, and unknown id return 404
  even if a corrupted pending/failed row carries ciphertext.
- Feedback GET/POST return not-found for a pending/failed row carrying
  ciphertext, even when a feedback row already exists.
- v5 historical detail remains readable after its chart becomes inactive.
- Stored-artifact guards still fail closed on malformed decrypted content.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-product-projection.test.ts src/routes/readings.integration.test.ts
```

Expected: route/loader missing.

- [ ] **Step 3: Add the readable-by-id loader**

Expose:

```ts
export async function loadReadableReadingById(
  env: Env,
  identity: UserIdentity,
  readingId: string,
): Promise<PublishedReading | null>;
```

Use:

```sql
WHERE id = ? AND user_id = ?
  AND reading_enc IS NOT NULL
  AND status IN ('published','superseded','invalidated')
```

Reuse the same explicit predicate in `loadReadingEvidence`,
`ownedReadableReading` and `loadLatestFeedback` in `db/feedback.ts`, and Save
guards. Feedback GET joins the owned reading and applies the same ciphertext
plus status predicate; POST’s transactional assertion does likewise. Do not use
Today’s active-chart `EXISTS`.

- [ ] **Step 4: Extract product projection**

Move the field-by-field v3/v5 reading envelope projection from `routes/readings.ts` into `services/reading-product-projection.ts`. Today and detail call the same function, preserving the M5 assertion.

- [ ] **Step 5: Register route in safe order**

Keep `/v1/readings/today` before dynamic routes. Add `GET /v1/readings/:id` before `/:id/evidence`, `/:id/feedback`, and `/:id/save`. Return the existing opaque `reading_not_found` envelope.

- [ ] **Step 6: Verify and commit**

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-product-projection.test.ts src/routes/readings.integration.test.ts
npm run typecheck -w @patternlike/api
```

```bash
git add apps/api/src/services/reading-product-projection.ts apps/api/src/services/reading-product-projection.test.ts apps/api/src/db/readings.ts apps/api/src/db/feedback.ts apps/api/src/routes/readings.ts apps/api/src/routes/readings.integration.test.ts
git commit -m "api: read historical reading artifacts"
```

---

### Task 3: Add canonical and Saved cursor pagination

**Files:**
- Create: `apps/api/src/services/reading-history-cursor.ts`
- Create: `apps/api/src/services/reading-history-cursor.test.ts`
- Modify: `apps/api/src/db/readings.ts`
- Modify: `apps/api/src/routes/readings.ts`
- Modify: `apps/api/src/routes/readings.integration.test.ts`

**Interfaces:**
- Produces: `encodeReadingHistoryCursor`, `parseReadingHistoryCursor`, `listReadingHistory`.

- [ ] **Step 1: Write failing cursor and history tests**

Cover:

- Empty list.
- One canonical item per day across multiple revisions.
- Priority `published > invalidated > superseded`, then highest revision.
- Saved view returns two saved revisions from one date.
- Stable `limit=1` drainage without duplicate/gap.
- Cursor from one view rejected in the other.
- Malformed/non-canonical/oversized cursor returns `400 invalid_reading_query`.
- Foreign user data never appears.
- V5 headline appears; V3 headline is null.

- [ ] **Step 2: Define the cursor union**

```ts
type ReadingHistoryCursor =
  | {
      v: 1;
      view: "history";
      local_date: string;
      reading_id: string;
    }
  | {
      v: 1;
      view: "saved";
      saved_at: string;
      reading_id: string;
    };
```

Encode canonical JSON as base64url. Parse exact keys/types, re-encode, and require byte equality to reject alternate encodings.

- [ ] **Step 3: Implement canonical History query**

Use a window CTE:

```sql
WITH readable AS (
  SELECT r.*,
    ROW_NUMBER() OVER (
      PARTITION BY r.local_date
      ORDER BY
        CASE r.status
          WHEN 'published' THEN 0
          WHEN 'invalidated' THEN 1
          WHEN 'superseded' THEN 2
          ELSE 3
        END,
        r.revision DESC,
        r.id DESC
    ) AS canonical_rank
  FROM daily_readings r
  WHERE r.user_id = ?
    AND r.reading_enc IS NOT NULL
    AND r.status IN ('published', 'invalidated', 'superseded')
)
SELECT ...
FROM readable r
LEFT JOIN reading_saves s
  ON s.user_id = r.user_id AND s.reading_id = r.id
WHERE r.canonical_rank = 1
  AND (
    ? IS NULL
    OR r.local_date < ?
    OR (r.local_date = ? AND r.id < ?)
  )
ORDER BY r.local_date DESC, r.id DESC
LIMIT ?
```

Develop and test this query with migration 0019 present locally, but do not merge
the History runtime commit yet. Execute Task 4’s schema-only commit, apply 0019
to production, and only then merge the combined History/Save runtime commit
shown in Task 4 Step 6.

- [ ] **Step 4: Implement Saved query after 0019**

Join from `reading_saves` to owned readable rows; do not collapse by date:

```sql
ORDER BY s.saved_at DESC, r.id DESC
```

Bind the saved cursor to both values.

- [ ] **Step 5: Decrypt headlines with one DEK load**

Fetch at most `limit + 1` rows. Use the extra row only to detect continuation;
remove it before decryption. Load the user key once, decode each returned row
with the existing closed stored-reading guard, and project `headline` only for
v5. Do not return paragraph previews.

- [ ] **Step 6: Add list route**

Default `view=history`, `limit=20`; max 50. When an extra row exists, encode
the cursor from the last returned row, not the extra row, so the strict `<`
predicate includes the extra row at the start of the next page.

- [ ] **Step 7: Run focused verification**

```bash
npm exec -w @patternlike/api -- vitest run src/services/reading-history-cursor.test.ts src/routes/readings.integration.test.ts
npm run typecheck -w @patternlike/api
```

Do not merge the runtime commit before Task 4’s migration is applied.

---

### Task 4: Add portable revision-specific Save state

**Files:**
- Create: `db/d1/0019_reading_saves.sql`
- Modify: `db/d1/MIGRATIONS.json`
- Modify: `apps/api/test/apply-migrations.ts`
- Modify: `contracts/smoke_check.py`
- Create: `apps/api/src/db/reading-saves.ts`
- Create: `apps/api/src/db/reading-saves.test.ts`
- Modify: `apps/api/test/helpers.ts`
- Modify: `apps/api/src/services/deletion-manifest.ts`
- Modify: `apps/api/src/services/deletion-manifest.test.ts`
- Modify: `apps/api/src/services/account-export.ts`
- Modify: `apps/api/src/services/privacy-jobs.ts`
- Modify: `apps/api/src/routes/privacy-export.integration.test.ts`
- Modify: `apps/api/src/db/privacy-jobs.ts`
- Modify: `apps/api/src/routes/readings.ts`
- Modify: `apps/api/src/routes/readings.integration.test.ts`

**Interfaces:**
- Produces: `getReadingSaveState`, `saveReading`, `unsaveReading`.
- Completes: Task 3 Saved query.

- [ ] **Step 1: Write failing migration, Save, export, and lifecycle tests**

Prove:

- PUT saves a readable published/superseded/invalidated revision.
- Repeated PUT preserves original `saved_at`.
- GET returns exact state.
- DELETE twice returns 204 twice.
- Foreign/unknown PUT and GET return the same 404.
- Foreign/unknown DELETE returns 204 without existence disclosure.
- Save cannot target pending/failed/no-ciphertext.
- Account deletion removes saves.
- Account export places `saved_at` on the matching revision and validates as M8.
- An export command reserved before M8 still emits byte-compatible M7 on retry;
  a new command pins M8 and emits Save metadata.

- [ ] **Step 2: Add migration 0019**

```sql
CREATE TABLE reading_saves (
  user_id TEXT NOT NULL REFERENCES users(id),
  reading_id TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (user_id, reading_id),
  FOREIGN KEY (reading_id, user_id)
    REFERENCES daily_readings(id, user_id)
);

CREATE INDEX idx_reading_saves_user_saved
  ON reading_saves(user_id, saved_at DESC, reading_id DESC);
```

No id column and no encryption are needed: the composite resource identity and timestamp are the entire state.
Extend `contracts/smoke_check.py` with the composite primary/foreign keys and
the saved-order index.

- [ ] **Step 3: Implement idempotent Save operations**

Expose:

```ts
export async function getReadingSaveState(
  env: Env,
  userId: string,
  readingId: string,
): Promise<ReadingSaveState | null>;

export async function saveReading(
  env: Env,
  userId: string,
  readingId: string,
  now?: Date,
): Promise<ReadingSaveState | null>;

export async function unsaveReading(
  env: Env,
  userId: string,
  readingId: string,
): Promise<void>;
```

PUT uses one D1 batch:

1. Arm `assertion_probe` unless an owned row with non-null `reading_enc` and
   readable status (`published|superseded|invalidated`) exists.
2. `INSERT OR IGNORE` the save.
3. Read state after the batch.

DELETE is `DELETE ... WHERE user_id = ? AND reading_id = ?` and always succeeds.

- [ ] **Step 4: Classify Save as portable**

Add `reading_saves` to `DELETED_USER_TABLES` and `PORTABLE_USER_TABLES`, not `NON_PORTABLE_USER_TABLES`. Extend account export’s reading query with an owner-scoped left join and emit `saved_at`. Change new export documents to `schema_version: "0.8.0"` and validate against M8.

Extend the encrypted export command with
`export_schema_version: "0.8.0"`. Its decoder treats the absent field on stored
pre-M8 commands as `"0.7.0"`. Thread the frozen value into
`assembleAccountExport` from `services/privacy-jobs.ts`: M7 omits `saved_at`;
M8 includes it. This keeps a create-only export retry from changing bytes
merely because the Worker was upgraded.

- [ ] **Step 5: Add routes**

```text
GET    /v1/readings/:id/save  -> 200 state or 404 reading_not_found
PUT    /v1/readings/:id/save  -> 200 state or 404 reading_not_found
DELETE /v1/readings/:id/save  -> 204
```

No request body and no Idempotency-Key. Reject a non-empty PUT body if the framework exposes one.

- [ ] **Step 6: Verify and commit schema first**

```bash
npm exec -w @patternlike/api -- vitest run src/db/reading-saves.test.ts src/routes/privacy-export.integration.test.ts src/services/deletion-manifest.test.ts src/routes/readings.integration.test.ts
npm run test:contracts
```

Schema-only commit:

```bash
git add db/d1/0019_reading_saves.sql db/d1/MIGRATIONS.json apps/api/test/apply-migrations.ts contracts/smoke_check.py
git commit -m "db: add reading save state"
```

After 0019 is applied, runtime commit:

```bash
git add apps/api/src/db/reading-saves.ts apps/api/src/db/reading-saves.test.ts apps/api/test/helpers.ts apps/api/src/services/deletion-manifest.ts apps/api/src/services/deletion-manifest.test.ts apps/api/src/services/account-export.ts apps/api/src/services/privacy-jobs.ts apps/api/src/db/privacy-jobs.ts apps/api/src/routes/privacy-export.integration.test.ts apps/api/src/db/readings.ts apps/api/src/services/reading-history-cursor.ts apps/api/src/services/reading-history-cursor.test.ts apps/api/src/routes/readings.ts apps/api/src/routes/readings.integration.test.ts
git commit -m "api: serve reading history and save state"
```

---

### Task 5: Extract a reusable reading article and Save control

**Files:**
- Create: `apps/web/src/components/ReadingArticle.tsx`
- Create: `apps/web/src/components/ReadingArticle.test.tsx`
- Create: `apps/web/src/components/ReadingSaveButton.tsx`
- Create: `apps/web/src/components/ReadingSaveButton.test.tsx`
- Modify: `apps/web/src/components/TodayView.tsx`
- Modify: `apps/web/src/components/TodayView.test.tsx`
- Modify: `apps/web/src/lib/api-client.ts`

**Interfaces:**
- Produces: `ReadingArticle`, `ReadingSaveButton`.
- Consumed by: Today and History.

- [ ] **Step 1: Write failing extraction and Save tests**

Prove v3/v5 paragraphs, fallback/disclosure, revision chip, evidence, feedback, and Today check-in remain unchanged after extraction. Save tests cover initial GET, PUT, DELETE, reload persistence, busy state, `aria-pressed`, unauthorized, and recoverable failure.

- [ ] **Step 2: Add API client methods**

```ts
listReadingHistory(input: {
  view: ReadingHistoryView;
  limit?: number;
  cursor?: string;
}, signal?: AbortSignal): Promise<ReadingHistoryResponse>;

getReading(readingId: string, signal?: AbortSignal): Promise<DailyReadingResponse>;
getReadingSaveState(readingId: string, signal?: AbortSignal): Promise<ReadingSaveState>;
saveReading(readingId: string, signal?: AbortSignal): Promise<ReadingSaveState>;
unsaveReading(readingId: string, signal?: AbortSignal): Promise<void>;
```

- [ ] **Step 3: Extract `ReadingArticle`**

Props:

```ts
interface ReadingArticleProps {
  response: DailyReadingResponse;
  status?: "published" | "superseded" | "invalidated";
  showCheckIn: boolean;
  onReload: () => void;
  onUnauthorized: () => void;
  onSaveStateChange?: (state: ReadingSaveState) => void;
}
```

Today passes `showCheckIn=true`; historical detail passes false. The article includes `ReadingSaveButton`, evidence, and feedback for the displayed `reading_id`.

- [ ] **Step 4: Implement accessible Save**

Render a real button with `aria-pressed`, visible `Save`/`Saved`, and
`aria-live` status for network completion. Optimistic UI may toggle only after
the server returns; on failure retain the previous state. Emit the committed
`ReadingSaveState` through `onSaveStateChange`.

- [ ] **Step 5: Verify and commit**

```bash
npm exec -w @patternlike/web -- vitest run src/components/ReadingArticle.test.tsx src/components/ReadingSaveButton.test.tsx src/components/TodayView.test.tsx
npm run typecheck -w @patternlike/web
```

```bash
git add apps/web/src/components/ReadingArticle.tsx apps/web/src/components/ReadingArticle.test.tsx apps/web/src/components/ReadingSaveButton.tsx apps/web/src/components/ReadingSaveButton.test.tsx apps/web/src/components/TodayView.tsx apps/web/src/components/TodayView.test.tsx apps/web/src/lib/api-client.ts
git commit -m "web: add reusable reading save control"
```

---

### Task 6: Add History navigation, pagination, and detail

**Files:**
- Create: `apps/web/src/components/HistoryView.tsx`
- Create: `apps/web/src/components/HistoryView.test.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/icons.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 5 components/client.
- Produces: `#history` product surface.

- [ ] **Step 1: Write failing History tests**

Cover:

- Empty History and Saved states.
- Chronological cards with headline/date/revision/status.
- “Load more” appends without replacement.
- History↔Saved resets cursor/items.
- Two saved revisions from one date both appear in Saved.
- Selecting an item loads detail and reuses evidence/feedback.
- Invalidated copy says “Removed from Today”; superseded copy says “Revised.”
- Unauthorized delegates to the signed-out screen.
- Save/unsave refreshes the active list without deleting the reading.

- [ ] **Step 2: Add route and navigation**

Add `"history"` to `ViewId`, `currentView`, `viewIds`, and the app branch. Add a History icon/label to desktop and mobile navigation, then verify the six-item mobile bar at the smallest supported width rather than silently clipping labels.

- [ ] **Step 3: Implement list/detail state**

`HistoryView` owns:

```ts
type LibraryState =
  | { status: "loading"; view: ReadingHistoryView }
  | { status: "ready"; view: ReadingHistoryView; items: ReadingHistoryItem[]; cursor: string | null }
  | { status: "error"; view: ReadingHistoryView; message: string; requestId: string | null };
```

Use a semantic `<ul>` of `<article>` items, a two-button tablist or equivalent labelled filter, a real “Load more” button with `aria-busy`, and a polite result-count announcement. Detail includes a Back control that restores the list without refetching.

Pass `onSaveStateChange` to the detail article. Update the matching list item
locally; when the current view is Saved and the state becomes unsaved, remove
that item locally. Back therefore restores correct state without a refetch.

- [ ] **Step 4: Add a Today entry point**

Add “Past chapters” near Today’s action controls even though History is in primary navigation. This keeps the Save→revisit path discoverable.

- [ ] **Step 5: Run focused verification**

```bash
npm exec -w @patternlike/web -- vitest run src/components/HistoryView.test.tsx src/components/ReadingArticle.test.tsx src/components/TodayView.test.tsx src/App.test.tsx
npm run typecheck -w @patternlike/web
```

- [ ] **Step 6: Perform the manual walkthrough**

Using the real local API/web stack:

1. Open Today and save the current revision.
2. Open History and verify the canonical date list.
3. Open Saved and verify the saved revision.
4. Open detail, evidence, and feedback.
5. Unsave; verify Saved removes it and History retains it.
6. Seed/open invalidated and superseded revisions and verify honest badges.
7. Test keyboard-only mobile-width navigation and Save control.

Record one concise demo video under `/opt/cursor/artifacts`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/HistoryView.tsx apps/web/src/components/HistoryView.test.tsx apps/web/src/components/AppShell.tsx apps/web/src/components/icons.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/TodayView.tsx apps/web/src/styles.css
git commit -m "web: add reading history"
```

## Definition of Done

- [ ] History returns one canonical readable artifact per date.
- [ ] Saved returns every explicitly saved revision without date collapse.
- [ ] Cursor pagination has no duplicate/gap under stable data and rejects mode mismatch.
- [ ] Reading detail serves owned published/superseded/invalidated v3 and v5 artifacts.
- [ ] Today remains active-chart-gated; historical detail does not.
- [ ] PUT/DELETE Save operations are idempotent without jobs or idempotency headers.
- [ ] Save state survives reload, is deleted with the account, and appears in M8 export.
- [ ] No new encrypted column exists; existing prose/evidence crypto paths are reused.
- [ ] Today and History share one renderer without changing fallback/disclosure/evidence/feedback behavior.
- [ ] History and Save controls are keyboard/screen-reader operable.
- [ ] The manual video demonstrates Save, History, Saved filtering, detail, evidence, feedback, and unsave.
