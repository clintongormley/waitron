# Integrating modifier authoring and selections

Use the reusable definition for configuration and explicit selections for each order. The canonical
`Modifier`, `ModifierInput`, `ModifierSelection` and `ModifierSnapshot` types are exported from
`@waitron/shared`. Catalogue validates definitions and selections through `modifier-contract.ts`;
`modifiers.ts` owns transactional writes. Browser clients keep their local wire types.

## Authoring

`GET /management-api/modifiers` returns `{ modifiers: Modifier[] }`.
`POST /management-api/modifiers`, `GET /management-api/modifiers/:id` and
`PATCH /management-api/modifiers/:id` return `{ modifier: Modifier }`. POST returns 201; PATCH takes
the complete definition input. DELETE returns `{ ok: true }`. Choices have UUIDs supplied by the
editor, so an options default can name a newly added choice before its first save.

A modifier's `type` is one of `text`, `extras` or `options`. There is no `yes-no` type; the contract
(`parseModifierInput` in `packages/catalogue/src/modifier-contract.ts`) rejects any other value with
`modifier.invalid`. Every modifier is always offered as a whole — there is no modifier-level
availability, only a per-choice `available` flag.

For a venue whose default content language is English:

```http
POST /management-api/modifiers
Content-Type: application/json

{
  "type": "options",
  "name": { "en": "Bread" },
  "defaultChoiceId": null,
  "choices": [
    { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": { "en": "White" }, "available": true },
    { "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": { "en": "Gluten-free" }, "available": true,
      "suitableFor": ["vegan", "vegetarian"] }
  ]
}
```

The response includes the normalized definition:

```json
{
  "modifier": {
    "id": "11111111-1111-4111-8111-111111111111",
    "type": "options",
    "name": { "en": "Bread" },
    "available": true,
    "defaultChoiceId": null,
    "choices": [
      { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": { "en": "White" }, "available": true },
      { "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": { "en": "Gluten-free" }, "available": true,
        "suitableFor": ["vegan", "vegetarian"] }
    ]
  }
}
```

Product POST/PATCH no longer carries `modifierIds` or `optionGroupIds` (2026-09-19). A body sending
either is refused, naming that field. What it carries instead is one ordered `modifiers` list, each
entry `{ "kind": "extras" | "options", "id": "<list id>" }`, written to `product_modifiers`; product
lists and the editor read return the same shape, in the same order. Attaching an option GROUP has no
request body at all any more — the group/item endpoints still exist and still read
`option_groups`/`option_group_items`, and they go with those tables when the old model is removed.
The old group cap maps into `maxTotalQuantity`.

`dashboard-modifier-form` in `apps/dashboard/src/widgets/modifier-form.ts` accepts `open`, `busy`,
`locales: string[]`, `value: Modifier | null` and `fieldErrors: Record<string, string>`. It emits
`wt-submit` with `{ value: ModifierInput }` and `wt-cancel` with `{}`. The screen owns the API call
and closes the editor after a successful write. A choice-level validation error — the form's own
check, or a `choices.<index>.<field>` rejection from the server — is shown as one message under the
choices table naming the choice by its current label, so a rejection never lands on a field the
manager cannot see. Every error is also listed in the form's `wt-form-error-summary`, including a
server refusal that names no field (such as `modifier.in_use`) or a field the form does not draw
an input for (such as `defaultChoiceId`, or a name in a language the form does not show), which
appears only there. The
screen's reads use the existing option-group, item and content-language live sources.

One choice is edited in `dashboard-choice-form` (`apps/dashboard/src/widgets/choice-form.ts`), a
modal inside the modifier form. It accepts `open`, `busy`, `locales`, `kind: "extras" | "options"`,
`value: ChoiceDraft | null`, validates its own fields against the server's price and quantity
limits (`packages/catalogue/src/modifier-limits.ts`), lists what is wrong in its own error summary,
and emits `wt-choice-save` with `{ value: ChoiceDraft }` or `wt-choice-cancel` with `{}`. Nothing reaches the
server until the modifier itself is saved.

Products can compose the modifier form directly and select the saved definition. A choice carries two
optional nutrition fields, plus `vatClass` on an extra for tax inheritance:

- `addAllergens` — the allergens the choice contains. A map keyed by allergen code whose value records
  `{ presence: "contains" }`; the modifier choice UI records only `contains` and offers no
  presence or source field. This is a single "contains" list: there is no "removes" list, and the old
  `removeAllergens`/`addOrigins`/`removeOrigins` fields are gone.
- `suitableFor` — a positive dietary list over exactly four labels, `vegan`, `vegetarian`, `halal`,
  `kosher` (stored in the `dietary_suitability` column, validated by `validateDietarySuitability` in
  `packages/catalogue/src/dietary-declarations.ts`; anything else is `diet.declaration_invalid`). It
  replaces the old negative `dietaryEffect = { invalidates: [...] }` model — a choice states what it
  is suitable for, never what it invalidates.

The choice form renders both through the shared `dashboard-allergen-dietary-picker` widget
(`apps/dashboard/src/widgets/allergen-dietary-picker.ts`): one allergen multi-select under
"Nutritional information" and a four-item checklist under "Dietary preferences". Products can adopt
the same widget during integration.

## Ordering and stored facts

This section describes the order path as it stands after the extras-and-options change
(2026-09-20). The `modifierSelections` body it used to document is gone: `grep -rn
modifierSelections apps/server/src` finds nothing, and the old contract that parsed it
(`validateModifierSelections`, `packages/catalogue/src/modifier-contract.ts`) has no production
caller left.

A requested line now carries two optional fields, `options` and `extras`. Five routes take them,
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

Reading them back, four wire types carry `optionSnapshots` — the field these four called
`modifierSnapshots` before this change: `TabLine`, `HeldOrder.lines`, `StationQueueItem` and
`ExpoItem`, all declared in `apps/server/src/working-order.ts`. A held order's lines also carry an
`extras` array holding what each CHILD line froze. Those are VALUES, not a re-sendable selection:
the child line holds no list id to name.

A quantity-only edit of a held order sends the same answers with a new quantity. `updateHeldOrder`
rebuilds what those answers would freeze NOW and compares the result with what the stored line
holds, by value; equal, the line and its locked price are kept, otherwise the line is replaced and
re-priced.

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

An OPTIONS list RENAMED between the two sends does make the two sides differ, and the line is
replaced and re-priced. That is a decision, not an omission: an options answer freezes six names and
no ids, so the wording is the only evidence the line carries about what was chosen, and a rename
cannot be told from a different answer. Giving the comparison an id to use would mean putting one on
the line, which §2.3 of the design rules out. Pinned by "re-prices a held line when the options list
it answered was renamed between the two sends" (`apps/server/src/working-order.test.ts`). An EXTRAS
list is different: its children are compared by the picked product's id, so renaming the list — or
the product — disturbs nothing and the line is preserved.

The till has not moved onto this wire yet: `apps/till` still builds and reads the old
`modifierSelections`/`modifierSnapshots` shapes, which is a task of its own — its mirror of the
settled ticket included. The gap, and which till files it touches, is in `docs/backlog.md`.

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

None of this reaches the fiscal fingerprint. `backend.recordSale` is handed `total` and
`vatBreakdown`, never the individual lines, so a line's frozen answers have no channel into
`computeHuella`'s input. That is asserted rather than assumed: the same basket filed before and
after this rework produces a byte-identical huella, `ImporteTotal` and `CuotaTotal`, against values
recorded from `main` before the change — "the extras/options rework leaves the fiscal fingerprint
byte-identical" in `packages/fiscal-verifactu/src/write-path.e2e.test.ts`, which also records what a
wrong answer prints.

The paper receipt prints one `<list>: <label>` line indented under its dish. Each side takes its
CUSTOMER text at the invoice locale and falls back to the staff name, never to the kitchen name —
`customerOptionSnapshotLabels` (`apps/server/src/option-snapshot-labels.ts`), beside the
kitchen-facing `optionSnapshotLabels` the printed kitchen ticket uses.

## Storage and integration order

Generated core migration `packages/db/drizzle/0021_product_modifiers.sql` extends the existing
group/item definitions and adds JSONB snapshots to working and sale lines. It creates NO table of
that name, despite the file name — beware the twin: `packages/catalogue/drizzle/0010_product_modifiers.sql`
is a different migration in a different set, and it is the one that creates the `product_modifiers`
table. Everything in THIS SECTION is about the OLD `option_groups`/`option_group_items` model and
its `product_option_groups` attachment table, not that new one; the authoring section above already
describes the new `modifiers` body field. No new tables or core-to-catalogue
foreign keys are added here. The catalogue generation script reports no schema change. Existing
table grants, classification and configuration-transfer ordering apply; the group/item definition,
`product_option_groups` attachment and `menu_item_option_groups` publication operations share one
transaction-scoped advisory lock, keyed on the constant `"modifier-definitions"`
(`packages/catalogue/src/modifier-lock.ts`). The new `product_modifiers` write takes no advisory
lock at all — `writeProductModifiers` (`packages/catalogue/src/product-modifiers.ts`) takes a
`for key share` ROW lock on each list it names instead, which that file explains.

Selections take that lock in shared mode so definition readers can coexist. Canonical and retained
group/item writers take it exclusively before reading or changing definitions. The retained
`updateOptionGroup` and `updateOptionGroupItem` operations take `(tx, id, patch)` — the tenant
argument and the tenant predicate on their by-ID reads and writes went with the column
(2026-09-14).

Regenerate generated migration collisions against the integration base rather than editing the
journal or snapshots. No backfill or shared development database reset is included. Products still
owns removal of the combined editor and final composition with Units and Categories.
Existing pre-migration rows do not acquire canonical caps from their old `max_select` values;
recreate disposable pre-production catalogue data under the approved schema/reset convention.
