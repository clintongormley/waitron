# A1515. Set lunch menus: proposal

**Historical draft, 12 November 2026.** Later dated sections supersede earlier recommendations, including receipt layout, closing choices and the VAT wait. These are recommendations, not agreed features. Lane L reviewed the invoice part on 12 November; its corrections are incorporated below. Nothing is built; implementation, schema,
fiscal changes and public printed-menu design are outside this proposal.

I recommend one priced lunch item, with selected dishes attached for service, so you can send
them to different stations before the guest chooses the last dish.

## Owner decisions, 12 November 2026

The owner answered through the watcher in Lane D questions.md at 11:59 and 18:29:
“yes, one item”; “Yes, allow it” for a later course choice; “Price the supplement too”.
The later send contains only the newly chosen course. An untaken dessert or coffee closes at
payment without changing the lunch price.

These decisions supersede the receipt recommendation below: show **1 House lunch €18.00**
and its **hake supplement €3.00** as a priced line beneath it, followed by the chosen dishes
without prices. The bill uses the same presentation. The lunch remains one bill item.
The adviser question S10 remains open; the full invoice waits for that answer.
The watcher requested an implementation plan, followed by Claude review and watcher clearance;
that request is paused until you see the 18:39 reuse comparison below.
No implementation plan or VAT treatment is approved by these design answers.

## Set it up on the dashboard

Create a priced **House lunch** catalogue item on a menu whose service periods limit its
selling times and days. It is an item, not a new whole-menu kind.

You would enter **€18 including VAT** and build its choices from existing products:
**Starter:** soup or salad; **Main:** chicken or premium fish; **Dessert or coffee:** pudding or coffee.
Bread and one drink, water or a soft drink, are included. Dessert **or** coffee is one
choice, not both. Beside fish you would enter **+€3**, added to the lunch price rather than
using the fish's ordinary selling price. The lunch costs €18 with chicken or €21 with fish.

Selected products stay in their original routing folders. Choices say what the guest may pick;
service courses separately say when it is cooked, so choosing fish need not cook it now.

## Sell it on the till

You would tap **House lunch** at Table 4 and choose soup, fish and water. The till would
show **€21** (“€18 lunch + €3 fish”), with bread included. Add one lunch per diner, even with
identical choices; each remains its bill item, without guest numbers.

I recommend allowing **Dessert or coffee: choose later** while you send the known choices.
After the main, you would reopen that lunch and choose coffee. Only coffee would be sent,
without another charge or repeat orders for the earlier dishes. The outstanding choice would
stay visible, without silently choosing pudding. If the diner takes neither, I recommend
closing that choice at payment with the fixed €21 unchanged and no kitchen order.

## What you would print

The proposed receipt has one priced line, **1 House lunch €21.00**, with unpriced descriptions
below: “Soup; fish (+€3 included in total); bread; water; coffee”. A chicken lunch would show
€18.00. If the last choice is untaken, its description would say “Dessert or coffee: not taken”.
This merges rows the receipt prints separately today.

The ticket can keep one priced lunch line under either adviser answer: it already prints the
amount before VAT and the VAT for each rate. The full invoice depends on the adviser. Today's
renderer prints each line's price before VAT and, for a mixed-rate bill, its rate. A lunch split
across rates would need one priced row per rate with that renderer. The gross total stays €21.
AEAT receives totals by rate, not the printed dish rows.

Today's priced-item/extra model would put €18 at the lunch item's rate and €3 at the fish's,
with included dishes at zero. One restaurant-service rate can use existing bill lines; a split
needs a new price-allocation step before filing. The demo classifies cola and coffee differently
from water and desserts: under a split, a guest's choices would change the VAT within one fixed
price. Those demo classes do not settle the correct treatment of a lunch eaten at the table.

Kitchen tickets list actual dishes without prices, following their folder routing; the lunch
itself has no station. Parts mention each other: “Table 4 · Fish · House lunch; soup from Soup
station; bread and water from Bar; Dessert or coffee to choose”. Later coffee refers to that
lunch's soup and fish without ordering them again. Identical lunches share these descriptions.

## Sources and limits

Source reads, not runtime verification: [A1515](../../backlog/catalogue.md#a1515-set-lunch-menus-the-menú-del-día),
[Bundles](2026-09-30-catalogue-menus-routing-design.md) §5.10, `apps/server/src/receipt-document.ts:268–417`,
`packages/catalogue/src/pricing.ts:179–203,264–327`, and `packages/fiscal-verifactu/src/backend.ts:319–337`.
The adviser question extends [S10](../../compliance/asesor-questions.md) and its
[VAT research](../../compliance/research/2026-10-09-vat-and-corrections.md); it settles neither.

## Choices to settle

**Owner:**

- **One lunch item per diner, with inclusions and surcharges?** Recommend yes: fish €21;
  chicken €18, with the same inclusions.
- **Allow later choices and leave the price unchanged if untaken?** Recommend yes: send soup
  and fish now; choose coffee later or close that choice at payment without ordering it.
- **Show the selected dishes beneath one priced ticket line?**
  Recommend yes: the guest can check what the €21 covered.

**One question to send to your adviser, as an addition to S10** (example prices, not a
claim about the live menu):

«Un menú del día consumido en mesa cuesta 18 € con IVA: sopa, pollo, pan, cola y café.
Elegir pescado añade 3 €. En este ejemplo, por separado la cola (2,50 €) y el café (1,40 €)
están al 21 %, y la sopa (6 €), el pollo (12 €) y el pan (1,50 €) al 10 %. ¿Cuál procede?
**A:** todo es un servicio de restauración al 10 %: 18 € = 16,36 € de base + 1,64 € de IVA.
**B:** repartir los 18 € según esos precios: cola y café reciben 3 € al 21 %
(2,48 € + 0,52 € de IVA), y el resto 15 € al 10 % (13,64 € + 1,36 € de IVA);
los 3 € del pescado se añaden al 10 %. Si B: cuando no se toma café y se paga lo mismo,
¿se excluye el café del reparto?»

## 12 November 2026, 18:39 request: reuse comparison

**Recommend existing extras, rather than variants:** one €18 House lunch product; included
product choices priced at €0 and hake at €3. This reuses the price components and child links.
The missing work is course-by-course service and lunch presentation. **Needs owner review before
a build plan.** These are source-inspection findings, not runtime verification.

| Existing piece | Works today, unchanged | Small change to an existing piece | Truly new behavior |
| --- | --- | --- | --- |
| **Variants at €18/€21** | Select a variant and save its price on the parent line. | Not enough on its own. | A separate €3 breakdown and dish choices. A “with hake” variant is not linked to the main pick. Extras already retain a priced child. [1] |
| **Extras and options** | Extras select products, override prices and enforce min/max picks and quantity caps; each course can use a one-pick list. Enter **€0 explicitly** for included dishes; blank uses the ordinary price. Options are text labels, not priced children. | Adapt the existing picker and basket for lunch. | Remember an outstanding **choose later** course. Required extras currently block Add; optional lists permit omission without remembering it. [2] |
| **Kitchen** | Reuse routing and ticket rendering. Set lunch to No preparation; give choices explicit station cells (product, folder or zone-wide). Default-station fallback follows the parent, so a no-preparation parent alone sends nothing. | None. | Give children their own courses, fire them independently and accept later coffee without recalling earlier work. Normal edits refuse a changed selection once any lunch part has started or been served, or where the station disallows changes after sending. Otherwise a fired-line edit recalls and resends it. Close an untaken course at payment without repricing. [3] |
| **Bill and receipt** | Parent/child grouping keeps €18 and €3. Extras currently display prices, including €0. | Show the same hake child as a €3 supplement line and an unpriced dish description, charged once. Hide included-dish prices. Skip basket and receipt merging for lunches so each diner keeps an item. | Price/name data already exists; untaken-course wording uses the new choice state above. [4] |
| **Ordinary extra starter** | Croquettes already has its own product line, ordinary €7.80 demo price and kitchen route. Keep it outside lunch choices on till and receipt. | None. | Nothing new. [5] |

The owner’s answers stand: one lunch item, later choice allowed, supplement priced separately.
The proposed display is **House lunch €18 + hake supplement €3 + ordinary Croquettes €7.80 =
€28.80**, with the lunch’s selected dishes beneath it unpriced. Add the second €18 lunch and the
two-diner example totals **€46.80**. Adviser S10 remains open; no VAT treatment is chosen and the
full invoice waits. With extras, €18 is at the lunch’s rate and €3 at the hake’s. A €21 variant puts all €21 at its own
rate. Adviser answer B needs a new allocation step either way.

The local gallery is linked from Lane D’s `receipts/a1515-mockups/README.md`; mock-ups stay
outside the repository. The displayed choices remain as drawn; the recommendation reuses extras
underneath them and adds later-course service.

**Sources inspected:** [1] `packages/catalogue/src/variants.ts::selectMenuVariant`;
`apps/till/src/state/order-line.ts::productAsVariant`.
[2] `packages/catalogue/src/extra-contract.ts::{priceForExtraPortion,validateExtraSelections}`;
`option-contract.ts::validateOptionSelections` in that package;
`apps/server/src/modifier-selection.ts::buildLineExtras`;
`apps/till/src/widgets/modifier-picker.ts::TillModifierPicker.#satisfied`.
[3] `packages/venue-service/src/routing.ts::{chooseExtraMaker,chooseExtraMakerBeside}`;
`apps/server/src/working-order.ts::{fireLines,insertSplitExtras,applyLineEdits}`;
`apps/server/src/kitchen-print.ts::buildTicketItems`.
[4] `apps/till/src/widgets/basket.ts::TillBasket.render`;
`apps/till/src/state/working-order.ts::WorkingOrderStore.addMerging`;
`apps/server/src/receipt-lines.ts::{groupByParent,mergeIdenticalGroups,ticketLinesFrom}`;
`apps/till/src/screens/till-ticket-view.ts::{groupByParent,mergeIdenticalGroups}`.
[5] `apps/server/src/working-order.ts::{addTabRound,priceTabRound,priceOrderLines,fireLines}`;
`packages/country-es/src/demo/menu.ts:610–634`.

## 12 November 2026, 20:38 and 20:54: extras and course service

The owner answered the reuse comparison through the watcher in Lane D questions.md:
“that works. however, it doesn't allow splitting the order into two - everything gets ordered
at the same time. also it doesn't allow sending the dishes to the kitchen by course.”
At 20:54: “btw, with set menus, having a selling times section doesn't make sense - that can
already be handled with periods and menus”. These directions supersede the comparison's
owner-review wait and any separate availability controls in the earlier local studies.

Use existing extras. Keep outstanding choices on the same lunch, and send each chosen course
independently to its station without recalling earlier courses. The revised English and Spanish
studies show starters and drinks first, a main chosen and sent later, then coffee. Choosing the
premium main adds its separate supplement once; the included coffee adds no charge. Put House
lunch on the menu offered by an existing service period, with no new selling schedule.

These directions authorise preparing the build plan, followed by Claude review and watcher
clearance. They choose no VAT treatment; adviser S10 and the full invoice remain open. The
studies are local layout examples, not implemented order, printer or fiscal behaviour.

## 12 November 2026, 21:37: table service proceeds

The watcher relayed the owner: “a coca cola sold in the restaurant is 10%. The same coca cola
sold to take away is 21%. If it is sold as part of a take away meal … the coca cola portion
should be at 21% … Let's add this to the list”. The watcher directs: “At the table, the whole
set lunch is one 10% service. Write and build the plan without waiting; the plan does not split
a set menu's price across VAT rates.” This supersedes the earlier table-service VAT/full-invoice
wait. Takeaway and delivery set menus remain in adviser question S10, handled by Lane L.
The build plan still goes through Claude review and watcher clearance.


## 12 November 2026, 21:52: simpler build and open choices

The watcher cleared existing `courseId`, `extraListId` and recorded `menu_version_id`, with no
new course column or stored open/chosen/not-taken state. “Payment must never be blocked by a
choice still open.” A guest who never chooses coffee can pay the same lunch price, with nothing
sent for that choice. The watcher also cleared: “The bounded kitchen context (lunch reference
plus earlier dishes, clearly labelled) is fine.” The corrected plan still needs watcher clearance.


## 12 November 2026, 22:04: plan cleared; kitchen reference only

The watcher cleared the plan with the open-choice payment case, kitchen slips showing only
that course’s dishes and the lunch reference, and three hours as a point for a look rather than
a ceiling. This replaces the 21:52 earlier-dish context direction. Growth beyond 1.5 times a
pull request’s forecast still requires a deviation question. No further plan read was requested.
