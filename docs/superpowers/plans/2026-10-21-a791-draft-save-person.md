# A791: each draft save names whose order it is — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A till's order save says which person's order it is, and the server refuses a save whose person is not the one signed in on that device, so an order typed by Ana can never be saved as Ben's.

**Architecture:** The till's save body gains `personId`, taken from the `DraftSync` that holds the order (fixed when the order was opened for that person). The save route `PUT /api/parties/:id/drafts` requires the field and compares it with the session's person before it opens a transaction, so a refusal writes nothing. The till treats the new refusal quietly: it stops saving that order and keeps the unsaved lines for their own person, as it already does when a sign-in drops another person's orders.

**Tech Stack:** TypeScript, Hono routes (`apps/server`), Lit till app (`apps/till`, Vitest browser mode in Chromium), `node:sqlite` venue database through `useVenueDb`.

**Spec:** backlog entry A791 in `docs/backlog.md` (lines 2386–2392 at `f17a43ad5`) and the owner's answer to Q35 (option A), relayed verbatim: "Yes: each till order save names whose order it is, and the server refuses a save whose person is not the one signed in on that device. Build it as backlog A791 says (one small server change, with a refusing case and the legitimate same-person save still served)."

**Review path:** FULL (the change is an authorisation check). No migration.

## What was found, with receipts

These settle the questions the plan had to answer. Each says how it was established.

1. **The gap is real, and it is only a new order.** A throwaway probe, appended to
   `apps/server/src/till-api.drafts.test.ts` and removed afterwards (run 2026-10-21 in this
   worktree: `cd apps/server && pnpm exec vitest run src/till-api.drafts.test.ts -t "A791 PROBE"`,
   `1 passed | 74 skipped`), sent two saves from the administrator's session that named Ana in a
   `personId` field:
   - onto Ana's existing order: `409 draft.taken_over`;
   - a new order on a fresh table: `200`, and the saved order's `ownerId` was the administrator's id
     (`3c0d2d40-…`), not Ana's (`63d04cd7-…`).

   So an unknown `personId` field is ignored today, and the existing guard covers only a bill that
   already has an editor. The brief's name for that guard, `requireOwnDraftAt`, does not exist
   (`git grep requireOwnDraft` finds nothing); the guard is `requireBillEditor`
   (`apps/server/src/bill-editing.ts:209-220`), which `saveDraft` calls at
   `apps/server/src/order-drafts.ts:491`. On a bill with no editor it passes, and `saveDraft`
   then takes the bill for the session's person (`acquireBillEditor`, `order-drafts.ts:556`) and
   inserts the order with `ownerId: operatorId` (`order-drafts.ts:558`).
2. **Which person the till sends.** `DraftSync` stores `personId` once, in its constructor
   (`apps/till/src/state/draft-sync.ts:283`, `:320`). The app builds it with
   `personId: this.#sessionPersonId` (`apps/till/src/till-app.ts:10541`) when it opens a table, and
   `#sessionPersonId` changes only at a sign-in (`till-app.ts:4838`) or a server switch (`:1951`,
   where every order is dropped at `:1956-1957`). So a save that Ana's timer fires after Ben's
   cookie has arrived still carries Ana's id. The save itself is built in `#saveNow`
   (`draft-sync.ts:790-799`); it is the only caller of `TillApi.saveDraft`
   (`git grep -n "saveDraft(" -- apps/till/src` outside tests).
3. **Where the server compares.** In the route, right after it reads `draftId` and `revision`
   (`apps/server/src/till-api.ts:3507-3508`) and before `withTransaction` (`:3509`). The comparison
   needs nothing from the database, so refusing there writes nothing and opens no transaction.
   `saveDraft` itself is left alone: its direct callers (`saveDraftForTest`,
   `apps/server/src/testing/draft-command-fixture.ts:24`, and the database suites) pass the person
   explicitly and are not a path a cookie can change.
4. **The error code** is `draft.person_not_signed_in`, params `{ personId: string }` (the person
   the save named). Siblings: every draft refusal is `draft.*` — `draft.taken_over`,
   `draft.out_of_date`, `draft.not_found`, `draft.already_submitted`
   (`apps/server/src/errors.ts:468-492`); `git grep -E 'startsWith\("(session|draft)\.'` finds no
   prefix matcher a new `draft.` code could trip. **Status 409**: by the owner's rule in
   `docs/developers/conventions-data.md:39-41`, "a clash with stored data → 409" — the body is
   well formed and names a real person, but the device's stored session now names someone else.
   This matches `draft.taken_over: 409` (`till-api.ts:594`).
5. **A missing or malformed `personId` is refused** `400 management.request_invalid`
   `{ field: "personId" }` through `requireBodyUuid` (`packages/server-kit/src/request-screens.ts:43-47`).
   Nothing is kept for an older till build: CLAUDE.md §3, "No backwards-compatibility or
   data-migration code until Waitron is in production."
6. **The till's strings.** The till never shows this refusal (Task 1), so no English or Spanish
   wording is added to `apps/till/src/i18n/codes.ts`. `scripts/errors-reachable.test.ts` scans
   `packages/` only (its `PACKAGES_DIR`, line 21), and `till-api.ts` already imports
   `./errors.js` (`till-api.ts:256`). `scripts/alert-codes.test.ts` is about recorded incident
   codes, which this is not.
7. **What the till does today with a not-your-order refusal.** In the real race, Ben's sign-in runs
   `#dropOthersDrafts` (`till-app.ts:4837`, `:10642-10655`) synchronously after the login answer
   (`apps/till/src/screens/till-lock-screen.ts:244-258` dispatches `logged-in` straight after
   `api.login` resolves), so by the time any refusal comes back the order has been dropped, and
   `#saveNow` answers `"failed"` without calling `onRefused` (`draft-sync.ts:802`, `#ended` at
   `:738-740`). That ordering is read, not run. If a refusal did reach a live order, the existing
   handling of a code outside `DRAFT_REFUSALS` would mark the edit unsaved and stop
   (`draft-sync.ts:849-857`), but the bill refresh every 15 s (`till-app.ts:10669-10676`) calls
   `sync.load()` (`:10687`), and `#load` schedules the save again when edits are unsaved
   (`draft-sync.ts:544`) — a retry every 15 s. Task 1 closes that.
8. **The other order-writing routes** (read, not run, except the submit case, which
   `till-api.drafts.test.ts:643-677` already pins):
   - submit, split and discard each name an existing order (`:did`) and go through
     `requireBillEditor` (`order-drafts.ts:1101`, `:189`, `:954`), so a foreign person is refused
     `draft.taken_over`; they have no new-order gap.
   - `POST /api/dead-ends/draft` (`till-api.ts:3602-3662`) only reads.
   - **Take-over** (`till-api.ts:3573`) and **recall into the order**
     (`POST /api/parties/:id/lines/:lineId/recall`, `till-api.ts:3446`, which can take an empty
     bill for the session's person at `apps/server/src/draft-recall.ts:257`) both act as whoever
     the session is. Both are started by a tap, and the till sends each only after its save queue
     (`#takeOver` awaits it at `draft-sync.ts:602`, `runCommand` at `:659`), so one started by Ana and sent after Ben's
     cookie arrived would act as Ben. Whether the lock screen's appearance always stops such a
     command first has not been traced. This is left open as a backlog entry (Task 3); it is not
     fixed here.

## Global Constraints

- Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-a791-draft-save-person`,
  branch `feat/a791-draft-save-person`. Every commit `git commit -s`, staging explicit paths only.
- General code is English only (CLAUDE.md §3); this change adds no translation.
- Wire field name: `personId`. Error code: `draft.person_not_signed_in`, params `{ personId: string }`, status 409.
- Do not touch the hunks of lane G's open branch `feat/a773-2-pass-lifetime`:
  `apps/server/src/till-api.ts` imports and the course/group verb mounts at about lines 45–176,
  1151–1200, 2235–2257 and 3198–3210; `apps/till/src/till-app.ts`'s `.fireControl=` bindings near
  17366–17644; `apps/till/src/till-app-drafts.test.ts` lines near 178 and 8227. This plan's edits
  sit at `till-api.ts` ~594 and ~3500–3510, `till-app.ts` ~102, ~9999 and ~10732, and
  `till-app-drafts.test.ts` ~1836–1916, ~8309 and ~9121 onward.
- Run focused tests only (CLAUDE.md §2); CI runs the package suites. Read each run's `Tests` count.
- Comments only for an invariant the code cannot show (CLAUDE.md §1, last rule). A comment that
  says the refusal is "safe" or "unreachable" is a claim and needs its receipt.
- Backlog A792 (`docs/backlog.md:2394`) is a separate item; leave it.

## Review Focus

1. **Ana signs back in after the restart and carries on.** Her save names Ana under Ana's session
   and must be served — Task 3's legitimate case.
2. **A person id in another letter case.** The till sends the id the server gave it, but a
   hand-built request may differ in case; the route lower-cases the named id before comparing (as
   `requireDraftPartyParam` does for parties, `till-api.ts:1080-1082`). Task 3 tests Ana's id in
   upper case from Ana's session: served.
3. **An empty save (lines `[]`) naming someone else.** `saveDraft` answers an empty save on a bill
   with no order early, with `200` and no order (`order-drafts.ts:492`). The check sits in the
   route before that, so it is refused too. Task 3 tests it.
4. **The refusal reaching an order that is still on screen.** It must not retry every 15 s nor
   show Ben an error. Task 1's draft-sync case checks no later save follows; its app case checks
   no banner.
5. **A refusal that writes nothing at all**, including no bill editor taken. Task 3 compares the
   whole database before and after, as the existing `snapshot()` cases do.

---

### Task 1: The till names the order's person in each save and stays quiet when that is refused

**Files:**
- Modify: `apps/till/src/api/client.ts:827-833` (`DraftSave`)
- Modify: `apps/till/src/state/draft-sync.ts` (`DRAFT_PERSON_REFUSAL` beside `DRAFT_REFUSALS` at :25; the body at :792-798; `#refused` at :839-858)
- Modify: `apps/till/src/till-app.ts` (import at :102; `#releaseDraft` at :9999; `#flushDraft` at :10732)
- Modify: `apps/till/src/widgets/test-helpers.ts:444` (the fake's `save` helper type)
- Test: `apps/till/src/state/draft-sync.test.ts`, `apps/till/src/till-app-drafts.test.ts`, `apps/till/src/api/client.test.ts`, `apps/till/src/api/client.bill-editing.test.ts`

**Interfaces:**
- Produces: `DraftSave.personId: string` — "the person whose order this is; the server refuses the save unless it is the person signed in on this device".
- Produces: `export const DRAFT_PERSON_REFUSAL = "draft.person_not_signed_in";` in `draft-sync.ts`.

- [ ] **Step 1: Write the failing tests in `apps/till/src/state/draft-sync.test.ts`**

  In `describe("DraftSync: saving")`:
  - `it("names the sync's person in every save, whoever signs in later")`: `const draft = sync("p7");` load, `addProduct(beer, "1")`, `settle()`; expect `server.saveDraft.mock.calls[0]![1].personId` toBe `"p7"`; add steak, settle; expect the second call's `personId` toBe `"p7"`.

  In `describe("DraftSync: a refused save")`:
  - `it("stops saving an order refused for its person, keeps it for that person, and says nothing")`: load; `server.saveDraft.mockRejectedValueOnce({ code: "draft.person_not_signed_in", status: 409 })`; add beer; expect `await draft.flush()` toEqual `{ refused: "draft.person_not_signed_in" }`; expect `refused` toEqual `[]`; expect `server.listDrafts` toHaveBeenCalledOnce (no re-read); expect `draft.candidate?.lines.map((line) => line.product.name)` toEqual `["Beer"]`; then `draft.store.addProduct(steak, "1")`, `await draft.load()`, `await settle()`, and expect `server.saveDraft` toHaveBeenCalledOnce and `await draft.flush()` toBe `"failed"`.
  - `it("answers failed and says nothing when that refusal lands after the order was dropped")`: modelled on "does not send a save once dropped" (:501): hold the first save with a deferred that then rejects `{ code: "draft.person_not_signed_in", status: 409 }`; `drop()` before releasing it; expect the queued flush toBe `"failed"`, `refused` toEqual `[]`, and `server.listDrafts` toHaveBeenCalledOnce.

  In `apps/till/src/till-app-drafts.test.ts`, `describe("till-app: a save the server refuses")` (:1836), beside "says nothing when the session had already ended" (:1906):
  - `it("says nothing when the save's person is no longer the one signed in")`: `mountApp({ saveDraft: vi.fn().mockRejectedValue({ code: "draft.person_not_signed_in", status: 409 }) })`, `openMesa`, `tap(el, "Beer")`, `back(el)`; expect `banner(el)` toBeNull.

  In `describe("A773 retained bill candidates in the app")` (:9121), using its `reopen`:
  - `it("names the signed-in person in each save, and the next person in theirs")`: `mountApp()`, `openMesa(el)` (signs in as `p1`), `tap(el, "Beer")`, flush past `DRAFT_SAVE_DELAY_MS`; expect `api.saveDraft.mock.calls.at(-1)![1].personId` toBe `"p1"`; `emit(tableOrder(el)!, "logout")`, flush, `reopen(el, "p2", "Luis")`, `tap(el, "Steak")`, flush; expect the last call's `personId` toBe `"p2"`.

- [ ] **Step 2: Run them and watch them fail**

  `pnpm --filter @waitron/till exec vitest run src/state/draft-sync.test.ts src/till-app-drafts.test.ts -t "person"`
  Expected: the new cases FAIL (`personId` undefined; the refusal is reported through `onRefused` and the bill refresh saves again; the banner shows the generic table error).

- [ ] **Step 3: Implement**

  - `DraftSave` gains `personId: string` (doc line as in Interfaces).
  - `#saveNow` sends `personId: this.personId` in the body.
  - `#refused`: when `refusal.refused === DRAFT_PERSON_REFUSAL`, set `this.#unsaved = true`, call `this.drop()` (which keeps the lines as this person's candidate, `draft-sync.ts:729-736`), and return the refusal without calling `onRefused`.
  - `till-app.ts`: at `#releaseDraft` (:9999) and `#flushDraft` (:10732), treat `DRAFT_PERSON_REFUSAL` exactly as `"session.required"` is treated there (no error set).
  - `test-helpers.ts:444`: the fake's `save(partyId, save: Omit<DraftSave, "expectedEdit" | "personId">)` so its direct callers stay as they are.

- [ ] **Step 4: Grow the existing body expectations** (changed checks — each grows by the new field and nothing else, because every save now carries it):
  - `draft-sync.test.ts:333` ("saves three taps on Beer once…"), `:356` ("sends the next save with the id and revision…"), `:395` ("never has two saves out…"): add `personId: "p1"` to the expected body.
  - `till-app-drafts.test.ts:8309` (recalled-source note save): add `personId` with the signed-in person's id (`"p1"` unless that case signs in someone else).
  - `client.test.ts:4593` (the PUT body `saveDraft` sends): add `personId` to both the call and the expected body; `client.test.ts:4553`, `:4582`, `:4610` and `client.bill-editing.test.ts:91` gain `personId` in the `DraftSave` they build (fixture growth, for the type).
  - `pnpm --filter @waitron/till typecheck` lists any other `DraftSave` literal missing the field; add it there too.

- [ ] **Step 5: Run and see them pass**

  `pnpm --filter @waitron/till exec vitest run src/state/draft-sync.test.ts src/till-app-drafts.test.ts src/api/client.test.ts src/api/client.bill-editing.test.ts src/state/draft-editing.test.ts`
  Expected: every file passes, with a `Tests` count shown. Then `pnpm --filter @waitron/till typecheck` and `pnpm format:check`: both exit 0.

- [ ] **Step 6: Proof by deletion** — remove the `drop()` call from the new branch of `#refused`; the "stops saving an order refused for its person" case must fail on the later save. Restore it.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/till/src/api/client.ts apps/till/src/state/draft-sync.ts apps/till/src/till-app.ts apps/till/src/widgets/test-helpers.ts apps/till/src/state/draft-sync.test.ts apps/till/src/till-app-drafts.test.ts apps/till/src/api/client.test.ts apps/till/src/api/client.bill-editing.test.ts
  git commit -s -m "The till names whose order each save is, and stops saving one refused for that"
  ```
  (Add any other file Step 4's typecheck made you touch.)

---

### Task 2: The save route requires `personId`, and every server test that saves an order sends one

**Files:**
- Modify: `apps/server/src/till-api.ts` (the save route, ~3500-3510)
- Modify: `apps/server/src/testing/draft-command-fixture.ts:108-184` (`observedDraftCommandBody`)
- Test: `apps/server/src/till-api.drafts.test.ts` and the HTTP-saving suites listed in Step 4

**Interfaces:**
- Consumes: nothing from Task 1 (the server already ignores an unknown field — receipt 1).
- Produces: `observedDraftCommandBody(db, method, path, body, personId?: string)` — for a save (`PUT /api/parties/:id/drafts`) whose object body has no `personId`, adds `personId` **before any of the function's early returns**, so a malformed-body case still reaches the route's own field check.
- Produces: in the route, `const personId = requireBodyUuid(body.personId, "personId").toLowerCase();` read after `requireRevision(body.revision)`.

- [ ] **Step 1: Write the failing test** in `till-api.drafts.test.ts`, `describe("a malformed body")` (:1084): a new `it.each` sent with `send(venue.app, adminCookie, "PUT", …)` directly (bypassing `draftBody`, so nothing fills the field), rows:
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID }]` (absent)
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID, personId: "ana" }]`
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID, personId: 7 }]`

  titled `"refuses a save 400 management.request_invalid naming %s for %j"`; each expects status 400, `refusal("management.request_invalid", { field })`, and `snapshot()` unchanged (as the existing table does).

- [ ] **Step 2: Run it and watch it fail**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts -t "naming personId"`
  Expected: FAIL — today these answer 400 naming `billId`-side fields or 200, not `personId`.

- [ ] **Step 3: Implement** the route read (Interfaces), and the fixture's optional `personId`.
  In `till-api.drafts.test.ts`, `draftBody` takes the caller's person and passes it on: `ana` passes `venue.operatorId`, `admin` passes `venue.adminId`.

- [ ] **Step 4: Grow every HTTP save's body** (fixture growth: the session's own person, no assertion changes). Where a file's saves go through `observedDraftCommandBody`, pass the caller's person to it; elsewhere add `personId` to each save body. Files that send `PUT /api/parties/:id/drafts` (from `grep -rlE '"PUT"' apps/server/src | xargs grep -lE drafts` plus the template-path search, 2026-10-21):
  `adjustments-report`, `attendance-till-api`, `bill-editing.bill-moves`, `bill-editing.commands`, `bill-unsent`, `course-retention`, `draft-discard`, `draft-recall-adjustments`, `draft-recall-split`, `draft-recall.modifiers`, `draft-recall`, `draft-split`, `made-here.routes`, `till-api.drafts`, `till-api.profile-zones`, `till-api.service-periods`, `till-api.zone-closed` (each `apps/server/src/<name>.test.ts`). `till-api.profile-actions.test.ts:463` is refused by the profile check before the body is read; change it only if its run fails. In a `BillVenue` suite, `venue.cookie` is Ana's session and her id is `venue.operatorId` (receipt 1's probe); read each other harness to find its cookie's person.

- [ ] **Step 5: Run and see them pass**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts src/adjustments-report.test.ts src/attendance-till-api.test.ts src/bill-editing.bill-moves.test.ts src/bill-editing.commands.test.ts src/bill-unsent.test.ts src/course-retention.test.ts src/draft-discard.test.ts src/draft-recall-adjustments.test.ts src/draft-recall-split.test.ts src/draft-recall.modifiers.test.ts src/draft-recall.test.ts src/draft-split.test.ts src/made-here.routes.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts src/till-api.service-periods.test.ts src/till-api.zone-closed.test.ts`
  Expected: all files pass, `Tests` count shown, none skipped beyond what each file skipped before. Then `pnpm --filter @waitron/server typecheck` and `pnpm format:check` exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/till-api.ts apps/server/src/testing/draft-command-fixture.ts <each test file changed>
  git commit -s -m "An order save names its person; a save without one is refused"
  ```

---

### Task 3: The server refuses a save whose person is not the one signed in; backlog updated

**Files:**
- Modify: `apps/server/src/errors.ts` (declare the code beside the other `draft.*` codes, ~468-492)
- Modify: `apps/server/src/till-api.ts` (`STATUS` ~594; the save route after Task 2's read)
- Test: `apps/server/src/till-api.drafts.test.ts`, `describe("PUT /api/parties/:id/drafts")` (:413)
- Modify: `docs/backlog.md`, `docs/backlog/till.md`

**Interfaces:**
- Consumes: Task 2's `personId` read and `draftBody(method, path, body, personId)`.
- Produces: `"draft.person_not_signed_in": { personId: string }` in `ErrorParams`, documented as "A till saved an order for a person who is not the one signed in on the device; nothing was written." `STATUS["draft.person_not_signed_in"] = 409`.

- [ ] **Step 1: Write the failing tests** (all through `send(…)` with an explicit `personId`, so the fixture does not fill it):
  - `it("refuses 409 draft.person_not_signed_in for a new order saved for someone else, writing nothing")`: `seated()`; `before = snapshot()`; from `adminCookie`, a new-order save (`draftId: null, revision: 0`, `billId` the main bill, `lines: [dish("Pulpo")]`, `expectedEdit` from `observedDraftCommandBody` or built as `{ billId, editorVersion: 0, draftId: null, draftRevision: null }`) naming `personId: venue.operatorId`. Expect 409, body `{ code: "draft.person_not_signed_in", params: { personId: venue.operatorId } }`, `snapshot()` toEqual `before`. Today this answers 200 with an order owned by the administrator (receipt 1).
  - The same refusal for an empty save (`lines: []`) naming `venue.operatorId` from `adminCookie` on a fresh party with no order: 409, same code, nothing written. (Today it answers 200 with `draft: null` — `order-drafts.ts:492`. On a bill where Ana already has an order the existing guard answers `draft.taken_over` instead, so that is not the case to use.)
  - `it("still saves the signed-in person's own new order, whatever case the id is written in")`: from Ana's cookie, `personId: venue.operatorId.toUpperCase()`; expect 200 and `draft.ownerId` toBe `venue.operatorId`. (The plain-case same-person save is already every other case in the file once Task 2's fixture fills the field.)

- [ ] **Step 2: Run them and watch the refusing ones fail**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts -t "person"`
  Expected: both refusing cases FAIL with status 200 (the first writes a new order owned by the administrator; the second answers `draft: null`); the same-person case passes.

- [ ] **Step 3: Implement** — in the route, right after reading `personId` and before `withTransaction`: if it differs from `session.personId.toLowerCase()`, throw `new AppError("draft.person_not_signed_in", { personId })`. Declare the code in `errors.ts` and its 409 in `STATUS`.

- [ ] **Step 4: Run and see them pass**, then the existing cases that pin the neighbouring rules:
  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts`
  Expected: the file passes, including "saves the session's person's draft, whatever operator the body names" (:623) and "refuses 409 draft.taken_over for a save or a submit by someone other than the owner" (:643), both unchanged.

- [ ] **Step 5: Proof by deletion** — comment out the new throw; the two refusing cases must fail with 200. Restore it.

- [ ] **Step 6: Backlog and decision record**
  - `docs/backlog.md`: delete the A791 entry (lines 2386–2392 at `f17a43ad5`). In the same area ("The till, devices and table service"), add one short entry: **A take-over or a recall into the order acts as whoever the session is (left open by A791, 2026-10-21).** Both are started by a tap and sent after the order's save queue (`apps/till/src/state/draft-sync.ts` `#takeOver` and `runCommand`); one started by one person and sent after the next person's sign-in answer would act as the next person (read, not run). Whether the lock screen always stops such a command first is not traced. If it does not, name the person in those requests as A791 did for the save.
  - `docs/backlog/till.md`, section "One editor per bill (owner, 2026-10-17; A773)" (:1634): add two sentences: each order save names the person whose order it is, and the server refuses `draft.person_not_signed_in` (409) unless that is the person signed in on the device (owner, Q35, A791); the till stops saving that order and keeps its lines for that person, without a message. Cite `apps/server/src/till-api.drafts.test.ts` and `apps/till/src/state/draft-sync.test.ts`.

- [ ] **Step 7: Checks and commit**

  `pnpm --filter @waitron/server typecheck && pnpm format:check` — both exit 0.
  ```bash
  git add apps/server/src/errors.ts apps/server/src/till-api.ts apps/server/src/till-api.drafts.test.ts docs/backlog.md docs/backlog/till.md
  git commit -s -m "The server refuses an order save for someone other than the person signed in (A791)"
  ```

---

## After the tasks

Run `/finish-branch` on the worktree (full wave: the change is an authorisation check). Its
checklist for the run-it seat: a save naming another person from a real session is refused with
nothing written, for a new order and an empty one; the same person's save is served; the till
sends the person of the order it holds.
