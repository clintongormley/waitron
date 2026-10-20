# A758 — Voids and comps: the rules, the owner's answers, and a page of their own

> **2026-10-20 A802 update:** the [partial paid-invoice correction proposal](2026-10-20-a802-partial-paid-invoice-correction-design.md)
> is ready for owner review. References below to A802 as still queued describe the earlier state.
> Its new policies are proposals; they do not amend this approved design before owner approval.

Status: **design, revised 2026-10-19 a second time, for the owner's four answers to A758r3's
question (D23–D26), then for the answer to A758r4's question (D28).** Settled and buildable, all of
it: the Spanish words (§3.9), no confirmation switch on a cash refund (§3.8.2), a fired dish
answered No not listed (§3.3, §3.6), the refund screen's Reason drop-down (§3.8 item 3), and a cash
refund only on a device whose profile takes cash (D28, §3.8.2). No question is open. Earlier revisions: 2026-10-17, 2026-10-18 and
2026-10-19 (the owner's answers to Q21–Q28, Q40 and Q43). Backlog entry: `docs/backlog.md` "A758" and
[its detail](../../backlog/till.md#a758-adjustment-reasons-review-the-rules-then-a-page-of-their-own).
Pictures: `docs/backlog/mockups/a758-adjustment-reasons/`, all drawn in HTML with the dashboard's
colour tokens, not screenshots: 01 the starter list and 02 the edit form (both also in dark,
`-dark.png`), 03 `03-cancel-by-where-the-dish-is.png`, 04 past a limit, 05 the receipt, 06 Finish
table asks (also in dark), 07 `07-cancel-item-on-a-paid-bill.png`, 08 the refund filled in, 09 the
pass card. This revision redrew 03, 06 (both themes), 08 and 09; the rest are unchanged.

**Words.** A **void** — the till's **Cancel** — takes an item off the order because it should not be
made or should not be charged; the code calls it `cancel`. A **comp** is the house taking some or
all of an item's price off; the code calls a free item `comp` and a part off `discount_percent` or
`discount_amount`. A **reason** is what staff pick when they do either (`adjustment_reasons`,
`packages/adjustments/src/schema/reasons.ts`). A **station** is wherever a dish is made; a bar is
one too, so what people see says "station", never "kitchen". A dish is **fired** once it is sent to
its station to be made. **Preparation started** means the station has started it: being prepared,
ready or served (lane G's `stage: "started"`, `apps/server/src/line-cancel-context.ts:75-77` on its
branch). For a dish fired but not started the till cannot know, so it asks the waiter "Has
preparation started?". A **refund** gives money back on a paid bill; nothing else is called one.
**The refund permission** is `sale.refund`, held today by supervisor, manager and admin
(`packages/identity/src/permissions.ts:46-55`; a manager holds every supervisor permission, `:56-57`,
and an admin every permission, `:78-83`).

File references are to `main` at `5ade0d4f5` unless they name lane G's branch. **(run)** marks a
result measured on 2026-10-17 by a throwaway test against `apps/server`'s adjustment venue
(`apps/server/src/testing/adjustment-venue.ts`: Burger €12, Bottle €30, Steak €25, Coffee €1.50) on
`c7ebd2fd8`, Node v26.11.1. None of the adjustment files those runs exercised has changed since
(`git log c7ebd2fd8..5ade0d4f5 -- packages/adjustments/src apps/server/src/adjustments-apply.ts
apps/server/src/testing/adjustment-venue.ts` prints nothing). The range does add migrations the test
venue applies (menu periods, photo framing, staffing); I believe them unrelated to adjustments, but
the runs were not repeated. **(read)** marks a conclusion from reading code, not
from running it. References added on 2026-10-19 are to `main` at `4ce4a56c2` and to lane G's
`feat/a773-1-unsent-list` at `6b62e757b` (in its worktree, not pushed; its uncommitted edits then
touched none of the files cited), all **(read)** unless marked. References added in the second
revision of 2026-10-19 (§3.8.2, §3.9, §9.1's cash checks, §10 item 5, §11) are to `main` at
`ad57a6bb9` and to lane G's branch at `84e08630a` (committed files only, read with `git show`).

---

## 1. What the owner decided (2026-10-17 to 2026-10-19)

| # | Decision | Was |
|---|---|---|
| D1 | **Two lists per Comp reason: "Who can apply it" and "Who can approve it"**, both chosen with the shared multi-select (`wt-combobox` with `multiple`, design-system.md). Anyone signed in may ask for any reason. Someone on the first list uses it straight away; for anyone else, someone on the second list enters their PIN; someone on the second list asking for it themselves goes straight through. A Void reason has no lists (D13). | Q1 (Q21), first answered "just who can approve it", then revised by the owner to two lists; Void reasons' lists removed by the Q43 notes |
| D2 | **Every limit is the venue's own**, set per Comp reason. Nothing is written into the code; the €30 and €40 in the examples are examples. | owner, with Q21 |
| D3 | **Above a Comp reason's limit, an approver enters their PIN** (no longer a flat refusal). Up to it, someone on "Who can apply it" goes through alone. The till's "ask a manager" message then becomes true (§2.2). | Q2 (Q22): B |
| D4 | **Two kinds of reason: Void and Comp.** A Comp takes a percentage or an amount off, up to 100%, which is the item given free. One kind per reason; the form shows only that kind's fields; a Comp's "most off one item" counts everything that reason took off that item. | Q3 (Q23), reframed by the owner from three kinds to two |
| D5 | **No separate "give away"**: a 100% comp is the give-away, so the question whether a discount may reach zero falls away. | Q4 (Q24): moot |
| D6 | **The venue's bill-wide limit becomes a euro amount of comps per bill**, set by the venue; past it, someone the venue names approves (§3.5). | Q5 (Q25): B |
| D7 | **"Staff meal" is an ordinary Comp reason, 50% an item.** No record of who ate; the report must show who gave each comp, per reason (§3.7). | Q6 (Q26): A |
| D8 | **Retired.** A Void reason has no approval switch of its own; D12 and D13 decide what a cancel needs. | Q7 (Q27): A, retired by the Q43 notes |
| D9 | **The starter list in Void and Comp terms**, the Comp reasons with both lists and limits filled in; nine reasons since D16 (§4). | Q8 (Q28): A |
| D10 | **Names people see.** The page is "Voids and comps" (Spanish "Cancelaciones y descuentos"); the kinds and the till's actions are **Void** and **Comp** (Spanish **Cancelar** and **Descuento**). Code names (`cancel`, `comp`, `adjustment`) stay unless renaming one is cheap and clean. A773-1's approved "Cancelar …" strings already match. | owner naming, 14:45 |
| D11 | **A full comp prints "Descuento 100%"** on the Spanish receipt. "Invitación" goes. | owner, receipt wording |
| D12 | **What the till does depends on where the dish is** (§3.3, picture 03). Not sent, or held, bill unpaid: **just removed** — no reason, no approval, not in the report ("it is still editing the order"). Fired, not started, bill unpaid: the till asks **"Has preparation started?"** (the waiter asks the station in person); No → removed with no reason and no approval, and not in the report (D25); Yes → as started. Being prepared, ready or served, bill unpaid: **"Cancel, still charge"** (a reason, no approval) or **"Cancel, don't charge"** (a reason and D13). Bill paid: cancelled with a reason, refunded or not; a refund needs D13. The station is told whenever the dish had reached it. | Q43 notes, ~22:50, in place of the 17 October table and Q43 (f) |
| D13 | **A cancel that takes a dish off an unpaid bill ("Cancel, don't charge"), and any refund on a paid bill, needs the refund permission** (`sale.refund`): the person's own, or the PIN of someone who has it. **For cancels this replaces the reasons' own rules:** a Void reason is a label for the record, with no lists, no limit and no switch. Comps are judged by D1–D7 alone. | Q43 notes, ~22:50, in place of Q43 (c) |
| D14 | **No "Ask for approval" button in the cancel and refund dialogs.** The main button always names the action ("Cancel and refund €5.50"); pressed without the refund permission it opens the approver PIN prompt, and the action completes once someone who holds the permission enters their PIN. | Q43 notes, ~23:10 |
| D15 | **The reason is a drop-down**, the shared field primitive, one line. In Finish table it starts on "Not served"; choosing "Other" shows its required note. Every cancel and refund dialog that asks a reason uses it, the refund screen included (D26). | Q43 notes, ~23:15 |
| D16 | **Two more starter reasons, "Not served" and "Other"** (note required): nine in all, which a venue edits or removes as today. | Q43 (b), approved ~23:20 |
| D17 | **Finish table on a paid table with dishes not served** cancels every one of them; the only questions are per dish: has preparation started (known for held — No — and for being prepared or ready — Yes; asked Yes / No for fired and not started), and a Refund tick, starting ticked when not started and unticked when started, changeable. The main button reads **"Cancel"** while nothing is ticked and **"Cancel and refund {amount}"** once any is. A third choice, **"They'll collect it at the counter"**, moves the order to the counter to wait (§3.8). "They were served" goes. | Q43 notes, ~23:10 and ~23:40, in place of Q43 (a). "They were served" going is our reading of the ~23:10 flows; say if wrong |
| D18 | **A refund of a served dish after paying is a separate, intentional action** — Refund a payment on the receipt — not a cancel. The table's Cancel item… on a paid bill is for dishes not yet served; the paid receipt's "Cancel items…" is dropped. | Q43 notes, ~23:10. Dropping the receipt's "Cancel items…", and offering the table's Cancel item… on a paid bill only for dishes not yet served, are our reading of the ~23:10 flows; say if wrong |
| D19 | **The report** lists every cancelled dish with its reason, who did it, who gave the PIN (if anyone), whether preparation had started, and the amount off the bill (unpaid "Cancel, don't charge": the dish's value; "Cancel, still charge" and any cancel on a paid bill: €0.00, because a filed bill never changes); money given back shows with refunds, linked to the cancel (§3.6). A dish not sent or held, removed from an unpaid bill, is not a cancel (D12), nor is a fired dish answered No (D25). | Q43 (d), approved ~23:25 |
| D20 | **The refund screen opens filled in** with the ticked dishes' total and the cancel's reason (its shape is D26); each payment goes back by its own method, only on a device whose profile takes that method (§3.8.2), and cash without its switch (D24). **Once A802 lands, a refund of cancelled dishes files the corrective invoice in the same step**; until then nothing is filed and the invoice is unchanged. | Q43 (e), approved ~23:35 |
| D21 | **A cash refund when the guest has left is not tracked**: no "Is the customer here?", no "cash owed" record. | Q43 notes, ~23:45 |
| D22 | **One word per meaning.** Unpaid bill: "Cancel, don't charge" (comes off the bill; no money moves). Paid bill: "Cancel and refund" (money goes back). "Refund" only where money is returned. "Station" and "preparation started", never "the kitchen", in every question, label and report column. | Q43 notes, ~23:00 and ~23:30 |
| D23 | **The Spanish words** are the table in §3.9. The question "Has preparation started?" is **«En preparación»**, answered «Sí» / «No», and the report's column "Preparation started" is also «En preparación». Every other word as A758r3 recommended. The English does not change. | owner, 2026-10-19 ~12:30, A758r3 (a) |
| D24 | **No confirmation switch on any cash refund.** Today's "I have handed this money back to the customer" goes, and the refund goes through without it. The drawer follows today's rules (§3.8.2). | owner, 2026-10-19 ~12:35, A758r3 (b), in place of both options asked |
| D25 | **A fired dish removed because preparation had not started is not listed** in Voids and comps: it is treated like a held dish, still editing the order. No record, no migration for it. | owner, 2026-10-19 ~12:40, A758r3 (c) |
| D26 | **The refund screen's Reason is the same drop-down** (D15): it starts on the cancel's reason when opened from a cancel and on "Choose a reason" otherwise; "Other" gives the typed note; the dishes show on a line under it ("1 × Flan"), not inside the reason. What is stored keeps its shape: the reason's name, or Other's typed words. | owner, 2026-10-19, A758r3 (d), as recommended |
| D27 | **A venue keeps at least one Void reason that asks for a note**, so a refund can always be given typed words (§6). | our reading of D26, beside the existing "a venue keeps at least one Void reason"; say if wrong |
| D28 | **Keep today's rule: cash is given back only on a device whose profile takes cash.** On a handheld that takes none, Finish table shows no Refund tick, its button reads "Cancel", and one line, «Devuelve el dinero en una caja: Devolver un pago, en el recibo.», sends staff to a till (§3.8.2). | owner, 2026-10-19 ~14:05, A758r4, as recommended |

Kept from the first version, which the owner did not object to: the page sits under **Service**
(A755); a search bar, drag handles and a real **Delete** through `wt-delete-dialog` (no Disable,
no Status column); a venue always keeps at least one Void reason; the migration deletes
switched-off reasons (2026-10-20, A758-2: not done, as no data-migration code is written before
go-live; see `docs/backlog/till.md`, Decisions and deliberate limits); Square's "left without paying", "paid separately / already paid" and
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
  the control, a supervisor/manager reason: `needsApproval: manager`. *Settled by D13 for voids,
  which have no lists, and by D1 for comps:* with two lists, the approver list is used when someone
  not on the apply list asks, or above a limit; the list page shows both, so an unused approver list
  is visible as such.
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
  `needsApproval: manager` for a held burger and for a fired one. *Settled by D12 and D13:* the
  stage decides what the till offers, and the refund permission decides who may take a dish off
  an unpaid bill or give money back.

---

## 3. The new rules

### 3.1 A reason

| Field | Void | Comp |
|---|---|---|
| Kind | Void | Comp |
| Name, in each content language | yes | yes |
| Who can apply it (multi-select of roles) | — | yes |
| Who can approve it (multi-select of roles) | — | yes |
| How it can be taken off: Free (100%), A percentage, An amount | — | at least one |
| Most off one item (%) | — | optional; counts everything this reason took off the item: free, percentages, amounts and its share of a comp on the whole bill |
| Most off one bill (€) | — | optional: everything this reason comped on the bill |
| Note required | switch | switch |

A Void reason is a label for the record (D13): who may cancel is the same under every one (§3.2).

- **A Comp's two role lists** are a `wt-combobox` with `multiple` over today's four roles. Neither may be
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

**A comp**, for one request under one reason, by one person, with an optional approver's PIN:

1. **Not allowed at all:** the reason does not offer what was asked (a Void reason asked to comp, a
   Comp reason without "An amount" asked for an amount), or a required note is missing → refused,
   as today (`adjustment.action_not_allowed`, `adjustment.note_required`).
2. **Does it need the reason's approver?** Yes when the person is not on "Who can apply it", or the
   request goes past one of the reason's limits. The approver must be on "Who can approve it";
   someone on that list asking for it themselves needs nobody.
3. **Does it pass the bill's comp limit?** (§3.5.) If so, the approver must instead be
   on the venue's "Who can approve past it" list, which then approves the whole request; someone on
   that list asking themselves needs nobody. This is close to today, where passing the bill limit raises the
   approver to at least a manager (a reason asking for nobody or someone lower is raised to a
   manager; an admin approver stays, `adjustments-apply.ts:539-542`), and it means one PIN is
   always enough.

**A void (a cancel)** (D12, D13):

1. **Not allowed at all:** the reason is not a Void reason, or its required note is missing →
   refused, as today. A dish removed before preparation started takes no reason, so this step does
   not arise for it.
2. **The refund permission, and only for money.** "Cancel, don't charge" on an unpaid bill, or a
   refund on a paid one, needs the refund permission: the person's own, or the PIN of someone who
   has it. Everything else — a dish removed before preparation started, "Cancel, still charge", a
   paid-bill cancel with nothing ticked — needs nobody. No reason list, no limit and no stage switch.
   A comp is not judged by this step: it takes money off an unpaid bill too, and D1–D7 alone decide it.
3. The bill's comp limit (§3.5) does not apply: it counts comps, and a cancel adds none.

What goes from today's cancel checks **(read, on `4ce4a56c2`)**: the reason's roles
(`evaluateAdjustment`, `packages/adjustments/src/policy.ts:110-112`) and its bill limit (`:101-106`)
stop applying to a cancel, and so does **`billCancelNeedsManager`** (`policy.ts:166-191`), which asks
a manager when a cancel leaves the bill's discount share past the venue's share limit (called through
`pastBillDiscountLimit`, `apps/server/src/adjustments-apply.ts:664-672`, which raises the approver at
`:532-542`). It goes with the share limit itself (§3.5). Two refusals stay, because they are about the
money's state rather than about who asks: a cancel while a payment is in flight
(`refusePaymentInFlight`, `adjustments-apply.ts:399`) and a cancel of what a bill payment already
paid for (`refusePaidLines`, `:458-460`).

Worked example for a comp (picture 04; the settings are one venue's own). Complaint: Who can apply it
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
approve this with their PIN.", `apps/till/src/i18n/strings.ts:1042-1045`) and lists everyone at or
above it (`/api/adjustment-approvers`, `apps/server/src/adjustments-api.ts:203-212`). For a comp it
becomes "Someone who can approve Complaint must enter their PIN." or "This takes the bill's comps
past €40.00. Someone who can approve past the bill's limit must enter their PIN.", and the picker
lists the people on that list. The Comp window keeps its approval step and its "Ask for approval"
button (`adjust.ask_approval`, `strings.ts:1048`; picture 04): that is our choice, because D14
covers only the cancel and refund dialogs; say if the Comp window should lose it too. For a cancel
the till opens the prompt the refund screen already uses, `till-supervisor-override-dialog`
(`apps/till/src/widgets/supervisor-override-dialog.ts:115-121`; opened for a refund at
`apps/till/src/till-app.ts:6584-6589`), over the people who hold the refund permission
(`GET /api/refund-authorizers`, `apps/server/src/bill-payments-api.ts:262-270`). Per D14 the cancel
dialog has no "Ask for approval" button: its main button names the action, opens the prompt when
the permission is needed, and the action completes on the approver's PIN. That prompt's words
today are the `override.*` strings, chosen at `supervisor-override-dialog.ts:117-122`: "Supervisor
authorization", "Choose a supervisor", "Enter the supervisor's PIN" (`strings.ts:417-421`), though
it lists everyone who holds the refund permission, a manager or admin included. Under D22's one
word per meaning the plan rewords them, for example "Approve with PIN", "Choose who approves" and
"Enter their PIN" (picture 03 draws those); the Spanish already says "un responsable"
(`strings.ts:1995-1999`).

### 3.3 Cancel item…, by where the dish is (picture 03)

Lane G's A773-1 replaces the till's Cancel with **Cancel item…**, whose choices depend on where the
dish is and whether the bill is paid (spec `docs/superpowers/specs/2026-10-16-a773-courses-and-groups-design.md`
§3.9; plan `docs/superpowers/plans/2026-10-16-a773-1-unsent-list.md` Task 20). On lane G's branch at
`6b62e757b`: the dialog's choices follow the bill and the stage
(`apps/till/src/widgets/cancel-item-dialog.ts:142-153`) and its buttons read Close and Continue
(`:335-353`); "don't charge" requires a reason (`apps/server/src/line-cancel.ts:125-127`) and goes
through today's cancel adjustment with its approver (`:157-176`); "still charge" is refused for a
dish not started on an unpaid bill (`:119-124`); "still charge" and both paid-bill choices take no
reason and write no adjustment (the `else` branch from `:178`), recording the line's service state
(`:253-270`), whose `was_started` is true when the dish's stage is started and, once true, stays
true through later cancels of the line (`:259`, `:267`).

What the till does under D12 and D13:

| Where the dish is | The till | Reason | Who may | Station | Bill | Voids and comps |
|---|---|---|---|---|---|---|
| Not sent (New order); bill unpaid | ✕ removes it | no | anyone | never had it | line gone | not listed |
| Held (not fired); bill unpaid | Cancel item… removes it | no | anyone | told, if its HOLD ticket was queued | off | not listed |
| Fired, not started; bill unpaid | asks **"Has preparation started?"**: No → removed with no reason, as held; Yes → as the next rows | after No: no | after No: anyone | told | after No: off | after No: not listed (D25) |
| Being prepared, ready or served; bill unpaid | **Cancel, still charge** | yes | anyone | told | stays, "Cancelled, charged" | €0.00 off |
| same | **Cancel, don't charge** | yes | refund permission | told | off | the dish's value off |
| Bill paid, not yet served (the table open, or at Finish table) | **Cancel**, or **Cancel and refund {amount}**, by a Refund tick per dish (§3.8) | yes | a refund: refund permission | told | unchanged | €0.00 off; the refund with refunds |
| Bill paid, served | not cancelled: money back is Refund a payment on the receipt (D18) | the refund's own | refund permission | — | unchanged | not listed |

- **This changes today.** Cancelling a held dish, or one fired and not started, today takes a reason
  and writes a cancel adjustment (lane G, above). Under D12 it takes neither. A held dish leaves no
  record and is not in the report: the owner called it "still editing the order". A fired dish
  answered No is the same (D25). The station is still told as a cancel tells it today: `removeFromLine` (`apps/server/src/working-order.ts:2602-2611`,
  its description) records a VOID notice for fired work, with a slip where the station has a printer,
  and a HOLD CANCELLED slip for held work whose HOLD ticket was queued; the removal reuses it without
  the adjustment.
- **"Has preparation started?"** The waiter asks the station in person; nothing is sent to the
  station's screen. It is asked only for a dish fired and not started, because the stage answers it
  otherwise: held is No; being prepared, ready or served is Yes. Yes makes the dish started for this
  cancel: the server accepts "still charge" for it, which lane G refuses today (`line-cancel.ts:119-124`),
  and records it as started. A dish whose stage changes while the dialog is open is refused with the
  new choices, as lane G's context check already does (`requireCancellationContext`,
  `apps/server/src/line-cancel-context.ts:92-103`).
- **The reason is a drop-down (D15):** `wt-combobox`, single choice, one line. design-system.md
  calls it "The one dropdown" (`docs/developers/design-system.md:735`), and CLAUDE.md §3 forbids a
  screen's own native `<select>`. It lists the Void reasons in the venue's order, starts empty
  ("Choose a reason", the till's `adjust.reason_required`) except in Finish table, where it starts on
  "Not served", and a reason whose note is required (Other) shows the Note field, required, with the
  placeholder "Say why". Today the till's adjustment window lists reasons as radio buttons
  (`apps/till/src/widgets/adjustment-dialog.ts:696-718`). D15 covers every cancel and refund dialog
  that asks a reason, the refund screen's own Reason included (D26, §3.8 item 3); the Comp window,
  which is neither, keeps its list.
- **The buttons (D14).** The main button reads the chosen action — "Cancel, still charge", "Cancel,
  don't charge", "Cancel", "Cancel and refund €5.50", and for a dish removed before preparation
  started the till's existing "Remove" (`action.remove`, `apps/till/src/i18n/strings.ts:280`; our
  choice, since that removal is not a cancel) — in place of Close and Continue; the other is
  Back. It is quiet and disabled until every required answer is given (the stage question, the
  choice, the reason, a required note). Pressed without the refund permission where D13 needs it, it
  opens the PIN prompt (§3.2).
- These choices still need the till's own rights (session, device profile, zone and action) under
  A773-1; A758 adds nothing to them.

Worked example (picture 03). Ana, staff, cancels a €12.00 burger. Held: she removes it; nobody is
asked and it is not in the report. Fired, not started: the till asks; the cook says it is not
started, she answers No, and it is removed the same way, the station told, and it is not in the
report. Being cooked: "Cancel,
still charge" with "Customer changed mind" goes straight through, €0.00 off; "Cancel, don't charge"
opens the PIN prompt, Luis (supervisor) enters his PIN, and €12.00 comes off.

### 3.4 Comp: part or all of the price (picture 05)

- **The till's Comp window** is A773-1's single window for what are today Give away and Discount
  (spec §3.8, there named "Discount…"; under D10 its English name is **Comp…** and its Spanish
  **Descuento…**). It offers Free, % and € as the chosen reason allows. Free stays the stored
  `comp` action and percentages and amounts stay `discount_percent` and `discount_amount`
  (`ADJUSTMENT_ACTIONS`, `policy.ts:10-15`): renaming a stored action means changing the
  append-only `adjustments` table's action check (`packages/adjustments/src/schema/adjustments.ts:89`)
  and its stored rows, which its triggers refuse to update (§3.8's run), so the plan keeps them
  unless it finds that cheap.
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

### 3.6 Reports (D19)

- **By kind:** two rows, Voids and Comps, replacing today's four (cancel, comp and the two
  discounts: `ACTIONS` in `packages/adjustments/src/dashboard/adjustment-report-screen.ts:31-36`).
- **Each entry** keeps its own words: "Void", "Comp 100%", "Comp 20%", "Comp €3.00", so a full comp
  is told apart from a part one in the list without a separate total. A void that took nothing off
  the bill reads "Void, charged" ("Cancelado, cobrado").
- **Every cancelled dish is an entry**, with its reason and note, who did it, who gave the PIN if
  anyone, **whether preparation had started** (the column «En preparación» in Spanish, D23), and
  the **amount off the bill**: the dish's value
  for an unpaid "Cancel, don't charge"; €0.00 for "Cancel, still charge" and for any cancel on a paid bill, because a filed
  bill never changes. Money given back is the refund's: the entry shows "Refunded €5.50" beside the
  cancel, linked to the refund. A dish not sent or held, or fired and answered No, removed from an
  unpaid bill, is not a cancel and has no entry (D12, D25). So "Preparation started: no" appears
  only for a paid bill's dishes (§3.8).
- **By reason** already exists (`packages/adjustments/src/reports.ts:191-214`), and each person's
  own by-reason breakdown too (`PersonAdjustments` extends the totals, `reports.ts:68-76`).

**What stores it.**

- Reason, note, who asked and who approved: the `adjustments` row has them already (`reason_name`,
  `requested_by`, `approved_by`, `note`, `packages/adjustments/src/schema/adjustments.ts:63`, `:75-77`).
- **Whether preparation had started: nothing stores it per cancel today.** The row's `stage` is
  unsent, held, fired or served (`schema/adjustments.ts:24`, `:78`), and "fired" does not say whether
  the station had started. Lane G's `line_service_cancellations` is one row per line: a later cancel
  of the same line adds its quantity and replaces the time and person, and `was_started`, once true,
  stays true (`line-cancel.ts:257-268` on lane G's branch;
  `packages/db/src/schema/line-service-cancellations.ts:6-24`), so it cannot say it per cancel
  either. Expected shape: a nullable flag on the `adjustments` row, added as a column. Widening
  `stage`'s check instead changes a constraint on an append-only table; whether drizzle-kit writes
  that in place or as a rebuild was not tried.
- **The link from a refund to the cancels it pays for: nothing stores it today.** A refund after the
  invoice (`tender_refunds`) keeps a typed reason and no reference to a cancel
  (`packages/db/src/schema/tender-refunds.ts:26-61`, the reason at `:36`); the `adjustments` row is
  append-only and written before the refund, so it cannot take the refund's id afterwards. Expected
  shape: a link written with the refund, naming it and the cancels it pays for. A table in the
  adjustments migration set can name a core table, as `adjustments` already names `working_orders`
  (`adjustments_working_order_fk`, `schema/adjustments.ts:83-87`).
- So **a migration is expected** (the flag and the link); the plan decides their exact shape. Before
  go-live there is no compatibility code (CLAUDE.md §3).
- **Where refunds show today: no screen lists every refund.** Completed refunds after the invoice
  (`tender_refunds`) count in the daily close's cash and the overview's takings
  (`packages/reporting/src/cash-up.ts:58-62`; pinned by the case at
  `apps/server/src/report-api.tender-refunds.test.ts:225-241`); the Payments page lists only the
  stuck ones, pending card refunds (`/management-api/payments/tender-refunds`,
  `apps/server/src/payments-api.ts:1331-1350`; `apps/dashboard/src/screens/payments-screen.ts:1471`).
  An order's detail lists only refunds of bill payments made before the invoice
  (`apps/dashboard/src/widgets/order-detail-dialog.ts:398`). Q43 (d) said the money back "shows
  with refunds"; with no such list, the Voids and comps entry is
  where it shows: "Refunded €5.50", with the refund's state, beside the cancel. A list of every refund
  is not part of this item.

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
pass. The owner's answer to Q40 (2026-10-18) chose the standard cancel with a reason and a Refund
tick per dish; the owner's notes on Q43 the same evening settled the rest (D12–D22).

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

**What the till does (D17, D18, D20, D21).** References from here on are to `4ce4a56c2` and lane G's
`6b62e757b`.

1. **Finish table on a paid table asks first** (picture 06, also in dark). While any bill of the
   party holds a dish that is neither served nor away, Finish table opens a dialog headed "3 dishes
   not served". Every such dish is cancelled; the only questions are per dish:
   - **Has preparation started?** Known for a held dish (No) and for one being prepared or ready
     (Yes), shown as text; for a dish fired and not started the row asks Yes / No.
   - **Refund**, a tick that starts from that answer: not started → ticked, started → unticked, and
     no tick until a Yes / No row is answered. Every tick can be changed.

   Below them, **Reason**, the drop-down, starting on "Not served" (D15). The main button reads
   **Cancel** while nothing is ticked and **Cancel and refund €5.50** once any is; without the refund
   permission it opens the PIN prompt (D14). **Back** changes nothing. Cancelling finishes the table
   in the same request. A third choice, **They'll collect it at the counter**, is item 4.
   - "They were served" (the Q40 version) goes. A waiter who finds a dish was in fact served presses
     Back, marks it served where that is done today — Mark served on the table screen's Sent list
     (`apps/till/src/screens/till-table-order-screen.ts:4160-4170`; Mark all served for a group,
     `:3935-3940`; `POST /api/parties/:id/served`, `apps/server/src/till-api.ts:3065-3093`) — and
     presses Finish table again.
   - Finish table on a table with a bill still owing is refused as today (`party.bill_outstanding`,
     `finishTable`, `apps/server/src/parties.ts:682-696`), so the dialog appears only once every bill
     of the party is paid. Lane G's plan has Finish table offer Fire or Void for held dishes (plan
     Task 22); on a paid table this dialog takes its place (§10).
2. **The table's Cancel item… on a paid bill** (picture 07), while the table is still open: the same
   questions for that one dish, without finishing the table. It is offered only for what is not yet
   served; a partly served line offers its unserved quantity. A served dish on a paid bill is not
   cancelled: money back for it is a separate, intentional action, Refund a payment on the receipt
   (A737, `apps/till/src/screens/till-ticket-view.ts:910`). This replaces lane G's two paid-bill
   choices, "Cancel, keep the payment" and "Cancel and refund" (`cancel-item-dialog.ts:150-151`).
3. **The refund, filled in** (picture 08). After the cancel commits, the refund screen opens with the
   ticked dishes' total — their price after any comp on them, and their share of a comp on the whole
   bill — and **Reason, the same drop-down as the cancel's** (D26): it starts on the cancel's reason
   ("Not served"), with the dishes on a line under it ("1 × Flan"), not inside the reason. Opened
   from a receipt's Refund a payment, it starts on "Choose a reason". It lists the Void reasons in the
   venue's order, and "Other" shows its required note. **(read)** The refund's reason is one text
   today: the server takes any text that is not blank and at most 500 characters
   (`apps/server/src/tender-refund-reservation.ts:42-48`), trims it (`:52`) and stores it in
   `tender_refunds.reason` (`:159`; `packages/db/src/schema/tender-refunds.ts:36`). The reason
   picked is stored as its name, or for Other as the words typed, in that same text: no change to the
   server or the table. A venue's own reason that asks for a note is stored as its typed words, as
   Other is: our reading, since the till knows Other only as a reason that asks for a note. The
   change is the till's field, a typed `wt-input` today
   (`apps/till/src/widgets/tender-refund-dialog.ts:301-317`, used at `:411`), and the reasons it
   reads. The waiter picks the payment as today, and it goes back by its own method — a card taken on
   a connected reader to that card, a card keyed by hand on its own terminal (confirmed with a PIN,
   `tender-refund-authorization.ts:132-147`), cash from the drawer with no switch — and only on a
   device whose profile takes that method (§3.8.2, which also says what a device that can give back
   none of them shows). When the chosen payment cannot return
   it all, the screen fills in what it can and says what is left: "€2.00 left to refund from another
   payment" ("Quedan 2,00 € por devolver de otro pago"). A PIN given for "Cancel and refund" covers
   the refund too, so the screen does not ask again; the refund route already takes an approver's
   PIN (`tender-refund-authorization.ts:127-131`), and how the till carries that approval to it,
   never storing the PIN, is the plan's. The refund is a separate step: if the waiter abandons it,
   the dishes stay cancelled and charged. **Once A802 lands, this refund files the corrective
   invoice in the same step** (D20); until then nothing is filed and the invoice is unchanged.
4. **They'll collect it at the counter** (D17; its own slice). The table has paid and is freed, and
   the guests wait for their food: the order moves to the counter, and the table finishes. There it
   is a paid counter order with dishes still coming, which Find bill's Bills tab already keeps until
   it is collected (`apps/server/src/find-bill-bills.ts:72-73`) and whose dishes leave the pass when
   it is (`liveKitchenDish`, `apps/server/src/working-order.ts:7323-7329`). **No path today moves a
   paid bill there.** Move this bill → The counter (`table.to_counter`,
   `apps/till/src/screens/till-table-order-screen.ts:5128-5137`; `moveBill`,
   `apps/server/src/move-bill.ts:78`) refuses a paid bill `bill.paid` (`:90`). The department
   transfer, whose accept offers "No table" (`department_transfer.no_table`,
   `apps/till/src/i18n/strings.ts:228`), refuses a bill that is neither open nor placed, and any
   bill of a party (`department_transfer.tab_unavailable` and `department_transfer.structure_unsupported`,
   `packages/venue-service/src/department-transfers.ts:183-197`; again on accept, `:394-395` and
   `:422-423`). So the slice builds the move; its design settles which path it extends (Move this
   bill's counter branch is the nearer one) and what a held dish does on the way (fired, since the
   guests are waiting for it, is the likely answer).
5. **The pass says what happened** (picture 09). On a pass screen and the All stations board, a card
   whose party has finished shows **Table finished** («Mesa cerrada», §3.9) in place of its group and
   course buttons; the pass monitor shows the same words as a label. Since item 1, a paid table no
   longer finishes with dishes waiting, so the card is seen when a table closes without that
   question (item 6).
6. **What still leaves dishes on the pass.** The Q40 version's "Cancel items…" on the paid receipt is
   dropped: it was the way back for dishes left after a table closed without the question, and Finish
   table now always asks. **Record unpaid departure** still closes the party without asking
   (`closeParty`, `apps/server/src/unpaid-departure.ts:161`); it refuses only dishes not fired on the
   bills it invoices (`unpaid_departure.unfired_dishes`, `:82-91`), so fired dishes not yet served
   stay on the pass. A pass screen keeps a dish until that screen marks it Done (`listPassScreen`,
   `apps/server/src/pass-board.ts:50-72`; the mark is per device, `:131-191`), so each pass screen
   clears them by hand and nothing clears them for all. That gap is **A908** in the backlog.
7. **A cash refund when the guest has left is not tracked** (D21): no "Is the customer here?", no
   "cash owed" record, and no switch saying the money was handed over (D24). A cash refund is
   recorded and the drawer opens under the usual rules; whether the cash reaches the guest is outside
   the system. §3.8.2 says what that does to the drawer and its count.

**Which dishes are listed, and how each row starts.**

| Where the dish is | Pass today | Listed | Preparation started? | Refund tick starts |
|---|---|---|---|---|
| Held (not yet fired) | yes, greyed, "Held, not released" | yes | No (known) | ticked |
| Fired, not started | yes | yes | asked: Yes / No | ticked after No, unticked after Yes; none before |
| Being prepared, or ready | yes | yes | Yes (known) | unticked |
| Away, or served | no longer waiting | no | — | — |

A line never sent to the station has no kitchen item, so the pass does not show it; lane G's plan
refuses every new payment while a bill has unsent dishes (plan Task 21), so once A773-1 lands a paid
bill holds none.

**What records it.** One `adjustments` row per dish line: a void (`cancel`) whose amount before and
after are both what the dish added to the bill, so it takes **€0.00 off**, with the dish's list
value, the reason, the note, who asked and who approved, the stage, and whether preparation had
started (§3.6). An unpaid "Cancel, still charge" is recorded the same way (the probe below ran on a
settled bill only). On an open bill, other readers of `adjustments` come after such a row — a later
comp on the line, a payment, the invoice. On either bill, the report adds every cancel's list value
to the sales of the person the line is credited to, "since a cancelled line has left the bill"
(`packages/adjustments/src/reports.ts:344-350`, `:383`), which by reading would count a dish still
charged twice. The plan checks each of these against a €0.00 cancel row. The station side is lane
G's `keep_charge`. Neither changes an amount on the bill, the sale
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
  **"Void, charged"** ("Cancelado, cobrado", lane G's words for the table screen). A refunded dish
  reads the same, because a refund does not change the bill, and shows the refund beside it (§3.6).
- An unpaid "Cancel, don't charge" keeps today's cancel adjustment, whose reduction is the dish's
  value.

**Who may.** A cancel with nothing ticked needs nobody's PIN; a refund needs the refund permission
(D13), as the refund itself already does (`apps/server/src/tender-refund-authorization.ts:87`).
Beyond that, the till's own rights, as A773-1's route asks: a signed-in session on
an admitted device whose profile has `take-orders` (`line-cancel-api.ts:39-51` on lane G's branch),
and the zone. A finished party holds no table, so its zone reads as none (`partyZone`,
`apps/server/src/parties.ts:199-212`), and a subject in no zone passes the zone check whatever the
device's zones (`assertSubjectZones`, `apps/server/src/zone-access.ts:43-56`) **(read)**. Closing a
party keeps only its tables' names (`closePartyTables`, `parties.ts:740-744`), but each order keeps
its zone and the check already reads it for an order (`zone-access.ts:22-25`) **(read)**: the build
checks the order's zone for a finished table's dishes, with no new stored field, and adds a refusing
case. (These references are to `2212ff18d`.) With Finish table cancelling in the same request that
closes the party, the cancel runs while the party is still open; the zone point matters for "They'll
collect it at the counter" and for A908.

#### 3.8.1 They stay on the bill — what each place says

**Yes.** A dish cancelled without a refund stays on the bill, the receipt and the filed invoice at
its full price, because the guest paid for it. The cancel takes it off the pass, tells the station
and records why; it moves no money and files nothing. A refunded dish stays on the original invoice
too — a filed invoice never changes. The money goes back by the refund, and until A802 lands nothing
tells the tax agency. Once A802 lands, a second invoice, the correction, takes the refunded dishes
off, in the same step as the refund (D20).

Worked example. Table 4, four guests, €62.00 paid by card at 22:10, all at 10% VAT: 2 × Croquetas
(€7.50 each, €15.00) being prepared, 1 × Flan (€5.50) held and never fired, and €41.50 of other food
and drink, all served. At 22:12 Ana presses Finish table on Caja 1, a till whose profile takes card
payments on its reader: "3 dishes not served". The Flan is ticked,
the Croquetas are not; the reason starts on "Not served".

| | Cancel (she unticks the Flan) | Cancel and refund €5.50 (the ticks as they come) |
|---|---|---|
| Station | a VOID slip for the Croquetas, a hold correction for the Flan; both leave the pass | the same |
| Bill and receipt | unchanged: €62.00, every dish on it | unchanged, plus a refund slip for €5.50 that says the invoice does not change |
| Filed invoice | the F2 for €62.00 | the same F2 for €62.00 |
| Veri\*Factu before A802 | that one record | that one record: the refund files nothing |
| Veri\*Factu once A802 lands | that one record | plus an R5 (the corrective invoice for a simplified one) by differences: −€5.50, base −€5.00 and VAT −€0.50, pointing at the F2; €56.50 invoiced in all |
| Voids and comps report | two entries, "Void, charged", €0.00 off, value €20.50; preparation started: Croquetas yes, Flan no | the same, and the Flan's entry shows "Refunded €5.50" |
| PIN | none | Ana cannot give refunds, so Luis enters his |
| Money | the venue keeps €62.00 | the card gets €5.50 back; the venue keeps €56.50 |

Arithmetic: €15.00 + €5.50 + €41.50 = €62.00. €5.50 ÷ 1.10 = €5.00 base, €0.50 VAT. Refunding all
three dishes would be €20.50: base €18.64 (€20.50 ÷ 1.10 = €18.636, to the cent), VAT €1.86, which
together make €20.50 — the owner's rule that the amount entered is what the customer gets back, VAT
included (`docs/backlog/fiscal.md`, A802's points of 2026-09-29).

**What A802 files.** Correcting part of a paid invoice is **A802** (lane E, spec first; queued
`pending` after A679, no spec under `docs/superpowers/specs/` yet). The engine already takes a
partial correction (`packages/core/src/record-correction.ts:92`), files by differences
(`TipoRectificativa: "I"`, `packages/fiscal-verifactu/src/backend.ts:429`), and "settles
nothing; a refund is a separate payments action" (`:80-81`); the server's one caller credits the
whole invoice (`apps/server/src/cancel-credit.ts:64-75`, `wholeInvoice: true`). This dialog needs
no correction of its own. **Settled for A802 (D20):** a refund of cancelled dishes issues the
partial R5 for them in the same step; the refund slip's "the invoice does not change" then changes
with it.

**Out of scope.** A counter sale: its dishes leave the pass when the order is collected, and Find
bill's Bills tab keeps a paid counter sale until then (`find-bill-bills.ts:72-73`).

**Order.** This builds on A773-1's route and station side, so it waits for A773-1 to land (§10 says
which parts A773-1 builds). It does not wait for A802. A migration is expected for the
preparation-started flag and the refund link (§3.6); the €0.00 row itself fits today's table (run
above).

#### 3.8.2 A cash refund and the drawer (D24)

The owner, 2026-10-19: "I don't think we need this confirmation. But they will need to open the
cash drawer, which can only happen from the till, although they could cancel then take the money
out later, or not at all." So the switch goes; the refund goes through without it; and the drawer
keeps today's rules.

**The switch today, and what the build removes (read, on `ad57a6bb9`).** Only Refund a payment
(a refund after the invoice) has it; Give back a payment before the invoice has none (its request
carries only `manualConfirmed`, `apps/server/src/bill-refunds.ts:52-62`).

- **The till** draws "I have handed this money back to the customer" («He entregado este dinero al
  cliente», `tender_refund.cash_confirm`, `apps/till/src/i18n/strings.ts:49`, `:1634`) as a
  `wt-switch` for a cash payment (`apps/till/src/widgets/tender-refund-dialog.ts:318-336`) and will
  not send while it is off (`:228-232`); a refusal naming it is shown beside it and cleared when it
  changes (`:197`, `:240`); the draft carries it (`:34`, `:43`, `:160`) and the saved
  attempt too (`apps/till/src/state/tender-refund.ts:45-46`, `:60`;
  `apps/till/src/api/tender-refund-types.ts:10`).
- **The server also requires it:** a cash refund whose `cashConfirmed` is not true is refused
  `management.request_invalid` naming that field (`apps/server/src/tender-refund-reservation.ts:90-91`).
  The field is parsed at `apps/server/src/tender-refund-api.ts:102-110`, typed at
  `apps/server/src/tender-refund-types.ts:11`, set true for cash when a pending refund is retried
  (`tender-refund-api.ts:257`), and is part of the fingerprint stored to recognise a repeated
  request (`tender-refund-reservation.ts:53-61`, stored at `:156`). **(run)** On `ad57a6bb9`, Node
  v26.11.1, `tender-refunds.test.ts:372` ("does not return cash without confirmation") passed.
- **The build removes all of it on both sides**: the switch, its string in both languages, the
  draft and saved field, the till's check, the server's check, the request field and its parsing.
  One case for the plan: a refund recorded before the upgrade whose answer the till never got, sent
  again by the till with the same request after it, would be refused `submission.id_reused`
  instead of being answered with the refund already recorded, because the stored request was
  checked with the switch in it (`tender-refund-reservation.ts:63-69`). This holds for cash and card
  alike; a retry by the refund's own id checks no such thing (`tender-refund-api.ts:240-294`).
  **Unchanged:** the
  hand-keyed card's switch, "I have returned this money on the original card terminal"
  (`strings.ts:50`), which the server still requires (`tender-refund-reservation.ts:92`,
  `apps/server/src/tender-refund-authorization.ts:133`).

**What a cash refund does to the drawer today.** Both refund paths complete a cash refund and queue
its drawer job in the same transaction (the job is queued with the refund's `tx`,
`apps/server/src/tender-refunds.ts:117`, `apps/server/src/bill-refunds.ts:676`):

- **Refund a payment** (A758's refund): `apps/server/src/tender-refunds.ts:106-118` completes it and calls
  `enqueueTenderRefundDrawer` (`apps/server/src/receipt-print.ts:618-657`), which queues an audited
  `drawer` job only for a completed cash refund made on this device (`:625-639`), once (`:640-644`),
  and only when `drawerPrinter` finds one (`:645-646`).
- **Give back a payment** (before the invoice): `bill-refunds.ts:670-680` completes it and calls
  `enqueueBillRefundDrawer` (`receipt-print.ts:600-616`), which goes through the same
  `drawerPrinter` (`enqueueBillDrawer`, `:545-566`).
- **`drawerPrinter`** (`receipt-print.ts:66-74`) takes the device's drawer printer — its own drawer
  choice, else its profile's default (`resolveDrawerPrinter`, `:88-97`) — and opens nothing unless
  the profile allows `open-cash-drawer` and that printer has a drawer.

**Which device may give back which payment.** A refund goes back by the payment's own method, and
the device's profile must take that method, the same check as taking the payment
(`assertTakesTender`, `apps/server/src/device-session.ts:395-402`): cash needs `take-cash`
(`assertTakesCash`, `:380-384`, refusing `device.cash_not_allowed`); a card taken on a connected
reader needs `integrated-card-payment` (`:401`, refusing `device.forbidden_action`); a card keyed on
a separate terminal needs `hand-keyed-card-payment` (`:400`). Refund a payment checks it at
`tender-refund-authorization.ts:122-125`, with the method from `refundTenderKind` (`:37-69`); Give
back a payment at `apps/server/src/bill-payments-api.ts:285-286`. The refund screen lists every
payment on any device (`tender-refund-dialog.ts:46-50`), so today the refusal comes on Refund; for
cash the till says "This device does not take cash. Take cash at a till." (`apps/till/src/i18n/codes.ts:729-732`).

| The payment | The profile needs | Seeded Counter till | Seeded Handheld |
|---|---|---|---|
| Cash | `take-cash`; the drawer opens only with `open-cash-drawer` and a drawer | gives it back; the drawer opens | refused `device.cash_not_allowed` |
| Card on a connected reader | `integrated-card-payment` | gives it back | refused `device.forbidden_action` |
| Card keyed on a separate terminal | `hand-keyed-card-payment` | gives it back, with the terminal switch and a PIN | the same |

The seeded profiles are at `packages/layouts/src/device-profile.ts:95-109` (Counter) and `:110-116`
(Handheld, seeded at `:144-149`); a venue may change either. **(run)** On `ad57a6bb9`, Node
v26.11.1, `tender-refund-authorization.test.ts:394-414` ("requires the current device's %s tender
capability") passed for cash, a hand-keyed card and a connected card.

For cash, by device:

| The device's profile | A cash refund today |
|---|---|
| takes cash and may open a drawer that has one | completes; the drawer opens, audited |
| takes cash, no drawer it may open | completes; nothing opens. **(run)** `tender-refunds.test.ts:408` ("completes cash without a drawer job when the profile has no drawer permission") passed on `ad57a6bb9` |
| does not take cash | refused `device.cash_not_allowed`; nothing is written. **(run)** `tender-refunds.test.ts:380` (its `cash-policy` case) and `tender-refund-api.test.ts:409` (its `cash` case) passed on `ad57a6bb9` |

**So on a handheld as seeded, a cash refund and a connected-card refund are both refused today;
only a card keyed on a separate terminal can be given back there.** The design keeps that rule —
for cash it is CLAUDE.md §5's: `take-cash` decides whether a device takes cash at all. §11's
question is about cash only, because the owner's answer was. A connected card is not in it: its
money goes back through the card provider, sent by the server (`apps/server/src/tender-refund-sends.ts:332`),
not through the device's reader, so the profile check on it is the code's choice — "as a payment
of it would need" (`bill-payments-api.ts:284`) — rather than something the hardware needs; a venue
whose handhelds should give card payments back turns on `integrated-card-payment` in their profile,
which also lets them take card payments on a reader (`apps/till/src/till-app.ts:8449-8452`).

**What a device shows when it cannot give the money back** (D28). The till knows both sides: its profile's actions (`till-app.ts:8445-8452`) and each
payment's method and whether it was keyed by hand (`apps/till/src/api/tender-refund-types.ts:15-23`).

- On a device that can give back **none** of the bill's payments, Finish table and the table's
  Cancel item… on a paid bill show no Refund ticks, the main button reads "Cancel", and one line
  says **"Give the money back at a till: Refund a payment on the receipt."** («Devuelve el dinero en
  una caja: Devolver un pago, en el recibo.» — "Devolver un pago" is the receipt's button,
  `tender_refund.title`, `apps/till/src/i18n/strings.ts:35`, `:1619`, drawn at
  `apps/till/src/screens/till-ticket-view.ts:909-913`; "recibo" as in «Abrir recibo», `strings.ts:2125`;
  "caja" as in `codes.ts:731`). No PIN is asked: "Cancel" with nothing ticked needs none (D13), so
  nobody approves a refund the device would refuse.
- Where **some** payments can be given back on this device and others not, the ticks work and the
  refund screen offers only the payments this device can give back. What it cannot cover shows as
  "€x left to refund from another payment" (§3.8 item 3), followed by the line above. That line's
  meaning fits — the rest does come from another payment — but alone it would send the waiter to
  pick that payment here, where it is refused, so the till line follows it.
- A refund given back later at a till from the receipt is not linked to the cancel, so the Voids
  and comps entry shows no "Refunded" for it.

The summary relayed with the owner's answer read it the other way ("on a device that cannot (a
handheld), nothing opens and the refund still goes through"), which today happens only on a device
whose profile takes cash and opens no drawer; §11 asked, and the owner kept today's rule (D28).

**Taking the money out later without a refund.** The manual open (`POST /api/drawer/open`,
`apps/server/src/till-api.ts:2489-2523`) needs the profile's `open-cash-drawer` (`:2495`),
`cash.drawer` or the PIN of someone who holds it (`:2499-2509`; held from supervisor up,
`packages/identity/src/permissions.ts:46-55`), and a drawer on the device's drawer printer
(`:2511-2517`); it records a `drawer_opens` row with the reason `manual` (`receipt-print.ts:398-415`)
and no amount. Ana, staff, does not hold `cash.drawer` (staff hold only `sale.take_payment`, `permissions.ts:45`), so she opens it with Luis's PIN. It is the
way to take out money for a refund already recorded on a device with no drawer it may open.

**The drawer count at cash-up.** Waitron has the day's cash figure, and the arithmetic of a count,
but no screen that takes a count.

- **The figure:** `computeCashUp` (`packages/reporting/src/cash-up.ts:18-93`) adds each device's cash
  payments and subtracts its completed cash refunds, both kinds (`:50-62`), against the device that
  recorded the refund; the Sales screen shows it per device and method
  (`apps/dashboard/src/screens/dashboard-sales-screen.ts:659-695`, from
  `/management-api/reports/daily-close`, `apps/server/src/report-api.ts:296`).
- **The count:** `recordDailyClose` (`packages/reporting/src/record-daily-close.ts:32`) takes, per
  device, an opening float, payouts and the cash counted, and records counted − (float + cash
  figure − payouts) as the difference (`:202-209`). **(run)** `git grep -n recordDailyClose -- apps
  ':!*.test.ts'` on `ad57a6bb9` finds only the demo script `apps/server/scripts/daily-close-z-demo.ts`:
  no route or screen takes a count today.
- **A recorded refund is money out, of the device that recorded it.** **(run)** On `ad57a6bb9`, Node v26.11.1, a throwaway test of
  `recordDailyClose` in `packages/reporting` (kept outside the repository at
  `~/waitron-campaign/a758r4-design/probe.test.ts`): a €62.00 cash sale and a completed €5.50 cash
  refund on one device, float €100.00. Counted €162.00 (the refund never taken out): figure €56.50,
  difference +€5.50. Counted €156.50: difference €0.00. Control, no refund, counted €162.00:
  figure €62.00, difference €0.00. A second throwaway test (`probe2.test.ts`, same place) recorded
  the refund on a second device instead and counted that device at €0.00: with Caja 1 counted at
  €156.50 (the money taken out of it), Caja 1's difference was −€5.50 and the second device's
  +€5.50, the venue's total €0.00; with Caja 1 counted at €162.00, Caja 1 €0.00 and the second
  device +€5.50. Control, the refund recorded on Caja 1 and counted at €156.50: €0.00.

Worked example. Caja 1 starts the day with a €100.00 float. Table 4 pays €62.00 in cash at Caja 1;
at Finish table Luis refunds the Flan, €5.50, at Caja 1, and the drawer opens. Caja 1 should hold
the float plus the cash taken less the cash refunds: €100.00 + €62.00 − €5.50 = €156.50. If he
hands the €5.50 to the guest, it holds €156.50. If the guest has gone and the €5.50 stays in the
drawer, it holds €162.00: **over by €5.50**, the refund's amount.

**Should anything show an untaken refund? Recommended: nothing new.** The owner chose not to track
whether the cash reaches the guest (D21), and "or not at all" accepts the money staying. A count
over by a refund's amount is that choice's expected result, and the refund is easy to find: it is
on the refund slip and beside its cancel in Voids and comps ("Refunded €5.50"). No backlog entry
builds the count screen (searching `docs/backlog.md` and `docs/backlog/` for the daily close and a
drawer count finds A239, recorded cash in and out, which replaces the typed float and payouts, and
"Richer daily close", one close across all tills, `docs/backlog.md:3002-3007` and `:5345`). Whatever
builds it must count a completed cash refund as money out of the device that recorded it, as the
figure already does.

### 3.9 The till's words, in English and Spanish (D23)

The owner chose «En preparación» on 2026-10-19 and approved every other word as recommended. The
English does not change. Lines are on `main` at `ad57a6bb9`.

| English | Spanish | Where it comes from |
|---|---|---|
| Has preparation started? | En preparación | new; the owner's choice, in place of «¿Se ha empezado a preparar?» |
| Yes / No | Sí / No | new |
| Preparation started (the report's column) | En preparación | new; one word for one meaning, as the question |
| They'll collect it at the counter | Lo recogerán en el mostrador | new; "mostrador" as the till already says for the counter («El mostrador», `table.to_counter`, `apps/till/src/i18n/strings.ts:2885`) |
| Cancel | Cancelar | the till's "Cancel" on an order line (`table.cancel_line`, `strings.ts:999`, `:2548`) |
| Cancel and refund {amount} | Cancelar y devolver {amount} | replaces lane G's «Cancelar y devolver el pago» |
| Cancel, don't charge | Cancelar sin cobrar | lane G's, already approved |
| Cancel, still charge | Cancelar y cobrar | lane G's, already approved |
| Remove (a dish not started) | Quitar | the till's "Remove" (`action.remove`, `strings.ts:280`, `:1865`) |
| {n} dishes not served (Finish table's heading) | {n} platos sin servir | new |
| Not served (a starter reason) | No servido | new |
| Other (a starter reason) | Otro motivo | new |
| Say why (Other's note, as its placeholder) | Indica el motivo | the till's (`working_order.reason_required`, `apps/till/src/i18n/codes.ts:352-355`) |
| Choose a reason (the drop-down, empty) | Elige un motivo | the till's (`adjust.reason_required`, `strings.ts:1030`, `:2579`) |
| €2.00 left to refund from another payment | Quedan 2,00 € por devolver de otro pago | new |
| Refunded €5.50 (a Voids and comps entry) | Devuelto 5,50 € | new in the report; the till shows «Devuelto: {amount}» for a refunded bill payment (`bill_pay.refunded`, `strings.ts:2975`) |
| Give the money back at a till: Refund a payment on the receipt. | Devuelve el dinero en una caja: Devolver un pago, en el recibo. | new; our reading (§3.8.2), not yet seen by the owner |
| Table finished (the pass card) | Mesa cerrada | new; matches «Cerrar mesa» for Finish table (`table.finish`, `strings.ts:2875`) |

The till already says «En preparación» for a dish being prepared (`table.row_preparing`, English
"Preparing", `strings.ts:973`, `:2523`); picture 06, which the owner saw when choosing, shows both
on the Croquetas' row.

---

## 4. The starter list (picture 01)

What a new venue starts with; the venue may change or delete any of it (a Void reason must remain).
No euro limit is seeded: a euro amount depends on the venue's prices, so it is the venue's to set
(D2). The only seeded limit is a share, which does not depend on prices.

| Kind | English / Spanish | Who can apply it | Who can approve it | Limits |
|---|---|---|---|---|
| Void | Entry error / Error al marcar | — | — | — |
| Void | Item not available / Producto agotado | — | — | — |
| Void | Customer changed mind / Cambio del cliente | — | — | — |
| Void | Not served / No servido | — | — | — |
| Void | Other / Otro motivo, note required | — | — | — |
| Comp | Complaint / Queja del cliente | Supervisor, Manager, Admin | Supervisor, Manager, Admin | — |
| Comp | On the house / Invitación | Manager, Admin | Manager, Admin | — |
| Comp | Staff meal / Comida de personal | Everyone | Manager, Admin | 50% an item |
| Comp | Discount / Descuento | Manager, Admin | Manager, Admin | — |

- Void reasons carry no lists and no limits (D13). Not served and Other were added with Q43 (b)
  (D16). Other is "type your own": its note is required, and the till asks for it with the
  placeholder "Say why". The same list is the refund screen's Reason (D26), so a venue keeps at
  least one Void reason that asks for a note (D27, §6).
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
the name, its kind, a Comp's two lists and its limits in one short line (a Void's cells are empty),
and a row menu with Edit and Delete. Below the list, the bill's comp limit (§3.5).

**Delete removes the row.** A recorded adjustment keeps its own copy of the reason's name and rules
(`reason_name`, `policy_snapshot`, no foreign key: `schema/adjustments.ts:60-64`), and a till holding
a deleted reason is told "That reason no longer exists. Reload and choose another"
(`apps/till/src/i18n/codes.ts:596-598`). Deleting the last Void reason is refused, and so is
changing its kind; the configuration import, which replaces every reason
(`apps/server/src/configuration-transfer.ts:679-689`), refuses a bundle with none. The same holds
for the last Void reason that asks for a note, and switching its "Note required" off is refused
too (D27, our reading): the refund screen's Reason is this list (D26), and without such a reason
nobody could type why a refund was given. Other may still be deleted while another Void reason
asks for a note. design-system.md's
"Switching off versus deleting" stops listing adjustment reasons.

**The form** (picture 02): Kind (Void | Comp), Name in each content language, then, for a Comp, Who
can apply it, Who can approve it and its own fields (§3.1); Note required last. A Void reason has
only Kind, Name and Note required, with a short line saying that who may cancel is set by the
refund permission, not by the reason. Save opens quiet and disabled until the draft changes
(`draftScopeFor`, `saveActionState`), as every saving form does.

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

- **`packages/adjustments`:** a reason's kind; for a Comp, two role lists instead of `applyRole` and
  `approverRole`, its limits, the item limit counting every comp the reason gave the item, and
  limits that ask instead of refusing; for a Void, only its name and note rule, and a cancel judged
  by D13 (the refund permission when money comes off or goes back) in place of the reason's roles and
  limit, with `billCancelNeedsManager` and its call removed (§3.2); the bill comp limit in euros with
  its approver list, replacing `maxBillDiscountBp`; the policy snapshot recorded on each adjustment
  changes shape; the new-venue seed of nine reasons (§4); the configuration import refusing a bundle
  with no Void reason, or none that asks for a note (D27); the page and form. **Migrations:** the
  reasons' new shape, a preparation-started flag on `adjustments`, and the link from a refund to the
  cancels it pays for. A fired dish answered No needs none: it leaves no record (D25). Before go-live no compatibility code (CLAUDE.md §3), so the plan measures the upgrade and
  says whether a venue reset is needed.
- **The approval path for a comp**, from "at or above a role" to "on the list": the verdict's one
  `approverRole` (`policy.ts:52`), the preview's `needsApproval` (`adjustments-apply.ts:539-542`,
  `:704`), the approver check (`adjustments-apply.ts:724`), the approver route
  (`adjustments-api.ts:203-212`) and the till's prompt (`strings.ts:1042-1045`). **For a cancel:** the
  refund permission, checked on the server, and the till's existing PIN prompt over
  `/api/refund-authorizers`, its `override.*` words reworded (§3.2).
- **Receipts:** "Descuento 100%" for a full comp (§3.4).
- **The till:** the Comp window's name and Free/%/€ from the reason; "Comp the bill" with 100%;
  approval prompts naming the reason or the bill limit; Spanish "Invitar" becomes "Descuento"
  (`apps/till/src/i18n/strings.ts:2508`, `:2513`, `:2515`, `:2552`; `apps/till/src/i18n/codes.ts:586`).
  The cancel dialogs (§3.3, §3.8) are A773-1's, built to this design (§10).
- **Reports:** By kind, entry wording, By reason's Asked by and Approved by, the Reason filter; per
  cancelled dish whether preparation had started («En preparación»), the amount off and
  "Refunded …" (§3.6). The report's credit of a cancel's value to a
  person's sales is checked against €0.00 cancels (§3.8).
- **The demo seed** (`apps/server/scripts/demo-seed/seed-adjustments.ts`): one kind per reason, the
  Comp reasons' lists filled, Not served and Other.
- **Order against A773-1.** A773-1 Task 16 builds the single Comp window over today's reasons and
  actions; Tasks 20 and 22 build Cancel item… and Finish table to §3.3 and §3.8 (§10). A758's rules
  slice changes who approves behind them, not their shape, so either can land first; whichever lands
  second adapts.
- **A758's slice for §3.8, after A773-1 lands:** the refund screen filled in, with the refund-to-cancel
  link; its Reason becomes the reason drop-down with the dishes on a line under it (D26), adding the
  till's read of the Void reasons to that screen and removing the typed field; the cash switch goes
  on the till and the server (D24, §3.8.2); the preparation-started flag and the report's columns; Table finished on the pass card; the
  order's zone for a finished party, with a refusing case. No fiscal change: the refund files what
  A802 makes a refund file.
- **"They'll collect it at the counter"** is a slice of its own: a move to the counter for a paid bill
  of a finishing party, which no path allows today (§3.8 item 4).
- **A908** (dishes left on the pass after Record unpaid departure) is a separate backlog item.

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

Pins of today's cancel rules, which change with D13: `packages/adjustments/src/policy.test.ts:124`
("counts a cancel's reduction against the bill limit") and the `billCancelNeedsManager` cases from
`:311`; `apps/server/src/adjustments-apply.test.ts:1631` and `:1782` (a cancel past the bill's share
limit asks a manager); and the cases that check a cancel's approval by the reason's roles, which the
plan finds among the 52 lines that `git grep -c 'action: "cancel"' -- 'apps/server/src/adjustments-*.test.ts' 'packages/adjustments/src/*.test.ts'`
counted on `4ce4a56c2` **(run)**.

Pins of the cash refund's switch, which go with D24, found with `git grep -n
"cashConfirmed\|cash_confirm" -- apps packages` on `ad57a6bb9` **(run)**:

- **Cases that assert the switch:** `apps/server/src/tender-refunds.test.ts:372` ("does not return
  cash without confirmation"), which becomes its opposite — a cash refund with no confirmation
  completes; `apps/server/src/tender-refund-reservation.test.ts:428-440` ("requires explicit cash
  handover confirmation"); `apps/till/src/widgets/tender-refund-dialog.test.ts:78`, `:96`, `:358`
  and `:369` (the switch reset, required, described and its refusal cleared).
- **Cases that list the field among others:** `tender-refund-reservation.test.ts:277` and `:393`;
  `apps/server/src/tender-refund-api.test.ts:477` and `:686`; `apps/till/src/state/tender-refund.test.ts:98`,
  `:117-140` and `:296`.
- **Fixtures and helpers that send it:** `tender-refund-api.test.ts:49`,
  `apps/server/src/tender-refund-authorization.test.ts:205`,
  `apps/server/src/tender-refund-management.test.ts:167`, `tender-refund-reservation.test.ts:171`,
  `tender-refunds.test.ts:240`, `apps/till/src/state/tender-refund.test.ts:12`,
  `apps/till/src/api/tender-refund-client.test.ts:57`, `tender-refund-dialog.test.ts:72`, `:116`,
  `:125`, `:166`, `:189`; and in `apps/till/src/till-app.test.ts` the A737 refund test's expected
  request (`:21816`, checked with `toMatchObject` at `:21933`) and its helper, which switches the
  switch on before submitting (`:21875`).

---

## 10. For other lanes

- **A773 (lane G), comps.** Its spec §3.8 says "The receipt keeps printing a free dish and a discount
  differently, as today"; D11 overrides that (a full comp prints "Descuento 100%"). Its window
  named "Discount…" is the Comp window under D10. Neither changes what lane G builds now.
- **A773-1 (lane G): what Cancel item… and Finish table build** (plan Tasks 20 and 22; branch read at
  `6b62e757b`, and at `84e08630a` for item 5's strings). The English and the Spanish are settled
  (§3.9).
  1. **Unpaid, not started** (held, or fired and answered No): Cancel item… removes the dish with no
     reason, no approval and no `adjustments` row; the station is told as today, through
     `removeFromLine`'s kitchen side. Today `remove_charge` requires a reason and writes a cancel
     adjustment for every unpaid dish (`line-cancel.ts:125-127`, `:157-176`); for a dish not started
     that stops. The removal must keep the checks the adjustment path makes today before it removes
     anything: the bill is open (`assertTabOpen`, `apps/server/src/working-order.ts:3480`, called at
     `apps/server/src/adjustments-apply.ts:395`), no payment is in flight (`refusePaymentInFlight`,
     `adjustments-apply.ts:399`) and nothing a bill payment paid for is removed (`refusePaidLines`,
     `:458-460`), all before `removeFromLine` (`working-order.ts:2602-2611`, which says it runs "once
     the caller has checked the bill and the paid lines"), with a refusing test for each. (Lines on
     `4ce4a56c2`; on lane G's branch the same calls are at `adjustments-apply.ts:417`, `:421` and
     `:499-501`, and `removeFromLine`'s description at `working-order.ts:2844`.) A fired dish answered
     No leaves no record, in A773-1 and after A758 (D25).
  2. **Fired, not started:** the dialog asks "Has preparation started?" Yes / No first, and the
     request carries the answer. With Yes the server accepts `keep_charge` (refused today,
     `line-cancel.ts:119-124`) and records `was_started` true (`:259`). Held and started dishes are
     never asked.
  3. **Started, unpaid:** "Cancel, still charge" and "Cancel, don't charge", both with the reason
     drop-down. "Don't charge" keeps today's cancel adjustment; its approval follows today's reason
     rules until A758's rules slice lands, then the refund permission. "Still charge" writes, beside
     its service-cancellation row, one `adjustments` cancel row taking €0.00 off through
     `recordAdjustment` (`packages/adjustments/src/record.ts:47`), after checking that the reason is
     one whose actions include `cancel` (a Void reason, once A758's rules slice adds the kind) and
     that a required note is there; it needs no approval.
  4. **Paid, not served:** the table's Cancel item… for one dish (picture 07) and Finish table for
     every such dish of the party (picture 06), each with the per-dish "Has preparation started?" and
     Refund tick, the reason drop-down (in Finish table starting on "Not served"), and the buttons
     "Cancel" / "Cancel and refund {amount}". Each dish keeps lane G's `keep_charge` station side and
     gains the €0.00 row of item 3. Finish table cancels and closes in one transaction. On a paid
     table this replaces Task 22's held-only list and its Fire choice, because every dish not served
     is cancelled. "Cancel and refund" opens the refund screen as Task 20 already does; filling it in
     is A758's. A served dish on a paid bill is not offered.
  5. **Buttons and PIN:** the main button names the action, in place of Close and Continue. For a
     refund on a paid bill (and for "Cancel, don't charge" once A758's rules slice lands), when the
     person lacks the refund permission, the button opens
     `till-supervisor-override-dialog` over `/api/refund-authorizers`, and the action completes with
     the approver's PIN, sent with the request and never stored. No "Ask for approval" button.
     Lane G's `cancel_item.*` strings at `84e08630a` (`apps/till/src/i18n/strings.ts`, English at
     `:5-16`, Spanish at `:1596-1607`) already ask «En preparación» with «Sí» / «No»
     (`cancel_item.preparation`, `:6`, `:1597`; `yes` and `no`, `:7-8`, `:1598-1599`), so the
     question's Spanish needs no change. Two keys change:

     | Key | English / Spanish at `84e08630a` | Do |
     |---|---|---|
     | `keep_payment` | Cancel, keep the payment / Cancelar sin devolver el pago (`:14`, `:1605`) | drop: a paid bill's cancel with nothing ticked is "Cancel" / «Cancelar» (`table.cancel_line`) |
     | `refund` | Cancel and refund / Cancelar y devolver el pago (`:15`, `:1606`) | reword: "Cancel and refund {amount}" / «Cancelar y devolver {amount}» |

     The rest of the keys stay. The new words Finish table needs (its heading and "They'll collect
     it at the counter") take §3.9's Spanish.
  6. **Not A773-1's:** the rules themselves (Void reasons without lists; the refund permission for
     a cancel that takes a dish off an unpaid bill), Not served and Other in the starter list, the
     preparation-started flag and the refund link with their migration, the report, the refund
     screen filled in (its Reason drop-down, D26, and no cash switch, D24), Table finished on the
     pass card, and "They'll collect it at the counter".
     Those are A758's, after A773-1 lands. Lane G need not add a reason column to
     `line_service_cancellations`: the reason lives on the `adjustments` row.
  7. **Finish table's "Not served" default** needs the venue to have that reason, which only A758's
     starter list seeds (a new venue today gets "Entry error" alone,
     `packages/adjustments/src/provisioning.ts:20-30`). How the till recognises it — a venue may
     rename or delete it — is for the plan to settle; with none found, the drop-down starts empty.
- **A802 (lane E; queued `pending` after A679, no spec yet).** Settled (D20): a refund of cancelled
  dishes files the partial R5 for them in the same step, and §3.8 then files it with no code of its
  own; the refund slip's "La factura original no cambia" changes with it. §3.8.1's worked example is
  the arithmetic to check against. The answers of 2026-10-19 change nothing for A802: the refund's
  reason keeps its stored shape (D26), and dropping the cash switch (D24) changes no amount.

---

## 11. Open questions

**Answered.** Q40 (2026-10-18): use the standard cancel with a reason, picked from a list or typed;
Finish table warns about dishes not served; a tick per dish for which to refund. **Q43 (2026-10-18,
about 22:50 to 23:45), in the owner's notes:** (a) replaced by D12, D17 and D18; (b) approved (D16),
with D13 in place of per-reason lists; (c) replaced by D13 and D14; (d) approved (D19); (e) approved
(D20); (f) replaced by D12 — "Cancel, still charge" takes a reason and needs no approval. The notes
also gave D15, D21 and D22. §3.8.1 answers "if we don't refund, they stay on the bill, no?": yes.

**A758r3 (2026-10-19, about 12:30 to 12:40), all four parts answered:**

- (a) "the column and question "Has preparation started?" is **«En preparación»** (with «Sí» /
  «No»), NOT «¿Se ha empezado a preparar?»", the report's column too, and "**Every other word as
  you recommended**". D23; the words are §3.9.
- (b) "I don't think we need this confirmation. But they will need to open the cash drawer, which
  can only happen from the till, although they could cancel then take the money out later, or not
  at all." No switch on any cash refund; the drawer keeps today's rules. D24, §3.8.2.
- (c) "**NOT LISTED** in Voids and comps … treated like a held dish, still editing the order." D25;
  no record and no migration for it.
- (d) "**the SAME drop-down** (as recommended)", starting on the cancel's reason or empty, Other
  giving the typed note, the dishes on a line under it. D26, §3.8 item 3; D27 is our reading of what
  it needs from the starter list.

**A758r4 (2026-10-19 ~14:05), answered: "KEEP TODAY'S RULE"** — cash is given back only on a
device whose profile takes cash; on a handheld Finish table shows no Refund tick, the button reads
"Cancel", and the one line «Devuelve el dinero en una caja: Devolver un pago, en el recibo.» sends
staff to a till. D28. The question as it was asked follows, for the record.

**The question as asked: a cash refund on a handheld.**

**Recommended: keep today's rule — cash is given back only on a device whose profile takes cash,
such as a till. "Recommended" is a complete answer.** Everything else in A758 is settled and
buildable; only a cash refund on a device that takes no cash would change if you choose the other
way.

Today a handheld, as Waitron sets it up, takes no cash, so a cash refund on it is refused ("This
device does not take cash. Take cash at a till."). Your words — "they could cancel then take the
money out later, or not at all" — fit the other way: the handheld records the refund now, and the
money comes out of a till's drawer later, or never. We recommend keeping today's rule because the
day's cash is counted per device, and a refund counts against the device that recorded it. With the
other way, the till whose drawer actually pays the money out ends the day short by the refund
against what it should hold, and the handheld, which has no drawer, has to be counted as holding
minus the refund. It would also have a device that takes no cash giving cash back, against the
rule that a device's profile decides whether it takes cash.

What the handheld shows under the recommendation: when none of the bill's payments can be given
back on it, Finish table shows no Refund ticks, its button reads "Cancel", and one line says "Give
the money back at a till: Refund a payment on the receipt." («Devuelve el dinero en una caja:
Devolver un pago, en el recibo.»). Nobody is asked for a PIN.

Worked example. Caja 1 starts the day with €100.00. Table 4 paid €62.00 in cash at Caja 1. Ana
(staff), on her handheld, presses Finish table; the Flan (€5.50) was never started.

- **Recommended:** there is no Refund tick; she presses "Cancel", the dishes are cancelled and the
  table finishes, and the line tells her to give the money back at a till. At Caja 1 she opens the
  receipt (Find bill → Transactions), presses "Refund a payment", picks "Not served", and Luis
  enters his PIN; the drawer opens and she hands €5.50 over. Caja 1 should hold €100.00 + €62.00 −
  €5.50 = €156.50, and it does. If she never does it, no refund is recorded, and Caja 1 should hold
  and does hold €162.00. Either way the Flan's entry in Voids and comps shows no "Refunded",
  because a refund made later from the receipt is not linked to the cancel.
- **The other way:** the Flan is ticked; she presses "Cancel and refund €5.50" and Luis enters his
  PIN on the handheld; the refund is recorded against the handheld, linked to the cancel, and
  nothing opens. Caja 1 should hold €162.00, and the handheld −€5.50. If Ana later takes €5.50 out
  of Caja 1 with Open drawer (Luis's PIN again), Caja 1 holds €156.50: short by €5.50, while the
  handheld, counted at €0.00, is over by €5.50 — the venue's total agrees, but neither device does.
  If nobody takes it out, Caja 1 is right and the venue is over by €5.50.
