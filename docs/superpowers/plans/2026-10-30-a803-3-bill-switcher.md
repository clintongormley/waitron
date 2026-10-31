# A803 slice 3: one bill switcher, one ⋮ menu, no main bill — task plan

**Goal.** At a table, the waiter always sees which bill is on screen and can change it from one
drop-down, "Bill 1 · €38.50 ▾" with one bill and "Bill 2 of 3 · Clint · €54.00 ▾" with several, which
also holds **+ New bill**. Everything that acts on that bill or on the whole table sits in one ⋮
menu with two headed sections. The Tab button and its side panel go, the table screen has no Hold,
and Pay is drawn quiet (still tappable, and explaining why) while this bill has unsent dishes. The
party's hidden "main bill" goes: no join or move ever merges bills by itself, and no order, draft or
action ever lands on a bill the waiter did not choose.

**Implements.** [Master plan](2026-10-19-a803-bills-and-tables.md), section "Slice 3: always-on
switcher, one kebab, explicit bill selection", under its "Global constraints and release gates",
"Review focus" (item 4), "Builder decisions and proposed contracts" ("Full invoice and menu") and
"Shared execution and verification contract", all binding except where "Departures" says otherwise
and why. [Spec](../specs/2026-10-18-a803-bills-and-tables-design.md) §3.4, §3.5 as amended, §3.8,
§6 (second bullet: no "merge into their main bill" question), §7. The owner's amendments of
2026-10-18 ~21:40–22:05 (lane C queue, A803 section, items 1–5) override spec §3.5 and boards 12/13.

**Execution.** `trial: implementers`: each task below goes to ONE `subagent_type: "implementer"`
dispatch (medium effort), test first. Each is sized for well under 100 tool calls (the estimate is
in its heading); an implementer passing about 150 calls with its task unfinished stops at a passing
or cleanly red point, commits, and hands over (done, left, files, each check's state). Worktree
`/Users/clintongormley/workspace/worktrees/waitron-feat-a803-3-bill-switcher`, branch
`feat/a803-3-bill-switcher`, planned from main `a90f4f87b`. Review weight: **FULL** (a core
migration that rebuilds `parties`, a cross-package wire contract between server and till, and
concurrency: a bill created while another till acts on the party).

**Task size and end state (review-1 I1, I2, I6).** Every task is estimated at about 70 implementer
tool calls or fewer. Every task ends with `pnpm --filter @waitron/server typecheck` and
`pnpm --filter @waitron/till typecheck` clean and its touched files' focused suites green. No task
is planned to end red. If one does, the implementer stops at a cleanly red point, lists the exact
failing files and cases in the ledger and the hand-over, and the next task turns them green before
anything else.

**Not a working product between Tasks 2 and 8d.** From Task 2 the server's answers change shape
(no `merged`, no `mainBillId`, `billIds`), and the till reads the new shapes only from Task 8a
(answers) and Task 8c (the floor's `openingBillId`). No test sees the gap: the till's tests use
fakes and there is no shared wire type. For example, `till-app.ts:14808`
(`if (result.mainBillId !== null) this.activeTabId = result.mainBillId;`) would set the bill on
screen to `undefined` against a Task 4a server. So each intermediate commit is green in its own
package only. Nothing is pushed, and no dev stack is started from this branch, before Task 8d's
commit. `/finish-branch` pushes the whole branch once.

## Owner answers

- 2026-10-31 ~02:40, via the watcher: question 5 — yes, all six items as written (questions.md).
  Question 5b (below) is not yet answered.

Otherwise none yet. The defaults under "Owner questions" are what the build uses. **Question 5 (test and
guard changes) is asked in `questions.md` at Task 0, before the build edits any of those files**;
the build goes ahead on its default meanwhile, as the owner's 2026-10-05 rule allows ("ask in
questions.md, carry on with other work meanwhile"), and the PR cannot land until it is answered
(Task 16's landing gate). The other questions are asked in `questions.md` and the PR at Task 16.

## Read this first: what the planning pass found

Line numbers are at `a90f4f87b`. Two things were run: the drizzle generation in finding 9 (then
thrown away), and `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts`
(24 passed), which showed that test's "no bill named" cases pass only through a test helper
(finding 2). Everything else was read, not run.

1. **No production order path falls back to the main bill any more.** Since A773-1 every send names
   its bill: `placeGroups` takes `input.billId ?? expectedEdit.billId` and refuses a mismatch
   (`apps/server/src/order-groups.ts:273-275`), `expectedEdit` is required at the route
   (`parseBillEditExpected`, `apps/server/src/till-api.ts:3227`), `saveDraft` requires `billId`
   (`apps/server/src/order-drafts.ts:484`), and `splitDraft`/`submitDraft` take the bill from the
   stored draft (`order-drafts.ts:188`, `:1153`). The till's draft is always tied to the bill on
   screen (`DraftSave.billId`, `apps/till/src/api/client.ts:812-813`, built from `activeTabId`,
   `apps/till/src/till-app.ts:11415-11427`). `partyMainBill` (`apps/server/src/parties.ts:159-194`)
   has one product caller, Split a table choosing no bill (`apps/server/src/table-actions.ts:428`).

2. **The tests' "no bill named" fallback lives in three helpers.** `testing/group-submit-fixture.ts:27-36`
   (`observation` calls `partyMainBill` when the test names no bill) and `:135-157`
   (`observedGroupSubmitBody` reads `parties.mainBillId`); `testing/draft-command-fixture.ts:141-148`
   (reads `parties.mainBillId`); `testing/serve-line.ts:41` (`setMainBill` to mirror seating). The
   group-submit fixture is imported by 60 server test files and `party-venue.ts`'s `orderForParty`
   (`:251-273`) relies on it; `party-venue.ts` is imported by 122 (counts from
   `rg -l 'group-submit-fixture' apps/server/src` and `rg -l 'party-venue' apps/server/src`).
   Task 6a replaces the fallback in the helpers before anything else removes the main bill.

3. **The main bill's live roles on the server.** Written by `seatTable` (`parties.ts:135`),
   `partyMainBill` (`:191`), `combineParties` (`table-actions.ts:326`), `splitTable` (`:449`),
   `moveBillOnce` (`apps/server/src/move-bill.ts:286`, `:319`), `mergeCheckedBills`
   (`apps/server/src/bill-actions.ts:280`), and the two clearing triggers of
   `packages/db/drizzle/0038_main_bill_release.sql` (last re-created by
   `0097_operator_script_restore_triggers.sql:414-427`). Read by: the implicit merge on Move this
   bill (`move-bill.ts:191-201`, merge arm `:303-312`) and on combining parties
   (`table-actions.ts:262-288`, merge `:305-328`); `refuseMainBillLeaving` (`move-bill.ts:515-535`,
   called at `:222`); `refuseUnsplittableBill` (`table-actions.ts:461-477`, the only other thrower
   of `party.main_bill_stays`, `:476`); the action answers (`TableActionResult`
   `table-actions.ts:67-71`, `CombineResult` `:73-78`, split `:389`, `:454`); and the floor read
   (`TableParty.mainBillId`, `apps/server/src/working-order.ts:8601`, filled `:9017`, `:9066`).

4. **Joining and moving merge bills by default.** The routes treat a missing `bills` as `"merge"`
   (`requireBillChoice`, `till-api.ts:882-886`, used by `moveCommand` `:908-923` and
   `tableActionCommand` `:929-938`); the seat route hard-codes `"merge"` (`:2858-2866`); today's
   floor merges pass `"merge"` (`apps/server/src/floor-today-merges.ts:137-144`). About 70 server
   test files pass a `bills` value (`rg -c 'bills: "(merge|separate)"|bills = "merge"|bills,'
   apps/server/src -g '*.test.ts' -g 'testing/*.ts'`), most as setup. Only those whose two parties
   or bills were both untouched (no payment, not presented, same service mode — `isUntouched`
   `move-bill.ts:549-556`, `serviceModesMatch` `working-order.ts:3980-3990`) actually merged.

5. **The till has no switcher and no ⋮ today.** The **Tab** button (`data-open-drawer`,
   `apps/till/src/screens/till-table-order-screen.ts:2369-2381`, state `drawerOpen` `:1192`,
   `#toggleDrawer` `:2271`) opens a side drawer (`:2405`, `#drawer` `:4034-4046`) holding the bills
   list (`#billsSection` `:4248-4303`, rows `#billRow` `:4334-4395`: Receipt copy, Take payment,
   Cancel and credit), the table's still-to-pay total (`:4259-4262`), the Finish table refusal
   (`:4263-4291`), Bill requested (`#billRequest` `:4306-4332`), Finish table (`:4293-4301`) and the
   **Table actions** panel (`#actionSection` `:5406-5429`, trigger `data-move-split` `:5409-5416`,
   menu `#actionMenu` `:5431-5488`, multi-step pickers `pick`, `transfer-lines`, `split-lines`,
   `split-table`). The only way to change bill is Take payment on an owing row (`:4368-4379`),
   handled by `#onTakePayment` (`till-app.ts:16870-16886`); a paid bill cannot be put on screen.
   About 100 test call sites in 33 files open the drawer (`rg -c 'data-open-drawer'
   apps/till/src -g '*.test.ts' -g '*helpers.ts'`).

6. **Hold on the table screen already does nothing.** `till-tender-pay` draws Hold in its idle pay
   view (`apps/till/src/widgets/tender-pay.ts:1027-1037`), the table screen swallows its
   `park-order` (`#onTenderPark`, `till-table-order-screen.ts:2341-2343`, bound `:4064`), and a test
   pins the swallowing (`till-table-order-screen.test.ts:694`,
   `till-table-order-screen.panel-footer.test.ts:127-150`). The counter's Hold is the same widget's
   (A739 renamed it Park, `action.hold` = "Park", `apps/till/src/i18n/strings.ts:354`).

7. **Full invoice is already on the payment step, twice.** The table screen's pay section offers
   the bill's own **Full invoice** (`#billChoices`, `till-table-order-screen.ts:4138-4168`,
   `choose-bill-invoice` → `#onChooseBillInvoice` `till-app.ts:16940-16969`) and `till-tender-pay`
   draws its own (`#renderInvoiceButton`, `tender-pay.ts:945-956`, `choose-invoice` → the counter's
   `#askInvoiceRecipientForOrder`, `till-app.ts:19109`, `:6323`, which targets the counter's store,
   not the bill). Both are gated on `fullInvoices` (`till-app.ts:10068`), which the server sends as
   `true` (`apps/server/src/till-setup.ts:127`, A948). `docs/backlog.md:2488-2492` records the
   duplicate. `widgets/bill-pay-dialog.ts` has no invoice code. No A802 code is on main
   (`rg -n A802 apps packages` prints nothing); its design is approved and its till entry is planned
   on the find-a-bill page beside Refund (`docs/backlog/fiscal.md:695`, `:707-709`).

8. **No client check for unsent dishes before paying.** The server refuses a payment on a bill with
   unsent dishes, `bill.unsent_dishes` (`apps/server/src/bill-unsent.ts:49-52`), and the till words
   it with the approved `bill_pay.unsent` ("Send or remove the unsent dishes before paying." /
   «Envía o quita los platos sin enviar antes de cobrar.», `strings.ts:1517`, `:3289`; approved in
   `docs/superpowers/specs/2026-10-17-a773-one-editor-design.md:239-245`). The pay controls are
   disabled only by an empty bill or busy (`tender-pay.ts:899`, `:905-907`).

9. **Dropping `parties.main_bill_id` rebuilds `parties`.** Measured: with the column removed from
   `packages/db/src/schema/parties.ts:46-50`, `pnpm --filter @waitron/db db:generate` wrote a
   `__new_parties` create-copy-`DROP TABLE parties`-rename (drizzle-kit 0.31.11 turns the dropped
   foreign key into a table rebuild); the files were deleted and the schema restored afterwards
   (`git status` clean). The two triggers of finding 3 sit ON `working_orders` but their BODIES name
   `parties`, so the rebuild's rename would fail while they exist (`docs/developers/conventions-data.md:1565-1578`);
   they must be dropped first (as `0043_drop_triggers_before_rebuild.sql` did for `0044`'s rebuild of
   `parties`). No other trigger names `parties`: `parties_clear_table_status` was dropped by
   `0180_drop_table_status_trigger.sql:2` (`rg -n -U 'CREATE TRIGGER[\s\S]{0,400}?parties'
   packages/*/drizzle/*.sql` finds only files up to `0139`, all superseded). The rebuild runs with
   foreign keys on (`conventions-data.md:1581-1603`); `parties`' children are `party_tables`,
   `unpaid_departures` (restrict), `order_groups` (two keys), `order_group_events`, `order_drafts`,
   `working_orders`, venue-service's `bill_identities` (no action) and venue-service's
   `party_allergy`, `order_kitchen_notes`, `service_step_completions` (cascade)
   (`rg -n 'REFERENCES .parties.' packages/*/drizzle/*.sql`). So on a box holding any seated party
   the migration fails at `DROP TABLE parties` (a venue reset is needed anyway), and the upgrade
   guard needs a `RESETS` entry like `core/0044_drop_table_bill_pointer`
   (`scripts/migration-upgrade.test.ts:437-439`).

10. **A797 slices 10 and 11 wait on this slice.** Slice 10 builds the handheld's fixed foot "(A803
    builds its contents and quiet Pay)"; slice 11 puts "✎ Bill 2 unsent" on the closed switcher and
    "✎ Unsent" in its list (`docs/superpowers/plans/2026-10-24-a797-device-screens-build.md:253-264`).
    This slice leaves the switcher's row content in one function so slice 11 has one place to add
    its marks (D3).

## Scope

In: retiring `parties.main_bill_id` and every reader and writer; no implicit merge on Move this
bill, Move guests or Join (spec §3.4, §6); Split a table may give away any eligible bill (still one
bill until slice 4); `POST /api/parties/:id/bills` to make an empty bill explicitly; action answers
naming bills explicitly; the server listing a party's bills in number order (A1232); the floor read
naming the bill a table opens on (D7); the till's switcher with + New bill, shown even for one bill;
one ⋮ menu (bill section, then Whole table); the Tab button and drawer gone; no Hold on the table
screen; Pay quiet while this bill has unsent dishes; one Full invoice on the payment step plus a
menu shortcut for an unpaid, unissued bill; EN/ES guides; design-system contract; LOOK; backlog.

Out: Move dishes… and the shared picker (slice 4; Split by item and Transfer items keep their names
and flows); Split a table's multi-bill picker (slice 4); A739's payment window (Cut B is parked,
`docs/backlog/till.md:2355-2368`); any correction of a paid invoice (A802); bill names on paper (slice
2's owner answer 1); A797 slice 10's handheld layout and slice 11's unsent marks.

**Venue reset.** Required: the core migration rebuilds `parties` (finding 9). Its `DROP TABLE
parties` fails on any box holding a `parties` row that another row still names, and every party,
closed ones included, is still named by its bills in `working_orders` and by `bill_identities`,
neither of which cascades; a merged party is also named by `parties.merged_into_party_id`. So it
fails on any box that has ever seated a party (review-1 minor 7; read, and Task 7 confirms it by
the `RESETS` run's own refusal output). Pre-live rule: no data-migration code (root `CLAUDE.md`
§3). The PR's first line says so; the reset needs its own authorisation and is not run by this
slice.

**Spanish.** Seven new till strings and one guide section, all **proposals** (Owner question 1):

| Key | English | Proposed Spanish | Built from |
| --- | --- | --- | --- |
| `table.bill_gone` | `{gone} is no longer at this table. Now showing {shown}.` | `{gone} ya no está en esta mesa. Ahora se muestra {shown}.` | `table.take_over_gone` «Este pedido ya no está en esta mesa.» (`strings.ts:3169`); `{gone}`/`{shown}` are the short labels («Cuenta 2») |
| `table.bill_gone_none` | `{gone} is no longer at this table.` | `{gone} ya no está en esta mesa.` | as above, for when no bill is left to show |
| `table.bill_gone_unnumbered` (added by the 8d review, M5) | `That bill is no longer at this table. Now showing {shown}.` | `Esa cuenta ya no está en esta mesa. Ahora se muestra {shown}.` | as above, for a bill with no number to name (a stale bill the till never read, or one stored with no number) |
| `table.bill_gone_unnumbered_none` (8d review, M5) | `That bill is no longer at this table.` | `Esa cuenta ya no está en esta mesa.` | as above, with no bill left to show |
| `table.bill_count` | `{bill} of {count}` | `{bill} de {count}` | «de» as in «{n} de {total}»-style counts; `floor.unsent_bill` «Cuenta {n}» supplies `{bill}` |
| `table.new_bill` | `+ New bill` | `+ Cuenta nueva` | `table.bills_title` «Cuentas»; «+» as in `kitchen_note.add` «+ Nota para cocina» (`strings.ts:1947`) |
| `table.whole_table` | `Whole table` | `Toda la mesa` | «mesa» throughout (`table.actions_title` «Acciones de mesa», `:3012`) |

Every other word the new controls show is an approved string (D10).

## Owner decisions this plan applies

- **Amendments of 2026-10-18 ~21:40–22:05** (lane C queue, A803 section): 1 Full invoice at the
  payment step (D8); 2 the drop-down even for one bill (D2); 3 one ⋮ with a bill section headed by
  the bill on screen, then "Whole table" (D4); 4 no Hold on the table screen (D6); 5 Pay quiet,
  tappable, explaining with A773's approved sentence, only for THIS bill's unsent dishes (D5).
- **Spec §3.4**: no main bill; joining keeps every bill separate; staff merge afterwards. **§6**: a
  bill moved to a table with guests arrives as a separate bill with no question.
- **Refusals** (root `CLAUDE.md` §3, first bullet): the quiet Pay's explanation is the approved
  refusal, shown in place; it offers no new choice beyond what the screen already shows (send or
  remove the dishes in New order).
- **Owner's test-change rule (2026-10-05)** (`~/waitron-campaign-c/queue.md:236-249`): an
  assertion pinning main-bill selection, merge on arrival, the merge question, the Tab drawer or
  Hold on the table screen may change to check the new behaviour at least as strictly; every such
  change is listed under "Changed test checks". **Still a stop, asked in `questions.md` while other
  work carries on:** a change to a golden hash, `inmutabilidad`, or any other fiscal hash or
  **filing** test; a change to **a guard under `scripts/`**; a change that deletes or weakens a
  check without an equally strict check of the new behaviour; a check of something this slice was
  not asked to change; money totals, VAT, login refusals, permissions or the cash drawer where the
  spec does not spell out the new value. This plan's files in those classes are all in Owner
  question 5, asked at Task 0 (review-1 C1).

## Decisions

- **D1 The server makes a bill only when asked, with one exception.** New
  `createPartyBill(tx, cfg, partyId, command: { expectedPartyRevision: number }):
  Promise<{ billId: string; revision: number }>` in `parties.ts` replaces `partyMainBill`. It takes
  no operator: nothing on a bill records who opened it (`working_orders` has no such column, and an
  empty bill has no lines to credit), as `guardParty` takes none (`parties.ts:453-457`). It checks
  and moves the party's revision (`checkAndBumpParty`, `parties.ts:447`), refuses a closed party
  (`party.not_open`), and inserts an empty open bill on the party in its zone exactly as
  `partyMainBill` does today (`createOpenOrder(..., { zoneId, partyId, existingService: true })`,
  `parties.ts:184-188`), which numbers it (`working-order.ts:1741`). It returns the new revision, as
  `setPartyName` does (`parties.ts:265-273`), so the till can send the next command. The exception:
  a table action that would leave a party with **no bill that is not abandoned** makes one empty
  bill on it in the same transaction (master plan, slice 3 "Interfaces"): Split a table choosing no
  bill (the new party), Split a table taking the staying party's last such bill (the staying party,
  spec §3.7 case 3), and Join/Move guests whose resulting party has none. **Move this bill is not
  among them**: a party left with no bill by Move this bill keeps none, and the till goes back to
  the floor as it does today (D11).
  **One inserting helper, no second revision move (review-1 I5).** The insert itself is a separate
  internal `insertPartyBill(tx: Transaction, cfg: OriginConfig, partyId: string): Promise<string>`
  in `parties.ts`: party zone, `createOpenOrder(..., { zoneId, partyId, existingService: true })`,
  returns the new bill id, and **never touches the party's revision**. `createPartyBill` = refuse a
  closed party + `checkAndBumpParty` + `insertPartyBill`. The table actions call `insertPartyBill`
  inside their own revision move, and the test helpers (Task 6a) call it with the old helper's
  revision handling, so nothing moves the revision twice.
  **The till never makes a bill by itself (review-1 I4).** Only the waiter's **+ New bill** asks
  for one. Opening a table, reading its bills or finishing an action writes nothing; a party with
  no shown bill is drawn with the switcher holding only + New bill (D2, D11). So two tills looking
  at the same table never race on a write, and the only two-till collision is two waiters both
  tapping + New bill on the same revision: the second is refused `party.out_of_date`, shows that
  refusal as every party command does today (`#onTableRefusal`), reloads the party's bills so its
  switcher lists the bill the first waiter made, stays on the bill it showed, and sends no second
  request by itself (Task 9 case).
- **D2 The switcher is drawn by the table screen itself**, not a new widget, as a `wt-row-actions`
  whose `trigger` slot holds the closed label (`wt-row-actions` API: `docs/developers/design-system.md:870`)
  and whose default slot holds one row button per shown bill (`shownBills`,
  `apps/till/src/state/bill-state.ts:23-31`) and **+ New bill**. Closed label: one bill "Bill 1 ·
  €38.50"; several "Bill 2 of 3 · Clint · €54.00"; a paid bill's amount is "Paid"
  (`table.bill_paid`). Each row: the bill's short label, what it owes or "Paid", and, for each
  person with unsent dishes on it, the approved floor sentence ("Ana has an unsent order: 3 items",
  `floor.unsent_owner`/`_one`, `strings.ts:977-978`) from `party.unsentDrafts`. It renders in the
  screen's shadow root (so the existing `data-*` test hooks keep working), in its own module
  `apps/till/src/screens/table-bill-controls.ts` exporting template functions, so the 5,801-line
  screen does not grow. It shows on every device and every width, including handheld (spec §3.5,
  "one layout everywhere"). **+ New bill is always the last item of the open list**, with one bill
  or many (amendment 2, "always in the same place"). A party with **no shown bill** draws the
  switcher closed as "Bills" (`table.bills_title`) with only + New bill in its list, and no New
  order (as today, `#openDraft` makes no draft without a bill, `till-app.ts:11415`). **With no
  party** (`party === null`) there are no party bills and no switcher is drawn (review-1 minor 9).
- **D3 Row content in one function** (`billRowContent(bill, party)`), so A797 slice 11 adds its ✎
  marks in one place.
- **D4 One ⋮ menu** (`wt-row-actions`, icon `kebab`, accessible name the approved
  `table.actions_title` "Table actions" / «Acciones de mesa»), with two `role="group"` sections each
  named by a visible heading, the pattern the More menu uses (`apps/till/src/widgets/till-shell.ts:1198`):
  - **Bill section**, headed with the bill on screen's short label ("Bill 1", "Bill 2 · Clint");
    omitted when no bill is on screen. Items, each only where it applies today: Name this bill
    (any shown bill of this party, paid included — folds A1233); Split by item; Transfer items;
    Merge bills; Move this bill (`#movable`, `till-table-order-screen.ts:5492-5494`); **Comp the
    bill** (moved out of the foot, D16: same `data-discount-bill` hook, `adjust` event and gate
    `#adjustable() && lines.length > 0`, `:2231-2251`); **Full invoice** (D8); **Receipt copy**
    (paid with a receipt, from `#billRow` `:4356-4367`); **Cancel and credit** (presented with a
    receipt and no payments, `:4380-4392`).
  - **Whole table**: Guests; Name the party; Allergies; Bill requested / cancel request (from
    `#billRequest`); Split a table (two or more tables); Join a table; Move guests; Finish table.
  - **With no party** (`party === null`) the ⋮ offers exactly what today's menu offers with no
    party (`:5446-5486`: Move guests, Join a table, Merge bills, Transfer items, Split by item;
    `#movable` is false without a party, `:5492-5494`), the bill items under a bill heading "Bill"
    (`floor.unsent_bill_unnumbered`) and Move guests/Join under "Whole table"; nothing is added or
    removed for that case (review-1 minor 9).
  Every item keeps its existing `data-action` name, label string and event; the ⋮ host carries
  `data-move-split` (the old trigger's hook) so tests that open the menu still find it. Choosing an
  item that needs a picker opens today's step (`pick`, `transfer-lines`, `split-lines`,
  `split-table`) in the action panel (D9); the old `menu` step goes. Focus returns to the ⋮ trigger
  when a window opened from it closes (folds A1234 for both naming windows).
- **D5 Quiet Pay.** "This bill has unsent dishes" = the bill on screen has a line in the screen's
  own New order, or an entry in `party.unsentDrafts` naming it (any owner); another bill's entries do
  not count. While true, every control that starts a payment of the bill on screen — `till-tender-pay`'s
  Cash and Card, the pay ways (Pay items, Contribute, Split equally, `#payWays`
  `till-table-order-screen.ts:4176-4189`), Pay the rest (`data-pay-rest`, `:4098-4105`) and the
  handheld's Pay (`data-pay-sheet`, `:4124-4135`) — is drawn `secondary`, stays enabled (native
  `disabled` false), and on tap shows `billUnsentText` (`apps/till/src/state/bill-unsent.ts:15-17`:
  the bill's label, then the approved sentence) in the pay section's `role="alert"` line and sends
  nothing. `till-tender-pay` gains a boolean property `payQuiet` and an event `pay-quiet-tap`
  (detail `{}`), so the counter, which never sets it, is unchanged. Every other existing gate
  (empty bill, busy, tip, guests, part-paid, presented) is unchanged.
  **The next step is on the screen (review-1 minor 10; root `CLAUDE.md` §3, first bullet).** The
  approved sentence says "Send or remove the unsent dishes". When the dishes are in this waiter's
  own New order, Send and the line controls are right there. When they are another person's
  (`party.unsentDrafts`), the in-place step is A773's existing **Take over draft** button on that
  person's panel (`#otherDraftPanels`, `data-take-over=<draftId>`,
  `till-table-order-screen.ts:3047-3069`): after taking over, the waiter can send or remove them.
  On a narrow screen that panel is on the Review view, as today. No new choice or wording is added.
  **Addendum (2026-10-31, Task 12 review answers, review I1, I2, M3).** The words above stay as the
  decision was made; three things now read differently. (1) "This bill has unsent dishes" = the
  bill on screen has a line in the screen's own New order, or another person's draft of it is
  drawn with dishes in its Take over panel (`otherDrafts`, the list the panels are drawn from).
  `party.unsentDrafts` is no longer read: it changes only on a floor read, so it went on naming a
  dish already removed or cleared elsewhere, leaving Pay quiet with nothing on screen to act on.
  While the bill's draft could not be read (`draftStore` null), nothing is quiet: no unsent dish
  is shown. What then stops a payment is the till's own draft save, which fails first, so no
  request reaches the server, and the till says "Your last change to an order was not saved.
  Open its table to check it." (`table.draft_save_failed`, from code on `main`); the server's
  refusal of a bill with unsent dishes stands behind it (corrected 2026-10-31, fixes review M2,
  its experiment 4). (2) "Every control that starts a payment" is judged per control: a control whose tap
  reopens a payment already sent on this bill is not quiet. That is the pay ways, Pay the rest and
  the handheld's Pay while a bill payment on the bill is being sent or got no answer (A773-1's
  hold), and the handheld's Pay on a presented bill whose whole payment got no answer. Cash and
  Card always start a new payment, so they stay quiet. (3) The keypad's and the card reference's
  Confirm payment are quiet too, for a payment opened before the bill turned quiet.
  **Addendum (2026-10-31, fix review answers, review I1).** (2)'s exception covers reopening the
  payment already sent, nothing after it. The bill payment dialog starts no new payment while the
  bill on screen has unsent dishes under (1)'s rule, however it was opened: once a reopened
  payment's hold has ended (Check again answered, or a balance read shows it answered on another
  device), and when the dishes were read in after the dialog opened. Its Continue and Take payment
  show the dialog's own unsent sentence (`bill_pay.unsent` after the bill's label) and send
  nothing. Checking again a payment still without an answer is not new and is never stopped.
  Before a new preview the dialog saves the New order, as opening it from a Pay that is not quiet
  does. A handheld's presented sheet, in the case run (another person's draft read in after it
  opened), already sends nothing: its pay saves the New order first, and that save fails while
  that draft holds the bill; the server's refusal of a bill with unsent dishes stands behind it.
- **D6 No Hold on the table screen.** `till-tender-pay` gains `parks` (default `true`); the table
  screen sets it `false`, so Hold is not drawn; `#onTenderPark` goes. The counter's Park is
  untouched.
- **D7 The floor read names the bill a table opens on.** `TableParty.mainBillId` is replaced by
  `openingBillId: string | null` — the lowest-numbered bill still owing (open or presented), else
  the highest-numbered shown bill, else null — computed in `readSeatedParties` from the bills it
  already reads (`working-order.ts:9033`, `own` at `:9048`). It is a read for opening the screen
  only: nothing on the server writes to it or falls back to it. This keeps opening a seated table
  at one request (today's main-bill shortcut, `till-app.ts:11002-11015`) and closes A786
  (`docs/backlog.md:2323-2326`), which measured the bills-then-lines round trip at 241–266 ms
  against 113–120 ms. As built, bills read in number order with unnumbered ones last, so with
  nothing owing an unnumbered bill (a fault state, logged as `bill.number_missing`) wins over the
  highest-numbered shown bill (Task 6c review, probe P5: an unnumbered paid bill beside a paid
  Bill 1 → the unnumbered one). The rule differs from the till's `billToOpen`
  (`till-app.ts:696-700`: first owing, else last): with nothing owing, `billToOpen` takes the last
  bill of the bills read, which can be an abandoned one (Task 6c review probe: it opened the
  abandoned bill; `billToOpen` predates this branch), while D7 skips abandoned bills.
- **D8 Full invoice.** On the payment step the bill's own button (`#billChoices`) stays; on the
  table screen `till-tender-pay`'s own Full invoice is not drawn (new property `invoices`, default
  `true`, set `false` by the table screen), which removes the duplicate (Owner question 3) and the
  counter-targeted event from a table. The ⋮ bill section keeps a **Full invoice** shortcut for a
  bill that is owing and has no filed sale (`owing(bill) && bill.invoiceNumber === undefined`),
  dispatching the same `choose-bill-invoice` with the same `{ workingOrderId, revision }`
  (`:4142`), so menu and payment step open one editor. **The payment step's own button takes the
  same gate** (review-1 minor 6): today `#billChoices` draws Full invoice for any owing bill
  (`:4139-4141`), including a presented bill that already has a sale, which the server refuses
  `working_order.not_open` (`apps/server/src/working-order.ts:4384-4392`). That gate predates this
  branch (`git blame -L 4138,4150` on the screen: commits `86782eacf` 2026-10-12 and `ed7e082ca`
  2026-10-16); this slice gates the Full invoice button on `owing(bill) && bill.invoiceNumber ===
  undefined` too, and leaves the receipt-language button's gate as it is. A paid or issued bill
  gets **no** Full invoice item and no request: A802's correction has no till entry on main (finding 7), so the
  guide says that a full invoice for a paid bill is a correction Waitron does not offer yet (Owner
  question 2). Everything gated on `fullInvoices` stays gated.
- **D9 The action panel replaces the drawer.** The side column the drawer used (`.layout`, `:2405`)
  shows the action step only while one is open (`actionStep` other than `closed`), with its Back
  and close as today. The bills list, the table total row and the Tab button go. The table's still
  to pay (`table.still_to_pay`) moves into the foot under this bill's total; the Finish table
  refusal (`:4263-4291`, with Take payment and Record unpaid departure) moves above the foot, shown
  when `finishRefused` as today; Take payment on a bill row goes (the switcher replaces it). The
  Tab button's "to serve" badge goes with it (D17).
- **D10 Strings.** Reused: `floor.unsent_bill` / `floor.unsent_bill_unnumbered` ("Bill {n}" /
  "Bill") for the short label, joined to a bill name with " · " as `unsentText` joins
  (`apps/till/src/widgets/table-details-sheet.ts:18-28`); `table.bill_paid`; `table.bills_title`
  (the switcher's accessible name); `table.actions_title`; every action label; `invoice.full`;
  `table.bill_receipt`; `cancel_credit.action`; `table.finish`; `table.request_bill` /
  `table.cancel_bill_request`; `table.still_to_pay`; `bill_pay.unsent`. New: the three in "Spanish".
  Retired with the code that drew them: `table.bills_question`, `table.bills_merge`,
  `table.bills_separate`, `table.bills_kept_separate`, `table.bill_move_question`
  (`strings.ts:1253-1257`, `:1500-1501`; ES `:3032-3036`, `:3273-3274`), `table.open_drawer`
  (`:1094`, `:2876`), and the `party.main_bill_stays` wording (`apps/till/src/i18n/codes.ts:294-297`).
- **D11 Which bill is on screen** (master plan `A803 switcher`: "If it disappears, choose lowest
  surviving stored number with a visible refresh, or explicitly create an empty bill when none
  survive; never submit to a hidden fallback"; Review focus 4). One rule, `billToShow(kept, read)` in
  `state/bill-state.ts`, used in every place below:
  1. **After this till's Join, Move guests or Split a table**: keep the bill it showed if that id is
     in the answer's `billIds`/the party's bills afterwards; otherwise the lowest-numbered
     owing bill; otherwise the lowest-numbered shown bill. The server guarantees the resulting
     party has a bill (D1), so "none" cannot follow these.
  2. **After this till's Move this bill**: the moved bill has left; the screen shows the rule's
     choice among the bills left. **If none is left, the till goes back to the floor, exactly as
     today** (`#billAfterMove` then `#leaveTable`, `till-app.ts:14893-14902`), and nothing is
     created. The pinned case `till-app-parties.test.ts:3964` "goes back to the floor when the
     moved bill was the party's last" keeps its assertions (it only loses the event's `bills` key,
     a kind-F row) (review-1 I4).
  3. **Whenever a bills read arrives that no longer holds the bill on screen** (review-1 I3: another
     till merged it away, moved it, or paid and closed it; or a floor `openingBillId` that was
     already stale when the table opened): the screen switches **visibly** to the lowest-numbered
     owing bill, else the lowest-numbered shown bill, and shows `table.bill_gone` ("Bill 2 is no
     longer at this table. Now showing Bill 1.") in a `role="status"` line under the switcher
     (`data-bill-gone`, new; cleared on the next switch, + New bill or table change); the
     switcher's closed label changes with it. If no bill is left, the screen shows
     `table.bill_gone_none`, the switcher closed as "Bills" with only + New bill, and no New
     order; **nothing is created by itself** (D1). The check lives in `#loadPartyBills`
     (`till-app.ts:11769-11788`), which today replaces `partyBills` but never re-checks
     `activeTabId`.
  4. **What is never done**: no draft, line or group **write** goes to a bill that is not in the
     latest read. Lines the waiter typed on the vanished bill are **not** moved or re-sent to the
     new bill: the switch goes through the same flush-then-switch body as a waiter's switch
     (`#onSwitchBill`, Task 9), whose flush to the vanished bill is refused by the server
     (`tab.not_open` / `bill.other_party`) and leaves those lines in the existing retained-draft
     panel (`#retainedDraftPanel`, `till-table-order-screen.ts:3017`), as a refused save does today.
     Reads (lines, current orders, balance) may still name the stale id while the bills read is in
     flight: opening a table keeps reading the lines of `openingBillId` in parallel with the bills
     read (that parallel read is what keeps A786's one round trip), and a read cannot land a dish on
     a bill.
  The next draft save names exactly the id on screen (`DraftSync` is built on `activeTabId`).
- **D12 Explicit Merge stays strict.** `mergeBills` (`bill-actions.ts:211-235`) keeps
  `requireUntouchedPair` and `assertServiceModesMatch`; `mergeCheckedBills` loses only its main-bill
  bookkeeping (`:252`, `:258-259`, `:280`). `isUntouched`, `readBillState` and `serviceModesMatch`
  become unused (their only callers were the implicit merges, `move-bill.ts:197-200`,
  `table-actions.ts:280-284`) and are deleted with them; `modesMatch` stays
  (`assertServiceModesMatch`, `working-order.ts:3962`).
- **D13 A stale `bills` key is ignored, not refused.** The routes stop reading `bills`, so an old
  till's key is ignored, as the split route already ignores the old `guests` key
  (`apps/server/src/till-api.table-actions.test.ts:621`). The 400 for a bad `bills` value goes with
  it.
- **D14 Retired error code.** `party.main_bill_stays` (`apps/server/src/errors.ts:481-486`, status
  `till-api.ts:606`, till `codes.ts:294-297`, `TABLE_REFUSALS` `till-app.ts:614`) has no thrower
  once Tasks 2 and 4a land; it is removed everywhere in Tasks 4a and 8d. `scripts/errors-reachable.test.ts`
  checks only that each `errors.ts` is reachable from its barrel (`:7-17`, `:59-`) and
  `scripts/alert-codes.test.ts` checks dashboard incident codes against a source list (`:23-42`,
  `:101-134`); both are run once after the removal.
- **D15 Server list order by number (folds A1232, `docs/backlog.md:2025-2030`).**
  `readBillsOfParties` orders by stored number (null last), then id, instead of opening order
  (`parties.ts:684`); action answers list ids in that order.
  - **D15 addendum (Task 5 review I1; driver's decision 2026-10-31, the most conservative reading;
    an owner choice in the PR).** A departure issues its invoices in opening order; the list's
    number order does not reach invoicing. `recordUnpaidDeparture` re-sorts the list once, at its
    top, by opened time, order number, then id (the order `readBillsOfParties` had before Task 5),
    so its refusals (`firstUnfired`, `holding`), pricing, invoice numbers and chain records, and
    every later per-bill write all read that one sorted list. The test pins the invoice order only
    (`unpaid-departure.test.ts` "A803 departure order: …").
- **D16 The foot: totals, then Pay (review-1 I8; amendment 4; Owner question 7).** On main the
  table screen's foot (`#orderSummary`, `till-table-order-screen.ts:2481-2497`) holds: this bill's
  total; **Comp the bill** (`#billAdjust`, `data-discount-bill`, `:2231-2251`); then the pay section
  (`#paySection`, `:4053-4105`): `till-tender-pay` (Cash, Card, Hold, its own Full invoice), the
  bill's own Full invoice and receipt-language buttons (`#billChoices`), and the pay ways (Pay
  items, Contribute, Split equally, `#payWays`); a part-paid bill shows its still-to-pay, Pay the
  rest and the same choices; a handheld shows one **Pay** button that opens the existing pay sheet
  (`#paySheetButton`/`#paysOnSheet`, `:4107-4135`) plus `#billChoices`. Amendment 4 says the foot
  is "the totals and **Pay** only"; the master plan's `A803 pay scope` says "current bill total,
  table remaining total and Pay only"; spec §3.5 and board 13 say "Pay opens A739's one window".
  A739's window is parked (Cut B, `docs/backlog/till.md:2345-2368`) and is not built here. What
  this slice does:
  - **Totals**: this bill's total, then "Still to pay at this table" (`table.still_to_pay`, D9).
  - **Pay**: on a handheld, unchanged (one Pay button and its sheet, plus `#billChoices`). On wider
    screens, **the pay section stays what Pay is today until A739 replaces it**: Cash and Card,
    the pay ways, Pay the rest, the bill's Full invoice and receipt language. Making every width
    use the handheld's one Pay button and sheet was considered and not taken: the wide table screen
    pays a whole bill through `till-tender-pay`'s tab payment (`confirm-payment`, card outcomes,
    receipt guests, the payment confirmation), the sheet through the bill-payment path; switching
    would move money paths that about 25 till test files pin (`rg -l 'till-tender-pay|confirm-payment|data-open-bill-pay'
    apps/till/src` minus the counter's), which is A739's job, not a footer change.
  - **Hold goes** (D6); **tender-pay's own Full invoice goes** at a table (D8, Owner question 3).
  - **Comp the bill leaves the foot for the ⋮ bill section** (D4): it acts on the bill, is not a
    total or a payment, and keeps its hook, event, label and gate.
  - The Finish table refusal (D9) shows above the foot only after Finish table was refused, as a
    refusal in place (root `CLAUDE.md` §3); it is not part of the foot.
  Task 12's `A803 pay scope` asserts the foot's exact contents, in order, for an open bill wide,
  a part-paid bill wide, and a handheld; Departures has the row.
- **D17 The Tab button's "to serve" count (review-1 I7).** The badge (`#pending()`, lines with
  `servedAt === null`, `till-table-order-screen.ts:2087-2089`, drawn `:2375-2379`) goes with the
  Tab button. The mockups are not silent: board 13 ("And the rest") puts "Sent, To serve, Served,
  courses waiting" in "the panel's Sent box under A773", and that box is on main: `till-sent-orders`'
  summary reads "{ready} ready · {firing} firing · {held} held · {served} served"
  (`table.sent_counts`, `widgets/sent-orders.ts:727-754`), drawn on the table screen by
  `#sentOrders()` (`:2500-`) on every width. So the information stays visible on the table screen
  without a new control: the four pins of the badge (`till-table-order-screen.test.ts:535-539`,
  `:552-561`, `:751`; `.populated-drawer.a11y.test.ts:92`; `.empty-drawer.a11y.test.ts:47`) are
  re-pointed to the Sent summary (kind R): a case with one unserved and one served sent line reads
  "1 … served" and a non-zero not-yet-served count in `[data-sent-panel] .summary`; after the last
  one is served the not-yet-served counts read 0. The badge counted LINES and the summary counts
  QUANTITIES, so the re-pointed cases use one-portion lines, where the two agree (stated in each
  case). The accessible-name case (`:541-549`, the handle's name included its count) is re-pointed
  to the Sent toggle (`data-sent-toggle`), whose name is its title and summary text
  (`sent-orders.ts:740-756`), asserted with `toHaveAccessibleName` as before (kind R).

## Departures from the master plan, and where it no longer matches the code

| Master plan says | Now | Why |
| --- | --- | --- |
| "table order creation requires explicit `billId`" | already true on main | finding 1 (A773-1); this slice removes only the test helpers' fallback (Task 6a) |
| client `createPartyBill(...): Promise<{billId}>` | `{ billId, revision }` | D1: the till must send the party's next revision, as after `setPartyName` |
| "If the resulting party has no bill, create one" (join/move) | also Split a table's new and staying party | D1; spec §3.7 cases 3–4 |
| `TableParty` no longer carries `mainBillId` | replaced by `openingBillId` (read only) | D7: keeps table opening at one request (A786) |
| switcher as a separate component with `bill-switcher.a11y.test.ts` | template functions in the screen's shadow root; a11y file `till-table-order-screen.bill-controls.a11y.test.ts` | D2: keeps every `data-*` hook the 33 drawer-opening test files use reachable, and the screen file from growing |
| menu "Include … Refund where allowed" | Refund stays inside the payment window, per payment (`widgets/bill-pay-dialog.ts:1312`) | a refund is chosen per payment; a menu shortcut would have to open the window at its payment list, which is A739's window (Owner question 4) |
| `A803 invoice entry` in `widgets/bill-pay-dialog.test.ts` | in `till-table-order-screen.panel-footer.test.ts` and `till-app-bill-payments.test.ts` | the dialog has no invoice code; the payment step's Full invoice is the screen's pay section (finding 7) |
| "menu … unpaid Full invoice shortcut" opens the editor | same, plus the duplicate tender-pay button removed on the table screen | finding 7, D8, Owner question 3 |
| Error registry "mappings" for main-bill codes | one code, `party.main_bill_stays` | D14; no code exists for merge on arrival |
| `CombineResult` → `{billIds}` | `combineParties` returns `void`; `combineAt` reads the ids | the explicit Merge never went through `combineAt`; `mergedInto` is empty once the implicit merge goes |
| RED file list includes `party-main-bill.test.ts` "only for explicitly retired behaviour" | rewritten in Task 6c, every case either kept or turned to the new behaviour | Changed test checks |
| Code map: `order-drafts.ts:1247` etc. | re-resolved below | drift since `c9ad7a634` |
| `A803 pay scope`: "footer contains current bill total, table remaining total and Pay only" (amendment 4: "totals and Pay only") | totals, then today's pay section (Cash, Card, pay ways, Pay the rest, the bill's Full invoice and receipt language) on wide screens; handheld unchanged (one Pay and its sheet); Hold and tender-pay's own Full invoice go; Comp the bill moves to the ⋮ | D16: one Pay button opening one window is A739's parked Cut B; the handheld's existing sheet takes a different money path from the wide screen's, so moving every width onto it is A739's work (Owner question 7) |
| "If it disappears … explicitly create an empty bill when none survive" | when none survives, the till shows "Bills" with + New bill and creates nothing until the waiter taps it | D1/D11: "explicitly" read as the waiter's tap; a bill made by just looking at a table would race between tills (review-1 I4) |
| `CombineResult` → `{billIds}` and "remove its implicit-bill-merge mapping consumers" | `SlipsLater.mergedInto` and `enqueueMovedSlipsFor`'s `mergedInto` parameter retired in Task 3b | their only writer was `combineAt`'s implicit merge (`table-actions.ts:224-226`; `rg -n mergedInto apps/server/src`); the explicit Merge queues its own slips (`bill-actions.ts:281`) and is untouched |

## Current code map (main `a90f4f87b`)

| Boundary | Where |
| --- | --- |
| Main bill (server) | `parties.ts:135` (seat), `:159-194` `partyMainBill`, `:201-207` `setMainBill`, `:210-216` `readMainBill`; `packages/db/src/schema/parties.ts:46-50` |
| Implicit merge | `move-bill.ts:191-201`, `:303-312`; `table-actions.ts:262-288`, `:305-328`; helpers `move-bill.ts:549-558`, `working-order.ts:3980-3990` |
| Action answers | `table-actions.ts:67-78`, `:138`, `:193`, `:227`, `:362`, `:389`, `:454`; `move-bill.ts:81-86`; till `api/client.ts:2185-2191`, `:2213-2218`, split `:4665-4668` |
| Routes | `till-api.ts:882-886` `requireBillChoice`; `:908-923`; `:929-938`; seat `:2858-2866`; move/join `:3060-3128`; split-table `:3130-3176`; `GET /api/parties/:id/bills` `:3178-3188`; bill move `:4267-4311`; allergy preview `:4242-4264` |
| Floor read | `working-order.ts:8590-8601` `TableParty`, `:9004-9075` `readSeatedParties` |
| Party bills order | `parties.ts:663-700` `readBillsOfParties` (`orderBy` `:684`) |
| Till client | `api/client.ts:2099-2121` `TableParty` (`mainBillId` `:2110`), moves `:4419-4435`, bill move `:4438-4456`, preview `:4458-4470`, join `:4478-4499`, split `:4650-4677` |
| Till app | `billToOpen` `till-app.ts:696-700`; open `:11002-11015`; seat `:11037-11050`; find-tab follow `:12082`; Move guests answer `:14806-14813`; `#billAfterMove` `:14893-14902`; kept-apart `:15321`, `:15324-15332`; split-table follow `:15401-15409`; `#onTakePayment` `:16870-16886`; invoice `:16940-16969`, `:19109`; `TABLE_REFUSALS` `:614` |
| Table screen | Tab `:2369-2381`; drawer `:2405`, `:4034-4046`; foot `#orderSummary` `:2481-2497`; pay `:4053-4135`; `#billChoices` `:4138-4168`; bills `:4248-4399`; actions `:5406-5494`; merge question `:4860-4932`; split choices `:5029-5037` |
| Merge question elsewhere | `widgets/bill-choice-dialog.ts`; `screens/till-floor-screen.ts:978`, `:1658-1691`, `:2198-2204`; `widgets/held-orders.ts:20-32`, `:220`, `:348-361`, `:381` |
| Shared pay widget | `widgets/tender-pay.ts:303` `fullInvoices`; `:899-943`; `:945-956`; `:1008-1040` |

## Consumer trace (planning run, `a90f4f87b`)

Run each again at the task that touches it; list any new consumer in the ledger.

```
rg -n 'mainBillId|main_bill_id|partyMainBill|readMainBill|setMainBill' apps packages scripts -g '!**/drizzle/**'
rg -n 'bills: "(merge|separate)"|bills = "merge"|requireBillChoice|BillChoiceDetail|bill-choice' apps packages
rg -n '\bmerged\b' apps/server/src/move-bill.ts apps/server/src/table-actions.ts apps/till/src/api/client.ts apps/till/src/till-app.ts
rg -n 'CombineResult|TableActionResult|MoveBillResult|mergedInto' apps packages
rg -n 'party\.main_bill_stays' apps packages scripts docs
rg -n -i 'main bill|main_bill|New orders|Send to|Merge the bills|Keep separate|Juntar las cuentas|cuenta principal' apps packages docs/developers docs/operations
rg -n 'data-open-drawer|drawerOpen|data-move-split|data-take-payment|data-bills\b' apps/till/src
```

| Consumer (non-test) | Task |
| --- | --- |
| `parties.ts` new `insertPartyBill`/`createPartyBill` | 1 |
| `parties.ts` `seatTable`/`partyMainBill`/`setMainBill`/`readMainBill`, `moduleCoreServices` comment | 6c |
| `table-actions.ts` combine merge | 3a |
| `table-actions.ts` answers, split choice, `refuseUnsplittableBill`, D1 creation | 4a |
| `table-actions.ts` `TableActionOptions.bills` | 4b |
| `table-actions.ts` `readMainBill` calls and main-bill writes left after 4a | 6b |
| `move-bill.ts` merge arm, `refuseMainBillLeaving` | 2 |
| `move-bill.ts` `isUntouched`/`readBillState` | 3b |
| `move-bill.ts` `MoveBillOptions.bills`, `MoveBillResult.merged` | 4b |
| `move-bill.ts` main-bill reads and writes (`:286`, `:319`, `SourceParty.mainBillId`) | 6b |
| `bill-actions.ts:209`, `:237-282` main bookkeeping | 6b |
| `working-order.ts` `serviceModesMatch` | 3b |
| `working-order.ts` `TableParty.mainBillId` → `openingBillId` | 6c |
| `moved-slips.ts` `SlipsLater.mergedInto`, `kitchen-print.ts:1880-1893` `mergedInto` parameter, `combineAt`'s loop `table-actions.ts:224-226` | 3b |
| `till-api.ts` `moveCommand` stops reading `bills` | 2 |
| `till-api.ts` `STATUS` `party.main_bill_stays` | 4a |
| `till-api.ts` `requireBillChoice`, `tableActionCommand`, seat route `:2858-2866` | 4b |
| `floor-today-merges.ts:137-144` | 4b |
| `errors.ts:481-486` | 4a |
| `testing/group-submit-fixture.ts`, `testing/draft-command-fixture.ts`, `testing/serve-line.ts`, `testing/bill-venue.ts:466` (prose), new `testing/party-bill-of.ts` | 6a |
| `testing/party-venue.ts:313` (join helper's `bills`) | 4b |
| `packages/bookings/src/testing/fake-core.ts:5` (prose) | 6c |
| `packages/db/src/schema/parties.ts:46-50`, `packages/db/README.md:88-95` | 7 |
| `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json` (captured schema, hashed; not edited) | 7 (the test adapts its expectation; Owner question 5) |
| till `api/client.ts` result types, `bills` parameter made optional and no longer sent, `createPartyBill` | 8a |
| till `api/client.ts` `bills` parameter deleted | 8b |
| till `api/client.ts` `TableParty.mainBillId` → `openingBillId` (rename only) | 8c |
| till `till-app.ts` Join/Move guests/Split follow, `#sayBillsKeptApart` | 8a |
| till `till-app.ts` `#moveCounterWithAllergy(asked, bills)` `:14968-14971` and its caller `:15260` | 8b |
| till `till-app.ts` open path, `#loadPartyBills` vanish rule, `#billAfterMove`, find-tab follow, `TABLE_REFUSALS` | 8d |
| till screen merge question (`#pickTable`, `#onBillChoice`, `#billChoiceDialog`) | 8a |
| till screen `#splitTableBills` | 8d |
| till screen switcher | 9 |
| till screen ⋮ | 10 |
| till screen Tab button, drawer, badge, foot's still-to-pay, finish refusal | 11c |
| till screen Hold, quiet Pay, Full invoice gate, Comp the bill out of the foot | 12 |
| till `screens/till-floor-screen.ts`, `widgets/held-orders.ts`, `widgets/bill-choice-dialog.ts` | 8b |
| till `i18n/codes.ts:294-297` | 8d |
| till `i18n/strings.ts`: each retired key goes in the task that removes its last user (`rg` for the key confirms); new keys in 8d (`table.bill_gone*`), 9, 10 | 8a, 8b, 8d, 9, 10, 11c |
| till test helpers `test/bill-pay-app.ts:82`, `test/allergy-app-fixture.ts:133`, `:167`, `screens/till-table-order-screen.panel-footer.test-helpers.ts:20` (`mainBillId`) | 8c |
| till test helper `test/bill-pay-app.ts` (opens the drawer) and every other helper in `rg -l data-open-drawer apps/till/test apps/till/src -g '*helpers.ts'` | 11a/11b |
| `scripts/behavioural-triggers.test.ts:121-131`, `:158-159`, `:1544-1590`; `scripts/migration-upgrade.test.ts` `RESETS` | 7 (Owner question 5) |
| Guides `apps/server/src/guide/{en,es}/table-service.md` (`{#bill-names}` EN `:235-239`, ES `:247-251`; `{#full-invoice}`; `{#portions}`) | 14 |
| `docs/developers/conventions-data.md:3512-3513`, `:3570`; `docs/operations/a760-migration-squash-inventory.md:126-127` | 7, 14 |

Counts at `a90f4f87b`: server non-test files 9 (6 product, 3 test helpers) plus 2 route/registry
files; server test files naming the main bill 19 (`rg -l 'mainBillId|main_bill|partyMainBill|setMainBill|readMainBill'
apps/server -g '*.test.ts'`); server files passing a literal `bills` value 61, at 196 sites
(`rg -c 'bills: "(merge|separate)"|bills = "merge"' apps/server/src -g '*.test.ts' -g 'testing/*.ts'`,
review-1 re-count), plus `bills,` shorthand sites; till non-test files 3 plus 3 test helpers; till
files naming `mainBillId` 73 (`rg -c mainBillId apps/till/src apps/till/test | wc -l`); till files
carrying the merge question 23 (`rg -l '"merge"|"separate"' apps/till/src`); till files opening
the drawer 37, at 105 sites (`rg -c data-open-drawer apps/till`); db/scripts 3; guides 2;
developer docs 3.

## Guard suites

Each command separately, each exit status checked, a nonzero **Tests** count required.

- **S:** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`,
  then `pnpm exec vitest run scripts/two-file-foreign-keys.test.ts scripts/column-vocabulary.test.ts scripts/apply-migrations-callers.test.ts scripts/live-subscriptions.test.ts scripts/module-seams.test.ts`,
  then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- **H2 (unedited):** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **F (unedited, plus H2):** `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
- **Filing (edited only as Owner question 5 says):** `pnpm --filter @waitron/server exec vitest run src/move-merge.filing.test.ts src/order-portions.filing.test.ts`.
- **G:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- **Words and codes:** `pnpm exec vitest run scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- **Till types:** `pnpm --filter @waitron/till typecheck`; **server types:** `pnpm --filter @waitron/server typecheck`.

A red F, H2 or Filing case, or any change to the F/H2 files, is a stop: keep the output, revert the
task's uncommitted change, write a decision request. `git diff a90f4f87b -- packages/fiscal-verifactu apps/server/src/split-bill.fiscal.test.ts apps/server/src/till-api.fiscal-sale-paths.test.ts apps/server/src/transactional-series.test.ts apps/server/src/bill-payments.test.ts apps/server/src/bill-payments.card.test.ts`
prints nothing at every task's end. The two Filing files and the three `scripts/`-level files of
Owner question 5 change only as that question's items say, and `git diff a90f4f87b -- <file>`
of each is compared with the item at every task that touches it.

`scripts/schema-constraints.test.ts` is NOT touched: its foreign-key list is checked one way
("a constraint nobody listed passes unseen", `:12-14`) and it lists no `parties.main_bill_id` key
(`rg -n '"parties"' scripts/schema-constraints.test.ts` prints only keys whose parent is
`parties`, at `:49`, `:220`, `:223`, `:227`, `:231`, `:232`, `:332`, `:359`).

## Changed test checks

The owner's rule (2026-10-05): an assertion may change without asking only where it pins behaviour
this slice deliberately changes, and then to check the new behaviour at least as strictly; never
deleted, never loosened. Kinds: **B** behaviour the spec or an amendment changes (cite it); **R**
a retired control or field re-pointed at the control that now holds the same thing, assertion
otherwise unchanged; **W** a whole-shape or list pin losing/gaining an entry with every other value
unchanged; **S** setup re-expressed through the explicit command, every `expect` byte-identical;
**F** a fixture or request losing or renaming a field the type no longer has, same value.
**Q5** marks a row that is also an item of Owner question 5 (a filing test, a `scripts/`-level
guard, or a deleted check): it is built on the default and the PR cannot land until it is answered.
**A check covering money totals, VAT, permissions, fiscal filing or anything this slice was not
asked to change, that is not on this list, is a STOP**: write it in the ledger and the PR, revert,
ask.

Every changed check goes in the receipt attached to the PR with file:line, kind, before, after,
the spec/amendment line, and the red and green output. Expected from reading (each confirmed at its
task's red run; a red assertion not on this list that is not kind B/R/W/S/F under the rule is a stop):

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `apps/server/src/party-move-bill.test.ts` cases at `:321`, `:356`, `:374`, `:894`, `:1065`, `:1306` (merge into the main bill by default / with conditions / kitchen told once) | B | merged into the destination's main bill → arrives as its own bill with the destination's next number; kitchen told of the move only. `:356` and `:374` (paid-towards and other-service-mode destination) were already green: retitled to "arrives as its own bill with the next number when …", the "merges only bills of one service mode" comment deleted, and each gains `numbersOf(v, luis.partyId)` → `[[luis.tabId, 1, null], [checkId, 2, null]]`; their `mainBillId` lines stay for 6b | spec §6 bullet 2, §3.4 | 2 |
| `party-move-bill.test.ts:458` (`party.main_bill_stays`), `:765` (only an unpaid main bill moves last) | B | refused → the bill moves; the source keeps its other bills | spec §3.4 ("all equal") | 2 |
| `party-move-bill.test.ts` `:827`, `:941`, `:1203`, `:292` (main bill of the new/receiving party) | B | `mainBillId` checks → the moved bill is in the destination's bills with its number | §3.4 | 2 (answers), 6b (checks of `parties.mainBillId`) |
| `apps/server/src/till-api.move-bill.test.ts:1155` (merges by default, `party.main_bill_stays`), `:368` | B | as above | §6 | 2 |
| `till-api.move-bill.test.ts:976` (bad `bills` → 400) | B | "a `bills` key, of any value, is ignored": the same request answers 200 and the bill arrives separate | D13 | 4b |
| `apps/server/src/bill-identities.test.ts:314`, `:334`, `:821` (move with Merge the bills) | B | the arriving bill takes the next number instead of merging | §6 | 2 |
| `apps/server/src/order-drafts.db.test.ts:4863` (moveBill merge) | B | the arriving bill and its draft stay separate; the recalled line's `slot: 3` (renumbered by the merge) → `slot: 2`, the slot it was given before the move | §6 | 2 |
| `apps/server/src/bill-editing.bill-moves.test.ts:240` ("refuses a merge even with a common foreign editor": a move asked to merge refused `draft.taken_over`, no row changed) | B (found at Task 2's red run) | the same move succeeds as `{partyId, billId: moved, merged: false}`; the moved bill's editor state, its draft row (now under the destination party, owner kept) and the destination bill's editor state are each pinned with `toEqual`/`toMatchObject`; then explicit `mergeBills` of the two still refuses `draft.taken_over` with the full conflict, no row changed | spec §6 bullet 2, §3.4 bullet 2 | 2 |
| `apps/server/src/order-kitchen-note.moves.test.ts:194` (`it.each` merge/separate: `result.merged` was `bills === "merge"`) | B (found at Task 2's red run) | both rows `expect(result).toEqual({ partyId: target, billId: incoming, merged: false })`; the two note assertions unchanged | spec §6 bullet 2; D13 | 2 |
| `apps/server/src/party-arriving-dishes.test.ts:716` (counter order merged into the main bill: answer `billId: main, merged: true`, Tarta's line on the main bill) | B (found at Task 2's red run) | answer `{partyId, billId: counter, merged: false}`; the groups assertion unchanged; the first bill's lines are exactly Burger/Vino as before; Tarta's line, in group 2, is on the counter bill, which is now the party's | spec §6 bullet 2 | 2 |
| `party-arriving-dishes.test.ts:972` (now `:975`; HOLD ticket names the main bill the moved bill merged into) | B (found at Task 2's red run) | answer `toEqual {partyId, billId: moved, merged: false}` (was `toMatchObject`); the one HOLD ticket's header names the moved bill at the destination table (`head("Aviso 8", ana.tabId)`), every other line unchanged | spec §6 bullet 2; D13 | 2 |
| `apps/server/src/print-problems.test.ts` helper `transferDish` (`:1320`, used by 9 cases of "a printing problem whose dishes move to another bill") | S, plus B for the helper's own answer check (found at Task 2's red run) | setup: the move is followed, in the same transaction, by explicit `mergeBills(tx, cfg, to.tabId, billId, …)` (imported as `mergeBillsCommand`, since the file has its own `mergeBills` join helper); the helper's `expect(moved)` goes from `{billId: to.tabId, merged: true}` to `{billId, merged: false}` (B); every `expect` in the 9 cases byte-identical. Deletion control: without the merge, 7 of the 9 fail on their `problemsOf`/`stationSees` assertions; the 2 that assert no failure travels ("…at a station none of the moved dishes go to", "…only dishes that stayed behind") pass either way | spec §3.4 bullet 2 "staff merge afterwards", §6 bullet 2 | 2 |
| `apps/server/src/sent-order-number.test.ts:400` (a sent counter order merged on arrival keeps its sent-under number) | S, plus B for the move's answer check (found at Task 2's red run) | setup: the move is followed, in the same transaction, by explicit `mergeBills(tx, cfg, tabId, counter, …)`; the answer check goes from `toMatchObject({billId: tabId, merged: true})` to `toEqual({partyId, billId: counter, merged: false})` (B); the `kitchenItems` assertion byte-identical. Deletion control: without the merge, that assertion fails (only Paella on the table's bill) | spec §3.4 bullet 2, §6 bullet 2 | 2 |
| `apps/server/src/till-api.allergy-move.test.ts:553` (`it.each` merge/separate: answer `billId`/`merged` followed `bills`) | B (found at Task 2's red run) | both rows answer `{partyId, billId: moved, merged: false}`; the allergy assertions unchanged | spec §6 bullet 2; D13 | 2 |
| `apps/server/src/party-table-actions.test.ts` `:315`, `:977`, `:1328`, `:1550` (combine/join merges main bills, `mergedInto`) | B | every bill stays separate, numbered by slice 2's rule | §3.4 bullet 2 | 3a |
| `party-table-actions.test.ts` `:349`, `:366`, `:383`, `:641`, `:659`, `:1004` (which main bill survives) | B | main-bill assertions → each bill's party, status and number | §3.4 | 3a (bills), 6b (`mainBillId`) |
| `party-table-actions.test.ts:1101`, `:1124`, `:1138`, `:1183` (split takes chosen bill as main; new empty main bill; presented; `party.main_bill_stays`) | B | chosen bill moves with its number 1 at the new party; no bill chosen → one empty bill created (D1); choosing the bill that was main succeeds | §3.4, master plan "now allowing any eligible bill" | 4a |
| `party-table-actions.test.ts:709-713` (opening order `[ana, luis, second]`) | B | number order `[luis, ana, second]`; as built, each tuple also gained its `billNumber` | A1232 (`docs/backlog.md:2025-2030`), D15 | 5 |
| `parties.test.ts:1127` (merged parties), `bill-identities.test.ts:781` (and its retitle), `bill-identities.test.ts:833` (an abandoned bill) | B (found at Task 5's red run) | `parties.test.ts:1127`: abandoned tab first → last, each tuple gaining its `billNumber`; `bill-identities.test.ts:781`: `[anaSecond 2, luis 1]` → `[luis 1, anaSecond 2]`, retitled from "… while the list keeps its opening order" to "… and is listed after the party's own Bill 1"; `:833`: the abandoned bill moves from second to last | A1232 (`docs/backlog.md:2025-2030`), D15 | 5 |
| `apps/server/src/order-drafts.db.test.ts` `merge()` helper `:3418-3427` and its users `:3460`, `:3530-3547`, `:3551`, `:3586`, `:3613`, `:4480` | B | joins keep both bills; Sam's `billNumber` stays 2 only if the receiving party's own bill stays 1 — confirm at red | §3.4 | 3a |
| `order-drafts.db.test.ts:1048` (draft goes to its bill while another is main) | B | same assertion, "while another bill has a lower number" | §3.4 | 6c |
| `apps/server/src/table-actions.refund-pending.test.ts:248` (main bills merge, `merged: true`), `:194`, `:223` (`it.each` over merge/separate) | B | merge row → separate | §3.4 | 3a |
| `table-actions.refund-pending.test.ts:177`, `:306` (answer shapes) | W | shapes → `billIds`/`billId` | master plan interfaces | 4a |
| `apps/server/src/bill-identities.test.ts:595` (join with Merge the bills), `:167` (main bill after all paid) | B | separate numbering; `:167` → no main bill, `openingBillId` | §3.4, D7 | 3a, 6c |
| `apps/server/src/move-merge.test.ts:493` ("the main bill of the party taken in, which merges") | B | both bills kept; kitchen told of the moved bills' dishes | §3.4 | 3a |
| `apps/server/src/move-merge.filing.test.ts:300-331`, `:333-` ("parties combined, bills merged → one registro (H2)", "tables joined across parties, bills merged"), and its helper's `bills: "merge" as const` (`:215`) | **S, Q5 item 1** | the combine no longer merges, so the setup adds an explicit `mergeBills(tx, cfg, intoTab, fromTab, …)` in the same transaction after `moveGuests`/`joinTables`, and the `:215` property goes; **every existing `expect` byte-identical**. Before this branch `:339` did not check that one sale covers both bills (its two sale counts also hold when nothing merges); the branch adds `expect(await orderState(fromTab)).toMatchObject({ status: "abandoned" })`, `registroCount(intoTab)` 1, `registroCount(fromTab)` 0 and `filedSaleTotal(intoTab)` "3.50" (café 1.50 + agua 2.00), which fail with its Merge bills step deleted. The additions are built on the default, pending the owner's yes | §3.4 "staff merge afterwards" | 3a |
| Task 3a's planned rows, as built | B / S | `party-table-actions.test.ts:316`, `:994`, `:1350`, `:1572` (B): `merged: false`, the incoming bill open on the receiving party with its own lines and `numbersOf` `[[receiving, 1], [incoming, 2]]`; `:1350`'s MOVED notice is on the incoming bill itself. `table-actions.refund-pending.test.ts:248` (B): both bills open on the receiving party, each "3.00" total and outstanding (each bill's own Caña; the merged total was "6.00"); the refund's bill unchanged as before. `bill-identities.test.ts:599` (B): no bill abandoned; incoming bills numbered 2 and 3. `move-merge.test.ts:514` (B: a notice goes out only when an order loses a table or a place name, or changes number (`kitchenToBeTold`, `kitchen-print.ts:1563-1579`), and a join does neither): notices `toEqual(before)`, both incoming bills open on the receiving party. `order-drafts.db.test.ts` `merge()` helper `:3420` (S): join, then `mergeBills(into.tabId, from.tabId)` in the same transaction; `:4494` byte-identical under it. Its user at `:3600` ("answers the first result when the draft was added into its owner's draft on the target and discarded") passes either way: it passes with the merge step deleted. `move-merge.filing.test.ts:300`, `:339` (S, Q5 item 1): as the row above | spec §3.4 bullet 2, §6 | 3a |
| `order-drafts.db.test.ts:3474`, `:3565`, `:3627` (draft details of the merge-on-join, under the S helper) | B (found at Task 3a's red run) | join-then-Merge moves the incoming draft to the receiving party before Merge bills discards it: the discarded draft's row is on the receiving party at revision +2 (was the closed party, +1); saving it on the receiving party refuses `draft.out_of_date` (was `draft.not_found`); the retried submission's refusal names revision +3 (was +2); Sam's bill is number 3 (was 2: the merged-away bill had already taken 2, numbers are never reused — the plan row's "confirm at red") | spec §3.4 bullet 2 "staff merge afterwards"; slice 2's numbering | 3a |
| `party-table-actions.test.ts:915` ("adds the operator's draft on the moving party to their draft on the receiving one") | B (found at Task 3a's red run) | two drafts on the receiving party, each on its own bill with its own line (`{partyId, billId, ownerId, items}` per draft) | spec §3.4 | 3a |
| `till-api.table-actions.test.ts:111` ("merges the bills by default", planned for 4a) | B (red at 3a) | the default request answers `merged: false`; both bills open | §3.4 | 3a |
| `bill-identities.test.ts:689` ("after a join … hold no number twice") | B (found at Task 3a's red run) | no abandoned bill in the list (was the merged-away one); the numbers are 1–5 (was 1–4) | §3.4 | 3a |
| `move-merge.test.ts:482` (join; kitchen told of the merged-in dish only) | S (found at Task 3a's red run) | join, then `mergeBills` in the same transaction (local `mergeInTx`); every `expect` byte-identical. Deletion control: without the merge, its notices assertion fails | §3.4 bullet 2 | 3a |
| `move-merge.test.ts:866` (row 7: a join with bills merging prints a MOVED slip From Mesa 74) | B (found at Task 3a's red run; S does not hold: after the join, Merge bills prints From "Mesa 73, 74") | the join prints nothing and each order keeps its number; Merge bills afterwards prints the merged-in order's dishes From and To "Mesa 73, 74" (as row 16a, a Merge bills at one party) | §3.4 bullet 2; MOVED-slip rule §3 (c) | 3a |
| `parties.test.ts` helper `merge()` `:103` (6 cases) | S (found at Task 3a's red run) | the join or move is followed, in the same transaction, by `mergeBills(into.tabId, from.tabId)`; every `expect` byte-identical. Deletion control: without it, 3 cases fail (`:974` absorbs …, "lists the absorbed party's bills …", "follows a chain of merges …"); the other 3 pass either way | §3.4 bullet 2 | 3a |
| `parties.test.ts:1244` (a merged party's invoiced bill; joined over HTTP) | B (found at Task 3a's red run) | the presented bill's `billNumber` 2 → 3 (the closed party's own bill is no longer merged away, so it takes 2); every other value of the object, and every money, invoice and filing check, unchanged | §3.4; slice 2's numbering | 3a |
| `current-orders.test.ts:1538`, `order-groups.test.ts:490`, `:2375`, `receipt-guests.test.ts:145` (join used to merge the bills as setup) | S (found at Task 3a's red run) | join, then `mergeBills` in the same transaction (`receipt-guests`' `joinOther` gains an optional `mergeInto`); every `expect` byte-identical. Deletion control: each fails without the merge | §3.4 bullet 2 | 3a |
| `print-problems.test.ts` helper `mergeBills(v, source, destination)` `:1806` (7 cases) | S, plus B for the helper's own answer check (found at Task 3a's red run) | join, then `mergeBillsCommand(destination.tabId, source.tabId)` in the same transaction; the helper's `expect(result)` `merged: true` → `false` (B); every case `expect` byte-identical. Deletion control: without the merge, 4 of the 7 fail; the 3 that check a merged-in failure does NOT come back pass either way | §3.4 bullet 2 | 3a |
| `floor-today-flatten-api.test.ts:466`, `:495`, `:548` (floor and till joins with `bills: "merge"`; notices filed on the bill merged into) | B (found at Task 3a's red run; HTTP, so no same-transaction merge) | `:466`: one notice, Long table's own dish on its own bill (was two on it); Bar's bill open. `:495`: the one notice is on Long table's own bill (was the bill it merged into). `:548`: no notice (Bar's dish stays on Bar's bill at Bar); Bar's bill open | §3.4 bullet 2 | 3a |
| `attendance-draft-merge-routes.test.ts:190`, `:265`, `:341` (a combine's merge discarded a draft, so it took an attendance snapshot) | B (found at Task 3a's red run) | the combine now writes no draft event and no attendance fact (pinned), and a refusing recorder no longer refuses it (200); then Merge bills over HTTP (`/api/bills/:id/merge`, helper `mergeAfter`) carries every original check: the one `discarded` event, its `draft` fact at the trusted instant (filtered by `source: "draft"`, as the file's direct-merge case does) plus the merge's two `order` facts pinned, the "Elsewhere" location re-read, the refusal rollback `toEqual(before)`, and no facts without capture | §3.4 bullet 2 | 3a |
| `bill-editing.table-actions.test.ts:216`, `:242`, `:266` (`it.each` join/move/combine: the implicit merge's editor authority and service mode) | B (found at Task 3a's red run) | the action asked to merge answers `merged: false` and keeps both bills (editors and drafts pinned); then `mergeBills` of the pair refuses `draft.taken_over` with the full conflict, no row changed (`:216`, `:242`, after the source's mode changed and relocation), or, authorised, succeeds and abandons the source bill (`:266`) | spec §6 bullet 2, §3.4 bullet 2 | 3a |
| `bill-editing.table-actions.test.ts:233`, `:263`, `:288` (`it.each` join/move/combine, 9 answers: `toMatchObject({ merged: false })`) | W (found at Task 4a's red run) | `toEqual` of the whole answer, `{partyId: into, billIds: [into, from]}` (helper `keptApart`), or `undefined` for combine; the editor, draft and status checks unchanged | master plan interfaces | 4a |
| `bill-identities.test.ts:534`, `:608`, `:645` (Split and Join answers) | W (found at Task 4a's red run) | `:534` the split answer's bill as `billId`, same value (was `mainBillId`); `:608` `result.merged` `toBe(false)` → the whole answer `{partyId, billIds: [ours, theirs' two]}` in `toEqual`; `:645` `mainBillId` `toBeNull()` → the whole answer `{partyId, billId: third}`; every `numbersOf` and `allocationsOf` check unchanged | master plan interfaces | 4a |
| `table-actions.refund-pending.test.ts:211`, `:239`, `:270` (join answers `{partyId, mainBillId, merged: false}`) | W (found at Task 4a's red run) | `{partyId, billIds}` with every bill the party keeps, in number order, in `toEqual`; every `charges`, `expectPendingFigures` and payment check byte-identical | master plan interfaces | 4a |
| `till-api.today-joins.test.ts` helper `mainBill(p)` (`:689`; used at `:716`, `:922`, `:944`, `:972`) | W (found at Task 4a's red run) | `onlyBill(p)`: the party's one bill that is not abandoned, asserting there is exactly one (was `parties.mainBillId`, which could be null); answers `{partyId, billIds: [onlyBill(p)]}`, split `{partyId, billId: onlyBill(...)}` | master plan interfaces | 4a |
| `party-table-actions.test.ts` Move and Join answers (`:270`, `:333`, `:365`, `:383`, `:401`, `:434`, `:658`, `:678`, `:964`, `:1005`, `:1036`, `:1361`, `:1688`; the combine answer `:1589`) | W (found at Task 4a's red run) | `{partyId, mainBillId, merged: false}` → `{partyId, billIds}` in `toEqual`, in number order; the combine answer → `toBeUndefined()` plus `partyRow(luis).mainBillId` carrying the value the answer held; where a title promises something about the main bill, its `partyRow(...).mainBillId` check stays | master plan interfaces | 4a |
| `merged: false` in 39 `toEqual` answers in 9 files: `bill-editing.bill-moves.test.ts` (1), `order-drafts.db.test.ts` (1), `order-kitchen-note.moves.test.ts` (1), `party-arriving-dishes.test.ts` (2), `party-move-bill.test.ts` (18), `print-problems.test.ts` (1), `sent-order-number.test.ts` (1), `till-api.allergy-move.test.ts` (2), `till-api.move-bill.test.ts` (12) | W (found at Task 4b's red run) | the `merged: false` entry goes; every other value of each `toEqual` unchanged | D13 | 4b |
| `till-api.move-bill.test.ts:411`, `bill-identities.test.ts:321`, `:346` (`toMatchObject` with `merged: false`) | W, stricter (found at Task 4b's red run) | `:411` `toMatchObject({partyId, billId, merged: false})` → `toEqual({partyId, billId})`; `:321`, `:346` `toMatchObject({merged: false, billId})` → `toEqual({partyId: to.partyId, billId})` | D13 | 4b |
| `party-move-bill.test.ts:831`, `:957` (`expect(result.merged).toBe(false)`) | B (found at Task 4b's red run) | `expect(Object.keys(result).sort()).toEqual(["billId", "partyId"])` | D13 | 4b |
| `till-api.allergy-move.test.ts:213` (the answer's type cast) | F (found at Task 4b's red run) | the cast loses `merged: boolean`; no other change | D13 | 4b |
| `apps/server/src/order-portions.filing.test.ts:1159` (`bills: "separate"` passed to `moveBill`) | **F, Q5 item 2** | the property line goes; no other line; no `expect` changes ("separate" is now the only behaviour) | D13 | 4b |
| `apps/server/src/split-bill.test.ts:539` (`bills: "separate"`), `:1019` (`bills: "merge"`) | F | the property lines go, no other change — provided both files' cases are green at Task 3a's run (where `bills: "merge"` stops merging); if `:1019`'s case goes red there, it is a stop (this file was meant to stay unchanged) | D13 | 4b |
| every other `bills: "merge" \| "separate"` property in the 61 server files | F | property deletion only; a file whose behaviour changed was handled, with its own row, in Tasks 2–3a | D13 | 4b |
| `apps/server/src/moved-slips.test.ts:108`, `:116` (`inner.mergedInto.set(...)`, `outer!.mergedInto.get(...)`) | **B, Q5 item 6a** | the two lines go with the map they set and read; the case's other checks (the inner call gets the outer's slips; the kitchen is told once) stay. As built: the `notABill`, `into` and `outer` locals and `outer = slips;` go with them (unused otherwise), and the title loses "writes into them" (nothing is written into the token now) | master plan "remove its implicit-bill-merge mapping consumers" | 3b |
| `party-table-actions.test.ts:1591` (the combine answer's `mergedInto: new Map()`, a Task 3a row) | W (Task 3b) | the key goes with `CombineResult.mergedInto`; `merged: false` and `mainBillId` unchanged in the same `toEqual` | master plan "remove its implicit-bill-merge mapping consumers" | 3b |
| `apps/server/src/till-api.table-actions.test.ts:97`, `:111`, `:156`, `:172`, `:243`, `:509`/`:536`/`:691` | B, W | answers `{partyId, billIds[, zoneRevisions]}`, split `{partyId, billId}`; "merges by default" → "keeps every bill"; `party.main_bill_stays` rows → those splits succeed | §3.4, master plan interfaces | 4a |
| `till-api.table-actions.test.ts` bad `bills` value → 400 | B | ignored, answered 200 | D13 | 4b |
| `apps/server/src/till-api.today-joins.test.ts:201`, `:630-652`, `:696`, `:712-717`, `:908`, `:923`, `:949` | B, W | answer shape; the default-merge join keeps bills | §3.4 | 4a |
| `apps/server/src/floor-today-flatten.test.ts:430-431` (split with no bill gives a main bill) | B | gives one empty bill (D1) named in the answer | D1 | 4a |
| `apps/server/src/till-api.zone-closed.test.ts:310-318` (split answer's `mainBillId`, then its status read) | W | `billId`, same status read | master plan interfaces | 4a |
| `till-api.zone-closed.test.ts:327`, `:474` (setup writes `parties.mainBillId = null` before deleting the bill) | S | the write goes with the column; the bill deletion that follows stays; every `expect` identical | §3.4 | 6c |
| `till-api.zone-closed.test.ts:382-385` (after the refused first order, `parties.mainBillId` is still null: "without creating a bill") | B | re-pointed to the bills themselves: the party has no `working_orders` row after the refusal (`select … where party_id`) → `[]`, beside the existing `orderRows()` before/after check | §3.4 | 6c |
| `apps/server/src/order-kitchen-note.moves.test.ts:234` (`result.mainBillId!` of a join) | W | the bill from the answer's `billIds` that the case means (the receiving party's own) | master plan interfaces | 4a |
| `order-kitchen-note.moves.test.ts:369` (`partyMainBill(tx, v.cfg, into.partyId, "moved")`) | S | `insertPartyBill(tx, v.cfg, into.partyId)` (D1: no revision move, as `"moved"`); every `expect` identical | D1 | 6c |
| `apps/server/src/print-problems.test.ts:1808` (`mainBillId: destination.tabId` in an expected object) | W | `openingBillId` or `billIds`, whichever shape the object is; confirm at red | D7 / interfaces | 4a or 6c (where it goes red) |
| `apps/server/src/adjustments-report.test.ts:123`, `attendance-draft-events.test.ts:59`, `:96`, `till-api.drafts.test.ts:183` (read `parties.mainBillId` to find the party's bill) | S | `firstOpenBillOf(tx, partyId)` (Task 6a); every `expect` identical | §3.4 | 6c |
| `apps/server/src/tabs.test.ts:1069` (`party: objectContaining({ mainBillId: tabId })`) | W | `openingBillId: tabId` | D7 | 6c |
| `apps/server/src/party-main-bill.test.ts` (all main-bill cases, `:75-226`, `:235-285`, `:343-466`) | B | rewritten case by case: seating opens Bill 1 named in `openingBillId`; a send names its bill; after paying, `createPartyBill` makes the next bill; a send to a paid/other/stale bill refuses with rows compared before/after (kept); every non-main-bill case unchanged; `:157` and `:356-358` keep "moves the party revision once" | §3.4, Review focus 4 | 6c |
| Cases in any group-submit/draft-command user whose sent bill changes at Task 6a (red or not) because the main bill was null while another open bill existed (the old helper made a new bill; the new one picks the existing lowest-numbered open bill) | S | the case names the bill the old helper would have made: its setup calls `insertPartyBill` and passes that id; every `expect` byte-identical | D1, I5 | 6a |
| `apps/server/src/current-orders.test.ts:1279` ("…across a paid bill, a split one and a later one": its mains, sent with no bill after the first bill was paid, landed on the split bill, so the case read two bills, not three) | S | the setup makes the later bill with `insertPartyBill` and sends the mains to it (the file's `group()` helper gains an optional `billId`); every `expect` byte-identical | D1, I5; Task 6a review I1 | 6a |
| The seven `expect((await partyRow(…)).mainBillId).toBe(<the bill the helper made>)` assertions that rest on Task 6a's kept `setMainBill`: `parties.test.ts:662`, `:767`; `party-move-bill.test.ts:774`, `:1218`; `party-table-actions.test.ts:682` (two cases), `:1181` | B | decided at Task 6c (the review offers, as an example: the order's bill is the party's, open, and numbered next after the party's existing bills, read with `numbersOf`) | §3.4; Task 6a review M3 | 6c |
| **As built at Task 6c** (lines at `e31ede59e`). `openingBillOfParty(v, partyId)` is a new `testing/party-venue.ts` helper: the floor row's `party.openingBillId` for the party's tables (D7). Every red run below failed only on a `mainBillId` read; none on money, VAT, permissions or filing | | | | |
| `party-main-bill.test.ts:78`, `:93`, `:98` (seated/paid/next main bill) | B | `partyRow.mainBillId` `toBe(tabId)` / `toBeNull()` / `toBe(dessert)` → the floor's `openingBillId` `toBe(tabId)` / `toBe(tabId)` (the paid bill, highest shown) / `toBe(dessert)`; describe "the main bill" → "the bill a table opens on"; `:86` retitled "stays the paid bill once it is paid, and moves to the new, empty bill …" | D7 | 6c |
| `party-main-bill.test.ts:111`, `:115` (presented, next order) | B | `toBeNull()` → `openingBillId` `toBe(tabId)` (presented still owes); `toBe(next)` → `numbersOf` `[[tabId, 1, null], [next, 2, null]]`, `next` status `open`, and `openingBillId` still `tabId`; retitled | D7 | 6c |
| `party-main-bill.test.ts:122` ("is cleared by setMainBill naming none") | **B, Q5b item 1 (retired)** | deleted: `setMainBill` no longer exists, and nothing writes the column (the behaviour is gone). The column itself goes in Task 7 | §3.4 | 6c |
| `party-main-bill.test.ts:132-155` (a hand-written main bill naming a presented / another party's bill refuses `tab.not_open`) | **B, Q5b item 2 (retired and replaced)** | retired with the main bill: the refused order named no bill, which only the test fixture could send (production `placeGroups` already required a named bill on `a90f4f87b`; the refusal lived in the fixture since #1897), so no product refusal code changes. Replaced by a different request, overlapping the `:249` `it.each` rows: the order names that bill itself and is refused `bill.presented` / `bill.other_party` with `params: { workingOrderId: target }`; the lines, bills and revision before/after checks unchanged; the hand-written `parties.mainBillId` write goes; retitled "refuses an order naming %s, writing nothing" | §3.4, Review focus 4 | 6c |
| `party-main-bill.test.ts:171` (group command's landed bill is main) | B | → `numbersOf` `[[tabId, 1, null], [landed, 2, null]]` and `landed` status `open`; revision-once checks unchanged; title "next main bill" → "next bill" | §3.4 | 6c |
| `party-main-bill.test.ts:217` (`before.party.mainBillId` `toBeNull()`, the precondition) | B | → `before.bills` `toEqual([tabId])` (no bill made, beside the unchanged before/after `toEqual`); title "next main bill" → "next bill" | §3.4 | 6c |
| `party-main-bill.test.ts:224` (abandoned main bill cleared) | B | → the floor's `openingBillId` `toBeNull()` (no shown bill); retitled "is none when the party's only bill is abandoned" | D7 | 6c |
| `party-main-bill.test.ts:248`, `:362`, `:375`, `:397`, `:422`, `:460` | B, W | `:248` → `openingBillId` `toBe(tabId)` (retitled "… and the table still opens on Bill 1"); `:362` → `numbersOf` `[[tabId,1],[checkId,2],[dessertTab,3]]`; `:375` `party: { mainBillId }` → `{ openingBillId: dessertTab }`; `:397` whole-shape `mainBillId: null` → `openingBillId: tabId` (the paid bill); `:422` → `openingBillId` `toBe(dessertTab)`; `:460` → `openingBillId` `toBe(next)` | D7 | 6c |
| `parties.test.ts:662`, `:767` (two of the seven) | B | `mainBillId` `toBe(dessertTab)` → `dessertTab` status `open` and `openingBillOfParty` `toBe(dessertTab)` (the paid Bill 1 owes nothing) | §3.4, D7 | 6c |
| `parties.test.ts:712` | B | `toBe(tabId)` → `openingBillOfParty` `toBe(tabId)` | D7 | 6c |
| `party-move-bill.test.ts:774`, `:1218` (two of the seven), `:770`, `:1216`, `:961`, `:835-839` | B | `:770` `toBeNull()` → `openingBillOfParty` `toBe(paid)` (the paid split bill is the only one shown); `:774` → `toBe(tabId)`; `:1216` `toBeNull()` → `toBe(second)` (presented, owing); `:1218` (now `:1222`) `toBe(tabId)` → `numbersOf` `[[second,1],[tabId,2]]` and `tabId` status `open`; `:961` `toBeNull()` → `toBe(orderId)`; `:835` whole object `mainBillId: null` → `openingBillId: second`. Describe "the main bill" → "the party's last unpaid bill"; titles at `:760`, `:1208`, `:358`, `:378`, `:1543` and comments `:408`, `:1272` say Bill 1 instead of main bill | D7 | 6c |
| `party-move-bill.test.ts:315`, `:316`, `:339`, `:355`, `:401`, `:847`, `:874`, `:907`, `:939`, `:1040`, `:1205` | B | `partyRow.mainBillId` `toBe(x)` → `openingBillOfParty` `toBe(x)`, same `x` | D7 | 6c |
| `party-table-actions.test.ts:682` (two of the seven, the loop), `:679`, `:655`, `:1181`, `:1183`, `:1159`, `:1137`, `:278`, `:344`, `:1143` | B | `:682` (now `:689`) `toBe(tabId)` → `numbersOf` `[[luis.tabId,1],[ana.tabId,2],[tabId,3]]` and status `open`; `:679` `toBeNull()` → `openingBillOfParty` `toBe(luis.tabId)` when presented, `toBe(ana.tabId)` when paid; `:655` `toBeNull()` → `toBe(luis.tabId)`; `:1183` `toBeNull()` → `toBe(b2)`; `:1181` (now `:1194`) `toBe(tabId)` → `numbersOf` `[[b2,1],[tabId,2]]` and status `open`; `:1159` `toBeNull()` → `toBe(main.id)`; `:1137` `mainBillId: null` in `toMatchObject` → `openingBillOfParty` `toBe(b2)`; `:278`, `:344`, `:1143` the `mainBillId` key leaves the `toMatchObject` for a separate `openingBillOfParty` `toBe` of the same value. Describe "the main bill when parties combine" → "the bills when parties combine"; titles at `:312`, `:351`, `:368`, `:385`, `:643`, `:665`, `:1164` and comment `:1115` retitled | D7 | 6c |
| `party-table-actions.test.ts:365`, `:1040`, `:1592` | B | `toBe(x)` → `openingBillOfParty` `toBe(x)`, same `x` | D7 | 6c |
| `party-bill-actions.test.ts:263`, `:731-734`, `:875-878`, `:744` | B | `:263` → `openingBillOfParty` `toBe(tabId)`; `:731`, `:875` the whole objects' `mainBillId: tabId` → `openingBillId: tabId`; `:744` `toBeNull()` → `toBe(second)`, retitled "… and the table opens on it, when Bill 1 is merged away" | D7 | 6c |
| `party-bill-actions.test.ts:1313`, `:1380`, `:1391` (Task 6b's writers describe) | B | seating names no main bill, so `mainOf(partyId)` `toBe(main)` / `toBe(tabId)` → `toBeNull()`; `:1380` and `:1391` also gain `openingBillOfParty(partyId)` `toBe(tabId)` (the staying party keeps its bill). The describe keeps reading the column (`mainOf`) as its guard until Task 7 drops it; `:1311` and `:1370` retitled | §3.4 | 6c |
| `bill-identities.test.ts:171` | B | `toBeNull()` → `openingBillOfParty` `toBe(tabId)` (the paid bill); title "a main bill given to …" → "a bill made for …" | D7 | 6c |
| `order-drafts.db.test.ts:1059` | B | `mainBillId` `toBe(tabId)` → `firstOpenBillOf(tx, partyId)` `toBe(tabId)`; title "… while another bill is main" → "… while another bill has a lower number" | §3.4 | 6c |
| `till-api.drafts.test.ts:181-186` helper `mainBillOf` (13 call sites) | S | the helper reads `firstOpenBillOf` and is renamed `openBillOf`; every `expect` other than `:1102`'s byte-identical | §3.4 | 6c |
| `till-api.drafts.test.ts:1102` (was `:1104`) | B | before: Bill 1 is still the party's main bill after a submit to Bill 2. After: `expect(await openBillOf(party.partyId)).toBe(party.tabId)` — Bill 1 is the party's lowest-numbered open bill, which holds as long as Bill 1 stays open. A different and weaker statement: no main bill exists to check (Task 6c review Minor 2) | §3.4 | 6c |
| `order-kitchen-note.moves.test.ts:355` title | S | "… when the party needs a replacement main bill" → "… on a new bill made after the party's bill is paid", with the planned `insertPartyBill` at `:367` | D1 | 6c |
| `apps/server/src/party-bill-actions.test.ts:690`, `:736` (merge keeps/moves the main bill) | B | the explicit merge's surviving bill keeps its number; no main bill | §3.4 | 6b |
| `party-bill-actions.test.ts:739` (was `:736`, "makes the bill merged into the main bill when the main bill is merged away") | B (Task 6b's red run) | `mainBillId` `toBe(second)` → `toBeNull()`, plus `numbersOf` `[[main, 1, null], [second, 2, null]]` and `second`'s status `open`; retitled "keeps the bill merged into as Bill 2, naming no main bill, when Bill 1 is merged away"; the abandoned and lines checks unchanged. `:690` stayed green (seating's main bill is not the one merged away) and is unchanged | §3.4; D12 | 6b |
| `party-move-bill.test.ts:822` (was `:827`, a bill moved to a free table is the new party's main bill) | B (Task 6b's red run) | `mainBillId: second` → `mainBillId: null` in the same `toEqual`, plus `numbersOf(new party)` `[[second, 1, null]]` and `second`'s status `open`; retitled "… with the bill as its Bill 1 …"; every other check unchanged | §3.4 | 6b |
| `party-move-bill.test.ts:943` (was `:941`, a counter order seated at a free table is the new party's main bill) | B (Task 6b's red run) | `mainBillId` `toBe(orderId)` → `toBeNull()`, plus `numbersOf` `[[orderId, 1, null]]` and its status `open`; retitled "… as a new party's Bill 1"; every other check unchanged | §3.4 | 6b |
| `party-table-actions.test.ts:643` (was `:641`, "makes the incoming main bill main when the receiving one is presented") | B (Task 6b's red run) | `mainBillId` `toBe(ana.tabId)` → `toBeNull()`, plus `numbersOf(luis)` `[[luis.tabId, 1, null], [ana.tabId, 2, null]]`; retitled "keeps the incoming open bill as the receiving party's Bill 2, naming no main bill, when the receiving one is presented"; the answer and both bills' status/party checks unchanged | §3.4 | 6b |
| `party-table-actions.test.ts:1125` (was `:1121`, split: "the chosen bill as its main") | B (Task 6b's red run) | `mainBillId: b2` → `mainBillId: null` in the same `toMatchObject` (its `numbersOf` `[[b2, 1, null]]` and status checks were already there); retitled "… as its Bill 1"; the staying party's `mainBillId: ana.tabId` unchanged | §3.4; master plan "any eligible bill" | 6b |
| `party-table-actions.test.ts:1149` (was `:1145`, split with no bill: "a new, empty main bill") | B (Task 6b's red run) | `mainBillId` `toBe(main.id)` → `toBeNull()`, plus `numbersOf` `[[main.id, 1, null]]`; retitled "… a new, empty Bill 1 …"; every other check unchanged | §3.4; D1 | 6b |
| `department-transfer-api.test.ts:1661`, `order-portions.lifecycle.test.ts:261`, `order-portions.adjustments.test.ts:1910` (calls of `mergeCheckedBills`, directly or through `testing/bill-action-fixture.ts`) | F (Task 6b) | a function parameter was dropped, not a field: `mergeCheckedBills` no longer has its `partyId` parameter, which only the main-bill bookkeeping read, so the argument goes at each call; expectations unchanged; `department-transfer-api`'s setup stops keeping the party id it no longer passes; no `expect` changes | D12 | 6b |
| `apps/server/src/parties.test.ts`, `till-api.parties.test.ts:807-821`, and any `TableParty`/floor whole-shape pin | W | `mainBillId` → `openingBillId` | D7 | 6c |
| `scripts/behavioural-triggers.test.ts` `EXPECTED_TRIGGERS` (`:158-159`) and `describe("working_orders_release_main_bill")` (`:1544-1590`) | **W, B, Q5 item 3** | the two names leave the list; the describe becomes "the main bill is gone": `parties` has no `main_bill_id` column (`pragma_table_info`) and no trigger's SQL names `main_bill` (`sqlite_master`). The seed rows the retired cases used (`party-main-*`, `wo-main-*`) and their comment are removed (setup the retired cases used, removed; no check changed; 368 tests before and after) | §3.4 | 7 |
| `scripts/migration-upgrade.test.ts` `RESETS` | **W, Q5 item 4** | gains the new core rebuild step, `refused: ["DROP TABLE \`parties\`", "FOREIGN KEY constraint failed"]` (as `:437-439`; the exact text from the run's own output) | finding 9 | 7 |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:119-130` (expectation adapter) | **W, Q5 item 5** | the captured `parties` table's expectation drops the `main_bill_id` column and its foreign key, as the adapter already adds columns; the hashed fixture is not edited | finding 9 | 7 |
| `apps/server/src/party-bill-actions.test.ts` `A803 no main bill (writers):` (Task 6b's writers describe, lines at `2d009763b`): the `mainOf` helper `:1283-1284` and its 14 reads of `parties.mainBillId` — `:1304` (in `presentedParty`), `:1320`, `:1324`, `:1334`, `:1345`, `:1361`, `:1367`, `:1374`, `:1386`, `:1387`, `:1398`, `:1399`, `:1410`, `:1411` | **R, Q5b item 3 (deleted checks)** | the column goes, so every `mainOf(...)` `toBeNull()` line and the helper are deleted. The case "Merge bills leaves the party with no main bill when Bill 1 is merged away" (`:1318`) has no other check and is deleted whole. The other seven cases (`:1327`, `:1337`, `:1348`, `:1364`, `:1377`, `:1391`, `:1403`) keep every other `expect` byte-identical (the answers' `partyId`, `billId` and `billIds` checks, the new bill's party, and `openingBillOfParty` at `:1388` and `:1400`); their titles and the describe's lose the "no main bill" clause. What carries the guarantee afterwards (that no table action names a main bill): Task 7's new behavioural-triggers case "the main bill is gone" — `parties` has no `main_bill_id` column (`pragma_table_info`) and no trigger's SQL names `main_bill` — so nothing can store one. Task 6b's six rewritten lines (at `e31ede59e`: party-bill-actions `:744`; party-move-bill `:838`, `:961`; party-table-actions `:655`, `:1137`, `:1159`) no longer read `mainBillId` at `2d009763b` (Task 6c re-pointed them, rows above) and are not in this row. `till-api.table-actions.test.ts:775`, `:800` ("no answer carries mainBillId", `not.toHaveProperty("mainBillId")`) are absence checks on the answer, not reads of the column: they survive the drop unchanged and stay | §3.4 | 7 |
| `apps/till/src/api/client.test.ts:2738-2749`, `apps/till/src/i18n/codes.test.ts:323-333`, `apps/till/src/till-app-parties.test.ts:2491`, `:4101` (`party.main_bill_stays`) | **B, Q5** | the code's rows go (no thrower, D14); `codes.test.ts`'s loop keeps its other two codes. Deleted checks: question 5d (questions.md 2026-10-31 ~09:45), built on the default | §3.4, D14 | 8d |
| `till-app-parties.test.ts:2126`, `:2452`, `:4395`, `:4405`, `:5830`; `till-app-drafts.test.ts:8720` (opening/following the main bill) | B | follow D7/D11: `openingBillId`, kept or lowest-numbered bill | §3.4, Review focus 4 | 8d |
| `till-app-parties.test.ts:3964` ("goes back to the floor when the moved bill was the party's last") | F | **kept**: every assertion unchanged (D11 rule 2); only its emitted event detail loses `bills: "merge"` | D11 | 8b |
| `till-app-parties.test.ts` kept-apart message tests (`table.bills_kept_separate`) and merge-question tests in the table screen | B | no question; the request carries no `bills` | §3.4 bullet 2, §6 | 8a |
| As built at Task 8a (lines at `3e83dc464`): `apps/till/src/api/client.test.ts` request-body pins `:2624`, `:2661`, `:2690`, `:2723`, `:2772`, `:2814`, `:2823`, `:2832`, `:3020`, `:4512`, `:4527`; `party-allergy-client.test.ts:52`, `:84` | B | the body's `bills` entry goes; every other key and value of the same `JSON.stringify`/`toEqual` pin unchanged | §3.4 bullet 2, §6, D13 | 8a |
| `client.test.ts` mocked answers `:2601`, `:2638`, `:2677`, `:2703`, `:2753`, `:2782`, `:2996-2997`, `:3030`, `:3071`; `party-allergy-client.test.ts:59`; `till-floor-screen.today-joins.test.ts:716-718`, `:1069`; till-app fixtures (`till-app.test.ts:523-524`, `:9902`, `:9930`, `:17394`, `:17484`, `:17522`, `:17640`, `:17653`, `:17723`, `:17773`, `:21887`, `:22010`, `:22019`, `:22027`, `:22036`; `till-app-allergy.move.test.ts:98`, `:154`, `:353`, `:368`, `:464`, `:582`; `till-app-table-service.test.ts:289-291`; `till-app-parties.test.ts:300-302`, `:311`, `:1573`, `:1768`, `:1813`, `:2174-2175` (first answer), `:2240`, `:2281`, `:2463`, `:3285`, `:3292`, `:3378`, `:3486`, `:3598`, `:3650`, `:3704`, `:3761-3763`, `:3815`, `:3980`, `:4002`, `:4089`, `:5183`, `:10508`, `:10562`, `:10917`, `:10981`) | F | the answer takes the new shape: `mainBillId: X, merged` → `billIds: [X]` (`[]` for null), split `mainBillId` → `billId` (null → a new bill's id), `merged` dropped from move answers and type casts; `it.each` rows `:2154-2155`, `:4085-4086` lose their unread `merged` value. Every `expect` unchanged | master plan interfaces | 8a |
| `till-app-parties.test.ts:2092` (follows the guests into Luis's party: `orderId` `wo-7`, banner `table.bills_kept_separate`), `:2153` (it.each, answer), `:2170` (join: banner `table.bills_kept_separate`), `:3496` (floor unreadable: `orderId` `wo-7`, banner kept apart), `:4000` (move bill: banner kept apart) | B | answers list every bill the party holds afterwards (`["wo-7", "wo-4", "wo-check"]`); the screen keeps the bill it showed, `wo-4` (was the destination's main bill `wo-7`), and the banner is `null` (was the kept-apart sentence); titles say so. `:2092` and `:2155` read Luis's drafts through `draftsOnceJoinedByAna`, which lists Ana's bills under him once joined (setup) | D11 rule 1; §3.4 bullet 2, §6. **Departure:** the plan's 8d row lists `:2126`; the Move guests follow it and these cases pin changed in 8a, so they changed here; the Move guests follow it pins changed here | 8a |
| `till-app-parties.test.ts:2126` ("opens the first unpaid bill … when it has no main bill") | B | retitled "… when its answer no longer lists the bill on screen"; answer `billIds: ["wo-7", "wo-luis"]`; the same `orderId` `wo-7` and party checks (lowest-numbered owing bill of the read) | D11 rule 1 | 8a |
| Task 8a review (lines at `7e78e9495`): `till-app-parties.test.ts:2146` (follows the party the guests moved into when its answer no longer lists the bill on screen; the B row above as `:2126`) | B | the read's Bill 1 `wo-7` is now `settled` (paid, `outstanding` `0.00`) and Luis's `wo-luis` open; `orderId` `wo-7` → `wo-luis`; retitled "… past its paid Bill 1 …"; the party check unchanged. Red: `#followActionBills` taking `billIds[0]` fails it (`expected 'wo-7' to be 'wo-luis'`); green with the code as built | D11 rule 1 | 8a |
| Task 8a review: `till-app-parties.test.ts:1732` (handheld: back on the order tab the screen followed the guests into v9) and `:3465` (the answer arrives after the waiter came back to the same party) — filed above as kind F at base `:1732`, `:3454` | B | the answer is the server's shape, `billIds: ["wo-9", "wo-4", "wo-check"]`; once moved, the bills and drafts reads list Ana's bills under v9 (`billsOnceJoinedByAna`, new, and `draftsOnceJoinedByAna` with its new `into` argument: setup); `orderId` `wo-9` → `wo-4`, the bill the screen showed; titles add "keeping the bill …"; every other `expect` unchanged. Red: with the old `wo-9` expectation both fail `expected 'wo-4' to be 'wo-9'` | D11 rule 1; §3.4 bullet 2 | 8a |
| Task 8a review: `till-app-parties.test.ts:3407`, `:3412` (rows 2 and 3 of "Move guests: $read, read after the answer …") — filed above as kind F at base `:3383`, `:3388` | B | row 2's answer `billIds: []`, which the server never sends (D1), → `["wo-9"]` (the "not listed" path: another till took the bill on screen); row 3, "the bills it says the merge from", → "the bills read with the lines", answer `["wo-9", "wo-4", "wo-check"]` (the "listed, keep it" path); the held read and every `expect` unchanged | D1; D11 rule 1 | 8a |
| Task 8a review: titles only — `client.test.ts:2600`, `:2636`, `:2746` ("… the bill choice …"); `till-app-parties.test.ts:2177`, `:4110` (`it.each` rows "merged" / "kept apart when asked to", "merged into their main bill" / "kept separate when asked to"); `till-app-parties.test.ts:4050` and `till-app.test.ts:17999` ("sends the party the bill choice named …") | B (titles; no `expect` changes) | the client titles drop "the bill choice"; each `it.each` pair is titled by the event's `bills` value it sends ("… with the event's bills value merge/separate"), the two rows now being the same behaviour; "the bill choice named" → "the waiter picked" | §3.4 bullet 2 | 8a |
| Task 8a review: `state/bill-state.test.ts` calls passing `named` (all added at Task 8a) | B | the case "takes the bill the answer names when the kept one has gone" (two checks) is deleted with `billToShow`'s `named` parameter, which no production code passed; `billToShow(undefined, [paidThree, dropped, paidTwo], "wo-0")` → `wo-2` is deleted, the same read with `kept` `"wo-0"` → `wo-2` staying beside it; `billToShow("wo-9", read, "wo-9")` → `wo-2` becomes `billToShow(undefined, read)` → `wo-2`; the other three calls drop the argument with the same expectation | D11 (no step for a bill the answer names) | 8a |
| `till-app-parties.test.ts:10928-10995` (relocation observations "while the bill choice is open" ×3, "read before opening the bill choice" ×3) | B | no dialog: the source-observation case holds the destination's drafts read and changes the source meanwhile (same `not.toHaveBeenCalled` and `draft.out_of_date` banner); the destination case checks the send used the one read made when the table was picked (`before + 1`, was the count when the dialog opened) and the same `expectedEdits`; `relocationPrompt` asserts no dialog is drawn | §3.4 bullet 2, §6 | 8a |
| `till-app-open-table.test.ts:1405`/`:1427` (moving guests back onto Ana's table showed her `Beer ×1`, the merged main bill) | B | answer `billIds: ["wo-4", "wo-7"]`; the screen keeps `wo-7` (new `orderId` check) and its rows are `[]`; the waits-for-its-save checks and `savedLines()` unchanged. `:1382`'s answer F | D11 rule 1, §3.4 | 8a |
| `till-app-menu-refresh.test.ts:2069`, `:2074` | F | answer `billIds: ["wo-other", "wo-7"]`; the comment no longer says the party has a new main bill; every `expect` unchanged | §3.4 | 8a |
| `till-table-order-screen.test.ts:4767` (`:4785-4786`), `:4962`, `:5065` (`:5082`) (`bills: "merge"` in the event detail) | B | the detail carries no `bills`; same `toEqual` otherwise | §3.4 bullet 2, §6 | 8a |
| `till-table-order-screen.test.ts:4793` (Move this bill to a seated table asks, then sends `separate`), `:4978` (Move guests asks, then sends `separate`), `:5027` (Join asks, then sends `merge`) | B | sends at once with no `bills`, no dialog. **The dialog's wording checks go with it** (`table.move_bill_scope` `:4802-4804`, `:4855-4857`, `table.bill_move_question` `:4806`, `table.combine_scope` `:4989-4993`, `:5045-5049`): the question no longer exists on this screen; its words stay tested by `bill-choice-dialog.test.ts` and `held-orders.test.ts` until 8b | §3.4 bullet 2, §6 | 8a |
| `till-table-order-screen.test.ts:4820` (a slot-named bill printed as typed in the question's scope) | R | the same bill name, `Ana · Bill 2 · {into}`, printed as typed in Move this bill's picker heading (`table.move_bill_heading`) | §3.4 bullet 2 | 8a |
| `till-table-order-screen.test.ts:4832` (sends the seated party the question was asked about, though the floor changed) | B | the screen's remaining wait, `table-relocation-open` held until `ready`: the floor changes meanwhile and the send still names `v7` rev 9 | §3.4 bullet 2 | 8a |
| `till-table-order-screen.test.ts:4871` (cancelling the question sends nothing), `:5008` (cancelling leaves the list open) | B | `:4871` → "sends nothing when the waiter goes back before the move is ready to send" (same `[]`); `:5008` → picking a seated table offers no choice, sends once and closes the list | §3.4 bullet 2, §6 | 8a |
| `till-table-order-screen.a11y.test.ts:900`, `:921` (axe over the bill choice) | B | axe over the screen after picking the seated table, which must have sent once and drawn no bill choice; both themes as before | §3.4 bullet 2 | 8a |
| merge-question tests in the floor screen and parked orders, and every other `bills: "merge"` event detail or client argument in till tests | B / F | no question, no `bills` | §3.4 bullet 2, §6 | 8b |
| `apps/till/src/widgets/bill-choice-dialog.test.ts`, `bill-choice-dialog.a11y.test.ts` | **B, Q5 item 6b** (deleted with the widget) | deleted; replaced by the "no question" cases of Tasks 8a/8b, which fail if a question is drawn or `bills` is sent | §3.4 bullet 2 ("The … question goes") | 8b |
| As built at Task 8b (lines at the Task 8b commit): the mechanical `bills` sweep — every `bills: "merge"`/`"separate"` event-detail field and every positional `"merge"`/`"separate"`/`undefined` argument to, or expected argument of, `moveGuests`, `moveBill`, `previewBillMoveAllergy` and `joinTables` in `till-app-parties.test.ts` (103 sites, `:3964` among them), `till-app.test.ts` (35), `till-floor-screen.today-joins.test.ts` (18), `api/client.test.ts` (17, and `:5838`'s `undefined`), `till-app-table-service.test.ts` (8), `held-orders.test.ts` (5), `till-app-allergy.move.test.ts` (3), `party-allergy-client.test.ts` (3), `till-app-drafts.test.ts` (2), `till-app-open-table.test.ts` (2), `till-app-menu-refresh.test.ts` (1); `till-app.test.ts:17317` `counterMovePreview` loses its `_bills` parameter; argument positions after the dropped slot move down one — `till-app-allergy.move.test.ts` `mock.calls[n]![3]` → `[2]` (2), `![4]` → `![3]` (10), `.slice(0, 5)` → `.slice(0, 4)` (4), `till-floor-screen.today-joins.test.ts:401` `toHaveLength(4)` → `3`, `:792` and `:812` `[3]` → `[2]` | F | the field or argument goes; every other value of the same call or detail unchanged | §3.4 bullet 2, §6, D13 | 8b |
| Task 8b: `till-app-parties.test.ts:2191`, `:4135` (the two `it.each` pairs "… with the event's bills value merge/separate") | B | each pair folds into one case sending no `bills`; the same `toHaveBeenCalledOnce` and no-banner checks | §3.4 bullet 2 | 8b |
| Task 8b: `client.test.ts:5829` title "… even when a caller passes one" | B (title) | "moveGuests sends no bills key, and answers …": no caller can pass one now; the body pin unchanged | D13 | 8b |
| Task 8b: checks that no `till-bill-choice-dialog` is drawn — `till-floor-screen.today-joins.test.ts` (10 sites: `:195`, `:281`, `:395`, `:428`, `:744`, `:836`, `:853`, `:874`, `:925`, `:961`, now `expect(dialogs(el)).toEqual([])`, a new helper listing every `till-*-dialog` the screen draws), `till-table-order-screen.test.ts:4721` `billChoice` and `:4735` `anyDialog`, `till-table-order-screen.a11y.test.ts:900`, `:925`, `till-app-parties.test.ts:10978` `relocationPrompt` | B | the widget is deleted, so a check naming its tag could no longer fail; each now checks that no `till-*-dialog` element of any kind is drawn, which also catches the old one | §3.4 bullet 2 | 8b |
| Task 8b: floor `:338` (a seated table dropped on a merge of two) | B | "no bill choice" → the only dialog drawn is `till-today-seats-dialog`; the seats checks unchanged | §3.4 bullet 2 | 8b |
| Task 8b: floor `:269` ("two seated tables ask which bills to keep, then join", base `:264`) | B | no question: retitled "join at once, the dragged table staying where it was dropped until answered"; the join is held unanswered, the table stays drawn at 18 through a re-read and nothing refreshes, then the answer gives one refresh; the `joinTables` arguments as before minus `bills`. The scope check ("Ana (1) joins 2") goes with the question | §3.4 bullet 2 | 8b |
| Task 8b: floor `:309` ("… after the bill choice keeps that choice"), `:449` ("a re-read while the bills are asked …"), `:475` ("… while the bills are asked still sends the join"), `:590` ("two seated tables still ask which bills to keep", prepay zone), `:628` ("… through the bill choice and the seats window"), `:738` ("reads both parties before the bill question …"), `:858` ("… and its question"), `:945` ("… without reopening its old question"), `:971` ("… retires the original confirmation"), `:930`, `:1008`, `:1038`, and the `finish` helper | B | the confirmation step goes; titles name the join or the seats instead of the question; `:475` takes its re-read after the first send, while the seats are asked; `:590` checks `joinTables` called once instead of the question drawn; `:738` waits for the join instead of the question; every `joinTables` argument check as before minus `bills` | §3.4 bullet 2 | 8b |
| Task 8b: floor `:909` ("switching the active zone closes the original bill question", base `:953`) | B | the drop's reads are held, the zone tab is clicked, the reads answer: no join and no dialog | §3.4 bullet 2 | 8b |
| Task 8b: floor "cancelling the bill choice puts the table back and sends nothing" (base `:357`), "a replaced API cannot send an already-open bill confirmation" (base `:912`), `it.each` "an old bill-choice-confirm / bill-choice-cancel cannot close the replacement question" (base `:1081`, 2 rows) | **R, deleted (Q5 item 6b's reach, see the record)** | each tested a control of the question itself (its Cancel, a confirmation kept open across an API change, a stale confirmation), which no longer exists; the replaced-API fence is still checked by `:858`'s `api` row and the stale-prompt fence by `:1038` | §3.4 bullet 2 | 8b |
| Task 8b: `held-orders.test.ts:723` ("qualifies the bill choice before opening …"), `:779` ("asks about the bills first at a seated table …"), `:794` ("sends the party the bill choice names …"), `:831` ("goes back to the tables when the bill choice is cancelled, and Cancel there sends nothing") | B | `:723` checks nothing is sent before `ready` and after a cancelled `ready`, then the move with its `prompt` and no `bills`; `:779` and `:794` the move sent at once with the seated read, no `bills` (`:794` re-expressed by the review row I1, the re-read now between the pick and `ready()`); `:831` keeps its second half (Cancel in the tables list sends nothing). The question's scope and wording checks (`table.move_bill_scope`, `table.bill_move_question`) go with the question | §3.4 bullet 2 | 8b |
| Task 8b: `held-orders.test.ts:825` ("names a seated party with no name by the tables the floor lists for it") | R | the same value, `Mesa 7`, read from `partyScope` (`widgets/table-targets.ts`), which made the question's "into" name and still names parties on the table screen; moved to `table-targets.test.ts` by the review row M2 | §3.4 bullet 2 | 8b |
| Task 8b: `held-orders.a11y.test.ts:169` (axe over the bill choice) | B | axe after picking the seated table, which must have sent once and drawn no `till-*-dialog`; both themes as before | §3.4 bullet 2 | 8b |
| Task 8b: `till-app.test.ts:17429` ("counter relocation keeps the destination observations shown before native confirmation") | B | no confirmation: "… sends at once the destination observations read when the table is picked"; the same `listDrafts("v7")` and `moveBill` argument checks minus `bills`; the change of the drafts read while the choice was open goes with the choice | §3.4 bullet 2 | 8b |
| Task 8b: `bill-choice-dialog.test.ts` (6 cases) and `bill-choice-dialog.a11y.test.ts` (2 cases × 2 themes) | R, Q5 item 6b | deleted with the widget (the row above) | §3.4 bullet 2 | 8b |
| Task 8b review I1: `held-orders.test.ts` "sends the party the picker showed once ready, though the floor read since seats another there" (was `:794`, which after 8b re-read only after the move was sent, repeating `:779`) | B | the app takes the relocation event and answers later through `ready()`; nothing is sent at the pick, the floor re-read seats Pedro (`v8`) at t7, then `ready()` sends `seated: { id: "v7", revision: 9 }` with its `prompt`. Control: `ready` sending the table as re-read fails, `+ "id": "v8"` | §3.4 bullet 2 | 8b review |
| Task 8b review I2: floor "a re-read while the drop reads the bills still joins the party the drop named" (was `:449`) and the first half of "a join sends the revision read at the drop, through the bill reads and the seats window" (was `:628`) | B | a new helper `holdFirstDraftRead` holds the drop's first `listDrafts`; each case checks no join was sent, re-reads the floor (party R at t1; the room at revision 8), then releases the read; the `joinTables` argument checks unchanged (`otherPartyId: "P"`, `expectedOtherPartyRevision: 3`; `zoneRevision: 7`). Controls: the join taking the party drawn after the reads fails (`"P"` → `"R"`, `3` → `11`); the join taking the room's revision after the reads fails (`7` → `8`) | §3.4 bullet 2 | 8b review |
| Task 8b review M1: `apps/till/src/state/floor-today.test.ts:179` | B (title) | "two seated tables join into the target's party, after the bill choice" → "… join into the target's party"; assertions unchanged | §3.4 bullet 2 | 8b review |
| Task 8b review M2: the `partyScope` case from `held-orders.test.ts` (was `:825`) | S | moved to a new `apps/till/src/widgets/table-targets.test.ts`, beside `partyScope`, with copies of the `tableRow`, `luis` and `tables` fixtures; the title and the `expect` byte-identical (`Mesa 7`) | §3.4 bullet 2 | 8b review |
| As built at Task 8c (base `2e285151d`): every `mainBillId` in `apps/till` — 163 lines in 72 files (`rg -c mainBillId apps/till` before), 66 of them test files: fixture and helper keys `mainBillId:`, and the reads `party.mainBillId` in `till-app-kitchen-note.test.ts:933-934`, `till-app-device-zones.test.ts` (12 sites, `:1419`-`:2199`) and `till-app-table-service.test.ts:1778` (an `expect(...).toBe(openTable.party!.mainBillId)`, whose expected value is the same field of the same fixture) | F | `\bmainBillId\b` → `openingBillId` by one `perl -pi` over `rg -l mainBillId apps/till`, same values; no assertion's matcher or expected value changed. Prettier re-wrapped two lines the longer name pushed past the width: `till-app-device-zones.test.ts:1524` (`draftServer(() => ({ tabId: … }))` now on five lines, `:1524-1528`) and `till-app-parties.test.ts:4444` (`getTablesState: vi.fn().mockResolvedValue([...])` now on three lines, `:4445-4447`) | D7 | 8c |
| `till-table-order-screen.test.ts:713` ("Table actions" trigger inside the drawer), `:4231` (verb buttons in the menu), `:6704` (Back in the panel) | R | the ⋮ holds the same items; Back returns to `closed` (no `menu` step) | amendment 3 | 10 |
| `till-table-order-screen.parties.test.ts:128-239` (bills list rows, Take payment), `:184-197` (no New orders tag) | R, B | rows → switcher rows; Receipt copy and Cancel and credit → ⋮ bill section for the bill on screen; Take payment → switching; the no-tag checks stay (the switcher draws no tag) | spec §3.5, amendment 2 | 9 (rows), 11a (re-point) |
| Every `data-open-drawer` site (105 in 37 files) | R | opens the ⋮ or the switcher, or reads the foot, whichever now holds what the case checks; a11y cases run axe on the ⋮ and switcher open instead of the drawer | spec §3.5 "The Tab button and its side panel go" | 11a (screen files), 11b (app files, helpers), 11c (sites that read the still-to-pay row, the finish refusal or the badge) |
| Tab badge: `till-table-order-screen.test.ts:535-539`, `:541-549` (handle's accessible name), `:552-561`, `:751`; `.populated-drawer.a11y.test.ts:92`; `.empty-drawer.a11y.test.ts:47` | R | the not-yet-served count read from the Sent summary (`[data-sent-panel] .summary`, `table.sent_counts`) and the Sent toggle's accessible name; one-portion lines so line and quantity counts agree | spec §3.5; board 13 "Sent, To serve, Served … the panel's Sent box"; D17 | 11c |
| `till-table-order-screen.test.ts:694`, `till-table-order-screen.panel-footer.test.ts:127-150` (Hold swallowed) | B | Hold is not drawn on the table screen; a counter case pins Park still drawn there | amendment 4 | 12 |
| `till-table-order-screen.panel-footer.test.ts:29-54` (one tender-pay, Full invoice count, Discount in the foot) | B, R | one Full invoice on the table's payment step (D8); `data-discount-bill` found in the ⋮ bill section, not the foot (D16) | amendment 1, amendment 4, Owner questions 3 and 7 | 12 |
| `data-discount-bill` sites: `panel-footer.test.ts` (7), `till-table-order-screen.adjustments.test.ts` (4), `till-app-adjustments.test.ts` (2), `panel-footer.a11y.test.ts` (1) | R | open the ⋮ first, then the same button, same event and detail | D16, Owner question 7 | 12 |
| Any case that pins the payment step's Full invoice on a presented bill that already has an invoice number | B | not drawn (D8 gate, matching the server's `working_order.not_open`); confirm at red, none found by reading | master plan "an issued/paid bill never opens that editor" | 12 |
| Task 8d-0: bills fakes list the floor's bills, every `expect` identical; files: `apps/till/src/widgets/test-helpers.ts` (new `partyBillOf`, `floorPartyBills`), `apps/till/test/allergy-app-fixture.ts`, `till-app-drafts.test.ts`, `till-app-table-service.test.ts`, `till-app-device-zones.test.ts`, `till-app-open-table.test.ts`, `till-app-bar-tables.test.ts`, `till-app-kitchen-note.test.ts`, `till-app-menu-refresh.test.ts`, `till-app-counter-adjustments.test.ts`, `till-app-setup-refresh.test.ts`, `till-app.a11y.test.ts`, `till-app-parties.test.ts`, `till-app.test.ts` | S | a bills fake that answered `[]`, or one party's bills whoever asked, answers what a server would: every bill a floor answer has named for the party (`openingBillId`), a newly seated party its `wo-new`, table 7's party its `wo-7`, the party the guests moved into all its bills (`billsOnceJoinedByAna`), and after a split or a paid tab the bill the answer named. Four cases keep their `[]` read (named in the Task 8d-0 record). No `expect`, title or production line changed (`git diff -U0 \| rg '^[-+].*expect'` prints nothing) | owner's standing rule: a fixture may grow what it lacks | 8d-0 |
| 8d-0 review answers (`a803-3-reviews/task-8c-8d0.md`), built in Task 8d's commit: `widgets/test-helpers.ts:840` `floorPartyBills` (I1, I4, M1) | S | the fake also lists, first and as Bill 1, the `tabId` of a fulfilled `seatTable`/`seatAtTables` answer of the mounted api for that party (I1); it reads `mock.settledResults` (fulfilled only), so a bills read never waits on a floor read the test holds (M1); floor answers naming two different `openingBillId`s for one party make it fail the run with an uncaught error naming the party (I4); the doc comment says so, drops "since a party keeps its bills when the floor stops naming them", and says the outstanding is not split between several bills. Control: `till-app-menu-refresh.test.ts:1864` put back on `floorPartyBills()` gave `Tests 1 passed`, `Errors 1 error` ("floorPartyBills: the floor named wo-7 and then wo-next for party party-a; …"), exit 1. `till-app-counter-adjustments.test.ts:570` keeps its committed `floorPartyBills()` and is green with the seat-aware fake (its red was I1's, not a production defect) | I1, I4, M1 | 8d |
| `till-app-drafts.test.ts:299` (`billsAfterSplit` comment, M2) | — (comment) | "once the split has answered" → "once the split has been sent", which is what the code checks | M2 | 8d |
| `till-app-drafts.test.ts:1513`, `:4022` (relocation cases kept on `[]` by 8d-0), `till-app-open-table.test.ts:1406` (I2) | S | the bills read lists the bill on screen for the party holding it at each point (drafts: new local `relocatedBillReads()` `:1495`, `v1`/`v9` → `wo-4`, `v7` → `wo-7`; open-table: `v1` → `wo-4`, plus `wo-7` once Move guests is sent, `v7` → `wo-7`), and each party's `listDrafts` answers only that party's `billEdits` (the real route lists only the family's bills, `apps/server/src/till-api.ts:3548-3567`); every `expect` byte-identical. All three pass on the base production code with this setup (`Tests 7 passed` with the other S cases below). Under D11 rule 3 the `[]` read makes the screen leave the bill on screen, so `[]` could not stay | I2; D11 rule 3 | 8d |
| `till-app-parties.test.ts:566` ("acts on the party the seat answered with when the floor cannot be read after seating", I3) | B | setup `onlyNewPartyBills()` plus `drafts.bills.add("wo-new")` (was `[]`); `finishTable("v-new", 0, [])` → `[newBillEdit]` and `joinTables(…, expectedEdits: [])` → `[newBillEdit]`, `newBillEdit` = `{ billId: "wo-new", editorVersion: 0, draftId: null, draftRevision: null }`, exact values; the party id and revision checks unchanged. Green on the base production code with this setup (8d review M3), so the `expect` change follows the realistic setup, not a change in what the till sends. The server refuses an `expectedEdits` list that does not name exactly the family's bills (`apps/server/src/bill-editing.ts:228-230`), and seating creates Bill 1 (D7) | I3; D7; D11 rule 3 | 8d |
| `till-app-table-service.test.ts:2902` ("a table of 4 on one open bill shows 4, and a cash payment changed to 5 …") | S | `openTableWith(tableWith(4, 1))` → `openTableWith(tableWith(4, 1), [bill()])`: the bills read lists the one open bill the title names (was `[]`, which under D11 rule 3 leaves the bill, so no payment was taken: the 8d-0 record's "`recordSale` never called"); every `expect` byte-identical, green on the base production code. Not a production defect | D11 rule 3 | 8d |
| `till-app-menu-refresh.test.ts:1864` (was "reads the table's party again and shows the tab the table now points at", I4) | B | the bills read is the server's state: `wo-7` Bill 1, then settled once the round is sent, beside `wo-next` Bill 2 open (another till took payment and the party moved on). Retitled "… stays on the bill the round was sent from, now paid, beside the tab the table points at"; `shownTab` and the last `getTabLines` `"wo-next"` → `"wo-7"`; the party, bills-read, line-count and banner checks unchanged. A paid bill on screen stays (Task 8d case 6); the find-tab follow takes the draft's own bill, not the floor's `openingBillId` (D7: a read for opening only; Task 8d Files ":12082 follows the draft's own bill"). Added beside it, `:1904` "… shows the bill the table now points at once the round's bill has left the party": read `wo-next` alone after the send → every old check of this case byte-identical (`wo-next`) plus the `data-bill-gone` line "Bill 1 is no longer at this table. Now showing Bill 2." | D7; D11 rule 3; Task 8d case 6 | 8d |
| `till-app-menu-refresh.test.ts:2110` ("does not follow the table the round was sent from", I4) | S | own bills read in the server's order: `wo-7` before Move guests is sent, then `wo-other` Bill 1 and `wo-7` Bill 2 (the floor names the lowest owing, `wo-other`, and the answer lists `["wo-other", "wo-7"]`); every `expect` byte-identical, green on the base code. (`wo-7` keeps number 2 throughout; the fake does not model how it came by it) | I4 | 8d |
| `till-app-drafts.test.ts:9423` (`it.each` "opening a %s bill keeps its Sent reads but accepts no fresh dishes", row `abandoned`) | B | the `abandoned` row leaves the `it.each` (the `placed`/`settled` rows unchanged) for its own case `:9438` "opening a table whose floor names an abandoned bill leaves it, says so, and accepts no fresh dishes": `orderId` `"wo-4"` → `undefined`, `bills[0].status` `abandoned` → `draftStore` `null` and no menu drawn (`browser(el)` `null`, stricter than `inert`: no dish can be tapped), plus `[data-bill-gone]` "Bill is no longer at this table." (8d review M5: "That bill is no longer at this table.", `table.bill_gone_unnumbered_none`); `getTabLines` called with `wo-4` (the parallel read, D11 rule 4 allows it) and `saveDraft` not called, unchanged. 8d review I2: the case's `getTabLines` answers one sent line for `wo-4` (was the suite's `[]`), and the screen's `lines` `toEqual([])` once it has left the bill. Judged a changed row, not a retired case: the case's claim, no fresh dish on an abandoned bill, is checked more strictly | D7 (never names an abandoned bill); D11 rule 3 | 8d |
| `till-app-parties.test.ts:4706`, `:4736`, new `:4760` (opening a seated table) | B | `:4706` title "opens the party's main bill" → "opens the bill the floor names" (no `expect` change). `:4736` "opens the latest bill when every bill of the party is paid" → "opens the bill the floor names, the highest-numbered, when every bill of the party is paid": the floor names `wo-2` (D7's choice with nothing owing) instead of `null`; `orderId` `"wo-2"` byte-identical (green on the base code too). New `:4760`: a floor naming no bill (a fault state) with `[wo-1, wo-2]` both paid opens `wo-1` with no notice, which the old `billToOpen` (last bill) would not: it would open `wo-2` | D7; D11 | 8d |
| `till-app-parties.test.ts:6132` (the plan row's `:5830`, confirmed by title: "keeps the party on screen, not the older copy on the kept floor, when a send from another bill got no answer and the floor cannot be read") | B | retitled "keeps the party and the bill sent from on screen, …"; `orderId` `"wo-4"` (the floor's bill) → `"wo-check"`, the bill the round was sent from; the party `toEqual` and the Move guests request (both bills' edit states) byte-identical | D7; Task 8d Files (":12082 follows the draft's own bill") | 8d |
| `till-app-parties.test.ts:2554`, `:4178` (`it.each` rows `party.main_bill_stays`); `api/client.test.ts:2743`; `i18n/codes.test.ts:322` | **B, Q5** | question 5d (questions.md 2026-10-31 ~09:45), built on the default. The two `it.each` rows go; the client case keeps its request and checks, the sample code `party.main_bill_stays` → `group.held_leaves_party` (a code Move this bill still meets), with that code's own params `{ tabId: "wo-4", lineNo: 2 }` (`apps/server/src/errors.ts:536`) and status 409, expected back as `{ code, tabId: "wo-4", lineNo: 2, status: 409 }` (8d review M4; was `{ partyId: "v1" }`, the old sample's params); `codes.test.ts`'s loop keeps its other two codes and the code's two wording checks go. `rg -n 'party\.main_bill_stays' apps/till` prints nothing | D14 | 8d |
| `screens/till-table-order-screen.test.ts:5423` (Split a table's bill list, found at the GREEN run) | B | retitled "… then any of its open or presented bills, the one on screen included, or none"; `targetIds` `["wo-check", "wo-placed", "wo-part", "none"]` → `["wo-4", "wo-check", "wo-placed", "wo-part", "none"]`; every other check unchanged | master plan "now allowing any eligible bill"; Task 8d Files (`#splitTableBills`, any owing bill) | 8d |
| The plan's 8d row `till-app-parties.test.ts:2126`, `:2452`, `:4395`, `:4405`, `:5830`; `till-app-drafts.test.ts:8720` | — | `:2126`, `:2452` and `till-app-drafts.test.ts:8720` needed no change (green under Task 8d unedited); `:4395`/`:4405`/`:5830` are, by title, the `:4736` and `:6132` rows above | — | 8d |
| 8d review I2 (lines at the 8d review commit): `till-app-parties.test.ts` `A803 bill gone` cases `:4325` (merged away), `:4343` (moved away), `:4361` (no bill survives), `:4407` (stale opening bill) | B (additions) | each gains a check that the vanished bill's lines leave the screen: `expect(api.getTabLines).toHaveBeenLastCalledWith("wo-4")` right after the switch (`:4325`, `:4343`, `:4407`) and the screen's `lines` `toEqual([])` (`:4361`); every other check unchanged | D11 rule 3 ("never keeps a vanished bill on screen"); 8d review I2 | 8d review |
| 8d review M5: `till-app-parties.test.ts:4407` (stale opening bill) | B | `[data-bill-gone]` "Bill is no longer at this table. Now showing Bill 1." → "That bill is no longer at this table. Now showing Bill 1." (`table.bill_gone_unnumbered`); the drafts abandoned case's text is in its row above | D11 rule 3; 8d review M5; Owner question 1 | 8d review |
| Task 9 review M6: `screens/till-table-order-screen.bill-switcher.test.ts:81` (three bills), `:132` (Bill 2 merged away), `:97` (Paid on screen) | B | the paid row's text `"Bill 3 Paid"` → `"Bill 3 Paid ✓"` (`:81`, `:132`); `:97` keeps `closedLabel` `"Bill 3 of 3 · Paid"` byte-identical and gains: the trigger's text `"Bill 3 of 3 · Paid ✓ ▾"`, the accessible name `"Bills: Bill 3 of 3 · Paid"` (no ✓), and both ✓ marks `aria-hidden="true"`. Every other check unchanged | spec §3.5 and board 12 B ("Paid ✓"); Task 9 review M6 | 9 review |
| Task 9 review I1: `screens/till-table-order-screen.bill-controls.a11y.test.ts:29` (`states`) | W | the state list gains "one bill, + New bill out" (`newBillBusy: true`); each existing state gains `false`, which is the default it was mounted with; every `expect` byte-identical. 12 → 16 cases | Task 9 review I1 | 9 review |
| 8d review M2: `till-app-parties.test.ts:2180` (Move guests: "opens the lowest-numbered unpaid bill of the party the guests moved into, …") and `:2518` (Split a table: "opens the party's main bill once the bill on screen has gone with the table split off") | B (additions), S | each gains `[data-bill-gone]` `toBeNull()` after this till's own action, where the till picks the bill itself (D11 rule 1). `:2518` setup: the bills read after the split lists `[tabBill]` (was the suite's `[tabBill, checkBill]` throughout, which kept `wo-check` at the party after it left with the split-off table); `orderId` `"wo-4"` byte-identical; with this setup and the added check, green on Task 9's production code (`8cea9e48d`) too | D11 rules 1 and 3; 8d review M2 | 8d review |

**Task 3a's red run found 50 red cases (each `it.each` row counted) in 15 files** (trace: the union of the plan's command and
`rg -l 'joinTables\(|moveGuests\(|combineParties\(|/join|/move-guests'`, 84 files); the rows
marked "found at Task 3a's red run" above are the ones planning did not list.

**Merge-after-join cases that pass without their merge step.** With every added Merge bills step
skipped (the Task 3a review's deletion control), these still pass, as they did before the branch:
3 of the 6 `parties.test.ts` `merge()` users and 3 of the 7 `print-problems.test.ts` `mergeBills`
cases (both named in their rows), and `order-drafts.db.test.ts:3600`. They check negatives or a
repeat, not that a merge happened. `move-merge.filing.test.ts:339` also passed without it until
the checks its row lists were added.

**The planning pass missed seven Task 2 rows** (the seven "found at Task 2's red run" rows above,
15 red cases). All six files are in Task 2's trace command (`rg -l 'moveBill\(|/api/bills/.*/move|bills: "merge"'`),
but the planning pass listed only the cases it read in the four files it named; these six files'
cases each pinned a merge on arrival, through a move helper whose default or argument was
`bills: "merge"`. A task's trace command lists files, not cases: every red case in a traced file
needs reading at that task's red run.

Kept unchanged on purpose: F and H2 (all files); every money, VAT, payment, permission and
profile-action assertion (`till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`
only GAIN rows for the new route, kind W); `transfer-lines.test.ts`; `split-bill.test.ts` apart
from its two `bills` property lines (row above); the explicit-merge cases of
`party-bill-actions.test.ts` other than `:690`/`:736`; `till-app-parties.test.ts:3964`'s
assertions.

## Owner questions

Each has a default the build uses; a different answer changes only the tasks named. **Question 5
is written to `questions.md` at Task 0, before any file it names is edited.** The others go to
`questions.md` and the PR at Task 16, each with its pictures from Task 15 (saved as PNGs in
`docs/backlog/mockups/a803-bills-and-tables/slice3-*.png` and copied, with the question text, to
`~/My Drive/Waitron mockups/2026-10-30 A803 slice 3 <topic>/`). **The PR is parked
`needs-owner-review` and cannot land until questions 1, 5 and 7 are answered** (Task 16).

1. **Spanish for the seven new strings and the guide section.** Default: as in "Spanish" above —
   «{bill} de {count}» ("Cuenta 2 de 3 · Clint · 54,00 €"), «+ Cuenta nueva», «Toda la mesa»,
   «Cuenta 2 ya no está en esta mesa. Ahora se muestra Cuenta 1.», «Cuenta 2 ya no está en esta
   mesa.», «Esa cuenta ya no está en esta mesa. Ahora se muestra Cuenta 1.», «Esa cuenta ya no
   está en esta mesa.» — and the ES `{#bill-switcher}` section (Task 14). Example: a closed switcher at a table
   with three bills reads «Cuenta 2 de 3 · Clint · 54,00 € ▾»; the ⋮ shows «Cuenta 2 · Clint» over
   its bill items and «Toda la mesa» over Guests… Finish table. Built behind the approval gate;
   landing waits for your yes. Changes Task 8d/9/10 strings and Task 14.
2. **Full invoice for a bill already paid.** Default: the ⋮ shows no Full invoice for a paid or
   issued bill, and the guide says a full invoice for a paid bill is a correction Waitron does not
   offer yet (A802). Alternative: show it quiet, and on tap explain that correction is not built
   yet — which needs a new sentence in both languages. Changes Task 10 and Task 14.
3. **Which Full invoice button stays on the table's payment step.** Today an unpaid table bill shows
   two (`docs/backlog.md:2488-2492`, whose next action is "draw both placements for the owner to
   pick which one stays"): the pay panel's own (which, at a table, actually opens the counter's
   invoice question) and the bill's smaller one beside the pay ways. **Pictures of both placements
   come from Task 15.** Default: keep the bill's own (it names this bill and its revision) and stop
   drawing the pay panel's at a table; the counter keeps its. Changes Task 12 only; the backlog
   entry stays, pointing at the pictures, until you answer (review-1 minor 5).
4. **Refund in the ⋮.** Board 13 lists "Give back a payment" in Bill ⋯. Default: Refund stays where
   it is, beside each payment in the payment window (one refund is of one payment), and the ⋮ has
   no Refund. Alternative: a ⋮ item that opens the payment window at its payments list. Changes
   Task 10.
5. **Filing tests, `scripts/` guards and deleted checks this slice changes** (review-1 C1). The
   full text, ready to paste, is in Task 0. Default: yes to every item. The build goes ahead on it;
   the PR cannot land until you answer. A "no" to item 1 means the two filing cases need a decision
   (they cannot stay as they are: joining no longer merges); a "no" to items 3–5 means keeping the
   `main_bill_id` column (see the alternative in the question) and changes Tasks 6c, 7 and 14.
   Item 1 also covers four checks added to the `:339` case. Before this branch, `:339` did not
   check that one sale covers both bills: it checked only the two sale counts, which also hold
   when nothing merges. That weakness predates the branch. The branch adds, copied from `:300`:
   `expect(await orderState(fromTab)).toMatchObject({ status: "abandoned" })`, `registroCount(intoTab)` 1, `registroCount(fromTab)` 0 and `filedSaleTotal(intoTab)` "3.50" (café 1.50 + agua 2.00). They fail when the case's Merge bills step is deleted. They stay only if you
   say yes.

   **5b. Three more deleted checks** (asked 2026-10-31 ~02:35, unanswered; questions.md, "question
   5b"). Default: yes to all three; the PR cannot land until it is answered.
   1. `apps/server/src/party-main-bill.test.ts:122`, "is cleared by setMainBill naming none": the
      function it checked is deleted with the main bill, so the check goes; nothing replaces it.
   2. The old "the receiving one is presented" case in `party-main-bill.test.ts` (`:132-155` before
      Task 6c): an order naming no bill was refused `tab.not_open` when the main bill pointed at a
      presented or another party's bill. Only the test helper could send such an order, so the
      check is retired and replaced by a case naming the bill and expecting `bill.presented` /
      `bill.other_party`. No product refusal code changes.
   3. Task 7's `party-bill-actions.test.ts` "A803 no main bill (writers)" lines: the `mainOf` helper
      (`:1283-1284`) and its 14 reads of `main_bill_id`; the case at `:1318` goes whole, the other
      seven keep their other checks. Task 7's "the main bill is gone" trigger test holds the
      guarantee afterwards.
6. **A paid bill on screen.** Default: the switcher lists paid bills and choosing one puts it on
   screen (as A1233 suggests), where the ⋮ offers Name this bill and Receipt copy, and New order
   refuses as it does for a paid bill today (`bill.paid`, `apps/till/src/state/draft-sync.ts:471-480`).
   Alternative: paid bills in the list are not choosable. Changes Task 9.
7. **What the table's foot holds until A739's Pay window lands** (review-1 I8). Your amendment 4:
   "The table screen's foot is the totals and Pay only." Today the foot also holds Comp the bill,
   and "Pay" on a till or tablet is not one button but the pay controls themselves: Cash, Card, Pay
   items, Contribute, Split equally, and this bill's Full invoice and receipt language (a handheld
   already has one Pay button that opens a pay sheet). A739's one Pay window, which would put all
   of those behind one Pay button, is parked. Worked example — Table 4, Bill 2 open, €38.50:
   the foot reads "Total €38.50", "Still to pay at this table €92.00", then Cash, Card, Pay
   items, Contribute, Split equally, Full invoice; Comp the bill is in the ⋮ under "Bill 2"; Hold
   is gone. Pictures from Task 15. Default: as in the example (D16). Alternative A: Comp the bill
   stays in the foot. Alternative B: every width uses the handheld's one Pay button and its sheet
   now — this moves the table's whole-bill payment from the pay panel's path to the bill-payment
   path, a money-path change best made with A739. Changes Task 12 only.

## Task 0: preflight, reservations and Owner question 5 (no commit, ≈15 calls)

- [ ] `git -C /Users/clintongormley/workspace/worktrees/waitron-feat-a803-3-bill-switcher status --short`
      clean apart from this plan's commits; `git log -1`. If main moved, rebase and re-resolve each
      line in the code map a task touches.
- [ ] Ledger: lane C's `item-a803-3-ledger.md` (the queue names it), `Status: in progress`, base
      sha, the owner-question defaults in force, and "PR parked until Q1, Q5, Q7 answered".
- [ ] Reservations: `grep -n 'A739\|A773\|A797\|A738\|A796\|A696\|A802' ~/waitron-campaign*/queue.md`;
      `gh pr list --state open --json number,title,headRefName,files`. Known: lane E's parked
      `feat/a696-startup-zone-validation` changes `bill-actions.ts` (`splitBill` gains an admission
      argument), `till-api.ts`, `working-order.ts` and till `i18n/strings.ts` — different functions
      from this slice's; whoever lands second rebases; do not wait. Lane F's parked
      `feat/a739-payment-window` (3e45abdc6) is a read-only reference, not a live branch. H1: no
      other PR of lane C is parked (a migration-adding item may start).
- [ ] **Re-check Owner question 5's file list** before writing it. Each command's output must be
      exactly what the item list names, else add the new file as an item:
      `rg -l 'bills: "|mainBillId|main_bill|partyMainBill|joinTables\(|moveGuests\(|combineParties\(|moveBill\(|splitTable\(|mergedInto|party\.main_bill_stays' apps packages -g '*filing*' -g '*fiscal*' -g '*huella*' -g '*inmutab*' -g '*golden*'`
      (planning run: `move-merge.filing.test.ts` and `order-portions.filing.test.ts` are the two
      the slice edits; `operation-authentication.fiscal.test.ts`, `recovery-operation.fiscal.test.ts`,
      `first-fiscal-setup.e2e.test.ts` and `first-fiscal-launch.test.ts` match only on the words
      "join"/"merged" in unrelated senses and are not edited);
      `rg -l 'main_bill|mainBill|release_main' scripts apps/server/scripts` (planning run:
      `scripts/behavioural-triggers.test.ts`; `scripts/migration-upgrade.test.ts` gains a row;
      `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` adapts);
      `rg -n 'mergedInto' apps/server/src -g '*.test.ts'` (planning run: `moved-slips.test.ts:108`, `:116`
      and `party-table-actions.test.ts:1569`, the latter a B row of Task 3a that tests the merge).
- [ ] **Append Owner question 5 to `~/waitron-campaign-c/questions.md`** (the lane's
      `questions.md`), as one `##` section, exactly this text with any file the re-check added:

      > ## A803 slice 3 (bill switcher, no main bill) — may these filing tests, guards and deleted checks change? The build goes ahead on "yes"; the PR waits for your answer (lane C, 2026-10-30)
      >
      > Why: this slice removes the party's hidden "main bill" and stops joining and moving guests
      > from merging bills by themselves (spec §3.4, §6). Your 2026-10-05 rule makes any change to a
      > filing test or a guard under `scripts/`, and any deleted check, a stop. These are all of them.
      > The fiscal suites that file sales (`split-bill.fiscal`, `till-api.fiscal-sale-paths`,
      > `transactional-series`, `bill-payments`, `bill-payments.card`, and `write-path.e2e` and
      > `inmutabilidad` in fiscal-verifactu) are not edited and run at every step.
      >
      > 1. **`apps/server/src/move-merge.filing.test.ts`**, cases at `:300-331` ("parties combined,
      >    bills merged → one registro") and `:333-` ("tables joined across parties, bills merged").
      >    They join two tables so the bills merge by themselves. The `:300` case then checks one
      >    sale covers both (its filed total is "3.50"). The `:339` case did not, before this
      >    branch: it checked only that the receiving bill files one sale and the other none,
      >    which also holds when nothing merges. Joining no longer merges. Before: the join, with
      >    `bills: "merge" as const` (the helper at `:215`). After: the same join, then the
      >    explicit Merge bills command staff will use (`mergeBills(tx, cfg, intoTab, fromTab, …)`)
      >    in the same transaction; the `:215` line goes. Every existing `expect` stays
      >    byte-for-byte. The `:339` case also gains four checks copied from `:300`: the other
      >    bill is abandoned, the receiving bill has one filing record and the other none, and the
      >    filed total is "3.50" (café 1.50 + agua 2.00). They fail when the Merge bills step is
      >    deleted. Recommended: yes, to both the setup change and the added checks.
      > 2. **`apps/server/src/order-portions.filing.test.ts:1159`**: `bills: "separate",` passed to
      >    `moveBill`. The option no longer exists and "separate" is now the only behaviour. Before →
      >    after: that one line deleted; nothing else. Recommended: yes.
      > 3. **`scripts/behavioural-triggers.test.ts`**: the two database triggers that cleared the main
      >    bill are dropped with its column. Before: `EXPECTED_TRIGGERS` lists
      >    `working_orders_release_main_bill` and `working_orders_release_main_bill_on_move`
      >    (`:158-159`), and `describe("working_orders_release_main_bill")` (`:1544-1590`) has five
      >    cases on the column. After: both names leave the list; the describe becomes "the main bill
      >    is gone", with two cases: `parties` has no `main_bill_id` column, and no trigger's SQL names
      >    `main_bill`. Recommended: yes.
      > 4. **`scripts/migration-upgrade.test.ts`, `RESETS`**: one new entry for the migration that
      >    rebuilds `parties`, worded like `core/0044_drop_table_bill_pointer`'s (`:437-439`):
      >    `refused: ["DROP TABLE \`parties\`", "FOREIGN KEY constraint failed"]`. It records that
      >    the migration needs a venue reset (it fails on any box that has ever seated a party).
      >    Recommended: yes.
      > 5. **`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:119-130`**: the captured
      >    Madrid demo database (hashed, not edited) has `parties.main_bill_id`. The test's adapter,
      >    which already adds columns newer than the capture, also removes that column and its
      >    foreign key from what it expects. Recommended: yes.
      > 6. **Checks deleted with what they checked.**
      >    a. `apps/server/src/moved-slips.test.ts:108` and `:116` set and read a `mergedInto` map
      >       whose only writer was the automatic merge. The map goes, and so do those two lines; the
      >       case's other checks (the inner call gets the outer call's slips; the kitchen is told
      >       once) stay.
      >    b. `apps/till/src/widgets/bill-choice-dialog.test.ts` and `.a11y.test.ts`: the "Merge the
      >       bills / Keep separate bills" question is retired (spec §3.4), so its window and its tests
      >       go. New cases fail if a join or move on the table screen, the floor or the parked orders
      >       draws any question or sends a merge choice.
      >    Recommended: yes to both.
      >
      > The one way to avoid items 3–5: keep the `main_bill_id` column in the database until A760's
      > migration squash, and only stop the code using it. Not recommended: the column would stay
      > typed and writable in the code, so "nothing picks a bill for you" would rest on review alone,
      > and the two triggers would keep acting on a column nothing reads.
      >
      > Answer "a803-3 q5 y" for all, or name the items you want done differently.

- [x] Baselines, each separately, recording the Tests counts: S, H2, F, Filing, G, words and codes.

## Task 1: `createPartyBill`, `insertPartyBill` and `POST /api/parties/:id/bills` (≈45 calls)

**Files.** `apps/server/src/parties.ts` (new internal `insertPartyBill` and exported
`createPartyBill` beside `partyMainBill`, which stays until Task 6c; D1); `apps/server/src/till-api.ts`
(route beside `GET /api/parties/:id/bills` `:3178`, modelled on `PUT /api/parties/:id/name`
`:3023-3040`: session `take-orders`, `requirePartyParam`, `requireRevision(body.expectedPartyRevision, …)`,
`checkZones(tx, deps.cfg, session, [{ partyId }])`, `catchUpFloor(tx)` as split-table does `:3152`);
tests `apps/server/src/party-bill-create.test.ts` (new), `apps/server/src/till-api.parties.test.ts`,
rows in `till-api.profile-actions.test.ts` (table at `:112-114`, case list near `:439`) and
`till-api.profile-zones.test.ts` (table `:164-167`, list near `:934-941`).

- [x] Cases `A803 create bill:` (domain, `useVenueDb`): "makes an empty open bill on the party
      numbered next after its highest number, in the party's zone, and moves the revision by one";
      "after Bill 2 was merged away the new bill is Bill 3" (slice 2's history rule); "a stale
      revision refuses `party.out_of_date` and writes nothing" (compare `working_orders`,
      `bill_identities`, `bill_number_allocations` and the party row before and after, outside the
      failed transaction); "a closed party refuses `party.not_open`, writing nothing"; "two
      requests with the same revision: the second refuses `party.out_of_date` and only one bill
      exists"; "`insertPartyBill` makes the same bill and leaves the party's revision where it was".
      Route cases `A803 create bill route:` answer `{ billId, revision }` (200), 400 on a missing or
      malformed revision, 401 without a session, `party.not_open` for a malformed party id;
      profile-action row (`take-orders`) and profile-zone row (a party outside the device's zones
      is refused) — new rows only.
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-bill-create.test.ts src/till-api.parties.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts -t 'A803|bills'`.
      The domain cases fail on the missing export as the first red; once a stub returns nothing,
      they must fail on the bill/revision assertions; the route cases on a 404 status.
- [x] Implement (D1). No submission replay: the revision guard is what stops a resend making two
      bills, as for every other party command that takes `expectedPartyRevision`.
- [x] GREEN: the four files unfiltered; F; server typecheck; till typecheck (untouched, still clean).
- [x] Commit: "Let the till ask for a new empty bill at a table".

## Task 2: Move this bill never merges on arrival (≈55 calls)

**Files.** `apps/server/src/move-bill.ts` (merge decision `:191-201`, `mergingEdits` `:203-206`,
merge arm `:303-312` go, so a seated arrival always takes `allocateBillNumber` and
`moveBillDraftsToParty` as the not-merging arm does `:313-317`; `refuseMainBillLeaving` `:515-535`
and its call `:222` go; **`MoveBillOptions.bills` `:73` becomes optional and is no longer read, and
`MoveBillResult.merged` `:85` is always `false`** — both are deleted in Task 4b with the sweep, so
this task does not break the ~60 test files that pass `bills` (review-1 I1); `isUntouched` and
`readBillState` `:549-570` stay until Task 3b, because `table-actions.ts:15`, `:280-281` still call
`isUntouched`; `readMainBill` stays for `:286`/`:319`, removed in 6b); `apps/server/src/till-api.ts`
(`moveCommand` `:908-923` stops reading `bills`; `requireBillChoice` stays for
`tableActionCommand` until Task 4b); tests `party-move-bill.test.ts`, `till-api.move-bill.test.ts`,
`bill-identities.test.ts` (move helper `:256`), `order-drafts.db.test.ts:4863`, and every other
file in `rg -l "moveBill\(|/move\b" apps/server/src -g '*.test.ts'` whose red run changes (each
listed in the receipt). No test's `bills` property is removed in this task.

- [x] **Write and run the new cases red BEFORE touching `move-bill.ts`** (review-1 minor 8): they
      rely on the `move()` helper's default `bills: "merge"` (`party-move-bill.test.ts:122-133`),
      which stays until Task 4b. New cases `A803 no main bill (move):` in `party-move-bill.test.ts`:
      "a bill moved to a seated table with an untouched bill of the same service mode arrives as
      its own bill with the next number, and the receiving bill is unchanged" (both untouched, one
      mode — the case the merge would have caught); "a party's first bill can move away while it
      holds other unpaid bills"; "a counter order moved to a seated table stays its own bill"; and
      in `till-api.move-bill.test.ts` "a request still carrying `bills: \"merge\"` is served the same
      way" (D13).
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts src/till-api.move-bill.test.ts -t 'A803 no main bill'`.
      Expect the first case to fail on the receiving bill's lines (the merge moved them) and the
      second on `party.main_bill_stays`.
- [x] Implement. Then run every file the trace lists: `rg -l 'moveBill\(|/api/bills/.*/move|bills: "merge"' apps/server/src -g '*.test.ts' | sed 's#apps/server/##' | xargs pnpm --filter @waitron/server exec vitest run`.
      Each red assertion is either in the Changed test checks rows for Task 2 (change it as that row
      says) or a stop. `split-bill.test.ts` and the two Filing files must stay green unedited here.
- [x] GREEN: that list unfiltered; F; H2; Filing; server typecheck.
- [x] Commit: "Move this bill keeps the bill separate at its new table" (committed red), then
      "Keep separate bills separate in the tests that moved a bill onto a table" for the seven rows
      found at the red run.

## Task 3a: Join and Move guests keep every bill (≈65 calls)

**Files.** `apps/server/src/table-actions.ts` (`combineParties` `:246-363`: the `merging` decision
`:276-288`, `requireBillEditors` for the merge `:289-294`, `fromMainState` and the merge block
`:296-328` go; bills move with `takeIntoParty` as today `:298-303`; `rescopeBillNumbers` stays after
the move `:331`; `moveDraftsToParty` takes every moving bill's edits; `mergedInto` is now always
empty and is retired in 3b; the answer keeps today's shape with `merged: false` until Task 4a;
`TableActionOptions.bills` becomes optional and unread until 4b); tests `party-table-actions.test.ts`,
`table-actions.refund-pending.test.ts`, `order-drafts.db.test.ts` (`merge()` helper `:3418-3427`),
`bill-identities.test.ts:595`, `move-merge.test.ts:493`, `move-merge.filing.test.ts` (Owner question
5 item 1: built on the default), and every other file in the trace whose red run changes.

- [x] **New cases first, red before touching `table-actions.ts`** (minor 8: they rely on `opts()`'s
      default `bills: "merge"`, `party-table-actions.test.ts:87-100`, which stays until 4b). Cases
      `A803 no main bill (join):` in `party-table-actions.test.ts`: "joining a seated table whose
      party has an untouched bill of the same mode keeps both parties' bills, each with its own
      number and lines" (both untouched, one mode — the merging case); "Move guests onto a seated
      table keeps every bill and every payment on its own bill" (pay part of one bill first;
      compare `bill_payments` rows by bill before and after); "the kitchen hears only that dishes
      moved table, never a merge" (moved notices only).
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts -t 'A803 no main bill'`
      — fails on the receiving party's bill count (merged to one). (Run: 3 failed — the two
      answer checks on `merged: true` and the kitchen case on the incoming bill `abandoned`.)
- [x] Implement; `move-merge.filing.test.ts` gets its kind-S setup change and its `:215` line's
      removal only (Q5 item 1).
- [x] Run every file in `rg -l 'joinTables\(|moveGuests\(|combineParties\(|/api/parties/.*/(join|move)|bills: "merge"|bills = "merge"' apps/server/src -g '*.test.ts'`;
      each red assertion is a listed row or a stop. `split-bill.test.ts` must stay green (its
      `:1019` passes `bills: "merge"`; if it goes red, stop: that file was meant to stay unchanged).
- [x] GREEN: that list; F; H2; Filing; `git diff a90f4f87b -- apps/server/src/move-merge.filing.test.ts | /usr/bin/grep '^[-+].*expect'`
      prints nothing; server typecheck. (That grep also matches the two added
      `expectedPartyRevision:` setup lines; at Task 3a's commit `/usr/bin/grep '^[-+].*expect('` printed nothing. Since the
      Task 3a review fix 8184f7597 it prints only `+` lines: the four checks added to the `:339` case, Q5 item 1. No `-` line.)
- [x] Commit: "Joining or moving guests keeps every bill separate".

## Task 3b: retire the merge helpers and the kitchen-slip merge map (≈30 calls)

**Files.** `move-bill.ts` (`isUntouched`, `readBillState` `:549-570` and the `serviceModesMatch`
import `:52` go); `table-actions.ts` (the `isUntouched`/`serviceModesMatch` imports `:15`, `:46`;
`combineAt`'s slip mapping `:224-226`); `working-order.ts:3980-3990` (`serviceModesMatch` deleted,
D12; `modesMatch` stays); `moved-slips.ts` (`SlipsLater.mergedInto` `:16`, `:43-45`: `SlipsLater`
stays as the token an outer call hands down, with no field); `kitchen-print.ts:1880-1893`
(`enqueueMovedSlipsFor` loses `mergedInto`: each bill's moved slip goes onto itself);
`moved-slips.test.ts:108`, `:116` (Q5 item 6a, built on the default). The explicit Merge's own slips
(`bill-actions.ts:281`) are untouched (review-1 minor 2).

- [x] Before editing: `rg -n '\bisUntouched\b|\breadBillState\b|\bserviceModesMatch\b|mergedInto\b|enqueueMovedSlipsFor' apps/server/src`
      — every hit is in the files above, `party-table-actions.test.ts:1569` (already a Task 3a row)
      or `mergedIntoPartyId` (a different column, untouched). (Run: as said; the test hit was at
      `:1591`; `serviceModesMatch`'s imports in `move-bill.ts` and `table-actions.ts` had already
      gone in Tasks 2/3a, leaving only its definition; `mergedInto` also named
      `CombineResult.mergedInto`, now always empty, which goes too.)
- [x] Remove `combineParties`' unused `_attendance` parameter and its `void _attendance;`
      (`table-actions.ts:256-259`), and the argument its callers pass to it. (Built: with
      `noUnusedParameters` on, removing the argument left `combineAt`'s `attendance` unread, and
      then `moveGuests`' and `joinTables`'; each went in turn, with the recorder argument the
      move/join route passed (`till-api.ts:3091`) and the test fixture's pass-throughs
      (`testing/table-action-fixture.ts`). `splitTable` keeps its `attendance`, which it reads.)
- [x] RED is the deletion itself: the server typecheck fails on the removed names until each
      caller is updated (record the first run's errors). (First run: `moved-slips.test.ts(108,17)`
      and `(116,19)` TS2339 `mergedInto` does not exist on `SlipsLater`; `table-actions.ts(201,3)`
      TS6133 `attendance` never read; `testing/table-action-fixture.ts(97,5)` TS2554 expected 3
      arguments, got 4.)
- [x] GREEN: `pnpm --filter @waitron/server exec vitest run src/moved-slips.test.ts src/kitchen-print.test.ts src/party-table-actions.test.ts src/move-merge.test.ts src/party-move-bill.test.ts src/party-bill-actions.test.ts`
      (add any file the `rg` above names); F; Filing; server typecheck; the `rg` prints only
      `mergedIntoPartyId` lines. (Run: 341 passed in 6 files; F 267 in 5; H2 20 in 2; Filing 67
      in 2; every test file naming a join, move, combine, the slip helpers or the fixture, 2672 in
      61; the other test files importing `kitchen-print`, `moved-slips`, `move-bill` or `working-order`, 4822 in 153; server and till typechecks clean. The `rg` prints `enqueueMovedSlipsFor`'s definition and
      its one call in `moved-slips.ts`, which stay as planned, and `mergedInto` keys holding
      `parties.mergedIntoPartyId` in `receipt-guests.ts` and `testing/bill-identities.ts`.)
- [x] Commit: "Retire the helpers and the slip map only the automatic merge used".

## Task 4a: action answers name their bills; Split a table takes any bill; the code goes (≈65 calls)

**Files.** `table-actions.ts` (`TableActionResult` `:67-71` → `{ partyId: string; billIds: string[] }`,
`CombineResult` `:73-78` gone and `combineParties` returns `void`; `moveGuests`/`joinTables`/`combineAt`
answer the destination party's shown bill ids in number order (a small `partyBillIds(tx, partyId)`
beside `readPartyBillIds`), inserting one empty bill with `insertPartyBill` first when there is none
(D1); `splitTable` `:380-455` answers `{ partyId; billId }`: the chosen bill, or a new empty bill on
the new party (`insertPartyBill`, replacing `partyMainBill(... "moved")` `:428`), and an empty bill
on the staying party when it is left with none; `refuseUnsplittableBill` loses its main-bill rule
`:476` and its parameter); `till-api.ts` (the route answers pass the new shapes, keeping
`zoneRevisions` exactly where today's answers carry it; `STATUS` `party.main_bill_stays` `:606`);
`errors.ts:481-486` (the code goes, D14); tests `till-api.table-actions.test.ts`,
`till-api.today-joins.test.ts`, `floor-today-flatten.test.ts`, `party-table-actions.test.ts` split
cases, `table-actions.refund-pending.test.ts` shapes, `till-api.zone-closed.test.ts:310-318`,
`order-kitchen-note.moves.test.ts:234`, `print-problems.test.ts:1808` if its red run is here.
`bills` stays optional and unread (4b).

- [x] New cases `A803 action results:` in `till-api.table-actions.test.ts`: exact `toEqual` answers
      for Move guests to a free table, Join a free table, Move guests onto a seated table, Join a
      seated table (each `{ partyId, billIds }` in number order, plus `zoneRevisions` exactly where
      today's answer has them); "split a table giving away the party's first bill answers that
      bill, which is Bill 1 at the new party, and the staying party keeps its others"; "split with
      no bill answers one new empty bill, and the staying party is unchanged"; "split taking the
      staying party's only unpaid bill, with no other bill left, leaves the staying party one new
      empty bill" (D1); "a party with no bill that joins a free table answers one new empty bill,
      not two" (seed by moving its only bill to the counter); "the party's revision moves once per
      action, also when a bill was inserted" (I5); "no answer carries `mainBillId`". (Built: 10
      cases, the last also checking no `merged` key.)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/till-api.table-actions.test.ts -t 'A803 action results'`
      — fails on the answer shape (`mainBillId` present) and on `party.main_bill_stays`. (Run: 10
      failed, 70 skipped: the four answers carried `mainBillId`/`merged`; the two splits of the
      first bill answered 409; no bill was inserted for a party with none.)
- [x] Implement; then the trace's files (Task 3a's list plus `rg -l 'splitTable\(|split-table' apps/server/src -g '*.test.ts'`).
      (Built: `partyBillIds` is private to `table-actions.ts`, not beside `readPartyBillIds`, since
      it reads numbers through `VENUE_SERVICE`; an inserted bill is still recorded as the party's
      main bill (`insertMainBill`) until Task 6b, as `partyMainBill` did; `moveGuests`/`joinTables`
      take `OriginConfig`, which `insertPartyBill` needs. First trace run, 62 files: 63 red, 57 of them
      an answer-shape pin (W) or the `party.main_bill_stays` rows (B): `till-api.table-actions` 8
      (`:97`, `:111`, `:156`, `:172`, `:186`, `:469`, the refusal list and the guest-count refusal
      list: each main-bill row now a success after the other refusals, answering the first bill,
      the revision +1, or the counts 1/1); `party-table-actions` 21 (13 answers → `billIds`; the
      combine answer → `undefined` plus a `partyRow(...).mainBillId` check carrying the value the
      answer held; split `:1123` → `{partyId, billId: b2}` plus `numbersOf` `[[b2, 1, null]]`;
      `:1145`, `:1174` → `billId`; "refuses the main bill" → "takes the party's first bill … Bill 1
      at the new party", which pins both parties' numbers and tables); `bill-editing.table-actions`
      9 (`merged: false` → `toEqual` of `{partyId: into, billIds: [into, from]}`, `undefined` for
      combine); `print-problems` 7 (its `mergeBills` helper's join answer); `table-actions.refund-pending`
      7; `till-api.today-joins` 4 (`mainBill()` → `onlyBill()`, which also checks the party has one
      bill); `till-api.zone-closed` 1; and 6 more that fail at runtime as well as at typecheck,
      `bill-identities.test.ts:534`, `:608`, `:645`, `floor-today-flatten.test.ts:430-431`,
      `order-kitchen-note.moves.test.ts:234`.)
- [x] GREEN: those files; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`
      (run, not edited); F; H2; Filing; server typecheck; `rg -n 'party\.main_bill_stays|CombineResult' apps/server packages`
      prints nothing. (Run: trace 2843 passed in 62; guards 36 in 2; F 267 in 5; H2 20 in 2; Filing
      67 in 2, both files unchanged; server and till typechecks clean; `pnpm format:check` clean;
      the `rg` exits 1. Deletion controls in `till-api.table-actions.test.ts`: no insert for a party
      with none → 3 fail; no staying-party insert → 1 fails; number order reversed → 7 fail.)
- [x] Commit: "Table actions answer the bills they leave, and Split a table takes any bill".

## Task 4b: the `bills` option and `merged` flag go, by a mechanical sweep (≈45 calls)

**Files.** `move-bill.ts` (`MoveBillOptions.bills`, `MoveBillResult.merged`); `table-actions.ts`
(`TableActionOptions.bills` `:59`); `till-api.ts` (`requireBillChoice` `:882-886` and its uses,
`tableActionCommand` `:929-938`, the seat route's hard-coded `"merge"` `:2858-2866`);
`floor-today-merges.ts:137-144`; `testing/party-venue.ts:313` (join helper's `bills`); the sweep over
`apps/server/src` (61 files, 196 literal sites, plus `bills,` shorthand and helper parameters);
`order-portions.filing.test.ts:1159` (Q5 item 2) and `split-bill.test.ts:539`, `:1019` (F rows).

- [x] New cases first: `A803 no merge flag` in `party-move-bill.test.ts`: "the answer is
      `{ partyId, billId }` with no `merged` key" (`toEqual`); in `till-api.table-actions.test.ts`
      and `till-api.move-bill.test.ts`: "a `bills` key of any value, including an invalid one, is
      ignored" (D13; replaces the two 400 rows). (Built: one party-move-bill case covering a
      party, a free table and the counter; the move route's row and the table routes' move and
      join rows each run `"merge"`, `"separate"`, `"together"`, `null`, `1` and answer 200 with the
      exact `toEqual` answer, both bills open.)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts src/till-api.table-actions.test.ts src/till-api.move-bill.test.ts -t 'A803 no merge flag|bills key'`.
      (Run: 12 failed, 5 passed, 192 skipped: the three move answers carried `merged`; the
      invalid values answered 400; the table routes' `"merge"`/`"separate"` rows already passed.)
- [x] Implement the product deletions. Then the sweep, a script kept outside the repository that,
      for each file in `rg -l 'bills: "(merge|separate)"' apps/server/src`, deletes every line that
      is exactly `\s*bills: "(merge|separate)"( as const)?,\s*$` and nothing else. Then fix the
      leftovers by hand from `rg -n 'bills: "(merge|separate)"|bills = "merge"|\bbills,|bills\?:' apps/server/src`
      (inline objects, helper parameters, `{ ...opts, bills }`). Each hand edit is a property or
      parameter deletion; anything else is a stop.
      (Done: product deletions in `move-bill.ts`, `table-actions.ts` (also `combineParties`'
      `bills` argument), `till-api.ts`, `floor-today-merges.ts`, `testing/party-venue.ts`. Sweep:
      122 lines in 61 files. Hand fixes: 70 lines in 14 files by a second outside script (a
      `bills: "…"` property inside a one-line object, or a whole `{ bills: "…" }` argument to a
      helper whose options default to `{}`); helper parameters and their call-site arguments in
      `bill-editing.bill-moves`, `bill-editing.table-actions`, `bill-identities`, `receipt-guests`,
      `party-table-actions`, `order-kitchen-note.moves` and `floor-today-flatten-api`; the
      `it.each` callback parameter in `order-kitchen-note.moves.test.ts`, removed (`async (bills) =>`
      → `async () =>`, now at `:193`). Left
      alone: the `bills,` shorthand that `it.each` rows send in HTTP bodies in
      `till-api.allergy-move.test.ts:558` and `table-actions.refund-pending.test.ts:204`, `:232`.
      An HTTP body has no type, and deleting the key would leave each row's parameter unused.
      Changed checks: `merged: false` dropped from 39 `toEqual` answers in 9 files (W); `till-api.move-bill.test.ts:411`
      `toMatchObject({partyId, billId, merged: false})` → `toEqual({partyId, billId})` (W);
      `bill-identities.test.ts:321`, `:346` `toMatchObject({merged: false, billId})` →
      `toEqual({partyId: to.partyId, billId})` (W); `party-move-bill.test.ts:831`, `:957`
      `expect(result.merged).toBe(false)` → `expect(Object.keys(result).sort()).toEqual(["billId", "partyId"])`
      (B, D13); `till-api.allergy-move.test.ts:213`'s answer cast loses `merged: boolean` (F); the
      two 400 rows → the D13 cases above (B). Each check is as strict as before or stricter.
      Titles left stale by the deletions, not retitled (a retitle is not a deletion):
      `till-api.table-actions.test.ts:112` ("… or with one"), `till-api.move-bill.test.ts:1171`
      (now the same as the D13 `"merge"` row), `till-api.today-joins.test.ts:201`,
      `floor-today-flatten-api.test.ts:371`, `:463`, `:491`, `:543`, `bill-identities.test.ts:313`,
      `:337`, `:592`, `:820`, `bill-editing.bill-moves.test.ts:238`,
      `bill-editing.table-actions.test.ts:223`, `:247`, `:269`, `party-arriving-dishes.test.ts:974`,
      `party-move-bill.test.ts:342`, `:908`, `party-table-actions.test.ts:351`, `:1022`, `:1597`,
      `:1612`, `order-kitchen-note.moves.test.ts:192`.)
- [x] GREEN: server typecheck (the type no longer has the field, so any missed site fails here);
      `git diff --name-only HEAD -- apps/server | /usr/bin/grep 'test.ts$' | sed 's#apps/server/##' | xargs pnpm --filter @waitron/server exec vitest run`;
      F; H2; Filing (and `git diff a90f4f87b -- apps/server/src/order-portions.filing.test.ts` shows
      exactly the one deleted line); `rg -n 'bills: "(merge|separate)"|requireBillChoice|\bmerged\b' apps/server/src packages`
      prints nothing but unrelated `merged` words (list them in the ledger).
      (Run: server typecheck clean; the changed files, 60, 2709 passed in 60; F 267 in 5; H2 20 in
      2; Filing 67 in 2, and `order-portions.filing.test.ts`'s diff from `a90f4f87b` is the one
      `bills: "separate",` line; the F/H2 diff is empty; till typecheck clean; `pnpm format:check`
      clean; eslint on the changed files clean. The `rg` prints 383 lines: words about parties
      merged into others, the `table.merged` code and its tests, and local variables named
      `merged`, plus two lines that mention the retired things: Task 4a's
      `not.toHaveProperty("merged")` (`till-api.table-actions.test.ts:790`) and the stale title at
      `till-api.move-bill.test.ts:1171`. Deletion controls: refusing an invalid `bills` again in
      both commands → 9 of the D13 rows fail; putting `merged: false` back in the move answer →
      6 fail.)
- [x] Commit: "Retire the bills option and the merged flag".

## Task 5: the server lists a party's bills in number order (A1232) (≈25 calls)

**Files.** `parties.ts:684` (`readBillsOfParties` sorts the rows it returns by `billNumber`, null
last, then `workingOrderId`, after reading identities `:689-`); tests `parties.test.ts`,
`party-table-actions.test.ts:709-713`.

- [x] Case `A803 bill order:` "a party whose Bill 2 was opened before its Bill 1 arrived lists Bill
      1 first" (join a seated party whose own bill is older than the joining party's: numbers and
      opening order disagree). (Built at `parties.test.ts:1799`: the earlier-seated party's guests
      move to the later party's table; a precondition reads the two bills in the old order
      (opened, order number, id) and asserts it is `[early, late]`; the list must be
      `[[late, 1], [early, 2]]`.)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/parties.test.ts -t 'A803 bill order'`.
      (Run: 1 failed, 77 skipped: the list came back `[[early, 2], [late, 1]]`, opening order.)
- [x] Implement; run `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/parties.test.ts src/till-api.parties.test.ts src/order-drafts.db.test.ts src/unpaid-departure.test.ts src/table-signals.test.ts`.
      Only the A1232 pin (and pins of the same list whose bills' numbers and opening order differ)
      may change; anything else is a stop, and then this task is reverted and A1232 stays a residual.
      (Done: `readBillsOfParties` sorts by `billNumber`, null last, then `workingOrderId`
      (`parties.ts:753`); `readPartyBills`' comment says so. That run: 2 failed, 647 passed in 6
      files. The whole server suite then: 2 more failed, 26863 passed, 25 skipped in 1129 files.
      All four are pins of this list whose numbers and opening order differ, changed to number
      order (kind B, A1232, D15): `party-table-actions.test.ts:712` (the A1232 pin, numbers 1, 2, 3)
      `[ana, luis, second]` → `[luis, ana, second]`, each tuple gaining its `billNumber`;
      `parties.test.ts:1127` (merged parties, numbers 1, 3, 4, none) abandoned tab first → last,
      each tuple gaining its `billNumber`; `bill-identities.test.ts:781` `[anaSecond 2, luis 1]` →
      `[luis 1, anaSecond 2]`, retitled from "… while the list keeps its opening order" to "… and
      is listed after the party's own Bill 1"; `bill-identities.test.ts:833` the abandoned bill
      moves from second to last. Nothing else red.)
- [x] GREEN: those files; server typecheck. (Run: the six files 649 passed in 6;
      `bill-identities.test.ts` 54 passed; server typecheck clean; `pnpm format:check` clean; the
      F/H2 diff from `a90f4f87b` empty. Controls: the sort deleted → 3 fail (the new case and the
      two pins in `parties.test.ts` and `party-table-actions.test.ts`); nulls sorted first → the
      merged-parties pin and `bill-identities.test.ts:820` fail, with `:838` (a bill with no
      identity row) as well. The id tie-break was not given a control: none of the four changed
      pins or the new case lists two bills with one number. `unpaid-departure.ts` issued a departing party's invoices in this list's order, so
      they followed bill number; its suite did not tell the two orders apart (it passed under
      both). The review fix (D15 addendum) keeps a departure's invoices in opening order and pins
      it with `unpaid-departure.test.ts` "A803 departure order: invoices the bill opened first
      first, when its bill number is the higher one", and gives the id tie-break a control with
      `bill-identities.test.ts` "A803 bill order: two abandoned bills are listed last, in id
      order, not in the order they were opened". A1232 deleted from the backlog;
      the till's `shownBills` still sorts the same way, now redundantly.)
- [x] Commit: "List a party's bills in number order on the server".

## Task 6a: the test helpers stop relying on the main bill (≈50 calls)

**Files.** `apps/server/src/testing/group-submit-fixture.ts` (`observation` `:27-36`: with no
`billId`, `firstOpenBillOf(tx, partyId)`; when that is none, `insertPartyBill(tx, cfg, partyId)`
and, only when `revisionMoved` is not set, `bumpPartyRevision(tx, partyId)` — exactly the revision
handling `partyMainBill(..., revisionMoved ? "moved" : "move")` had (`parties.ts:186-193`), so the
revision moves once where it moved once (review-1 I5); `observedGroupSubmitBody` `:135-157`: the
party's `firstOpenBillOf` read instead of `parties.mainBillId`); `testing/draft-command-fixture.ts:141-148`
(same read); `testing/serve-line.ts:41` (`setMainBill` call goes: seating's bill is found by number);
`testing/bill-venue.ts:466` (comment). New `apps/server/src/testing/party-bill-of.ts` exporting
`firstOpenBillOf(tx, partyId)`: the party's lowest-numbered `open` bill, else null.

**The one behaviour difference, and what it does to tests.** When the main bill is null but the
party still has an open bill (after the main bill moved away or was presented), the old helper
made a NEW bill; the new one picks the existing lowest-numbered open bill. Any case whose sent
bill changes for that reason, whether or not it goes red, is re-expressed (kind S, its own
Changed-checks row with file:line): its setup calls `insertPartyBill` and passes that id, which is
exactly what the old helper did, and every `expect` stays byte-identical. A red case for any other reason is a stop. The one such case,
`current-orders.test.ts:1279`, stayed green; the Task 6a review found it with a logging probe at
the helper's choice points, not by a red run.

- [x] Case `A803 fixtures:` in `apps/server/src/testing/party-bill-of.test.ts`: "names the
      lowest-numbered open bill, skipping paid and presented ones", "names none for a party whose
      bills are all paid", "names Bill 1 over an older-opened Bill 2" (numbers against opening order).
      (As built: `firstOpenBillOf` orders by the `bill_identities` number, unnumbered last, then
      id, reading that table itself, so it does not rest on Task 5's list order.)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/testing/party-bill-of.test.ts`.
      (Failed to load: "Cannot find module './party-bill-of.js'", Tests: no tests.)
- [x] Implement; the main bill still exists. Run `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts src/till-api.drafts.test.ts src/party-arriving-dishes.test.ts src/served.test.ts`
      and every file importing the helpers whose cases send without a bill
      (`rg -l 'orderForParty\(|observedGroupSubmitBody|observedDraftCommandBody|submitGroups\(|placeGroups\(' apps/server/src -g '*.test.ts'`),
      including `party-main-bill.test.ts:157` ("moves the party revision once") and `:356-358`,
      which must stay green unedited.
      (**Departure, driver's decision 2026-10-31.** Built as written, the helper turned 15
      existing cases red, none of them for the one difference above: 13 assert that the party's
      `mainBillId` is the bill the helper made (`party-main-bill.test.ts:98`, `:115`, `:171`,
      `:362`, `:422`, `:460`; `parties.test.ts:662`, `:767`; `party-move-bill.test.ts:774`,
      `:1218`; `party-table-actions.test.ts:682` twice, `:1181`), and 2 expect the old helper's
      `tab.not_open` when a hand-written main bill names a presented or another party's bill
      (`party-main-bill.test.ts:148`). So `group-submit-fixture.ts`'s `openBillFor` still writes
      the main bill on a bill it creates (`setMainBill`, as Task 4a's `insertMainBill` does) and
      keeps the old refusal when `mainBillId` names a bill that is not this party's open one;
      otherwise it sends to `firstOpenBillOf`. Both spots carry a one-line comment that Task 6c
      removes them with its `party-main-bill.test.ts` rewrite. It also keeps the old helper's
      `party.not_open` refusal of a closed party. No test was edited and no Changed-checks row is
      added. `serve-line.ts` loses its `setMainBill` as planned; nothing went red for it.)
- [x] GREEN: those files; F; Filing; server typecheck. (Every server test file importing
      `group-submit-fixture`, `draft-command-fixture` or `serve-line`, directly or through another
      `testing/` helper, plus F's `till-api.fiscal-sale-paths`: 320 files, 9740 passed, 0 failed,
      run in four chunks. F 267 passed (5 files); Filing 67 passed; H2 20 passed; new file 3
      passed; server typecheck clean; `pnpm format:check` clean. Controls: the open-status filter
      deleted → 2 of 3 fail; ordering by opening time instead of number → "names Bill 1 over an
      older-opened Bill 2" fails.)
- [x] Commit: "Server test helpers find a party's bill by number".

## Task 6b: the table actions stop reading and writing the main bill (≈60 calls)

**Files.** `table-actions.ts` (`readMainBill` imports and calls left after 4a, `:127`, `:191`,
`:326`, `:406`, `:449`, and any main-bill write); `move-bill.ts` (`:191`, `:286`, `:319`,
`SourceParty.mainBillId` `:498`, `:504`); `bill-actions.ts` (`:209` comment, `:237-282`
`known.mainBillId` and `setMainBill`). Seating (`seatTable`) still names a main bill until 6c;
nothing reads it after this task except `partyMainBill`'s own callers. Tests: the main-bill
assertions that pin these writers — `party-table-actions.test.ts`, `party-move-bill.test.ts`
(`:827`, `:941`, `:1203`, `:292`), `party-bill-actions.test.ts:690`, `:736`,
`till-api.table-actions.test.ts`, `till-api.today-joins.test.ts`, `table-actions.refund-pending.test.ts`,
`floor-today-flatten.test.ts` — each re-pointed to the bills themselves (their party, status and
number), as their rows say.

- [x] New case `A803 no main bill (writers):` in `party-bill-actions.test.ts`: "Merge bills, Move
      this bill, Join and Split a table never SET a party's `main_bill_id`": the new party of a
      split, and a party that receives a bill or guests, keep the value they had or null — the only
      change allowed is the existing triggers clearing it (read the column before and after; it
      still exists until Task 7). Expected red on the writers still naming one after Task 4a —
      `mergeCheckedBills` (`bill-actions.ts:280`) and `moveBillOnce` (`move-bill.ts:286`, `:319`)
      by reading; record which go red, and if a writer's sub-case is already green say so in the
      ledger (the case still guards it). (Built as a `describe` of 8 cases, one per writer: Merge
      bills of the main bill; Move this bill to a free table; Move this bill onto a party whose
      main bill was cleared; Join a seated table by a party whose main bill was cleared; Join a free
      table by a party with no bill (D1's inserted bill); Split a table taking an open bill; Split
      with no bill; Split taking the staying party's only bill (both inserted bills).)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-bill-actions.test.ts -t 'A803 no main bill'`.
      (Run: 8 failed, 58 skipped, each on its `mainOf(...)` `toBeNull()` receiving a bill id; none
      already green. Beyond the two writers named by reading, `combineParties` (`setMainBill` of
      `from`'s main), `splitTable` (the new party's chosen bill) and Task 4a's `insertMainBill`
      (split with no bill, `ensureShownBill`) also still wrote one.)
- [x] Implement; run the files above plus the trace's
      `rg -l 'mainBillId|main_bill' apps/server/src -g '*.test.ts'`. A red assertion in a file that
      Task 6c owns (it pins seating or `partyMainBill`) must not appear here; if one does, stop and
      move the writer change, not the test.
      (Done: `combineParties` reads only guest counts; `splitTable` and `ensureShownBill` call
      `insertPartyBill`, and `insertMainBill` goes; `moveBillOnce` and `mergeCheckedBills` write and
      read no main bill, and `mergeCheckedBills` loses its `known.mainBillId` and its `partyId`
      parameter, which only that bookkeeping read (three test call sites, kind F row).
      `SourceParty.mainBillId` had already gone. First run of the 19 files (the trace's 16 plus
      `party-move-bill`, `party-bill-actions` (also in it), `floor-today-flatten`, `till-api.table-actions`,
      `till-api.today-joins`, `table-actions.refund-pending` and the three `mergeCheckedBills`
      callers): 6 failed, 1311 passed — exactly the six B rows marked "Task 6b's red run" above,
      none in a file Task 6c owns. `party-bill-actions.test.ts:690` stayed green.)
- [x] GREEN: those files; F; H2; Filing; server typecheck. (Run: the 19 files 1317 passed, exit 0;
      every other test file calling a table action, a bill move or a merge
      (`rg -l 'moveBill\(|joinTables\(|moveGuests\(|splitTable\(|combineParties\(|mergeBills|mergeCheckedBills|/move|/join|/split-table|/merge' apps/server/src -g '*.test.ts'`,
      102 files beyond those 19) in three chunks: 1971, 1047 and 1578 passed, each exit 0. F 267
      passed; Filing 67 passed, both files unchanged from HEAD; H2 20 passed; server typecheck
      clean; prettier and eslint clean on the 10 changed files; the F/H2 diff from `a90f4f87b`
      is 0 bytes. Deletion control: `moveBillOnce`'s `setMainBill` for a free table put back →
      "Move this bill to a free table names no main bill on the new party" fails, 7 pass; restored.)
- [x] Commit: "Table actions no longer read or write a main bill".
- Note (Task 6b review, Minor 2): what staff see changes at this commit. The review's probe: from
  6b on, a party made by Move this bill, Split a table or Join has no main bill on its floor row,
  so the till opens it via one extra request (the party's bill list), and Ana's party moved onto
  Luis's party whose only bill is presented now opens on Luis's presented Bill 1 (before: Ana's
  open bill). This matches D7's end state (the lowest-numbered bill still owing). The PR text must
  name it in its list of changed behaviour (Task 16).

## Task 6c: seating names no main bill; the floor names the bill a table opens on (≈65 calls)

**Files.** `parties.ts` (`seatTable` `:135` stops naming a main bill; `partyMainBill` `:153-194`,
`setMainBill` `:196-207`, `readMainBill` `:209-216` go; `moduleCoreServices` unchanged);
`working-order.ts` (`TableParty.mainBillId` `:8601` → `openingBillId` with D7's rule and a comment
that nothing writes to it; `:9017`, `:9066`); `packages/bookings/src/testing/fake-core.ts:5`
(sentence goes); tests `party-main-bill.test.ts` (rewrite, Changed test checks), `parties.test.ts`,
`till-api.parties.test.ts`, `bill-identities.test.ts:167`, `order-drafts.db.test.ts:1048`,
`order-kitchen-note.moves.test.ts:369`, `adjustments-report.test.ts:123`,
`attendance-draft-events.test.ts:59`, `:96`, `till-api.drafts.test.ts:183`, `tabs.test.ts:1069`,
`till-api.zone-closed.test.ts:327`, `:382-385`, `:474`, `print-problems.test.ts:1808` (if not done
in 4a), `till-api.move-bill.test.ts` (its one read) — every row above for Task 6c.

- [x] New cases `A803 no main bill:` in `party-main-bill.test.ts` (Review focus 4): "a seated
      table's floor row names Bill 1 as the bill it opens on"; "after the only bill is paid the
      floor row names it, and an order needs a bill made with `createPartyBill`"; "a send naming a
      bill that has since moved to another party refuses `bill.other_party`, and no line, draft or
      bill is written" (rows compared outside the failed transaction); "a send naming a bill of this
      party that is not the lowest-numbered lands on exactly that bill"; "the floor row opens on the
      lowest-numbered owing bill, else the highest-numbered shown bill" (seed numbers against
      opening order).
      (As built: the last case seeds Bill 3 opened first and Bill 2 second, checks all open → Bill 1,
      then Bill 1 paid and Bill 2 presented → Bill 2; and a second party with Bills 1 and 2 paid and
      Bill 3 abandoned → Bill 2.)
- [x] RED: `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts -t 'A803 no main bill'`
      — fails on `openingBillId` (undefined).
      (Run: 3 failed, 2 passed, 24 skipped; each failure "expected undefined to be '<bill id>'". The
      two send cases were already green: the server already refuses or lands a named send; they
      guard it.)
- [x] Remove, with the `party-main-bill.test.ts` rewrite, the two spots Task 6a left in
      `testing/group-submit-fixture.ts` `openBillFor` (each commented): the `setMainBill` on a bill
      the helper creates, and the `tab.not_open` refusal when `mainBillId` names a bill that is not
      the party's open one. The 15 cases Task 6a's note lists are the ones that rest on them.
- [x] Implement; rewrite the main-bill cases (Changed test checks); run the files above and
      `rg -l 'readSeatedParties|listTablesWithState|/api/tables/state' apps/server/src -g '*.test.ts'`.
      (First run of the named files: 32 failed, 1181 passed, all on a `mainBillId` read in
      `party-bill-actions`, `party-move-bill`, `party-table-actions`, `parties`, `order-drafts.db`
      and `tabs`; each is a row under "As built at Task 6c". 7 of the 15 cases of Task 6a's note are
      among them (`parties` `:662`, `:767`; `party-move-bill` `:774`, `:1218`; `party-table-actions`
      `:682` twice, `:1181`); the other 8 are in `party-main-bill.test.ts`, which was not in that run,
      and were rewritten with it, each with its own row. Task 6c review Minor 4.)
- [x] GREEN: those files; F; H2; Filing; server typecheck;
      `rg -n 'mainBillId|partyMainBill|setMainBill|readMainBill' apps/server packages --glob '!**/drizzle/**'`
      prints only `packages/db/src/schema/parties.ts` (Task 7), `party-bill-actions.test.ts:1284`
      (the writers describe's `mainOf`, retired at Task 7 by its row) and
      `till-api.table-actions.test.ts:775`, `:800` (absence checks that stay).
      (Run: the named files plus the 33 floor readers, 46 files, 2397 passed, exit 0; every other
      server test file seating a party or using the party, bill, draft or group fixtures, 275 files
      in four chunks: 2107, 1984, 1924 and 1645 passed, each exit 0. F 267 passed; Filing 67
      passed, both files unchanged from HEAD; H2 20 passed; `@waitron/bookings` 277 passed; server
      and till typecheck clean; prettier and eslint clean on the changed files; the F/H2 diff from
      `a90f4f87b` is 0 bytes. **Departure:** the `rg` also prints two test sites, kept on purpose:
      `till-api.table-actions.test.ts:775`, `:800` ("no answer carries mainBillId", a negative
      check) and `party-bill-actions.test.ts`'s `mainOf` (Task 6b's writers guard, reading the
      column until Task 7 drops it); re-pointing or deleting either would loosen a check. The till
      still reads the floor's `mainBillId` until Task 8c, as "Not a working product between Tasks 2
      and 8d" says; no compatibility field was added. Controls: `readBillsOfParties`' number sort
      removed (opening order) → "the floor row opens on …" fails, 4 pass; abandoned bills counted
      as shown → the same case fails; `placeGroups` sending to the party's lowest open bill instead
      of the one named → the two send cases fail. Each restored.)
- [x] Commit: "The server keeps no main bill; the floor names the bill a table opens on".
- [x] Review fix (Task 6c review Minor 2), titles only, no assertion or setup changed:
      - `party-main-bill.test.ts:151` "a group command without a bill creates the next bill and
        moves the party revision once" → "a group command without a bill lands on the next bill the
        test helper makes, and moves the party revision once";
      - `party-table-actions.test.ts:666` "… and the next order makes Bill 3, when the receiving one
        is …" → "… and the bill the test helper makes for the next order is Bill 3, when the
        receiving one is …";
      - `party-move-bill.test.ts:761` "… and the party's next order makes a new one" → "… and the
        party's next order lands on a new bill the test helper makes";
      - `party-move-bill.test.ts:1213` "… and its next order makes a new bill, since …" → "… and its
        next order lands on a new bill the test helper makes, since …";
      - `bill-identities.test.ts:338` "a bill moved to a table whose main bill is presented …" → "a
        bill moved to a table whose Bill 1 is presented …";
      - `order-drafts.db.test.ts:3472` "merges the main bills after explicit takeover, …" → "merges
        the two tables' Bill 1s after explicit takeover, …".

## Task 7: the migration that drops `parties.main_bill_id` (venue reset) (≈45 calls)

Built on Owner question 5's default (items 3–5); the PR cannot land until it is answered.

**Files.** New custom migration first: `pnpm --filter @waitron/db db:generate:custom --name retire_main_bill_triggers`,
then write in it only `DROP TRIGGER working_orders_release_main_bill;` and `DROP TRIGGER
working_orders_release_main_bill_on_move;` with a two-line header (why: the next migration rebuilds
`parties`, which their bodies name; nothing replaces them). Then `packages/db/src/schema/parties.ts:46-50`
(column, its comment and now-unused imports go) and `pnpm --filter @waitron/db db:generate --name retire_main_bill`.
Read the generated SQL: it must be finding 9's rebuild of `parties` only, with no other table; never
hand-edit it. Guard pins (Q5 items 3–5): `scripts/behavioural-triggers.test.ts`,
`scripts/migration-upgrade.test.ts` `RESETS`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.
Prose: `packages/db/README.md:88-95` (a dated sentence that the triggers and column were retired by
the new files); `docs/developers/conventions-data.md:3512-3513` list gains the new custom file
(and its date in the dated list `:3570`).

- [x] Write the behavioural-triggers describe's new case first ("the main bill is gone": no
      `main_bill_id` in `pragma_table_info('parties')`, no trigger whose `sql` contains `main_bill`).
- [x] RED: `pnpm exec vitest run scripts/behavioural-triggers.test.ts -t 'main bill'` — fails on the
      column still present.
      (Run: 2 failed, 366 skipped: `expected [ 'id', 'guest_count', 'state', …(10) ] to not include
      'main_bill_id'`, and the trigger case received the two `working_orders_release_main_bill*`
      names. This red run is also the case's deletion control: the same file with the migrations
      not yet written.)
- [x] Generate both migrations; apply exactly the Q5 items 3–5 changes, no other edit to those files.
      (drizzle-kit picked `0201_retire_main_bill_triggers.sql` (custom, two `DROP TRIGGER`s; its
      snapshot equals `0200`'s once `id`/`prevId` are removed, checked) and
      `0202_retire_main_bill.sql`: `__new_parties` create, copy, `DROP TABLE parties`, rename, and
      `parties_merged_into_idx` re-created; no other table. Journal times increase. Without the
      `RESETS` row, `migration-upgrade` failed at `core/0202`: "Failed to run the query 'DROP TABLE
      `parties`;'" caused by "FOREIGN KEY constraint failed". A scratch run (deleted) on a database
      migrated to `0200`: a closed party named by a `party_tables` row, or by a settled
      `working_orders` bill, is refused with the same two messages; a closed party with no child row
      migrates (control). The Madrid adapter failed 2 of 2 before its three lines.)
      **Correction (Task 7 review, Minor 1):** closing a party deletes its `party_tables` rows
      (`closePartyTables`, `apps/server/src/parties.ts:793-797`, the delete at `:796`), so "a
      closed party named by a `party_tables` row" is a state closing never leaves. A closed party
      stays named by its bills (`working_orders`, `bill_identities`) and, after a combine, by the
      party it joined (`parties.merged_into_party_id`); that part is from reading the code, not a run.
      **Both outcomes (Task 7 review, Minor 2; the review's run at `3e83dc464` is the receipt):**
      (a) on a box where any party has a refusing child (`working_orders`, `bill_identities`,
      `party_tables`, `order_drafts`, `order_groups`, `order_group_events`, `unpaid_departures`,
      `parties.merged_into_party_id`), `DROP TABLE parties` is refused, the whole core set rolls
      back with `0201`, every row stays, and the box stays at `0200` and refuses to start with
      `migrations.apply_failed`; (b) on a box where no party has a refusing child, the migration
      succeeds and the cascade deletes those parties' `party_allergy`, `order_kitchen_notes` and
      `service_step_completions` rows without a word (measured 1 → 0 each). The venue reset is
      needed either way (pre-live: root `CLAUDE.md` §3, "No backwards-compatibility … until
      production").
- [x] Retire the `mainOf` reads of `party-bill-actions.test.ts`'s `A803 no main bill (writers):`
      exactly as its row says (Q5, deleted checks); the "the main bill is gone" case above is what
      holds their guarantee from here.
- [x] GREEN: S (all three commands; `migration-upgrade` with its new `RESETS` row; record the
      refusal text from its own output, and confirm it is the `DROP TABLE parties` foreign-key
      refusal on a box with a closed party too, review-1 minor 7); H2; F; Filing;
      `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/canvas-retirement-upgrade.test.ts`;
      `pnpm --filter @waitron/db exec vitest run src/schema/parties.test.ts`; server typecheck;
      `rg -n 'main_bill|mainBill' packages apps/server --glob '!**/drizzle/**' --glob '!**/test-fixtures/**'`
      prints only the dated README sentence, `till-api.table-actions.test.ts:775`, `:800` (absence
      checks, kept) and `simplified-limit.test.ts`'s local `mainBill` (a name for Bill 1 in its
      `twoBills` helper; it reads no column); `git diff a90f4f87b -- scripts apps/server/scripts`
      matches Q5 items 3–5 and nothing else.
      (Run: S 558, 4040 and 34 passed; H2 20; F 267; Filing 67, both unchanged from HEAD; Madrid,
      canvas-retirement-upgrade and party-bill-actions 72; db `parties.test.ts` 12, and the 12 db
      test files naming `parties` 287; the 190 server test files naming `parties`, in three chunks,
      2193, 2678 and 2641 passed; every exit 0. Server, db and till typecheck clean; prettier and
      eslint clean on the changed files; F/H2 diff from `a90f4f87b` 0 bytes. **Departure:** the
      `rg` also prints the README's older `0038` sentence (history, kept) and the Madrid adapter's
      two filter lines (Q5 item 5 itself).)
- [x] Commit: "Drop the main bill column and its triggers (venue reset needed)". Body: the rebuild
      and why the triggers go first; the children of `parties` and that the rebuild fails on any box
      that has ever seated a party; the `RESETS` row; no data migration (pre-live); built on Owner
      question 5's default.

## Task 8a: the table screen asks no merge question; the till reads the new answers (≈60 calls)

**Files.** `apps/till/src/api/client.ts` (`TableActionResult` `:2185-2191` → `{ partyId; billIds;
zoneRevisions? }`; `MoveBillResult` `:2213-2218` loses `merged`; split result `:4665-4668` →
`billId`; `moveGuests`, `moveBill`, `moveBillAllergyPreview`, `joinTables` keep their `bills`
parameter **optional and no longer put it in the request body** until Task 8b deletes it with its
last callers, so the till typecheck stays clean (I6); new `createPartyBill(partyId,
expectedPartyRevision): Promise<{ billId: string; revision: number }>` → `POST /api/parties/:id/bills`;
doc comments `:2185-2186`, `:2213`, `:4420`); `apps/till/src/state/bill-state.ts` (new
`billToShow(kept, bills)`, D11); `apps/till/src/till-app.ts` (Move guests answer
`:14806-14813` and split follow `:15401-15409` follow D11 rule 1 from the answer's ids;
`#sayBillsKeptApart` `:15324-15332` and its calls `:14817`, `:14889`, `:15321` go);
`apps/till/src/screens/till-table-order-screen.ts` (`#pickTable` `:4860-4867` sends at once,
`#sendTableAction`/`#moveBillToCounter` `:4869-4900` send no `bills`, `#onBillChoice`/`#billChoiceDialog`
`:4902-4932` and `billChoice` state go); strings whose last user goes here; tests
`api/client.test.ts`, `state/bill-state.test.ts`, `till-app-parties.test.ts`,
`till-app-table-service.test.ts`, `till-table-order-screen.test.ts`, `till-app-allergy.move.test.ts`
(those the trace's `"merge"|"separate"` list names for the table screen and app).

- [x] Cases `A803 action results` in `api/client.test.ts` (the request bodies of the four calls
      carry no `bills` even when a caller passes one; the parsed answers; `createPartyBill`'s
      request and answer) and `till-app-table-service.test.ts` (after Join, Move guests and Split a
      table: the bill on screen is chosen by D11 rule 1, and the next `saveDraft` request's
      `billId` equals that id — Review focus 4); `billToShow` unit cases in `state/bill-state.test.ts`
      (kept, named, lowest owing, lowest shown, none); `A803 no merge question` in
      `till-table-order-screen.test.ts` (picking a seated table dispatches at once, with no dialog).
      (Built: client 6, table service 3, `billToShow` 5, screen 3 — Move guests, Join, Move this bill
      to a seated table, a free one and the counter.)
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/state/bill-state.test.ts src/till-app-table-service.test.ts src/screens/till-table-order-screen.test.ts -t 'A803|billToShow'`.
      (Run: 4 files failed, 11 tests failed, 22 passed: the bodies carried `bills`;
      `createPartyBill is not a function`; `billToShow` not exported (file failed to load); the
      screen sent nothing and drew `till-bill-choice-dialog`; Split showed `wo-9`, the first owing
      bill read, not `wo-10`, Bill 2. The table-service Move guests and Join cases failed on their
      setup (`moveGuests` called 0 times: the shared drafts fake lists every bill for every party,
      so the destination's observations repeated the source's); after a per-party drafts read in
      setup they pass, and the controls below show they fail when the follow ignores the answer.)
- [x] Implement; run the trace's till files for the table screen and app.
      (Built: client keeps `bills` as an ignored, possibly `undefined`, parameter until 8b;
      `TableActionResult` is `{ partyId; billIds; zoneRevisions? }`; `#followActionBills` keeps the
      bill on screen while the answer lists it (lines and bills read together, as before), else
      reads the bills and takes `billToShow`'s choice; Split takes `billToShow` over the staying
      party's bills; `#sayBillsKeptApart` and `table.bills_kept_separate` (EN, ES) go; the screen
      sends at once and draws no dialog, and no longer imports it. First trace run, 18 files:
      45 red cases in 6 files (client 9, allergy client 2, table screen 10, its a11y 4, open table 1, parties 19), each a row under "As built at Task 8a"; old-shape answer fixtures elsewhere showed only as unhandled rejections, and two floor-screen fixtures only at typecheck; no money, VAT, permission or
      filing check among them.)
- [x] GREEN: those files unfiltered; till typecheck clean.
      (Run after the Task 8a review's answer, each set in one foreground run: the 11 table-screen
      and client files — `src/api/client.test.ts`, `src/api/party-allergy-client.test.ts`,
      `src/screens/till-floor-screen.today-joins.test.ts`, `src/screens/till-table-order-screen.test.ts`,
      `src/screens/till-table-order-screen.a11y.test.ts`,
      `src/screens/till-table-order-screen.actions-unsaved.test.ts`, `src/state/floor-today.test.ts`,
      `src/widgets/held-orders.test.ts`, `src/widgets/bill-choice-dialog.test.ts`,
      `src/widgets/bill-choice-dialog.a11y.test.ts`, `src/state/bill-state.test.ts` — 942 passed,
      exit 0; the 7 till-app files — `src/till-app-allergy.move.test.ts`, `src/till-app-drafts.test.ts`,
      `src/till-app-menu-refresh.test.ts`, `src/till-app-open-table.test.ts`,
      `src/till-app-parties.test.ts`, `src/till-app-table-service.test.ts`, `src/till-app.test.ts` —
      2466 passed, exit 0. The review counted 943 and 2466 on the same sets at `7e78e9495`; the one
      fewer is the `billToShow` case removed with its `named` parameter. A vite client log "Cannot
      read properties of null (reading 'approvedProfiles')" prints when `AI_AGENT` is set; it comes
      from `till-app.test.ts:21173` ("does not leave the dialog busy when a step after the switch
      throws", from `7873b97e2`), which makes the device read answer `null` on purpose, and the
      review saw it at `3e83dc464` too; Vitest does not count it as an error.) `pnpm --filter
      @waitron/till typecheck` clean; prettier `--check` and eslint clean on the 17 changed files.
      Controls, each restored: `bills` back in the Move guests body → the client case fails;
      `#followActionBills` ignoring the kept bill and the answer → the Move guests and Join cases
      fail; Split choosing the first owing bill read (`billToOpen`) → the Split case fails; the
      screen holding back a seated table's send → the three no-question cases fail; the ready guard
      dropped → "sends nothing when the waiter goes back …" fails; `billToShow` without the owing
      step → its "lowest-numbered still owing" case fails.)
- [x] Commit: "The table screen asks no merge question and follows the bills an action leaves".
- [x] Answer the Task 8a review (`a803-3-reviews/task-8a.md`): `billToShow` loses its `named`
      parameter, which no production caller passed (`rg -n 'billToShow\(' apps/till/src`: the two
      callers in `till-app.ts` pass two arguments); the app-level "lowest owing" case and the two
      Move guests cases that pinned the destination's bill take real-shaped answers; the three
      client titles, the parties titles at `:4050` and the two `it.each` pairs, `till-app.test.ts:17999`
      and the `#followActionBills` comment stop naming the retired bill choice or saying "as
      before". Every changed check is a row below ("Task 8a review"). Controls, each restored:
      `#followActionBills` taking `billIds[0]` instead of `billToShow(kept, read ?? []) ?? billIds[0]`
      → the `:2146` case fails `expected 'wo-7' to be 'wo-luis'`; the two Move guests cases with
      their old `wo-9` expectation and the real-shaped answer → both fail `expected 'wo-4' to be
      'wo-9'`. The two `it.each` pairs keep both rows while the event still carries `bills`; Task 8b's
      `bills` sweep (its row below) folds each pair into one case.

## Task 8b: the floor and parked orders ask no merge question; the dialog and `bills` go (≈50 calls)

**Files.** `apps/till/src/screens/till-floor-screen.ts` (`:53`, `:67`, `:978`, `#join` `:1658-1691`,
dialog `:2198-2204`); `apps/till/src/widgets/held-orders.ts` (`:20-32`, `#send` `:220`, `#billChoice`
`:348-361`, `:381`); `till-app.ts` `#moveCounterWithAllergy(asked, bills)` `:14968-14971` and its
caller `:15260` (review-1 minor 3), and every remaining `bills` argument or event-detail field;
`api/client.ts` (the four `bills` parameters deleted); delete `widgets/bill-choice-dialog.ts`,
`.test.ts`, `.a11y.test.ts` (Q5 item 6b, built on the default); `i18n/strings.ts` retired keys
(D10) whose last user goes here; tests `till-floor-screen.today-joins.test.ts`,
`widgets/held-orders.test.ts`, `held-orders.a11y.test.ts`, `till-app-parties.test.ts:3964` (kind F)
and every till test that emits or passes a `bills` value.

- [x] Cases `A803 no merge question`: the floor's drop of a table onto a seated table calls
      `joinTables` once with no `bills` and draws no dialog; moving a parked order to a seated table
      calls `moveBill` with no `bills` and draws no dialog; moving a counter order with an allergy
      answer to a seated table asks the allergy question only, not a merge question.
      (Built, one each: floor `till-floor-screen.today-joins.test.ts:1063` (two seated tables:
      `joinTables` called once at once with no `bills` slot, no `till-*-dialog`); parked orders
      `held-orders.test.ts:846` (the widget's `move-held-order` detail, which the app turns into
      `moveBill`, is sent at once with no `bills` key and no `till-*-dialog`); app
      `till-app-allergy.move.test.ts:584` (the allergy dialog opens; `previewBillMoveAllergy` and
      `moveBill` carry no `bills` slot).)
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.today-joins.test.ts src/widgets/held-orders.test.ts src/till-app-allergy.move.test.ts -t 'A803'`.
      (Run: 3 files failed, 3 tests failed, 4 passed, 124 skipped. Floor: `expected [ 'till-bill-choice-dialog' ]
      to deeply equal []`; parked orders: `expected [] to deeply equal [ { orderId: 'wo-1', …(2) } ]`
      (nothing sent, the question drawn); app: the preview call carried `undefined` in the
      `bills` slot.)
- [x] Implement.
      (Built: the floor joins as soon as both parties are read and draws no dialog (`askingBills`,
      `#billChoice` go); parked orders send at once (`choosing`, `#billChoice` go);
      `#moveCounterWithAllergy(asked)`; the four client methods lose `bills`; the event details
      lose it; `widgets/bill-choice-dialog.ts` and its two test files deleted. Strings retired whose
      last user went here: `table.bills_question`, `table.bills_merge`, `table.bills_separate`,
      `table.bill_move_question` (D10), and `table.move_bill_scope`, `table.combine_scope` with
      `moveBillScope` (`widgets/table-targets.ts`), which only the question used (D10 does not name
      these two; the "last user goes" rule does). Changed checks: the "As built at Task 8b" and
      "Task 8b" rows; no money, VAT, permission or filing check among them.)
- [x] GREEN: those files, `held-orders.a11y.test.ts` and every till test file this task edited,
      unfiltered; till typecheck clean;
      `rg -n '"merge" \| "separate"|bills: "(merge|separate)"|bill-choice|BillChoiceDetail|bills_question|bills_merge|bills_separate|bills_kept_separate|bill_move_question' apps/till`
      prints nothing.
      (Run, each set in one foreground run: the 8 screen, widget, client and allergy files —
      `src/screens/till-floor-screen.today-joins.test.ts`, `src/widgets/held-orders.test.ts`,
      `src/widgets/held-orders.a11y.test.ts`, `src/till-app-allergy.move.test.ts`,
      `src/api/client.test.ts`, `src/api/party-allergy-client.test.ts`,
      `src/screens/till-table-order-screen.test.ts`, `src/screens/till-table-order-screen.a11y.test.ts`
      — 859 passed, exit 0; the 6 till-app files — `src/till-app-parties.test.ts`,
      `src/till-app.test.ts`, `src/till-app-table-service.test.ts`, `src/till-app-drafts.test.ts`,
      `src/till-app-open-table.test.ts`, `src/till-app-menu-refresh.test.ts` — 2436 passed, exit 0;
      `src/i18n/strings.test.ts` and `t.test.ts` 75 passed. `pnpm --filter @waitron/till typecheck`
      clean; prettier `--check` and eslint clean on the 21 changed files. **The `rg` line prints
      three lines, all the unrelated `.bill-choices` class** (`till-table-order-screen.ts:616`,
      `:4136`, `till-table-order-screen.bill-payments.test.ts:140`: the Full invoice and receipt
      language buttons, from `86782eacf`), which the pattern `bill-choice` also matches; left
      alone, as renaming it is outside this task. `rg -n --pcre2 'bill-choice(?!s)' apps/till`
      prints nothing. Controls, each restored from a copy: the floor holding back the join when
      the target is seated → the floor case fails (`joinTables` not called with the expected
      arguments); parked orders not sending a seated table → the parked-orders case fails
      (`expected [] to deeply equal …`); the app's allergy preview passing a `"separate"` slot →
      the app case fails.)
- [x] Commit: "Retire the merge question everywhere in the till".
      (Deleted checks beyond the dialog files: four floor cases (row "R, deleted"), each about a
      control of the question itself. They are deletions the owner's rule asks about; listed for
      Task 16's PR and questions. `docs/backlog.md` A1238 still names `table.combine_scope`, now
      deleted: left for Task 16's backlog pass.)

## Task 8c: rename the floor's `mainBillId` to `openingBillId` in the till (mechanical, ≈35 calls)

**Files.** `api/client.ts` `TableParty.mainBillId` `:2109-2110` → `openingBillId: string | null`
(doc comment says it is the bill a table opens on, D7); the three till-app reads renamed with the
same use (`till-app.ts:11002-11015`, `:14895`, and the others `rg` finds); every till test file and
helper with `mainBillId:` (`test/bill-pay-app.ts:82`, `test/allergy-app-fixture.ts:133`, `:167`,
`screens/till-table-order-screen.panel-footer.test-helpers.ts:20`, and the rest of the 73 files)
renamed by a script: `mainBillId:` → `openingBillId:` with the same value; no other change.
Behaviour is unchanged in this task; Task 8d changes what the app does with the field (review-1 I6).

- [x] Before: `rg -c mainBillId apps/till` (record the count). As built: 163 lines in 72 files.
- [x] Rename (type, three reads, then the script over `rg -l mainBillId apps/till`). As built: the
      type and its doc comment by hand; then one script, `\bmainBillId\b` → `openingBillId`, over
      every file `rg` listed, which also took the four app sites (`till-app.ts:11002`, `:11045`,
      `:12082`, `:14898`), the screen's `till-table-order-screen.ts:4977` and the tests' `.mainBillId`
      reads, not only `mainBillId:` keys (the typecheck needs every read renamed).
- [x] GREEN: till typecheck clean; `git diff --name-only HEAD -- apps/till | /usr/bin/grep '\.test\.ts$' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`
      green; `rg -n mainBillId apps/till` prints nothing; `git diff HEAD -- apps/till | /usr/bin/grep '^[-+]' | /usr/bin/grep -v -e mainBillId -e openingBillId -e '^+++' -e '^---'`
      prints nothing (a rename only), apart from lines `pnpm exec prettier --write` re-wrapped
      because the new name is two characters longer — list those in the ledger.
      As built: typecheck exit 0; the 66 changed test files ran together, `Tests  1 failed | 5094
      passed (5095)`, the one failure `till-app-drafts.test.ts:8408` ("keeps the source and pending
      edit when the save before a split fails": `locator.click` timed out, the split button
      "detached from the DOM, retrying"), a case that names no `openingBillId`; that file alone then
      ran `Tests  432 passed (432)`. `rg -n mainBillId apps/till` printed nothing; the diff filter
      printed only the type's doc comment and the two re-wraps in the Changed test checks row for 8c;
      `prettier --check` and `eslint` on the changed files exit 0.
- [x] Commit: "Till: the floor names the bill a table opens on".

## Task 8d: the till opens and follows bills without a main bill, and never shows a vanished bill (≈65 calls)

**Files.** `till-app.ts` (open `:11002-11015`: `activeTabId = openingBillId`, lines and bills read
in parallel as today, then D11 rule 3 when the bills read lacks it; `#loadPartyBills`
`:11769-11788` applies D11 rule 3 and sets the notice; `#billAfterMove` `:14893-14902` uses
`billToShow` over the bills left, else `#leaveTable` (D11 rule 2); seat `:11045`; find-tab follow
`:12082` follows the draft's own bill; `TABLE_REFUSALS` `:614` loses `party.main_bill_stays`); screen
`#splitTableBills` `:5029-5037` (any owing bill of this party), the `data-bill-gone` status line;
`i18n/codes.ts:294-297`; `i18n/strings.ts` `table.bill_gone`, `table.bill_gone_none` (EN and the ES
proposals, Owner question 1); tests `till-app-open-table.test.ts`, `till-app-parties.test.ts`,
`till-app-drafts.test.ts:8720`, `api/client.test.ts`, `i18n/codes.test.ts:323-333`.

- [x] Cases `A803 opening bill` in `till-app-open-table.test.ts`: opening a seated table shows
      `openingBillId` with one bills request at most and lines in parallel (count the requests);
      opening a party whose floor row names no bill and whose bills read is empty sends **no**
      `createPartyBill` and no draft write, and shows no New order (I4).
      As built (`:2002`): three cases: the bill the floor names, with one bills read and the lines of
      `wo-4` read before the bills answer; no bill and no draft for an empty read; and "never opens
      an abandoned bill when the floor names no bill".
- [x] Cases `A803 bill gone` (review-1 I3) in `till-app-parties.test.ts`:
      1. "another till merged the bill on screen away": the bills read arrives without it → the
         screen's bill is the lowest-numbered owing bill, `[data-bill-gone]` reads "Bill 2 is no
         longer at this table. Now showing Bill 1.", and the next `saveDraft` request names Bill 1;
      2. "another till moved the bill on screen to another table": same, with a party whose only
         other bill is paid → the lowest-numbered shown bill (the paid one) and New order refuses
         `bill.paid`;
      3. "no bill survives": `table.bill_gone_none`, no New order, no `createPartyBill` request;
      4. "lines typed on the vanished bill are not sent to the new bill": after the switch, no
         `saveDraft`/submit request to Bill 1 carries them, and they are offered in the retained
         draft panel;
      5. "a stale `openingBillId`": the floor names a bill the bills read does not hold → the screen
         corrects to the rule's choice with the notice, and no draft, submit or group request
         names the stale id (the parallel lines read may);
      6. "the bill on screen is paid by another till": it stays on screen shown Paid, with no
         notice and no switch, and New order refuses `bill.paid` (it did not vanish).
      As built (`:4257`), the six cases. **Departures:** "New order refuses `bill.paid`" (cases 2
      and 6) is checked as the paid bill's draft being locked (`billStatus` `settled`, `editsLocked`,
      no line, no `saveDraft`): no `bill.paid` sentence exists on the till today. Case 4: the lines
      typed on the vanished bill are not flushed (D11 rule 4 forbids a write to a bill missing from
      the latest read, so Task 9's flush-then-switch body is not used here); the switch drops the
      draft and offers its unsaved lines in the retained-draft panel of the bill now shown
      (`#carryCandidate`). A stale bill the till never read is named "Bill" ("Bill is no longer at
      this table. Now showing Bill 1."), having no number to show.
- [x] Case `A803 action results` in `till-app-parties.test.ts`: Move this bill to another table
      leaves the screen on the staying party's lowest-numbered owing bill, and the next draft
      request names it; `:3964` (back to the floor when it was the last) stays green unedited.
      As built (`:4443`); `:3964`'s case green unedited.
- [x] The till's new opening rule (`billToShow`, and any reuse of `billToOpen` for D11) must not
      carry `billToOpen`'s abandoned-bill pick: abandoned bills are never chosen (D7; Task 6c
      review Minor 3).
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts src/till-app-parties.test.ts -t 'A803'`.
      As built, against the base production code (the task's tests in place): `Tests  7 failed | 29
      passed | 650 skipped (686)`. The 7 are every new case that pins a new rule; the three new
      cases passing on the base code pin kept behaviour (one bills read and parallel lines on
      opening; no bill made for an empty read; a paid bill on screen stays). With Task 8d: `36 passed`.
- [x] Implement; the Changed test checks rows for 8d.
      As built: an earlier implementer's work, saved as a patch and applied, then judged and finished.
      `till-app.ts`: opening sets `activeTabId` to `openingBillId`, reads lines, bills and the draft in
      parallel, then `#followBillsRead` (D11 rule 3, `opening`); `#loadPartyBills` applies it to
      every other read unless the caller picks the bill itself (`follow` false: the action follow,
      Move this bill and the split follow); Move this bill takes `billToShow` over the bills left,
      else the floor (`#billAfterMove` and `billToOpen` deleted); the find-tab follow takes only the
      draft's own bill; `party.main_bill_stays` leaves `TABLE_REFUSALS` and `codes.ts`;
      `state/bill-state.ts` `billLabel`; the screen's `data-bill-gone` `role="status"` line and
      `#splitTableBills` taking any owing bill of the party; `table.bill_gone`/`table.bill_gone_none`
      in English and the Spanish proposals. The Changed test checks rows marked Task 8d, the 8d-0
      review answers among them. No production change came out of the record's "not diagnosed"
      cases: each was a fake that left out the bill on screen (see the 8d-0 record's correction).
      Controls (each production check mutated, the named cases run, the code restored and
      `git diff --stat` the same as before): (1) opening with `activeTabId = undefined`: `3 failed` —
      "shows the bill the floor names, reading its lines alongside one bills read", "opens the bill
      the floor names", "opens the bill the floor names, the highest-numbered, …"; (2)
      `#followBillsRead` acting on opening only: `4 failed | 2 passed` of `A803 bill gone` — merged
      away, moved away, no bill survives, lines typed on the vanished bill (the two passing are the
      paid-stays case, which never switches, and the stale-opening case, which is the opening
      path); (3) `shownBills` keeping abandoned bills: `2 failed` — "never opens an abandoned bill
      when the floor names no bill", "opening a table whose floor names an abandoned bill leaves it,
      …"; (4) the vanished bill's draft not dropped: `1 failed` — "lines typed on the vanished bill
      are not sent to the new bill, and are offered for review"; (5) Move this bill taking the last
      bill left instead of `billToShow`: `1 failed` — "Move this bill to another table leaves the
      screen on the staying party's lowest-numbered owing bill, …".
- [x] GREEN: the five files unfiltered; till typecheck clean; `rg -n 'party\.main_bill_stays' apps/till` prints nothing.
      As built: every `till-app*.test.ts` (41), `api/client.test.ts`, `state/bill-state.test.ts`, the 79
      `till-table-order-screen*.test.ts` files and the two allergy screen files on the shared
      fixture, in one run: `Test Files  122 passed (122)`, `Tests  6333 passed (6333)`, exit 0 (the
      known split-click flake did not show). `pnpm --filter @waitron/till exec vitest run src/i18n`:
      `Tests  259 passed (259)`. `pnpm exec vitest run scripts/english-only.test.ts
      scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`: `Tests  2024 passed (2024)`.
      `pnpm --filter @waitron/till typecheck`, `prettier --check` and `eslint` on the changed files:
      exit 0 each. `rg -n 'party\.main_bill_stays' apps/till`: no output, exit 1. The setup-only (S)
      cases run on the base production code: `Tests  7 passed`.
- [x] Commit: "The till opens a table on the bill the floor names and never keeps a vanished bill on screen".
      As built: one commit, with the 8d-0 review answers in it (they touch the same test files).

### 8d review answers (2026-10-31, `a803-3-reviews/task-8d.md`)

Done on the branch after Task 9 (`8cea9e48d`), in one commit. Runs in the foreground, `--maxWorkers=2`
or `3`, with `AI_AGENT`/`CLAUDECODE` unset; free memory 50–53% before the browser runs. Each control
below broke one production line, ran the named cases, then put the file back from a copy and `cmp`'d
it (no difference).

- **I1 (behaviour defect, fixed).** `till-app.ts` gains `#billChosenRead` and `#chooseBill(id)`, used
  at every place this till sets the bill on screen itself: seat, Split this bill, `#followDraft`,
  `#followActionBills`, Move this bill, the Split a table follow, and `#showBill` (Task 9's
  `#onSwitchBill`, `take-payment` and + New bill). `#followBillsRead` returns early when
  `read <= #billChosenRead`. **Departure from the review's design:** a bill the shown bills list
  already holds sets `#billChosenRead` to 0, not to the latest read's number. The list came from a
  read no later than any read that can still be followed, so such a read lacking the bill shows
  that it went. The review's design would ignore that read and keep a vanished bill on screen after
  a switch. Any other bill (a seat's, a split's, + New bill's, an action answer's) sets it to the
  latest read's number. Opening does not go through `#chooseBill`. Its own read is sent after it
  sets the bill, so its number is higher, and D11 rule 3 still applies to it: the stale-opening
  and abandoned-opening cases stay green.
  New cases in `till-app-parties.test.ts` `A803 bill gone`:
  `:4511` "a bills read sent before this till's own Split this bill answered leaves the split's new
  bill on screen, with nothing said" (the review's probe). RED on `8cea9e48d`: `expected 'wo-4' to
  be 'wo-check'`, `Tests 1 failed | 1 passed`. `:4564` "a bills read sent before + New bill answered
  leaves the new bill on screen, with nothing said": **green before the fix**. Task 9's
  `#onNewBill` sends its own bills read (follow off) before it shows the new bill, and that read
  makes the earlier one stale. So the review's "+ New bill will have the same gap" did not hold for
  the code as built. `:4540` "a bills read sent before the waiter switched to a listed bill still
  moves the screen off it once it has gone, and says so" pins the departure.
  Controls: (C1) guard line deleted: `:4511` fails, `:4564` passes (`1 failed | 1 passed`). (C2)
  guard deleted **and** `#onNewBill`'s own read deleted: both fail (`2 failed`). (C3) own read
  deleted, guard kept: both pass, so the guard alone covers + New bill. (C4) `#chooseBill` always
  taking the latest read's number (the review's design): `:4540` fails, `expected 'wo-check' to be
  'wo-4'`.
- **I2.** Added checks that the vanished bill's lines leave the screen (rows "8d review I2" and
  `till-app-drafts.test.ts:9423` above). The drafts abandoned case now answers one sent line for
  `wo-4`, because the suite's `[]` lines could not tell the difference. The review's mutation
  (`await this.#loadTabLines()` deleted in `#followBillsRead`), run on parties, open-table,
  menu-refresh and drafts filtered `A803|round that got no answer|opening a seated|abandoned|A773`:
  `Tests 7 failed | 122 passed` (the review's run: 2 failed). The 5 newly failing: the drafts
  abandoned case and parties merged, moved, no bill survives and stale.
- **I3.** Rows for the deleted `party.main_bill_stays` till checks are marked `B, Q5`, question 5d
  (questions.md 2026-10-31 ~09:45), built on the default. questions.md not edited here.
- **M1.** `state/bill-state.test.ts` `A803 billLabel` covers a number, a number and a name, no
  number, and no number with a name, in EN and ES (`Tests 18 passed`). Mutation `return label;`:
  `2 failed` (`expected 'Bill 2' to be 'Bill 2 · Clint'`, and the ES twin). The docstring's "as the
  floor names a bill" is cut. `widgets/table-details-sheet.ts` `unsentText` uses the same number
  keys but never adds the bill's name, so the clause claimed more than the floor does.
- **M2.** New case `:4449` "the notice clears when the waiter chooses another bill, and when another
  table opens" (via `switch-bill`, `take-payment` and opening table 7). `[data-bill-gone]` is null
  after Move guests `:2180` and Split a table `:2518` (rows above). Mutations, each on its cases:
  no clear when a table opens: `1 failed`; no clear in `#showBill`: `1 failed`;
  `#followActionBills` reading with follow on: `1 failed` (`:2180`); the Split a table follow
  reading with follow on: `1 failed` (`:2518`, once its bills fake stops listing `wo-check` after
  the split; before that setup change the mutation passed). Join shares `#followActionBills` with
  Move guests, so the `:2180` control covers its follow too.
- **M3.** Row `till-app-parties.test.ts:566` now says it is green on the base production code
  with this setup.
- **M4.** `api/client.test.ts:2743` sample params → `{ tabId: "wo-4", lineNo: 2 }`. The rejection
  is now expected as `{ code: "group.held_leaves_party", tabId: "wo-4", lineNo: 2, status: 409 }`,
  and the row's text says so.
- **M5.** New keys `table.bill_gone_unnumbered` / `_none` (EN "That bill is no longer at this
  table. Now showing {shown}." / "That bill is no longer at this table."; ES proposals «Esa cuenta
  ya no está en esta mesa. Ahora se muestra {shown}.» / «Esa cuenta ya no está en esta mesa.»).
  They are used whenever the bill that went has no number: never read, or stored with none. They
  are added to the Spanish table and Owner question 1 (now seven strings). Both pinned texts were
  updated (B rows above). RED before the code change: `2 failed` on the old wording. The optional
  "dishes not sent" line was skipped as asked.
- **GREEN.** The required files in one run (`till-app-parties`, `-open-table`, `-drafts`,
  `-menu-refresh`, `-table-service`, `api/client`, `state/bill-state`,
  `screens/till-table-order-screen.bill-switcher`, `src/i18n`): `Test Files 20 passed (20)`, `Tests
  1920 passed (1920)`, exit 0. Every `till-app*.test.ts` (41 files, as `till-app.ts` changed):
  `Test Files 41 passed (41)`, `Tests 4514 passed (4514)`, exit 0. The known split-click flake did
  not show. `till-app-parties.test.ts` again after a lint-only edit: `Tests 623 passed (623)`.
  `pnpm --filter @waitron/till typecheck`, `prettier --check` and `eslint` on the seven changed
  files: exit 0 each. `pnpm exec vitest run scripts/english-only.test.ts`: `Tests 1988 passed
  (1988)`.

### Task 8d-0 record (test setup only, done 2026-10-31 before Task 8d)

Commits `8ea48348b`, `9851ee87c` and the one adding this record. Every till-app file whose bills
fake went red under Task 8d's production hunks is done; none is left. Measured with only the WIP
patch's production hunks applied (`git apply --exclude='*.test.ts'`), red cases before → after:
`till-app-drafts` 379 → 3, `till-app-table-service` 97 → 1, `till-app-device-zones` 47 → 0,
`till-app-open-table` 34 → 1, `till-app-allergy` 28 → 0, `till-app-bar-tables` 27 → 0,
`till-app-parties` 14 → 5, `till-app-kitchen-note` 10 → 0, `till-app-late-send` 10 → 0,
`till-app` 1 → 0, `till-app-menu-refresh` ? → 1, `till-app-counter-adjustments` ? → 1,
`till-app-setup-refresh` and `till-app.a11y` ? → 0 (? = not measured before the change). The other
27 `till-app*.test.ts` files were green under the hunks. On the current code every changed file
passes: the twelve files using `floorPartyBills`, 1197 of 1197; `till-app-parties` and
`till-app`, 1735 of 1735.

Still red under the hunks, for Task 8d to judge (no `expect` was touched):
- In the Changed test checks rows for 8d: `till-app-parties` "shows party.main_bill_stays in its
  own words after split-table" and "… and moves nothing on screen" (the `:2491`/`:4101` row);
  "opens the latest bill when every bill of the party is paid" and "keeps the party on screen, not
  the older copy on the kept floor, …" (by line drift, the `:4395`/`:4405`/`:5830` row; not
  confirmed by title).
- Kept on their `[]` bills read, because a realistic read turns them red on the current code too:
  `till-app-drafts` "retains local edits without saving to the old party, then reads the relocated
  bill" and "decides a later addition from the new party's groups, not the old party's" (Move
  guests refused `party.out_of_date`); `till-app-open-table` "moving guests onto the table just left
  waits for its own save" (the 8a row for `:1405`/`:1427`); `till-app-parties` "acts on the party
  the seat answered with when the floor cannot be read after seating" (with `wo-new` listed, Finish
  sends its editor state, and the case expects `[]`).
- Correction at Task 8d (from the 8d-0 review, I1-I4): the reason given above for the cases kept
  on `[]` was true, but what went red under a realistic read was the fake `draftServer.listDrafts`,
  which answered every party with every bill's editor state, not the till (I2); and
  `till-app-parties` "acts on the party …" pinned an `expectedEdits: []` the server refuses (I3).
  `till-app-counter-adjustments` "allows a table Move …" was red because `floorPartyBills` ignored
  the seat's answer (I1), and `till-app-table-service` "a table of 4 …" because its bills read was
  `[]` beside the bill on screen; neither is a production defect. Each is in a Task 8d row of
  Changed test checks.
- Not in the plan: `till-app-drafts` "opening a abandoned bill keeps its Sent reads but accepts no
  fresh dishes" (D11 never shows an abandoned bill, so the screen leaves it); `till-app-menu-refresh`
  "reads the table's party again and shows the tab the table now points at" (the party's earlier
  bill is still in its bills, so the screen keeps it; Task 8d's find-tab follow change);
  `till-app-table-service` "a table of 4 on one open bill shows 4, and a cash payment changed to 5
  sends 5 beside a bare tender" (`recordSale` not called); `till-app-counter-adjustments` "allows a
  table Move after table navigation overtakes a pending Make at" (no station-choice dialog). Not
  diagnosed.

## Task 9: the bill switcher with + New bill (≈65 calls)

**Files.** New `apps/till/src/screens/table-bill-controls.ts` (`billSwitcher(...)`,
`billRowContent(...)`, short-label helper beside `billName` in `state/bill-state.ts`); the screen
renders the switcher in the panel head beside where the Tab button sits (the Tab button stays until
11c), on every width and on handheld; events `switch-bill` `{ workingOrderId }` and `new-bill` `{}`
(`bubbles`, `composed`; app-owned names, root `CLAUDE.md` §3); `till-app.ts` handlers: `switch-bill`
reuses `#onTakePayment`'s flush-then-switch body (`:16870-16886`, renamed `#onSwitchBill`, also
used by D11 rule 3; `take-payment` stays bound for the finish refusal); `new-bill` flushes the
draft, calls `createPartyBill` with the party's revision, notes the answer's revision, reloads the
party's bills and shows the new bill; a refusal goes through `#onTableRefusal` like other party
commands (D1's two-till collision); `i18n/strings.ts` `table.bill_count`, `table.new_bill` (EN and
the ES proposals); tests new `screens/till-table-order-screen.bill-switcher.test.ts`,
`till-app-table-service.test.ts`, new `screens/till-table-order-screen.bill-controls.a11y.test.ts`.

- [x] Screen cases `A803 switcher`: one bill → the closed label "Bill 1 · €38.50" and the open list
      holds that bill and "+ New bill"; three bills → "Bill 1 of 3 · €67.00", rows in number order
      with what each owes, "Paid" for a paid one, a name "Bill 2 · Clint", and "Ana has an unsent
      order: 3 items" under the bill Ana has unsent dishes on; **"+ New bill" is the last item of
      the list with one bill and with three** (minor 11); after Bill 2 is merged away the list
      shows Bill 1 and Bill 3 and the closed label says "of 2" (a count, not the highest number);
      choosing Bill 3 dispatches `switch-bill` with Bill 3's id (never an index); "+ New bill"
      dispatches `new-bill`; an unnumbered bill reads "Bill" (slice 2's owner answer 5); a party
      with no shown bill draws "Bills" with only "+ New bill"; no party → no switcher.
- [x] App cases `A803 new bill`: "+ New bill" calls `createPartyBill(partyId, revision)` once,
      shows the answered bill, and the next draft save names it; "two tills tap + New bill on the
      same revision: the second shows the `party.out_of_date` refusal, its switcher then lists the
      first till's new bill, it stays on its bill, and it sends exactly one `createPartyBill`"
      (I4); switching to a paid bill shows it and New order refuses as `bill.paid` (Owner question
      6); "after the bill on screen vanishes, the closed label names the bill now shown" (I3,
      visible refresh).
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.test.ts src/till-app-table-service.test.ts -t 'A803'`
      — the screen cases fail on the missing switcher (the assertion, after the file mounts the
      screen), the app cases on no `createPartyBill` request.
- [x] a11y: `till-table-order-screen.bill-controls.a11y.test.ts` covers the switcher closed and open,
      one bill and three, a paid row and an editor row, the no-bill state, in light and dark; run
      with `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-controls.a11y.test.ts`.
- [x] GREEN: the three files; `till-table-order-screen.parties.test.ts`, `till-table-order-screen.test.ts`; till typecheck.
- [x] Commit: "A bill switcher with + New bill on every table, even with one bill".

### Task 9 as built (2026-10-31)

- **RED** (the listed command): 18 failed, 5 passed, 126 skipped (149). The 12 screen cases and
  the 6 app cases failed on the missing switcher (`[data-bill-switcher]` is null). The app cases
  reach + New bill and the bill rows by clicking the switcher, so they fail on the missing control
  before any `createPartyBill` request could be sent. That is a departure from the stated reason
  ("no `createPartyBill` request"). The passes were the 4 existing A803 cases in
  `till-app-table-service.test.ts` and "no party: no switcher", which passes without a switcher
  by design.
- **GREEN**: the three Task 9 files plus `till-table-order-screen.parties.test.ts` and
  `till-table-order-screen.test.ts`: 5 files, 540 passed. `till-app-parties.test.ts` and
  `till-app-bill-payments.test.ts` (the `take-payment` users of the renamed handler): 862 passed.
  a11y file alone: 12 passed. `pnpm --filter @waitron/till typecheck` exit 0;
  `vitest run src/i18n` 259 passed; root guards (english-only, style-token-names,
  primary-coloured-text, native-form-fields) 2062 passed; prettier and eslint clean on the changed
  files.
- **Cases.** Screen (`till-table-order-screen.bill-switcher.test.ts`, 13): the ones listed, plus
  "names the bill on screen, its name and count" ("Bill 2 of 3 · Clint · €54.00"), "says Paid
  for a paid bill on screen", "choosing the bill on screen dispatches nothing" and "shows on a
  handheld too". App (`till-app-table-service.test.ts`, `A803 new bill`, 6): the four listed, plus
  "a refusal other than out of date is said on the banner and changes no bill" and "choosing a
  bill in the switcher shows it, by its id". The app cases run in the venue's Spanish (the app
  takes es-ES at sign-in), so they also pin the ES proposals «Cuenta 2 de 2 · …» and «Pagada». The
  two-till case pins the banner as the existing `describePartyChange` sentence ("Otro dispositivo
  ha cambiado la mesa 2, así que se ha vuelto a cargar. Sus cuentas han cambiado …").
- **a11y** (`till-table-order-screen.bill-controls.a11y.test.ts`, 12 cases): {one bill; three bills
  with a paid row and an editor row; no bill shown} × {closed, open} × {light, dark}, axe run on
  the switcher. Control: without `role="menu"` on the list, the 6 open cases fail
  `aria-required-parent`, which shows the open cases do read the list.
- **Deletion controls** (each production check broken, the named cases watched fail, then the
  check restored and `cmp`'d against the copy saved before the break):
  1. switch-bill sends the row's index instead of its id: 4 fail, including "choosing Bill 3
     dispatches switch-bill with Bill 3's id" and the app's "choosing a bill … by its id".
  2. + New bill drawn first: 5 fail, including "+ New bill is the last item with one bill and with
     three".
  3. count = highest bill number: 1 fails, "after Bill 2 is merged away … counts 2".
  4. `createPartyBill` sent with revision + 1: "+ New bill asks once … with the party's revision"
     fails (re-run after the last edit to that line); sent twice: the same case fails.
  5. the refusal set as `tableWriteError` instead of going through `#onTableRefusal`: the two-till
     case fails.
  6. `#followBillsRead` not moving `activeTabId`: "after the bill on screen vanishes, the closed
     label names the bill now shown" fails.
- **Controls drawn.** `billSwitcher(...)` and `billRowContent(...)` in
  `apps/till/src/screens/table-bill-controls.ts`. `billNumberLabel` sits beside `billLabel` in
  `state/bill-state.ts`, and `billLabel` now uses it. The switcher is a `wt-row-actions` (D2) whose
  trigger holds the closed label (`data-bill-switcher-label`, with an `aria-hidden` ▾). Its list is
  a `role="menu"` of native `role="menuitemradio"` buttons (`data-switch-bill=<id>`, `aria-checked`
  on the bill on screen), then a `role="menuitem"` + New bill (`data-new-bill`). This is the
  pattern the shell's counter-zone menu uses (`widgets/till-shell.ts`). The accessible name is
  "Bills: <closed label>", or just "Bills" when no bill is shown, so the visible text is part of it.
  Choosing the bill already on screen dispatches nothing.
  `till-app.ts`: `#onTakePayment` became `#onSwitchBill`, which now also handles `switch-bill`
  (`take-payment` and the held-list path still call it). Its flush-then-check moved to
  `#flushBeforeSwitch`. `#onNewBill` flushes, sends one `createPartyBill(partyId, revision)`,
  notes the answer's revision, reloads the bills with `follow` off and shows the new bill. A
  refusal goes to `#onTableRefusal`. Strings: `table.bill_count` "{bill} of {count}" / «{bill} de
  {count}», `table.new_bill` "+ New bill" / «+ Cuenta nueva» (ES proposals, Owner question 1).
- **Departures.** (a) The switcher sits after the Tab button, between it and the floor's Back,
  not before it. This keeps `till-table-order-screen.test.ts:4159` ("the status's next sibling is
  the Tab button") and the 390px one-line check at `:4200` passing unchanged, so no existing
  assertion changed. Task 11c removes the Tab button. (b) The RED reason for the app cases, given
  above. **Changed test checks: none.** **Owner-question candidates: none new.**

### Task 9 review answers (2026-10-31, `a803-3-reviews/task-9.md`)

Done on `1707e6fe2`, in one commit. Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset,
`--maxWorkers` 2 to 4, free memory 53–57% before each browser run. Each control broke one
production line in a copy, ran the A803 cases of the switcher screen file and
`till-app-table-service.test.ts` (`-t A803`), then put the file back and `cmp`'d it (no difference).

- **RED** (the new and changed cases, `-t A803` on the two files): `Tests 11 failed | 24 passed |
  126 skipped (161)`. Failing: the I1 app and screen cases, both I2 cases, M1, M3, I3 (light), M5,
  and the three M6 text pins. The M2 cases and I3 dark passed before the fix: they pin behaviour
  that was already right (I3 dark: `surface-raised` already differs from the popup there).
- **I1.** `#onNewBill` keeps `newBillsOut`, the parties whose + New bill is out, set before the
  flush and cleared in `finally`; a tap while its party's is out does nothing. The screen's
  `newBillBusy` draws + New bill `aria-disabled="true"` in `--wt-color-text-muted` with a
  `not-allowed` cursor, and its click sends nothing (`wt-row-actions` keeps the list open on an
  `aria-disabled` item). No new string. Cases: app `:3538` (two `new-bill` events before any
  redraw: one `createPartyBill`, no banner, busy while out, not after); screen `:164`. Controls:
  C1 app guard removed → `:3538` fails (`1 failed | 34 passed`); C2 the screen's click guard
  removed → `:164` fails.
- **I2.** `#askForNewBill` takes the bill on screen after the flush and shows the new bill only if
  it is still that one after the answer and after its own bills read (follow off); otherwise the
  read lists the new bill and the screen stays. It never shows the new bill once the waiter has
  chosen another, so `#billChosenRead` is not involved: the waiter's choice of a listed bill sets
  it to 0 as before and the + New bill read never follows. Cases `:3563` (P2's shape: choice while
  `createPartyBill` is out) and `:3588` (choice while + New bill's own bills read is out). Control
  C4, the after-read check reduced to `!live()`: both fail (`2 failed`). A separate branch for a
  choice made while `createPartyBill` was out was tried first and dropped: its deletion (C3)
  passed, as the after-read check covers it.
- **M1.** `#onSwitchBill` stores the id in `#switchTo` and, after the flush, shows the latest one.
  Case `:3622`: `saveDraft` held, Bill 2 then Bill 3 chosen, release → Bill 3 on screen; every
  save names `wo-7`. Control C5 (show the event's own id): fails `expected 'wo-8' to be 'wo-9'`.
  Seen while building it: this case sends two `saveDraft` calls naming `wo-7` with the same lines,
  on the committed `1707e6fe2` code too (run with that `till-app.ts` put back:
  `[["wo-7",null],["wo-7",null]]`). Not changed here; no save named another bill.
- **M2.** Cases `:3649` (the `saveDraft` naming `wo-7` is invoked before `createPartyBill`),
  `:3666` (a refused save, `draft.out_of_date`, sends no `createPartyBill`; screen stays on
  `wo-7`), `:3686` (`setPartyName` after + New bill carries revision 4, the answer's, over the
  floor's 3). Controls: C6 flush removed → `:3649` and `:3666` fail; C7 `#notePartyRevision`
  removed → `:3686` fails.
- **M3.** Choice: the existing `table.reread_failed` message, as `#rereadAmounts` and the invoice
  recipient's save already say for a failed bills read after a write. The new bill stays shown
  (the server just made it); the list is not given a made-up row. Case `:3700`. Control C8
  (message line removed): fails.
- **I3.** Checked row: `--wt-color-surface-lifted` with a `--wt-color-border` edge (rows carry a
  transparent 1px border so nothing moves); hover `--wt-color-bg`. No ✓ column: with M6 a paid
  row already ends in ✓, and a second ✓ for "on screen" would read the same. Case: screen
  `describe.each` light/dark, the checked row's computed background differs from the open
  popup's and from an unchecked row's. Control C9 (back to `surface-raised`): the light case
  fails. Hover is not asserted. LOOK (throwaway probe, deleted): 1024 px, three bills, light and
  dark, idle and + New bill out; Bill 2's tinted row is plain in both themes, + New bill reads
  muted while out. Screenshots outside the repository in `/tmp/a803t9/shots/`.
- **M4.** Not changed (shared `wt-row-actions`, predates the branch). Filed as A1256 in
  `docs/backlog/dashboard.md`, listed in `docs/backlog.md` beside A781; Task 16 carries a note.
- **M5.** The trigger part gets `1px solid --wt-color-border`, `--wt-radius-md` and
  `--wt-color-surface`. Case `:180`; control C10 (border removed): fails.
- **M6.** An `aria-hidden` ✓ after "Paid" in the row and the closed trigger; the label span and the
  accessible name stay "Paid". Rows in Changed test checks (Task 9 review M6). Control C11 (mark
  removed): the three pins fail.
- **GREEN.** The seven named files (switcher, bill-controls a11y, `till-table-order-screen`,
  `.parties`, `till-app-table-service`, `till-app-parties`, `till-app-bill-payments`):
  `Test Files 7 passed (7)`, `Tests 1422 passed (1422)`. The switcher screen files, the two
  table-screen files and `src/i18n` again after the last edit: `Test Files 16 passed`, `Tests 671
  passed (671)`. a11y file alone: `Tests 16 passed (16)`. Every `till-app*.test.ts` (41 files):
  in one run with `src/i18n`, `Tests 1 failed | 4780 passed (4781)`: `till-app-late-send.test.ts`
  "a manager's PIN > shows a refused approver on the app's line when the dialog was closed while
  it was sent" (that file sends no `switch-bill`, `take-payment` or `new-bill`; `table-bill-controls.ts`
  was reformatted while that run was going). The file alone: `82 passed`; that `describe` three
  times: `21 passed` each. Then the 41 files again in four runs: `1160`, `1817`, `263`, `1282`
  passed, 0 failed (4522). The known split-click flake did not show.
  `pnpm --filter @waitron/till typecheck` exit 0; prettier `--check` and eslint on the six changed
  code files exit 0; root guards english-only, style-token-names, primary-coloured-text,
  native-form-fields: `Tests 2062 passed (2062)`.

## Task 10: one ⋮ menu: the bill on screen, then the whole table (≈65 calls)

**Files.** `table-bill-controls.ts` (`tableMenu(...)`); the screen: `#actionSection`'s `closed` and
`menu` steps (`:5406-5488`) become the ⋮ (D4), which carries `data-move-split`; items keep their
`data-action` names; Receipt copy, Cancel and credit, Bill requested, Finish table and Comp the bill
are **added** to the ⋮ with their existing events, and **the drawer's and the foot's own copies stay
until Tasks 11c and 12** (review-1 I6), so every test that still opens the drawer or reads the foot
keeps passing; the ⋮ copies carry the same `data-*` hooks inside `[data-table-menu]`, and Task 10's
own cases select inside it; the Full invoice item (D8) dispatches `choose-bill-invoice`; focus
returns to the ⋮ trigger after the naming, guests and split-guests windows close (A1234);
`i18n/strings.ts` `table.whole_table`; tests new `screens/till-table-order-screen.table-menu.test.ts`,
`till-table-order-screen.test.ts` (`:713`, `:4231`, `:6704` kind R),
`till-table-order-screen.actions-unsaved.test.ts`, `till-table-order-screen.parties.test.ts`,
`bill-controls.a11y.test.ts` (menu states), and `till-app-bill-payments.test.ts` (invoice entry).

- [x] Cases `A803 single menu`: exactly one ⋮ on the screen and no "Table actions" button; its
      first group is named "Bill 2 · Clint" and lists, for an open owing bill with full invoices on,
      Name this bill, Split by item, Transfer items, Merge bills, Move this bill, Comp the bill,
      Full invoice, in that order; its second group is named "Whole table" and lists Guests, Name
      the party, Allergies, Mark bill requested, Split a table (two tables only), Join a table, Move
      guests, Finish table; a paid bill with a receipt shows Name this bill and Receipt copy and no
      Full invoice; a presented bill with a receipt and no payments shows Cancel and credit; a
      presented bill with an invoice number shows no Full invoice; with no bill on screen the bill
      group is absent; Full invoice is absent while `fullInvoices` is false; **with no party**
      (`party === null`) the ⋮ offers exactly Split by item, Transfer items and Merge bills under
      "Bill" and Move guests and Join a table under "Whole table", as today's menu does (minor 9).
- [x] Cases `A803 invoice entry` in `till-app-bill-payments.test.ts`: the ⋮ Full invoice and the pay
      step's Full invoice open the same recipient editor for the same bill and revision; a paid bill
      offers none and the test asserts no `setOrderInvoiceChoice` (or any issuance or correction)
      request is made (finding 7, D8).
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.table-menu.test.ts src/till-app-bill-payments.test.ts -t 'A803'`.
- [x] Implement; re-point the kind-R checks.
- [x] GREEN: those files and `till-table-order-screen.test.ts`, `.actions-unsaved.test.ts`,
      `.parties.test.ts`, `.allergy.test.ts`, `.bill-controls.a11y.test.ts`, plus the drawer-opening
      app files `till-app-parties.test.ts`, `till-app-adjustments.test.ts` and
      `till-app-bill-payments.test.ts` unfiltered (they still open the drawer and must stay green);
      till typecheck.
- [x] Commit: "One ⋮ menu for the bill on screen and the whole table".

### Task 10 as built (2026-10-31)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 56–58% before each browser
run.

- **RED.** The listed command as two runs. `till-table-order-screen.table-menu.test.ts` plus
  `till-app-bill-payments.test.ts -t A803` before the app cases were written: `16 failed`, the
  existing A803 refund case passed; every screen case failed on the missing ⋮
  (`[data-table-menu]` null). Then the two app cases (`-t 'A803 invoice'`): `Tests 2 failed | 243
  skipped (245)`, both on the missing ⋮ (`Cannot read properties of null (reading 'click')`,
  `expected null not to be null`). The paid-bill case's "no Full invoice" line already held for the
  payment step; it fails only once the ⋮ is drawn without its gate (control C2).
- **GREEN.** The listed files (`.table-menu`, `till-app-bill-payments`, `till-table-order-screen`,
  `.actions-unsaved`, `.parties`, `.allergy`, `.bill-controls.a11y`, `.a11y`, `.bill-switcher`,
  `till-app-parties`, `till-app-adjustments`): `Test Files 11 passed (11)`, `Tests 1608 passed
  (1608)`. Every file under `src/screens` (168): `Tests 4025 passed (4025)`. Every
  `till-app*.test.ts` plus `src/i18n` (53 files): `Tests 4783 passed (4783)`.
  `pnpm --filter @waitron/till typecheck` exit 0; prettier `--check` and eslint on the changed files
  exit 0; root guards english-only, style-token-names, primary-coloured-text, native-form-fields:
  `Tests 2062 passed (2062)`.
- **Built.** `tableMenu(...)` in `table-bill-controls.ts`: a `wt-row-actions` (kebab, label "Table
  actions", `align="end"`, `data-table-menu` and `data-move-split`) holding two `role="group"`
  sections, `data-table-menu-bill` and `data-table-menu-table`, each named by its visible heading
  through `aria-labelledby`, split by a rule (the More menu's pattern). It sits in the panel head
  after the switcher. The `menu` step and the Table actions button are gone; the drawer no longer
  holds the action steps. A step chosen in the ⋮ (`pick`, `transfer-lines`, `split-lines`,
  `split-table`) is drawn in its own side panel (`aside.drawer.action-panel`,
  `data-action-panel`) beside the order while it is open, and Back from a first step closes it.
  Comp the bill (`#compBill`, shared with the foot's `#billAdjust`), Full invoice (D8 gate:
  `fullInvoices && owing && invoiceNumber === undefined`, the same `choose-bill-invoice` detail),
  Receipt copy, Cancel and credit, Bill requested / cancel request and Finish table are drawn in the
  ⋮ with their existing hooks and events; the drawer's and the foot's copies are unchanged.
  `#refocusMenu` focuses the ⋮ when the last of the naming, bill-naming, guests and split-guests
  windows closes (A1234). New string `table.whole_table` "Whole table" / «Toda la mesa» (ES
  proposal, for Owner question 1).
- **Departures.** (a) **Whole table order** is Allergies, Name the party, Guests, Bill requested,
  Split a table, Join a table, Move guests, Finish table, not D4's Guests, Name the party,
  Allergies. Two existing checks pin the old order: `till-table-order-screen.allergy.test.ts:139`
  ("offers Allergies first in Actions", from A669's spec line "Actions gains Allergies, first in the
  list", `docs/superpowers/specs/2026-10-14-a669-allergy-at-the-table-design.md:162`) and
  `till-table-order-screen.test.ts:6148` ("offers Guests right after Name the party"). Neither the
  A803 spec (§3.5 lists no Allergies) nor an owner answer moves them, so they were kept and
  re-pointed only; the driver decides whether D4's order wins. (b) With no party, Whole table reads
  Join a table, Move guests (the party order), where the case text says "Move guests and Join a
  table". (c) A ⋮ item that leaves an open step holding a choice (split quantities, a transfer
  target or lines, Split a table's table) asks the unsaved question first, as Back does
  (`#fromMenu`); the old menu could not be reached while a step was open. New case in
  `.actions-unsaved.test.ts` "A803 single menu: another ⋮ item asks before leaving staged split
  quantities". (d) The step panel (D9's side column) is built now rather than in 11c, because the
  ⋮ left the drawer and a step chosen from it has to show somewhere; 11c still removes the drawer.
  (e) The duplicated hooks made unscoped selectors in existing tests find the ⋮ copy first (it is
  earlier in the page). Positive selections that read the drawer's or the foot's control were
  scoped `:not([data-table-menu] *)` so each keeps reading the control it read before (rows
  below); unscoped `toBeNull()` checks were left unscoped, so they now cover the ⋮ copy too. (f)
  The ⋮ uses `variant="ghost" align="start"` buttons, as the More menu does.
- **Found, not caused here.** `till-table-order-screen.sent-actions.test.ts` "a retained Void
  cannot begin consent after party changes" and "a retained Comp cannot open after party changes"
  fail on the branch without this task's ⋮ (control: the ⋮ taken out of the head, `Tests 2 failed |
  133 passed (135)`), in `billRowContent` (`party.unsentDrafts.filter`), because the test sets
  `el.party = { id: "other" }` cast to `TableParty`. I believe this came with Task 9's switcher
  (not checked against `1707e6fe2`). The ⋮ makes three more such cases fail the same way
  (`party.tableIds.length`). All five setups now use a whole party (`{ ...switcherParty, id }`),
  kind S below.
- **Deletion controls** (each production line broken in a copy, the named cases run, the file put
  back and `cmp`'d, no difference): C1 Full invoice without `invoiceNumber === undefined`: "a
  presented bill with an invoice number offers no Full invoice" fails. C2 without `owing(bill)`:
  the screen's paid-bill case and the app's "a paid bill offers no Full invoice and sends no invoice
  request" fail. C3 without `fullInvoices`: "offers no Full invoice while full invoices are off"
  fails. C4 a bill heading with no bill on screen: "with no bill on screen there is no bill group"
  fails. C5 `#refocusMenu`'s focus line removed: the three A1234 cases fail. C6 `#fromMenu` never
  asking: the new actions-unsaved case and the existing "departed action-menu controls cannot
  replace a staged split" fail. C7 `#actionPanel` drawing nothing: "choosing Merge bills shows its
  picker beside the order, and Back closes it" fails. C8 the bill heading's id changed so
  `aria-labelledby` names nothing: axe does not report it (`16 passed`), but 8 table-menu cases fail
  (they read each group's name through it); the heading in `--wt-color-border`: the 8 open a11y
  cases fail, so the open cases do scan the list. C9 Guests before Name the party: the table-menu
  order case and `:6148` fail. C10 the ⋮'s Full invoice sending `revision + 1`: "each copy sends
  its own event" and the app's "the ⋮'s Full invoice and the payment step's write the same bill at
  the same revision" fail. C11 Split a table at one table: "offers Split a table only at two or more
  tables" fails. C12 an extra Move this bill item with no party: the no-party case fails (adding
  Comp the bill there instead changes nothing, as `#adjustable()` already needs a party).

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `till-table-order-screen.test.ts:724-731` ("renders an ENABLED Table actions trigger that opens the action menu") | R | the trigger inside the drawer (`openDrawer` dropped), its `textContent`, `[data-action-menu]` null then not null → the ⋮ host, its `label`, its popup closed then open after its trigger button is clicked; the not-disabled check was left on the host, which never carries `disabled`, so it could not fail (review M3; corrected in "Task 10 review answers") | D4 | 10 |
| `till-table-order-screen.test.ts:4214` (`toMenu`) | S | clicks the `[data-move-split]` host → clicks its trigger button, so the ⋮ opens; still opens the drawer first | D4 | 10 |
| `till-table-order-screen.test.ts:4245-4253` ("shows all five action verbs … and a Back control") | R | verbs and Split read anywhere → inside `[data-table-menu]`; `[data-action-back]` present → the ⋮'s trigger closes it (popup not open after a second tap) | D4 (the menu step and its Back go) | 10 |
| `till-table-order-screen.test.ts:4281`, `:5043`, `:6296`, `:6449`, `:6763` (`[data-action-menu]` null after a split, Move guests, merge, transfer, a tab change) | R | → `[data-action-panel]` null (the step closed); before this task the selector would have matched nothing at all | D4 | 10 |
| `till-table-order-screen.test.ts:5642` ("Back from choosing Split a table's bill returns to its tables", last check) | B | the second Back reaches the menu (`[data-action-menu]` not null) → closes the step (`[data-action-panel]` null); the first Back's check unchanged | D4 ("the old `menu` step goes") | 10 |
| `till-table-order-screen.test.ts:6017-6023` ("offers Name this bill, right after Name the party") | B | retitled "…, first under the bill on screen, …"; `[data-action="name"]`'s next sibling → the first `wt-button` of `[data-table-menu-bill]`; the label check unchanged | D4 (Name this bill is in the bill section) | 10 |
| `till-table-order-screen.test.ts:6030` (counter order) | R | `[data-action-menu]` not null → `[data-table-menu]` not null | D4 | 10 |
| `till-table-order-screen.test.ts:6056` (bill naming window open) | R | `[data-action-menu]` null → the ⋮'s popup not open | D4 | 10 |
| `till-table-order-screen.test.ts:6739-6748` ("Back from the menu closes; Back from a picker returns to the menu") | R | retitled "Back from a picker closes it"; after Back from the move picker `[data-action-menu]` not null → `[data-action-panel]` null; the second Back (from the menu) has no control left, so its click goes and its two checks (`[data-action-menu]` null, `[data-move-split]` present) are kept after the first Back as `[data-action-panel]` null and `[data-move-split]` present | D4; plan row `:6704` | 10 |
| `till-table-order-screen.actions-unsaved.test.ts:120` (`mount`) | S | clicks the `[data-move-split]` host → its trigger button | D4 | 10 |
| `till-table-order-screen.actions-unsaved.test.ts:155`, `:171` (after Discard / clean Back) | B | poll for `[data-action-menu]` present → for `[data-action-panel]` absent | D4 | 10 |
| `till-table-order-screen.allergy.test.ts:139` ("offers Allergies first in Actions") | R | `[data-action-menu] [data-action]` → `[data-table-menu-table] [data-action]`; Allergies still first (departure a) | D4, A669 spec :162 | 10 |
| `till-table-order-screen.sent-actions.test.ts:110`, `:496`, `:652`; `till-table-order-screen.sent.test.ts:308`, `:441` | S | `el.party = { id: … } as …` → `{ ...switcherParty, id: … }`, same id; every `expect` byte-identical | a cast fixture the switcher and the ⋮ cannot draw | 10 |
| `till-table-order-screen.bill-payments.test.ts:161`, `:165`, `:263`, `:487`, `:524`, `:544`; `.panel-footer.test.ts:40`, `:64`, `:85`, `:183`, `:226`; `.panel-footer.a11y.test.ts:53`, `:71`; `.adjustments.test.ts:440`; `.a11y.test.ts:446`; `till-app-adjustments.test.ts:498`, `:698`; `till-app-handheld-pay.test.ts:257`; `till-app-recipient-identity.test.ts:240`; `till-app-bill-payments.test.ts:555`, `:583`, `:620`, `:680`, `:732`, `:804`, `:6390`, `:6432`, `:6469`, `:6507`, `:6532`, `:6586`, `:6650`, `:6683`, `:6727`, `:6755` | R | `"[data-discount-bill]"` / `"[data-choose-bill-invoice]"` / `"[data-cancel-bill-request]"` → the same with `:not([data-table-menu] *)`, so each keeps selecting the foot's, payment step's or drawer's control rather than the ⋮ copy that now comes first; assertions unchanged | D4, review-1 I6 (the drawer's and foot's copies stay) | 10 |
| `till-table-order-screen.bill-payments.test.ts:299` (a presented bill's unanswered whole payment on a handheld: no Full invoice) | ~~R~~ **loosened; reverted** | was changed to "none outside the ⋮", which let the ⋮ offer Full invoice while a whole payment's answer is unknown (review I1: a loosened check, not kind R). Restored to its unscoped `toBeNull()`, byte-identical to `6711fb40e`, and the ⋮'s Full invoice now takes the payment step's gate (see "Task 10 review answers", I1) | D8, A773-1 (`c9ad7a634`) | 10, fixed in the review answers |

## Task 11a: screen tests reach bills and actions through the switcher and the ⋮ (≈60 calls)

The drawer still exists in this task; tests stop depending on it. **Files.** The screen test files
that open the drawer (`rg -l data-open-drawer apps/till/src/screens`; about 20 files, including the
`*-retirement`, `.a11y`, `.loading`, `.empty-drawer.a11y`, `.populated-drawer.a11y`,
`.current-orders`, `.sent*`, `.adjustments*`, `.bill-payments*`, `.panel-footer` files and
`sent.test-helpers.ts`). Each site is re-pointed (kind R) to the ⋮, the switcher or the foot. Sites
whose check reads what only the drawer holds until 11c — the table's still-to-pay row, the Finish
table refusal, the Tab badge — are left as they are and listed in the ledger for 11c. If the sweep
passes ~55 calls, commit at a green file boundary and hand over.

- [x] RED: none new; the change is in where each test looks. For each file: run it, re-point, run
      it again; record each changed check (file:line, what it opened before, what it opens now).
- [x] GREEN: `rg -l 'till-table-order-screen' apps/till/src/screens -g '*.test.ts' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`;
      `rg -n 'data-open-drawer' apps/till/src/screens -g '*.test.ts' -g '*helpers.ts'` prints only
      the sites listed for 11c; till typecheck.
- [x] Commit: "Screen tests reach bills and actions through the switcher and the ⋮".

### Task 11a as built (2026-10-31)

The sweep ran past the ~55-call mark; it was finished in this run rather than handed over, as
every file was green at each step.

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 52–56% before each browser
run. File names below drop the `till-table-order-screen` prefix; lines are at this task's commit
unless written "was :N" (a line at `037016e5b` that this task deleted).

- **Before.** The GREEN command at `037016e5b`: `Test Files 91 passed (91)`, `Tests 1758 passed
  (1758)`, `Errors 6 errors`, exit 1. A first run of the same command also reported `1 failed`;
  the second did not, and I did not find which case it was. The 6 errors are `TypeError: Cannot
  read properties of undefined (reading 'length')` in `#tableMenu`
  (`till-table-order-screen.ts:5479`, `party.tableIds.length`) while `.drag`, `.sent-reorder` and
  `.arrangement-authority` cases run with a party fixture that has no `tableIds`. They come with
  Task 10's ⋮ (the same cause as its "Found, not caused here" note), not from this task, and none
  of those files opens the drawer, so they are left for the driver.
- **After.** The GREEN command: `Test Files 91 passed (91)`, `Tests 1758 passed (1758)`, the same
  6 errors, exit 1. The 25 changed test files after the lint fixes: `Test Files 25 passed (25)`,
  `Tests 666 passed (666)`, exit 0. Every changed file's count equals its count before (main 344,
  `.parties` 35, `.a11y` 60, `.current-orders` 38, `.bill-payments` 28, the rest as before).
  `pnpm --filter @waitron/till typecheck` exit 0; `pnpm exec prettier --check` and
  `pnpm exec eslint` on the changed files exit 0.
- **Helper.** `tapTableMenu(el)` in `till-table-order-screen.bill-switcher.test-helpers.ts` taps the
  ⋮'s trigger (opens its list, or closes it when open). No switcher helper was needed: no screen
  test here reads a bill through the switcher, because the drawer's bill rows (name, total, state,
  Take payment) have no byte-identical twin in the switcher's rows (see 11c leftovers).
- **Two kinds of change.** (1) **R**: a check that read the drawer now reads the control that holds
  the same thing: the drawer's action copies → the ⋮'s, the drawer's tab total → the foot's
  `[data-order-total]` (the same `#payStore` total when no draft line is unsent, which holds in
  every case moved), and a "the drawer holds no X" check → "the open ⋮ holds no X", since the ⋮
  and the switcher are what take the drawer's place. (2) **S**: a drawer opened (or closed) before
  checks that read nothing in it is no longer opened; every `expect` byte-identical. Several of
  these opens were closing a drawer an earlier helper had opened (`.adjustments` `:286`/`:300`,
  `.bill-payments` `:459`, `.a11y` `:644`, all "was").
- **Departure.** The plan calls every 11a change kind R; the dropped vestigial opens are kind S
  (setup only), recorded as such. Test titles that said the test opens the drawer were retitled to
  the table menu; no assertion changed for it.
- **STOP:** none. No check on money totals, VAT, permissions or filing needed anything other than
  a re-point: six tab-total checks moved to the foot's total (`.test.ts:628`, `:666`, `:763`;
  `.empty-drawer.a11y` at 0.00 and at 2.00; `.populated-drawer.a11y` at 10.00), each with the same
  `toContain` or `not.toBeNull()`. The values match in all six because each setup is a single bill
  with no party (the review's probe printed both texts in each: equal).

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.parties.test.ts:211` (Receipt copy of the paid bill on screen) | R | the drawer row's `[data-bill-receipt]` → the ⋮'s; the event check unchanged; `:214` (no receipt on another bill's row) stays on the drawer | D4 | 11a |
| `.parties.test.ts:361`, `:364`, `:377`, `:378`, `:389`, `:400`, `:406` (Mark bill requested / Cancel the bill request: text EN and ES, disabled while busy, the other absent) | R | `bills(el)` (the drawer's bills section) → `menu(el)` (`[data-table-menu]`); the bill-requested chip checks `:363`, `:374`, `:404` stay on the drawer (the ⋮ has no chip) | D4 | 11a |
| `.parties.test.ts:417` (Finish table asks) | R | the drawer's `[data-finish-table]` → the ⋮'s | D4 | 11a |
| `.test.ts:743` (embedded: "body function stays") | R | `[data-open-drawer]` present → `[data-table-menu]` present; retitled "…, keeping the table menu" | D4 | 11a |
| `.test.ts:565`, `:573` (badge and To serve card after the last dish is served) | R | opens the drawer → the ⋮; `[data-drawer] .pending` null → `[data-table-menu] .pending` null; the badge checks unchanged (11c) | D4 | 11a |
| `.test.ts:626-628`, `:663-666` (tab total from locked prices; total stays without settlement) | R | opens the drawer and reads `[data-tab-total]` → opens the ⋮ and reads the foot's `[data-order-total]`; `toContain(formatMoney("4.50"))` and `not.toBeNull()` unchanged | the foot holds the total (D9) | 11a |
| `.test.ts:712-713` ("has no Status section") | R | drawer opened and present → ⋮ opened and its list open (`tableMenuOpen`); the two Status checks unchanged | D4 | 11a |
| `.test.ts:754-763` (empty tab) | R | drawer → ⋮ for the opened container, its text and `.pending`; `[data-tab-total]` 0.00 → `[data-order-total]` 0.00; the badge check unchanged | D4, D9 | 11a |
| `.test.ts:2924-2929` (no Send on a held group's line) | R | opens the drawer, `[data-drawer] [data-group-fire]` null → opens the ⋮, `[data-table-menu] [data-group-fire]` null | D4 | 11a |
| `.test.ts` was `:605`, `:643`, `:672`, `:680`, `:693`, `:706`, `:1661` (`mountGroups`), `:2449`, `:2580`, `:2646`, `:2688`, `:2702`, `:2722`, `:2733`, `:2743`, `:2761`, `:2782`, `:2788`, `:2801`, `:2825`, `:2847`, `:2900`, `:2963`, `:2995`, `:3011`, `:3033`, `:3278` (`openPicker`'s close-if-open), `:3315`, `:3323`, `:3332`, `:3341`, `:3349`, `:3359`, `:3369`, `:3379`, `:3392`, `:3403`, `:3448-3453` (a11y click), `:3488`, `:3503`, `:3536`, `:3581`, `:3621`, `:3632`, `:3653`, `:3670`, `:3685`, `:3717`, `:3733`, `:3750`, `:3768`, `:3777`, `:3813`, `:3833`, `:3879`, `:3893`, `:3901`, `:3918`, `:3936`, `:3949`, `:4213` (`toMenu`), `:7162` | S | `await openDrawer(el)` before checks on Sent, the pay card, the ⋮ or the editors → removed; every `expect` byte-identical | the drawer holds none of it | 11a |
| `.drawer-placement-retirement.test.ts:50-55`; `.drawer-placement-retirement.a11y.test.ts:69-83`; `.drawer-service-retirement.test.ts:43-46`, `:96-101`, `:159-177`; `.current-list-retirement.test.ts:61-64`; `.drawer-station-retirement.test.ts:52-54`; `.sent-course.test.ts:167-168`; `.sent-course.a11y.test.ts:61-78`; `.sent-prices.test.ts:127-129`; `.sent-prices.a11y.test.ts:91-95`; `.service-migration.a11y.test.ts:67-68`; `.current-orders.test.ts:628-632`; `.standalone-send-retirement.test.ts:93` | R | "the opened drawer holds no X" (placement, firing, serving, course, Served, reminder, Send, station or Comp controls, or the dish's name) → "the opened ⋮ holds no X": the drawer open/close → `tapTableMenu`, `[data-drawer]` → `[data-table-menu]` (the a11y screenshot and `scrollIntoView` element with it); every null / `not.toContain` and every Sent check unchanged; titles that said "drawer" say "table menu" | D4 | 11a |
| `.reorder-retirement.test.ts:42-48` | R | drawer opened and present → ⋮ opened and its list `:popover-open`; the no-reorder-arrows check unchanged | D4 | 11a |
| `.empty-drawer.a11y.test.ts:35-57`, `:91-93`; `.populated-drawer.a11y.test.ts:84-99` | R | the drawer open/close → `tapTableMenu`; `drawer` visible / no `.pending` / no To serve title → the ⋮; `[data-tab-total]` (0.00, 2.00 visible within the width; 10.00) → `[data-order-total]`; badge checks unchanged (11c, D17) | D4, D9 | 11a |
| `.loading.test.ts:30`, `:78` | R | `[data-open-drawer]` hidden while loading / shown after → `[data-table-menu]` | D4 | 11a |
| `.a11y.test.ts:200` (round grid scan) | R | the drawer opened so its subtree is scanned → the ⋮ opened so its list is; comment says so; retitled "…and the open table menu" | D4 | 11a |
| `.a11y.test.ts` was `:243`, `:326` (`mountDrawer`), `:369`, `:629` (`withGroups`), `:644`, `:767`, `:795`, `:827`, `:886`, `:963`, `:989`, `:1011`; `.adjustments.test.ts` was `:126` (`mountScreen`), `:132-135` and `:478-481` (close-if-open), `:286`, `:300`; `.bill-payments.test.ts` was `:109` (`mountScreen`), `:459`; `.current-orders.test.ts` was `:59` (`mountCurrent`); `.allergy.test.ts` was `:137`; `.actions-unsaved.test.ts` was `:119`; `.bill-payments.a11y.test.ts` was `:110` (`mountHandheld`) | S | drawer open (or close) before checks that read nothing in it → removed; every `expect` byte-identical. `.a11y.test.ts:213` retitled "has no violations with a child extras row" and its comment no longer names the drawer surface | the drawer holds none of it | 11a |
| `.adjustments.a11y.test.ts:145-147`; `.bill-payments.a11y.test.ts:124`, `:198` (scans) | R | the drawer opened for the scan → the ⋮ opened for the scan (`:124` also takes `el`); the "scan must include" guards unchanged | D4 | 11a |
| `.bill-payments.test.ts:179-180` (Full invoice recipient on a bill row) | S | the drawer, opened by `mountScreen` for every case, is opened by this case alone; its check unchanged (11c site) | — | 11a |
| `.bill-payments.a11y.test.ts:146-147` (LOOK: the drawer's background differs by theme) | S | the drawer, opened by `mountHandheld`, is opened by this case alone; its checks unchanged (11c site) | — | 11a |

**Left for 11c** (each reads what only the drawer, its handle or its badge holds until then;
`rg -n 'data-open-drawer' apps/till/src/screens -g '*.test.ts' -g '*helpers.ts'` prints exactly
these):

- `.test.ts:188` (`openDrawer`, used only by `:542`), `:542` ("keeps the tab drawer closed until its
  handle is tapped"), `:556` (the handle's accessible name with the badge count), `:4102` (the
  status's next sibling is the Tab button), `:4138` (the Tab button on one line at 390px).
- `.parties.test.ts:105` (`mountScreen`): the drawer's bills section: bill rows with their name,
  total, state and `aria-current` (`:129-247`), Take payment on a bill's row (`:217-265`),
  Receipt copy absent on another bill's row (`:214`), Cancel and credit on another bill's row
  (`:304-335`), the bill-requested chip (`:363`, `:374`, `:404`), the still-to-pay row (`:142`), and
  the Finish table refusal with its Take payment and Record unpaid departure (`:422-506`).
- `.a11y.test.ts:408` (scan of the bills section with the Finish refusal) and `:437` (scan of the
  bills section with the bill-requested chip; reads the drawer's `[data-cancel-bill-request]`).
- `.loading.test.ts:38` ("a drawer left open is not shown while loading").
- `.panel-footer.test.ts:117` (opening and closing the drawer keeps one pay card).
- `.bill-payments.test.ts:179` (the drawer row's Full invoice recipient, `[data-invoice-choice]`).
- `.bill-payments.a11y.test.ts:146` (LOOK: the drawer's background differs by theme).
- `.sent.test-helpers.ts:69` (`sentFallbackFor` closes a drawer a caller left open; app tests in
  11b may still do so).
- Badge checks with no drawer open (D17 rows): `.test.ts:550`, `:572`, `:755`;
  `.empty-drawer.a11y.test.ts:47`; `.populated-drawer.a11y.test.ts:94`.

### Task 10 review answers (2026-10-31, `a803-3-reviews/task-10.md`)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 53% before the browser runs.
Every deletion control below changed one production line in the worktree by a script that asserts
its pattern occurs once, ran the named files, and put the file back (`cmp` against a saved copy, no
difference).

- **I1, Full invoice in the ⋮ while a whole payment is unanswered.** Fixed: `#billDocumentItems`
  gates the ⋮'s Full invoice on `this.paymentConfirmation === undefined` as well, the same condition
  the payment step's `#billChoices` is drawn under. RED: `.bill-payments.test.ts:299` restored to
  `expect(el.shadowRoot!.querySelector("[data-choose-bill-invoice]")).toBeNull()` (byte-identical to
  `6711fb40e`), run before the fix: `Tests 1 failed | 27 skipped (28)`, `AssertionError: expected
  <wt-button …(5)></wt-button> to be null`. GREEN: the file `Tests 28 passed (28)`. The RED run is the
  deletion control (the code without the gate). Not added: a refusal in the app's
  `#onChooseBillInvoice` (the review's optional second gate); the screen's gate is still the only one.
- **I2, the ⋮ list taller than the window.** Fixed in the primitive, opt-in: `wt-row-actions` gains
  a boolean `opens-below` (`opensBelow`). With it the popup is placed at the trigger's bottom and its
  `max-height` is the room from there to 8px above the window's bottom, so the list scrolls (the
  popover's own `overflow: auto`) instead of moving up over its trigger. Without it nothing changes:
  `positionPopup` takes the old path, and the existing "lifts its popup to exactly 8px above that
  edge" case still passes. `tableMenu(...)` sets `opens-below`. No new painted property (no token
  test needed); a11y covered below. The other users of `wt-row-actions` do not set it. Measured
  (LOOK run): 1024×768 trigger 58–102, list 102–760, `scrollHeight 791 / clientHeight 656`; 375×667
  trigger 110–154, list 154–659, `791 / 503`.
  - `wt-row-actions.test.ts` "opens-below": four cases. RED (the old primitive put back, new tests
    kept): `Tests 4 failed | 75 passed (79)`: "a menu taller than the room under its trigger…"
    (`expected 8 to be close to 92`), "does not open over its own trigger…" (the point at the
    trigger's centre was a `wt-button`, not the host), and the two new a11y cases (`expected 1452 to
    be greater than 1452`: nothing scrolled). The other two ("without it, the same menu still moves up
    to fit, over its trigger"; "leaves a menu that fits under its trigger at its own height") pass on
    both, as controls. GREEN: `Tests 79 passed (79)`.
  - `.table-menu.test.ts` "at 1024x768 / 375x667 the list opens under its trigger, fits the window and
    scrolls Finish table into reach": 15 items, list top ≥ trigger bottom, bottom ≤ window, it
    scrolls, the point at the trigger's centre is the ⋮ host, and a real click on Finish table sends
    `finish-table`. Control (`opens-below` taken out of `tableMenu`): both fail, `expected 8 to be
    greater than or equal to 101.5` and `… 153.5`.
  - LOOK: no scrollbar is drawn in headless Chromium (overlay scrollbars), so nothing but the cut
    edge shows that the list scrolls; at 1024×768 the cut falls between two items. Left as it is.
- **I3 and M2, a step chosen from the ⋮ out of view, focus dropped.** Fixed: a ⋮ item that opens a
  step (`#chooseVerb`, Split a table) marks the step for focus; after the render the panel's step
  heading (each step's `h2`, now `tabindex="-1"`, as `#draft-title` already is) takes focus, and the
  panel is scrolled into view (`block: "nearest"`) once its buttons have drawn (scrolling at once
  measured the panel before its buttons had their height and left its bottom 71px out of the
  window). `update()` notes, before the render removes it, whether focus is inside the panel: a step
  replaced while focus is there (Split a table's second step, Back from it) focuses the new heading;
  a step closed while focus is there (Back, Escape, a pick that finishes) focuses the ⋮'s trigger;
  a step closed while focus is elsewhere (another bill chosen) leaves focus alone. **Escape** inside
  the panel does what its Back does, including asking first when the step holds a choice: every step
  has Back, and Escape already closes the ⋮'s list and the till's windows, so it was cheap and
  consistent. LOOK: Spanish 1024×768 Merge bills, panel top 604, height 164 (bottom 768), heading
  focused («Juntar una cuenta con Clint · Cuenta 2 · Ana»); the panel still sits under the whole
  order at that width, which is 11c's layout (D9).
  - Cases in `.table-menu.test.ts` "a step chosen from the ⋮ is shown and takes focus; leaving it
    returns focus to the ⋮": (1) Spanish 1024×768, four sent lines, three bills: Merge bills' panel
    wholly inside the window (polled) with its heading focused, Tab reaches the first target, Back
    (real click) → panel gone and focus on the ⋮'s trigger, Escape → the same; (2) Split a table →
    table → the second step's heading focused, Escape → the first step, heading focused; (3) see M4;
    (4) a step closed by choosing another bill while the switcher has focus leaves focus on the
    switcher. Controls, each failing only the cases named: no `scrollIntoView` → (1)
    (`expected 1225.28125 to be less than 768`, before the wait-for-buttons change; after it the
    same case fails on the poll); scrolling before the buttons draw → (1); no heading focus → (1),
    (2); no ⋮ focus on close → (1); no step-to-step focus → (2); no Escape handler → (1), (2);
    focus to the ⋮ on every close → (4).
  - `.bill-controls.a11y.test.ts` "A803 single menu at a phone's height": in both themes at 375×667
    the open ⋮ (scrolling) and then the Merge step with its heading focused pass axe.
- **I4, seven ⋮ guards with no failing case.** Five cases added in `.table-menu.test.ts` ("the ⋮'s
  copies keep the guards of the controls they copy") and one in `.actions-unsaved.test.ts`. Each
  mutation run against `.table-menu`, `.actions-unsaved` and `.parties` (unmutated `Tests 77 passed
  (77)`):
  - M2 Receipt copy without `receiptAvailable`: `1 failed`, "a paid bill without a receipt offers no
    Receipt copy".
  - M3 Cancel and credit without `!hasPayments`: `1 failed`, "a presented bill with a receipt and
    payments offers no Cancel and credit".
  - M5 the request item always sending `{ requested: true }`: `2 failed`, the new "a requested bill
    offers to cancel the request, which sends requested false" and `.parties` "shows a requested bill,
    and offers to cancel the request…" (Task 11a re-pointed that case to the ⋮, after the review ran).
  - M6 the request item without `.disabled=${this.groupCommandBusy}`: `2 failed`, the new "holds Mark
    bill requested while a party command runs, and Full invoice while busy" and `.parties` "holds the
    action while another command on the party runs" (also 11a's re-point).
  - M7 Full invoice without `.disabled=${this.busy}`: `1 failed`, "holds Mark bill requested while…".
  - M10 `#fromMenu` without `#actionControlCurrent(event)`: `1 failed`, "a step or window item does
    nothing while the screen is busy".
  - **M9 `#fromMenu`'s `opening`/`step` check: no case can fail without it**, and I did not find one
    that could. The leave coordinator (`packages/ui-core/src/unsaved-changes.ts`, `invalidate` and
    the `"stale"` result) aborts an open question whenever the step's draft scope changes or is
    disposed, and every path that changes the step or `#actionOpening` while a question is open
    goes through `changed()` or `#retireActions()`; so `proceed` never runs with a stale step. Tried:
    the new case "a ⋮ item's old Discard answer does not replace a step opened since" (Confirm
    between the question and an old Discard), a Confirm in the same turn as Discard, and Back pressed
    under an open question: each gives the same result with and without M9. `#actionBack`'s
    identical check is in the same state: without it `.actions-unsaved` gives `Tests 21 passed (21)`.
    The check is kept as a second layer; the new case is kept because it pins the outcome both
    layers protect, and it says so here rather than in its title.
- **M3, a re-pointed check that could not fail.** `.test.ts:721-731` now reads the ⋮'s own trigger
  button: `button.disabled` false, its `aria-disabled` not `"true"`, and no `inert` ancestor, as well
  as the host's `disabled`; it taps that button. The old check (`6711fb40e`, from `6f0139c73`, which
  turned a hard-disabled "Move · Split" button into Table actions) guarded that the control the waiter
  taps is not disabled. Controls: `disabled` on the primitive's button → fails at `:724`
  (`expected true to be false`; the host-only check passed this); `inert` on the ⋮ in `tableMenu` →
  fails at `:726`.
- **M4, the A1234 refocus stealing focus.** Case (3) above, "a redraw with no step or window closing
  leaves focus where it is": the switcher's trigger focused, then three redraws (`bills`,
  `groupCommandBusy`, `lines`), focus unchanged. Control (the review's M8, `if (!open)`): fails, as
  does case (4).
- **M1** is Task 11c's: one line added to its case list (the Finish table refused case taps the ⋮
  item with the drawer closed). Not built here.
- **The 6 errors.** `TableParty.tableIds` is required (`apps/till/src/api/client.ts`, `tableIds:
  string[]`), so the parties were partial cast fixtures. Kind S rows below. Before:
  `.drag`, `.sent-reorder`, `.arrangement-authority`: `Tests 100 passed (100)`, `Errors 3 errors`,
  each `TypeError: Cannot read properties of undefined (reading 'length')`. After, with
  `.split-authority` (the same cast, no error seen, changed for the same reason): `Tests 148 passed
  (148)`, no `Errors` line.
- **GREEN.** `rg -l 'till-table-order-screen' apps/till/src/screens -g '*.test.ts' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`:
  `Test Files 91 passed (91)`, `Tests 1772 passed (1772)`, no `Errors` line, exit 0 (one run, no
  failure seen, so the unexplained `1 failed` 11a saw once did not recur). `till-app-bill-payments`,
  `till-app-parties`, `till-app-adjustments`: `Tests 1068 passed (1068)`, exit 0. Every
  `till-shell*.test.ts` (the More menu uses `wt-row-actions` without `opens-below`): `Tests 383
  passed (383)`. `packages/ui` `wt-row-actions.test.ts` and `.a11y.test.ts`: `Tests 79 passed (79)`;
  `no-hardcoded-chrome.test.ts`: `Tests 88 passed (88)`. `pnpm --filter @waitron/till typecheck` and
  `pnpm --filter @waitron/ui typecheck` exit 0; `pnpm exec prettier --check` and `pnpm exec eslint`
  on the changed files exit 0.
- **LOOK.** `a803-3-reviews/task-10-fix-shots/`: `en-1024x768-{light,dark}-open[-scrolled].png`,
  `en-375x667-{light,dark}-open[-scrolled].png`, `es-1024x768-{light,dark}-merge-step[-later].png`.
  Looked at: 1024 light open (list under the switcher row, ending at Split a table with room below),
  1024 dark scrolled (Finish table last, inside the window), 375 dark scrolled (Finish table inside
  the window), Spanish merge step light and dark (panel wholly visible at the window's bottom). The
  ⋮'s kebab icon does not draw in these screen tests (an empty gap between the switcher and Back to
  floor); I did not look into why.
- **STOP:** none. No check on money totals, VAT, permissions or filing changed; the one Full invoice
  check is restored, not changed.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.bill-payments.test.ts:299` | restored | Task 10's `:not([data-table-menu] *)` scope removed; byte-identical to `6711fb40e` | review I1 | 10 review |
| `.test.ts:721-731` ("renders an ENABLED Table actions trigger…") | R (tightened) | the host's `disabled` only → also the trigger button's `disabled`, its `aria-disabled` and no `inert` ancestor; the click goes to that button (as before) | review M3; `6f0139c73` | 10 review |
| `.drag.test.ts:456`, `.sent-reorder.test.ts:67`, `.arrangement-authority.test.ts:200`, `.split-authority.test.ts:85` | S | `el.party = { id: "other" } as …` → `{ ...switcherParty, id: "other" }`, same id; every `expect` byte-identical | a cast fixture the ⋮ cannot draw (`tableIds` required) | 10 review |

### Task 11a review answers (2026-10-31, `a803-3-reviews/task-11a.md`)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 61% before the browser runs.

- **I1.** `tapTableMenu` is gone from `.bill-switcher.test-helpers.ts`; `openTableMenu(el)` and
  `closeTableMenu(el)` each `expect` the ⋮'s `[popover]` closed (open) before the tap and open
  (closed) after it. Every caller now opens or closes by name. One caller relied on the old toggle:
  `.drawer-service-retirement.test.ts` (the Comp/discount case) opened the ⋮, then tapped the Sent
  panel's toggles, which close the ⋮'s list, and its "close" tap opened the list again. The open now
  comes after the toggles, right before the checks it serves; the checks are unchanged. Control:
  the first `await openTableMenu(el)` in `.empty-drawer.a11y.test.ts` deleted: `Tests 8 failed (8)`,
  `AssertionError: expected false to be true` at `closeTableMenu`; file put back from a saved copy.
- **M1.** Every 11a re-pointed absence check scoped to `[data-table-menu]` now reads the screen's
  whole shadow root, which takes in the ⋮, the switcher, the foot and the side panel but not
  `till-sent-orders`' own shadow. The text checks ("Recorded dish", the To serve titles) read the ⋮
  and the switcher together (`tableMenuAndSwitcherText`), since the screen's `[data-sent-fallback]`
  legitimately holds that text. Expected values unchanged.
- **M2.** Retitled to say what they check now: `.test.ts` "keeps serving in Sent, with no duplicate
  Served list anywhere on the screen", "fires a held dish through Sent More, with no direct Send
  anywhere on the screen", "keeps sent line $lineNo read-only on the screen instead of opening a
  direct Change editor", and the describe "the party's groups in the Sent panel". The narrower
  reach of the kind-S checks (they no longer see inside the drawer, which nothing opens) holds until
  11c deletes the drawer; not changed here.
- **M3.** Already fixed in `11bb4ec8c`: `.split-authority.test.ts:85` uses
  `{ ...switcherParty, id: "other" }`; `rg -n 'party = \{ id:[^}]*\} as' apps/till/src/screens`
  prints nothing.
- **M4.** Added to Task 11c below.
- **M5.** The as-built STOP paragraph now counts six tab-total checks.
- **Runs.** The 19 changed test files: `Test Files 19 passed (19)`, `Tests 546 passed (546)`. The
  GREEN command: `Test Files 91 passed (91)`, `Tests 1772 passed (1772)`, no `Errors` line, exit 0.
  `pnpm --filter @waitron/till typecheck` exit 0; `pnpm exec prettier --check` and
  `pnpm exec eslint` on the changed files exit 0.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| every `tapTableMenu` caller (`.test.ts`, `.a11y`, `.adjustments.a11y`, `.bill-payments.a11y`, `.current-orders`, `.current-list-retirement`, `.drawer-placement-retirement*`, `.drawer-service-retirement`, `.drawer-station-retirement`, `.empty-drawer.a11y`, `.populated-drawer.a11y`, `.reorder-retirement`, `.sent-course*`, `.sent-prices*`, `.service-migration.a11y`, `.standalone-send-retirement`) | R (tightened) | a toggle tap asserting nothing → `openTableMenu` / `closeTableMenu`, each asserting the list's state before and after | review I1 | 11a review |
| `.drawer-service-retirement.test.ts` Comp/discount case | R (tightened) | the ⋮ opened before the Sent toggles (which closed it) → opened after them, before the checks; checks unchanged | review I1 | 11a review |
| `.empty-drawer.a11y.test.ts:38-39`, `:92-93`; `.populated-drawer.a11y.test.ts:88-90`; `.test.ts:573`, `:760-763`, `:2932`; `.drawer-placement-retirement*`; `.drawer-service-retirement`; `.drawer-station-retirement`; `.current-list-retirement`; `.sent-course*`; `.sent-prices*`; `.service-migration.a11y`; `.current-orders.test.ts:631-632` | R (widened) | `[data-table-menu] X` / `menu.querySelector(X)` null → `el.shadowRoot.querySelector(X)` null; the ⋮'s `textContent` → the ⋮'s and the switcher's text; expected values unchanged | review M1 | 11a review |
| `.test.ts` "keeps serving in Sent…", "fires a held dish through Sent More…", "keeps sent line $lineNo read-only…", describe "the party's groups in the Sent panel" | retitled | titles promising a drawer check → what the case checks; no assertion changed | review M2 | 11a review |

### Task 10 fix review answers (2026-10-31, `a803-3-reviews/task-10-fix.md`)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 59–60% before the browser
runs. "RED" means the new cases run against the parent's code: for the primitive, `git show
HEAD:packages/ui/src/components/wt-row-actions.ts` written over the file, then the saved copy put
back (`cmp`, no difference). Every deletion control changed one production line by a script that
asserts its pattern occurs once, ran the named cases, and put the file back the same way.

- **I1, nothing showed that the ⋮'s list goes on.** Fixed in the primitive, for `opens-below`
  only: after capping the height to the room under the trigger, `capBelow` rounds the cap down so
  the list's bottom edge cuts through the middle of an action (the menu's drawn `button`,
  `a[href]` and `wt-button` elements, slotted directly or inside a slotted group). Half of the next action's label always shows; nothing new is painted (no token, so no
  token-painting case is owed; the existing `opens-below` a11y case runs in both themes and passes).
  Why the review's picture showed nothing at 1024×768: the old cut was 13px into "Join a table"
  (746–790, cut 759), but the items are borderless, so those 13px held no ink. Measured now:
  1024×768 list 102–721, cut 720 through "Split a table" (698–742); 375×667 list 154–629, cut 628
  through "Name the party" (606–650).
  - `wt-row-actions.test.ts` "a list cut short is cut through the middle of an action…": trigger
    tops 40–130px in steps of 7 at 600×400, 15 actions; at each, the cut is within 1px of an
    action's middle and the popup's bottom stays at or above 8px from the window's bottom. RED:
    `trigger top 40px: expected 12 to be less than or equal to 1`.
  - `.table-menu.test.ts` "at %ix%i the list's bottom edge cuts through the middle of an item, so
    half its label shows" (1024×768, 375×667): exactly one item crosses the cut, within a tenth of
    its height of its middle. RED: `expected 9 to be less than or equal to 4.4` (1024×768) and
    `expected 18 to be less than or equal to 4.4` (375×667). A first version that asked only for
    the cut to be between a quarter and three quarters into the item passed at 1024×768 on the old
    code (13 of 44px), so it was tightened to the middle before the fix.
  - `wt-row-actions.test.ts` "actions inside a slotted group are cut through the middle too" (15
    actions in one `role="group"` column, as the till's ⋮ slots them). Control C5 (groups not
    searched): fails, `expected 676 to be greater than 676` (no actions found, so nothing was
    capped). A first version of this case laid the group's buttons out in one row, so the list fit
    and the case failed on the fixed code; the group is now a grid column.
  - Control C1 (the rounding line deleted): the primitive's middle case fails at trigger top 40px
    (`expected 12…`), the other `opens-below` cases pass.
  - `wt-row-actions.ts` per-file coverage over its two test files: 100% statements, branches,
    functions and lines.
- **M1, Escape closed the step under an open list.** Fixed: the step panel's Escape handler returns
  without acting, and without cancelling the key, while `#layerOpen()` finds an open popover
  anywhere in the screen's shadow tree (walked down through each element's shadow root, since the
  ⋮'s and the switcher's popovers sit inside their own `wt-row-actions`). The browser's own Escape
  then closes the popover. The review's own control (handler's `preventDefault()` removed) showed
  that close happens only while the key is not cancelled. A `dialog[open]` arm was written first
  and taken out: no dialog sits inside the panel (`render()` draws the screen's dialogs, the split-guests
  dialog among them, after the panel's container, not inside it), so no case could exercise it.
  - `.table-menu.test.ts` "Escape in a step while %s is open closes only that list; the next Escape
    closes the step" (the ⋮; the bill switcher): Merge bills opened from the ⋮, the list opened by
    `show()`, the step heading focused, Escape → the list closed and the panel still there; Escape
    again → the panel gone. RED (`|| this.#layerOpen()` taken out): both fail, `expected true to be
    false` (the list still open). Control (the shadow-root walk replaced by `return false`, so only
    the screen's own root is read): both fail the same way.
- **M2, no floor under `opens-below`, and a cap left behind.** Minimum chosen: one whole action and
  half of the next. Below that the list would show one action at most and give no sign there is
  more, so moving it up over the trigger (the old placement) shows more of it, at the cost the
  setting exists to avoid. `capBelow` clears `max-height` and returns false, and `positionPopup`
  takes the old placement. `positionPopup` also clears `max-height` whenever `opens-below` is off.
  - `wt-row-actions.test.ts` "with room under the trigger for %s, it opens there or moves up to
    fit": the room for one action and half the next is measured from the mounted menu, then the
    trigger is placed so the room is that plus 2px (opens under the trigger, scrolls) or that minus
    2px (moves up, bottom 8px above the window, no cap, nothing to scroll). RED on the old code:
    the "less than that" row fails (`expected 315 to be less than 315`: it opened under the
    trigger); the "fits" row passes on both, as the control in the other direction. "a trigger at
    the window's bottom edge moves the list up to fit, whole" (trigger top 350px of 400): RED
    `expected 412 to be close to 392` (the popup below the window). Control C2 (the floor's `if`
    made `if (false)`): both fail with the same messages.
  - "hidden actions do not count toward the one action and a half the room must show": three
    `hidden` actions put before five, room 2px short of one visible action and a half → moves up,
    no cap. Control C4 (the zero-height filter deleted): fails, `expected 315 to be less than 315`.
  - "turned off, the next open drops the height it capped": RED `expected '300px' to be ''`.
    Control C3 (the clearing line deleted): fails, `expected '272px' to be ''`.
- **M3.** `docs/developers/design-system.md`, the `wt-row-actions` row: one clause for
  `opens-below` (default off; capped to the room down to 8px above the window's bottom, cut
  through an action's middle; with less room than one action and half the next it moves up as it
  does without the setting).
- **M4** is not fixed here (the review believes it predates the branch). Filed as **A1258** in
  `docs/backlog.md` and `docs/backlog/dashboard.md`, beside A1256.
- **Runs (GREEN).** `packages/ui` `wt-row-actions.test.ts`, `.a11y.test.ts`, `wt-data-table`,
  `wt-menu-row`, `tap-target-and-focus`, `no-hardcoded-chrome`: `Test Files 6 passed (6)`, `Tests
  790 passed (790)`. Till's other `wt-row-actions` users (every `till-shell*.test.ts`,
  `floor-zone-menu*.test.ts`, `till-floor-screen.zone-menu.test.ts`): `Test Files 18 passed (18)`,
  `Tests 425 passed (425)`. Dashboard sample (`alerts-bell*`, `staff-list*`,
  `content-languages-screen.layout`, `menu-structure-table*`): `Test Files 8 passed (8)`, `Tests 354
  passed (354)`. These two ran before the last change to `capBelow`/`rows()` (the hidden-action
  filter kept, a no-actions fallback dropped); none of those users sets `opens-below`, so neither
  function runs for them, and they were not run again. `rg -l 'till-table-order-screen' apps/till/src/screens -g '*.test.ts' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`:
  `Test Files 91 passed (91)`, `Tests 1776 passed (1776)`, no `Errors` line, exit 0. `pnpm
  --filter @waitron/till typecheck` and `pnpm --filter @waitron/ui typecheck` exit 0; `pnpm exec
  prettier --check` and `pnpm exec eslint` on the four changed source files exit 0; `pnpm exec
  vitest run scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`: `Tests 49
  passed (49)`.
- **LOOK.** `a803-3-reviews/task-10-fix2-shots/`: `{old,new}-{1024x768,375x667}-{light,dark}-open.png`
  (four sent lines, two bills, two tables). Looked at: old 1024 light (ends at "Split a table",
  then blank: nothing of "Join a table" visible), new 1024 light and dark ("Split a table" cut
  through its label at the bottom edge), new 375 light and dark ("Name the party" cut through its
  label). The ⋮'s kebab is still a blank gap in these screen tests (no icons registered), as the
  review explained.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `packages/ui/src/components/wt-row-actions.test.ts` "a menu taller than the room under its trigger opens under it…" (the `box.bottom` line) | B | `box.bottom` close to `innerHeight - 8` → at most `innerHeight - 8` (+0.5) and less than one action's pitch above it; the new "cut through the middle of an action" case pins where in that band, to 1px. The old exact edge is the picture review I1 asked to change | review I1 | 10 fix review |

#### Second fix review (task-10-fix2.md)

Same method as above: foreground, `AI_AGENT`/`CLAUDECODE` unset, free memory 56%; each control
changed one line by a script that asserts its pattern occurs once, ran `wt-row-actions.test.ts`,
and put the saved copy back (`cmp`, no difference).

- **m1, the "without it" case no longer told the two modes apart.** The trigger moved from 300px to
  200px (600×400, 7 actions); the same case now also turns `opens-below` on at that trigger and
  expects the popup under it, scrolling. Control (`opens-below` turned on for the plain half too):
  fails, `expected 372 to be close to 392`.
- **m2, a list 1px too tall lost half of its last action.** `capBelow` now keeps the cap at the room
  when the last drawn action already ends inside it. New case "a list whose last action already
  ends inside the room is not cut short" (two actions, room 1px under their natural height). RED:
  `expected 384 to be less than or equal to 362.5`. Control (that skip deleted): fails the same way.
- **m4, the fallback drew a list taller than the window off its bottom.** The move-up fallback now
  caps the height at the window less 16px, and a menu with no `button`, `a[href]` or `wt-button` to
  find keeps the cap at the room. New cases "a list taller than the window, moved up to fit, is
  capped to the window and scrolls" (RED: `expected 838 to be close to 392`) and "a list of no
  actions it can find still opens under its trigger, capped to the room" (RED: `expected 8 to be
  close to 92`). Controls: the window cap set back to `""` fails the first case and the two below;
  the no-actions return deleted fails the second. `design-system.md`'s `opens-below` clause now
  names the window cap. Changed assertions: "with room under the trigger for less than that…" and
  "hidden actions do not count…" expected `maxHeight` `""` in the fallback → `${innerHeight - 16}px`
  (review m4).
- **m3, `#layerOpen` counts manual popovers and misses ones outside the screen.** Left as it is: no
  manual popover sits in the screen's tree today.
- **Runs (GREEN).** `packages/ui` `wt-row-actions.test.ts` + `.a11y.test.ts`: `Test Files 2 passed
  (2)`, `Tests 89 passed (89)`. `till-table-order-screen.table-menu.test.ts`: `Tests 31 passed
  (31)`. Every `till-shell*.test.ts`: `Test Files 15 passed (15)`, `Tests 383 passed (383)`. `pnpm
  --filter @waitron/ui typecheck` and `pnpm --filter @waitron/till typecheck` exit 0; `pnpm exec
  prettier --check` and `pnpm exec eslint` on the two changed source files exit 0.

## Task 11b: app tests and helpers that opened the drawer (≈55 calls)

**Files.** `till-app-parties.test.ts` (25 sites), `till-app-adjustments.test.ts`,
`till-app-bill-payments.test.ts`, `till-app-drafts.test.ts`, `till-app-table-service.test.ts`,
`till-app.test.ts`, `till-app-menu-refresh.test.ts`, `till-app-handheld-pay.test.ts`,
`screens/till-paid-view.test.ts`, **`apps/till/test/bill-pay-app.ts`** (review-1 minor 4) and every
other file `rg -l data-open-drawer apps/till/src apps/till/test` names outside `screens/`. Kind R
only; a helper `openTableMenu(el)` / `openBillSwitcher(el)` in `apps/till/test/` if three or more
files need it. Sites that read what only the drawer holds stay for 11c, as in 11a.

- [x] Re-point each file, running it before and after; GREEN: the same files unfiltered;
      `rg -n 'data-open-drawer' apps/till` prints only the 11c sites; till typecheck.
- [x] Commit: "Till app tests reach bills and actions through the switcher and the ⋮".

### Task 11b as built (2026-10-31)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 55–58% before each browser
run. File names below drop the `till-app` prefix (`.test.ts` is `till-app.test.ts`); lines are at
this task's commit unless written "was :N" (a line at `d217cb3f7` that this task deleted).

- **Before** (`d217cb3f7`, the eight app files in one run): `Test Files 8 passed (8)`,
  `Tests 3087 passed (3087)`: `-parties` 623, `-adjustments` 200, `-bill-payments` 245, `-drafts`
  432, `-table-service` 144, `.test.ts` 1122, `-menu-refresh` 77, `-handheld-pay` 244.
- **After** (the same command): `Test Files 8 passed (8)`, `Tests 3087 passed (3087)`, every file's
  count equal to its count before, exit 0. `pnpm --filter @waitron/till typecheck` exit 0;
  `pnpm exec prettier --check` and `pnpm exec eslint` on the nine changed files exit 0.
- **Helper.** `switchToBill(el, workingOrderId)` added to
  `screens/till-table-order-screen.bill-switcher.test-helpers.ts`: it expects the switcher's list
  closed, taps the switcher, expects the list open, then taps the bill's `[data-switch-bill]` row.
  Two files use it, so it sits beside `openTableMenu`, not under `apps/till/test/`.
- **Why the switcher row is the same behaviour as the drawer's Take payment.** In
  `till-app.ts` the screen's `take-payment` and `switch-bill` events both go to `#onSwitchBill`,
  which reads only `detail.workingOrderId`. Both re-pointed sites used Take payment only to put
  another bill on screen, and each still checks `orderId` afterwards with the same value.
- **Not re-pointed: `screens/till-paid-view.test.ts`.** Its `open-drawer` is the cash drawer
  (`action.open_drawer`), not the Tab drawer; it never reaches `[data-open-drawer]`.
- **STOP:** none. No money, VAT, permission or filing check changed; the one value check moved is
  `[data-request-bill]` present, from the drawer to the ⋮.
- **Deletion control.** `-parties.test.ts:9588` changed to `switchToBill(order, "wo-4")` (the bill
  already on screen): `-t 'retained held-line command uses the source bill after switching'`
  printed `AssertionError: expected 'wo-4' to be 'wo-check'` at `:9591`, `Tests 1 failed | 622
  skipped (623)`; the file put back from a saved copy (`cmp` equal).

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `-drafts.test.ts:10418` (`chooseSourceBill`, used by "the retained move command carries only the source bill…" and "refuses a retained move command whose captured source observation changed") | R | the drawer row's `[data-bill="wo-7"] [data-take-payment]` → `switchToBill(order, "wo-7")`; `orderId` `toBe("wo-7")` unchanged; the `[data-move-line]` null check's text is unchanged but it no longer reads the drawer, which nothing opens (moot since 11c deleted it), and it can fail on nothing in production, which has drawn no `data-move-line` since `c9ad7a634` (before this branch; 11b review M1) | D4 (bills in the switcher) | 11b |
| `-parties.test.ts:9588` ("the retained held-line command uses the source bill after switching to it") | R | the drawer row's `[data-bill="wo-check"] [data-take-payment]` → `switchToBill(order, "wo-check")`; `orderId` `toBe("wo-check")` unchanged; both `[data-move-line]` null checks' text is unchanged but they no longer read the drawer, which nothing opens (moot since 11c deleted it), and they can fail on nothing in production, which has drawn no `data-move-line` since `c9ad7a634` (before this branch; 11b review M1) | D4 | 11b |
| `-parties.test.ts:5362-5365` (bill request cancelled: Mark bill requested offered again) | R | `(await drawer(el)).querySelector("[data-request-bill]")` not null → `openTableMenu`, then `[data-table-menu] [data-request-bill]` not null; the chip check before it (`requestedOnScreen`) stays on the drawer (11c) | D4 | 11b |
| `-adjustments.test.ts:4781-4789` (combined Comp of one extra, 8 rows of locale × theme × width) | R | the drawer opened by `openTable4` and `[data-drawer]` holding no `[data-comp-line], [data-discount-line]` → `openTableMenu`, the screen's whole shadow root holding none (11a M1), which no longer reads the drawer (nothing opens it; moot since 11c deleted it) but does read the ⋮, the switcher and the rest of the screen (11b review M1); the screenshot element `[data-drawer]` → the ⋮'s open list, `[data-table-menu]`'s `[popover]` (file `a773-comp-table-menu-…`; was the ⋮ glyph until the 11b review's M4); the drawer's close → `closeTableMenu` | D4 | 11b |
| `-adjustments.test.ts` `openTable4` (was `:328-329`), was `:1043` (reopened table before `requestComp`), was `:2182-2183` (a close of the drawer `openTable4` opened) | S | drawer opened (or closed) before checks that read nothing in it → removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-bill-payments.test.ts` was `:4254-4255` (table reopened before `[data-bill-payments]` is read), was `:4375-4376` (a close of the drawer `openTable` opened, before `openSentDish`) | S | removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-drafts.test.ts` was `:10476-10477`, `:10544-10545` (before `chooseSourceBill`) | S | removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-table-service.test.ts` was `:1537-1538` (before `change-line`), was `:2876-2877` (`openTableWith`, before the pay card's guests stepper; its unused `screen` went with it) | S | removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `.test.ts` was `:10295-10296` (before the table's cash tender), `-menu-refresh.test.ts` was `:1273-1274` (before the table's Pay), `-handheld-pay.test.ts` was `:945-946` (`signInAgainAndReopen`, before the bill's Pay) | S | removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-parties.test.ts` was `:2882-2883` (another bill's naming window: the ⋮ is tapped next), `openGroups` (was `:6665-6666`), the 2-wide handheld mount of "%s disables the group controls…" (was `:7146-7147`), "files the spec's five groups…" (was `:7764-7765`, before `groups` and `[data-sent-unread]`) | S | drawer opened before checks that read nothing in it → removed; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-parties.test.ts` `reopenDrawer` (was `:6714-6720`) and its six calls; the close-if-open in `heldGroupsList` (was `:456-459`) and in `openSent` (was `:6677-6680`) | S | removed: every caller is in "the order's groups", where nothing opens the drawer once `openGroups` no longer does; every `expect` byte-identical | the drawer holds none of it | 11b |
| `-parties.test.ts` `prompt` (was `:11092-11095`) and `relocationPrompt` (was `:11438-11441`) | S | an open-if-`[data-move-split]`-missing branch that never ran (the ⋮ carries `data-move-split` whenever the screen draws) → removed; every `expect` byte-identical | — | 11b |

**Left for 11c** (each reads what only the drawer holds until then; `rg -n 'data-open-drawer'
apps/till` prints these and the screen-test sites 11a left):

- `-parties.test.ts:911`, `:941`, `:989`, `:1055`, `:1072`, `:1096`, `:1203`, `:1287`, `:1317`,
  `:1358`: each opens the drawer for `figures(el)` (`:783`), which reads the drawer's bill row
  (`[data-bill="wo-4"]`'s `[data-bill-total]` and `[data-bill-state]`) and the table's still-to-pay
  (`[data-party-outstanding]`). The switcher's row shows the bill's amount in a different form and
  no still-to-pay, so no byte-identical twin exists before 11c puts still-to-pay in the foot.
- `-parties.test.ts:2785`: `billNameShown` (`:2711`) reads the drawer row's `.bill-name`
  ("4 · Bill 1 · Clint"); the switcher's row label is `billLabel`, not that text.
- `-parties.test.ts:5233`: lists the drawer's `[data-bill]` rows after a split-off bill is left
  and reopened. Not drawer-only: the switcher lists the same `shownBills(this.bills)` (11b review
  M2); 11c re-pointed it as R.
- `-parties.test.ts:5300` (`drawer`, used by `requestedOnScreen`): the bill-requested chip,
  `[data-chip='bill-requested']`, which only the drawer draws (`:5332`, `:5347`, `:5361`, `:5455`).
- `-parties.test.ts:9693` (`openDeparture`): the Finish table refusal's Record unpaid departure,
  `[data-finish-refusal] [data-record-departure]`.
- `-parties.test.ts:10296` (`pressCancelCredit`): Cancel and credit on another bill's row,
  `[data-bill="wo-check"] [data-cancel-credit]`.
- `apps/till/test/bill-pay-app.ts:398` (`openTable`): its callers read the drawer:
  `-bill-payments.test.ts:572` (`[data-invoice-choice]`), `:3045-3047` (the `[data-bill]` rows'
  `[data-bill-total]`), `-handheld-pay.test.ts:3401`, `:3510` (`[data-finish-refusal]`). Moving
  the open into those cases would add drawer sites rather than remove them, so it stays whole.

### Task 11b review answers (2026-10-31, `a803-3-reviews/task-11b.md`)

0 Critical, 0 Important, 5 Minor. Answered at the tip after Task 11c (`2c36c4bc5`), which had
already deleted the drawer and re-pointed some of the same sites. Runs in the foreground with
`AI_AGENT`/`CLAUDECODE` unset; free memory 59% before the browser runs.

- **M1 (record only).** The three R rows' unchanged absence checks (`-adjustments` comp line,
  `-drafts:10418` and `-parties:9588` `[data-move-line]`) no longer read the drawer; the 11b table's
  rows now say so. Moot since 11c deleted the drawer: `rg -n '#drawer\(|data-drawer\]' apps/till/src
  -g '!*.test.ts'` prints nothing. The `[data-move-line]` checks can fail on nothing in production:
  `git log -S'data-move-line'` on the till's non-test source prints `a9a26cc98` (added, in the
  drawer) and `c9ad7a634` (removed, A773-1), which is on `main` before this branch; `rg -n
  'data-move-line'` outside tests prints nothing. No assertion changed.
- **M2 (already answered by 11c).** `-parties` was `:5233` (now `:5222`) reads
  `[data-bill-switcher] [data-switch-bill]` since 11c, recorded R in the 11c table; the 11b
  "Left for 11c" bullet now says it was not drawer-only. Control at the tip: the switcher's list
  made to drop `wo-check` (`table-bill-controls.ts`, `shownBills(options.bills)`) → `-t 'leaves an
  unpaid split-off bill listed'` `AssertionError: expected [ 'wo-4' ] to include 'wo-check'`,
  `Tests 1 failed | 622 skipped (623)`; put back from a saved copy (`cmp` equal), then `Tests 1
  passed | 622 skipped (623)`.
- **M3.** `switchToBill` now expects the target row's `aria-checked` to be `"false"` before tapping
  it, so asking for the bill already on screen fails in the helper. Control: `-parties:9573` changed
  to `switchToBill(order, "wo-4")` (the bill on screen) → `-t 'retained held-line command uses the
  source bill after switching'` `AssertionError: expected 'true' to be 'false'` at
  `till-table-order-screen.bill-switcher.test-helpers.ts:97`, `Tests 1 failed | 622 skipped (623)`;
  put back from a saved copy (`cmp` equal). Its three callers' files (`-drafts`, `-parties`, run
  with `-adjustments` below): `Test Files 3 passed (3)`, `Tests 1255 passed (1255)` (432 + 623 +
  200, as before), exit 0.
- **M4.** The comp case's screenshot element is the ⋮'s open list,
  `menu.shadowRoot!.querySelector<HTMLElement>("[popover]")!`. Its 8 rows ran in the same run
  (`-adjustments` 200 passed). The eight `a773-comp-table-menu-…` files are 143–162 × 457–458
  pixels; `en-light-1280` opened and looked at: the whole list, "Bill 1" then "Whole table".
- **M5 (record only; predates the branch).** The three `-drafts` retained-move cases ("the retained
  move command carries only the source bill…" ×2 and "refuses a retained move command whose
  captured source observation changed") pin the switch only by their `orderId` check: their command
  checks hold whichever bill is on screen, at `d217cb3f7` too (review run 9(iii)). They are not
  evidence that the switcher's bill reaches the move command; `-parties`'s "…uses the source bill
  after switching to it" is (review mutation B).
- **Checks.** `pnpm --filter @waitron/till typecheck` exit 0; `pnpm exec prettier --check` and
  `pnpm exec eslint` on the two changed test files exit 0.

## Task 11c: the Tab button and drawer go (≈55 calls)

**Files.** The screen: Tab button `:2369-2381` and its badge, `drawerOpen` `:1192`, `#toggleDrawer`
`:2271`, `#drawer` `:4034-4046`, `#billsSection`/`#billRow`/`#takePayment` `:4248-4399` and the
drawer's copies of Receipt copy, Cancel and credit, Bill requested and Finish table go; the action
panel shows in the side column only while a step is open (D9); the foot gains the table's
still-to-pay under the bill's total and, when `finishRefused`, the refusal with Take payment and
Record unpaid departure above it (D9); `i18n/strings.ts` `table.open_drawer` goes; the sites left
for 11c by 11a/11b; the badge rows (D17).

- [x] Cases `A803 no tab panel` in `till-table-order-screen.panel-footer.test.ts`: no Tab button at
      any width; the foot shows this bill's total, then "Still to pay at this table" with the party's
      outstanding; Finish table refused shows the refusal with Take payment for the first other
      unpaid bill above the foot; choosing Move guests in the ⋮ shows the table picker in the side
      column and Back closes it. The Finish table refused case taps the ⋮'s Finish table with the
      drawer closed (no `emit` of `finish-table`), so it proves the refusal is seen where the tap was
      made (Task 10 review M1). Case `A803 to serve` in `till-table-order-screen.test.ts`: with one
      unserved and one served one-portion sent line, the Sent summary shows them, and after the
      last is served its not-yet-served counts read 0 (D17).
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.test.ts -t 'A803 no tab panel|A803 to serve'`.
- [x] Implement; re-point the 11c sites and the badge rows. Four `.parties.test.ts` behaviours have
      no control to re-point to, because the ⋮ acts only on the bill on screen: Take payment on
      another bill's row (`:217-265`), Cancel and credit on another bill's row (`:304-335`), no
      Receipt copy on another bill's row (`:214`), and the bill-requested chip (`:363`, `:374`,
      `:404`). Record each as kind B citing the spec (§3.5, D4 or D9 for where it goes), or as a
      deleted check that becomes an item of Owner question 5. None is recorded as R.
- [x] GREEN: the screen files (11a's command), the 11b files, till typecheck;
      `rg -n 'data-open-drawer|drawerOpen|open_drawer|data-pending-badge' apps/till` prints nothing.
- [x] Commit: "The table screen loses the Tab button: bills in the switcher, actions in the ⋮".

### Task 11c as built (2026-10-31)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 48–61% before each browser
run. File names below drop the `till-table-order-screen` prefix for screen files and the `till-app`
prefix for app files; lines are at this task's commit unless written "was :N" (a line at
`f8b8f7ba5`).

- **Built.** The Tab button, its badge, `drawerOpen`, `#toggleDrawer`, `#pending`, `#drawer`,
  `#billsSection`, `#billRow`, the drawer's `#billRequest` and `#takePayment` are gone, with the CSS
  only they used (`.badge`, `.bill*`, `.bill-request`, `.finish`, `.drawer ul`) and the signal-chip
  import and styles the drawer's chip needed. The side column's panel is `.action-panel` (was
  `.drawer action-panel`). The foot (`#orderSummary`) now draws, in order: the Finish table refusal
  when `finishRefused` (`#finishRefusal`, same text, Take payment for the first other unpaid bill
  and Record unpaid departure), this bill's total, "Still to pay at this table" with the party's
  outstanding (`[data-party-outstanding-row]`, only with a party), then the bill's actions.
  `table.open_drawer` is deleted in English and Spanish; `rg -n 'table.open_drawer' apps/till`
  prints nothing.
- **Departure: the refusal scrolls into view.** The 1024×768 case of `A803 no tab panel` failed its
  "the refusal is inside the window" check with the refusal drawn above the foot: tapping Finish
  table in the ⋮ at the top left the refusal below the window, which is the Task 10 review's M1
  problem in a new place. `updated()` now scrolls the refusal into view (`#showFinishRefusal`, using
  the step panel's `#scrollIntoViewOnceDrawn`) when `finishRefused` turns on. (2026-10-31: on a
  narrow screen that still left it hidden; replaced by `#revealFinishRefusal`, see _Task 11c review
  answers_ I1.)
- **Departure: the GREEN grep.** The plan's `rg -n 'data-open-drawer|drawerOpen|open_drawer|data-pending-badge' apps/till`
  can never print nothing: `open_drawer` also matches `action.open_drawer`, the cash drawer's Open
  drawer (`strings.ts:338`, `:2149`, `till-paid-view.ts:280`, `till-ticket-view.ts:1095`,
  `till-paid-view.test.ts:285`), which this slice does not touch. Those five lines are all it
  prints; the narrowed `rg -n 'data-open-drawer|drawerOpen|table\.open_drawer|data-pending-badge' apps/till`
  prints nothing (exit 1).
- **Found, not changed.** `table.pending_title` and `table.none_pending` have no user outside tests
  on this branch or on `main` (`git grep` at `main` and `HEAD`); tests use them only in absence
  checks. Their retirement is not this task's.
- **RED** (the plan's command): `Tests 6 failed | 2 passed | 355 skipped (363)`: the three widths
  (`expected <wt-button …> to be null`, the Tab button), the still-to-pay and the refusal cases
  (`expected null not to be null`), and `A803 to serve` (the badge span present). Move guests' step
  and the no-party case passed before (Task 10 built the step panel). The final cases read the head's
  children instead of the retired hooks, so the GREEN grep holds.
- **GREEN.** The screen files (11a's command, 91 files): `Test Files 91 passed (91)`, `Tests 1783
  passed (1783)`, no `Errors` line, exit 0. The 11b app files plus every other file importing
  `test/bill-pay-app.ts` (12 files): `Test Files 12 passed (12)`, `Tests 3199 passed (3199)`, exit
  0; the eight 11b files alone earlier in the task: `Tests 3087`, as before 11c. `.parties` 35 and
  `-parties` 623, as before; `.test.ts` 345 (344 + `A803 to serve`); `.panel-footer` 18 (11 + 7);
  `.bill-payments` one fewer (the deleted recipient case below). `pnpm --filter @waitron/till
  typecheck` exit 0; `vitest run src/i18n` `Tests 259 passed (259)`; root
  `scripts/english-only.test.ts` `Tests 1988 passed (1988)`; `prettier --check` and `eslint` on the
  changed files exit 0.
- **Deletion controls** (each on the plan's RED filter, the screen put back from a saved copy and
  `cmp`-equal after): the still-to-pay row removed → `Tests 1 failed | 7 passed`; the refusal no
  longer drawn above the foot → `1 failed | 7 passed`; the scroll call removed → `1 failed | 7
  passed`; a "Tab" button with a `.badge` put back in the head → `4 failed | 4 passed` (three widths
  and `A803 to serve`). Only the counts were read, not which case failed in each.
- **STOP:** none taken, but see the money rows: `-parties` `figures` and `-bill-payments` `listed`
  read a bill's amount from the switcher's row (what it owes) instead of the drawer row's total.
  Where total and owing were equal in the fixture (`figures`) every amount is unchanged; in `listed`
  the partly paid bill reads €70.00 owing where the drawer showed its €120.00 total (kind B, §3.5).

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.panel-footer.test.ts:110` (one payment widget across the side panel opening and closing) | R | the Tab button tapped twice, `[data-drawer]` present then absent, holding no Discount or `.pay` → Move guests opened from the ⋮ and closed with Back, `[data-action-panel]` present then absent, holding no Discount or `.pay`; the widget checks unchanged | D9 (the action panel replaces the drawer) | 11c |
| `.test.ts:582` (was "keeps the tab drawer closed until its handle is tapped") | B | drawer absent, then present after the handle → "draws no Tab drawer or handle": `[data-drawer]` and `.drawer-handle` absent | §3.5 "The Tab button and its side panel go" | 11c |
| `.test.ts:588` (was "badges the drawer handle with the pending-to-serve count") | R | badge text contains 1 → the Sent summary reads `sentCounts(0, 1, 0, 1)` (1 firing, 1 served); one-portion line; the service read added so Sent draws | D17 | 11c |
| `.test.ts:598` (was "names the drawer handle by … its pending count") | R | the handle's name "Tab 1" → the Sent toggle's name, its title and `sentCounts(0, 1, 0, 1)`, with `toHaveAccessibleName` | D17 | 11c |
| `.test.ts:610` (was "hides the badge and duplicate To serve card …") | R | the badge null after the last dish is served → moved to `A803 to serve`, which reads the Sent summary's not-yet-served counts as 0 after it; this case runs on the stored-lines fallback, where Sent draws no summary; its other checks unchanged; retitled | D17 | 11c |
| `.test.ts:802` (empty tab) | R + S | badge null → `sentSummary` undefined (Sent draws no summary); retitled "no Sent counts". Corrected by the 11c review answers (I2): as first built the case gave no service read, so the check passed with a dish still to serve; it now mounts with `orderId: "wo-4"` and a service read listing no rows (S), and the same check fails when that read holds an unserved dish | D17 | 11c |
| `.test.ts:4150`, `:4186` (status in the head actions; one line each at 390px in Spanish) | R | the status's next sibling, and the button measured beside the pin, the Tab button → the bill switcher; `[1, 1, 1]` and the same-row check unchanged | §3.5, D4 | 11c |
| `.empty-drawer.a11y.test.ts:51-53` | R | badge null after a served line with the service read unread → (11c review answers, I2) the check moves to after the case's service read lists that served line: the Sent summary reads exactly `0 ready · 0 firing · 0 held · 1 served` (Spanish in the `es` runs). The first-built check (no summary while the read is unread) passed with a dish still to serve and is gone | D17 | 11c |
| `.populated-drawer.a11y.test.ts:96-106` | R | badge text "2" → Sent summary `0 ready · 2 firing · 0 held · 1 served`. The 2 agrees for a different reason: the badge counted the dish and its extra row, the summary the dish's two portions; a one-portion fixture would change this case's total checks, so it was kept | D17 | 11c |
| `.parties.test.ts` `mountScreen` (was `:105`) | S | the drawer opened for every case → not opened | — | 11c |
| `.parties.test.ts:145` (was "lists every bill with what it came to …") | B + R | the drawer rows' `[data-bill-total]` (14.00, 30.00) and `[data-bill-state]` (Paid, "To pay €30.00") → the switcher rows' `.bill-row-owes` ("Paid ✓", €30.00), row count 2 unchanged (B); `[data-party-outstanding]` €30.00 read in the foot (R, `toBe` byte-identical) | §3.5 "listing each bill with what it owes (or Paid ✓)"; D9 | 11c |
| `.parties.test.ts:154`, `:161`, `:179` (bill names) | B | the drawer's `.bill-name` "Ana · Bill 1" (`table.bill_of`, `table.bill_of_named`) → the switcher row's `.bill-row-label` "Bill 1", "Bill 2 · Clint"; `:179` still checks a bill's own label never shows | §3.5; D4 (the short label); D10 | 11c |
| `.parties.test.ts:188`, `:199`, `:205` (no New orders tag; no main-bill mark; abandoned left out) | R | the drawer's rows → the switcher's rows (`:199` the whole shadow root); expected values unchanged | §3.5 | 11c |
| `.parties.test.ts:211` second check (no Receipt copy on another bill's row) | B | `[data-bill="wo-check"] [data-bill-receipt]` null → with `wo-check` put on screen, the ⋮ has no `[data-bill-receipt]`; the ⋮ acts on the bill on screen | D4; review 11a M4 | 11c |
| `.parties.test.ts:223` (Take payment on another bill's row) | B | `take-payment` `{ wo-check }` from the row's button, none on the paid row → `switch-bill` `{ wo-check }` from the switcher's row, and nothing from the bill already on screen; the app sends both events to `#onSwitchBill` (11b) | D9 "Take payment on a bill row goes (the switcher replaces it)"; review 11a M4 | 11c |
| `.parties.test.ts:233` (the bill on screen marked, no Take payment for it) | B | `aria-current="true"`, no `[data-take-payment]` → `aria-checked="true"` on its switcher row, and a tap on it sends no `switch-bill`; the charge check unchanged | D9 | 11c |
| `.parties.test.ts:249` (no party) | R | `[data-bills]` null → `[data-bill-switcher]` null; retitled | §3.5 | 11c |
| `.parties.test.ts:266` (Take payment for a presented bill) | B | the row's `take-payment` → the switcher row's `switch-bill`, same id | D9 | 11c |
| `.parties.test.ts:322`, `:333` (Cancel and credit on another bill's row) | B | `[data-bill="wo-invoiced"] [data-cancel-credit]` → with `wo-invoiced` on screen, the ⋮'s `[data-cancel-credit]`; same text and event; `:333` also checks the ⋮'s bill section is drawn, so the absence means something | D4; review 11a M4 | 11c |
| `.parties.test.ts:366`, `:379`, `:402` (the bill-requested chip, EN and ES) | B | the drawer's `[data-chip='bill-requested']` → the same chip in the status pin's details (`requestedChip`: tap the pin, read `till-table-details-sheet`); null, "Bill requested" and "Cuenta pedida" unchanged | §3.5; D4 (the ⋮ carries the request, not a chip) | 11c |
| `.parties.test.ts:427-506` (Finish table refusal, 8 cases) | R | `bills(el)` (the drawer's section) → the screen's shadow root (the refusal is above the foot); every expected value unchanged | D9 | 11c |
| `.parties.test.ts:439` second check | B | the drawer row's `[data-bill-state]` "To pay €30.00" → the switcher row's €30.00 | §3.5 | 11c |
| `.a11y.test.ts:398` (scan with Finish refused) | R | the drawer opened for the scan → the bill switcher opened (`openBillSwitcher`, new beside `openTableMenu`); new guard that the refusal is in the scan when refused; retitled | D4, D9 | 11c |
| `.a11y.test.ts:419` (scan with the bill requested) | R + B | the drawer's own `[data-cancel-bill-request]` → the ⋮ opened and its `[data-cancel-bill-request]` (R); then the status pin's details opened, its chip present, scanned again (B, where the chip is now); retitled | D4 | 11c |
| `.loading.test.ts:37` (was "a drawer left open is not shown while loading") | R | the drawer → a ⋮ step (Move guests) left open; `[data-action-panel]` present, then absent while loading | D9 | 11c |
| `.bill-payments.a11y.test.ts:146-153` (LOOK: the themes paint differently) | R | the drawer's background → the bill switcher trigger's (both `--wt-color-surface`); `light` ≠ `dark` unchanged | D4 | 11c |
| `.sent.test-helpers.ts` `sentFallbackFor` (was `:68-71`) | S | the close of a drawer a caller left open → removed; nothing can open one | — | 11c |
| `.bill-payments.test.ts` was `:167-184` ("shows a saved full-invoice choice and customer on an unissued bill") | deleted, **Q5e** | the drawer row's `[data-invoice-choice]` "Full invoice · Cliente SL · B12345674" → nothing: no control on the table screen shows a saved recipient once the drawer goes | — | 11c |
| `-bill-payments.test.ts:574` (saving a full-invoice recipient) | stand-in, **Q5e** | the drawer's `[data-invoice-choice]` contains "Ana García" → the bill the app handed the screen has that recipient (`order.bills`); weaker: not what staff see | — | 11c |
| `-bill-payments.test.ts` `listed` (`:3049`), used by `:3112`, `:3123`, `:3143` | B | the drawer rows' `[data-bill-total]` (wo-4 €120.00, wo-9 €12.00) → the switcher rows' owing (wo-4 €70.00, the partly paid bill's outstanding; wo-9 €12.00) | §3.5 "what it owes" | 11c |
| `-parties.test.ts` `figures` (`:784`) and its ten callers (was `:911`, `:941`, `:989`, `:1055`, `:1072`, `:1096`, `:1203`, `:1287`, `:1317`, `:1358`, each opening the drawer first) | B + R + S | the drawer row's `[data-bill-total]` and `[data-bill-state]` "To pay X" → the switcher row's owing X (same amount: each fixture owes its total) (B); `total` field dropped, since the bill on screen's total from the bills read is drawn nowhere now; the Split a table and Merge/Transfer lists still show other bills' totals (the foot's total comes from the lines, €30.00 here, and was tried first: 10 failures); still-to-pay from the foot, byte-identical (R); the drawer opens removed (S) | §3.5; D9 | 11c |
| `-parties.test.ts:2776` (`billNameShown` `:2699`, "4 · Bill 1 · Clint") | B | the drawer's `.bill-name` → the switcher row's label "Bill 1 · Clint"; the drawer open removed | §3.5; D4 | 11c |
| `-parties.test.ts:5222` (split-off bill still listed) | R | the drawer's `[data-bill]` rows → the switcher's `[data-switch-bill]` rows; `toContain(wo-check)` unchanged | §3.5 | 11c |
| `-parties.test.ts` `requestedOnScreen` (`:5285`, used at `:5317`, `:5332`, `:5346`, `:5440`) | B | the drawer's bill-requested chip → the ⋮ offering Cancel the bill request (it does only while requested); true/false unchanged | D4 | 11c |
| `-parties.test.ts` `openDeparture` (`:9658`) | S | the drawer opened before tapping the refusal's Record unpaid departure → not opened (the refusal is above the foot) | D9 | 11c |
| `-parties.test.ts` `pressCancelCredit` (`:10274`) and `offered` (`:10234`) | B | `[data-bill="wo-check"] [data-cancel-credit]` → `wo-check` put on screen with `switchToBill`, then the ⋮'s `[data-cancel-credit]`; `offered` reads the whole screen for `[data-cancel-credit]` (the other bill offers none) | D4; review 11a M4 | 11c |
| `test/bill-pay-app.ts` `openTable` (was `:398-399`) | S | the drawer opened → not opened; its callers' refusal checks (`-handheld-pay.test.ts:3399`, `:3508`) read the refusal above the foot, unchanged | D9 | 11c |

**Owner question 5e candidates** (built on the plan's default: the drawer and everything only it drew
go):

- `.bill-payments.test.ts` was `:167-184` and `-bill-payments.test.ts:574`: the drawer's bill row
  was the only place on the table screen showing a bill's saved full-invoice choice and customer
  ("Full invoice · Cliente SL · B12345674"). After 11c staff cannot see on the table that a bill will
  be a full invoice, or to whom, until they open the Full invoice editor. Neither §3.5 nor D4/D8/D9
  names a new place. The screen case is deleted; the app case reads the data handed to the screen.
  Possible answers: show the choice under the foot's Full invoice button, or in the switcher's row.

### Task 11c review answers (2026-10-31, `a803-3-reviews/task-11c.md`)

Answered on top of Task 12 (`241c38630`); each finding was checked against that tip, where the
refusal, `#showFinishRefusal` and the two to-serve checks were as the review read them at
`2c36c4bc5`. Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 55–61% before
each browser run. Every control changed one line by a script that asserts its pattern occurs once,
ran the named case, and put the file back from a saved copy (`cmp`-equal after). Lines are at this
answer's commit.

- **I1 (behaviour), the refusal hidden on a narrow screen.** Fixed: `#showFinishRefusal` in
  `updated()` is replaced by `#revealFinishRefusal`, started from `willUpdate` when `finishRefused`
  turns on, as `#revealTakeOver` is for another person's draft. Below 720 px wide, while browsing
  with a New order, it opens Review first (`#openReview`, which puts focus on Review's Back), then
  scrolls the refusal into view once its buttons are drawn. Wide screens and screens with no New
  order (whose order pane is never hidden) only scroll, as before.
  - `.panel-footer.test.ts:305` is now `it.each` over 1024×768 and 390×844 (was 1024×768 only),
    keeping the visibility, `role="alert"`, in-window and above-the-total checks, and adding M2's.
    RED (screen as at `241c38630`): `Tests 1 failed | 1 passed | 30 skipped (32)`, the 390×844 row
    failing at `refusal.checkVisibility()` (`expected false to be true`); 1024×768 passed.
  - App case, new: `till-app-handheld-pay.test.ts:5409` "Finish table refused from the ⋮ on a
    handheld opened from the floor": a phone (`phone-portrait`) at 390×844, two bills, Finish table
    refused `party.bill_outstanding`, the table opened from the floor with `openTable` (not from the
    paid screen), the order pane checked hidden first, the ⋮'s Finish table tapped with
    `userEvent.click`; then the refusal, its Take payment and its Record unpaid departure are each
    `checkVisibility()` true and the refusal is in the window. Its in-window check rounds the bottom
    edge: it failed unrounded, and a probe run then measured the refusal at 752.44–844.44 in an 844 px
    window after the scroll.
  - GREEN: both screen rows and the app case pass.
  - Deletion control: the Review-opening line removed → screen `1 failed | 1 passed`, the 390×844
    row at `refusal.checkVisibility()`; the app case `1 failed`, at `refusal.checkVisibility()`.
- **I2, two to-serve checks that could not fail.** Both now read a real Sent summary.
  - `.test.ts:801` (empty tab) mounts with `orderId: "wo-4"` and a service read listing no rows
    (`sentRows([])`), and keeps `expect(await sentSummary(el)).toBeUndefined()`: with nothing sent,
    Sent draws no summary, so "assert 0 counts" has nothing to read here. Probe (one unserved one-portion
    dish put in both the lines and the read): `1 failed`, at that check, `expected '0 ready · 1
    firing · 0 held · 0 served' to be undefined`. The first try without `orderId` failed only at the
    later total check (the read's rows belong to `wo-4`, so with no bill on screen nothing counted
    them), which is why `orderId` is set.
  - `.empty-drawer.a11y.test.ts:82`: the unread-state check is gone; after the case's own service
    read lists the served line, the Sent summary must read exactly `0 ready · 0 firing · 0 held · 1
    served` (in Spanish for the `es` runs). Probe (an unserved row added to that read): `8 failed`,
    each at this check (`expected '0 ready · 1 firing · 0 held · 1 served' to be '0 ready · 0 firing
    · 0 held · 1 served'`, and the Spanish `Marchados: 1` against `Marchados: 0`; read per case from
    Vitest's JSON report).
  - GREEN: the 9 cases pass. Rows corrected in _Task 11c as built_: `.test.ts:802` becomes R + S
    (the service read added), `.empty-drawer.a11y.test.ts:51-53` states where the check now sits.
- **M1.** The `-parties.test.ts figures` row now says the bill on screen's total from the bills read
  is drawn nowhere, and that the Split a table and Merge/Transfer lists still show other bills'
  totals. The B kind and the `figures()` reasoning are unchanged.
- **M2.** The refusal case asserts `checkVisibility()` on both Take payment and Record unpaid
  departure, then taps Record unpaid departure with `userEvent.click` and captures exactly one
  `record-unpaid-departure`, at both widths. Control: `hidden` added to `[data-record-departure]` →
  `2 failed` (both widths), at `record.checkVisibility()` (`.panel-footer.test.ts:340`).
- **M3.** Backlog line A1259 in _The till, devices and table service_ (`docs/backlog.md`): the two
  strings, that only tests name them on `main` and here, their last user's removal in A773-1
  (#1897, `c9ad7a634`, `git log -S` on `origin/main`), and the three test files that check them.
  Four lines, so no detail file. The item counter moved from A1259 to A1260.
- **Runs.** The whole screen set (91 files): `Test Files 91 passed (91)`, `Tests 1801 passed
  (1801)` (Task 12's 1800 plus the 390×844 row), no `Errors` line. The 12 app files of the review's
  app set: `Test Files 12 passed (12)`, `Tests 3200 passed (3200)` (3199 plus the app case). After
  the final edits, `.panel-footer`, `.empty-drawer.a11y`, `.test.ts` and `-handheld-pay` again:
  `Tests 630 passed (630)`. `pnpm --filter @waitron/till typecheck` exit 0; `prettier --check` and
  `eslint` on the changed files exit 0.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.panel-footer.test.ts:305` (Finish table's refusal above the foot) | stricter | 1024×768 only, Record unpaid departure only `not.toBeNull()` → also 390×844; Take payment and Record unpaid departure `checkVisibility()` true; a real tap on Record unpaid departure sends one `record-unpaid-departure`; every earlier check unchanged; retitled with the size | D9; review 11c I1, M2 | 11c answers |
| `.test.ts:801` (empty tab) | S | the mount gains `orderId: "wo-4"` and an empty service read; the `expect`s are byte-identical | review 11c I2 | 11c answers |
| `.empty-drawer.a11y.test.ts:53` (was) → `:82` | removed + stricter | no summary while the read is unread (removed) → after the read, the summary is exactly 0 ready, 0 firing, 0 held, 1 served (added). Relabelled 2026-10-31 (fixes review M3; was "stricter"): a grep of the till's tests that set `currentOrdersUnread`, reading each hit, found no other check that no summary is drawn while the read is unread (a grep, not a mutation) | D17; review 11c I2 | 11c answers |

## Task 12: the table's foot: totals and Pay, no Hold, quiet Pay, one Full invoice (≈65 calls)

**Files.** `widgets/tender-pay.ts` (properties `parks` default `true`, `invoices` default `true`,
`payQuiet` default `false`; with `payQuiet` Cash and Card are `secondary`, enabled, and a tap
dispatches `pay-quiet-tap` and nothing else; Hold drawn only with `parks`; `#renderInvoiceButton`
only with `invoices`); the screen (`parks=false`, `invoices=false`, `payQuiet=${unsent}`; the pay
ways, Pay the rest and the handheld Pay follow D5; `#onTenderPark` goes; a `role="alert"` line in
the pay section shows `billUnsentText(label)` after a quiet tap, cleared when the bill or its unsent
state changes; `#billChoices`' Full invoice gated on `invoiceNumber === undefined` too (D8, minor 6);
`#billAdjust` leaves the foot, its ⋮ copy from Task 10 stays (D16)); tests
`till-table-order-screen.panel-footer.test.ts` (`:29-54`, `:127-150`),
`till-table-order-screen.test.ts:694`, `widgets/tender-pay.test.ts` (counter defaults unchanged),
`till-table-order-screen.bill-payments.test.ts` (handheld), `bill-controls.a11y.test.ts` (quiet Pay
in both themes), the `data-discount-bill` sites (`panel-footer.test.ts`,
`till-table-order-screen.adjustments.test.ts`, `till-app-adjustments.test.ts`,
`panel-footer.a11y.test.ts`, kind R).

- [x] Cases `A803 pay scope` in `panel-footer.test.ts`:
      - **the foot's exact contents, in order** (I8, D16): for an open owing bill on a wide screen —
        `[data-order-total]`, the still-to-pay row, then the pay section holding exactly Cash and
        Card (no Park/Hold, no tender-pay Full invoice), `[data-choose-bill-invoice]`, and the three
        `[data-open-bill-pay]` ways — and no `[data-discount-bill]` anywhere outside the ⋮; with two
        receipt languages, `[data-choose-bill-language]` too; for a part-paid bill — totals, the
        still-to-pay line, Pay the rest, the bill's choices and the pay ways; on a handheld —
        totals, one Pay (`data-pay-sheet`) and the bill's choices;
      - one Full invoice on the payment step; none for a presented bill that has an invoice number;
      - with an unsent dish in this bill's New order, Cash, Card and each pay way are `secondary`
        and not `disabled`, and a tap on each shows "Bill 1. Send or remove the unsent dishes before
        paying." and dispatches no `pay-tab`/`bill-pay`; the same when the unsent dishes are another
        person's on this bill (`party.unsentDrafts`), and then that person's
        `[data-take-over="<draftId>"]` button is on the screen (minor 10); NOT quiet when the unsent
        dishes are on Bill 2 only; in Spanish the sentence is «Envía o quita los platos sin enviar
        antes de cobrar.».
      In `tender-pay.test.ts` `A803 counter unchanged`: with defaults, Park and Full invoice are
      drawn and Cash is primary.
- [x] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/widgets/tender-pay.test.ts -t 'A803'`.
- [x] Implement; re-point the `data-discount-bill` sites (open the ⋮ first).
- [x] GREEN: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.panel-footer.a11y.test.ts src/screens/till-table-order-screen.adjustments.test.ts src/till-app-adjustments.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/widgets/bill-pay-dialog.unsent.test.ts src/widgets/tender-pay.test.ts src/widgets/tender-pay.a11y.test.ts src/screens/till-table-order-screen.bill-payments.test.ts src/screens/till-table-order-screen.bill-controls.a11y.test.ts src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts`;
      `pnpm --filter @waitron/till exec vitest run src/screens/till-counter-screen.test.ts` (the counter keeps Park); till typecheck.
- [x] Commit: "The table's foot: totals and Pay, quiet while this bill has unsent dishes".

### Task 12 as built (2026-10-31)

Runs in the foreground with `AI_AGENT`/`CLAUDECODE` unset; free memory 55–61% before each browser
run. File names drop the `till-table-order-screen` prefix for screen files and the `till-app` prefix
for app files; lines are at this task's commit unless written "was :N" (a line at `89f76bf08`).

- **Built.** `till-tender-pay` gains `parks`, `invoices` (both default `true`) and `payQuiet`
  (default `false`) and the event `pay-quiet-tap` (detail `{}`, bubbling and composed). With
  `payQuiet`, Cash and Card are `secondary`, stay enabled, and a tap dispatches `pay-quiet-tap` and
  starts nothing. Hold is drawn only with `parks`, its own Full invoice only with `invoices`. The
  table screen sets `parks=false`, `invoices=false` and `payQuiet` from `#billHasUnsent()` (a line
  in the screen's New order, or an entry of `party.unsentDrafts` naming the bill on screen). Pay the
  rest and the handheld's Pay are drawn `secondary` while quiet; they and the pay ways show the
  sentence and send nothing on a tap. The sentence (`billUnsentText(billLabel(bill))`, the existing
  `bill_pay.unsent` string: **no new string**, so nothing joins Q1) is a `role="alert"` line,
  `[data-pay-unsent]`, at the end of the pay section; `willUpdate` clears it when another bill is
  shown or the bill has no unsent dishes left. `#onTenderPark` is gone. `#billChoices`' Full
  invoice is gated on `invoiceNumber === undefined` too; the receipt-language gate is unchanged.
  `#billAdjust` and its `.bill-adjust` style are gone, so Comp the bill is only in the ⋮;
  `#compBill` lost its variant parameter (only the ⋮'s `ghost` was left).
- **Departure: an unanswered whole payment is never quiet.** `till-app-handheld-pay.test.ts:1069`
  ("a resend carries the original request after another person's draft has changed the bill")
  failed: another person's draft on a presented bill made the handheld's Pay quiet, so the locked
  sheet that resends a whole payment whose answer is unknown could not be opened. That Pay recovers
  a payment already sent, it does not start one (D5 names "every control that starts a payment"),
  and on a wide screen the pay card shows its confirmation view, with no Cash or Card, in that state.
  So quiet is off while `paymentConfirmation` is set. New case in `A803 pay scope`: "is not quiet
  for a handheld's unanswered whole payment of a presented bill, which it recovers".
- **Surprise, not changed: a closed zone.** `.test.ts:7120` (a zone closed to new dishes, two
  coffees left in New order) checked that Pay items still pays. Under D5 it is now quiet until
  those dishes are removed. The sentence says "Send or remove"; in a closed zone only Remove is
  possible, and the line controls to do it are on the screen. No owner question is raised for it.
- **Found, not changed** (corrected in the Task 12 review answers, M2). `till-counter-screen.test.ts`
  alone (48 cases) does not pin Park: it passes with `parks` defaulting to `false`. The counter's
  help, layout and look suites and `till-app-boot-and-counter.test.ts` do (the review's experiment 7:
  51 cases fail with `parks` defaulting to `false`), as do `tender-pay.test.ts` `A803 counter
  unchanged` and the A738 Park cases at the widget.
- **RED** (the plan's command): `Tests 16 failed | 8 passed | 195 skipped (219)`. Failed: the four
  foot-contents cases (extra `data-discount-bill`, `tender hold`, `tender data-full-invoice`), the
  invoice-number case (`expected <wt-button …> to be null`), six quiet cases (`expected 'primary'
  to be 'secondary'`; the clearing case `expected null not to be null`), and the five widget cases
  (`expected undefined to be true` for the defaults, Hold and Full invoice present, `primary`).
  Passed before: the seven `A803 no tab panel` cases and "is not quiet when the unsent dishes are
  on Bill 2 only" (nothing was quiet yet).
- **GREEN.** The plan's GREEN command (12 files): `Test Files 12 passed (12)`, `Tests 1095 passed
  (1095)`, exit 0. `till-counter-screen.test.ts`: `Tests 48 passed (48)`. The whole screen set
  (91 files): `Test Files 91 passed (91)`, `Tests 1800 passed (1800)`, no `Errors` line, exit 0
  (1783 at 11c, plus 17 new cases). The other files that touch the pay controls, plus
  `-parties` and `-drafts` (30 files): `Test Files 30 passed (30)`, `Tests 3654 passed (3654)`.
  `pnpm --filter @waitron/till typecheck` exit 0; `prettier --check` and `eslint` on the changed
  files exit 0. No string changed, so `src/i18n` and `scripts/english-only.test.ts` were not run.
- **Deletion controls** (each on the plan's RED filter, the file put back from a saved copy and
  `cmp`-equal after): Hold drawn whatever `parks` → 3 failed (the two wide foot-contents cases,
  "draws no Hold when it does not park"); tender-pay's Full invoice whatever `invoices` → 4 failed
  (the two wide foot-contents cases, the one-Full-invoice case, "draws no Full invoice of its own");
  a quiet Cash tap also starting the payment → 5 failed (four screen quiet cases, the widget's `.pay`
  case); a quiet Card tap also starting the card → 5 failed (four screen quiet cases, the widget's
  `.pay-card` case; before the screen's quiet check also read the pay card after each tap, this
  control failed only 2); the screen's quiet tap never refusing → 6 failed (every screen quiet case
  that taps); the alert line never drawn → 6 failed (the same six); the `invoiceNumber` gate
  removed → 1 failed (the one-Full-invoice case); the clearing in `willUpdate` removed → 1 failed
  (the clearing case); any bill's `unsentDrafts` counting → 1 failed (Bill 2 only); quiet not
  lifted for an unanswered payment → 1 failed (the recovery case); `parks`, `invoices` or
  `payQuiet` default flipped → `A803 counter unchanged` fails each time (plus the other widget case
  that relies on that default).

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.panel-footer.test.ts:33` (was "offers payment and Discount without opening the drawer") | B + R | the foot's Discount visible and before the pay card → no `[data-discount-bill]` in `[data-bill-actions]` (B); Discount found and visible in the opened ⋮ (R); the summary, pay card and one-widget checks unchanged; retitled | D16 "Comp the bill leaves the foot for the ⋮ bill section"; D4 | 12 |
| `.panel-footer.test.ts:60` (Discount keeps the saved amount) | R | the foot's Discount tapped → the ⋮ opened and its Discount tapped; the `adjust` detail `toEqual` byte-identical | D16 | 12 |
| `.panel-footer.test.ts:85` (no payment without settling, Discount kept) | R | the foot's Discount visible → the ⋮'s Discount visible; the other checks unchanged | D16 | 12 |
| `.panel-footer.test.ts:138` (was "… swallows a counter Hold from the relocated widget", was `:135`) | B | a synthetic `park-order` from the widget did not leave the screen → the widget draws no Hold (`.hold` null, no `action.hold` text) beside a drawn Cash; the `pay-tab` forwarding checks byte-identical; retitled | D6 ("`#onTenderPark` goes"; Hold is not drawn, so the widget cannot send `park-order`) | 12 |
| `.panel-footer.test.ts:215` (the bill's state after switching, was `:213`) | R | the foot's Discount text → the ⋮ opened, its Discount text; `toContain(t("table.discount_bill"))` unchanged | D16 | 12 |
| `.panel-footer.a11y.test.ts:28` (24 cases: EN/ES × themes × widths × partial) | B + R | the foot's Discount in the visible, ≥ 44 px, inside-the-width loop and tapped for the whole bill → no Discount in the foot (B); the ⋮ opened and its Discount given the same text, visibility, height and width checks, then tapped (closed first for the part-paid case, whose tap is Pay the rest); the `adjust` and `bill-pay` checks byte-identical (R) | D16 | 12 |
| `.adjustments.test.ts:428` (comp the bill on screen) | R | the foot's Discount → the ⋮ opened and its Discount; text and `adjust` detail unchanged | D16 | 12 |
| `-adjustments.test.ts:496`, `:693` (whole-bill discount; refused as out of date) | R | the foot's Discount pressed → the ⋮ opened (`openTableMenu`), its Discount pressed; everything after unchanged | D16 | 12 |
| `.test.ts:746` (was "swallows a Hold (park-order) from the embedded pay widget") | B | the synthetic `park-order` did not leak → the widget draws Cash and no Hold; retitled | D6 | 12 |
| `.test.ts:7120` (a zone closed to new dishes keeps the bill payable) | B | Pay items with two coffees in New order sends `bill-pay` once → that tap sends nothing and shows `bill_pay.unsent`; after New order is cleared, Pay items sends `bill-pay` once; the zone, draft and Move checks unchanged | D5; spec owner amendment "quiet Pay with unsent dishes" | 12 |

**Owner question 5f candidates:** none. No check was deleted without a replacement.

### Task 12 review answers (2026-10-31, `a803-3-reviews/task-12.md`)

Answered on top of the Task 11c review answers (`e8b1ee8dc`). Runs in the foreground with
`AI_AGENT`/`CLAUDECODE` unset; free memory 51–55% before each browser run. Every control changed
one line (one pattern; the app binding's two identical lines together) by a script that asserts the
pattern's count, ran `.panel-footer.test.ts`, `-bill-payments.test.ts` and `tender-pay.test.ts`
with `-t A803` (481 cases), and put the file back from a saved copy (`cmp`-equal after); failures
read per case from Vitest's JSON report. Lines are at this answer's commit. D5 has a dated
addendum with the new rule.

- **I1 (behaviour), quiet Pay blocked the way back to a bill payment that got no answer.** Fixed:
  the app binds `billPaymentHeld` (`till-app.ts:18856`, `:18995`, from `#billPaymentHeld`: a bill
  payment out on the bill or one A773-1 holds unanswered), and the screen's `#recovers`
  (`till-table-order-screen.ts:4070`) lifts quiet for the bill-payment controls (the pay ways, Pay
  the rest) and the handheld's Pay while it is set. Each of those taps reaches `#openBillPaying`
  (the handheld's Pay on a presented bill through `#onPayPresented`), which, by reading, opens the
  dialog with the held payment's request and preview and `confirmationLocked` set, whichever way
  was tapped; the app case below runs it for Pay items only. A tap that goes ahead also takes down a
  sentence an earlier quiet tap showed (`#payQuietTap`, `:4081`).
  - App case, new: `-bill-payments.test.ts:2503` "Pay items reopens a part payment that got no
    answer while another person's unsent dish is on the bill; Cash stays quiet" (the review's H1:
    a contribution with no answer, the dialog closed, Luis's saved draft of the bill read on
    reopening the table, his Take over drawn; Cash is secondary and its tap shows the sentence;
    Pay items, tapped with `userEvent.click`, opens the dialog `confirmationLocked` with Check
    again, the sentence gone, no new send).
  - Screen cases, new: `.panel-footer.test.ts:657` (the pay ways send `bill-pay` while held, and
    clear the sentence), `:679` (Pay the rest primary and sends), `:697` (the handheld's Pay on an
    open and on a presented bill, primary and sends `bill-pay`/`pay-presented`).
- **M3, the exceptions per control.** `#recovers` names the control: the tender (Cash and Card)
  never recovers, so it stays quiet under both holds (`:657` and the app case check it); the
  handheld's Pay recovers under an unanswered whole payment. The state the review read (a handheld
  showing an open bill while a whole payment of it has no answer, its Pay then sending a new
  `bill-pay`) is not drawn: `#paysOnSheet` gives the sheet's Pay, with a whole payment unanswered,
  only to a presented bill, so an open bill gets the pay card's confirmation view, which has no
  Cash or Card. New case `:722` "draws no Pay that starts a bill payment on a handheld's open bill
  while a whole payment of it has no answer" (no `[data-pay-sheet]`, no pay way, no Pay the rest,
  the tender's Confirm payment and no Cash or Card); it passes on the old code too, since it pins
  the drawing, not the quiet rule. Control C3c (the experiment behind dropping the presented-bill
  test from `#recovers`): the sheet recovering under an unanswered whole payment whatever the bill's
  status → `0 failed`, which is why `#recovers` does not repeat `#paysOnSheet`'s status check.
- **I2 (behaviour), Pay stayed quiet with nothing on screen to act on.** Fixed as the review
  proposed: `#billHasUnsent` (`:4061`) reads the screen's New order and `otherDrafts` (any of them
  with a line), never `party.unsentDrafts`, and nothing while no draft is drawn. So it changes with
  the draft store and the fifteen-second read of other drafts, and every quiet state has its own way
  out drawn. **Choice for a draft that could not be read:** not quiet (the most conservative of the
  brief's options): no unsent dish is known and shown. Corrected 2026-10-31 (fixes review M2,
  its experiment 4): what then stops a payment is the till's own draft save. `#onPayTab` and
  `#onBillPay` save the draft before anything else, that save fails with no draft read, and no
  request reaches the server; the till shows "Your last change to an order was not saved. Open
  its table to check it." (`table.draft_save_failed`; the save-first lines are on `main`,
  `c9ad7a634` and `1356ff14a`), about a change the waiter never made. The server's refusal of a
  bill with unsent dishes stands behind it on both paths. Whether Pay should look payable in that
  state is a design question for Task 16's backlog pass.
  - App cases, new: `-bill-payments.test.ts:2545` "is not quiet once the waiter removes their own
    unsent dish, with no floor read" (the review's H2: the floor still lists the waiter's own
    entry; Cash goes primary after `removeLine(0)` and Pay items opens the dialog, with no floor
    read); `:2569` "is not quiet after the fifteen-second draft read finds another device's dishes
    gone" (Luis's draft removed from the draft server, the timer advanced 15 s; his Take over goes
    and Cash is primary, with no floor read).
  - Screen cases, new: `.panel-footer.test.ts:759` (an entry of `party.unsentDrafts` for this bill,
    another person's draft drawn with no dishes → not quiet), `:769` (another person's draft read
    again without dishes → not quiet, sentence cleared), `:781` (`draftStore` null, with an entry
    and another person's draft with dishes → no Take over drawn, not quiet).
- **I3, the sentence below the window.** Fixed: `#payQuietTap` starts `#revealPayUnsent` (`:4092`),
  which waits for the update and scrolls `[data-pay-unsent]` into view (`block: "nearest"`), as the
  Finish refusal is. `expectQuiet` now scrolls each control to the window's bottom edge
  (`scrollIntoView({ block: "end" })`) before tapping it, and checks the alert's box is inside the
  window (top ≥ 0, bottom rounded down ≤ `innerHeight`). The quiet cases run at 1024×768; the
  New order case runs at 1024×768 and 390×844 (opening Review where the foot is on it), and the
  handheld case at 390×844.
- **M1, a payment opened before the bill turned quiet.** Chosen: guard Confirm payment with the
  same quiet tap (`tender-pay.ts:1376` card reference, `:1427` keypad), drawn `secondary` while
  quiet, rather than closing the open step. Why it is clearer to staff: the step does not vanish
  under them because of something done on another device; the sentence comes at the moment they
  press Confirm, saying what to do; and the amount typed or the card reference stays, so once the
  dishes are sent Confirm sends it (closing the step would also drop typed input without asking,
  against the unsaved-input rule). Widget case, new: `tender-pay.test.ts:2544` (keypad and card
  reference: Confirm secondary and enabled, a tap sends one `pay-quiet-tap` and no
  `confirm-payment`, the typed amount or reference kept; quiet lifted, Confirm primary and sends it).
  Screen case, new: `.panel-footer.test.ts:793` (Cash opened with nothing unsent, 20 typed, then a
  dish in New order → Confirm secondary, its tap sends no `pay-tab`/`confirm-payment` and shows the
  sentence).
- **M2.** The as-built "Found, not changed" bullet now says `till-counter-screen.test.ts` alone does
  not pin Park, and names the suites that do, with the review's count.
- **RED** (new and changed cases with the screen, app and widget as at `e8b1ee8dc`; the three
  files `-t A803`): `481 total, 19 failed, 25 passed`. Per case: the app H1 case `expected
  undefined to be true` (no dialog); the two app I2 cases and five screen cases (`:679`, both `:697`
  rows, `:759`, `:781`) `expected 'secondary' to be 'primary'`;
  `:769` `expected null not to be null`; the position check in every quiet case (`expected 914 to
  be less than or equal to 768` at 1024×768, `990`/`938` against 844 at 390×844, `983` in Spanish),
  which also fails `:657` first; the two widget M1 rows and `:793` `expected 'primary' to be
  'secondary'`.
- **GREEN.** The plan's Task 12 GREEN command (12 files): `Test Files 12 passed (12)`, `Tests 1112
  passed (1112)`. `till-counter-screen.test.ts`: `Tests 48 passed (48)`. The whole screen set
  (91 files): `Test Files 91 passed (91)`, `Tests 1811 passed (1811)` (1801 plus 10 new), no
  `Errors` line. The 11c review's 12 app files (which include `-parties`, `-drafts`,
  `-handheld-pay` and `-bill-payments`): `Test Files 12 passed (12)`, `Tests 3203 passed (3203)`
  (3200 plus 3). All three after the last code edit. `pnpm --filter @waitron/till typecheck` exit
  0; `prettier --check` and `eslint` on the six changed files exit 0. No string changed, so
  `src/i18n` and `scripts/english-only.test.ts` were not run.
- **Controls** (each production line broken, then put back):
  - C1, `billPaymentHeld` ignored in `#recovers` → 5 failed: the app H1 case (`expected undefined
    to be true`), `:657` (the sentence not taken down), `:679` and both `:697` rows (`expected
    'secondary' to be 'primary'`).
  - C2, the app binding set to `false` at both sites → 1 failed: the app H1 case.
  - C3, the tender also recovering → 2 failed: the app H1 case and `:657` (`expected 'primary' to be
    'secondary'`: Cash no longer quiet under a hold).
  - C3b, the handheld's Pay not recovering an unanswered whole payment → 1 failed: `:635` "is not
    quiet for a handheld's unanswered whole payment of a presented bill, which it recovers".
  - C3c, see M3 → 0 failed.
  - C4, `party.unsentDrafts` counted again for this bill → 4 failed: both app I2 cases, `:759`,
    `:769`.
  - C5, the null-draft guard removed (others counted with no draft drawn) → 1 failed: `:781`.
  - C6, the scroll replaced by `focus({ preventScroll: true })` → 7 failed: every quiet case that
    taps through `expectQuiet` (both New order rows, Pay the rest, handheld, another person's,
    `:657`, Spanish), at the position check.
  - C7, the keypad's Confirm unguarded → 2 failed: `:793` (a `pay-tab` sent) and the widget's
    keypad row (`pay-quiet-tap` not sent).
  - C8, the card reference's Confirm unguarded → 1 failed: the widget's card reference row.
  - C9, a going-ahead tap not taking the sentence down → 2 failed: the app H1 case and `:657`.

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `.panel-footer.test.ts:524` `expectQuiet` (every quiet case) | stricter | the tap and the alert's `checkVisibility()` → each control first scrolled to the window's bottom edge, and the alert's box inside the window after the tap; every earlier check unchanged | review 12 I3 | 12 answers |
| `.panel-footer.test.ts` quiet cases (the `describe`'s viewport) | S | 1280×1100 (the file's `beforeEach`) → 1024×768 for the quiet cases; the handheld case at 390×844 with the foot shown through Review where it sits there; every `expect` unchanged | review 12 I3 | 12 answers |
| `.panel-footer.test.ts:571` (was "keeps Cash, Card and the pay ways quiet … New order") | stricter | one run at 1280×1100 → `it.each` over 1024×768 and 390×844; checks unchanged; retitled with the size | review 12 I3 | 12 answers |
| `.panel-footer.test.ts:602` (another person's unsent dishes) | B | `otherDrafts` entry with no lines (quiet came from `party.unsentDrafts`) → the same entry with one dish; `party.unsentDrafts` kept; every `expect` unchanged | D5 addendum (1) | 12 answers |
| `.panel-footer.test.ts:635` (a handheld's unanswered whole payment) | B | unsent from `party.unsentDrafts` → also another person's draft with one dish, so the bill really is unsent under the new rule and the exception is what lifts quiet; every `expect` unchanged | D5 addendum (1), (2) | 12 answers |
| `.panel-footer.test.ts` "is not quiet when the unsent dishes are on Bill 2 only" | unchanged | the case is byte-identical. Corrected 2026-10-31 (fixes review M4): it still fails if any bill's `party.unsentDrafts` is read (the review's mutation Ma: 4 cases fail, it, `:759` and both app I2 cases; Task 13's control 6 turned it red too). C4, which counts only this bill's entries, does not fail it | D5 addendum (1) | 12 answers |

**Owner question 5f candidates:** none. No check was deleted or loosened.

### Fix review answers (2026-10-31, `a803-3-reviews/fixes-11c-12.md`)

Answered on top of the Task 12 review answers (`7edaa74c3`). Runs in the foreground or as one
background command, with `AI_AGENT`/`CLAUDECODE` unset; free memory 49–56% before each browser
run. Each control changed one line (the app binding's two identical lines together) by a script
that asserts the pattern's count, ran the `A803 quiet Pay` cases of `-bill-payments.test.ts`, and
put `till-app.ts` back from a saved copy (`cmp`-equal after). Lines are at this answer's commit. D5
has a second dated addendum with the narrowing. No string was added: the dialog shows its own
existing unsent sentence.

- **I1 (behaviour), a reopened payment became a new-payment dialog while the bill had unsent
  dishes.** Fixed in the app, where the dialog's events land. `#unsentOnScreen` (`till-app.ts`)
  reads the screen's rule through a helper both now share, `billHasUnsent`
  (`state/bill-unsent.ts`: a dish in the New order drawn for the bill, or in another person's
  draft of it drawn with its Take over; nothing while no New order is drawn). `#refusedUnsent`
  puts the dialog's refusal to `bill.unsent_dishes` for the bill, which the dialog already words
  as `billUnsentText` after the bill's label ("4 · Bill 1. Send or remove the unsent dishes before
  paying.", the sentence it shows today when the server refuses for unsent dishes), and sends
  nothing. `#onBillPayPreview` asks it before any preview (after the existing check that a held
  payment is still unanswered, which reopens it as before); `#onBillPayConfirm` asks it before any
  send except Check again of a payment still without an answer (`previous?.unconfirmed === true`),
  so the recovery is never stopped. The typed amount and the confirmation stay, as the screen's
  keypad Confirm keeps them (Task 12 review answers, M1).
  - **Draft saved before a new preview.** `#onBillPayPreview` now saves the New order
    (`#flushDraft`) before reading the bill's edit and asking for a preview, on every table
    dialog. The skip it closes predates the branch: `#onBillPay` skips the save while a payment
    holds the bill (`git blame`: `c9ad7a634`, A773-1, #1897, and `9a52b5efc`, A796, #1921, both
    on `origin/main`, `git merge-base --is-ancestor` exit 0); this slice opened the path to that
    dialog while the bill has unsent dishes. A save that fails says so in the dialog
    (`#saidInDialog`: the till's own error text, which the dialog would otherwise cover), and no
    preview is sent.
  - **A dialog opened before the dishes appeared.** Run, and the same gap was there: with the
    dialog open, another person's draft read in (the window's `focus` refresh), Continue sent a
    preview and Take payment sent a payment. The same check covers it. **The presented sheet**
    (handheld) was run the same way, and in that case nothing is sent: its pay saves the New order
    first, that save fails while another person's draft holds the bill, and the till's banner says
    "Luis has taken over this order. …" (the sheet itself shows nothing). Not run: the waiter's
    own dish on a presented bill. New case pins that nothing is collected in the case run. A
    guard in `#payWholeTab` to show the unsent sentence there instead was tried and dropped: it
    failed 6 existing `-drafts.test.ts` cases ("A773 Pay requires takeover before paying a
    colleague's bill", the four "flushes before … Pay and retains the bill and dishes on refusal"
    rows and "sends no pay-tab when the local draft cannot be saved"), which pin the save-first
    path, and no existing assertion is changed in this answer.
  - App cases, new (`-bill-payments.test.ts`): `:2644` "takes no new payment from a reopened
    payment that Check again finds declined while the bill has unsent dishes" (the review's A1b);
    `:2669` "starts no new preview from a reopened payment another device answered declined /
    received while the bill has unsent dishes" (A3b, two rows); `:2697` "saves the waiter's own
    removal before a new preview from a reopened payment"; `:2731` "says in the dialog that the
    waiter's removal was not saved, and asks for no preview"; `:2761` "starts no payment from a
    dialog opened before another person's dishes were read" (continue, take). In
    `-handheld-pay.test.ts`: `:314` "a sheet opened before another person's dish was read collects
    nothing" (passes on the old code too: it pins that nothing is sent).
- **M1, `billPaymentHeld` belongs to the bill on screen.** New app case `-bill-payments.test.ts:2789`
  "leaves another bill's Pay quiet while a payment on Bill 1 has no answer" (the review's A2: a
  contribution on Bill 1 with no answer, Luis's dish on Bill 2 only, Bill 2 shown: `billPaymentHeld`
  false, Cash secondary, Pay items opens no dialog and shows "Bill 2. Send or remove …"). It passes
  on the old code (HEAD was right); control D4 turns it red.
- **M2.** The I2 bullet above and D5's first addendum now give the path the review ran: the
  till's own draft save fails first, no request reaches the server, and the till says "Your last
  change to an order was not saved. Open its table to check it."
- **M3.** The `.empty-drawer.a11y.test.ts` row in the Task 11c review answers is relabelled
  "removed + stricter", saying no other check of "no summary while unread" was found (a grep).
- **M4.** The Task 12 review answers' "Bill 2 only" row now says the case still fails when any
  bill's `party.unsentDrafts` is read.
- **Task 13's plan text.** Controls 1, 2 and 7 corrected in its list, and "Task 13 as run" added.
- **RED** (the new cases with `till-app.ts` as at `7edaa74c3`, the screen's helper change kept,
  `-t 'A803 quiet Pay|a sheet opened before'` over the two app files): `Tests 7 failed | 5 passed`.
  Per case: A1b `expected 5 to be 4` (a fifth send, under a new submission id) at `:2664`; both A3b
  rows `expected 2 to be 1` (a second preview) at `:2692`; the draft-save case `expected 1 to be
  +0` (the preview went out while the server still held the dish) at `:2728`; the save-failure
  case `expected '' to be 'Your last change to an order was not …'` at `:2757`; the opened-before
  rows `expected 1 to be +0` (a preview) at `:2783` and `takeBillPayment` called once at `:2784`.
  Passed: the three Task 12 answer cases, M1's case and the presented sheet's case.
- **GREEN.** `A803 quiet Pay`: `Tests 11 passed`. The 11c review's 12 app files: `Test Files 12
  passed (12)`, `Tests 3212 passed (3212)` (3203 plus 9). The plan's Task 12 GREEN command (12 files): `Test Files
  12 passed (12)`, `Tests 1121 passed (1121)` (1112 plus 9). The whole `src/screens` folder
  (`vitest run src/screens`, 168 files, which hold the 91-file screen set): `Test Files 168
  passed (168)`, `Tests 4078 passed (4078)`, no `Errors` line. All after the
  last code edit. `pnpm --filter @waitron/till typecheck` exit 0; `prettier --check` and `eslint`
  on the five changed code and test files exit 0. No string changed, so `src/i18n` and
  `scripts/english-only.test.ts` were not run. No server file was touched.
- **Controls** (each production line broken, then put back):
  - D1, `#onBillPayPreview`'s unsent check removed → 3 failed: both A3b rows at `:2693` and the
    opened-before Continue row at `:2785` (`expected 'Luis has taken over this order. Your …' to
    be '4 · Bill 1. …'`). No preview went out even so: the new draft save fails while Luis's draft
    holds the bill, and the dialog shows that save's refusal instead of the unsent sentence.
  - D2, `#onBillPayConfirm`'s unsent check removed → 2 failed: A1b at `:2664` (`expected 5 to be
    4`) and the opened-before Take payment row at `:2784` (`takeBillPayment` called once).
  - D3, the draft save before a preview removed → 2 failed: `:2728` (`expected 1 to be +0`) and
    `:2757` (`expected '' to be …`).
  - D3b, a failed save leaving the dialog's refusal empty → 1 failed: `:2757`.
  - D4 (M1), both app bindings set to "any bill held" (`[...#unansweredPayments.values()].some(…
    unconfirmed) || #paymentsOut.size > 0`) → 1 failed: `:2807` (`expected true to be false`).
  - D5, Check again of an unanswered payment no longer exempt → 1 failed: A1b at `:2656`
    (`expected true to be false`: Check again refused, the dialog stays locked).

No existing assertion changed, so this answer adds no Changed-checks row.

**Owner question 5f candidates:** none. No check was deleted or loosened.

## Task 13: whole-slice run and controls (no commit unless a fixture moves, ≈45 calls)

- [ ] Server: every file the Tasks 1–7 GREEN lines named, in one run per task list. Till:
      `git diff --name-only a90f4f87b -- apps/till | sed 's#apps/till/##' | /usr/bin/grep '\.test\.ts$' | xargs pnpm --filter @waitron/till exec vitest run`.
- [ ] S, F, H2 (byte-unedited, the `git diff` check above), Filing, G, words and codes, both
      typechecks.
- [ ] Proof by deletion, one at a time in the working tree and reverted, each turning the named case
      red for that reason (record each red line in the ledger):
      1. restore the merge arm in `moveBillOnce` → "arrives as its own bill …" (Task 2). The old
         condition (an untouched bill) is gone, so the control makes every move merge instead;
      2. restore the `merging` decision in `combineParties` → "joining a seated table … keeps both"
         (Task 3a). The old condition (the main bill) is gone, so the control makes the combine
         merge the two parties' first bills instead;
      3. drop the empty-bill creation in `splitTable` for the staying party → "leaves the staying party
         one new empty bill" (Task 4a);
      4. compute `openingBillId` as the first bill in opening order → "the floor row opens on the
         lowest-numbered owing bill" (Task 6c);
      5. make the till's `new-bill` handler switch to the lowest-numbered bill instead of the answer →
         "the next draft save names it" (Task 9);
      6. count another bill's unsent dishes in D5's rule → "NOT quiet when the unsent dishes are on
         Bill 2 only" (Task 12);
      7. drop the keypad Confirm's quiet guard → `panel-footer.test.ts:816` in "keeps a cash payment
         begun before the dishes appeared from being confirmed", which checks that no `pay-tab` is
         dispatched (Task 12). A
         quiet Cash tap only opens the keypad and never dispatches `pay-tab`; dropping Cash's own
         guard is caught by the sentence and position checks at `:545`/`:549` instead;
      8. draw the ⋮ Full invoice for a paid bill → "a paid bill offers none … no request" (Task 10);
      9. remove the vanished-bill check from `#loadPartyBills` → "another till merged the bill on
         screen away" (Task 8d);
      10. make opening a no-bill party call `createPartyBill` → "sends no `createPartyBill`" (Task 8d);
      11. make `createPartyBill` call `bumpPartyRevision` inside `insertPartyBill` as well →
          "`insertPartyBill` … leaves the party's revision where it was" and "moves once per action"
          (Tasks 1, 4a).
- [ ] Coverage is CI's (root `CLAUDE.md` §2): after the push, read the `changes` job's `packages`
      output on the PR head (it must name `@waitron/server`, `@waitron/till`, `@waitron/db`) and each
      one's coverage or merge job. Not from this worktree (changed-since matches nothing in a worktree).

### Task 13 as run (2026-10-31)

Run at `7edaa74c3` with no commit (tree clean after); the counts are from the run's ledger line.

- **Suites, all green.** Server, one run per task's GREEN list: Task 1 367, 2 505, 3a 520, 3b 350,
  4a 383, 4b 644, 5 705, 6a 1041, 6b 354, 6c 1240, 7 279; db parties 12. Till: the 105 changed
  test files in three batches, 1222 + 1315 + 4366, no `Errors` line, no flake. S 558 + 4041 + 34
  (4041 against 4040 at Task 1, all passing, the one extra not investigated); H2 20; F 267; Filing
  67; G 75 + 12; words and codes 2046. Server and till typechecks exit 0. F and H2 byte-unedited
  (`git diff --stat a90f4f87b` on them empty).
- **Controls, each red** (failing cases / cases run):
  1. every move merging → `party-move-bill` `:331` "arrives as its own bill …" (26/66);
  2. the combine merging the first bills → `:1700` "joining a seated table … keeps both parties'
     bills …" (17/83);
  3. no empty bill for the staying party → `till-api.table-actions` `:709` (1/84);
  4. the number sort removed → `party-main-bill` `:580` (1/28);
  5. New bill showing the lowest-numbered bill → `:3409`, `wo-7` where `wo-new` was expected (3);
  6. any bill's unsent drafts counted → "is not quiet when the unsent dishes are on Bill 2 only"
     (2/42);
  7. the keypad Confirm's quiet guard dropped → `panel-footer` `:816` (1/42); Cash's own guard
     dropped instead → 7 fail, at `:545`/`:549`;
  8. a paid bill's ⋮ Full invoice drawn → 1/248;
  9. the vanished-bill check removed → 6/623, including "another till merged the bill on screen
     away";
  10. `createPartyBill` on opening → `till-app-open-table` `:2069` (1/66);
  11. `insertPartyBill` moving the revision → `party-bill-create` `:158` and `table-actions`
      `:769` (6/90).

## Task 14: guides and the design-system contract (≈35 calls)

- [ ] `apps/server/src/guide/en/table-service.md`: new `## Switch bills {#bill-switcher}` before
      `{#bill-names}` (`:226`): the switcher shows even with one bill; what a row shows (what it owes,
      Paid, a name, who has unsent dishes); + New bill; that when another till merges or moves the
      bill on screen the screen switches and says so; the ⋮ and its two sections (Comp the bill is
      in the bill section); that joining or moving keeps every bill, and Merge bills in the ⋮ joins
      two; the foot (totals, then the pay controls); Pay is quiet with this bill's unsent dishes,
      what a tap says, and Take over draft for another person's; no Hold at a table.
      `{#bill-names}` `:229-241`: "open **Table actions**" → "open **⋮**", and the "except a bill
      that **Merge the bills** folds into this party's main bill" clause goes (`:237-238`).
      `{#full-invoice}` `:3-23`: Full invoice from the payment step or the ⋮ for a bill still to pay
      and not yet invoiced; a paid bill's full invoice is a correction Waitron does not offer yet
      (Owner question 2). ES twins with the same ids (`es/table-service.md`, `{#bill-names}`
      `:247-251`), as **proposals** (Owner question 1). Search both guides for "Comp the bill" /
      «Descuento en la cuenta» and "Tab" and move each to the ⋮.
- [ ] `docs/developers/design-system.md`: near the table screen's action bar (`:1028-1048`) a
      "Table screen: bill switcher and ⋮" contract — the closed label, rows, + New bill last, the
      no-bill state, the vanished-bill notice, the ⋮'s two headed groups and item order, the action
      panel, the foot's exact contents (D16); and under the button rule (`:2801-2825`) the
      quiet-but-tappable Pay with this bill's unsent dishes (amendment 5) as an exception to "quiet
      while disabled": it is never `disabled`, because its tap explains. Only what Tasks 8d–12's
      tests cover.
- [ ] `docs/operations/a760-migration-squash-inventory.md:126-127`: a dated note that the two
      triggers were dropped by the new core files.
- [ ] G; open `/help/en/table-service#bill-switcher` and `/help/es/table-service#bill-switcher`
      during Task 15.
- [ ] Commit: "Guides and design contract: one bill switcher and one ⋮".

## Task 15: LOOK, and the owner's pictures (≈50 calls)

- [ ] Before any reset: `lsof +D <the slot's venue folder>` and `lsof -i :8080`; stop only
      processes this session started. The migration needs a fresh venue:
      `wa-wt reset demo waitron-feat-a803-3-bill-switcher`, then `wa-wt demo waitron-feat-a803-3-bill-switcher`
      (never a bare `pnpm dev`).
- [ ] EN and ES, light and dark, 390 and 1280 px, screenshots outside the repository: a table with
      one bill (closed and open switcher, + New bill last); three bills, one paid, one named "Clint",
      one with another waiter's unsent dishes; a long bill name; the ⋮ open for an open, a paid and a
      presented bill; Full invoice from the ⋮ and from Pay; Pay quiet with this bill's unsent dish
      and the sentence after a tap, and not quiet with Bill 2's; join a seated table (bills kept,
      numbers continue); move a bill to a seated table and to the counter; split a table giving the
      first bill; a bill on screen merged away from a second browser tab (the notice and the new
      label); a stale-revision refusal on + New bill and its recovery; Finish table refused with
      Take payment; handheld width; keyboard only through the switcher and the ⋮ (focus returns to
      the trigger), touch targets, native enabled state of the quiet Pay. Physical tills were not
      used; say so.
- [ ] **Pictures for the owner** (review-1 minor 5, I8), saved as PNGs in
      `docs/backlog/mockups/a803-bills-and-tables/` and copied with each question's text to
      `~/My Drive/Waitron mockups/2026-10-30 A803 slice 3 <topic>/`:
      `slice3-q3-full-invoice-bill-button.png` (as built) and
      `slice3-q3-full-invoice-pay-panel-button.png` (the same bill with `till-tender-pay`'s
      `invoices` set back to `true` from the browser console, the other placement), both at 1280 px
      light; `slice3-q7-foot-wide.png`, `slice3-q7-foot-handheld.png` and
      `slice3-q7-comp-in-menu.png` (the ⋮ open on "Bill 2" showing Comp the bill).

### LOOK fixes F2, F5, F7 (2026-10-31)

**F2, a presented bill's foot read "Total €0.00".** Cause: the till reads a bill's lines with `GET /api/working-orders/:id/lines`; the server refuses that for any bill that is not open (`readTabLines` → `assertTabOpen`, `tab.not_open`), `#loadTabLines` sets the lines to `[]`, so the foot added up nothing. A paid bill had the same fault (LOOK picture `k6`). Fix: `#savedTotal()` in `till-table-order-screen.ts` — for a bill that is not open, the foot takes the bill's `total` from the bills read; an open bill keeps adding its lines; unsent lines are still added in both. Tests: `.panel-footer.test.ts` "shows a presented / paid bill's own total, read with no lines …" (2 rows); `till-app-bill-payments.test.ts` `A803 LOOK F2` (2 rows). RED 2 + 2 failed, `expected '€0.00' to be '€7.80'`. Controls: old stored total put back → 4 failed; only presented bills read the list → 2 failed (paid rows).

**F5, the ⋮ offered actions a paid or presented bill cannot take.** The bill section drew Split by item, Transfer items and Merge bills always. Server receipts (`apps/server/src/bill-actions.ts`): `splitBill` calls `refuseClosedBill` (`:172`, function `:88`) → `bill.paid` / `bill.presented`; `mergeBills` (`:215`) and `transferItems` (`:288`) go through `requireUntouchedPair` → `refuseTouched` (`:152`). Run: `party-bill-actions.test.ts` presented/paid refusal rows for split, merge, transfer: 18 passed. Kept (server accepts): Name this bill, Move this bill on a presented bill, Full invoice on a presented bill with no invoice number, Receipt copy, Cancel and credit. Fix: the three are drawn only while `shown.status === "open"`. Tests `.table-menu.test.ts` `A803 LOOK F5`: paid and presented offer none of the three (2 rows); paid keeps exactly Name this bill + Receipt copy; presented keeps exactly Name this bill, Move this bill, Full invoice, Cancel and credit; an open bill holding a payment keeps Split by item. RED 4 failed / 1 passed. Controls: gate removed → 4; hidden only on paid → 2 (presented rows); also hidden with a payment → 1 (Split-kept case).

**F7, focus after Full invoice.** Cause: the opening control is disabled while the till reads the delivery choices (`busy` includes `invoiceRecipientReading`), so focus dropped before the window opened and `wt-dialog` handed focus to the first control it found. The ⋮ steps' `#refocusMenu` covers screen-owned windows; this window is the app's, so the fix follows the kitchen note window's `returnFocus` precedent: `#onChooseBillInvoice` remembers the screen and the tapped control (the ⋮ if focus is inside `[data-table-menu]`, else the pay area's Full invoice); `#returnInvoiceFocus` after a closing save and after Cancel focuses it, or the ⋮ when it is gone. Tests `till-app-bill-payments.test.ts` `A803 LOOK F7` (5 cases; the delivery read answers a task later, which reproduces the bug). RED 5 failed. Controls F7-a (no return on Cancel) 2, F7-b (none on save) 3, F7-c (pay-area button not remembered) 2, F7-d (no fallback) 1. Limit: the two ⋮ cases cannot tell "remembered" from "fell back", both end on the ⋮.

Fixtures grown: none. No existing assertion changed. Runs: `src/screens` 168 files 4085; 12 app files 3219; typecheck, prettier, eslint clean.

### LOOK fix F3 and fix review 2 answers (2026-10-31)

Answered on top of `fdbfbee5c` (commit `4c61436c1`, cherry-picked as `85dac91d2`). **F3:** the take-over banner after only viewing Marta's bill came from `DraftSync.flush`, which answers `draft.taken_over` whenever another person holds the bill, even with nothing of this till's own to save. The waiter's leave points read that answer as a lost change. The same answer also blocked the bill switcher away from another person's draft. The quiet Cash tap and `dab161689`'s save before a preview played no part: an app probe gave the banner with 0 saves with and without the tap. Both predate the branch (the flush answer since `c9ad7a634`; reproduced at `a90f4f87b`, including the old Take payment switch) and this slice's switcher reaches them. Fixed at the seven leave points (Back to floor, the Floor button, opening another party's table, opening the party's other table, choosing another bill, opening the chosen bill's draft, and + New bill, which saves through the same `#flushBeforeSwitch`; "six" until the LOOK fix review counted + New bill): there a taken-over answer with no edit of this till's own waiting (`DraftSync.ownEditWaiting`: unsent, being saved, or kept aside) is nothing lost — no banner, and the switch goes ahead. Payment paths keep the old answer. New cases in `-bill-payments.test.ts`: `:2882` (two rows), `:2923`, `:2948`; in `-drafts.test.ts`: `:4912` (an edit that was taken over is still said). **Review 2 M1:** `:2805`, the waiter's own dish read in while the dialog is open, then Continue: no preview, the sentence. `:2816`, another person's draft as the only unsent dishes (the store is emptied after the read, because the real sync loads their draft into the store too): no preview, the sentence. **M2:** the dialog takes down the unsent sentence it put up once the bill on screen has no unsent dishes (`:2833`). **M3:** no code — the server refuses a draft save on a presented bill and writes nothing (`order-drafts.db.test.ts` "refuses new saves, edits and takeovers on a %s bill", an `it.each` of three rows: the placed row alone `Tests 1 passed | 299 skipped`, all three `Tests 3 passed | 297 skipped`, run again 2026-10-31 for the LOOK fix review, which found "3 passed" given for the placed row; fails with the `bill.presented` check in `parties.ts` removed). **RED** at `fdbfbee5c`: 5 failed (M1 cases and the drafts case pass — they pin behaviour the old code had). **GREEN:** 12 app files + `state/draft-sync.test.ts`, 13 files, 3311 passed. Typecheck, prettier, eslint exit 0. **Controls:** each leave point fails its own case (`:2914`, `:2918`, `:2944`, `:2962`, `:2963`); D1 fails `:2812` on a sent preview; ignoring other drafts fails `:2830` on its sentence (no preview either way, since the save before a preview is refused while Luis holds the bill); M2 unfixed fails `:2847`; "nothing lost" ignoring the waiter's own edit fails `-drafts.test.ts:4924`. Not fixed: `#switchProfile` would show "draft replaced" in the same state (read, not run). No existing assertion changed, no string added. (Line numbers are from the fixer's tree before the cherry-pick beside the F2/F5/F7 commit.)

### LOOK fix F1 (2026-10-31)

**F1, a bill another till merged or moved away was never noticed, and a dish rung on it vanished.** Cause: the till has no push from the server (no `EventSource` or `WebSocket` in `apps/till/src`), and `#loadPartyBills`, whose answer `#followBillsRead` checks under D11 rule 3, ran only after this till's own actions. A draft save naming the merged bill was refused `tab.not_open` (`bill.other_party` once moved to another table), and `#onDraftRefused` and the send path turned that into "Could not update the table, try again". Where the Bread went, from temporary probes (not committed): on the old code the dish stayed on screen under the red banner; after Back to floor and reopening table 1, Bill 1 showed no dish and no review list while the page's unsaved-changes guard stayed dirty (true; false with nothing rung): the dish was kept only in this page's memory, under the merged bill's key, which no screen shows once the floor names Bill 1. On the server (`order-drafts.db.test.ts`, `saveDraft` called directly), after `mergeBills` Bill 2 is `abandoned` and a first save naming it is refused `tab.not_open` with every table unchanged; the same save before the merge is written. Fix (`till-app.ts`): the 15-second draft timer also re-reads the party's bills (`#rereadBillsOnTimer`) while the table screen is in front and the page is visible; a save refused `tab.not_open`/`bill.other_party` (`BILL_LEFT_REFUSALS`) for the bill on screen re-reads them at once (`#followLeftBill`), and the refusal is said only if that read still shows the bill or fails; Send all returns quietly on those two refusals (but not, until the LOOK fix review's m2, when its save was still out as the timer's read moved the screen: see below). `#followBillsRead` then moves the screen, shows `[data-bill-gone]`, and carries the unsaved lines for review (Discard changes / Update the order) as Task 8d built it. Tests `till-app-parties.test.ts` `A803 bill gone` → `LOOK F1` (9 cases): refused save, merged and moved (2 rows, including Update the order then saving Flan ×2 on Bill 1); failed bills read keeps the dish and says `table.error`; Send all before the save; the timer with nothing rung, merged and moved (2 rows); no read while the page is hidden, then the switch once shown; no read on a handheld's floor tab; no read after sign-out. RED (till-app.ts at `fdbfbee5c`) 6 failed / 3 passed, `expected 'wo-check' to be 'wo-4'`; the 3 that pass assert that nothing happens and rest on the controls. GREEN 9 passed. Controls over the block's 18 cases: timer read removed → 3 (both timer rows, hidden-page case); hidden check removed → hidden-page case (`expected 2 to be 1`); screen-in-front check removed → handheld case (`expected 2 to be 1`); save-refusal branch removed → 3 (both refused-save rows, Send all); Send all's quiet return removed → Send all ("Could not update the table, try again"); the refusal after a read that still shows the bill removed → failed-read case; `bill.other_party` dropped → moved refused-save row. The timer read's signed-in and same-party checks turn nothing red: sign-out clears the draft first, which stops the timer, and no case fires the timer while the draft's party and the screen's differ.

Not fixed: a window focus or the page becoming visible again re-reads the draft but not the bills, so the switch can wait up to 15 seconds after the till is picked up. Fixtures grown: none. No existing assertion changed; no new wording. Runs: till-app-parties, -drafts, -bill-payments, -open-table 1386 passed; 16 other till-app suites reading bills or drafts 2390 passed; typecheck, prettier, eslint clean. Commit `cc7620a72`.

### LOOK fix review answers (2026-10-31, a803-3-reviews/look-fixes.md)

Answered on top of `854a01aa1` in two commits: the code (`78f476d90`) and these records, the guides and the backlog. No existing assertion changed; no new wording. RED is `till-app.ts` and `till-table-order-screen.ts` at `854a01aa1` (copied aside with `mktemp -d`, put back after).

**I1, a failed 15-second bills read emptied the screen's bills.** `#loadPartyBills` set `partyBills = []` on any failed read (since `47d826d25`, #816); F1's timer made that a background event with nobody to say why: the switcher lost its rows, the ⋮ its bill section, and a presented bill's foot fell back to €0.00. Fix: `#loadPartyBills(balance, follow, background)`; a `background` read (the timer's, `#rereadBillsOnTimer`, and the refusal path's, `#followLeftBill`) keeps the last list when it fails. Every caller after the waiter's own action keeps the old behaviour. The F1 refusal read is a background read too: on a failed read it still keeps the dish and says `table.error`, and now the switcher keeps its rows as well, since emptying the list beside a banner that says only "could not update" would show a table with no bills. Tests in `till-app-parties.test.ts` "LOOK fix review": a failed timer read on a presented Bill 2 leaves `{ total €7.80, 2 ⋮ bill items, 2 switcher rows }` and no banner; a failed timer read leaves 2 rows and the next good read still follows a merged-away Bill 2 ("Bill 2 is no longer at this table. Now showing Bill 1."); a refused save whose read fails keeps 2 rows and says `table.error`. RED 3 failed, `expected { total: '€0.00', billItems: +0, …(1) } to deeply equal { total: '€7.80', billItems: 2, …(1) }` and `expected +0 to be 2` (×2). Control: keep-on-failure removed → those 3.

**m1, the timer could answer inside this till's own Move this bill.** Fix: `#ownBillsChange` wraps this till's own Move guests, Move this bill, Join a table, Split a table, Merge bills, Transfer items and Split by item (the listeners, and the different-people confirmation's re-run of the last two). While one is under way a background read is not made (`#ownBillsChanges`), and one sent before it started is set aside when it answers (`#ownBillsStarted`), leaving the list alone and following nothing; the action's own read settles the screen. A refused save inside one makes no read and says nothing (`setAside`). The window covers the whole action, including a dead-end question it asks. (LOOK fix review 2, below: a refused save now follows once the window closes, Move this bill lets go of the window around its dead-end question, and every hold lapses after 150 s.) Merge bills keeps the bill on screen (it merges the other bill into it, by reading `#onMergeBills`) and Split by item chooses its new bill (`#billChosenRead`), so neither could show the wrong line; they are wrapped because the mechanism is shared, and no case covers them. Tests: probe B's shape (14 s, Move this bill to the counter, the floor read held, 1.5 s, release) ends on `wo-4` with no gone line; the same with the timer's read held from before the move and answered `[tabBill]` after it; the same for Split a table with the bill on screen; a dish's save refused `bill.other_party` inside the move reads no bills and says nothing. RED 4 failed: `expected <p class="bill-gone" …(2)></p> to be null` (×3) and `expected 2 to be 1` (the refusal case's bills reads). Controls: the no-start-in-window check removed → the probe-B case and the refused-save case; the answer-time set-aside removed → the held-from-before Move case; the refusal path's `setAside` check removed → the refused-save case; Move this bill not wrapped → its 3 cases; Split a table not wrapped → its case.

**m2, Send all or a bill switch said "Could not update the table, try again" beside the gone line.** Two shapes. Send all's save out when the timer's read dropped the draft answers `"failed"` (the sync has ended); the till now records drafts dropped because their bill left (`#leftBillDrafts`) and Send all returns quietly for one of them. A bill switch's save refused `tab.not_open` before its read answers went through `#flushDraft`'s banner; `#flushDraft` now leaves a refusal `#billLeft` names to `#followLeftBill`, which says it only if the bill is still there. So the F1 record's "Send all returns quietly" now holds for both shapes. (LOOK fix review 2, below: the commit message's "Nothing was lost (the dishes are kept for review)" held only when a bill was left to show and the lines could be moved to it; with no bill left the dish was lost with no word. Send all is now quiet only when the lines were kept for review.) Tests: probe F's shape (Flan rung on Bill 2, save held, Send all, merge, 15 s, save refused) and a switch whose save is refused with the bills read answering 30 ms later both pass `expectSwitchedKeepingFlan` (screen on Bill 1, gone line, Flan kept for review, nothing sent, no `table.error`). RED 2 failed, `expected 'Could not update the table, try again' not to contain 'Could not update the table, try again'`. Note: with the bills read answering at once the switch case passed on old code (the follow dropped the draft before `#flushDraft` looked), so the case holds the read 30 ms. Controls: Send all's left-draft return removed → the Send all case; `#flushDraft`'s `#billLeft` check removed → the switch case.

**m4, an open bill holding a payment offered Transfer items and Merge bills.** Server receipt: `requireUntouchedPair` (`apps/server/src/bill-actions.ts`) refuses `bill.payments_received` for either bill; `splitBill` checks only `refuseClosedBill`, so a partly paid bill splits. The merge and transfer target lists already leave out bills holding a payment (`#otherBills`). Fix (`till-table-order-screen.ts`): a bill holding a payment draws Split by item alone. Tests `.table-menu.test.ts` `A803 LOOK F5`: an open bill holding a payment offers no Transfer items or Merge bills and keeps Split by item; an open bill with no payment beside one that has a payment keeps both. RED 1 failed, `expected <wt-button …(5)></wt-button> to be null`. Controls: gate removed → the first; Split hidden too → it and "keeps Split by item"; gate on any bill of the party holding a payment → the second. A1262 deleted from the backlog, the A803 entry and the PR text.

**m3:** not changed; filed as A1266 (the payment window stays on a gone bill; an unanswered card payment's view leaves the screen) and listed in the PR's follow-ups.

**m5:** EN and ES `{#bill-switcher}` say the switch comes within about 15 seconds («en unos 15 segundos como mucho»).

**m6:** the F7 comment (`#onChooseBillInvoice`) no longer says the tapped control is read from focus unconditionally: it is taken from the screen's focus where the tap put it there, otherwise focus goes back to the ⋮. Whether a tap focuses a button on Safari was not run. The F3 record now says seven leave points, and its M3 count names the `it.each` rows; the F1 record points here for Send all. A1263 says seven too.

**GREEN:** the 6 named files (`till-app-parties`, `-drafts`, `-bill-payments`, `-open-table`, `.table-menu`, `.panel-footer`) `Tests 1492 passed`; the other 37 `till-app*` files `3160 passed`; all 82 `src/screens/till-table-order-screen*` files `1645 passed`; typecheck exit 0; prettier and eslint on the changed code files exit 0; `apps/server` `guide-content.test.ts` `Tests 35 passed`; `scripts/guide-links.test.ts` `Tests 12 passed`.

### LOOK fix review 2 answers (2026-10-31, a803-3-reviews/look-fixes-2.md)

Answered on top of `4936052ee`. RED is `till-app.ts` at `4936052ee` (copied aside with `mktemp -d`, put back after). No existing assertion changed; no new wording. One test helper grew an argument: `onBillTwoMergedLater` in `till-app-parties.test.ts` takes extra API fakes.

**I1, the own-change window could stay open for good.** Root: `#openDeadEnds` kept one reply slot, so a second dead-end question left the first caller waiting for ever (the slot is from `c8487cba5`; the lock-up came with `78f476d90`'s window). Fix: a question still waiting when another opens is answered `null`, the answer Cancel gives. Every caller was read: `#askCounterDeadEnds` and `#askStoredDeadEnds` return false on `null`, and each of their callers (the counter Pay and card re-checks, Place, Park, the counter bill's Pay, the check before the tender, Move this bill, moving a counter order to a table, and the bill's Pay preview) then sends nothing more; read, and run for the check before the tender. Then the window itself: `#ownBillsChange` now hands the action a hold (`take`/`release`). Move this bill, the one wrapped action that asks the waiter anything (the different-people confirmation ends the wrapped call before it asks), lets go of the hold around its dead-end check, question included, and takes it again after; taking it again counts as a new start, so a read sent meanwhile is set aside when it answers. Every hold lapses `TABLE_REQUEST_LIMIT_MS` (150 s, the till's bound on a request it limits) after it is taken, so a request with no answer cannot hold background reads back for good. Why this design: keeping only the answer-time set-aside does not answer m1, because the review's own control (the no-start check removed) turns the probe-B case and the refused-save case red; scoping the window to each of the seven actions' requests would touch all seven, where only Move this bill waits on the waiter. Limit: once a hold has lapsed, a request answering later runs its own reads with the window open, so the timer could again say "no longer at this table" about the bill this till moved; not tested. While a question is on screen and the screen follows a bill merged away, the question stays up; Continue then sends nothing (tested), Cancel nothing. Tests: `till-app-parties.test.ts` "LOOK fix review 2": probe P4's shape (two Move this bill, one cancel, another till merges Bill 2, 15 s → `wo-4`, the gone line, no `moveBill`); a question left on screen while another till merges Bill 2 → the 15-second read follows, then Continue sends no `setMakeAt` and no `moveBill`; a `moveBill` with no answer → no bills read at 15 s, the follow after 150 s more. `till-app.test.ts`: a counter question a second one replaces settles `false`, and nothing is recorded.

**I2, Send all quiet for a dish that was lost.** `#followBillsRead` now records, for each draft it drops, whether `#carryCandidate` moved its unsaved lines to the bill now shown (`#carryCandidate` answers that). Send all returns quietly only when they were moved; otherwise it says `table.error` as before `78f476d90`. The refusal path (`#followLeftBill`, from F1) had the same gap: a dish refused on a merged bill with no bill left was dropped with only the gone line. It now says the refusal when the read drops the draft without keeping its lines. The second way in the review named (the bill now shown already holds kept lines, so `#carryCandidate` gives up) takes the same branch; no case covers it. The 15-second timer finding no bill left while a dish is unsaved still drops it with only the gone line (by reading, not run): filed as A1267. Tests: probe P5's shape (Send all, save held, bills read `[]`, save refused) → screen on no bill, "Bill 2 is no longer at this table.", no submission, banner `table.error`; a dish refused on a merged bill with the read answering `[]` → banner `table.error`.

**m1, a refusal inside an own change said nothing.** After the I1 change the window no longer covers a question on screen, so a refusal then follows at once. Inside the window a refusal whose bills read is not made, or is set aside, is kept (`#leftBillWaiting`) and followed when the last hold is let go (the action ends, or the hold lapses), if the draft and the bill on screen are unchanged; otherwise the action's own reads have moved the screen. A bill switch refused `tab.not_open` reaches the same path through `#onDraftRefused`; no separate case. Test: Move this bill out with no answer, another till merges Bill 2, a dish's save refused `tab.not_open` → no bills read and the screen stays on `wo-check`; the move then fails → `wo-4`, the gone line, Flan kept for review.

**m2:** the not-made read now answers `read: -1`, which no read's number equals, instead of the current number. No case can see it: no caller reads that field from a not-made read today.

**m3:** no behaviour change. The commit message of `78f476d90` and the `#loadPartyBills` comment called a background read "one no action of the waiter's asked for"; the refused-save read follows a dish the waiter rang. The comment now says what a background read is: a check that the bill on screen is still there, not a read after this till's own change to the bills.

**RED** (`till-app.ts` at `4936052ee`): `till-app-parties.test.ts -t "LOOK fix review 2"` `Tests 6 failed | 641 skipped (647)`: the four I1/m1 cases `expected 'wo-check' to be 'wo-4'`, the two I2 cases `Cannot read properties of null (reading 'textContent')` at the banner check (no banner). `till-app.test.ts -t "a second question replaces"` `Tests 1 failed | 1122 skipped (1123)`, `expected "vi.fn()" to be called once with arguments: [ false ]`.

**GREEN:** `till-app-parties`, `-drafts`, `-bill-payments`, `-open-table`, `till-app.test.ts` and `-boot-and-counter` (the last two hold the dead-end question cases) `Tests 2947 passed (2947)`; the other 35 `till-app*` files `1630 passed`; all 82 `src/screens/till-table-order-screen*` files `1645 passed`; typecheck exit 0; prettier and eslint on the three changed code files exit 0.

**Controls** (each over the LOOK F1 and both LOOK fix review blocks plus the counter case): the displaced-question answer removed → only the counter case (P4 passes on the hold release alone); no release before the question → the question-on-screen case; no lapse → the no-answer case; no take after the question → the two m1 cases from `78f476d90` (the read inside the move, the refused save inside it), the no-answer case and the new m1 case; no follow when the last hold is let go → the new m1 case; Send all quiet for any dropped draft → the I2 Send all case; the refusal path quiet when lines were lost → the I2 refusal case; `#carryCandidate` answering false when it moved the lines → four cases (F1's refused merged-away row and its Send all case, and both m2 cases from `78f476d90`).

## Task 16: backlog, questions, PR text, hand-off (≈25 calls)

- [x] Task 9 review M4 (keyboard of the shared `wt-row-actions`: no arrow keys in a `role="menu"`,
      focus dropped to the page after a choice, no `aria-haspopup`) was not fixed in this slice: the
      primitive predates it and the counter-zone menu shares it. Filed as A1256 in
      `docs/backlog/dashboard.md` (and `docs/backlog.md` beside A781) with the review's experiment.
      List it in the PR as known and not this slice's.
- [x] `docs/backlog.md` A803 entry (`:1983-2000`): remove the switcher, kebab, no-Hold, quiet-Pay,
      Full invoice and main-bill clauses; slices 4 and 6 remain. Delete: A1232 (`:2025-2030`, Task
      5), A1233 (`:2032-2036`, Task 9/10), A1234 (`:2038-2042`, Task 10), A786 (`:2323-2326`, D7),
      the `party.main_bill_stays` wording point (`:2944-2945`, `docs/backlog/till.md:899-900`) and
      the "Keep separate bills wraps" point (`:2960`, `docs/backlog/till.md:920-921`). **Keep** the
      duplicate Full invoice entry (`:2488-2492`) until Owner question 3 is answered, its next action
      updated to "owner to pick between the two pictures" with links to the Task 15 PNGs. Keep and
      list in the PR as not this slice's: A1235, A1236, A1237, A1238. New entries, numbered from
      `~/waitron-campaign-shared/next-item-number` (read, use, write back): Refund from the ⋮ if Owner
      question 4 is answered "yes"; the paid-bill Full invoice once A802 has a till entry (Owner
      question 2); A739 Cut B to put the wide screen's pay controls behind one Pay button (D16, Owner
      question 7), as a line in A739's entry rather than a new item if A739's entry already says it.
- [x] `questions.md`: one section for Owner questions 1, 2, 3, 4, 6 and 7, one at a time with its
      default and its pictures, headed "A803 slice 3 (#PR) — six questions; the build used the
      defaults; the PR waits for 1, 5 and 7"; and the FYI section the owner's rule asks for, headed
      "A803 slice 3 (#PR) — changed test checks, FYI, no answer needed", pointing at the PR's
      "Changed test checks" section.
- [x] Changed-checks receipt outside product source, attached to the PR: every row above with its
      red and green output, plus any found at red runs, and a statement that F and H2 are
      byte-unedited and the Filing files and `scripts/`-level files changed only as Owner question 5
      says.
- [x] PR title: "One bill switcher and one ⋮ at a table; no main bill (A803 slice 3; venue reset
      needed)". First line: "Needs a venue reset: the migration rebuilds `parties` to drop the main
      bill, and fails on any box that has ever seated a party." Then, in plain English: what a waiter
      sees; that joins and moves never merge bills now and Merge bills does it on purpose; that a
      table whose party was made by Move, Split or Join opens on its lowest-numbered owing bill,
      which may be a presented one (Task 6b's note); the seven
      owner questions and their defaults; the seven Spanish proposals and the ES guide section; a
      "Changed test checks" section; Owner question 5's items with their before and after; the LOOK
      screenshots; the deletion controls of Task 13; that F and H2 ran unedited.
- [x] PR text, Task 7 corrections (Task 7 review, Minors 1 and 2; the commit body is not
      rewritten): (1) the commit body's "Every party keeps … its tables in party_tables after it
      closes" is wrong: closing a party deletes its `party_tables` rows (`closePartyTables`,
      `apps/server/src/parties.ts:793-797`); a closed party stays named by its bills
      (`working_orders`, `bill_identities`) and, after a combine, by the party it joined (from
      reading, not a run). (2) Both outcomes of the migration on an unreset box, with the review's
      run as receipt: where any party has a refusing child (`working_orders`, `bill_identities`,
      `party_tables`, `order_drafts`, `order_groups`, `order_group_events`, `unpaid_departures`,
      `parties.merged_into_party_id`) the `DROP TABLE parties` is refused, the whole core set rolls
      back, rows stay and the box stays at `0200`; where no party has one, it migrates and the
      cascade silently deletes those parties' `party_allergy`, `order_kitchen_notes` and
      `service_step_completions` rows (measured 1 → 0). The reset is required either way
      (pre-live, root `CLAUDE.md` §3).
- [x] Overlap note in the PR: lane E's `feat/a696-startup-zone-validation` changes other functions
      of `bill-actions.ts`, `till-api.ts`, `working-order.ts` and till `strings.ts`; whoever lands
      second rebases. A739 Cut B will rebuild the pay section this slice edits (D5, D6, D8, D16).
- [ ] **Landing gate.** Not fiscal code: no sale, invoice number, receipt, `registros_facturacion`,
      `computeHuella`, chain or alta builder changes; F and H2 unedited. But it edits two filing
      tests and `scripts/`-level guards on Owner question 5's default, so the lane's queue entry
      goes to `needs-owner-review` and the PR is **not landed until the owner has answered Owner
      questions 1, 5, 5b and 7** and CI is green on the current head. A different answer is built as
      a follow-up task on this branch before landing.
- [ ] Ledger `Status: done` for the build (parked for the owner); tell the owner the branch is ready
      for `finish-branch`.

### Task 16 as done (2026-10-31)

Backlog commit `2ce0a3247`. Deleted: A1233, A1234, A786, and the `party.main_bill_stays` wording and
"Keep separate bills" loose ends (`docs/backlog.md`, `docs/backlog/till.md`); A1232 was already gone
(Task 5). The A803 entry keeps slices 4 and 6 and names slice 3's follow-ups. Kept: the two Full
invoice buttons entry, now pointing at the Q3 pictures. Edited: A1256 (both files; LOOK F6), A739
(a line: its window replaces the foot's pay controls, D16, Q7), A797 (slice 3 has landed, #PR). New,
from the counter (A1261 read, A1266 written back): A1261 paid-bill Full invoice after A802 (Q2),
A1262 Transfer items / Merge bills on an open bill holding a payment, A1263 `#switchProfile`, A1264
bills not re-read on focus or visibility, A1265 the ⋮ list taller than the room below it (LOOK F8;
A1258 is about resizing, so not its home). Nothing for Q4 (conditional on "yes"). Questions 1, 2, 3,
4, 6, 7 and the changed-checks FYI appended to lane C's `questions.md`; the receipt is
`~/waitron-campaign-c/a803-3-changed-checks.md` and the PR text `~/waitron-campaign-c/a803-3-pr-description.md`,
both with "#PR" for the number.

## Against the master plan's slice 3

| Master plan item | Where |
| --- | --- |
| `TableParty` without `mainBillId`; explicit `billId` for orders | Tasks 6c, 8c (D7), finding 1 |
| POST `/api/parties/:id/bills`, `createPartyBill` (server and client) | Tasks 1, 8a (Departures: returns the revision) |
| join/move drop `bills`; incoming bills stay separate | Tasks 2, 3a, 4b, 8a, 8b |
| split accepts any eligible bill; `billId` answer; explicit empty bill | Task 4a (D1) |
| `MoveBillResult {partyId, billId}`; `TableActionResult {partyId, billIds}`; `CombineResult` | Tasks 2, 4a, 4b (Departures) |
| kept selection, else lowest numbered; empty party gets one bill in the same transaction | D1, D11; Tasks 4a, 8a, 8d |
| `A803 switcher` (incl. "if it disappears … never submit to a hidden fallback") | Tasks 8d (the rule and its cases), 9 |
| `A803 single menu` (rename, Move dishes pending as Split by item/Transfer items, Merge, Move, Full invoice, Refund; table items) | Task 10 (Refund: Owner question 4) |
| `A803 pay scope` | Tasks 11c, 12 (Departures: D16, Owner question 7) |
| `A803 invoice entry` | Tasks 10, 12 (Departures: not in `bill-pay-dialog`) |
| `A803 no main bill` (server) | Tasks 2, 3a, 6b, 6c |
| `A803 action results` (server, client, app; selected id = next request's id) | Tasks 4a, 8a, 8d |
| remove main-bill consumers incl. error registry and prose; strict explicit Merge | Tasks 3b, 4a, 6b, 6c, 7, 8b, 8d, 14 (D12, D14) |
| remove implicit-bill-merge mapping consumers | Task 3b |
| GREEN files, S, F, G; `bill-switcher.a11y.test.ts` | Tasks 9–13 (`…bill-controls.a11y.test.ts`) |
| EN/ES guides, design-system contract, LOOK | Tasks 14, 15 |

## Task list and sizes

| Task | What | Est. calls | Ends |
| --- | --- | --- | --- |
| 0 | preflight; Owner question 5 to `questions.md` | 15 | no commit |
| 1 | `createPartyBill`, `insertPartyBill`, route | 45 | green |
| 2 | Move this bill never merges (`bills` optional, unread) | 55 | green |
| 3a | Join/Move guests keep every bill; filing setup (Q5 1) | 65 | green |
| 3b | merge helpers and slip map retired (Q5 6a) | 30 | green |
| 4a | answers name bills; split any bill; D1 creation; code retired | 65 | green |
| 4b | `bills` and `merged` deleted, mechanical sweep (Q5 2) | 45 | green |
| 5 | bills in number order (A1232) | 25 | green |
| 6a | test helpers find bills by number | 50 | green |
| 6b | table actions stop the main bill | 60 | green |
| 6c | seating stops it; `openingBillId` | 65 | green |
| 7 | migration; guards (Q5 3–5) | 45 | green |
| 8a | table screen: no question; answers; `billToShow`; client | 60 | green |
| 8b | floor/parked orders: no question; dialog and `bills` gone (Q5 6b) | 50 | green |
| 8c | `mainBillId` → `openingBillId` rename in the till | 35 | green |
| 8d | opening bill; vanished-bill rule; follow after move | 65 | green |
| 9 | switcher, + New bill | 65 | green |
| 10 | ⋮ menu (drawer and foot copies kept) | 65 | green |
| 11a | screen tests off the drawer | 60 | green |
| 11b | app tests and helpers off the drawer | 55 | green |
| 11c | Tab button, drawer, badge go; foot totals | 55 | green |
| 12 | foot: no Hold, quiet Pay, one Full invoice, Comp out | 65 | green |
| 13 | whole-slice run, deletion controls | 45 | no commit |
| 14 | guides, design contract | 35 | green |
| 15 | LOOK, owner pictures | 50 | pictures committed in 16 |
| 16 | backlog, questions, PR, parking | 25 | green |

## Review answers (review-1)

Review: `/Users/clintongormley/waitron-campaign-c/a803-3-plan-review/review-1.md` at `6357096d6`.
What I ran while revising is named in each answer; everything else was read.

- **C1 (filing tests and `scripts/` guards need the owner).** Agreed. The rule text is restated in
  "Owner decisions" (it now names `scripts/` guards and deleted checks). Owner question 5 is
  rewritten as one `questions.md` entry, drafted word for word in Task 0, written there before any
  named file is edited, covering every such file with its before and after: `move-merge.filing.test.ts`
  (and its `:215` helper line), `order-portions.filing.test.ts:1159`, `scripts/behavioural-triggers.test.ts`,
  `scripts/migration-upgrade.test.ts` `RESETS`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`
  (included because it sits under a `scripts/` folder), and two deleted-check items
  (`moved-slips.test.ts:108`/`:116`, the bill-choice dialog's two test files). Re-check run:
  `rg -l '<the slice's identifiers>' apps packages -g '*filing*' -g '*fiscal*' …` printed the two
  filing files plus four fiscal files that match only the words "join"/"merged" in other senses
  (`recovery-operation.fiscal.test.ts:76` `"master/join-1"`, `first-fiscal-setup.e2e.test.ts:179`
  `merged` env); `rg -l 'main_bill|mainBill|…' scripts` printed `behavioural-triggers.test.ts` and
  `schema-constraints.test.ts`, and the latter lists no `main_bill_id` key (`rg -n '"parties"'` on
  it), so it is untouched. Task 0 re-runs these. The build goes ahead on the default; Task 16's
  landing gate parks the PR until questions 1, 5 and 7 are answered; the build-may-just-edit
  wording is gone. Cuts that avoid the files: none is equally strict. Each filing file is now
  edited in one task only (`move-merge.filing` in 3a, `order-portions.filing` in 4b), but not
  edited at all would need either the merge-on-join behaviour the spec retires or a `bills` option
  kept alive and ignored forever. Sparing the guards would mean keeping the `main_bill_id` column,
  which leaves it typed and writable, so "nothing picks a bill for you" would rest on review alone;
  that alternative is offered to the owner in the question instead.
- **I1 (Task 2 cannot typecheck).** Confirmed by `rg -n '\bisUntouched\b|…' apps/server/src` (callers
  at `table-actions.ts:15`, `:280-281`) and `apps/server/tsconfig.json` `include: ["src", "test",
  "scripts"]`. Task 2 now keeps `isUntouched`/`readBillState` (deleted in new Task 3b), makes
  `bills` optional and unread, and keeps `merged` always false; Task 4b deletes both with the sweep.
- **I2 (Task 4 too large).** Split into 4a (answers, D1 creation, split any bill, error code) and
  4b (`bills` and `merged` deletion, scripted sweep with its own GREEN). Re-count: 61 files, 196
  literal sites (`rg -c … | awk`), recorded in the counts.
- **I3 (the bill on screen vanishing).** D11 rewritten into four rules; rule 3 covers a bills read
  without the bill on screen and a stale `openingBillId`; rule 4 says what is never written. New
  strings `table.bill_gone`/`_none` (Owner question 1). Cases: Task 8d `A803 bill gone` 1–6, Task 9
  "closed label names the bill now shown", Task 13 controls 9 and 10, LOOK step.
- **I4 (who creates a bill).** The till never creates one by itself; only + New bill asks (D1). The
  server creates one only inside Join, Move guests and Split a table (master plan). Opening a table
  writes nothing. "Back to the floor when the moved bill was the party's last" is kept: its
  assertions are unchanged, only its event loses `bills` (kind F row). The two-till + New bill
  collision has a Task 9 case. Departures row for the master plan's "explicitly create".
- **I5 (double revision move).** New `insertPartyBill` never moves the revision; `createPartyBill`
  wraps it; Task 6a's helper reproduces `partyMainBill`'s `"move"`/`"moved"` handling exactly
  (read at `group-submit-fixture.ts:27-36`, `:52-55`; `parties.ts:186-193`), and the
  existing-open-bill difference has an expected kind-S row instead of a blanket stop.
  `party-main-bill.test.ts:157` and `:356-358` (read) must stay green unedited at 6a.
- **I6 (unannounced red stretches).** Every task now ends green with both typechecks clean (task
  table). Task 10 keeps the drawer's and foot's copies; 11a/11b re-point tests while the drawer
  exists; 11c removes it. Task 8c is a pure rename (`mainBillId:` → `openingBillId:`) before 8d
  changes behaviour. Task 6 is split into 6b (action writers) and 6c (seating, floor) so each
  half's assertions move with its writers. "Execution" states the server/till wire gap and that
  nothing is pushed before 8d.
- **I7 (to-serve count).** Board 13 is not silent ("Sent, To serve, Served … the panel's Sent box
  under A773"); the Sent summary (`sent-orders.ts:727-754`, read) already shows ready/firing/held/
  served on every width. D17; badge rows re-pointed kind R in 11c; new `A803 to serve` case.
- **I8 (the foot).** Read the foot on main (`till-table-order-screen.ts:2481-2497`, `:4053-4168`,
  `:2231-2251`), spec §3.5, boards 12/13 and A739's addendum. D16: totals, then today's pay controls
  until A739; Hold and tender-pay's Full invoice go; Comp the bill moves to the ⋮. The handheld's
  existing one-Pay sheet was considered for every width and rejected as a money-path change.
  Departures row; Owner question 7 with a worked example and Task 15 pictures; Task 12 asserts the
  foot's exact contents in three layouts; added to the landing gate.
- **Minor 1.** Rows added for `till-api.zone-closed` (four), `order-kitchen-note.moves` (two),
  `adjustments-report`, `attendance-draft-events`, `till-api.drafts`, `tabs`, `print-problems`,
  `moved-slips`, and `split-bill.test.ts:539`/`:1019` (read each with `rg -n`/`sed`).
- **Minor 2.** Task 3b retires `SlipsLater.mergedInto` and `enqueueMovedSlipsFor`'s parameter
  (`rg -n mergedInto apps/server/src`: only writer `table-actions.ts:224-226`); Departures row.
- **Minor 3.** `#moveCounterWithAllergy` `:14968`, caller `:15260` (`rg -n`) in Task 8b, with the
  `"merge" \| "separate"` search in its GREEN.
- **Minor 4.** `apps/till/test/bill-pay-app.ts` in Task 11b's files.
- **Minor 5.** Task 15 saves pictures of both placements; Owner question 3 carries them; the backlog
  entry stays until answered (Task 16).
- **Minor 6.** The payment step's Full invoice takes D8's gate; `git blame` shows the old gate
  predates the branch (`86782eacf`, `ed7e082ca`); server refusal read at `working-order.ts:4384-4392`;
  Task 10 and 12 cases.
- **Minor 7.** Venue-reset wording and PR first line now say "any box that has ever seated a party";
  Task 7 confirms it from the guard's own output.
- **Minor 8.** Tasks 2 and 3a write and run the new cases red before the helpers lose `bills`
  (which now happens only in 4b).
- **Minor 9.** D2/D4 state the no-party screen (no switcher; today's no-party menu items); a Task 10
  case pins it (read `:5446-5486`, `:5492-5494`).
- **Minor 10.** D5 names A773's Take over draft as the in-place step for another person's dishes
  (read `:3047-3069`); a Task 12 case asserts it is on the screen.
- **Minor 11.** Task 9 asserts + New bill is the last item with one bill and with three.

No finding was rejected.
