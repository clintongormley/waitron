# Form fields in the "filled" style, with the label inside the field (A178) — design

**Status:** draft for the owner's review, 2026-10-01. Written by the lane A campaign runner from the
A178 entry in `docs/backlog.md` and the owner-approved mockups linked there. Section 3 is what the
owner has already decided; every other section is this document's proposal. Section 12 lists the
points the owner should look at hardest, each with the default this design takes.

## 1. Why

The owner, showing Home Assistant's device dialog, wants every form field drawn the "filled" way:
a background fill with a line along the bottom instead of a border all round, the field's name
inside the fill, and dropdowns whose open list is clear and roomy. The look was approved on
2026-10-01 ("perfect!"). The owner also wants the look to be the same everywhere for now — the
dashboard, setup AND the till (2026-10-01 ~16:00: "yes for now, then we can revisit later";
~16:01: "make everything consistent for now").

Two things make this more than a stylesheet change:

- **A native `<select>` cannot be restyled into the approved dropdown.** Its open list is drawn by
  the browser and the operating system. Every dropdown in the product has to become a list the app
  draws itself, which brings the keyboard and screen-reader behaviour of a list box with it.
- **Many screens draw their own fields** instead of using the shared ones, and those do not follow
  a change to the shared components. The owner wants them moved onto the shared components ("if
  there are screens drawing their own fields then they should be updated to use the primitives … or
  to add a primitive"), and then a rule, with a guard, that a screen never draws its own field.

## 2. Words used here

- **Primitive** — one of the shared `wt-*` web components in `packages/ui-core` and `packages/ui`.
  The field primitives are `wt-input`, `wt-price-input`, `wt-number-stepper` and `wt-combobox`,
  plus the new `wt-textarea` this design adds.
- **Field box** — the filled rectangle of one field: the fill, the bottom line, the label inside,
  and the value.
- **Resting label** — the label drawn large (16px) in the middle of an empty field.
- **Floated label** — the label drawn small (12px) at the top left of the field box.
- **Hint** — the field's `hint` property, which the house rules already show inside the empty field
  as its placeholder (CLAUDE.md §3, Forms; `docs/developers/design-system.md` → Forms).
- **Dropdown** — any control where the operator picks from a list. After this change every one of
  them is a `wt-combobox`.
- **List panel** — the popup a dropdown opens, holding the rows to pick from.
- **Search box** — the text box at the top of a list panel that filters its rows.
- **Hand-drawn field** — a native `<select>`, `<textarea>` or text `<input>` written directly in a
  screen's own markup rather than drawn by a primitive.

## 3. What the owner has decided (from `docs/backlog.md`, the A178 entry)

1. The field is marked out by a fill and a line along its bottom, not a border all round.
2. The field's name sits inside the fill, small, at the top left.
3. The field being edited has a blue bottom line, and its name turns blue too.
4. A hint is clearly told apart from a filled-in value.
5. A dropdown's options are very clear: a roomy list of rows, an icon where there is one, a search
   box at the top.
6. With no other hint, the field's name IS the hint, drawn in the empty field; it moves up to the
   top left, small, once there is a value or the field is focused.
7. Measurements from the approved mockups: a field is 56px tall, with 8px rounded top corners,
   square bottom corners and a 1px bottom line; focused, the line is 2px in the primary blue and
   the label turns blue. The label is 16px resting and 12px floated; the required `*` travels with
   it. A hint is grey and italic. An error turns the line (2px) and the label red, with the message
   under the field. Disabled: a paler fill, a dashed bottom line, greyed text. A filled-in value is
   pure black in light and pure white in dark.
8. The open dropdown: a search box at the top, 48px rows, the hovered row tinted, the chosen row
   bold with a tick. While the list is open the FIELD loses its focus marking, because the search
   box is where typing goes. The search box is outlined, not filled: the list's own background, a
   1px blue line all round and 8px corners. A soft shadow under the search area separates it from
   the rows, in place of a dividing line.
9. The colours, worked out with WCAG's contrast formula (table in section 6).
10. The change lives in the shared primitives, so every screen built on them changes with them;
    screens that draw their own fields move onto a primitive, or a primitive is added.
11. The dashboard, setup and the till all follow, and the till keeps its tap targets at the ui-core
    minimum (`--wt-tap-min`, 44px, `packages/ui-core/src/tokens/structure.css`). This one is
    recorded in the lane A campaign queue rather than the backlog (owner, 2026-10-01 ~16:00,
    relayed by the supervising watcher).
12. Text is 14px in the system font (A179, landed as #988 on 2026-10-01), which the mockups use.

## 4. How it works today

Read from `main` at `b02c0e381` on 2026-10-01; nothing in this section was run except where it
says so.

- **`wt-input`** (`packages/ui-core/src/components/wt-input.ts`; `packages/ui` re-exports it) draws a
  `<label for>` above a bordered `<input>` with `min-height: var(--wt-tap-min)`, a 1px
  `--wt-color-border` border all round and `--wt-radius-md` corners. Its `hint` is the input's
  placeholder unless `placeholder` is set, and is also kept as a visually hidden paragraph the input
  names in `aria-describedby`. A `help` slot sits beside the label and an `end` slot inside the
  field. It has no `hide-label`, so a field with no visible label has no accessible name.
- **`wt-price-input`** and **`wt-number-stepper`** (`packages/ui/src/components/`) follow the same
  label-above, bordered pattern; both already have `hide-label`. `wt-price-input` has no `invalid`
  property (its `aria-invalid` follows `error` alone).
- **`wt-combobox`** (`packages/ui/src/components/wt-combobox.ts`) is a `<button>` trigger
  (`aria-haspopup="listbox"`) opening a `popover` panel. The panel holds a search `<input
  role="combobox">` with `aria-activedescendant` over a `<ul role="listbox">`. Arrows (clamped, no
  wrap), Home, End and Enter work in the search box; Escape closes and refocuses the trigger.
  There is no keyboard on the closed trigger beyond what a button does, no type-ahead, no `hint`,
  no `help` slot, no option icons and no option groups. Its search box is pill-shaped
  (`--wt-radius-full`).
- **Native dropdowns** are styled by `selectStyles` (`packages/ui/src/base-styles.ts`) or, in the
  till, by `apps/till/src/select-styles.ts`, whose own comment says it must not be merged with the
  first ("the till's select is a touch target and does not fill its container"). `wt-data-table`'s
  filter is a native `<select class="table-filter">` (A173 is about that control's arrow).
- **No textarea primitive exists.** `apps/dashboard/src/screens/receipt-screen.ts` says so in its
  own header comment ("wt-input has no multiline form").
- **Hand-drawn fields**, counted on 2026-10-01 by three read-only surveys that opened every `grep`
  hit (comment-only hits and checkbox, radio, file, range, colour and hidden inputs left out):

  | Tree | `<select>` | `<textarea>` | text-like `<input>` |
  | --- | --- | --- | --- |
  | `apps/dashboard/src` | 47 | 2 | 12 (4 of them hidden password-manager helpers) |
  | `apps/setup/src` | 5 | 1 | 1 |
  | `apps/till/src` | 6 | 1 | 0 |
  | `packages/*/src`, screens | 9 lines (18 fields on screen) | 0 | 2 lines (7 fields) |
  | inside primitives | `wt-data-table`'s filter | — | `wt-floor-canvas`'s zone name |

  Section 9 lists every one of them, file by file, with where it moves.
- **Tokens** (`packages/ui-core/src/tokens/colors.css`) are written four times — the light base, a
  `prefers-color-scheme: dark` block, `[data-theme="light"]` and `[data-theme="dark"]`. There is no
  field fill, field line, field height or disabled-colour token today; disabled is
  `--wt-opacity-disabled` (0.5). `colors.test.ts` checks that a fixed list of tokens is set in the
  light theme only; its one contrast case, about `--wt-color-surface-lifted`, reads six tokens in
  both themes.
- **No guard reads screen code for hand-drawn fields.** The two `no-hardcoded-chrome.test.ts`
  suites read only the primitives' `static styles`.

## 5. The field box

One shared stylesheet fragment, `fieldStyles`, in a new file `packages/ui-core/src/field-styles.ts`,
draws the field box for every field primitive, so the look is defined once. Each primitive renders
the same structure:

```html
<div class="field" part="field">          <!-- the fill, top corners, bottom line -->
  <label for="…" class="field-label">Name<span class="required" aria-hidden="true">*</span></label>
  <input class="field-control" …>          <!-- or textarea, or the dropdown's trigger button -->
  <slot name="end"></slot>                 <!-- wt-input only, as today -->
</div>
<slot name="help"></slot>                  <!-- beside the field box, see 5.4 -->
<p class="error">…</p>                     <!-- under the field, as today -->
```

### 5.1 States

The field box carries data attributes the primitive sets from its own state, and `fieldStyles`
draws each:

| State | When | Drawn |
| --- | --- | --- |
| `data-label="rest"` | empty, not focused, no hint, no placeholder, and the type is not a date or time type | label 16px, vertically centred, `--wt-color-text-muted` |
| `data-label="float"` | any other case | label 12px at the top left; value and hint sit under it |
| `:focus-within` on `.field` | the control has focus (and, for a dropdown, its list is closed) | line 2px `--wt-color-primary`; label `--wt-color-field-label-focus` |
| `data-invalid` | `invalid` or a non-empty `error` | line 2px `--wt-color-danger`; label `--wt-color-danger` |
| `data-disabled` | `disabled` | fill `--wt-color-field-fill-disabled`; dashed line; label and value `--wt-color-text-muted` |
| `data-compact` | no label is drawn: `hide-label`, or no `label` at all | height `--wt-tap-min` instead of `--wt-field-height`; the hint or placeholder sits vertically centred |
| `data-open` | a dropdown's list is open | the focus marking is dropped (owner decision 8) |

- **An invalid field keeps its red marking while it has focus.** A failed submission puts focus on
  the first invalid field (`focusFirstInvalid`), so the red line and label win over the focused
  blue ones.
- **The focused field's 2px line is its focus indicator**; the control inside draws no separate
  focus ring. Elsewhere (buttons, rows) the focus ring stays as it is.

- **The label floats for every date and time type** (`date`, `time`, `datetime-local`, `month`,
  `week`), because the browser draws its own format text in an empty one (the date's parts and
  separators), which a resting label would overlap.
- **The resting label and a placeholder never share the box.** A field with a hint or placeholder
  always floats its label, so the hint shows where the value goes (owner decision 6 read with the
  existing rule that a hint is the placeholder). A field with neither shows its label resting, and
  the native placeholder is empty.
- **Today one field has no label at all**: `backup-screen.ts`'s pasted-key `wt-input` sits inside
  a `<label>` the screen draws itself, which does not name the input inside the component (found
  by the plan review's scan of every non-test `<wt-input`). It moves its text into `label`
  (section 9.1).
- **Disabled stops using opacity.** Today `disabledStyles` halves the opacity; the mockups draw a
  disabled field with its own paler fill and greyed text instead, so `fieldStyles` does not apply
  `disabledStyles` to the field box. It keeps `cursor: not-allowed`.
- **The value colour** is `--wt-color-field-value` (pure black or white, owner decision 7); the hint
  is `--wt-color-text-muted` in italics.

### 5.2 The label stays a real label

Only its position moves. It keeps today's `for`/`id` association
(`docs/developers/design-system.md` → "Accessible, clickable labels"), so a click on it still
focuses the control, and the required `*` stays inside it, `aria-hidden`, with the native
`required` (or `aria-required` on a dropdown) still announcing the requirement. The label is
positioned over the control with `position: absolute` and `pointer-events: none` is NOT used, so
the click-to-focus behaviour of a `<label>` keeps working.

### 5.3 Errors and hints

Unchanged in meaning: the error message stays a paragraph under the field box, named by the
control's `aria-describedby` after the hint, and `aria-invalid` follows `invalid || error`. The
hint stays both the placeholder and the hidden description. `wt-price-input` gains the `invalid`
property its siblings have, so a form that marks it without a message can.

### 5.4 Where the help tooltip goes

The `help` slot (a `wt-help-tooltip` today) moves from beside the label to beside the field box, at
its trailing end and vertically centred on it. Inside the field box it would sit in the control's
own click area and compete with the `end` slot (the password reveal button). `wt-combobox` gains the
same `help` slot, because setup puts a help tooltip on every field, including its dropdowns.

### 5.5 Sizes

The field box is `--wt-field-height` (56px) tall, which is above `--wt-tap-min` (44px), and the
control keeps `min-width: var(--wt-tap-min)`, so every field's hit target still meets the ui-core
tap-target suite.

**The stepper.** `wt-number-stepper`'s − and + buttons move outside the field box, one on each
side, each a `--wt-tap-min` square vertically centred on the box; the box between them is an
ordinary field whose label floats above the number. The box keeps today's width tokens
(`--wt-stepper-field-width`, `--wt-stepper-field-width-wide`), so a label longer than the box is cut
with an ellipsis (the whole label stays the accessible name). Section 12 asks. A compact field (`hide-label`) is
exactly `--wt-tap-min` tall. `wt-textarea` is at least `--wt-field-height` tall and grows with its
`rows`. Every field keeps `max-width: var(--wt-field-max-width)` on its host.

## 6. Tokens

New tokens, in all four blocks of `colors.css` and in `structure.css`. Values are the owner-approved
ones from `docs/backlog.md`; the ratios were re-computed for this document with WCAG's
relative-luminance formula (a short Python script, 2026-10-01) and agree with the backlog's.

| Token | Light | Dark | Ratio checked |
| --- | --- | --- | --- |
| `--wt-color-field-fill` | `#f0f1f4` | `#262a33` | — |
| `--wt-color-field-line` | `#7d8390` | `#7a8291` | 3.37 / 3.72 on the fill; 3.80 / 4.41 on `--wt-color-surface`; 3.55 / 4.85 on `--wt-color-bg` |
| `--wt-color-field-label-focus` | `#1a5fd0` | `#5c98ff` | 5.18 / 5.06 on the fill |
| `--wt-color-field-fill-disabled` | `#f7f7f8` | `#1f2229` | `--wt-color-text-muted` on it: 5.72 / 6.59 |
| `--wt-color-field-value` | `#000000` | `#ffffff` | 18.59 / 14.37 on the fill |

| Structure token | Value |
| --- | --- |
| `--wt-field-height` | `56px` |
| `--wt-field-label-rest-size` | `16px` |
| `--wt-field-line-width` | `1px` |
| `--wt-field-line-width-active` | `2px` |
| `--wt-dropdown-row-height` | `48px` |

The focused label needs its own colour because `--wt-color-primary` as 12px text on the fill is
4.10:1 in light and 4.49:1 in dark, under the 4.5:1 small text needs; the focused LINE uses
`--wt-color-primary` itself, which as a non-text mark needs only 3:1.

**The fill alone does not mark the field out** — `--wt-color-field-fill` is 1.13:1 against white
and 1.19:1 against the dark surface — so the bottom line is what meets WCAG 2.2's 3:1 for a
component's boundary (1.4.11, non-text contrast). axe does not check non-text contrast, so a new
case in `packages/ui-core/src/tokens/colors.test.ts` computes each ratio in the table above, in
both themes, and fails under the bar. The same file gains a case that every new token resolves to
a non-empty value in BOTH themes; today's set-check covers the light theme only.

## 7. The dropdown

**One dropdown primitive: `wt-combobox`, extended.** A second primitive (a `wt-select`) would draw
the same field box, the same list panel and the same rows, and differ only in whether a search box
shows. So `wt-combobox` becomes the one dropdown, and gains:

- `search` — `"always"` (the default, today's behaviour, so no existing combobox changes),
  `"auto"` or `"never"`. `auto` shows the search box when the list has more than 7 options
  (`SEARCH_THRESHOLD`); every dropdown moved from a native `<select>` sets `search="auto"`, which
  keeps a two-option choice (paper width, environment) from opening onto a search box. The owner's
  mockup draws one; section 12 asks. `allow-add` needs the search box to type into, so it shows the
  search box whatever `search` says; `multiple` works with or without one (Space toggles the active
  row).
- `hint`, `help` slot and `hide-label`, with the same meaning as on `wt-input`.
- per option, `icon?: string` (a registered `wt-icon` name, drawn before the label, `aria-hidden`),
  `group?: string` (consecutive options with the same group render under a heading, inside a
  `role="group"` named by it — the member list editor needs this), and `action?: true` (a row that
  sends `wt-combobox-action` with `detail: { value }` and never becomes the value — the variant
  table's "Add unit…" needs this).

### 7.1 Look

The trigger is a field box (section 5) whose control is the trigger button, showing the chosen
option's label as the value and a chevron at the trailing end, inside the field's own padding —
the arrow is ours, not the browser's, so A173's "arrow touches the border" cannot happen on it. The
list panel follows owner decision 8: rows `--wt-dropdown-row-height` (48px), hover tinted
`--wt-color-bg`, the chosen row `--wt-font-weight-bold` with a tick icon at its trailing end, and
the search box outlined (`--wt-color-surface` background, `--wt-field-line-width` of
`--wt-color-primary` all round, `--wt-radius-md` corners) with `--wt-shadow-1` under the search
area. While the panel is open the field box drops its focus marking (`data-open` on the field box
overrides `:focus-within`). The consuming app registers the `chevron-down` and `check` icons. The
dashboard registers `chevron-down` today (`apps/dashboard/src/icons.ts`); no app registers a `check`
icon yet, and setup registers no icons at all, so each app gains what it lacks.

### 7.2 Keyboard and screen readers

The roles stay what they are today: the trigger is a `<button aria-haspopup="listbox">`, and the
open panel holds either the search box (a `role="combobox"` input pointing at the list with
`aria-activedescendant`, as now) or, with no search box, the list itself, which takes focus. Screen
readers already announce the trigger as a button that opens a list box.

| Where | Key | Does |
| --- | --- | --- |
| Closed trigger | ArrowDown, ArrowUp, Alt+ArrowDown, Enter, Space | opens the list with the chosen row (or the first) active; the key's default is prevented, so the button's own click does not close it again and Enter does not submit a form |
| Closed trigger | a printable character | with a search box: opens the list and puts the character in the search box; without one: makes the next option whose label starts with the typed text the value, without opening (type-ahead, the typed text resets after 500 ms) |
| Open, with search box | ArrowDown, ArrowUp | move the active row, **wrapping** at the ends (today they clamp) |
| Open, with search box | Home, End | first and last row |
| Open, with search box | Enter | picks the active row; an `action` row sends its event |
| Open, without search box | the same keys, on the list itself | focus moves to the `<ul role="listbox" tabindex="-1">`, which carries `aria-activedescendant`; printable characters jump to the next matching row |
| Open | Escape | closes and returns focus to the trigger (today's behaviour) |
| Open | Tab, Shift+Tab | picks nothing, closes, and lets focus move on (today nothing in the component handles Tab) |

Wrapping replaces clamping because the `wt-language-footer` menu already wraps
(`docs/developers/design-system.md`, its primitives row) and one product should behave one way. A
group heading is not a row: arrows skip it. The "No results" text stays outside the list box (the
reason is in the code at `wt-combobox.ts`, the comment above it).

### 7.3 Native selects that move

Every native `<select>` moves onto `wt-combobox`. That retires the house trap where a Lit `<select>`
built from an expression must mark its choice with `.selected` (CLAUDE.md §3), because nothing
draws such a select any more; the rule and its receipt are pruned in the last pull request, once
the guard in section 10 stops a new one appearing. A screen that reads a value through
`querySelector('[name=…]').value` (`packages/venue-service/src/dashboard/venue-operations-screen.ts`
does) keeps working, because the `wt-combobox` host carries the `name` attribute and a `value`
property.

**Some screens re-apply a select's value after every render**, because a native select's `.value`
set in the template commits before its options exist (`devices-screen.ts`'s `updated()`, about
lines 188–212; `printing-rules-screen.ts`'s, about 103–110). A `wt-combobox` with `.value` bound
has no such ordering problem, so the move deletes those after-render fix-ups.

**A native select with no empty option starts on its first option; a `wt-combobox` with no value
starts empty.** Some screens rely on the first: `venue-operations-screen.ts`'s `#select` helper,
given no value, reads the first option back as the value; `canvas-editor-screen.ts` says so in a
comment (about lines 771–801). Wherever a moved select had no value bound and no empty option, the
screen binds `.value` to the first option's value, so what is saved does not change.

**A listener higher up the page that heard the native `input` or `change`** stops hearing it,
because the primitives stop the native event and send `wt-change` instead (`dispatchWtChange`,
`packages/ui-core/src/interactive.ts`). `venue-operations-screen.ts` re-checks its errors on the
form's own `input` and `change` (about line 1127). The move finds every such ancestor listener and
moves it to `wt-change`.

**An empty first `<option>`** ("Choose…", or the blank province) becomes the combobox's
`placeholder`. Where the field is not required it ALSO stays a row, so the operator can clear the
choice; where it is required, the row goes.

## 8. The textarea

A new primitive, `wt-textarea`, in `packages/ui-core/src/components/` beside `wt-input` (both the
till and the dashboard need it, and `wt-input` lives there). Properties: `value`, `label`, `name`,
`rows` (default 3), `maxlength`, `placeholder`, `hint`, `required`, `disabled`, `invalid`, `error`,
`hide-label`, `spellcheck`, `autocapitalize`; `help` slot. `spellcheck` is a standard HTML
property, and HTML reads the attribute `spellcheck="false"` as false where a plain Lit Boolean would
read any present attribute as true, so the component declares it with a converter that treats
`"false"` as false; the control is
`part="control"`, so setup's recovery-kit box can set a monospace font through `::part(control)`.
It sends `wt-change` with `detail: { value }` on every `input`, like `wt-input`. It follows the
"Adding a primitive" checklist in `docs/developers/design-system.md`, including the
`--wt-field-max-width` case.

## 9. Every hand-drawn field, and where it goes

"cb" is `wt-combobox`; "in" `wt-input`; "ta" `wt-textarea`; "ns" `wt-number-stepper`. Line numbers
are from `main` at `b02c0e381` and will drift; the plan's tasks re-find each by `grep` first.

### 9.1 Dashboard screens (`apps/dashboard/src/screens/`)

| File | Fields | Moves to |
| --- | --- | --- |
| `backup-screen.ts` | days, time mode (selects); fixed time (`type=time`); keep-count and keep-days (`type=number`, one template); the pasted-key `wt-input`, whose text is in a `<label>` around it rather than its own `label` | cb, cb, in, ns `min=1`; its text moves into `label` |
| `units-screen.ts` | reassign products to unit (select, aria-label only) | cb `hide-label` |
| `floor-screen.ts` | table's zone | cb |
| `profile-screen.ts` | UI language (required) | cb |
| `printing-rules-screen.ts` | receipt printer | cb |
| `roster-screen.ts` | roster week (`type=date`) | in |
| `device-profiles-screen.ts` | home layout per menu; canvas; form factor | cb ×3 |
| `my-schedule-screen.ts` | shift, colleague, absence kind | cb ×3 |
| `staff-screen.ts` | search (`type=search`); role filter; status filter (with help tooltip) | in; cb; cb with `help` slot |
| `dashboard-sales-screen.ts` | from and to dates; report printer | in ×2; cb |
| `recipe-screen.ts` | catalogue; product | cb ×2 |
| `login-screen.ts` | three hidden password-manager username inputs | stay — allow-listed in the guard (section 10) |
| `printers-screen.ts` | ruler's last number; paper width; resolution | cb ×3 |
| `devices-screen.ts` | receipt printer; card reader; move to profile (aria-label only); join: station, till, profile | cb ×6 (one `hide-label`) |
| `receipt-screen.ts` | footer message | ta |
| `canvas-editor-screen.ts` | form factor (new canvas; canvas) | cb ×2 |
| `planned-actual-screen.ts` | week (`type=date`) | in |
| `payments-screen.ts` | bill outcome (required); reader status filter | cb ×2 |
| `../dashboard-app.ts` | sidebar "Search pages" (`type=search`, aria-label only) | in `hide-label` |

### 9.2 Dashboard widgets (`apps/dashboard/src/widgets/`)

| File | Fields | Moves to |
| --- | --- | --- |
| `allergen-picker.ts` | contains / may contain, per allergen (named by a span) | cb `hide-label` |
| `member-list-editor.ts` | add member, with option groups | cb, options carrying `group` |
| `unit-form.ts` | decimal places (required; visible help text today) | cb with `hint` |
| `purchase-form.ts` | VAT kind per line; tax regime | cb ×2 |
| `person-form.ts` | role (required) | cb |
| `variant-table.ts` | status filter; pricing unit in a column heading, with an "add unit" row | cb; cb `hide-label` with an `action` option |
| `person-edit.ts` | role; status (both required) | cb ×2 |
| `location-picker.ts` | location | cb |
| `product-editor.ts` | station and course (one helper); description per language; VAT class; unit | cb; ta; cb; cb |
| `dietary-origin-picker.ts` | dietary origin | cb |
| `add-content-language.ts` | content language (every language `Intl` knows) | cb |
| `section-add-products.ts` | category filter | cb |
| `autofill-username.ts` | hidden password-manager username | stays — allow-listed |

### 9.3 Setup (`apps/setup/src/screens/`)

| File | Fields | Moves to |
| --- | --- | --- |
| `restore-screen.ts` | recovery key (`type=password`); environment | in with the reveal button in `end`; cb |
| `restore-bucket-screen.ts` | recovery kit (monospace, spellcheck off); environment | ta `spellcheck="false"`, monospace through `::part(control)`; cb |
| `cert-screen.ts` | certificate kind | cb |
| `venue-screen.ts` | country; province | cb ×2 |

### 9.4 Till (`apps/till/src/`)

| File | Fields | Moves to |
| --- | --- | --- |
| `screens/till-counter-screen.ts` | service zone | cb |
| `screens/till-schedule-screen.ts` | shift, colleague, absence kind | cb ×3 |
| `screens/till-table-order-screen.ts` | course on a held line; course on a draft line (both aria-label only, in a basket row) | cb `hide-label` ×2 |
| `widgets/line-extras-editor.ts` | kitchen note (max 200) | ta |

`apps/till/src/select-styles.ts` is deleted once its three importers have moved. The till's other
fields are already `wt-input`s, and change with the primitive.

### 9.5 Module screens (`packages/*/src/dashboard/`)

| File | Fields | Moves to |
| --- | --- | --- |
| `adjustments/…/adjustment-report-screen.ts` | from and to dates (`type=date`) | in ×2 |
| `adjustments/…/reasons-screen.ts` | who may apply; who may approve | cb ×2 |
| `bookings/…/booking-form.ts` | the booking's table | cb |
| `bookings/…/bookings-screen.ts` | table to seat at | cb |
| `media/…/image-library.ts` | sort order; sort direction | cb ×2 |
| `payments-sumup/…/sumup-connect-form.ts` | merchant (required) | cb |
| `venue-service/…/venue-operations-screen.ts` | the `#input` helper (5 fields: two names, two times, an order number); the `#select` helper (9 fields); release reminder; ticket grouping (both with a hint) | in ×4 and ns ×1; cb ×9; cb ×2 with `hint` |

### 9.6 Inside the primitives

| File | Field | Moves to |
| --- | --- | --- |
| `packages/ui/src/components/wt-data-table.ts` | the filter `<select class="table-filter">` | cb `hide-label` |
| `packages/ui/src/components/wt-floor-canvas.ts` | the zone name `<input>` | in |
| `packages/ui/src/components/wt-data-table.ts` | the search `<input type="search">` | **stays** — A175 owns its look |

With the table filter on `wt-combobox`, `selectStyles` has no user left and is deleted. **A173
becomes moot**: its subject was the native arrow of that filter and of every `selectStyles` select,
and none remains. The plan's last task checks that by the guard (no native `<select>` left
anywhere) and marks A173 done in the backlog with that note.

**A175 narrows.** Of its three pill-shaped search boxes, the dropdown's search box is restyled here
(owner decision 8) and the sidebar's moves onto `wt-input`; only `wt-data-table`'s own search box
is left for A175.

### 9.7 Not moved

`apps/print-agent/src/setup-page.ts` writes two text inputs (the server address and the agent's
name) into a page built as a string, served by the print agent itself. The print agent may import
no other workspace package (CLAUDE.md §3, the print-agent seam), so it cannot use the primitives;
the guard allows it by name, with that reason. `apps/server`'s string-built pages hold no fields.

## 10. The rule and its guard

`docs/developers/design-system.md` → Forms gains a standing rule: **a screen does not draw its own
form field.** A `<select>`, a `<textarea>` or a text-like `<input>` is drawn by a primitive; where
no primitive fits, add to one or add one.

The guard, `scripts/native-form-fields.test.ts`, in the root project:

- walks every non-test `.ts` file under `apps/` and `packages/` (the walk
  `scripts/pinned-actions-column.test.ts` uses, skipping `node_modules`, `dist` and dot-entries);
- parses each with the root `typescript` and reads only template literals and string literals,
  so a comment naming `<select>` does not count; inside a template, each `${…}` is blanked out
  before matching, so an attribute after a binding (`<input .checked=${x} type="radio">`) is still
  read and a `>` inside a binding does not end the tag;
- reports, as `path:line`, every `<select`, every `<textarea`, and every `<input` whose `type` is
  missing or is not one of `checkbox`, `radio`, `file`, `range`, `color`, `hidden`, `button`,
  `submit`, `reset` or `image`; an `<input` whose `type` is bound with `${…}` is reported too,
  because the guard cannot know what it will be;
- exempts the field primitives that are meant to draw the native control —
  `packages/ui-core/src/components/wt-input.ts`, `wt-textarea.ts`, and
  `packages/ui/src/components/wt-combobox.ts`, `wt-price-input.ts`, `wt-number-stepper.ts`,
  `wt-data-table.ts` (its search box) — by an `EXEMPT_FILES` list, and allows the hidden
  password-manager helpers and the print agent's setup page by an `ALLOWED` list of
  `{ file, reason }` entries, with a case that fails when an entry no longer matches anything ("the
  list shrinks; it does not grow").

**Weaker than its name, stated in its header and wherever CLAUDE.md names it:** it reads text, so a
field built with `document.createElement`, inserted with `unsafeHTML`, written in an `.html` file
or a `.js`/`.mjs` file, or whose tag name is split across a `${…}` boundary is invisible to it; it
reads `apps/server`'s string-built pages but they are not Lit, and the rule is about Lit screens;
and an exempt primitive file is not read at all, so a second, unrelated field added inside one
passes.

## 11. Contract and tests that change

- `docs/developers/design-system.md`: the Forms section (the field box, the floated label, the help
  slot's new place, the standing rule), the primitives table rows for `wt-input` (`hide-label`),
  `wt-price-input` (`invalid`), `wt-combobox` (the additions in section 7), a new row for
  `wt-textarea`, the tokens listed in section 6, the "fallback" subsection (the `<select>` bullet
  merges into the single-choice `wt-combobox` bullet), and every paragraph naming `selectStyles`.
- `docs/developers/conventions-ui.md` and CLAUDE.md §3: the Lit `<select>` `.selected` rule goes,
  in the same pull request as the guard; the new rule and its guard's hedge go in.
- **Tests that pin today's LOOK change with the owner's approved mockups.** Examples read on
  2026-10-01: `wt-input.test.ts`'s 12px-label case (a resting label is now 16px), the border cases
  of each field primitive, `wt-combobox`'s pill-shaped search box, and `base-styles.test.ts`'s
  `selectStyles` cases (deleted with `selectStyles`). The plan names each such test in its task, and
  every pull request names them again. Every BEHAVIOURAL assertion — labels, `aria-*` wiring,
  events, hints as descriptions, `focusFirstInvalid`, refusals placed under fields — is kept.
- **Tests that READ a native field's parts change where they read, not what they expect** — a
  third kind of edit: a test that counts or reads `<option>` elements reads the combobox's
  `options` instead, and one that reads an error paragraph the screen drew itself
  (`[data-field-error]`) reads the primitive's `error` instead, with the same expected values. The
  one value that does change is the count of options where an empty first `<option>` of a required
  field became the placeholder (7.3) — each such case is named. Found by the plan review on
  2026-10-01, among others: `apps/setup/src/screens/venue-screen.test.ts` (about 128–160, the
  provinces), `till-schedule-screen.test.ts`, `sections-screen.test.ts`,
  `venue-operations-screen.test.ts` and `reasons-screen.test.ts` and their a11y suites.
- **Screen tests that DRIVE a native select change how they drive it, not what they assert.** About
  43 test files under `apps/` and `packages/` query a `select` (a `grep` on 2026-10-01; some are
  matches on other words). Each picks a value by setting `select.value` and sending `change`; after
  the move they call a shared helper, `chooseOption(el, value)`, in `packages/ui/src/test-helpers.ts`
  (exported for the apps' tests), which does what the primitive does when a row is picked: set
  `value` and send `wt-change`. The pattern already exists in
  `apps/dashboard/src/widgets/allergen-dietary-picker.test.ts`.
- The two tap-target suites pin the set of primitives that reflect `disabled`
  (`packages/ui-core/src/tap-target-and-focus.test.ts`, `packages/ui/src/tap-target-and-focus.test.ts`);
  `wt-textarea` joins both (the `packages/ui` one sees it through the re-export). Each pin is a
  whole-shape list gaining one name.

## 12. Points for the owner (each with the default this design takes)

1. **One dropdown, and a dropdown moved from a native select shows its search box only above 7
   options.** The mockup draws a search box on an open dropdown; a two-option choice would open onto
   a search box above two rows. Default: `auto` (above 7) for the moved ones, today's always-on
   search for the existing comboboxes. Alternative: always, everywhere.
2. **The help tooltip sits beside the field box, not inside it.** Default as section 5.4.
3. **A field with no visible label is compact: 44px tall, no label drawn** — the sidebar search, the
   table filter, the till's course picker in a basket row, the allergen picker's rows. Default as
   section 5.1.
4. **Disabled fields stop being half-transparent** and use the paler fill and grey text instead.
5. **Delivery in six pull requests**, each leaving `main` working: the primitives and tokens first
   (every screen already built on them changes at once), then the moves in four batches (section
   9's groups), then the guard and the clean-up. Between the first and the last, a screen still
   drawing its own dropdown shows the old look beside new fields. Alternative: one large pull
   request.
6. **Tests that pinned the old look change**, screen tests change how they pick a dropdown value,
   and tests that read a native field's options or a screen-drawn error read the primitive's
   instead (section 11). THE RULE treats an edited test as a STOP; approving this plan approves
   those three kinds of edit, and nothing else.
7. **A173 becomes moot and A175 narrows** to the table's own search box (section 9.6).
8. **Arrow keys wrap** in an open dropdown, where today they stop at the ends (section 7.2).
9. **The stepper's − and + sit outside the field box**, and a label longer than the box is cut
   (section 5.5). Alternative: the box widens to its label.

## 13. Not in this change

- The till's radio "option" rows, segmented controls and checkboxes are not text fields and keep
  their look.
- Phone-width zoom in Safari on iPhone (fields under 16px text) — the owner tests phones later
  (A179's entry).
- Page heading sizes (left open by A179).
- A169 (the folding section) is built after this, in the new look (the owner's build order).
- `apps/server`'s string-built pages have no form fields (survey, 2026-10-01).
