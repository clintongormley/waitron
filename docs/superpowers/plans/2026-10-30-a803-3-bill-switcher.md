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

## Owner answers

None yet. The defaults under "Owner questions" are what the build uses; the PR asks each one.

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

**Venue reset.** Required: the core migration rebuilds `parties` (finding 9), which fails on any
box holding a seated party. Pre-live rule: no data-migration code (root `CLAUDE.md` §3). The PR's
first line says so; the reset needs its own authorisation and is not run by this slice.

**Spanish.** Three new till strings and one guide section, all **proposals** (Owner question 1):

| Key | English | Proposed Spanish | Built from |
| --- | --- | --- | --- |
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
- **Owner's test-change rule (2026-10-05)**: an assertion pinning main-bill selection, merge on
  arrival, the merge question, the Tab drawer or Hold on the table screen may change to check the
  new behaviour at least as strictly; every such change is listed under "Changed test checks".

## Decisions

- **D1 The server makes a bill only when asked, with one exception.** New
  `createPartyBill(tx, cfg, partyId, command: { expectedPartyRevision: number; operatorId: string }):
  Promise<{ billId: string; revision: number }>` in `parties.ts` replaces `partyMainBill`: it checks
  and moves the party's revision (`checkAndBumpParty`, `parties.ts:447`), refuses a closed party
  (`party.not_open`), and inserts an empty open bill on the party in its zone exactly as
  `partyMainBill` does today (`createOpenOrder(..., { zoneId, partyId, existingService: true })`,
  `parties.ts:184-188`), which numbers it (`working-order.ts:1741`). It returns the new revision, as
  `setPartyName` does (`parties.ts:265-273`), so the till can send the next command. The exception:
  a table action that would leave a party with **no bill that is not abandoned** makes one empty
  bill on it in the same transaction (master plan, slice 3 "Interfaces"): Split a table choosing no
  bill (the new party), Split a table taking the staying party's last such bill (the staying party,
  spec §3.7 case 3), and Join/Move guests whose resulting party has none.
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
  "one layout everywhere").
- **D3 Row content in one function** (`billRowContent(bill, party)`), so A797 slice 11 adds its ✎
  marks in one place.
- **D4 One ⋮ menu** (`wt-row-actions`, icon `kebab`, accessible name the approved
  `table.actions_title` "Table actions" / «Acciones de mesa»), with two `role="group"` sections each
  named by a visible heading, the pattern the More menu uses (`apps/till/src/widgets/till-shell.ts:1198`):
  - **Bill section**, headed with the bill on screen's short label ("Bill 1", "Bill 2 · Clint");
    omitted when no bill is on screen. Items, each only where it applies today: Name this bill
    (any shown bill of this party, paid included — folds A1233); Split by item; Transfer items;
    Merge bills; Move this bill (`#movable`, `till-table-order-screen.ts:5492-5494`); **Full
    invoice** (D8); **Receipt copy** (paid with a receipt, from `#billRow` `:4356-4367`); **Cancel
    and credit** (presented with a receipt and no payments, `:4380-4392`).
  - **Whole table**: Guests; Name the party; Allergies; Bill requested / cancel request (from
    `#billRequest`); Split a table (two or more tables); Join a table; Move guests; Finish table.
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
  (`:4142`), so menu and payment step open one editor. A paid or issued bill gets **no** Full
  invoice item and no request: A802's correction has no till entry on main (finding 7), so the
  guide says that a full invoice for a paid bill is a correction Waitron does not offer yet (Owner
  question 2). Everything gated on `fullInvoices` stays gated.
- **D9 The action panel replaces the drawer.** The side column the drawer used (`.layout`, `:2405`)
  shows the action step only while one is open (`actionStep` other than `closed`), with its Back
  and close as today. The bills list, the table total row and the Tab button go. The table's still
  to pay (`table.still_to_pay`) moves into the foot under this bill's total; the Finish table
  refusal (`:4263-4291`, with Take payment and Record unpaid departure) moves above the foot, shown
  when `finishRefused` as today; Take payment on a bill row goes (the switcher replaces it).
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
- **D11 Selection after an action** (master plan; spec Review focus 4). After Join, Move guests,
  Split a table or Move this bill, the till keeps the bill it showed if that id is in the party's
  bills afterwards; otherwise it shows the bill the answer names (Move this bill to another party:
  none, it stays with the table it was on — see next), otherwise the lowest-numbered owing bill,
  otherwise the lowest-numbered shown bill. If the party on screen has no shown bill, the till
  calls `createPartyBill` and shows that bill (the server only does this inside its own actions,
  D1). The switcher redraws from the read, so the change is visible. The next draft save names
  exactly the id on screen (`DraftSync` is built on `activeTabId`).
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
  once Tasks 2 and 4 land; it is removed everywhere in Tasks 4 and 8c. `scripts/errors-reachable.test.ts`
  checks only that each `errors.ts` is reachable from its barrel (`:7-17`, `:59-`) and
  `scripts/alert-codes.test.ts` checks dashboard incident codes against a source list (`:23-42`,
  `:101-134`); both are run once after the removal.
- **D15 Server list order by number (folds A1232, `docs/backlog.md:2025-2030`).**
  `readBillsOfParties` orders by stored number (null last), then id, instead of opening order
  (`parties.ts:684`); action answers list ids in that order.

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
| RED file list includes `party-main-bill.test.ts` "only for explicitly retired behaviour" | rewritten in Task 6b, every case either kept or turned to the new behaviour | Changed test checks |
| Code map: `order-drafts.ts:1247` etc. | re-resolved below | drift since `c9ad7a634` |

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
| `parties.ts` `seatTable`/`partyMainBill`/`setMainBill`/`readMainBill`, `moduleCoreServices` comment | 6b |
| `table-actions.ts` combine merge, answers, split choice, `refuseUnsplittableBill` | 3, 4 |
| `move-bill.ts` merge arm, `refuseMainBillLeaving`, `readSourceParty.mainBillId`, answer | 2, 6b |
| `bill-actions.ts:209`, `:237-282` main bookkeeping | 6b |
| `working-order.ts` `TableParty.mainBillId`, `serviceModesMatch` | 6b, 3 |
| `till-api.ts` `requireBillChoice`, `moveCommand`, `tableActionCommand`, seat route, `STATUS` | 2, 4 |
| `floor-today-merges.ts:137-144` | 4 |
| `errors.ts:481-486` | 4 |
| `testing/group-submit-fixture.ts`, `testing/draft-command-fixture.ts`, `testing/serve-line.ts`, `testing/party-venue.ts:313`, `testing/bill-venue.ts:466` (prose) | 6a, 4 (`party-venue` join) |
| `packages/bookings/src/testing/fake-core.ts:5` (prose) | 6b |
| `packages/db/src/schema/parties.ts:46-50`, `packages/db/README.md:88-95` | 7 |
| `packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json` (captured schema, hashed; not edited) | 7 (the test adapts its expectation) |
| till `api/client.ts` `TableParty`, results, `bills` params, doc comments `:2109`, `:2185-2186`, `:2213`, `:4420`, `:4439`, `:4656` | 8a, 8c |
| till `till-app.ts` six `mainBillId` reads, `#sayBillsKeptApart`, `billToOpen`, `TABLE_REFUSALS` | 8a, 8c |
| till screen merge question, `#splitTableBills`, Tab drawer, actions, Hold, Full invoice | 8a, 8c, 9, 10, 11a, 12 |
| till `screens/till-floor-screen.ts`, `widgets/held-orders.ts`, `widgets/bill-choice-dialog.ts` | 8b |
| till `i18n/codes.ts:294-297`, `i18n/strings.ts` retired keys | 8b, 8c, 11a |
| till test helpers `test/bill-pay-app.ts:82`, `test/allergy-app-fixture.ts:133`, `:167`, `screens/till-table-order-screen.panel-footer.test-helpers.ts:20` | 8d |
| `scripts/behavioural-triggers.test.ts:121-131`, `:158-159`, `:1544-1590` | 7 |
| Guides `apps/server/src/guide/{en,es}/table-service.md` (`{#bill-names}` EN `:235-239`, ES `:247-251`; `{#full-invoice}`; `{#portions}`) | 14 |
| `docs/developers/conventions-data.md:3512-3513`, `:3570`; `docs/operations/a760-migration-squash-inventory.md:126-127` | 7, 14 |

Counts at `a90f4f87b`: server non-test files 9 (6 product, 3 test helpers) plus 2 route/registry
files; server test files naming the main bill 19 (`rg -l 'mainBillId|main_bill|partyMainBill|setMainBill|readMainBill'
apps/server -g '*.test.ts'`); server test files passing `bills` about 70; till non-test files 3 plus
3 test helpers; till test files with a `mainBillId` fixture 67; till files carrying the merge
question 23 (`rg -l '"merge"|"separate"' apps/till/src`); db/scripts 3; guides 2; developer docs 3.

## Guard suites

Each command separately, each exit status checked, a nonzero **Tests** count required.

- **S:** `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/migrations-match-schema.test.ts scripts/classification-complete.test.ts scripts/append-only-migration-sets.test.ts scripts/module-graph-honesty.test.ts scripts/id-columns-are-references.test.ts scripts/journal-monotonic.test.ts scripts/migration-upgrade.test.ts`,
  then `pnpm exec vitest run scripts/two-file-foreign-keys.test.ts scripts/column-vocabulary.test.ts scripts/apply-migrations-callers.test.ts scripts/live-subscriptions.test.ts scripts/module-seams.test.ts`,
  then `pnpm --filter @waitron/composition exec vitest run src/composition.test.ts`.
- **H2 (unedited):** `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- **F (unedited, plus H2):** `pnpm --filter @waitron/server exec vitest run src/split-bill.fiscal.test.ts src/till-api.fiscal-sale-paths.test.ts src/transactional-series.test.ts src/bill-payments.test.ts src/bill-payments.card.test.ts`.
- **G:** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
- **Words and codes:** `pnpm exec vitest run scripts/english-only.test.ts scripts/personal-log-params.test.ts scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`.
- **Till types:** `pnpm --filter @waitron/till typecheck`; **server types:** `pnpm --filter @waitron/server typecheck`.

A red F or H2 case, or any change to their files, is a stop: keep the output, revert the task's
uncommitted change, write a decision request. `git diff a90f4f87b -- packages/fiscal-verifactu apps/server/src/split-bill.fiscal.test.ts apps/server/src/till-api.fiscal-sale-paths.test.ts apps/server/src/transactional-series.test.ts apps/server/src/bill-payments.test.ts apps/server/src/bill-payments.card.test.ts`
prints nothing at every task's end.

## Changed test checks

The owner's rule (2026-10-05): an assertion may change without asking only where it pins behaviour
this slice deliberately changes, and then to check the new behaviour at least as strictly; never
deleted, never loosened. Kinds: **B** behaviour the spec or an amendment changes (cite it); **R**
a retired control or field re-pointed at the control that now holds the same thing, assertion
otherwise unchanged; **W** a whole-shape or list pin losing/gaining an entry with every other value
unchanged; **S** setup re-expressed through the explicit command, every `expect` byte-identical;
**F** a fixture losing a field the type no longer has. **A check covering money totals, VAT,
permissions, fiscal filing or anything this slice was not asked to change is a STOP**: write it in
the ledger and the PR, revert, ask.

Every changed check goes in the receipt attached to the PR with file:line, kind, before, after,
the spec/amendment line, and the red and green output. Expected from reading (each confirmed at its
task's red run; a red assertion not on this list that is not kind B/R/W/S/F under the rule is a stop):

| Test | Kind | Before → after | Source | Task |
| --- | --- | --- | --- | --- |
| `apps/server/src/party-move-bill.test.ts` cases at `:321`, `:356`, `:374`, `:894`, `:1065`, `:1306` (merge into the main bill by default / with conditions / kitchen told once) | B | merged into the destination's main bill → arrives as its own bill with the destination's next number; kitchen told of the move only | spec §6 bullet 2, §3.4 | 2 |
| `party-move-bill.test.ts:458` (`party.main_bill_stays`), `:765` (only an unpaid main bill moves last) | B | refused → the bill moves; the source keeps its other bills | spec §3.4 ("all equal") | 2 |
| `party-move-bill.test.ts` `:827`, `:941`, `:1203`, `:292` (main bill of the new/receiving party) | B | `mainBillId` checks → the moved bill is in the destination's bills with its number | §3.4 | 6b (checks of `parties.mainBillId`), 2 (answers) |
| `apps/server/src/till-api.move-bill.test.ts:1155` (merges by default, `party.main_bill_stays`), `:976` (bad `bills` → 400), `:368` | B | as above; `:976` becomes "a `bills` key is ignored" (D13) | §6, D13 | 2 |
| `apps/server/src/bill-identities.test.ts:314`, `:334`, `:821` (move with Merge the bills) | B | the arriving bill takes the next number instead of merging | §6 | 2 |
| `apps/server/src/order-drafts.db.test.ts:4863` (moveBill merge) | B | the arriving bill and its draft stay separate | §6 | 2 |
| `apps/server/src/party-table-actions.test.ts` `:315`, `:977`, `:1328`, `:1550` (combine/join merges main bills, `mergedInto`) | B | every bill stays separate, numbered by slice 2's rule | §3.4 bullet 2 | 3 |
| `party-table-actions.test.ts` `:349`, `:366`, `:383`, `:641`, `:659`, `:1004` (which main bill survives) | B | main-bill assertions → each bill's party, status and number | §3.4 | 3 (bills), 6b (`mainBillId`) |
| `party-table-actions.test.ts:1101`, `:1124`, `:1138`, `:1183` (split takes chosen bill as main; new empty main bill; presented; `party.main_bill_stays`) | B | chosen bill moves with its number 1 at the new party; no bill chosen → one empty bill created (D1); choosing the bill that was main succeeds | §3.4, master plan "now allowing any eligible bill" | 4 |
| `party-table-actions.test.ts:709-713` (opening order `[ana, luis, second]`) | B | number order `[luis, ana, second]` | A1232 (`docs/backlog.md:2025-2030`), D15 | 5 |
| `apps/server/src/order-drafts.db.test.ts` `merge()` helper `:3418-3427` and its users `:3460`, `:3530-3547`, `:3551`, `:3586`, `:3613`, `:4480` | B | joins keep both bills; Sam's `billNumber` stays 2 only if the receiving party's own bill stays 1 — confirm at red | §3.4 | 3 |
| `order-drafts.db.test.ts:1048` (draft goes to its bill while another is main) | B | same assertion, "while another bill has a lower number" | §3.4 | 6b |
| `apps/server/src/table-actions.refund-pending.test.ts:248` (main bills merge, `merged: true`), `:194`, `:223` (`it.each` over merge/separate), `:177`, `:306` (answer shapes) | B, W | merge row → separate; shapes → `billIds`/`billId` | §3.4 | 3, 4 |
| `apps/server/src/bill-identities.test.ts:595` (join with Merge the bills), `:167` (main bill after all paid) | B | separate numbering; `:167` → no main bill, `openingBillId` | §3.4, D7 | 3, 6b |
| `apps/server/src/move-merge.test.ts:493` ("the main bill of the party taken in, which merges") | B | both bills kept; kitchen told of the moved bills' dishes | §3.4 | 3 |
| `apps/server/src/move-merge.filing.test.ts:300-331`, `:333-` ("parties combined, bills merged → one registro (H2)", "tables joined across parties, bills merged") | **S** (fiscal file: Owner question 5) | the combine no longer merges, so the setup adds an explicit `mergeBills(tx, cfg, intoTab, fromTab, …)` in the same transaction after `moveGuests`/`joinTables`; **every `expect` byte-identical** (`git diff` of the file shows only setup lines and the helper's `bills` removal) | §3.4 "staff merge afterwards" | 3 |
| `apps/server/src/till-api.table-actions.test.ts:97`, `:111`, `:156`, `:172`, `:243`, `:509`/`:536`/`:691` | B, W | answers `{partyId, billIds[, zoneRevisions]}`, split `{partyId, billId}`; "merges by default" → "keeps every bill"; bad `bills` → ignored; `party.main_bill_stays` rows → those splits succeed | §3.4, D13, master plan interfaces | 4 |
| `apps/server/src/till-api.today-joins.test.ts:201`, `:630-652`, `:696`, `:712-717`, `:908`, `:923`, `:949` | B, W | answer shape; the default-merge join keeps bills | §3.4 | 4 |
| `apps/server/src/floor-today-flatten.test.ts:430-431` (split with no bill gives a main bill) | B | gives one empty bill (D1) named in the answer | D1 | 4 |
| `apps/server/src/party-main-bill.test.ts` (all main-bill cases, `:75-226`, `:235-285`, `:343-466`) | B | rewritten case by case: seating opens Bill 1 named in `openingBillId`; a send names its bill; after paying, `createPartyBill` makes the next bill; a send to a paid/other/stale bill refuses with rows compared before/after (kept); every non-main-bill case unchanged | §3.4, Review focus 4 | 6b |
| `apps/server/src/party-bill-actions.test.ts:690`, `:736` (merge keeps/moves the main bill) | B | the explicit merge's surviving bill keeps its number; no main bill | §3.4 | 6b |
| `apps/server/src/parties.test.ts`, `till-api.parties.test.ts:807-821`, and any `TableParty`/floor whole-shape pin | W | `mainBillId` → `openingBillId` | D7 | 6b |
| `scripts/behavioural-triggers.test.ts` `EXPECTED_TRIGGERS` (`:158-159`) and `describe("working_orders_release_main_bill")` (`:1544-1590`) | W, B | the two names leave the list; the describe becomes "the main bill is gone": `parties` has no `main_bill_id` column (`pragma table_info`) and no trigger body names `main_bill` (`sqlite_master`) | §3.4 | 7 |
| `scripts/migration-upgrade.test.ts` `RESETS` | W | gains the new core rebuild step, `refused: ["DROP TABLE \`parties\`", "FOREIGN KEY constraint failed"]` (as `:437-439`) | finding 9 | 7 |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:119-130` (expectation adapter) | W | the captured `parties` table's expectation drops the `main_bill_id` column and its foreign key, as the adapter already adds columns (`:119-130`); the hashed fixture is not edited | finding 9 | 7 |
| `apps/till/src/api/client.test.ts:2738-2749`, `apps/till/src/i18n/codes.test.ts:323-333`, `apps/till/src/till-app-parties.test.ts:2491`, `:4101` (`party.main_bill_stays`) | B | the code's rows go (no thrower, D14); `codes.test.ts`'s loop keeps its other two codes | §3.4, D14 | 8c |
| `till-app-parties.test.ts:2126`, `:2452`, `:4395`, `:4405`, `:5830`; `till-app-drafts.test.ts:8720` (opening/following the main bill) | B | follow D7/D11: `openingBillId`, kept or lowest-numbered bill | §3.4, Review focus 4 | 8c |
| `till-app-parties.test.ts` kept-apart message tests (`table.bills_kept_separate`) and merge-question tests in till screens/floor/held-orders | B | no question; the request carries no `bills` | §3.4 bullet 2, §6 | 8a, 8b |
| `apps/till/src/widgets/bill-choice-dialog.test.ts`, `bill-choice-dialog.a11y.test.ts` | B (retired with the widget) | deleted with the widget; replaced by the "no question" cases of Tasks 8a/8b, which fail if a question is asked or `bills` is sent | §3.4 bullet 2 ("The … question goes") | 8b |
| `till-table-order-screen.test.ts:694`, `till-table-order-screen.panel-footer.test.ts:127-150` (Hold swallowed) | B | Hold is not drawn on the table screen; a counter case pins Park still drawn there | amendment 4 | 12 |
| `till-table-order-screen.panel-footer.test.ts:29-54` (one tender-pay, Full invoice count) | B | one Full invoice on the table's payment step (D8) | amendment 1, Owner question 3 | 12 |
| `till-table-order-screen.test.ts:713` ("Table actions" trigger inside the drawer), `:4231` (verb buttons in the menu), `:6704` (Back in the panel) | R | the ⋮ holds the same items; Back returns to `closed` (no `menu` step) | amendment 3 | 10 |
| `till-table-order-screen.parties.test.ts:128-239` (bills list rows, Take payment), `:184-197` (no New orders tag) | R, B | rows → switcher rows; Receipt copy and Cancel and credit → ⋮ bill section for the bill on screen; Take payment → switching; the no-tag checks stay (the switcher draws no tag) | spec §3.5, amendment 2 | 9, 10 |
| Every `data-open-drawer` site (≈100 in 33 files) | R | opens the ⋮ or the switcher, or reads the foot, whichever now holds what the case checks; a11y cases run axe on the ⋮ and switcher open instead of the drawer | spec §3.5 "The Tab button and its side panel go" | 11a, 11b |
| 67 till test files' `mainBillId:` fixture lines and 3 helpers | F | the line goes; where a case needed the field to open a bill, `openingBillId` with the same id | D7 | 8d |

Kept unchanged on purpose: F and H2 (all files); every money, VAT, payment, permission and
profile-action assertion (`till-api.profile-actions.test.ts` and `till-api.profile-zones.test.ts`
only GAIN rows for the new route, kind W); `transfer-lines.test.ts`, `split-bill.test.ts` and the
explicit-merge cases of `party-bill-actions.test.ts` other than `:690`/`:736`.

## Owner questions

Each has a default the build uses; a different answer changes only the tasks named.

1. **Spanish for the three new strings and the guide section.** Default: as in "Spanish" above —
   «{bill} de {count}» ("Cuenta 2 de 3 · Clint · 54,00 €"), «+ Cuenta nueva», «Toda la mesa» — and
   the ES `{#bill-switcher}` section (Task 14). Example: a closed switcher at a table with three
   bills reads «Cuenta 2 de 3 · Clint · 54,00 € ▾»; the ⋮ shows «Cuenta 2 · Clint» over its bill
   items and «Toda la mesa» over Guests… Finish table. Built behind the approval gate; landing waits
   for your yes. Changes Task 9/10 strings and Task 14.
2. **Full invoice for a bill already paid.** Default: the ⋮ shows no Full invoice for a paid or
   issued bill, and the guide says a full invoice for a paid bill is a correction Waitron does not
   offer yet (A802). Alternative: show it quiet, and on tap explain that correction is not built
   yet — which needs a new sentence in both languages. Changes Task 10 and Task 14.
3. **Which Full invoice button stays on the table's payment step.** Today an unpaid table bill shows
   two (`docs/backlog.md:2488-2492`): the pay panel's own (which, at a table, actually opens the
   counter's invoice question) and the bill's smaller one beside the pay ways. Default: keep the
   bill's own (it names this bill and its revision) and stop drawing the pay panel's at a table;
   the counter keeps its. Changes Task 12 only; the backlog entry is deleted by this slice.
4. **Refund in the ⋮.** Board 13 lists "Give back a payment" in Bill ⋯. Default: Refund stays where
   it is, beside each payment in the payment window (one refund is of one payment), and the ⋮ has
   no Refund. Alternative: a ⋮ item that opens the payment window at its payments list. Changes
   Task 10.
5. **Two filing tests that used combining to merge.** `move-merge.filing.test.ts` has two cases
   (`:300-331`, `:333-`) that check a merged bill files one sale covering both tables. Combining no
   longer merges, so the default re-creates the merge with the explicit Merge command right after
   the join or move, leaving every `expect` exactly as it is. Alternative: leave the file untouched
   and drop the cases (not offered by the test rule) or keep them red (blocks landing). Changes
   Task 3 only.
6. **A paid bill on screen.** Default: the switcher lists paid bills and choosing one puts it on
   screen (as A1233 suggests), where the ⋮ offers Name this bill and Receipt copy, and New order
   refuses as it does for a paid bill today (`bill.paid`, `apps/till/src/state/draft-sync.ts:471-480`).
   Alternative: paid bills in the list are not choosable. Changes Task 9.

## Task 0: preflight and reservations (no commit, ≈10 calls)

- [ ] `git -C /Users/clintongormley/workspace/worktrees/waitron-feat-a803-3-bill-switcher status --short`
      clean apart from this plan's commit; `git log -1`. If main moved, rebase and re-resolve each
      line in the code map a task touches.
- [ ] Ledger: lane C's `item-a803-3-ledger.md` (the queue names it), `Status: in progress`, base
      sha, the owner-question defaults in force.
- [ ] Reservations: `grep -n 'A739\|A773\|A797\|A738\|A796\|A696\|A802' ~/waitron-campaign*/queue.md`;
      `gh pr list --state open --json number,title,headRefName,files`. Known: lane E's parked
      `feat/a696-startup-zone-validation` changes `bill-actions.ts` (`splitBill` gains an admission
      argument), `till-api.ts`, `working-order.ts` and till `i18n/strings.ts` — different functions
      from this slice's; whoever lands second rebases; do not wait. Lane F's parked
      `feat/a739-payment-window` (3e45abdc6) is a read-only reference, not a live branch. H1: no
      other PR of lane C is parked (a migration-adding item may start).
- [ ] Baselines, each separately, recording the Tests counts: S, H2, F, G, words and codes.

## Task 1: `createPartyBill` and `POST /api/parties/:id/bills` (≈40 calls)

**Files.** `apps/server/src/parties.ts` (new `createPartyBill` beside `partyMainBill`, which stays
until Task 6b); `apps/server/src/till-api.ts` (route beside `GET /api/parties/:id/bills` `:3178`,
modelled on `PUT /api/parties/:id/name` `:3023-3040`: session `take-orders`, `requirePartyParam`,
`requireRevision(body.expectedPartyRevision, …)`, `checkZones(tx, deps.cfg, session, [{ partyId }])`,
`catchUpFloor(tx)` as split-table does `:3152`); tests `apps/server/src/party-bill-create.test.ts`
(new), `apps/server/src/till-api.parties.test.ts`, rows in `till-api.profile-actions.test.ts`
(table at `:112-114`, case list near `:439`) and `till-api.profile-zones.test.ts` (table `:164-167`,
list near `:934-941`).

- [ ] Cases `A803 create bill:` (domain, `useVenueDb`): "makes an empty open bill on the party
      numbered next after its highest number, in the party's zone, and moves the revision by one";
      "after Bill 2 was merged away the new bill is Bill 3" (slice 2's history rule); "a stale
      revision refuses `party.out_of_date` and writes nothing" (compare `working_orders`,
      `bill_identities`, `bill_number_allocations` and the party row before and after, outside the
      failed transaction); "a closed party refuses `party.not_open`, writing nothing"; "two
      requests with the same revision: the second refuses `party.out_of_date` and only one bill
      exists". Route cases `A803 create bill route:` answer `{ billId, revision }` (200), 400 on a
      missing or malformed revision, 401 without a session, `party.not_open` for a malformed party
      id; profile-action row (`take-orders`) and profile-zone row (a party outside the device's
      zones is refused) — new rows only.
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-bill-create.test.ts src/till-api.parties.test.ts src/till-api.profile-actions.test.ts src/till-api.profile-zones.test.ts -t 'A803|bills'`.
      The domain cases fail on the missing export as the first red; once a stub returns nothing,
      they must fail on the bill/revision assertions; the route cases on a 404 status.
- [ ] Implement (D1). No submission replay: the revision guard is what stops a resend making two
      bills (case 5), as for every other party command that takes `expectedPartyRevision`.
- [ ] GREEN: the four files unfiltered; F; `pnpm --filter @waitron/server typecheck`.
- [ ] Commit: "Let the till ask for a new empty bill at a table".

## Task 2: Move this bill never merges on arrival (≈60 calls)

**Files.** `apps/server/src/move-bill.ts` (`MoveBillOptions.bills` `:73` and `MoveBillResult.merged`
`:85` go; merge decision `:191-201`, `mergingEdits` `:203-206`, merge arm `:303-312` go, so a
seated arrival always takes `allocateBillNumber` and `moveBillDraftsToParty` as the not-merging arm
does `:313-317`; `refuseMainBillLeaving` `:515-535` and its call `:222` go; `isUntouched`/`readBillState`
`:549-570` go; `readMainBill` stays only for `if (main === null && open) await setMainBill(...)`
`:319` and `:286`, removed in 6b); `apps/server/src/till-api.ts` (`moveCommand` `:908-923` stops
reading `bills`; `requireBillChoice` stays for `tableActionCommand` until Task 4); tests
`party-move-bill.test.ts` (helper `move()` `:122-133` loses `bills`), `till-api.move-bill.test.ts`,
`bill-identities.test.ts` (move helper `:256`), `order-drafts.db.test.ts:4863`, and every other
file in `rg -l "moveBill\(|/move\b" apps/server/src -g '*.test.ts'` whose red run changes (each
listed in the receipt).

- [ ] New cases `A803 no main bill (move):` in `party-move-bill.test.ts`: "a bill moved to a seated
      table with an untouched bill of the same service mode arrives as its own bill with the next
      number, and the receiving bill is unchanged" (this is the case the merge would have caught:
      both untouched, one mode); "a party's first bill can move away while it holds other unpaid
      bills"; "a counter order moved to a seated table stays its own bill"; "the answer is
      `{ partyId, billId }` with no `merged` key" (`toEqual`); "a request still carrying `bills:
      \"merge\"` is served the same way" (route, D13).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-move-bill.test.ts src/till-api.move-bill.test.ts -t 'A803 no main bill'`.
      Expect the first case to fail on the receiving bill's lines (the merge moved them) and the
      second on `party.main_bill_stays`.
- [ ] Implement. Then run every file the trace lists: `pnpm --filter @waitron/server exec vitest run $(rg -l 'moveBill\(|/api/bills/.*/move|bills: "merge"' apps/server/src -g '*.test.ts' | sed 's#apps/server/##')`
      (zsh: split the list with `${=…}` or `xargs`). Each red assertion is either in the Changed
      test checks rows for Task 2 (change it as that row says) or a stop.
- [ ] GREEN: that list unfiltered; F; H2; server typecheck.
- [ ] Commit: "Move this bill keeps the bill separate at its new table".

## Task 3: Join and Move guests keep every bill (≈70 calls)

**Files.** `apps/server/src/table-actions.ts` (`combineParties` `:246-363`: the `merging` decision
`:276-288`, `requireBillEditors` for the merge `:289-294`, `fromMainState` and the merge block
`:296-328` go; bills move with `takeIntoParty` as today `:298-303`; `rescopeBillNumbers` stays after
the move `:331`; `moveDraftsToParty` takes every moving bill's edits; `mergedInto` goes, so
`combineAt`'s slip mapping `:224-225` goes; the answer keeps today's shape with `merged: false`
until Task 4); `apps/server/src/working-order.ts:3980-3990` (`serviceModesMatch` deleted, D12);
tests `party-table-actions.test.ts` (helper `opts` `:87-100` default becomes no merge),
`table-actions.refund-pending.test.ts`, `order-drafts.db.test.ts` (`merge()` helper `:3418-3427`),
`bill-identities.test.ts:595`, `move-merge.test.ts:493`, `move-merge.filing.test.ts` (Owner
question 5), and every other file in the trace whose red run changes.

- [ ] New cases `A803 no main bill (join):` in `party-table-actions.test.ts`: "joining a seated
      table whose party has an untouched bill of the same mode keeps both parties' bills, each with
      its own number and lines" (both untouched, one mode — the merging case); "Move guests onto a
      seated table keeps every bill and every payment on its own bill" (pay part of one bill first;
      compare `bill_payments` rows by bill before and after); "the kitchen hears only that dishes
      moved table, never a merge" (moved notices only).
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-table-actions.test.ts -t 'A803 no main bill'`
      — fails on the receiving party's bill count (merged to one).
- [ ] Implement; `move-merge.filing.test.ts` gets its kind-S setup change only (Owner question 5).
- [ ] Run every file in `rg -l 'joinTables\(|moveGuests\(|combineParties\(|/api/parties/.*/(join|move)|bills: "merge"|bills = "merge"' apps/server/src -g '*.test.ts'`;
      each red assertion is a listed row or a stop.
- [ ] GREEN: that list; F; H2; `git diff a90f4f87b -- apps/server/src/move-merge.filing.test.ts | grep '^[-+].*expect'`
      prints nothing; server typecheck.
- [ ] Commit: "Joining or moving guests keeps every bill separate".

## Task 4: action answers name their bills; Split a table takes any bill; `bills` retired (≈70 calls)

**Files.** `table-actions.ts` (`TableActionOptions.bills` `:59`, `TableActionResult` `:67-71` →
`{ partyId: string; billIds: string[] }`, `CombineResult` `:73-78` gone and `combineParties` returns
`void`; `moveGuests`/`joinTables`/`combineAt` answer the destination party's shown bill ids in
number order (a small `partyBillIds(tx, partyId)` beside `readPartyBillIds`), creating one empty bill
first when there is none (D1); `splitTable` `:380-455` answers `{ partyId; billId }`: the chosen bill,
or a new empty bill on the new party (replacing `partyMainBill(... "moved")` `:428`), and an empty
bill on the staying party when it is left with none; `refuseUnsplittableBill` loses its main-bill
rule `:476` and its parameter); `till-api.ts` (`requireBillChoice` `:882-886` and its uses go;
`tableActionCommand` `:929-938`; seat route `:2858-2866`; `STATUS` `party.main_bill_stays` `:606`);
`floor-today-merges.ts:137-144`; `errors.ts:481-486` (the code goes, D14); `testing/party-venue.ts:313`;
the mechanical `bills` sweep: delete every `bills: "merge" | "separate"` property and `bills`
helper parameter left in `apps/server/src` (≈70 files, finding 4) — a property deletion, no other
edit, so a file whose behaviour changed was already handled in Tasks 2–3. Tests
`till-api.table-actions.test.ts`, `till-api.today-joins.test.ts`, `floor-today-flatten.test.ts`,
`party-table-actions.test.ts` split cases, `table-actions.refund-pending.test.ts` shapes.

- [ ] New cases `A803 action results:` in `till-api.table-actions.test.ts`: exact `toEqual` answers
      for Move guests to a free table, Join a free table, Move guests onto a seated table, Join a
      seated table (each `{ partyId, billIds }` in number order, plus `zoneRevisions` exactly where
      today's answer has them); "split a table giving away the party's first bill answers that
      bill, which is Bill 1 at the new party, and the staying party keeps its others"; "split with
      no bill answers one new empty bill, and the staying party is unchanged"; "split taking the
      staying party's only unpaid bill, with no other bill left, leaves the staying party one new
      empty bill" (D1); "a party with no bill that joins a free table answers one new empty bill,
      not two" (seed by moving its only bill to the counter); "no answer carries `mainBillId` or
      `merged`".
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/till-api.table-actions.test.ts -t 'A803 action results'`
      — fails on the answer shape (`mainBillId` present) and on `party.main_bill_stays`.
- [ ] Implement; sweep; then the trace's files (as Task 3's run, plus `rg -l 'splitTable\(|split-table' apps/server/src -g '*.test.ts'`).
- [ ] GREEN: those files; `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/alert-codes.test.ts`;
      F; H2; server typecheck; `rg -n 'bills: "(merge|separate)"|requireBillChoice|party\.main_bill_stays' apps/server packages`
      prints nothing.
- [ ] Commit: "Table actions answer the bills they leave, and Split a table takes any bill".

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
- [ ] Commit: "List a party's bills in number order on the server".

## Task 6a: the test helpers stop relying on the main bill (≈45 calls)

**Files.** `apps/server/src/testing/group-submit-fixture.ts` (`observation` `:27-36`: with no
`billId`, the party's lowest-numbered open bill, else a bill made with `createPartyBill` at the
party's current revision, moving it as `partyMainBill(... "moved")` did when the caller's command
moves it; `observedGroupSubmitBody` `:135-157`: the lowest-numbered open bill by a read of
`bill_identities`/`working_orders`, not `parties.mainBillId`); `testing/draft-command-fixture.ts:141-148`
(same read); `testing/serve-line.ts:41` (`setMainBill` call goes: seating's bill is found by number);
`testing/bill-venue.ts:466` (comment). New `apps/server/src/testing/party-bill-of.ts` exporting
`firstOpenBillOf(tx, partyId)` used by all three, with its own test.

- [ ] Case `A803 fixtures:` in `apps/server/src/testing/party-bill-of.test.ts`: "names the
      lowest-numbered open bill, skipping paid and presented ones", "names none for a party whose
      bills are all paid".
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/testing/party-bill-of.test.ts`.
- [ ] Implement; the main bill still exists, so nothing else may change: run
      `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts src/order-groups.test.ts src/order-drafts.db.test.ts src/till-api.drafts.test.ts src/party-arriving-dishes.test.ts src/served.test.ts`
      and every file importing `group-submit-fixture` whose cases send without a bill
      (`rg -l 'orderForParty\(|observedGroupSubmitBody|observedDraftCommandBody' apps/server/src -g '*.test.ts'`).
      Any red case is a stop for this task (the helper changed what a test sends).
- [ ] Commit: "Server test helpers find a party's bill by number".

## Task 6b: the server retires the main bill (≈65 calls)

**Files.** `parties.ts` (`seatTable` `:135`, `partyMainBill` `:153-194`, `setMainBill` `:196-207`,
`readMainBill` `:209-216` go; `moduleCoreServices` unchanged); `table-actions.ts` (`readMainBill`
imports and calls, `:127`, `:191`, `:326`, `:406`, `:449`); `move-bill.ts` (`:191`, `:286`, `:319`,
`SourceParty.mainBillId` `:498`, `:504`); `bill-actions.ts` (`:209` comment, `:237-282` `known.mainBillId`
and `setMainBill`); `working-order.ts` (`TableParty.mainBillId` `:8601` → `openingBillId` with D7's
rule and a comment that nothing writes to it; `:9017`, `:9066`); `packages/bookings/src/testing/fake-core.ts:5`
(sentence goes); tests `party-main-bill.test.ts` (rewrite, Changed test checks),
`party-bill-actions.test.ts:690`, `:736`, `parties.test.ts`, `till-api.parties.test.ts`, the remaining
`mainBillId` reads in the 19 server test files (trace), and `order-drafts.db.test.ts:1048`.

- [ ] New cases `A803 no main bill:` in `party-main-bill.test.ts` (Review focus 4): "a seated
      table's floor row names Bill 1 as the bill it opens on"; "after the only bill is paid the
      floor row names it, and an order needs a bill made with `createPartyBill`"; "a send naming a
      bill that has since moved to another party refuses `bill.other_party`, and no line, draft or
      bill is written" (rows compared outside the failed transaction); "a send naming a bill of this
      party that is not the lowest-numbered lands on exactly that bill"; "the floor row opens on the
      lowest-numbered owing bill, else the highest-numbered shown bill".
- [ ] RED: `pnpm --filter @waitron/server exec vitest run src/party-main-bill.test.ts -t 'A803 no main bill'`
      — fails on `openingBillId` (undefined).
- [ ] Implement; rewrite the main-bill cases (Changed test checks); run the trace's 19 files and
      `rg -l 'readSeatedParties|listTablesWithState|/api/tables/state' apps/server/src -g '*.test.ts'`.
- [ ] GREEN: those files; F; H2; server typecheck;
      `rg -n 'mainBillId|partyMainBill|setMainBill|readMainBill' apps/server packages --glob '!**/drizzle/**'`
      prints only `packages/db/src/schema/parties.ts` (Task 7).
- [ ] Commit: "The server keeps no main bill; the floor names the bill a table opens on".

## Task 7: the migration that drops `parties.main_bill_id` (venue reset) (≈45 calls)

**Files.** New custom migration first: `pnpm --filter @waitron/db db:generate:custom --name retire_main_bill_triggers`,
then write in it only `DROP TRIGGER working_orders_release_main_bill;` and `DROP TRIGGER
working_orders_release_main_bill_on_move;` with a two-line header (why: the next migration rebuilds
`parties`, which their bodies name; nothing replaces them). Then `packages/db/src/schema/parties.ts:46-50`
(column, its comment and now-unused imports go) and `pnpm --filter @waitron/db db:generate --name retire_main_bill`.
Read the generated SQL: it must be finding 9's rebuild of `parties` only, with no other table; never
hand-edit it. Guard pins (kind W/B rows for Task 7): `scripts/behavioural-triggers.test.ts`,
`scripts/migration-upgrade.test.ts` `RESETS`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`.
Prose: `packages/db/README.md:88-95` (a dated sentence that the triggers and column were retired by
the new files); `docs/developers/conventions-data.md:3512-3513` list gains the new custom file
(and its date in the dated list `:3570`).

- [ ] Write the behavioural-triggers describe's new case first ("the main bill is gone": no
      `main_bill_id` in `pragma_table_info('parties')`, no trigger whose `sql` contains `main_bill`).
- [ ] RED: `pnpm exec vitest run scripts/behavioural-triggers.test.ts -t 'main bill'` — fails on the
      column still present.
- [ ] Generate both migrations; apply the W rows.
- [ ] GREEN: S (all three commands; `migration-upgrade` with its new `RESETS` row; confirm the
      refusal text by its own output); H2; F;
      `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/canvas-retirement-upgrade.test.ts`;
      `pnpm --filter @waitron/db exec vitest run src/schema/parties.test.ts`;
      `rg -n 'main_bill|mainBill' packages apps/server --glob '!**/drizzle/**' --glob '!**/test-fixtures/**'`
      prints only the dated README sentence.
- [ ] Commit: "Drop the main bill column and its triggers (venue reset needed)". Body: the rebuild
      and why the triggers go first; the children of `parties` and that the rebuild fails on a box
      with a seated party; the `RESETS` row; no data migration (pre-live).

## Task 8a: the till sends no `bills` and reads the new answers (≈70 calls)

**Files.** `apps/till/src/api/client.ts` (`TableActionResult` `:2185-2191` → `{ partyId; billIds }`;
`MoveBillResult` `:2213-2218` loses `merged`; split result `:4665-4668` → `billId`; `moveGuests`,
`moveBill`, `moveBillAllergyPreview`, `joinTables` drop their `bills` parameter `:4419-4499`; doc
comments `:2185-2186`, `:2213`, `:4420`); `apps/till/src/till-app.ts` (Move guests answer
`:14806-14813`, split follow `:15401-15409` and `#billAfterMove` `:14893-14902` follow D11 using the
answer's ids; `#sayBillsKeptApart` `:15324-15332` and its calls `:14817`, `:14889`, `:15321` go);
`apps/till/src/screens/till-table-order-screen.ts` (`#pickTable` `:4860-4867` sends at once,
`#sendTableAction`/`#moveBillToCounter` `:4869-4900` send no `bills`, `#onBillChoice`/`#billChoiceDialog`
`:4902-4932` and `billChoice` state go); tests `api/client.test.ts`, `till-app-parties.test.ts`,
`till-app-table-service.test.ts`, `till-table-order-screen.test.ts`, `till-app-allergy.move.test.ts`
(those the trace's `"merge"|"separate"` list names).

- [ ] Cases `A803 action results` in `api/client.test.ts` (the request bodies of the four calls
      carry no `bills`; the parsed answers) and `till-app-table-service.test.ts` (after Join, Move
      guests, Split a table and Move this bill: the bill on screen is chosen by D11, and the next
      `saveDraft` request's `billId` equals that id — Review focus 4); `A803 no merge question` in
      `till-table-order-screen.test.ts` (picking a seated table dispatches at once, with no dialog).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/api/client.test.ts src/till-app-table-service.test.ts src/screens/till-table-order-screen.test.ts -t 'A803'`.
- [ ] Implement; run the trace's till files.
- [ ] GREEN: those files unfiltered; till typecheck may still fail only on `TableParty.mainBillId`
      (Task 8c) and the floor/held-orders callers (Task 8b): record its output in the ledger.
- [ ] Commit: "The till asks no merge question on joins and moves".

## Task 8b: the floor and parked orders ask no merge question; the dialog goes (≈45 calls)

**Files.** `apps/till/src/screens/till-floor-screen.ts` (`:53`, `:67`, `:978`, `#join` `:1658-1691`,
dialog `:2198-2204`); `apps/till/src/widgets/held-orders.ts` (`:20-32`, `#send` `:220`, `#billChoice`
`:348-361`, `:381`); delete `widgets/bill-choice-dialog.ts`, `.test.ts`, `.a11y.test.ts`;
`i18n/strings.ts` retired keys (D10); tests `till-floor-screen.today-joins.test.ts`,
`widgets/held-orders.test.ts`, `held-orders.a11y.test.ts`.

- [ ] Cases `A803 no merge question`: the floor's drop of a table onto a seated table calls
      `joinTables` once with no `bills` and draws no dialog; moving a parked order to a seated table
      calls `moveBill` with no `bills` and draws no dialog.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-floor-screen.today-joins.test.ts src/widgets/held-orders.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: both files and `held-orders.a11y.test.ts` unfiltered; `rg -n 'bill-choice|BillChoiceDetail|bills_question|bills_merge|bills_separate|bills_kept_separate|bill_move_question' apps/till/src`
      prints nothing; till typecheck fails only on `mainBillId` (8c).
- [ ] Commit: "Retire the merge question everywhere in the till".

## Task 8c: the till opens and follows bills without a main bill (≈60 calls)

**Files.** `api/client.ts` (`TableParty.mainBillId` `:2109-2110` → `openingBillId: string | null`;
new `createPartyBill(partyId, expectedPartyRevision): Promise<{ billId: string; revision: number }>`
→ `POST /api/parties/:id/bills`; split doc `:4656`, `:4439`); `till-app.ts` (open `:11002-11015`
uses `openingBillId`, else D11's creation; seat `:11045`; find-tab follow `:12082` follows the draft's
own bill; `billToOpen` `:696-700` kept for the after-action rules; `TABLE_REFUSALS` `:614` loses
`party.main_bill_stays`; a private `#ensureBill()` implementing D11's last step); screen
`#splitTableBills` `:5029-5037` (any owing bill of this party); `i18n/codes.ts:294-297`; tests
`till-app-open-table.test.ts`, `till-app-parties.test.ts`, `till-app-drafts.test.ts:8720`,
`api/client.test.ts`, `i18n/codes.test.ts:323-333`.

- [ ] Cases `A803 opening bill` in `till-app-open-table.test.ts`: opening a seated table shows
      `openingBillId` with one bills request at most and lines in parallel (count the requests);
      a party whose floor row names no bill gets exactly one `createPartyBill` call and shows its
      answer; `A803 action results` in `till-app-parties.test.ts`: Split a table choosing the bill
      on screen leaves the screen on the staying party's lowest-numbered owing bill, and the next
      draft request names it.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/till-app-open-table.test.ts src/till-app-parties.test.ts -t 'A803'`.
- [ ] Implement; the Changed test checks rows for 8c.
- [ ] GREEN: the five files unfiltered; till typecheck fails only on the fixture files of 8d.
- [ ] Commit: "The till opens a table on the bill the floor names, and makes a bill only by asking".

## Task 8d: till fixtures lose `mainBillId` (mechanical, ≈35 calls)

**Files.** The 67 till test files and 3 helpers that carry `mainBillId:` (trace). Delete each
`mainBillId: …,` line in a party literal (a script over `rg -l`), then add `openingBillId: <same id>`
only where a case's red run shows it opened a bill through it. No assertion changes.

- [ ] Run the till package's test files that changed: `pnpm --filter @waitron/till exec vitest run $(git diff --name-only HEAD -- apps/till | sed 's#apps/till/##' | grep test.ts)`
      (zsh: `${=…}`); every case green.
- [ ] GREEN: `pnpm --filter @waitron/till typecheck` passes (first time since 8a);
      `rg -n 'mainBillId' apps/till` prints nothing.
- [ ] Commit: "Till test fixtures drop the main bill".

## Task 9: the bill switcher with + New bill (≈70 calls)

**Files.** New `apps/till/src/screens/table-bill-controls.ts` (`billSwitcher(...)`,
`billRowContent(...)`, short-label helper beside `billName` in `state/bill-state.ts`); the screen
renders the switcher in the panel head where the Tab button sat (`:2369`), on every width and on
handheld; events `switch-bill` `{ workingOrderId }` and `new-bill` `{}` (`bubbles`, `composed`;
app-owned names, root `CLAUDE.md` §3); `till-app.ts` handlers: `switch-bill` reuses
`#onTakePayment`'s flush-then-switch body (`:16870-16886`, renamed `#onSwitchBill`; `take-payment`
stays bound for the finish refusal); `new-bill` flushes the draft, calls `createPartyBill` with the
party's revision, notes the answer's revision, reloads the party's bills and shows the new bill; a
refusal goes through `#onTableRefusal` like other party commands (`party.out_of_date` reloads and
says so); `i18n/strings.ts` `table.bill_count`, `table.new_bill` (EN and the ES proposals); tests
new `screens/till-table-order-screen.bill-switcher.test.ts`, `till-app-table-service.test.ts`,
new `screens/till-table-order-screen.bill-controls.a11y.test.ts`.

- [ ] Screen cases `A803 switcher`: one bill → the closed label "Bill 1 · €38.50" and the open list
      holds that bill and "+ New bill"; three bills → "Bill 1 of 3 · €67.00", rows in number order
      with what each owes, "Paid" for a paid one, a name "Bill 2 · Clint", and "Ana has an unsent
      order: 3 items" under the bill Ana has unsent dishes on; after Bill 2 is merged away the list
      shows Bill 1 and Bill 3 and the closed label says "of 2" (a count, not the highest number);
      choosing Bill 3 dispatches `switch-bill` with Bill 3's id (never an index); "+ New bill"
      dispatches `new-bill`; an unnumbered bill reads "Bill" (slice 2's owner answer 5).
- [ ] App cases `A803 new bill`: "+ New bill" calls `createPartyBill(partyId, revision)` once,
      shows the answered bill, and the next draft save names it; a stale revision shows the party
      refusal and creates nothing; switching to a paid bill shows it and New order refuses as
      `bill.paid` (Owner question 6).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-switcher.test.ts src/till-app-table-service.test.ts -t 'A803'`
      — the screen cases fail on the missing switcher (the assertion, after the file mounts the
      screen), the app cases on no `createPartyBill` request.
- [ ] a11y: `till-table-order-screen.bill-controls.a11y.test.ts` covers the switcher closed and open,
      one bill and three, a paid row and an editor row, in light and dark; run with
      `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.bill-controls.a11y.test.ts`.
- [ ] GREEN: the three files; `till-table-order-screen.parties.test.ts`, `till-table-order-screen.test.ts`; till typecheck.
- [ ] Commit: "A bill switcher with + New bill on every table, even with one bill".

## Task 10: one ⋮ menu: the bill on screen, then the whole table (≈65 calls)

**Files.** `table-bill-controls.ts` (`tableMenu(...)`); the screen: `#actionSection`'s `closed` and
`menu` steps (`:5406-5488`) become the ⋮ (D4), which carries `data-move-split`; items keep their
`data-action` names; Receipt copy, Cancel and credit, Bill requested and Finish table move in from
`#billRow`/`#billsSection` with their existing events; the Full invoice item (D8) dispatches
`choose-bill-invoice`; focus returns to the ⋮ trigger after the naming, guests and split-guests
windows close (A1234); `i18n/strings.ts` `table.whole_table`; tests new
`screens/till-table-order-screen.table-menu.test.ts`, `till-table-order-screen.test.ts` (`:713`,
`:4231`, `:6704` kind R), `till-table-order-screen.actions-unsaved.test.ts`,
`till-table-order-screen.parties.test.ts`, `bill-controls.a11y.test.ts` (menu states), and
`till-app-bill-payments.test.ts` (invoice entry).

- [ ] Cases `A803 single menu`: exactly one ⋮ on the screen and no "Table actions" button; its
      first group is named "Bill 2 · Clint" and lists, for an open owing bill with full invoices on,
      Name this bill, Split by item, Transfer items, Merge bills, Move this bill, Full invoice, in
      that order; its second group is named "Whole table" and lists Guests, Name the party,
      Allergies, Mark bill requested, Split a table (two tables only), Join a table, Move guests,
      Finish table; a paid bill with a receipt shows Name this bill and Receipt copy and no Full
      invoice; a presented bill with a receipt and no payments shows Cancel and credit; with no bill
      on screen the bill group is absent; Full invoice is absent while `fullInvoices` is false.
- [ ] Cases `A803 invoice entry` in `till-app-bill-payments.test.ts`: the ⋮ Full invoice and the pay
      step's Full invoice open the same recipient editor for the same bill and revision; a paid bill
      offers none and the test asserts no `setOrderInvoiceChoice` (or any issuance or correction)
      request is made (finding 7, D8).
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.table-menu.test.ts src/till-app-bill-payments.test.ts -t 'A803'`.
- [ ] Implement; re-point the kind-R checks.
- [ ] GREEN: those files and `till-table-order-screen.test.ts`, `.actions-unsaved.test.ts`,
      `.parties.test.ts`, `.allergy.test.ts`, `.bill-controls.a11y.test.ts`; till typecheck.
- [ ] Commit: "One ⋮ menu for the bill on screen and the whole table".

## Task 11a: the Tab button and drawer go (screen and screen tests) (≈75 calls)

**Files.** The screen: Tab button `:2369-2381`, `drawerOpen` `:1192`, `#toggleDrawer` `:2271`,
`#drawer` `:4034-4046`, `#billsSection`/`#billRow`/`#takePayment` `:4248-4399` go; the action panel
shows in the side column only while a step is open (D9); the foot gains the table's still-to-pay
under the bill's total and, when `finishRefused`, the refusal with Take payment and Record unpaid
departure above it (D9); `i18n/strings.ts` `table.open_drawer` goes; the screen test files that open
the drawer (trace; ≈20 files under `screens/`, including the `*-retirement`, `.a11y`, `.loading`,
`.empty-drawer.a11y`, `.populated-drawer.a11y`, `.current-orders`, `.sent*`, `.adjustments*`,
`.bill-payments*`, `.panel-footer` files and `sent.test-helpers.ts`) re-pointed (kind R). If the
sweep passes ~60 calls, commit at a green file boundary and hand over (11a-2).

- [ ] Cases `A803 no tab panel` in `till-table-order-screen.panel-footer.test.ts`: no Tab button at
      any width; the foot shows this bill's total, then "Still to pay at this table" with the party's
      outstanding, then Pay; Finish table refused shows the refusal with Take payment for the first
      other unpaid bill above the foot; choosing Move guests in the ⋮ shows the table picker in the
      side column and Back closes it.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts -t 'A803 no tab panel'`.
- [ ] Implement; sweep the screen files: run each re-pointed file red-then-green; record each changed
      check (file:line, what it opened before, what it opens now).
- [ ] GREEN: `pnpm --filter @waitron/till exec vitest run $(rg -l 'till-table-order-screen' apps/till/src/screens -g '*.test.ts' | sed 's#apps/till/##')`;
      `rg -n 'data-open-drawer|drawerOpen|open_drawer' apps/till/src/screens` prints nothing; till typecheck.
- [ ] Commit: "The table screen loses the Tab button: bills in the switcher, actions in the ⋮".

## Task 11b: app tests that opened the drawer (≈45 calls)

**Files.** `till-app-parties.test.ts` (25 sites), `till-app-adjustments.test.ts`,
`till-app-bill-payments.test.ts`, `till-app-drafts.test.ts`, `till-app-table-service.test.ts`,
`till-app.test.ts`, `till-app-menu-refresh.test.ts`, `till-app-handheld-pay.test.ts`,
`screens/till-paid-view.test.ts` (trace). Kind R only; a helper `openTableMenu(el)` /
`openBillSwitcher(el)` in `apps/till/test/` if three or more files need it.

- [ ] RED (before any edit, to list the sites): `pnpm --filter @waitron/till exec vitest run src/till-app-parties.test.ts src/till-app-adjustments.test.ts src/till-app-bill-payments.test.ts src/till-app-drafts.test.ts src/till-app-table-service.test.ts src/till-app.test.ts src/till-app-menu-refresh.test.ts src/till-app-handheld-pay.test.ts src/screens/till-paid-view.test.ts`
      — the failures are the missing `data-open-drawer` element.
- [ ] Re-point each; GREEN: the same command; `rg -n 'data-open-drawer' apps/till` prints nothing.
- [ ] Commit: "Till app tests reach bills and actions through the switcher and the ⋮".

## Task 12: the table's foot: no Hold, quiet Pay, one Full invoice (≈55 calls)

**Files.** `widgets/tender-pay.ts` (properties `parks` default `true`, `invoices` default `true`,
`payQuiet` default `false`; with `payQuiet` Cash and Card are `secondary`, enabled, and a tap
dispatches `pay-quiet-tap` and nothing else; Hold drawn only with `parks`; `#renderInvoiceButton`
only with `invoices`); the screen (`parks=false`, `invoices=false`, `payQuiet=${unsent}`; the pay
ways, Pay the rest and the handheld Pay follow D5; `#onTenderPark` goes; a `role="alert"` line in
the pay section shows `billUnsentText(label)` after a quiet tap, cleared when the bill or its unsent
state changes); tests `till-table-order-screen.panel-footer.test.ts` (`:29-54`, `:127-150`),
`till-table-order-screen.test.ts:694`, `widgets/tender-pay.test.ts` (counter defaults unchanged),
`till-table-order-screen.bill-payments.test.ts` (handheld), `bill-controls.a11y.test.ts` (quiet Pay
in both themes).

- [ ] Cases `A803 pay scope` in `panel-footer.test.ts`: no Hold on the table screen; one Full invoice
      on the payment step; with an unsent dish in this bill's New order, Cash, Card and each pay way
      are `secondary` and not `disabled`, and a tap on each shows "Bill 1. Send or remove the unsent
      dishes before paying." and dispatches no `pay-tab`/`bill-pay`; the same when the unsent dishes
      are another person's on this bill (`party.unsentDrafts`); NOT quiet when the unsent dishes are
      on Bill 2 only; in Spanish the sentence is «Envía o quita los platos sin enviar antes de
      cobrar.». In `tender-pay.test.ts` `A803 counter unchanged`: with defaults, Park and Full
      invoice are drawn and Cash is primary.
- [ ] RED: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/widgets/tender-pay.test.ts -t 'A803'`.
- [ ] Implement.
- [ ] GREEN: `pnpm --filter @waitron/till exec vitest run src/screens/till-table-order-screen.panel-footer.test.ts src/screens/till-table-order-screen.actions-unsaved.test.ts src/widgets/bill-pay-dialog.unsent.test.ts src/widgets/tender-pay.test.ts src/widgets/tender-pay.a11y.test.ts src/screens/till-table-order-screen.bill-payments.test.ts src/screens/till-table-order-screen.bill-controls.a11y.test.ts src/till-app-bill-payments.test.ts src/till-app-handheld-pay.test.ts`;
      `pnpm --filter @waitron/till exec vitest run src/screens/till-counter-screen.test.ts` (the counter keeps Park); till typecheck.
- [ ] Commit: "The table's foot: totals and Pay, quiet while this bill has unsent dishes".

## Task 13: whole-slice run and controls (no commit unless a fixture moves, ≈45 calls)

- [ ] Server: every file the Tasks 1–7 GREEN lines named, in one run per task list. Till:
      `pnpm --filter @waitron/till exec vitest run $(git diff --name-only a90f4f87b -- apps/till | sed 's#apps/till/##' | grep '\.test\.ts$')`.
- [ ] S, F, H2 (byte-unedited, the `git diff` check above), G, words and codes, both typechecks.
- [ ] Proof by deletion, one at a time in the working tree and reverted, each turning the named case
      red for that reason (record each red line in the ledger):
      1. restore the merge arm in `moveBillOnce` → "arrives as its own bill …" (Task 2);
      2. restore the `merging` decision in `combineParties` → "joining a seated table … keeps both" (Task 3);
      3. drop the empty-bill creation in `splitTable` for the staying party → "leaves the staying party
         one new empty bill" (Task 4);
      4. compute `openingBillId` as the first bill in opening order → "the floor row opens on the
         lowest-numbered owing bill" (Task 6b; seed numbers against opening order);
      5. make the till's `new-bill` handler switch to the lowest-numbered bill instead of the answer →
         "the next draft save names it" (Task 9);
      6. count another bill's unsent dishes in D5's rule → "NOT quiet when the unsent dishes are on
         Bill 2 only" (Task 12);
      7. drop `payQuiet`'s tap guard so a quiet Cash tap dispatches → "dispatches no `pay-tab`" (Task 12);
      8. draw the ⋮ Full invoice for a paid bill → "a paid bill offers none … no request" (Task 10).
- [ ] Coverage is CI's (root `CLAUDE.md` §2): after the push, read the `changes` job's `packages`
      output on the PR head (it must name `@waitron/server`, `@waitron/till`, `@waitron/db`) and each
      one's coverage or merge job. Not from this worktree (changed-since matches nothing in a worktree).

## Task 14: guides and the design-system contract (≈35 calls)

- [ ] `apps/server/src/guide/en/table-service.md`: new `## Switch bills {#bill-switcher}` before
      `{#bill-names}` (`:226`): the switcher shows even with one bill; what a row shows (what it owes,
      Paid, a name, who has unsent dishes); + New bill; the ⋮ and its two sections; that joining or
      moving keeps every bill, and Merge bills in the ⋮ joins two; Pay is quiet with this bill's
      unsent dishes and what a tap says; no Hold at a table. `{#bill-names}` `:229-241`: "open
      **Table actions**" → "open **⋮**", and the "except a bill that **Merge the bills** folds into
      this party's main bill" clause goes (`:237-238`). `{#full-invoice}` `:3-23`: Full invoice from
      the payment step or the ⋮ for a bill still to pay; a paid bill's full invoice is a correction
      Waitron does not offer yet (Owner question 2). ES twins with the same ids (`es/table-service.md`,
      `{#bill-names}` `:247-251`), as **proposals** (Owner question 1).
- [ ] `docs/developers/design-system.md`: near the table screen's action bar (`:1028-1048`) a
      "Table screen: bill switcher and ⋮" contract — the closed label, rows, + New bill, the ⋮'s two
      headed groups and item order, the action panel, the foot; and under the button rule
      (`:2801-2825`) the quiet-but-tappable Pay with this bill's unsent dishes (amendment 5) as an
      exception to "quiet while disabled": it is never `disabled`, because its tap explains. Only
      what Tasks 9–12's tests cover.
- [ ] `docs/operations/a760-migration-squash-inventory.md:126-127`: a dated note that the two
      triggers were dropped by the new core files.
- [ ] G; open `/help/en/table-service#bill-switcher` and `/help/es/table-service#bill-switcher`
      during Task 15.
- [ ] Commit: "Guides and design contract: one bill switcher and one ⋮".

## Task 15: LOOK (≈45 calls)

- [ ] Before any reset: `lsof +D <the slot's venue folder>` and `lsof -i :8080`; stop only
      processes this session started. The migration needs a fresh venue:
      `wa-wt reset demo waitron-feat-a803-3-bill-switcher`, then `wa-wt demo waitron-feat-a803-3-bill-switcher`
      (never a bare `pnpm dev`).
- [ ] EN and ES, light and dark, 390 and 1280 px, screenshots outside the repository: a table with
      one bill (closed and open switcher, + New bill); three bills, one paid, one named "Clint", one
      with another waiter's unsent dishes; a long bill name; the ⋮ open for an open, a paid and a
      presented bill; Full invoice from the ⋮ and from Pay; Pay quiet with this bill's unsent dish
      and the sentence after a tap, and not quiet with Bill 2's; join a seated table (bills kept,
      numbers continue); move a bill to a seated table and to the counter; split a table giving the
      first bill; a stale-revision refusal on + New bill and its recovery; Finish table refused with
      Take payment; handheld width; keyboard only through the switcher and the ⋮ (focus returns to
      the trigger), touch targets, native enabled state of the quiet Pay. Physical tills were not
      used; say so.

## Task 16: backlog, PR text, hand-off (≈20 calls)

- [ ] `docs/backlog.md` A803 entry (`:1983-2000`): remove the switcher, kebab, no-Hold, quiet-Pay,
      Full invoice and main-bill clauses; slices 4 and 6 remain. Delete: A1232 (`:2025-2030`, Task
      5), A1233 (`:2032-2036`, Task 9/10), A1234 (`:2038-2042`, Task 10), A786 (`:2323-2326`, D7),
      the duplicate Full invoice entry (`:2488-2492`, D8), the `party.main_bill_stays` wording point
      (`:2944-2945`, `docs/backlog/till.md:899-900`) and the "Keep separate bills wraps" point
      (`:2960`, `docs/backlog/till.md:920-921`). Keep and list in the PR as not this slice's: A1235,
      A1236, A1237, A1238. New entries, numbered from `~/waitron-campaign-shared/next-item-number`
      (read, use, write back): Refund from the ⋮ if Owner question 4 is answered "yes"; the paid-bill
      Full invoice once A802 has a till entry (Owner question 2).
- [ ] Changed-checks receipt outside product source, attached to the PR: every row above with its
      red and green output, plus any found at red runs, and a statement that F and H2 are byte-unedited.
- [ ] PR title: "One bill switcher and one ⋮ at a table; no main bill (A803 slice 3; venue reset
      needed)". First line: "Needs a venue reset: the migration rebuilds `parties` to drop the main
      bill, and fails on a box with a seated table." Then, in plain English: what a waiter sees; that
      joins and moves never merge bills now and Merge bills does it on purpose; the six owner
      questions and their defaults; the three Spanish proposals and the ES guide section; the
      `move-merge.filing.test.ts` setup change with its unchanged `expect`s (Owner question 5); the
      LOOK screenshots; the deletion controls of Task 13; that F and H2 ran unedited.
- [ ] Overlap note in the PR: lane E's `feat/a696-startup-zone-validation` changes other functions
      of `bill-actions.ts`, `till-api.ts`, `working-order.ts` and till `strings.ts`; whoever lands
      second rebases. A739 Cut B will rebuild the pay section this slice edits (D5, D6, D8).
- [ ] Not fiscal code: no sale, invoice number, receipt, `registros_facturacion`, `computeHuella`,
      chain or alta builder changes; F and H2 unedited. The lane lands it under its own rules once
      the owner has answered Owner questions 1 and 5 and CI is green.
- [ ] Ledger `Status: done` for the build; tell the owner the branch is ready for `finish-branch`.

## Against the master plan's slice 3

| Master plan item | Where |
| --- | --- |
| `TableParty` without `mainBillId`; explicit `billId` for orders | Task 6b (D7), finding 1 |
| POST `/api/parties/:id/bills`, `createPartyBill` (server and client) | Tasks 1, 8c (Departures: returns the revision) |
| join/move drop `bills`; incoming bills stay separate | Tasks 2, 3, 4, 8a, 8b |
| split accepts any eligible bill; `billId` answer; explicit empty bill | Task 4 (D1) |
| `MoveBillResult {partyId, billId}`; `TableActionResult {partyId, billIds}`; `CombineResult` | Tasks 2, 4 (Departures) |
| kept selection, else lowest numbered; empty party gets one bill in the same transaction | D1, D11; Tasks 4, 8a, 8c |
| `A803 switcher` | Task 9 |
| `A803 single menu` (rename, Move dishes pending as Split by item/Transfer items, Merge, Move, Full invoice, Refund; table items) | Task 10 (Refund: Owner question 4) |
| `A803 pay scope` | Tasks 11a, 12 |
| `A803 invoice entry` | Tasks 10, 12 (Departures: not in `bill-pay-dialog`) |
| `A803 no main bill` (server) | Tasks 2, 3, 6b |
| `A803 action results` (server, client, app; selected id = next request's id) | Tasks 4, 8a, 8c |
| remove main-bill consumers incl. error registry and prose; strict explicit Merge | Tasks 4, 6b, 7, 8b, 8c, 14 (D12, D14) |
| GREEN files, S, F, G; `bill-switcher.a11y.test.ts` | Tasks 9–13 (`…bill-controls.a11y.test.ts`) |
| EN/ES guides, design-system contract, LOOK | Tasks 14, 15 |
