# A988 guest count naming implementation plan

> **For agentic workers:** Use `superpowers:subagent-driven-development`. Dispatch each task to one
> `subagent_type: "implementer"` (foreground, never in the background), in the order below, in the
> worktree `/Users/clintongormley/workspace/worktrees/waitron-chore-a988-guest-count-naming`
> (branch `chore/a988-guest-count-naming`). Read the TDD skill before writing a test. One PR.

**Goal:** Call the number of guests in a party or on a receipt `guestCount` everywhere code and the
wire name it, and `guest_count` in a column, so the payment routes, the receipt-guests table and
Split a table stop using `guests` for a count.

**Source:** the third bullet of _Loose ends left by A663 Part 3b (#1827)_ in
[docs/backlog/printers.md](../../backlog/printers.md): "The number is `guests` on the wire and in
the `sale_receipt_guests` column, but `guestCount` on the seat-a-table route, and Split a table
uses `guests` for something else. Free to rename before go-live."

**Tech stack:** TypeScript, Hono routes in `apps/server`, Lit till in `apps/till`, Drizzle on
SQLite in `packages/db`, Vitest (the till runs in headless Chromium). No new dependency.

## Decisions already made (not reopened here)

1. **A party's or a receipt's number of guests is `guestCount` in code and on the wire, and
   `guest_count` in a column** — the party's existing name (`parties.guest_count`, the seat route's
   `guestCount`). So the receipt-guests choice on the till's pay, collect and bill-payment routes
   takes body field `guestCount` and refuses as field `guestCount`; the
   `sale_receipt_guests.guests` column becomes `guest_count` (with its CHECK name and drizzle
   field); code identifiers that hold the count follow. Function and file names that name the
   receipt's guests LINE stay unless they would mislead.
2. **Split a table's `guests: { staying, leaving }` body becomes `guestCounts: { staying,
   leaving }`**, refusing as fields `guestCounts`, `guestCounts.staying` and
   `guestCounts.leaving`, with the till placing those refusals beside the same fields as today.
3. **Not renamed:** table names, file names, route paths (`PUT /api/parties/:id/guests`,
   `POST /api/parties/:id/split-table`), anything a person sees (translation keys and strings),
   and every `guests` that means PEOPLE (party allergy guest lists, `today-names`, floor
   `ApartReason` `"guests"`, adjustments report "guests").
4. Pre-live: no backwards-compatibility code and no data migration beyond the column rename itself
   (CLAUDE.md §3, last rule). An old till sending `guests` is simply ignored, not translated.

**Q1 ANSWERED by the lane driver, 2026-10-27: B for this PR.** The column rename breaks the frozen
Madrid baseline fixture's comparison, and changing that comparison is an assertion change only the
owner can allow. So Task 5 is SKIPPED here: the column stays `guests`, Task 6 records it as a
deliberate limit, and a follow-up backlog entry plus an owner question offer option A as its own
small PR. This PR therefore adds no migration.

## Global constraints

- **Every task leaves the tree green on its own**: its focused tests, its package typechecks, and
  the guards it names. Each task commits with `git commit -s` and a plain-English message.
- **Rename-only test edits are allowed, and nothing else.** A test whose body field, refusal
  `field` string, column or drizzle property reference, type name or event-detail key changes only
  because of this rename is updated mechanically, with **every asserted value unchanged** (counts,
  codes, statuses, row contents, rendered text). Prefer changing only the reference: for example
  keep a select alias `.select({ guests: saleReceiptGuests.guestCount })` so the asserted object
  `{ guests: 4 }` stays byte-identical. Do not rename test titles (`it("…")` strings):
  `docs/developers/conventions-data.md` cites some by title. Any other assertion that must change
  to pass is a **STOP**: commit nothing for it, write it into the ledger, and return.
- **List every test file changed mechanically** in the ledger
  `docs/handoffs/2026-10-27-a988-guest-count-naming.md` (gitignored; create it in Task 1 with
  `Status: in progress`), one line per file with the task number, and update it at the end of
  every task.
- **Protected, unedited, run in Tasks 2 and 5:**
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
  Their diffs must be empty at the end (`git diff main -- packages/fiscal-verifactu/src/write-path.e2e.test.ts packages/fiscal-verifactu/src/inmutabilidad.test.ts`).
- **Check `guests` is a count before renaming it.** Every task starts with the grep it names and
  classifies each hit as count (rename) or people / guests line / UI field (leave). Follow the call
  chain, not the name.
- A Vitest run that shows no `Tests` count proves nothing. A name-filtered run loads no guard
  suite. Check each command's exit status separately (`&&` or one command per call).
- The till's tests run headless Chromium: check `memory_pressure | grep free` first and run beside
  another session only well above 15% free.
- Before each commit run `pnpm format:check` (exit 0). Typecheck with `pnpm --filter <pkg>
  typecheck`.
- **Intermediate commits are not shippable, the PR is.** No test spans the till and the server
  (searched: `git grep -l -E "apps/till/src|@waitron/till" -- apps/server packages scripts` finds
  only comments and a probe fixture), so after Task 2 the server reads `guestCount` while the till
  still sends `guests` and every suite stays green; a running till at that commit would have its
  chosen count ignored and the party's default stored. Task 3 closes that. Split a table is renamed
  on both sides in one task (Task 4) so it never has that gap.

## Measured: how the column migration is produced

Run on 2026-10-27 in a throwaway detached worktree of `1bf0d26e7`
(`git worktree add --detach "$(mktemp -d)/probe" HEAD`, `pnpm install --frozen-lockfile`, removed
afterwards with `git worktree remove --force`), with the schema edited to
`guestCount: count("guest_count")` and CHECK name `sale_receipt_guests_guest_count_ck`.

1. **`pnpm --filter @waitron/db db:generate` stops at an interactive prompt.** With no terminal it
   printed `Error: Interactive prompts require a TTY terminal …` from `promptColumnsConflicts`
   (drizzle-kit 0.31.11) and wrote nothing, exiting 0. The prompt is
   `Is guest_count column in sale_receipt_guests table created or renamed from another column?`
   with `+ guest_count create column` (default) and `~ guests › guest_count rename column`.
2. **Choosing rename produces a table rebuild, not a `RENAME COLUMN`**, because the CHECK changes.
   Driven with `expect` (script below), drizzle wrote `drizzle/0194_sale_receipt_guest_count.sql`,
   `meta/0194_snapshot.json` and a journal entry:

   ```sql
   PRAGMA foreign_keys=OFF;--> statement-breakpoint
   CREATE TABLE `__new_sale_receipt_guests` (
   	`sale_id` text PRIMARY KEY NOT NULL,
   	`guest_count` integer,
   	`created_at` text NOT NULL,
   	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE restrict,
   	CONSTRAINT "sale_receipt_guests_guest_count_ck" CHECK("__new_sale_receipt_guests"."guest_count" is null or (typeof("__new_sale_receipt_guests"."guest_count") = 'integer' and "__new_sale_receipt_guests"."guest_count" between 1 and 999))
   );
   --> statement-breakpoint
   INSERT INTO `__new_sale_receipt_guests`("sale_id", "guest_count", "created_at") SELECT "sale_id", "guest_count", "created_at" FROM `sale_receipt_guests`;--> statement-breakpoint
   DROP TABLE `sale_receipt_guests`;--> statement-breakpoint
   ALTER TABLE `__new_sale_receipt_guests` RENAME TO `sale_receipt_guests`;--> statement-breakpoint
   PRAGMA foreign_keys=ON;
   ```

3. **That generated SQL fails on every existing database, empty or not.** Applied with `node:sqlite`
   (Node v26.11.1, SQLite 3.54.0) after `0166_sale_receipt_guests.sql`, both with one row and with
   none, inside `BEGIN … COMMIT`: `no such column: "guest_count" - should this be a string literal
   in single-quotes?`. The copy selects the NEW name from the OLD table.
4. **Correcting that one line — `SELECT "sale_id", "guests", "created_at"` — applies and keeps the
   row**: `[{"sale_id":"s1","guest_count":4,…}]`. Plain `ALTER TABLE … RENAME COLUMN guests TO
   guest_count` also keeps the row, but leaves the CHECK named `sale_receipt_guests_guests_ck`,
   which then disagrees with drizzle's snapshot; the plan uses the corrected rebuild.
5. **The rebuild drops triggers ON the table; `RENAME COLUMN` keeps them.** With a stand-in
   `BEFORE UPDATE` trigger on `sale_receipt_guests`, `select name from sqlite_master where
   type='trigger'` listed it before and nothing after the rebuild. Not run, read only: the real
   append-only triggers come back in the same migration run, because `applyMigrations` calls
   `installAppendOnlyTriggers` after each set (`packages/migrations/src/apply.ts:74`), and boot
   records `append_only.triggers_restored` only for triggers missing BEFORE it migrates
   (`missingBeforeMigration`, `apps/server/src/boot.ts:987`), then `assertAppendOnlyIntact` checks
   them after (`:1002`). Task 5 adds a test that an UPDATE is refused after the reinstall.
6. **Guards over the corrected rebuild:** `pnpm exec vitest run scripts/schema-constraints.test.ts
   scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
   scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts
   scripts/migration-upgrade.test.ts scripts/append-only-migration-sets.test.ts
   scripts/two-file-foreign-keys.test.ts` → `Tests 1 failed | 505 passed (506)`. The one failure was
   `carries every check constraint the product declares`: `expected [ 'sale_receipt_guests_guests_ck' ]
   to deeply equal []` — the hand list in `scripts/schema-constraints.test.ts:783`. With that entry
   renamed, that file passed (`Tests 4 passed (4)`).
7. **The frozen Madrid baseline breaks.** `pnpm --filter @waitron/server exec vitest run
   scripts/demo-seed/seed.madrid-baseline.test.ts` failed both cases with
   `before/sale_receipt_guests: …` and the diff `- "name": "guests"` / `+ "name": "guest_count"`.
   Control on the unchanged worktree: `Tests 2 passed (2)`. The fixture
   (`packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json`) records every table's
   `pragma table_info` columns, is pinned by SHA-256 in its manifest
   (`packages/country-es/src/demo-testing.test.ts`), and A972's plan says to keep it untouched.
   No schema change has landed since its capture commit `d5c7ccb1a` (`git log d5c7ccb1a..HEAD --
   packages/*/drizzle packages/*/src/schema` is empty), so this is the first one to meet it.
8. **Renaming only the drizzle property** (`guestCount: count("guests")`, column and CHECK
   unchanged) made `db:generate` print `No schema changes, nothing to migrate`. That is why Task 1
   can rename every TypeScript reader without a migration.

The `expect` driver used (keep it outside the worktree):

```tcl
set timeout 60
cd [lindex $argv 0]
spawn pnpm --filter @waitron/db db:generate --name sale_receipt_guest_count
expect {
  "rename column" { sleep 1; send "\033\[B"; sleep 1; send "\r"; exp_continue }
  eof
}
```

Run as `gtimeout 120 expect <script> <worktree>`. Running `db:generate` by hand in a terminal and
choosing the rename line does the same.

Other places checked for the column: no export descriptor, transfer list or
`scripts/write-path-tables.json` names `sale_receipt_guests`; no foreign key points at it
(`grep -c '"tableTo": "sale_receipt_guests"' packages/db/drizzle/meta/0193_snapshot.json` → `0`);
no other set's migration SQL names it (only `packages/db/drizzle/0166_sale_receipt_guests.sql`);
`apps/server/src/canvas-retirement-upgrade.test.ts:515` names the table only, with no rows. Table-name
lists in `packages/db/src/classification.ts`, `packages/migrations/migrations.manifest.json`,
`scripts/append-only-triggers.test.ts` and `scripts/schema-constraints.test.ts:286` are unchanged
because the table keeps its name.

## Task order

| # | Task | Boundary |
| - | ---- | -------- |
| 1 | Drizzle property `guestCount` (column still `guests`) and every TypeScript reader/writer | db + server |
| 2 | Payment routes read and refuse `guestCount`; server identifiers follow | server |
| 3 | Till sends `guestCount` on every payment request; till identifiers follow | till |
| 4 | Split a table: `guestCounts` on both sides | server + till |
| 5 | Column `guest_count` and its migration — **gated on Q1** | db + guards |
| 6 | Documentation and backlog | docs |

Task 5 comes after the code renames so that, whatever the lane answers, Tasks 1–4 and 6 land; if
the lane keeps the column, Task 5 is skipped and the only `guests` left for this count is the SQL
column name.

---

## Task 1: the drizzle property becomes `guestCount`

**Find:** `git grep -n -E "saleReceiptGuests\.guests|saleReceiptGuests\)\.values|guests: count" -- packages apps`.
Today's hits are in `packages/db/src/schema/sale-receipt-guests.ts`,
`packages/db/src/schema/sale-receipt-guests.test.ts`, `apps/server/src/receipt-guests.ts`
(`recordReceiptGuests` insert, `readPrintedGuests` select) and the server tests
`adjustments-bill-payments`, `bill-payments-loop`, `bill-payments`, `finish-party-collect`,
`receipt-guests`, `receipt-guests.routes`, `receipt-print`, `transaction-receipt-api`,
`unpaid-departure` and `receipt-language` (`.test.ts`). Re-run the grep; it is the list.

**Change:** `packages/db/src/schema/sale-receipt-guests.ts`: `guests: count("guests")` →
`guestCount: count("guests")`, and the CHECK body's `${t.guests}` → `${t.guestCount}`. The column
string `"guests"` and the CHECK name `sale_receipt_guests_guests_ck` stay (Task 5 changes them).
In `apps/server/src/receipt-guests.ts` write `.values({ saleId: sale.saleId, guestCount })` and
read `saleReceiptGuests.guestCount`.

- [ ] Create the ledger (see Global constraints).
- [ ] RED: in `packages/db/src/schema/sale-receipt-guests.test.ts` change the `insert` helper to
  `.values({ saleId, guestCount: guests })` and every read of `saleReceiptGuests.guests` to
  `.guestCount`, assertions unchanged. Run
  `pnpm --filter @waitron/db exec vitest run src/schema/sale-receipt-guests.test.ts` and record the
  failure (drizzle has no `guestCount` property yet).
- [ ] Rename the property. Rerun the same command: green with a `Tests` count.
- [ ] Update `apps/server/src/receipt-guests.ts` and every server test from the grep (property
  references only; keep select aliases so asserted objects are unchanged).
- [ ] `pnpm --filter @waitron/db typecheck` and `pnpm --filter @waitron/server typecheck`.
- [ ] Focused: `pnpm --filter @waitron/server exec vitest run src/receipt-guests.test.ts
  src/receipt-guests.routes.test.ts src/receipt-print.test.ts src/bill-payments.test.ts
  src/bill-payments-loop.test.ts src/adjustments-bill-payments.test.ts
  src/finish-party-collect.test.ts src/transaction-receipt-api.test.ts
  src/unpaid-departure.test.ts src/receipt-language.test.ts`.
- [ ] Guards (prove no migration is owed and the constraint list holds):
  `pnpm exec vitest run scripts/migrations-match-schema.test.ts scripts/schema-constraints.test.ts`.
- [ ] Commit: "Name the receipt guests row's count guestCount in code (A988)".

## Task 2: the payment routes read and refuse `guestCount`

**Find:** `git grep -n -w "guests" -- apps/server/src ':!*.test.ts' | grep -v -i allerg`, then
classify. The count hits today: `receipt-guests.ts` (`GuestsChoice`, `readGuestsChoice`,
`invalid("guests")`, the `guests` parameter of `recordSaleReceiptFacts`, the local `guests`
variables and the `BILL_PARTY.guests` / `readPrintedGuests` aliases), `till-api.ts`
(`POST /api/sales` ~1763, `POST /api/pay` ~1826, `POST /api/working-orders/:id/collect` ~2687–2710:
`readGuestsChoice(body.guests)` and `{ ...body, zoneId, guests, … }`), `bill-payments-api.ts`
(`parseRequest`), `bill-payments.ts` (`BillPaymentRequest.guests`, the `guests` options of
`issueWhenFullyPaid` / `completeBillPayment`, `retryShapeOf`), `till-sale.ts` (three request
interfaces' `guests`, the `guests: GuestsChoice` parameters, every `req.guests`),
`testing/party-venue.ts` (`pay(v, billId, amount, ...guests)` sends `guests`). Leave:
`receipt-document.ts`, `invoice-document.ts` and `receipt-print.ts`'s `guests` (the printed
receipt's guests line, never on the wire — see "Left deliberately"), `table-actions.ts` (Task 4),
`till-api.ts` `requireSplitGuests` (Task 4), and every people/comment use.

**Names:** `GuestsChoice` → `GuestCountChoice`; `readGuestsChoice` → `readGuestCountChoice`,
refusing `invalid("guestCount")`; request/option/parameter fields `guests` → `guestCount`. Keep
`recordReceiptGuests`, `recordSaleReceiptFacts`, `readPrintedGuests`, `readReceiptGuests`,
`storableDefault` and the file name — they name the guests line or its row. Update their doc
comments only where a comment names the old field.

**Trap — the bill-payment retry fingerprint.** `retryShapeOf` (`bill-payments.ts` ~993) spreads
the request and sets `guests: undefined` so a resend is matched on the payment alone; the
fingerprint drops undefined keys (`canonicalJson`, `apps/server/src/parties.ts` ~833). It must
become `guestCount: undefined`, or the count enters the fingerprint. The existing describe
`a bill payment's retry is matched on the payment alone, never its guests`
(`receipt-guests.routes.test.ts` ~815) is what catches a miss — keep it, change only body keys.

- [ ] RED first, in `apps/server/src/receipt-guests.routes.test.ts`, a new describe
  `A988: the payment routes read guestCount`, on the existing party-of-4 bill fixtures, for each of
  `POST /api/sales`, `POST /api/pay`, `POST /api/working-orders/:id/collect` and the
  bill-completing `POST /api/working-orders/:id/payments`:
  (a) sending `guestCount: 2` stores 2 (fails today: the default 4 is stored);
  (b) sending only the old `guests: 2` stores the party's 4 — the old name is ignored (fails today:
  2 is stored);
  (c) `guestCount: 0` is refused `400 management.request_invalid { field: "guestCount" }` and
  records no sale or payment (fails today: the sale goes through).
  Run `pnpm --filter @waitron/server exec vitest run src/receipt-guests.routes.test.ts -t "A988"`
  and record the failures.
- [ ] Rename in the source files above; `pnpm --filter @waitron/server typecheck`.
- [ ] Mechanically update existing tests: body `guests:` → `guestCount:` where it is the payment
  count, `params: { field: "guests" }` → `{ field: "guestCount" }`, and calls through
  `party-venue.ts`'s `pay`. Today that includes `receipt-guests.routes.test.ts`,
  `receipt-guests.test.ts` (the `a payment request's guests` refusal case ~367),
  `receipt-print.test.ts` and `unpaid-departure.test.ts` (~1679–1683, the collect refusal). Find
  the rest with `git grep -n -E "guests: (null|[0-9])|field: \"guests\"" -- 'apps/server/src/*.test.ts'`
  and `git grep -n -E "\bpay\(v" -- apps/server/src`.
- [ ] Focused, no name filter: `pnpm --filter @waitron/server exec vitest run
  src/receipt-guests.routes.test.ts src/receipt-guests.test.ts src/receipt-print.test.ts
  src/unpaid-departure.test.ts src/bill-payments.test.ts src/bill-payments-api.test.ts
  src/bill-payments-loop.test.ts src/finish-party-collect.test.ts src/till-sale.test.ts
  src/adjustments-bill-payments.test.ts` plus any other file the greps touched.
- [ ] Protected, unedited: the fiscal command in Global constraints.
- [ ] Commit: "Payment routes take the receipt's guest count as guestCount (A988)".

## Task 3: the till sends `guestCount` on every payment request

**Find:** `git grep -n -w "guests" -- apps/till/src ':!*.test.ts' | grep -v -i "allerg\|i18n/"`,
classify. The count hits today: `api/client.ts` (`BillPaymentRequest.guests` ~1138, `recordSale`'s
`guests` parameter and body ~2839/2851, `pay`'s `guests` field ~2878 spread into the body,
`collectOrder` ~3229/3235), `till-app.ts` (`WholePayment.guests` ~1163, the handlers ~6372, 6409,
6574, 7521–7528, 8225–8232, 10282 `pending.request.guests`, 16988–17017, 17136–17222),
`state/bill-payment.ts` (`delete payment.guests` ~172 — keeps the count out of the resend key; it
must become `delete payment.guestCount`), `widgets/tender-pay.ts` (`ReceiptGuestsDetail.guests`,
`RetainedTender.guests`, the confirmation spreads ~556, 1209, 1218–1252),
`widgets/bill-pay-dialog.ts` (`#guestsDetail` ~1228), `widgets/presented-pay-dialog.ts`
(`PresentedPayDetail`'s `guests` ~44–46 and its builders/readers ~364–376, 452–489). These are
coupled through object spreads (`Confirmation = Omit<BillPaymentRequest, "submissionId">`, the
widgets' details spread into requests), so rename them together in this task; TypeScript does not
flag an extra `guests` key in a spread.

**Leave:** the shared stepper's input `name="guests"` (`widgets/guest-count.ts`, also used by the
seat and party-guests dialogs, which already send `guestCount`); widget form-field keys `"guests"`
(`Field` unions, `errors.get("guests")`); `receiptGuests` / `defaultReceiptGuests` (the default
the receipt's guests line starts on); `guestsText`, `guestsAttempted`, `#guests()` renderers; the
`ReceiptGuestsDetail` interface name; Split a table (Task 4); `floor-today.ts` `"guests"` reasons.

- [ ] RED: in `apps/till/src/api/client.test.ts`, change the existing body assertions for
  `recordSale`, `pay`, `collectOrder` and the bill payment to expect `guestCount` and NO `guests`
  key (add `expect(body).not.toHaveProperty("guests")` beside each); run
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts` and record the failure.
- [ ] Rename across the files above; `pnpm --filter @waitron/till typecheck`.
- [ ] Mechanically update the widget and app tests that read event details or request bodies.
  Today: `till-app-bill-payments.test.ts`, `widgets/tender-pay.test.ts`,
  `widgets/bill-pay-dialog.test.ts`, `widgets/presented-pay-dialog.test.ts`, `till-app.test.ts`,
  `till-app-handheld-pay.test.ts`, `state/bill-payment.test.ts`, `till-app-boot-and-counter.test.ts`
  and possibly `screens/till-table-order-screen.test.ts`. Change only keys holding the count —
  `[name="guests"]` selectors and form-field keys stay.
- [ ] Focused (check memory first): `pnpm --filter @waitron/till exec vitest run
  src/api/client.test.ts src/state/bill-payment.test.ts src/widgets/tender-pay.test.ts
  src/widgets/bill-pay-dialog.test.ts src/widgets/presented-pay-dialog.test.ts
  src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts src/till-app.test.ts
  src/till-app-boot-and-counter.test.ts src/screens/till-table-order-screen.test.ts`, plus the
  matching `*.unsaved.test.ts` and `*.a11y.test.ts` of the three widgets.
- [ ] Check no count-shaped `guests` remains: `git grep -n -E "guests(\?)?: (number|null|[0-9])|\.guests\b|\{ guests \}" -- apps/till/src`
  and classify every hit left.
- [ ] Commit: "The till sends the receipt's guest count as guestCount (A988)".

## Task 4: Split a table sends `guestCounts`

**Server:** `apps/server/src/till-api.ts` `requireSplitGuests` (~817–825) → `requireSplitGuestCounts`,
called with `body.guestCounts` (~3134), refusing `invalid("guestCounts")` for a non-object and
`"guestCounts.staying"` / `"guestCounts.leaving"` for a bad side; the local `guests` → `guestCounts`.
`apps/server/src/table-actions.ts`: `SplitGuests` → `SplitGuestCounts`, the option
`guests?: SplitGuests` → `guestCounts?: SplitGuestCounts`, and its two reads (~393, ~418).
**Till:** `api/client.ts` `splitTable(…, guestCounts?)` sending `guestCounts` (~4599–4620, fix its
doc comment); `till-app.ts` `refusedSplitSide` (~716–719) matching `"guestCounts.staying"` /
`"guestCounts.leaving"`, and the split handler (~15228–15264); `screens/till-table-order-screen.ts`
`SplitTableDetail.guests` → `guestCounts` (~247, ~4838). Leave the split dialog's
`SplitGuestsDetail` type, its `split-guests-confirm` event and the widget/file names.

- [ ] RED server, in `apps/server/src/till-api.table-actions.test.ts` beside the existing split
  cases: (a) `guestCounts: { staying: 3, leaving: 1 }` leaves the staying table at 3 and the new
  party at 1 (fails today: ignored, 5 and none); (b) the old `guests: { staying: 0, leaving: 2 }`
  is ignored — the split succeeds, staying keeps 5, the new party has none (fails today: refused
  `guests.staying`). Then change the existing `refuses guests %j as a bad %s, changing nothing`
  table's body key to `guestCounts` and its field strings to `guestCounts…` (title unchanged).
  Run `pnpm --filter @waitron/server exec vitest run src/till-api.table-actions.test.ts`; record.
- [ ] RED till: in `apps/till/src/api/client.test.ts` (~3058–3068) and
  `api/client.bill-editing.test.ts` (~110) expect body `guestCounts`; in `till-app-parties.test.ts`
  change the refusal table (~2291–2292) to `"guestCounts.staying"` / `"guestCounts.leaving"` with
  the same sides and field texts, and the event details' `guests:` → `guestCounts:`. Run them;
  record.
- [ ] Implement both sides; `pnpm --filter @waitron/server typecheck` and
  `pnpm --filter @waitron/till typecheck`.
- [ ] Mechanically update the remaining callers: `apps/server/src/receipt-guests.test.ts` (~203,
  a split command), any other `splitTable(…, { … guests: … })` found by
  `git grep -n -B6 "staying:" -- 'apps/server/src/*.test.ts'`, and the till's
  `screens/till-table-order-screen.test.ts` / `till-table-order-screen.actions-unsaved.test.ts`
  details.
- [ ] Focused: `pnpm --filter @waitron/server exec vitest run src/till-api.table-actions.test.ts
  src/receipt-guests.test.ts src/party-table-actions.test.ts src/attendance-arriving-groups.test.ts
  src/bill-editing.bill-moves.test.ts src/floor-catch-up.test.ts` and
  `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts
  src/api/client.bill-editing.test.ts src/till-app-parties.test.ts
  src/screens/till-table-order-screen.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts
  src/widgets/split-guests-dialog.test.ts`.
- [ ] Commit: "Split a table sends each side's count as guestCounts (A988)".

## Task 5: the column becomes `guest_count` — SKIPPED in this PR (Q1 = B); kept as the follow-up's recipe

**Q1 for the lane (record the answer in the ledger before starting):** renaming the column changes
`pragma table_info(sale_receipt_guests)`, which `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`
compares against the frozen, digest-pinned `madrid-before-move.{en,es}.json` (measured above,
item 7). The fixture must not be edited or regenerated. Choose one:

- **A. Authorise a narrow comparator change** in `seed.madrid-baseline.test.ts`: an explicit map of
  renamed schema columns, `{ sale_receipt_guests: { guests: "guest_count" } }`, applied to the
  frozen side's column names and row keys before comparing, failing if an entry is unused; every
  other comparison unchanged. This is an assertion change, so it needs the lane's explicit yes. A972
  cut 2 plans its own old→new expectation map in the same comparator — check its status and share
  one mechanism rather than adding two.
- **B. Keep the column `guests`.** Skip this task; Task 1 already gives code `guestCount`. The SQL
  column alone keeps the old word, recorded as a deliberate limit in Task 6.

**If A:**

- [ ] RED: add `packages/db/src/schema/sale-receipt-guests-upgrade.test.ts`, modelled on
  `kitchen-timing-upgrade.test.ts`: stage core's migrations, cut the journal to the entry before
  the tag ending `_sale_receipt_guest_count` (assert that tag exists), migrate, seed a sale as
  `sale-receipt-guests.test.ts`'s `seedSales` does and insert by raw SQL two rows into the old
  `guests` column (4 and null); then run all of core's migrations and assert the two rows read
  `guest_count` 4 and null, `pragma table_info` lists `guest_count` and not `guests`, the table's
  stored SQL carries `sale_receipt_guests_guest_count_ck`, and, after
  `installAppendOnlyTriggers(db, CORE_MIGRATIONS.appendOnlyTables ?? [])` (what `applyMigrations`
  does per set), an UPDATE of the row is refused with the trigger abort. It fails now: no such tag.
- [ ] Edit `packages/db/src/schema/sale-receipt-guests.ts`: `count("guest_count")`, CHECK name
  `sale_receipt_guests_guest_count_ck`.
- [ ] Generate: `pnpm --filter @waitron/db db:generate --name sale_receipt_guest_count` in a
  terminal, choosing `~ guests › guest_count rename column` (or the `expect` driver above). Confirm
  the new SQL equals the measured output, then correct the copy line's SELECT to
  `"sale_id", "guests", "created_at"` and add a two-line header, as `0036_party_rename.sql` and
  `packages/media/drizzle/0005_photo_name_only.sql` do, saying the copy line is hand-corrected
  because drizzle copies the new column name from the old table, so a regeneration must paste it
  back. Keep drizzle's snapshot and journal entry exactly as generated.
- [ ] Before shipping the rebuild, list foreign keys pointing at the table:
  `grep -c '"tableTo": "sale_receipt_guests"' packages/db/drizzle/meta/0194_snapshot.json` → `0`
  (use the actual number the file gets).
- [ ] Mechanical guard update: `scripts/schema-constraints.test.ts` hand list entry
  `"sale_receipt_guests_guests_ck"` → `"sale_receipt_guests_guest_count_ck"`. Optional, allowed
  without asking: a `scripts/migration-upgrade.test.ts` `CANDIDATES` entry
  `"sale_receipt_guests.guests": [4]` so rows reaching the rebuild carry a real count (the walk keys
  by the column name at each step; an unreached entry fails the guard).
- [ ] Apply the comparator change the lane authorised under A, nothing wider.
- [ ] Focused: `pnpm --filter @waitron/db exec vitest run src/schema/sale-receipt-guests.test.ts
  src/schema/sale-receipt-guests-upgrade.test.ts`, `pnpm --filter @waitron/server exec vitest run
  src/receipt-guests.test.ts src/receipt-guests.routes.test.ts
  scripts/demo-seed/seed.madrid-baseline.test.ts`, `pnpm --filter @waitron/country-es exec vitest
  run src/demo-testing.test.ts` (the fixture digests must still match).
- [ ] Guards, one run, read the `Tests` line: `pnpm exec vitest run scripts/schema-constraints.test.ts
  scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts
  scripts/migrations-match-schema.test.ts scripts/journal-monotonic.test.ts
  scripts/migration-upgrade.test.ts scripts/append-only-migration-sets.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/apply-migrations-callers.test.ts
  scripts/module-graph-honesty.test.ts`, then the protected fiscal command.
- [ ] `pnpm --filter @waitron/db typecheck`; commit: "Rename the receipt guests column to
  guest_count (A988)". The PR description says the migration rebuilds an append-only ledger table
  whose triggers are reinstalled in the same run.

## Task 6: documentation and backlog

**Find:** `git grep -n -E "readGuestsChoice|GuestsChoice|requireSplitGuests|SplitGuests\b|guests\.staying|guests\.leaving|field: \"guests\"|payment routes' \`guests\`" -- docs/developers docs/backlog docs/backlog.md CLAUDE.md apps/server/src/guide README.md`.

- [ ] `docs/backlog/printers.md`, _Loose ends left by A663 Part 3b (#1827)_: delete the third bullet
  (this item). In the next bullet change "a server refusal naming `guests` … `refusalField` has no
  `guests` case" to `guestCount`. Under B, add a line to the area's
  `## Decisions and deliberate limits`: the receipt-guests count is `guestCount` in code and on the
  wire but the column stays `guests` because the frozen Madrid fixture pins it.
- [ ] `docs/developers/conventions-data.md` ~4165–4180: Split a table's fields become
  `guestCounts.staying` / `guestCounts.leaving`; "The payment routes' `guests`" becomes
  `guestCount`. Test titles cited there are unchanged by this plan.
- [ ] Under B (this PR): add a short backlog entry in `docs/backlog/printers.md` (outside the
  decisions section, as open work): "Rename `sale_receipt_guests.guests` to `guest_count` — needs
  the owner's yes to map the renamed column in `seed.madrid-baseline.test.ts`'s comparison of the
  frozen Madrid fixture; the recipe and measurements are Task 5 of
  `docs/superpowers/plans/2026-10-27-a988-guest-count-naming.md`."
- [ ] Under A only, same file ~3441: "Two generated migrations also carry hand-written SQL" becomes
  three, naming the new file and what is hand-written in it.
- [ ] `docs/backlog/printers.md` ~709 and `docs/backlog/till.md` ~172 name the TABLE
  `sale_receipt_guests` only — no change. `CLAUDE.md` §3's "the seat-a-table route's `guestCount`"
  stays true — no change. Historical plans (`2026-10-15-a663-receipt-layout.md`,
  `2026-10-22-a758-7-collect-at-counter.md`) record what was true then — no change.
- [ ] No guide text names a wire field (`apps/server/src/guide/` mentions guests only as people).
- [ ] `docs/` is prettier-ignored, so `pnpm format:check` says nothing about it; `git diff --check`.
  Commit: "Docs: the guest count is guestCount (A988)". Set the ledger to `Status: done`.

## Left deliberately (judgment calls the lane may overturn)

- `ReceiptDocument.guests` (`apps/server/src/receipt-document.ts`, built by `receipt-print.ts` and
  `invoice-document.ts`) holds the count printed on the receipt's guests line. It is an in-process
  print model, never on the wire or stored, and renaming it reaches the fiscal print path and its
  tests (`invoice-document.test.ts` asserts `not.toHaveProperty("guests")`, which would pass
  vacuously after a rename unless updated with it). Left as is.
- The till's guest-count stepper input `name="guests"` and the dialogs' form-field keys `"guests"`
  name a form field, not the wire.
- An old till sending `guests` is ignored, not refused. Read, not run: the handlers read named
  fields and spread the rest of the body, so an unknown key is not refused; Task 2's case (b) and
  Task 4's case (b) are the tests that pin it. This plan adds no special case.

## Finishing

- [ ] After Task 6 tell the driver the branch is ready for `finish-branch`. This diff changes a
  cross-package wire contract (till ↔ server), so it takes the full path: the plan-vs-spec read and two Codex run-it reviews side by side.
- [ ] The pre-push hook runs once, never `--no-verify`; CI owns package suites and coverage — read
  the `changes` job's selection on the current head and confirm `@waitron/db`, `@waitron/server`,
  `@waitron/till` coverage ran. The lane lands the PR (not a fiscal PR: no invoice, chain, series
  or filing change).
