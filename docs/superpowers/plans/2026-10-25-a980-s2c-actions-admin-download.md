# A980 slice S2c: the actions file, and an admin's download of another person's data

**Status: plan, 2026-10-25, round 1 review folded. Nothing was built when this was written.**
Round 1's review, claim check and the driver's rulings are in
`/Users/clintongormley/waitron-campaign-b/a980-s2c-plan-review/` (`round1-review.md`,
`round1-claims.md`, `round1-rulings.md`); the fold report beside them (`round1-fold.md`) says where
each finding landed. Design:
[A980 data protection, revision 2](../specs/2026-10-22-a980-data-protection-design.md) §4.2 (the
download, its two worked examples and "`actions.csv` lists sale numbers and amounts, never another
person's data"), §2.1 row s12 ("Who did what"), §5.3 row S2 (its tests), §8 owner answer O5
("staff should be able to download their own data, otherwise admins … If so, provide an admin
permission"). Overview: [the build plan](2026-10-24-a980-data-protection-build.md), row S2c and
"Notes for each slice → S2c". It builds on [S2a1](2026-10-24-a980-s2a1-own-download.md) (the seat,
the gatherer, `sendPersonalData` and its `authorize` step; its decisions 5 and 7 say what S2c
adds), [S2a2](2026-10-25-a980-s2a2-own-download-ui.md) (the README, the Profile button, the guide
section) and [S2b](2026-10-25-a980-s2b-own-download-workforce.md) (the work files, server parts,
the README's language on the subject). Branch `feat/a980-s2c-actions-admin-download`, from `main`
at `c87b4a0e0`. **No migration** (decision 4: the actions part reads in short write-lock turns of
its own, and Tasks 3a and 3b measure every turn with a stop rule). **FULL review**: a new
permission, a by-id read of another person's data, and personal data, all risk triggers. Per-task
reviews run, then `/finish-branch`.

## Words used here

- A **part** is one contributor's share of the download: the file names it may add and the code
  that reads and builds them (`packages/module/src/personal-data.ts:26-41`). A **server part** is
  one the server adds itself, passed as `serverParts` (`apps/server/src/personal-data-export-api.ts:25-26`).
- The **subject** is what every part is told about the request: whose data, the README's language,
  the moment, the venue's time zone and this node's location (`personal-data.ts:6-16`).
- The **snapshot turn** is the first of the route's two write-lock turns, in which every part's
  `prepare` runs; the **build** runs after it closes; the **re-check** is the second turn, after
  the files are built, in which the caller's `authorize` runs again
  (`personal-data-export-api.ts:67-85`). A **write-lock turn** is one `db.withWriteLock` body: the
  only write transaction on the file while it runs, so a sale waits behind it
  (`packages/store/src/write-queue.ts:4-12`, `:50-62`).
- The **actions turns** are the write-lock turns the actions part takes during its build
  (decision 4): two **row turns** that read the person's own rows, then **sale-number turns** that
  look up the sales those rows name, a fixed number of ids at a time.
- An **actor column** is a column that records which person did something to a row (who voided a
  sale, who authorised a refund), as distinct from whom the row is about.
- A **sale void** here is the annulment of a whole sale after it was recorded: a row in
  `sale_voids` (`packages/db/src/schema/sale-voids.ts:5-22`). It is **not** what the till's line
  menu calls **Void…** (`table.void_line`, `apps/till/src/i18n/strings.ts:1109`), which cancels a
  line on an open bill and is recorded by the adjustments module, beside core's
  `line_service_cancellations.actor_id` (`apps/server/src/line-cancel.ts:426-430`); decision 3.
- A **tender refund** is money given back on a payment of an issued sale (`tender_refunds`,
  `packages/db/src/schema/tender-refunds.ts:26-61`); a **bill-payment refund** is money given back
  on a payment taken against a bill before its invoice existed (`bill_payment_refunds`,
  `packages/db/src/schema/bill-payments.ts:130-171`).
- A **drawer opening** is one row of the cash-drawer audit log (`drawer_opens`,
  `packages/db/src/schema/drawer-opens.ts:10-55`).
- A **sale number** is the series code and the invoice number joined by `/`, as receipts print it
  (`formatInvoiceNumber`, `packages/core/src/record-sale.ts:101-107`).
- The **admin route** is the new `GET /management-api/staff/:id/personal-data/export`; the **own
  route** is the existing `GET /management-api/me/personal-data/export`.
- A **mirror** is a read-only copy of the venue's box whose dashboard signs everyone in as an
  ambient admin (`apps/server/src/mirror-session.ts:27-30`); decision 9.

## What this slice builds, and what it leaves

1. **`actions.json`**, a server part, in both routes' ZIPs whenever the person has at least one
   sale void, refund or drawer opening recorded against them: counts per kind, then one entry per
   action with the sale number, the amount where there is one, when, and the person's part in it.
2. **`personal_data.export`**, a new permission only admins hold.
3. **The admin route**, gated by that permission, giving the same ZIP for any person, a disabled
   one included (the design's worked example: Marta has left, emails, an admin downloads).
4. **The dashboard**: a **Download their data** item in each row menu on **Users** for whoever
   holds the permission, English and Spanish, with a refusal that offers an administrator's
   sign-in.
5. **Words**: the README's lines for `actions.json`, the own-data guide section and Profile help
   text widened, and a new Users guide section for an admin's download, English and Spanish. Every
   one names exactly what `actions.json` holds (decision 3).
6. **A guard** that lists every core column whose name matches the actor pattern of decision 2 and
   says, for each, whether the download carries it or why not yet. It knows a column only by its
   name; the three person columns the first pattern missed are named in it explicitly (decision 2).

Left for later, on purpose (each becomes a backlog point in Task 12):

- **The rest of "who did what"** (design §2.1 row s12), **line voids, comps and discounts first**:
  what the till calls **Void…** and the dashboard's **Voids and comps** page records (the
  adjustments module's `requested_by` and `approved_by`, and core's
  `line_service_cancellations.actor_id`); then sales a person rang (`sales.operator_id`),
  corrective invoices they authorised (`sales.authorized_by`), unpaid departures, receipt
  reprints, invoice PDF downloads, order changes (`order_amendments`, `ticket_item_moves`,
  `order_draft_events`, `order_group_events`, `order_groups`), whose sale a line counts as
  (`working_order_lines.credited_to`), who owns an order draft (`order_drafts.owner_id`), who is
  editing a bill (`bill_edit_states.editor_id`), parties opened and closed, daily closes, incident
  acknowledgements, membership changes, bill payments asked for, pass marks, and other modules'
  actor columns: bookings, menu publication, fiscal operations, payment holds and resolutions,
  department transfers, allergy answers, service steps. Decisions 2 and 3.
- **A manager's own copy of what they decided about others** stays its own backlog point (S2b
  decision 11); it is not in this slice either.
- **Moving the download's mount into `boot.ts`** stays its own backlog point; the admin route is
  mounted beside the own route (decision 9).
- **An in-place administrator sign-in** that keeps the current session: none exists in the
  dashboard (decision 12), so the refusal offers sign-out and sign-in instead.
- **An index on `drawer_opens`' person columns** is not added (no migration); Task 3b measures what
  one would buy, for the "measure on a box" backlog point.

## Decisions this plan makes that the design does not

1. **`actions.json` is a server part in `apps/server`, constructed with the database, not a
   module's seat value.** Its tables are core tables (`packages/db/src/schema/`), and the core entry
   in `ALL_MODULES` takes its seat values from `@waitron/db`
   (`packages/composition/src/modules.ts:144-154`). Three other homes were considered:
   - **A seat value in `@waitron/db`**: `@waitron/db` cannot import the seat's types, because
     `@waitron/module` depends on `@waitron/db` (`packages/module/package.json`, `dependencies`),
     not the reverse. A plain object of the right shape would work, but `@waitron/db` is
     mutation-tested over all of `src` (`packages/db/stryker.config.json:7`), and it cannot import
     `formatInvoiceNumber` from `@waitron/core`, which depends on it (`packages/core/package.json`).
   - **Assembled in composition**, as `CORE_TRANSFER` is (S2a1 decision 5 named both homes):
     composition does not depend on `@waitron/core` (`jq .dependencies packages/composition/package.json`
     on 2026-10-25 listed twenty packages, `@waitron/core` not among them), so it would gain a
     dependency for one seat value.
   - **`@waitron/core` itself** (`@waitron/core` is not mutation-tested: `ls packages/*/stryker.config.json`
     lists only `db`, `fiscal`, `shared`, `ui-core` and `ui`): the core descriptor would have to take
     a seat value from it through composition, the same new dependency.
   - And, decisive since decision 4: **a seat value is handed only a `Transaction`**
     (`personal-data.ts:32-35`), whose type has no `withWriteLock`
     (`packages/db/src/client.ts:36-46`), so it has no handle with which to take turns of its own.
     A server part is built where the `Database` is held.

   The server already reads these tables and formats sale numbers
   (`apps/server/src/orders-list.ts:4`, `:458`), already adds a server part the same way
   (`apps/server/src/personal-data-time-record.ts:19-56`), and core is always migrated
   (`tier: "mandatory"`, `modules.ts:147`), so the part needs no enabled-module check. Default:
   `apps/server/src/personal-data-actions.ts` exports `ACTIONS_FILES = ["actions.json"] as const`,
   `SALE_LOOKUP_CHUNK = 500` and `actionsPersonalData(db: Database, options?: { chunk?: number }):
   PersonalDataPart[]` (owner `"server"`; `chunk` defaults to `SALE_LOOKUP_CHUNK` and exists so a
   test can count turns with a small fixture), passed in `serverParts` after
   `timeRecordPersonalData(modules)`. Shared code names no module (the composition rule, home
   CLAUDE.md §3): the part reads only core tables.

2. **What "sale voids, refunds, drawer openings" covers, column by column.** Printed on 2026-10-25
   by a throwaway walk (`/tmp/a980-s2c-fold/walk/walk.test.ts`, run with the worktree's
   `packages/db` Vitest, outside the worktree; nothing in the worktree changed) over every drizzle
   table exported by `@waitron/db`'s root (`packages/db/src/index.ts`), keeping columns whose name
   matches `/(^|_)(person_id|person|by|operator_id|actor_id)$|^(credited_to|owner_id|editor_id)$/`:
   **39 columns**. The first half of the pattern alone printed 36, the same 36 the first draft
   listed. The second half names three person columns the first half misses, found by reading each
   `*_id`/`*_to` column's schema comment and the A664 core audit: `working_order_lines.credited_to`
   ("Whose sale the line counts as. A plain person id", `packages/db/src/schema/orders.ts:214-216`;
   A664 audit `docs/superpowers/specs/2026-10-16-a664-personal-data-audit.md:45`),
   `order_drafts.owner_id` (`order-drafts.ts:26`, `:33`; audit `:67`) and
   `bill_edit_states.editor_id` (`bill-edit-states.ts:10-11`). A broader control in the same walk,
   every column whose name ends `_to`, `_to_id`, `owner`, `owner_id`, `editor` or `editor_id`,
   printed those three and no other. (Control for the walk itself: it printed the three
   `tender_refunds` actor columns.)
   The part reads nine of the 39:

   | Table | Columns that select the person | The person's part (`yourPart`) |
   | --- | --- | --- |
   | `sale_voids` | `voided_by` ("The person who authorised the void", `sale-voids.ts:19-21`; written from the authorisation at `packages/core/src/record-void.ts:86-90`) | none: a void records only who authorised it |
   | `tender_refunds` | `requested_by`, `authorized_by`, `attested_by` (`tender-refunds.ts:38-40`) | `requested`, `authorized`, `attested` |
   | `bill_payment_refunds` | `requested_by`, `authorized_by`, `attested_by` (`bill-payments.ts:153-154`, `:166`) | `requested`, `authorized`, `attested` |
   | `drawer_opens` | `person_id`: the operator (`apps/server/src/receipt-print.ts:407-420`, `:555-570`, `:645-680`), or, on a calibration, whoever ran the dashboard's test drawer open, who holds `cash.drawer` (a supervisor, manager or admin: `apps/server/src/print-api.ts:1233-1243`; `cash.drawer` in the supervisor set, `packages/identity/src/permissions.ts:46-54`). `authorized_by`: who authorised a manual open, a refund's open (tender or bill refund, from the refund's authorisation: `receipt-print.ts:561`, `:652`) or ran a calibration (the same person as `person_id`, `print-api.ts:1240-1241`) | `opened`, `authorized` |

   `yourPart` lists every column of the row that names the person, in the order above; a refund the
   person asked for and authorised themselves reads `["requested", "authorized"]`.

   The other 30 are listed in the Task 4 guard as "not yet" (28, each with the backlog point of
   Task 12) or "not a person" (2): `print_jobs.claimed_by` names a print agent
   (`packages/db/src/schema/print-jobs.ts:46`, `.references(() => printAgents.id)`), and
   `invoice_deliveries.claimed_by` holds the claiming print agent's id, or for an email delivery the
   node's id (`apps/server/src/invoice-delivery.ts:221-222`; the print paths pass the agent id,
   `invoice-print.ts:83`, `invoice-page-print.ts:99`; the email worker passes its `holder`,
   `invoice-email-worker.ts:85`, which boot sets to the node id, `boot.ts:1849`, `:1898`).

   **`payment_refunds` is not read** (payments module). It is the card provider's record of the
   same refund: it is written for every tender and bill refund
   (`apps/server/src/tender-refund-sends.ts:183`, `tender-refunds.ts:97`, `bill-refunds.ts:311`,
   `:739`), so counting it would count one refund twice; it is also written by the reconciliation's
   automatic reversal (`packages/payments/src/reconcile.ts:536`, through the providers'
   `reverse.ts`, `packages/payments-sumup/src/reverse.ts:62-64`,
   `packages/payments-stripe/src/reverse.ts:85-87`), which records no person
   (`authorizedBy: params.authorizedBy ?? null`, `packages/payments/src/store.ts:259`).

3. **`actions.json` holds whole sales voided after they were recorded, refunds and cash-drawer
   openings; line voids, comps and discounts wait.** In this product "void" names two things: the
   till's line menu item **Void…** (`table.void_line`, `apps/till/src/i18n/strings.ts:1109`), whose
   reason refusal points to "Service › Voids and comps" (`:1156`), and the adjustments module's
   page **Voids and comps** (`packages/adjustments/src/dashboard/strings.ts:12-13`) cancel a line
   on an open bill; the dashboard's sales figures call the annulment of a whole recorded sale
   **Voids** (`apps/dashboard/src/i18n/strings.ts:2181`, `:2218`). The Spanish words collide the
   same way: a voided line reaches the kitchen as «Anulado» (`station.notice.void`,
   `apps/till/src/i18n/strings.ts:2430`) and the adjustments report calls a cancelled line's value
   «Valor de carta de lo anulado» (`packages/adjustments/src/dashboard/strings.ts:295`, `:307`),
   while the dashboard calls sale annulments «Anulaciones» (`apps/dashboard/src/i18n/strings.ts:5568`,
   `:5604`); the till's own line item reads «Cancelar…» (`apps/till/src/i18n/strings.ts:2839`).
   Line cancellations, comps and discounts are recorded by the adjustments module
   (`packages/adjustments/src/schema/adjustments.ts`, actions `cancel`, `comp`, `discount_percent`
   and `discount_amount` at `packages/adjustments/src/policy.ts:6-11`, with `requested_by` and
   `approved_by`), and a line cancel also writes core's `line_service_cancellations.actor_id`
   (`apps/server/src/line-cancel.ts:426-430`; the reason it takes is of kind `"void"`, `:261`).
   Default: those stay out of this slice and are named first in the "rest of who did what" backlog
   point. **Every text this slice writes** (README lines, Profile help, the guide's own-data and
   admin sections, both languages) names exactly what `actions.json` holds, in words that cannot
   be read as the till's line **Void…**: "whole sales voided after they were recorded" / «ventas
   completas anuladas después de registrarse», refunds, cash-drawer openings. No text promises a
   later addition. **Open decision for the owner** (FYI in the pull request, built with this
   default): should line voids, comps and discounts join `actions.json`? Worked example: Marta, a
   cashier, cancelled three lines on table 4's bill with the till's **Void…** and voided one whole
   sale, A/1532, from the dashboard. Her `actions.json` lists A/1532 and none of the three lines;
   her Profile help says "whole sales voided after they were recorded", so she is not told the
   lines are there. Adding them is one more task: a module part in `@waitron/adjustments`, its
   README words and its column guard.

4. **The actions part reads in short write-lock turns of its own during the build, not in the
   snapshot turn. No index, no migration.** Why:
   - **The snapshot turn has no room.** S2b left its working-time read in that turn at 213.8 ms
     median on this Mac for its fixture (`docs/backlog/data-protection.md:105-111`). The claim
     check's run of the actions read on the real schema (all core migrations, 1,000,000 drawer
     openings and sales with every column filled, 20,000 voids, 30 people; one person with 33,677
     drawer rows and 6,667 voids; `round1-claims.md`, "Notes beyond the plan's claims") took a
     median of 192 ms over twelve runs (171 to 276). Added to the same turn the sum passes 250 ms,
     S2b's bar (S2b decision 6).
   - **An index would not fix it.** The review's split of the drawer read at 1,000,000 rows
     (`round1-review.md`, experiment 3 and finding I3): the table scan alone took 64–71 ms without
     indexes on `drawer_opens(person_id)` and `(authorized_by)` and 31–35 ms with them; with the
     join to the sale, 133–162 ms without and 108–149 ms with. Most of the cost is the per-row join
     from the person's tens of thousands of rows to `sales` by random id, which grows with the
     person's history, not with the table.
   - **None of the nine columns has an index**, so each row read scans its table: `sale_voids` has
     a unique key on `sale_id` and an index on `voided_at` (`sale-voids.ts:27-33`); `drawer_opens`
     declares none (`drawer-opens.ts:56-72`); the refund tables' indexes and unique keys name the
     sale, tender, submission, payment, provider and state, never a person
     (`tender-refunds.ts:88-98`; `bill-payments.ts:178`). The claim check applied all core
     migrations and listed the four tables' indexes: none names a person column (claim #32).

   **The design (default, built):**
   - `prepare(tx, subject)` reads nothing and returns the build; it does not use `tx`.
   - The build takes, each awaited before the next and never `Promise.all`:
     1. **Row turn 1**, one `db.withWriteLock`: the person's `sale_voids`, `tender_refunds` and
        `bill_payment_refunds` rows, each table's own columns only (Task 2a's and 2b's column
        table), **no join**, each ordered by its `at` then `id`.
     2. **Row turn 2**, one `db.withWriteLock`: the person's `drawer_opens` rows, its own columns,
        **no join**, ordered by `opened_at`, `id`.
     3. **Sale-number turns**: the distinct `sale_id`s the rows name (voids, tender refunds, drawer
        openings), `SALE_LOOKUP_CHUNK` (500) ids a turn, each turn one read of `sales` by primary
        key joined to `invoice_series` by key (the series code, the invoice number, and `total` for
        a void's amount); then the distinct `bill_payment_id`s (bill-payment refunds, and every
        drawer opening whose `bill_payment_id` is set, whatever its reason), 500 a turn, each one
        read of `bill_payments` by primary key (its `method`), left-joined to `sales` on
        `sales.working_order_id` (unique, `sales.ts:141`, so the join uses that key's index) and to
        `invoice_series`. No sale-number turn grows with the person's history; the row turns grow
        with the person's own rows but carry no join.
     4. Shaping and `jsonFile`, outside any turn.
   - Each turn is `db.withWriteLock` with no `withTransaction` around it, so no change-log drain
     and nothing written, for the reason `sendPersonalData`'s own comment gives
     (`personal-data-export-api.ts:63-65`: the drain "is a write a full disk refuses").
   - **It works, run not read.** `/tmp/a980-s2c-fold/lockprobe/lock.test.ts` (outside the
     worktree, run with the worktree's `packages/store` Vitest on 2026-10-25) opened a real store,
     called the real `preparePersonalData` inside `db.withWriteLock` as `sendPersonalData` does
     (`personal-data-export-api.ts:67-78`), with a part whose build calls `db.withWriteLock`, then
     committed a row from a separate turn, then called the build outside any turn as
     `sendPersonalData` does (`:80`). The build's turn ran and returned both rows. Control in the
     same run: calling `db.withWriteLock` from inside the snapshot turn threw "write lock: a body
     asked for the lock it is already holding" (`packages/store/src/write-queue.ts:41-43`; the lock
     is not re-entrant). Had the build still counted as inside the snapshot turn, the build's turn
     would have thrown that same message. The route's own suite already does the same from a stub
     part's build (`apps/server/src/personal-data-export-api.test.ts:270-278`, `duringBuild` opens
     `withTransaction` during the build).
   - **A departure from the seat's doc comment, stated at the part's site.** `ModulePersonalData.prepare`
     says it "Reads everything this part holds about the person, inside the caller's transaction"
     and the build "must not use `tx`" (`personal-data.ts:29-31`). The build still does not use
     `tx`; it reads through the `Database` the part was built with. The part's file carries a
     commented decision: why (the two measurements above, by pointer to this plan and the pull
     request), what the turns are, and the consistency note below. The shared comment gains one
     line, no more: "A server part constructed with the `Database` may take write-lock turns of its
     own in the returned function."
   - **Consistency.** An action committed between the snapshot turn and an actions turn may appear
     in the file; the lock probe above shows a row committed between the turns is read by the
     build's turn. That is harmless: the action happened before the download was sent. Task 2b pins
     it with a case.
   - **The re-check still guards the bytes.** `sendPersonalData` runs the re-check after every
     part's build and before any bytes go (`personal-data-export-api.ts:79-85`), so a person whose
     authority is withdrawn during the actions turns gets no file. Existing case for the own route:
     `personal-data-export-api.test.ts:270-278` ends the session during a stub part's build, the
     same position as the actions turns, and expects 401 and no file. New case for the admin route:
     Task 7b's re-check case.
   - **Measured before it ships** (Tasks 3a and 3b): the snapshot turn with every other part at
     S2b's Task 6a fixture size, with and without the actions part (to show this slice did not
     lengthen it), and each actions turn with 1,000,000 drawer openings and 20,000 voids, at least
     ten runs each, with an indexed control. **Stop rule**: any turn's median over 250 ms on this
     Mac stops the slice (Task 3a and 3b). Either way the box measurement joins the existing
     "Measure … on a box" backlog point, with the actions turns added.
   - The file can be large: the claim check measured that person's drawer list alone, pretty
     printed, at 5.49 MB. No cap in this slice; Task 3b records the whole file's size for the pull
     request.

5. **The file is JSON, `actions.json`, not the design's `actions.csv`.** S2b chose JSON for the
   module files (S2b decision 2), and this file holds three kinds of entry with different fields
   and a counts block, which one CSV table cannot without empty columns. It is built with
   `jsonFile` (`packages/module/src/personal-data.ts:22-25`). The README's existing ".json files
   are a machine-readable copy" line (`apps/server/src/i18n/personal-data-readme.ts:123`) applies
   to it as to the others.

6. **What each entry holds, and what it leaves out.** Shape (keys in this order):

   ```text
   actions.json { counts: { voids, refunds, drawerOpenings },
                  voids:          [{ sale, amount, at }],
                  refunds:        [{ kind, sale, amount, tip, method, state, at, yourPart }],
                  drawerOpenings: [{ reason, sale, at, viaOverride, yourPart }] }
   ```

   - `counts` are the three lists' lengths. The design says "counts per kind …, rows on request"
     (§4.2); the route takes no query (S2a1 decision 7), so there is no "on request" form. Default:
     the rows are always included, because the copy is the person's right and the sale numbers the
     overview asks for are the rows. A long-serving cashier's file can hold tens of thousands of
     drawer rows (33,677 for the claim check's person at 1,000,000 openings).
   - `sale` is the sale number, or null where none exists. A void's and a tender refund's sale is
     the row's `sale_id` (both `.notNull()`, `sale-voids.ts:15`, `tender-refunds.ts:30`). A drawer
     opening's is its `sale_id` when set (a `tender_refund` opening always carries one,
     `drawer-opens.ts:67-69`); else, **whenever its `bill_payment_id` is set, whatever its reason**
     (`bill_payment`, `bill_refund`, or a `card_slip` written for a bill payment:
     `enqueueBillDrawer`, `receipt-print.ts:544-563`, called with `"card_slip"` at `:591`; allowed by
     `drawer-opens.ts:65`), the sale filed from the bill payment's order
     (`bill_payments.working_order_id`, `bill-payments.ts:42`, matched to `sales.working_order_id`,
     unique at `sales.ts:141`); else null (a `calibration` or `manual` opening with no sale). A
     bill-payment refund's sale is found the same way, and is null while the bill has no invoice.
   - `amount`: a void's is the voided sale's `total`; a refund's is `applied_amount` and its `tip`
     is `tip_amount`; a drawer opening has none. Each is read as integer cents through drizzle's
     query builder and written with `centsToDecimal` (the money rule, home CLAUDE.md §3; S2b
     decision 7 did the same for pay rates), so `1234` becomes `"12.34"`.
   - `kind` is `sale` (a tender refund) or `bill_payment`; `method` is the tender refund's `method`
     or the bill payment's (`bill-payments.ts:47`), both `cash` or `card`; `state` is the stored
     `pending`, `completed` or `failed`; `reason` is the drawer opening's stored reason
     (`drawer-opens.ts:32-40`); `viaOverride` is the stored flag.
   - `at` is written as stored (ISO 8601 UTC, as S2a1 decision 10): `voided_at`, the refund's
     `created_at`, `opened_at`. `opened_at` is a `ts()` column, which drizzle reads back as a `Date`
     (`packages/db/src/schema/columns.ts:29-35`), so it is written with `toISOString()`; the other
     two are stored text.
   - **Left out**: every free-text reason and attestation note (`sale_voids.reason`,
     `tender_refunds.reason`, `attestation_note`, the bill refund's): typed by staff about a sale,
     they can name a customer or a colleague, and the design says this file holds "never another
     person's data" (§4.2). **Review focus**: the person typed some of them, so a reviewer may want
     them in. Also left out: the device and printer of a drawer opening (a device's label can name
     somebody, design §2.3 row d1), every other person's id or name (who else asked for or
     authorised the same refund, who rang the voided sale), provider references, row ids, and the
     columns that run a refund's sending. Task 4's guard holds each of the four tables' columns to
     the lists in Tasks 2a and 2b.
   - **Order**, so the output is the same on every run: each list by `at`, then row id, sorted in
     the row turn's query.
   - **No row, no file** (S2b decision 3): with no sale void, refund or drawer opening the part
     builds nothing, and the README lists only built files (S2a2 decision 2). This also leaves every
     existing whole-ZIP assertion unchanged unless its fixture already holds an action row.

7. **The permission.** `personal_data.export` goes in `PERMISSIONS` straight after `person.admin`
   (`packages/identity/src/permissions.ts:15-16`) with a one-line comment that it is admin only,
   and in no role's set: admins get it because their set is every permission
   (`permissions.ts:76`, `:82`). The name is the design's and A1002's
   (`docs/superpowers/specs/2026-10-22-a1002-custom-roles-design.md:101`), and A1002 has not
   landed (`docs/backlog.md:4013`, "Awaiting owner approval"; `permissions.ts` last changed by
   #1906), so no stored role data needs writing. The permission reaches the dashboard through the
   session read's `permissions: permissionsForRole(role)` (`apps/server/src/me-api.ts:350`).
   **A module could widen it**: `roleHasPermission` is the static set or the module registry
   (`permissions.ts:123-131`), and `registerModulePermissions` accepts any id, a core one included
   (`permissions.ts:106-114`). No module registers this id today (the review's experiment 4 listed
   every `grantedFrom` floor: `adjustment.manage`, `booking.manage`, `image.manage`,
   `staffing.manage`, `venue_service.manage`, `workforce.correct`). Default: an `apps/server` case
   holds that no id in `ALL_MODULE_PERMISSIONS` (`apps/server/src/modules.ts:39-41`) is in
   `PERMISSIONS` (Task 1), and Task 7a's refusal cases call
   `registerModulePermissions(ALL_MODULE_PERMISSIONS)` first, as boot does (`boot.ts:926`).
   `registerModulePermissions` itself is not changed.

8. **The admin route's checks, in this order**, inside its `authorize` (S2a1 decision 7 runs it in
   the snapshot turn and again in the re-check):
   1. `authorizeManager(tx, { managementSessionId, permission: "personal_data.export", touch: false })`
      (`packages/identity/src/manager-login.ts:162-175`): no cookie 401
      `management_session.required` (`requireManagementSession`, before the turn), ended 401, idle
      401 `management_session.expired`, a disabled caller 403 `person.suspended`, no permission 403
      `authorization.not_permitted` `{ permission: "personal_data.export" }`. `touch: false`
      writes nothing, as the own route (S2a1 decision 7).
   2. Any query string: 400 `management.request_invalid` `{ field: "query" }`, as the own route.
   3. The path id: not a UUID, or no `persons` row, 404 `person.not_found` `{ personId }`, the code
      and status the staff routes already give an unknown person (`requirePersonId`,
      `apps/server/src/management-api.ts:301-304`; `"person.not_found": 404` at `:245`), and the
      house status rule: "the thing the request's path points at is missing → 404"
      (`docs/developers/conventions-data.md:37-40`).

   **The permission is checked before the id**, so a caller without it gets the same 403 for any
   id, real, unknown or malformed, and cannot learn which people exist. A target's status does not
   matter: active, pending and disabled people are all downloadable (the worked example's Marta is
   disabled). An admin may name themselves; they get their own data. **An admin may download
   another admin**: design §4.2 gives every other person's data to the permission with no
   exception, and the A1000 admin-only rules (`packages/identity/src/staff.ts:125-128`, `:224-238`)
   protect an admin from managers, not from other admins (read, not run; Task 7a's case pins it). A
   staff member or supervisor is refused 403 whoever they name, themselves included: their own copy
   is the own route's.

   `withPersonalDataErrors` (`personal-data-export-api.ts:35-43`) gains
   `"authorization.not_permitted": 403`, as S2a1 decision 5 foresaw
   (`docs/superpowers/plans/2026-10-24-a980-s2a1-own-download.md:141-146`), and
   `"person.not_found": 404`, which that decision did not name; the own route throws neither (its
   `authorize` calls only `resolveManagementSession`, `personal-data-export-api.ts:116`), and both
   entries are shared because the map is one. Without the entries both codes would answer the
   boundary's default 400 (`packages/server-kit/src/error-boundary.ts`, `status[code] ?? 400`).
   **No new error code**, so no registry, `scripts/errors-reachable.test.ts` or
   `scripts/alert-codes.test.ts` change is due; both codes are declared in identity's registry
   (`packages/identity/src/errors.ts:42`, `:71`).

   **No product code deletes a person after setup.** On 2026-10-25,
   `git grep -n -E '\.delete\(persons\)|delete from "?persons' -- 'packages/*/src/**' 'apps/*/src/**' ':!*.test.ts' ':!**/testing/**'`
   printed nothing (exit 1). Control, the same command without the two exclusions: 11 files, all
   test files (`apps/server/src/boot.test.ts`, `certificate-reminder-worker.test.ts`,
   `me-api.test.ts`, `till-api.receipt.test.ts`, `till-api.test.ts`, `units-api.test.ts`, and
   `packages/identity/src/authorize.test.ts`, `management-session.test.ts`,
   `profile-admission.test.ts`, `profile.test.ts`, `staff.email.test.ts`). (The first draft's
   pathspec, `'packages/*/src' 'apps/*/src'`, matches no file at all:
   `git grep -l import -- 'packages/*/src' 'apps/*/src' | wc -l` printed 0, and with `/**` 5973.)
   A regular expression cannot see a table named through `sql.identifier`, and one such delete
   exists: first setup's configuration import removes every non-admin person
   (`packages/provisioning/src/configuration-transfer.ts:695-699`, `delete from
   ${sql.identifier(declaration.name)} where role <> 'admin'` when the table is `persons`, called
   through `importConfigurationTables` from `first-setup-command-deployment.ts:329`). That runs
   during setup, before anyone can open **Users**. So from the dashboard `person.not_found` follows
   only a stale list or a fault (decision 12 words it as a fault).

   **The re-check repeats the permission**: an admin demoted to manager while the files are built
   is refused 403 in the re-check and sent nothing. A role change alone ends no session
   (`packages/identity/src/staff.ts:275-277` revokes access only when the email or status changes;
   `setRole`, `:498-511`, the same), so this case is reachable.

9. **Mounted by `mountPersonalDataExportApi`, beside the own route.** The function
   (`personal-data-export-api.ts:105-128`) already holds every dependency the ZIP needs (modules,
   server parts, venue language, privacy-notice address, clock), and it is called from
   `mountMeApi` (`apps/server/src/me-api.ts:119-131`). `mountManagementApi`'s dependencies hold no
   module list (`apps/server/src/management-api.ts:138-170`), so mounting there would mean passing
   the modules and server parts through `boot.ts` as well. **This departs from S2a1 decision 5**,
   which said the S2c route would be "mounted from the management API mount rather than from
   `mountMeApi`" (S2a1 plan `:141-143`), for the reason just given. Default: the function mounts
   both routes; `mountMeApi`'s comment, which says its routes are role-blind and never call
   `authorizeManager` (`me-api.ts:104-109`), gains one sentence that the personal-data mount it
   calls also carries the admin route, which does. Moving the mount into `boot.ts` stays its own
   backlog point (`docs/backlog/data-protection.md`, "Mount the own download from `boot.ts`").
   **Review focus**: a reviewer may prefer the mount moved now; `boot.ts` is in no open pull
   request (`gh pr list --state open` on 2026-10-25 listed only #1986, whose files are
   `docs/backlog.md` and `packages/core/src/record-substitution.ts`).

   **On a mirror the admin route answers, like every other read there.** A mirror seeds an `admin`
   viewer and sets its cookie on every request (`ensureMirrorViewer`, `mirrorSession`,
   `apps/server/src/mirror-session.ts:27-63`, `:92-140`); the read-only gate passes every GET
   (`apps/server/src/read-only-gate.ts:17`, `:34-38`); what keeps a mirror off the network is a
   loopback bind unless `WAITRON_MIRROR_ALLOW_EXPOSED` is set (`mirror-bind-guard.ts:1-3`). So
   anyone who reaches a mirror's address can download any person's data, as they can already read
   the staff list's personal data there. Default: it answers; Task 8b pins it with one real-boot
   case so the choice cannot change silently. **Open decision for the owner** (FYI in the pull
   request, built with this default): should the admin route refuse on a mirror? Worked example:
   the owner opens the mirror on the office laptop at `http://127.0.0.1:…`; without signing in,
   **Users** → Marta → **Download their data** gives her ZIP, as the mirror already shows her email
   on **Users**.

10. **The README for someone else's download is in that person's language.** The own route uses
    the requester's saved language, else their browser's, else the venue's (S2a2 decision 1); for
    the admin route the browser is the admin's, so it is not used. Default:
    `resolveActiveLocale(target.locale, deps.venueLocale)` (`packages/shared/src/locales.ts:37-44`),
    then `es-…` → Spanish, anything else → English, the same mapping as the own route
    (`personal-data-export-api.ts:119-123`). The working-time files follow it (S2b decision 5).
    The README stays addressed to the person ("Your data held by …", "Prepared for {name}"), because
    the admin hands it to them. The file name is the target's display name and the venue's date
    (S2a1 decision 8).

11. **The row menu item.** `dashboard-staff-list` gains `canExportPersonalData` (default false)
    and `downloadingPersonId` (`string | null`), both in its columns' memo inputs
    (`apps/dashboard/src/widgets/staff-list.ts:38-41`; A1000 added `canAdminister` there for the
    same reason, a cell reads it). With `canExportPersonalData`, every row's menu ends with a ghost
    `wt-button` `data-test="download-data-<id>"` reading **Download their data** / «Descargar sus
    datos», after the existing items (`staff-list.ts:96-113`), so the existing menus' order is
    unchanged. It dispatches `download-person-data` `{ personId }` (an app component's event, so a
    plain name, home CLAUDE.md §3), not `person-action`, whose handler opens a confirm dialog and
    returns unless `canAdminister` (`apps/dashboard/src/screens/staff-screen.ts:103-118`). The
    screen gains `canExportPersonalData`, set by the app from
    `this.#sessionPermissions.includes("personal_data.export")` beside `canAdminister`
    (`apps/dashboard/src/dashboard-app.ts:2553-2557`). Today only admins hold it, so the item
    appears exactly where `canAdminister` is true; it reads its own permission so custom roles
    (A1002) can separate them. A disabled person is shown with the **Status** filter on **Disabled**
    or **All statuses** (`staff-screen.ts:157-171`, `:392-400`).
    - **States** (design-system.md → Forms): a download is a read, not a save, so no confirm
      dialog. While one is out, every row's item is `disabled` and the handler returns early
      (`disabled` stops a person, not a test); design-system.md excludes "a button disabled only
      while a request is being sent" from the quiet-button rule (`docs/developers/design-system.md:2773`).
      The menu closes on the press (`wt-row-actions` keeps itself open only for `data-keep-open`,
      design-system.md:848), so progress is shown under the table: a `role="status"` line with a
      decorative `wt-spinner`, "Preparing a copy of {name}'s data…" / «Preparando una copia de los
      datos de {name}…» (the third form at design-system.md:1188-1190).
    - **Success** saves the blob under the server's file name, else `personal-data.zip`, and
      releases its address, exactly as the Profile page does
      (`apps/dashboard/src/screens/profile-screen.ts:760-779`).
    - **Failure** is held in its own field, not the screen's `errorKey`, whose read-versus-action
      bookkeeping feeds the edit and create dialogs' feet (`staff-screen.ts:86-91`, `:424`, `:503`),
      so a download failure never appears in a later dialog; it is shown under the table with
      `role="alert"` until the next press. A refusal never disables the item. Session refusals
      also return to sign-in through the existing signal (`apps/dashboard/src/session-signals.ts:6-21`).
      Decision 12 gives the permission refusal and the unknown-person line.
    - **Leaving** while a download is out drops its answer (a counter, as the Profile page's
      `#download`).
    - Every `{name}` is filled with a function replacement, so a name holding `$&` prints as typed
      (S2a2 decision 5); the dashboard's usual `.replace("{count}", String(n))`
      (`apps/dashboard/src/dashboard-app.ts:1689`) would mangle one.
    - The API client gains `downloadPersonalData(personId)`: `GET
      /management-api/staff/${encodeURIComponent(personId)}/personal-data/export` with
      `{ as: "file" }`, as `downloadOwnPersonalData` (`apps/dashboard/src/api/client.ts:2360-2367`).
      Not passive: a person pressed it.

12. **The permission refusal offers an administrator's sign-in, here; an unknown person is a
    fault.** The house rule: a refusal explains what happened and what each choice does and offers
    any needed administrator sign-in there; it never sends the person to somebody else; a state only
    a bug can cause is identified at its site as a fault in Waitron (home CLAUDE.md §3;
    `docs/developers/conventions-ui.md:8-20`).
    - **The permission refusal.** The shared `authorization.not_permitted` sentence, "You don't
      have permission to do that" (`apps/dashboard/src/i18n/codes.ts:406-409`), names no choice,
      and no in-place step-up sign-in exists in the dashboard (searched `apps/dashboard/src`, tests
      excluded, for "admin sign-in", `signInAsAdmin`, "sign in as", "step-up", "switch account" on
      2026-10-25: only `login.use_another_account` on the login screen). Because the item is drawn
      only for a session holding the permission (decision 11), the dashboard meets this refusal
      only when the person lost the permission after the screen read it (a demotion, which ends no
      session, decision 8), or through a fault. Default, for this action only: the alert reads
      "Only an administrator can download another person's data, and this account can no longer do
      it. Sign in as an administrator to download {name}'s data: this signs you out here first." /
      «Solo un administrador puede descargar los datos de otra persona, y esta cuenta ya no puede
      hacerlo. Inicia sesión como administrador para descargar los datos de {name}: antes se cierra
      tu sesión aquí.», followed by a `wt-button` **Sign in as an administrator** / «Iniciar sesión
      como administrador» that dispatches `admin-sign-in` (bubbling, composed). The app answers it
      with its existing logout (`#onLogout`, `dashboard-app.ts:1517-1530`), which asks about
      unsaved drafts through the leave coordinator before signing out, so that is the safe Stop.
      The other choice is to do nothing: the line stays until the next press.
    - **An unknown person** (`person.not_found`): the shared sentence "That person could not be
      found" (`codes.ts:394-397`) does not say it is a fault. Decision 8 shows the dashboard can
      reach it only through a stale list or a fault. Default, for this action only: the alert reads
      "{name} is on this list, but the box has no record of them. That is a fault in Waitron. The
      list has been reloaded." / «{name} aparece en esta lista, pero el servidor Waitron del local
      no tiene ningún registro suyo. Es un fallo de Waitron. Se ha vuelto a cargar la lista.», and
      the screen reloads its list with its own `#load()` (`staff-screen.ts:180-189`; the screen
      already reloads this way after its other actions, `:139`, `:244`, `:316`).
    - Every other failure shows `codeMessage(code)` as the Profile page does.
    - The in-place sign-in that would keep the session becomes a backlog point (Task 12), listed in
      the pull request. The server already checks an administrator's credentials for one request
      without replacing the session (`loginManagerById` → `authorizeManager` →
      `endManagementSession`, `apps/server/src/management-api.ts:1063-1078`), which the backlog
      point names as the pattern to reuse.

13. **The guide.** A new section after "Download your data", **Download another person's data**
    `{#person-data}`, with the Spanish twin «Descargar los datos de otra persona» `{#person-data}`;
    the own-data section and `profile.data_copy_help` name `actions.json` in decision 3's words. The
    new row item has no help badge: a row menu option takes one only through `wt-menu-row`
    (design-system.md:845), and no other item in this menu has one. Task 10 gives the text.

## Open decisions for the owner (FYI, built with the default)

- **What `actions.json` holds** (decision 3): whole sales voided after they were recorded, refunds
  and cash-drawer openings; line voids, comps and discounts not yet. With its worked example.
- **The admin route on a mirror** (decision 9): it answers. With its worked example.

## Global constraints

- **English only** in code, identifiers, comments, fixtures and tests. Spanish only in
  `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/guide/es/staff.md` and the
  Spanish half of `apps/dashboard/src/i18n/strings.ts`. A test of Spanish text reads its expected
  words from the words file or `t()`.
- **The actions part's turns** (decision 4): `prepare` reads nothing; the build takes two row turns
  and the sale-number turns through `db.withWriteLock`, never `withTransaction`, never inside
  another turn, awaited in turn (never `Promise.all`); no turn joins the person's rows to another
  table; each sale-number turn takes at most `SALE_LOOKUP_CHUNK` ids. Every other part is
  unchanged and still reads in the snapshot turn.
- **Every database test uses `useVenueDb`.** Every refused request asserts the domain error code.
- **Exact shapes** use `toEqual` or `toBe`, never `toMatchObject`.
- **Fixtures use values the two sides could treat differently**: amounts whose cents matter
  (`1234`, not `1200`); a colleague with different distinct sale numbers and amounts in every one
  of the four tables, so "only hers" fails if a person condition is dropped; a refund Marta
  requested and a colleague authorised, so a read that returned the authoriser's id would show; a
  manager, who holds every permission but the admin-only ones, as the refused caller, so a check
  against any manager-held permission passes it.
- **No secret in the download**: the existing no-secrets cases stay unedited. The admin route's
  cases (Tasks 7b and 8) look for the hashes that could leak: the downloaded person's own
  management-session token hash (her sessions are listed in `sign-in.json`,
  `packages/identity/src/personal-data.ts:87-93`) and her PIN hash, with the admin's token hash
  only as an extra, a positive control (her email is found), and a negative control (a stub part
  that writes her PIN hash into a file makes the check fail; run and reverted, recorded in the pull
  request).
- **Existing assertions that change on purpose**, each allowed because it pins a whole shape and
  every existing value stays as it is, named in the pull request:
  `packages/identity/src/permissions.test.ts:34-38` (the manager's admin-only set gains
  `personal_data.export`); `apps/server/src/guide-content.test.ts:156-162` (the Users page's
  section ids gain `person-data`); `apps/server/src/personal-data-readme.test.ts:275-276` (the
  server files whose words are checked gain the actions part's); and the entry list in
  `apps/server/src/personal-data-export-api.workforce.test.ts` (Task 8 gives its fixture action
  rows, so the list gains `actions.json` last). No other existing assertion changes. These do not
  change and need not: `apps/dashboard/src/widgets/staff-list.test.ts:45-59` and
  `apps/dashboard/src/screens/staff-authority.test.ts:117-129` (the new property defaults to
  false, so their menus are unchanged). No root guard lists the permission catalogue:
  `git grep -l 'person.admin\|PERMISSIONS' -- scripts` printed nothing on 2026-10-25;
  `scripts/alert-codes.test.ts:44-63` names `sale.void` and `sale.rectify` and
  `scripts/till-configure-retired.test.ts:26-32` the retired `till.configure`, each only for files
  it lists by hand, none of which this slice edits.
- **One shared comment line** in `packages/module/src/personal-data.ts` (decision 4), no other
  change there.
- **Coverage**: `@waitron/identity`, `@waitron/server`, `@waitron/dashboard` hold 98/98/98/95. No
  exclude or ignore comment. None of them is mutation-tested; nor is `@waitron/module`, whose one
  changed line is a comment.
- **Fixture code stays in test files**, never `src/testing/` (home CLAUDE.md §2).
- **Same files as open pull requests**: #1986 changes `docs/backlog.md`; whichever lands later
  rebases.
- **Greps** in this plan and in every task use the pathspec `'packages/*/src/**' 'apps/*/src/**'`
  (the form without `/**` selects no file, decision 8), and a grep's control uses the same pathspec
  as its probe.
- Commits `git commit -s`; `pnpm format:check` before each commit.
- An implementer that passes about 150 tool calls with its task unfinished stops at a passing or
  cleanly failing point, commits, and hands over: what is done, what is left, the files, each
  check's state.
- Browser suites: check `memory_pressure | grep free` first.

## Review focus

- **Whose data, in the actions file**: each read selects by the subject's person id in that
  table's actor columns only (decision 2); the file names no other person, by id or name
  (decision 6); Task 2b's "only hers" and "no other person" cases, and Task 8's end to end.
- **The permission and the by-id read** (decisions 7 and 8): admin only; no module may register
  the id; checked before the id; repeated in the re-check; a manager, a supervisor and a staff
  member refused whoever they name; an admin may download another admin; the proofs by deletion in
  Task 7a.
- **The actions turns** (decision 4): `prepare` reads nothing; the build's turns run after the
  snapshot turn closes and before the re-check; no turn joins; chunks of 500; the departure from
  the seat's doc comment, stated at the part's site and in one shared line; Tasks 3a and 3b's
  numbers, the indexed control and the stop rule; no index, no migration.
- **What `actions.json` holds, and the words that say so** (decision 3): whole sales voided after
  they were recorded, never the till's line **Void…**, in both languages.
- **Free text left out** (decision 6): reasons and notes, though the person typed some.
- **Rows always included** (decision 6) rather than counts alone, and the file's size.
- **The README language for someone else** (decision 10): the person's saved language, else the
  venue's; never the admin's browser.
- **The mount** (decision 9): beside the own route, inside `mountMeApi`'s call, with its comment
  narrowed; `boot.ts` untouched; a departure from S2a1 decision 5. **On a mirror** it answers.
- **The refusals** (decision 12): the sign-in signs the current account out; an in-place sign-in is
  a backlog point; an unknown person is named as a fault and the list reloads.
- **Every README and guide sentence against its source** (Task 5's and Task 10's tables).
- **Codex run-it seat**: a permission, a by-id read and personal data are risk triggers, so
  `/finish-branch` runs two Codex reviews, the second told to set this plan aside and test what it
  does not name.

## Task 1 — the permission

Files: `packages/identity/src/permissions.ts`, `packages/identity/src/permissions.test.ts`,
`apps/server/src/modules.test.ts`.

1. Tests first:
   - A new case: `personal_data.export` is in `PERMISSIONS`; `roleHasPermission` is true for
     `admin` and false for `manager`, `supervisor` and `staff`; `permissionsForRole("admin")`
     contains it and `permissionsForRole("manager")` does not.
   - The manager case's `ADMIN_ONLY` set (`permissions.test.ts:34-38`) gains
     `"personal_data.export"`; the three existing entries stay.
   - In `apps/server/src/modules.test.ts`, a new case: no `permission` in `ALL_MODULE_PERMISSIONS`
     (`apps/server/src/modules.ts:39-41`) is in identity's `PERMISSIONS` (exported,
     `packages/identity/src/index.ts:49`), so no module floor can widen a core permission, this one
     included (decision 7). It passes today; its proof is step 3.
   Run `pnpm --filter @waitron/identity exec vitest run src/permissions.test.ts`; watch the new case
   fail.
2. Add the id after `person.admin` with the comment of decision 7.
3. Omission controls, each run and reverted: add the id to `MANAGER`'s set as well → the new case
   and the manager case both fail; add `{ permission: "personal_data.export", grantedFrom:
   "manager" }` to one module's `permissions` list (any module that has one) → the
   `modules.test.ts` case fails. Run it with
   `pnpm --filter @waitron/server exec vitest run src/modules.test.ts`.
4. Run `pnpm --filter @waitron/identity typecheck` and `pnpm --filter @waitron/server typecheck`.
   Read each test count.

## Task 2a — the actions part: its turns, sale voids and tender refunds

Files: `apps/server/src/personal-data-actions.ts` (new), `apps/server/src/personal-data-actions.test.ts`
(new).

Interface (decisions 1 and 4): `export const ACTIONS_FILES = ["actions.json"] as const;`
`export const SALE_LOOKUP_CHUNK = 500;`
`export function actionsPersonalData(db: Database, options?: { chunk?: number }): PersonalDataPart[]`
returning one part, owner `"server"`. `prepare` reads nothing and returns the build. In this task
the build takes **row turn 1** with the sale voids and tender refunds (Task 2b adds the bill-payment
refunds to it) and the **sale-number turns** for their sale ids, in chunks of `chunk`, then shapes
decision 6's file, or returns `[]` when every list is empty. The commented decision of decision 4
goes at the top of the file. The one shared comment line goes in
`packages/module/src/personal-data.ts` (decision 4), in this task.

Columns, so Task 4's guard can hold them (in: read and shaped; out: never read into the file):

| Table | In (as) | Out |
| --- | --- | --- |
| `sale_voids` | `sale_id` (as `sale`, and the sale's `total` as `amount`, both through a sale-number turn), `voided_at` (as `at`), `voided_by` (selects) | `id`, `reason` |
| `tender_refunds` | `sale_id` (as `sale`, through a sale-number turn), `applied_amount` (as `amount`), `tip_amount` (as `tip`), `method`, `state`, `created_at` (as `at`), `requested_by`, `authorized_by`, `attested_by` (select; as `yourPart`) | `id`, `tender_id`, `submission_id`, `fingerprint`, `reason`, `attestation_note`, `source`, `device_id`, `node_id`, `location_id`, `manual`, `provider`, `provider_payment_ref`, `completed_at`, `failed_at`, `sent_at`, `send_count`, `refs_before_send`, `provider_refund_ref`, `provider_status`, `last_lookup_at`, `next_retry_at` |

(`id` is read for the sort's tie-break and never written to the file.) Before writing the tests,
print each table's columns with `getTableConfig` in a throwaway case (deleted after) and check them
against this table; a column the table lacks is classified in the pull request and the plan's
review, not silently.

1. Tests first (`useVenueDb` with the core migrations; fixture helpers in the test file; read
   `apps/server/src/working-order.test.ts` or the tender-refund suites for how a sale, a series and
   a tender are seeded; the tender-refund checks tie `method`, `manual`, `provider` and attestation
   together, `tender-refunds.ts:102-131`). Call `prepare` inside `suite.db.withWriteLock` and the
   build outside it, as `sendPersonalData` does:
   - **Fixture builder** (shared with Task 2b, so built to be extended): Marta and a colleague,
     Luis. Distinct sales, numbers and amounts for each. Marta: one sale void she authorised; a
     tender refund she requested and Luis authorised (cash, completed); one she both requested and
     authorised (card, pending). Luis: one sale void and one tender refund of his own, none naming
     Marta. Every row with a distinct, explicit time.
   - **Exact file.** Prepare, build, parse: `toEqual` the whole expected object of decision 6 for
     these rows (empty `drawerOpenings`, counts to match), every key, every list in order, every
     amount as a two-place string, each `sale` as `formatInvoiceNumber(code, number)`, the void's
     `amount` the voided sale's `total`, `yourPart` as decision 2 says (`["requested"]` on the
     refund Luis authorised, `["requested", "authorized"]` on the one she did both).
   - **No row, no file.** A person with no action gets `[]`.
   - **It reads nothing in the snapshot turn.** A `vi.spyOn(suite.db, "withWriteLock")` installed
     inside the snapshot turn, just before `prepare`, records no call until `prepare` has returned;
     the build makes its calls after the snapshot turn has returned.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.test.ts`; watch it
   fail.
2. Write the part for these two tables.
3. Omission controls, each run and reverted, the failing line recorded for the pull request: drop
   the `voided_by` condition → the exact file fails (Luis's void appears); sort by row id only →
   the exact file fails; move the voids read into `prepare` on `tx` → the snapshot-turn case
   fails.
4. Run `pnpm --filter @waitron/server typecheck`. Read each count.

## Task 2b — the actions part: bill-payment refunds, drawer openings, and the person checks

Files: `apps/server/src/personal-data-actions.ts`, `apps/server/src/personal-data-actions.test.ts`.

The build gains the bill-payment refunds in **row turn 1**, **row turn 2** for the drawer
openings, and the bill-payment sale-number turns (decision 4, step 3).

| Table | In (as) | Out |
| --- | --- | --- |
| `bill_payment_refunds` | `bill_payment_id` (as `sale`, through a bill-payment turn: the payment's order's sale, and the payment's `method`), `applied_amount`, `tip_amount`, `state`, `created_at`, `requested_by`, `authorized_by`, `attested_by` | `id`, `submission_id`, `fingerprint`, `reason`, `source`, `device_id`, `sent_at`, `send_count`, `provider_refund_ref`, `refs_before_send`, `attestation_note`, `completed_at`, `failed_at` |
| `drawer_opens` | `reason`, `opened_at` (as `at`), `sale_id`, `bill_payment_id`, `tender_refund_id` (as `sale`), `via_override` (as `viaOverride`), `person_id`, `authorized_by` (select; as `yourPart`) | `id`, `device_id`, `printer_id` |

1. Tests first, in the same file (read how a bill payment, a working order and a device are
   seeded in the bill-refund suites; drawer openings must satisfy `drawer_opens_target_ck`,
   `drawer-opens.ts:58-71`):
   - **The fixture grows.** Marta also has: one bill-payment refund she attested, on a bill that
     has been invoiced, and one she requested on a bill not yet invoiced; drawer openings she made
     for a cash sale, for a bill payment, for a tender refund, a `card_slip` written for a bill
     payment (`bill_payment_id` set, no `sale_id`), one manual she authorised for Luis with
     `via_override` true, and one calibration. Luis also has one drawer opening of his own, naming
     no one else.
   - **Exact file**, extended: Task 2a's expected object gains the bill-payment refunds and the
     drawer openings; the not-yet-invoiced refund's and the calibration's `sale` null; the
     `card_slip`'s `sale` the bill's invoice; `["attested"]` on the bill refund she attested,
     `["authorized"]` on the manual opening, `["opened", "authorized"]` on the calibration.
   - **Only hers.** None of Luis's sale numbers or amounts appears in the text.
   - **No other person.** Luis's person id appears nowhere in the text, though he authorised one of
     her refunds and she authorised his drawer opening; Marta's own id appears nowhere either (the
     file needs neither). Positive control in the same helper: one of her sale numbers is found.
   - **No reason text.** Every row's reason and note is a distinct string; none appears.
   - **Bounded turns.** With `actionsPersonalData(suite.db, { chunk: 2 })` the file equals the
     default's byte for byte, and the `withWriteLock` spy, installed after the snapshot turn,
     counts exactly `2 + ceil(saleIds / 2) + ceil(billPaymentIds / 2)` calls, the counts taken
     from the fixture.
   - **A row committed after the snapshot turn is in the file** (decision 4, consistency): prepare
     inside the lock, then write one more of Marta's sale voids through `withTransaction`, then
     build: the file holds it.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.test.ts`; watch the
   new cases fail.
2. Write the two reads and the bill-payment turns.
3. Omission controls, each run and reverted, the failing line recorded for the pull request: drop
   the `person_id` condition from the drawer read → "only hers" fails; select `authorized_by`'s
   value into the refund entry → "no other person" fails; drop the order-to-sale join in the
   bill-payment turn → the exact file fails on the invoiced bill-payment refund; key the drawer
   opening's sale on `reason in ('bill_payment', 'bill_refund')` instead of `bill_payment_id` → the
   exact file fails on the `card_slip`; ignore `chunk` (one turn for all ids) → "bounded turns"
   fails.
4. Run `pnpm --filter @waitron/server typecheck`. Read each count.

## Task 3a — time the snapshot turn, with and without the actions part

Files: none committed. A throwaway `apps/server/src/zz-s2c-snapshot-turn.test.ts`, deleted at the
end (`git status --short` shows nothing of it).

1. The fixture is S2b Task 6a's: one location and node, 30 staff, four years of shifts each (about
   20 a month), 48 monthly pay-period closes. Its recipe is saved at
   `/Users/clintongormley/waitron-campaign-b/a980-s2b-locked-read/fixture-recipe.zz-s2b-locked-read.test.ts.txt`
   (it built in about 80 s on this Mac, `vitest-full.log` beside it); reuse it, every set migrated.
2. Time, inside `db.withWriteLock`, `preparePersonalData(db, parts, subject)` for the long-serving
   person, as `sendPersonalData` does at `personal-data-export-api.ts:67-78` (its `authorize`, place
   and tenant reads are left out and the report says so), in two arms, interleaved run by run:
   **without** the actions part (`parts` = `personalDataParts(ALL_MODULES)` plus
   `timeRecordPersonalData(ALL_MODULES)`) and **with** it (plus `actionsPersonalData(db)`). At least
   ten runs per arm; record median and range of each.
3. Before running, write down what a failure prints: either arm's median over 250 ms, or the
   "with" arm's median above the "without" arm's by more than the two arms' ranges overlap. The
   expected answer is equal arms, because the actions part's `prepare` reads nothing; the control
   that the measurement can see a difference is the "with" arm run once with the part's voids read
   moved back into `prepare` (reverted after), which should show the part's read in the turn.
4. **Stop rule.** Either arm's median over 250 ms on this Mac: stop, commit nothing, and report the
   numbers to the coordinator. No migration in this slice either way.

## Task 3b — time each actions turn at 1,000,000 drawer openings, with an indexed control

Files: none committed. A throwaway `apps/server/src/zz-s2c-actions-turns.test.ts`, deleted at the
end (`git status --short` shows nothing of it).

1. With the core migrations, in a file database, not `:memory:`: 30 people; 1,000,000 sales with
   every `sales` column filled and one drawer opening each, spread so one person holds about 33,000
   drawer rows; 20,000 sale voids, one person holding about 6,667; and, so row turn 1's refund
   reads scan something, 10,000 tender refunds and 2,000 bill-payment refunds across the 30 people
   (raw multi-row inserts that satisfy each table's checks; foreign keys may be switched off for the
   load with `pragma foreign_keys = off` outside any transaction, then back on: inside a `begin`
   the pragma stays on, the claim check's `fk.mjs`, claim #138). If a refund check cannot be met
   within the task, leave that table empty and say so. The claim check's loader
   (`/tmp/a980-claims/realload.mjs`, if still present) is a starting point.
2. Before running, write down what a failure prints: any turn's median over 250 ms.
3. For the long-serving person, with `actionsPersonalData(db)`, time each turn on its own, at least
   ten runs each: row turn 1, row turn 2, one sale-number turn of 500 ids, one bill-payment turn of
   500 ids (or as many as exist); record median and range of each, the number of sale-number and
   bill-payment turns the build takes, the build's whole time, and the file's size. Also record
   `explain query plan` for each turn's statements.
4. **The indexed control**, in the same throwaway database: create indexes on
   `drawer_opens(person_id)` and `drawer_opens(authorized_by)` (and on the refund and void tables'
   person columns), re-run step 3, and record what each index buys per turn. The control measures
   something only if the indexed arm's query plan names the indexes (`SEARCH … USING INDEX`); if it
   still says `SCAN`, say so, because then the two arms look alike for a reason that is not the
   index. No index is committed.
5. **Stop rule.** Any turn's median over 250 ms on this Mac (without indexes): stop, commit nothing,
   and report the numbers to the coordinator. No migration in this slice either way. The numbers go
   in the pull request and in Task 12's backlog line.

## Task 4 — the actor-column guard

Files: `apps/server/src/personal-data-actions.coverage.test.ts` (new).

1. Tests first:
   - **Every actor column is classified.** Walk every drizzle table exported by `@waitron/db`'s
     root (`import * as db from "@waitron/db"`; its `exports` map lists only `.` and three
     `./testing/*` paths, `packages/db/package.json`; `is(value, SQLiteTable)`, as
     `packages/identity/src/personal-data.coverage.test.ts` does), keep columns whose name matches
     decision 2's pattern, and require the set to equal `READ ∪ NOT_YET ∪ NOT_A_PERSON` with no
     column in two of them. `READ` is decision 2's nine; `NOT_A_PERSON` is `print_jobs.claimed_by`
     and `invoice_deliveries.claimed_by`; `NOT_YET` is the other 28, each with the reason "not in
     the download yet: backlog, who did what" (`bill_edit_states.editor_id`,
     `bill_payments.attested_by`, `bill_payments.requested_by`, `daily_closes.closed_by`,
     `incidents.acknowledged_by`, `invoice_deliveries.person_id`, `invoice_pdf_downloads.person_id`,
     `line_service_cancellations.actor_id`, `membership_clearances.person_id`,
     `membership_removals.person_id`, `order_amendments.actor_id`, `order_draft_events.actor_id`,
     `order_draft_events.from_person`, `order_draft_events.to_person`, `order_drafts.owner_id`,
     `order_group_events.actor_id`, `order_groups.fired_by`, `order_groups.submitted_by`,
     `parties.closed_by`, `parties.opened_by`, `pass_item_marks.done_by_person_id`,
     `receipt_reprints.person_id`, `sales.authorized_by`, `sales.operator_id`,
     `ticket_item_moves.moved_by_person_id`, `unpaid_departures.authorized_by`,
     `unpaid_departures.recorded_by`, `working_order_lines.credited_to`).
   - **The walk sees every table.** The walked table names equal the newest drizzle snapshot's
     table names (`packages/db/drizzle/meta/<highest>_snapshot.json`, `0190` on 2026-10-25, found by
     listing the folder, not named in the test) less the three the root does not export, named in
     the test: `change_log`, `mirror_config`, `node_membership`. On 2026-10-25 the throwaway walk
     of decision 2 printed 93 snapshot tables, 90 root tables, and exactly those three missing. A
     table the root stops exporting then fails loudly.
   - **The four tables' columns.** For each table of Tasks 2a's and 2b's column tables, its full
     column set equals that row's in plus out, with no column in both.
   - A comment at the top says what it is weaker than: it knows an actor column only by its name;
     the three explicit names were found by reading each `*_id`/`*_to` column's schema comment and
     the A664 audit (decision 2), so a person column under another name is missed until someone
     reads it; it reads `@waitron/db`'s schema alone (other modules' actor columns are in the
     backlog point, not here); and it proves a column was classified, not that the part honours it
     (Tasks 2a and 2b do).
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-actions.coverage.test.ts`.
   It should pass at once; its proof is step 2.
2. Omission controls, each run and reverted: remove `sales.operator_id` from `NOT_YET` → the first
   case fails; remove `working_order_lines.credited_to` from `NOT_YET` → the first case fails (the
   explicit names are live); move `drawer_opens.device_id` out of both lists → the third fails; put
   `drawer_opens.person_id` in both `READ` and `NOT_YET` → the first fails; drop `change_log` from
   the three named exceptions → the second fails.

## Task 5 — the README's words for `actions.json`

Files: `apps/server/src/i18n/personal-data-readme.ts`, `apps/server/src/personal-data-readme.test.ts`.

Words (shape `holds`, `use`, optional `sentTo`, `kept`, `i18n/personal-data-readme.ts:1-8`), in
decision 3's terms:

| Key | English | Spanish |
| --- | --- | --- |
| `holds` | `the whole sales voided after they were recorded that you authorised, the refunds you asked for, authorised or recorded the outcome of, and the cash-drawer openings you made or authorised: how many of each and, for each one, the sale number where there is one, the amount where there is one, when it happened and your part in it.` | `las ventas completas anuladas después de registrarse que autorizaste, las devoluciones que pediste, autorizaste o cuyo resultado registraste, y las aperturas del cajón de efectivo que hiciste o autorizaste: cuántas hay de cada una y, de cada una, el número de venta si lo tiene, el importe si lo tiene, cuándo ocurrió y qué parte tuviste tú.` |
| `use` | `Kept to account for the money the venue takes and gives back.` | `Se guarda para dar cuenta del dinero que el local cobra y devuelve.` |
| `kept[0]` | `Nothing in the box deletes a voided sale, a refund or a cash-drawer opening.` | `Nada en el servidor Waitron del local borra una venta anulada, una devolución ni una apertura del cajón de efectivo.` |

No `sentTo` of its own, so the README's shared backup line is the only recipient line it adds to.
Before shipping, check each sentence's words against the till's and dashboard's strings for the
collision decision 3 names (`table.void_line`, `station.notice.void`, the adjustments page): no
sentence may read as a line voided on an open bill.

**What backs each sentence.** The implementer re-checks each row on the branch and fixes the
sentence, not the row, where they disagree; a sentence with no row is not shipped.

| Sentence | Source |
| --- | --- |
| holds | decision 6's shape and decision 2's `yourPart` (`voided_by` is the authoriser, `sale-voids.ts:19-21`; `attested_by` is the manager who recorded a refund's outcome, `bill-payments.ts:60-62` on the bill payment's column of the same name); decision 3 for "whole sales voided after they were recorded" |
| use | design §2.1 row s12, purpose "accountability, fraud" |
| kept | `git grep -n -E '\.delete\((drawerOpens\|tenderRefunds\|billPaymentRefunds\|saleVoids)\)\|delete from "?(drawer_opens\|tender_refunds\|bill_payment_refunds\|sale_voids)' -- 'packages/*/src/**' 'apps/*/src/**' ':!*.test.ts' ':!**/testing/**'` printed nothing on 2026-10-25 (exit 1); control, the same pathspec without the two exclusions: `packages/db/src/schema/bill-payments.test.ts` and `tender-refunds.test.ts`. Re-run both on the branch with the same pathspec. Also: a case-insensitive `drop table` over the same four names and the same pathspec printed nothing; first setup's import deletes only declared transfer tables, and the core list (`packages/db/src/configuration-transfer.ts:40-88`) names none of the four; `sale_voids` is append-only (`packages/db/src/classification.ts:21`) and bill-payment refunds carry a no-delete trigger (`bill-payments.ts:134-138`) |
| no `sentTo` | none of the four tables is in the configuration export's list (`packages/db/src/configuration-transfer.ts:40-88`, read the whole list); and the filing record a sale void sends to the tax agency carries no person: `record-void.ts:101` hands the fiscal seat only the sale id and the reason (`backend.recordVoid(tx, saleId, reason)`, with the comment at `:99-100`). On 2026-10-25, over `'packages/fiscal-verifactu/src/**'` with tests and `testing/` excluded, `voidedBy` was in no file, `authorizedBy` only in `routes.ts`, and `operatorId` in 30 setup and allocation files, none on the void path. Re-check on the branch; if a person is sent, add a `sentTo` sentence in both languages saying where, and say so in the pull request |

1. Tests first, in `personal-data-readme.test.ts`:
   - The server-files case (`:275-276`) reads
     `[...timeRecordPersonalData(ALL_MODULES), ...actionsPersonalData(stubDb)].flatMap((p) => p.part.files)`
     (any `Database` will do: reading `files` touches no database); both languages must have words
     for each.
   - A new case: `files: ["profile.json", "sign-in.json", "actions.json"]` in English, `toBe` the
     whole expected text written out in the test; the same in Spanish built from
     `PERSONAL_DATA_README_WORDS.es`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-readme.test.ts`; watch both
   fail.
2. Add the words.
3. Omission control: delete the Spanish entry → the server-files case fails.
4. Run `pnpm --filter @waitron/server typecheck`.

## Task 6 — put the actions part in the own route

Files: `apps/server/src/me-api.ts` (`serverParts` at `:126` becomes
`[...timeRecordPersonalData(modules), ...actionsPersonalData(deps.db)]`, so `actions.json` comes
after the time record in the ZIP: files come out in parts order, `personal-data.ts:86-104`),
`apps/server/src/me-api.personal-data-export.test.ts`, `apps/server/src/start-full-disk.e2e.test.ts`
(its mount's `serverParts`, `:352-361`, gains `actionsPersonalData(db)` in the same place).

1. Tests first: in `me-api.personal-data-export.test.ts`, one new case: mounted with
   `["core", "identity"]`, a person with one sale void they authorised gets `actions.json` in the
   ZIP, listed in the README; the existing cases pass unedited (their people have no action rows,
   so no file, decision 6). Run
   `pnpm --filter @waitron/server exec vitest run src/me-api.personal-data-export.test.ts`; watch it
   fail.
2. Add the part to both mounts.
3. Omission control: drop it from the `mountMeApi` mount → the new case fails.
4. Run unedited: `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts src/personal-data-export-api.readme.test.ts src/personal-data-export-api.workforce.test.ts src/boot.personal-data-export.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data"`
   (on macOS it makes its own small disk with `hdiutil`). The full-disk own case now also runs the
   actions part's row turns on the full disk (they run even when they find no row). Read each
   count. If one fails only because its fixture holds an action row, its whole-list assertion gains
   `actions.json`, named in the pull request (Global constraints).

## Task 7a — the admin route: permission, id, query and session

Files: `apps/server/src/personal-data-export-api.ts`, `apps/server/src/personal-data-export-api.staff.test.ts`
(new), `apps/server/src/me-api.ts` (the comment of decision 9, `:104-109`).

Interface: `mountPersonalDataExportApi` also mounts `GET /management-api/staff/:id/personal-data/export`,
wrapped in `withPersonalDataErrors`, calling `sendPersonalData(c, deps, authorize)` with decision
8's `authorize`, which returns `{ personId: target.id, label: target.displayName, language }`
(decision 10). The target is read from `persons` (`@waitron/identity` exports the table,
`packages/identity/src/index.ts:55`), selecting only `id`, `display_name` and `locale`. The map
gains the two entries of decision 8. The id check uses `isUuid` (`packages/shared/src/ids.ts:28`).

1. Tests first (`useVenueDb` with core and identity migrations; the existing route test's setup,
   `personal-data-export-api.test.ts:1-148`, read and copied, with a stub server part that records
   its subject; `registerModulePermissions(ALL_MODULE_PERMISSIONS)` in `beforeAll`, as boot does,
   `boot.ts:926`; seed two admins, a manager, a supervisor, a staff member, and Marta, disabled by
   SQL, with a saved locale of `es-ES`):
   - **An admin downloads a disabled person.** 200; the four headers of S2a1 decision 7; the name
     `marta-…-<date>.zip`; the stub's subject has Marta's id; `profile.json` holds Marta's email.
   - **An admin downloads another admin** (decision 8): 200, the second admin's `profile.json`.
   - **A manager is refused another person's download**: 403 `authorization.not_permitted`
     `{ permission: "personal_data.export" }`, no ZIP. The same for a supervisor and for a staff
     member.
   - **A staff member gets only their own**: the same staff member naming their own id on the admin
     route is refused 403; on the own route they get a ZIP whose `profile.json` is theirs and holds
     none of Marta's values.
   - **Permission before the id**: a manager naming an unknown UUID and a malformed id both get 403,
     not 404.
   - **Unknown and malformed ids for an admin**: 404 `person.not_found` with `{ personId }` for
     each.
   - **A query** from an admin: 400 `management.request_invalid` `{ field: "query" }`.
   - **Session refusals**: no cookie 401 `management_session.required`; an ended admin session 401;
     a disabled admin's live session 403 `person.suspended`.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.staff.test.ts`;
   watch it fail.
2. Write the route and the comment.
3. **Proof by deletion**, each run and reverted, the failing case recorded for the pull request:
   replace `authorizeManager` with `resolveManagementSession` (no permission) → the manager,
   supervisor and staff cases fail; change the permission to `person.manage` → the manager case
   fails (the manager holds it), so the test can tell the right permission from a wrong one; check
   the id before the permission → "permission before the id" fails.
4. Run unedited `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.test.ts src/me-api.test.ts src/me-api.cross-person.test.ts`
   and `pnpm --filter @waitron/server typecheck`.

## Task 7b — the admin route: language, re-check, nothing written, no secret

Files: `apps/server/src/personal-data-export-api.staff.test.ts`, and
`apps/server/src/personal-data-export-api.ts` only if a case finds a defect.

1. Tests first, in the same file (Task 7a's setup):
   - **The person's language, not the admin's**: Marta's download gives the stub
     `language: "es"` though the admin's saved locale is `en-GB` and the request sends
     `Accept-Language: en-GB`; the README's first line is the Spanish title.
   - **The venue's language when the person has none**: a target with no saved locale and a venue
     locale of `es-ES` gives `language: "es"`; with `en-GB`, `"en"`.
   - **The re-check repeats the permission**: the stub part's build sets the admin's role to
     `manager` through `withTransaction` → 403 `authorization.not_permitted` and no ZIP. This is the
     admin route's case for decision 4's "the re-check still guards the bytes": the stub's build
     takes a turn in the same position as the actions turns.
   - **Nothing written**: the admin session's `last_seen_at`, set five minutes back, is unchanged.
   - **No secret** (Global constraints): Marta gets a management session (`startManagementSession`)
     and a PIN hash before she is disabled; her session's `token_hash`
     (`hashSessionToken(martaToken)`) and her PIN hash are in no unzipped file; the admin session's
     token hash is in none either (an extra); Marta's email is (the positive control).
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.staff.test.ts`;
   the language and re-check cases should pass if Task 7a is right; any that fails is a defect to
   fix in this task.
2. **Proof by deletion and the negative control**, each run and reverted, recorded for the pull
   request: use the requester's language → the language case fails; drop the role re-check by
   caching the first `authorize` result → the re-check case fails; a stub server part that writes
   Marta's PIN hash into a file → the no-secret case fails.
3. Run `pnpm --filter @waitron/server typecheck`.

## Task 8 — the admin's download end to end

Files: `apps/server/src/personal-data-export-api.workforce.test.ts`,
`apps/server/src/start-full-disk.e2e.test.ts`.

1. Tests first:
   - In `personal-data-export-api.workforce.test.ts` (S2b's whole-ZIP file, every module mounted
     through `mountMeApi`): Marta's fixture gains a sale void, a refund and a drawer opening, and
     the colleague's one of each, all with distinct sale numbers; the entry list ends
     `…, "time-record.pdf", "time-record.csv", "actions.json"` (the server parts' order, Task 6). A
     new case: an admin downloads Marta after she is disabled (by SQL, after her rows and a
     management session of hers are written): the entries are the same list; each of her distinct
     values, the actions included, is found in some file; none of the colleague's is, except the
     colleague's display name as `rota.json`'s `otherPerson` (S2b decision 8); her session's token
     hash and her PIN hash are in no file, nor the admin session's token hash, and her email is.
     This is the design's S2 test for the admin route over every table the download reads: "a
     fixture with a distinct value in every table that names the person, each asserted present"
     (§5.3), for the tables the download holds. The columns that name a person and are not yet in
     the download are held by Task 4's guard and the backlog point of Task 12, not by this test.
   - In `start-full-disk.e2e.test.ts`: `beforeAll` seeds an admin beside Marta and Sergio
     (`seedPerson("admin", "Ana")`, `:257-258`); a new case beside the own route's (`:438-456`): on
     the full disk with a change waiting, the admin route for Marta answers 200 with a ZIP, the
     admin session's `last_seen_at` is unchanged, and the waiting change is still there.
   Run `pnpm --filter @waitron/server exec vitest run src/personal-data-export-api.workforce.test.ts`
   and `pnpm --filter @waitron/server exec vitest run src/start-full-disk.e2e.test.ts -t "personal-data"`.
   Both should pass at once (Tasks 6, 7a and 7b built what they read); the proof is step 2.
2. Omission controls, each run and reverted: drop the actions part from the `mountMeApi` mount →
   the entry list fails; give the colleague's sale void Marta's person id → the colleague check
   fails.
3. Run `pnpm --filter @waitron/server typecheck`. Name the changed entry list in the pull request.

## Task 8b — the admin route in a real start, and on a mirror

Files: `apps/server/src/boot.personal-data-export.test.ts`, `apps/server/src/boot.mirror.test.ts`.

1. Tests first:
   - In `boot.personal-data-export.test.ts` (its real start, `:29-90`, read and followed): seed an
     admin and a manager beside the venue's person; in the same start, the admin's cookie gets 200
     and a ZIP from the admin route for that person, and the manager's gets 403
     `authorization.not_permitted`. The review found no route or middleware in boot that would
     shadow the path (`round1-review.md`, experiment 6); this case is the run that says so.
   - In `boot.mirror.test.ts`: write a staff person into the mirror's venue in `beforeAll` (the
     file seeds each venue there, `:117-145`), and in the mirror boot (read
     `serves a dashboard read via the ambient viewer`, `:174-245`, for the cookie primer) the
     ambient viewer's cookie gets 200 and a ZIP from the admin route for that person (decision 9's
     default, pinned).
   Run `pnpm --filter @waitron/server exec vitest run src/boot.personal-data-export.test.ts src/boot.mirror.test.ts`.
   Both should pass at once; the proof is step 2.
2. Omission controls, each run and reverted: change the admin route's path in the mount → both new
   cases fail with 404; make the route refuse when the node is a mirror → the mirror case fails.
3. Read each count.

## Task 9a — the API client and the row item

Files: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/api/client-routes.test.ts`,
`apps/dashboard/src/widgets/staff-list.ts`, `apps/dashboard/src/widgets/staff-list.personal-data.test.ts`
(new), `apps/dashboard/src/i18n/strings.ts` (`person.download_data`: "Download their data" /
«Descargar sus datos»).

1. Tests first:
   - In `client-routes.test.ts`, beside the own download's case (`:1697-1718`):
     `downloadPersonalData("p 1")` requests `/management-api/staff/p%201/personal-data/export`,
     `GET`, credentials included, not passive, and returns the header's file name.
   - In the new staff-list file (browser): with `canExportPersonalData` the menu's buttons end with
     `download-data-p1`, after the existing ones, whose order is unchanged; without it there is no
     such button, with `canAdminister` true or false; a press dispatches one `download-person-data`
     `{ personId: "p1" }`, `bubbles` and `composed`, and no `person-action`; with
     `downloadingPersonId` set, every row's item is `disabled`; changing either property after the
     first render redraws the menu (the memo inputs); the item's text is `t("person.download_data")`
     in English and Spanish.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/widgets/staff-list.personal-data.test.ts`;
   watch them fail.
2. Write the method, the two properties, the item and the strings.
3. Omission control: leave `canExportPersonalData` out of the memo inputs → the redraw case fails.
4. Run unedited `pnpm --filter @waitron/dashboard exec vitest run src/widgets/staff-list.test.ts src/widgets/staff-list.a11y.test.ts src/screens/staff-authority.test.ts`
   and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9b — the screen's handler, its status and its refusals

Files: `apps/dashboard/src/screens/staff-screen.ts`, `apps/dashboard/src/screens/staff-screen.personal-data.test.ts`
(new), `apps/dashboard/src/i18n/strings.ts`.

Strings (English / Spanish):

| Key | English | Spanish |
| --- | --- | --- |
| `staff.data_copy_busy` | Preparing a copy of {name}'s data… | Preparando una copia de los datos de {name}… |
| `staff.data_copy_not_permitted` | decision 12's English sentence | decision 12's Spanish sentence |
| `staff.data_copy_not_found` | decision 12's English unknown-person sentence | decision 12's Spanish unknown-person sentence |
| `staff.sign_in_as_admin` | Sign in as an administrator | Iniciar sesión como administrador |

1. Tests first (browser; the new file's own API stub, built like the existing staff-screen suites'
   with `listStaff` plus `downloadPersonalData`; each case restores the language it changed):
   - **A press saves the file**: one call with the person's id; spied `URL.createObjectURL`,
     `revokeObjectURL` and the anchor's `click`, as `profile-screen.personal-data.test.ts` does; the
     anchor's `download` is the server's name, or `personal-data.zip` when it is null.
   - **While it is sent** (the API's promise held): the status line reads the busy text with the
     person's name, `role="status"`; `list.downloadingPersonId` is the id; a second event makes no
     second call; axe finds nothing; once resolved the line is gone and the id null.
   - **A name with `$&`** prints as typed in the busy line.
   - **A permission refusal**: the API rejects `{ code: "authorization.not_permitted" }`: the alert
     reads decision 12's sentence with the name, and holds the sign-in button; pressing it dispatches
     one `admin-sign-in`, bubbling and composed.
   - **An unknown person**: the API rejects `{ code: "person.not_found" }`: the alert reads
     decision 12's unknown-person sentence with the name, and `listStaff` is called once more (the
     reload).
   - **Other codes** show `codeMessage(code)` and no button. No failure disables the item; the next
     press clears the line.
   - **The dialogs' feet stay clear**: after a failed download, opening the edit dialog shows no
     message at its foot.
   - **Leaving while it is sent** drops the answer: no anchor click, no message.
   - **Spanish**, and **light and dark** with axe, for the status line and the alerts.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/staff-screen.personal-data.test.ts`;
   watch it fail.
2. Write the property, the handler, the lines and the strings.
3. Omission controls: drop the early return → the second-event case fails; put the failure in
   `errorKey` → the dialog-foot case fails; use `String.replace` with the name as a string → the
   `$&` case fails; drop the reload → the unknown-person case fails.
4. Run unedited `pnpm --filter @waitron/dashboard exec vitest run src/screens/staff-screen.test.ts src/screens/staff-screen.a11y.test.ts src/screens/staff-edit.unsaved.test.ts src/screens/staff-create.unsaved.test.ts src/screens/staff-filters.test.ts`
   and `pnpm --filter @waitron/dashboard typecheck`.

## Task 9c — the app passes the permission and answers the sign-in

Files: `apps/dashboard/src/dashboard-app.ts` (`:2553-2557`), `apps/dashboard/src/dashboard-app.test.ts`.

1. Tests first, beside "passes admin authority to the staff screen" (`dashboard-app.test.ts:8685-8697`):
   - `it.each([false, true])`: with `personal_data.export` in the session's permissions or not, the
     staff screen's `canExportPersonalData` matches. The `true` row's permissions carry
     `personal_data.export` without `person.admin`, and the `false` row's carry `person.admin`
     without it, so a binding to the wrong permission fails both rows.
   - An `admin-sign-in` event from the staff screen calls `api.logout` once and returns to the
     sign-in screen (read how the existing logout cases check it; the leave coordinator's prompt
     with an unsaved draft is the existing logout's and is not retested here).
   Run `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "staff screen"`;
   watch them fail.
2. Bind the property and the event to `#onLogout`.
3. Omission controls: bind the property to `person.admin` instead → both rows of the first case
   fail; drop the event binding → the sign-in case fails.
4. Run `pnpm --filter @waitron/dashboard typecheck`.

## Task 10 — the guide and the help text

Files: `apps/server/src/guide/en/staff.md`, `apps/server/src/guide/es/staff.md`,
`apps/server/src/guide-content.test.ts` (`:156-162`), `apps/dashboard/src/i18n/strings.ts`
(`profile.data_copy_help`, both languages).

Every sentence names what `actions.json` holds in decision 3's words, and none promises a later
addition.

The own-data section (`en/staff.md:30-38`, `es/staff.md:33-43`) gains, after the working-time
sentence: "It also holds `actions.json`, when there are any: the whole sales voided after they were
recorded, the refunds and the cash-drawer openings you took part in." / «También contiene
`actions.json`, si las hay: las ventas completas anuladas después de registrarse, las devoluciones
y las aperturas del cajón de efectivo en las que participaste.»

That section ends "For anything else about your data, ask the venue." (`en/staff.md:38`,
`es/staff.md:42`). **Leave it as written**: the venue is the data controller, so for data rights it
is the right party, and the refusal rule (`docs/developers/conventions-ui.md:8-20`) governs
refusals on screen, not a guide's statement of who the controller is.

The new section, after it:

> ## Download another person's data {#person-data}
>
> As an admin, you can download what the box holds about another person, for example when someone
> who has left asks for their data. On **Users**, set **Status** to **All statuses** if the person
> is disabled, open their row menu and choose **Download their data**. You get the same files the
> person gets from **Copy of your data**, with its `README.txt` in the language the person chose,
> or the venue's language if they have not chosen one. Managers do not see this action. Waitron
> keeps no list of these requests, so note the request and your answer in the venue's own records.

> ## Descargar los datos de otra persona {#person-data}
>
> Como administrador, puedes descargar lo que el servidor Waitron del local guarda sobre otra
> persona, por ejemplo cuando alguien que ya no trabaja en el local pide sus datos. En
> **Usuarios**, elige **Todos los estados** en **Estado** si la persona está deshabilitada, abre el
> menú de su fila y elige **Descargar sus datos**. Recibes los mismos archivos que la persona
> obtiene con **Copia de tus datos**, con su `README.txt` en el idioma que eligió la persona o, si
> no eligió ninguno, en el idioma del local. Los gerentes no ven esta acción. Waitron no guarda una
> lista de estas solicitudes, así que anota la solicitud y tu respuesta en los registros del local.

`profile.data_copy_help`: English `Your profile and sign-in details, your work records if the venue
keeps them in Waitron, the whole sales voided after they were recorded, the refunds and the
cash-drawer openings you took part in, and a README.txt that explains them and your rights.`;
Spanish `Tus datos de perfil y de acceso, tus datos de trabajo si el local los guarda en Waitron,
las ventas completas anuladas después de registrarse, las devoluciones y las aperturas del cajón de
efectivo en las que participaste, y un README.txt que los explica junto con tus derechos.`

| Sentence | Source |
| --- | --- |
| Users, Status, All statuses, Download their data | `strings.ts` (`nav.staff` :961/:4329, `staff.filter_status` :1166/:4539, `staff.filter_all_statuses` :1172/:4545, Task 9a's key), both languages; a disabled person is hidden by the default filter (`staff-screen.ts:163`) |
| the same files | the two routes call one `sendPersonalData` with the same parts (decision 9); the README's language can differ, which the sentence's next clause says (decision 10) |
| the README's language | decision 10 |
| Managers do not see this action | decision 7 and decision 11; Task 9a and 9c's cases |
| no list of these requests | design §8 O7 (no requests list); the route writes nothing (Task 7b's "nothing written" case) |
| actions.json "when there are any" and what it holds | decision 6, no row no file; decision 3's words |

1. Tests first: the section list in `guide-content.test.ts` (`:156-162`) gains `"person-data"`
   after `"own-data"` (both languages, one `it.each`). Run
   `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`; watch it fail.
2. Write the sections and the strings; check each bold label against `strings.ts`, and each
   sentence about `actions.json` against decision 3's collision list.
3. Omission control: give the Spanish section another id → the test fails.
4. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`,
   `pnpm --filter @waitron/dashboard exec vitest run src/screens/profile-screen.personal-data.test.ts`
   (browser), and from the root `pnpm exec vitest run scripts/guide-links.test.ts scripts/english-only.test.ts`.

## Task 11 (visual) — a reduced LOOK

Scripts and shots outside the worktree: `/Users/clintongormley/waitron-campaign-b/a980-s2c-scripts/`
and `/Users/clintongormley/waitron-campaign-b/a980-s2c-shots/`, named
`<what>-<lang>-<theme>-<width>.png`. Nothing committed. A fix this leads to is committed with a
test that would have caught it where one can.

On 2026-10-25 `gtimeout 15 docker info` exited 1 on this Mac, so `wa-wt` dev stacks could not
start; restarting Docker is shared state this lane does not own. Run it once first: if it answers,
also do step 4; if not, record step 4 under "not looked at", as S2a2's pull request #2049 did.

1. **The Users screen in the test runner**: a throwaway
   `apps/dashboard/src/zz-staff-data-copy.look.test.ts`, built like
   `profile-screen.a11y.test.ts:85-88`'s look screenshots, with Task 9b's stub: English and Spanish
   × light and dark × 1280 and 390 px, (a) an admin's row menu open with **Download their data**
   last, (b) the busy status line, (c) the permission refusal with its button, (d) the
   unknown-person line, (e) a generic failure line. Copy the PNGs to the shots folder, delete the
   file (`git status --short` shows nothing of it).
2. **The guide sections**: write `/help/en/staff` and `/help/es/staff` as the server renders them
   (read how `guide-pages.test.ts` calls the renderer) to HTML files in the scripts folder and
   screenshot `#own-data` and `#person-data` with the workspace's Playwright Chromium in light and
   dark (`localStorage["waitron-theme"]`, `apps/server/src/guide-pages.ts:52`) at 1280 and 390 px.
   Record the Chromium process id and stop only it.
3. **The files**: a throwaway copy of Task 8's admin case that writes the Spanish and an English ZIP
   to the shots folder, run once and deleted; `unzip -l` each; read both READMEs whole and both
   `actions.json`. Look for: `actions.json` named once in the README with its words, in decision
   3's terms; counts equal to the lists' lengths; no colleague's sale number; amounts with two
   places; null sales where decision 6 says.
4. Only if `docker info` answered: S2a2 Task 6b's real download, as the demo's admin, of a person
   disabled first, with the shots of the menu and the saved file's name.
5. Open every PNG and file, and write one line per picture or file for the pull request's **LOOK**
   section, and a "not looked at" line for whatever was skipped and why.

## Task 12 — backlog, overview, design notes and the conventions paragraph

Files: `docs/backlog/data-protection.md` (the A980 S2 point and its S2c sub-point),
`docs/backlog.md` (the A980 entry, only if stale), `docs/superpowers/plans/2026-10-24-a980-data-protection-build.md`,
`docs/superpowers/specs/2026-10-22-a980-data-protection-design.md` (§4.2), `docs/developers/conventions-data.md`
(`:2597-2602`).

1. Grep the siblings first: `grep -rn "S2c\|actions.csv\|personal_data.export\|personal-data" docs/backlog.md docs/backlog/data-protection.md docs/developers/ docs/superpowers/plans/2026-10-2*-a980-*.md docs/superpowers/specs/2026-10-22-a980-*.md`.
2. In `data-protection.md`, the S2 point says an admin can download another person's data under
   `personal_data.export` and that the download holds `actions.json` when there is an action (in
   decision 3's words); **delete the S2c sub-point** (`:83`; S2 is then finished except what the new
   points carry). Add as their own short points:
   - **The rest of "who did what"**, with **line voids, comps and discounts named first** (the
     till's **Void…** and the **Voids and comps** page: the adjustments module's `requested_by` and
     `approved_by`, core's `line_service_cancellations.actor_id`; decision 3, with its worked
     example and the owner's open decision), then the 28 core columns of Task 4's `NOT_YET` list by
     table (the three found by name, `working_order_lines.credited_to`, `order_drafts.owner_id` and
     `bill_edit_states.editor_id`, among them), and other modules' actor columns (the list in
     "Left for later").
   - **An in-place administrator sign-in** for permission refusals, which keeps the current
     session (decision 12), naming the server's existing one-request check as the pattern to reuse
     (`loginManagerById` → `authorizeManager` → `endManagementSession`,
     `apps/server/src/management-api.ts:1063-1078`).
   - The existing "Measure the working-time part on a box" point (`:105`) gains the actions turns:
     Task 3a's snapshot-turn numbers and Task 3b's per-turn numbers on the Mac, what the indexed
     control bought, and the file's size, to be measured on a box too.
   The "Mount the own download from `boot.ts`" point gains: the admin route is mounted by the same
   function.
3. In the overview's status paragraph, after the S2b sentence: "2026-10-25: S2c is built
   ([its plan](2026-10-25-a980-s2c-actions-admin-download.md)): the download holds `actions.json`
   (counts and the sale numbers of the whole sales the person voided after they were recorded, and
   of their refunds and cash-drawer openings), read in short turns of its own after the snapshot,
   and an admin downloads another person's data under `personal_data.export`, with the README in
   that person's language, else the venue's. Line voids, comps and the rest of who did what wait
   (S2c decisions 2 and 3)."
4. In the design's §4.2, after the S2b note: a dated note "2026-10-25: S2c writes `actions.json`,
   not `actions.csv`; it holds whole sales voided after they were recorded, refunds and cash-drawer
   openings, not line voids; the admin's action is **Download their data** in the person's row menu
   on **Users** (the S2c plan's decisions 3, 5 and 11)." The worked example above it is left as
   written.
5. In `conventions-data.md`, the personal-data paragraph names both routes:
   "the staff personal-data downloads (`GET /management-api/me/personal-data/export` and, for an
   admin, `GET /management-api/staff/:id/personal-data/export`, …)" and "the caller checked again in
   the second", says the actions part reads in write-lock turns of its own between the two
   (decision 4), and its case list adds Task 8's admin case.
6. `pnpm exec prettier --file-info <file>` on each changed doc: `docs/` is ignored, so each prints
   `"ignored": true`.

## Root guards to run before `/finish-branch`

From the repository root, once all tasks are in:
`pnpm exec vitest run scripts/english-only.test.ts scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts scripts/native-form-fields.test.ts scripts/pinned-actions-column.test.ts scripts/style-token-names.test.ts scripts/module-seams.test.ts scripts/workspace-cycles.test.ts scripts/errors-reachable.test.ts`.
Read each count. No new package and no new dependency is added, so the shard lists and the
dependency guards should not move.
