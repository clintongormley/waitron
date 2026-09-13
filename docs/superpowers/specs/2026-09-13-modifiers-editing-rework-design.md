# Reworking how a manager edits a modifier

The manager's Modifiers screen and the modifier edit form get a visual and structural rework, and two
pieces of the modifier contract are simplified because the new form no longer needs them. This spec
covers the dashboard screen, the modifier form, the shared contract, the database, and the two till
surfaces that read what changes.

The wider modifier system — what a modifier is, how it is chosen at the till, how it is snapshotted
into an order — is described in `2026-09-12-product-modifiers-design.md`. Read that first. This spec
only changes how a manager edits one, plus the two contract simplifications that fall out of it.

## What the manager sees

Four visible changes, all on the dashboard.

**A round add button beside the heading.** The Modifiers list currently opens its "New modifier"
action from a three-dot menu at the top right. That menu goes. In its place, a round button sits
immediately to the right of the "Modifiers" heading: a blue disc with a white plus in the centre. It
is icon-only, so its accessible name comes from an `aria-label`, not visible text. Blue is the
primary colour token, so nothing is hardcoded.

**Extras and options edited as a table.** Inside the modifier edit form, the choices of an extras or
options modifier are today a stack of bordered blocks, each holding every field of one choice. They
become one table, one row per choice, with these columns:

| Drag handle | Name | Price (extras only) | Available | Default | Row menu |

- **Drag handle** — the first column. A grip icon the manager drags to reorder the choices. It is
  also a focusable button: with it focused, the Up and Down arrow keys move the row, so reordering
  works from the keyboard as well as by pointer.
- **Name** — the choice's name in the default content language, read-only in the table.
- **Price** — the choice's price delta, extras only, read-only in the table.
- **Available** — an inline switch. Switching a choice off clears any default or preselection it
  held, exactly as the current form does.
- **Default** — a radio for an options modifier (at most one choice is the default), or a checkbox
  for an extras modifier (any number of choices may be preselected). Disabled while the choice is
  unavailable.
- **Row menu** — a three-dot (kebab) `wt-row-actions` menu holding Edit and Remove. The current
  form's Move up / Move down / Remove buttons and the per-choice bordered block go away; the drag
  handle replaces the move buttons.

For an options modifier, the current "Default choice" dropdown below the choices is removed — the
per-row radio is now the only way to set the default. A "Clear default" ghost button appears below
the table only while some choice is the default, so the manager can return to "no default".

**Adding or editing a choice opens its own modal.** The table shows only Name, Price, Available and
Default. Every other field of a choice — the name in each content language, and for extras the
maximum quantity, the VAT class, and the allergen / dietary effects — lives in a second modal that
opens over the modifier modal. "Add choice" opens it empty; a row's Edit opens it on that row.
Saving the inner modal validates its own fields and writes the row back into the draft; nothing
reaches the server until the manager saves the modifier itself. The inner modal guards its close
event so dismissing it does not also close the modifier modal.

**Yes/No is just Yes and No.** A yes/no modifier no longer carries custom "yes" and "no" labels. Its
edit form keeps the modifier name, the Available switch, and the default (yes or no). At the till it
is shown as a single toggle switch labelled with the modifier name, rather than two radio buttons; on
the toggle, on means yes and off means no.

> **Superseded detail, 2026-09-13 (owner decision).** The lines below that have the till basket print
> "Yes" or "No" from its own translations no longer hold. A "yes" answer shows the modifier's name
> alone and a "no" answer, though still recorded, shows nothing — on the receipt, the kitchen ticket
> and the till basket alike. No "Yes"/"No" strings were added. See `docs/modifiers.md`.

## What changes in the contract

Two simplifications fall out of the form rework. Both are behavioural changes to a contract that six
packages share, so both retire receipts about the old shape.

**An extra is preselected, not defaulted to a quantity.** Today each extras choice carries a
`defaultQuantity` (0 up to its `maxQuantity`), and the till pre-fills that quantity. That is replaced
by a boolean `preselected`. A preselected extra is pre-filled with quantity 1 at the till, never
more. The cap rule changes with it: today the sum of default quantities may not exceed the modifier's
`maxTotalQuantity`; now the count of preselected choices may not exceed it.

**Yes/No drops its labels.** `yesLabel` and `noLabel` leave the modifier input, the stored record,
and the order snapshot. The snapshot keeps the boolean answer; the till's basket derives the words
"Yes" and "No" from its own translations rather than from a copied label.

### Types after the change

In `packages/shared/src/modifiers.ts`:

```ts
export interface ExtraChoice extends ModifierChoice {
  priceDelta: string;
  maxQuantity: number;
  preselected: boolean; // was: defaultQuantity: number
  vatClass?: "general" | "reduced" | "super_reduced" | "zero" | null;
}
// yes-no member becomes: { type: "yes-no"; defaultValue: boolean }
```

In `packages/shared/src/modifier-snapshots.ts`, the yes-no member becomes
`{ type: "yes-no"; value: boolean }` — the `label` field is removed.

### Database

In `option_groups`: drop `yes_label` and `no_label`. In `option_items`: drop `default_quantity`, add
`preselected boolean not null default false`. The change is drop-and-recreate in the generated
migration, per the repo's no-backwards-compatibility rule (nothing is in production). The migration
is produced by regenerating with drizzle, never hand-edited, and verified by running the catalogue
grant assertions and the immutability checks after it applies. The append-only classification and
grants of these tables are unchanged.

## Where the edits land

- **`packages/shared`** — the two type changes above.
- **`packages/catalogue`** — `modifiers.ts` (build/persist), `modifier-contract.ts` (parse and
  validate: `preselected` replaces the `defaultQuantity` bounds check; the cap check counts
  preselected choices; the yes-no branch drops the two labels), and the projection that reads rows
  back. Their tests move with them.
- **`packages/db`** — the schema and a regenerated migration.
- **`apps/server`** — the selection-to-snapshot step (`modifier-selection.ts`) drops the yes-no
  label; the demo seed (`demo-seed/seed-options.ts`) drops default quantities and custom labels.
  Confirm what the receipt and kitchen-ticket line builders do with the yes-no label, by running them
  rather than reading. (They did read it: before this change a receipt printed the modifier name and
  the chosen label, such as "Hielo: Sin hielo".)
- **`apps/till`** — `modifier-picker.ts` renders yes/no as a toggle and pre-fills quantity 1 for a
  preselected extra; `basket.ts` prints "Yes"/"No" from its own translations; the client types
  follow shared.
- **`apps/dashboard`** — the screen (round button), the modifier form (table, inner modal, radio /
  checkbox defaults, drag reorder), the client types, and the strings.

### The choices table

The table is built as semantic markup inside the modifier form, not by extending `wt-data-table`.
`wt-data-table` is a read-only sortable list; a reorderable, per-row-editable table is a different
thing, and column sorting is meaningless when row order is itself the data. Reusing it would fight
its sort model. The row menu reuses the `wt-row-actions` primitive; the drag handle needs a `grip`
(or similarly named) icon added to `apps/dashboard/src/icons.ts` alongside the existing `plus`. All
colour, spacing, radius and font in the table read `--wt-*` tokens, as every dashboard view must.

The round add button needs a `plus` icon in the dashboard icon set and a round, icon-only shape on
the shared button primitive. The primitive change carries its own two tests (token-painting and axe)
per the "new primitive state" rule.

### Reorder mechanics

Pointer events, not the browser's native drag-and-drop, so the handle works by touch on an iPad and
avoids the drag-image quirks. Dragging a handle reorders the draft's `choices` array; the array order
is the persisted order. Keyboard: with a handle focused, Up and Down arrows move the row and keep
focus on the moved handle. The existing move-up / move-down tests are rewritten as keyboard-reorder
tests, preserving the behavioural assertion that a choice can be moved and that the ends are bounded.

## Testing

Test-first throughout.

- **Contract** (`packages/catalogue`): a choice round-trips with `preselected`; the removed
  `defaultQuantity` and the two yes-no labels are gone; the cap check rejects more preselected
  choices than `maxTotalQuantity`; an unavailable choice cannot be preselected. Rejected writes
  assert the domain error code, not merely that an error was thrown.
- **Database** (real Postgres, `packages/catalogue` / `packages/db`): the regenerated migration
  applies from a virgin database, the grant assertions still hold, and the immutability checks pass.
- **Dashboard** (browser mode): the round button opens the new-modifier modal and carries an
  accessible name; choices render as a table; the row menu's Edit opens the inner modal on that row
  and Remove drops the row; the inner modal's own close does not close the modifier modal; a radio
  sets a single options default and a checkbox sets multiple extras preselections; an unavailable
  choice's default control is disabled and clearing availability clears the default; pointer drag and
  keyboard Up/Down both reorder. An axe test covers the new button shape and the table in both
  themes. The screen is opened in both themes at phone width and looked at, not only asserted as a
  string.
- **Till**: a yes/no modifier renders one toggle labelled with the modifier name and preserves an
  explicit "no"; a preselected extra pre-fills quantity 1; the basket shows "Yes" / "No" from its own
  translations.

## Acceptance

- The Modifiers list opens "New modifier" from a round blue plus button beside the heading, with an
  accessible name and no hardcoded colour.
- Extras and options are edited in a table with a drag handle, an availability switch, a radio
  (options) or checkbox (extras) default column, and a per-row Edit / Remove menu; the full per-choice
  fields open in a modal over the modifier modal.
- Choices reorder by pointer drag and by keyboard, and the order persists.
- An extras choice carries `preselected: boolean`; the till pre-fills quantity 1 for a preselected
  choice; the cap rejects more preselected than allowed.
- A yes/no modifier carries no custom labels, shows as a toggle at the till, and snapshots only its
  boolean answer.
- The generated migration applies from a virgin database with grants and immutability intact.
- CI is green on the current head.
