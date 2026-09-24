# One product model: extras, options and variants — design

**Status:** design approved by the owner in the brainstorm of 2026-09-18; branch 2 revised by the owner on 2026-09-23 (§15). Branch 1 landed (its
thirteen tasks, ending #480). Branch 2 landed (its nine tasks: Tasks 1 to 8 as #511, #517, #528,
#532, #537, #539, #545 and #551, and Task 9 on `feat/variants-cleanup`); its plan is
`docs/superpowers/plans/2026-09-23-variants-as-products.md` (2026-09-23), which records where the
code has moved since this spec was written and the decisions it takes where this spec is silent.
How variants work now is in `docs/developers/products.md`, under _Variants_.
**Date:** 2026-09-18
**Branches:** `feat/modifiers-extras-options` (branch 1), `feat/variants-as-products` (branch 2).

## What this changes, and why

Today the catalogue has three "named, priced things" that are each a slightly different re-telling of
the same idea:

- A **product** — the full model: three names (staff, customer, kitchen), a price, a VAT class,
  allergens (a manual overlay plus a recipe-derived floor), dietary declarations, a category, a unit,
  a kitchen station and course, and a photo.
- A **variant** (`product_variants` in `packages/catalogue/src/schema/variants.ts`) — a thin thing
  that owns only three names, a price, a photo and an availability flag, and inherits everything else
  from its product.
- A **modifier choice** (`option_group_items` in `packages/db/src/schema/catalogue.ts`) — for the
  `extras` kind, a priced addition with a single name, its own cut-down allergen list
  (`add_allergens`), its own dietary suitability, and a VAT class that can inherit the dish's rate.

A modifier choice that adds bacon to a burger *is* a thing the venue sells. It has a price, a VAT
rate, allergens, and one day a cost, a supplier and a stock count. Today it is a second, weaker
product model kept in parallel with the real one — one name where a product has three, a simplified
allergen picker, no photo, and invisible to every sales report because a filed extra line carries no
product identity. A variant is the same story told even more thinly. Two specs landed this month
(`docs/developers/modifiers.md`, the modifier-nutrition rework #377) already say "products can adopt
this widget later" — that sentence is the seam showing.

This design makes **one model**. There is one `products` table. "Extra", "ingredient" and (later)
"recipe component" are **roles a product plays by being referenced from somewhere**, not separate
kinds of thing with their own tables. A variant is a product with a parent. This removes the two
parallel models, makes a future inventory and purchasing model reference one table instead of three,
and makes recipes and bundles expressible as "a product made of products" without another rework.

It also settles a question the brainstorm surfaced: today's single "modifier" concept bundles two
genuinely different things — a money-and-stock thing (an extra, which becomes its own sale line) and a
kitchen-instruction thing (an option like doneness, which is only a note the kitchen reads). They
share almost nothing underneath, so they become **two features** (Extras and Options) that a product
composes through **one ordered list**, so the manager and the diner never see the split.

### Scope, in two branches

The two big pieces are independent, so they are two branches with one shared spec:

- **Branch 1 — `feat/modifiers-extras-options`.** Replaces the modifier model. Adds the
  `sold_alone` flag to products; builds Extras (lists of products) and Options (lists of labels);
  replaces the product's `modifierIds` with one ordered attachment list; removes the text modifier and
  the built-in doneness field; changes what an extra's child line stores. This branch does **not**
  touch variants.
- **Branch 2 — `feat/variants-as-products`.** Folds variants into products behind a `parent_id`
  self-reference with a field-level fallback rule; changes menu publication, the till's variant pick,
  the sale line's two-name split and the top-sellers report; removes `product_variants` and
  `menu_item_variants`.

### What this design deliberately does NOT build

- **The "is made of" components table** (recipes, bundles, set menus). The model is *ready* for it —
  ingredients are just products with `sold_alone = false`, and a bundle is a product made of sellable
  products — but nothing would read that table yet, so it is a later project. Recipe authoring was
  removed from the dashboard earlier (`docs/backlog.md`, the #377 era) and its return is an open
  product question; this design does not answer it, it only stops blocking it.
- **Per-variant modifier attachments.** A variant uses its parent's extras and options lists; there
  is no per-variant attachment row. (A variant offering different extras from its parent is a possible
  later addition, called out in §4.4, not built now.) Every *other* field a variant normally inherits —
  VAT, category, unit, routing, allergens, dietary declarations — *is* editable per variant on the
  variant's own product page (§4.4); that is built, a change from an earlier draft that deferred it.

## 0. Decisions taken with the owner (2026-09-18)

These were settled in the brainstorm before this spec was written. Where a decision changed a premise
from the conversation, that is called out so the reviewer can veto it.

1. **One product model.** One `products` table. "Extra" and "ingredient" are roles, not kinds. A
   product carries one flag, `sold_alone` (see §1), and plays a role by being referenced from an
   extras list, a menu, or (later) a recipe.

2. **A product can play any role at once.** The same product — a side of bacon, a bottle of wine —
   can be sold on its own from the till, offered as an extra on another dish (possibly repriced in
   that role), and be an ingredient later. This is why the model uses a `sold_alone` flag plus
   references, **not** a fixed "type" column that says a thing *is* an extra or *is* an ingredient.

3. **Modifiers split into two features.** Extras (a list of products, priced, becomes a sale line) and
   Options (a list of labels, a kitchen instruction, becomes a note on the line). They keep their own
   tables, validation, endpoints and editors, because the type-branching in today's
   `packages/catalogue/src/modifier-contract.ts` and `modifiers.ts` is where the two concepts fight.

4. **One ordered list on top of the two features.** A product has ONE ordered attachment list; each
   entry points at either an extras list or an options list. The manager's product editor and the
   till's one-at-a-time flow are unchanged by the split.

5. **The umbrella keeps the name "Modifiers".** The sidebar keeps one **Modifiers** entry; the page
   has two tabs, **Extras** and **Options**. The product editor keeps its **Modifiers** section. No
   new word is coined for the umbrella. (Changed from an earlier draft that called it "Asks".)

6. **The text modifier is dropped.** Every order line already carries a free-text `note`
   (`packages/db/src/schema/orders.ts`); the named text modifier duplicated it. There is no
   per-product free-text prompt.

7. **Options carry three names, at both levels.** An options list and each of its labels carry the
   same three names as a product — a plain staff name (required), a translated customer name
   (optional), and a plain kitchen name (optional) — because a receipt, a kitchen ticket and a future
   QR customer-order screen each read a different one. The chosen answers are frozen onto the line
   with all three names at both levels.

8. **Doneness becomes an options list.** The built-in `doneness` enum, its columns, its validation and
   its kitchen-ticket line are removed. This was already on the backlog ("doneness becomes a modifier
   the venue adds itself"). The demo seed adds a "Cooked" options list on the meat dishes.

9. **An extra's price falls back to the product's own; its VAT is always the product's own.** An
   extras list entry may carry a price for the product *in that role* (bacon is €3 as a side, €1.50 as
   an extra); blank means "use the product's own unit price". A menu offer may still override per
   offer, as it does today. An extra's VAT rate is always the product's own `vat_class`; the old
   "inherit the dish's rate" choice (`option_group_items.vat_class` NULL) is removed.

10. **Revised for branch 2 on 2026-09-23 — see §15.1, which withdraws this decision: a parent with variants is never sold itself.**
    The original text follows, for the record.
    **A parent product can be sold as itself as well as by variant.** "Coffee" at €1.50 is sellable,
    and "Large" at €2.00 is a variant of it — no need to invent a "Regular" variant. The `sold_alone`
    flag on the parent controls this: with it on, the till shows the parent plus its variants as
    choices including the plain one; with it off, the diner must pick a variant (today's rule, now
    driven by the flag rather than by "has any variants"). The refusal code stays
    `product.variant_required`.

11. **Filed sale lines stay snapshots, never catalogue references.** This is the standing decision at
    `packages/db/src/schema/sales.ts:191` ("Snapshotted values, never catalogue references,
    architecture §6"). An extra's child line on a *filed* sale carries the product's three frozen
    names, quantity, price and VAT — no `product_id`. "How much bacon did we sell" groups on the
    frozen name, exactly as the top-sellers report groups products. The **open-order** line
    (`working_order_lines`) does reference the catalogue, and its extra child line carries `product_id`
    in place of today's `option_group_item_id`.

12. **Branch 1 before the flip (if engine-neutral); branch 2 after.** Branch 1's new tables are
    written engine-neutral (see §7) so they ride through the SQLite flip's baseline regeneration like
    every other table. Branch 2 touches the variant-locales trigger (a PL/pgSQL body), so it waits for
    the flip to land, unless the flip is far off when branch 1 lands, in which case the sequencing is
    revisited.

## 1. The product model (branch 1 adds `sold_alone`; branch 2 adds `parent_id`)

`products` (`packages/db/src/schema/catalogue.ts`) gains two columns.

### 1.1 `sold_alone` (branch 1)

A boolean, `NOT NULL DEFAULT true`. It answers one question: does this product appear as a thing in
its own right — on a menu, and on the till's product grid? It is `false` for an ingredient, or a
topping that only ever rides on a dish, or a "Gluten-free bun" that is only ever a bread choice.

It changes nothing about *what a product is*: a product with `sold_alone = false` still has a price, a
VAT class, allergens, dietary declarations, a category, a unit and (optionally) a photo. It is a
full product; it just is not offered standalone.

Since Waitron is pre-production, existing rows get the default `true` and the seed is recreated; there
is no backfill (CLAUDE.md §3).

### 1.2 `parent_id` (branch 2)

**Revised for branch 2 on 2026-09-23 — see §15.2 (names are never inherited) and §15.3 (a variant's price may be blank and
then follows the parent's).**

A nullable self-reference, `parent_id → products(id)`. A row with a non-null `parent_id` **is** a
variant. The reading rule is one sentence:

> A null field on a variant reads as its parent's value.

- **Normally the variant's own:** `name`, `unit_price`, `image`, `active`, and (later, for inventory)
  barcode, cost and stock count.
- **Normally inherited (null on the variant, read from the parent):** `customer_name`, `kitchen_name`,
  `vat_class`, `category_id` and its category membership, `station_id`, `course_id`, `unit_id`,
  `allergens`/`manual_allergens`/`recipe_derivation`/diet derivation, `dietary_declarations`, and the
  modifier attachment list (§5).

A check constraint enforces **one level only**: a product whose `parent_id` is set may not itself be
named as any other product's parent. (Concretely: `parent_id` must reference a row whose own
`parent_id` is null. Enforced with a trigger or a check that reads the parent row; the exact
mechanism is a plan decision, engine-neutral either way.)

`product_variants` and `menu_item_variants` are **removed** in branch 2 (see §4 and §8).

## 2. Options (branch 1)

An **options list** is a reusable, named list of labels; the diner picks exactly one; the list names a
default. It owns nothing else — no price, no VAT, no stock, no allergens. It is a kitchen instruction,
saved as text on the dish's line.

### 2.1 Names

The list and each label carry the **same three names as a product**, resolved by the same fallback
that `packages/catalogue/src/product-presentation.ts` already owns:

- `name` — plain staff text, required.
- `customer_name` — translated (locale → text) map, optional; a blank entry falls back to `name`.
- `kitchen_name` — plain text, optional; blank falls back to `name`.

Example: a list "Cooked" / "How would you like it cooked?" / "Cook"; a label "Medium rare" /
`{ es: "Al punto", en: "Medium rare" }` / "MR".

### 2.2 Storage

Two tables, engine-neutral (§7):

- `option_lists` — `id`, `name`, `customer_name`, `kitchen_name`, `sort`, `active`.
- `option_labels` — `id`, `list_id` (FK, cascade), `name`, `customer_name`, `kitchen_name`,
  `available` (flag), `sort`. The default label is named by `option_lists.default_label_id`
  (nullable; a label of this list), mirroring today's `option_groups.default_choice_id`.

An options list requires exactly one pick, with the default preselected. (Today's `options` modifier
is always required with `min = max = 1`; this preserves that. An *optional* options list is a possible
future change and is called out in §11, not built now.)

A product attaches an options list through the shared attachment table in §5. **Menus do not publish
options lists** — a dish asks the same questions on every menu — so there is no per-menu options row.

### 2.3 On the order line

The chosen answers are frozen onto the dish line as a small JSON list, one entry per answered list,
each entry carrying the **list's three names and the chosen label's three names**:

```json
[
  {
    "listName": { "en": "Cooked" },
    "listCustomerName": { "en": "How cooked?", "es": "¿Punto?" },
    "listKitchenName": "Cook",
    "labelName": { "en": "Medium rare" },
    "labelCustomerName": { "en": "Medium rare", "es": "Al punto" },
    "labelKitchenName": "MR"
  }
]
```

Receipts read the customer names, kitchen tickets the kitchen names, the till and reports the staff
names. Customer text is stored under the venue's configured invoice locales, the way the product's own
`descriptions` is (§6). Nothing on the line points back at the list or label by id, so editing or
deleting a list never changes a saved order, and **there is no "in use by an open order" check for
options** — a delete only cascades the product attachments.

This replaces the `modifier_snapshots` JSON of type `text`/`options`
(`packages/shared/src/modifier-snapshots.ts`).

### 2.4 Doneness

Removed end to end: the `doneness` pgEnum and the `doneness` columns on `working_order_lines` and
`ticket_items` (`packages/db/src/schema/orders.ts`, `ticket-items.ts`), the `DONENESS` runtime tuple,
`working_order.invalid_doneness` and its validation in `apps/server/src/working-order.ts`, the
doneness line on kitchen tickets, and the meat-gated doneness `<select>` in
`apps/till/src/widgets/line-extras-editor.ts` and its callers. The demo seed adds a "Cooked" options
list attached to the meat dishes so the demo still asks how a steak is cooked.

## 3. Extras (branch 1)

An **extras list** is a reusable, named list of products the diner may add to a dish, with rules on
how many. "Choose your bread" is an extras list with `min = 1`, `max = 1`, every item priced at 0.

### 3.1 Storage

Two tables, engine-neutral (§7):

- `extra_lists` — `id`, `name` (three names, as §2.1), `min_picks` (total picks required; 0 = optional,
  1 = at least one), `max_picks` (total picks allowed; null = uncapped), `sort`, `active`. (Named
  `min_picks`/`max_picks`, not bare `min`/`max`, which collide with SQL function names; the plan may
  pick a different spelling but not the bare words.) **2026-09-19:** the spelling stands as a design
  choice, but that reason is wrong — `min` and `max` are legal column names. Measured on PGlite 0.5.8
  (PostgreSQL 18.3); the receipt is on `extraLists` in `packages/catalogue/src/schema/extras.ts`.
- `extra_list_items` — `id`, `list_id` (FK, cascade), `product_id` (FK to `products`, restrict),
  `sort`, `max_quantity` (per-dish cap for this product; `>= 1`, default 1), `preselected` (flag),
  `price` (money, **nullable**; null means "use the product's own `unit_price`").

The item row holds **nothing that duplicates the product**: its VAT rate, allergens, dietary labels,
photo and three names all come from the `products` row. The choice-level `add_allergens`,
`dietary_suitability`, `vat_class` and single `name` fields, and their choice-form widget, are
**removed**.

`min`/`max` carry the rules today's `option_groups` split across `min_select`, `max_select`,
`max_total_quantity` and `required`. `required` becomes `min >= 1`. The "exactly one" bread case is
`min = 1, max = 1`.

### 3.2 Per menu

A menu offer says which of a dish's extras lists it publishes and may narrow the items and reprice
them, replacing `menu_item_option_groups` / `menu_item_options` with the same shape keyed by product:

- `menu_item_extra_lists` — `menu_item_id`, `list_id`, `display_order`.
- `menu_item_extra_items` — `menu_item_id`, `list_id`, `product_id`, `price` (money, nullable),
  `available` (flag).

### 3.3 Price and VAT resolution

Price, in order: the menu's per-item `price` if set → the list item's `price` if set → the product's
`unit_price`. VAT is **always the product's own `vat_class`**; the "inherit the dish's rate" choice is
removed (decision 9).

In every editor a blank `price` follows the inheritance-hint pattern (§9.1): the field is empty, and
the price it would fall back to — the product's own `unit_price` in the extras list editor, the list
item's resolved price in the per-menu editor — is shown as the field's hint/placeholder text, so a
manager sees the effective price without a value being stored. Typing a value overrides it.

### 3.4 On the order and the sale

Each picked product becomes a **child line** of the dish, exactly as extras do today (see the
parent/child expansion in `apps/server/src/working-order.ts` and `packages/core/src/sale-line-rows.ts`):

- **Open order** (`working_order_lines`): the child line carries `product_id` (replacing today's
  `option_group_item_id`), the three frozen names, its own quantity (dish count × picks per dish), its
  resolved price and the product's VAT rate.
- **Filed sale** (`sale_lines`): the child line carries the three frozen names, quantity, price and
  VAT — and **no `product_id`** (decision 11; the standing architecture §6 rule). The parent line no
  longer needs an extras entry in a JSON snapshot: the child lines *are* the record.

Allergens and dietary information for an extra are **resolved live from the product** at display time
(the till basket, kitchen and expo screens), never stored on the line — the same posture the current
extras path has (`docs/developers/modifiers.md`, "resolved live from a saved choice's current
declarations").

### 3.5 Deleting

- Deleting an **extras list** cascades its product attachments (§5) and its menu rows (§3.2) and
  touches no order — an open order's child line points at the product, not the list.
- Deleting a **product** that an extras list names is refused with `product.in_use`, the same way a
  product on a menu is refused today; an open-order reference to that product also keeps refusing.

## 4. Variants as products (branch 2)

### 4.1 Which products get a till tile

**Revised for branch 2 on 2026-09-23 — see §15.4, which replaces this subsection.**

The till grid shows products that are `sold_alone` **and** have no parent. Tapping one opens the pick:
the product itself (if `sold_alone`), plus its published, available variants, each with its price.
A parent with `sold_alone = false` is today's rule exactly — the diner must pick a variant — and
`product.variant_required` is raised from that flag rather than from "has any variants".

### 4.2 Menus

**Revised for branch 2 on 2026-09-23 — see §15.5, which replaces how variants reach a menu.**

`menu_items` keeps one row per product; a variant is a product, so it gets its own `menu_items` row
(the `(menu_id, product_id)` uniqueness still holds — a variant has its own `product_id`). A variant's
row owns its price and availability; because `section_id` and `display_order` are `NOT NULL` columns on
the row, publishing a parent from the dashboard **creates each variant's row with the parent's
`section_id` and `display_order`**, so a variant is presented under its parent rather than as an
independent menu tile. A variant row whose parent is not on that menu is never shown.
`menu_item_variants` is removed.

### 4.3 The sale line

`product_id` on an open-order line is whichever row was chosen — parent or variant. The frozen names
keep today's split so nothing downstream moves (`packages/db/src/schema/sales.ts`,
`packages/db/src/schema/orders.ts`):

- `name` / `descriptions` / `kitchen_name` — the **parent's** three names.
- `variant_name` / `variant_descriptions` / `variant_kitchen_name` — the **variant's** three names,
  null when the parent itself was sold.

Receipts, kitchen tickets and the top-sellers report read exactly what they read now. The locale check
on the variant's customer text (the `working_order_lines_check_variant_locales` trigger,
`packages/db/drizzle/0031_variant_descriptions_locales_sql.sql`) stays, in whatever form the SQLite
flip gives triggers — the concrete reason branch 2 waits for the flip (decision 12).

### 4.4 Attachments and overrides

A variant is a product, so it has its **own product page**, and that page edits **any field**: the
ones a variant normally owns (three names, price, photo, availability) and the ones it normally
inherits (VAT, category, unit, kitchen station and course, allergens, dietary declarations). Following
the inheritance-hint pattern (§9.1), an inherited field is shown **empty with the parent's value as the
field's hint/placeholder text**: leaving it empty keeps the inheritance — the §1.2 fallback reads the
parent's value — and entering a value overrides it for this variant only. This is also how inventory
will later set a variant's own cost, barcode and stock.

The parent's product editor **also** has a quick variants section (§9) that edits only the common
fields inline — three names, price, photo, availability — without opening each variant's own page; the
full set of overrides lives on the variant's own page.

The **modifier attachment list (§5) is the one thing a variant does not override in this design**: a
variant always offers its parent's extras and options lists. A per-variant attachment is a possible
later addition (recorded in §14), not built now.

### 4.5 Removed

`product_variants`, `menu_item_variants`, `listProductVariantsForProducts`, and `selectMenuVariant`
in its current shape (`packages/catalogue/src/variants.ts`) — it becomes "resolve the chosen product
and its parent's names".

## 5. The product's modifier attachment (branch 1)

`product_modifiers` replaces `product_option_groups`:

- `product_id` (FK, cascade), `sort`, and **exactly one of** `extra_list_id` (FK to `extra_lists`) or
  `option_list_id` (FK to `option_lists`), enforced by a check constraint (`num_nonnulls(extra_list_id,
  option_list_id) = 1`, or the engine-neutral equivalent).

This is the one ordered list a product exposes (decision 4). The till walks it in `sort` order,
drawing the extras widget or the options radio group per entry.

## 6. Reporting (branch 2)

Today `packages/reporting/src/top-sellers.ts` groups on `name` **and** `variant_name`, so variants
rank as separate sellers and there is no parent total. With the two names kept in separate columns,
both views come from the same rows:

- **Split** (today's behaviour): group on `name` + `variant_name`.
- **Parent roll-up** (new): group on `name` alone.

Branch 2 presents parent rows with their variants nested underneath — the visible payoff for keeping
the two-name split. This is a report/presentation change; the filed data is unchanged.

"How much of an *extra* did we sell" is answerable from the extra's frozen `name` on its child sale
line (§3.4), grouping the same way; a dedicated extras report is a later follow-up, not this branch.

## 7. Engine neutrality — the SQLite switch is in flight

Slice 1 of the PostgreSQL→SQLite switch is in progress
(`docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md`); the column vocabulary has
rolled out to `packages/catalogue` (#397), the remaining prepare tasks are queued, and the flip
regenerates every migration set as one fresh baseline. New code in these branches must not carry
constructs the flip removes:

- **No advisory locks in new code.** `packages/catalogue/src/modifier-lock.ts` and the inline copies
  in `categories.ts` and `content-languages.ts` use `pg_advisory_xact_lock`, which the flip's single
  write queue makes redundant. If branch 1 needs serialisation before the flip lands, it takes it
  through **one shared helper** so the flip changes one body, not several. With extras as child lines
  carrying `product_id` and options copied as text, the modifier delete/"in use" checks no longer need
  the definitions lock at all — prefer removing it over reproducing it.
- **No JSON containment queries.** Today's `modifier_snapshots @> …::jsonb` (in
  `packages/catalogue/src/modifiers.ts`) asks "does an open order still use this modifier". Extras
  become a plain `product_id` column match; options orphan nothing on delete. The containment queries
  go away by construction.
- **No new enum type.** Enums become "text with a check constraint" after the flip; do not add a new
  pgEnum. `sold_alone`, `preselected` and `available` are booleans (`flag`), which the vocabulary
  already handles.
- **Use the shared column vocabulary** (`money()`, `id()`, `flag()`, `count()`, `json()`, `label()`
  from `@waitron/db`) for every new column, so the flip's cents/text conversions and the money task
  (P5) cover the new price columns for free.
- **Branch 2's variant-locales trigger** (§4.3) is a PL/pgSQL body; branch 2 waits for the flip so it
  is written once in the flip's trigger form.

## 8. What is deleted

**Branch 1:** `option_groups`, `option_group_items`, `product_option_groups`,
`menu_item_option_groups`, `menu_item_options`; the `doneness` enum and its columns (§2.4); the
`ModifierSnapshot` `text`/`options`/`extras` JSON shape (`packages/shared/src/modifier-snapshots.ts`,
replaced by the options snapshot of §2.3 and the extras child lines of §3.4); the text modifier;
`modifier-lock.ts`; the choice-form widget (`apps/dashboard/src/widgets/choice-form.ts`); the
choice-level allergen/diet/VAT/name fields; `docs/developers/modifiers.md` is rewritten in place
(kept, not split into two files — decision 5).

**Branch 2:** `product_variants`, `menu_item_variants`, `listProductVariantsForProducts`, the current
`selectMenuVariant` shape (§4.5).

Every table drops and recreates; no data migration (CLAUDE.md §3). Migration-number collisions on
rebase are fixed by regeneration, never by editing snapshots or the journal.

## 9. Dashboard surfaces

### 9.1 The inheritance-hint pattern

Several fields in these editors carry a value only to *override* an inherited default: an extra's price
(falls back to the product's price, §3.3) and a variant's inherited fields (fall back to the parent's,
§4.4). Every such field uses one pattern: the input is **empty when the field inherits**, and the value
it would fall back to is shown as the field's **hint/placeholder text** so the manager sees the
effective value without one being stored. Typing a value overrides the default; clearing the field
returns it to inheriting. This keeps "inherits" and "set to the same value as the parent" distinct in
the data — a blank stays blank — while the manager always sees the number that will apply.

### 9.2 Screens

- **Sidebar and screen (branch 1):** one **Modifiers** entry, one page, two tabs — **Extras** and
  **Options** — each the Categories-pattern table for its kind (header Add button, full-width search
  with filters, remembered sort in session storage, a detail modal with Edit/Close, a delete flow with
  a dependants preview). Extras and options delete flows differ only in what they preview: extras and
  options both preview products and menus (cascaded); neither previews an order count (options never
  touch an order; an extras list delete never blocks on an order — only a *product* delete does). An
  options list has no per-menu row (§2.2), so its menu preview is reached through the products that
  carry it, not from a publication table of its own.
- **Product editor (branch 1):** the section keeps its name, **Modifiers**. It is the one ordered list
  mixing extras and options lists (§5), adding from either, reordering, with the existing
  create-in-place flow for a new list. A product created from inside an extras list starts with
  `sold_alone = false`.
- **Products list (branch 1):** gains a `sold_alone` column and filter, so ingredients and
  extra-only products live in the same list rather than a separate screen.
- **Products list and editor (branch 2):** the list nests variants under their parent from `parent_id`
  (instead of the variants table). The parent editor's variants section edits the common fields inline —
  three names, price, photo, available. Each variant also opens its **own product page**, where every
  inherited field (VAT, category, unit, routing, allergens, dietary declarations) can be overridden,
  each shown with the parent's value as its hint (§4.4, §9.1). The one field not overridable per variant
  is the modifier attachment list (§4.4).
- **Media usage scan (branch 2):** reads one column, `products.image`, instead of two
  (`packages/media/src/images.ts`).

Every new or changed screen follows the shared UI contract (design-system.md → Forms): required
fields marked, per-field and summarised validation, semantic `name` attributes, `wt-*` primitives and
tokens only, cells styled with `part=`/`::part()` not CSS classes.

## 10. Till surfaces

The picker (`apps/till/src/widgets/modifier-picker.ts` and friends) walks a dish's modifier list in
order, drawing the extras widget (quantity steppers with prices, as today) or the options radio group
(default preselected). The per-line `note` stays; the built-in doneness `<select>` goes (§2.4).
Basket, kitchen ticket, expo and receipt read the extras child lines (as now) and the frozen option
names — kitchen name on tickets, customer name on receipts, staff name in the basket. Branch 2 changes
the variant pick as in §4.1.

## 11. API and error codes (branch 1)

- `GET/POST /management-api/modifiers/extras`, `.../modifiers/extras/:id` (GET/PATCH/DELETE) and the
  same under `.../modifiers/options` replace `/management-api/modifiers`.
- The product write body's `modifierIds` becomes an ordered `modifiers: [{ kind: "extras" |
  "options", id }]`.
- Orders send, per line, `extras: [{ listId, picks: [{ productId, quantity }] }]` and
  `options: [{ listId, labelId }]`, replacing `modifierSelections`.
- **Error codes** name the domain concept (conventions-data.md, "never renamed once shipped"):
  `modifier.*` stays the family for umbrella facts (`modifier.not_found`, `modifier.in_use`); a
  failure specific to one kind is named by that kind (`extras.limit_exceeded`, `options.label_required`,
  and so on). Each new code is registered in the catalogue `errors.ts` registry with English and
  Spanish alert wording (the `scripts/alert-codes.test.ts` guard). The retired `modifier.*` codes that
  are no longer thrown stay in the registry rather than being deleted (never-rename rule); nothing is
  renamed, so nothing needs a deprecation sibling.

**Open item:** an *optional* options list (pick zero or one) is not built — today's options are always
required with a default. If the deli needs one (e.g. an unforced "Any preference?"), it is a small
follow-up: an `min` of 0 on `option_lists` and a "none" affordance in the picker. Recorded here so a
future session does not assume it exists.

## 12. Testing

TDD throughout — the failing test first, watched failing for the right reason, then the minimal code
(CLAUDE.md §4). Behavioural assertions preserved when refactoring; fixtures give three *different*
texts for the three names so a surface reading the wrong name fails.

**Catalogue (branch 1):**
- Extras and options list CRUD; attachment ordering; the `product_modifiers` "exactly one of" check.
- Extras price resolution proven by a fixture with three *different* prices (menu → item → product).
- The `min`/`max`/`max_quantity` rules; the "exactly one" bread case; `preselected` seeding.
- Delete cascades (list → attachments, menu rows); `product.in_use` when an extras list names the
  product; no order check for an options-list delete.
- Grant assertions call `asAppUser(tx)` before the query (PGlite superuser trap); rejected writes
  assert the domain error code, not `toBeInstanceOf(Error)`.

**Order and sale (branch 1):**
- An extra's child line carries `product_id` on the open order and only frozen facts on the filed sale.
- An extra's VAT is the product's own — fixture: a 21% wine as an extra on a 10% dish.
- **The fiscal fingerprint is unchanged:** the shared alta fixture sale produces byte-identical
  `CuotaTotal`, `ImporteTotal` and huella before and after — the existing check, re-run against the new
  line shapes (CLAUDE.md §5, §4; the same gate slice 1 §5.3 inherits).
- Options answers freeze all six names; a held order and a quantity-only update preserve them.

**Reporting (branch 2):** parent roll-up and per-variant split from one fixture with three different
variant names and prices.

**Browser (both branches):** the Extras and Options tabs and the product editor's Modifiers section get
axe a11y tests in both themes; the till picker's two widget kinds; a rendered look at phone width in
both themes before the PR (the "open it and LOOK" rule — a string/`toMatchObject` assertion does not
prove a page renders).

**Guards run deliberately (both branches):** table classification
(`scripts/classification-complete.test.ts`), append-only enable-always where relevant, English-only
vocabulary, alert codes, live-subscription names, errors-reachable, `no-hardcoded-chrome`, module
seams, workspace cycles, and the `apps/server/src/modifier-selection.test.ts` "compare by values"
guard rewritten against the new selection shape. Prove a new guard by deletion and confirm a negative
control fails.

**Engine neutrality:** a check that new catalogue code adds no advisory lock, no JSON containment and
no new enum (§7) — a grep-style guard or a reviewer checklist item; the plan decides which.

## 13. The work, in order

One spec, two branches; each branch is its own plan.

**Branch 1 — `feat/modifiers-extras-options`** (before the flip, engine-neutral):
1. `sold_alone` on products; products-list column and filter.
2. Options: tables, contract, CRUD, endpoints, the line snapshot shape.
3. Extras: tables, contract, CRUD, endpoints, price/VAT resolution, per-menu rows.
4. `product_modifiers` attachment; product editor Modifiers section; remove `modifierIds`.
5. Order/sale path: extras child line carries `product_id` (open) / frozen only (filed); options
   snapshot; remove the old `modifier_snapshots` text/options shape.
6. Remove doneness end to end; add the "Cooked" options list to the demo seed.
7. Dashboard Extras/Options tabs; till picker; receipts/tickets/expo.
8. Remove `option_groups` family, text modifier, `modifier-lock.ts`, choice-form; rewrite
   `docs/developers/modifiers.md`.

**Branch 2 — `feat/variants-as-products`** (after the flip):
1. `parent_id` and the fallback rule; one-level check.
2. Menu publication per product row; remove `menu_item_variants`.
3. Sale-line two-name split from parent/variant; the variant-locales trigger in the flip's form.
4. Reporting: parent roll-up + split.
5. Dashboard nesting and inline variant editing; media scan on one column.
6. Remove `product_variants` and the old `selectMenuVariant` shape.

Each branch is a fiscal-adjacent, migration-carrying change and takes the full review ceremony (the
fresh-context plan-vs-spec read and the Codex run-it seat on every branch; the simplify lenses and
per-task reviews because it touches fiscal invariants and a cross-package contract).

## 14. Risks and open items

- **The fiscal fingerprint.** Every order/sale line shape change is gated by the byte-identical
  huella check (§12). This is the one unrecoverable risk and it is the first test written on the
  order/sale task.
- **Sequencing against the flip.** Branch 1 is engine-neutral by §7 and rides the flip's baseline
  regeneration. Branch 2 waits for the flip. If branch 1 lands long before the flip, re-check that no
  §7 construct crept in; if the flip lands first, branch 1's tables regenerate with everything else.
- **Optional options list** — not built (§11), recorded so it is not assumed.
- **The components table (recipes/bundles)** — not built; the model is ready for it (§0, "does NOT
  build").
- **Per-variant modifier attachments** — not built (§4.4): a variant offers its parent's extras and
  options lists. Recorded so a future session does not assume a variant can carry its own.
- **`docs/backlog.md`** is updated in the same change that lands each branch (the moment it goes stale
  is a merge), and the modifier/variant entries in it are reconciled against what these branches ship.

## 15. Branch 2 revisions (owner, 2026-09-23)

Agreed with the owner on 2026-09-23, one decision at a time, while reviewing the branch-2 plan
(`docs/superpowers/plans/2026-09-23-variants-as-products.md`). Where this section and an earlier
one disagree, **this section wins**; the earlier text is kept, with a pointer, as the record of what
was first decided. Branch 1 is unaffected.

### 15.1 A parent with variants is never sold itself

Decision 10 is withdrawn. A product with at least one **Active** variant (§15.6) cannot be rung up
as itself: it holds what its variants share and is the one button on the till, and choosing it
means choosing one of its variants. Example: "Wine by the glass" is the parent; "Wine 125" and
"Wine 175" are what is sold. A product with no Active variants sells as itself, exactly as a product
does today. There is no "Regular" variant, stored or displayed: the manager adds every variant
themselves, starting with the first. A product with exactly one variant is allowed.

`product.variant_required` stays, and is raised when a product with an Active variant is rung up
without one. `sold_alone` no longer has anything to do with variants (§15.4).

### 15.2 A variant has its own full name, and its names are never inherited

A variant is named in full ("Wine 125"), not as a suffix of its parent's name. Receipts, kitchen
tickets, the till basket and the staff name in reports show the variant's own name alone; the
" · " join of parent and variant names (`packages/catalogue/src/product-presentation.ts`) is no
longer used for a variant line. The sale line still records BOTH names in their separate columns
(§4.3 — `name` the parent's, `variant_name` the variant's), so a report can group by parent (§6).

Because the variant's name is what is printed, **a variant's three names are never inherited**: a
blank customer name or kitchen name falls back to the **variant's own** staff name, the rule every
product already follows, never to the parent's names. Every other field in §1.2's inherited list —
VAT, category and membership, unit, station, course, allergens and diet, dietary declarations,
description, and photo — still reads the parent's value when the variant leaves it blank. Two blanks
cannot be told from "none": a variant cannot be in no category, or have no unit, while its parent
has one.

### 15.3 Prices

- **The parent's price is the base price.** A variant whose own price is blank sells at it; so a
  variant's price becomes optional, while a product with no parent still needs one.
- **Every stored price is a full price**, never a difference, at every level. Changing the base
  price moves only the variants whose price is blank.
- **On a menu, the most specific price that is set wins**, in this order: the variant's price on
  that menu; the variant's own price; the parent's price on that menu; the parent's own price.
- **Every price field shows, as its hint, the price it would fall back to** (§9.1) — in the product
  editor and on every menu.
- Where variants are listed with prices — the till's variant picker now, a customer menu later — a
  variant whose price differs from its parent's price on that menu may be labelled with the
  difference ("+€1.50"). The label is computed for display; nothing stores it.

### 15.4 Which products get a till button

Every Active, Available (§15.6), top-level product offered on the menu gets a till button,
**including one with `sold_alone = false`**, so staff can ring up an extra such as bacon on its own.
`sold_alone` now governs only a future customer-facing menu, where such products are not listed on
their own. A variant never has a button of its own. Tapping a parent that has variants opens its
variants with the **first available one preselected**; a parent whose variants are all unavailable
on that menu has nothing to sell and gets no button.

### 15.5 Variants follow their parent onto every menu

Putting a parent on a menu offers **every Active variant of it** there, at its price by §15.3,
automatically — including a variant added to the catalogue later. The menu stores something for a
variant only when the manager overrides its price there, or switches it off for that menu; without
such a setting there is nothing stored. The menu screen lists the parent's variants so either can be
set. A variant is presented under its parent, in ONE order set in the product editor and used
everywhere (the till picker, every menu); per-menu variant ordering is not kept.

### 15.6 Two states: Active, and Available

Today one switch does two jobs: the product editor labels it *Available* and the products list shows
it as *Active / Inactive*, and "delete" sets it off. It becomes two, for products and variants alike:

- **Active / Inactive** — whether the item exists for the venue. Deleting a product or removing a
  variant makes it **Inactive**; it is hidden behind a status filter on the products list and in the
  product editor's variant section, and making it Active again restores it. Removing is always
  allowed, whatever refers to the item, because nothing is deleted.
- **Available / Unavailable** — sold out for now. It toggles freely and never hides the item from
  the dashboard.

The till offers an item only when it is both Active and Available, as it offers only an Active one
today.

### 15.7 What this does not change

The parent of a variant is fixed when the variant is created and is in the same catalogue. A variant
offers its parent's extras and options lists (§4.4). The filed sale line carries frozen names and no
catalogue reference (decision 11), and the fiscal fingerprint is unchanged.

## Provenance

- The brainstorm of 2026-09-18 (this conversation), which settled every decision in §0.
- Current state read on 2026-09-18 from: `packages/db/src/schema/catalogue.ts`,
  `packages/catalogue/src/schema/{menu,variants}.ts`, `packages/catalogue/src/{modifiers,
  modifier-contract,modifier-projection,modifier-lock,variants,product-types}.ts`,
  `packages/shared/src/{modifiers,modifier-snapshots}.ts`, `packages/db/src/schema/{orders,sales}.ts`,
  `packages/core/src/sale-line-rows.ts`, `apps/server/src/working-order.ts`,
  `packages/reporting/src/top-sellers.ts`, `docs/developers/modifiers.md`.
- The SQLite switch: `docs/superpowers/specs/2026-09-16-sqlite-slice1-storage-swap-design.md` and its
  plan, `docs/superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md`, and
  `docs/backlog.md`'s SQLite status entry.
