# Translate all: collect results page by page (A689-21) Implementation Plan

> **2026-10-19:** PR 1 (Tasks 1 to 8) was built on branch `feat/a689-21-collect-pages`, using the
> defaults of the four open questions at the end of this plan; the owner chose all four defaults
> on 2026-10-19.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The box fetches a finished Translate all job from Waitron Cloud one page at a time, stores each page together with its place in the list, resumes from that place after a crash or a lost reply, and tells Cloud to delete the job only after the last page is stored and every item is accounted for — then the plan's Task 21 end-to-end check runs against a real local Cloud.

**Architecture:** Cloud now answers a collect with one page of at most 16 MiB and a `nextCursor`, a plain whole-number position in the job's list of items that is sent back inside the signed request body (not an opaque token). The catalogue gains two columns on `content_suggestion_jobs`: the position of the next page to fetch, and the list of items already accounted for. `storeSuggestionPage` writes one page's suggestions, its accounting and the next position in one transaction, and finishes the job (counts, state, the run's next job) only on the page whose `nextCursor` is `null` — and only if every item Cloud counted is accounted for; otherwise it ends the job without a release. The runner asks for status once per step, then fetches and stores pages until the last one; release stays where it is today, a later step that sees the job is no longer `running`.

**Tech Stack:** TypeScript, drizzle-orm on `node:sqlite` (drizzle-kit 0.31.11), Vitest 4, Node `fetch` (undici).

**Spec:** the wire contract, waitron-cloud `origin/main` at `300f7bb829136dac37952bfe4af8167ec479783d` (2026-10-19), `docs/waitron-integration-contract.md`, sections "Request limits", "Status, collect and release", "Refusals" and "Joint release gate"; its rationale, `docs/superpowers/plans/2026-10-16-translation-collect-pages.md` on the same commit. Waitron's own plan: `docs/superpowers/plans/2026-10-14-translate-all.md` (Tasks 4, 9, 11 built collect; Task 21 is the end-to-end check). Worktree: `/Users/clintongormley/workspace/worktrees/waitron-feat-a689-21-collect-pages`, branch `feat/a689-21-collect-pages`, base `main` `c2b302f86`. Fresh-context review: `/Users/clintongormley/waitron-campaign/item-a689-21-plan-review.md` (revision log at the end).

---

## The contract words this plan builds to (quoted from Cloud `origin/main` 300f7bb82)

1. Request: "Collect signs exactly those fields with an optional `cursor`, for example `{"version":1,"jobId":"00000000-0000-4000-8000-000000000010","cursor":2}`. Omitting `cursor` means 0."
2. Cursor checks: "An unknown or foreign job is always 404 `translation_job_not_found`, including with an invalid cursor. For an owned job, a supplied cursor must be a JSON number that is a safe integer with `0 <= cursor < total`; null, strings, booleans, fractions, negative, unsafe and out-of-range values are 400 `invalid_request`. Validate the cursor before applying collect's state rules." … "An opaque or encrypted token adds no authority: the offset is already signed and installation-scoped."
3. Size: "Every successful collect response is at most **16,777,216 UTF-8 bytes (16 MiB) for the complete JSON body**, including every field, the UUID and `nextCursor`."
4. Shape: "The response has exactly `version`, `jobId`, `state`, `results`, `failed` and `nextCursor`." … "`nextCursor` is the offset immediately after the segment, or `null` at the end." … "Repeating the same cursor returns the identical semantic page while the job is retained, even with a fresh operation ID. Collect never deletes data or extends retention."
5. The box's duties: "The box must read at most 16 MiB of decoded JSON per page, regardless of `Content-Length` or compression, and reject an oversized or incomplete response. Do not concatenate response strings or keep an unbounded in-memory collection. Persist each validated page into Waitron's existing durable suggestion reconciliation, deduplicate refs per job, and save the next cursor with the page's durable writes. Crash retries may safely fetch and reconcile the same page again. Mark the walk complete only after the null-cursor page is durably stored and all `total` refs are accounted for. A release or expiry between pages returns 410 `translation_expired` for the next valid collect; retain the partial/incomplete distinction and never report those pages as a full job or release on their behalf."
6. Release: "**Release** tells Cloud the box has durably stored **every page**, and is sent only after that complete walk. A `failed` job has no collectable pages and keeps its existing release path." The amendment adds: "Release only after the null-cursor page and all `total` unique refs are durably accounted for."
7. Joint gate: "Do not go live until pinned Cloud and Waitron candidates jointly prove multi-page collection, crash/reply-loss retry, deduplication, bounded decoded reads and release only after durable completion."
8. Refusals for collect, unchanged from the table: 400 `invalid_request` → `cloud.request_invalid`; 404 `translation_job_not_found` and 410 `translation_expired` → `content.suggestion_expired`; 409 `translation_not_ready`, 429 `rate_limited` and 503 `temporarily_unavailable` → `cloud.unavailable`.

Cloud's code on that commit agrees with these words: `packages/translation/src/collect-page.ts` (`maxCollectBytes=16777216`; the page is the largest run of items that fits, measured incrementally with its actual `nextCursor`; when not one item fits it throws a plain `Error` at :29), `packages/translation/src/job-store.ts:43-52` (`collectJob`: cursor checked against `total`, then `collected`/`expired` → 410, then not `done`/`partly_done` → 409), `packages/translation/src/machine.ts:30-35` (`jobReference`: collect's signed body must have, after sorting, exactly the keys `jobId,version` or `cursor,jobId,version`, checked before the job lookup; the cursor value only after it), `packages/account-http/src/app.ts` (`publicError`: a plain `Error` becomes `503 temporarily_unavailable` with `Retry-After: 1`), `packages/account-http/src/translation.ts` (answers with `c.json(...)`, no compression; rate limits 60 a minute per address and 30 a minute per installation).

## Measured while planning

- **drizzle-kit adds the two columns without rebuilding the table.** On 2026-10-19 I copied `packages/catalogue/drizzle` and `src/schema` to a `mktemp -d` folder, added `collectCursor: count("collect_cursor")` and `collectedRefs: labelList("collected_refs").notNull().default([])` to the copy of `contentSuggestionJobs`, and ran the worktree's `drizzle-kit` 0.31.11 `generate` against the copy. It wrote exactly `ALTER TABLE \`content_suggestion_jobs\` ADD \`collect_cursor\` integer;` and `ALTER TABLE \`content_suggestion_jobs\` ADD \`collected_refs\` text DEFAULT '[]' NOT NULL;` — no `__new_` table. A rebuild would matter: `content_suggestions.job_id` references this table `on delete set null` (`content_suggestions_job_fk`), and a rebuild's `DROP TABLE` with foreign keys on would null every suggestion's job. Those two statements ran on Node v26.11.1's `node:sqlite` against a table already holding a row, which read back `collect_cursor: null, collected_refs: "[]"`. The reviewer reproduced the generation in a full copy and ran the ten root guards Task 2 names on it: 10 files, 460 tests passed, so no `CANDIDATES` or `schema-constraints` entry is needed.
- **Node's `fetch` hands the reader decoded bytes, and stops at a declared length.** On Node v26.11.1, a local HTTP server answering with `content-encoding: gzip` sent 17,373 bytes on the wire for a 17,825,802-byte JSON body; reading `response.body` chunk by chunk counted 17,825,802. The reviewer found that the same body served by a real server with `content-length: 100` gave the reader 100 bytes. So the box's chunk counter counts decoded bytes; only its limit is wrong; and a real server cannot test "regardless of `Content-Length`" (Task 5 uses a mocked `fetch` for that).

## Global Constraints

- The contract on Cloud `origin/main` is the authority for every wire detail; where a sentence here differs, the contract wins and the plan is wrong.
- Collect's page limit is 16,777,216 decoded bytes; status, submit and release keep their limits.
- Nothing a page holds is stored unless the page's position (`collect_cursor`) is saved in the same transaction; a network call never runs inside a transaction (CLAUDE.md §3, `withTransaction`).
- Release is sent only by a runner step that finds the job no longer `running` and not ended; only a null-cursor page that accounts for every item moves it to `done`/`partly_done`.
- Pre-live rule (CLAUDE.md §3, last data bullet): no backfill, no code for a Cloud that sends no `nextCursor` (such a reply is refused), no compatibility shims.
- Migrations are generated by drizzle-kit (`pnpm --filter @waitron/catalogue db:generate --name <name>`); never hand-edit the SQL, a snapshot or `_journal.json`; never edit `0032` or `0033`; let drizzle-kit pick the number.
- Every refusal test asserts the domain error code; every test run is read for its `Tests` count.
- Commits are `git commit -s` with plain-English messages; run `pnpm format:check` before each commit.
- An implementer past about 150 tool calls with the task unfinished stops at a passing or cleanly red point, commits, and hands over (done, left, files, each check's state). Each task here is sized for well under 100.
- PR 1 touches a migration and a cross-package contract: it takes the full `/finish-branch` wave with two Codex run-it reviews (global CLAUDE.md). Its description carries the "Changed test checks" section below, verbatim.
- Before Task 2: check the lane's migration bar (lane B's RUNNER rule H1: no migration while a PR the lane parked for the owner is open; on 2026-10-19 the queue names #1890 and #1894); `gh pr list --state open` for an open PR changing `packages/catalogue/drizzle/` (none on 2026-10-19: #1752, #1894 and #1897 change none); and local branches. **`feat/a682-translations`** (checked out in a worktree, last commit 2026-10-18) adds `packages/catalogue/drizzle/0033_unit_staff_identity.sql`, which already collides with `main`'s `0033_unit_measure`. Whichever of A682 and this branch lands second resets its migrations folder to `main`'s and regenerates (CLAUDE.md §3), then re-runs Task 2 Step 4's guards. Tell lane F (A682's owner) in `questions.md` when this branch's migration lands.

## Decisions this plan makes

1. **The cursor is always signed**, as `JSON.stringify({ version: 1, jobId, cursor })` in that key order, `cursor` 0 included (contract quote 1 allows either; one shape is simpler to test).
2. **Two columns, not one.** `collect_cursor` (nullable integer: null until the first page is stored, then the next page's position; the null-cursor page writes null back, and the job is no longer `running` by then) and `collected_refs` (refs already answered or failed in this job). The second is how "deduplicate refs per job" and "all `total` refs are accounted for" are kept without depending on the order of `sent`'s keys.
3. **A page is stored only at the saved position.** `storeSuggestionPage` compares the cursor the page was fetched with against `collect_cursor ?? 0` and changes nothing when they differ ("stale"). A crash after a page's transaction commits therefore re-fetches the next page, and a crash before it re-fetches the same page (contract quote 5: "Crash retries may safely fetch and reconcile the same page again").
4. **Inside a page:** a ref the job did not send, a ref already in `collected_refs`, a second copy of a ref, and a result for a ref the same page also lists as failed are dropped and counted in `dropped` (today's rules for the first, third and fourth, `content-suggestion-store.ts:96-101`; the second is new). A failed ref already accounted for is ignored without counting, as an unknown failed ref is today (`:96`).
5. **Status once per step, then every page.** The runner keeps "poll every five seconds at most" for status and fetches pages back to back. A 429 or 503 mid-walk is `cloud.unavailable`; the runner backs off (5 → 60 s) and resumes at the saved position. The loop does not re-check `isPrimary`, the service or the 24-hour clock between pages: a venue has one node today, and a walk is a handful of requests; the next step checks all three. Stated in the commit, not in a comment.
6. **The client checks the page arithmetic.** `nextCursor` must be present; it is `null`, or a safe integer equal to `cursor + results.length + failed.length`; and a page holds at least one entry. A reply breaking any of these is `cloud.unavailable` (refused, nothing stored). Extra keys are tolerated, as they are on every other reply today.
7. **The walk is complete only when every item is accounted for (contract quotes 5 and 6 decide this; it is not an owner question).** On the page whose `nextCursor` is `null`, `storeSuggestionPage` writes the page's rows, then requires that `collected_refs` holds every ref in `sent` and that its length equals the job's `total` (Cloud's own count from the submit reply, `content-suggestion-jobs.ts:84`). If not, it ends the job `failed` with failure `rejected` through `recordSuggestionJobEnded` — marked released without a call, so Cloud is never told the walk is complete — and the run shows `cloud.request_invalid`. The check counts accounted refs, not raw entries: a result for a ref the box did not send is still dropped, as the contract requires ("The box must drop: a result whose `ref` it did not send"), and does not by itself fail the walk. This replaces today's rule that counted unanswered sent refs as failed and completed (`content-suggestion-store.ts:181`).
8. **An interrupted walk says how many items were lost (the minimal change consistent with the owner's 2026-10-15 answer to A689 question 5 and the contract).** The owner chose: the notice is raised "for any run that is no longer sending or running and has suggestions waiting, worded as now, with 'N couldn't be done' when some failed" (`waitron-campaign-b/questions.md`, WATCHER 2026-10-15 ~13:00). Today `recordSuggestionJobEnded` leaves `failed` at the last status reading (usually 0), so an expired walk raises `content.suggestions_ready` — the full-job wording — which contradicts "never report those pages as a full job". The change: when `recordSuggestionJobEnded` ends a job whose `collected_refs` is not empty (at least one page stored), it adds every sent ref not in `collected_refs` to `failed_refs` and sets `failed` and `done` from them. `contentSuggestionsAlertSource` (`alert-sources.ts:813-841`) is not changed: `run.failed > 0` already selects `content.suggestions_ready_partly`, "{failed} couldn't be done this time". A job that ends before any page is stored keeps today's behaviour; that wider case is a backlog entry (Task 8), not this branch.
9. **The suggestions from an interrupted walk stay** for review; the run shows `expired` or `failed`, never `done` (open question 2).
10. **Collect's read deadline becomes 120 s** (today 30 s, `LIMITS`, `cloud-translation.ts:96`). Open question 1.

## Review Focus

The five inputs most likely to bite that no task's main tests name; each has its test in the task named.

1. **Cloud's per-installation limit during a long walk** (30 requests a minute): a 429 mid-walk must resume at the saved position, not restart at 0. Test: Task 6, "a refused page (429) resumes at the saved position after back-off".
2. **A Cloud from before paging** (no `nextCursor` in its reply): must be refused, not read as a complete one-page job and released. Test: Task 5, "refuses a collect reply with no nextCursor".
3. **A person discards or saves a suggestion from page 1 while page 2 is being fetched:** page 2 must not resurrect it or fail. Test: Task 3, "a suggestion discarded between pages stays discarded and the next page is stored".
4. **The box's own 24-hour clock or the service going off mid-walk:** the job ends without a release call, the run is not `done`, and the notice says how many could not be done. Test: Task 7, "a walk the box ends itself between pages keeps the stored page and sends no release".
5. **A compressed reply** (a proxy in front of Cloud may compress even though Cloud does not): judged by its decoded size. Test: Task 5, "a gzip reply is judged by its decoded size".

---

## File map

| File | Change |
| --- | --- |
| `apps/server/test/translation-cloud-fixture.ts` | The fake Cloud pages collect by the contract; knobs for page size, rewriting a page, gzip |
| `apps/server/src/translation-cloud-fixture.test.ts` | The fake's own tests for paging |
| `packages/catalogue/src/schema/suggestions.ts` | Two columns on `content_suggestion_jobs` |
| `packages/catalogue/drizzle/00NN_<name>.sql`, `meta/00NN_snapshot.json`, `meta/_journal.json` | Generated by drizzle-kit |
| `packages/catalogue/src/content-suggestion-types.ts` | `SuggestionResults` becomes `SuggestionPage` |
| `packages/catalogue/src/content-suggestion-store.ts` | `storeSuggestionResults` becomes `storeSuggestionPage`; the end-of-walk check |
| `packages/catalogue/src/content-suggestion-jobs.ts` | `recordSuggestionJobEnded` counts what an interrupted walk lost |
| `packages/catalogue/src/content-suggestion-store.test.ts`, `content-suggestion-store.list.test.ts`, `content-suggestion-jobs.test.ts` | The rename; new page tests |
| `apps/server/src/cloud-translation.ts` | The rename; signed cursor, `nextCursor` checks, 16 MiB reader, 120 s deadline |
| `apps/server/src/cloud-client.ts` | `translation.collect(jobId, cursor, signal?)` |
| `apps/server/src/cloud-translation.exchange.test.ts` | Reader and page-shape tests |
| `apps/server/src/content-suggestion-runner.ts`, `.test.ts` | The page loop |
| `docs/developers/cloud-connection.md`, `docs/backlog.md`, `docs/backlog/catalogue.md`, `docs/superpowers/plans/2026-10-14-translate-all.md` | Docs (Task 8) |

Commands (from the worktree root; read the `Tests` count every time):

- Server: `pnpm --filter @waitron/server exec vitest run <path relative to apps/server>`
- Catalogue: `pnpm --filter @waitron/catalogue exec vitest run <path relative to packages/catalogue>`
- Typecheck: `pnpm --filter @waitron/catalogue typecheck && pnpm --filter @waitron/server typecheck`
- Root guards: `pnpm exec vitest run scripts/<file>`
- Fiscal: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`

## Changed test checks (copy into PR 1's description)

Each existing assertion this branch edits or deletes, with why. Nothing else in an existing test changes except mechanical renames and call shapes (listed last).

1. `apps/server/src/translation-cloud-fixture.test.ts:543` (Task 1) — the `toEqual` on the fake's collect body gains `nextCursor: null`: the fake now answers with the contract's six fields. The reviewer measured that this assertion fails without the edit.
2. `apps/server/src/cloud-translation.exchange.test.ts:352-359` (Task 5) — the `collected()` helper's base gains `nextCursor: null`, so every "refuses a collect reply …" case built from it is refused only by the rule its name gives. Without the edit, the new presence check refuses them first and they pass whatever `readResult` does (the reviewer's experiment 4).
3. `apps/server/src/cloud-translation.exchange.test.ts:451` (Task 5) — "accepts a collect reply holding a correction": the expected value gains `nextCursor: null`.
4. `apps/server/src/cloud-translation.exchange.test.ts:285` (Task 5) — **deleted**: "a collect reply as large as the contract allows fits under its size limit". It proved 1,000 worst-case items fit one 116 MiB reply; paging removed that premise. Replaced by "reads a page of exactly 16 MiB and refuses one byte more"; the single-item bound is Cloud's ("Single-item size proof", 11,720,640 bytes).
5. `packages/catalogue/src/content-suggestion-store.test.ts:364` (Task 4) — "counts sent items with nothing usable, or not answered, as failed": renamed "counts sent items with nothing usable as failed"; its input lists cheese under `failed` instead of leaving it unanswered. Every assertion stays (`partly_done`, `done: 0`, `failed: 3`, `dropped: 1`, the same `failedRefs`). The "not answered" half moves to the new test "a last page that leaves a sent item unaccounted ends the job without a release", which expects the opposite outcome (Decision 7).
6. `packages/catalogue/src/content-suggestion-store.test.ts:688` (Task 4) — "a later run replaces more than one batch of an item's rows in one store": its `answer` helper also lists the seed venue's bread, wine and cheese under `failed`, so both runs' walks are complete. Assertions unchanged. Without the edit the test still passes, but through Decision 7's rejected path, so it would no longer test a completed store.
7. Mechanical (no assertion changes): `storeSuggestionResults` → `storeSuggestionPage` and `SuggestionResults` → `SuggestionPage` in `content-suggestion-store.test.ts` (`:11-12`, `:35-42`, `:625`), `content-suggestion-store.list.test.ts:15,41`, `content-suggestion-jobs.test.ts:20,288`; every `translation.collect(id)` in the server tests becomes `collect(id, 0)`.

---

# PR 1 — the box side of paged collect

Order: 1 and 2 are independent; 3 needs 2; 4 needs 3; 5 needs 1 and 3; 6 needs 4 and 5; 7 needs 6; 8 last.

### Task 1: The fake Cloud pages collect by the contract

**Files:**
- Modify: `apps/server/test/translation-cloud-fixture.ts` (`jobIdIn` at :112-124, `handler` at :264-323, `collect` at :422-434, the returned object at :513-566)
- Test: `apps/server/src/translation-cloud-fixture.test.ts`

**Interfaces:**
- Produces:
  - `export interface FakePage { version: 1; jobId: string; state: "done" | "partly_done"; results: FakeResult[]; failed: string[]; nextCursor: number | null }`
  - `export const PAGE_BYTES = 16_777_216`
  - fixture methods: `pageBytes(n: number): void` (the page budget; default `PAGE_BYTES`), `pageItems(n: number | null): void` (at most `n` entries a page — a test convenience Cloud does not have; default `null`), `collectReply(fn: ((page: FakePage, cursor: number) => FakePage | string) | null): void` (rewrites each collect page before it is sent; a string is sent as the body verbatim), `gzipReplies(on: boolean): void` (every 200 reply is sent `content-encoding: gzip`)
  - `calls` entries gain `cursor?: unknown` (collect only: the signed value, `0` when omitted) and `replyBytes?: number` (bytes of the body before any encoding)

- [ ] **Step 1: Write the failing tests and edit the one existing assertion** (Changed test checks 1). New tests in `translation-cloud-fixture.test.ts`, each building a job through the existing `signedRequest` helper and finishing it with two status calls, as the test at :514 does:
  - `it("pages a finished job in submit order and walks to a null cursor")` — three items with languages to write plus one context head, `pageItems(1)`: collects at cursors 0, 1, 2 return `nextCursor` 1, 2, `null`; the refs across the walk equal the three written refs in submit order; the head appears in no page. Failing case today: the reply has no `nextCursor` and holds all three results, printing `expected undefined to be 1`.
  - `it("measures each page with its own nextCursor and never exceeds the budget")` — `pageBytes(n)` where `n` is the byte length of the one-result page at cursor 0 (compute it with `JSON.stringify` of that page): the cursor-0 page holds one result; every `replyBytes` is `<= n`; then `pageBytes(n - 1)` makes the cursor-0 collect answer `503 { error: "temporarily_unavailable" }` with `Retry-After: 1`, as Cloud's `publicError` does for the plain `Error` `collect-page.ts:29` throws. Failing case today: one page holds all three, printing `expected 3 to be 1`.
  - `it("checks the job before the cursor and the cursor before the state")` — an unknown job id with cursor `"x"` is 404 `translation_job_not_found`; an owned `done` job with cursor `-1`, `1.5`, `"1"`, `null`, `true`, `2 ** 53` and `total` each is 400 `invalid_request`; an owned `expired` job with cursor `total` is 400 (cursor before state) and with cursor 0 is 410 `translation_expired`; a `running` job with cursor 0 is 409 `translation_not_ready`; a status or release signed with a `cursor` key is 400 `invalid_request`. Failing case today: the fake answers 400 for every collect with a cursor key (`jobIdIn` refuses it), so the unknown-job case prints `expected 400 to be 404`.
  - `it("answers the same page for a repeated cursor and any in-range cursor")` — collect at 1 twice with fresh operation ids returns deep-equal bodies; collect at 2 without ever asking for 1 is accepted. Failing case today: 400.
  - `it("collectReply rewrites a page and gzipReplies compresses every reply")` — a `collectReply` returning a string is received verbatim; with `gzipReplies(true)` the response carries `content-encoding: gzip` and Node's `fetch` reads the decoded JSON. Failing case today: `f.collectReply is not a function`.
- [ ] **Step 2: Run them and watch them fail** — `pnpm --filter @waitron/server exec vitest run src/translation-cloud-fixture.test.ts`. Expected: the five new tests FAIL with the messages above, and the edited :543 assertion FAILS (`nextCursor` missing); the rest PASS.
- [ ] **Step 3: Implement.** `jobIdIn(signedBody, action)` returns `{ jobId, cursor: unknown } | null`: for collect it accepts the exact strings `JSON.stringify({version:1,jobId})` and `JSON.stringify({version:1,jobId,cursor})` (any JSON value as `cursor`); for status and release only the first. (The fake stays stricter than Cloud about key order — Cloud sorts keys, `machine.ts:33-34` — as it already is on `main`; the box sends this order. Task 8's shared-vectors entry names it.) After the job lookup, collect checks `Number.isSafeInteger(cursor) && cursor >= 0 && cursor < job.total` (400 otherwise), then the existing state rules, then builds the page the way Cloud's `collectPage` does, **measuring incrementally** (running byte totals for `results` and `failed` plus the envelope's size with the candidate's actual `nextCursor`, as `collect-page.ts:21-27` does — never re-serialising each candidate page, which would be quadratic on Task 7's 18 MB walk), stopping at `pageItems` when set; none fits → 503 as above. Record `cursor` and `replyBytes` on the call. Update the comment block at :218-231 for the new choices (`pageItems`).
- [ ] **Step 4: Run the file again, then every suite that uses the fake.** `pnpm --filter @waitron/server exec vitest run src/translation-cloud-fixture.test.ts` — Expected: all PASS, :543 included after its edit. Then `pnpm --filter @waitron/server exec vitest run src/cloud-translation.exchange.test.ts src/content-suggestion-runner.test.ts src/content-suggestions-api.test.ts` — Expected: PASS (one page each, because the default budget is 16 MiB, and the box's collect still ignores the extra `nextCursor` field).
- [ ] **Step 5: Commit** — `git add apps/server/test/translation-cloud-fixture.ts apps/server/src/translation-cloud-fixture.test.ts && git commit -s -m "The fake Cloud answers collect a page at a time, as the contract now says"`

### Task 2: Two columns for a job's place in the walk

**Files:**
- Modify: `packages/catalogue/src/schema/suggestions.ts` (after `openedAt`, :68)
- Create (generated): `packages/catalogue/drizzle/00NN_<name>.sql`, `packages/catalogue/drizzle/meta/00NN_snapshot.json`; modify (generated) `packages/catalogue/drizzle/meta/_journal.json`
- Test: `packages/catalogue/src/content-suggestion-jobs.test.ts`

**Interfaces:**
- Produces: `contentSuggestionJobs.collectCursor` (`count("collect_cursor")`, nullable) and `contentSuggestionJobs.collectedRefs` (`labelList("collected_refs").notNull().default([])`); `SuggestionJobRow` gains `collectCursor: number | null` and `collectedRefs: string[]`.

- [ ] **Step 0:** the checks in Global Constraints' last bullet (lane bar, open PRs, `feat/a682-translations`).
- [ ] **Step 1: Write the failing test** `it("a new job has no collect position and nothing accounted for")` in `content-suggestion-jobs.test.ts`: after `startSuggestionRun`, the job row has `collectCursor: null` and `collectedRefs: []`. Failing case today: `expected undefined to be null`.
- [ ] **Step 2: Run it** — `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-jobs.test.ts`. Expected: that test FAILS as above.
- [ ] **Step 3: Add the two columns and generate** — `pnpm --filter @waitron/catalogue db:generate --name content_suggestion_collect_cursor`. Read the generated SQL: it must be exactly the two `ALTER TABLE \`content_suggestion_jobs\` ADD …` statements measured above. If it holds a `CREATE TABLE \`__new_` or any other statement, stop and report — do not hand-edit it. A comment at `collectedRefs` says what it holds (refs answered or failed so far in this job), the one invariant the column's name does not show.
- [ ] **Step 4: Run the test and the guards.**
  - `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-jobs.test.ts src/schema/schema-conformance.test.ts src/schema/suggestions.db.test.ts` — Expected: PASS.
  - `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts scripts/column-vocabulary.test.ts scripts/id-columns-are-references.test.ts scripts/migration-upgrade.test.ts` — Expected: PASS (the reviewer ran exactly these on the generated migration: 10 files, 460 tests). No `schema-constraints` entry and no `CANDIDATES` entry is expected; if `migration-upgrade` fails naming either column, add a `CANDIDATES` entry with the reason, as its siblings do.
  - `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts` — Expected: PASS, unedited.
- [ ] **Step 5: Commit** the schema, the three generated files and the test, with a message that says the migration adds two columns and no table rebuild.

### Task 3: Rename to pages, and store one page at a time

**Files:**
- Modify: `packages/catalogue/src/content-suggestion-types.ts:9-16`, `packages/catalogue/src/content-suggestion-store.ts:82-208`, `apps/server/src/cloud-translation.ts:2-5,272-292` (types only), `apps/server/src/content-suggestion-runner.ts:11-13,118-128` (call site only)
- Modify (mechanical): `packages/catalogue/src/content-suggestion-store.test.ts` (`:11-12`, `:35-42`, `:625`), `content-suggestion-store.list.test.ts:15,41`, `content-suggestion-jobs.test.ts:20,288`
- Test: `packages/catalogue/src/content-suggestion-store.test.ts`

**Interfaces:**
- Consumes: Task 2's columns.
- Produces:
  ```ts
  export interface SuggestionPage {
    state: "done" | "partly_done";
    /** The cursor this page was fetched with. */
    cursor: number;
    results: SuggestionResult[];
    failed: string[];
    nextCursor: number | null;
    /** Copied by the runner from the status reply; collect's reply carries no reason. */
    reason?: "limit_reached" | "provider_failed";
  }
  export type PageStored = "stored" | "complete" | "ended" | "stale";
  export async function storeSuggestionPage(
    tx: Transaction, jobId: string, page: SuggestionPage, context: TranslationContext, now?: Date,
  ): Promise<PageStored>;
  ```
  `SuggestionResults` and `storeSuggestionResults` are removed (pre-live, nothing else reads them). `"ended"` is produced by Task 4.

- [ ] **Step 1: The rename, with behaviour unchanged.** Rename the type and the function in the catalogue; `storeSuggestionPage` returns `"complete"` where it finishes the job and `"stale"` where it returns early today, and ignores `cursor`/`nextCursor` for now. In `cloud-translation.ts`, `collectTranslation` returns `Omit<SuggestionPage, "cursor" | "nextCursor" | "reason">` (Task 5 replaces this). The runner passes `{ ...collected, cursor: 0, nextCursor: null }`. The tests' `done(...)` helper returns `{ state: "done", cursor: 0, nextCursor: null, results, failed }`, `:625` reads `SuggestionPage["results"][number]`, and the list and jobs tests call the new name (Changed test checks 7). Run the typecheck command, then `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts src/content-suggestion-store.list.test.ts src/content-suggestion-jobs.test.ts` and `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts src/cloud-translation.exchange.test.ts`. Expected: typecheck clean in both packages, every test PASS. Commit ("Rename stored results to pages; no change in behaviour").
- [ ] **Step 2: Write the failing tests** (venue from `seedSuggestionVenue`: bread, wine and cheese sent; `page(cursor, nextCursor, results, failed = [])` builds a `SuggestionPage`):
  - `it("a page before the last stores its suggestions and keeps the job running at the next cursor")` — page(0, 1, [bread]) returns `"stored"`; the job is `running`, `collectCursor` 1, `collectedRefs` [bread], `finishedAt` null; bread's rows are stored; `readActiveSuggestionJob` is this job. Failing case today: the store finishes the job, printing `expected 'done' to be 'running'`.
  - `it("only the last page finishes the job, counts it and chains the next")` — with olives added after the job started (as the chain test at :465 does): after page(0, 1, [bread]) there is one job row; after page(1, null, [cheese], [wine]) it returns `"complete"`, the job is `partly_done` with `done: 2, failed: 1`, `failedRefs: [wine]`, and a second job holds olives. Failing case if completion ran on every page: two job rows after the first page, printing `expected [ …(2) ] to have a length of 1`.
  - `it("a page stored again after its transaction committed changes nothing")` — page(0, 1, [bread]) twice: the second returns `"stale"`; rows, `dropped` and `collectedRefs` are unchanged. Failing case with the cursor comparison deleted: the second store counts bread as already collected, printing `expected 1 to be 0` for `dropped`.
  - `it("a page whose transaction rolled back is stored once when fetched again")` — `withTransaction` storing page(0, 1, [bread]) then throwing; then page(0, 1, [bread]) in a fresh transaction returns `"stored"`, `collectCursor` 1, bread's rows once, `dropped` 0. Failing case if the cursor were written outside the page's transaction: the retry is `"stale"` and bread has no rows, printing `expected [] to deeply equal [ …(1) ]`.
  - `it("a ref repeated on a later page is stored once and counted dropped")` — page(0, 1, [bread "EN Bread"]) then page(1, 2, [bread "EN Bread again", wine]): bread keeps "EN Bread", wine is stored, `dropped` 1, `collectedRefs` [bread, wine]. Failing case without the per-job dedupe: bread's text becomes "EN Bread again", printing the text difference.
  - `it("a failed ref already accounted for on an earlier page is ignored and not counted")` (Decision 4) — page(0, 1, [bread]) then page(1, null, [cheese], [bread, wine]): bread keeps its row and is not in `failedRefs`; `failedRefs: [wine]`, `dropped: 0`, `done: 2, failed: 1`. Failing case if an earlier answer could be overturned: bread in `failedRefs` and `failed: 2`.
  - `it("a suggestion discarded between pages stays discarded and the next page is stored")` (Review Focus 3) — page(0, 1, [bread]); `discardContentSuggestion` on bread's row; page(1, null, [wine, cheese]): bread has no row, wine and cheese do, job `done`. No line of the planned code threatens this today; it fails, printing bread's row in the difference, if a later change re-plans the refs earlier pages stored.
  - `it("a page for a job that is not running, or at another cursor, is stale")` — page(1, …) before any page (saved position 0) and any page after `"complete"` both return `"stale"` and change nothing. Failing case with either check deleted: rows written, printing the row difference.
- [ ] **Step 3: Run them** — `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts`. Expected: the new tests FAIL as described; the renamed ones PASS.
- [ ] **Step 4: Implement the page store.** Keep today's per-result planning (live item, language still missing, `expected` token, fixes, placeholder) unchanged. Around it: return `"stale"` when the job is missing, not `running`, or `(job.collectCursor ?? 0) !== page.cursor`; build the page's failed set from `page.failed` less refs not sent or already in `collectedRefs`; drop (count) a result whose ref is not sent, already collected, repeated, or in the page's failed set; write rows exactly as today; then update the job with `collectCursor: page.nextCursor`, `collectedRefs` (old plus this page's answered and failed refs), `failedRefs` (old plus this page's failed, sorted) and `dropped` (old plus this page's). Only when `page.nextCursor === null`: set `state`, `failure` (limit), `finishedAt`, `failed`, `done`, chain the next job and set `runTotal` exactly as today, and return `"complete"` — keeping, until Task 4, today's rule that adds unanswered sent refs to `failedRefs`. Otherwise return `"stored"`. One update statement for the job per page.
- [ ] **Step 5: Run** the catalogue suggestion tests and the server runner suite from Step 1. Expected: PASS. Then `pnpm --filter @waitron/catalogue test:coverage` and read `content-suggestion-store.ts` in the per-file table: at or above 98/98/98/95.
- [ ] **Step 6: Commit.**

### Task 4: A walk ends complete only when every item is accounted for

**Files:**
- Modify: `packages/catalogue/src/content-suggestion-store.ts` (the null-cursor branch), `packages/catalogue/src/content-suggestion-jobs.ts:119-137` (`recordSuggestionJobEnded`)
- Test: `packages/catalogue/src/content-suggestion-store.test.ts`, `packages/catalogue/src/content-suggestion-jobs.test.ts`

**Interfaces:**
- Consumes: Task 3's `storeSuggestionPage`.
- Produces: `storeSuggestionPage` returns `"ended"` when the last page leaves the walk incomplete. `recordSuggestionJobEnded`'s signature is unchanged; for a job with a non-empty `collectedRefs` it now also writes `failedRefs`, `failed` and `done` (Decision 8).

- [ ] **Step 1: Edit the two existing tests' inputs** (Changed test checks 5 and 6) and **write the failing tests**:
  - `it("a last page that leaves a sent item unaccounted ends the job without a release")` (Decision 7) — page(0, 1, [bread]) then page(1, null, [wine]): returns `"ended"`; the job is `failed`, `failure: "rejected"`, `released: true`; bread and wine keep their rows; `failedRefs: [cheese]`, `failed: 1`, `done: 2`; no next job; run view `failed`, `code: "cloud.request_invalid"`. Failing case today (unanswered counted failed and completed): `expected 'partly_done' to be 'failed'`.
  - `it("a last page whose accounted items fall short of Cloud's total ends the job")` — set the running job's `total` to 4 (Cloud counted one more than the box sent), then one page(0, null, [bread, wine, cheese]): `"ended"`, `failed`/`rejected`. Failing case if only `sent` were compared: `"complete"` and `done`.
  - `it("a result for an item the box did not send does not by itself fail the walk")` — page(0, null, [bread, wine, cheese, "product:unknown"]): `"complete"`, `done`, `dropped: 1`. Guards against counting raw entries. Failing case with a raw-entry count: `"ended"`.
  - `it("a job ended after some pages counts what it never received as failed")` (Decision 8), in `content-suggestion-jobs.test.ts` — page(0, 1, [bread], [wine]); then `recordSuggestionJobEnded(tx, job.id, "expired", null, at)`: `failedRefs: [cheese, wine]`, `failed: 2`, `done: 1`; `readSuggestionRun` gives `state: "expired"`, `failed: 2`. Failing case today: `failed` keeps the last status reading (0 for this fixture), printing `expected 0 to be 2`.
  - `it("a job ended before any page keeps its counts")` — `recordSuggestionJobEnded` on a running job with no page stored leaves `done`, `failed` and `failedRefs` as they were. Pins that the change is limited to walks that began.
- [ ] **Step 2: Run** `pnpm --filter @waitron/catalogue exec vitest run src/content-suggestion-store.test.ts src/content-suggestion-jobs.test.ts`. Expected: the new tests FAIL as described; the two edited tests PASS (their inputs now account for every item).
- [ ] **Step 3: Implement.** In the null-cursor branch, after the rows and accounting are written: if `collectedRefs` lacks any key of `job.sent`, or `collectedRefs.length !== job.total`, call `recordSuggestionJobEnded(tx, jobId, "failed", "rejected", now)` and return `"ended"`; else complete as today, without the old unanswered-to-failed rule. In `recordSuggestionJobEnded`, read the job first; when its `collectedRefs` is non-empty, also set `failedRefs` to its old value plus every sent ref not in `collectedRefs` (sorted), `failed` to that length and `done` to the number of sent refs less it. The existing `where` (only `submitting`/`running`) and `released` rules are unchanged.
- [ ] **Step 4: Run** the two files, plus `content-suggestion-store.list.test.ts` and `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts src/alert-sources.test.ts`. Expected: PASS. (`alert-sources.test.ts` seeds job rows directly, `:1341-1400`, so Decision 8 does not change it.)
- [ ] **Step 5: Commit.**

### Task 5: The collect call signs a cursor, checks the page and reads at most 16 MiB

**Files:**
- Modify: `apps/server/src/cloud-translation.ts` (`COLLECT_REPLY_BYTES` and its comment :74-82, `LIMITS` :91-96, `collectTranslation` :272-292), `apps/server/src/cloud-client.ts:398-399`, `apps/server/src/content-suggestion-runner.ts` (the call site only)
- Test: `apps/server/src/cloud-translation.exchange.test.ts`

**Interfaces:**
- Consumes: Task 1's fixture knobs; Task 3's `SuggestionPage`.
- Produces:
  - `export const COLLECT_REPLY_BYTES = 16_777_216;` (comment: the contract's "Request limits" sentence, one line)
  - `export type CollectedPage = Omit<SuggestionPage, "cursor" | "reason">;`
  - `collectTranslation(state: SavedCloudState, jobId: string, cursor: number, signal?: AbortSignal, onRefusal?: OnRefusal): Promise<CollectedPage>`
  - `CloudConnection["translation"]["collect"]: (jobId: string, cursor: number, signal?: AbortSignal) => Promise<CollectedPage>`
  - `LIMITS["translation-collect"]` = `{ reply: COLLECT_REPLY_BYTES, ms: 120_000 }` (Decision 10)

- [ ] **Step 1: Edit the existing checks and write the failing tests.** Changed test checks 2, 3 and 4: `collected()`'s base gains `nextCursor: null`; the :451 expectation gains `nextCursor: null`; the :285 test is deleted. Existing `collect(id)` calls become `collect(id, 0)`. New tests:
  - `it("signs the cursor it is given and returns the page's nextCursor")` — fake with `pageItems(1)`, a two-item job: `collect(id, 1)` resolves with `nextCursor: null` and the second ref; the fake's last collect call has `cursor` 1. Failing case today: no cursor is signed, the fake records 0, printing `expected 0 to be 1`.
  - `it.each` "refuses a collect reply with …" (mocked `fetch`, as at :356, built with `collected(...)`): no `nextCursor` (`nextCursor: undefined` removed from the object); `nextCursor` a string; `nextCursor` equal to the cursor; `nextCursor` one more than `cursor + entries`; `nextCursor: null` with no results and no failures — each `cloud.unavailable`. Failing case today: the first resolves, printing `promise resolved "{ state: 'done', … }" instead of rejecting` (Review Focus 2).
  - `it("reads a page of exactly 16 MiB and refuses one byte more")` — mocked `fetch`: a valid page body padded with trailing spaces to 16,777,216 bytes resolves; to 16,777,217 rejects `cloud.unavailable`. Failing case today (116 MiB limit): the second resolves.
  - `it("refuses an oversized page whatever its Content-Length says")` — **only meaningful against a mocked `fetch`**: a real server cannot send a body longer than its declared length (undici stops reading at it, the reviewer's measurement). `vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body, { headers: { "content-length": "100" } }))`, where `body` is a **valid page** padded to 16,777,217 bytes, so a reader that trusted the header instead of counting would parse it and resolve. Expected: rejects `cloud.unavailable`.
  - `it("a gzip reply is judged by its decoded size")` (Review Focus 5) — the fake with `gzipReplies(true)`: a normal page resolves (control: if the reader saw the compressed bytes, `JSON.parse` would fail and it would reject), and a `collectReply` string of a page padded to 17 MiB of spaces — about 17 KB on the wire, measured above — rejects `cloud.unavailable`. Failing case today: the padded reply resolves (17 MiB is under 116 MiB).
  - `it("refuses a page whose stream breaks off")` — a mocked stream that enqueues half a page then calls `controller.error()`: rejects `cloud.unavailable`. Today this passes already (the reader's `catch` turns any error into `cloud.unavailable`); it pins "reject an … incomplete response". Say so in the commit message rather than claiming a red run.
  - `it("gives a collect 120 seconds and a status 8")` (Decision 10) — `vi.spyOn(AbortSignal, "timeout")`, one collect and one status against the fake: the spy was called with `120_000` for the collect and `8000` for the status. Weaker than its name: it pins the number passed to `AbortSignal.timeout`, not that a stalled read is cut off at 120 s. Failing case today: called with `30000`.
  - `it.each` collect refusals carried through: 400 `invalid_request` (a cursor equal to `total`, sent to the fake) → `cloud.request_invalid`; 404 for another job → `content.suggestion_expired`; 410 for an expired job → `content.suggestion_expired`; 409 for a running job → `cloud.unavailable`; 503 `temporarily_unavailable` (the fake with `pageBytes(1)`) → `cloud.unavailable`.
  - The existing "refuses a collect reply over its size limit, and stops reading it" (:311) stays and now runs against 16 MiB.
- [ ] **Step 2: Run them** — `pnpm --filter @waitron/server exec vitest run src/cloud-translation.exchange.test.ts`. Expected: the new tests FAIL as described.
- [ ] **Step 3: Implement.** Sign `JSON.stringify({ version: 1, jobId, cursor })`; after the existing checks, require `Object.hasOwn(v, "nextCursor")`, `results.length + failed.length >= 1`, and `v.nextCursor === null || (Number.isSafeInteger(v.nextCursor) && v.nextCursor === cursor + results.length + failed.length)`; return `{ state, results, failed, nextCursor }`. Change the constant, its comment and the deadline. The runner's call site becomes `translation.collect(cloudJobId, job.collectCursor ?? 0, signal)` and stores `{ ...page, cursor: job.collectCursor ?? 0 }`, one page per step; Task 6 makes it a loop.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/cloud-translation.exchange.test.ts src/cloud-translation.test.ts src/content-suggestion-runner.test.ts src/translation-cloud-fixture.test.ts` and the typecheck command. Expected: PASS, typecheck clean.
- [ ] **Step 5: Control for Changed test checks 2.** In a throwaway edit make `readResult` return its input unchecked: "a collect reply with a result that is not an object", "… a correction missing its right text" and "refuses a collect reply with a result whose names are not text" must FAIL; restore and re-run to PASS. Record it in the commit message.
- [ ] **Step 6: Commit.**

### Task 6: The runner walks every page before the job can be released

**Files:**
- Modify: `apps/server/src/content-suggestion-runner.ts` (`poll`, :108-138)
- Test: `apps/server/src/content-suggestion-runner.test.ts`

**Interfaces:**
- Consumes: `storeSuggestionPage`, `PageStored` (Tasks 3-4); `translation.collect(jobId, cursor, signal)` (Task 5); fixture `pageItems`, `calls[].cursor` (Task 1).
- Produces: no new export. Test-file helpers used by Task 7 too: `const cursors = (f: Fake) => f.calls.filter((c) => c.action === COLLECT).map((c) => c.cursor);` and `function lossy(f: Fake, on: (cursor: number, call: () => Promise<CollectedPage>) => Promise<CollectedPage>)` returning `deps(f, { connection: { ...f.client, translation: { ...f.client.translation, collect: (id, cursor, signal) => on(cursor, () => f.client.translation.collect(id, cursor, signal)) } } })`.

- [ ] **Step 1: Write the failing tests** (three products, `f.pageItems(1)`):
  - `it("collects every page, then stores the job as done, then releases it")` — `runToIdle`: actions `[SUBMIT, STATUS, STATUS, COLLECT, COLLECT, COLLECT, RELEASE]`; `cursors` `[0, 1, 2]`; three suggestions; run view `done`, `done: 3`. Failing case after Task 5 (one page a step): a `STATUS` between each `COLLECT`, printing the array difference. Failing case on `main` before this branch: one `COLLECT`, one suggestion, then `RELEASE`.
  - `it("never sends release before the last page is stored")` — `lossy` throws `new AppError("cloud.unavailable", {})` for cursor 2 before calling the fake: the step **rejects** `cloud.unavailable`; `actions` holds no `RELEASE`; the job is `running` with `collectCursor` 2; run view `running`. Failing case if a page before the last finished the job (Task 7's deletion proof): the loop stops after the first page with `"again"`, so the step resolves instead of rejecting and the job is `done`.
  - `it("a lost page reply is fetched again at the same position, and nothing is counted twice")` — `lossy` calls the fake for cursor 1 the first time, then throws (the reply is lost after Cloud answered): the first step rejects; `runToIdle` on the same runner then finishes; `cursors` `[0, 1, 1, 2]`, job `dropped: 0`, `done: 3`. Failing case if the position were not saved with the page: `[0, 1, 0, 1, 2]` and `dropped: 1`.
  - `it("a restarted box resumes from the saved position")` — the first runner's `lossy` throws a `TypeError` for cursor 1; a new runner built with `createCloudConnection(f.options)` (as at :166) runs to idle: its first collect has cursor 1; three suggestions; one `RELEASE`.
  - `it("a refused page (429) resumes at the saved position after back-off")` (Review Focus 1) — `lossy` rejects cursor 1 once with `refusalOf(429, { error: "rate_limited" })`: the step rejects `cloud.unavailable`; the next step's first collect has cursor 1.
- [ ] **Step 2: Run them** — `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts`. Expected: the new tests FAIL as described.
- [ ] **Step 3: Implement the loop** in `poll`'s `done`/`partly_done` branch: `let cursor = job.collectCursor ?? 0`; repeat — `collect(cloudJobId, cursor, signal)`, store `{ ...page, cursor, ...reason }` in its own `withTransaction` with `now()` read per page, stop and return `"again"` unless the store answered `"stored"`, else `cursor = page.nextCursor!`. The existing `catch` (expired → `close(job, "expired")`, request_invalid → `close(job, "failed", "rejected")`, anything else rethrown) is unchanged. Decision 5's no-recheck between pages goes in the commit message.
- [ ] **Step 4: Run** `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts src/cloud-translation.exchange.test.ts src/translation-cloud-fixture.test.ts src/content-suggestions-api.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Walks ended between pages, oversized pages and a real-size walk

**Files:**
- Test: `apps/server/src/content-suggestion-runner.test.ts` (no production change is expected; if one of these fails for a reason Tasks 3-6 did not cover, fix it test-first in the file that owns the behaviour and say so in the commit)

**Interfaces:**
- Consumes: Task 6's `cursors` and `lossy`; fixture `collectReply`, `pageBytes`, `calls[].replyBytes`, `expire`, `statusOverride`, `service`; `contentSuggestionsAlertSource` from `./alert-sources.js`.

- [ ] **Step 1: Write the tests** (three products, `f.pageItems(1)` unless stated). Each "between pages" case first lets page 0 be stored and makes the cursor-1 collect fail once through `lossy` (throwing `cloud.unavailable` before calling the fake), so the walk stops between pages; the arrangement below then happens before the next step:
  - `it.each` "a walk Cloud ends between pages (%s) keeps the stored page, sends no release and says what could not be done": (a) `f.expire(jobId)` and `f.statusOverride({ state: "done" })` → the next collect gets 410; (b) the job deleted from `f.jobs` → 404 `translation_job_not_found`. Each: run view `expired`, `code: "content.suggestion_expired"`, `waiting: 1`, `failed: 2`; no `RELEASE`; and `contentSuggestionsAlertSource().read({ tx, now })` (as `alert-sources.test.ts:1341` calls it) returns one notice with `code: "content.suggestions_ready_partly"` and `params: { count: 1, failed: 2 }`. Failing case without Decision 8: `content.suggestions_ready` with `failed: 0` — the full-job wording.
  - `it("a cursor Cloud refuses as invalid ends the job rejected without a release")` — set the running job's `collectCursor` to 99 directly: actions end `[STATUS, COLLECT]`, run view `failed`, `code: "cloud.request_invalid"`.
  - `it("a walk the box ends itself between pages keeps the stored page and sends no release")` (Review Focus 4) — after the stop, `f.service("unconfigured")` and `f.client.refresh()`, as the test at :573 does: the next step ends the job without a call; run view `failed`, `code: "cloud.not_configured"`, `waiting: 1`, `failed: 2`; no `RELEASE`.
  - `it("refuses a page over 16 MiB, stores nothing of it, and resumes at the same position")` — `collectReply` returns, for cursor 1 and only once, the real page padded with spaces to 16,777,217 bytes (sent by the fake's real HTTP server, so the reader counts it): the step rejects `cloud.unavailable`; `collectCursor` stays 1; the next step stores page 1 and the walk completes with one `RELEASE`.
  - `it("walks a result over 16 MiB in pages within 16 MiB")` — default budget (no `pageItems`), 300 products, a translator returning for each item one `en` name and ten `internal` corrections whose `wrong` and `right` are 500 copies of `"\u0001"` and `"\u0002"` (six bytes each in JSON, so about 60 KB an item and about 18 MB in all): at least two collects; every `replyBytes` `<= 16_777_216`; 300 names stored; one `RELEASE`, after the last collect. Timeout 120 s, as the 1,005-item test has. Failing case on `main`: one page stored, then `RELEASE`, printing fewer than 300 names.
- [ ] **Step 2: Run them** — `pnpm --filter @waitron/server exec vitest run src/content-suggestion-runner.test.ts`. Expected: PASS (they test Tasks 3-6's behaviour). Any that fails is a defect to fix test-first, per Files above.
- [ ] **Step 3: Prove the loop by deletion.** Two throwaway edits, each restored before the next: (1) the loop runs one iteration — "collects every page…" and "walks a result over 16 MiB…" must fail; (2) `storeSuggestionPage` finishes the job on every page — "never sends release before the last page is stored" must fail (its step resolves instead of rejecting). And one for Decision 8: (3) `recordSuggestionJobEnded` without the new counting — the 410/404 cases must fail on the notice's code. Record all three in the commit message.
- [ ] **Step 4: Commit.**

### Task 8: Documentation and the backlog

**Files:**
- Modify: `docs/developers/cloud-connection.md` ("Translate all", :100-136), `docs/backlog.md` (the Task 21 entry, :998-1002), `docs/backlog/catalogue.md` (:682 onward), `docs/superpowers/plans/2026-10-14-translate-all.md` (a dated pointer under Task 21)
- Create: `docs/superpowers/plans/2026-10-19-translate-all-collect-pages.md` (this plan, committed so PR 2's runbook travels with the code)

- [ ] **Step 1:** In `cloud-connection.md`, replace "the runner collects the results and stores them as suggestions. Then it releases the job" with the paged walk: each page of at most 16 MiB is stored with the position of the next one in one transaction; a lost reply or a restart fetches from that position; the job is released only after the last page is stored and every item is accounted for, and a walk that ends short is ended without a release; a walk Cloud ends between pages (released or expired) keeps what was stored, is shown expired, and the notice says how many could not be done. Grep for every other sentence about collect or its reply limit (`/usr/bin/grep -rn -i -E "collect|116" docs apps/server/src/*.ts`) and update each one this branch makes stale.
- [ ] **Step 2:** The backlog entry for Task 21 and its detail: Cloud's side exists; the box pages collect (this PR); what remains is PR 2 below and the joint proof Cloud's gate asks for. New entries: (1) "shared collect-page vectors" (see PR 2, "What can be automated"), naming the fake's stricter key-order check (`translation-cloud-fixture.ts`'s `jobIdIn` against Cloud's sorted keys, `machine.ts:33-34`) as one drift those vectors would catch; (2) a job that ends before any page is stored (expired, service off, 24-hour clock) still leaves `failed` at the last status reading, so the notice for earlier jobs' waiting suggestions does not mention its lost items (Decision 8's limit); (3) open question 1's choice if the owner overrides the default.
- [ ] **Step 3:** `pnpm exec prettier --file-info` on each changed doc (the `docs/` tree is ignored by prettier, CLAUDE.md §2), then commit.

---

# PR 2 — Task 21's end-to-end check against a local Waitron Cloud

> **2026-10-19:** part 2a ran and passed; its record is under Task 21 of
> [the Translate all plan](2026-10-14-translate-all.md). Step 5's origin had to be
> `http://localhost:3000`, not `127.0.0.1`. Part 2b is lane D's Cloud script.

**What it is.** It cannot be a committed Waitron test: it needs a running Cloud (its account server, its worker and PostgreSQL) from another, closed repository, and Waitron's CI has none. It is two things:

- **2a, a recorded manual run on the Santet venue** — the original Task 21, adapted to paging. Its only commit is docs-only (the run record and the backlog), pushed direct under the docs-only rule; a defect it finds is fixed test-first in its own PR against the task that owns the code, and the run repeated.
- **2b, the joint fault proof** Cloud's gate asks for (quote 7), which is better done as an automated script in the **Cloud** repository than by hand — see "What can be automated" below.

## 2a: the Santet run

Preconditions: PR 1 is on `main`; Cloud `origin/main` carries the paging code (record its SHA and Waitron's at the start of the record; quote 7 asks for "pinned … candidates"). The owner is away until 2 November, so the run uses a fake provider (open question 3).

- [ ] **Step 1: Reconcile the vectors** — exactly as Task 21 Step 1 of `docs/superpowers/plans/2026-10-14-translate-all.md`.
- [ ] **Step 2: Prepare the Santet worktree.** `/Users/clintongormley/workspace/worktrees/waitron-local-santet-data`, branch `local-santet-data` (no commits of its own on 2026-10-19: `git log main..HEAD` is empty). `git merge --ff-only main`. Check what holds the venue before any reset — `lsof +D ~/workspace/.waitron-dev/instances/waitron-local-santet-data/box/venue` and `lsof -i :8180` — then rebuild with `local/square/reset.sh` only, **never `wa-wt reset`** (its README: the venue is on wa-wt's second slot and holds Santet's real Square data).
- [ ] **Step 3: Start a local Cloud from the pinned SHA** in a throwaway worktree of `~/workspace/repos/waitron-cloud` (`git worktree add --detach <mktemp dir> <sha>`, never switching that checkout's branch), following its `docs/local-deployment.md` to build and migrate the Compose stack (`--env-file deploy/local-stack/local.env`; the account server publishes on 127.0.0.1:3000 and PostgreSQL on 55432 per that file). Then, per `packages/translation/README.md`: set `CLOUD_TRANSLATION=1` in the shell and recreate `account` with the same `--env-file`; run the worker on the host (not the Compose profile — "Inside a container, loopback means that container") with `DATABASE_URL` set to the stack's PostgreSQL, `CLOUD_OPENAI_API_KEY=sk-local-fake` and `CLOUD_OPENAI_BASE_URL=http://127.0.0.1:<port>/v1`: `pnpm translation:worker`.
- [ ] **Step 4: Start the fake provider** — a scratch wrapper in `~/waitron-campaign-b/a689-21-e2e/` (not committed) that imports Cloud's `packages/translation/test/fake-openai.ts` from the throwaway worktree and serves `echoFirstPass` for first passes and `emptyReview` for reviews. To make the result exceed 16 MiB, its first pass also returns, for each product, ten `internal` corrections whose `wrong` and `right` are 500 characters each: Cloud's `checkFirstPass` (`packages/translation/src/reply.ts`) keeps up to 10 corrections whose trimmed texts are 1 to 500 characters and differ. Choose the character from the expected item count: with `"€"` (3 bytes) an item carries about 30 KB of corrections, so the job needs about 560 items with languages to write to pass 16,777,216 bytes; with `"\u0001"` (6 bytes in JSON) about 280. Record the item count, the character and the estimate before pressing Translate all.
- [ ] **Step 5: Point Santet at it and pair.** `WAITRON_CLOUD_ORIGIN=http://127.0.0.1:3000` (Cloud's `docs/local-pairing.md`: "HTTPS is required; `WAITRON_ENV=dev` also permits HTTP on loopback"); find how `wa-wt` passes environment to the server before starting it. Pair through Cloud services; give consent on `http://127.0.0.1:3000/account` (contract, "Consent"); check Cloud services lists Translate all as ready.
- [ ] **Step 6: Run it** — Task 21 Step 5's list unchanged (progress line, number of Cloud jobs and a second job starting by itself, the bell notice and its clearing, drafts marked Suggested, saving a page, discarding one, closing and reopening, a second browser, Refresh on Cloud services while a job runs). Add enabled languages first if Santet's gaps are too few for Step 4's estimate (Cloud allows 20).
- [ ] **Step 7: Check the walk.** In Santet's `venue.db` (read with `exclusive: false` or after stopping the server): the job's `collected_refs` holds as many refs as its `total`, `dropped` is what the fake's nine surplus corrections per item predict (9 × items with a fix stored), and `released` is true. In Cloud's PostgreSQL: the job's `translation_job_bodies` row is gone and `translation_jobs.state` is `collected`. From Cloud's account-server request log, or the box's own log if Cloud's does not show it: the collect cursors in order, then one release after the last.
- [ ] **Step 8: Report** in the form "pressed X, saw Y" (CLAUDE.md §1), with both SHAs, timings, counts of suggestions, failures and drops, and the page count. Then reset Santet with `local/square/reset.sh` (the run changed its languages and stored suggestions). Docs-only commit: the record appended under Task 21 in `docs/superpowers/plans/2026-10-14-translate-all.md`, and the backlog entry deleted — or, for each failure, a backlog entry.

## 2b and what can be automated

- **Already automated on the box side (PR 1):** multi-page walks, a lost page reply, a restart resuming at the saved position, a page replayed after commit and after rollback, a ref repeated across pages, a last page that leaves an item unaccounted, a page over 16 MiB (counted through a real HTTP server, and against a misleading `Content-Length` through a mocked `fetch`), a compressed reply, a reply with no `nextCursor`, a 429 and a 503 mid-walk, release and expiry between pages with the notice's wording, and release only after the complete walk — all against the fake Cloud, whose paging follows Cloud's `collect-page.ts`.
- **Not automatable in Waitron:** anything needing Cloud's real code and PostgreSQL. The fake can drift from Cloud; nothing in either repository compares them for paging (the shared vectors cover submit signing only).
- **Recommended instead of fault injection by hand:** Cloud already runs a joint proof of this shape. `scripts/test-waitron-pairing.mjs` on Cloud `main` spawns Waitron's `apps/server/scripts/cloud-integration-fixture.ts` (a real Waitron server process, `WAITRON_ENV=dev`) against disposable PostgreSQL and an in-process Cloud, and per `docs/local-pairing.md` "discards a committed completion reply and recovers the result" and restarts the Waitron processes. A sibling `scripts/test-waitron-translation.mjs` (lane D, Cloud repository) can drive the box's own routes (`POST /management-api/content-suggestions/jobs`, `GET /management-api/content-suggestions`) with a fake provider and, from inside Cloud, drop a page reply, kill and restart the box between pages, drop the release reply, and expire the job between pages — the joint gate's list — with no proxy (a proxy would change the origin the box signs, which Cloud compares with its own). The box's runner starts with `startServer` whenever a Cloud connection exists (`apps/server/src/boot.ts:2167`), so I expect Waitron to need no change for it; if the script needs a seed (products with missing languages) the fixture cannot reach through the management API, that is a small Waitron PR. Open question 4.
- **Shared collect-page vectors**, generated by Cloud from fixed items, outcomes and a budget and checked by both Cloud's `collectPage` and Waitron's fake, would catch fake-versus-Cloud drift in CI on both sides. Backlog entry in Task 8; it is a contract change for lane D.

---

## Where the box and the contract disagree, beyond the named items

1. **A pre-paging collect reply** (no `nextCursor`) is read today as the whole job and released; under the contract it is page one of an unknown walk. Fixed by Task 5's refusal.
2. **Collect's 30-second read deadline** was set for one reply of any size; a 16 MiB page needs about 4.5 Mbit/s to arrive in 30 s, and a box on its 4G fallback can be slower. A page that never arrives in time is retried with back-off until the box's 24-hour clock ends the job. Open question 1.
3. **Unanswered items on a complete walk**: today's box counts them failed, completes and releases; the contract says complete only when all `total` refs are accounted for. Decided by the contract (Decision 7), not asked.
4. **An interrupted walk raised the full "Translations ready" notice** (`failed` left at the last status reading, usually 0), against "never report those pages as a full job". Fixed by Decision 8 within the owner's Q5 answer; the case of a job ending before any page is a backlog entry.
5. **The box tolerates more than the contract sends**: extra reply keys, whitespace, and names longer than 500 characters (it bounds stored names at 4,096 bytes, `TRANSLATION_NAME_BYTES`). Not changed; none of these lets a partial walk pass as complete.
6. **Lane B's note says "a signed `cursor`"**: it is signed only in the sense that it travels inside the signed body; it is a plain whole number, and any in-range position is valid (quote 2).

## Open questions for the owner (each with the default this plan builds)

1. **Collect's read deadline.** (a) 120 seconds a page — enough for 16 MiB at about 1.1 Mbit/s — **default**; (b) keep 30 seconds; (c) no fixed deadline, only a stalled-stream timeout. Worked example: a 12 MiB page over a 2 Mbit/s 4G link takes about 50 s; under (b) it fails every time and the job never finishes, under (a) it arrives.
2. **Suggestions from an interrupted walk.** (a) keep them for review, the run shown as expired and the notice saying "N couldn't be done this time" — **default**; (b) delete them when the walk is interrupted, so a run either delivers everything or nothing.
3. **Provider for the Santet run.** (a) Cloud's fake provider: no menu leaves the machine and nothing is spent, but it proves the protocol, not translation quality — **default** (the owner is away until 2 November, and Cloud's README keeps real-key runs for the owner); (b) the real key, spending the owner's money and sending Santet's real menu to the provider.
4. **Who builds the joint fault proof.** (a) lane D, as a Cloud script beside `test-waitron-pairing.mjs`, with lane B supplying any Waitron fixture change — **default**; (b) lane B by hand during the Santet run through a proxy, which first needs Cloud configured to treat the proxy's address as its own origin.

## Could not pin down

1. How the box should behave on the rate limit is not in the contract beyond "existing … limits"; the numbers (60 a minute per address, 30 per installation) are from Cloud's code, `packages/account-http/src/translation.ts`.
2. Whether anything in front of a production Cloud compresses replies. Cloud's code does not (`c.json`); the box handles both.
3. Cloud's cost estimate per item for the monthly cap: if the local Santet job is refused with `translation_limit_reached`, the run record says so with `fits`; I found no local override in the files I read.
4. The exact commands to build, migrate and expose the local Cloud stack, the PostgreSQL URL from the host, and how `wa-wt` passes `WAITRON_CLOUD_ORIGIN` — the run's steps point at the guides rather than quoting commands I did not run.

---

## Self-review

- **Contract coverage.** Signed cursor and its default (Task 5, Decision 1); cursor checks and their order (Task 1's fake, Task 5's refusal mapping, Task 7's 400 test); 16 MiB decoded, regardless of `Content-Length` or compression, oversized or incomplete refused (Tasks 5 and 7); exact fields and `nextCursor` arithmetic (Task 5, Decision 6); repeated cursor gives the same page (Task 1); persist each page with its next cursor in one transaction (Task 3); dedupe per job (Task 3); crash retries (Tasks 3 and 6); complete only after the null-cursor page and all `total` refs accounted (Task 4, Decision 7); 410 between pages, partial kept distinct in the run and the notice, no release on its behalf (Tasks 4 and 7, Decision 8); release only after the walk (Tasks 6 and 7); failed job's release path unchanged (no task changes it; the existing runner tests at :251 stay); joint gate (PR 2).
- **Step scan.** Each test step names its test, its assertions and what the failing case prints; each code step names the signature, the file and the values.
- **Type consistency.** `SuggestionPage` (Task 3) is what Task 5's `CollectedPage` omits `cursor` and `reason` from and what Task 6 stores; `PageStored` (`"stored" | "complete" | "ended" | "stale"`) is what Task 6 branches on; `collect(jobId, cursor, signal?)` is the same in Tasks 5-7; `collectCursor`/`collectedRefs` (Task 2) are what Tasks 3-7 read.
- **Proportion.** Eight tasks, code blocks only for the two new types.

## Revision log

**2026-10-19, after the fresh-context review** (`item-a689-21-plan-review.md`). Each change was checked against the code or Cloud before it was made.

- **H1** — `collected()` gains `nextCursor: null` (Task 5 Step 1) and Task 5 Step 5 runs the `readResult` control. The reviewer's experiment 4 is the receipt.
- **H2** — open question 2 removed: the contract decides it. New Decision 7 and Task 4: the last page completes the walk only when every sent ref is in `collected_refs` and their count equals Cloud's `total`; otherwise the job ends `failed`/`rejected` with no release. The check counts accounted refs, not raw entries as the review's first wording had it, because the contract also requires the box to drop a result it did not send. Reading the tests showed this changes two of them (Changed test checks 5 and 6).
- **M1** — new Decision 8. When a job that has stored at least one page is ended early, its unreceived items are counted failed, so the existing source raises the `_partly` notice ("N couldn't be done this time"), the owner's own Q5 wording. The alert source is not changed. Task 7 reads the notice after an interrupted walk. `alert-sources.test.ts` seeds rows directly (`:1341-1400`), so it is unaffected. A job ended before any page is a backlog entry.
- **M2** — new "Changed test checks" section, to be copied into the PR. Task 1 Step 4's claim is corrected: :543 is edited in Step 1 and expected to fail in Step 2.
- **M3** — Task 5 split into Task 6 (the loop and its five tests) and Task 7 (walks ended between pages, oversized and real-size pages, the deletion proofs).
- **M4** — the `Content-Length` test is a mocked-`fetch` test with a valid padded page. Real-server oversize coverage stays in Task 7.
- **M5** — Task 3 Step 1 is an explicit rename, with typecheck, covering `cloud-translation.ts` and `content-suggestion-store.test.ts:625`.
- **L1** — when no item fits a page, Cloud answers `503 temporarily_unavailable` with `Retry-After: 1` (`app.ts` `publicError`; the throw is at `collect-page.ts:29`). The fake does the same, and the item is removed from "Could not pin down".
- **L2** — a test now pins the 120 s deadline through `AbortSignal.timeout`, stated as weaker than its name.
- **L3, L7** — Task 7 now says how each between-pages arrangement happens, and Task 6's release test describes its failing case as the step resolving.
- **L4** — the fake measures incrementally.
- **L5** — Task 1 Step 4 runs `content-suggestions-api.test.ts`.
- **L6** — a new test covers Decision 4's ignored failed ref.
- **L8** — Decision 5 states that the loop does not re-check between pages, and why.
- **L9** — the key-order drift is named in Task 1 and in the shared-vectors entry.
- **L10** — line numbers corrected.
- **L11** — the A682 migration check and whoever-lands-second regeneration are in Global Constraints and Task 2 Step 0.
- **Line references** — two references to `content-suggestion-store.ts` corrected to :96-101 and :181.
