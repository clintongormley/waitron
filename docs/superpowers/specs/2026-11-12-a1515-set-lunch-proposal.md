# A1515. Set lunch menus: proposal

**Draft, 12 November 2026.** These are recommendations, not agreed features. Lane L reviewed the invoice part on 12 November; its corrections are incorporated below. Nothing is built; implementation, schema,
fiscal changes and public printed-menu design are outside this proposal.

I recommend one priced lunch item, with selected dishes attached for service, so you can send
them to different stations before the guest chooses the last dish.

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
