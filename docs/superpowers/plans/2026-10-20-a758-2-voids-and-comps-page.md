# A758-2 — Voids and comps get a page of their own: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL** (a migration; Delete; a permission-gated route; a cross-package contract
between the adjustments package, the server, the till and the dashboard). Implementers are
dispatched as `subagent_type: "implementer"`. An implementer that passes about 150 tool calls with
its task unfinished stops at a passing or cleanly failing point, commits, and hands over: done,
left, files, each check's state.

**Goal:** the reasons move from the Venue settings tab to a page of their own, Service → Voids and
comps, drawn as picture 01: a search box, drag handles, Name / Kind / Who can apply it / Who can
approve it / Limits, a row menu with Edit and Delete. Delete removes the reason; "switched off"
(`active`, Disable, Enable, the Status column) goes, with `adjustment.reason_inactive`.

**Architecture:** one generated migration drops `adjustment_reasons.active` and makes `name` unique
across all reasons. `deleteAdjustmentReason` deletes the row behind the existing Void guards; a
`DeleteImpact` read lets the page ask through `wt-delete-dialog`. The page is a `moreScreens` entry
of `ADJUSTMENTS_DASHBOARD` in the `service` group. The list is the screen's own `<table>` with
`ReorderController`, as the Courses list is (Decision 1).

**Tech stack:** TypeScript, Drizzle on `node:sqlite`, drizzle-kit 0.31.11, Hono, Lit, Vitest (node
and browser projects).

**Spec:** `docs/superpowers/specs/2026-10-17-a758-adjustment-reasons-design.md` — §1 (D10, and the
"Kept from the first version" paragraph after the table), §6 (the page and Delete), §4 (the starter
list). Parent plan: `docs/superpowers/plans/2026-10-19-a758-reason-rules.md` (its Global
constraints, Guard suites, Decisions 5–6 and Open point 6 apply here; its "# A758-2" outline is what
this plan replaces). Pictures: `docs/backlog/mockups/a758-adjustment-reasons/01-starter-list-page.png`
(and `-dark`); what A758-1 built: `…/built/01-page-with-bill-limit-light-1280.png`.

Every `file:line` below was read on 2026-10-20 in this worktree at `main` `4984b066f`, with
`sed -n`/`grep -n`, unless it names a command that was run.

---

## Global constraints

The parent plan's apply. In particular, and for this PR:

- **Pre-live: no compatibility or data-migration code** (CLAUDE.md §3). The migration is generated
  with `pnpm --filter @waitron/adjustments db:generate`, never hand-written or edited.
- **The PR's first line:** "Needs a venue reset where a switched-off adjustment reason exists: it
  comes back as a reason, and one sharing a name with another stops the upgrade." Still true,
  measured (Decision 3).
- **The filed record does not change.** Every task leaves `computeHuella`, the chain,
  `registros_facturacion` and the alta builders alone; the PR still runs, unedited,
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **Changing an existing test's assertion is a stop** unless the design changes what it checks.
  Each is listed under "Changed test checks" below with its design point; a fixture losing
  `active` is under "Fixtures grown". Anything else that turns red is a stop and a report.
- **Who may is a risk trigger:** Delete and its impact read are `adjustment.manage`
  (`packages/adjustments/src/permissions.ts:3-5`, granted from manager); each gets a refusing case
  and a served case at the route.
- **Words.** English and Spanish for every string, in `packages/adjustments/src/dashboard/strings.ts`
  (`en` from `:11`, `es` from `:168`) and `apps/dashboard/src/i18n/strings.ts`. General code is
  English only (CLAUDE.md §3). Spanish role word «rol»; kinds «Cancelar» / «Descuento»
  (`strings.ts` `KIND_NAMES`); the page «Cancelaciones y descuentos» (D10).
- **Forms and tables** follow `docs/developers/design-system.md`: fields from primitives
  (`wt-input`, `wt-combobox`), `--wt-*` tokens only, `wt-delete-dialog` for a confirmed Delete
  (`:725`, `:4746-4757`), a page that holds staged input keeps its `*.unsaved.test.ts`.
- **Guides:** no guide page mentions reasons, Venue settings' reasons tab or adjustments:
  `git grep -n -i "reason\|voids\|comps\|adjustment" -- apps/server/src/guide` finds only
  `en/content-and-images.md:103` (an upload failure's reason). No guide changes.
- **Coverage** 98/98/98/95 in every package touched; local runs are focused, CI runs the suites.
  Every commit `git commit -s`, staging explicit paths only.

### Guard suites, by kind of change (run in the task that makes the change)

- **Schema or migration:** `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts
  scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts`, then
  `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/migration-upgrade.test.ts` (read its
  printed summary), and `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/inmutabilidad.test.ts`.
- **A retired error code:** `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`
  and `git grep -n "reason_inactive" -- apps packages scripts` → nothing.
- **A changed wire shape** (`active` leaves every reason body): `git grep -n "active" -- 'packages/adjustments/**/*.test.ts' 'apps/server/src/adjustments*.test.ts'`
  for whole-shape `toEqual` pins.
- **Dashboard strings or a new query key:** `pnpm exec vitest run scripts/native-form-fields.test.ts
  scripts/style-token-names.test.ts scripts/live-subscriptions.test.ts scripts/pinned-actions-column.test.ts
  scripts/english-only.test.ts`.

---

## Decisions (with receipts)

1. **The list is the screen's own `<table>` with `ReorderController`, not `wt-data-table`.** The
   outline asked for both `wt-data-table` `searchable` and drag handles following `course-list.ts`;
   they do not combine. `ReorderController` finds rows only in its host's own shadow root
   (`packages/ui/src/reorder-table.ts:396-398`, `#rows()` → `this.#host.shadowRoot!.querySelectorAll("tbody tr")`),
   and `wt-data-table` draws its rows in its own; its handle is styled by class (`.handle`,
   `reorder-table.ts:143-163`), which cell markup handed to `wt-data-table` may not use (CLAUDE.md
   §3, `part=` only). Every `ReorderController` host draws a plain table: `git grep -ln
   ReorderController -- apps packages ':!*.test.ts'` lists `course-list.ts`, `extra-list-form.ts`,
   `option-list-form.ts`, `product-editor.ts`, `variant-table.ts` and, in a module package,
   `packages/venue-service/src/dashboard/department-service-steps.ts` (its table at `:265-320`). The
   only drag over a `wt-data-table` is the Menus/Products tree's own (`apps/dashboard/src/widgets/tree-drag.ts`,
   181 lines, plus `menu-structure-table.ts`), which a module may not import. So the page draws a
   `<table>` in a `.table-wrap` (`ReorderController.tableStyles`, `reorder-table.ts:198-226`), a
   search `wt-input type="search"` above it (as `apps/dashboard/src/screens/staff-screen.ts:361-370`
   draws its own), and the row menu `wt-row-actions` in a last `td.actions-cell`. **What it costs:**
   the column chooser, the Filters panel and the remembered view go (picture 01 draws none); and the
   CLAUDE.md row-menu rule (`key: "actions"`, `pinned: "end"`) is `wt-data-table`'s, so the page
   keeps its aim — the menu stays on a phone's screen (A155) — with its own CSS:
   `td.actions-cell, th.actions-cell { position: sticky; inset-inline-end: 0; background: var(--wt-color-surface); }`,
   pinned by a 390 px test (Task 5). Owner point 1.
2. **Delete removes the row, used or not; nothing is refused for having been used.** Design §6:
   "Delete removes the row. A recorded adjustment keeps its own copy of the reason's name and
   rules". Receipts: `adjustments.reason_id` is declared with no foreign key and says why
   (`packages/adjustments/src/schema/adjustments.ts:60-62`); the only key in the adjustments set is
   `adjustments.working_order_id → working_orders`, and no migration in any set names
   `adjustment_reasons` in a `REFERENCES` (`git grep -n "adjustment_reasons" -- '*.sql'` lists only
   the adjustments set's own `CREATE`/`INSERT`/`INDEX` lines). **Run** on 2026-10-20 with
   `node:sqlite` (Node v26.11.1, foreign keys on), the adjustments set's SQL applied in order:
   `pragma_foreign_key_list` over every table printed one key, `adjustments → working_orders ON
   DELETE RESTRICT`; an `adjustments` row naming reason `r2` stayed, `reason_name` "Mistake", after
   `delete from adjustment_reasons where id = 'r2'`. `packages/adjustments/src/migrations.test.ts:334-342`
   already pins the same with the append-only triggers installed. Reports read `reason_name` from
   the rows and never `adjustment_reasons` (`git grep -n adjustmentReasons -- apps packages
   ':!*.test.ts'` names no `reports.ts`). A till holding a deleted reason is answered
   `adjustment_reason.not_found` (`operations.ts:149-152`), which it already words "That reason no
   longer exists. Reload and choose another" (`apps/till/src/i18n/codes.ts:616-619`) and treats as a
   reason refusal (`apps/till/src/till-app.ts:1051-1055`). This matches the sibling real Deletes
   that keep history as copies (design-system.md `:4735-4745`: "Recorded names stay with historical
   work, and adding the same name creates a different id"). **Consequence, stated not fixed:**
   the item and bill limits count a reason's earlier rows by `reason_id`
   (`packages/adjustments/src/record.ts:88-94`), so deleting a reason and adding one of the same name
   starts a new count on an open bill. Owner point 4.
3. **The migration is three statements, not a rebuild, and the upgrade walk needs no `RESETS`
   entry; the venue reset is still real.** Probe, run on 2026-10-20 and reverted: with `active`
   and the partial index replaced in `schema/reasons.ts` by `uniqueIndex("adjustment_reasons_name_key").on(t.name)`,
   `pnpm --filter @waitron/adjustments db:generate` wrote `0006_perpetual_lionheart.sql`:
   `DROP INDEX adjustment_reasons_active_name_key; CREATE UNIQUE INDEX adjustment_reasons_name_key
   ON adjustment_reasons (name); ALTER TABLE adjustment_reasons DROP COLUMN active;`. So none of the
   rebuild traps (CLAUDE.md §3: `DROP TABLE` with foreign keys on, expression indexes, add-and-rebuild)
   applies; the name the generation picks will differ. With that file in place,
   `env -u AI_AGENT -u CLAUDECODE pnpm exec vitest run scripts/migration-upgrade.test.ts` passed,
   4 tests, 328 steps. Its synthetic rows differ in every unique index over plain columns
   (`scripts/migration-upgrade.test.ts:24-29`), so it never builds the failing case; a `RESETS`
   entry for a step that carries the rows fails the guard (`:358-359`). The real failing case,
   **run** on `node:sqlite` over 0000–0005 then the probe 0006: a switched-off "Retired" beside a
   switched-on "Other" migrated, and "Retired" came back as a reason; a switched-off "Other" beside
   a switched-on "Other", and two switched-off "Old", each stopped with `UNIQUE constraint failed:
   adjustment_reasons.name`. Hence the PR's first line, and no custom SQL deletes them (pre-live).
4. **Names are unique across every reason** (the index above; `assertNameFree`, `operations.ts:134-147`,
   drops its `active` filter). The dashboard's `adjustment_reason.name_taken` sentence loses
   "active": "Another reason already has this name" / «Ya hay otro motivo con este nombre»
   (`strings.ts:329-332`).
5. **Delete's impact is a `DeleteImpact` whose only possible refusal is the Void guard.**
   `readAdjustmentReasonDeleteImpact(tx, reasonId)` answers `{ target: { id, name }, refusals,
   ends: [], removes: [] }`; `refusals` is empty or one `{ code: "adjustment_reason.void_required",
   params: { withNote: 0 | 1 }, targets: [] }`. `withNote` is a number there because
   `DeleteImpactRefusal.params` holds only strings and numbers (`packages/shared/src/delete-impact.ts:7-11`);
   the thrown error keeps its boolean (`errors.ts:12`), so the route's 409 body is unchanged
   (`routes.test.ts:346-387` pins it). `DELETE` keeps answering 204 with no body
   (`routes.ts:276-283`), as its tests pin; the staffing sibling returns its impact instead
   (`packages/staffing/src/routes.ts:371-377`), which nothing here reads.
6. **Search filters by every name, keeps list order, and freezes the order while it holds text.**
   A row matches when `textSearch(query)` (`packages/shared/src/text-search.ts`, the table's own
   matcher) ranks its `name` or any of its `names` values; matches keep their position order (the
   order is the point of the page). While the search holds text the grips are disabled
   (`ReorderModel.busy()`), and the note under the list says "Clear the search to change the order."
   instead of the drag sentence.
7. **Moves save the whole order, one at a time, through the existing route.** `PUT
   /management-api/adjustments/reason-order` takes every reason's id once (`routes.ts:314-321`,
   `operations.ts:243-266`, which after Task 1 names every reason). A key move saves at once; a
   pointer drag saves once, on drop (`course-list.ts:250-262`). Saves are chained so one is in
   flight at a time; a refused save shows "The new order could not be saved." (`strings.ts:95`) and
   reads the list again. A list snapshot arriving while a drag is held or a save is unanswered is
   not applied; the list is read again once the last save answers (`course-list.ts:221-224`,
   `:265-282`). `busy()` is never true during a save, which would drop a keyboard user's focus
   (`course-list.ts:166`).
8. **Kind and "Note required" are neutral `wt-lozenge`s.** Picture 01 outlines Void in red and
   Comp in green. `wt-lozenge` takes only a hex colour (`packages/ui/src/components/wt-lozenge.ts:43-48`)
   and a screen may not write one (CLAUDE.md §3, tokens only); the word carries the meaning. Owner
   point 2.
9. **The screen id stays `adjustment-reasons`** (D10: code names stay), so the page's address is
   `/manage/adjustment-reasons`, which today's test calls retired (`apps/dashboard/src/dashboard-app.test.ts:1828-1845`)
   and which this PR brings back as the page. No `order`: Service holds Bookings
   (`packages/bookings/src/dashboard/index.ts:12`) and the sort is stable on registry order
   (`apps/dashboard/src/dashboard-app.ts:1433`), so Voids and comps follows Bookings.

## Where the outline drifted (re-read on `4984b066f`)

| Outline said | Now |
|---|---|
| `schema/reasons.ts:43-45` | `active` `:45`; partial index `:50-52` |
| `routes.ts:267-273` (reactivate) | reactivate `:285-291`; `DELETE` `:276-283`; list `:242-251` |
| `till-api.ts:609`, till `codes.ts:588`, `till-app.ts:894`, `adjustment-dialog.ts:77` | `:624`, `:592-595`, `:1053`, `:82`; plus `apps/server/src/line-cancel.ts:247` (A773-1, now on main) |
| `migrations.test.ts:101` | `:130-136` |
| `venue-settings-screen.ts:14`, `:22`; strings `:940`, `:3925` | `:11`, `:16`; `apps/dashboard/src/i18n/strings.ts:938`, `:3917` |
| `dashboard-app.test.ts:1822-1863` | `:1828-1870` |
| `dashboard-app.settings-panels.test.ts:13-64`, `:154` | `:13-64`, `:152-158` |
| `dashboard-app.search-modules.test.ts:451-454` | `:445-458` |
| `venue-settings-screen.test.ts:84`, `:196` | `:88`, `:196-205` |
| `dashboard/index.test.ts:32-33` | `:16-38`, `:43`, `:55-91` |
| `reasons-screen.ts:797-885` | move buttons `:943-959`, row menu `:961-987`, columns `:989-1044`, render `:1335-1372` |
| `course-list.ts:1`, `:143` | `:1`, `:158-172` |
| design-system "Switching off versus deleting" `:4713-4715` | `:4719-4724` |
| `moreScreens` entry as one flat object | `{ screen: { id, navLabelKey, group, requiresPermission }, create(ctx) }` (`packages/dashboard-kit/src/contract.ts:46-49`) |
| "Generate (one rebuild; no ADD)" | generation writes no rebuild (Decision 3) |
| Not in the outline | `packages/adjustments/src/schema/reasons.test.ts:7-11` and `scripts/schema-constraints.test.ts:371` name the old index; `packages/dashboard-modules/src/registry.test.ts:21-26` pins the settings panel |

---

## Review focus

1. **Deleting a reason past adjustments used** leaves those rows and their `reason_name` as they
   were, and is not refused for it (Decision 2) — pinned in Task 1 (operation) and Task 2 (route).
2. **A till holding a deleted reason** is told `adjustment_reason.not_found` and reads the reasons
   again — pinned in Task 3 (the three till cases move from `reason_inactive` to it).
3. **Two Void reasons deleted at once** leave one; the other is refused 409 — the route case
   `routes.test.ts:389-407`, kept, now through a real delete (Task 1).
4. **Search, then drag:** the grips are disabled while text is typed, and a move never sends a
   partial list — pinned in Task 6.
5. **A Delete question gone stale:** a reason deleted elsewhere closes the dialog with "That reason
   could not be found…" and reloads; a refusal that arrives after a fresh impact read (another Void
   reason deleted meanwhile) shows in the dialog and leaves the row — pinned in Task 7.

---

## Task 1: the package — `active` goes, Delete removes the row

**Files:**
- Modify: `packages/adjustments/src/schema/reasons.ts:45`, `:50-52`; `schema/reasons.test.ts:7-11`
- Create (generated): `packages/adjustments/drizzle/0006_*.sql`, `drizzle/meta/0006_snapshot.json`; modify `drizzle/meta/_journal.json`
- Modify: `packages/adjustments/src/operations.ts` (`:17`, `:51`, `:104-132`, `:134-147`, `:155-174`, `:194-266`), `policy.ts:88`, `:104`, `:146`, `:175`, `errors.ts:10-16`, `:33-35`, `configuration-transfer.ts:32-37`, `:56`, `provisioning.ts:69`, `routes.ts:23-31`, `:242-251`, `:276-291`
- Modify: `scripts/schema-constraints.test.ts:371`
- Tests: `packages/adjustments/src/migrations.test.ts`, `operations.test.ts`, `policy.test.ts`, `configuration-transfer.test.ts`, `provisioning.test.ts`, `routes.test.ts`; `packages/adjustments/test/seed.ts` (comments only)

**Interfaces:**
- Produces: `AdjustmentReason` without `active` (`policy.ts:77-90`);
  `listAdjustmentReasons(tx: Transaction): Promise<AdjustmentReason[]>` (no options);
  `deleteAdjustmentReason(tx: Transaction, reasonId: string): Promise<void>` (refuses
  `adjustment_reason.not_found`, `adjustment_reason.void_required { withNote }`);
  `deactivateAdjustmentReason` and `reactivateAdjustmentReason` no longer exist;
  `reorderAdjustmentReasons(tx, ids)` takes every reason's id once.
- `DELETE /management-api/adjustments/reasons/:reasonId` deletes (204);
  `POST …/:reasonId/reactivate` and `?includeInactive` go.

- [ ] **Step 1: Write the failing tests**
  - `migrations.test.ts:64-85`: the expected columns lose `active`. `:130-136` becomes
    `"refuses a second reason under a name"`: two inserts named "Complaint" → the second is a
    `UNIQUE_VIOLATION` naming `adjustment_reasons.name`. The `insert()` helper (`:46-54`) loses the
    `active` column.
  - `schema/reasons.test.ts:7-11`: the index list is `[["adjustment_reasons_name_key", true]]`.
  - `operations.test.ts`: a new case `"deletes a reason that past adjustments name, leaving them as
    they were"` — `seedReason`, `recordAdjustment` under it (as `routes.test.ts` does with
    `policySnapshotOf`), `deleteAdjustmentReason`, then `listAdjustmentReasons` lacks it,
    `findAdjustmentReason` rejects `{ code: "adjustment_reason.not_found" }`, and
    `select reason_id, reason_name from adjustments` still returns the row unchanged. The block
    `"keeping a Void reason switched on"` (`:340-443`) is rewritten to delete in place of switching
    off (cases listed under Changed test checks), each still asserting the code and `withNote` and
    that the refused reason is still listed.
  - `routes.test.ts:127-175`: after `DELETE` (204), `GET` lists only `second`, and a second
    `DELETE` of the same id answers 404 `adjustment_reason.not_found`. Add `"refuses a supervisor or
    staff member a Delete of an existing reason, and keeps it"`: create as manager, `DELETE` as each
    → 403 `authorization.not_permitted { permission: "adjustment.manage" }`, and the reason is still
    listed.
- [ ] **Step 2: Run them; expect red**
  `pnpm --filter @waitron/adjustments exec vitest run src/migrations.test.ts src/schema/reasons.test.ts src/operations.test.ts src/routes.test.ts`
  — FAIL: `active` still a column, the old index name, `deleteAdjustmentReason` not a function,
  the deleted reason still listed.
- [ ] **Step 3: Change the schema and generate**
  In `schema/reasons.ts` remove `active` (`:45`) and replace the partial index (`:50-52`) with
  `uniqueIndex("adjustment_reasons_name_key").on(t.name)`; drop the now-unused `sql` import only if
  nothing else uses it (the checks do). Run `pnpm --filter @waitron/adjustments db:generate`.
  Expected: one new file whose three statements are those in Decision 3, and no `__new_` table. If
  it writes a rebuild instead, stop and report. Update `scripts/schema-constraints.test.ts:371` to
  `"adjustment_reasons_name_key"` (the list stays sorted).
- [ ] **Step 4: Make the operations, policy and routes follow**
  - `operations.ts`: `toReason` drops `active`; `assertNameFree` drops its `active` filter (its
    comment `:134` goes); `listAdjustmentReasons(tx)` reads every reason in `STAFF_ORDER`;
    `updateAdjustmentReason` always checks the name. Replace `assertVoidKept` (`:104-132`) with
    `voidKeptFault(tx, before: ReasonRow, after: { kind: ReasonKind; noteRequired: boolean } | null):
    Promise<{ withNote: boolean } | null>` — `after` null is a delete; same rule as today with
    "switched-on" removed — and a thin `assertVoidKept` that throws
    `AppError("adjustment_reason.void_required", fault)`. `deleteAdjustmentReason` = `findReason`,
    `assertVoidKept(tx, row, null)`, `tx.delete(adjustmentReasons).where(eq(id))`. Delete
    `deactivateAdjustmentReason` and `reactivateAdjustmentReason`. `reorderAdjustmentReasons`: every
    reason is "active"; the `inactive` tail goes. Cut the comments that name switching off.
  - `policy.ts`: `active` leaves `AdjustmentReason` (`:88`); the two `!reason.active` lines
    (`:146`, `:175`) and `"adjustment.reason_inactive"` in the verdict's code union (`:104`) go.
  - `errors.ts`: remove `"adjustment.reason_inactive"` (`:16`); reword `:10-11` and `:33-34`
    without "switched-on".
  - `configuration-transfer.ts:56`: `row.kind === "void" && row.note_required === 1`; its doc
    (`:32-37`) without "switched-on".
  - `provisioning.ts:69`: `listAdjustmentReasons(tx)`.
  - `routes.ts`: the list route reads no `includeInactive` (`:245`); `DELETE` calls
    `deleteAdjustmentReason`; the reactivate route (`:285-291`) and its imports go.
- [ ] **Step 5: Bring the remaining package tests to the new shape** — `policy.test.ts`,
  `configuration-transfer.test.ts`, `provisioning.test.ts`, `operations.test.ts`, `routes.test.ts`
  as listed under Changed test checks and Fixtures grown.
- [ ] **Step 6: Run; expect green**
  `pnpm --filter @waitron/adjustments exec vitest run --project node` — every node test passes.
  Then the schema guard suites (Global constraints) and
  `pnpm --filter @waitron/adjustments typecheck`. Record the upgrade walk's printed step count in the
  commit message. `apps/server` and `apps/till` suites naming the retired functions stay red until
  Task 3.
- [ ] **Step 7: Commit** — `git add` the files above;
  `git commit -s -m "Adjustment reasons are deleted, not switched off; names are unique across all reasons (A758-2)"`.

## Task 2: the Delete question's impact, behind `adjustment.manage`

**Files:**
- Modify: `packages/adjustments/src/operations.ts`, `routes.ts`, `dashboard/live-queries.ts`
- Tests: `operations.test.ts`, `routes.test.ts`

**Interfaces:**
- Consumes: `voidKeptFault` (Task 1).
- Produces: `readAdjustmentReasonDeleteImpact(tx: Transaction, reasonId: string): Promise<DeleteImpact>`
  (Decision 5); `GET /management-api/adjustments/reasons/:reasonId/delete-impact` → 200 `DeleteImpact`,
  404 `adjustment_reason.not_found`, 400 `shared.invalid_id` for a malformed id;
  `QUERY_DEPENDENCIES["reason-delete-impact"] = ["adjustment_reasons"]`.

- [ ] **Step 1: Write the failing tests**
  - `operations.test.ts` `"reads what deleting a reason would do"`: a Comp reason → `{ target:
    { id, name: "Complaint" }, refusals: [], ends: [], removes: [] }`; the only Void reason →
    one refusal `{ code: "adjustment_reason.void_required", params: { withNote: 0 }, targets: [] }`;
    the only Void reason asking for a note beside one that does not → `withNote: 1`; an unknown id
    rejects `adjustment_reason.not_found`.
  - `routes.test.ts` `"reads a reason's delete impact for a manager or an admin, and refuses
    anyone else"`: manager and admin → 200 and the body above; staff and supervisor → 403
    `authorization.not_permitted { permission: "adjustment.manage" }`; no session → 401
    `management_session.required`; `MISSING` → 404; `"not-a-uuid"` → 400.
- [ ] **Step 2: Run; expect red** —
  `pnpm --filter @waitron/adjustments exec vitest run src/operations.test.ts src/routes.test.ts -t "delete impact|what deleting"`
  — FAIL: not a function / 404 from Hono.
- [ ] **Step 3: Implement** `readAdjustmentReasonDeleteImpact` beside `deleteAdjustmentReason`
  (both read the same `voidKeptFault`), the route next to `DELETE`, gated through `gated` as the
  other reason routes are (`routes.ts:209-210`), and the live-query key.
- [ ] **Step 4: Run; expect green** — the same command, then
  `pnpm --filter @waitron/adjustments exec vitest run --project node` and
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`.
- [ ] **Step 5: Commit** — `"Read what deleting an adjustment reason would do, for managers of adjustments (A758-2)"`.

## Task 3: the server and the till stop naming a switched-off reason

**Files:**
- Modify: `apps/server/src/line-cancel.ts:246-247`, `till-api.ts:624`, `adjustments-api.ts:257`,
  `apps/server/scripts/demo-seed/seed-adjustments.ts:186`
- Modify: `apps/till/src/i18n/codes.ts:592-595`, `till-app.ts:1051-1055`, `widgets/adjustment-dialog.ts:82`
- Tests: `apps/server/src/adjustments-api.test.ts:1019-1051`, `line-cancel.test.ts:285-318`,
  `configuration-transfer.test.ts:1770-1810`, `scripts/demo-seed/seed-adjustments.test.ts`
  (`:65`, `:82`, `:88`, `:166`, `:184`, `:186`), `apps/till/src/i18n/codes.test.ts:365`,
  `widgets/adjustment-dialog.test.ts:716`, `:755`, `till-app-adjustments.test.ts:780-802`,
  `:1866-1880`, `till-app-parties.test.ts:11305-11320`

**Interfaces:** consumes Task 1's `listAdjustmentReasons(tx)` and `deleteAdjustmentReason`.

- [ ] **Step 1: Rewrite the failing tests** (each listed under Changed test checks): the server
  cases that switched a reason off now delete it with `deleteAdjustmentReason` and expect 404
  `adjustment_reason.not_found` (`adjustments-api.test.ts`) or a rejection with that code and an
  unchanged order (`line-cancel.test.ts`; the `inactive` row of its table becomes `deleted`); the
  till cases mock `{ code: "adjustment_reason.not_found" }` and expect
  `codeMessage("adjustment_reason.not_found")`; the two refusal lists drop `reason_inactive`.
- [ ] **Step 2: Run; expect red where code still names it** —
  `pnpm --filter @waitron/server exec vitest run src/adjustments-api.test.ts src/line-cancel.test.ts src/configuration-transfer.test.ts scripts/demo-seed/seed-adjustments.test.ts`
  and `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts src/widgets/adjustment-dialog.test.ts src/till-app-adjustments.test.ts src/till-app-parties.test.ts -t "reason"`.
  Expected: the server suites fail on the missing `deactivateAdjustmentReason` import until the
  tests are rewritten, then on `line-cancel.ts`'s `reason.active` (undefined, so every reason
  refused) — read the failure before changing code.
- [ ] **Step 3: Implement** — remove `line-cancel.ts:247`; the till's copies of the code go
  (`codes.ts:592-595`, `till-app.ts:1053`, `adjustment-dialog.ts:82`, `till-api.ts:624`);
  `listAdjustmentReasons(tx)` at `seed-adjustments.ts:186` and in the tests.
- [ ] **Step 4: Run; expect green** — Step 2's commands, then
  `pnpm exec vitest run scripts/alert-codes.test.ts scripts/errors-reachable.test.ts`,
  `git grep -n "reason_inactive\|deactivateAdjustmentReason\|reactivateAdjustmentReason\|includeInactive: true" -- apps packages scripts`
  (expected: only other modules' `includeInactive` for zones, none for reasons), and
  `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/till typecheck`.
- [ ] **Step 5: Commit** — `"Retire adjustment.reason_inactive: a deleted reason is not found (A758-2)"`.

## Task 4: the page sits under Service; the Venue settings tab goes

**Files:**
- Modify: `packages/adjustments/src/dashboard/index.ts:24-39`, `client.ts:124-131`, `:146-148`,
  `reasons-screen.ts` (Enable only: `#enable` `:725-741`, its menu item `:980-985`), `strings.ts` (`nav.adjustment_reasons`, `adjustments.title`, `adjustments.intro`, the
  `name_taken` sentence)
- Modify: `apps/dashboard/src/screens/venue-settings-screen.ts:11`, `:16`;
  `apps/dashboard/src/i18n/strings.ts:938`, `:3917`
- Tests: `packages/adjustments/src/dashboard/index.test.ts`, `client.test.ts`;
  `packages/dashboard-modules/src/registry.test.ts:21-26`; `apps/dashboard/src/dashboard-app.test.ts:1828-1870`,
  `dashboard-app.settings-panels.test.ts:13-64`, `:152-158`, `dashboard-app.search-modules.test.ts:445-458`,
  `screens/venue-settings-screen.test.ts:88`, `:196-205`

**Interfaces:**
- Produces: `ADJUSTMENTS_DASHBOARD.moreScreens = [{ screen: { id: "adjustment-reasons",
  navLabelKey: "nav.adjustment_reasons", group: "service", requiresPermission: "adjustment.manage" },
  create(ctx) }]`, rendering `<dashboard-adjustment-reasons-screen .api=${new AdjustmentsApi(ctx.request, ctx.liveData)}>`;
  no `settingsPanels`. `VENUE_SETTINGS_TABS = ["venue-details", "kitchen"]`.
- `AdjustmentsApi`: `listReasons()` GETs `/management-api/adjustments/reasons`;
  `reactivateReason` goes (its route went in Task 1). `deactivateReason` stays, already calling the
  `DELETE` that now deletes, until Task 7 renames it; `active` stays on the client's type until
  Task 5 rewrites the list. Between Task 1 and Task 5 the running page shows every reason as
  Disabled (the server no longer sends `active`); the suites mock their own reasons, so none sees
  it — a mid-branch state, gone by Task 5.
- Strings: `nav.adjustment_reasons` and `adjustments.title` "Voids and comps" / «Cancelaciones y
  descuentos»; `adjustments.intro` "The reasons staff choose when they void or comp an item." /
  «Los motivos que elige el personal al cancelar un artículo o hacerle un descuento.» (picture 01).

- [ ] **Step 1: Write the failing tests** (Changed test checks list each): `index.test.ts` — the
  contribution has no `settingsPanels` and `moreScreens` holds the entry above; the page renders on
  the context's request and live data and GETs `/management-api/adjustments/reasons`; the
  `name_taken` sentence. `registry.test.ts` — the adjustments contribution's `moreScreens` screen is
  that placement and `settingsPanels` is undefined. `dashboard-app.test.ts` — at
  `/manage/adjustment-reasons` a manager of adjustments sees the page, with nav items
  `adjustment-reasons` (under the Service group, after `bookings`) and `adjustment-report`; at
  `/manage/venue-settings/view/adjustment-reasons` the venue settings page opens its first visible
  tab and holds no reasons screen; a session without `adjustment.manage` has no
  `adjustment-reasons` nav item and `/manage/adjustment-reasons` lands on the overview.
  `client.test.ts` — the list URL; no `reactivateReason`.
- [ ] **Step 2: Run; expect red** —
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/index.test.ts src/dashboard/client.test.ts`,
  `pnpm --filter @waitron/dashboard-modules exec vitest run src/registry.test.ts`,
  `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "adjustment" src/dashboard-app.settings-panels.test.ts src/dashboard-app.search-modules.test.ts src/screens/venue-settings-screen.test.ts`.
- [ ] **Step 3: Implement.** The reasons screen renders its own `<h1>` (`adjustments.title`) above
  the intro, as `packages/staffing/src/dashboard/staff-roles-screen.ts:320-324` does; the venue
  settings page no longer owns its heading. Do not name `adjustment-reasons` in
  `apps/dashboard/src/navigation.ts` (CLAUDE.md §3). Remove `#enable`, the Enable menu item and the
  `adjustments.enable` string with `reactivateReason` (a switched-off reason's menu offers nothing
  until Task 5 drops the state), and retire the `enabling` block of `reasons-screen.test.ts`
  (`:1728-1919`) and the Enable a11y states (`reasons-screen.a11y.test.ts:170-195`) in this task.
- [ ] **Step 4: Run; expect green** — Step 2's commands, then
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/` (the screen suites mount it
  standalone, so only the heading can move their results), the dashboard strings guards,
  and `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/adjustments typecheck`.
- [ ] **Step 5: Commit** — `"Voids and comps is a page under Service; the Venue settings tab goes (A758-2)"`.

## Task 5: the list of picture 01, with search

**Files:**
- Modify: `packages/adjustments/src/dashboard/reasons-screen.ts` (styles `:240-276`, `:479-512`,
  `:698-717`, `:939-1044`, `:1335-1372`), `client.ts:31-35` (`active` leaves `AdjustmentReason`),
  `strings.ts`
- Tests: `reasons-screen.test.ts`, `reasons-screen.a11y.test.ts`, `reasons-screen.unsaved.test.ts`
  (helpers only)

**Interfaces:**
- Produces, for Tasks 6–7: rows are `<tr data-reason=${id}>` in `<tbody>` inside
  `<div class="table-wrap" tabindex="0" role="region" aria-label=${t("adjustments.title")} data-test="reasons">`;
  cells in order: handle (`td.handle-cell`, empty until Task 6), Name, Kind, Who can apply it,
  Who can approve it, Limits, `td.actions-cell` holding `wt-row-actions` labelled
  `${t("adjustments.column.actions")}: ${name}` with `[data-test="edit-${id}"]`; the search is
  `wt-input name="search" type="search" data-test="search"`; `#shown(): AdjustmentReason[]` is the
  searched rows in list order.
- Strings (en / es): `adjustments.search` "Search" / «Buscar»; `adjustments.column.kind` "Kind" /
  «Tipo»; `adjustments.column.apply_roles` "Who can apply it" / «Quién puede aplicarlo»;
  `adjustments.column.approver_roles` "Who can approve it" / «Quién puede autorizarlo»;
  `adjustments.limit_percent` "{percent}% an item" / «{percent}% por artículo»;
  `adjustments.limit_amount` "{amount} a bill" / «{amount} por cuenta»; `adjustments.none` "—"
  (both); `adjustments.order_note` "Drag ⋮⋮ to set the order the till lists them in." / «Arrastra
  ⋮⋮ para fijar el orden en que la caja los muestra.»; `adjustments.order_note_searching` "Clear the
  search to change the order." / «Borra la búsqueda para cambiar el orden.» Retire the keys only the
  old table used (`column.allows`, `column.roles`, `column.status`, the column-chooser and Filters
  keys `:23-41`, `active`, `disabled`, `no_limit`, `approves`, `move_up`, `move_down`) — `git grep`
  each before removing. (`enable` goes in Task 4, `disable*` in Task 7.)

- [ ] **Step 1: Write the failing tests** in `reasons-screen.test.ts`, replacing the
  `"the reasons list"`, column-chooser, phone-width, Filters and Status cases (Changed test checks):
  - `"draws each reason as picture 01"`: fixtures Entry error (Void), Other (Void, note), Complaint
    (Comp, Supervisor/Manager/Admin both lists, `maxAmount` "30.00"), Staff meal (Comp, all four /
    Manager, Admin, `maxPercentBp` 5000) → cell texts, in English:
    `["Entry error", "Void", "—", "—", "—"]`, `["Other Note required", "Void", "—", "—", "—"]`,
    `["Complaint", "Comp", "Supervisor, Manager, Admin", "Supervisor, Manager, Admin", "€30.00 a bill"]`,
    `["Staff meal", "Comp", "Everyone", "Manager, Admin", "50% an item"]`; a Comp with both limits
    shows both, one line each; the Kind and "Note required" are `wt-lozenge`s.
  - the same in Spanish, reading each expected word from `ADJUSTMENTS_STRINGS.es` and the name
    tables (CLAUDE.md §3: no Spanish literal in a test).
  - `"searches every name of a reason, keeping list order"`: typing `compl` leaves Complaint;
    a reason whose `names.es` alone matches is kept (fixture text in English, e.g.
    `names: { en: "Complaint", es: "Grievance (es)" }` and `griev`, as the package's tests keep no
    Spanish); a name "Crème brûlée spilt" is found by `CREME`; nothing matching shows
    `tableNoMatches()`; clearing restores every row in its order.
  - `"keeps the row menu on screen at phone width"`: host 390 px wide → the `wt-row-actions`
    box's right edge ≤ the `.table-wrap`'s right edge + 0.5, with the wrap's `scrollLeft` 0 and
    its `scrollWidth` > `clientWidth`.
  - `"opens Edit from the row menu"` (the existing edit cases keep working through the new menu).
  - In `reasons-screen.a11y.test.ts`, both themes: the list; the list with a search matching
    nothing; the open row menu. Retire the states that showed switched-off reasons
    (`reasons-screen.a11y.test.ts:157-168`).
- [ ] **Step 2: Run; expect red** —
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.a11y.test.ts`.
- [ ] **Step 3: Implement.** The `<table>` per the Interfaces block with `ReorderController.styles`
  and `.tableStyles`, the sticky actions cell of Decision 1, a `<p class="hint">` under the list
  with `adjustments.order_note` (or `…_searching` while the search holds text). Remove the Status
  column and filter, the move buttons and `#move`, `#activeIds`/`#activeIndex` (`:353-355`,
  `:479-512`) and the `wt-data-table::part(manage)` rule. The row menu keeps Edit and, until Task 7,
  Disable (its confirmation and `#deactivate` stay as they are). Focus after a write (`#refocusFrom`, `:698-717`) reads
  `tbody tr[data-reason]` in the screen's own shadow root.
- [ ] **Step 4: Run; expect green** — the Step 2 command, then
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/` (the unsaved and save-state
  suites find the list by `[data-test="reasons"]` and the row menu in the screen's own root;
  helper changes only; every reason fixture loses `active`), the dashboard strings guards and
  `pnpm --filter @waitron/adjustments typecheck`.
- [ ] **Step 5: Commit** — `"Draw the voids and comps list as picture 01, with search (A758-2)"`.

## Task 6: drag to set the order

**Files:** `packages/adjustments/src/dashboard/reasons-screen.ts`, `strings.ts`;
tests `reasons-screen.test.ts`, `reasons-screen.a11y.test.ts`

**Interfaces:** consumes Task 5's rows and `#shown()`. A `ReorderController(this, model,
{ announce: () => t("adjustments.reordered") })` with `order()` = the reasons' ids,
`move(id, to, via)`, `drop(id)`, `label(id)` = the reason's name, `busy()` = the search holds text,
`reorderLabel` = `t("adjustments.reorder")`. Strings: `adjustments.reorder` "Move reason" /
«Mover motivo»; `adjustments.reordered` "Moved." / «Movido.».

- [ ] **Step 1: Write the failing tests** (copy the pointer helper from
  `apps/dashboard/src/widgets/course-list.test.ts:1002-1018`):
  - `"moves a reason with the keyboard and saves the whole order at once"`: ArrowDown on
    `[data-test="drag-e"]` (Entry error, the fixtures' first row) → the first two rows swap;
    `reorderReasons` called once with every id in the new order; focus stays on the grip; the
    live region reads `t("adjustments.reordered")`.
  - `"saves a pointer drag once, on drop"`: drag Entry error past two rows → one call, at drop.
  - `"saves one move at a time"`: two ArrowDowns while the first save is pending → the second call
    starts after the first resolves, with the order after both moves.
  - `"reads the list again after a refused move and says so"`: refused → `page-alert` reads
    "The new order could not be saved." and `listReasons` is called again.
  - `"holds a live list while a move is unanswered, then reads again"`: a snapshot delivered
    through the live data while a save is pending leaves the moved order on screen; after the save
    answers, the list is read again.
  - `"disables the grips while searching, and says how to reorder"`: with text in the search,
    every grip is disabled and the hint reads `adjustments.order_note_searching`; clearing enables
    them.
  - a11y (both themes): the list with grips; a grip focused.
- [ ] **Step 2: Run; expect red** —
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts -t "move|drag|grip|order"`.
- [ ] **Step 3: Implement** Decision 7. `#move` updates `this.reasons` with `reorder()` from
  `@waitron/ui`; key moves save at once, pointer moves on `drop`. Render `liveRegion()` once.
  The editor's Disable stays in the row menu until Task 7.
- [ ] **Step 4: Run; expect green** — Step 2's command, then
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/`.
- [ ] **Step 5: Commit** — `"Drag voids and comps reasons into the till's order (A758-2)"`.

## Task 7: Delete through `wt-delete-dialog`

**Files:** `packages/adjustments/src/dashboard/reasons-screen.ts` (`:719-724`, the `deactivate`
editor kind and its modal branch `:1255-1322`), `client.ts:142-144`, new
`packages/adjustments/src/dashboard/reason-delete-copy.ts`, `strings.ts`; tests
`reasons-screen.test.ts`, `reasons-screen.a11y.test.ts`, `reasons-screen.unsaved.test.ts`,
`client.test.ts`; `docs/developers/design-system.md:4719-4745`

**Interfaces:**
- Produces in `AdjustmentsApi`: `deleteReason(reasonId: string): Promise<void>` (the `DELETE`, in
  place of `deactivateReason`) and
  `watchReasonDeleteImpact(queries: QueryController, reasonId: string, apply: (impact: DeleteImpact) => void): Promise<void>`
  (key `adjustments:reason-delete-impact:${reasonId}`, dependencies from Task 2's
  `QUERY_DEPENDENCIES["reason-delete-impact"]`, passive, as
  `packages/staffing/src/dashboard/client.ts:82-99`); `client.test.ts` pins both requests.
- Removes: Disable (`#deactivate`, the `deactivate` editor kind, the `adjustments.disable*`
  strings, the deactivation a11y state `reasons-screen.a11y.test.ts:315`).
- Produces: `reasonDeleteCopy(): DeleteDialogCopy`, modelled on
  `packages/staffing/src/dashboard/staff-role-delete-copy.ts`; its `refusal` maps
  `adjustment_reason.void_required` to `adjustments.error.void_required_note` when
  `params.withNote === 1`, else `adjustments.error.void_required` (`strings.ts:91-93`), and any
  other code to `codeMessage(code)`.
- The screen follows `packages/staffing/src/dashboard/staff-roles-screen.ts:28-35`, `:91-226`,
  `:289-316`: a `Deletion` state, a second `QueryController` for the impact released on close, a
  generation object so a late answer is dropped, `adjustment_reason.not_found` closing the
  question with that sentence on the page and a reload, a refusal kept in `actionError`.
- Strings (en / es): `adjustments.delete` "Delete" / «Eliminar»; `adjustments.delete_heading`
  "Delete reason" / «Eliminar motivo»; `adjustments.delete_refusals` "Why this cannot be deleted" /
  «Por qué no se puede eliminar»; `adjustments.delete_ends` "Work that ends" / «Trabajo que
  termina»; `adjustments.delete_removes` "Settings removed" / «Ajustes eliminados»;
  `adjustments.delete_irreversible` "Past voids and comps keep its name. This cannot be undone." /
  «Las cancelaciones y descuentos ya hechos conservan su nombre. Esta acción no se puede
  deshacer.»; `adjustments.delete_retry` "Try again" / «Reintentar»; `adjustments.delete_loading`
  "Checking whether this reason can be deleted…" / «Comprobando si se puede eliminar este
  motivo…»; `adjustments.delete_load_error` "Could not check whether it can be deleted: {reason}"
  / «No se pudo comprobar si se puede eliminar: {reason}»; `adjustments.delete_error` "Could not
  delete the reason: {reason}" / «No se pudo eliminar el motivo: {reason}».

- [ ] **Step 1: Write the failing tests**
  - `"asks before deleting, names the reason, then deletes and reloads"`: row menu → Delete → a
    `wt-delete-dialog` whose impact read was asked for that id; once read, the dialog names
    "Complaint" (fixture `c`) and its Delete is enabled; confirm → `deleteReason("c")` once, the dialog closes,
    the list is read again, focus goes to the row now in its place (or Add reason when none).
  - `"shows why the last Void reason cannot be deleted, with Delete held"`: impact with the
    `withNote: 0` refusal → the refusal line reads `adjustments.error.void_required`; `withNote: 1`
    → `…_note`; Delete disabled.
  - `"keeps the question open and explains a refused delete"`: `deleteReason` rejects
    `{ code: "adjustment_reason.void_required", params: { withNote: true } }` → `actionError`
    reads `delete_error` with that sentence; the row is still listed.
  - `"closes the question when the reason was deleted elsewhere"`: the impact read rejects
    `adjustment_reason.not_found` → no dialog, the page alert reads
    `codeMessage("adjustment_reason.not_found")`, the list is read again.
  - `"sends one Delete while it is on its way"` (two confirms → one call).
  - `reasons-screen.unsaved.test.ts`: the two deactivation cases (`:341`, `:482`) become
    `"an open Delete question closes without the unsaved-changes question"` and `"a departed
    Delete control cannot delete the current reason"`.
  - a11y (both themes): the dialog loading, ready, refused, and after a failed read.
- [ ] **Step 2: Run; expect red** —
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.unsaved.test.ts src/dashboard/reasons-screen.a11y.test.ts -t "Delete|delete"`.
- [ ] **Step 3: Implement**, adding Delete after Edit in the row menu. In design-system.md
  "Switching off versus deleting" (`:4721`) drop "an adjustment reason" from the list of things
  switched off, and add to the Courses-and-stations paragraph (`:4735`) one sentence: "Voids and
  comps reasons offer Delete on every row; Delete is refused only while the reason is the venue's
  last Void reason, or its last one asking for a note."
- [ ] **Step 4: Run; expect green** — Step 2's command, then
  `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/` and
  `pnpm --filter @waitron/adjustments typecheck`; `pnpm exec prettier --file-info docs/developers/design-system.md`
  (expected `"ignored": true`; `docs/` is not format-checked).
- [ ] **Step 5: Commit** — `"Delete a void or comp reason after reading what it would do (A758-2)"`.

## Task 8: docs and backlog

**Files:** `docs/developers/design-system.md:4829-4833`, `docs/backlog.md:2180-2186`,
`docs/backlog/till.md:1377-1379`

- [ ] In design-system.md's routes paragraph, Venue settings "starts with `venue-details`, followed
  by `kitchen`" (`tables` and `adjustment-reasons` are both gone: `VENUE_SETTINGS_TABS`,
  `venue-settings-screen.ts:11`), and one sentence: "Voids and comps (`/manage/adjustment-reasons`)
  sits under Service."
- [ ] Backlog A758 (`docs/backlog.md:2180-2186`) and `docs/backlog/till.md` "## A758": one sentence
  that A758-2 built the page (link this plan), and "Left" loses A758-2. Add a short entry for each
  owner point below that the PR leaves open, in the till area.
- [ ] Commit — `"Backlog: the voids and comps page landed (A758-2)"`.

## Task 9: LOOK

- [ ] `lsof +D` the venue folder and port 8080 (memory: wa-wt reset), then
  `wa-wt demo waitron-feat-a758-2-voids-and-comps-page`; if the boot stops on
  `adjustment_reasons.name`, `wa-wt reset demo waitron-feat-a758-2-voids-and-comps-page` (the PR's
  first line) and start again. Screenshot at 1280 and 390 px, light and dark, English and Spanish:
  the page; a search with matches and with none; a grip focused; the Delete question for Complaint
  and for Other while it is the only Void reason asking for a note. Save them under
  `docs/backlog/mockups/a758-adjustment-reasons/built/` named `01-voids-and-comps-…`.
- [ ] Put each beside picture 01 and record every difference in the PR description; fix what is a
  defect; list what is a judgement call as an owner point. Commit the pictures —
  `"Pictures of the built voids and comps page (A758-2)"`.

**PR description** (first line): "Needs a venue reset where a switched-off adjustment reason
exists: it comes back as a reason, and one sharing a name with another stops the upgrade." Then:
what the page does, in plain words; Decision 3's measurements (the walk passes; why no `RESETS`
entry; the probe that shows the reset); that a configuration export taken before this PR carries
`active` and is refused on import (`setup.request_invalid { field: "table:adjustment_reasons" }`,
`apps/server/src/configuration-transfer.ts:679-685`), as A758-1's already were; Changed test checks
and Fixtures grown below; the owner points.

---

## Changed test checks (each by design §6 unless stated)

- `packages/adjustments/src/migrations.test.ts:64-85` (no `active` column); `:130-136` (a second
  reason under a name is refused whatever its state). `schema/reasons.test.ts:7-11` (index name).
- `operations.test.ts`: `:64` "…and deactivates…" → deletes; `:134` (inactive listed) retired;
  `:149` (name freed once deactivated) → freed once deleted; `:183` (reorder names every active) →
  every reason; `:210` (inactive renumbered) retired; `:341`, `:391`, `:403` switch-off → delete;
  `:428` (a switched-off Void reason edited) retired; `:472` (inactive included) narrowed;
  `:486-535` (reactivating) retired.
- `policy.test.ts:213`, `:277` (switched-off reason refused) retired — `reason_inactive` retires.
- `configuration-transfer.test.ts:86-90` (only Void reasons switched off) retired; `:92-96` → "whose
  Void reasons ask for no note".
- `provisioning.test.ts:130` "even one switched off" → "a venue that already has a reason".
- `routes.test.ts:127-175` (deactivate → delete; `active` leaves the body at `:135`); `:336-340`
  (`active` leaves the body); `:346`, `:389` (the same guards through a real delete; codes and
  statuses unchanged); `:409-525` (reactivating) retired.
- `apps/server/src/adjustments-api.test.ts:1019-1051`: the retired reason → a deleted one, 404
  `adjustment_reason.not_found`; its name loses "reason_inactive".
- `apps/server/src/line-cancel.test.ts:287-314`: `inactive` → `deleted`, `adjustment_reason.not_found`.
- `apps/server/src/configuration-transfer.test.ts:1783-1795`: no "Retired" reason; 11 → 10 rows.
- `apps/till/src/i18n/codes.test.ts:365`; `widgets/adjustment-dialog.test.ts:716`, `:755`;
  `till-app-adjustments.test.ts:787`, `:801`, `:1868`, `:1878`; `till-app-parties.test.ts:11312`,
  `:11319` — `reason_inactive` → `adjustment_reason.not_found` (design §6, the till's words for a
  deleted reason).
- `packages/adjustments/src/dashboard/index.test.ts:16-38`, `:55-91` (the page, not a panel; the
  list URL); `:43` (the `name_taken` sentence, Decision 4). `client.test.ts:43`, `:94-95` (Task 4),
  and its `deactivateReason` case → `deleteReason` (Task 7).
  `packages/dashboard-modules/src/registry.test.ts:21-26`.
- `apps/dashboard/src/dashboard-app.test.ts:1828-1845` (the address is the page again, Decision 9),
  `:1847-1870` (under Service, not a tab). `dashboard-app.settings-panels.test.ts:13-64`,
  `:152-158` (its two module panels move to the `kitchen` tab; the case keeps "a panel the session
  may not see, and a disabled module's panel, are left out" and loses "the tab is then absent",
  which no tab can show now: both remaining tabs hold core panels, `dashboard-app.ts:310-339`).
  `dashboard-app.search-modules.test.ts:445-458` (the permission now gates the page's nav entry,
  not a settings destination). `screens/venue-settings-screen.test.ts:88` (the address names an
  unknown tab now), `:196-205` (two tabs, two Spanish names).
- `reasons-screen.test.ts`: `:92`, `:2307`, `:2316` (Filters and Customise) retired; `:284-421`
  (the list) rewritten to picture 01; `:424-480` (column chooser) retired; `:482-527` (phone width)
  → the sticky menu; `:529-603` (move buttons) → grips (Task 6); `:1603-1726` (disabling) → Delete
  (Task 7); `:1728-1919` (enabling) retired. `reasons-screen.a11y.test.ts:157-195`, `:315` (states
  that showed switched-off reasons and the deactivation confirmation) replaced.
  `reasons-screen.unsaved.test.ts:341`, `:482` (Task 7).

## Fixtures grown

- Every reason fixture loses `active` (`packages/adjustments/src/configuration-transfer.test.ts:7-25`,
  `migrations.test.ts:46-54`, the dashboard tests' reason objects, `client.test.ts:29`).
- `apps/server/scripts/demo-seed/seed-adjustments.test.ts` calls `listAdjustmentReasons(tx)`.
- Test helpers that found rows inside `wt-data-table` find them in the screen's own `<table>`.

## Owner points

1. **The list is a plain table** (Decision 1): no column chooser, Filters or remembered view, and
   the row menu is held on a phone's screen by the page's own CSS. The alternative is teaching
   `wt-data-table` to reorder rows (a `packages/ui` change, mutation-tested), which would give every
   reorderable list one table.
2. **Kind lozenges are neutral**, not red and green as picture 01 draws (Decision 8).
3. **Words not drawn by a picture:** the Delete question's sentences, the searching hint, the
   Spanish intro and limits («{percent}% por artículo», «{amount} por cuenta»).
4. **A deleted reason re-added under its name starts a new count** of its limits on an open bill
   (Decision 2). Default: accept; backlog entry.
