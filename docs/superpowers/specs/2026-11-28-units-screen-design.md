# The Units screen opens a unit, asks before deleting, and explains its words

Status: approved by the owner on 2026-11-28, from the mock-ups below. Backlog entry A1647.

## 1. Why

An Impeccable critique of the dashboard's Units screen on 2026-11-28 scored it 18 out of 40
(`.impeccable/critique/2026-11-28T15-21-38Z__apps-dashboard-src-screens-units-screen-ts.md` in the
main checkout, not committed). The reviewers ran the screen on the demo venue in a headless browser.
What they found:

- **A row click opens a window headed "Delete unit".** `rowClick` opens the in-use dialog and
  `rowClickLabel` names every row "Delete unit: …" (`apps/dashboard/src/screens/units-screen.ts`,
  the `wt-data-table` in `render`). On Kilogram it showed red "can't be deleted" text with a red,
  enabled Delete. On Gram it showed one sentence and a red Delete, one press from deleting a unit
  Waitron provides. The other table screens the reviewer checked (devices, modifiers, menus, roles,
  departments) open or edit the row.
- **Delete in the row menu deletes at once**, with no question (`#requestDelete` →
  `#deleteUnit`). That came in with #350 on 2026-09-13; the owner said on 2026-11-28 that it was
  not chosen knowingly.
- **A second unit with the same staff name is accepted**, leaving two identical "Kilogram / kg"
  rows.
- **Decimal places appear three ways**: 0–3 in the form, ".000" in the list, under the name
  "Precision". "Measure Yes/No" is unexplained, the six name fields are one undivided column, and
  the list shows the customer-facing name where the Products list shows the staff name (the demo's
  "Portion" is listed as "serving").
- **The data table's search box** (`.table-search` in `packages/ui/src/components/wt-data-table.ts`)
  draws its placeholder in the browser's default grey: measured 4.30:1 on light, 4.07:1 on dark,
  below 4.5:1. Field primitives colour theirs with `--wt-color-text-muted`
  (`packages/ui-core/src/field-styles.ts`); this box has no rule. Its focus shows only as a 1px
  border colour change.
- **At 390px wide, a focused column heading hides under the pinned Actions column**; the table
  does not scroll it into view (measured on the "Measure" heading).

## 2. Decisions (owner, 2026-11-28)

1. **Units stays a page of its own.** The owner asked where units would be edited without it;
   the product editor's Pricing unit window can only add one. Folding units into the product editor
   is not part of this work.
2. **A row click opens Edit unit.** The row menu holds **Edit**, **Products (n)** and **Delete**.
3. **Delete always asks first, through `wt-delete-dialog`**, like Courses. Nothing is deleted from
   the row menu without that window's Delete.
4. **The list shows the staff name**, as the Products list does, and gains a **Products** count.
5. **"Precision" becomes "Decimal places"**, shown the same way in the form and the list, with an
   example in the unit.
6. **"Measures a quantity (ml, g…) — no extras" becomes "Sold by weight or volume"**, and the list
   column "Measure" becomes **Weight or volume**.
7. **The edit form is grouped**: For staff, On receipts and the guest menu, Selling.
8. **A staff name another unit already has is refused.** Customer-facing names and abbreviations
   may repeat (two units both called "Glass" for diners, "Wine glass" and "Beer glass" for staff).
9. **The search placeholder and the phone focus are fixed in `wt-data-table`**, for every screen.

The owner approved the look from the frames below with "Yes, spec and queue it".

## 3. The frames

Rough HTML mock-ups, not the built screen. They are in
`~/waitron-campaign-shared/mockups/2026-11-28-units-screen/` (never committed):

| Frame | What it shows |
| --- | --- |
| `units-list.png` | The list: staff name, abbreviation, decimal places with example, weight or volume, products count |
| `units-list-menu.png` | The same with a row menu open: Edit, Products (15), Delete (the menu is drawn by the wrong row; it belongs to Kilogram) |
| `units-edit.png` | Edit unit for Kilogram, grouped |
| `units-del-refused.png` | Delete for Kilogram while 15 products use it |
| `units-del-ready.png` | Delete for Gram, which no product uses |
| `units-products.png` | Products sold in Kilogram |

The mock-up draws "2 (1.50 srv)" for two decimal places; §4.1's example number wins.

## 4. The screen, in words

### 4.1 The list

- **Description under the title:** "The units you sell by weight, volume or portion. A product
  without one is sold each."
- **Columns, in order:** **Name** (the staff name, sorted by default), **Abbreviation** (the staff
  abbreviation), **Decimal places**, **Weight or volume** (Yes or No), **Products**, then the pinned
  row-menu column (`actions`, `pinned: "end"`).
- **Decimal places cell:** the number, then an example in muted text in brackets, written with
  the dashboard language's decimal mark and the staff abbreviation: 0 → "250", 1 → "2.5",
  2 → "1.25", 3 → "1.250". So Kilogram reads "3 (1.250 kg)", or "3 (1,250 kg)" in Spanish.
- **Products cell:** a right-aligned count of the products that would stop a delete today: active,
  top-level products whose unit this is (`productsUsingUnit`, `packages/menu/src/units.ts`).
  Switched-off products are not counted; deleting the unit clears their unit, as now.
- **Search** matches the staff name, the staff abbreviation, and every language's name and
  abbreviation.
- **Row click** opens Edit unit. The row's accessible name is "Edit {staff name}".
- **Row menu:** Edit; **Products ({count})**, which opens §4.4; **Delete** in the danger colour,
  which opens §4.3. The menu must stay inside the page area at 1440px (today it overhangs about
  14px).
- At phone width the Weight or volume and Products columns may be hidden like today's Measure
  column; the column chooser still offers them.

### 4.2 Add unit and Edit unit

One `wt-modal`, the same form for both (`apps/dashboard/src/widgets/unit-form.ts`), used also by
the product editor's Pricing unit window. The Forms contract stands: required marks, inline errors,
one bottom message, Save quiet and disabled until the draft changes, Escape asks before discarding.

Three groups, each with a group label (small, bold, uppercase, muted) and one muted line under it:

1. **For staff** — "Shown on the till and the dashboard." Name and Abbreviation side by side,
   name wider; both required.
2. **On receipts and the guest menu** — "Leave a language empty to use the staff name." One row per
   enabled content language: the language's name at the start (Español, English), then Name and
   Abbreviation side by side. Empty fields keep today's fallback cue ("↳ Kilogram").
3. **Selling** — **Decimal places** (required), a combobox whose options read "0 — 250 kg",
   "1 — 2.5 kg", "2 — 1.25 kg", "3 — 1.250 kg" with the staff abbreviation as typed (no unit text
   while the abbreviation is empty). Then the switch **Sold by weight or volume**, with the line
   under it: "The till asks for the amount, such as 250 g, and the product takes no extras." The
   example's unit is the staff abbreviation when there is one, otherwise "g". The existing
   precision and measure usage warnings stay, under their controls, with "precision" reworded to
   "decimal places".

Opening Add unit puts focus on the first field (today it lands on the dialog).

The help-mode bubble on Decimal places is no longer needed once the options carry examples; remove
it.

### 4.3 Delete unit

`wt-delete-dialog` with `DeleteDialogCopy`, heading **Delete unit**, the unit's staff name in bold.
The impact comes from a new read, `GET /management-api/units/:id/delete-impact`, built like Courses'
(`readCourseDeleteImpact`, `apps/server/src/management-courses-routes.ts`).

- **While products use the unit:** one refusal, under the group heading **Can't be deleted yet**:
  "{count} products are sold in this unit. Move them to another unit, or to Each, first." (one
  product: "1 product is sold…"). Delete is quiet and disabled, as the component already draws a
  refused impact. A secondary footer button **Show products** closes this window and opens §4.4 for
  the same unit.
- **When none do:** "No products are sold in this unit. Deleting it can't be undone." Delete is
  danger and enabled.
- **After a successful delete** the dialog closes and the row is gone. No toast.
- The server keeps refusing `unit.in_use` at the write, for the case where a product took the unit
  after the window read its impact; that refusal shows in the dialog's `actionError`.

`wt-delete-dialog` has no secondary action today (only Retry uses the `secondary` slot). It gains
an optional one: a label in its copy and a `wt-delete-secondary` event (a `wt-*` event with
`detail: {}`, `bubbles` and `composed`). Its a11y test covers the new button in both themes.

### 4.4 Products sold in {unit}

Today's in-use window (`#openUnitProducts`), renamed and without its delete role:

- Heading **Products sold in {staff name}**; under it "{count} products. Select some and move them
  to another unit." or, with none, "No products are sold in this unit."
- No red text and no Delete button. Footer: **Close** only.
- The Select, search, "Move selected to…" and move button, and each product's Edit, work as
  today, including returning here after a product edit. The move button keeps today's quiet
  disabled state until products and a destination are chosen; its label becomes **Move**.
- The count in the list and in the row menu updates after a move.

### 4.5 Duplicate staff names

Creating or renaming a unit to a staff name another unit already has is refused, with a new error
code naming the field, shown under the Name field in For staff: "Another unit is already called
{name}." Names are compared after trimming spaces and ignoring letter case. The server refuses it
inside the write's transaction; the plan decides whether a unique index on a normalised column
backs it (the schema rules in `CLAUDE.md` §3 apply, and before go-live a schema change rebuilds the
set's starting migration). The product editor's Pricing unit window shows the same refusal, since
it uses the same form.

### 4.6 `wt-data-table`

- `.table-search::placeholder` reads `--wt-color-text-muted`, as field controls do, and passes
  4.5:1 on the search box's own fill in both themes.
- The search box gets the same 2px focus outline as the table's other controls.
- When a heading or cell receives focus under the pinned end column, the table scrolls it into
  view clear of that column.

Each lands with a test in `packages/ui` and, for the first two, a case in the table's a11y test.

## 5. Words

English as above. Spanish suggestions, for the translator to check against the guide:

| English | Spanish |
| --- | --- |
| Decimal places | Decimales |
| Weight or volume | Peso o volumen |
| Sold by weight or volume | Se vende por peso o volumen |
| For staff | Para el personal |
| On receipts and the guest menu | En los tiques y la carta |
| Selling | Venta |
| Products sold in {name} | Productos vendidos en {name} |
| Show products | Ver productos |
| Can't be deleted yet | Aún no se puede eliminar |
| Another unit is already called {name}. | Ya hay otra unidad llamada {name}. |

Spanish names **Each** two ways today, and both read like a unit: "Por unidad" in the Units
screen's move choice (`units.change_unit_each`) and "Unidad" in the product editor's Pricing unit
window (`editor.unit_each`). Choose one Spanish wording that says "no unit, sold one at a time"
(for example "Sin unidad") and use it in both places.

## 6. The guide

`apps/server/src/guide/en/products.md` and its Spanish twin: rename **Precision** to **Decimal
places** and the measure switch to **Sold by weight or volume** wherever they appear, and add a short
**Units** section with a shared `{#units}` id saying what a unit is for, that a row opens it, that a
unit in use is moved with **Products** before it can be deleted, and that Waitron provides
millilitres, litres, grams, kilograms and milligrams. Link it from the Units screen through the
dashboard's `help-guide.ts`.

## 7. Not in this work

- Folding units into the product editor (decision 1).
- Whether Waitron's own five units may be deleted: unchanged.
- A toast after saving or deleting: the house rule keeps saves quiet.
