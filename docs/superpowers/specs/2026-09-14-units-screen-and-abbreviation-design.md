# Units: an abbreviation, and a units screen that matches categories

**Status:** design, awaiting owner review
**Date:** 2026-09-14
**Worktree/branch:** `waitron-units-overhaul` / `units-overhaul`

## Why

Two things, from the owner, while using the units screen:

1. A unit today has one translated text — its `name` — and that single text does double duty: it
   labels the unit in the dashboard *and* it is the string frozen onto every sold line and printed
   on receipts, kitchen tickets and the till. That forces a compromise: the seeded units are named
   with their short forms (`kg`, `ml`, `l`) so receipts stay short, which reads badly in a
   management screen. A unit should carry **both** a full name (`Kilogram`) and a short
   **abbreviation** (`kg`), each translatable, and each read where it belongs: the full name in the
   dashboard, the abbreviation everywhere a quantity is shown.

2. The units screen predates the shared table conventions the categories screen now follows. It has
   a hand-built toolbar with the search box and an inline create button, no table search, no column
   filter, no remembered sort. It should match the categories screen: an **Add unit** button at the
   header level on the right, a full-width table search bar with a column filter, left-aligned row
   actions, and a sort/filter that the tab remembers between visits.

## Scope

In:

- Add `abbreviation` (translated JSON, like `name`) to the `units` table and every layer that
  reads or writes a unit.
- Freeze the **abbreviation** — not the name — onto a sold line, so receipts, kitchen tickets, the
  expo screen and the station queue print the short form.
- The till's on-screen unit label reads the abbreviation.
- The dashboard product editor's unit dropdown shows `Name (abbr)`.
- Rebuild the units screen to the categories-screen pattern; add the abbreviation field to the unit
  form.

Out:

- No `hardware_unit` change. That column (`kg`/`g`/`mg`) is the scale-hardware mapping, resolved
  from stored data and never inferred from editable text; it is unrelated to the display
  abbreviation and stays exactly as it is.
- No change to the fiscal hash. The frozen unit label is presentation metadata on `sale_lines`; it
  is not one of the AEAT-hashed fields (see "Fiscal neutrality" below). This work does not touch
  `computeHuella`, the chain, or the filed record's hashed content.
- No data-migration or backwards-compatibility code. Pre-production: schema changes drop and
  recreate (`CLAUDE.md` §3, §5).

## Fiscal neutrality — the claim this design rests on

The column frozen at add-time is `working_order_lines.unit_name` (JSON), copied to
`sale_lines.unit_name` when the sale is filed. It is read only for display: `receipt-ticket.ts`,
`kitchen-print.ts`, the till's `till-expo-screen.ts`, `till-ticket-view.ts` and
`station-queue.ts`. **Checked (grep, not yet run):** `grep -rn "unitName\|unit_name"
packages/verifactu/src packages/fiscal-verifactu/src` returns nothing — the huella is built by
`packages/verifactu/src/huella.ts` from the AEAT-specified fields in `format.ts`, and the unit
label is not among them.

**The implementer must confirm this by running, not reading** (`CLAUDE.md` §1: reading is not
verification): the verifactu conformance vectors (`packages/verifactu/src/conformance.test.ts`)
must stay green with the abbreviation change in place, and a fiscal-record test must show that two
lines differing only in `unit_name` produce the same huella. If either shows the label reaching the
hash, stop — freezing a different string there would be a fiscal change, and this design would be
wrong.

Because the value is presentation-only, the column keeps its name `unit_name`. Renaming it to
`unit_label` would be a `core` migration-set change, and it would collide a second time with the
`feat/drop-tenant-id` branch (see Coordination). Instead, a one-line comment on the column and its
carrier types states what it now holds: the printed unit label, which is the unit's abbreviation
frozen at add-time.

## Data model

`packages/catalogue/src/schema/units.ts`, `units` table: add

```
abbreviation: jsonb("abbreviation").$type<Record<string, string>>().notNull(),
```

beside `name`. Same shape, same not-null. No new constraint (translation validity is enforced in
code against the tenant's content languages, exactly as `name` is).

This regenerates the catalogue drizzle migration for the `units` table. Per `CLAUDE.md` §3, the
migration is **generated, never hand-written**, and a rebase collision is fixed by regeneration.
Because module sets other than `core` are virgin-DB-only, regenerating the catalogue baseline is
legitimate; do not add an ALTER-to-preserve step.

### Seeded units

`packages/catalogue/src/provisioning.ts` `UNIT_NAMES` today seeds six units whose names ARE the
short forms. Each gains a full name; the current short form moves to `abbreviation`:

| seed_key | name (en / es) | abbreviation (en / es) | hardware_unit |
| --- | --- | --- | --- |
| each | Each / Unidad | ea / ud | null |
| g | Gram / Gramo | g / g | g |
| kg | Kilogram / Kilogramo | kg / kg | kg |
| mg | Milligram / Miligramo | mg / mg | mg |
| ml | Millilitre / Mililitro | ml / ml | null |
| l | Litre / Litro | l / l | null |

**Owner-confirm needed:** the Catalan (`ca`), Galician (`gl`) and Basque (`eu`) full names, and the
`each` abbreviation (`ea`/`ud` is a guess — "each"/"unidad" has no standard short form). The
implementer drafts these and flags them; the owner corrects them before land.

The two **test** seeders — `apps/server/src/testing/seed-units.ts` and
`packages/catalogue/test/fixtures.ts` — seed only the two legacy `each`/`kg` stubs and gain
`abbreviation` too (a bare `abbreviation` matching today's short-form name is fine there).

## Server / catalogue

- `packages/catalogue/src/units.ts`: `Unit`, `CreateUnitInput`, `UpdateUnitInput` gain
  `abbreviation`. `UNIT_COLUMNS` and `SELLABLE_UNIT_COLUMNS` select it. `createUnit` and
  `updateUnit` validate the abbreviation's translations with `validateContentTranslations` (the same
  call already made for `name`) so it is required in the default language and its non-default
  entries are validated.
- `SellableUnit` and the `UnitSnapshot` in `packages/catalogue/src/pricing.ts` gain `abbreviation`.
  `sellableUnit(...)` in `packages/catalogue/src/operations.ts` carries it through from the selected
  row.
- **The freeze point** is `pricing.ts`: `priceBasket` and the optioned-basket path today snapshot
  `unitName: item.product.unit.name`. They change to `unitName: item.product.unit.abbreviation` —
  the printed label is now the abbreviation. This one edit is what makes receipts, kitchen tickets,
  the expo screen and the station queue print the short form; they read the frozen column and need
  no change.
- `apps/server/src/units-api.ts`: the POST/PATCH bodies accept and validate `abbreviation` the way
  they validate `name` (`screenName` gains a sibling for the abbreviation).
- `apps/server/src/working-order.ts`: the in-flight `unit` context object (used to rebuild a line
  for filing from stored `working_order_lines`) carries `abbreviation` where it carries `name`, so
  the offer→line path stays type-consistent. Its comment notes `unit_name` holds the frozen label
  (the abbreviation).

## Till

- `apps/till/src/api/client.ts`: `TillProduct["unit"]` gains `abbreviation`.
- `apps/till/src/widgets/product-name.ts`: `unitName(product)` — the one helper every on-screen unit
  label goes through (product tile price `€/kg`, keypad label, basket line) — returns
  `unit.abbreviation` resolved through the same content-language fallback it uses now. Its fallback
  `productUnit()` (for legacy `pricingUnit`-only products with no `unit`) gains an `abbreviation`
  matching the short form it already synthesises.

## Dashboard

### Product editor

`apps/dashboard/src/widgets/product-editor.ts`: the unit `<option>` label (`this.label(unit)`)
becomes `Name (abbr)` — e.g. `Kilogram (kg)` — so a manager picking a unit sees both. The dropdown
still marks the chosen option with `.selected` (already correct; `CLAUDE.md` §3 UI rule).

### Units screen — `apps/dashboard/src/screens/units-screen.ts`

Rebuilt to mirror `categories-screen.ts`:

- **Header row** (`.heading` flex, space-between): `<h1>` on the left, an **Add unit** button on the
  right inside `.header-actions`. The hand-built `.toolbar` (its own search input + inline create
  button) is removed.
- **Table** gains `searchable` with `searchLabel`, and a `viewKey="waitron.units.table"` so the
  tab's session storage restores the last sort and filter; `sortKey="name"`
  `sortDirection="ascending"` sets the first-visit default (alphabetical on Name). This is exactly
  the `wt-data-table` mechanism the categories table already uses — no change to the primitive.
- **Columns:** Name · Abbreviation · Precision · Actions.
  - Name: `searchValue`/`sortValue` = localized name.
  - Abbreviation: new column, `searchValue`/`sortValue` = localized abbreviation.
  - Precision: `sortValue` = the numeric precision (sort stays numeric). Cell renders the decimal
    marker of the **dashboard** locale followed by `precision` zeroes — `,000` in Spanish, `.000`
    in English for precision 3 — and a plain `0` for precision 0 (a bare marker would read as a
    stray comma). The marker comes from `Intl.NumberFormat(locale).formatToParts(1.1)` (the decimal
    part), so it follows the same locale rule the rest of the UI does; no hard-coded separator.
    Add a `filter` on this column (allLabel "All precisions", options = the precisions actually in
    use), giving the table a column filter like categories' Parent/Reporting filters.
  - Actions: the row-actions Edit/Delete buttons take `align="start"` (left-aligned menu text), as
    categories does.
- The in-use / reassign delete modal is unchanged in behaviour; its product table is left as-is.
  Its reassign `<option>` labels may show `Name (abbr)` for consistency (minor; not required).

### Unit form — `apps/dashboard/src/widgets/unit-form.ts`

Beneath each per-language Name field, add a per-language **Abbreviation** field. Required in the
default language (index 0), like Name. The draft state, the willUpdate seeding, the submit
validation and the emitted `UnitInput` all grow the abbreviation the way they handle names. New
strings `units.abbreviation`, `units.abbreviation_required` in both languages.

### Types — `apps/dashboard/src/api/client.ts`

`Unit`, `UnitInput`, `UnitPatch`, and `ProductUsingUnit` (unchanged — products, not units) — the
three unit types gain `abbreviation`.

## Strings

`apps/dashboard/src/i18n/strings.ts`, en + es:

- `units.abbreviation` — "Abbreviation" / "Abreviatura"
- `units.abbreviation_required` — mirror `units.name_required`
- The existing `units.precision` label "Decimal places"/"Decimales" becomes **"Precision"** /
  **"Precisión"** per the owner's rename. `units.precision_help` / `units.precision_invalid` keep
  their wording.
- A filter label for the precision column: `units.filter_precision_all` — "All precisions" / "Todas
  las precisiones".

## Testing (TDD — failing test first for each)

- **catalogue** (`units.ts`): create and update require the abbreviation in the default language
  and validate its translations; the returned/stored unit carries it. Prefer PGlite; a grant
  assertion (if touched) calls `asAppUser(tx)` first (`CLAUDE.md` §4).
- **pricing** (`pricing.ts`): a priced basket line freezes `unitName` = the unit's **abbreviation**,
  not its name. This is the behavioural assertion that guards the receipt/ticket outcome.
- **fiscal neutrality** (verifactu): conformance vectors stay green; two lines differing only in
  `unit_name` hash identically. Run it — do not read it.
- **units API** (`units-api.test.ts`): POST/PATCH accept `abbreviation`, reject a missing one with
  the right code.
- **working-order**: a filed line's frozen label is the abbreviation (end-to-end through the
  add→file path).
- **till** (`product-name.test.ts`): `unitName(product)` returns the abbreviation; the legacy
  `pricingUnit`-only fallback still works.
- **units screen** (`units-screen.test.ts` + `.a11y.test.ts`): Add-unit button is in the header, not
  a toolbar; the table is searchable; the Abbreviation column renders; the Precision cell shows
  `,000` under an es locale and `.000` under en for precision 3, and `0` for precision 0; the
  precision filter narrows rows; first visit sorts by Name ascending; a stored sort/filter is
  restored from session storage (`sessionStorage.clear()` in setup, as the categories test does).
  Row-action buttons are `align="start"`.
- **unit form** (`unit-form.test.ts` + `.a11y.test.ts`): the abbreviation field appears per locale,
  is required in the default language, and is emitted in `wt-submit`.
- **product editor**: the unit option label is `Name (abbr)`.

After the automated suite: open the units screen in the running dashboard, **both themes, phone
width**, and look — the string-rendered assertions above cannot catch a screen that throws on open
or renders an unreadable value (`CLAUDE.md` §4, the "open it and LOOK" rule). A browser-mode package
has the harness; the dashboard screen tests run in real Chromium already.

## Coordination — the `feat/drop-tenant-id` sibling branch

The `feat/drop-tenant-id` worktree is mid-flight (Phase A: it has renamed `withTenant` →
`withTransaction` and removed `where tenant_id` read filters; it has **not** yet reached Phase B,
which drops `tenant_id` columns and regenerates the catalogue migrations). Two overlaps:

1. **Code:** it edits `apps/server/src/units-api.ts`, `packages/catalogue/src/operations.ts`, and
   the catalogue unit tests — the same files this work touches. Whichever branch lands second
   rebases and resolves the conflict (notably `withTenant`→`withTransaction` in `units-api.ts`).
2. **Migrations:** when that branch reaches Phase B it regenerates the catalogue migration; so does
   this one. A drizzle migration-number collision on rebase is fixed by **regeneration**, never by
   hand-editing snapshots or `_journal.json` (`CLAUDE.md` §3), verified by running the grant
   assertions and `inmutabilidad`.

Neither overlap changes this design; both are handled by the standard rebase-and-regenerate flow.
The implementer coordinates land order with whoever holds `feat/drop-tenant-id` and does not
hand-write the catalogue migration.

## Files touched (summary)

- `packages/catalogue/src/schema/units.ts` — column
- `packages/catalogue/src/units.ts` — types, columns, validation
- `packages/catalogue/src/pricing.ts` — freeze abbreviation; snapshot type
- `packages/catalogue/src/operations.ts` — carry abbreviation through `sellableUnit`
- `packages/catalogue/src/provisioning.ts` — seed names + abbreviations
- `packages/catalogue/test/fixtures.ts`, `apps/server/src/testing/seed-units.ts` — test seeds
- `packages/catalogue/drizzle/*` — regenerated (generated, not written)
- `apps/server/src/units-api.ts` — accept/validate abbreviation
- `apps/server/src/working-order.ts` — unit context + comment
- `apps/till/src/api/client.ts`, `apps/till/src/widgets/product-name.ts` — till label
- `apps/dashboard/src/api/client.ts` — types
- `apps/dashboard/src/widgets/product-editor.ts` — option label
- `apps/dashboard/src/screens/units-screen.ts` (+ tests) — rebuilt screen
- `apps/dashboard/src/widgets/unit-form.ts` (+ tests) — abbreviation field
- `apps/dashboard/src/i18n/strings.ts` — strings
- plus the test files listed under Testing
