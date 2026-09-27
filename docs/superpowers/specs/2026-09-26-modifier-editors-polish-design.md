# The Extras and Options editors — owner review fixes

Status: approved by the owner in conversation, 2026-09-26. Plan:
[2026-09-26-modifier-editors-polish.md](../plans/2026-09-26-modifier-editors-polish.md). Built by
campaign lane A, items A64–A67.

## 1. Why

The owner used the dashboard's Modifiers screen (`/manage/modifiers`, Extras and Options tabs) and
listed what got in the way. Some notes are layout, some are wording that says the wrong thing, and
one is a data rule. This spec turns each note into a decision; nothing here changes what a diner is
charged or what is filed.

The owner's notes, verbatim, grouped as given:

> Extras: put translated names into a descriptions collapsed box · do we want minimum choices, or
> just a Required toggle? · put min and max choices on one row, with +/- buttons · the drag and drop
> doesn't show the dragging taking place · in max quantity also have the +- buttons, and make the
> field narrower · vertical alignment of the product rows, currently up and down · replace Remove
> with a dustbin to take up less space · also make price narrower · in the header, make the Price
> column "Price per [unit]" (this header can extend over the remove column) · perhaps we need to make
> the modal wider · Status: In Use? What does that mean? Active? It hasn't been added to any products
> yet · in the product popup, there is item type: product/menu. is that going away?
>
> Options: Are we getting rid of item types: product|menu item? · it's not clear what the popup is
> telling you when you click on the name, it's also not clear that the name is clickable · names and
> kitchen names should be collapsed · the options list should be shown as text, not fields, with a
> kebab menu with delete and edit options, edit to open it in its own modal. · i think one should
> always be selected as the default, so remove Clear default · Add label -> Add option

## 2. Decisions

Each was put to the owner on 2026-09-26; the answer is recorded with it.

- **D1. Extras keep a minimum and a maximum number of choices.** A minimum above 1 is what lets a
  list say "choose 2 sides", which a Required switch cannot. Minimum 0 means optional; a blank
  maximum means no limit. No server change.
- **D2. "In use" was the list's on/off switch, not whether anything carries it.** The Status column
  reads **Active / Inactive**, and a new **Used by** column shows how many things carry the list.
- **D3. An options list belongs to products only.** The owner: "options belong to products, not to
  menu items." Checked: no table attaches an options list to a menu item, yet
  `optionListDependants` (`packages/catalogue/src/options.ts`) reports every menu that happens to
  include a carrying product as a "Menu item", so the same dish appears twice. The only consumer of
  that answer is the dashboard (traced: `apps/dashboard/src/api/client.ts`, the modifiers screen and
  their tests), so the server stops returning menus for an options list.
- **D4. An extras list can still be carried by one menu's own version of a product**
  (`menu_item_extra_lists`, kept by the menus plan's D5). Its popup keeps both kinds of row and
  names the menu. **The owner is not sure per-menu extras are worth the effort**; that question is
  recorded in `docs/backlog.md` for a separate decision and does not block this work.
- **D5. The standard modal gets wider, everywhere.** Not a per-screen size: the owner's rule is that
  a complaint about a shared component is fixed in the shared component. `--wt-modal-max-width`
  goes from `48rem` to `64rem`. `--wt-dialog-max-width` is written in terms of the modal token
  (`packages/ui-core/src/tokens/structure.css`), so it would widen every `wt-dialog` and
  `wt-help-tooltip` too; the dialog token is therefore given its own `48rem` and keeps today's
  width. (Not every `wt-dialog` is a confirmation: some add and edit forms, the ingredient form
  among them, are built in one and stay at 768px.)
- **D6. Row alignment means the text baselines line up**, not that cells are centred — "some cells
  are much taller than others". Checked by screenshot, not by reading CSS.
- **D7. The price column names each row's own unit.** Products in one list can be sold in different
  units, so the header reads **Price** (running over the bin column) and each row's price box shows
  its product's unit after it, as `wt-price-input` already does with its `unit` property.
- **D8. An options list with an available option always has a default.** The server, not only the
  form, holds this: where `parseOptionListInput` (`packages/catalogue/src/option-contract.ts`) today
  drops a default naming no available label to `null`, it instead picks the FIRST available label in
  list order. A list with no available label (possible only while it is inactive) keeps `null`. This
  is normalisation, not a refusal, so the demo seed (`apps/server/scripts/demo-seed/seed-option-lists.ts`),
  the menus test fixture and any other writer keep working without a new error code. A row copied
  in by configuration transfer is not re-parsed, so a stored `null` stays possible and every reader
  keeps coping with it as it does today.
- **D9. Editing one option opens the standard modal** (`wt-modal`), stacked over the list's modal.

## 3. What changes

### 3.1 Shared pieces

- **`wt-number-stepper`** — a new primitive in `packages/ui`: a − button, a narrow numeric input and
  a + button, with `min`, optional `max`, `value`, `label`, `name`, `error`, `disabled` and an
  `allow-blank` mode (blank is a value in its own right: "no limit"). − and + are real buttons with
  accessible names ("Decrease {label}", "Increase {label}") and are disabled at the bounds; typing
  still works. Pressing + on a blank value gives `min` (or 1 if `min` is 0; as built, never above
  `max`, and a step that changes nothing emits nothing — review of 2026-09-26); − never goes below
  `min`, so clearing the box is the only way back to blank. Emits `wt-change` with
  `detail: { value: string }`, following the custom-event rule (`bubbles`, `composed`, the inner
  event stopped). It needs the two tests CLAUDE.md §3 requires of a new primitive: a token-painting
  test and a sibling `*.a11y.test.ts` covering each state in both themes.
- **Icons**: `minus` and `bin` are added to the dashboard's icon set (`apps/dashboard/src/icons.ts`)
  beside the existing `plus`.
- **Modal width**: D5.
- **Drag feedback**: `ReorderController` (`apps/dashboard/src/widgets/reorder-table.ts`) marks the
  row being dragged while a pointer drag is in progress — raised background, a shadow, and a
  `grabbing` cursor on the page — and clears it on release or cancel. It is shared, so the product
  editor, the variants table and the member-list editor get it too. The keyboard path is unchanged.

### 3.2 The list tables (both tabs)

- Status column: **Active / Inactive** (D2), with its filter options renamed to match.
- New **Used by** column: "3 products · 1 menu" for extras, "3 products" for options, "Not used"
  when nothing carries the list; sortable by the total. The counts come back with the lists
  themselves from `listExtraLists` / `listOptionLists`, in one grouped query per call — never one
  request per row — so the live-query dependency lists in `apps/dashboard/src/api/live-queries.ts`
  gain the tables the counts read (`product_modifiers`, and `menu_item_extra_lists` for extras).
  _(2026-09-26: the shipped wording counts menu items, not menus: "3 products · 1 menu item", in
  Spanish "1 elemento del menú". See the A65 entry in [the backlog](../../backlog.md).)_
- The name is plain text. The **count** is the button that opens the popup, and looks like a link.
  The kebab keeps Edit and Delete.
- The popup is titled **Used by {list name}**. Options: products only, no Type column (D3). Extras:
  products and menu rows, a menu row reading "{product} — {menu name}", with the Type filter kept.
- The options delete warning stops counting menu items (D3).

### 3.3 The Extras editor

- The guest-facing translated names and the kitchen name move into one `wt-disclosure`, closed by
  default, whose `summary` says how many are filled in (design-system.md, "Fold a long form into
  collapsible sections with summaries"). `has-error` opens it when a field inside holds an error.
- **Minimum choices** and **Maximum choices** sit side by side on one row as `wt-number-stepper`s
  (maximum with `allow-blank`, placeholder "No limit"). The long labels lose their parenthetical
  explanations to a hint line.
- Product rows:
  - Baselines line up across the row (D6). The product name, the quantity stepper, the Preselected
    switch and the price box are measured by screenshot at 1280px and 390px wide.
  - **Max quantity** is a narrow `wt-number-stepper` with minimum 1.
  - **Price** is a narrow `wt-price-input` showing the product's unit (D7); blank still means
    "inherits the product's price", shown as the placeholder.
  - **Remove** becomes an icon-only bin button (`bin` icon, same accessible name as today).
  - The header's Price cell spans the price and bin columns.
- At 390px the table must not scroll sideways more than it does today; the plan measures it before
  and after.

### 3.4 The Options editor

- The list's translated names and kitchen name collapse into a `wt-disclosure`, as in 3.3.
- The option rows become read-only: drag handle, the option's name as text, a **Default** radio, an
  **Unavailable** lozenge (`wt-lozenge`) when the option is switched off, and a kebab
  (`wt-row-actions`) with **Edit** and **Delete**.
- **Edit** and **Add option** (renamed from "Add label") open one option editor in the standard
  modal (D9): name (required), the translated names and kitchen name in a collapsed disclosure, and
  an **Available** switch. Saving it updates the draft list; nothing is sent until the list itself
  is saved, exactly as today.
- **Clear default** goes. The form keeps a default whenever an option is available: the first
  available option becomes the default when the current one is removed or made unavailable, and a
  new list's first option is its default (D8, mirrored so the operator sees what the server will
  store).
- A server refusal naming one option's field (`labels.N.name` and siblings) is shown under that
  option's row and in the form's error summary; opening that option's editor shows it beside the
  field. The existing id-keyed mapping (`#formKey`) carries it.
- The same form is opened from the catalogue screen (`apps/dashboard/src/screens/catalogue-screen.ts`),
  which gets all of this without changes of its own.

## 4. Out of scope

- Whether per-menu extras stay at all (D4) — a backlog decision.
- The till's picker. D8 changes only what is stored; the till already preselects the stored default.
  _2026-09-27: since PR #719 the till is also served the first available option when the published
  default is switched off or absent (`effectiveDefaultLabelId` in `applyLiveFields` and
  `withUnavailable`)._
- An optional options list (still always required, `docs/backlog.md` → "What branch 1 deliberately
  did NOT build").

## 5. How it is checked

- Every change lands test-first. The screen and form suites are browser-mode suites in
  `apps/dashboard`; the server changes are tested in `packages/catalogue` against a real database
  (`useVenueDb`).
- **Every visual change is looked at**: screenshots in both themes, English and Spanish, at 1280px
  and at 390px (set with `page.viewport`, and the width read back from `window.innerWidth` —
  testing-guide.md, "A width you set with `commands.setViewportSize` is not a width the component
  rendered at"). Each PR states what was looked at and attaches or describes the screenshots.
- The modal width change is looked at on every screen that opens a `wt-modal`, not only this one.
