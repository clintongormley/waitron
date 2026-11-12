# A1515. Set lunch menus: proposal

**Draft, 12 November 2026.** These are recommendations, not agreed features. Lane L must
review the invoice part before owner presentation. The proposal stays off main until the
owner sees it. Nothing is built; implementation, schema, fiscal changes and public printed-menu
design are outside this proposal.

You need to charge for one lunch while sending its dishes to different stations, sometimes
before the guest chooses the last dish. I recommend one priced lunch item, with its selected
dishes attached to it for service.

## Set it up on the dashboard

You would create a priced catalogue item called **House lunch**, then place it on a menu
whose service periods limit its selling times and days. It is an item sold from a menu,
rather than a new kind of whole menu.

You would enter **€18 including VAT** and build its choices from existing products:
**Starter:** soup or salad; **Main:** chicken or premium fish; **Finish:** pudding or coffee.
Bread and one drink, water or a soft drink, are included. Dessert **or** coffee is one
choice, not both. Beside fish you would enter **+€3**, added to the lunch price rather than
using the fish's ordinary selling price. The lunch costs €18 with chicken or €21 with fish.

The selected products would stay in their original folders for preparation routing. The
lunch's choices say what the guest may pick; service courses say when each dish is cooked.
You would assign those separately, so choosing fish need not mean cooking it now.

## Sell it on the till

You would tap **House lunch** at Table 4 and choose soup, fish and water. The till would
show **€21**, explain “€18 lunch + €3 fish”, and show bread as included. I recommend adding
separate lunch items when diners choose different dishes; each lunch remains its bill item,
without introducing guest numbers.

I recommend allowing **Dessert or coffee: choose later** while you send the known choices.
After the main, you would reopen that lunch and choose coffee. Only coffee would be sent,
without another charge or repeat orders for the earlier dishes. The outstanding choice would
stay visible, without silently choosing pudding. If the diner takes neither, I recommend
closing that choice at payment with the fixed €21 unchanged and no kitchen order.

## What you would print

The proposed receipt has one priced line, **1 House lunch €21.00**, with unpriced descriptions
below: “Soup; fish (+€3 included in total); bread; water; coffee”. A chicken lunch would show
€18.00. If the last choice is untaken, its description would say “Dessert or coffee: not taken”.
Both this receipt layout and the full invoice's layout depend on the adviser's answer.

The invoice should identify the lunch and selected contents, with the same €21 gross total.
Whether either document can use one priced line, needs component amounts, or needs another
tax presentation remains unresolved. No VAT rate or allocation formula is chosen. The adviser
must settle tax treatment before implementation.

Each kitchen ticket would list its actual dishes without prices. Each selected product
would follow its ordinary folder routing; the lunch itself has no station. Parts would
mention each other, as the Bundles design requires. For example, the Hot station gets
“Table 4 · Fish · House lunch; with soup at Starters, bread and water; finish to choose”.
Later, the coffee ticket would refer to the same lunch's soup and fish. These references
would not order those dishes again.

## Sources and limits

Read-only design directions, not proof that lunches work: [A1515](../../backlog/catalogue.md#a1515-set-lunch-menus-the-menú-del-día);
[Bundles](2026-09-30-catalogue-menus-routing-design.md), lines 640–644 and §5.10;
[Courses](2026-10-16-a773-courses-and-groups-design.md), lines 95–105. Reuse candidates:
`packages/venue-service/src/routing.ts:153` and `apps/server/src/invoice-document.ts:95`.
The adviser question below extends [S10](../../compliance/asesor-questions.md) and its
[VAT research](../../compliance/research/2026-10-09-vat-and-corrections.md), rather than settling either.

## Choices to settle

**Owner, after Lane L review:**

- **One lunch item per diner's choices, with explicit inclusions and surcharges?** Recommend
  yes: soup, fish, bread, water and coffee cost €21; the same choices with chicken cost €18.
- **Allow later choices and leave the price unchanged if untaken?** Recommend yes: send soup
  and fish now; choose coffee later or close that choice at payment without ordering it.
- **Show the selected dishes beneath one priced receipt line, subject to the adviser?**
  Recommend yes: the guest can check what the €21 covered.

**One question to send to your adviser, extending S10:** “For an €18 VAT-inclusive dine-in
lunch of starter, main, bread, a drink and dessert OR coffee, with a €3 premium-fish surcharge
making €21, should it have one restaurant-service VAT treatment? If any component requires a
different rate, how should we allocate the price, including the inclusions and surcharge:
are the products' ordinary separate selling prices acceptable allocation weights? Exactly
what descriptions, amounts and VAT breakdown must the receipt/simplified invoice and full
invoice show?”
