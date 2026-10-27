# A809 — the table screen reads its printing problems in the groups read

**Backlog entry:** `docs/backlog/kitchen.md` → "A809. The table screen reads its printing problems in
the groups read (owner, 2026-10-17)":

> Today every table load makes a second request, `GET /api/parties/:id/print-problems`, beside
> `GET /api/parties/:id/groups` (`apps/server/src/till-api.ts`). Fold the printing problems into the
> groups read and drop the second request; the exact-body assertion in
> `apps/server/src/till-api.groups.test.ts` changes with it. Done when a table load no longer calls
> `GET /api/parties/:id/print-problems` and the printing problems arrive in the groups read.

**Branch:** `feat/a809-groups-print-problems`. One pull request. No migration, no new error code, no
screen change (the notice the table screen draws is unchanged; only where its data comes from).

**Review path: FULL.** The groups read is a wire contract between `apps/server` and `apps/till` (a
cross-package contract, a risk trigger), so each task gets a per-task reviewer and `finish-branch`
runs its full wave.

## What exists today (read on 9d5853c31)

- Server, `apps/server/src/till-api.ts`:
  - `GET /api/parties/:id/groups` (≈ line 3175): `requireSession`, `checkZones`, then
    `listOrderGroups(tx, partyId)` (`apps/server/src/order-groups.ts:1410`), answered as
    `{ revision, groups }`.
  - `GET /api/parties/:id/print-problems` (≈ line 3199): same session and zone checks, then
    `listPrintProblems(tx, partyId)` (`apps/server/src/kitchen-print.ts:2155`), answered as
    `{ problems }`.
  - Both throw `party.not_open` for an unknown party (`currentRevision`, order-groups.ts ≈ 2366, and
    `listPrintProblems`'s own party read).
- `listOrderGroups` has one other caller, `apps/server/src/order-drafts.ts:432`, which does not need
  printing problems. **Leave `listOrderGroups` alone**; the route adds the problems itself.
- Till, `apps/till/src/api/client.ts`: `listGroups` (≈ 3835) typed `{ revision; groups }`;
  `listPrintProblems` (≈ 4114). The only `listPrintProblems` caller is `#readPrintProblems` in
  `apps/till/src/till-app.ts` (≈ 11068), called only from `#loadTabLines` (≈ 11015), beside
  `#readGroups` (≈ 11103). A failed groups read leaves the groups "unread" (`null`, which makes
  held-group commands refuse); a failed problems read shows no problem (`[]`).
- Two other `listGroups` callers in `till-app.ts` (`#refreshAllergyMetadata` ≈ 3816, the draft-sync
  refresh ≈ 11766) replace `tabGroups` from their read (≈ 3831, ≈ 11837). After this change their
  answer carries the printing problems too, which they would throw away (D6).
- No dashboard or other caller of `/print-problems` exists (`git grep -n print-problems -- apps
  packages` on 9d5853c31: only the route, the client method and tests).

## Decisions

- **D1. Field name `printProblems`**, a sibling of `revision` and `groups` in the groups answer —
  the till's state field already has that name. Same element shape as today's `problems`
  (`PrintProblem`: `workingOrderId`, `stationId`, `stationName`, `since`).
- **D2. Read in the route's one transaction**, after `listOrderGroups`, awaited in turn (CLAUDE.md
  §3: never `Promise.all` on one transaction).
- **D3. The `/print-problems` route and `TillApi.listPrintProblems` are removed**, not kept unused
  (the backlog already carries one route nobody calls, `outputs-down`; do not add a second).
- **D4. A failed groups read now also shows no printing problem** (`[]`), and leaves the groups
  unread exactly as today. Before, a failed problems read beside a good groups read showed no
  problem; that case no longer exists, because there is one read.
- **D5. No fallback for a missing field.** The server and the till ship in one image; the till
  reads `printProblems` as the type says. Test stubs that resolve `listGroups` without the field
  gain `printProblems: []` (adding what a stub lacks — the owner's 2026-09-27 rule; name each grown
  file in the PR).

- **D6. The other two groups reads use the problems they now receive.** `#refreshAllergyMetadata`
  and the draft-sync refresh set `this.printProblems` from their groups answer at the point they set
  `this.tabGroups`, so every groups read the till pays for (each now runs the printing-problems
  queries: party, family, join) keeps the notice current. One test each.

## Task 1 — the groups read carries the party's printing problems (server)

Files: `apps/server/src/till-api.ts`, `apps/server/src/till-api.print-problems.test.ts`,
`apps/server/src/till-api.groups.test.ts`.

1. Test first, in `till-api.print-problems.test.ts`: a new case "the groups read carries the
   party's printing problems" — `tableWithFailedTicket()`, then `GET /api/parties/:id/groups`;
   expect status 200 and `json.printProblems` `toEqual` the one-element list the existing 200 case
   expects for `/print-problems`. A second case: a table with a fresh ticket still WAITING (not yet
   past `JOBS_WAITING_MS`, `apps/server/src/print-job-trouble.ts:15`) answers `printProblems: []` —
   a table with no ticket would also pass an implementation that lists every ticket. Run it; watch both fail (field absent).
2. In the groups route: `return { ...(await listOrderGroups(tx, partyId)), printProblems: await
   listPrintProblems(tx, partyId) }` inside the existing transaction (D2).
3. `till-api.groups.test.ts:804` — the one `toEqual` on the WHOLE groups answer (plan review
   checked every suite; `snapshot()` at `:168` reads both sides so needs nothing) — gains
   `printProblems: []`. This is the "assertion pinning a whole shape
   may gain the key a new field adds" exception — no existing value changes. List each in the
   ledger's changed-checks table.
4. Run: `pnpm --filter @waitron/server exec vitest run src/till-api.print-problems.test.ts
   src/till-api.groups.test.ts src/print-api.unpair-kitchen.test.ts src/till-api.profile-zones.test.ts`.
   Also `git grep -n "parties/.*/groups\`" -- apps/server/src` for any OTHER test pinning the whole
   groups body with `toEqual` (CLAUDE.md §2: e2e suites pinning a shared wire body), and run those.
5. Commit (`git commit -s`).

## Task 2 — the till takes its printing problems from the groups read

Files: `apps/till/src/api/client.ts`, `apps/till/src/api/client.test.ts`, `apps/till/src/till-app.ts`,
`apps/till/src/till-app-parties.test.ts`, and the till test stubs that need the new field.

1. Test first, in `till-app-parties.test.ts`, beside the existing printing-problem cases (≈ 7130):
   rewrite those cases' stubs to deliver the problems through `listGroups`'s answer
   (`{ revision, groups, printProblems }`) instead of `listPrintProblems`, keeping every assertion
   on what the screen shows. Add the done-criterion case: the stub carries an explicit
   `listPrintProblems: vi.fn()`; open the table; assert `listGroups` was called with `"v1"` and
   `listPrintProblems` was NOT called (without the explicit stub, `not.toHaveBeenCalled` fails for
   the wrong reason). The D4 failed-read case: stub `listPrintProblems: vi.fn().mockResolvedValue({
   problems })` AND a rejecting `listGroups`; assert `printProblems` is `[]` (today it equals
   `problems`, so this fails first). The groups-unread half is already covered at ≈ 7079 — point to
   it, do not duplicate it. D6: one case each for `#refreshAllergyMetadata` and the draft-sync
   refresh, showing the problems from their groups answer replace the shown ones. Run; watch the
   new/rewritten cases fail.
2. `client.ts`: `listGroups`'s answer type gains `printProblems: PrintProblem[]`; delete
   `listPrintProblems`. `client.test.ts`: delete the `listPrintProblems` case; the `listGroups`
   client case (find it) stubs and expects the new field.
3. `till-app.ts`: `#readGroups` returns both (e.g. `{ groups, printProblems }`, with `null` groups
   and `[]` problems when the read fails); delete `#readPrintProblems`; `#loadTabLines` sets
   `this.printProblems` from the one read, at the same point it sets it today (after the
   `read !== this.#tabLinesRead` check). Keep `#readGroups`'s and `#loadTabLines`'s other behaviour
   exactly as today. Update `#readGroups`'s doc comment only if it becomes false.
4. Stubs: remove every `listPrintProblems:` stub entry in till tests and
   `apps/till/test/allergy-app-fixture.ts` (except the two explicit ones step 1 adds); add
   `printProblems: []` to EVERY `listGroups` stub in the files that mention `listGroups` (about 22:
   `git grep -l listGroups -- apps/till`). Typecheck is no evidence about stubs — every stub is cast
   `as unknown as TillApi` and `apps/till/tsconfig.json` includes only `src` — and a stub without
   the field leaves the state `undefined`, which throws only when the screen draws
   (`till-table-order-screen.ts` ≈ 3138). Assertions do not change except the ones step 1 rewrites (list each in
   the ledger's changed-checks table with before/after).
5. Run: `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts
   src/api/client.test.ts`, then every till test file that named `listPrintProblems` or stubs
   `listGroups` (`git grep -l -E 'listPrintProblems|listGroups' -- apps/till`), then
   `pnpm --filter @waitron/till typecheck`. The till runs in real headless Chromium — check free
   memory first (`memory_pressure | grep free`) and scale `--maxWorkers` to it.
6. Commit.

## Task 3 — the old route goes (server)

Files: `apps/server/src/till-api.ts`, `apps/server/src/till-api.print-problems.test.ts`,
`apps/server/src/print-api.unpair-kitchen.test.ts`, `apps/server/src/till-api.profile-zones.test.ts`,
`apps/server/src/working-order.ts` (comment only, if it names the route).

1. Test first: in `till-api.print-problems.test.ts`, a case that `GET
   /api/parties/:id/print-problems` now answers 404 (whatever the app answers for an unknown route —
   read what `till-api.ts`'s other "no such route" tests expect, if any; otherwise assert 404). Run;
   watch it fail (route still there).
2. Delete the route from `till-api.ts`; drop `listPrintProblems` from the import only if nothing
   else in the file uses it (the groups route now does — it stays).
3. `till-api.print-problems.test.ts`: delete all three `/print-problems` cases. The 200 case is
   Task 1's; the groups route's 401 is covered at `till-api.groups.test.ts:1441` and its 409
   `party.not_open` (random id and not-an-id) at ≈ 847 — the groups read throws it first
   (`order-groups.ts:2371`). Update the file's header comment to name the groups read.
4. `print-api.unpair-kitchen.test.ts`: both reads (≈ 155 and ≈ 176) become `GET
   /api/parties/:id/groups`, comparing `json.printProblems` with the same values (`[]` before, the
   one-element list after). Its header comment (≈ 26) follows.
5. `till-api.profile-zones.test.ts`: remove `print-problems` from the party-read list (≈ 976) and
   from the table comment (≈ 163). This removes a refusing case for a route that no longer exists;
   the groups read keeps its own case. Record it in the changed-checks table.
6. `working-order.ts:7418` comment names `listPrintProblems` (the function, which stays) — leave it
   unless it names the route.
7. Run the four server files from Task 1 step 4 again, plus `pnpm --filter @waitron/server
   typecheck`, plus `pnpm exec vitest run scripts/errors-reachable.test.ts` from the root (no code
   is retired, but the route was a thrower of `party.not_open`; confirm the guard still passes).
8. Commit.

## Task 4 — docs

1. Delete the A809 section from `docs/backlog/kitchen.md`, the "The table screen's second request
   for printing problems is A809." bullet in its Task 5 section, and the A809 pointer in
   `docs/backlog.md`.
2. `git grep -n -E 'print-problems|listPrintProblems' -- docs/developers apps/server/src/guide
   README.md CLAUDE.md` — fix any present-tense claim about the route. Plans under
   `docs/superpowers/` are historical: leave them.
3. Commit.

## Checks the branch must pass before finish-branch

- The focused files above, green, with the counts read (CLAUDE.md §4: a run with no `Tests` count
  is no evidence).
- Golden huella and `inmutabilidad` (RUNNER H2, unedited): `pnpm --filter @waitron/fiscal-verifactu
  exec vitest run src/write-path.e2e.test.ts` and `... vitest run inmutabilidad`.
- The pre-push hook runs the rest; CI runs the package suites.
