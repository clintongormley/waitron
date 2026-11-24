# Inherited values: an empty setting inherits, shown once and quietly

Status: waiting for the owner's approval of this document. A fresh reader checked it against the
code, 2026-11-24, and its findings are in. The approach (option 4) was approved by
the owner, 2026-11-24, from mock-ups on the demo's own screens. Points marked **my call** were the
session's.

## Why

The owner: "i have a rule to show inherited default values as grey italics, including as hints in
fields. This appears quite noisy, and Claude has taken to filling in default values as "foo (same as
the category value)" and things like that, which is also incredibly noisy."

Looked at on the demo venue and in the code:

- Inherited is the usual state, so most of a screen was grey italic. Every printer in the demo's
  Devices table was.
- Grey italic also means a search prompt, an example and "None", so it does not say "inherited".
  Search boxes disagree: the sidebar's is italic, the Devices table's upright.
- A dropdown lists the inherited value and then the same value again. The device form offers "Demo
  printer" twice. Where builders saw that, they added words: "Same as department (Table service)",
  "Same as Eat-in VAT — Reduced (10%)", "Starters (from the product)", "Main room (default)", "Use
  default: Bar printer". The owner banned "Same as" on 2026-10-02; nothing checked it.
- Departments and zones (2026-11-14) and Routes (2026-10-11) already leave a matching inherited
  value blank.

## What the owner decided

- "there must be a distinction between choosing the inherited value and fixing the value to what
  happens to be the inherited value at this moment".
- "especially in routing, we only show the custom values, not the inherited values. this makes the
  routing table much quieter."
- "I'm OK with setting no value to mean use the inherited value, but maybe that needs to be made
  more obvious". Option 4, below, answered "y".

## Goals, non-goals, anti-goals

- **Goals:** anyone can tell an inherited value from an example, a disabled field and a value fixed
  here; nobody reads a sentence to learn it.
- **Non-goals:** what inherits from what, and what is stored. A `null` still means inherit. No server,
  database or wire change, with one new use of what the server already accepts: a period may now name
  its department's default floor plan.
- **Anti-goals:** a new mark on values that are set here; explanations of where a value comes from;
  an allergen or a price left blank because it is inherited.

## The rule

> **An empty setting inherits. Say so once, quietly.**

1. **Fields.** An inherited value is drawn upright in `--wt-color-text-muted`
   after a small arrow, "↳". A value set here is the ordinary field value, with no mark, even when it
   equals the inherited one.
2. **Dropdowns.** The first row is "↳ Inherit: {value}" (Spanish "↳ Heredar: {value}"), muted, then
   every value, the inherited one included. The first row inherits; any other fixes the value. The
   closed field shows "↳ {value}", without the word. When nothing is inherited the row is
   "↳ Inherit: None". The value named is the one in force now, so a printer or reader another device
   holds reads "None", as today.
3. **Text and price boxes.** Empty inherits: the box shows "↳ {value}". Typing anything, the same
   value included, fixes it. Clearing it inherits again.
4. **Boxes repeated down a table column** have no arrow: the inherited value is muted and upright
   (**my call**: an arrow on every row is noise). A dropdown there still has the "↳ Inherit" row. A
   hidden label alone does not remove the arrow.
5. **Settings tables show only custom values.** A blank cell inherits. A value fixed here shows even
   when it equals the inherited one. The row must sit under its
   parent or name it in a column. Exception: an inherited value that differs from what the row would
   lead you to expect is shown, muted and upright (Routes, as decided 2026-10-11).
6. **Facts people rely on are never blank:** prices, allergens, diet labels, VAT on a product page and
   opening hours. Inherited, they are muted and upright, with no arrow in tables and summaries.
7. **A closed section's summary** shows only values set here, plus the facts in 6.
8. **Hints are upright and muted, with no arrow.** An example starts "e.g." ("p. ej."). Prompts
   ("Choose a profile", "Search devices"), formats ("HH:MM") and "None" are not examples.
9. **No italics** in the apps' own styles.
10. **No other visible words** for inheriting: no "Same as …", "(default)", "from the …",
    "Use default". For screen readers only, the closed field's value is followed by "inherited"
    ("heredado"), and the calendar's hidden "as {department}" stays.

## Approaches considered

- **1. Arrow only**, in the field and the list's first row: you must know what the arrow means before
  choosing.
- **2. A clear button** on a field that is set, and no inherit row: one more control, and an empty box
  still looks like an example.
- **3. "Inherit" in the list only**: the closed field still looks like an example.
- **4. Arrow in the field, "Inherit" in the list** — picked. The open list explains the arrow.
- Grey upright with no arrow was turned down because disabled fields are muted too. Bold with a bar on
  every value set here was not needed once inherited values carried the arrow.

## Shared parts

- `packages/ui-core/src/field-styles.ts`: the placeholder loses its italic.
- `wt-input`, `wt-textarea`, `wt-price-input`: an inherited value is a property
  of its own (proposed name `inherited`), separate from `placeholder` and `hint`, so an example cannot
  be drawn as one. It floats the label as a placeholder does and adds the hidden "inherited".
  `placeholder` stays for prompts and examples. The caller says when a box is in a table column.
- `wt-combobox`: an option may be marked as the inherit row. It draws the arrow before that row, shows
  the value alone in the closed field, and keeps the row when the list is searched. The words come
  from the caller; `packages/ui` holds none. The row is offered whether or not it is chosen, replacing
  `show-empty-option` at these fields.
- `wt-disclosure`: `placeholder` on a summary value goes, with its last users.
- The arrow is one `wt-icon` drawn at `--wt-font-size-sm`, hidden from screen readers.
- The one pair of strings per app or module is "Inherit: {value}" and "inherited".

## Screens to change

| Screen | Today | Change |
| --- | --- | --- |
| Devices table | grey italic printers and reader | blank when inherited; sorting still uses the printer in force |
| Device form | same name twice | inherit row |
| Zone form | "Same as department (…)" | inherit row |
| Departments and zones list | blank when equal, even when fixed | blank only when inherited; a table-service row still leaves counter service blank |
| Period form, Floor plan | "{set} (default)"; the default cannot be fixed | inherit row, then every plan, the default included |
| Periods list, Floor plan | default in grey italic | blank; "—" stays where the department has no plans |
| Delete floor plan, Replace with | "{set} (default)" | inherit row; the default is not listed again, because the server stores it as inheriting |
| Product editor, variant page: course, VAT when taken away | fallback twice; "Same as {product} — …" | inherit row |
| Variant page, allergens | chip "Same as {parent}" | chip "Inherit"; inherited chips muted, upright |
| Variant page, Details' closed line | inherited values in italic | own values only, plus allergens, diet and VAT |
| Product, variant, option, extras, section, set-menu and unit name, abbreviation and description fields | italic placeholder | arrow |
| Extras editor, customer-facing names closed line | inherited names in italic | own names only (changes the owner's 2026-10-04 answer; **my call**) |
| Extras editor, Price | italic placeholder in a grid | muted, upright |
| Variants table and variant window, price | grey italic | table muted, upright; window arrow |
| Product list, inherited allergens | italic badges | muted, upright |
| Product list, variant's inherited price | unmarked | muted, upright (answers the open backlog question; **my call**) |
| Menu Price overrides | italic placeholder | muted, upright; bold and bar stay |
| Menu patch window, Edit translations | italic placeholder | arrow where the label shows |
| Set menu, VAT when taken away | "Same as Eat-in VAT — …" | inherit row |
| Set menu dishes, Course | "{course} (from the product)" | inherit row |
| Set menu dishes, Surcharge | "Included" in italic | upright hint, no arrow |
| Set menu variant, Surcharge | italic placeholder | arrow when it is the dish's surcharge; "Included" is a hint, with no arrow |
| Product and variant colour | "Use category colour" / "Use default colour" | "Inherit" beside the chip of the colour it gives, or with no chip when there is none |
| Category colour | "No colour", which inherits | "Inherit", with the chip of the colour it gives |
| Calendar day box | grey italic hours | muted, upright |
| Routes grid | differing inherited station in italic | muted, upright; nothing else |
| Sales report, a category's own row | italic | muted, upright; not inheritance, but it is italic |
| Till: Printers and readers window | "Use default: {name}", "Profile default", "Chosen on this device" | inherit row and arrow; those two notes go, the others (held, switched off, busy, free) stay |
| Till: document and invoice printer | "Use default: {name}" | inherit row |
| Till: pay sheet | "ticket at {printer} (default)", "Profile default" note | "ticket at {printer}"; the note goes. Its list is unchanged: it draws the printer in force as chosen |
| Till: a line's course | "Default" | "↳ Inherit: {the product's course}" |
| Till: Rename for today, party name | italic placeholder | arrow; the shortening in `fit-placeholder.ts` allows for it |
| Hints: course name, tax ID, kitchen inactivity, privacy address and email, mail port | "For example …" or a bare example | "e.g. …" |

Left as they are, and why:

- **The Routes cell editor**, including "From {source}": it opens on the inherited choice so Save can
  fix it, and that choice can come from several places (**my call**).
- **The till's "{station} (default)"** where a closed station's dishes go: it says which station is the
  venue's default, and nothing inherits (**my call**).
- **"Same as the venue's address"**: a switch that copies an address.
- **The included-menu window**: its names arrive filled in and an empty one is stored as empty, so
  empty does not inherit there. Its "Use included menu colour" and "Use included menu photo" stay.
- **The guest-menu paper's "Use default colour"**: it stores a colour.
- **"Follows the season"** (staffing), **"Blank names use {language}"** (content languages) and the
  receipt logo's sentence: each describes the page, not one field's value.
- **Filters** such as Routes' "All periods", and text only a screen reader hears. Price overrides'
  hidden "Leave it empty to use the inherited price" already says it, so that field does not also add
  "inherited".
- **Inherited photos and colour squares**: dashed outlines, no text. The staffing and season grids'
  faded blocks are the same.
- The guides' and data-protection templates' own italics, which are prose.

`hours.inherit`, `hours.inherit_value` and `hours.inherited_prefix` are read by nothing; delete them.

## Documents changed with the code

- `docs/developers/design-system.md`: the rule above replaces "A field that falls back to another
  value" where they differ; also the field box, hints, disclosure, Routes, calendar, Periods and
  component-table lines that say italic. `DESIGN.md`: "Placeholder and hints: muted ink, upright."
- `CLAUDE.md` §3: one entry naming the rule and its guards.
- The guides, English and Spanish: products, modifiers, printers, opening hours,
  table service.
- The [menu editor design](2026-11-24-menu-editor-redesign-design.md) says "muted italics" for the
  usual price: muted and upright. Its bold for a price set on the menu stays.

## Guards

- A root test refuses `font-style: italic` and `oblique` in the apps' and packages' styles.
- A root test reads the English and Spanish strings and refuses "Same as", "Igual que", "(default)",
  "(predeterminado/a)", "Use default", "Usar el predeterminado", "Profile default", "Predeterminado del
  perfil", "(from the product)" and "(del producto)", listing
  by key the strings that stay. Weaker than its name: it reads text and only those phrases.
- `wt-*` tests cover each state in both themes, with contrast of the muted text measured.

## Order

1. Shared parts and their tests; italics go, with their guard. Screens keep working: an untouched
   `placeholder` is simply upright.
2. Dashboard product and menu screens.
3. Devices, venue-service screens, Calendar, Routes.
4. Till, remaining hints, the wording guard.

Each is light review: no risk trigger. The unfinished menu editor, set-menus page and products list
builds follow the rule from part 1 on; where one has replaced a screen above, apply the rule to its
replacement.

## Left to the builder

Property and key names, the arrow's exact drawing, and how the Devices table sorts a blank cell (by
the printer in force).
