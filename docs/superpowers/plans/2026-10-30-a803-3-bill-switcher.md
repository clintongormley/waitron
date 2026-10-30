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

None yet. The defaults under "Owner questions" are what the build uses. **Question 5 (test and
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

**Spanish.** Five new till strings and one guide section, all **proposals** (Owner question 1):

| Key | English | Proposed Spanish | Built from |
| --- | --- | --- | --- |
| `table.bill_gone` | `{gone} is no longer at this table. Now showing {shown}.` | `{gone} ya no está en esta mesa. Ahora se muestra {shown}.` | `table.take_over_gone` «Este pedido ya no está en esta mesa.» (`strings.ts:3169`); `{gone}`/`{shown}` are the short labels («Cuenta 2») |
| `table.bill_gone_none` | `{gone} is no longer at this table.` | `{gone} ya no está en esta mesa.` | as above, for when no bill is left to show |
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
  against 113–120 ms. The rule matches today's `billToOpen` (`till-app.ts:696-700`: first owing,
  else last) under number order.
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
  survive; never submit to a hidden fallback"; Review focus 4). One rule, `billToShow(kept, read,
  named?)` in `state/bill-state.ts`, used in every place below:
  1. **After this till's Join, Move guests or Split a table**: keep the bill it showed if that id is
     in the answer's `billIds`/the party's bills afterwards; otherwise the bill the answer names
     (split: `billId` when the screen follows the leaving party); otherwise the lowest-numbered
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
| `party-table-actions.test.ts:709-713` (opening order `[ana, luis, second]`) | B | number order `[luis, ana, second]` | A1232 (`docs/backlog.md:2025-2030`), D15 | 5 |
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
| Cases in any group-submit/draft-command user that go red at Task 6a because the main bill was null while another open bill existed (the old helper made a new bill; the new one picks the existing lowest-numbered open bill) | S | the case names the bill the old helper would have made: its setup calls `insertPartyBill` and passes that id; every `expect` byte-identical | D1, I5 | 6a |
| `apps/server/src/party-bill-actions.test.ts:690`, `:736` (merge keeps/moves the main bill) | B | the explicit merge's surviving bill keeps its number; no main bill | §3.4 | 6b |
| `apps/server/src/parties.test.ts`, `till-api.parties.test.ts:807-821`, and any `TableParty`/floor whole-shape pin | W | `mainBillId` → `openingBillId` | D7 | 6c |
| `scripts/behavioural-triggers.test.ts` `EXPECTED_TRIGGERS` (`:158-159`) and `describe("working_orders_release_main_bill")` (`:1544-1590`) | **W, B, Q5 item 3** | the two names leave the list; the describe becomes "the main bill is gone": `parties` has no `main_bill_id` column (`pragma_table_info`) and no trigger's SQL names `main_bill` (`sqlite_master`) | §3.4 | 7 |
| `scripts/migration-upgrade.test.ts` `RESETS` | **W, Q5 item 4** | gains the new core rebuild step, `refused: ["DROP TABLE \`parties\`", "FOREIGN KEY constraint failed"]` (as `:437-439`; the exact text from the run's own output) | finding 9 | 7 |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:119-130` (expectation adapter) | **W, Q5 item 5** | the captured `parties` table's expectation drops the `main_bill_id` column and its foreign key, as the adapter already adds columns; the hashed fixture is not edited | finding 9 | 7 |
| `apps/till/src/api/client.test.ts:2738-2749`, `apps/till/src/i18n/codes.test.ts:323-333`, `apps/till/src/till-app-parties.test.ts:2491`, `:4101` (`party.main_bill_stays`) | B | the code's rows go (no thrower, D14); `codes.test.ts`'s loop keeps its other two codes | §3.4, D14 | 8d |
| `till-app-parties.test.ts:2126`, `:2452`, `:4395`, `:4405`, `:5830`; `till-app-drafts.test.ts:8720` (opening/following the main bill) | B | follow D7/D11: `openingBillId`, kept or lowest-numbered bill | §3.4, Review focus 4 | 8d |
| `till-app-parties.test.ts:3964` ("goes back to the floor when the moved bill was the party's last") | F | **kept**: every assertion unchanged (D11 rule 2); only its emitted event detail loses `bills: "merge"` | D11 | 8b |
| `till-app-parties.test.ts` kept-apart message tests (`table.bills_kept_separate`) and merge-question tests in the table screen | B | no question; the request carries no `bills` | §3.4 bullet 2, §6 | 8a |
| merge-question tests in the floor screen and parked orders, and every other `bills: "merge"` event detail or client argument in till tests | B / F | no question, no `bills` | §3.4 bullet 2, §6 | 8b |
| `apps/till/src/widgets/bill-choice-dialog.test.ts`, `bill-choice-dialog.a11y.test.ts` | **B, Q5 item 6b** (deleted with the widget) | deleted; replaced by the "no question" cases of Tasks 8a/8b, which fail if a question is drawn or `bills` is sent | §3.4 bullet 2 ("The … question goes") | 8b |
| 73 till files' `mainBillId:` lines (fixtures, helpers, three app reads) | F | renamed `openingBillId:` with the same value, mechanically; no assertion changes | D7 | 8c |
| `till-table-order-screen.test.ts:713` ("Table actions" trigger inside the drawer), `:4231` (verb buttons in the menu), `:6704` (Back in the panel) | R | the ⋮ holds the same items; Back returns to `closed` (no `menu` step) | amendment 3 | 10 |
| `till-table-order-screen.parties.test.ts:128-239` (bills list rows, Take payment), `:184-197` (no New orders tag) | R, B | rows → switcher rows; Receipt copy and Cancel and credit → ⋮ bill section for the bill on screen; Take payment → switching; the no-tag checks stay (the switcher draws no tag) | spec §3.5, amendment 2 | 9 (rows), 11a (re-point) |
| Every `data-open-drawer` site (105 in 37 files) | R | opens the ⋮ or the switcher, or reads the foot, whichever now holds what the case checks; a11y cases run axe on the ⋮ and switcher open instead of the drawer | spec §3.5 "The Tab button and its side panel go" | 11a (screen files), 11b (app files, helpers), 11c (sites that read the still-to-pay row, the finish refusal or the badge) |
| Tab badge: `till-table-order-screen.test.ts:535-539`, `:541-549` (handle's accessible name), `:552-561`, `:751`; `.populated-drawer.a11y.test.ts:92`; `.empty-drawer.a11y.test.ts:47` | R | the not-yet-served count read from the Sent summary (`[data-sent-panel] .summary`, `table.sent_counts`) and the Sent toggle's accessible name; one-portion lines so line and quantity counts agree | spec §3.5; board 13 "Sent, To serve, Served … the panel's Sent box"; D17 | 11c |
| `till-table-order-screen.test.ts:694`, `till-table-order-screen.panel-footer.test.ts:127-150` (Hold swallowed) | B | Hold is not drawn on the table screen; a counter case pins Park still drawn there | amendment 4 | 12 |
| `till-table-order-screen.panel-footer.test.ts:29-54` (one tender-pay, Full invoice count, Discount in the foot) | B, R | one Full invoice on the table's payment step (D8); `data-discount-bill` found in the ⋮ bill section, not the foot (D16) | amendment 1, amendment 4, Owner questions 3 and 7 | 12 |
| `data-discount-bill` sites: `panel-footer.test.ts` (7), `till-table-order-screen.adjustments.test.ts` (4), `till-app-adjustments.test.ts` (2), `panel-footer.a11y.test.ts` (1) | R | open the ⋮ first, then the same button, same event and detail | D16, Owner question 7 | 12 |
| Any case that pins the payment step's Full invoice on a presented bill that already has an invoice number | B | not drawn (D8 gate, matching the server's `working_order.not_open`); confirm at red, none found by reading | master plan "an issued/paid bill never opens that editor" | 12 |

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

1. **Spanish for the five new strings and the guide section.** Default: as in "Spanish" above —
   «{bill} de {count}» ("Cuenta 2 de 3 · Clint · 54,00 €"), «+ Cuenta nueva», «Toda la mesa»,
   «Cuenta 2 ya no está en esta mesa. Ahora se muestra Cuenta 1.», «Cuenta 2 ya no está en esta
   mesa.» — and the ES `{#bill-switcher}` section (Task 14). Example: a closed switcher at a table
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
- [ ] Implement the product deletions. Then the sweep, a script kept outside the repository that,
      for each file in `rg -l 'bills: "(merge|separate)"' apps/server/src`, deletes every line that
      is exactly `\s*bills: "(merge|separate)"( as const)?,\s*$` and nothing else. Then fix the
      leftovers by hand from `rg -n 'bills: "(merge|separate)"|bills = "merge"|\bbills,|bills\?:' apps/server/src`
      (inline objects, helper parameters, `{ ...opts, bills }`). Each hand edit is a property or
      parameter deletion; anything else is a stop.
- [x] (Done: product deletions in `move-bill.ts`, `table-actions.ts` (also `combineParties`'
      `bills` argument), `till-api.ts`, `floor-today-merges.ts`, `testing/party-venue.ts`. Sweep:
      122 lines in 61 files. Hand fixes: 70 lines in 14 files by a second outside script (a
      `bills: "…"` property inside a one-line object, or a whole `{ bills: "…" }` argument to a
      helper whose options default to `{}`); helper parameters and their call-site arguments in
      `bill-editing.bill-moves`, `bill-editing.table-actions`, `bill-identities`, `receipt-guests`,
      `party-table-actions`, `order-kitchen-note.moves` and `floor-today-flatten-api`; the
      `it.each` callback parameter in `order-kitchen-note.moves.test.ts:194`, left unused. Left
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

- [ ] Case `A803 bill order:` "a party whose Bill 2 was opened before its Bill 1 arrived lists Bill
      1 first" (join a seated party whose own bill is older than the joining party's: numbers and
      opening order disagree).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/parties.test.ts -t 'A803 bill order'`.
- [ ] Implement; run `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts src/parties.test.ts src/till-api.parties.test.ts src/order-drafts.db.test.ts src/unpaid-departure.test.ts src/table-signals.test.ts`.
      Only the A1232 pin (and pins of the same list whose bills' numbers and opening order differ)
      may change; anything else is a stop, and then this task is reverted and A1232 stays a residual.
- [ ] GREEN: those files; server typecheck.
- [ ] Commit: "List a party's bills in number order on the server".

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
made a NEW bill; the new one picks the existing lowest-numbered open bill. A case that goes red
for that reason is re-expressed (kind S, its own Changed-checks row with file:line): its setup
calls `insertPartyBill` and passes that id, which is exactly what the old helper did, and every
`expect` stays byte-identical. A red case for any other reason is a stop.

- [ ] Case `A803 fixtures:` in `apps/server/src/testing/party-bill-of.test.ts`: "names the
      lowest-numbered open bill, skipping paid and presented ones", "names none for a party whose
      bills are all paid", "names Bill 1 over an older-opened Bill 2" (numbers against opening order).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/testing/party-bill-of.test.ts`.
- [ ] Implement; the main bill still exists. Run `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts src/till-api.drafts.test.ts src/party-arriving-dishes.test.ts src/served.test.ts`
      and every file importing the helpers whose cases send without a bill
      (`rg -l 'orderForParty\(|observedGroupSubmitBody|observedDraftCommandBody|submitGroups\(|placeGroups\(' apps/server/src -g '*.test.ts'`),
      including `party-main-bill.test.ts:157` ("moves the party revision once") and `:356-358`,
      which must stay green unedited.
- [ ] GREEN: those files; F; Filing; server typecheck.
- [ ] Commit: "Server test helpers find a party's bill by number".

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

- [ ] New case `A803 no main bill (writers):` in `party-bill-actions.test.ts`: "Merge bills, Move
      this bill, Join and Split a table never SET a party's `main_bill_id`": the new party of a
      split, and a party that receives a bill or guests, keep the value they had or null — the only
      change allowed is the existing triggers clearing it (read the column before and after; it
      still exists until Task 7). Expected red on the writers still naming one after Task 4a —
      `mergeCheckedBills` (`bill-actions.ts:280`) and `moveBillOnce` (`move-bill.ts:286`, `:319`)
      by reading; record which go red, and if a writer's sub-case is already green say so in the
      ledger (the case still guards it).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-bill-actions.test.ts -t 'A803 no main bill'`.
- [ ] Implement; run the files above plus the trace's
      `rg -l 'mainBillId|main_bill' apps/server/src -g '*.test.ts'`. A red assertion in a file that
      Task 6c owns (it pins seating or `partyMainBill`) must not appear here; if one does, stop and
      move the writer change, not the test.
- [ ] GREEN: those files; F; H2; Filing; server typecheck.
- [ ] Commit: "Table actions no longer read or write a main bill".

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

- [ ] New cases `A803 no main bill:` in `party-main-bill.test.ts` (Review focus 4): "a seated
      table's floor row names Bill 1 as the bill it opens on"; "after the only bill is paid the
      floor row names it, and an order needs a bill made with `createPartyBill`"; "a send naming a
      bill that has since moved to another party refuses `bill.other_party`, and no line, draft or
      bill is written" (rows compared outside the failed transaction); "a send naming a bill of this
      party that is not the lowest-numbered lands on exactly that bill"; "the floor row opens on the
      lowest-numbered owing bill, else the highest-numbered shown bill" (seed numbers against
      opening order).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts -t 'A803 no main bill'`
      — fails on `openingBillId` (undefined).
- [ ] Implement; rewrite the main-bill cases (Changed test checks); run the files above and
      `rg -l 'readSeatedParties|listTablesWithState|/api/tables/state' apps/server/src -g '*.test.ts'`.
- [ ] GREEN: those files; F; H2; Filing; server typecheck;
      `rg -n 'mainBillId|partyMainBill|setMainBill|readMainBill' apps/server packages --glob '!**/drizzle/**'`
      prints only `packages/db/src/schema/parties.ts` (Task 7).
- [ ] Commit: "The server keeps no main bill; the floor names the bill a table opens on".

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

- [ ] Write the behavioural-triggers describe's new case first ("the main bill is gone": no
      `main_bill_id` in `pragma_table_info('parties')`, no trigger whose `sql` contains `main_bill`).
- [ ] RED: `pnpm exec vitest run scripts/behavioural-triggers.test.ts -t 'main bill'` — fails on the
      column still present.
- [ ] Generate both migrations; apply exactly the Q5 items 3–5 changes, no other edit to those files.
- [ ] GREEN: S (all three commands; `migration-upgrade` with its new `RESETS` row; record the
      refusal text from its own output, and confirm it is the `DROP TABLE parties` foreign-key
      refusal on a box with a closed party too, review-1 minor 7); H2; F; Filing;
      `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/canvas-retirement-upgrade.test.ts`;
      `pnpm --filter @waitron/db exec vitest run src/schema/parties.test.ts`; server typecheck;
      `rg -n 'main_bill|mainBill' packages apps/server --glob '!**/drizzle/**' --glob '!**/test-fixtures/**'`
      prints only the dated README sentence; `git diff a90f4f87b -- scripts apps/server/scripts`
      matches Q5 items 3–5 and nothing else.
- [ ] Commit: "Drop the main bill column and its triggers (venue reset needed)". Body: the rebuild
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
`billToShow(kept, bills, named?)`, D11); `apps/till/src/till-app.ts` (Move guests answer
`:14806-14813` and split follow `:15401-15409` follow D11 rule 1 from the answer's ids;
`#sayBillsKeptApart` `:15324-15332` and its calls `:14817`, `:14889`, `:15321` go);
`apps/till/src/screens/till-table-order-screen.ts` (`#pickTable` `:4860-4867` sends at once,
`#sendTableAction`/`#moveBillToCounter` `:4869-4900` send no `bills`, `#onBillChoice`/`#billChoiceDialog`
`:4902-4932` and `billChoice` state go); strings whose last user goes here; tests
`api/client.test.ts`, `state/bill-state.test.ts`, `till-app-parties.test.ts`,
`till-app-table-service.test.ts`, `till-table-order-screen.test.ts`, `till-app-allergy.move.test.ts`
(those the trace's `"merge"|"separate"` list names for the table screen and app).

- [ ] Cases `A803 action results` in `api/client.test.ts` (the request bodies of the four calls
      carry no `bills` even when a caller passes one; the parsed answers; `createPartyBill`'s
      request and answer) and `till-app-table-service.test.ts` (after Join, Move guests and Split a
      table: the bill on screen is chosen by D11 rule 1, and the next `saveDraft` request's
      `billId` equals that id — Review focus 4); `billToShow` unit cases in `state/bill-state.test.ts`
      (kept, named, lowest owing, lowest shown, none); `A803 no merge question` in
      `till-table-order-screen.test.ts` (picking a seated table dispatches at once, with no dialog).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/state/bill-state.test.ts src/till-app-table-service.test.ts src/screens/till-table-order-screen.test.ts -t 'A803|billToShow'`.
- [ ] Implement; run the trace's till files for the table screen and app.
- [ ] GREEN: those files unfiltered; till typecheck clean.
- [ ] Commit: "The table screen asks no merge question and follows the bills an action leaves".

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

- [ ] Cases `A803 no merge question`: the floor's drop of a table onto a seated table calls
      `joinTables` once with no `bills` and draws no dialog; moving a parked order to a seated table
      calls `moveBill` with no `bills` and draws no dialog; moving a counter order with an allergy
      answer to a seated table asks the allergy question only, not a merge question.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.today-joins.test.ts src/widgets/held-orders.test.ts src/till-app-allergy.move.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: those files, `held-orders.a11y.test.ts` and every till test file this task edited,
      unfiltered; till typecheck clean;
      `rg -n '"merge" \| "separate"|bills: "(merge|separate)"|bill-choice|BillChoiceDetail|bills_question|bills_merge|bills_separate|bills_kept_separate|bill_move_question' apps/till`
      prints nothing.
- [ ] Commit: "Retire the merge question everywhere in the till".

## Task 8c: rename the floor's `mainBillId` to `openingBillId` in the till (mechanical, ≈35 calls)

**Files.** `api/client.ts` `TableParty.mainBillId` `:2109-2110` → `openingBillId: string | null`
(doc comment says it is the bill a table opens on, D7); the three till-app reads renamed with the
same use (`till-app.ts:11002-11015`, `:14895`, and the others `rg` finds); every till test file and
helper with `mainBillId:` (`test/bill-pay-app.ts:82`, `test/allergy-app-fixture.ts:133`, `:167`,
`screens/till-table-order-screen.panel-footer.test-helpers.ts:20`, and the rest of the 73 files)
renamed by a script: `mainBillId:` → `openingBillId:` with the same value; no other change.
Behaviour is unchanged in this task; Task 8d changes what the app does with the field (review-1 I6).

- [ ] Before: `rg -c mainBillId apps/till` (record the count).
- [ ] Rename (type, three reads, then the script over `rg -l mainBillId apps/till`).
- [ ] GREEN: till typecheck clean; `git diff --name-only HEAD -- apps/till | /usr/bin/grep '\.test\.ts$' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`
      green; `rg -n mainBillId apps/till` prints nothing; `git diff HEAD -- apps/till | /usr/bin/grep '^[-+]' | /usr/bin/grep -v -e mainBillId -e openingBillId -e '^+++' -e '^---'`
      prints nothing (a rename only), apart from lines `pnpm exec prettier --write` re-wrapped
      because the new name is two characters longer — list those in the ledger.
- [ ] Commit: "Till: the floor names the bill a table opens on".

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

- [ ] Cases `A803 opening bill` in `till-app-open-table.test.ts`: opening a seated table shows
      `openingBillId` with one bills request at most and lines in parallel (count the requests);
      opening a party whose floor row names no bill and whose bills read is empty sends **no**
      `createPartyBill` and no draft write, and shows no New order (I4).
- [ ] Cases `A803 bill gone` (review-1 I3) in `till-app-parties.test.ts`:
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
- [ ] Case `A803 action results` in `till-app-parties.test.ts`: Move this bill to another table
      leaves the screen on the staying party's lowest-numbered owing bill, and the next draft
      request names it; `:3964` (back to the floor when it was the last) stays green unedited.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts src/till-app-parties.test.ts -t 'A803'`.
- [ ] Implement; the Changed test checks rows for 8d.
- [ ] GREEN: the five files unfiltered; till typecheck clean; `rg -n 'party\.main_bill_stays' apps/till` prints nothing.
- [ ] Commit: "The till opens a table on the bill the floor names and never keeps a vanished bill on screen".

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

- [ ] Screen cases `A803 switcher`: one bill → the closed label "Bill 1 · €38.50" and the open list
      holds that bill and "+ New bill"; three bills → "Bill 1 of 3 · €67.00", rows in number order
      with what each owes, "Paid" for a paid one, a name "Bill 2 · Clint", and "Ana has an unsent
      order: 3 items" under the bill Ana has unsent dishes on; **"+ New bill" is the last item of
      the list with one bill and with three** (minor 11); after Bill 2 is merged away the list
      shows Bill 1 and Bill 3 and the closed label says "of 2" (a count, not the highest number);
      choosing Bill 3 dispatches `switch-bill` with Bill 3's id (never an index); "+ New bill"
      dispatches `new-bill`; an unnumbered bill reads "Bill" (slice 2's owner answer 5); a party
      with no shown bill draws "Bills" with only "+ New bill"; no party → no switcher.
- [ ] App cases `A803 new bill`: "+ New bill" calls `createPartyBill(partyId, revision)` once,
      shows the answered bill, and the next draft save names it; "two tills tap + New bill on the
      same revision: the second shows the `party.out_of_date` refusal, its switcher then lists the
      first till's new bill, it stays on its bill, and it sends exactly one `createPartyBill`"
      (I4); switching to a paid bill shows it and New order refuses as `bill.paid` (Owner question
      6); "after the bill on screen vanishes, the closed label names the bill now shown" (I3,
      visible refresh).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.test.ts src/till-app-table-service.test.ts -t 'A803'`
      — the screen cases fail on the missing switcher (the assertion, after the file mounts the
      screen), the app cases on no `createPartyBill` request.
- [ ] a11y: `till-table-order-screen.bill-controls.a11y.test.ts` covers the switcher closed and open,
      one bill and three, a paid row and an editor row, the no-bill state, in light and dark; run
      with `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-controls.a11y.test.ts`.
- [ ] GREEN: the three files; `till-table-order-screen.parties.test.ts`, `till-table-order-screen.test.ts`; till typecheck.
- [ ] Commit: "A bill switcher with + New bill on every table, even with one bill".

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

- [ ] Cases `A803 single menu`: exactly one ⋮ on the screen and no "Table actions" button; its
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
- [ ] Cases `A803 invoice entry` in `till-app-bill-payments.test.ts`: the ⋮ Full invoice and the pay
      step's Full invoice open the same recipient editor for the same bill and revision; a paid bill
      offers none and the test asserts no `setOrderInvoiceChoice` (or any issuance or correction)
      request is made (finding 7, D8).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.table-menu.test.ts src/till-app-bill-payments.test.ts -t 'A803'`.
- [ ] Implement; re-point the kind-R checks.
- [ ] GREEN: those files and `till-table-order-screen.test.ts`, `.actions-unsaved.test.ts`,
      `.parties.test.ts`, `.allergy.test.ts`, `.bill-controls.a11y.test.ts`, plus the drawer-opening
      app files `till-app-parties.test.ts`, `till-app-adjustments.test.ts` and
      `till-app-bill-payments.test.ts` unfiltered (they still open the drawer and must stay green);
      till typecheck.
- [ ] Commit: "One ⋮ menu for the bill on screen and the whole table".

## Task 11a: screen tests reach bills and actions through the switcher and the ⋮ (≈60 calls)

The drawer still exists in this task; tests stop depending on it. **Files.** The screen test files
that open the drawer (`rg -l data-open-drawer apps/till/src/screens`; about 20 files, including the
`*-retirement`, `.a11y`, `.loading`, `.empty-drawer.a11y`, `.populated-drawer.a11y`,
`.current-orders`, `.sent*`, `.adjustments*`, `.bill-payments*`, `.panel-footer` files and
`sent.test-helpers.ts`). Each site is re-pointed (kind R) to the ⋮, the switcher or the foot. Sites
whose check reads what only the drawer holds until 11c — the table's still-to-pay row, the Finish
table refusal, the Tab badge — are left as they are and listed in the ledger for 11c. If the sweep
passes ~55 calls, commit at a green file boundary and hand over.

- [ ] RED: none new; the change is in where each test looks. For each file: run it, re-point, run
      it again; record each changed check (file:line, what it opened before, what it opens now).
- [ ] GREEN: `rg -l 'till-table-order-screen' apps/till/src/screens -g '*.test.ts' | sed 's#apps/till/##' | xargs pnpm --filter @waitron/till exec vitest run`;
      `rg -n 'data-open-drawer' apps/till/src/screens -g '*.test.ts' -g '*helpers.ts'` prints only
      the sites listed for 11c; till typecheck.
- [ ] Commit: "Screen tests reach bills and actions through the switcher and the ⋮".

## Task 11b: app tests and helpers that opened the drawer (≈55 calls)

**Files.** `till-app-parties.test.ts` (25 sites), `till-app-adjustments.test.ts`,
`till-app-bill-payments.test.ts`, `till-app-drafts.test.ts`, `till-app-table-service.test.ts`,
`till-app.test.ts`, `till-app-menu-refresh.test.ts`, `till-app-handheld-pay.test.ts`,
`screens/till-paid-view.test.ts`, **`apps/till/test/bill-pay-app.ts`** (review-1 minor 4) and every
other file `rg -l data-open-drawer apps/till/src apps/till/test` names outside `screens/`. Kind R
only; a helper `openTableMenu(el)` / `openBillSwitcher(el)` in `apps/till/test/` if three or more
files need it. Sites that read what only the drawer holds stay for 11c, as in 11a.

- [ ] Re-point each file, running it before and after; GREEN: the same files unfiltered;
      `rg -n 'data-open-drawer' apps/till` prints only the 11c sites; till typecheck.
- [ ] Commit: "Till app tests reach bills and actions through the switcher and the ⋮".

## Task 11c: the Tab button and drawer go (≈55 calls)

**Files.** The screen: Tab button `:2369-2381` and its badge, `drawerOpen` `:1192`, `#toggleDrawer`
`:2271`, `#drawer` `:4034-4046`, `#billsSection`/`#billRow`/`#takePayment` `:4248-4399` and the
drawer's copies of Receipt copy, Cancel and credit, Bill requested and Finish table go; the action
panel shows in the side column only while a step is open (D9); the foot gains the table's
still-to-pay under the bill's total and, when `finishRefused`, the refusal with Take payment and
Record unpaid departure above it (D9); `i18n/strings.ts` `table.open_drawer` goes; the sites left
for 11c by 11a/11b; the badge rows (D17).

- [ ] Cases `A803 no tab panel` in `till-table-order-screen.panel-footer.test.ts`: no Tab button at
      any width; the foot shows this bill's total, then "Still to pay at this table" with the party's
      outstanding; Finish table refused shows the refusal with Take payment for the first other
      unpaid bill above the foot; choosing Move guests in the ⋮ shows the table picker in the side
      column and Back closes it. Case `A803 to serve` in `till-table-order-screen.test.ts`: with one
      unserved and one served one-portion sent line, the Sent summary shows them, and after the
      last is served its not-yet-served counts read 0 (D17).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.test.ts -t 'A803 no tab panel|A803 to serve'`.
- [ ] Implement; re-point the 11c sites and the badge rows.
- [ ] GREEN: the screen files (11a's command), the 11b files, till typecheck;
      `rg -n 'data-open-drawer|drawerOpen|open_drawer|data-pending-badge' apps/till` prints nothing.
- [ ] Commit: "The table screen loses the Tab button: bills in the switcher, actions in the ⋮".

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

- [ ] Cases `A803 pay scope` in `panel-footer.test.ts`:
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
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/widgets/tender-pay.test.ts -t 'A803'`.
- [ ] Implement; re-point the `data-discount-bill` sites (open the ⋮ first).
- [ ] GREEN: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.panel-footer.a11y.test.ts src/screens/till-table-order-screen.adjustments.test.ts src/till-app-adjustments.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/widgets/bill-pay-dialog.unsent.test.ts src/widgets/tender-pay.test.ts src/widgets/tender-pay.a11y.test.ts src/screens/till-table-order-screen.bill-payments.test.ts src/screens/till-table-order-screen.bill-controls.a11y.test.ts src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts`;
      `pnpm --filter @waitron/till exec vitest run src/screens/till-counter-screen.test.ts` (the counter keeps Park); till typecheck.
- [ ] Commit: "The table's foot: totals and Pay, quiet while this bill has unsent dishes".

## Task 13: whole-slice run and controls (no commit unless a fixture moves, ≈45 calls)

- [ ] Server: every file the Tasks 1–7 GREEN lines named, in one run per task list. Till:
      `git diff --name-only a90f4f87b -- apps/till | sed 's#apps/till/##' | /usr/bin/grep '\.test\.ts$' | xargs pnpm --filter @waitron/till exec vitest run`.
- [ ] S, F, H2 (byte-unedited, the `git diff` check above), Filing, G, words and codes, both
      typechecks.
- [ ] Proof by deletion, one at a time in the working tree and reverted, each turning the named case
      red for that reason (record each red line in the ledger):
      1. restore the merge arm in `moveBillOnce` → "arrives as its own bill …" (Task 2);
      2. restore the `merging` decision in `combineParties` → "joining a seated table … keeps both" (Task 3a);
      3. drop the empty-bill creation in `splitTable` for the staying party → "leaves the staying party
         one new empty bill" (Task 4a);
      4. compute `openingBillId` as the first bill in opening order → "the floor row opens on the
         lowest-numbered owing bill" (Task 6c);
      5. make the till's `new-bill` handler switch to the lowest-numbered bill instead of the answer →
         "the next draft save names it" (Task 9);
      6. count another bill's unsent dishes in D5's rule → "NOT quiet when the unsent dishes are on
         Bill 2 only" (Task 12);
      7. drop `payQuiet`'s tap guard so a quiet Cash tap dispatches → "dispatches no `pay-tab`" (Task 12);
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

## Task 16: backlog, questions, PR text, hand-off (≈25 calls)

- [ ] `docs/backlog.md` A803 entry (`:1983-2000`): remove the switcher, kebab, no-Hold, quiet-Pay,
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
- [ ] `questions.md`: one section for Owner questions 1, 2, 3, 4, 6 and 7, one at a time with its
      default and its pictures, headed "A803 slice 3 (#PR) — six questions; the build used the
      defaults; the PR waits for 1, 5 and 7"; and the FYI section the owner's rule asks for, headed
      "A803 slice 3 (#PR) — changed test checks, FYI, no answer needed", pointing at the PR's
      "Changed test checks" section.
- [ ] Changed-checks receipt outside product source, attached to the PR: every row above with its
      red and green output, plus any found at red runs, and a statement that F and H2 are
      byte-unedited and the Filing files and `scripts/`-level files changed only as Owner question 5
      says.
- [ ] PR title: "One bill switcher and one ⋮ at a table; no main bill (A803 slice 3; venue reset
      needed)". First line: "Needs a venue reset: the migration rebuilds `parties` to drop the main
      bill, and fails on any box that has ever seated a party." Then, in plain English: what a waiter
      sees; that joins and moves never merge bills now and Merge bills does it on purpose; the seven
      owner questions and their defaults; the five Spanish proposals and the ES guide section; a
      "Changed test checks" section; Owner question 5's items with their before and after; the LOOK
      screenshots; the deletion controls of Task 13; that F and H2 ran unedited.
- [ ] Overlap note in the PR: lane E's `feat/a696-startup-zone-validation` changes other functions
      of `bill-actions.ts`, `till-api.ts`, `working-order.ts` and till `strings.ts`; whoever lands
      second rebases. A739 Cut B will rebuild the pay section this slice edits (D5, D6, D8, D16).
- [ ] **Landing gate.** Not fiscal code: no sale, invoice number, receipt, `registros_facturacion`,
      `computeHuella`, chain or alta builder changes; F and H2 unedited. But it edits two filing
      tests and `scripts/`-level guards on Owner question 5's default, so the lane's queue entry
      goes to `needs-owner-review` and the PR is **not landed until the owner has answered Owner
      questions 1, 5 and 7** and CI is green on the current head. A different answer is built as
      a follow-up task on this branch before landing.
- [ ] Ledger `Status: done` for the build (parked for the owner); tell the owner the branch is ready
      for `finish-branch`.

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
