# A758 — Voids and comps: the rules, the owner's answers, and a page of their own

Status: **design, revised 2026-10-17 with the owner's answers to all eight questions, and on
2026-10-18 for food left on the pass after a table has paid (§3.8), rewritten the same day for the
owner's answer to Q40: the standard cancel with a reason, and a Refund tick per dish. One question
is open, Q43 (§11); the build waits for it.** Backlog entry: `docs/backlog.md` "A758" and
[its detail](../../backlog/till.md#a758-adjustment-reasons-review-the-rules-then-a-page-of-their-own).
Pictures: `docs/backlog/mockups/a758-adjustment-reasons/` (01, 02 and 06 also in dark, `-dark.png`;
06–09 are §3.8's; all drawn in HTML with the dashboard's colour tokens, not screenshots). The first version of this
design (main `ed0be7d89`) asked Q1–Q8, which the campaign numbered Q21–Q28; its pictures 01–09 are
deleted, because every one showed a choice the owner has now made.

**Words.** A **void** takes an item off the bill because it should not be there; the code calls it
`cancel`. A **comp** is the house taking some or all of an item's price off; the code calls a free
item `comp` and a part off `discount_percent` or `discount_amount`. A **reason** is what staff pick
when they do either (`adjustment_reasons`, `packages/adjustments/src/schema/reasons.ts`). "The
kitchen has it" means the dish has been **fired** — sent to the kitchen to be made — or served.

File references are to `main` at `5ade0d4f5` unless they name lane G's branch. **(run)** marks a
result measured on 2026-10-17 by a throwaway test against `apps/server`'s adjustment venue
(`apps/server/src/testing/adjustment-venue.ts`: Burger €12, Bottle €30, Steak €25, Coffee €1.50) on
`c7ebd2fd8`, Node v26.11.1. None of the adjustment files those runs exercised has changed since
(`git log c7ebd2fd8..5ade0d4f5 -- packages/adjustments/src apps/server/src/adjustments-apply.ts
apps/server/src/testing/adjustment-venue.ts` prints nothing). The range does add migrations the test
venue applies (menu periods, photo framing, staffing); I believe them unrelated to adjustments, but
the runs were not repeated. **(read)** marks a conclusion from reading code, not
from running it.

---

## 1. What the owner decided (2026-10-17)

| # | Decision | Was |
|---|---|---|
| D1 | **Two lists per reason: "Who can apply it" and "Who can approve it"**, both chosen with the shared multi-select (`wt-combobox` with `multiple`, design-system.md). Anyone signed in may ask for any reason. Someone on the first list uses it straight away; for anyone else, someone on the second list enters their PIN; someone on the second list asking for it themselves goes straight through. | Q1 (Q21), first answered "just who can approve it", then revised by the owner to two lists |
| D2 | **Every limit is the venue's own**, set per reason. Nothing is written into the code; the €30 and €40 in the examples are examples. | owner, with Q21 |
| D3 | **Above a reason's limit, an approver enters their PIN** (no longer a flat refusal). Up to it, someone on "Who can apply it" goes through alone. The till's "ask a manager" message then becomes true (§2.2). | Q2 (Q22): B |
| D4 | **Two kinds of reason: Void and Comp.** A Comp takes a percentage or an amount off, up to 100%, which is the item given free. One kind per reason; the form shows only that kind's fields; a Comp's "most off one item" counts everything that reason took off that item. | Q3 (Q23), reframed by the owner from three kinds to two |
| D5 | **No separate "give away"**: a 100% comp is the give-away, so the question whether a discount may reach zero falls away. | Q4 (Q24): moot |
| D6 | **The venue's bill-wide limit becomes a euro amount of comps per bill**, set by the venue; past it, someone the venue names approves (§3.5). | Q5 (Q25): B |
| D7 | **"Staff meal" is an ordinary Comp reason, 50% an item.** No record of who ate; the report must show who gave each comp, per reason (§3.7). | Q6 (Q26): A |
| D8 | **A switch on a Void reason: "Ask for approval only once the kitchen has it"**, made consistent with A773-1's Cancel item choices (§3.3). | Q7 (Q27): A |
| D9 | **The starter list as drawn, in Void and Comp terms**, with both lists and limits filled in (§4). | Q8 (Q28): A |
| D10 | **Names people see.** The page is "Voids and comps" (Spanish "Cancelaciones y descuentos"); the kinds and the till's actions are **Void** and **Comp** (Spanish **Cancelar** and **Descuento**). Code names (`cancel`, `comp`, `adjustment`) stay unless renaming one is cheap and clean. A773-1's approved "Cancelar …" strings already match. | owner naming, 14:45 |
| D11 | **A full comp prints "Descuento 100%"** on the Spanish receipt. "Invitación" goes. | owner, receipt wording |
| D12 | **Food left on a paid bill is cancelled with the standard cancel and a reason** (from the list or typed); Finish table warns about dishes not served and offers "Cancel and refund" or "Cancel, no refund", perhaps with a tick per dish — held refunded, prepared not (§3.8; the details are Q43). | Q40, 2026-10-18 |

Kept from the first version, which the owner did not object to: the page sits under **Service**
(A755); a search bar, drag handles and a real **Delete** through `wt-delete-dialog` (no Disable,
no Status column); a venue always keeps at least one Void reason; the migration deletes
switched-off reasons; Square's "left without paying", "paid separately / already paid" and
"training" are not reasons (§5).

---

## 2. How it works today, and what the answers change

### 2.1 Today

A reason (`AdjustmentReason`, `packages/adjustments/src/policy.ts:24-36`) carries a list of actions
(any of cancel, comp, discount_percent, discount_amount), a cap on the percentage off one line
(`maxPercentBp`, counting percentage discounts only, `policy.ts:94-100`), a cap on everything the
reason takes off one bill (`maxAmount`, voids included, `policy.ts:101-106`), the lowest role that
applies it without approval and the lowest that may approve it (`applyRole`, `approverRole`), and
whether a note is required. Roles are a ladder of four: staff, supervisor, manager, admin
(`ROLE_LADDER`, `packages/identity/src/permissions.ts:93-105`); "approve" means "at or above the
approver role" (`approvedBy`, `apps/server/src/adjustments-apply.ts:711-726`).

A venue-wide setting caps a bill's discounts as a **share** of its full price (`maxBillDiscountBp`,
`packages/adjustments/src/settings.ts:5-17`); past it, anyone below a manager needs a manager's PIN
(`billDiscountNeedsManager` and `billCancelNeedsManager`, `policy.ts:133-191`; "manager" is written
into the code at `policy.ts:139`, `:179` and `adjustments-apply.ts:540-541`). Free items do not count
(a comp is never checked against it, `adjustments-apply.ts:532-533`, and earlier comps are left
out of the bill's discount, `shareOf`, `:598-624`). No venue has a limit until someone sets one (`settings.ts:11-16`).

| Today | On the bill | On the receipt (Spanish) | Kitchen |
|---|---|---|---|
| Void (`cancel`) | the item goes | not printed | told |
| Free (`comp`) | stays, priced at zero | the item, then "Invitación -12,00" (`apps/server/src/receipt-document.ts:96`) | not told |
| Percentage off | stays, lower price | "Descuento 50% -6,00" (`receipt-document.ts:97-103`) | not told |
| Amount off | stays, lower price | "Descuento -3,00" (`receipt-document.ts:97`) | not told |

What the kitchen is told comes from `applyAdjustment`'s own description: a cancel tells the kitchen,
a comp or a discount "tells the kitchen nothing" (`adjustments-apply.ts:804-808`) **(read)**.

A new venue gets one reason, "Entry error": cancel, staff apply it, a supervisor approves
(`packages/adjustments/src/provisioning.ts:20-30`).

### 2.2 What the review found, and how the answers settle it

- **An approver nobody asks.** "Entry error" names a supervisor as approver, but nobody is below
  staff. **(run)** Staff voiding a burger under a staff/supervisor reason: `needsApproval: null`;
  the control, a supervisor/manager reason: `needsApproval: manager`. *Settled by D1:* with two
  lists, the approver list is used when someone not on the apply list asks, or above a limit; the
  list page shows both, so an unused approver list is visible as such.
- **A limit nobody could approve past.** The limits refuse before approval is considered
  (`policy.ts:94-106` before `:110-112`). **(run)** A give-away reason capped at €30 a bill, two
  steaks (€50): a manager alone, and staff with a manager's PIN, both got `adjustment.over_limit`;
  the control, one steak: allowed. The till's refusal still says "Choose another reason or ask a
  manager" (`apps/till/src/i18n/codes.ts:565`). *Settled by D3.*
- **Mixed actions leak.** **(run)** Under a reason allowing both discounts, capped at 20% an item,
  staff took a €12 burger to €0 with a €12 amount discount; under one reason capped at 50%, two 50%
  bill discounts and a 50% line discount took a burger 87.5% off, because bill discounts are never
  added up (`packages/adjustments/src/record.ts:101`, `:128-131`). *Settled by D4:* a Comp's item
  limit counts everything the reason took off the item, by percentage, amount or bill comp.
- **Free against 100% off.** **(run)** A complaint about a lone €1.50 coffee under a 20% bill
  limit: as a give-away, no approval; as a 100% discount, `needsApproval: manager`; the same 100%
  discount beside two €25 steaks, no approval. *Settled by D5 and D6:* one kind, and a euro limit
  that does not depend on what else the table ordered.
- **Approval by stage.** The rules never read the dish's stage (`AdjustmentRequest`,
  `policy.ts:40-48`), though each adjustment records it (`stageOf`, `adjustments-apply.ts:280-284`:
  unsent, held, fired, served). **(run)** A supervisor/manager void reason asked by staff:
  `needsApproval: manager` for a held burger and for a fired one. *Settled by D8.*

---

## 3. The new rules

### 3.1 A reason

| Field | Void | Comp |
|---|---|---|
| Kind | Void | Comp |
| Name, in each content language | yes | yes |
| Who can apply it (multi-select of roles) | yes | yes |
| Who can approve it (multi-select of roles) | yes | yes |
| How it can be taken off: Free (100%), A percentage, An amount | — | at least one |
| Most off one item (%) | — | optional; counts everything this reason took off the item: free, percentages, amounts and its share of a comp on the whole bill |
| Most off one bill (€) | optional, "Most voided on one bill": counts only what this reason's voids took off the bill | optional: everything this reason comped on the bill |
| Ask for approval only once the kitchen has it | switch | — |
| Note required | switch | switch |

- **Both role lists** are a `wt-combobox` with `multiple` over today's four roles. Neither may be
  empty: the form marks it and keeps Save disabled, so no reason can leave a venue with nobody able
  to approve it. The closed field names the chosen roles ("Supervisor, Manager, Admin"), or
  "Everyone" when all four are chosen; the screen supplies that text through the combobox's
  `countLabel`. The combobox passes that function only the count, and calls it only when two or
  more are chosen (`packages/ui/src/components/wt-combobox.ts:392`, `:496-500`), so the screen's
  function reads the form's own draft to name the roles.
- **Changing the kind** clears the fields the new kind does not have.
- A limit left empty is **no limit**. Nothing has a value written into the code (D2).
- A Comp whose "most off one item" is under 100% cannot offer Free: the form refuses that pair.

### 3.2 Who may do what — the checks, in order

For one request under one reason, by one person, with an optional approver's PIN:

1. **Not allowed at all:** the reason does not offer what was asked (a Void reason asked to comp, a
   Comp reason without "An amount" asked for an amount), or a required note is missing → refused,
   as today (`adjustment.action_not_allowed`, `adjustment.note_required`).
2. **Does it need the reason's approver?** Yes when the person is not on "Who can apply it", or the
   request goes past one of the reason's limits, or (a Void with the switch on, once the kitchen has
   it) the person is not on "Who can approve it" (§3.3). The approver must be on "Who can approve
   it"; someone on that list asking for it themselves needs nobody.
3. **Does it pass the bill's comp limit?** (Comps only, §3.5.) If so, the approver must instead be
   on the venue's "Who can approve past it" list, which then approves the whole request; someone on
   that list asking themselves needs nobody. This is close to today, where passing the bill limit raises the
   approver to at least a manager (a reason asking for nobody or someone lower is raised to a
   manager; an admin approver stays, `adjustments-apply.ts:539-542`), and it means one PIN is
   always enough.

Worked example (picture 04; the settings are one venue's own). Complaint: Who can apply it
Supervisor, Manager, Admin; Who can approve it Manager, Admin; most off one bill €30. The bill's
comp limit €40, approved past by Manager, Admin. A table of eight; Chuletón at €25.

| Who asks | What | What happens |
|---|---|---|
| Ana, staff | 1 Chuletón free (€25) | not on the apply list → a manager or admin enters their PIN |
| Luis, supervisor | 1 free (€25) | within €30 → goes straight through |
| Luis | 2 free (€50) | past €30 and past the bill's €40 → someone on "Who can approve past it" enters their PIN |
| Marta, manager | 2 free (€50) | on both approval lists → goes straight through |

**The till.** The dialog already lists every reason of the chosen action to whoever is signed in
(`apps/till/src/widgets/adjustment-dialog.ts:349-352`), which is "anyone may ask". What changes is
the approval: today the server answers with one role and the till names it ("A supervisor must
approve this with their PIN.", `apps/till/src/i18n/strings.ts:1018-1021`) and lists everyone at or
above it (`/api/adjustment-approvers`, `apps/server/src/adjustments-api.ts:203-212`). It becomes
"Someone who can approve Complaint must enter their PIN." or "This takes the bill's comps past
€40.00. Someone who can approve past the bill's limit must enter their PIN.", and the picker lists
the people on that list.

### 3.3 Void, and A773-1's Cancel item choices (picture 03)

Lane G's A773-1 replaces the till's Cancel with **Cancel item…**, whose choices depend on where the
dish is and whether the bill is paid (spec `docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md`
§3.9; plan `docs/superpowers/plans/2026-10-16-a773-1-unsent-list.md` Task 20). On lane G's branch
`feat/a773-1-unsent-list` (not yet pushed; read at `ad9026be3` in its worktree), the dialog offers
exactly those (`apps/till/src/widgets/cancel-item-dialog.ts:142-153`), "don't charge" requires a
reason and goes through today's cancel adjustment with its approver
(`apps/server/src/line-cancel.ts:125-127`, `:157-176`), and "still charge" and both paid-bill choices
take no reason and write no adjustment (the `else` branch from `line-cancel.ts:178` writes the line's
service state, kitchen correction slips and revisions) **(read)**.

Under the owner's answer to Q40 (§3.8), every cancel takes a Void reason. Where no money comes off,
the reason is recorded as a void that takes €0.00 off the bill (§3.8, "What records the reason"):

| Where the dish is | The till offers | Void reason? | Its lists and limit | Kitchen | Bill |
|---|---|---|---|---|---|
| New order (not sent) | ✕ removes it | no | — | never had it | line removed |
| Held, or fired but not started; bill unpaid | **Cancel** | yes | yes; the switch applies once fired | told | off |
| Being prepared, ready or served; unpaid | **Cancel, still charge** | **yes** (Q43 f) | the lists and the switch; the limit counts nothing, because nothing comes off | told, marked started | stays, "cancelled, charged" |
| same | **Cancel, don't charge** | yes | yes; the kitchen has it, so the switch applies | told, marked started | off |
| Bill paid, any stage, the table open or finished | **the paid-bill dialog** (§3.8): each dish ticked for a refund or not, reached from Cancel item…, Finish table or the receipt | **yes** | the lists and the switch, by each dish's stage; the limit counts nothing | told | unchanged; the ticked dishes refunded through the refund screen (A737), under `sale.refund` (`apps/server/src/tender-refund-authorization.ts:87`) |

These choices still need the till's own rights (session, device profile, zone and action) under
A773-1; A758 adds nothing to them. A void that takes nothing off appears in the Voids and comps
report as "Void, charged" with €0.00 off (§3.6) and counts towards no reason's limit, because the
limits add up what came off the bill.

**The switch, "Ask for approval only once the kitchen has it".** Off: the two lists apply the same
at every stage. On: before the dish is fired, the reason works as usual (its apply list goes through
alone); once it is fired or served, only the people on "Who can approve it" void it alone, and
anyone else asks one of them. A reason's limit applies at every stage. The stage is the one
`stageOf` already records (`adjustments-apply.ts:280-284`), so "has it" means fired or served, as the
owner's Q27 picture said — not A773-1's "started", which decides only what money choice is offered.
A dish fired but not yet started therefore needs approval under such a reason, though the till
offers only the plain Cancel.

Worked example: "Customer changed mind" (Who can apply it Everyone; Who can approve it Supervisor,
Manager, Admin; switch on). Ana, staff, cancels a held burger: alone. The burger is fired: a
supervisor, manager or admin enters their PIN. It is being cooked: "Cancel, still charge" — a PIN,
as fired, though nothing comes off; "Cancel, don't charge" — a PIN, as fired.

### 3.4 Comp: part or all of the price (picture 05)

- **The till's Comp window** is A773-1's single window for what are today Give away and Discount
  (spec §3.8, there named "Discount…"; under D10 its English name is **Comp…** and its Spanish
  **Descuento…**). It offers Free, % and € as the chosen reason allows. Free stays the stored
  `comp` action and percentages and amounts stay `discount_percent` and `discount_amount`
  (`ADJUSTMENT_ACTIONS`, `policy.ts:10-15`): renaming a stored action means rebuilding the
  append-only `adjustments` table (its action check, `packages/adjustments/src/schema/adjustments.ts:89`),
  so the plan keeps them unless it finds that cheap.
- **What the receipt prints:** every comp prints under its item as a discount. A percentage prints
  "Descuento 50%", an amount "Descuento", as today. **A full comp — Free, 100%, or an amount equal
  to the price — prints "Descuento 100%"** (D11), wherever "Invitación" prints today: the item line
  (`receipt-document.ts:96`), the full invoice's discount rows (`receipt-document.ts:295-296`) and
  the till's on-screen copy (`apps/till/src/screens/till-ticket-view.ts:119`). Catalan, Galician
  and Basque print their existing discount word with "100%" ("Descompte", "Desconto", "Deskontua",
  `packages/country-es/src/receipt-labels.ts:65`, `:104`, `:143`), the same pattern a percentage
  discount already prints in each language (`receipt-document.ts:103`). The `comp` receipt label
  (`receipt-labels.ts:25`, `:64`, `:103`, `:142`, declared in `RECEIPT_LABEL_KEYS`,
  `packages/country/src/country.ts:74`) then has no reader and goes. A comp on the whole
  bill at 100% prints the same words at the bill's foot.
- **The kitchen** is told nothing about any comp, part or full, as today (`adjustments-apply.ts:804-808`).
- **The comp on the whole bill.** Today's "Discount the bill" becomes "Comp the bill", with %, €,
  and 100% for a guest whose whole meal is free. A bill-level row already allows a percentage up to
  100% (`adjustments_percent_ck`, `schema/adjustments.ts:97-101`, with bill-level rows limited to the
  two discount actions, `:111-116`), so the free whole bill is a 100% percentage comp, not a new
  stored action.

### 3.5 The bill's comp limit

One venue setting, on the Voids and comps page (picture 01): **"Most comped on one bill" (€)**,
empty for no limit, and **"Who can approve past it"** (a multi-select of roles, never empty; Manager
and Admin to start). It counts what every comp on the bill took off the items still on it, whatever
the reason; voids do not count (the owner's answer named comps). Someone on the list goes past it
alone; anyone else needs a PIN from someone on it (§3.2 step 3). It replaces today's share
(`maxBillDiscountBp`) and the code's fixed "manager" (`policy.ts:139`, `:179`;
`adjustments-apply.ts:540-541`). Free items now count, because a free item is a comp (D5).

### 3.6 Reports

- **By kind:** two rows, Voids and Comps, replacing today's four (cancel, comp and the two
  discounts: `ACTIONS` in `packages/adjustments/src/dashboard/adjustment-report-screen.ts:31-36`).
- **Each entry** keeps its own words: "Void", "Comp 100%", "Comp 20%", "Comp €3.00", so a full comp
  is told apart from a part one in the list without a separate total. A void that took nothing off
  the bill (§3.8) reads "Void, charged" ("Cancelado, cobrado").
- **By reason** already exists (`packages/adjustments/src/reports.ts:191-214`), and each person's
  own by-reason breakdown too (`PersonAdjustments` extends the totals, `reports.ts:68-76`).

### 3.7 Who gave each comp, per reason (D7)

Each adjustment already stores who asked and who approved (`requested_by`, `approved_by`,
`schema/adjustments.ts:75-76`), and the entries list already shows both columns
(`adjustment-report-screen.ts:656-667`) beside the reason (`:612-617`). What is missing is the view
from the reason: the By reason table gains **Asked by** and **Approved by** (names with counts, as
the people table's Approved by column draws them, `adjustment-report-screen.ts:563-572`), and the
entries list gains a Reason filter, so "Staff meal" lists every staff meal with who gave it and who
approved it. No new stored field.

### 3.8 Food left on the pass after the table has paid (pictures 06–09)

The owner's addition (2026-10-17): a table pays and leaves while some of its food is still on the
pass. The owner's answer to Q40 (2026-10-18), which replaces the first proposal (main `b9eb519e5`):
*"I think we use the standard cancel function, which should include a reason (select from a list or
custom). The only difference is that when you try to finish the table it tells you there are items
that haven't been served, and it asks "Cancel and refund" or "Cancel, no refund". Hmm in fact maybe
we need a list with checkboxes for which to refund. An item that was held we can refund, an item
that was prepared we don't. If we don't refund, they stay on the bill, no?"*

Read on `main` at `2212ff18d` and on lane G's `feat/a773-1-unsent-list` at `ad9026be3` (in its
worktree, not pushed) unless marked **(run)**. "Paid" here means the bill is `settled`.

**Today.**

- **Paying does not end the party.** The paid bill becomes `settled`
  (`apps/server/src/bill-payments.ts:751`) and the party keeps its table. **Finish table** ("Cerrar
  mesa") closes the party and frees the table (`finishTable`, `apps/server/src/parties.ts:677-691`);
  it refuses only while a bill still owes, and does not look at the kitchen. Lane G's version is the
  same in that respect.
- **The dishes stay on the pass after that.** The pass lists every kitchen dish of an order that is
  neither abandoned nor collected (`liveKitchenDish`, `apps/server/src/working-order.ts:7323-7329`),
  and a settled bill is neither. A **held** dish — its group held back, not yet fired — is on the
  pass too, greyed, under "Held, not released" ("En espera, sin marchar"), with a Fire button only
  where the venue lets the pass fire groups (`fireControl` "expo")
  (`apps/till/src/screens/till-expo-screen.ts:932-968`, `:1026-1032`). Fire, Group ready and Away need
  an open party (`checkAndBumpParty(…, "open")`, `apps/server/src/order-groups.ts:307`, `:418`,
  refusing `party.not_open` at `apps/server/src/parties.ts:410`), and the till words that refusal
  "This table has changed since you opened it. Reload the floor and try again"
  (`apps/till/src/i18n/codes.ts:128-131`), which is not what happened. A pass screen can still mark a
  dish Done, whose route does not read the party (`markPassItems`, `apps/server/src/pass-board.ts:131`);
  the pass monitor has no button of any kind (`apps/till/src/screens/till-expo-screen.ts:74`).
- **The till cannot reach a finished table's dishes.** Find bill lists a finished table's paid bill
  only under Transactions (its Bills tab keeps a settled bill only for a counter sale,
  `apps/server/src/find-bill-bills.ts:72-73`), and that receipt offers Reprint and, while refundable,
  Refund a payment ("Devolver un pago", `apps/till/src/screens/till-ticket-view.ts:910`).
- **No change through an adjustment reaches a paid bill:** `planAdjustment`
  (`apps/server/src/adjustments-apply.ts:388-395`) first requires an open bill (`assertTabOpen`,
  `apps/server/src/working-order.ts:3480`). **(run)** On `2e997c3ef`, Node v26.11.1, a throwaway test
  using `apps/server/src/testing/order-venue.ts` (a counter bill issued and paid €10.00 in cash, the
  real Veri\*Factu backend): `planAdjustment` asked to cancel its line was refused `tab.not_open`.
- **A reason today is picked from a list, with a note.** The till's adjustment window lists the
  reasons that allow the action and has a Note field, required only when the reason says so
  (`apps/till/src/widgets/adjustment-dialog.ts:349-352`, `:567-583`, `:382-383`). There is no
  "type your own reason": a venue can get one only by making a reason whose note is required. No
  cancel reason the code seeds does that: not a new venue's one reason
  (`packages/adjustments/src/provisioning.ts:21-30`), nor the demo seed's three
  (`apps/server/scripts/demo-seed/seed-adjustments.ts:39`, `:54`, `:69`); only three of its comp
  and discount reasons require a note (`:78`, `:93`, `:123`).
- **Lane G's A773-1 cancels a dish on a paid bill without a reason.** On a paid bill its Cancel item
  dialog offers "Cancel, keep the payment" and, when the till can take a refund, "Cancel and
  refund" (`apps/till/src/widgets/cancel-item-dialog.ts:150-151`), one order line at a time. Both
  send the server's `keep_charge` (`apps/till/src/till-app.ts:11430` on that branch), which takes the
  dish's kitchen items away, sends the kitchen a VOID slip for fired work and a hold correction
  ("HOLD CANCELLED") for held work (`line-cancel.ts:219-235`), and writes a `line_service_cancellations` row (`apps/server/src/line-cancel.ts:178-279`); only
  `remove_charge` requires a reason (`:125-127`). That row holds the quantity, when, who and whether
  the kitchen had started — no reason — and a second cancel of the same line updates it in place:
  the quantities add up, and the first cancel's time and person are replaced
  (`packages/db/src/schema/line-service-cancellations.ts:6-24`, upserted at `line-cancel.ts:253-270`,
  the quantity summed at `:179`).
  "Cancel and refund" then opens the receipt's refund screen, empty (`till-app.ts:11462-11474`,
  `#openTenderRefund` at `:6599-6619`). The route checks the zone by party
  (`apps/server/src/line-cancel-api.ts:144`, `:201`) and has no open-party check of its own; nothing
  on the till opens the dialog once the table is finished. The till's table screen marks such a dish
  "Cancelled, charged" ("Cancelado, cobrado", `apps/till/src/widgets/sent-orders.ts:468`); the
  receipt and the till's copy of it do not (no reader of the cancellation outside the table screen's
  Sent panel and the dialog, by `git grep cancelledQuantity` over `apps/till/src`, and none among
  the server's receipt files, by `git grep readLineCancellations` over `apps/server/src`).
- **A refund files nothing.** A refund (A737, `POST /api/transactions/:saleId/refunds`,
  `apps/server/src/tender-refund-api.ts:154`) gives back an amount of one payment, needs `sale.refund`
  or the PIN of someone who has it (`apps/server/src/tender-refund-authorization.ts:87`) and a written
  reason (`apps/server/src/tender-refund-reservation.ts:43-48`). **(run)** In the same test on
  `2e997c3ef`, a €3.00 refund of the €10.00 cash payment completed, and the sale's one filed record
  (an F2, the simplified invoice), its `sales` row and its `sale_lines` rows were byte-identical
  before and after. The refund slip says so: "La factura original no cambia"
  (`apps/server/src/tender-refund-receipt.ts:94`).

**Proposed.** One dialog for every cancel on a paid bill: the standard cancel, with a reason, and a
Refund tick on each dish.

1. **The dialog** (picture 06, also in dark). It lists dishes, each with its count, its stage and
   what it added to the bill, and a **Refund** tick ("Devolver"). Below them, **Reason** ("Motivo"),
   the Void reasons as the till lists them today, and **Note** ("Nota"). Its main button follows the
   ticks: **Cancel and refund €5.50** ("Cancelar y devolver 5,50 €") when any is ticked, **Cancel, no
   refund** ("Cancelar sin devolver") when none is, the owner's two words. When the reason needs an
   approver for any dish (§3.2, and §3.3's switch by each dish's stage), the button is **Ask for
   approval** ("Pedir aprobación", the till's `adjust.ask_approval`) and one PIN covers every dish.
   **Back** ("Atrás", the till's `action.back`) changes nothing. The dialog is reached three ways:
   - **Finish table** opens it first, headed **"3 dishes not served"** ("3 platos sin servir"), while
     any bill of the party holds a dish that is neither served nor away. It also offers **They were
     served** ("Ya se sirvieron"), which marks them away as the pass's Away does, then finishes the
     table — offered only when none of them is held, because a held dish was never fired, so it cannot
     have been served.
     Cancelling finishes the table in the same request.
   - **The table's Cancel item…** on a paid bill while the table is still open, for that one dish
     (picture 07, left). This replaces lane G's two paid-bill choices, so every paid-bill cancel
     works the same way.
   - **The paid receipt's Cancel items…** ("Cancelar platos…", picture 07, right), in Find bill →
     Transactions, headed "Cancel items" ("Cancelar platos"), shown while the sale has dishes
     neither served nor away. With Finish table asking first, this is the way back for dishes left
     after a table closed without the question. An unpaid departure also closes the party
     (`closeParty`, `apps/server/src/parties.ts:693-697`) without asking; whether this route should
     serve such a sale, where nothing was paid and so no Refund tick applies, is left to the plan.
2. **The refund, filled in** (picture 08). After the cancel commits, the refund screen opens with the
   ticked dishes' total — their price after any comp on them, and their share of a comp on the whole
   bill — and the reason's name and note with the dishes ("Not served — 1 × Flan"), both editable.
   The waiter picks the payment as today: a card goes back to that card, or on its own terminal if
   it was keyed by hand (confirmed with a PIN, `tender-refund-authorization.ts:132-147`); cash comes
   from the drawer, which opens only under CLAUDE.md §5's rules — a completed cash refund on a device
   queues a drawer job (`apps/server/src/tender-refunds.ts:116-118`) only when the device's profile
   may open its drawer printer and that printer has a drawer (`drawerPrinter`,
   `apps/server/src/receipt-print.ts:70-74`, called at `:645`), and only on a device that takes cash
   (`assertTakesTender`, `tender-refund-authorization.ts:125`). When the chosen payment cannot return
   it all, the screen fills in what it can and says what is left: "€2.00 left to refund from another
   payment" ("Quedan 2,00 € por devolver de otro pago"). The refund is a separate step, as on lane
   G's branch: if the waiter abandons it, the dishes stay cancelled and charged.
3. **The pass says what happened** (picture 09, unchanged from the first proposal). On a pass screen
   and the All stations board, a card whose party has finished shows **Table finished** ("Mesa
   terminada") in place of its group and course buttons; the pass monitor shows the same words as a
   label. The card leaves once its dishes are cancelled or marked served.

**Which dishes are listed, and which are ticked.**

| Stage | Pass today | Listed | Refund ticked |
|---|---|---|---|
| Held (not yet fired) | yes, greyed, "Held, not released" | yes | **yes** |
| Fired, not started | yes | yes | **yes** |
| Being prepared, or ready | yes | yes | no |
| Away, or served | no longer waiting | no | — |

The owner named the two ends: held is refunded, prepared is not. Fired but not started is ticked
because the kitchen has done no work on it yet, and A773-1 draws the same line (`started`: being
prepared, ready or served, `apps/server/src/line-cancel-context.ts:75-77` on lane G's branch) for
whether an unpaid dish can come off the bill without a charge choice. Every tick can be changed. A
line never sent to the kitchen has no kitchen item, so the pass does not show it; whether a paid
bill can hold one was not checked, and if it can the plan lists it, ticked.

**A reason from the list, or typed.** No new field. Two reasons join the starter list (§4):
**Not served** ("No servido") for the usual case here, and **Other** ("Otro motivo") with **Note
required** on, which is "type your own": the till already marks the Note field required for such a
reason and refuses an empty one ("This reason needs a note", `adjustment-dialog.ts:382-383`). For
Other, the Note field's placeholder reads "Say why" ("Explica el motivo"). The adjustment stores the reason's name in
`reason_name`, its rules in `policy_snapshot` and the typed words in `note`
(`packages/adjustments/src/schema/adjustments.ts:63-64`, `:77`), and the report's entries list
already shows the note beside the reason (`packages/adjustments/src/dashboard/adjustment-report-screen.ts:619-623`).
Other's lists are its own like any reason's (§4): everyone may use it, and once the kitchen has the
dish a supervisor, manager or admin approves, because a typed reason is the easiest to hide behind.

**What records the reason on a paid bill.** One `adjustments` row per dish line: a void (`cancel`)
whose amount before and after are both what the dish added to the bill, so it takes **€0.00 off**,
with the dish's list value, the reason, the note, who asked and who approved, and the stage. The
kitchen side is lane G's `keep_charge`, unchanged. Neither changes an amount on the bill, the sale
or the filed record. **(run)** On `2212ff18d`, Node v26.11.1, a throwaway test (kept at
`~/waitron-campaign-c/a758r2-design/probe.test.ts`, outside the repository) using
`provisionOrderVenue`: a counter bill of Croquetas (€10.00 in that venue) issued and paid in cash,
status `settled` (a counter bill; a table's paid bill has the same status); `recordAdjustment` (`packages/adjustments/src/record.ts:47`) wrote a `cancel` row
with before €10.00, after €10.00, reduction €0.00, value €10.00 and a note. The table's checks took
it (`adjustments_amounts_ck`, `schema/adjustments.ts:92-96`). The filed records, the `sales` and
`sale_lines` rows, the bill and its lines, `readBillAdjustments` and the till's receipt answer
(`GET /api/transactions/:saleId/receipt`) were deep-equal before and after. That equality is weak:
`recordAdjustment` writes only the `adjustments` row, `readBillAdjustments` leaves every `cancel`
row out by its query (`record.ts:202`), and a `comp` row written next with a €10.00 reduction, the
control, changed only `readBillAdjustments` — the receipt answer, built from the issued sale, did
not change under the comp either. (The first run read the receipt from a field the test helper
does not return, so its receipt comparison was of nothing; the kept probe now reads the receipt's
JSON, and its re-run on `2212ff18d` found it — a 200 with the €10.00 total — equal after the cancel
and after the comp.) So the run shows the table accepts the row and that those two readers do not
show it; it does not show that every reader of a bill ignores it. The report went from no entries
to one void: €0.00 off bills, voided value €10.00, counted under "after firing" (the stage the test
passed); the entry showed the note. An
update of the cancel row was refused "adjustments is append-only". The plan writes the real path
and its tests; this run only shows the table and the readers accept such a row.

- **In the Voids and comps report** each such dish is a void with €0.00 off the bill and its value
  in the voided-value column (`add`, `packages/adjustments/src/reports.ts:163-169`). Its entry reads
  **"Void, charged"** ("Cancelado, cobrado", lane G's words for the table screen). A refunded dish reads the same,
  because a refund does not change the bill; the refund is
  listed with the refunds, under the reason the refund screen was given.
- **The reason's lists and the kitchen switch apply** (§3.2, §3.3), by each dish's stage.
- **"Most voided on one bill" does not bite**: it adds up what the reason took off the bill
  (`readReasonTotals`, `packages/adjustments/src/record.ts:91-99`), and here that is €0.00. Money
  back is the refund's, under `sale.refund`. So a waiter on a reason's apply list can cancel any
  number of paid dishes without a PIN, as long as no money comes off.

**Who may, beyond the reason.** The till's own rights, as A773-1's route asks: a signed-in session on
an admitted device whose profile has `take-orders` (`line-cancel-api.ts:39-51` on lane G's branch),
and the zone. A finished party holds no table, so its zone reads as none (`partyZone`,
`apps/server/src/parties.ts:199-212`), and a subject in no zone passes the zone check whatever the
device's zones (`assertSubjectZones`, `apps/server/src/zone-access.ts:43-56`) **(read)**. Closing a
party keeps only its tables' names (`closePartyTables`, `parties.ts:740-744`), but each order keeps
its zone and the check already reads it for an order (`zone-access.ts:22-25`) **(read)**: the build
checks the order's zone for a finished table's dishes, with no new stored field, and adds a refusing
case.

#### 3.8.1 They stay on the bill — what each place says

**Yes.** A dish cancelled without a refund stays on the bill, the receipt and the filed invoice at
its full price, because the guest paid for it. The cancel takes it off the pass, tells the kitchen
and records why; it moves no money and files nothing. A refunded dish stays on the original invoice
too — a filed invoice never changes. The money goes back by the refund, and until A802 lands nothing
tells the tax agency. Once A802 lands, a second invoice, the correction, takes the refunded dishes
off.

Worked example. Table 4, four guests, €62.00 paid by card at 22:10, all at 10% VAT: 2 × Croquetas
(€7.50 each, €15.00) being prepared, 1 × Flan (€5.50) held and never fired, and €41.50 of other food
and drink, all served. At 22:12 Ana presses Finish table: "3 dishes not served". The Flan is ticked,
the Croquetas are not; she picks "Not served".

| | Cancel, no refund (she unticks the Flan) | Cancel and refund €5.50 (the ticks as they come) |
|---|---|---|
| Kitchen | a VOID slip for the Croquetas, a hold correction for the Flan; both leave the pass | the same |
| Bill and receipt | unchanged: €62.00, every dish on it | unchanged, plus a refund slip for €5.50 that says the invoice does not change |
| Filed invoice | the F2 for €62.00 | the same F2 for €62.00 |
| Veri\*Factu before A802 | that one record | that one record: the refund files nothing |
| Veri\*Factu after A802 (recommended) | that one record | plus an R5 (the corrective invoice for a simplified one) by differences: −€5.50, base −€5.00 and VAT −€0.50, pointing at the F2; €56.50 invoiced in all |
| Voids and comps report | two entries, "Void, charged", €0.00 off, value €20.50 | the same; the €5.50 is with the refunds |
| Money | the venue keeps €62.00 | the card gets €5.50 back; the venue keeps €56.50 |

Arithmetic: €15.00 + €5.50 + €41.50 = €62.00. €5.50 ÷ 1.10 = €5.00 base, €0.50 VAT. Refunding all
three dishes would be €20.50: base €18.64 (€20.50 ÷ 1.10 = €18.636, to the cent), VAT €1.86, which
together make €20.50 — the owner's rule that the amount entered is what the customer gets back, VAT
included (`docs/backlog/fiscal.md`, A802's points of 2026-09-29).

**What A802 would file.** Correcting part of a paid invoice is **A802** (lane E, spec first; queued
`pending` after A679, no spec under `docs/superpowers/specs/` yet). The engine already takes a
partial correction (`packages/core/src/record-correction.ts:92`), files by differences
(`TipoRectificativa: "I"`, `packages/fiscal-verifactu/src/backend.ts:429`), and "settles
nothing; a refund is a separate payments action" (`:80-81`); the server's one caller credits the
whole invoice (`apps/server/src/cancel-credit.ts:64-75`, `wholeInvoice: true`). This dialog needs
no correction of its own. **Recommended to A802:** a refund that names dishes, as this one does,
issues the partial R5 for them in the same step; the refund slip's "the invoice does not change"
then changes with it.

**Out of scope.** A counter sale: its dishes leave the pass when the order is collected, and Find
bill's Bills tab keeps a paid counter sale until then (`find-bill-bills.ts:72-73`).

**Order.** This builds on A773-1's route and kitchen side, so it waits for A773-1 to land. It does
not wait for A802. Migration: none expected — the row it writes fits today's table (run above); the
build confirms.

---

## 4. The starter list (picture 01)

What a new venue starts with; the venue may change or delete any of it (a Void reason must remain).
No euro limit is seeded: a euro amount depends on the venue's prices, so it is the venue's to set
(D2). The only seeded limit is a share, which does not depend on prices.

| Kind | English / Spanish | Who can apply it | Who can approve it | Limits | Kitchen switch |
|---|---|---|---|---|---|
| Void | Entry error / Error al marcar | Everyone | Manager, Admin | — | off |
| Void | Item not available / Producto agotado | Everyone | Manager, Admin | — | off |
| Void | Customer changed mind / Cambio del cliente | Everyone | Supervisor, Manager, Admin | — | **on** |
| Void | Not served / No servido (Q43 b) | Everyone | Manager, Admin | — | off |
| Void | Other / Otro motivo, note required (Q43 b) | Everyone | Supervisor, Manager, Admin | — | **on** |
| Comp | Complaint / Queja del cliente | Supervisor, Manager, Admin | Supervisor, Manager, Admin | — | — |
| Comp | On the house / Invitación | Manager, Admin | Manager, Admin | — | — |
| Comp | Staff meal / Comida de personal | Everyone | Manager, Admin | 50% an item | — |
| Comp | Discount / Descuento | Manager, Admin | Manager, Admin | — | — |

- The approver lists of Entry error, Item not available and Not served are used only once the venue
  sets a limit on them.
- Not served and Other are proposed with Q43 (§3.8); picture 01 shows the seven approved reasons.
  Other is "type your own": its note is required, and the till asks for it with the placeholder
  "Say why".
- Complaint, On the house and Discount allow Free, % and €; Staff meal allows % and € (Free is above
  its 50%). A staff member's second staff-meal comp on the same item counts with the first, so it
  cannot pass 50% without a manager.
- The reason name "Invitación" never reaches a receipt: the receipt prints a word chosen by the
  comp's kind and size, not the reason's name (`adjustmentLabel`, `receipt-document.ts:91-104`).
- The bill's comp limit starts empty, with Manager and Admin approving past it once set.

---

## 5. Square's reasons

As in the first version: Square's void and comp reasons at Santet are voids (Entry error, Item no
longer available, Customer changed mind) or comps (Customer complaint, Friends and family, Manager
special, Invited by staff, Employee discount). "Customer left without paying" is Waitron's
**Record unpaid departure** (`apps/server/src/unpaid-departure.ts:41-47`). "Paid separately" is a
**Transfer** while both bills are untouched — not presented or paid, and holding no payment
(`transferItems`, `apps/server/src/bill-actions.ts:219-230`, its guard at `:106-124`); "Already paid",
once the paying bill is settled, is a void under "Entry error". "Training" is practice mode, which
is a whole installation (Demo or Prepare, `apps/server/src/boot.ts:1524`), not a reason.

The owner's import tool (`local/square/import.mjs`, only in the Santet worktree, outside the
repository) brings Square's six discounts in as discount reasons. Under D4 each becomes a Comp
reason: EVENT GUEST 100%, INVITATIONAL ITEM 100% and CUSTOMER COMPLAINT 100% allowing Free, the rest
capped at their percentage. That change is to the owner's local tool, not this item's pull requests.

---

## 6. The page and the form (pictures 01 and 02)

**Service → Voids and comps** ("Cancelaciones y descuentos"). A search bar; each row a drag handle,
the name, its kind, both lists, its limits in one short line, and a row menu with Edit and Delete.
Below the list, the bill's comp limit (§3.5).

**Delete removes the row.** A recorded adjustment keeps its own copy of the reason's name and rules
(`reason_name`, `policy_snapshot`, no foreign key: `schema/adjustments.ts:60-64`), and a till holding
a deleted reason is told "That reason no longer exists. Reload and choose another"
(`apps/till/src/i18n/codes.ts:596-598`). Deleting the last Void reason is refused, and so is
changing its kind; the configuration import, which replaces every reason
(`apps/server/src/configuration-transfer.ts:679-689`), refuses a bundle with none. design-system.md's
"Switching off versus deleting" stops listing adjustment reasons.

**The form** (picture 02): Kind (Void | Comp), Name in each content language, Who can apply it, Who
can approve it, then the kind's own fields (§3.1), Note required. Save opens quiet and disabled until
the draft changes (`draftScopeFor`, `saveActionState`), as every saving form does.

---

## 7. Editable roles (A7)

The first version tied the lists to "roles the admin can edit" (A7). **A7 has not landed**: its
design is not written (`docs/backlog.md`, "Roles are something an admin can add and edit … design
not written"; `docs/backlog/dashboard.md`, "Roles the admin can edit (A7)"), and `git log` on
`origin/main` shows no commit building it. The owner chose the lists now (D1), so they are built over
today's four roles. When A7 lands, its roles become more options in both multi-selects; the lists
should store each role by the key A7 will keep for the built-ins, so nothing is migrated then.

---

## 8. Does the receipt's wording reach a filed record?

**No, by reading — not by a run.** The Veri*Factu alta record is built in
`packages/fiscal-verifactu/src/backend.ts:219-235`: issuer, invoice number and date, the
taxpayer's name, invoice type, recipients, `DescripcionOperacion`, the VAT breakdown, the VAT total,
the total and the system's identity. `DescripcionOperacion` is the operation description the caller supplies —
the server passes the receipt department's (`apps/server/src/sale-operation-description.ts:25-50`)
— or else the sale's location's (`operationDescriptionFor`, `packages/core/src/sale-location.ts:6-33`,
called at `packages/core/src/record-sale.ts:359-364`); the breakdown carries only regime, qualification, base,
rate and tax per rate (`toDetalleDesglose`, `backend.ts:141-149`). No item line and no receipt label
enters it, and nothing under `packages/fiscal-verifactu`, `packages/fiscal` or `packages/core`
imports the receipt labels (`packages/core/src/counterparty.ts` does load the country-pack registry
that holds them, but reads only the tax identifier from it). The corrective and substitute records pass the same description
(`backend.ts:441`, `:561`). A comp changes only amounts — what the sale's lines sum to — exactly as
today; a full comp leaves the item at zero whether it prints "Invitación" or "Descuento 100%".

---

## 9. What the build changes (for sizing, not to decide)

- **`packages/adjustments`:** a reason's kind; two role lists instead of `applyRole` and
  `approverRole`; per-kind limits; the item limit counting every comp the reason gave the item;
  limits that ask instead of refusing; the switch, read against `stageOf`; the bill comp limit in
  euros with its approver list, replacing `maxBillDiscountBp`; the policy snapshot recorded on each
  adjustment changes shape; the new-venue seed (§4); the configuration import refusing a bundle with
  no Void reason; the page and form. A migration; before go-live no compatibility code (CLAUDE.md
  §3), so the plan measures the upgrade and says whether a venue reset is needed.
- **The approval path**, from "at or above a role" to "on the list": the verdict's one
  `approverRole` (`policy.ts:52`), the preview's `needsApproval` (`adjustments-apply.ts:539-542`,
  `:704`), the approver check (`adjustments-apply.ts:724`), the approver route
  (`adjustments-api.ts:203-212`) and the till's prompt (`strings.ts:1018-1021`).
- **Receipts:** "Descuento 100%" for a full comp (§3.4).
- **The till:** the Comp window's name and Free/%/€ from the reason; "Comp the bill" with 100%;
  approval prompts naming the reason or the bill limit; Spanish "Invitar" becomes "Descuento"
  (`apps/till/src/i18n/strings.ts:2508`, `:2513`, `:2515`, `:2552`; `apps/till/src/i18n/codes.ts:586`).
- **Reports:** By kind, entry wording, By reason's Asked by and Approved by, the Reason filter.
- **The demo seed** (`apps/server/scripts/demo-seed/seed-adjustments.ts`): one kind per reason, both
  lists filled.
- **Order against A773-1.** A773-1 Task 16 builds the single Comp window over today's reasons and
  actions; Task 20 routes "don't charge" through today's cancel adjustment. A758 changes the rules
  behind both, not their shape, so either can land first; whichever lands second adapts.
- **Food left on the pass (§3.8)**, its own slice after A773-1 lands: the paid-bill dialog (several
  dishes, a Refund tick each, one reason and one PIN) opened from Finish table, the paid receipt's
  Cancel items… and the table's Cancel item…, replacing A773-1's two paid-bill choices; one request
  that cancels the dishes (and finishes the table, from Finish table) in one transaction, writing
  A773-1's kitchen side and an `adjustments` void of €0.00 per dish — a path beside `planAdjustment`,
  which refuses a paid bill, sharing its reason and approver checks; the same reason on "Cancel,
  still charge" (Q43 f); the order's zone for a finished party, with a refusing case; "Void, charged"
  in the report; Not served and Other in the starter list and the demo seed; Table finished on the
  pass card; the refund screen filled in. No fiscal change: the refund files what A802 makes a
  refund file.

### 9.1 Changed test checks to list in the pull request

Tests and fixtures that pin "Invitación" (or Catalan "Invitació") **as a printed receipt word**,
found with `grep -rn -i "invitaci" apps packages` on `5ade0d4f5`; each changes to "Descuento 100%"
(or the language's equivalent):

- `apps/server/src/receipt-ticket.test.ts:237-241` (the per-language label table), `:2227`, `:2234`,
  `:2272` and `:2283` (the case "prints the comp's label as Invitación"), `:2315`, `:2462`, `:2497`
- `apps/server/src/receipt-adjustments.test.ts:592`
- `apps/server/src/adjustments-apply.test.ts:447` (case name) and `:475`
- `apps/server/src/adjustments-bill-payments.test.ts:244`
- `apps/server/src/receipt-document.test.ts:777`
- `apps/till/src/screens/till-ticket-view.test.ts:1549-1550`, `:1810`
- `apps/server/src/receipt-ticket.test.ts:2532`, Basque "Gonbidapena", which the search does not
  match

Pins of the dashboard's name for the action, which change with D10:
`packages/adjustments/src/dashboard/reasons-screen.test.ts:304` ("Give away"), `:372`
("Invitación") and `:1621` (the bill-limit hint, which goes with §3.5), from
`packages/adjustments/src/dashboard/strings.ts:236`, `:245`, `:333`, `:341`, `:349`; and
`packages/adjustments/src/dashboard/adjustment-report-screen.test.ts:235`, `:260`, `:278`
("Give-aways") and `:536` ("Give away"). Tests pinning the till's "Give away"/"Invitar" wording,
which change with D10: `apps/till/src/widgets/adjustment-dialog.test.ts`,
`apps/till/src/widgets/basket.adjustments.test.ts`, `apps/till/src/till-app-adjustments.test.ts`,
`apps/till/src/till-app-counter-adjustments.test.ts`,
`apps/till/src/screens/till-table-order-screen.adjustments.test.ts` and its `.a11y.test.ts`, and
`apps/till/src/i18n/codes.test.ts:388` (the Spanish "no se puede invitar ni descontar" of
`apps/till/src/i18n/codes.ts:586`); `apps/till/src/widgets/basket.a11y.test.ts:61` has the words
only in a test's name.

Not about comps, and unchanged: staff invitations ("invitación" in
`apps/dashboard/src/screens/staff-screen.test.ts:469`, `:811`, `apps/dashboard/src/widgets/staff-list.test.ts:65`,
`apps/setup/src/screens/done-screen.test.ts:133`),
and the demo seed's reason name "Invitación del encargado"
(`apps/server/scripts/demo-seed/seed-adjustments.ts:113-116`), which is a reason's name, never
printed on a receipt.

---

## 10. For other lanes

- **A773 (lane G).** Its spec §3.8 says "The receipt keeps printing a free dish and a discount
  differently, as today"; D11 overrides that (a full comp prints "Descuento 100%"). Its window
  named "Discount…" is the Comp window under D10. Neither changes what lane G builds now.
- **A773 (lane G), from §3.8 and the owner's Q40 answer.** A773-1 lands as built: its paid-bill
  choices and "Cancel, still charge" without a reason. A758's §3.8 slice then replaces the paid-bill
  branch of its Cancel item dialog with the paid-bill dialog, and adds the reason to "still charge"
  (if Q43 f is approved), reusing its route's kitchen side. Lane G need not add a reason column to
  `line_service_cancellations`: the reason lives on the `adjustments` row. Its spec §3.9's "refund
  takes a reason as today's cancel does" now matches the owner, through a Void reason; the refund
  itself keeps A737's free-text reason and `sale.refund`. The new dialog uses the owner's words
  "Cancel and refund" / "Cancel, no refund" ("Cancelar y devolver" / "Cancelar sin devolver") in
  place of A773-1's "Cancelar y devolver el pago" / "Cancelar sin devolver el pago".
- **A802 (lane E; queued `pending` after A679, no spec yet).** §3.8's refund names the dishes it pays
  back. Recommended to A802's spec: a refund that names dishes issues the partial R5 for them in the
  same step, and §3.8 then files it with no code of its own; the refund slip's "La factura original
  no cambia" changes with it. §3.8.1's worked example is the arithmetic to check against.

---

## 11. Open questions

**Answered.** Q40 (2026-10-18): use the standard cancel with a reason, picked from a list or typed;
Finish table warns about dishes not served and asks "Cancel and refund" or "Cancel, no refund",
perhaps with a tick per dish, a held dish refunded and a prepared one not; "if we don't refund, they
stay on the bill, no?" (§3.8 quotes it in full; §3.8.1 answers the question). The first proposal's
"Table finished" on the pass card and Cancel items… on the receipt stay; its "no Void reason" goes.

**Q43 (§3.8, pictures 03, 06–08). Cancelling food on a paid bill: the dialog, the reason, and what
is refunded.** Do you approve, as recommended:

- (a) **One dialog for every cancel on a paid bill**, from Finish table, the table's Cancel item…
  and the paid receipt's Cancel items…: each dish with a Refund tick, ticked when the kitchen had not
  started it (held, or fired but not started) and unticked when it was being prepared or ready; the
  button reads "Cancel and refund €5.50" or "Cancel, no refund" as the ticks are; "They were served"
  only when no dish is held.
- (b) **"Not served" and "Other" join the starter list**; Other's note is required, which is "type
  your own".
- (c) **Who may:** the reason's two lists and its kitchen switch apply by each dish's stage, with one
  PIN for the dialog; "Most voided on one bill" does not bite, because nothing comes off a paid
  bill; the refund keeps its own permission.
- (d) **The report** shows each as "Void, charged", €0.00 off the bill, with the dish's value; the
  refund shows with refunds.
- (e) **The refund screen opens filled in** with the ticked dishes' total and the reason; card and
  cash as today; recommended to A802, the corrective invoice in the same step.
- (f) **"Cancel, still charge" on an unpaid bill takes a reason too**, recorded the same way, so every
  cancel has one.

Where this departs from an earlier decision: (b) adds two reasons to the starter list approved as
D9; (f) and the paid-bill rows change §3.3's table, approved on 2026-10-17 with no reason where no
money moves; (a) uses the owner's new words in place of A773-1's approved paid-bill wording (D10).

Everything else in §1–§7 is approved. Once Q43 is answered the build starts; §3.8 is a slice of its
own after A773-1.
