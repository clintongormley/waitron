# Eaten here or taken away: one product, the right VAT

**Design, 14 November 2026.** Agreed with the owner in conversation on 14 November; the owner
approved this document, including the calls marked "my call", the same day ("approved"). Nothing
is built yet. This is a fiscal change: it changes the VAT rate filed with AEAT on some sales, so it
takes the full review path and the owner lands it.

## Why

In Spain, the same can of Coca-Cola is 10% VAT when it is drunk at the venue and 21% when it is
taken away. On 13 November the demo's deli got separate Coca-Cola, Coca-Cola Zero and beer
products at 21% (#3096). That works for a department that only sells to take away. It does not work
for a bar where the same customer may sit down or walk out. It also doubles the catalogue, and it
relies on staff picking the right copy.

The owner wants one product that charges the right VAT for how it is sold, in a way that other
countries with different rules can use.

## The law, as far as we have checked it

[The 13 November research](../../compliance/research/2026-11-13-takeaway-food-and-drink-vat.md)
quotes the sources. In short:

- **Eaten at the venue with its tables, bar or counter available** is a restaurant service (LIVA
  art. 91.Uno.2.2.º). Food and drink served this way take 10%, drinks and alcohol included.
- **Taken away or delivered** is a supply of goods, and each item takes its own goods rate (LIVA
  art. 91.Uno.1.1.º and 91.Dos). Most food stays at 10%. Alcohol and sugared or sweetened soft
  drinks, juices and fizzy drinks go to 21%. Bread, milk, cheese, eggs and fruit go to 4%.

So every product needs a takeaway rate, not just the drinks. The demo deli's cheese is 4% to take
away but 10% at the table.

A research summary the owner pasted on 14 November added two claims that no source we found
supports. The first is that a sale rung up as "eaten here" stays at 10% even if the customer then
walks out with it. The second is that a counter sale where the customer says nothing can be rung up
as eaten here. It cited two rulings. **V1429-22** exists: 16 June 2022, a restaurant franchise
taking orders in person, by phone and by app. We have read only a summary of it, not its text.
**V0557-23** could not be found at all. Both claims go to the tax adviser with question T17 (see
"Adviser" below). The design does not depend on their answers.

## What the owner decided, 14 November 2026

1. **Each product has two VAT classes:** one for when it is served here, one for when it is taken
   away. The sale uses the class that matches how the order is sold. Separate products and a VAT
   rate per department were both considered and dropped (see Approaches).
2. **Each department says how it sells**, one of three: **eaten in**, **taken away**, or
   **chosen on the till**. A department that chooses on the till also says which way an order
   starts, eaten here or taken away; staff switch it when needed and are never forced to choose.
3. **One price for both.** The price includes VAT, so a takeaway sale leaves the venue less after
   VAT: a €1.80 Coca-Cola leaves €1.64 drunk here and €1.49 taken away. There is no separate
   takeaway price.
4. **The price comes from the department's menu at the time**, exactly as today.
5. **Whether the distinction exists is a country matter.** A country without it shows one VAT
   field and never asks the question.
6. **A cover charge, and a higher price on the terrace than inside, are separate features.** They
   are not part of this design and go to the backlog. A cover charge only applies to an order
   that is eaten in, so it will hang off this design's setting.

## Goals

- One product sells at the right VAT whether it is eaten here or taken away.
- Staff in a department that only does one or the other never think about it.
- At a counter that does both, switching an order is one tap, and the till always shows which one
  the order is.
- The existing VAT model holds: the published menu fixes each product's classes, an order line
  stores classes and never a percentage, and the percentage is looked up at payment
  (owner, 27 September 2026).
- Each country decides whether the distinction exists, region by region.

## Not in this design

- A separate takeaway price, or a packaging charge.
- A cover charge, and different prices by floor zone (backlog entry, see above).
- Choosing eaten here or taken away for each line of an order. The choice is per order. A guest
  at a table who also buys a bottle to take home is a separate takeaway order.
- Splitting a set lunch's single price between VAT rates when it is taken away. That is adviser
  question T17 (see "Set lunches" below).
- A sales report split by eaten here and taken away.

## Must not happen

- A sale filed at a VAT rate the order's screen did not show. The till, the printed bill and the
  filed record must all agree on which way the order was sold.
- An order switched after money has been taken on it, leaving a payment and its invoice at
  different rates.
- Staff having to know VAT law. The till shows "Eat here" and "Take away", never class names or
  percentages.

## Approaches considered

1. **Separate products for takeaway (today's deli fix).** No code change, but staff must pick the
   right copy, a counter cannot switch an order already rung up, and the catalogue and its reports
   double. Dropped.
2. **A VAT rate per department.** Cannot say that the deli sells cheese at 4% and Coca-Cola at 21%:
   the rate depends on the product as well as how it is sold. Dropped.
3. **Two classes per product, and "eat here or take away" on each order, set from the
   department.** Chosen by the owner on 14 November.

## How it works

### Products

- The product's existing VAT class becomes its **served here** class. A new, optional **taken
  away** class sits beside it. Empty means "same as served here", which is right for most food.
- A variant can override either class, as it overrides the single class today. **My call:** a
  variant with no takeaway class uses its own served-here class if it has one, otherwise the
  product's takeaway class, and the editor's hint shows the class that will apply.
- An extra is a product, so it has both classes too, and an extra on a dish follows the order's
  way of selling, like the dish.
- Publishing a menu fixes both classes, as it fixes the one class today.
- The product editor shows the second field only where the country makes the distinction. Its hint
  says it is the same as served here when left empty. As with every screen change, the English and
  Spanish guides are updated.

### Departments

- A new setting, **How it sells**: eaten in, taken away, or chosen on the till.
- With chosen on the till, a second setting, **Starts as**: eaten here or taken away. **My call:** it
  defaults to eaten here.
- Shown only where the country makes the distinction.
- **My call:** an existing or new department defaults to **eaten in**. Today every sale is charged
  as served here, so this keeps every venue as it is until someone changes the setting.

### Orders

- Every order records whether it is **eaten here** or **taken away**, taken from its department
  when the order starts.
- In a **chosen on the till** department, the order starts as that department's **starts as**
  setting, eaten here or taken away, and the till shows a switch that is always visible. Staff are
  never forced to choose before sending or paying (owner, 14 November).
- In an **eaten in** or **taken away** department there is no switch.
- **My call:** the switch works until the order is first sent to the kitchen or any money is taken
  on it, whichever comes first. After that it is refused, with a message saying why. Sending fixes
  most of an order today (`working_orders_enforce_transition`, `packages/db/src/schema/orders.ts`),
  the kitchen ticket has printed by then, and a department set to send first and pay later sends
  with no payment taken. So "until the first payment" would let an order change after its kitchen
  ticket and its filing basis were fixed. Lines added later join the order as it is.
- **My call, moving an order to another department** (`acceptDepartmentTransfer`): while the switch
  would still be allowed, the order takes the new department's setting. After that it keeps its
  own, and a move into a department fixed the other way is refused with a message saying why.
- **My call, the bottle a table guest takes home:** a department that also sells to take away is
  set to chosen on the till; its table orders still start as eaten here. A department set to eaten
  in sells nothing to take away.
- An order from the delivery apps (A1513) is always taken away.

### Working out the VAT

- An order line still stores VAT classes, never a percentage. Which class it uses, served here or
  taken away, follows the order's way of selling. The percentage is looked up at payment, as today.
- How the line holds this is left to the builder: it may store both classes and read the order's
  setting at payment, or store the one class and rewrite it when the order is switched. Either way
  the bill shown on the till, the printed bill and the filed record must agree.

### Where the rules live

- **My call, the narrow version.** Each fiscal region a country pack describes
  (`fiscalJurisdictions` in `packages/country/src/country.ts`) gains a flag saying whether it
  charges takeaway differently. The product editor, the department setting and the till's switch
  appear only where the venue's region has it.
- The four VAT classes and today's rate table (`packages/shared/src/menu-document/vat-rates.ts`)
  stay where they are. Letting each country define its own classes and rates is a bigger, separate
  change: today `tax: "vat"` is only a name, the classes are spelled out in four database checks,
  and a dashboard screen reads the Spanish rates in the browser. It is not needed to sell a
  Coca-Cola at the right rate, so it waits until a second country needs it.
- Spain's common VAT region (`ES-common`) makes the distinction. Every other region starts without
  it until its own law is checked. The Basque Country, Navarre, the Canary Islands, Ceuta and
  Melilla are not supported today and are not changed.

### Till and printing

- The order screen shows **Eat here** or **Take away** wherever the order's department allows a
  choice. In a taken away department it shows **Take away** as a label.
- **My call:** the kitchen ticket and the customer's bill say **Take away** on a takeaway order,
  so the kitchen packs it and the guest can see why the VAT differs.
- The receipt already shows each line's VAT rate. Nothing else changes on it.

### Set lunches

A1515 treats a set lunch at the table as one service at 10%. How its single price splits between
rates when it is taken away is adviser question T17, still open. **My call:** until T17 is
answered, a set lunch cannot be added to a takeaway order. The till says that set lunches are
served at the table for now, and offers to switch the order to eat here when its department allows
it.

### Demo

**My call:** the deli's three separate drinks from #3096 are removed. The deli menu offers the
ordinary Coca-Cola, Coca-Cola Zero and beer, whose takeaway class is general (21%), and the
deli department is set to taken away. The restaurant stays eaten in. The demo has only these two
departments, so it does not show the till's switch; a third, counter department would be needed
to show it, and is not added.

## Adviser

Added to [T17](../../compliance/2026-11-06-adviser-questions.md#the-questions-that-need-judgement)
on 14 November, for the tax adviser to confirm:

- A sale rung up as eaten here, at a counter with tables or the bar available, stays at 10% if the
  customer then walks out with it.
- A counter sale where the customer says nothing, in a venue with tables or a bar, may be rung up
  as eaten here.

## Left to the builder

- How the line holds its classes (see "Working out the VAT").
- Where the tax regime's tables live in code, within the rule that a country pack is a
  browser-safe preset that names modules and never carries their logic.
- The exact wording on the till, the dashboard and the guides, in English and Spanish.
- Checking that a Veri*Factu record needs no marker for "goods" against "service". We believe the
  record carries only the rate and the amounts, but this has not been checked against AEAT's
  schema. The same check covers the operation description each department files today
  (`apps/server/src/sale-operation-description.ts`): whether a takeaway order in a department that
  chooses on the till needs a different one.

## Before go-live

Waitron is not yet in production, so no data is carried forward: the schema changes rebuild the
starting migration, and existing installations reset.
