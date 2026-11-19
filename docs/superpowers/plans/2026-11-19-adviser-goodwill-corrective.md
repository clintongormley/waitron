# ADVISER-GOODWILL-CORRECTIVE: money given back as goodwill takes a corrective invoice

Status: plan, written 2026-11-19 on `feat/adviser-goodwill-corrective` at `ee45498b38`, revised the
same day after a fresh-context review (ten findings). No code yet.

Words used below, once:

- A **corrective invoice** (Spanish *factura rectificativa*, type **R5** for a ticket) is a new invoice
  with negative amounts that reduces an invoice already issued. Waitron files it with AEAT (the tax
  agency) like any other invoice record.
- The **VAT split** of an invoice is, for each VAT rate on it, the **base** (the price before VAT) and
  the **VAT** charged on that base. A ticket with food at 10% and wine at 21% has two lines in its split.
- A **reason** is one of the venue's void and comp reasons, set up in the dashboard's **Voids and
  comps**. A **void** reason (kind `void`) explains cancelling a dish; a **comp** reason (kind `comp`)
  explains making a dish free or cheaper. The starter list has five void reasons and four comp
  reasons: **Complaint**, **On the house**, **Staff meal** and **Discount**.
- A **plain refund** is a **Refund a payment** that is neither a step of **Correct invoice** nor the
  refund of dishes cancelled with **Cancel and refund** or **Finish table**.
- The **watcher** is the session that supervises the campaign lanes and makes day-to-day choices
  the owner can overrule.

## 0. For the owner to confirm (the PR's first section)

The PR's first section lists these three choices word for word, marked as the **watcher's choices
(2026-11-19 08:00), not the owner's**:

1. **A plain refund of money the invoice counted is refused.** The refusal says why and names
   **Correct invoice**, which gives the money back and files a corrective. Refund a payment stays
   for a tip, for money still owed on cancelled dishes, and for an invoice naming a customer, which
   cannot be corrected yet (section 3.1). Its window and the guide say so, in English and Spanish.
2. An amount given back with **no dishes ticked**, on a ticket with dishes at two VAT rates, is
   shared across every dish in proportion to its price, exactly as the server already does when
   every dish is ticked. The till stops limiting the ticked dishes to one VAT rate. **The adviser
   has not confirmed this split**; the PR adds the question to the adviser sheet.
3. **Complaint** can be chosen as the reason for **Correct invoice**. **On the house**, **Staff
   meal** and **Discount** still cannot.

**What this changes in an owner-approved design.** The owner approved the A802 design on
2026-10-21 "with all three policies" (lane E's archive,
`~/waitron-campaign-e/archive/questions-to-2026-10-23.md:6487-6489`). Policy 2 there reads "both
permissions and explicit links, goodwill refunds stay money-only", and the design says "a
served-dish goodwill return can still use ordinary Refund a payment"
(`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:301-302`, also
`:31-32`). The owner's own decision of 18 November ("Money given back as goodwill takes a
corrective", `docs/compliance/2026-11-19-adviser-meeting.md:66`) overturns that, and choice 1 follows
from it.

Choices 2 and 3 overturn other parts of the same design **on the watcher's word only**:

- Choice 2. The design says "At mixed rates, explicitly pick the affected original lines before
  entering the amount. Show the allocation across those lines and rates" (`spec:86-88`). Picking
  dishes at both rates was therefore always the approved design; the till's one-rate lock came in
  with A802 slice 5b (section 2), so dropping it restores the design. Only "no dishes ticked on a
  two-rate ticket → split by price" is new.
- Choice 3. The design says "Reason: use A758's Void-reason dropdown" (`spec:90`); allowing a comp
  reason is new.

The owner should confirm choices 2 and 3 before they are built (open question Q6).

**The fiscal boundary, for the owner.** `allocateCorrectionAmounts` decides the per-rate base and VAT
figures that get filed with AEAT; with choice 2 it decides them in a case it refuses today (no dishes
ticked, two rates). The corrective builder (`recordCorrection`), the hash (`computeHuella`), the chain,
invoice numbering and series, and `registros_facturacion` and its triggers are untouched.

Customer-named full invoices still cannot be corrected (`packages/core/src/correction-eligibility.ts:5-9`);
that stays out of this item, and choice 1 leaves their plain refunds as they are today.

## 1. What staff can do when it lands

A guest complains after paying, and the manager wants to give €10 back. On the past receipt the
manager chooses **Correct invoice**, types €10 under **Money back, VAT included**, leaves the dishes
unticked, picks **Complaint** as the reason and presses **Correct and refund**. Waitron gives the
money back and files a corrective invoice for it, even when the ticket has food at 10% and drinks at
21%: the €10 is shared across the dishes by price, and the window shows the VAT for each rate before
anything is filed. Staff may also tick dishes at both rates.

If the manager chooses **Refund a payment** instead, the window says it is only for a tip or for
cancelled dishes, and pressing **Refund** for €10 is refused with a message naming **Correct
invoice**. Nothing changes in the dashboard's screens.

## 2. What happens today

Every line below was read on `ee45498b38`. The check run through the real server routes
(`~/waitron-campaign-l/receipts/adviser-goodwill/finding.md`, at `4993909df0`) is the receipt for the
behaviour; where its line numbers have moved, the current ones are given.

**Refund a payment files nothing.** A refund files a corrective only when it is a leg of an invoice
correction: `refundSettledTender` calls `fileCorrectionAutomatically` only when
`request.invoiceCorrection?.id` is set (`apps/server/src/tender-refunds.ts:144-146`). The window
says "This returns money only. The original invoice is unchanged." (`tender_refund.invoice_unchanged`,
`apps/till/src/i18n/strings.ts:130`, Spanish `:2259`), shown whenever the window is not a
correction's card refund (`apps/till/src/widgets/tender-refund-dialog.ts:566-573`). The till's two
buttons sit side by side on a past receipt (`apps/till/src/screens/till-ticket-view.ts:1017-1031`;
the finding's `:982-993` has moved). Finding row A: €10 refunded in cash, no corrective.

**Every payment amount Refund a payment can return was counted on the invoice.** A sale's payments
are written once, when it settles, and only if they add up exactly to the invoice total plus tips:
`if (compareDecimal(charged, due) !== 0) throw … "sale.tender_shortfall"`
(`packages/core/src/settle-sale.ts:89-101`; the one product insert into `tenders` is `:118`). No
later payment can be added. So the "payment amount" part of any refund is money the invoice counts;
only the tip part is not.

**What the data can tell apart.** The request carries `invoiceCorrection` when it is a step of
Correct invoice, and `cancellationIds` when it refunds dishes cancelled with Cancel and refund or
Finish table (`apps/server/src/tender-refund-types.ts:5-17`; the till sends the ids only from a
filled-in window, `apps/till/src/till-app.ts:9010-9017`). Product code reaches the refund
reservation from two places only: the till route (`apps/server/src/tender-refund-api.ts:170-185`)
and Correct invoice's cash step, which always carries `invoiceCorrection`
(`apps/server/src/invoice-correction-cash.ts:113`). Three legitimate plain refunds remain:

- **A tip.** A tip can be returned only together with all of the payment's remaining amount
  (`apps/server/src/tender-refund-reservation.ts:207-215`; test "enforces applied and whole-tip
  ceilings", `tender-refund-reservation.test.ts:468-479`). So a tip goes back on its own only once
  the payment amount is all back, for example after Correct invoice returned it. Such a refund has
  a payment amount of 0.
- **The rest of a cancelled-dish refund.** When the first payment holds less than the cancelled
  dishes' value, the guide tells staff to "choose **Refund a payment** again and pick a payment.
  That window is not filled in" (`apps/server/src/guide/en/table-service.md:285-290`); likewise a
  refund opened from the receipt after the filled-in window was closed (`:280-282`). These carry no
  `cancellationIds`. The server can still see them: the sale's working order holds a cancel with
  the Refund tick whose refund value is not all linked to refunds yet (`readCancelsForRefund`,
  `packages/adjustments/src/refund-links.ts:46-75`, which already sums what is linked).
- **An invoice naming a customer.** Correct invoice refuses it (`requireSupportedCorrection`,
  `correction-eligibility.ts:5-9`, read from `stored.sale.counterpartyTaxId` at
  `packages/core/src/correction-history.ts:115`). Refusing its plain refund too would leave no way
  to give money back at all.

The watcher's two examples of money "that was never the sale's" are not what this window does: a
card charged twice cannot show up as two payments on one sale (the exact-total rule above), and a
mistaken tip cannot go back on its own while the payment amount remains.

**Refunded cancelled dishes file no corrective either.** Finding row C; the backlog already holds
this ("a refund of cancelled dishes does not yet file its corrective in the same step", A758 §3.8,
`docs/backlog.md:360-363`). This plan leaves it there.

**Correct invoice with no dishes ticked, two VAT rates: refused.** `allocateCorrectionAmounts`
refuses an amount with no dishes (`lineIds` undefined) when the remaining dishes hold more than one
rate: `if (rates.size > 1) refuseScope("required")` (`packages/core/src/correction-allocation.ts:61-65`),
code `sale.correction_scope_invalid` with reason `required` (`packages/core/src/errors.ts:14`). The
till words it "This bill has dishes at more than one VAT rate. Pick the dishes to correct, all at
one rate." (`apps/till/src/i18n/codes.ts:488-491`; the finding's `:485` has moved). Finding row B2.

**Correct invoice with dishes at both rates ticked: works on the server, blocked by the till.** With
`lineIds` given, the same function shares the amount across those dishes by their remaining price
(`correction-allocation.ts:71-80`, `apportionCorrectionCents` at `:239-257`), then works out each
rate's base and VAT within the invoice's own stored figures (`:87-117`, `correctionBaseAtRate` at
`:126-141`). Finding row B3 filed this through the routes: €10 split −€4.89 base and −€0.49 VAT at
10%, −€3.82 and −€0.80 at 21%. The till greys out every dish at another rate once one is ticked:
`(picked !== undefined && picked.rate !== line.rate)` (`apps/till/src/widgets/invoice-correction-dialog.ts:591`),
pinned by the test "previews the picked dishes and stops offering dishes at another VAT rate"
(`invoice-correction-dialog.test.ts:216-231`). That lock came in with A802 slice 5b (#3108,
`997ce08baa`); the slice plan says "pick dishes (optional at one VAT rate)"
(`docs/superpowers/plans/2026-11-11-a802-slices-4-5.md:32-33`), narrower than the approved design.

**The corrective builder already takes two rates.** `fileCorrectionIn` passes the preview's lines and
its per-rate split to `recordCorrection` unchanged (`apps/server/src/invoice-corrections.ts:357-382`);
the split is whatever `previewCorrectionAmounts` returns (`packages/core/src/correction-history.ts:43-63`).
Choice 2 only stops `allocateCorrectionAmounts` refusing; with no dishes ticked it then takes every
remaining dish (`correction-allocation.ts:71`, `scope === undefined` keeps all lines), which is the
B3 path. No builder changes.

**Reasons for Correct invoice: void only.** Open refuses any reason whose kind is not `void`:
`if (reason.kind !== "void") throw new AppError("adjustment.action_not_allowed", {})`
(`apps/server/src/invoice-corrections.ts:229-230`). The till offers only reasons whose actions
include `cancel` (`voidReasons`, `apps/till/src/widgets/reason-picker.ts:10-12`), used by the
correction window at `invoice-correction-dialog.ts:358`, `:654` and `:782`, and by the two refund
windows (`bill-refund-dialog.ts:290`, `tender-refund-dialog.ts:145-151`). Finding row B4.
**Complaint**, **On the house** and **Discount** are seeded identically: kind `comp`, actions
`["comp", "discount_percent", "discount_amount"]`, limit €0 (`packages/adjustments/src/provisioning.ts:28-63`).
Nothing on a reason tells them apart except the name, which the owner can edit.

**The reason's text never reaches AEAT.** Open stores `reason.name` (plus any note) on the
correction row (`invoice-corrections.ts:248`); `recordCorrection` gets no reason
(`invoice-corrections.ts:368-382`).

**The dashboard drops actions it does not offer.** The reason editor copies a comp reason's
`actions` into its draft (`packages/adjustments/src/dashboard/reasons-screen.ts:632`, copied again at
`:90`), but both the unsaved-change comparison (`:397`) and the saved body (`:722`) keep only
`OFFERS`, the three comp actions (`:50`). So any other stored action is silently removed the next
time a manager saves that reason, even if they changed only its name.

## 3. Design

### 3.1 Choice 1: a plain refund of invoiced money is refused

**Server.** In `reserveTenderRefund` (`apps/server/src/tender-refund-reservation.ts`), right after
the existing `refuseWhileCorrectionOpen` call (`:197`, which runs after the replay check, so a
repeated earlier request still answers), refuse with a new code `tender.refund_needs_correction`
(params `{ tenderId }`) when all of these hold:

- the request carries neither `invoiceCorrection` nor `cancellationIds`;
- its payment amount (`appliedAmount`) is more than 0;
- the sale's invoice names no customer (`counterpartyTaxId` is null, read as `correction-history.ts:115` reads it);
- the sale's working order has no cancel with the Refund tick (`refund_handoff`) whose refund value
  is more than what is already linked to refunds.

The last condition is a new reader beside `readCancelsForRefund` in
`packages/adjustments/src/refund-links.ts`, taking the working order id and reusing that query's
linked sum. Register the code in `apps/server/src/errors.ts` (beside `:909-916`) and give it 409 in
the route's status list (`tender-refund-api.ts:138-139`).

**Known limit.** On a sale that still owes money on a cancelled dish, a plain refund is not refused,
whatever its amount, because plain refunds are not linked to the cancel. Closing that needs the
cancelled-dish refund to file its own corrective (the backlog entry in section 2).

**Till.** The refusal's message (`apps/till/src/i18n/codes.ts`, beside `:572-591`):

| | Text |
| --- | --- |
| en | This payment was counted on the invoice, so giving it back must correct the invoice. Close this window and choose Correct invoice: it gives the money back and files a corrective invoice for it. |
| es | Este pago cuenta en la factura, así que para devolverlo hay que rectificarla. Cierra esta ventana y elige Rectificar factura: devuelve el dinero y presenta una factura rectificativa por él. |

It shows as the window's bottom message; a request refusal never disables the button
(CLAUDE.md §3, Forms).

The window has three states (`tender-refund-dialog.ts:566-573`):

- opened as a correction's card refund (`correcting`): unchanged, `tender_refund.correction_leg`;
- opened filled in from a cancelled dish (`dishes` not empty): unchanged,
  `tender_refund.invoice_unchanged`;
- opened plainly from a receipt: a new line, key `tender_refund.money_only`, with `data-money-only`
  in place of `data-invoice-unchanged` and the same `muted` styling:

| | Text |
| --- | --- |
| en | This returns money without correcting the invoice: only a tip, or what is still owed for cancelled dishes. For any other money back, choose Correct invoice. |
| es | Esto devuelve dinero sin rectificar la factura: solo una propina, o lo que falta por devolver de platos cancelados. Para cualquier otra devolución, elige Rectificar factura. |

An invoice naming a customer is not mentioned in the line: staff there meet Correct invoice's own
refusal first, and the line would be longer than the case is common.

### 3.2 Choice 2: an amount with no dishes ticked is shared across every dish

**Server.** Delete the `rates.size > 1` refusal (`correction-allocation.ts:61-65`). With no dishes,
the amount is shared by remaining price across all remaining dishes, cents by largest remainder,
then each rate's base and VAT within the stored budget, as for ticked dishes today. Remove
`"required"` from the reason type of `sale.correction_scope_invalid` (`packages/core/src/errors.ts:14`)
and from `refuseScope`'s parameter (`correction-allocation.ts:58`); `empty`, `missing` and
`duplicate` stay. Consumers traced: the code's HTTP status (`apps/server/src/invoice-correction-api.ts:47`,
unchanged), the till's field placement (`invoice-correction-dialog.ts:613`, by code only), and the
till's message (`codes.ts:488`). Nothing branches on the `required` reason (`git grep -n '"required"'`
over those files).

**A note for ADVISER-ADVANCES** (queued, `~/waitron-campaign-l/queue.md:120`, not yet planned): if
the final ticket comes to deduct an advance as a line of its own, sharing a goodwill amount by price
across every line must leave that line out.

**Till.** Delete the one-rate clause at `invoice-correction-dialog.ts:591` and the now-unused
`picked` at `:573`. The split lines (`invoice_correction.split`, one per rate) already show both
rates. The message for `sale.correction_scope_invalid`, now reached only when the dish list no
longer matches the invoice (for example, the invoice was exchanged while the window was open):

| | Text |
| --- | --- |
| en | The dishes chosen are not on this invoice. Close this window and choose Correct invoice again. |
| es | Los platos elegidos no están en esta factura. Cierra esta ventana y vuelve a elegir Rectificar factura. |

**Adviser sheet.** `docs/compliance/2026-11-19-adviser-meeting.md`, both parts. The numbers are
finding row B3's, recomputed: 35/65 of €10 is €5.38 (−€4.89 + −€0.49), 30/65 is €4.62 (−€3.82 +
−€0.80).

Part 1, a new bullet after line 161:

> - **Goodwill on a ticket with two VAT rates.** When the money given back is not tied to particular
>   dishes, Waitron shares it across the ticket's dishes in proportion to their prices, and so across
>   its VAT rates. For example, €10 given back on a €65 ticket (a €35 paella at 10% and €30 of wine
>   at 21%) files −€5.38 at 10% (base −€4.89, VAT −€0.49) and −€4.62 at 21% (base −€3.82, VAT
>   −€0.80). *Is that split correct?*

Line 169 ("Open: the goodwill "yes" does not say which of the two choices it answers; read as: the
corrective is required.") contradicts line 66, which records the owner's decision. Replace it with:
"Decided: the owner's decisions of 18 November above read the goodwill "yes" as: the corrective is
required. Open: the split of a goodwill amount across two VAT rates in proportion to price is the
watcher's choice of 19 November (ADVISER-GOODWILL-CORRECTIVE); the adviser has not confirmed it."

Part 2, a new bullet after line 318:

> - **Una devolución de cortesía en un tique con dos tipos de IVA.** Cuando lo devuelto no
>   corresponde a platos concretos, Waitron lo reparte entre los platos del tique en proporción a su
>   precio y, por tanto, entre sus tipos de IVA. Por ejemplo, 10 € devueltos de un tique de 65 €
>   (una paella de 35 € al 10 % y 30 € de vino al 21 %) presentan −5,38 € al 10 % (base −4,89 €,
>   cuota −0,49 €) y −4,62 € al 21 % (base −3,82 €, cuota −0,80 €). *¿Es correcto ese reparto?*

The sheet's header says the shared Google Doc holds both parts; the PR does not change the Google
Doc and says so (open question Q4).

### 3.3 Choice 3: Complaint can be a correction reason

**Three ways to do it, weighed.**

| Option | What changes | Meets choice 3? |
| --- | --- | --- |
| (a) A stored mark `correct_invoice` in the starter Complaint's `actions`; no dashboard control | rules, server, till picker, starter; the dashboard only stops dropping the mark (3 lines) | Yes |
| (b) No restriction: any reason may be given for Correct invoice | delete one line on the server, offer every reason in the till window | No: On the house and Discount become choosable |
| (c) The mark plus a dashboard switch per comp reason (the first draft of this plan) | (a) plus a switch, two strings in two languages, save-state, unsaved-change and accessibility tests, guide text | Yes, with configuration nobody asked for |

The reason's text never reaches AEAT (section 2), so none of the three changes what is filed; they
change only which label staff can put on a correction. **Plan: (a)**, the smallest that meets the
watcher's choice. (b) would be smaller still, and the watcher may prefer it (open question Q2).

Under (a) the dashboard must still be touched: without it, a manager who renames Complaint or
changes its limit silently removes the mark (section 2, `reasons-screen.ts:397`, `:722`). So:

- `reasons-screen.ts:722`: the saved comp body keeps every action in the draft that the screen does
  not offer, after the offered ones: `[...OFFERS.filter(…), ...draft.actions.filter((a) => !OFFERS.includes(a))]`.
- `:397`: the comparison does the same, so the baseline and the edit compare alike.
- `:690`: the "pick at least one" check counts only offered actions, since `correct_invoice` alone
  is not a valid comp reason.
- `:632` already copies every stored action into the draft; switching a reason to void still
  writes `["cancel"]` (`:714`), dropping the mark with the comp actions, as intended.

Why a stored mark and not the name: names are edited by the owner and translated at setup
(`STARTER_REASON_NAMES`, `packages/adjustments/src/starter-content.ts`); matching
`names.en === "Complaint"` (as `NOT_SERVED_REASON` does for a default choice,
`apps/server/src/adjustments-api.ts:282-287`) would let a rename quietly open or close the path.
Why in `actions` and not a new column: `adjustment_reasons.actions` is JSON with only a not-empty
check (`packages/db/src/schema/adjustments/reasons.ts:30,40`), so no schema change and no rebuilt
starting migration. The A802 design's rule "A reason alone never decides which path is fiscal"
(`spec:78`) still holds: staff still choose **Correct invoice**; the mark only lets the reason be
picked there.

Known limits of (a): a venue cannot mark a reason it made itself; deleting Complaint leaves only
void reasons for corrections; the mark travels in a configuration export and import.

Parts:

- `packages/shared/src/adjustment-policy-types.ts`: add
  `REASON_ACTIONS = [...ADJUSTMENT_ACTIONS, "correct_invoice"] as const` and `type ReasonAction`.
  `ADJUSTMENT_ACTIONS` itself does **not** change: it is the adjustment records' column enum
  (`packages/db/src/schema/adjustments/adjustments.ts:19-21`) and the comp request's action
  (`apps/server/src/adjustments-api.ts:55`). `AdjustmentPolicySnapshot.actions` becomes
  `ReasonAction[]` (it copies the reason's list onto each adjustment, `packages/adjustments/src/policy.ts:201`;
  stored as JSON text, `adjustments.ts:63`).
- `packages/db/src/schema/adjustments/reasons.ts:30`: `json<ReasonAction[]>` (a type only; the
  generated SQL does not change; `scripts/starting-migrations.test.ts` proves it).
- `packages/adjustments/src/policy.ts`: `reasonShapeFault` (`:34-52`) lets a comp reason list
  `correct_invoice` beside at least one of `COMP_ACTIONS`; a void reason stays exactly `["cancel"]`.
  New export `offersInvoiceCorrection(reason)`: `kind === "void" || actions.includes("correct_invoice")`.
  `evaluateComp` (`:127-142`) is unchanged.
- `packages/adjustments/src/operations.ts:23`, `routes.ts:99-100`: accept `REASON_ACTIONS`.
  `configuration-transfer.ts:55-61` already validates through `reasonShapeFault`.
- `packages/adjustments/src/provisioning.ts`: **Complaint** gets
  `["comp", "discount_percent", "discount_amount", "correct_invoice"]`.
- `packages/country-es/src/demo/reasons.ts:79-92`: the demo's **Complaint** gets `correct_invoice`
  too. On a provisioned venue the starter's actions win (`apps/server/scripts/demo-seed/seed-adjustments.ts:43-56`
  keeps `present.actions`), so this matters only where the demo seeds without the starter list.
- `apps/server/src/invoice-corrections.ts:230`: `if (!offersInvoiceCorrection(reason)) throw …
  "adjustment.action_not_allowed"`. Same code as today.
- Till: `apps/till/src/api/client.ts:900-911` adds `ReasonAction` for `AdjustmentReason.actions`;
  `reason-picker.ts` gets `correctionReasons()` (void or `correct_invoice`) and an optional
  `offered` filter on `reasonPicker`, defaulting to `voidReasons`; the correction window uses
  `correctionReasons` at `:358`, `:654`, `:782`. The two refund windows keep `voidReasons`.
- Dashboard: the three lines above, and `packages/adjustments/src/dashboard/client.ts:8,17` adds
  `ReasonAction`. No new strings.

The correction window's opening line changes, since it now covers complaints:

| Key | | Text |
| --- | --- | --- |
| `invoice_correction.explain` | en, before | Correct an overcharge and return the difference. |
| | en, after | Correct an overcharge or give money back for a complaint, with a corrective invoice. |
| | es, before | Corrige un cobro de más y devuelve la diferencia. |
| | es, after | Corrige un cobro de más o devuelve dinero por una queja, con una factura rectificativa. |

Existing venues keep their reasons as they are: no data change before go-live (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production"). A venue reset
brings Complaint in.

### 3.4 Guide pages

`apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`; the
`{#id}` headings do not change. `{#comps-and-discounts}` does not change (no dashboard switch).

**`{#refund-receipt}`**, a new second paragraph (after en `:264-269`, es `:281-286`). It must not
contradict the next paragraphs, which send staff to Refund a payment after Cancel and refund:

- en: "This gives money back without correcting the invoice, so it is only for a tip, or for dishes
  cancelled with **Cancel and refund** or **Finish table**. For any other money back, such as for a
  complaint, choose **Correct invoice** instead: **Refund a payment** refuses it."
- es: "Así se devuelve dinero sin rectificar la factura, por lo que solo sirve para una propina o
  para platos cancelados con **Cancelar y devolver** o **Cerrar mesa**. Para cualquier otra
  devolución, como una queja, elige **Rectificar factura**: **Devolver un pago** la rechaza."

The Spanish button names are checked against the Spanish guide's own wording for those buttons
before writing; if they differ, the guide's wording wins.

**`{#correct-invoice}`**, first two paragraphs (en `:297-305`, es `:314-322`) become:

- en: "When a paid bill charged too much, or you give money back for a complaint, correct its
  invoice: the guest gets the money back and Waitron files a corrective invoice for it. On a past
  receipt, choose **Correct invoice**, beside **Refund a payment**." / "If the money back is for
  particular dishes, tick them under **Dishes to correct (optional)**; otherwise leave them all
  unticked, and it is shared across every dish by price. Enter the **Money back, VAT included**,
  and check the VAT shown for each rate. Choose a **Reason**, such as **Complaint**, then **Correct
  and refund**. If you may not correct invoices, someone who may enters their PIN."
- es: "Cuando a una cuenta pagada se le cobró de más, o devuelves dinero por una queja, rectifica su
  factura: el cliente recibe el dinero y Waitron presenta una factura rectificativa por él. En un
  recibo anterior, elige **Rectificar factura**, junto a **Devolver un pago**." / "Si el dinero que
  devuelves corresponde a platos concretos, márcalos en **Platos que se rectifican (opcional)**; si
  no, déjalos todos sin marcar y se reparte entre todos los platos según su precio. Escribe el
  **Dinero a devolver, IVA incluido** y revisa el IVA que se muestra para cada tipo. Elige un
  **Motivo**, como **Queja**, y después **Rectificar y devolver**. Si no puedes rectificar facturas,
  alguien que pueda introduce su PIN."

The help bubble `help.correct_invoice` (`apps/till/src/i18n/help-strings.ts:15`, `:82`) still holds
and does not change.

### 3.5 Backlog

- `docs/backlog.md:360-365`: delete "Money given back as goodwill needs a corrective too (owner,
  2026-11-18, …; the adviser is still to confirm the details)." and add "A goodwill amount with no
  dishes ticked is shared across the VAT rates by price; the adviser has not confirmed it." The
  cancelled-dish sentence stays.
- `docs/backlog/fiscal.md:900-907`: replace the goodwill bullet with one line: goodwill goes through
  **Correct invoice** since this PR, a plain refund of invoiced money is refused, and the split by
  price awaits the adviser (question 6 of the 19 November sheet). Add the three watcher choices,
  dated, to that file's `## Decisions and deliberate limits` (`:1076`), marked as the watcher's, for
  the owner to confirm, with the known limit of 3.1.

## 4. Fiscal checks every task runs

No change to `computeHuella`, the chain, invoice numbering, series, `registros_facturacion` or its
triggers, `recordSale`, `recordCorrection` or `recordSubstitution`. Choice 2 changes only which lines
`allocateCorrectionAmounts` may share an amount across before the existing builder is called;
choice 1 refuses before any refund row is written. Nothing here edits a builder, so there is no STOP.

Every task runs, unedited and passing:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts
```

## 5. Test assertions that change

| File:line, today | Before | After | Choice | For the watcher |
| --- | --- | --- | --- | --- |
| `packages/core/src/correction-allocation.test.ts:217` | `[undefined, "required"]`: no dishes on two rates is refused | row deleted; a new case asserts the no-dishes split equals the all-dishes split (`0.95/0.86/0.09` at 10%, `1.05/0.87/0.18` at 21%, the figures already pinned at `:52-60`) | 2 | **Controversial: decides how a corrective's VAT is divided** |
| `apps/till/src/widgets/invoice-correction-dialog.test.ts:216-231` | after ticking `steak`, `rice` (other rate) is disabled | `rice` stays enabled; ticking both previews with both ids | 2 | no money |
| `invoice-correction-dialog.test.ts:337-340` | the mocked refusal carries `reason: "required"` | `reason: "missing"`; the message is the new text | 2 | no money |
| `apps/till/src/widgets/tender-refund-dialog.test.ts:117-119` | a plain window shows `tender_refund.invoice_unchanged` | it shows `tender_refund.money_only` in `[data-money-only]`; a new case keeps `invoice_unchanged` for a window with `dishes` | 1 | no money |
| Server suites whose **setup** makes a plain refund of a payment amount (section 6, Task 7) | the refund succeeds | the same refund, given an allowed shape (see Task 7); every assertion about the refund itself unchanged | 1 | **Moves money in setup; assertions must not change** |
| `packages/adjustments/src/provisioning.test.ts:108-119` | Complaint's actions are `all` | `[...all, "correct_invoice"]` | 3 | no money |
| `apps/server/src/invoice-corrections.test.ts:892` and `apps/server/src/invoice-correction-api.test.ts:441` | the refused reason is the first comp reason (Complaint) | the refused reason is **On the house**; the refusal assertion is unchanged | 3 | no money |
| `apps/server/scripts/demo-seed/seed-adjustments.test.ts:142-148` | demo Complaint `actions: ["comp", "discount_percent"]` | plus `"correct_invoice"` | 3 | no money |
| `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:2019-2022` | Complaint's expected row gets `max_amount = 0` | the same loop also appends `"correct_invoice"` to Complaint's expected `actions` | 3 | no money |

**The Madrid fixtures are never edited.** `seed.madrid-baseline.test.ts:695-696` checks each
`packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json` against the sha256 in
`madrid-before-move.manifest.json`. The expected rows are adjusted inside the test instead, in the
`if (phase !== "before")` block at `:2018-2022`, which runs for both the provisioned and the seeded
stage. Both stages hold Complaint with the three comp actions today (read from the fixture), and the
seeded stage keeps the starter's actions (section 3.3), so both get `correct_invoice`.

Any other assertion that has to change is listed in the PR with file:line, before and after.

## 6. Tasks

Risk: fiscal invariants (how a corrective's VAT is divided) and money (a refund refused), so the full
path: per-task review, and `/finish-branch` with two Codex run-it reviews. Each task: failing test
first, watch it fail, then the change; then `pnpm exec prettier --check <changed files>` and the two
fiscal suites in section 4. Till and dashboard suites run real headless Chromium; check
`memory_pressure | grep free` first. Each task is meant for one implementer, well under 100 tool
calls; the sizes below are estimates of calls.

**Before Task 1:** the owner confirms choices 2 and 3 (Q6). Tasks 6-8 (choice 1) do not wait on
it; Task 9 comes last.

### Task 1: The server shares an unticked amount across every dish (choice 2, server) — about 30 calls

1. In `packages/core/src/correction-allocation.test.ts`, add "shares an amount with no dishes
   chosen across every rate, as choosing them all does": on `mixedRates()`, `{ gross: "2.00" }`
   equals `{ gross: "2.00", lineIds: ["wine", "dish"] }`. Delete the `[undefined, "required"]` row
   (`:217`). Run, see it fail with `sale.correction_scope_invalid`.
2. In `apps/server/src/invoice-corrections.test.ts`, add "files a corrective split across both rates
   when no dishes are chosen": `soldForCash(["Rib steak", "Cold soup"], ["17.60"])` (as at `:470`),
   open €8.80 with no `lineIds` and the split the preview gives, give the cash, file. Assert the
   corrective's stored `vat_breakdown` is `[{10.00, −2.50, −0.25}, {21.00, −5.00, −1.05}]`, its
   total −8.80, and `backend.checkIntegrity` reports no issues. Run, see it fail.
3. Delete `correction-allocation.ts:61-65`'s refusal (keep the `else` checks); drop `"required"` from
   `refuseScope` (`:58`) and from `packages/core/src/errors.ts:14`.
4. Commands:
   ```sh
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts
   ```

### Task 2: The till lets staff tick dishes at both rates (choice 2, till) — about 25 calls

1. Change `invoice-correction-dialog.test.ts:216-231` as in section 5 and rename it "previews dishes
   picked at both VAT rates"; change `:337-340` to `reason: "missing"`. Add a codes test that
   `codeMessage("sale.correction_scope_invalid")` is the new English and Spanish text. Run, see them
   fail.
2. Delete the clause at `invoice-correction-dialog.ts:591` and `picked` at `:573`; replace the
   message at `apps/till/src/i18n/codes.ts:488-491`.
3. Commands:
   ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/invoice-correction-dialog.a11y.test.ts src/i18n/codes.test.ts
   ```

### Task 3: Complaint is marked for Correct invoice (choice 3, rules and server) — about 60 calls

1. Tests first:
   - `packages/adjustments/src/policy.test.ts`: `reasonShapeFault` accepts a comp reason with
     `["comp", "correct_invoice"]`, refuses `["correct_invoice"]` alone and a void reason with
     `["cancel", "correct_invoice"]`; `offersInvoiceCorrection` is true for a void reason and for a
     comp reason with the mark, false for a comp reason without it.
   - `packages/adjustments/src/provisioning.test.ts:108-119` as in section 5.
   - `packages/adjustments/src/configuration-transfer.test.ts`: an export whose comp reason carries
     `correct_invoice` imports with it; one with an unknown action is refused.
   - `packages/adjustments/src/routes.test.ts`: saving a comp reason with `correct_invoice` is
     accepted, and an unknown action still answers `management.request_invalid`.
   - `apps/server/src/invoice-corrections.test.ts:889-900`: rename to "a comp reason not offered in
     Correct invoice, and opens with Complaint and with a Void reason"; the refused one is **On the
     house**, and Complaint opens. Same change at `invoice-correction-api.test.ts:438-447`.
   - `packages/shared/src/adjustment-policy-types.test.ts`: `REASON_ACTIONS`, and
     `ADJUSTMENT_ACTIONS` unchanged.
   - `seed-adjustments.test.ts:142-148` and `seed.madrid-baseline.test.ts:2019-2022` as in section 5
     (never the fixture JSON).
   Run, see them fail.
2. Make the changes in section 3.3 for shared, db (type only), adjustments (policy, operations,
   routes, provisioning), the demo reasons and `invoice-corrections.ts:230`. Trace every reader of
   `AdjustmentPolicySnapshot.actions` and `AdjustmentReason.actions`
   (`git grep -n "\.actions" -- packages/adjustments apps/server/src apps/till/src ':!*.test.ts'`) and
   say in the handover which ones read the new value.
3. Commands:
   ```sh
   pnpm --filter @waitron/shared exec vitest run src/adjustment-policy-types.test.ts
   pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts src/provisioning.test.ts src/configuration-transfer.test.ts src/routes.test.ts src/operations.test.ts src/record.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts src/adjustments-api.test.ts scripts/demo-seed/seed-adjustments.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
   pnpm exec vitest run scripts/starting-migrations.test.ts scripts/schema-constraints.test.ts scripts/english-only.test.ts
   ```

### Task 4: The dashboard keeps the mark when a reason is saved (choice 3, dashboard) — about 25 calls

1. Tests first in `packages/adjustments/src/dashboard/reasons-screen.test.ts`: open Complaint
   (actions with `correct_invoice`), change only its name, save: the body's `actions` still ends in
   `correct_invoice`. Open it and save unchanged: Save stays quiet (no unsaved change). Untick all
   three offered actions: the inline "pick at least one" error shows. Run, see the first fail.
2. Change `reasons-screen.ts:397`, `:690` and `:722` as in 3.3; add `ReasonAction` in
   `dashboard/client.ts`.
3. Commands:
   ```sh
   pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.save-state.test.ts src/dashboard/reasons-screen.unsaved.test.ts
   ```

### Task 5: The till offers Complaint in Correct invoice (choice 3, till) — about 35 calls

1. Tests first in `invoice-correction-dialog.test.ts`: with reasons Overcharged (void), Complaint
   (comp, with `correct_invoice`) and On the house (comp, without), the reason list is Overcharged
   and Complaint, and choosing Complaint sends its id; the opening line is the new
   `invoice_correction.explain` in English and Spanish. In `tender-refund-dialog.test.ts`, the same
   three reasons offer only Overcharged (the refund windows are unchanged). Run, see them fail.
2. Add `ReasonAction` (`client.ts`), `correctionReasons` and the `offered` option
   (`reason-picker.ts`), use them at the three sites in the correction window, change
   `invoice_correction.explain` (en `strings.ts:155`, es `:2286`).
3. Commands:
   ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/invoice-correction-dialog.test.ts src/widgets/tender-refund-dialog.test.ts src/widgets/bill-refund-dialog.test.ts src/i18n/strings.test.ts
   ```

### Task 6: The server refuses a plain refund of invoiced money (choice 1, server) — about 50 calls

1. Tests first in `apps/server/src/tender-refund-reservation.test.ts` (direct) and
   `tender-refund-api.test.ts` (through the route), each asserting the code
   `tender.refund_needs_correction` and that no `tender_refunds` row and no drawer job were written:
   - a plain €10 refund on a cash sale with no cancels is refused (409 through the route);
   - the same request is accepted on a sale whose invoice names a customer;
   - a tip-only refund (payment amount 0) after the payment amount is all back is accepted;
   - a plain refund on a sale with a Refund-ticked cancel still owing money is accepted, and on the
     same sale after that cancel is fully refunded through its filled-in window, refused;
   - a refund carrying `cancellationIds`, and a correction's card and cash steps, are unchanged.
   Add the till codes test for the new message in English and Spanish. Run, see them fail.
2. Add the reader in `refund-links.ts`, the check in `reserveTenderRefund` after `:197`, the code in
   `errors.ts` and `tender-refund-api.ts`'s status list, and the message in `codes.ts`.
3. Run the refund-touching server suites and list in the handover every one that now fails
   because its setup makes a plain refund; commit with only those red, for Task 7:
   ```sh
   pnpm --filter @waitron/server exec vitest run $(git grep -ln "transactions/.*/refunds\|reserveTenderRefund\|beginSettledTenderRefund\|refundSettledTender" -- 'apps/server/src/*.test.ts')
   pnpm --filter @waitron/adjustments exec vitest run src/refund-links.test.ts
   pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts scripts/write-path-tables.test.ts
   ```
   That grep finds 21 server suites on `ee45498b38`; how many make a plain refund in setup was not
   measured.

### Task 7: Setups that made a plain refund take an allowed shape (choice 1, fixtures) — about 60 calls; split at about 12 suites

For each suite Task 6 listed: where the test is about refund mechanics (card provider, drawer,
pending, recovery, receipts), give the sale a Refund-ticked cancel still owing money, through a
helper in `apps/server/src/testing/` built on the real cancel route as `cancel()` does in
`tender-refund-links.test.ts:96-120`, or carry the refund as a step of Correct invoice where the
suite already opens one. Change setup only; every assertion about the refund stays as it was, and
the handover lists each suite with the shape chosen. If a sale in a suite has no working order to
cancel on, stop and report rather than inserting rows by hand. If the list passes about 12 suites,
the first implementer commits at a green point and hands the rest to a second.

Commands: the first command of Task 6, then the full `apps/server` refund suites green.

### Task 8: Refund a payment's window names Correct invoice (choice 1, till) — about 25 calls

1. Tests first in `tender-refund-dialog.test.ts`: a plain window shows `[data-money-only]` with the
   exact English and Spanish text of 3.1 and no `[data-invoice-unchanged]`; a window opened with
   `dishes` still shows `tender_refund.invoice_unchanged`; the `correcting` case (`:133-147`) stays;
   a mocked `tender.refund_needs_correction` refusal shows its message as the bottom message and
   leaves **Refund** enabled. Change `:117-119` as in section 5. Run, see them fail.
2. Add `tender_refund.money_only` (en after `strings.ts:130`, es after `:2259`) and the three-way
   choice at `tender-refund-dialog.ts:566-573`.
3. Commands:
   ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/tender-refund-dialog.test.ts src/widgets/tender-refund-dialog.a11y.test.ts src/i18n/strings.test.ts src/i18n/refund-wording.test.ts
   ```

### Task 9: Guide, adviser sheet and backlog — about 20 calls

1. Edit the guide sections in 3.4 (both languages), the adviser sheet in 3.2 (both parts, and line
   169) and the backlog in 3.5.
2. Commands:
   ```sh
   pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts
   pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts
   ```
   `docs/` is ignored by prettier, so check it with `pnpm exec prettier --file-info <file>`, which
   prints `"ignored": true`; the guide files under `apps/server` take `prettier --check`.
3. Write the PR's first section from section 0 of this plan.

## 7. Size

About 120 production lines (core 6, server 30, adjustments 35 including 3 in the dashboard, shared
4, till 40), about 450 new or changed test lines plus Task 7's setup changes across an unmeasured
number of the 21 refund suites, and about 50 lines of guide, sheet and backlog. Medium. Nine tasks,
Task 7 possibly two dispatches.

## 8. Open pull requests touching the same files

Checked with `gh pr list --state open` and `gh pr diff <n> --name-only` on 2026-11-19, and again for
the files the revision added (refund reservation and links, reasons screen, adjustments policy and
provisioning, the Madrid baseline test).

| PR | Overlap | How they interact |
| --- | --- | --- |
| #3724 (lane L, MEAL-END-TICKET PR B) | `table-service.md` en `:300`, es `:315`: adds "The till cannot correct a full invoice naming a customer." to the first paragraph of `{#correct-invoice}`; also `codes.ts`, `strings.ts`, `client.ts` in other places | Same paragraph as 3.4. Whichever lands second keeps both sentences. No behaviour overlap. |
| #3822 (`feat/h-one-way-to-pay`) | `table-service.md` en `:14-19`, es `:20-21` | This plan no longer edits `{#comps-and-discounts}`. None. |
| #3398 (`feat/later-sale-date`) | `seed.madrid-baseline.test.ts`, a hunk near `:1137` | Not the reasons block at `:2018-2022`; text-only rebase. |
| #3704 (lane L, MEAL-END-TICKET PR A) | `table-service.md` and `codes.ts`, other sections and keys | None. |
| #3752 (lane L) | `table-service.md` `:74`, `:159`; `client.ts` | None. |
| #3803 (lane L) | `till-ticket-view.ts`, `strings.ts` `:1627`, `codes.ts` `:561`, `client.ts` | This plan does not touch `till-ticket-view.ts`; string and code tables at other keys. None. |
| #3828 (lane L) | `till-ticket-view.ts` | Not touched here. None. |

No open PR touches `correction-allocation.ts`, `invoice-corrections.ts`, `invoice-correction-dialog.ts`,
`tender-refund-dialog.ts`, `tender-refund-reservation.ts`, `refund-links.ts`, `reason-picker.ts`,
the adjustments package or the adviser sheet.

## 9. Open questions, each with a recommended default

- **Q1. What Refund a payment is still for.** After this, a plain refund of money the invoice
  counted is refused, except on an invoice naming a customer and on a sale still owing money for
  cancelled dishes; a tip goes back on its own once the payment amount is all back. **Default:**
  those three, as in 3.1. The watcher's examples (a card charged twice, a tip keyed by mistake) are
  not used because the window cannot do either today (section 2).
- **Q2. How Complaint is allowed.** **Default:** (a), a mark on the starter Complaint with no
  dashboard control (3.3). (b), allowing any reason, is one line smaller on the server but lets On
  the house and Discount be chosen; (c), a dashboard switch, is configuration nobody asked for.
- **Q3. Existing venues.** Their Complaint lacks the mark until a reset. **Default:** no data
  change, as the pre-live rule says; the PR says so.
- **Q4. The shared Google Doc.** The sheet says the Google Doc holds both parts. **Default:** the PR
  changes the repository copy only and asks the desk to copy the new question and the line 169 fix
  into the Google Doc.
- **Q5. A set menu's share.** The owner chose on 18 November that a set menu takes its main item's
  rate rather than a split by price (sheet `:29-32`). A goodwill amount is a different case, so this
  plan still splits by price. **Default:** split by price, with the adviser question.
- **Q6. The owner's word on choices 2 and 3.** Both overturn parts of the design the owner approved
  on 2026-10-21 (section 0) on the watcher's word only. **Default:** the watcher asks the owner
  before Tasks 1-5 and 9 are built; Tasks 6-8 go ahead, since choice 1 follows from the owner's
  own 18 November decision.
