# A758 — Voids and comps: the rules, the owner's answers, and a page of their own

Status: **design, revised 2026-10-17 with the owner's answers to all eight questions. No question is
open: the build may start.** Backlog entry: `docs/backlog.md` "A758" and
[its detail](../../backlog/till.md#a758-adjustment-reasons-review-the-rules-then-a-page-of-their-own).
Pictures: `docs/backlog/mockups/a758-adjustment-reasons/` (01 and 02 also in dark, `-dark.png`;
drawn in HTML with the dashboard's colour tokens, not screenshots). The first version of this
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
`feat/a773-1-unsent-list` (not yet pushed; read at `d2cc56475` in its worktree), the dialog offers
exactly those (`apps/till/src/widgets/cancel-item-dialog.ts:142-153`), "don't charge" requires a
reason and goes through today's cancel adjustment with its approver
(`apps/server/src/line-cancel.ts:119-121`, `:151-165`), and "still charge" takes no reason
and writes no adjustment (the `else` branch from `line-cancel.ts:171` writes the line's service
state, kitchen correction slips and revisions) **(read)**.

So a Void reason applies exactly where money comes off the bill:

| Where the dish is | The till offers | Void reason? | Its lists and limit | Kitchen | Bill |
|---|---|---|---|---|---|
| New order (not sent) | ✕ removes it | no | — | never had it | line removed |
| Held, or fired but not started; bill unpaid | **Cancel** | yes | yes; the switch applies once fired | told | off |
| Being prepared, ready or served; unpaid | **Cancel, still charge** | no | no — no money moves | told, marked started | stays, "cancelled, charged" |
| same | **Cancel, don't charge** | yes | yes; the kitchen has it, so the switch applies | told, marked started | off |
| Bill paid, any stage | **Cancel, keep the payment** | no | no — no money moves | told | unchanged |
| same, when the till can take a refund | **Cancel and refund** | no | no: the refund's own rules apply — the `sale.refund` permission (`apps/server/src/tender-refund-authorization.ts:87`, `:129-145`) and a written reason (`apps/server/src/tender-refund-reservation.ts:43-52`) | told | a refund (A737) |

"Still charge" and "keep the payment" still need the till's own rights (session, device profile,
zone and action) under A773-1; A758 adds nothing to them. They are not adjustments, so they appear
in neither the Voids and comps report nor any reason's limit.

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
supervisor, manager or admin enters their PIN. It is being cooked: "Cancel, still charge" — alone,
nothing comes off; "Cancel, don't charge" — a PIN, as fired.

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
  is told apart from a part one in the list without a separate total.
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
| Comp | Complaint / Queja del cliente | Supervisor, Manager, Admin | Supervisor, Manager, Admin | — | — |
| Comp | On the house / Invitación | Manager, Admin | Manager, Admin | — | — |
| Comp | Staff meal / Comida de personal | Everyone | Manager, Admin | 50% an item | — |
| Comp | Discount / Descuento | Manager, Admin | Manager, Admin | — | — |

- The first two Void reasons' approver lists are used only once the venue sets a limit on them.
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
  named "Discount…" is the Comp window under D10. Its §3.9 says "refund" takes a reason "as today's
  cancel does"; on lane G's branch the refund goes through A737's flow, whose reason is free text
  and whose rule is the `sale.refund` permission (§3.3), not a void reason. Neither changes what
  lane G builds now.

---

## 11. Open questions

None. The build may start.
