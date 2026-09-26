# Service, ordering and billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff the service workflow the service spec describes. That means one visit per
seated party, their own saved drafts, unnamed groups of work they hold and release, honest kitchen
state, reminders to release the next group, adjustments with reasons and approval, and bills that
several people can pay in several ways. All of it is built on the order, kitchen and menu rules
lane C's menus work is landing now.

**Architecture:**
- **A visit** (new core table) ties a party's tab, its split bills and anything ordered after a
  payment to one table, and it keeps the table occupied until Finish table.
- **Order groups** (new core table) replace named kitchen courses as the unit of hold and release.
  A course name becomes only a product default that pre-sorts a draft.
- **Drafts** (new core tables) are stored on the server per signed-in operator. Each draft belongs
  to one tab, can be taken over, and is submitted exactly once. A draft is priced like an unsaved
  basket.
- **Adjustments** (a new module, `@waitron/adjustments`) own reason policies and the adjustment
  history, and they apply through the existing order and pricing path.
- **Bill payments** follow a payment design written as Task 0 and approved by the owner before
  Task 14 starts.

**Tech Stack:** TypeScript, Drizzle ORM on SQLite (`drizzle-orm/sqlite-core`, `node:sqlite`), Hono
routes, Lit web components (till, dashboard, venue-service dashboard), Vitest (`useVenueDb` real
SQLite databases; real Chromium for the front-ends).

**Spec:** `docs/superpowers/specs/2026-09-20-service-ordering-and-billing-design.md`, Revision 2.
**Read its §14 first**: the owner's decisions of 2026-09-26, what the menus work now governs, and
the rules marked **Proposed**. Then the whole spec. Then read the menus spec's
§10.3 and §11 (`2026-09-20-menus-categories-and-home-layouts-design.md`) and the menus plan's D10
and D22 (`docs/superpowers/plans/2026-09-25-menus-categories-home-layouts.md`), because every task
here builds on them.

**Revision 1, 2026-09-26.** Written from two read-only audits of `main` at `17dd4b147`, plus lane
C's unlanded order-edits branch (`feat/menus-order-edits` at `1996d4ce7`). Every "today" fact below
comes from reading, not running. **Most tasks start after lane C tasks that change the same files
and rules** (see "When each task may start"), so each task's Step 0 re-maps the code it touches
against the `main` it starts from. Where the map disagrees with this plan, the task records the
difference in the ledger and follows the landed code, unless the difference changes an owner
decision. In that case it stops and asks (see Global Constraints).

---

## When each task may start

Lane C (`~/waitron-campaign-c/queue.md`) is landing the menus plan's order and till tasks: M7b
(saved-order editing, kitchen notices, the "sent" mark, the card-payment lock), M7b2, M6c, M7c (the
till's Change action), M7 (the till sells from the published menu), M7v (VAT recorded on the line),
M8 (home-layout editor, dashboard only) and M9 (the till's home page). They rewrite
`apps/server/src/working-order.ts`, `till-sale.ts`, `till-api.ts`, `kitchen-print.ts`,
`apps/till/src/till-app.ts`, the till's table screen and its API client. They also add core
migrations. Building the service workflow beside them would collide on those files and on the core
migration journal. Worse, it would build on rules that are still changing.

| Task | May start when |
| --- | --- |
| 0 `payment-design` (documents only) | now |
| 1 `adjustment-policies` (new module, dashboard) | now |
| 2 `visits` | lane C's M7c has `landed` |
| 3 `groups` | M7v `landed`, and Task 2 `landed` |
| 4 `groups-till` | M9 `landed`, and Task 3 `landed` |
| 5 `groups-kitchen` | Task 3 `landed` |
| 6 `advance-hold-tickets` | Task 5 `landed` |
| 7 `drafts` | M9 `landed`, and Task 4 `landed` |
| 8 `drafts-till` | Task 7 `landed` |
| 9 `served-and-reminders` | Tasks 4 and 5 `landed` |
| 10 `service-dashboard` | Tasks 2, 8 and 9 `landed` |
| 11 `adjustments` | Tasks 1 and 3 `landed`, and M7v `landed` |
| 12 `adjustment-reports` | Task 11 `landed` |
| 13 `standalone-ordering` | M9 `landed` |
| 14 `bill-payments` | Task 0 approved by the owner, Task 2 `landed`, M7b2 `landed` |
| 15 `bill-payments-till` | Task 14 `landed` |
| 16 `counter-handover` | Task 10 `landed` |
| 17 `unpaid-departure` | asesor Q28 answered (or the owner decides without it), and Task 14 `landed` |

**The overlap rule applies to every task, even once its gate is met.** Before starting, run
`gh pr list`. If an open pull request from another lane changes a file this task will change, end
the firing and let that pull request land first. (PR #689, printer calibration and receipt layout,
landed on `main` as `f68301750` while this plan was written; Tasks 5, 6 and 11 read the printing
path as it left it.)

---

## What the code is today (read before Task 2)

These are reading notes from `main` at `17dd4b147`; line numbers drift. Re-check each one you
depend on.

- **Tables and tabs.** `dining_tables.tab_id` points at the open tab covering the table (one open
  tab per table; several tables pointing at one tab is a join), in
  `packages/db/src/schema/dining-tables.ts`. `openTab` (`apps/server/src/working-order.ts:819`)
  opens a tab straight away when a free table is tapped (`apps/till/src/till-app.ts:1473-1520`).
  No guest count is recorded; `dining_tables.capacity` is the table's size.
- **Paying frees the table.** A settled order is terminal (`working_orders_enforce_transition`),
  and the behavioural trigger `working_orders_clear_table_status`
  (`packages/db/drizzle/0001_behavioural_triggers.sql`) clears the table's service status when its
  tab settles or is abandoned. `listTablesWithState` (`working-order.ts:3452`) then reads the
  table as free.
- **Split bills.** `splitOffCheck` (`working-order.ts:2021`) makes a table-less open order and
  copies the label, so only the till's memory links it back (`till-app.ts:1719-1736`). A check
  cannot itself be split. Each working order has at most one sale
  (`sales_working_order_id_key`), so each bill gets its own invoice.
- **Courses.** `kitchen_courses` (`packages/db/src/schema/kitchen-courses.ts`) are named, ordered
  per location. A line carries `course_id`; the earliest course fires on send and later ones are
  held (`fireLines`, `working-order.ts:897`). The rest of the course machinery:
  - `fireCourse` (`:1074`) releases a held course;
  - `sendLines` (`:1104`) sends selected lines;
  - `bumpCourseReady` and `markCourseAway` work the pass.

  `locations.fire_control` (`waiter | kitchen | expo`, `packages/db/src/schema/tenants.ts:38,112`)
  says which surface shows the Fire action. It governs the interface only; the verb is the same.
- **Kitchen state.** `ticket_items` has one row per fired line (`fired_at` null means held), with
  states `queued → preparing → ready`. Correction slips are VOID and RECALLED
  (`kitchen-ticket.ts`, `enqueueCorrectionSlips` in `kitchen-print.ts`). Reprint exists
  (`reprintOrderTickets`, `kitchen-print.ts:407`), but its ticket is not marked REPRINT. Waiting
  bands come from `kitchen_stations.warm/overdue/forgotten_after_minutes`.
- **Served** is per whole line (`markLineServed`, `working-order.ts:1409`).
- **The round.** `POST /api/working-orders/:id/round` (`addTabRound`, `working-order.ts:1264`)
  takes no idempotency key, so a retried round would add its lines twice. That is read, not run.
  The round draft lives in the table screen's memory only
  (`apps/till/src/screens/till-table-order-screen.ts`). The counter basket belongs to the till
  device and survives a change of operator (`apps/till/src/state/working-order.ts`), and it never
  merges identical lines (`:237`).
- **Voiding a line** (`voidTabLine`, `working-order.ts:1315`) deletes it with no reason or actor.
  `order_amendments` knows only `order_placed` and `order_cancelled`.
- **Manager approval** exists as `authorize` with an `override` (a second person's id and PIN) that
  returns the approver without signing the waiter out (`packages/identity/src/authorize.ts:31`).
  Only the cash drawer uses it from a route. `sale.discount` is a permission with no call site
  (`packages/identity/src/permissions.ts:8`).
- **Payments.** `settleSale` (`packages/core/src/settle-sale.ts:36`) takes every tender at once,
  and a trigger refuses a tender once the sale is settled. The till sends one tender per sale
  (`TillTender`, `till-sale.ts:65-69`). Cash change is computed; cash and manual-card tips are
  always zero; an integrated card carries a tip when the venue allows tips.
- **Product ordering.** `products.sold_alone` is stored and shown in the dashboard's product list,
  but nothing on the order path or in the published menu document reads it.
- **What lane C's order-edits branch adds** (M7b; re-read it on `main` once it lands):
  - core columns `working_orders.revision`, `working_orders.payment_attempt_at`,
    `working_order_lines.sent_at`, `working_order_lines.extra_list_id` and `ticket_items.quantity`;
  - `service_settings` and `kitchen_notices` in `packages/venue-service`;
  - a revision check on order writes, and the in-flight refusal `order.payment_in_flight`;
  - kitchen notices for recall, void and change;
  - a split line takes its kitchen ticket with it;
  - a "MOVED" slip when sent work changes table (owner, 2026-09-26).

---

## The decisions this plan makes

Owner decisions are marked as such. The rest are the plan's defaults; each PR that implements one
names it so the owner can overturn it at review.

- **D1. Groups replace courses (owner, 2026-09-26), and a group belongs to the VISIT.**
  - A new core table, `order_groups`, holds each submitted group:
    - its `visit_id` and its `position` in the visit's sequence;
    - its `state` (`held | fired | removed`), `fired_at`, `fired_by` and `submitted_by`;
    - `remind_at` (D11).
  - A top-level line gets a nullable `group_id`; extras lines follow their dish.
  - **Why the visit and not the tab:** splitting bills must not fragment the kitchen's view (spec,
    opening section). A line split onto another bill of the SAME visit keeps its `group_id`,
    whole or part, held or fired.
  - **Moving work to ANOTHER visit** (a transfer to another table's tab, an unjoin):
    - a line in a HELD group is refused with the existing `tab.split_held_line` (grep its current
      meaning after M7b, and reuse it only if it still means "held kitchen work");
    - a line in a FIRED group moves with `group_id` cleared, and M7b's MOVED slip tells the kitchen.
  - **No unique index on `position`.** A reorder rewrites several rows one at a time, and a unique
    index there breaks midway although the final state satisfies it (CLAUDE.md §3). Lists order by
    `position`, then `created_at`. Say so at the column.
  - **A group is not deleted while history points at it.** An emptied held group is removed from
    the sequence by setting its `state` to `removed`. `order_group_events.group_id` is therefore a
    real key, and events never block a delete.
  - `kitchen_courses` stays, as the product-default names that pre-sort a draft, and
    `working_order_lines.course_id` stays as that label. After submission a group is identified
    by its position, contents and state, never by a course name.
  - **Who may release** a held group stays the venue setting `locations.fire_control`, which
    governs which SCREEN offers Fire. The server does not read it (`apps/server/src/till-api.ts`
    says so today), so it is tested on screens (Tasks 4 and 5), never at the route.
  - The pass's ready and away steps move from course to group.
  - A counter order (no visit) has no groups, and it fires as today.
- **D2. A visit record (owner, 2026-09-26).** New core table `visits`:
  - `table_id` (nullable, for a later counter visit) and `guest_count` (nullable);
  - `state` (`open | needs_clearing | closed`), `opened_at`, `opened_by`, `closed_at`,
    `closed_by`;
  - `bill_requested_at` (Task 10).

  `working_orders.visit_id` is nullable (counter orders have none). Seating opens a visit and its
  tab in one transaction. `splitOffCheck`, `transferLines` into a new tab, and a round added after
  the visit's tab settled all put the new order on the same visit. The table's service status
  comes off when the visit closes, not when a tab settles. A table may have at most one open visit
  (a partial unique index on `table_id` where `state` is not `closed`). Adding a nullable column
  with a key generates a plain `ALTER TABLE … ADD` (measured by the plan review, 2026-09-26).
- **D3. A bill's invoice is issued when the bill is fully paid (owner, 2026-09-26).** Several
  payments may be taken against one bill before its invoice exists. After a general contribution,
  lines can still be split to another bill, which is paid and invoiced on its own; the original
  bill keeps the contribution. Printing the invoice before any payment is NOT built until asesor
  Q27 answers. Task 0 designs the mechanism.
- **D4. Discounts and comps reduce the line (owner, 2026-09-26), in whole cents per unit.**
  - A comp sets the line's price to zero and keeps the list price in a new column,
    `working_order_lines.list_unit_price_gross`, so the receipt shows the original price and
    €0.00. The receipt text is presentation; nothing new enters the fiscal fingerprint.
  - **Issuance rebuilds a filed line from `unit_price_gross × quantity`** (the comment above
    `workingOrderLines` in `packages/db/src/schema/orders.ts`). So a reduced line must still be a
    whole number of cents per unit:
    - an adjustment to PART of a line (1 of Steak ×2) first splits that part into its own row;
    - a reduced line total that does not divide into whole-cent units is split into at most two
      rows. For Croquetas ×3 at €3.33 with 10% off, the total is €9.99 − €1.00 = €8.99. It becomes
      2 × €3.00 and 1 × €2.99; the extra cent goes to the first rows;
    - the reduction on a line is rounded to whole cents, half up, before any split;
    - a WEIGHED line (a quantity that is not a whole number) cannot take a line discount, and it
      is left out of D15's spreading. A line discount asked for on one is refused with
      `adjustment.action_not_allowed`.
  - Every order write in this plan (groups, adjustments, drafts, served) bumps
    `working_orders.revision` and honours `order.payment_in_flight`, through the helpers M7b
    landed, never a second copy of them.
- **D5. A draft belongs to the signed-in operator, on one VISIT.** The till's PIN lock screen
  already identifies the operator. A person has at most one open draft per visit. It is the visit,
  not the tab, so a draft survives "pay, then order dessert" opening a new tab (D2). The counter basket stays
  device-owned and out of scope (the spec's per-waiter drafts are table service).
- **D6. Adjustment limits are cumulative.**
  - A reason's `max_amount` limits the sum of that reason's reductions on one BILL, percentage
    discounts included (converted to their cent amount).
  - A reason's `max_percent` limits the combined percentage taken off one LINE under that reason:
    two 10% discounts under a 15% limit refuse the second. It applies to `discount_percent` only; a
    comp is outside it.
  - Asking above either limit is refused (`adjustment.over_limit`); the owner raises a policy to
    allow more.
  - A requester below the reason's `apply_role` needs approval by someone at or above
    `approver_role`. Roles compare on `ROLE_LADDER` (`packages/identity/src/permissions.ts`), for
    which Task 1 exports a `roleAtLeast(role, floor)` helper. `authorize` checks a PERMISSION, not a
    role, so it is not the approval check here. The approver is verified by PIN with the
    identity package's existing PIN check. The refusals reuse the shipped codes:
    `authorization.not_permitted` (approval missing or approver too junior) and `pin.invalid`.
- **D7. Vocabulary.** "Held" means submitted but not released to the kitchen. The counter's
  parked basket keeps its code name "park" (`parkOrder`), and no new till string calls it held.
- **D8. Every command that changes groups, drafts or payments carries a client-made
  `submission_id`.** That covers submit, join, fire, reorder, move, draft submit and payment. For
  groups the id is recorded on the `order_group_events` row the command writes
  (`submission_id`, unique per visit where not null). A repeat finds that row and returns the
  first result, writing nothing. Task 0 decides the payment equivalent.
- **D9. A draft is priced like an unsaved basket** (spec §2, "Prices in a draft"). It
  follows the live published menu until it is submitted, and staff confirm any price change the
  till shows (menus D9). Its prices lock at submission, when its lines become saved-order lines.
- **D10. Line merging (spec §2).** Within one draft group, two lines merge (quantities add) when
  they have:
  - the same product and variant;
  - the same set of option values, compared as values, never by order;
  - the same multiset of extras, each as (product, list);
  - the same note, and neither line marked `no_merge`.

  "Split quantity" turns one row of N into N rows of 1, each marked `no_merge`. Submitted lines
  never merge with a draft line.
- **D11. Release reminders (spec §4).**
  - `service_settings.release_reminder_minutes` is nullable (null = off) and defaults to 10.
  - The group needing release is the FIRST held group in the visit's sequence.
  - Its reminder is due `release_reminder_minutes` after every fired group before it is fully
    served, measured from the latest of their served times, or at `remind_at` when a snooze set one.
  - If any fired group before it is not fully served, or has no served record, there is no timer;
    the held group is shown without one.
  - Snoozing sets `order_groups.remind_at` to now plus the snooze, and never touches a served time.
  - Firing, emptying or cancelling the group clears its reminder. Reordering recomputes it for
    whichever group is now first.
- **D12. Standalone ordering (spec §9).**
  - `products.ordering` takes `public | staff_only | not_sold_separately` and replaces
    `sold_alone`. **It is declared WITHOUT a table CHECK.** A CHECK added to an existing table makes
    drizzle rebuild it, and `products` has child tables whose rows a rebuild deletes or refuses
    (measured by the plan review: with the CHECK, `__new_products`; without it, a plain
    `ALTER TABLE products ADD`). A custom-migration trigger refuses any other value on insert and
    update, and the column says so.
  - No data is carried across (CLAUDE.md §3: no data migration before production). Every existing
    product starts `public`, the column default, so an upgraded venue must reset any product it
    had as not sold alone; the PR and backlog say so.
  - Until guest ordering exists, `staff_only` behaves as `public`, and the task says so.
  - The published menu document carries the setting.
  - The server refuses a standalone line for `not_sold_separately` with a new code in
    `packages/catalogue/src/errors.ts`, beside `product.unavailable`: `product.not_sold_separately`.
  - Being offered as an extra is independent of the setting.
- **D13. Out of scope:** guest access and QR links (spec §5 asks for a security design first),
  inventory (spec §10's later part), seat assignment, staff-to-table assignment, changing the
  floor layout during service, source-coded screen plugins (spec §11), a Bizum tender (no connected
  provider offers it), and printing the invoice first (D3, Q27). Unpaid departure IS in scope as
  Task 17, which waits for asesor Q28.
- **D14. Kitchen ticket grouping.** `service_settings.kitchen_ticket_grouping` takes `combined`
  (Burger ×3, the default) or `separate` (three entries). It is independent of billing and draft
  grouping.
- **D15. Spreading a whole-bill discount.**
  - Each line's share is `discount × line gross ÷ bill gross`, in whole cents, rounded down.
  - The cents left over go one at a time to the lines with the largest remainders; a tie goes to
    the line added earlier.
  - The shares sum exactly to the discount.
  - A line never goes below zero.
  - Weighed lines take no share (D4).
  - Each share is then applied under D4, splitting a line where its units need it.
- **D16. Equal shares (spec §6).** For an outstanding amount of `C` cents across `n` people, each
  share is `floor(C ÷ n)`, and the first `C mod n` shares get one cent more. So €100.01 across 3 is
  €33.34, €33.34, €33.33.
- **D17. Venue service settings live in `service_settings`** (lane C's one-row table in
  `packages/venue-service/src/schema/settings.ts`, which lands with M7b), never as new columns on
  `locations`. A choice column with a CHECK on `locations` rebuilds it, and 21 keys that point at
  `locations` are `no action` or `restrict` (measured by the plan review). Before adding a CHECK
  column to `service_settings`, grep for `REFERENCES service_settings`: a rebuild of a table that
  no key points at is safe; one that has a key pointing at it is a STOP. This applies to
  `clearing_workflow`, `kitchen_ticket_grouping`, `print_held_work` and
  `release_reminder_minutes`.
- **D18. Serving is recorded on a settled bill too.** A visit can pay a bill before its food is
  served, and today `working_order_lines_require_open_parent_update` refuses any update of a line
  whose order is not open. Task 9 lets the served columns (`served_quantity`, `served_at`) change on
  a settled order, by widening that trigger's exemption the way lane C's
  `0013_settled_order_freeze_new_columns.sql` names its columns. Serving is an operational fact, not
  billing, and the trigger's comment says so.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Read `CLAUDE.md` first.** §1 (writing claims), §2 (the gate), §3 (conventions), §4 (testing)
  and §5 (fiscal invariants) apply to every task. Read the topic file for the area before touching
  it: `docs/developers/conventions-data.md` for schema and migrations,
  `docs/developers/conventions-ui.md` and `design-system.md` for screens,
  `docs/developers/testing-guide.md` for any database or browser test.
- **Step 0 of every task: re-map.** Read the files the task names on the `main` it starts from.
  Write down, in the task's ledger (`docs/handoffs/`), each "today" fact this plan states that no
  longer holds, and what replaced it. Follow the landed code. If the difference changes an owner
  decision (D1–D4, or the spec's owner decisions in §14), stop, write the question in the lane's `questions.md` with a
  recommended default, and mark the task `blocked`.
- **Worktree, never `main`.** Each task is its own branch and worktree, created with
  `python3 ~/workspace/tools/worktree.py new waitron feat/service-<slug>`, where the slug is in
  each task's heading. One pull request per task, landed before the next starts.
- **Every commit needs `git commit -s`.** Commit messages and PR text are in plain English. Exact
  file, function and error-code names appear once as pointers, and a command that was run goes in
  verbatim.
- **TDD, always.** Write the failing test first, watch it fail for the right reason, then write the
  minimal code. Product fixtures give the staff, customer and kitchen names three DIFFERENT texts
  (`docs/developers/products.md`).
- **Test databases come from `useVenueDb`.** Rejected writes assert the domain error CODE, never
  `toBeInstanceOf(Error)`.
- **An owner-decided behaviour change changes the tests that pinned the old behaviour.** D1 retires
  the course-firing tests (`apps/server/src/till-api.courses.test.ts` and the course cases in
  `working-order.test.ts`); D2 retires the tests that a settled tab frees its table. Name each such
  test in the PR. Preserve every other behavioural assertion.
- **Migrations:**
  - Generate with `pnpm --filter @waitron/<pkg> db:generate`; never hand-edit a snapshot or
    `_journal.json`.
  - A trigger change is a custom migration (`drizzle-kit generate --custom`) that drops and
    recreates the trigger.
  - READ every generated SQL file. An unexpected table rebuild is a STOP (CLAUDE.md §3: a rebuild
    deletes cascading children's rows).
  - New core tables (`visits`, `order_groups`, `order_group_events`, `order_drafts`,
    `order_draft_lines`) go in the core set because they key into `working_orders` and
    `dining_tables`; say so in the commit (CLAUDE.md §3).
  - Classify each new table. `order_group_events` and the adjustments module's `adjustments` are
    declared with `appendOnly()`. **An append-only row may not hold a declared key to a row that
    product code deletes**, because the delete is then refused, or its cascade is refused by the
    append-only trigger. So `adjustments.line_id` is a plain id with no key (a void deletes the
    line), and the column says so. Groups are never deleted (D1), so `order_group_events.group_id`
    keeps its key.
  - **A CHECK added to an EXISTING table rebuilds it** (measured by the plan review on `locations`
    and `products`). New settings go in `service_settings` (D17); a new choice column on a table
    with children is declared without a CHECK and guarded by a trigger (D12).
  - Run `scripts/schema-constraints.test.ts`, `scripts/migrations-match-schema.test.ts`,
    `scripts/append-only-triggers.test.ts`, `scripts/classification-complete.test.ts`,
    `scripts/two-file-foreign-keys.test.ts`, `scripts/module-graph-honesty.test.ts`,
    `scripts/behavioural-triggers.test.ts`, `scripts/journal-monotonic.test.ts` and the package's
    own migration and schema-conformance tests.
  - Lane C also adds core migrations. On a rebase collision, regenerate; never hand-edit
    (CLAUDE.md §3).
  - Measure the upgrade on a seeded scratch venue, and state it in the PR and the backlog.
- **Error codes name the domain concept and are never renamed** (CLAUDE.md §3). This plan's new
  codes (grep the registries first and reuse any sibling):
  - `visit.bill_outstanding`, `visit.not_open`
  - `group.not_held`, `group.not_found`
  - `draft.taken_over`, `draft.already_submitted`, `draft.not_found`
  - `adjustment.action_not_allowed`, `adjustment.over_limit`, `adjustment.note_required`,
    `adjustment.reason_inactive`, `adjustment_reason.name_taken` (the sibling of
    `course.name_taken` and `station.name_taken`)
  - `product.not_sold_separately`, in `packages/catalogue/src/errors.ts`

  Shipped codes to REUSE, never duplicate (the plan review grepped them on `main`):
  - seating an occupied table: `table.occupied` or `tab.already_open` (`apps/server/src/errors.ts`;
    read which one `openTab` throws today);
  - a stale revision: M7b's `working_order.out_of_date`;
  - approval missing or too junior: `authorization.not_permitted`;
  - a wrong approver PIN: `pin.invalid`.

  Every file that throws a code imports its registry. Each code gets its HTTP status and English
  and Spanish text wherever the till or the dashboard can meet it.
- **Queries on one transaction are awaited in turn, never `Promise.all`** (CLAUDE.md §3).
  Multi-table writes share ONE transaction; a route opens one `withTransaction`.
- **Money is whole cents at the row** (`packages/shared/src/cents.ts`); every amount above the row
  stays a `Decimal`.
- **The fiscal fingerprint is unrecoverable** (CLAUDE.md §5). The golden huella gate
  (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`) and `inmutabilidad` pass UNEDITED in
  every task. If they cannot, STOP and mark the task blocked. Task 11 changes what an invoice
  charges (a discount agreed before issuance, which the closed asesor Q15 supports). Under the
  owner's pre-production decision of 2026-09-20 it lands on the automated fiscal gates. Tasks 14
  and 17 change WHEN an invoice is issued, the new ground asesor Q27 and Q28 ask about, so each
  lands only after the owner reviews it (`needs-owner-review`). Task 15 cannot start until Task 14
  has landed.
- **Nothing external may block a sale** (CLAUDE.md §5). A print failure never refuses an order.
- **Screens:**
  - Every new or changed screen follows `docs/developers/design-system.md`.
  - `--wt-*` tokens only.
  - Reordering works without dragging (up and down buttons).
  - Every action shows its scope before it acts (spec §3).
  - Open every screen and LOOK in both themes, at 390 px (handheld) and at 1280 px (till), before
    the PR (CLAUDE.md §4).
- **Strings:** every till string goes in both `en` and `es` of `apps/till/src/i18n/strings.ts`,
  and every dashboard string in `apps/dashboard/src/i18n/strings.ts` (or the module's own strings).
- **Write boundaries, not only disabled buttons** (spec §12 item 13). Every refusal a screen shows
  is also refused by the server, and a test drives the server directly.
- **"Races" are two orders of events, tested one after the other.** This engine takes one write
  transaction at a time per file (`withTransaction` IS `withWriteLock`, CLAUDE.md §3). So two
  requests issued together always run in some order, and one run sees only one of the orders (read
  `docs/developers/testing-guide.md` on concurrency and the header of
  `apps/server/src/kitchen-print.concurrency.test.ts`). A race test here runs BOTH orders as
  sequential calls and asserts each outcome. There is no general "concurrency harness" in
  `apps/server/src/testing/`; do not look for one.
- **The gate per task:** focused behavioural tests while implementing, then `/finish-branch`, which
  lets the pre-push hook run once and watches CI. Every task except Task 0 touches a risk trigger (a
  migration, concurrency, a cross-package contract or the sale path), so every one takes the FULL
  review wave.
- **Update `docs/backlog.md` in the same change that makes it stale.**

## Review Focus

These are the conditions most likely to bite a person that the spec implies but no task would
test by default. Each has its test in the named task.

1. **Two devices act on one visit at nearly the same moment.** Writes run one at a time, so each
   case is tested in BOTH orders as sequential calls (Global Constraints).
   - Takeover then submit by the old owner: `draft.taken_over`. Submit then takeover: the takeover
     finds the draft submitted (`draft.already_submitted`). Nothing is written by the loser
     (Task 7).
   - Fire then move a line into the group: `group.not_held`. Move then fire: the line is fired with
     a ticket (Task 3).
2. **A retried request after the server committed but the reply was lost.** Resubmitting the same
   draft, groups or payment with the same `submission_id` creates no second group, kitchen ticket
   or tender (Tasks 3, 7, 14).
3. **A table with one bill paid and a split bill outstanding.** It never reads as fully paid, and
   Finish table is refused `visit.bill_outstanding` (Task 2). After Finish, the next party's tab
   shows none of the old visit's bills (Task 2).
4. **Rounding cents.** A €5.00 bill discount over lines of €3.33, €3.33 and €3.34 at two VAT
   rates, and €100.01 split three ways, each sum exactly, and a rerun gives the same allocation
   (Tasks 11, 14).
5. **A paper-only station and a failed printer.** A station with no kitchen screen never shows
   Ready; "fired 20 minutes ago" is all it claims. A failed print job shows a printing problem on
   the table and the station, never refuses the next order, and never marks the order missing
   (Tasks 5, 9).

---

## Task 0: The payment and billing design — slug `payment-design`

A documents-only task: no code, no migration. It writes the separate payment design spec §6 asks
for, which Task 14 implements. Branch, `commit -s`, fast-forward `main`, push direct (CLAUDE.md
§6: `docs/`-only changes skip the PR ceremony).

**Files:**
- Create: `docs/superpowers/specs/2026-09-26-bill-payments-design.md`.
- Modify: `docs/backlog.md` (point the service entry at it).

- [ ] **Step 1: Map today's payment path.** Read these and write down, with `file:line`, how a
  sale is priced, charged and filed on each path; what one-tender-per-sale assumption each one
  makes; and what D22's lock refuses while a card is in flight:
  - `packages/core/src/settle-sale.ts`
  - `apps/server/src/till-sale.ts`, all paths
  - `packages/payments/src/schema/payments.ts`
  - `packages/payments-stripe/src/provider.ts` and `packages/payments-sumup`
  - the tender triggers in `packages/db/drizzle/0001_behavioural_triggers.sql`
  - the menus plan's D22, and M7b2 as landed
- [ ] **Step 2: Write the design.** It must decide, with the reason for each:
  1. **Where a payment against an un-invoiced bill lives.** Examples: a `bill_payments` table
     keyed to the working order, holding each payment's amount applied, tendered amount, change,
     tip, method, provider payment id, `submission_id`, and whether it is item-specific (which
     lines and quantities) or a general contribution. How those rows become `tenders` on the sale
     when the bill is fully paid and its invoice is issued (D3).
  2. **The allocation rules of spec §6:**
     - Cash change versus electronic tip: electronic overpayment is a tip shown before
       confirmation; cash overpayment is change unless the operator marks it a tip.
     - A contribution larger than the outstanding amount.
     - The €25 steak with €15 left: two offered choices.
     - Earlier tips are never consumed.
     - An item already paid for cannot be charged again.
  3. **Moving lines to another bill after a contribution** (the owner's example in spec §6,
     "Split whole items into bills"):
     - The contribution stays on the original bill.
     - A line already covered by an item-specific payment cannot move.
     - What is refused when the move would leave the original bill owing less than it has
       received, and what the operator is offered instead.
  4. **Several devices paying one bill at once.** How D22's one-timestamp lock becomes a
     per-payment lock, what is refused while a card payment on the same bill is in flight, and
     what is not. For example: may a second device take cash while a card is at the terminal?
  5. **Pending provider outcomes, retries and recovery** for each payment, and how M7b2's manual
     clear works with several payments on one bill.
  6. **Refunds** of one payment on a bill that is not yet invoiced, and on one that is.
  6a. **A reduction on a bill that already has contributions** (spec §7: a post-payment reduction
     must not silently turn the difference into a tip). A €60.00 bill with €50.00 contributed
     takes a €20.00 comp and now totals €40.00. Decide what happens to the €10.00 received beyond
     the new total: refunded, held as a credit, or the comp refused. It is never a tip.
  7. **The invoice at full payment:** which transaction issues it, and that the VAT per line is the
     rate M7v recorded, re-resolving nothing.
  8. **The acceptance tests** Task 14 will write, each with concrete amounts (spec §12 items 7 and
     8, and the owner's split-after-contribution example).
  9. **What waits on asesor Q27**, and what changes if the answer is "issue the invoice at the
     first payment".
- [ ] **Step 3: Record the open points** in the lane's `questions.md` as `needs-owner-review`, each
  with a recommended default. Commit, push direct. Task 14 does not start until the owner approves
  this design (the queue says so).

---

## Task 1: Adjustment reasons and policies — slug `adjustment-policies`

Spec §7's configurable reasons, as a new module. It applies nothing to orders yet (Task 11 does).
It is independent of lane C's files, so it can start now.

**Files:**
- Create the package `packages/adjustments` (`@waitron/adjustments`), shaped like an existing small
  module. Read `packages/bookings` or `packages/venue-service` for the descriptor, migrations,
  classification, `errors.ts`, dashboard entry, configuration transfer and `vitest.config.ts` with
  the 98/98/98/95 coverage thresholds. It contains:
  - `src/schema/reasons.ts`: `adjustment_reasons` with `id`, `name` (label), `names` (locale map,
    as other staff-facing content does), `actions` (a JSON list of
    `cancel | comp | discount_percent | discount_amount`), `max_percent` (basis points, nullable),
    `max_amount` (cents, nullable; D6: per bill, per reason), `apply_role`, `approver_role`,
    `note_required`, `active`, `position` and `created_at`. It is classified `state`.
  - One generated migration set.
  - `src/policy.ts`: `evaluateAdjustment`, a pure function.
  - `src/operations.ts`: list, create, update, deactivate and reorder reasons.
  - `src/routes.ts`: management routes under the module, guarded by a new module permission
    `adjustment.manage` granted from `manager` (`registerModulePermissions`).
  - A dashboard screen listing reasons, with an editor.
  - The demo seed's reasons: the owner's examples from spec §7 (entry error, changed mind,
    unavailable item, complaint, friends and family, employee discount, manager special), with
    sensible limits.
- Modify:
  - `packages/composition` (the module list) and `packages/dashboard-modules` (its browser twin);
  - the root shard lists the three root guards name (CLAUDE.md §2: adding a workspace package);
  - `scripts/module-seams.test.ts` only if its allowlist truly must change. Shrink, never grow;
    if it must grow, stop and ask.

**Interfaces:**
- Produces:
  ```ts
  export type AdjustmentAction = "cancel" | "comp" | "discount_percent" | "discount_amount";
  export interface AdjustmentReason { id: string; name: string; names: Record<string, string>; actions: AdjustmentAction[]; maxPercentBp: number | null; maxAmount: Decimal | null; applyRole: PersonRoleValue; approverRole: PersonRoleValue; noteRequired: boolean; active: boolean; position: number }
  export interface AdjustmentRequest { action: AdjustmentAction; reduction: Decimal; percentBp: number | null; actorRole: PersonRoleValue; note: string | null; priorReductionOnBill: Decimal; priorPercentOnLineBp: number } // priors = this reason's earlier reductions on the same bill, and its earlier percentage on the same line (D6)
  export type AdjustmentVerdict =
    | { kind: "allowed" }
    | { kind: "needs_approval"; approverRole: PersonRoleValue }
    | { kind: "refused"; code: "adjustment.action_not_allowed" | "adjustment.over_limit" | "adjustment.note_required" | "adjustment.reason_inactive" };
  export function evaluateAdjustment(reason: AdjustmentReason, req: AdjustmentRequest): AdjustmentVerdict;
  export async function listAdjustmentReasons(tx, opts?: { includeInactive?: boolean }): Promise<AdjustmentReason[]>;
  ```
  (`PersonRoleValue` is the role type `packages/identity/src/permissions.ts` already exports.)
  ```ts
  // packages/identity/src/permissions.ts — added by this task (D6)
  export function roleAtLeast(role: PersonRoleValue, floor: PersonRoleValue): boolean; // reads ROLE_LADDER
  ```
  **Module tier:** `mandatory` (`packages/module/src/module.ts`), because from Task 11 every cancel
  writes to this module's tables, and a switched-off module's tables are never migrated.

- [ ] **Step 1: Write the failing tests.** In `policy.test.ts`, one case per rule, each with the
  reason "Complaint" (`actions: [comp, discount_percent]`, `max_percent 5000`, `max_amount €30.00`,
  `apply_role supervisor`, `approver_role manager`, `note_required true`):
  - a comp of €12.00 by a supervisor with a note is `allowed`;
  - the same by `staff` is `needs_approval` with `manager`;
  - a `discount_amount` is `refused` with `adjustment.action_not_allowed`;
  - a 60% discount is `adjustment.over_limit`;
  - a 30% discount on a line already discounted 30% under this reason (`priorPercentOnLineBp
    3000`) is `adjustment.over_limit` (60% combined); with 20% prior it is `allowed` (50%);
  - a comp is never measured against `max_percent`;
  - a €12.00 comp with €20.00 already comped on the bill is `adjustment.over_limit` (the cap is
    cumulative), and with €18.00 already comped it is `allowed` (exactly €30.00 is within);
  - no note is `adjustment.note_required`;
  - an inactive reason is `adjustment.reason_inactive`;
  - `max_amount` null means no cap.

  In `permissions.test.ts`: `roleAtLeast("manager", "supervisor")` is true,
  `roleAtLeast("staff", "supervisor")` is false, and a role equal to its floor is true. In the
  operations tests: the create, update, reorder and deactivate round trip; a name reused among
  active reasons is `adjustment_reason.name_taken`;
  a deactivated reason stays listed with `includeInactive`. Also the module migration test, the
  classification test and the configuration-transfer test (reasons ARE transferred; say so). In the
  dashboard screen tests (real Chromium): the list, the editor with every field, a validation error
  beside the field and in the summary, reorder by buttons, and an axe test in both themes. Run
  them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the focused tests and the package's `test:coverage`. LOOK at
  the screen in both themes, at 390 and 1280 px, in EN and ES. Commit, then `/finish-branch`.

---

## Task 2: A visit per seated party — slug `visits`

Spec §1 (seating and related bills), §8 (Finish table, Needs clearing), §6 ("all related bills
remain visible"); D2.

**Files:**
- Create: `packages/db/src/schema/visits.ts` (D2's columns; `visit_state` via the house `enumType`
  and `enumCheck`; the partial unique index on `table_id`). Add `working_orders.visit_id` (nullable,
  keyed to `visits`) in `orders.ts`. Add `service_settings.clearing_workflow` (flag, default off;
  D17) in `packages/venue-service/src/schema/settings.ts`, with its own venue-service migration. One generated core migration, plus a custom migration that replaces
  `working_orders_clear_table_status` with a trigger on `visits` that clears the table's
  `status_id` when a visit leaves `open`.
- Create: `apps/server/src/visits.ts` with `seatTable`, `finishTable`, `markCleared` and
  `readVisitBills`, plus its test.
- Modify:
  - `apps/server/src/working-order.ts`: `splitOffCheck` and `transferLines` into a new tab carry
    `visit_id`. `addTabRound` on a table whose visit is open but whose tab has settled opens a new
    tab on the same visit and repoints `dining_tables.tab_id`. `listTablesWithState` reads
    occupancy from the visit and returns its bills. `openTab` stays as the internal step
    `seatTable` calls.
  - `apps/server/src/till-api.ts` and `device-api.ts` (routes, and their device twins),
    `apps/server/src/errors.ts`, `apps/server/src/live-resources.ts`.
  - The till: `apps/till/src/screens/till-floor-screen.ts` (the seat dialog with an optional guest
    count; the Needs clearing state with Mark cleared); `till-table-order-screen.ts` (the visit's
    bills with paid and outstanding amounts, the table's total outstanding, settled bills and
    their receipts, and Finish table); `apps/till/src/api/client.ts`; the i18n strings and codes.
  - `apps/server/scripts/demo-seed/` (open tables get visits).

**Interfaces:**
- Produces:
  ```ts
  export async function seatTable(tx, cfg, args: { tableId: string; guestCount: number | null; operatorId: string }): Promise<{ visitId: string; tabId: string }>; // the reused occupied-table code
  export async function finishTable(tx, cfg, args: { visitId: string; operatorId: string }): Promise<{ state: "closed" | "needs_clearing" }>; // visit.bill_outstanding, visit.not_open
  export async function markCleared(tx, cfg, visitId: string): Promise<void>; // visit.not_open when not needs_clearing
  export interface VisitBill { workingOrderId: string; label: string | null; status: "open" | "placed" | "settled" | "abandoned"; total: string; outstanding: string }
  export async function readVisitBills(tx, visitId: string): Promise<VisitBill[]>;
  // wire: POST /api/tables/:id/seat { guestCount }, POST /api/visits/:id/finish, POST /api/visits/:id/cleared, GET /api/visits/:id/bills
  // TableState gains visit: { id, guestCount, state, outstanding: string, billCount: number } | null
  ```

- [ ] **Step 0: Re-map** (Global Constraints), especially `splitOffCheck`, `transferLines`,
  `moveTab`, `unjoinTable` and table merging after M7b. List every path that creates a tab or
  moves a tab between tables; each must keep or set `visit_id`.
- [ ] **Step 1: Write the failing tests:**
  - **Seating:** `seatTable` on free Mesa 4 with guest count 3 opens a visit and a tab; the table
    reads occupied with `guestCount 3`. Seating Mesa 4 again is refused with the reused
    occupied-table code (Global Constraints), and exactly one visit exists. A direct insert of a
    second open visit for Mesa 4 fails the partial unique index.
  - **Related bills:** Mesa 4's tab holds Burger €12.00, Wine €30.00 and Water €2.00. Split the Wine
    to a check. The check carries the visit. `readVisitBills` lists both bills. The table's
    outstanding is €44.00. Pay the tab (€14.00): the table still reads occupied, outstanding €30.00,
    and never "paid".
  - **Pay, then order dessert:** with the tab settled and the check paid, the visit is still open.
    Adding a round with a Flan opens a new tab on the same visit, `dining_tables.tab_id` points at
    it, and the earlier sale is untouched (its `sale_lines` compare equal before and after).
  - **Finish:** Finish with the €30.00 check open is `visit.bill_outstanding`, and nothing changes.
    Once everything is paid, Finish closes the visit, frees the table and clears its service
    status. An empty open tab on the visit is abandoned by Finish, not counted as outstanding.
  - **Needs clearing:** with `clearing_workflow` on, Finish leaves the table `needs_clearing`, and
    seating it is refused with the reused occupied-table code until `markCleared`. With it off (the default), Finish
    frees the table at once.
  - **The next party** (Review Focus 3): after Finish, seating Mesa 4 opens a new visit whose bills
    list is empty.
  - **Moves:** moving the party to Mesa 7 (`moveTab`) keeps the visit and moves `table_id`. A join
    keeps one visit, and an unjoin gives the detached table a new visit. Mirror whatever M7b left
    the transfer paths doing.
  - **Retired behaviour:** the tests that a settled tab frees its table, and the trigger test for
    `working_orders_clear_table_status`, change. Name them in the PR.
  - **The till (real Chromium):** tap a free table, get the seat dialog, enter 3, see the tab. The
    table screen lists both bills with paid and outstanding amounts and the total. Finish with an
    outstanding bill shows the refusal and offers Take payment. Needs clearing shows on the floor
    with Mark cleared. There is an axe test for the new dialog.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the focused tests plus `apps/server` and `apps/till`
  `test:coverage`. Measure the upgrade. LOOK at the floor, the seat dialog and the bills list in
  both themes at 390 and 1280 px. Commit, then `/finish-branch`.

---

## Task 3: Groups replace courses — the server — slug `groups`

Spec §3 (the four draft actions, later additions, editable held groups) and §12 items 3 and 4; D1,
D4's last bullet, D8. The kitchen and pass screens are Task 5 and the till is Task 4; this task's
tests drive the routes.

**Files:**
- Create in `packages/db/src/schema/order-groups.ts`:
  - `order_groups` (D1's columns, keyed to `visits`; no unique index on `position`, with the reason
    at the column);
  - `order_group_events` (`appendOnly()`): `id`, `visit_id`, `group_id` (keyed; groups are never
    deleted), `kind` (`submitted | joined | fired | reordered | lines_moved | removed`),
    `submission_id` (nullable; unique per `visit_id` where not null, D8), `actor_id`, `detail`
    JSON, `created_at`;
  - `working_order_lines.group_id` (nullable, keyed to `order_groups`), in `orders.ts`.

  One generated core migration. The plan review measured that adding the keyed column generates a
  plain `ALTER TABLE … ADD`; READ the SQL anyway.
- Create: `apps/server/src/order-groups.ts` with `submitGroups`, `fireGroup`, `reorderHeldGroups`,
  `moveLinesToGroup`, `listOrderGroups`, plus its test.
- Modify:
  - `apps/server/src/working-order.ts`:
    - for lines on a visit, `fireLines`, `sendLines` and `fireCourse` are replaced by group firing;
    - `sent_at` is stamped when a group fires, for routed and no-route lines alike, as M7b stamps
      it per course;
    - **firing refuses a group holding an unsent line whose product became unavailable**
      (`product.unavailable`, as M7b's send check does; menus §11.3), and nothing is fired;
    - M7b's rules for editing sent work (menus §10.3), its kitchen notices, its revision bump and
      its `order.payment_in_flight` refusal apply to every group write;
    - `splitOffCheck` and `transferLines` follow D1: within the visit, `group_id` is kept; to
      another visit, a held-group line is refused and a fired-group line moves with `group_id`
      cleared.
  - `till-api.ts` and `device-api.ts`: the routes. Retire `POST …/round`, `…/courses/:id/fire` and
    the course routes' firing; keep course CRUD as default labels.
  - `apps/server/src/kitchen.ts`: courses lose their firing role; `setProductCourse` stays.
  - `errors.ts` and `live-resources.ts`.
  - `apps/till/src/api/client.ts`: the wire types only. The screen is Task 4, so the till keeps
    compiling by mapping its current Send and Fire course buttons onto the new routes. Say in the
    PR that the till's look is unchanged until Task 4.

**Interfaces:**
- Produces:
  ```ts
  export type GroupRelease = "fire" | "hold";
  export interface SubmitGroupsInput {
    submissionId: string;
    groups: { lines: RoundLine[]; release: GroupRelease }[];   // RoundLine is today's round-line wire type
    joinGroupId?: string;                                       // a later addition into an existing HELD group; then groups.length must be 1 and release "hold"
    operatorId: string;
  }
  export interface OrderGroup { id: string; position: number; state: "held" | "fired"; firedAt: string | null; remindAt: string | null; lineIds: string[]; summary: string } // summary e.g. "2 × Steak, 1 × Fish"; removed groups are never returned
  export async function submitGroups(tx, cfg, visitId: string, input: SubmitGroupsInput): Promise<OrderGroup[]>; // lines go on the visit's open tab; group.not_held, group.not_found
  export async function fireGroup(tx, cfg, visitId: string, groupId: string, args: { submissionId: string; operatorId: string }): Promise<void>; // group.not_held, product.unavailable
  export async function reorderHeldGroups(tx, cfg, visitId: string, heldGroupIds: string[], args: { submissionId: string; operatorId: string }): Promise<void>; // exactly the held groups; fired positions never change
  export async function moveLinesToGroup(tx, cfg, visitId: string, moves: { lineId: string; quantity: string }[], target: { groupId: string } | "new", args: { submissionId: string; operatorId: string }): Promise<void>; // only between held groups; an emptied group becomes `removed`
  export async function listOrderGroups(tx, visitId: string): Promise<OrderGroup[]>;
  // Every mutating call with a submissionId already recorded on this visit returns the first result and writes nothing (D8).
  // wire: POST /api/visits/:id/groups, POST /api/visits/:id/groups/:gid/fire, PUT /api/visits/:id/groups/order, POST /api/visits/:id/groups/move, GET /api/visits/:id/groups
  ```

- [ ] **Step 0: Re-map** `fireLines`, `sendLines`, `fireCourse`, `recallLines`, `voidTabLine`,
  `updateOrderLine`, `splitOffCheck`, `transferLines` and the `sent_at` stamping as M7b and M7c
  landed them. List every caller of the course firing verbs, the till's included. Read what
  `tab.split_held_line` means after M7b.
- [ ] **Step 1: Write the failing tests:**
  - **The spec's example (§3, §12 item 3):** a seated visit and a draft of Beer ×2 and Water
    (drinks), four cold starters, four warm starters, Steak ×2 and Fish (mains), and Flan ×2
    (desserts).
    - Fire the drinks: one fired group at position 1.
    - Fire the cold starters: a fired group at position 2.
    - Hold the warm starters: a held group at position 3.
    - Submit the mains and desserts as two held groups: positions 4 and 5.
    - `listOrderGroups` returns five groups, and the two starter groups are distinct with no
      course name in them. Tickets exist for groups 1 and 2 only, and every line in them has
      `sent_at`.
  - **Fire all now** of a four-line draft makes ONE fired group, never one per course.
  - **Later additions (§12 item 4):**
    - a later Steak submitted with `release: "fire"` makes a new fired group;
    - with `joinGroupId` = the mains group (held), it joins at position 4 and the group's
      `remind_at` is unchanged;
    - `joinGroupId` = the fired drinks group is `group.not_held`, and nothing is written;
    - no call ever matches by course name: a Steak whose product default is "Mains" submitted
      with `release: "fire"` does NOT join the held mains group.
  - **Editing held groups:**
    - reorder puts desserts before mains; fired groups keep positions 1 and 2;
    - reordering three held groups into reverse order succeeds (no unique index trips midway);
    - a reorder list naming a fired group, or missing a held one, is refused and changes nothing;
    - move one Steak from mains to desserts;
    - move the Fish out of a group that holds only it: that group reads `removed`, is absent from
      `listOrderGroups`, and its events are still readable;
    - split Steak ×2 in a held group into two rows (reuse the line-carving logic M7b left);
    - each change writes one `order_group_events` row naming the operator and bumps the order's
      `revision`;
    - a held group's lines stay freely editable, since they are not sent (menus §10.3).
  - **Firing:**
    - `fireGroup` on the warm starters stamps `sent_at`, creates tickets and prints at fire, as
      today's course firing does, and writes a `fired` event;
    - firing it again with a new `submissionId` is `group.not_held`;
    - a no-route line in a held group gets `sent_at` only when the group fires;
    - a held group holding a Steak whose product became unavailable: `fireGroup` is
      `product.unavailable`, and nothing fires, not even its other lines. After the Steak is
      removed, it fires.
  - **Retries (Review Focus 2), one per command, each writing nothing the second time:**
    - `submitGroups` twice with one `submissionId` returns the same groups and creates no second
      ticket or line;
    - a `joinGroupId` submission repeated adds its Steak once;
    - `fireGroup` repeated with its `submissionId` prints once;
    - `moveLinesToGroup` repeated moves once.
  - **Two orders of events (Review Focus 1)**, as sequential calls (Global Constraints):
    - fire the mains, THEN move a Steak into it: the move is `group.not_held`, and the Steak stays
      where it was;
    - move a Steak into the mains, THEN fire it: the Steak is in the fired group, with a ticket.
  - **Splits and moves (D1):**
    - split a held-group line onto a check of the same visit: the new row keeps `group_id`, and
      firing the group fires it too, on the check;
    - transfer a held-group line to another table's tab: refused (the reused code), and nothing
      moves;
    - transfer a fired-group line there: it moves, its `group_id` is null, and M7b's MOVED slip
      prints.
  - **During a card payment:** with `payment_attempt_at` set on the tab (M7b's D22 test setup), a
    submit and a move into a held group are each `order.payment_in_flight`.
  - **A counter order** places and fires as today, with no groups.
  - **Retired behaviour:** `till-api.courses.test.ts` and the course-firing cases. Name them in the
    PR.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the focused tests plus `apps/server` `test:coverage`, and
  the till's tests (it must still compile and pass on the mapped buttons). Measure the upgrade.
  Commit, then `/finish-branch`.

---

## Task 4: Groups on the till — slug `groups-till`

Spec §3 (the draft actions with visible scope, later additions, editing held groups) and §2's
split quantity on the table screen. Real Chromium.

**Files:**
- Modify:
  - `apps/till/src/screens/till-table-order-screen.ts`: the draft is pre-sorted by each product's
    default course name; per-line checkboxes; the action bar; the destination picker; the held
    groups list with its editing controls.
  - `apps/till/src/till-app.ts`: return to the floor with a confirmation after a complete
    submission; stay on the screen after a partial one.
  - `apps/till/src/api/client.ts`; the i18n strings.
  - The till's home page, as M9 landed it, where the ordering home adds to the draft.

- [ ] **Step 0: Re-map** the table screen, the home page and the Change action as M7c and M9
  landed them.
- [ ] **Step 1: Write the failing tests** (real Chromium, the till app's existing test style with
  its stubbed API):
  - **Pre-sorting:** a draft of Beer (default "Drinks"), Croquetas ("Starters") and Steak ("Mains")
    shows three sections in the venue's course order. A product with no default goes in the first
    section.
  - **Actions show their scope before acting:**
    - with nothing checked the bar offers Send all and Fire all now;
    - with two lines checked it offers Send selected and Fire selected now;
    - each shows a preview ("Fire now: 2 items. Hold: 2 groups.");
    - confirming calls `submitGroups` with exactly the groups that preview named;
    - a Fire selected now leaves the unchecked lines in the draft and the screen open.
  - **The spec's five-group example** driven through the screen ends with five groups in the held
    groups list, positions 1–5, the first two marked fired.
  - **After a complete submission**, the till returns to the floor with "Fired: 2 groups. Held: 3
    groups."
  - **Later additions:**
    - the destination defaults to Fire now;
    - "Add to held group…" lists held groups by position and contents ("Next: 2 × Steak,
      1 × Fish");
    - "Add as new group" appends one;
    - a fired group is never offered.
  - **Editing held groups:**
    - up and down buttons reorder (no drag);
    - Move to… another held group or a new one;
    - Split quantity turns Steak ×2 into two rows that stay separate;
    - Fire on a held group asks for confirmation and fires it;
    - a refusal from the server (`group.not_held`, because another device fired it) reloads the
      groups and says so.
  - **Who may release (D1):** with `fire_control = waiter`, a held group on the table screen shows
    Fire. With `kitchen` or `expo`, the table screen shows no Fire on held groups, and Fire all now
    and Fire selected now are not offered. Read today's course-era behaviour first, and keep it
    exactly, per group.
  - **Accessibility:** an axe test on the action bar, the picker and the held-groups list, in both
    themes.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/till` `test:coverage`. LOOK at 390 and 1280 px in
  both themes, EN and ES. Commit, then `/finish-branch`.

---

## Task 5: Groups in the kitchen, the pass, and honest printing — slug `groups-kitchen`

Spec §4 (kitchen output, reprint, print problems); D1's pass; D14.

**Files:**
- Modify:
  - `apps/server/src/working-order.ts`: `bumpCourseReady` and `markCourseAway` become group
    versions, and the station queue carries each item's group position and state.
  - `apps/server/src/kitchen-ticket.ts` (a REPRINT header; the group's sequence number on a fire
    ticket; D14's `combined` or `separate` layout).
  - `apps/server/src/kitchen-print.ts` (`reprintOrderTickets` passes the reprint mark and records
    no fire event).
  - `packages/venue-service/src/schema/settings.ts` (`service_settings.kitchen_ticket_grouping`,
    D14 and D17, one venue-service migration; grep `REFERENCES service_settings` first).
  - The venue-service dashboard (the D14 setting).
  - `apps/till/src/screens/till-station-screen.ts`, `till-expo-screen.ts` and
    `widgets/station-queue.ts` (group by order group; the pass's ready and away per group).
  - `apps/server/src/alert-sources.ts`, plus the till's table screen and station screen: a failed
    or undelivered print job for an order shows "Printing problem" on that table and station, with
    Reprint, and never blocks ordering.

- [ ] **Step 0: Re-map** the kitchen print path as #689 and M7b left it (kitchen notices, MOVED slips).
- [ ] **Step 1: Write the failing tests:**
  - **Reprint:** reprinting Mesa 4's tickets prints each with a REPRINT header. No new
    `order_group_events` row, no ticket item and no `sent_at` change results (compare rows before
    and after).
  - **Ticket grouping:** Burger ×3 in one fired group prints "3 × Burger" under `combined` and
    three "1 × Burger" entries under `separate`. The bill and the draft are unchanged either way.
  - **Pass by group:** in the spec's example, the expo screen shows groups 1 and 2 and the held
    groups as "held, not released". Bump ready and away act per group, as today's course versions
    did.
  - **Who may release (D1):** with `fire_control = expo`, the expo screen offers Fire on the first
    held group and the station screen does not. With `kitchen`, the station screen offers it. With
    `waiter`, neither does. Mirror today's course-era screens exactly.
  - **Paper-only station (Review Focus 5):** a station with no kitchen screen enrolled never
    reports `ready`. The table screen shows "Fired 20 minutes ago" for its items, taken from
    `fired_at`, never "Ready".
  - **Print failure (Review Focus 5):** a print job failing for Mesa 4's fired group shows
    "Printing problem" on Mesa 4's table screen and on the station. A new round on Mesa 4 is still
    accepted, and the order is never shown as missing. After a successful reprint the problem
    clears.
  - **Browser:** the station screen groups by group, and an axe test in both themes.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server` and `apps/till` `test:coverage`. LOOK at the
  station, expo and table screens in both themes. Commit, then `/finish-branch`.

---

## Task 6: Advance HOLD tickets — slug `advance-hold-tickets`

Spec §4's configurable alternative: print held work in advance, clearly marked HOLD, then an
explicit FIRE.

**Files:**
- Modify:
  - `packages/venue-service/src/schema/settings.ts` (`service_settings.print_held_work`, a flag
    defaulting to off, D17, one venue-service migration);
  - `apps/server/src/order-groups.ts` (submitting a held group prints a HOLD ticket when the
    setting is on; firing prints a FIRE slip naming the group; an edit to a held group that
    already printed prints a HOLD correction and records a kitchen notice of M7b's `changed`
    kind);
  - `kitchen-ticket.ts` and `kitchen-print.ts`;
  - the venue-service dashboard setting.

- [ ] **Step 1: Write the failing tests:**
  - **Setting off (the default):** holding prints nothing, and firing prints the group's CURRENT
    contents, edits included.
  - **Setting on:**
    - holding the mains prints a ticket headed HOLD listing 2 × Steak, 1 × Fish;
    - moving one Steak to desserts prints a HOLD correction for the mains ("−1 Steak") and for the
      desserts ("+1 Steak"), each also a kitchen notice;
    - removing the Fish prints a HOLD cancellation;
    - firing the mains prints a FIRE slip naming the group and its current contents, and no second
      full ticket.
  - **A group held before the setting was turned on** fires with a normal ticket.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server` `test:coverage`. Commit, then
  `/finish-branch`.

---

## Task 7: Per-operator drafts on the server — slug `drafts`

Spec §2 (separate drafts, takeover, one submission), §10 (unavailable lines in a draft), §12 items
1, 2 and 13; D5, D8, D9, D10.

**Files:**
- Create in `packages/db/src/schema/`:
  - `order_drafts`: `id`, `visit_id`, `owner_id`, `revision`, `state`
    (`open | submitted | discarded`), `submission_id`, `menu_version_id` (the version the till
    priced against, M7's rule), `created_at` and `updated_at`. A partial unique index on
    (`visit_id`, `owner_id`) where `state = 'open'`.
  - `order_draft_lines`: `id`, `draft_id`, `position`, `product_id`, `variant`, `options` (JSON
    values), `extras` (JSON of product and list), `note`, `quantity`, `course_id`, `no_merge`,
    `added_by`.

  One generated core migration.
- Create: `apps/server/src/order-drafts.ts` with `readDrafts`, `saveDraft`, `takeOverDraft`,
  `submitDraft` and `normaliseDraftLines` (D10), plus its test.
- Modify: `till-api.ts` and `device-api.ts` (routes), `errors.ts`, `live-resources.ts`, and
  `listTablesWithState` (`unsentDrafts: { ownerName: string; lineCount: number }[]` per table).

**Interfaces:**
- Produces:
  ```ts
  export interface DraftLine { id: string; productId: string; variant: string | null; options: OptionSelection[]; extras: { productId: string; listId: string }[]; note: string | null; quantity: string; courseId: string | null; noMerge: boolean; addedBy: string; unavailable: boolean }
  export interface Draft { id: string; visitId: string; ownerId: string; ownerName: string; revision: number; lines: DraftLine[] }
  export async function readDrafts(tx, visitId: string): Promise<Draft[]>; // every open draft on the visit, others' included, read-only to non-owners
  export async function saveDraft(tx, cfg, visitId: string, operatorId: string, lines: Omit<DraftLine, "id" | "addedBy" | "unavailable">[], revision: number): Promise<Draft>; // draft.taken_over; a stale revision is M7b's working_order.out_of_date
  export async function takeOverDraft(tx, cfg, draftId: string, operatorId: string, revision: number): Promise<Draft>;
  export async function submitDraft(tx, cfg, draftId: string, operatorId: string, input: Omit<SubmitGroupsInput, "operatorId" | "groups"> & { groups: { lineIds: string[]; release: GroupRelease }[]; revision: number; menuVersionId: string }): Promise<OrderGroup[]>; // draft.already_submitted (unless the same submissionId: then the first result), product.unavailable, and M7's menu.version_changed
  export function normaliseDraftLines(lines: DraftLine[]): DraftLine[]; // D10, pure
  ```

- [ ] **Step 0: Re-map** M7's unsaved-basket pricing (D9 in the menus plan) and M9's home page.
  Reuse M7's version check for `menuVersionId`, never a second one.
- [ ] **Step 1: Write the failing tests:**
  - **Merging (§12 item 2):**
    - three saves adding Beer give one line Beer ×3;
    - a Burger with options [no onions, rare] and another with [rare, no onions] merge;
    - with [rare] versus [well done], they do not merge;
    - with different notes, they do not merge;
    - with an extra from "Toppings" versus the same extra from "Premium toppings", they do not
      merge;
    - Split quantity on Burger ×3 gives three `no_merge` rows that the next save does not regroup.
  - **Separate drafts (§12 item 1):** Alex and Sam each save a draft on Mesa 4. `readDrafts` returns
    both with owner names. Sam's save onto Alex's draft is `draft.taken_over`. The table state
    shows "Alex has an unsent order: 2 items".
  - **Takeover:** Sam takes over Alex's draft (revision 3). The draft's owner is Sam. Alex's next
    save or submit is `draft.taken_over`. Each line keeps `added_by` = Alex. The groups Sam submits
    record `submitted_by` = Sam.
  - **One submission, in both orders (Review Focus 1):**
    - Sam takes over, THEN Alex submits: `draft.taken_over`, nothing written;
    - Alex submits, THEN Sam takes over: `draft.already_submitted`, and the draft stays Alex's
      submitted draft;
    - two submits of one draft with different `submissionId`s give one success and one
      `draft.already_submitted`;
    - the same `submissionId` twice returns the first result, with no second group or ticket
      (Review Focus 2).
  - **Partial submission:** submitting the drinks only leaves the other lines in the open draft, in
    their positions.
  - **Unavailable (§10):** a draft line whose product became unavailable reads `unavailable: true`.
    Submitting it is `product.unavailable`, and nothing is written. Submitting only the unaffected
    lines succeeds, and the unavailable line stays in the draft. When availability returns, the
    flag clears and the line was never rewritten.
  - **Pricing (D9):** a draft built against version 7 is submitted with `menuVersionId` 7 after
    version 8 published; it is refused as M7 refuses a stale basket, and nothing is written.
  - **Navigation sends nothing:** saving the draft never creates a group or a ticket.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server` `test:coverage`. Measure the upgrade.
  Commit, then `/finish-branch`.

---

## Task 8: Drafts on the till — slug `drafts-till`

Spec §2 (the ordering home, last-added bar, the handheld Review screen, takeover on screen); D9.

**Files:**
- Modify:
  - `apps/till/src/screens/till-table-order-screen.ts` and the home page M9 landed: the draft
    is loaded from and saved to the server, with a debounced save and the revision; the last-added
    bar with +1 and −1; the handheld Review screen; other people's drafts, read-only with
    "Take over draft".
  - `till-app.ts` (a handheld layout below the till breakpoint keeps browsing and the Review
    screen separate; a wider till shows them side by side).
  - `till-floor-screen.ts` (the unsent-draft indication).
  - `api/client.ts` and the i18n strings.

- [ ] **Step 1: Write the failing tests** (real Chromium):
  - **Tapping:** three taps on Beer show "Beer ×3" in the last-added bar, and +1 makes it 4. A
    product with extras opens its customisation first, and confirming adds it.
  - **Handheld:** at 390 px, Review opens a separate screen with the whole draft. Going back keeps
    the draft and the scroll position. At 1280 px, browsing and the draft show together.
  - **Leaving:** leaving the screen sends nothing. The floor shows Mesa 4 with an unsent-draft
    mark. Coming back restores the draft from the server, even after a reload.
  - **Two operators:** signed in as Sam, Alex's draft shows read-only with "Alex has an unsent
    order". Take over draft asks for confirmation, then edits. Signed in as Alex again, the draft
    shows "Taken over by Sam" and no Send.
  - **Price refresh (D9):** a publish arriving while a draft is open shows the changed lines and
    asks for confirmation, as M7's basket refresh does.
  - **Unavailable:** an unavailable line shows flagged, is left out of Send all with a message,
    and can be removed or kept.
  - **Accessibility:** an axe test on the Review screen and the takeover dialog.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/till` `test:coverage`. LOOK at 390 and 1280 px,
  both themes, EN and ES. Commit, then `/finish-branch`.

---

## Task 9: Current orders, served, and release reminders — slug `served-and-reminders`

Spec §4 (Current orders, Served, no Collected state, reminders and snooze); §12 item 5; D11, D18.

**Files:**
- Modify:
  - `packages/db/src/schema/orders.ts` (`working_order_lines.served_quantity`, whose default is
    zero; `served_at` is set when the line is fully served), one core migration;
  - a custom core migration widening `working_order_lines_require_open_parent_update` so that
    `served_quantity` and `served_at` may change on a settled order (D18), read against lane C's
    `0013_settled_order_freeze_new_columns.sql` and whatever M7b left;
  - `service_settings.release_reminder_minutes` (default 10, nullable; D17), one venue-service
    migration;
  - `apps/server/src/working-order.ts` (`markServed` and `unmarkServed` by line and quantity, and
    `markGroupServed`, replacing `markLineServed` and `unmarkLineServed`);
  - `apps/server/src/order-groups.ts` (`releaseReminder`, `snoozeReminder`);
  - `listTablesWithState` (the reminder due per table);
  - the routes;
  - the till's table screen: a Current orders view showing groups in sequence, each row's known
    state with partial quantities, a Served action per row, quantity and group, an undo, and
    Snooze and Fire on a due reminder.

**Interfaces:**
- Produces:
  ```ts
  export async function markServed(tx, cfg, visitId: string, items: { lineId: string; quantity: string }[], operatorId: string): Promise<void>;
  export async function unmarkServed(tx, cfg, visitId: string, items: { lineId: string; quantity: string }[], operatorId: string): Promise<void>;
  export async function markGroupServed(tx, cfg, visitId: string, groupId: string, operatorId: string): Promise<void>;
  export function releaseReminder(groups: OrderGroup[], lines: { groupId: string | null; quantity: string; servedQuantity: string; servedAt: string | null }[], minutes: number | null, now: Date): { groupId: string; dueAt: string | null } | null; // pure; D11; reads OrderGroup.remindAt
  export async function snoozeReminder(tx, cfg, visitId: string, groupId: string, minutes: number): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests:**
  - **Served by quantity (§12 item 5):**
    - mark 2 of Croquetas ×4 served; the row reads "2 of 4 served", and marking the other 2 sets
      `served_at`;
    - unmarking 1 clears `served_at` and reads "3 of 4";
    - `markGroupServed` serves every line in the group, including lines split onto another bill
      of the visit;
    - a paper-only station's items go straight from fired to served, with no ready step required.
  - **Served on a settled bill (D18):** a bill of the visit is paid while its Flan is unserved;
    marking the Flan served succeeds, and its filed sale is unchanged. A change to any OTHER column
    of that line is still refused by the trigger (control).
  - **Reminder (D11):** with the interval at 10 minutes, groups 1–2 fired and group 3 held:
    - group 1 fully served at 20:00 and group 2 at 20:05 makes group 3 due at 20:15;
    - with group 2 not fully served there is no timer (`dueAt` null), and the table shows the held
      group without one;
    - snoozing 5 minutes at 20:15 makes it due at 20:20, and group 2's `served_at` is unchanged;
    - firing group 3 clears the reminder, and group 4 becomes the one waiting;
    - reordering group 4 ahead of group 3 moves the reminder to it;
    - emptying group 3 removes it, and the reminder moves on;
    - the interval null means no reminder at all.
  - **No invented state:** a fired item at a paper-only station reads "Fired 20 min ago", and no
    ready state appears anywhere for it.
  - **Browser:** Current orders shows held, released and later-added groups distinguishably;
    Served per quantity; Snooze and Fire on a due reminder; an axe test.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server` and `apps/till` `test:coverage`. LOOK in
  both themes at both widths. Commit, then `/finish-branch`.

---

## Task 10: The service dashboard's attention signals — slug `service-dashboard`

Spec §1 (the floor and counter landing views; signals that coexist; the station view per table).

**Files:**
- Modify:
  - `visits.bill_requested_at` (a "Bill requested" action; cleared when the visit's bills are all
    paid), one migration;
  - `listTablesWithState` returns a list of signals per table, not one status;
  - `apps/till/src/screens/till-floor-screen.ts` (the signals as coexisting chips);
  - `widgets/held-orders.ts` (the counter's tab list, showing the same signals, and tabs without a
    table identified by label or order number);
  - a station summary per table on the floor ("Bar: Mesa 2 ×3, Mesa 8 ×1") with a way into the
    station view;
  - the routes and strings.
- The venue-authored manual table statuses stay. "Bill requested" becomes a visit fact, and if the
  demo seed carries it as a manual status, that status is removed from the seed.

**Interfaces:**
- Produces:
  ```ts
  export type TableSignal =
    | { kind: "take_order" }                 // an open visit with no lines and no drafts
    | { kind: "unsent_draft"; ownerNames: string[] }
    | { kind: "ready"; byStation: { stationId: string; stationName: string; count: number }[] }
    | { kind: "long_wait"; band: "warm" | "overdue" | "forgotten" }
    | { kind: "release_due"; groupId: string }
    | { kind: "held_unavailable"; groupId: string; lineNames: string[] } // spec §10: staff are alerted to held items that became unavailable
    | { kind: "bill_requested" }
    | { kind: "needs_clearing" };
  // TableState gains signals: TableSignal[]
  ```

- [ ] **Step 1: Write the failing tests:**
  - **Signals coexist:** Mesa 2 has bar drinks ready, a held group due, and a bill requested. All
    three signals come back and all three chips show. Paying every bill clears `bill_requested`;
    serving the drinks clears `ready`.
  - **Take order:** a just-seated visit has `take_order`, which clears once a draft exists.
  - **Held and unavailable (spec §10):** marking Steak unavailable while it sits in Mesa 2's held
    mains gives `held_unavailable` naming the group and "Steak". Nothing is cancelled or
    substituted. Making Steak available again clears the signal.
  - **Stations:** the bar has 3 drinks ready for Mesa 2 and 1 for Mesa 8. The floor's bar summary
    lists both, and Mesa 2's signal names the bar with count 3. It is one fact read two ways, and
    serving clears both.
  - **Counter:** a counter tab without a table, labelled "Ana", appears in the tab list with its
    signals.
  - **Browser:** chips, the station summary, the counter list, and axe tests in both themes.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the tests. LOOK at 390 and 1280 px, both themes. Commit,
  then `/finish-branch`.

---

## Task 11: Cancellations, comps and discounts — slug `adjustments`

Spec §7 (reasons, approval, the history); D4, D6, D15; spec §7 on cancelling preparation
versus the charge. **It changes what an invoice charges; it lands on the automated fiscal gates
(Global Constraints).**

**Files:**
- Create in `packages/adjustments`:
  - `src/schema/adjustments.ts` (`appendOnly()`):
    - `id` and `working_order_id` (keyed; working orders are abandoned, never deleted, which Step 0
      re-checks with a grep for deletes of `working_orders`);
    - `line_id` (a PLAIN id with no key, nullable for a bill-level discount; the column says a void
      deletes the line, and that an append-only row may not hold a key to it);
    - a line snapshot (name, quantity, unit price);
    - `reason_id`, `action`, `quantity`, `before_amount`, `after_amount`, `reduction`,
      `nominal_value` (the list value of what was cancelled, which reports keep apart from the
      reduction);
    - `requested_by`, `approved_by` (nullable), `note`;
    - `stage` (`unsent | held | fired | served`), `by_guest` (flag, always false until guest
      ordering exists), `created_at`.
  - `src/record.ts`: `recordAdjustment` and `readReasonTotals` (the priors D6 needs).

  The module may not import `apps/server`. Put the order-changing half in
  `apps/server/src/adjustments-apply.ts`, which calls the module's evaluator and recorder and the
  order functions.
- Modify:
  - `packages/db/src/schema/orders.ts` (`working_order_lines.list_unit_price_gross`, D4; a plain
    `ADD COLUMN`);
  - `apps/server/src/working-order.ts`:
    - a void takes a reason and records an adjustment;
    - a comp sets the price to zero and keeps the list price;
    - a line discount lowers the locked price by D4;
    - a bill discount spreads by D15;
    - each path splits a line where D4 requires it;
  - the receipt layout (a comped line prints its list price and €0.00);
  - the routes;
  - the till's table screen: Cancel, Comp and Discount actions with a reason picker, a note, and
    the approver PIN prompt that keeps the waiter signed in.

**Interfaces:**
- Consumes: `evaluateAdjustment` and `roleAtLeast` (Task 1).
- Produces:
  ```ts
  export function spreadBillDiscount(lines: { lineId: string; addedOrder: number; gross: Decimal; weighed: boolean }[], discount: Decimal): Map<string, Decimal>; // D15, pure; weighed lines take no share
  export async function applyAdjustment(tx, cfg, args: { orderId: string; lineId: string | null; reasonId: string; action: AdjustmentAction; quantity?: string; percentBp?: number; amount?: Decimal; note: string | null; operatorId: string; approver?: { personId: string; pin: string } }): Promise<{ adjustmentIds: string[] }>;
  // refusals: adjustment.* (Task 1), authorization.not_permitted, pin.invalid, working_order.out_of_date, order.payment_in_flight
  ```

- [ ] **Step 0: Re-map** `voidTabLine`, M7b's kitchen notices and editing rules, M7v's per-line VAT,
  how issuance rebuilds a filed line from the stored unit price, and the receipt layout after #689.
- [ ] **Step 1: Write the failing tests:**
  - **Comp (D4):** comp Burger €12.00 with "Complaint". The line's price is €0.00 and
    `list_unit_price_gross` is €12.00. The filed sale for that bill has the line at zero, and its
    VAT per rate drops by the Burger's share. The receipt prints "Burger €12.00 → €0.00". The golden
    huella test passes unedited.
  - **A comp on served food:** comping a Burger whose kitchen ticket is `ready` and whose line is
    served succeeds. It records NO kitchen notice and NO new ticket: a comp changes the charge, not
    the kitchen (the control for M7b's `ticket.already_started`, which refuses edits, not
    adjustments).
  - **Partial comp:** comp 1 of Steak ×2 at €25.00. The line splits into Steak ×1 at €25.00 and
    Steak ×1 at €0.00 with list price €25.00, and the bill drops by €25.00.
  - **Line discount:** 10% off a €30.00 bottle gives €27.00, with one adjustment row with reduction
    €3.00.
  - **Whole cents per unit (D4):** 10% off Croquetas ×3 at €3.33 (€9.99). The reduction is €1.00
    and the line becomes 2 × €3.00 and 1 × €2.99 (€8.99). The filed sale's lines, rebuilt from
    unit price × quantity, sum to €8.99. A line discount on a weighed line (0.333 kg) is
    `adjustment.action_not_allowed`.
  - **Bill discount (Review Focus 4):** €5.00 across line 1 €3.33 (10% VAT), line 2 €3.33 (10%)
    and line 3 €3.34 (21%), each quantity 1.
    - D15 gives €1.66, €1.66 and €1.67 rounded down (€4.99).
    - The leftover cent goes to the largest remainder; lines 1 and 2 tie at €0.005 each, so it
      goes to line 1 (added earlier).
    - The shares are €1.67, €1.66 and €1.67, summing to €5.00.
    - The 10% lines' GROSS amount drops by €3.33 and the 21% line's by €1.67. Assert each rate's
      taxable base with the repo's own base-from-gross function, never a hand-computed figure.
    - A second run gives the same shares.
  - **Approval (D6):**
    - a staff member's comp under "Complaint" (`apply_role supervisor`) with no approver is
      `authorization.not_permitted`, and nothing changes;
    - with a manager's id and PIN it applies, the adjustment records `requested_by` = the waiter
      and `approved_by` = the manager, and the waiter's session is still valid;
    - a staff member as approver is `authorization.not_permitted`;
    - a wrong PIN is `pin.invalid`.
  - **Cumulative limits (D6):** three €12.00 comps under a €30.00 cap: the third is
    `adjustment.over_limit`. Two 30% discounts on one line under a 50% limit: the second is
    `adjustment.over_limit`.
  - **Cancel (menus §11.5):**
    - cancelling a WHOLE fired, not-started Steak ×1 records a VOID notice and slip and takes
      €25.00 off the bill;
    - its adjustment has `stage: fired`, reduction €25.00 and nominal value €25.00, and after the
      line row is gone the snapshot still reads "Steak, 1, €25.00";
    - cancelling a line already comped records reduction €0.00 and nominal value €25.00, so the
      reduction is never counted twice.
  - **Order rules:** each adjustment bumps the order's `revision`. With `payment_attempt_at` set,
    it is `order.payment_in_flight`.
  - **After payment:** an adjustment on a settled bill is refused. The spec says an issued invoice
    is corrected, not edited: grep for the code the correction path uses and reuse it.
  - **Browser:** the reason picker lists only reasons allowing the action; a required note is
    enforced beside the field; the approver prompt; an axe test.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server`, `apps/till`, `packages/adjustments` and
  `packages/fiscal-verifactu` `test:coverage`. LOOK at the screens. Commit, then `/finish-branch`.

---

## Task 12: Adjustment reports — slug `adjustment-reports`

Spec §7 "Make adjustments reviewable".

**Files:**
- Create: `packages/adjustments/src/reports.ts` plus its test, and a dashboard report screen in the
  module (or under the reports area, whichever lane C's C3 left as the home for reports; re-map
  first).
- The report shows, overall and per staff member, for a date range:
  - counts and values by action and by reason;
  - the actions before firing, after firing and after serving, separated;
  - requester and approver shown apart;
  - guest actions in their own row (always empty until guest ordering exists);
  - the rate (reductions ÷ that person's sales value);
  - the nominal value of cancelled items apart from the financial reduction;
  - drill-down to each adjustment.

- [ ] **Step 1: Write the failing tests.** The fixture day (the values are chosen so that a report
  mixing up nominal value and reduction gives a different number):
  - Alex, sales €800.00:
    - comps a €12.00 Burger (approved by Mia);
    - then cancels that comped Burger (nominal €12.00, reduction €0.00);
    - cancels a fired €25.00 Steak (nominal €25.00, reduction €25.00).
  - Sam, sales €200.00: a €3.00 discount.

  Expected:
  - Alex's row: 3 actions, total reduction €37.00 (comp €12.00 + cancellations €25.00), rate
    4.6%, and one approved by Mia.
  - Alex's cancellations: nominal €37.00 shown apart from their reduction of €25.00.
  - Sam's row: rate 1.5%.
  - The comped-then-cancelled Burger's €12.00 is counted once, under the comp.
  - A kitchen cancellation never appears as a voided invoice.
  - The drill-down lists Alex's three rows with reason, note and times.
  - Browser: the table, the drill-down, and axe in both themes.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the tests. LOOK. Commit, then `/finish-branch`.

---

## Task 13: Standalone ordering — slug `standalone-ordering`

Spec §9; D12.

**Files:**
- Modify:
  - `packages/db/src/schema/catalogue.ts` (`products.ordering` declared WITHOUT a table CHECK,
    default `public`, D12, and a custom migration adding the trigger pair that refuses any other
    value on insert and update; then drop `sold_alone` in its own generation, because the menus
    plan's migration rule forbids dropping and creating in one). READ the generated SQL: a
    `__new_products` rebuild is a STOP;
  - `packages/catalogue` (types, operations, editor input, configuration transfer);
  - the published menu document (`packages/catalogue/src/menu-document*.ts`: carry `ordering`, so
    a change flags the menu, by the menus plan's D6 and D7);
  - the order path in `apps/server/src/working-order.ts` and the draft path (refuse
    `not_sold_separately`);
  - the till's home page and search (hide `not_sold_separately` products; show `staff_only`);
  - the dashboard product editor (the three-way control) and product list;
  - the demo seed.

- [ ] **Step 0: Re-map** the menu document and the till home as M9 landed them. Grep the whole
  tree for `sold_alone` and `soldAlone`, not only `src/`.
- [ ] **Step 1: Write the failing tests** (spec §12 item 11):
  - Bacon is `staff_only` and in the Lunch menu. Staff search finds it. A standalone Bacon line
    is accepted, and it shows on the bill and receipt.
  - Bacon is `not_sold_separately`. Search does not find it, and a direct API line is
    `product.not_sold_separately`. As an extra on a Burger it still sells.
  - Changing the setting flags Lunch as changed. Publishing freezes it.
  - `staff_only` equals `public` in every current path, and a test says why (no guest ordering
    yet).
  - A direct `update products set ordering = 'secret'` is refused by the trigger (the guard the
    missing CHECK needs), and so is an insert with that value.
  - Editor: the three-way control and axe.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `packages/catalogue`, `apps/server`, `apps/till` and
  `apps/dashboard` `test:coverage`. Measure the upgrade. LOOK. Commit, then `/finish-branch`.

---

## Task 14: Several payments against one bill — the server — slug `bill-payments`

Spec §6; D3, D16; the approved Task 0 design. **Payments and fiscal issuance: full review wave,
and the owner reviews before landing.** This task's Files and Interfaces come from the approved
design. The tests below are the minimum it must contain whatever the design decides.

- [ ] **Step 0: Read the approved design** (`docs/superpowers/specs/2026-09-26-bill-payments-design.md`)
  and re-map the payment path after M7b2. Write this task's Files and Interfaces into the ledger
  before any test.
- [ ] **Step 1: Write the failing tests:**
  - **Change versus tip (§12 item 7):**
    - selected items €40.00, cash €50.00: €40.00 applied, €10.00 change, tip €0.00;
    - the operator marks it a tip: tip €10.00, change €0.00;
    - the same by card for €50.00: €40.00 applied and a €10.00 tip, returned by the preview
      BEFORE capture.
  - **Contribution:** a €120.00 bill with a general €50.00 cash contribution leaves €70.00
    outstanding. No line's price changes (it is a pool, not a discount), and no invoice exists
    yet.
  - **The steak (§12 item 8):** after €105.00 of contributions on €120.00, a €25.00 steak is chosen
    and €15.00 remains. The payment preview offers exactly two choices: pay €25.00 with a €10.00
    tip, or pay €15.00 using €10.00 of the earlier contribution. Earlier tips are never consumed.
  - **Equal shares (D16, Review Focus 4):** €100.01 across 3 gives €33.34, €33.34 and €33.33, and
    the three payments settle the bill exactly.
  - **Item already paid:** an item-specific payment for the Steak, then a second item-specific
    payment naming the Steak, is refused (code from the design).
  - **Split after a contribution (the owner's example, spec §6):**
    - €120.00 with €50.00 contributed;
    - move two lines (€30.00) to a new bill, pay €30.00, and its invoice is issued at once;
    - the original bill now owes €40.00 with the €50.00 still applied;
    - paying €40.00 issues the original bill's invoice for €90.00, with its tenders summing to
      €90.00.
  - **The invoice at full payment (D3):** no fiscal record exists for a bill until its outstanding
    amount reaches zero. Then exactly one, filing each line's rate as M7v recorded it. The golden
    huella test passes unedited.
  - **The bottle:** a whole €30.00 bottle moved to its own bill and paid by three €10.00
    contributions files ONE line of €30.00, never fractional bottle lines.
  - **Retries (Review Focus 2):** the same payment `submission_id` twice creates one payment and
    one tender.
  - **A reduction after contributions:** a €60.00 bill with €50.00 contributed takes a €20.00 comp.
    The €10.00 received beyond the new €40.00 is handled as the design decided, and it is never
    recorded as a tip.
  - **Concurrency:** whatever the design decides for two devices, tested with the concurrency
    harness, with the refusal code asserted.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/server`, `packages/core`, `packages/payments*` and
  `packages/fiscal-verifactu` `test:coverage`. Commit, then `/finish-branch`, and mark the task
  `needs-owner-review`.

---

## Task 15: Several payments on the till — slug `bill-payments-till`

Spec §6 on screen; the approved design's screen section.

- [ ] **Step 0: Read** the design's screen section and Task 14's routes.
- [ ] **Step 1: Write the failing tests** (real Chromium):
  - Pay selected items, Contribute an amount, Split equally. The remaining balance shows after
    every successful payment.
  - An electronic overpayment shows its tip allocation before confirmation.
  - Cash change is offered as change, with an explicit "leave as tip".
  - The steak case offers its two choices.
  - Moving lines to a new bill after a contribution, paying it, printing its invoice and returning
    to the original, which shows the contribution still applied.
  - Axe in both themes.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run `apps/till` `test:coverage`. LOOK at 390 and 1280 px, both
  themes, EN and ES. Commit, then `/finish-branch`.

---

## Task 16: Counter service — paid and not yet handed over — slug `counter-handover`

Spec §5 (counter): Pay is the primary action; Send without payment is a venue option; paid but
unfulfilled tabs stay listed until handed over; payment and handover in either order.

**Files:**
- Modify:
  - `apps/server/src/working-order.ts` (`markCollected` accepts a placed order in a venue using
    Send without payment, so handover before payment is recorded, and the order stays on the list
    until paid);
  - the counter's tab list (paid-not-handed-over and handed-over-not-paid signals, from Task 10's
    signals);
  - the till's counter screen (Pay primary; Send without payment only when the venue enables it,
    reusing the existing `ticket_then_pay` or `invoice_first` flows; re-map which setting governs).

- [ ] **Step 1: Write the failing tests:**
  - Prepay: a paid order stays listed as "Paid, not handed over" until handover, and handover
    removes it.
  - Paying already-sent work never fires it again (the ticket count is unchanged).
  - Send without payment: handover first, then payment. Both recorded, listed until both are done.
  - Completed orders stay reachable in history.
  - Browser: the counter list and axe.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the tests. LOOK. Commit, then `/finish-branch`.

---

## Task 17: Record unpaid departure — slug `unpaid-departure`

Spec §8; asesor Q28. **Does not start until Q28 is answered or the owner decides without it.** The
default below is Q28's option (a).

- [ ] **Step 1: Write the failing tests:**
  - With a €30.00 bill outstanding, "Record unpaid departure" needs a permission (a new module or
    core permission, granted from supervisor; grep for the naming pattern) and a reason.
  - It issues the bill's invoice for €30.00 as unpaid (per Q28's answer), records the debt with
    the staff member and reason, closes the visit and frees the table (or `needs_clearing`).
  - The debt shows in a list for later collection. Collecting it later is out of scope; say so.
  - Settled bills and history stay reachable.
  - The golden huella passes unedited.

  Run them: they FAIL.
- [ ] **Step 2: Implement.** Step 3: run the tests. Commit, then `/finish-branch`, and mark the
  task `needs-owner-review`.

---

## Finish (every task)

Each task ends with `/finish-branch` in its worktree (full review wave, Codex in the run-it seat),
then `/land-branch`. The next task starts from a freshly synced `main`. Update `docs/backlog.md` in
the task's own PR wherever the task makes it stale. **The last task to land** also sweeps spec
§12's acceptance list against what landed and records any item not met in the backlog.

## Self-Review notes

- **Spec coverage:**
  - §1 → Tasks 2 and 10 (the station view per table is Task 10; the station screen is Task 5).
  - §2 → Tasks 7 and 8 (drafts, merging, split quantity, takeover, review screen) and D9 (prices).
  - §3 → Tasks 3 and 4 (the four actions, later additions, editing held groups, history).
  - §4 → Task 5 (kitchen output, reprint, print problems), Task 6 (advance HOLD) and Task 9
    (Current orders, Served, reminders, snooze). Corrections to fired work follow menus §11.5
    (M7b, M7c).
  - §5 → counter only (Task 16); guest access is out of scope (D13).
  - §6 → Tasks 0, 14 and 15; related bills are Task 2. Q19 and Q27 stay open.
  - §7 → Task 1 (policies), Task 11 (applying them) and Task 12 (reports).
  - §8 → Task 2 (Finish, Needs clearing) and Task 17 (unpaid departure).
  - §9 → Task 13.
  - §10 → availability in drafts is Task 7; held and sent work follow menus §11.3 (M7b); inventory
    is out of scope.
  - §11 → out of scope (D13); screens reuse `wt-*` primitives throughout.
  - §12 → items 1 and 2 (Task 7), 3 and 4 (Tasks 3 and 4), 5 (Tasks 5 and 9), 6 (Tasks 5 and 6),
    7 and 8 (Task 14), 9 (Tasks 2 and 17), 10 (Tasks 11 and 12), 11 (Task 13), 13 (every server
    task's direct route tests, and Review Focus 1 and 2), 14 (every screen task). Item 12 is
    inventory, which is out of scope.
- **Interfaces used across tasks:**
  - `OrderGroup` (with `remindAt`), `GroupRelease` and `SubmitGroupsInput` come from Task 3; Tasks
    4, 7 and 9 use them. Group functions take a `visitId` and line ids, and every quantity is a
    string.
  - `seatTable` and `VisitBill` come from Task 2; Tasks 10, 14 and 17 use them.
  - `evaluateAdjustment`, `AdjustmentAction` and `roleAtLeast` come from Task 1; Task 11 uses
    them, keyed by line id.
  - `TableSignal` comes from Task 10; Task 16 uses it.
- **Honest limits of this revision:** every task after Task 1 sits on lane C code that has not
  landed. Their Files lists name today's files and their tests name behaviour, but the exact
  function signatures they extend may have moved. That is why every task begins with Step 0.
