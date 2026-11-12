# A1515. Set lunch menus: proposal

**Draft for review, 12 November 2026.** These choices are recommendations, not agreed
features. Lane L must review the invoice part before owner presentation. Nothing is built;
implementation, schema, fiscal changes and public printed-menu design are outside this proposal.

You need to sell one lunch while sending its dishes to different places, sometimes before
your guest has chosen the last course. I recommend one priced menu per guest, with its
chosen dishes beneath it for service.

## Set it up on the dashboard

In Menus, you would add a **Set lunch**, name it “Lunch menu” and enter €18 as the total
price including VAT. You would choose its selling days and lunch service period, so the
offer appears when you intend to sell it.

You would build the lunch from your existing products: one starter, soup or salad; one main,
chicken or premium fish; bread; one drink, water or a soft drink; and one finish, pudding
or coffee. Bread and the drink are included. Dessert **or** coffee is one choice, not both.
Beside fish you would enter **+€3**, an addition to the menu price rather than the fish's
ordinary selling price. The example lunch therefore costs €18 with chicken or €21 with fish.

Show the choices and inclusions together in a till preview: “Starter · Main · Bread included · Drink included · Dessert or coffee”. You would
select the products without moving them into a special lunch folder, preserving where each
belongs for preparation. The course choices describe what the guest may pick; their dishes
would follow the service courses you assign, so choosing a main need not mean cooking it now.

## Sell it on the till

You would tap **Lunch menu**, add one for Guest 2 at Table 4, then choose soup, fish and water.
The till would show **€21**, explain “€18 lunch + €3 fish”, and keep bread visible as included.
For two guests, you would add two lunches separately so each person's choices stay together.

I recommend letting you send these known choices while the last choice reads **Dessert or
coffee: choose later**. You would reopen Guest 2's lunch after the main and choose coffee.
That would send coffee only, without another menu charge or a repeat order for the earlier
dishes. An unanswered choice would remain visible on the table; it would not create a kitchen
order or silently pick pudding.

## What you would print

The proposed receipt would have one priced line, **1 Lunch menu €21.00**. I recommend
unpriced descriptions underneath: “Soup; fish (+€3 included in total); bread; water; coffee”.
The base lunch would show €18.00 in that same position. These are commercial display proposals;
any required tax detail remains subject to the adviser's answer.

For the invoice, the proposed goal is to identify the lunch and its selected contents clearly,
with the same €21 gross total. Whether that can be one priced line, needs component amounts,
or needs another tax presentation is unresolved. This proposal chooses neither a VAT rate
nor a way to divide the price. The adviser must settle the tax treatment before implementation.

Each kitchen ticket would list the actual dishes for its station, without menu prices.
Soup, fish, bread, water and later coffee would each route through their original product
folders and the applicable routing rules. The menu wrapper would have no station. Every
part would identify **Table 4 · Guest 2 · Lunch menu**, including later additions, so you can
recognise the same lunch across tickets.

## Sources and limits

Read-only design references, not proof that set lunches work: [A1515](../../backlog/catalogue.md#a1515-set-lunch-menus-the-menú-del-día); [Bundles](2026-09-30-catalogue-menus-routing-design.md), lines 640–644; [Courses](2026-10-16-a773-courses-and-groups-design.md), lines 68–105. Reuse candidates are `packages/catalogue/src/menu-document.ts:141`, `packages/venue-service/src/routing.ts:153` and `apps/server/src/invoice-document.ts:80`. No implementation plan is proposed yet.

## Choices to settle

**Owner, after Lane L review:** Would you accept the visible inclusion choices above, including
one finish? I recommend that explicit list: Guest 2 gets bread, water and coffee within the
lunch, with fish adding €3. Would you allow later choices? I recommend yes: send soup and fish
now, choose coffee after the main. Would you show choice descriptions on the receipt? I
recommend yes: keep one €21 priced line and let your guest check what it covered.

**One question you can send to your adviser:** “For an €18 VAT-inclusive lunch comprising one
starter, one main, bread, one drink and dessert OR coffee, with a €3 VAT-inclusive premium-fish
surcharge making €21, if its components hypothetically attract different VAT rates, what tax
treatment and allocation, if any, should we use for the included bread, drink, dessert/coffee
and surcharge, and exactly what descriptions, amounts and VAT breakdown must the receipt
and full invoice show?”
