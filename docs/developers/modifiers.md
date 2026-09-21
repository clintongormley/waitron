# Integrating extras and options

A dish can ask the diner two kinds of question, and the dashboard puts both under one **Modifiers**
screen:

- an **options** list — a reusable, named list of labels the diner picks exactly one of ("Cooked":
  rare, medium, well done). It is a kitchen instruction. It owns no price, no VAT class and no
  allergens, and it never becomes a line of its own: the answer freezes onto the dish's own line.
- an **extras** list — a reusable, named list of PRODUCTS the diner may add ("Sides": chips, salad).
  Each pick becomes its own child line at its own price and its own VAT rate, so an extra is sold,
  reported and filed as the product it is.

There is no third kind, and nothing chooses between them at run time: which table a list lives in
is what it is.

A list is authored once and attached to as many dishes as you like. A dish carries ONE ordered
attachment list, `product_modifiers`, and each row of it names either an extras list or an options
list — never both (`product_modifiers_one_reference_ck`,
`packages/catalogue/src/schema/extras.ts`). The three names every list and every label carries —
staff `name`, translated `customerName`, plain `kitchenName` — follow the product convention, and
which surface reads which is in [products.md](products.md).

The wire shapes are declared once, in `packages/catalogue/src/modifier-list-types.ts`: `OptionList`,
`OptionLabel`, `ExtraList`, `ExtraListItem`, their `…Input` twins and the two `…Dependants` shapes.
That file is types only and imports nothing, so a browser client can import the same copy the server
answers with. `scripts/dashboard-browser-purity.test.ts` is what keeps it that way, and it reads the
file as TEXT, so an `import type` line would pass it — that the file imports nothing at all is true
today and guarded by nothing.

## Authoring

Each kind of list has its own six routes under `/management-api/modifiers`, and the two sets are the
same six with one path segment different. They are mounted by one helper, `mountListSurface`
(`apps/server/src/catalogue-api.ts`), which is why they cannot drift apart.

| Route | Answers |
| --- | --- |
| `GET /management-api/modifiers/{options,extras}` | `{ optionLists: OptionList[] }` / `{ extraLists: ExtraList[] }` |
| `POST /management-api/modifiers/{options,extras}` | the created list under `optionList` / `extraList`, 201 |
| `GET /management-api/modifiers/{options,extras}/:id` | the list under `optionList` / `extraList` |
| `PATCH /management-api/modifiers/{options,extras}/:id` | the updated list, same key. The body is the COMPLETE list, not a patch of changed fields |
| `DELETE /management-api/modifiers/{options,extras}/:id` | `{ ok: true }` |
| `GET /management-api/modifiers/{options,extras}/:id/dependants` | `{ dependants }` — the products carrying the list and the menus publishing it, for a delete confirmation to show |

An id that is not a uuid is refused with `shared.invalid_id`, whose `kind` says which id was meant
(`OptionListId`, `ExtraListId`). A body fault is `options.invalid` or `extras.invalid` naming the
offending `field`; an unknown list id is `options.not_found` / `extras.not_found`; a name missing in
an enabled content language is `options.translation_required` / `extras.translation_required`
naming both the field and the language. Every code is registered in
`packages/catalogue/src/errors.ts`.

A list carries its labels or its items INSIDE it — there is no separate item endpoint. The order you
send them in is the order they come back in: the write numbers each row's `sort` from its position
in the body (`writeItems`, `packages/catalogue/src/extras.ts`; the options equivalent in
`options.ts`). Sending an id on a label or an item keeps that id; leaving it out mints a new one.
Which order a TILL draws things in is a separate question with three columns in it — the table under
_Ordering and stored facts_ below.

An **options list** must be answerable while it is active: an active list with no labels at all, or
whose every label is withdrawn, is refused. `defaultLabelId` names a label of THIS list and is the
one preselected when the list is asked; naming an unavailable label normalises it to null rather
than refusing.

An **extras list** bounds how many picks it takes — `minPicks` 0 makes it optional, 1 or more makes
it required, `maxPicks` null leaves it uncapped — and each item bounds its own product with
`maxQuantity` (at least 1, where 1 means "one or none"). An item names a product and adds only the
terms of the offer: it duplicates none of the product's names, VAT class, allergens, dietary labels
or photo, which all come from the `products` row (spec §3.1). A product may appear at most once in
one list (`extra_list_items_list_product_uq`).

### Attaching a list to a dish

A product POST or PATCH carries one ordered `modifiers` list, each entry
`{ "kind": "extras" | "options", "id": "<list id>" }`. Product reads and the editor read return the
same shape in the same order. A body that sends the retired `modifierIds` or `optionGroupIds` is
refused, naming that field.

`writeProductModifiers` (`packages/catalogue/src/product-modifiers.ts`) is what writes it. It takes
no advisory lock: it takes a `for key share` ROW lock on each list the body names, before it touches
an attachment row rather than after. That is the same lock the insert's own foreign-key check would
take anyway, so it adds no conflict — it only moves when the lock is acquired, which is what stops a
concurrent list delete deadlocking the save. The measurement is in that file.

### Publishing an extras list on a menu

A menu offer can publish a subset of a dish's extras lists and change the terms:
`menu_item_extra_lists` says which lists this offer publishes and in what order, and
`menu_item_extra_items` withdraws or re-prices individual products within one (spec §3.2). There is
no management route for this today — `setMenuItemExtraLists` (`packages/catalogue/src/extras.ts`)
is called from nothing outside `packages/catalogue` and the test suites.

An options list has no per-menu version at all. A dish asks the same questions on every menu (spec
§2.2), so every options list the dish carries is offered on every offer of it, and there is nothing
to publish. The consequence worth knowing: a menu item created today offers its product's options
lists and NONE of its extras lists, because an extras list reaches an offer only through
`setMenuItemExtraLists` and nothing outside `packages/catalogue` and its tests calls that. Pinned by
"omits an extras list the offer does not publish, and keeps the options list"
(`packages/catalogue/src/offered-modifiers.test.ts`).

### What an extra costs

Three rungs, first one wins (`resolveExtraPrice`, `packages/catalogue/src/extras.ts`, spec §3.3):
the menu offer's `menu_item_extra_items.price`, then the list item's own `price`, then the product's
`unit_price`. A null at a rung means "ask the next one". Every price on the wire is a GROSS
(VAT-inclusive) two-place decimal string; the column underneath holds a count of whole cents and the
row converts (`decimalToCents` / `centsToDecimal`, `packages/shared/src/cents.ts`).

The VAT class is never resolved that way — an extra always carries the picked PRODUCT's own VAT
class, because it is sold as that product.

### The dashboard

The Modifiers screen (`apps/dashboard/src/screens/modifiers-screen.ts`) has two tabs and composes one
widget per kind: `dashboard-option-list-form` (`apps/dashboard/src/widgets/option-list-form.ts`) and
`dashboard-extra-list-form` (`apps/dashboard/src/widgets/extra-list-form.ts`). The Products screen
composes the same two, so a list can be created without leaving the dish being edited. Each widget
emits `wt-submit` with the complete list input and `wt-cancel` with `{}`; the composing screen owns
the API call and closes the editor after a successful write.

## Ordering and stored facts

A requested line carries two optional fields, `options` and `extras`. Five routes take them,
each threading them into `priceOrderLines` (`apps/server/src/working-order.ts`): the walk-up sale
`POST /api/sales`, the park `POST /api/working-orders`, the held-order edit
`PUT /api/working-orders/:id`, the tab round `POST /api/working-orders/:id/round`, and the
integrated card pay `POST /api/pay` — the last on its WALK-UP branch only, since a retrieved or
placed order ignores the request's lines and files its own stored ones (`IntegratedPayRequest`,
`apps/server/src/till-sale.ts`).

An `options` answer names a list and one of its labels. An `extras` answer names a list and the
PRODUCTS picked from it, each with how many of that product this dish takes — a pick never names
an `extra_list_items` row. Both shapes are declared in `@waitron/shared`
(`option-selection.ts`, `extra-selection.ts`):

```json
{
  "menuItemId": "22222222-2222-4222-8222-222222222222",
  "quantity": "2",
  "options": [
    { "listId": "11111111-1111-4111-8111-111111111111",
      "labelId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
  ],
  "extras": [
    { "listId": "33333333-3333-4333-8333-333333333333",
      "picks": [{ "productId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "quantity": 1 }] }
  ]
}
```

`buildLineExtras` (`apps/server/src/modifier-selection.ts`) validates both against the definitions
the basket resolved, and decides what is stored:

- Every ACTIVE options list the dish attaches must be answered with one of that list's available
  labels. An unanswered list, or one answered with a label it does not carry, is
  `options.label_required` carrying the list id; an answer for a list not on offer, two answers for
  one list, or a malformed entry is `options.invalid` naming the field.
- An answered list freezes onto the PARENT line's `option_snapshots` column as six names — the
  list's three and the chosen label's three — and no ids at all, so renaming or deleting a list
  afterwards cannot rewrite a saved order.
- Each extras pick becomes its own CHILD line (`parent_line_id` set) carrying the picked PRODUCT,
  that product's three frozen names, the price the offer resolved and the product's OWN VAT class.
  The child's stored quantity is dish quantity × pick quantity.
- A list's own counts are enforced per list: too few picks for `minPicks`, too many for `maxPicks`,
  or more of one product than its `maxQuantity` is `extras.limit_exceeded` carrying the list id. A
  malformed pick is `extras.invalid` naming the field.
- A pick on a dish that is not priced `each` is refused with `extras.unsupported_product`: a child
  priced dish × pick would bill a fraction of an extra on a weighed dish. An options answer on a
  weighed dish is still allowed.
- Defaults are client draft seeds; the server fills in no missing answer.

Reading them back, four wire types carry `optionSnapshots`: `TabLine`, `HeldOrder.lines`,
`StationQueueItem` and `ExpoItem`, all declared in `apps/server/src/working-order.ts`. A held order's lines also carry an
`extras` array holding what each CHILD line froze. Those are VALUES, not a re-sendable selection:
the child line holds no list id to name. The till rebuilds one from them against the dish's live
offer (`deriveExtraSelections` and `deriveOptionSelections`, `apps/till/src/state/`) — see the end
of this section.

A quantity-only edit of a held order sends the same answers with a new quantity. `updateHeldOrder`
rebuilds what those answers would freeze NOW and compares the result with what the stored line
holds, by value; equal, every line and its locked price are kept. One line that does not match
sends the WHOLE order down the replacement path, which re-prices every line on it.

Neither side's ORDER is part of that comparison (`sameOptionSelections` and `matchExtraChildren`,
`apps/server/src/modifier-selection.ts`). Both sides are built in the order the dish offers its
answers, which reads as a fixed thing and is not one: it is a stored position, and THREE columns
hold parts of it, each re-numbered from the body of whatever save writes it.

| Column | What it orders | Written by | A route reaches it |
| --- | --- | --- | --- |
| `product_modifiers.sort` | a dish's options lists, and its extras lists on a line naming a plain PRODUCT | `writeProductModifiers` (`packages/catalogue/src/product-modifiers.ts`), from the product save's body | yes — the product write |
| `extra_list_items.sort` | the items WITHIN one extras list, which is the order its picks come back in | `writeItems` (`packages/catalogue/src/extras.ts`), from the list save's body | yes — `PATCH /management-api/modifiers/extras/:id`, and the `POST` that creates a list |
| `menu_item_extra_lists.display_order` | the extras lists of a line naming a MENU OFFER | `setMenuItemExtraLists` (`packages/catalogue/src/extras.ts`), from the publication body | no — nothing outside `packages/catalogue` and the test suites calls it |

So a line parked before any of those saves keeps the old order while the rebuilt side comes back in
the new one, and a comparison pairing the two up position by position reads that as a changed answer
and re-prices a quantity-only edit. The extras comparator answers the PAIRING of picks to stored
child lines rather than a yes or no, because the update moves each child's quantity and the two
sides are no longer in step.

**A picked product that more than one of the dish's ACTIVE lists offers refuses the pairing.** A
child line records the product it is, its quantity and the price it was sold at, never the list that
offered it (§3.4 of the design). So when two lists offer the same product at two prices, nothing on
the stored side says which row belongs to which list, and the comparison cannot tell a quantity
change from a pick that MOVED between the two — it keeps the price of whichever row it lands on.

Two halves, with different histories. Two picks EXCHANGED between the lists was introduced by making
the pairing order-independent: the index-wise comparison that preceded it saw the quantities move at
each position and replaced the line. ONE pick MOVED from one list to the other predates all of it —
the same fixture run against `main` at `68e36c6aa` bills it at the old list's 1.00 there too. Both
now take the replacement path and are re-priced from today's offers. The cost is not confined to the
line that was refused: the replacement path rewrites the WHOLE order, so every line loses its id and
its price lock whenever a picked product is doubly offered — re-priced from today's offers, which
changes the number only where an offer has moved.

Pinned in `apps/server/src/working-order.test.ts` by two cases that assert the BILL rather than the
line ids, because the ids were right while the money was wrong: "replaces the line when a pick moves
to another list offering the same product", and "replaces the line when two lists offering the same
product have their picks swapped", where two picks exchanged between a 1.00 list and a 3.00 one cost
5.00 against the 7.00 a crossed pairing charges.

**The refusal is not a complete guard, and the gap is in the word "offers".** It counts the offers as
they are NOW, while the ambiguity is a property of the offers the stored child was written against.
The escape is one specific edit: the list the STORED CHILD came off is deactivated, or loses the
product, between the park and the edit — the count comes back to one, the re-sent pick names the
surviving list, and the line is preserved at the old row's price. Traced through the code, not run.
The opposite edit is closed by something else: a pick naming a list that no longer offers the product
is refused outright by `validateExtraSelections`, and the line is replaced. Two ways to close the
escape, neither free — pair on the child's frozen price as well as its product and quantity, which
gives up the price lock a quantity-only edit exists to keep; or let the child carry the list it came
off, which is what §3.5 rules out when it says an open order's child points at the product and not
the list. Recorded in `docs/backlog.md` as an owner decision rather than guessed at here.

An OPTIONS list RENAMED between the two sends does make the two sides differ, and the WHOLE ORDER is
replaced and re-priced — not just the line that answered it. The preserve test is all-or-nothing
(`preservesEveryLine`, `apps/server/src/working-order.ts`), so one line that does not match sends
the request down the replacement path, which prices every line at today's offers and then deletes
and re-inserts them all under new ids. That is a decision, not an omission: an options answer
freezes six names and no ids, so the wording is the only evidence the line carries about what was
chosen, and a rename cannot be told from a different answer. Giving the comparison an id to use
would mean putting one on the line, which §2.3 of the design rules out. Pinned by "re-prices a held
line when the options list it answered was renamed between the two sends"
(`apps/server/src/working-order.test.ts`). An EXTRAS list is different: its children are compared by
the picked product's id, so renaming the list — or the product — disturbs nothing and the line is
preserved.

The till sends one `options` entry per answered list and one `extras` entry per list picked from,
reads a line's frozen answers back as `optionSnapshots` on all five mirrors it keeps
(`apps/till/src/api/client.ts`), and tells a child extras row from a dish by `parentLineNo` rather
than by a null product. A retrieved line's options answers ARE re-sendable, even though a frozen answer carries
six names and no ids: `deriveOptionSelections` (`apps/till/src/state/held-options.ts`) matches each
answer's STAFF names back against the dish's live offer and rebuilds the `{ listId, labelId }` pair,
which it has to, because leaving out an answer for an ACTIVE list refuses the whole edit with
`options.label_required`. It matches on the STAFF name of each side only, leaving the other four to
the server's own comparison — so a list whose CUSTOMER or KITCHEN wording moved still re-sends, and
the server then re-prices the whole order as it does for any other changed wording. What it will not
do is guess: a staff-name rename on either side, or a withdrawn label, matches nothing, and the till
tells the operator to open the line and choose again rather than substituting the list's own
default.

## What a till is offered

The two sell-side reads — `listAvailableProducts` and `listMenuOffers`
(`packages/catalogue/src/operations.ts`) — each carry an `offeredModifiers` array: the ordered
extras and options lists a dish puts in front of a diner, already resolved. It is built by
`readOfferedModifiers` (`packages/catalogue/src/offered-modifiers.ts`) and the shapes are declared
beside the rest of the sell-side wire in `menu-types.ts` (`OfferedModifier`, `OfferedExtrasList`,
`OfferedOptionsList`, `OfferedExtraItem`).

Nothing else on those two payloads describes a modifier. The till's picker walks
`offeredModifiers` alone (`apps/till/src/widgets/modifier-picker.ts`), and the two surfaces that ADD
a line — the product grid and tender-pay's weighed quantity — decide whether a dish needs a picker
from that field or from an available variant (`needsModifierPicker`,
`apps/till/src/state/order-line.ts`).

Five things it is worth knowing about that payload:

- **The order is the product's own `product_modifiers.sort`, on both reads** (spec §5). A menu
  offer changes what is inside an extras entry, and whether the entry is there at all, but not
  where it sits — so `menu_item_extra_lists.display_order` decides nothing here. It still decides
  the order in which the order path builds a line's answers, which is the table above.
- **An extras entry on a MENU offer is that offer's own version** — items withdrawn and repriced by
  `menu_item_extra_items` (spec §3.2) — and a list the offer does not publish is left out of the
  walk entirely.
- **Every price is settled**: the menu's price, then the list item's, then the product's
  `unit_price` (spec §3.3). A till has no way to walk that chain itself, because the last rung is
  not on the list item.
- **Only ACTIVE lists are offered, and an options list offers only its AVAILABLE labels** — which
  is exactly the set `validateExtraSelections` (`extra-contract.ts`) and `validateOptionSelections`
  (`option-contract.ts`) will accept an answer from. That agreement is the reason the order path
  and these two reads resolve their lists through ONE body, `resolveAttachedModifiers` in the same
  file: a required list the picker never drew would refuse the order with `options.label_required`
  or `extras.limit_exceeded`, and an offered list the server does not know about would be refused
  as `options.invalid`.
- **An extras item carries the PRODUCT's facts**, not the row's: its three names, its own VAT class,
  its allergens and its dietary labels, because `extra_list_items` deliberately duplicates none of
  them (spec §3.1). The two declaration fields take the names a CHILD LINE uses on the kitchen and
  expo screens — `addAllergens` and `suitableFor`, the same two values `readQueueSubItems`
  (`apps/server/src/working-order.ts`) hands those screens — because a pick is what becomes such a
  line. Shown beside the dish's own, never folded into them (spec §3.4).

## On the filed sale

A filed sale is a snapshot and never a catalogue reference (`packages/db/src/schema/sales.ts`,
architecture §6), so the two kinds of answer land differently:

- An options answer is copied onto the DISH's own `sale_lines.option_snapshots` — the same six names
  the open order froze, and no ids. Both filing routes supply it: a walk-up from the basket it was
  priced from, a retrieved order from `working_order_lines.option_snapshots`, read by
  `readLockedLines` (`apps/server/src/working-order.ts`).
- An extras pick is already its own CHILD line, and that line IS the record: the picked product's
  frozen name, its quantity, the price it sold at and its own VAT rate. Unlike the open order's child
  line it carries NO `product_id` — `sale_lines` has no such column. "How much bacon did we sell"
  therefore groups on the frozen name, the way the top-sellers report groups products.

**The frozen ANSWERS never reach the fiscal fingerprint. A line's AMOUNTS do.** Do not read the
first half as the second. What `backend.recordSale` is handed is the sale as a whole — its till,
node, sale and series ids, the series' own code, its invoice number, its issue time and offset, its
description, its `total`, its VAT breakdown (a list of one entry per VAT rate) and its counterparty
— and never the lines themselves, so the words a diner chose have no channel at all into
`computeHuella`'s input. The money is a different story, and the
channel is that breakdown, whichever of the two ways it was built. When the caller supplies none,
`recordSale` derives it from the lines (`input.vatBreakdown ?? buildVatBreakdown(input.lines)`,
`packages/core/src/record-sale.ts`), and `buildVatBreakdown` groups each line's `lineTotal` by its
`vatRate`; a correction and a substitution always take that path, calling `buildVatBreakdown`
unconditionally. When the caller supplies its own — which the till's filing routes do — it is filed
verbatim, but it too was grouped per rate over the priced lines a moment earlier
(`packages/catalogue/src/pricing.ts`). Either way an extras child line's base and its own VAT rate
reach the record's `CuotaTotal`, and `CuotaTotal` is one of the fields `computeHuella` hashes
(`packages/verifactu/src/huella.ts`).

One figure the fiscal backend does not derive: `ImporteTotal` is `sale.total` copied straight
through (`packages/fiscal-verifactu/src/backend.ts`), an explicit field of what the caller handed
in. So the same basket restructured into different lines can leave `ImporteTotal` exactly where it
was while `CuotaTotal` and the huella move. That is a fact about the BACKEND and not about the
system: every till filing route passes `total: priced.total` (`apps/server/src/till-sale.ts`), and
`priced.total` is the sum of every per-line gross (`priceRows`,
`packages/catalogue/src/pricing.ts`), so on a real sale a moved line AMOUNT does move
`ImporteTotal`. What it cannot see is a restructuring whose amounts still add up to the same
total.

That is measured rather than reasoned about. The gate is "the extras/options rework leaves the
fiscal fingerprint byte-identical" (`packages/fiscal-verifactu/src/write-path.e2e.test.ts`): one
basket — a dish carrying an options answer, plus a priced extra as its own child line — files the
same huella, `ImporteTotal` and `CuotaTotal` as that basket filed on `main` before this rework. The
same test also reads the filed line back and asserts the answers ARE on it, so the three figures
cannot match merely because nothing was written. And the block carries the control that was run for
it: with the child line's VAT rate moved from 10% to 21% and nothing else touched, `CuotaTotal` and
the huella both came back different while `ImporteTotal` did not move. That control is what shows
the fixture can see a moved VAT RATE at all. It says nothing about a moved line AMOUNT: the probe
left both `lineTotal`s exactly where they were. `ImporteTotal` held still there because that test
hands `recordSale` its own `total`, which a production sale does not — so what the third literal is
pinned against is the CALLER's declared total, not the basket.

The paper receipt prints one `<list>: <label>` line indented under its dish. Each side takes its
CUSTOMER text at the invoice locale and falls back to the staff name, never to the kitchen name —
`customerOptionSnapshotLabels` (`packages/catalogue/src/option-snapshot-labels.ts`), beside the
kitchen-facing `optionSnapshotLabels` the printed kitchen ticket uses.

## Storage

Seven tables carry the feature, all in the catalogue migration set, plus two columns in the core
set that hold what an order froze.

| Table or column | Set | What it holds |
| --- | --- | --- |
| `option_lists`, `option_labels` | catalogue | an options list and its labels |
| `extra_lists`, `extra_list_items` | catalogue | an extras list and the products it offers |
| `product_modifiers` | catalogue | a dish's one ordered attachment list |
| `menu_item_extra_lists`, `menu_item_extra_items` | catalogue | a menu offer's published extras and its per-product overrides |
| `working_order_lines.option_snapshots` | core | an open order line's frozen options answers |
| `sale_lines.option_snapshots` | core | a filed line's frozen options answers |

All seven catalogue tables are classified `state` in `CATALOGUE_CLASSIFICATION`
(`packages/catalogue/src/classification.ts`); none is append-only, so none carries a
`reject_mutation()` trigger. The app role reads, writes and removes rows and never owns or truncates
a table — the grants are in `packages/catalogue/drizzle/0001_catalogue_baseline_sql.sql`, and
`packages/fiscal-verifactu/src/privileges.expected.ts` pins them against the live catalog.

An extras pick's child line is the record on both sides: on an OPEN order it names the product it
is, and on a FILED sale it carries the frozen names with no `product_id` at all, because `sale_lines`
has no such column. That difference is deliberate and is what _On the filed sale_ above describes.

Nothing here takes an advisory lock and nothing asks a JSON containment question, so the SQLite
storage switch has nothing engine-specific to rewrite in this feature. That is a guard rather than a
convention: `scripts/catalogue-engine-neutral.test.ts` reads these files for
`pg_advisory_*_lock`, `@>` / `<@` and `pgEnum(`, and it reads them as TEXT, so it cannot tell code
from a comment and it only covers the files it names.
