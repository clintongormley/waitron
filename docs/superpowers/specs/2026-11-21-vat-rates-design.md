# VAT rates: one rate for eating in, a rate per product for taking away — design

_24 November 2026. The owner's decision relayed by the watcher at 11:21 replaces the mixed-rate
takeaway refusal below. For these menus, divide the price in proportion to each dish's à la carte
price and apply its own takeaway rate. See [set-menu design §4](2026-11-24-set-menus-automatic-grouping-design.md#4-the-calculation)._

Status: **approved by the owner, 21 November 2026** ("y"), after reading the list of the writer's
calls and asking how a takeaway set menu gets its rate (answer: worked out from its products, as
in "Set menus" below). The owner confirmed this approval on 22 November 2026 at 10:03, choosing "Yes to all" for piece A's D10, D11, D17 and D18 (lane L's `questions.md`, "WATCHER 2026-11-22 10:03"). The rules in "What the owner decided" are the owner's, from conversations on
16, 18 and 21 November 2026. The parts marked **my call** are the writer's, approved with the rest. Statements about today's code cite `file:line` on `main` at `58432f9af9`.
They come from reading the code, not from running it.

This replaces the paused 16 November brainstorm, under "VAT rates per product, eaten in or taken
away" in [docs/backlog/fiscal.md](../../backlog/fiscal.md). It also replaces the 18 November
decision that a set menu carries its own two VAT rates
([set-menus design](2026-11-17-set-menus-design.md), header note).

## What the owner decided

- **Eaten or drunk on the premises: one rate for everything** (owner, 21 November 2026: "so i
  think we need a single vat rate for dine-in, and then a vat rate per product for take away").
  It is 10% today. It covers food and drink, including drinks served with no food and drinks
  served after the kitchen has closed. The law's own words (Ley 37/1992, art. 91.Uno.2.2.º, the
  BOE's consolidated text fetched on 21 November 2026): «Los servicios de hostelería, acampamento
  y balneario, los de restaurantes y, en general, el suministro de comidas y bebidas para
  consumir en el acto, incluso si se confeccionan previo encargo del destinatario.» Nothing in
  that text needs food with a drink, and it names no kind of venue as an exception.
- **That rate can change, so it has dates.** Waitron supplies it with the date each rate starts.
  A change ships in a Waitron update, never as a venue setting (owner, 21 November: "great").
- **Taken away, each product has its own rate.** For example, 4% for cheese, 10% for food, 21%
  for alcohol and sugared drinks (owner, 21 November: "yes"). The rate is picked from the list
  Waitron supplies: the rates AEAT's checks accept, 0, 2, 4, 5, 7.5, 10 and 21 (owner, 16
  November). A venue cannot add its own.
- **A product's takeaway rate has dates too.** A change can be scheduled for a future day, for
  one product or for many at once (owner, 16 November).
- **No labels.** "General", "reduced", "super-reduced" and "zero" go everywhere (owner, 16
  November; again on 21 November: "we should no longer have labels for vat rates"). People see
  and pick percentages.
- **The ticket takes the rates of the day the meal ends** (adviser answer 1.4; owner, 18
  November: "correct"). An advance keeps the rate of the day it was paid.
- **Set menus have no VAT settings of their own.**
  - Eaten in, a set menu is at the dine-in rate, whatever it holds.
  - Taken away, a set menu is allowed only when every product it can hold has the same takeaway
    rate. It is then at that rate.
  - A set menu whose products' takeaway rates differ cannot be taken away. That stays until the
    adviser says whether a takeaway bundle of food and a drink (a burger and a cola) may go at
    the food's rate (owner, 21 November: "the safest thing for now is to say that we can't create
    set menus for takeaways containing items of different vat classes … we need the adviser's
    input before we change this last one").
- **A drink rung up at the counter as drunk on the premises stays at the dine-in rate** when the
  customer carries it out, and staff may ring it up that way when the customer says nothing
  (owner, 18 November: "yes"). Nothing here changes it: it follows the order's way, as today.

## What exists today

Four labels, `VAT_CLASSES` (`packages/shared/src/menu-document/vat-rates.ts:5`). One table turns
them into percentages, `VAT_RATE_TABLE` (`:26-31`). The table can already hold dated entries, but
each label has a single entry from the start of time, so nothing is dated yet.

**Where the labels are stored:**
- Products have `vat_class` and `takeaway_vat_class` (`packages/db/src/schema/menus.ts:139-142`).
  A blank takeaway label means "same as eaten in". A variant is a row in `products` and inherits
  a blank label from its product (`packages/menu/src/variant-fallback.ts:67-73`).
- Set menus have `set_vat_class` and `set_takeaway_vat_class` (`menus.ts:52-53`).
- Order lines have `vat_class` and `takeaway_vat_class`, both NOT NULL
  (`packages/db/src/schema/orders.ts:238-241`), and `offer_vat_class` (`:293`). Triggers freeze
  them once a line is past open (`packages/db/triggers/core.sql:430-431` and the lines after).
- Published menu copies carry both labels on every offer, variant, extra and set menu
  (`packages/shared/src/menu-document/menu-types.ts:35-36, 68-69, 118-119, 167-168`;
  `set-menu-types.ts:31-32`).
- The menu settings hold a default label for new products, `defaultProductVatClass`
  (`packages/menu/src/settings.ts:18`). Spain's pack sets it to `"reduced"`
  (`packages/country-es/src/spain.ts:317`).

**Where a label becomes a rate:**
- At issue: `rateLines` (`packages/menu/src/pricing.ts:214-255`), through `issueMoment`
  (`apps/server/src/issue-moment.ts:35-58`). The order's way, eaten here or taken away, picks
  which label in SQL (`apps/server/src/working-order.ts:1204-1206`).
- Advances: always `"reduced"`, on the day paid (`vat-rates.ts:9`; `apps/server/src/bill-advances.ts:132-152`).
- For display only: the dashboard (`apps/dashboard/src/i18n/domain.ts:204`,
  `widgets/product-editor.ts:712`, `widgets/menu-patch-dialog.ts:809`) and the till's
  `vatBreakdown` (`apps/till/src/state/working-order.ts:530`), which no screen shows.

**After a sale nothing changes.** A sale line stores the percentage it was charged
(`sale_lines.vat_rate`, `packages/db/src/schema/sales.ts:241`), and the sale stores its breakdown
by percentage (`:92-94`). Tickets, invoices, reports, the accountant export, AEAT records and
corrections all read percentages. None of them needs to change.

Whether takeaway has its own rate at all is a switch on each tax area, `takeawayVat`
(`packages/country/src/country.ts:56`). Spain's common area sets it (`spain.ts:348`). It stays.

## The design

### Rates Waitron supplies (my call: in the country pack)

Spain's fiscal area in `packages/country-es` gains two things, replacing `VAT_RATE_TABLE` in
`packages/shared`:
- **`dineInVatRates`**: the dine-in rate as a dated list, `[{ from: null, rate: "10.00" }]`
  today. A legal change is a new dated entry in a Waitron release, never an edit of an old one.
- **`vatRates`**: the rates a person may pick, `0, 2, 4, 5, 7.5, 10, 21`.

A Spanish rule belongs in Spain's pack, not in the shared package. Every reader finds the venue's
area as today.

### A product's takeaway rate

- A new table, `product_takeaway_vat_rates`: the product, the day the rate starts, and the rate in
  basis points. It is `state`, and one row per product per start day. The earliest row starts at
  the beginning of time, as the dated table's first entry does today.
- A variant may have its own rows. With none, it takes its product's. This is the inheritance it
  has today (**my call**), kept for a product whose variants are sold at different rates.
- An extra is a product, so it has its own takeaway rate.
- A new product starts at the venue's default takeaway rate, a setting that replaces
  `defaultProductVatClass`. Spain's pack sets it to 10% (**my call**). Today the fallback is
  `"general"` while Spain's pack says `"reduced"`. The new default comes only from the pack, so
  the two cannot disagree.
- **The eat-in label goes from products, set menus, order lines and menu copies.** So does
  `takeaway_vat_class`. Nothing about VAT is stored on an order line or in a published menu.

### Working out a line's rate

Rates are worked out once, when the ticket is issued, for the day the meal ends (as today,
`apps/server/src/close-of-day.ts:192-205`):
- **Eaten here:** the dine-in rate on that day, for every line.
- **Taken away:** each line's product's takeaway rate on that day. A set-menu line uses its set
  menu's takeaway rate (below). Its dishes and their surcharges and extras use their products'
  own rates, which are that same rate.
- **Advances:** the dine-in rate on the day paid, replacing the fixed `"reduced"`.

`rateLines` takes a rate for each line instead of a label. The till's `vatBreakdown`, which no
screen shows, is deleted rather than ported (**my call**).

### Set menus

- `set_vat_class` and `set_takeaway_vat_class` are removed, with their fields in the dashboard's
  set-menu form (`apps/dashboard/src/widgets/set-menu-terms-form.ts`).
- **Eaten here:** the dine-in rate.
- **Taken away:** a set menu's takeaway rate on a day is the one rate every product it can hold
  shares that day. Those are the products listed in its lines, including variants and the extras
  it offers. If they do not share one rate that day, the set menu cannot be taken away that day.
- **The dashboard says so** on the set menu, with the reason, for example: "Can't be taken away:
  Wine is 21%, the other dishes 10%." Saving is not refused: the set menu still sells eaten here
  (**my call**, the owner's "can't create set menus for takeaways" read as "can't be taken
  away").
- **The till refuses** to add it to a takeaway order: "Menú del día can't be taken away: its
  dishes have different VAT rates. Order the dishes separately." The check is made on the day of
  ordering, because a product's dated rate can change after the set menu was saved.
- **A scheduled rate change between ordering and the meal's end** can leave a takeaway set menu
  already ordered with rates that no longer match. Payment of that order is refused with the same
  message, so staff cancel the set menu and ring the dishes up separately (**my call**: rare, a
  takeaway order spans midnight on the day a rate changes; refused with a manual route rather
  than built for). The server makes this check, so a till that missed it cannot get past it.

### The dashboard

- **Product editor:** one field, "VAT when taken away", a list of percentages. It is shown only
  where the venue's area has `takeawayVat`. Beside it: "Eaten here: 10% (all food and drink)",
  read from the dine-in rate, so nobody looks for an eat-in field. The eat-in field goes.
- **A scheduled change:** "Change from" a day, to a rate. It is shown on the product until it
  starts.
- **Many products at once:** select products in the list, then "Change takeaway VAT", with a rate
  and a start day.
- **The live-menu patcher** (A1151) stops offering VAT. VAT no longer lives in a menu
  (`packages/menu/src/menu-patch.ts:101-104`).
- **Venue defaults:** "New products start at" a takeaway rate, replacing the label.

### Demo data and fixtures

Spain's demo menu and the regional demo venues give each product its takeaway rate as a
percentage. For example, the cheese to take home is 4%, as the demo charges today
(#3007). Test fixtures that name labels are rewritten.

### Before go-live

No venue is live, so the schema change rebuilds the core set's starting migration
(`migration-baseline rebuild --set core`) and test venues are reset. No data-migration code is
written (CLAUDE.md §3).

## Open, with the adviser

- **A takeaway bundle at the food's rate.** Until he answers, a takeaway set menu with products at
  different rates cannot be sold. If he says the food's rate applies to the whole bundle, the
  takeaway check above is replaced by "the rate of the main item", and a discount then needs no
  split. If instead the price must be split by what each item sells for on its own, that is a
  bigger change, designed then.
- **Drinks served with no food.** On 18 November the adviser said such drinks may take 21%,
  certainly once the kitchen has stopped serving. Today's text of art. 91.Uno.2.2.º (quoted
  above) does not say so. Ask him which ruling or rule he relies on. Until then, all drinks served
  on the premises are at the dine-in rate (owner, 21 November).

## What this changes elsewhere

- **Set menus piece 4** ([plan](../plans/2026-11-18-a1515-set-menu-bill.md), lane L): its Task 3,
  which gave covered dishes their set menu's labels, is no longer needed. Eaten in, every line has
  one rate. Taken away, every product in an allowed set menu has one rate. A covered €0.00 dish
  can never add an empty line at another rate to the ticket or the AEAT record.
- **Set menus piece 1** (landed: #3783, #3820): its two VAT fields come out, in piece B below.
- **The adviser sheet's** set-menu split question (question 4, "Splitting the price between VAT
  rates") is replaced by the bundle question above.

## The pieces, for planning

Each piece is planned on its own and read before building. These are fiscal: they change what
rate a ticket is filed at, so the owner lands them.

- **A. Rates from the country pack, and a product's dated takeaway rate.** The two pack lists, the
  `product_takeaway_vat_rates` table, issue and advances working out rates as above, and all
  labels and their columns removed from products, order lines and menu copies. Also the product
  editor's one field, the venue default, the patcher, demo data and fixtures. This is large, and
  the plan should split it into slices of a size one implementer can finish.
- **B. Set menus without VAT of their own.** Remove their two fields. The takeaway check in the
  dashboard, the till and at payment. Needs A.
- **C. Scheduled changes and changing many products at once.** The "Change from" field and the
  product list's "Change takeaway VAT". Needs A.

A, then B and C side by side. Set menus piece 4 drops its Task 3 and can be built before or after
B. Its other tasks do not depend on VAT.
