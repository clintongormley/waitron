# A791: each draft save names whose order it is — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** A till's order save says which person's order it is, and the server refuses a save whose person is not the one signed in on that device, so an order typed by Ana can never be saved as Ben's.

**Architecture:** The till's save body gains `personId`, taken from the `DraftSync` that holds the order (fixed when the order was opened for that person). The save route `PUT /api/parties/:id/drafts` requires the field and compares it with the session's person before it opens a transaction, so a refusal writes nothing. When the till meets the new refusal while it still believes that person is signed in, it signs that person out on this screen only — locks to the sign-in screen and keeps their unsaved lines for their next sign-in — without ending the device's session, which now belongs to someone else.

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
   The route already names the session's person `personId` (`const { personId } = session;`,
   `till-api.ts:3503`), so the body's value is read as **`namedPersonId`**. `saveDraft` itself is
   left alone: its direct callers (`saveDraftForTest`,
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
7. **When the till can meet the refusal, and what it does with an ended session today.**
   - *The race A791 names.* Ben's sign-in runs `#dropOthersDrafts` (`till-app.ts:4837`,
     `:10642-10655`) synchronously after the login answer
     (`apps/till/src/screens/till-lock-screen.ts:244-258` dispatches `logged-in` straight after
     `api.login` resolves), so by the time a refusal comes back Ana's order has been dropped and
     `#saveNow` answers `"failed"` without calling `onRefused` (`draft-sync.ts:802`; `#ended` at
     `:738-740`). That ordering is read, not run. Nothing new is needed there.
   - *The case the new handling is for:* the till still believes Ana is signed in, but the
     device's session is someone else's — for one, a second tab of the same till signed in as Ben,
     since tabs share the cookie. Left to the existing handling of a code outside
     `DRAFT_REFUSALS` (`draft-sync.ts:849-857`), the edit is marked unsaved and the app shows the
     generic table error (`draftRefusalError` → `tableWriteError`, `till-app.ts:654-661`); the bill
     refresh every 15 s (`till-app.ts:10664-10669`) then calls `sync.load()` (`:10687`), and
     `#load` schedules the save again (`draft-sync.ts:544`) — a retry every 15 s, each refused.
   - *How the till treats an ended session elsewhere.* Clocking, attendance and tender refunds
     answer `session.required` / `session.not_open` with `#onLogout()` (`till-app.ts:4097-4099`,
     `:4171-4173`, `:7516-7518`). `#onLogout` (`:17116`) locks to the sign-in screen
     (`#setScreen("lock")`), ends the till's own operator session (`#endOperatorSession`, which
     moves `#operatorSession` on at `:15846`), and closes the open and leaving orders
     (`sync.close()`, which keeps unsaved lines as that person's candidate, `draft-sync.ts:563-569`);
     the existing case "retains the complete local candidate after %s without exposing it to the
     next person" (`apps/till/src/till-app-drafts.test.ts:9168`) shows those lines return to Ana
     and not to Luis. It then calls `api.logout()` (`:17169`). For draft saves,
     `session.required` is not routed there: it is only kept quiet (`till-app.ts:9999`, `:10732`,
     `:10759`).
   - **Decision:** route `draft.person_not_signed_in` through `#onLogout`, but **without** its
     `api.logout()` call: the cookie now belongs to someone else, and ending it would sign out the
     other tab's person. So `#onLogout` gains a parameter `endServerSession = true`, and only the
     new path passes `false`. Because `#onLogout` moves `#operatorSession` on before its first
     `await`, the existing guards in `#releaseDraft` (`:9996`) and `#flushDraft` (`:10733`) stay
     quiet afterwards without new checks (read, not run; Task 1's app cases test the banner).
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
     (`#takeOver` awaits it at `draft-sync.ts:602`, `runCommand` at `:659`), so one started by Ana
     and sent after Ben's cookie arrived would act as Ben. Whether the lock screen's appearance
     always stops such a command first has not been traced. This is left open as a backlog entry
     (Task 4); it is not fixed here.

## Global Constraints

- Work only in `/Users/clintongormley/workspace/worktrees/waitron-feat-a791-draft-save-person`,
  branch `feat/a791-draft-save-person`. Every commit `git commit -s`, staging explicit paths only.
- General code is English only (CLAUDE.md §3); this change adds no translation.
- Wire field name: `personId`. In the route the body's value is `namedPersonId`. Error code:
  `draft.person_not_signed_in`, params `{ personId: string }`, status 409.
- **Lane G's open branch `feat/a773-2-pass-lifetime` changes files this plan also edits. Do not
  touch its hunks** (line numbers are where its hunks start on this branch's base, from
  `git diff $(git merge-base HEAD feat/a773-2-pass-lifetime) feat/a773-2-pass-lifetime`):
  - `apps/server/src/till-api.ts`: imports ~45–176, course verbs ~1151–1200, mounts ~2235–2257, group verbs ~3198–3210.
  - `apps/till/src/till-app.ts`: `.fireControl=` bindings ~17366, ~17438, ~17503, ~17644.
  - `apps/till/src/till-app-drafts.test.ts`: ~178, ~8227.
  - `apps/till/src/api/client.test.ts`: ~2186–2256, ~4128.
  - `apps/server/src/course-retention.test.ts`: ~8, ~271, ~288, ~345, ~553.
  - `apps/server/src/made-here.routes.test.ts`: ~633, ~680, ~717.
  - `apps/server/src/till-api.profile-zones.test.ts`: ~117, ~160, ~193, ~220, ~641, ~985, ~1376.
  - `apps/server/src/till-api.profile-actions.test.ts`: ~94–162, ~395, ~456 (it deletes the `away` row three lines above the drafts save row at :463), ~697.
  - `docs/backlog.md`: ~2021, ~2344. `docs/backlog/till.md`: ~602, ~2432.

  This plan's own edits sit elsewhere: `till-api.ts` ~594 and ~3500–3510; `till-app.ts` ~102,
  ~10758 and ~17116; `till-app-drafts.test.ts` ~1836–1916, ~8309, ~9121 onward;
  `client.test.ts` ~4553–4616; `docs/backlog.md` ~2386; `docs/backlog/till.md` ~1634–1670. Where a
  save body in one of lane G's files must grow, add the field on the body's own lines only.
- **`till-api.profile-actions.test.ts` stays untouched** unless its run fails: its save row
  (:463) is refused by the profile check before the body is read.
- Run focused tests only (CLAUDE.md §2); CI runs the package suites. Read each run's `Tests` count.
- Comments only for an invariant the code cannot show (CLAUDE.md §1, last rule). A comment that
  says the refusal is "safe" or "unreachable" is a claim and needs its receipt.
- Backlog A792 (`docs/backlog.md:2394`) is a separate item; leave it.

## Review Focus

1. **Ana signs back in after the restart and carries on.** Her save names Ana under Ana's session
   and must be served — Task 4's legitimate case; and her kept lines come back to her and to
   nobody else — Task 1's `it.each` row.
2. **A person id in another letter case.** The till sends the id the server gave it, but a
   hand-built request may differ in case; the route lower-cases the named id before comparing (as
   `requireDraftPartyParam` does for parties, `till-api.ts:1080-1082`). Task 4 tests Ana's id in
   upper case from Ana's session: served; its deletion proof removes the lower-casing.
3. **An empty save (lines `[]`) naming someone else.** `saveDraft` answers an empty save on a bill
   with no order early, with `200` and no order (`order-drafts.ts:492`). The check sits in the
   route before that, so it is refused too. Task 4 tests it.
4. **The refusal reaching an order that is still on screen.** The till must lock rather than
   leave a dead order, must not retry every 15 s, must not show Ben anything of Ana's, and must
   not end the device's session. Task 1's live-order app case checks all four.
5. **A refusal that writes nothing at all**, including no bill editor taken. Task 4 compares the
   whole database before and after, as the existing `snapshot()` cases do.

---

### Task 1: The till names the order's person in each save, and signs that person out on this screen when the device's session is someone else's

**Files:**
- Modify: `apps/till/src/api/client.ts:827-833` (`DraftSave`)
- Modify: `apps/till/src/state/draft-sync.ts` (`DRAFT_PERSON_REFUSAL` beside `DRAFT_REFUSALS` at :25; the body at :792-798)
- Modify: `apps/till/src/till-app.ts` (import at :102; `#onDraftRefused` at :10758; `#onLogout` at :17116)
- Modify: `apps/till/src/widgets/test-helpers.ts:444` (the fake's `save` helper type)
- Test: `apps/till/src/state/draft-sync.test.ts`, `apps/till/src/till-app-drafts.test.ts`, `apps/till/src/api/client.test.ts`, `apps/till/src/api/client.bill-editing.test.ts`

**Interfaces:**
- Produces: `DraftSave.personId: string` — "the person whose order this is; the server refuses the save unless it is the person signed in on this device".
- Produces: `export const DRAFT_PERSON_REFUSAL = "draft.person_not_signed_in";` in `draft-sync.ts`.
- Produces: `#onLogout(endServerSession = true)`; every existing caller stays as it is.

- [ ] **Step 1: Write the tests.** New test names, and whether each must fail first:

  In `apps/till/src/state/draft-sync.test.ts`:
  - `describe("DraftSync: saving")` → **`it("names the sync's person in every save, whoever signs in later")`** — must FAIL first. `const draft = sync("p7");` load, `addProduct(beer, "1")`, `settle()`; expect `server.saveDraft.mock.calls[0]![1].personId` toBe `"p7"`; add steak, settle; the second call's `personId` toBe `"p7"`.
  - `describe("DraftSync: a refused save")` → **`it("answers failed and says nothing when a refusal for the order's person lands after the order was dropped")`** — a PIN on existing behaviour (`#ended` in `#saveNow`'s error branch, `draft-sync.ts:802`); it passes before and after. Modelled on "does not send a save once dropped" (:501): hold the first save with a deferred that then rejects `{ code: "draft.person_not_signed_in", status: 409 }`; `drop()` before releasing it; expect the queued flush toBe `"failed"`, `refused` toEqual `[]`, `server.listDrafts` toHaveBeenCalledOnce.

  In `apps/till/src/till-app-drafts.test.ts`, `describe("A773 retained bill candidates in the app")` (:9121):
  - The `it.each` at :9168 ("retains the complete local candidate after %s without exposing it to the next person") gains a third ending, **`"save refused for another signed-in person"`**, which does what the `"expired-session save refusal"` ending does but rejects with `{ code: "draft.person_not_signed_in", status: 409 }`. Its other expectations stay as they are, plus, for this row only, `expect(api.logout).not.toHaveBeenCalled()` read right after `back(el)` and its flush — BEFORE the shared idle step, which calls `#onLogout()` with the default and so does call `api.logout()`; do not move this check after it. This row must FAIL first (today the till stays signed in and the leave shows the generic table error).
  - **`it("signs the order's person out on this screen, keeps their lines, and leaves the device's session alone, when a live order's save is refused for them")`** — must FAIL first. `mountApp({ saveDraft: vi.fn().mockRejectedValue({ code: "draft.person_not_signed_in", status: 409 }) })`; `openMesa(el)`; `tap(el, "Beer")`; stay on the table; advance past `DRAFT_SAVE_DELAY_MS` and flush. Expect `lock(el)` not null, `banner(el)` toBeNull, `api.logout` not called, `api.saveDraft` toHaveBeenCalledOnce; advance 20 s (past the 15 s bill refresh) on fake timers, `vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })` as at :898, never a real wait, and expect `api.saveDraft` still called once. Then `reopen(el, "p2", "Luis")`: `retainedCandidate(el)` toBeNull and `rows(el)` toEqual `[]`; log out, `reopen(el, "p1", "Ana")`: `retainedCandidate(el)?.lines.map((line) => line.product.name)` toEqual `["Beer"]`.
  - **`it("names the signed-in person in each save, and the next person in theirs")`** — must FAIL first. `mountApp()`, `openMesa(el)` (signs in as `p1`), `tap(el, "Beer")`, flush past `DRAFT_SAVE_DELAY_MS`; expect `api.saveDraft.mock.calls.at(-1)![1].personId` toBe `"p1"`; `emit(tableOrder(el)!, "logout")`, flush, `reopen(el, "p2", "Luis")`, `tap(el, "Steak")`, flush; the last call's `personId` toBe `"p2"`.

- [ ] **Step 2: Run them and watch the four failing-first cases fail**

  `pnpm --filter @waitron/till exec vitest run src/state/draft-sync.test.ts src/till-app-drafts.test.ts -t "person"`
  This name filter also runs existing cases whose names contain "person". The ones that must be seen FAILING are: "names the sync's person in every save, whoever signs in later" (`personId` undefined); the `it.each` row "…after save refused for another signed-in person without exposing it to the next person" (no lock); "signs the order's person out on this screen…" (no lock, generic banner, a second save after the refresh); "names the signed-in person in each save, and the next person in theirs" (`personId` undefined). The pin "answers failed and says nothing…" passes.

- [ ] **Step 3: Implement**

  - `DraftSave` gains `personId: string` (doc line as in Interfaces).
  - `#saveNow` sends `personId: this.personId` in the body. `#refused` is unchanged: the new code is outside `DRAFT_REFUSALS`, so it marks the edit unsaved and calls `onRefused` (`draft-sync.ts:855-856`).
  - `#onLogout(endServerSession = true)`: skip the `api.logout()` call when it is `false`; nothing else changes.
  - `#onDraftRefused`, before its `sync !== this.#draftSync` guard (so a leaving order's refusal is handled too): when `refusal.refused === DRAFT_PERSON_REFUSAL`, and `sync.personId === this.#sessionPersonId` and `this.operatorName !== ""` (the till still believes that person is signed in), `void this.#onLogout(false)`; in every case return without setting an error.
  - `test-helpers.ts:444`: the fake's `save(partyId, save: Omit<DraftSave, "expectedEdit" | "personId">)` so its direct callers stay as they are.

- [ ] **Step 4: Grow the existing body expectations** (changed checks — each grows by the new field and nothing else, because every save now carries it):
  - `draft-sync.test.ts:333` ("saves three taps on Beer once…"), `:356` ("sends the next save with the id and revision…"), `:395` ("never has two saves out…"): add `personId: "p1"` to the expected body.
  - `till-app-drafts.test.ts:8309` (recalled-source note save): add `personId` with the signed-in person's id (`"p1"` unless that case signs in someone else).
  - `client.test.ts:4593` (the PUT body `saveDraft` sends): add `personId` to both the call and the expected body; `client.test.ts:4553`, `:4582`, `:4610` and `client.bill-editing.test.ts:91` gain `personId` in the `DraftSave` they build (fixture growth, for the type).
  - `pnpm --filter @waitron/till typecheck` lists any other `DraftSave` literal missing the field; add it there too.

- [ ] **Step 5: Run and see them pass**

  `pnpm --filter @waitron/till exec vitest run src/state/draft-sync.test.ts src/till-app-drafts.test.ts src/api/client.test.ts src/api/client.bill-editing.test.ts src/state/draft-editing.test.ts`
  Expected: every file passes, with a `Tests` count shown. Then `pnpm --filter @waitron/till typecheck` and `pnpm format:check`: both exit 0.

- [ ] **Step 6: Proofs by deletion** — (a) make `#onDraftRefused`'s new branch only return (no `#onLogout`): the live-order case must fail on the lock and on the second save. (b) Pass `true` instead of `false`: the live-order case and the `it.each` row must fail on `api.logout`. Restore both.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/till/src/api/client.ts apps/till/src/state/draft-sync.ts apps/till/src/till-app.ts apps/till/src/widgets/test-helpers.ts apps/till/src/state/draft-sync.test.ts apps/till/src/till-app-drafts.test.ts apps/till/src/api/client.test.ts apps/till/src/api/client.bill-editing.test.ts
  git commit -s -m "The till names whose order each save is, and signs that person out here when the device's session is another's"
  ```
  (Add any other file Step 4's typecheck made you touch.)

---

### Task 2a: Every server test that saves an order sends `personId` (group one)

The server ignores an unknown body field today (receipt 1), so this task stays green throughout.

**Files:**
- Modify: `apps/server/src/testing/draft-command-fixture.ts:108-184` (`observedDraftCommandBody`)
- Test (fixture growth only): `apps/server/src/till-api.drafts.test.ts`, `draft-recall.test.ts`, `draft-recall.modifiers.test.ts`, `draft-recall-adjustments.test.ts`, `draft-recall-split.test.ts`, `draft-split.test.ts` (all under `apps/server/src/`)

**Interfaces:**
- Produces: `observedDraftCommandBody(db, method, path, body, personId?: string)` — for a save (`PUT /api/parties/:id/drafts`) whose object body has no `personId`, adds `personId` **before any of the function's early returns** (including the `expectedEdit` and non-UUID `billId` returns at :117 and :145), so a malformed-body case still reaches the route's own field checks.
- Produces: in `till-api.drafts.test.ts`, `draftBody(method, path, body, personId)`; `ana` passes `venue.operatorId`, `admin` passes `venue.adminId`.

- [ ] **Step 1: Make the change.** Where a file's saves go through `observedDraftCommandBody`, pass the caller's person to it; elsewhere add `personId` to each save body. The person is always the one whose cookie sends that request: in a `BillVenue` suite, `venue.cookie` is Ana's session and her id is `venue.operatorId`, `adminCookie`'s is `venue.adminId` (receipt 1's probe); read any other harness to find its cookie's person.

- [ ] **Step 2: Check, temporarily, that every save now carries the field.** Add `requireBodyUuid(body.personId, "personId");` to the save route **locally, never committed**, run
  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts src/draft-recall.test.ts src/draft-recall.modifiers.test.ts src/draft-recall-adjustments.test.ts src/draft-recall-split.test.ts src/draft-split.test.ts`,
  fix any failure that names `personId` (none is expected from the existing malformed-body rows: they go through `admin()`, which fills `personId` after this task, so a failure there means the fixture fills the field in the wrong place; the NEW malformed-body rows are Task 3's), then remove the line. `git diff apps/server/src/till-api.ts` must print nothing.

- [ ] **Step 3: Run the same command without the temporary line.** Expected: all six files pass with a `Tests` count. Then `pnpm --filter @waitron/server typecheck` and `pnpm format:check` exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/server/src/testing/draft-command-fixture.ts apps/server/src/till-api.drafts.test.ts <each other test file changed>
  git commit -s -m "Server tests that save an order name its person (group one)"
  ```

---

### Task 2b: Every server test that saves an order sends `personId` (group two)

**Consumes:** Task 2a's `observedDraftCommandBody(…, personId?)`.

**Files (fixture growth only, all under `apps/server/src/`):** `adjustments-report.test.ts`, `attendance-till-api.test.ts`, `bill-editing.bill-moves.test.ts`, `bill-editing.commands.test.ts`, `bill-unsent.test.ts`, `course-retention.test.ts`, `draft-discard.test.ts`, `made-here.routes.test.ts`, `till-api.profile-zones.test.ts`, `till-api.service-periods.test.ts`, `till-api.zone-closed.test.ts`.

- [ ] **Step 1: Make the change** by Task 2a's Step 1 rule. `course-retention.test.ts`'s `save(lines, draft, chosenCookie, partyId)` (:189-204) switches between Ana's `cookie` and Sam's `samCookie`, so its `personId` must follow `chosenCookie` (Ana's or Sam's id). Lane G edits four of these files (Global Constraints); grow only the save bodies' own lines.

- [ ] **Step 2: Temporary check**, as Task 2a Step 2, over these eleven files plus `till-api.profile-actions.test.ts` (which must pass unchanged; if it fails, grow only its save row, :463):
  `pnpm --filter @waitron/server exec vitest run src/adjustments-report.test.ts src/attendance-till-api.test.ts src/bill-editing.bill-moves.test.ts src/bill-editing.commands.test.ts src/bill-unsent.test.ts src/course-retention.test.ts src/draft-discard.test.ts src/made-here.routes.test.ts src/till-api.profile-zones.test.ts src/till-api.service-periods.test.ts src/till-api.zone-closed.test.ts src/till-api.profile-actions.test.ts`
  Then remove the temporary line; `git diff apps/server/src/till-api.ts` prints nothing.

- [ ] **Step 3: Run the same command again.** Expected: all twelve pass with a `Tests` count. Then `pnpm --filter @waitron/server typecheck` and `pnpm format:check` exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add <each test file changed>
  git commit -s -m "Server tests that save an order name its person (group two)"
  ```

If either group passes about 60 tool calls unfinished, stop at a green point, commit the files done, and hand over the rest by file.

---

### Task 3: The save route requires `personId`

**Files:**
- Modify: `apps/server/src/till-api.ts` (the save route, ~3500-3510)
- Test: `apps/server/src/till-api.drafts.test.ts`, `describe("a malformed body")` (:1084)

**Interfaces:**
- Consumes: Tasks 2a and 2b (every test save carries `personId`).
- Produces: in the route, `const namedPersonId = requireBodyUuid(body.personId, "personId").toLowerCase();`, read after `requireRevision(body.revision)` and before `withTransaction`. The session's `personId` (`till-api.ts:3503`) keeps its name.

- [ ] **Step 1: Write the failing test** — a new `it.each`, titled `"refuses a save 400 management.request_invalid naming %s for %j"`, sent with `send(venue.app, adminCookie, "PUT", …)` directly (bypassing `draftBody`, so nothing fills the field). Rows:
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID }]` (absent)
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID, personId: "ana" }]`
  - `["personId", { draftId: null, revision: 0, lines: [], billId: ID, personId: 7 }]`

  Each expects status 400, `refusal("management.request_invalid", { field })`, and `snapshot()` unchanged, as the existing table does.

- [ ] **Step 2: Run it and watch it fail**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts -t "naming personId"`
  Expected: the three new rows FAIL (today they answer something other than 400 naming `personId`).

- [ ] **Step 3: Implement** the read in Interfaces.

- [ ] **Step 4: Run every file that saves an order**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts src/draft-recall.test.ts src/draft-recall.modifiers.test.ts src/draft-recall-adjustments.test.ts src/draft-recall-split.test.ts src/draft-split.test.ts src/adjustments-report.test.ts src/attendance-till-api.test.ts src/bill-editing.bill-moves.test.ts src/bill-editing.commands.test.ts src/bill-unsent.test.ts src/course-retention.test.ts src/draft-discard.test.ts src/made-here.routes.test.ts src/till-api.profile-zones.test.ts src/till-api.service-periods.test.ts src/till-api.zone-closed.test.ts src/till-api.profile-actions.test.ts`
  Expected: all files pass with a `Tests` count; the existing malformed-body rows answer their original fields unchanged. Then `pnpm --filter @waitron/server typecheck` and `pnpm format:check` exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/server/src/till-api.ts apps/server/src/till-api.drafts.test.ts
  git commit -s -m "An order save must name its person"
  ```

---

### Task 4: The server refuses a save whose person is not the one signed in; backlog updated

**Files:**
- Modify: `apps/server/src/errors.ts` (declare the code beside the other `draft.*` codes, ~468-492)
- Modify: `apps/server/src/till-api.ts` (`STATUS` ~594; the save route after Task 3's read)
- Test: `apps/server/src/till-api.drafts.test.ts`, `describe("PUT /api/parties/:id/drafts")` (:413)
- Modify: `docs/backlog.md`, `docs/backlog/till.md`

**Interfaces:**
- Consumes: Task 3's `namedPersonId`.
- Produces: `"draft.person_not_signed_in": { personId: string }` in `ErrorParams`, documented as "A till saved an order for a person who is not the one signed in on the device; nothing was written." `STATUS["draft.person_not_signed_in"] = 409`.

- [ ] **Step 1: Write the tests** (all through `send(…)` with an explicit `personId`, so the fixture does not fill it):
  - **`it("refuses 409 draft.person_not_signed_in for a new order saved for someone else, writing nothing")`** — must FAIL first. `seated()`; `before = snapshot()`; from `adminCookie`, a new-order save (`draftId: null, revision: 0`, `billId` the main bill, `lines: [dish("Pulpo")]`, `expectedEdit: { billId, editorVersion: 0, draftId: null, draftRevision: null }`) naming `personId: venue.operatorId`. Expect 409, body `{ code: "draft.person_not_signed_in", params: { personId: venue.operatorId } }`, `snapshot()` toEqual `before`. Today this answers 200 with an order owned by the administrator (receipt 1).
  - **`it("refuses 409 draft.person_not_signed_in for an empty save for someone else")`** — must FAIL first. `lines: []`, naming `venue.operatorId` from `adminCookie` on a fresh party with no order: 409, same body, nothing written. (Today it answers 200 with `draft: null` — `order-drafts.ts:492`. On a bill where Ana already has an order the existing guard answers `draft.taken_over` instead, so that is not the case to use.)
  - **`it("still saves the signed-in person's own new order, whatever case the id is written in")`** — passes before and after. From Ana's cookie, `personId: venue.operatorId.toUpperCase()`; expect 200 and `draft.ownerId` toBe `venue.operatorId`. (The plain-case same-person save is every other case in the file, through the fixture.)

- [ ] **Step 2: Run them and watch the two refusing cases fail**

  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts -t "person"`
  Expected: "refuses 409 draft.person_not_signed_in for a new order…" and "…for an empty save…" FAIL with status 200; the same-person case passes.

- [ ] **Step 3: Implement** — in the route, right after reading `namedPersonId` and before `withTransaction`: if it differs from `session.personId.toLowerCase()`, throw `new AppError("draft.person_not_signed_in", { personId: namedPersonId })`. Declare the code in `errors.ts` and its 409 in `STATUS`.

- [ ] **Step 4: Run and see them pass**, with the neighbouring rules:
  `pnpm --filter @waitron/server exec vitest run src/till-api.drafts.test.ts`
  Expected: the file passes, including "saves the session's person's draft, whatever operator the body names" (:623) and "refuses 409 draft.taken_over for a save or a submit by someone other than the owner" (:643), both unchanged.

- [ ] **Step 5: Proofs by deletion** — (a) comment out the new throw: the two refusing cases must fail with 200. (b) Remove the `.toLowerCase()` from Task 3's read: the case-insensitive same-person case must fail with 409. Restore both.

- [ ] **Step 6: Backlog and decision record**
  - `docs/backlog.md`: delete the A791 entry (lines 2386–2392 at `f17a43ad5`). In the same area ("The till, devices and table service"), add one short entry: **A take-over or a recall into the order acts as whoever the session is (left open by A791, 2026-10-21).** Both are started by a tap and sent after the order's save queue (`apps/till/src/state/draft-sync.ts` `#takeOver` and `runCommand`); one started by one person and sent after the next person's sign-in answer would act as the next person (read, not run). Whether the lock screen always stops such a command first is not traced. If it does not, name the person in those requests as A791 did for the save.
  - `docs/backlog/till.md`, section "One editor per bill (owner, 2026-10-17; A773)" (:1634): add: each order save names the person whose order it is, and the server refuses `draft.person_not_signed_in` (409) unless that is the person signed in on the device (owner, Q35, A791). When the till meets that refusal while it still shows that person, it locks to the sign-in screen and keeps their unsaved lines for their next sign-in, without signing out the device's session, which belongs to someone else. Cite `apps/server/src/till-api.drafts.test.ts` and `apps/till/src/till-app-drafts.test.ts`.

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
sends the person of the order it holds; and a till that meets the refusal while showing that
person locks, keeps their lines for them, and does not sign out the device's session.
