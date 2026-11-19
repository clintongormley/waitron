# ADVISER-GOODWILL-CORRECTIVE: money given back as goodwill takes a corrective invoice

Status: plan, written 2026-11-19 on `feat/adviser-goodwill-corrective` at `ee45498b38`. No code yet.

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
- The **watcher** is the session that supervises the campaign lanes and makes day-to-day choices
  the owner can overrule.

## 0. For the owner to confirm when landing

The PR's first section lists these three choices word for word, marked as the **watcher's choices
(2026-11-19 08:00), not the owner's**, for the owner to confirm when landing:

1. **Refund a payment** is for money that does not need a corrective invoice. Its window and the
   guide say so, in English and Spanish, and name **Correct invoice** for money given back for food
   or drink, a complaint or goodwill. This is wording only: no new refusal (section 3.1 says why).
2. An amount given back with **no dishes ticked**, on a ticket with dishes at two VAT rates, is
   shared across every dish in proportion to its price, exactly as the server already does when
   every dish is ticked. The till stops limiting the ticked dishes to one VAT rate. **The adviser
   has not confirmed this split**; the PR adds the question to the adviser sheet.
3. **Complaint** can be chosen as the reason for **Correct invoice**. **On the house**, **Staff
   meal** and **Discount** still cannot.

Three of these change an owner-approved design. The A802 design (approved by the owner on
2026-10-21) says "At mixed rates, explicitly pick the affected original lines before entering the
amount" (`docs/superpowers/specs/2026-10-20-a802-partial-paid-invoice-correction-design.md:86-88`),
"Reason: use A758's Void-reason dropdown" (`:90`), and "a served-dish goodwill return can still use
ordinary Refund a payment" (`:301-302`). The owner's own decision of 18 November ("Money given back
as goodwill takes a corrective", `docs/compliance/2026-11-19-adviser-meeting.md:66`) replaces the
third. Choices 2 and 3 replace the first two on the watcher's say-so only. The PR says this in the
same section.

Customer-named full invoices still cannot be corrected (`packages/core/src/correction-eligibility.ts:5-9`);
that stays out of this item.

## 1. What staff can do when it lands

A guest complains after paying, and the manager wants to give €10 back. On the past receipt the
manager chooses **Correct invoice**, types €10 under **Money back, VAT included**, leaves the dishes
unticked, picks **Complaint** as the reason and presses **Correct and refund**. Waitron gives the
money back and files a corrective invoice for it, even when the ticket has food at 10% and drinks at
21%: the €10 is shared across the dishes by price, and the window shows the VAT for each rate before
anything is filed. Staff may also tick dishes at both rates. **Refund a payment** now says plainly
that it does not correct the invoice and names **Correct invoice** for goodwill. In the dashboard's
**Voids and comps**, a manager can switch **Offer in Correct invoice** on or off for each comp
reason; **Complaint** starts with it on.

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

**What money Refund a payment can return.** A sale cannot receive more than its total
(`bill.received_exceeds_total`, `apps/server/src/bill-payments.ts:471`), so every "payment amount"
it returns was counted towards the invoice. A tip can be returned only together with all of the
payment's remaining amount (`apps/server/src/tender-refund-reservation.ts:206-215`; the existing
test "enforces applied and whole-tip ceilings" refuses €5.00 plus a €1.00 tip,
`apps/server/src/tender-refund-reservation.test.ts:468-479`). So the watcher's two examples of money
that "was never the sale's" are not what this window does today: a tip keyed by mistake cannot be
returned on its own, and a card charged twice cannot show up as two payments on one sale. This is
read, plus that one existing test; nobody ran a double charge. It is why the wording in 3.1 does not
use those examples (open question Q1).

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
`997ce08baa`); I found no owner decision behind it beyond the slice plan's "pick dishes (optional at
one VAT rate)" (`docs/superpowers/plans/2026-11-11-a802-slices-4-5.md:32-33`).

**The corrective builder already takes two rates.** `fileCorrectionIn` passes the preview's lines and
its per-rate split to `recordCorrection` unchanged (`apps/server/src/invoice-corrections.ts:357-382`);
the split is whatever `previewCorrectionAmounts` returns (`packages/core/src/correction-history.ts:43-63`).
Choice 2 only stops `allocateCorrectionAmounts` refusing; with no dishes ticked it then takes every
remaining dish (`correction-allocation.ts:71`, `scope === undefined` keeps all lines), which is the
B3 path. No builder changes.

**Reasons for Correct invoice: void only.** Open refuses any reason whose kind is not `void`:
`if (reason.kind !== "void") throw new AppError("adjustment.action_not_allowed", {})`
(`apps/server/src/invoice-corrections.ts:229-231`). The till offers only reasons whose actions
include `cancel` (`voidReasons`, `apps/till/src/widgets/reason-picker.ts:10-12`), used by the
correction window at `invoice-correction-dialog.ts:358`, `:654` and `:782`, and by the two refund
windows (`bill-refund-dialog.ts:290`, `tender-refund-dialog.ts:145-151`). Finding row B4.
**Complaint**, **On the house** and **Discount** are seeded identically: kind `comp`, actions
`["comp", "discount_percent", "discount_amount"]`, limit €0 (`packages/adjustments/src/provisioning.ts:28-63`).
Nothing on a reason tells them apart except the name, which the owner can edit.

**The reason's text never reaches AEAT.** Open stores `reason.name` (plus any note) on the
correction row (`invoice-corrections.ts:248`); `recordCorrection` gets no reason
(`invoice-corrections.ts:368-382`).

## 3. Design

### 3.1 Choice 1: Refund a payment says what it does, and names Correct invoice

Wording plus guide, no refusal. A server refusal would need the server to tell goodwill from any
other refund; the request carries only an amount, a tip and a free-text reason
(`tender-refund-reservation.ts:197-215`), so there is nothing to refuse on. The window is the place
the choice is made, so it says it there.

The window has three states (`tender-refund-dialog.ts:566-573`):

- opened as a correction's card refund (`correcting`): unchanged, `tender_refund.correction_leg`;
- opened filled in from a cancelled dish (`dishes` not empty): unchanged,
  `tender_refund.invoice_unchanged`, because there the refund is for the cancelled dishes and
  pointing at **Correct invoice** would contradict the flow;
- opened plainly from a receipt: a new line, key `tender_refund.money_only`:

| | Text |
| --- | --- |
| en | This returns money only: the invoice is not corrected and still counts the full amount. To give money back for food or drink, for a complaint or as goodwill, choose Correct invoice. |
| es | Esto solo devuelve dinero: la factura no se rectifica y sigue contando el importe completo. Para devolver dinero por la comida o la bebida, por una queja o como cortesía, elige Rectificar factura. |

It keeps the existing `muted` paragraph styling, with `data-money-only` in place of
`data-invoice-unchanged`. Known limit: the "refund the rest from another payment" step of a
cancelled-dish refund opens the window plainly (guide `table-service.md:286-291`), so it shows this
line too.

The watcher's literal wording ("only for money that was never the sale's, such as a card charged
twice or a tip keyed by mistake") is not used, because section 2 shows the window cannot do either
today. Open question Q1 offers it back.

### 3.2 Choice 2: an amount with no dishes ticked is shared across every dish

**Server.** Delete the `rates.size > 1` refusal (`correction-allocation.ts:61-65`). With no dishes,
the amount is shared by remaining price across all remaining dishes, cents by largest remainder,
then each rate's base and VAT within the stored budget, as for ticked dishes today. Remove
`"required"` from the reason type of `sale.correction_scope_invalid` (`packages/core/src/errors.ts:14`);
`empty`, `missing` and `duplicate` stay. Consumers traced: the code's HTTP status
(`apps/server/src/invoice-correction-api.ts:47`, unchanged), the till's field placement
(`invoice-correction-dialog.ts:613`, by code only), and the till's message (`codes.ts:488`). Nothing
branches on the `required` reason (`git grep -n '"required"'` over those files).

**Till.** Delete the one-rate clause at `invoice-correction-dialog.ts:591` and the now-unused
`picked` at `:573`. The split lines (`invoice_correction.split`, one per rate) already show both
rates. The message for `sale.correction_scope_invalid`, now reached only when the dish list no
longer matches the invoice (for example, the invoice was exchanged while the window was open):

| | Text |
| --- | --- |
| en | The dishes chosen are not on this invoice. Close this window and choose Correct invoice again. |
| es | Los platos elegidos no están en esta factura. Cierra esta ventana y vuelve a elegir Rectificar factura. |

**Adviser sheet.** Add the question in both parts of `docs/compliance/2026-11-19-adviser-meeting.md`,
under question 6 after the goodwill bullet. The numbers are finding row B3's, recomputed: 35/65 of
€10 is €5.38 (−€4.89 + −€0.49), 30/65 is €4.62 (−€3.82 + −€0.80).

Part 1, a new bullet after line 161:

> - **Goodwill on a ticket with two VAT rates.** When the money given back is not tied to particular
>   dishes, Waitron shares it across the ticket's dishes in proportion to their prices, and so across
>   its VAT rates. For example, €10 given back on a €65 ticket (a €35 paella at 10% and €30 of wine
>   at 21%) files −€5.38 at 10% (base −€4.89, VAT −€0.49) and −€4.62 at 21% (base −€3.82, VAT
>   −€0.80). *Is that split correct?*

and, after line 169, an internal line: "Open: the split of a goodwill amount across two VAT rates in
proportion to price is the watcher's choice of 19 November (ADVISER-GOODWILL-CORRECTIVE); the adviser
has not confirmed it."

Part 2, a new bullet after line 318:

> - **Una devolución de cortesía en un tique con dos tipos de IVA.** Cuando lo devuelto no
>   corresponde a platos concretos, Waitron lo reparte entre los platos del tique en proporción a su
>   precio y, por tanto, entre sus tipos de IVA. Por ejemplo, 10 € devueltos de un tique de 65 €
>   (una paella de 35 € al 10 % y 30 € de vino al 21 %) presentan −5,38 € al 10 % (base −4,89 €,
>   cuota −0,49 €) y −4,62 € al 21 % (base −3,82 €, cuota −0,80 €). *¿Es correcto ese reparto?*

The sheet's header says the shared Google Doc holds both parts; the PR does not change the Google
Doc and says so (open question Q4).

### 3.3 Choice 3: Complaint can be a correction reason

A reason gets a new entry in its stored `actions` list, `correct_invoice`, meaning "offered in
Correct invoice". Open accepts a reason when its kind is `void` (as today) **or** its actions
include `correct_invoice`. The starter **Complaint** gets it; **On the house**, **Staff meal** and
**Discount** do not. A manager can switch it on or off per comp reason.

Why a stored mark and not the name: names are edited by the owner and translated at setup
(`STARTER_REASON_NAMES`, `packages/adjustments/src/starter-content.ts`); matching
`names.en === "Complaint"` (as `NOT_SERVED_REASON` does for a default choice,
`apps/server/src/adjustments-api.ts:282-287`) would let a rename quietly open or close a fiscal
path. Why in `actions` and not a new column: `adjustment_reasons.actions` is JSON with only a
not-empty check (`packages/db/src/schema/adjustments/reasons.ts:30,40`), so no schema change and no
rebuilt starting migration, which would reset every venue
(`docs/developers/conventions-data.md:4076-4081`). The A802 design's rule "A reason alone never
decides which path is fiscal" (`spec:78`) still holds: staff still choose **Correct invoice**; the
mark only lets the reason be picked there.

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
- `packages/country-es/src/demo/reasons.ts:79-92`: the demo's **Complaint** gets
  `correct_invoice` too, so the demo venue can try it.
- `apps/server/src/invoice-corrections.ts:230`: `if (!offersInvoiceCorrection(reason)) throw …
  "adjustment.action_not_allowed"`. Same code as today.
- Till: `apps/till/src/api/client.ts:900-911` adds `ReasonAction` for `AdjustmentReason.actions`;
  `reason-picker.ts` gets `correctionReasons()` (void or `correct_invoice`) and an optional
  `offered` filter on `reasonPicker`, defaulting to `voidReasons`; the correction window uses
  `correctionReasons` at `:358`, `:654`, `:782`. The two refund windows keep `voidReasons`.
- Dashboard (`packages/adjustments/src/dashboard/reasons-screen.ts`): a `wt-switch` named
  `correctsInvoice`, shown for comp reasons below the comp fields (beside `noteRequired`,
  `:1347-1367`), held in the draft as a boolean and written into `actions` on save (`:397`, `:722`).
  `packages/adjustments/src/dashboard/client.ts:8,17` adds `ReasonAction`.

| Key | en | es |
| --- | --- | --- |
| `adjustments.field.corrects_invoice` | Offer in Correct invoice | Ofrecer en Rectificar factura |
| `adjustments.field.corrects_invoice_hint` (the switch's `description`) | Staff can also choose this reason when they give money back on a paid invoice. | El personal también puede elegir este motivo al devolver dinero de una factura pagada. |

The correction window's opening line changes, since it now covers complaints:

| Key | | Text |
| --- | --- | --- |
| `invoice_correction.explain` | en, before | Correct an overcharge and return the difference. |
| | en, after | Correct an overcharge or give money back for a complaint, with a corrective invoice. |
| | es, before | Corrige un cobro de más y devuelve la diferencia. |
| | es, after | Corrige un cobro de más o devuelve dinero por una queja, con una factura rectificativa. |

Existing venues keep their reasons as they are: no data change before go-live (CLAUDE.md §3, "No
backwards-compatibility or data-migration code until Waitron is in production"). A venue reset, or a
manager switching **Offer in Correct invoice** on, brings Complaint in.

### 3.4 Guide pages

`apps/server/src/guide/en/table-service.md` and `apps/server/src/guide/es/table-service.md`; the
`{#id}` headings do not change.

**`{#comps-and-discounts}`**, a new sentence after the "Complaint, On the house and Discount start
at 0" paragraph (en `:19-20`, es `:20-21`):

- en: "Switch on **Offer in Correct invoice** for a comp reason staff may also choose when they
  correct a paid invoice. **Complaint** starts with it on."
- es: "Activa **Ofrecer en Rectificar factura** en un motivo de invitación que el personal también
  pueda elegir al rectificar una factura pagada. **Queja** empieza con esta opción activada."

**`{#refund-receipt}`**, a new second paragraph (after en `:264-269`, es `:281-286`):

- en: "This gives money back without correcting the invoice, which still counts the full amount. To
  give money back for food or drink, for a complaint or as goodwill, choose **Correct invoice**
  instead."
- es: "Así se devuelve dinero sin rectificar la factura, que sigue contando el importe completo. Para
  devolver dinero por la comida o la bebida, por una queja o como cortesía, elige **Rectificar
  factura**."

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
  dishes ticked is shared across the VAT rates by price; the adviser has not confirmed it."
- `docs/backlog/fiscal.md:900-907`: replace the goodwill bullet with one line: goodwill goes through
  **Correct invoice** since this PR, and the split by price awaits the adviser (question 6 of the
  19 November sheet). Add the three watcher choices, dated, to that file's `## Decisions and
  deliberate limits` (`:1076`), marked as the watcher's, for the owner to confirm.

## 4. The fiscal boundary

No change to `computeHuella`, the chain, invoice numbering, series, `registros_facturacion` or its
triggers, `recordSale`, `recordCorrection` or `recordSubstitution`. Choice 2 changes only which lines
`allocateCorrectionAmounts` is allowed to share an amount across before the existing builder is
called; section 2 shows the builder already files two rates (finding row B3, and Task 1's new test
files one). Nothing in this plan needs a builder edit, so there is no STOP.

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
| `packages/adjustments/src/provisioning.test.ts:108-119` | Complaint's actions are `all` | `[...all, "correct_invoice"]` | 3 | no money |
| `apps/server/src/invoice-corrections.test.ts:892` and `apps/server/src/invoice-correction-api.test.ts:441` | the refused reason is the first comp reason (Complaint) | the refused reason is **On the house**; the refusal assertion is unchanged | 3 | no money |
| `apps/server/scripts/demo-seed/seed-adjustments.test.ts:142-148` | demo Complaint `actions: ["comp", "discount_percent"]` | plus `"correct_invoice"` | 3 | no money |
| `packages/adjustments/src/dashboard/reasons-screen.test.ts:985` | three offer boxes | unchanged; a new case checks the `correctsInvoice` switch | 3 | no money |

If the demo baseline test (`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`) compares
the reasons' `actions`, the Complaint row in
`packages/country-es/test-fixtures/demo/madrid-before-move.{en,es}.json` changes by one value each;
the implementer reports it in the handover. Any other assertion that has to change is listed in the
PR with file:line, before and after.

## 6. Tasks

Risk: fiscal invariants (how a corrective's VAT is divided), so the full path: per-task review, and
`/finish-branch` with two Codex run-it reviews. Each task: failing test first, watch it fail, then the
change; then `pnpm exec prettier --check <changed files>` and the two fiscal suites in section 4.
Till and dashboard suites run real headless Chromium; check `memory_pressure | grep free` first.

### Task 1: The server shares an unticked amount across every dish (choice 2, server)

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
   `packages/core/src/errors.ts:14`.
4. Commands:
   ```sh
   pnpm --filter @waitron/core exec vitest run src/correction-allocation.test.ts src/correction-history.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts
   pnpm exec vitest run scripts/errors-reachable.test.ts
   ```

### Task 2: The till lets staff tick dishes at both rates (choice 2, till)

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

### Task 3: A reason can be offered in Correct invoice (choice 3, rules and server)

1. Tests first:
   - `packages/adjustments/src/policy.test.ts`: `reasonShapeFault` accepts a comp reason with
     `["comp", "correct_invoice"]`, refuses `["correct_invoice"]` alone and a void reason with
     `["cancel", "correct_invoice"]`; `offersInvoiceCorrection` is true for a void reason and for a
     comp reason with the mark, false for a comp reason without it.
   - `packages/adjustments/src/provisioning.test.ts:108-119` as in section 5.
   - `packages/adjustments/src/configuration-transfer.test.ts`: an export whose comp reason carries
     `correct_invoice` imports; one with an unknown action is refused.
   - `packages/adjustments/src/routes.test.ts`: saving a comp reason with `correct_invoice` is
     accepted, and an unknown action still answers `management.request_invalid`.
   - `apps/server/src/invoice-corrections.test.ts:889-900`: rename to "a comp reason not offered in
     Correct invoice, and opens with Complaint and with a Void reason"; the refused one is **On the
     house**, and Complaint opens. Same change at `invoice-correction-api.test.ts:438-447`.
   - `packages/shared/src/adjustment-policy-types.test.ts`: `REASON_ACTIONS`, and
     `ADJUSTMENT_ACTIONS` unchanged.
   Run, see them fail.
2. Make the changes in section 3.3 for shared, db (type only), adjustments (policy, operations,
   routes, provisioning), the demo reasons and `invoice-corrections.ts:230`. Trace every reader of
   `AdjustmentPolicySnapshot.actions` and `AdjustmentReason.actions`
   (`git grep -n "\.actions" -- packages/adjustments apps/server/src ':!*.test.ts'`) and say in the
   handover which ones read the new value.
3. Commands:
   ```sh
   pnpm --filter @waitron/shared exec vitest run src/adjustment-policy-types.test.ts
   pnpm --filter @waitron/adjustments exec vitest run src/policy.test.ts src/provisioning.test.ts src/configuration-transfer.test.ts src/routes.test.ts src/operations.test.ts src/record.test.ts
   pnpm --filter @waitron/server exec vitest run src/invoice-corrections.test.ts src/invoice-correction-api.test.ts src/adjustments-api.test.ts scripts/demo-seed/seed-adjustments.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts
   pnpm exec vitest run scripts/starting-migrations.test.ts scripts/schema-constraints.test.ts scripts/english-only.test.ts
   ```

### Task 4: The dashboard switch "Offer in Correct invoice" (choice 3, dashboard)

1. Tests first in `packages/adjustments/src/dashboard/reasons-screen.test.ts`: a comp reason shows
   the `correctsInvoice` switch with its English and Spanish label and description; a void reason
   does not; switching it on and saving sends `actions` ending in `correct_invoice`; editing Complaint
   shows it on. In `reasons-screen.save-state.test.ts`, toggling it enables Save and toggling back
   disables it; in `reasons-screen.unsaved.test.ts`, toggling it counts as an unsaved change;
   `reasons-screen.a11y.test.ts` covers the editor with the switch in both themes. `strings.test.ts`
   checks both languages carry the two keys. Run, see them fail.
2. Add the draft field, the switch, the strings (section 3.3) and `ReasonAction` in
   `dashboard/client.ts`.
3. Commands:
   ```sh
   pnpm --filter @waitron/adjustments exec vitest run src/dashboard/reasons-screen.test.ts src/dashboard/reasons-screen.save-state.test.ts src/dashboard/reasons-screen.unsaved.test.ts src/dashboard/reasons-screen.a11y.test.ts src/dashboard/strings.test.ts
   ```

### Task 5: The till offers Complaint in Correct invoice (choice 3, till)

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

### Task 6: Refund a payment names Correct invoice (choice 1)

1. Tests first in `tender-refund-dialog.test.ts`: a plain window shows `[data-money-only]` with the
   exact English and Spanish text of section 3.1 and no `[data-invoice-unchanged]`; a window opened
   with `dishes` still shows `tender_refund.invoice_unchanged`; the `correcting` case (`:133-147`)
   stays. Change `:117-119` as in section 5. Run, see them fail.
2. Add `tender_refund.money_only` (en after `strings.ts:130`, es after `:2259`) and the three-way
   choice at `tender-refund-dialog.ts:566-573`.
3. Commands:
   ```sh
   pnpm --filter @waitron/till exec vitest run src/widgets/tender-refund-dialog.test.ts src/widgets/tender-refund-dialog.a11y.test.ts src/i18n/strings.test.ts src/i18n/refund-wording.test.ts
   ```

### Task 7: Guide, adviser sheet and backlog

1. Edit the guide sections in 3.4 (both languages), the adviser sheet in 3.2 (both parts) and the
   backlog in 3.5.
2. Commands:
   ```sh
   pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts
   pnpm exec vitest run scripts/guide-links.test.ts scripts/claude-md-pointers.test.ts
   ```
   `docs/` is ignored by prettier, so check it with `pnpm exec prettier --file-info <file>`, which
   prints `"ignored": true`; the guide files under `apps/server` take `prettier --check`.
3. Write the PR's first section from section 0 of this plan.

## 7. Size

About 110 production lines (core 6, server 3, shared 4, adjustments 35, dashboard 30, till 30), about
450 test lines, and about 60 lines of guide, sheet and backlog. Small to medium; not larger.

## 8. Open pull requests touching the same files

Checked with `gh pr list --state open` and `gh pr diff <n> --name-only` on 2026-11-19.

| PR | Overlap | How they interact |
| --- | --- | --- |
| #3724 (lane L, MEAL-END-TICKET PR B) | `table-service.md` en `:300`, es `:315`: adds "The till cannot correct a full invoice naming a customer." to the first paragraph of `{#correct-invoice}`; also `codes.ts`, `strings.ts`, `client.ts` in other places | Same paragraph as 3.4. Whichever lands second keeps both sentences. No behaviour overlap: a correction needs a settled sale (`invoice_correction.not_settled`), whenever the ticket was issued. |
| #3822 (`feat/h-one-way-to-pay`) | `table-service.md` en `:14-19`, es `:20-21`: a new paragraph in `{#comps-and-discounts}` | Same section as 3.4; text-only rebase. |
| #3704 (lane L, MEAL-END-TICKET PR A) | `table-service.md` and `codes.ts`, other sections and keys | No overlap with the lines here. |
| #3752 (lane L) | `table-service.md` `:74`, `:159`; `client.ts` | Other places; none. |
| #3803 (lane L) | `till-ticket-view.ts`, `strings.ts` `:1627`, `codes.ts` `:561`, `client.ts` | This plan does not touch `till-ticket-view.ts`; string and code tables at other keys. None. |
| #3828 (lane L) | `till-ticket-view.ts` | Not touched here. None. |

No open PR touches `correction-allocation.ts`, `invoice-corrections.ts`, `invoice-correction-dialog.ts`,
`tender-refund-dialog.ts`, `reason-picker.ts`, the adjustments package or the adviser sheet.

## 9. Open questions, each with a recommended default

- **Q1. Refund a payment's wording.** The watcher's text ("only for money that was never the
  sale's, such as a card charged twice or a tip keyed by mistake") names two cases the window cannot
  do today (section 2). **Default:** the wording in 3.1, which says what the window does and names
  Correct invoice, with no examples. Whether a plain receipt refund should exist at all, once
  goodwill has its own path, is the owner's to decide; this PR does not change it.
- **Q2. How Complaint is marked.** **Default:** a `correct_invoice` mark in the reason's actions,
  switchable in the dashboard (3.3). The alternative, matching the English name, needs no dashboard
  change but breaks on a rename.
- **Q3. Existing venues.** Their Complaint lacks the mark until a reset or a manager switches it on.
  **Default:** no data change, as the pre-live rule says; the PR says so.
- **Q4. The shared Google Doc.** The sheet says the Google Doc holds both parts. **Default:** the PR
  changes the repository copy only and asks the desk to copy the new question into the Google Doc.
- **Q5. A set menu's share.** The owner chose on 18 November that a set menu takes its main item's
  rate rather than a split by price (sheet `:29-32`). A goodwill amount is a different case, so this
  plan still splits by price. **Default:** split by price, with the adviser question; revisit if the
  adviser prefers another split.
