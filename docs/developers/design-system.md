# Design system

Every screen in this project is built from `wt-*` primitives styled by `--wt-*` tokens.
This document is the contract. If you are building a view, read this first.

## Shared package boundary

`@waitron/ui-core` owns account-form controls: button, input, textarea, card, icon, spinner,
form actions and error summary, plus theme tokens, common styles (the filled field box,
`fieldStyles`, among them) and keyboard helpers.
Waitron's `@waitron/ui` keeps its existing root and deep component imports as re-exports.
Venue controls and brand asset delivery stay in `packages/ui`.

Develop against workspace source; use the built tarball for another repository.
`pnpm --filter @waitron/ui-core test:package` installs that tarball outside the workspace
and checks its declarations and real Chromium rendering. See
[the package guide](../../packages/ui-core/README.md). Private registry publication
and Cloud screens remain separate release work.

## The rule

**No hardcoded chrome.** No hex colours, no `rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/
`oklch()`/`color-mix()` colours, no named colours (`red`, `blue`, …), no font sizes, no radii, no
px spacing above `1`, and no `rem`/`em` sizing at all (not even inside `min()`/`max()`/`clamp()`)
in any component or view. Every such value reads a token instead. `transparent`, `currentColor`,
and `inherit` are legitimate escape hatches, not chrome. This is enforced by
`packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers every primitive automatically via
`import.meta.glob("./components/*.ts", ...)` (excluding `*.test.ts`), scans each one's `static
styles`, and fails the build on violations — a new component under `src/components/` is covered
the moment it exists, with nothing to remember to register.
The shared package also runs `packages/ui-core/src/no-hardcoded-chrome.test.ts` and
`packages/ui-core/src/tap-target-and-focus.test.ts` directly over its own controls.

If a token you need does not exist, add it to the token layer — do not inline a value. A `--wt-*`
name a stylesheet reads must be declared in the token layer. `scripts/style-token-names.test.ts`
checks only that some file under `apps/` or `packages/` declares it, not where, by reading text;
its header lists what it cannot see.

## Setting up a theme root

```ts
import { applyTokens } from "@waitron/ui";

applyTokens(document.querySelector("#app")!);
```

`applyTokens(root)` marks `root` with `data-wt-theme-root` and adopts the token stylesheet (a
single cached `CSSStyleSheet`, shared across every call) onto `root`'s document — or its shadow
root, if `root` lives inside one — via `adoptedStyleSheets`. The token CSS itself is written
entirely in `:where()`-wrapped attribute selectors (`:where([data-wt-theme-root])`,
`:where([data-wt-theme-root][data-theme="light"])`, etc. — see "Themes" below for why every one of
them is `:where()`-wrapped), so what a given theme root resolves depends only on its own
attributes. That means two elements on the same page can both be theme roots — one
`data-theme="light"`, one `data-theme="dark"` — and each resolves `--wt-*` independently and
simultaneously. That's what the workbench demonstrates, and what
`packages/ui-core/src/tokens/multi-root.test.ts` pins down with an assertion: two roots mounted at once,
each still reporting its own resolved `--wt-color-bg`.

## Themes

Light and dark ship by default. Selection order:

1. `prefers-color-scheme` — the default, read from the OS/browser.
2. `data-theme="light" | "dark"` on the theme root — always wins, in both directions.

**The token layer sets more than `--wt-*` custom properties: each of its three blocks also sets the
CSS `color-scheme` property**, to `light` or `dark` to match. That is what makes controls the app
does not paint itself — native radios, checkboxes and scrollbars — drawn in the right theme, because
the browser draws those from `color-scheme` and never from `data-theme`. Without it the dark theme
got the light drawing, and an unchecked radio came out as a solid white dot heavier than the checked
one's ring. `color-scheme` is an inherited property, so the base block's `color-scheme: light` also
stops a theme root nested inside a dark one from being drawn dark while its colour tokens resolve
light. Both are pinned in `packages/ui-core/src/tokens/colors.test.ts`; nothing nests a theme root today,
so the second is a constructed case rather than an observed one.

**Every rule in the token layer — the `prefers-color-scheme` block and both `data-theme` blocks —
is wrapped in `:where(...)`, which contributes zero specificity.** `data-theme` still wins over
`prefers-color-scheme` in both directions, but purely by **source order** (the `data-theme` rules
are written after the `@media` block in `colors.css`), not by specificity.

This matters beyond theme selection: because every built-in rule sits at specificity 0, **any**
plain selector in a deployment's own stylesheet — a class, an ID, an attribute selector — outranks
the token layer and wins, regardless of whether `data-theme` is set. An earlier version of this
file wrapped only the `prefers-color-scheme` block in `:where()` and left the two `data-theme`
blocks as plain attribute selectors (specificity 0,2,0). That made a deployment override like
`.brand { --wt-color-primary: purple }` (specificity 0,1,0) lose to the `data-theme` block whenever
`data-theme` was set — silently breaking retheming on exactly the configuration the shipped
workbench itself uses (each panel sets `data-theme` directly). See
`packages/ui-core/src/tokens/structure.test.ts`'s `deployment rules override the token layer's defaults
even when data-theme is set` for the regression test.

## Retheming a deployment

Override tokens on the theme root, with a selector of your own (a class or ID — not an inline
style, and not a bare `[data-wt-theme-root]`/`[data-theme]` selector, which only matches the token
layer's own specificity). Never patch component styles.

```css
#app {
  --wt-color-primary: #7c3aed;
  --wt-radius-md: 0px;
}
```

This works whether or not `#app` also carries `data-theme` — see "Themes" above.

## Tokens

### Colour

`--wt-color-bg`, `--wt-color-surface`, `--wt-color-surface-raised`, `--wt-color-surface-lifted`,
`--wt-color-text`, `--wt-color-text-muted`, `--wt-color-primary`, `--wt-color-on-primary`, `--wt-color-danger`,
`--wt-color-on-danger`, `--wt-color-success`, `--wt-color-warning`, `--wt-color-on-warning`,
`--wt-color-border`, `--wt-color-focus`, `--wt-color-scrim`, `--wt-color-field-fill`,
`--wt-color-field-line`, `--wt-color-field-label-focus`, `--wt-color-field-fill-disabled`,
`--wt-color-field-value`

Colours are semantic, not literal. There is no `--wt-color-blue`. `--wt-color-scrim` was added
after the rest of the palette to back `wt-dialog`'s `::backdrop` — if you need a similar
overlay/veil colour elsewhere, reuse it rather than inventing a new one.

`--wt-color-surface-lifted` is the background of something picked up and moving — a table row
while a pointer drags it (`packages/ui/src/reorder-table.ts`). A dragged row can sit
inside a `wt-modal`, which is painted `--wt-color-surface-raised`, so the lifted surface differs
from `--wt-color-bg`, `--wt-color-surface` and `--wt-color-surface-raised` in both themes, and
keeps `--wt-color-text` and `--wt-color-text-muted` at 4.5:1 or more; the "lifted surface" test
in `packages/ui-core/src/tokens/colors.test.ts` holds both. The dragged row follows the pointer,
held inside its list, and is drawn above the rows it covers. Each row it passes slides out of its
way, and the row itself slides into its slot when released, both over `--wt-duration-move`. Under
reduced motion (`prefers-reduced-motion: reduce`) passed and released rows land at once, while the
dragged row still follows the pointer.

`--wt-color-warning` is the amber for a warning that is not yet an error, such as the alerts count
badge when no open alert is an error. Text on it uses `--wt-color-on-warning`.

The five `--wt-color-field-*` tokens paint the filled form field (see "The field box" under Forms):

| Token | Light | Dark | Paints |
| --- | --- | --- | --- |
| `--wt-color-field-fill` | `#f0f1f4` | `#262a33` | the field's background |
| `--wt-color-field-line` | `#7d8390` | `#7a8291` | the bottom line at rest, and the dashed one when disabled |
| `--wt-color-field-label-focus` | `#1a5fd0` | `#5c98ff` | the label of the focused field |
| `--wt-color-field-fill-disabled` | `#f7f7f8` | `#1f2229` | a disabled field's background |
| `--wt-color-field-value` | `#000000` | `#ffffff` | the value typed or chosen |

Their contrast, computed 2026-10-01 from `colors.css` with WCAG 2.2's relative-luminance formula in
a short Python script (light / dark): the line is 3.37 / 3.72 on the fill, 3.80 / 4.41 on
`--wt-color-surface` and 3.55 / 4.85 on `--wt-color-bg`; the focused label is 5.18 / 5.06 on the
fill; `--wt-color-text-muted` (the resting and floated label, the hint) is 5.43 / 5.95 on the fill
and 5.72 / 6.59 on the disabled fill; `--wt-color-danger` is 5.79 / 5.14 and the value 18.59 /
14.37 on the fill. The focused label has its own token because `--wt-color-primary` as 12px text on
the fill is 4.10 / 4.49, under the 4.5:1 small text needs; the focused LINE is
`--wt-color-primary` itself, which as a non-text mark needs only 3:1. **The fill alone does not
mark a field out** — it is 1.13 / 1.19 against `--wt-color-surface` and 1.05 / 1.30 against
`--wt-color-bg` — so the bottom line is what meets WCAG 2.2's 3:1 for a component's boundary
(1.4.11, non-text contrast). In the light theme the disabled fill is the same colour as
`--wt-color-bg`, so a disabled field on the page background shows only its dashed line. axe does
not check non-text contrast, so the "field tokens" cases in
`packages/ui-core/src/tokens/colors.test.ts` compute the ratios in both themes and fail below 3:1
for the line (on the fill, the surface and the page background) and for `--wt-color-primary` on the
fill, and below 4.5:1 for the focused label, the muted, body, danger and value colours on the fill
and the muted colour on the disabled fill. Two more cases there hold that the
`prefers-color-scheme` blocks give the five tokens the same values as the explicit `data-theme`
ones.

A user-chosen data colour is the one deliberate exception to "no hex, no hardcoded chrome" (no
screen passes `wt-lozenge` one today: categories, its first user, lost their colour on 2026-09-30):
`wt-lozenge` fills its background with that colour directly and computes
black or white text for contrast, because the label still carries the meaning and the colour is
never the only signal. This is a different idiom from the one the floor plan and service statuses
already use for a data colour — a neutral chip with the colour shown only as a border and a dot —
which was tried for categories and declined: a pale colour nearly disappears as a border in the
theme where it's already pale (light colours in light mode, dark colours in dark mode). Reach for
the filled-background idiom only for a colour that is itself the data, never as a shortcut around a
`--wt-color-*` token.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-family-mono` (text read or copied character by character, such as a key or a log line),
`--wt-font-size-sm|md|lg|xl`, `--wt-font-weight-normal|bold`, `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`, `--wt-dialog-max-width`, `--wt-modal-max-width`,
`--wt-modal-inline-margin`, `--wt-modal-inline-padding`, `--wt-form-max-width`,
`--wt-field-max-width`, `--wt-cell-name-max-width`,
`--wt-stepper-field-width`, `--wt-stepper-field-width-wide`, `--wt-price-field-width`,
`--wt-opacity-disabled`, `--wt-opacity-hover`, `--wt-duration-fade`, `--wt-duration-move`,
`--wt-field-height`, `--wt-field-line-width`, `--wt-field-line-width-active`,
`--wt-dropdown-row-height`

The field tokens size the filled form field (see "The field box" under Forms):
`--wt-field-height` (56px) is a labelled field's height, above `--wt-tap-min`, which
`packages/ui-core/src/tokens/structure.test.ts` holds; `--wt-field-line-width` (1px) is the bottom
line at rest and `--wt-field-line-width-active` (2px) the focused or invalid one;
`--wt-dropdown-row-height` (48px) is the least height of a row in `wt-combobox`'s open list.

The type scale is 12px, 14px, 18px and 22px (`--wt-font-size-sm|md|lg|xl`), in each device's own
system font; the app ships no font files (A179, 2026-10-01 — before it the scale was 13, 15, 19
and 24px). Body text is `--wt-font-size-md`: `baseStyles` sets it on the host of each component
that includes it, the dashboard, setup and till shells among them, and each of those apps'
`index.html` sets it on `<body>` for anything drawn outside the app's own element. A size in `rem`
does not follow the scale — it is relative to the browser's 16px root, which none of the three
changes. Pinned in real Chromium by `packages/ui-core/src/tokens/structure.test.ts`,
`packages/ui-core/src/components/wt-card.test.ts` and
`packages/ui-core/src/components/wt-input.test.ts`, and by two cases each in the dashboard, setup
and till app suites: one for the app's own text, one for text on the page outside it.

`--wt-duration-fade` is how long `wt-notice` takes to fade out once its time is up.
`--wt-duration-move` is how long a row takes to slide into its place while a list is reordered by
dragging in `ReorderController` (`packages/ui/src/reorder-table.ts`).

`--wt-opacity-hover` is `wt-button`'s hover feedback (`button:hover:not(:disabled)`) — a plain
opacity dip, the same treatment for every variant. A variant-specific background or border-colour
change would need a distinct value per variant to stay visible in both themes: `--wt-color-surface`
and `--wt-color-surface-raised`, the pair other primitives already hover onto (`wt-tabs`,
`wt-data-table`), are identical in the light theme today, so that idiom would be invisible on
`wt-button`'s own secondary variant, which already rests on `--wt-color-surface`. For the same
reason `wt-combobox`'s option rows hover onto `--wt-color-bg`, not the raised surface: the raised
surface equals the popover panel's own background in the light theme, so a raised-surface hover
would not show.

`wt-button` also exposes its inner `<button>` as a CSS part (`part="button"`), so a consuming
screen can layer its own hover accent onto specific buttons — `wt-button.foo::part(button):hover`
— without changing what a variant looks like everywhere else `wt-button` is used. See "Card action
buttons" under "Page composition" below for the pattern this exists for.

`--wt-dialog-max-width` (`min(90vw, 48rem)`) exists so `wt-dialog` never spells out a literal
`rem` value inline — the no-hardcoded-chrome guard (see below) checks `rem`/`em` sizing, not just
`px`, so any component-level size, including one wrapped in `min()`/`max()`/`clamp()`, must resolve
through a token. `wt-modal` is at most `64rem` (1024px) wide; `wt-dialog` and `wt-help-tooltip`
read their own token and are at most `48rem` (768px). Some add and edit forms are built in
`wt-dialog` rather than `wt-modal` (the ingredient form is one), so they are held to 768px too. Overriding `--wt-modal-max-width` therefore resizes `wt-modal` alone; to resize a
dialog, set `--wt-dialog-max-width` (the till's device chooser does).

`--wt-form-max-width` (`36rem`, 576px at the default text size) is the one standard width of a form
inside a `wt-modal` (owner, 2026-09-30, C105): a field there grows no wider than it, however wide the
modal is. `wt-modal` sets `--wt-field-max-width` to it on its body, and every shared field reads
`--wt-field-max-width` as its `max-width` — `wt-input`, `wt-textarea`, `wt-combobox`, `wt-price-input`,
`wt-number-stepper`, `wt-switch`, and the line that shows a form's message
(`formMessageStyles`, so both the message a dialog shows at the end of its body and the one a
`wt-form-actions` placed in the body shows above its buttons). `--wt-field-max-width` is `none` at
the theme root. It narrows nothing else: a table, a preview, a `wt-disclosure`, a screen's own
paragraphs and the footer's buttons keep the modal's full width. There is one standard modal size;
a screen does not set its own form width.

The six field elements' label, hint and error are inside the element, so the cap holds them too.

Outside a `wt-modal`, `--wt-field-max-width` is the theme root's `none`, so a field on a page, or in a `wt-dialog`
that is not inside a `wt-modal`, is as wide as its container, as before; a `wt-dialog` placed
inside a modal's body inherits the cap. Page forms are bounded by their screen's own column instead
(the setup wizard's raised column, the `max-width` of screens such as backup and sign-in, and the
receipts screen's form column),
so they were left alone. At 390px wide a modal's body is narrower than the token, so a field there
still takes the body's whole width.

A screen that styles its own native control reads the same variable on the element wrapping it
(the venue operations screen's Default checkbox label does). A screen whose own layout
makes a row of fields grow to fill the modal reads it on that row, so a button beside a field stays
beside it: the Printers screen's `.field-row` does, for the calibration wizard's "Print width ruler"
button beside the ruler's answer, and the section member list's `.add` row does, for its Add button
(`apps/dashboard/src/widgets/member-list-editor.ts`, in the section editor's modal;
the Menus screen shows the same editor on a page, where nothing changes). Guards: the form-width
cases in `packages/ui/src/components/wt-modal.test.ts` (`wt-input`, `wt-textarea`, `wt-combobox`,
`wt-price-input`, `wt-number-stepper` and `wt-switch`, and the message at 1280px; wide content and
the footer row at full width; each field at the body's width at 390px; each field at its container's width outside a modal); the calibration case in
`apps/dashboard/src/screens/printers-screen.test.ts`; and one 1280px case each in
`apps/dashboard/src/widgets/add-content-language.test.ts`,
`apps/dashboard/src/widgets/member-list-editor.test.ts` (the editor placed in a `wt-modal`),
`packages/adjustments/src/dashboard/reasons-screen.test.ts` and
`packages/venue-service/src/dashboard/venue-operations-screen.test.ts` (these two measure the
reasons screen's two role `wt-combobox`es and the venue department editor's `wt-input` and
`wt-combobox` fields). A new field primitive that does not read
`--wt-field-max-width` is seen by none of them, and neither is a new screen-styled native control.

`--wt-cell-name-max-width` is one sizing value for the NAME column of a table a form owns, and it
is used in **three different directions**, which its name does not say. Grep for the token before
quoting a list of its consumers — the list here has gone stale once already.

As a **cap** (`max-width`) it is in the variants table (`apps/dashboard/src/widgets/variant-table.ts`)
and the product editor's attached-lists table (`apps/dashboard/src/widgets/product-editor.ts`). The
name is the one cell whose text can be long, so capping it makes the text wrap and keeps the
controls after it (a switch, a row menu) on screen at phone width instead of pushing the row into a
sideways scroll. The variants table no longer relies on the cap for that: measured 2026-09-24 in
the product editor, on the earlier phone layout that still showed a price column, removing it
changed no column at a 390px-wide frame, while in a 1280px frame it held the name column to 231px
against 342px without it. It has not been re-measured since the price moved under the name or
since `wt-modal`'s phone spacing shrank. At phone width it relies instead on its own rule for a
table 30rem wide or less: the price column goes, each price moves onto its own line under the
variant's name, and the name column takes whatever width the grip, Available and row menu
columns leave. The unit dropdown in the price heading goes with its column; the price field
above the table keeps a unit button that changes the same unit. The name is the one column that
may break inside a word; an amount never breaks, so the name column is never narrower than the
widest price. The Available heading is capped by `--wt-tap-min` plus a spacing token, and a longer
heading runs on into the row menu's empty heading. The measurements in this paragraph were taken
at the type scale before A179 (13, 15, 19 and 24px), and none has been repeated at the 12, 14, 18
and 22px one. Measured 2026-09-24 in the product editor at
390px, with `wt-modal`'s old 24px side margin and padding, a four-digit price, the text sizes raised
a step and Verdana standing in for CI's Linux fonts: with the price column the table needed 304px of
a 292px box. The price under the name carries its euro sign (`€1,250.00`, `1250,00 €`) and is drawn
in the small text size, `--wt-font-size-sm`. Measured 2026-09-29 in the product editor in headless
Chromium (Vitest browser mode), with three variants whose widest price is 1250.00, in English and
Spanish, at the normal and raised text sizes, in the default fonts and Verdana; the figure is how
much wider the name cell's content is than the widest price in it, the room left before a price
widens the table, in the tightest case (Verdana, raised sizes). The bare number with no sign, at the
name's size: 75.7px at 390px, 5.7px at 320px. With the sign at the name's size: 51.7px at 390px,
and at 320px with raised sizes the table scrolled sideways by 2px in the default fonts and 18px in
Verdana. With the sign in the small size: 77.6px at 390px, 47.6px at 360px, 7.6px at 320px, and no
case scrolls. Narrower phones fit because `wt-modal` gives up most of its side margin and padding
there (see the `wt-modal` entry below): measured 2026-09-24 with the modal's full 24px margin and
padding, the table at the larger text size needed 268px (280px in Verdana) of a 262px box at 360px,
and at 320px every case but English at the normal size in the default fonts overflowed a 222px box.
Guard: the phone-width cases in `apps/dashboard/src/widgets/product-editor.test.ts`, at 390, 360 and
320px, in English and Spanish, with the text sizes raised, and each again in Verdana. "Raised"
means the small size set to `--wt-font-size-lg` and the body size to `--wt-font-size-xl`, so since
A179 those cases draw 18px and 22px text where they drew 19px and 24px. They check
that the table does not scroll, that each row menu ends inside both the table's box and the frame,
that the price column is hidden and each price sits on one line inside the name's cell, that the
Available heading sits on one line, that the heading's unit dropdown is hidden, and that the price
field's unit button is a tap target on both axes.

As a **flex basis** it sizes the extras list form's product picker, which is a combobox rather
than a table cell.

As a **floor** (`min-width`) it is in the options list form's two single-input cells. An input
alone in a cell has no width of its own, so the automatic table layout shrinks it to `wt-input`'s
tap-target minimum and cuts the value off mid-word; the same value gives it room. That table then
does scroll sideways, which is exactly what the cap exists to avoid — it carries its own focusable
horizontal scroller so the dialog does not scroll instead. **So the two uses disagree about the
sideways scroll.** Whether the floor deserves a token of its own is an open design question, not a
settled convention; it is recorded in `docs/backlog.md` under what Task 11 left open.

### `--wt-tap-min`

Minimum interactive target, 44px, **on both axes**. POS screens are touched under time pressure by
staff who are not looking carefully — a numpad key ("1", "+", "−") fails just as badly if it's
44px tall but only 32px wide as if it were too short. `wt-button`, `wt-input`, `wt-textarea`,
`wt-price-input`, `wt-number-stepper`, `wt-switch` and `wt-combobox` size the element that actually
forms the hit target (the inner `button` for `wt-button`; the inner `input` for `wt-input`; the
inner `textarea` for `wt-textarea`; the inner `input` and the unit button for `wt-price-input`; the
inner `input` and both buttons for `wt-number-stepper`; both `:host` and `.control` for `wt-switch`;
the `.trigger` button for `wt-combobox`) — never an element that can overflow its own container
(see "Hit targets must not overflow their container" below). A field's control (`.field-control`
in `fieldStyles`) takes `min-width: var(--wt-tap-min)` and `min-height: var(--wt-field-height)`
(`wt-textarea` moves the floated label's share of that height into its field box's top padding,
but never lets the textarea itself fall below `--wt-tap-min`, growing the box instead), or
`--wt-tap-min` in a compact field; `wt-number-stepper`'s two buttons are `--wt-tap-min`
wide and fill the field box's height; `wt-switch`'s `:host` and `.control` and
`wt-price-input`'s unit button take `min-width` and
`min-height` of `--wt-tap-min`. `wt-button` takes them at its default size and is exactly
`--wt-tap-min` square with `shape="round"`, but its height depends on `size`: `size="lg"` is at
least 1.4 × `--wt-tap-min` tall, and `size="sm"` only `--wt-space-6`, BELOW the tap target (its
`min-width` stays `--wt-tap-min`).

`min-width` is a floor, not a request: `wt-input`'s inner `<input>` sets both `width: 100%` (to
fill its container) and `min-width: var(--wt-tap-min)`, so in a grid or flex cell narrower than
44px it will **overflow that cell rather than shrink to fit it**. This is intentional — a POS input
that shrinks below the tap-min floor to fit its container defeats the point of the token — but it's
a real, visible layout consequence: if you see a `wt-input` overflowing a narrow cell, that's this
rule working as designed, not a bug. Widen the cell (or the grid track/flex basis it sits in)
rather than the component. `packages/ui/src/tap-target-and-focus.test.ts` mounts every interactive
primitive, including `wt-input`, in a deliberately narrower-than-44px host specifically to guard
this floor — removing the `min-width` regresses that guard.

## Primitives

| Element | Properties | Events |
| --- | --- | --- |
| `wt-button` | `variant` (`primary`\|`secondary`\|`danger`\|`ghost`), `size` (`sm`\|`md`\|`lg`), `shape` (`default`\|`round`), `disabled`, `loading`, `aria-label`, `aria-haspopup`, `aria-expanded`, `aria-invalid` (these four forwarded to the inner `<button>`) | native `click` |
| `wt-icon` | `name`, `size` (`sm`\|`md`\|`lg`) | — |
| `wt-spinner` | `size` (`sm`\|`md`\|`lg`), `label` (the status region's accessible name), `decorative` | — |
| `wt-card` | `raised`; default slot (body), `header` slot | — |
| `wt-disclosure` | `heading`, `summary` (shown under the heading while the section is closed), `summaryFields` (`{ label, value }[]`; when it holds any, the closed line is these instead of `summary`: each value after its bold label and a colon, joined with a middot), `open` (reflected), `has-error` (reflected); default slot (body). The header is a `<button aria-expanded>` and the shadow root delegates focus to it; clicking it toggles `open`. `has-error` forces the section open and makes the header inert, so a section holding a validation error cannot be collapsed out of view | `wt-toggle` — `detail: { open: boolean }` |
| `wt-lozenge` | `color` (a hex string; empty or invalid renders the neutral chip); default slot (label) | — |
| `wt-count-badge` | `count` (renders nothing at zero; shows `99+` above 99), `tone` (`neutral`\|`warning`\|`error`, reflected). It has no accessible name: the control it decorates must say the count | — |
| `wt-toast` | `open`, `tone` (`info`\|`error`, reflected; info is announced politely through `role="status"`, error assertively through `role="alert"`), `message`, `close-label` (required: the close button's accessible name, and an empty one leaves that button nameless), `duration` (milliseconds, default `8000`; `0` keeps it open); `show()` opens it and restarts the full countdown (unless the pointer or keyboard focus is on it, when the countdown waits), which is how to re-announce an identical message. While the pointer or keyboard focus is on it the countdown never runs, even when the message changes; once both have left, the full duration restarts. Positioning belongs to the consumer, which must also register the `close` icon | `wt-activate` — `detail: {}` (the message was pressed; the toast then closes); `wt-close` — `detail: {}` (closed by the timer, the close button, or after activation) |
| `wt-notice` | `duration` (milliseconds on screen, default `4000`; `0` keeps it until the consumer removes it; a new value is counted from when it is set), `reducedMotion` (property only; overrides the `prefers-reduced-motion` query, which is read when the time is up); default slot (the words). An inline status message: the host takes `role="status"` unless given a role, so a change to its words is announced politely. When its time is up it fades out over `--wt-duration-fade`, then hides itself (`hidden`); under reduced motion it hides at once, with no fade. Taken off the page it stops counting, and counts its full duration again when put back. After hiding itself it shows again when put back or given a new duration; a `hidden` its page set while it was showing is kept, and a duration set while it is off the page starts no count until it is put back. It paints no colour of its own, so the consumer colours it (the Printers screen's Bluetooth rows do, through `::part`) | `wt-notice-gone` — `detail: {}` (its time is up and it is hidden). Not `wt-close`, which `wt-modal` and `wt-dialog` send and consumers listen for on them, so a notice inside one would read as the dialog closing |
| `wt-input` | `value`, `label`, `name`, `type` (a date or time type always floats the label, because the browser draws its own format text in the empty field), `autocomplete`, `placeholder`, `hint` (shown inside the empty field as its placeholder unless `placeholder` is set, and always the native input's description; see Forms), `maxlength` (a number passed to the native input; none by default), `required`, `disabled`, `readonly` (see Forms → "The field box"), `invalid`, `error`, `hide-label` (names the input with `label` for assistive technology but draws no label, and makes the field compact); `help` and `end` slots. Drawn as the filled field box (Forms → "The field box"); an action in the `end` slot sits inside the box at its trailing end, and a long label stops short of it | `wt-change` — `detail: { value: string }` |
| `wt-textarea` | `value`, `label`, `name`, `rows` (default `3`), `maxlength`, `placeholder`, `hint` (as `wt-input`'s), `required`, `disabled`, `invalid` (reflected), `error`, `hide-label` (as `wt-input`'s), `spellcheck` (the attribute `spellcheck="false"` turns it off, as it does in HTML), `autocapitalize`; `help` slot. A multi-line field in the filled field box. The `<textarea>` is the `control` part, so a screen can set, say, a monospace font on it through `::part(control)`, and it can be resized vertically only. The floated label's room is the field box's top padding, so text the textarea scrolls never runs under the label, and a resting label sits on the first line's band rather than in the middle of a tall box. Enter inserts a newline: `submitOnEnter` acts only on single-line inputs | `wt-change` — `detail: { value: string }` (on every input) |
| `wt-price-input` | `value`, `label`, `name`, `unit`, `placeholder`, `hint` (shown inside the empty amount as its placeholder unless `placeholder` is set, and always read first in the amount's description, before any error, the sign and a fixed unit; see Forms), `required` (reflected), `disabled` (reflected), `invalid` (reflected; marks the field invalid without a message, as `wt-input`'s does), `error`. `placeholder` shows on the amount only while it is empty, painted `--wt-color-text-muted` in italics. A money field in the filled field box (Forms → "The field box") with a `<button>` inside the box at its trailing end, `--wt-space-1` from its edge, a rounded bordered button of its own, whose visible text is `unit` (which is also that button's accessible name, so supply one). Beside that button the label sits in the amount's part of the box, so a long label stops short of the button; with a fixed unit it spans the whole box. `disabled` locks the amount AND the unit button, so a form that suspends itself while saving cannot be edited through the price. `error` marks the field `aria-invalid` and links the message. `hide-label` names the field with `label` for assistive technology but draws no label, and makes the field compact. `fixed-unit` shows `unit` as plain text rather than a button, for a field whose unit is not chosen here; the field's description then reads the unit after any error, and an empty `unit` draws no unit at all. A fixed unit is text with no box of its own, painted `--wt-color-text`, and `--wt-color-text-muted` while the field is disabled. The amount input is the `amount` part and a fixed unit the `unit` part; a field box holding a fixed unit wraps, so a host can move the unit under the amount with `flex-basis: 100%` on the unit part. The amount box is `--wt-price-field-width` wide where nothing stretches it and no sign is drawn, and fills a wider field unless it carries a fixed unit; a sign drawn by `locale` sits inside the box, and an unstretched box grows by the sign's measured width plus `--wt-space-1`, so the amount keeps the room it had without a sign. A host that lays the field out narrower than that box (a wrapping flex row with a small `min-width`) lets it run under its neighbour; the purchase form's VAT line gives its money fields `min-width: min-content` so the line wraps them instead. `locale` (default empty, which draws no sign) draws the euro sign inside the amount box on the side that locale writes it — before the amount for English, after it for Spanish (the amount then aligned to the sign), `--wt-space-1` from the amount — painted `--wt-color-text-muted`, as the `currency` part, and read in the field's description after any error and before a fixed unit. The label rests like any field's; while it rests on a labelled field that is empty and unfocused, the sign and a fixed unit are hidden under it (`visibility: hidden`) and stay named in the amount's `aria-describedby`, and focus or a value shows them again. With no label drawn they always show. EUR is the only currency; the sign and its side come from `currencySymbol` in `@waitron/shared`, and a dashboard form sets it to `currentLocale()`. It also serves a value in a fixed unit that is not money, such as a percentage: `fixed-unit` with `unit="%"` and no `locale` draws `%` as text beside the narrow amount box and no euro sign, as the bill discount limit in `packages/adjustments/src/dashboard/reasons-screen.ts` does | `wt-change` — `detail: { value: string }` (on input); `wt-unit-click` — `detail: {}` (the unit button was pressed) |
| `wt-number-stepper` | `value` (text), `label`, `name`, `min` (default `0`), `max` (default none), `placeholder`, `hint` (shown inside the empty box as its placeholder unless `placeholder` is set, and always the box's description; see Forms), `required` (reflected), `disabled` (reflected, and locks the box and both buttons), `invalid` (reflected), `error`, `hide-label` (names the box with `label` for assistive technology but draws no label, and makes the box compact, as tall as the buttons), `decreaseLabel` and `increaseLabel` (functions given `label` that return the buttons' accessible names, property only, default "Decrease …" and "Increase …"; set translated ones). A whole-number field in the filled field box (Forms → "The field box"), with − and + buttons inside the trailing end of the box, each `--wt-tap-min` wide and the box's full height, and each disabled at its bound. The buttons use `--wt-color-stepper-button`, darken to `--wt-color-stepper-button-hover` on hover, draw the symbol in `--wt-color-primary`, and have a one-pixel `--wt-color-surface` separator before each; the + button takes the box's top-trailing radius. The field's bottom line runs under the value area and ends at the buttons. A disabled button keeps its fill and fades only its symbol through `--wt-opacity-disabled`, while the box takes the disabled field look. + on a blank or non-number value gives the larger of `min` and 1, never above `max`; − never goes below `min`, so only clearing the box reaches blank. Typing emits exactly what was typed, never a clamped number, so the form's own validation sees a typed 0, a blank or a non-number. Its baseline is the number's, so a row aligned by baseline lines the text up. The box is at least `--wt-stepper-field-width` wide (a stepper whose blank value shows words, from a placeholder such as "No limit" or from a hint, sets it to `--wt-stepper-field-width-wide`, and so does a stepper set beside one, so the two boxes start from the same width; two labels of different lengths that are both wider than that still give two boxes of different widths). A label longer than that widens the box to show it whole on one line, measured at its larger resting size so the box keeps its width when the label floats, and the number fills the widened area before the buttons; in a row too narrow for that, the box narrows again, never below `--wt-stepper-field-width`, and the label is cut with an ellipsis on one line, keeping a required field's `*`; in a row narrower than the box, the stepper overflows the row. The width tokens include both buttons. The label is inset by the number's own `--wt-space-2` padding. Focusing the element focuses the box. The consuming app registers the `minus` and `plus` icons | `wt-change` — `detail: { value: string }` (on typing, and on each step that changes the value) |
| `wt-switch` | `checked`, `disabled`, `label`, `name`, `hide-label` (hides the drawn text while keeping `label` as the native switch's default accessible name), `accessible-name` (overrides the native switch's accessible name, for a row-specific name in a table whose column heading supplies the action). The drawn label is the `label` part, so a host can hide the text in one case only (the extras list form does on a phone) while the switch keeps its name. Its baseline is its label's text, so a row aligned by baseline lines the label up | `wt-change` — `detail: { checked: boolean }` |
| `wt-dialog` | `open`, `heading`, `aria-label` (fallback name when there is no `heading`), `dismissible` (default true; set the property `.dismissible=${false}` so Escape cannot close it, which holds through repeated Escape presses; while it is off and `open` is still true, a close the caller did not ask for shows the dialog again and sends no `wt-close`); default slot (body), `footer` slot. The message of a `wt-form-actions` placed directly in the `footer` slot shows at the end of the body instead, every such row's message joined, and is scrolled into view when it changes and when the dialog opens; a `wt-form-actions` in the body keeps its own message, which the dialog scrolls into view when it changes. Neither is scrolled to when it changes from an `input` event inside the dialog until a zero-delay timer the dialog then sets has run | `wt-close` |
| `wt-modal` | `open`, `heading`, `aria-label`, `dismissible`; default slot (scrolling body), `footer` slot (fixed actions) | `wt-close` |
| `wt-form-error-summary` | `heading`, `errors`. Retiring: a form no longer shows a summary (see Forms); no product form uses it any more; it is deleted once its remaining users, listed in `docs/backlog.md`, are gone | — |
| `wt-form-actions` | `error` (the form's one message about a failed submission: shown on its own line above the buttons, full width (in a `wt-modal`, no wider than `--wt-form-max-width`) and aligned to the start, announced as an alert, painted `--wt-color-danger`); `showError` (property only, default `true`; `wt-dialog` turns it off for each row directly in its footer and shows the message itself); `cancel`, `secondary`, and default slots. The same module exports `formMessage(message)` and `formMessageStyles`, which draw that message for a screen that has to place it itself; a shadow root using `formMessage` includes `formMessageStyles` | `wt-form-error` — `detail: { message: string }` (whenever `error` changes) |
| `wt-help-tooltip` | `aria-label`; default slot | — |
| `wt-tabs` | `items` (`{ key, label }[]`), `value`, `label`; named slots matching item keys | `wt-tab-change` — `detail: { value: string }` |
| `wt-row-actions` | `label`, `icon` (default `kebab`), `iconSize` (property; `wt-icon`'s `sm`\|`md`\|`lg`, default `md`), `align` (`start`\|`end`, default `start` — which trigger edge the popup lines up with; the popup's text starts at the start edge either way); default slot of action buttons; `badge` slot (drawn inside the trigger, in its top trailing corner); `part="popup"` (so a consumer can size the menu); methods `show()` and `hide()` open and close it from code | native events from actions |
| `wt-data-table` | `rows`, `columns` (each has `cell` — `(row, { ancestorOnly }) => content` — and may carry `sortValue`, `searchValue` and a `filter` — `{ label, allLabel, value, options, initial }`, which draws a dropdown whether or not the table is `searchable`, and whose optional `initial` is the option value it starts on while no choice has been made or restored and the column's options include it; and `choosable` — `"shown"`\|`"hidden"` — which offers the column in the column chooser, starting shown or hidden; and `pinned` — `"end"` — which, set on the last column, keeps it at the trailing edge of the table's box while the others scroll sideways), `rowKey`, `rowParent` (opts into tree mode), `collapseLabel`, `expandLabel`, `rowToggleLabel` (`(row, expanded) => string` — names each row's toggle in place of the two fixed labels), `initiallyCollapsed`, `rowGroup` (`(row) => number` — siblings sort by it first, smallest first in either direction, and by the chosen column only within a group, as the Products tree keeps categories above products), `rowCollapsible` (`(row) => boolean` — a branch it refuses is always open, draws no toggle and is never seeded closed), `loading`, `loadingMessage`, `emptyMessage`, `errorMessage`, `aria-label`, `selectable`, `rowSelectable` (`(row) => boolean` — leaves a row without a checkbox, for example a variant that moves with its product), `selected`, `selectionLabel` (`(row) => string`), `selectAllLabel`, `sortKey`, `sortDirection`, `searchable`, `searchLabel`, `searchPlaceholder` (defaults to `searchLabel`), `noMatchesMessage` (default `"Nothing matches your search or filters."`; a dashboard table passes `tableNoMatches()`, below), `filterSearchPlaceholder` and `filterNoResultsLabel` (every column filter's search box text and its no-match text, which a filter shows only above seven rows, its all row included; default `"Search"` and `"No results"`), `columnsLabel` (the column chooser's button text and its group's accessible name; defaults to `"Columns"`), `viewKey`, `searchTerm` (narrows rows as a typed search would while `searchable` is off — for a screen that draws its own search box), `expandAllLabel` and `collapseAllLabel` (in a tree, a toolbar button that opens every branch, reading the second label while all are open), `expandAllIncludes` (`(row) => boolean` — the branches that button opens, closes and counts as open; unset, every branch), `rememberExpanded` (with `initiallyCollapsed` and `viewKey`, keeps the open branches in local storage under `${viewKey}:expanded`), `searchOpensPath` (in a tree, while a search is typed, holds every row above a match open and keeps what is under a match reachable), `rowClick` (`(row) => void` — makes each row clickable via a stretched activator button rendered in the first cell, in a tree too), `rowClickLabel` (`(row) => string` — the activator's accessible name; defaults to `"Open row"`), `rowActivation` (`(row) => "toggle" | "click" | "none"` — in a tree, a "toggle" branch opens and closes from a click or Enter anywhere on its row and draws its arrow as a picture, "none" draws no activator; unset, every row clicks); `empty-action` slot (shown only while `rows` is empty); `toolbar-start` and `toolbar-end` slots (a screen's own controls at the toolbar's start, and at its end before Columns) | `wt-selection-change` — `detail: { selected: string[] }`; `wt-filter-change` — `detail: { filters: Record<string, string> }` (reports a filter you change, not one restored from storage nor a click on the row already chosen); `wt-sort-change` — `detail: { sortKey, sortDirection }`; `wt-expand-change` — `detail: { key, expanded }` (a person opening or closing one branch; not `setExpanded`); `wt-columns-change` — `detail: { shown: string[] }` (every shown column's key, in column order); native events from consumer-provided cells |
| `wt-combobox` | `options` (`{ value, label, icon?, group?, action? }[]`: `icon` is a registered `wt-icon` name drawn before the label and hidden from screen readers; consecutive options with the same `group` render under that heading, inside a `role="group"` the heading names, and the arrow keys step over the heading; an `action` row sends `wt-combobox-action` and never becomes the value or shows as chosen), `multiple`, `value`, `values`, `allowAdd` (`allow-add`), `label`, `name`, `placeholder`, `hint` (shown as the trigger's text while nothing is chosen unless `placeholder` is set, and always the trigger's description, before the error), `required`, `disabled`, `invalid`, `error`, `hide-label` (names the trigger with `label` but draws no label, and makes the field compact), `search` (`"always"`, the default; `"auto"`, which shows the search box only above `SEARCH_THRESHOLD`, 7, options; `"never"`; `allow-add` shows it whatever this says, because the new option is typed into it), `countLabel`, `noResultsLabel`, `searchPlaceholder`, `addLabel`; `help` slot. The one dropdown: the trigger is the control of the filled field box (Forms → "The field box"), showing the chosen option's label (cut with an ellipsis on one line) and a `chevron-down` icon at its trailing end; while nothing is chosen it shows the placeholder or hint, muted and italic, and with neither the label rests. In a single choice the trigger never shows an option whose value is `""` as chosen: it shows the placeholder or hint, muted and italic, though the open list still marks that row chosen (`selectedText` and `isSelected` in `packages/ui/src/components/wt-combobox.ts`). So a real "none" choice that must look chosen takes a non-empty stand-in value that its screen turns back into "none" before it is saved or sent (the Units screen's reassign choice and the product unit dropdowns' Each do this). While the list is open the field box drops its focus marking. The open list is at least as wide as the trigger and otherwise as wide as its longest row, so a row stays on one line; it is never wider than the viewport less 16px unless its trigger is, and is pulled left far enough to leave 8px at the right edge (its left edge stops at the screen's edge); a row too long for that width wraps. The list's rows are at least `--wt-dropdown-row-height` tall and a hovered row paints `--wt-color-bg`; a chosen row's label is bold, and in a single choice the row also carries a `check` icon at its trailing end (a multiple choice shows its checkbox picture instead). A click opens the list scrolled so the chosen row (in a multiple choice, the first chosen row) is in view, without making it the active row. The search box sits on `--wt-color-surface` with one `--wt-field-line-width` line of `--wt-color-primary` all round, `--wt-radius-md` corners and no focus ring, in an area that carries `--wt-shadow-1`. The consuming app registers the `chevron-down` and `check` icons, which `DROPDOWN_ICONS` holds. Its keyboard is described under the table | `wt-change` — `detail: { value: string }` or `detail: { values: string[] }`; `wt-combobox-add` — `detail: { text: string }`; `wt-combobox-action` — `detail: { value: string }` (an action row was picked: the list closes and the value is left alone) |
| `wt-language-chooser` | `active` (the code of the page's language; the parent sets it and the component never changes it), `loadLocales` (property; `() => Promise<{ code, label }[]>`, called on the first open and again after a failed load; defaults to `SUPPORTED_LOCALES`; one load at a time; while it is pending, a second press, Escape, or a press or focus outside cancels the opening, and a further press asks for it again). The language chooser for an app's top bar: an inline element with no footer and no padding of its own, so the bar places it. Its `wt-button` trigger draws two parts: `name`, the active language's full name (from the loaded list, then `SUPPORTED_LOCALES`, then the bare code), shown by default; and `code`, hidden by default and hidden from screen readers, the language's short code (the code's language subtag uppercased — `en-GB` shows `EN` — or a code with no subtag uppercased whole). The trigger's accessible name is always the full name (an `aria-label` the `wt-button` forwards to its inner button), whichever part shows. The app swaps the parts at phone width with its own rule — `@media (max-width: 40rem) { wt-language-chooser::part(name) { display: none } wt-language-chooser::part(code) { display: inline } }` — because a `packages/ui` primitive may hold no literal breakpoint (`packages/ui/src/no-hardcoded-chrome.test.ts`) and a media query cannot read a token; the page's rule beats the component's own hiding, whether it sits in the document or in the shadow root of the app that holds the chooser (both cases in `packages/ui/src/components/wt-language-chooser.test.ts`). Its menu of `menuitemradio` options, each naming its language in full, opens downwards: below the trigger, lined up with the trigger's trailing edge, as wide as its longest option but at least the trigger's width and at most the viewport's width less any scrollbar and 16px, and pulled in far enough to stay 8px clear of both sides of the viewport — so a trigger within 8px of the screen's edge loses the alignment. It is a native popover in the page's top layer, so nothing outside the top layer paints over it — a table's pinned column included — and it moves with its trigger when the window resizes or a container scrolls in the document or in a shadow root whose own tree holds the chooser; a container in a shadow root the chooser is only slotted into is not heard (cases in `packages/ui/src/components/wt-language-chooser.test.ts`). Opening focuses the checked option (or the first); ArrowDown and ArrowUp move between options and wrap, Home and End reach the ends; Escape closes it and returns focus to the trigger, and goes no further only when it closed the menu; a press or focus outside closes it without moving focus; `data-test` hooks `lang-trigger` and `lang-<code>` | `wt-locale-selected` — `detail: { code: string }`; a pick closes the menu and returns focus to the trigger |

`wt-combobox` works from the keyboard like a select. On the closed trigger, ArrowDown, ArrowUp,
Alt+ArrowDown, Enter and Space open the list with the chosen row active (the first row when nothing
is chosen), and Space leaves the search box it opens empty (the "… on the closed trigger opens the
list" cases and "Space on the closed trigger leaves the search box it opens empty" in
`wt-combobox.test.ts`). In a form bound with `submitOnEnter`, Enter on the closed trigger opens the
list and submits nothing ("Enter on a closed trigger in a form wired with submitOnEnter…"). A
printable key on the closed trigger opens a list that has a search box
with that character already searched for; on one without a search box it chooses the next option
whose label starts with the typed text, without opening (the typed text starts again 500 ms after
the last key, pressing one letter again steps on through the options starting with it, an action
row is never chosen, and a closed multiple choice ignores it). In the open list, ArrowDown and
ArrowUp move the active row and wrap at both ends, ArrowUp with no row active going to the last row;
Home and End reach the first and last row; Enter picks the active row (an action row sends its
event), and its default is prevented whether or not a row is active. Without a search box the list itself
takes focus and names the active row with `aria-activedescendant`; there Space picks too (in a
multiple choice it toggles the row and keeps the list open), and a printable key moves to the next
row starting with it. Escape closes the list and returns focus to the trigger, and its default is
prevented and its propagation stopped, so inside a `wt-dialog` it closes the list and not the
dialog. Tab and Shift+Tab pick nothing, close
the list and let focus move on, and focus leaving both the list and the trigger closes it. A press
on the label of a closed dropdown opens the list; a press on the label while the list is open
closes it and leaves focus on the trigger. Opened by a click, the list makes no row active (the
first arrow press goes to the first row, or with ArrowUp the last) but scrolls the chosen row into
view. While the list is open, the arrows, Home and End on the trigger move the active row and put
focus back on the search box or list; when the options change, the active row follows its option by
value (the add row stays active while it is still offered), else the chosen row, else the first,
while a list opened by a click with no row active keeps none; and a `search="auto"` list whose new
options cross the threshold stays open, and focus that was in the search box or list moves to
whichever of them now takes the keys. The "No results" text sits outside the list box; the reason
is in the code (`wt-combobox.ts`, the comment above it).

Set a `wt-data-table` column’s `activatesRow: false` when it has an action separate from `rowClick`.
Clicking blank space in that column does not open the row; its controls keep their own actions. This
also applies to pinned columns.

`wt-button shape="round"` renders a circular button of exactly `--wt-tap-min` diameter, meant for
one icon with its own `aria-label` rather than a text label — the round "Add" button beside a table
heading, for one. It replaces the button's own padding and border radius; it does not change what
`variant` paints.

`wt-button` has no `type` property — see "Forms" below. `wt-button loading` is how a button shows an
action in progress: it disables the button, sets `aria-busy`, and leads the label with a decorative
`wt-spinner` while keeping the label readable — swap the label to what is happening ("Scanning…" /
"Buscando…"), which is then the one thing announced. Existing `?disabled=${busy}` buttons predate
this and are not yet migrated. `wt-spinner` on its own is for a region that is loading; there it is a
`role="status"` live region, so give `label` the localized text.
A third form is a `wt-spinner decorative` beside a status text that itself announces the state
(`role="status"`), as the Bluetooth pairing row in Add a printer does.

Use `wt-data-table` for sortable administrative collections such as people, devices, printers and
canvases. Define columns and cell content in the consuming screen so domain actions stay outside the
primitive. Always supply `aria-label`; use its loading, empty and error properties instead of
replacing the table with unrelated markup. A column can supply `sortValue` for a stable sortable
header and `align: "center" | "end"` for non-text values; cell rendering stays with the consumer.

In the options and extras list forms, the reorder grip and other control columns take only the
width their contents need. The option name takes the spare width; the extras product, quantity and
price columns share it. Control headings can break inside a word, even in English, to stay as
narrow as the controls below them.

A table with no rows draws `emptyMessage` in a padded box with the table's own border, corners and
background, centred, and under it whatever the screen puts in its `empty-action` slot: the screen's
own Add button, rendered there only while its list is empty, so a screen whose Add button also
sits above the table shows it twice while empty (owner, A176). A table with no Add action leaves the
slot empty. A widget that draws a table with an Add button for a screen passes the button through:
`apps/dashboard/src/widgets/staff-list.ts` forwards the slot
(`<slot name="empty-action" slot="empty-action">`), while the Products screen has no Add button in its table: its tree always shows the All products
row, whose menu holds the screen's adds (spec `docs/superpowers/specs/2026-10-02-products-category-tree-design.md`
§3), so its box appears only when a search matches nothing, holding the no-matches sentence. When the first item made from the slotted button empties the slot,
the screen moves focus to its other Add button rather than leaving it on the page. When rows exist
but the table's own search or filters hide them all, the same box holds `noMatchesMessage` and the
slot is not drawn.

The no-matches sentence is one sentence, the same on every screen: `tableNoMatches()` from
`@waitron/dashboard-kit` ("Nothing matches your search or filters." / "Nada coincide con tu búsqueda
ni con tus filtros."), which every dashboard table passes as `noMatchesMessage`, including a table
with no search or filter today, so a filter added later is covered (owner, A177). The empty sentence
stays the screen's own and reads "No <things> yet." ("No extras lists yet.", "Todavía no hay listas
de extras."), except where the table lists the answer to a question rather than things made, such as
the Alerts screen's "Nothing needs attention.", or where the screen hands the table only part of what
was made, such as the Venue operations screen's Tills table, which leaves out revoked devices and kitchen
screens and says "No active tills." A screen that filters its rows before handing them to
the table chooses the empty sentence itself, because the table cannot tell nothing made from nothing
matching: the Orders screen's rows are always the result of its search and filters, so it passes
`tableNoMatches()` as `emptyMessage`; the catalogue browser does while its search box has text; and
the Users and Payments screens do while they hold people or readers that their own filters hide;
and the Units screen's delete dialog always does, because its products table is drawn only when
products use the unit, so an empty one means its search found nothing.

Table cells line up by their first line of text (`vertical-align: baseline`). A flex-row cell takes
its line from its first item, so that item must carry text, or the row uses `align-items: baseline`.
A picture beside the text goes inline with `vertical-align: middle`.

**Style your own cell markup with `part=` and `::part()`, never with a CSS class.** A cell callback
returns a template, but the nodes it produces are rendered by `wt-data-table` and so end up inside
`wt-data-table`'s shadow root — not your screen's. A stylesheet only reaches nodes inside the shadow
root that adopted it, so a `.swatch` rule in your screen's `static styles` silently matches nothing:
the element is in the page, correct in every attribute, and completely unstyled. Put `part="swatch"`
on the markup and write `wt-data-table::part(swatch)` in your screen instead — that crosses exactly
the one boundary involved. A nested primitive (`wt-button`, `wt-lozenge`) is unaffected, because it
carries its own styles wherever it is mounted. Reaching *inside* such a primitive is one boundary
further than `::part()` can select on its own: set the token it reads on the host instead — the
categories screen's muted ancestor row points `--wt-color-text` at `--wt-color-text-muted` through
`wt-data-table::part(name-muted)`, and the button's own ghost-variant rule picks it up by
inheritance. For a property whose token is a shared scale value it would be wrong to redefine
(its padding or weight), or one it reads no token for (an underline), put
`exportparts="button: <name>"` on the `wt-button` and style `wt-data-table::part(<name>)`, as
`apps/dashboard/src/screens/modifiers-screen.ts` does for its Used by count. Cost: the categories
screen's colour swatches, thumbnail boxes and ancestor-row muting
never rendered at all in the browser, through a full review and a green suite — DOM-presence tests
cannot see it, so assert a computed width or colour when you add a styled cell.

**A last column with `pinned: "end"` stays at the trailing edge of the table's box while the other
columns scroll sideways under it**, so a row menu can be kept on a phone's screen without the table
fitting it. It is set per column, and every row-menu column keyed `actions` sets it (A155; guard:
`scripts/pinned-actions-column.test.ts`, weaker than its name: it knows a row-menu column only by
a literal `key: "actions"` and reads only non-test `.ts` files under `apps/` and `packages/`, and never checks that the column is
the table's last; its header lists the rest). The
pinned header and cells paint the row's own
background (`--wt-color-surface`, and `--wt-color-surface-raised` while the row is hovered, or a
clickable row focused), sit above a clickable row's lifted controls, and draw a `--wt-color-border`
line on their leading side from the cell's own `::before`: the table collapses its borders, and in
the 2026-09-30 screenshots a border set on the pinned cell itself showed only once the table was
scrolled to its end, never while the cell was held at the edge. A table with no pinned column puts
no `data-pinned` attribute on any cell. Guards: the pinned cases in
`packages/ui/src/components/wt-data-table.test.ts` and `wt-data-table.a11y.test.ts`, a phone-width
case per dashboard table in its own suite, most built on `expectRowMenusOnScreen`
(`packages/ui/src/test-helpers.ts`) — the alerts and in-use products tables, whose column holds a
button, check it by hand — and `scripts/pinned-actions-column.test.ts`. In a table with
`rowClick`, a click on a pinned cell's empty space opens the row, and a click on anything inside
the cell does not (the pinned-click cases in `wt-data-table.test.ts`).

Supply `rowParent` — a `(row) => string | null` returning the parent row's own key, or `null` for a
top-level row — to switch the same table into tree mode, as the Products screen does for its
variants. A row whose declared parent key isn't present among the current rows floats to the top
level rather than disappearing. Each row that has children gets its own expand/collapse toggle
(`collapseLabel`/`expandLabel` give it a localized accessible name, or `rowToggleLabel` one naming its own row); collapsed state lives inside the
component, not the caller. The table renders `role="treegrid"` with `aria-level`/`aria-expanded` on
each row, and a sortable column sorts each level of siblings independently rather than flattening the
whole tree into one sort. Leave `rowParent` unset for the ordinary flat table — the two modes share
every other property. Set `initiallyCollapsed` when parent rows are summaries and children are
on-demand detail; a branch is seeded closed once, so a later row refresh does not close it again
after the person expands it. When search keeps an ancestor solely to reveal a matching descendant,
the table opens that branch without showing an ineffective collapse control; clearing search restores
the branch's own collapsed state. With `searchOpensPath`, as the Products tree sets it, every row above a match is held open
while a search is typed, even one that matches itself, and what passes the filters under a match
stays reachable, closed as the person left it. With filters alone, only a row kept solely to hold a
match's place is held open. A tree whose box is 380px wide or less indents each level
`--wt-space-2` instead of `--wt-space-4`, and no deeper than four levels. A CSS condition cannot read
a token, so the table watches a tree's box in code and sets a `narrow` attribute on itself while the
box is that narrow; a flat table is not watched.

A tree also answers `isExpanded(key)`, opens or closes a branch with `setExpanded(key, expanded)`
(no event), reports the order it would draw a set of siblings in with `sortedSiblings(rows)`, and
`revealRow(key)` opens every closed branch above a row and scrolls the row into view.

### Remembered, searchable, filterable tables

`wt-data-table` renders its own toolbar when `searchable` is set, any column carries a `filter` or
is `choosable`, a tree has an `expandAllLabel`, or the screen puts a control in the `toolbar-start` or
`toolbar-end` slot.
The search box appears only when `searchable` is set; each column with a `filter` gets one compact
`wt-combobox` (`hide-label`, `search="auto"`) whose "all" row is also its placeholder, whether or not the table is `searchable`, and a row must pass every active filter and the search to show. The
search box is named `search` and each dropdown `<column key>-filter`. The search box grows to fill
the line and the dropdowns sit after it at their natural width; when the two cannot share a line
with the search box at least eight tap targets wide, the dropdowns wrap onto the line below and the
search box takes its line alone (the table's tests measure a stacked toolbar at 360px and a single
line at 1000px). The wrap is sized by the controls rather than a breakpoint because a media or
container query cannot read a `--wt-*` token. A column exposes text to the search with
`searchValue` (falling back to `sortValue`), and offers a dropdown with a `filter` descriptor. A
filter's `value` may return a list, for a row that belongs under several options at once — a
product placed in two sections — and the row then shows when the list holds the chosen option. Pass
`sortKey`/`sortDirection` to choose the starting sort — the table then owns it and emits
`wt-sort-change`.

Give the table a `viewKey` and it remembers its sort and filter choices in the tab's session storage
— never the search text. It restores them once it has columns: a stored sort only if a current
column can still sort by it — its direction is restored with that column or not at all, so the
starting sort stands whole — and every stored filter value that is a string. A `filter` may name
an `initial` option, which it starts on until a choice is made or restored, while the column's
options include it; choosing the "all"
option over it is then stored as a choice of its own (an empty string), so it survives a reload. A
filter choice, restored or picked, narrows rows only while its column offers it, and its dropdown
then shows it. Each time the columns change, every choice is checked against its column. A chosen
option the column's current option values no longer include is cleared — the dropdown returns to
the column's `initial` option when it names one still offered, and to its "all" option otherwise,
and the stored view is rewritten without it — rather than hiding every row behind a dropdown that
reads "all". A chosen option whose column is not rendered, has no `filter`, or has
an empty option list (a screen still loading the data it builds them from) waits instead: it hides
no rows, stays in storage when the view is saved for another change, and is checked when the column
next has a non-empty list. So one `viewKey` can serve two layouts that show different columns. A
stored "all" does not wait: it is kept only while its column is rendered with a `filter` that names
an `initial`, and otherwise cleared and the stored view rewritten without it, so a layout that
leaves the column out forgets that "all" was chosen.

A column marked `choosable` is offered in a column chooser the toolbar draws at its trailing end: a
button reading `columnsLabel` that opens a panel of one labelled checkbox per choosable column,
each named `<column key>-column`, over the table rather than pushing it down. The panel opens inside
the screen, and scrolls its choices when it is taller than the screen. It closes on Escape, which
returns focus to the button, and on a press outside it. A column without `choosable` is always shown and not offered. The last column
still shown cannot be hidden — its checkbox is disabled — and if every column would be hidden, by
the columns' defaults or by a stored choice, the first is shown. A hidden column keeps its filter dropdown, which keeps narrowing rows, and search
still reads it; it stops sorting the rows while hidden, but `sortKey` still names it, so showing it
again restores the sort. With a `viewKey`, the choice is remembered per browser in local storage
under `<viewKey>:columns` as `{ [column key]: boolean }`, apart from the sort and filter memory in
session storage. An entry applies only to a column that is choosable now, and one that is not `true`
or `false` is ignored; blocked storage, malformed JSON or a stored list reads as nothing stored. A
new `viewKey` restores the choice stored under it, or the defaults when there is none.

Every list a dashboard screen or dashboard module shows as its main content with `wt-data-table`
offers the chooser for every column except the one that names the row and the one holding the row's
buttons, which are always shown. A column starts shown unless the screen has a reason to hide it
(the menu Prices tab's combined price does); the table passes a translated `columnsLabel`
(`table.columns` in the dashboard, the menu Prices tab's own `menu_prices.columns`, or the module's
own key) and a `viewKey` of its own. A table inside a dialog or picker does not offer one, and a
list whose only other column is its buttons (servers) has nothing to offer.

In tree mode the table keeps a match's ancestor rows and tells each cell, via its second argument's
`ancestorOnly`, whether the row is present only to hold a descendant's place — mute those with a
`part` on the cell.

Use `wt-modal` for an add or edit form. Its fields stop at `--wt-form-max-width` (see "Structure"
above). Its width is `--wt-modal-max-width` (`64rem`) bounded by the
viewport minus its side margins, and it fills the viewport height with 24px top and bottom margins.
Its side margins (`--wt-modal-inline-margin`) and the inline padding of its body and footer
(`--wt-modal-inline-padding`) are 24px from 800px wide and shrink on a phone to 4px and 12px, so the
width goes to the content. They are fluid `clamp()` values rather than a breakpoint because a media
query cannot read a custom property, and the no-hardcoded-chrome guard
(`packages/ui/src/no-hardcoded-chrome.test.ts`) refuses a literal `px` or `rem` breakpoint in a
`packages/ui` primitive. Unlike `wt-dialog`, it is not held to 90% of the viewport. The body scrolls
independently, so your footer actions stay visible. It uses the raised surface and shadow tokens:
white in the light theme, with the matching dark surface in the dark theme. Put `wt-form-actions` in
its `footer` slot to keep Cancel on the left and Save on the right. The dialog then shows that row's
message at the end of its scrolling body, below the last field, and scrolls it into view — except
when the message changes from an `input` event inside the dialog until a zero-delay timer the
dialog then sets has run, which it takes to be the form re-checking that edit.
Only an edit that fires `input` counts — typing, a native list, a tick box; a `wt-combobox` choice,
a `wt-number-stepper` −/+ button and `wt-price-input`'s unit button fire none, so a re-check they
cause is still scrolled to. The footer holds only the buttons. This needs the `wt-form-actions` itself in the footer slot: one wrapped in
another element keeps its message in the footer. One placed in the body shows its own message above
its buttons:

```html
<wt-modal heading="Add printer">
  <wt-input name="printer-name" label="Printer name"></wt-input>
  <wt-form-actions slot="footer">
    <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
    <wt-button variant="primary">Save</wt-button>
  </wt-form-actions>
</wt-modal>
```

The setup wizard is not a modal: its screens sit in a raised column centred on the page, with the
Waitron logo at the top of every screen (owner decision 2026-09-28, C39).

**A page with a persistent view and one reused `wt-modal` for every edit action** (a settings-style
screen editing itself, as opposed to a list opening a modal per row) has one more thing to get
right: the underlying native `<dialog>`'s `close` event lands asynchronously relative to the
`open` property change that triggers it. If your own code (Cancel, or a successful Save) already
switched to a different mode/state *before* that pending `close` event arrives — because the
caller opened a new edit right after closing the old one — a plain `@wt-close=${() =>
closeHandler()}` will stomp the newer state back to closed. Reproduced only under real timing load
(passed reliably in isolation, failed intermittently in the full suite) — arm a flag when *you*
close the modal programmatically, and have the `wt-close` handler consume-and-ignore it once,
rather than unconditionally acting on every `wt-close`:

```ts
#closingModal = false;
#closeModal(): void {
  this.#closingModal = true;
  this.#edit("view");
}
// in the template:
// @wt-close=${() => {
//   if (this.#closingModal) { this.#closingModal = false; return; }
//   this.#edit("view");
// }}
```

See `apps/dashboard/src/screens/profile-screen.ts` (`#closeModal`) for the full pattern and
`profile-screen.test.ts`'s "a stale close from the previous modal never reopens or reverts a newer
one" for how to reproduce the race deterministically (dispatch the delayed `wt-close` by hand
rather than depending on timing luck).

Since 2026-09-24 `wt-dialog` itself drops a close report that arrives while its native dialog is
open again, so a modal reopened before the report lands no longer emits `wt-close` at all
(`packages/ui/src/components/wt-dialog.test.ts`, "stays open, and reports no close, when shut and
reopened within one task"). A report for a dialog that is still shut does arrive, so a handler that
turns `wt-close` into a Cancel checks that it is still meant to be open, as
`apps/dashboard/src/widgets/product-editor.ts` does. The exception is a dialog with `dismissible`
off whose `open` is still true: `wt-dialog` shows it again and sends no `wt-close`.

Set `open` to show or close the modal. Handle button clicks in your form and listen for `wt-close`
to handle dismissal, including Escape. The native dialog keeps focus inside while open and
returns focus to its trigger on close. Use `wt-dialog` for a compact confirmation.

Variant- and state-like properties (`variant`, `size`, `align`, `name`, `raised`, `disabled`,
`loading`, `decorative`, `checked`, `invalid`, `open`) all reflect to attributes, which is what makes
`:host([variant="..."])`-style styling possible — see "Adding a primitive" below.

Icons are registered by the consuming app, so `packages/ui` depends on no icon library:

```ts
import { registerIcons } from "@waitron/ui";
registerIcons({ check: "M2 8 L6 12 L14 4" });
```

An unregistered `name` renders nothing — there is no broken-icon fallback markup. When a
`packages/ui` primitive itself uses `<wt-icon name="...">` internally (`wt-row-actions`' kebab
trigger, for one), that name becomes part of the primitive's contract: every consuming app must
register it itself, or that primitive's icon silently disappears there. `grep -rn "registerIcons("
apps` lists the registrations; on 2026-10-01 the production ones were `apps/dashboard/src/main.ts`
(registering `DASHBOARD_ICONS` from `apps/dashboard/src/icons.ts`, whose header carries the Material
Symbols attribution), `apps/till/src/till-app.ts`, `apps/till/src/widgets/station-queue.ts`,
`apps/till/src/widgets/menu-browser.ts` and `apps/setup/src/setup-app.ts`. `chevron-down` and
`check`, which `wt-combobox` draws, are `DROPDOWN_ICONS`
(`packages/ui/src/components/wt-combobox.ts`, exported from `@waitron/ui`), which
`DASHBOARD_ICONS` spreads in and the till's `till-app.ts` and setup's `setup-app.ts` register.
Each app's
`src/dropdown-icons.test.ts` mounts a `wt-combobox` and checks that its chevron and its chosen row's
tick draw: the till's and setup's import the app module, so they check the app's own registration;
the dashboard's registers `DASHBOARD_ICONS` itself, so it checks the icon set, not that `main.ts`
registers it. `hamburger` and `kebab` look similar in the abstract ("reveal more") but mean
different things at different scales: hamburger opens the whole app's navigation (used once);
kebab opens a small menu of actions for one specific item (used once per row/card). Giving the
wrong one to either reads as a UI mismatch — a per-row menu answering the "open navigation" icon,
or the nav toggle looking like just another row's overflow menu.

### Selection mode

When you need to act on several rows together, give the list a **Select** button. Show
checkboxes only while selecting, with an action bar for the selected count, actions and
**Cancel**. Clear the selection when you navigate, search or change a table filter, so an
action cannot apply to rows you have just hidden. Cancel clears the selection and exits
selection mode, restoring the ordinary toolbar. It does not cancel a Delete you have
already requested.

For example, selecting Drinks and Bread shows **2 selected** and lets you move both in one
step. Confirm destructive actions in a `wt-modal` with a `danger` button. Keep a refused
action open and show its message at the bottom of the form, so you can correct the choice.
For folder deletion, read what every selected folder contains before enabling Delete.
Empty folders are deleted without asking; otherwise offer moving their contents up as the
default, reversible choice.

### Accessible, clickable labels (`wt-input`, `wt-textarea`, `wt-price-input`, `wt-number-stepper`, `wt-switch`, `wt-combobox`)

All of them associate their visible `<label>` with the control through a real `for`/`id` pair —
not by wrapping the control inside the `<label>` — so the existing layout and font sizing stay
untouched. A named `wt-input` or `wt-combobox` uses that semantic name for its `name` and `id`. An
unnamed legacy input, an unnamed combobox and every `wt-switch` use a module-level counter
(`wt-input-N` / `wt-combobox-trigger-N` / `wt-switch-N`).

- `wt-input name="email"`: `<label for="email">` + `<input id="email" name="email">`. The label
  supplies the input's accessible name through that native association, while automation and
  password managers receive a stable field purpose instead of a generated component id.
- `wt-switch`: `name` forwards your semantic field name to the native input; unnamed switches
  omit it. The same `for`/`id` pairing is what makes clicking the visible label text toggle the
  switch. Because the control also carries `role="switch"` (re-purposing a native checkbox), its
  `<input>` *additionally* sets `aria-label` directly from the `label` property, so the accessible
  name doesn't depend on how a given screen reader resolves a `for`/`id` pair against a
  non-default role.
- `wt-combobox`: the visible `<label>`'s `for` points at the inner `.trigger` button's `id`, which
  is the `name` when one is set and a generated `wt-combobox-trigger-N` otherwise. The trigger also
  carries `aria-labelledby` pointing at that same `<label>`, so the accessible name does not depend
  on the `for`/`id` pair alone.
- `wt-textarea`, `wt-price-input` and `wt-number-stepper` follow `wt-input`: the label's `for` is the
  control's `id`, which is the `name` when one is set and a generated one otherwise.

This is a fix, not the original shape: both primitives used to render `<label>` and the control as
unconnected siblings — no `for`/`id`, no `aria-label` — which left every `wt-input` silent to a
screen reader and made `wt-switch`'s visibly pointer-cursored label inert on click. If you add a
labelled primitive, follow this pattern, not the unconnected-siblings one.

### Accessible names (`wt-button`, `wt-dialog`, `wt-input`, `wt-combobox`)

A shadow-DOM host's own `aria-label` attribute does not reach the focusable element inside its
shadow root on its own — the native `ariaLabel` accessor every `HTMLElement` carries just
reads/writes the host's own attribute, and the host itself has no interactive semantics. Every
primitive that can otherwise end up with no accessible name explicitly forwards one:

- `wt-button`: declares `@property({ attribute: "aria-label" }) override ariaLabel` and binds it
  onto the inner `<button>`. This matters most for icon-only buttons — `<wt-button
  aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>` — where `wt-icon`'s own SVG is
  `aria-hidden` and there is no text content to fall back on.
- `wt-dialog`: gives its `<h2>` a unique id (`wt-dialog-heading-N`, same per-instance-counter
  pattern as `wt-input`/`wt-switch`) and points the inner `<dialog>`'s `aria-labelledby` at it
  whenever `heading` is set. When there is no `heading` (so no `<h2>` exists to point at), it falls
  back to the same forwarded-`aria-label` pattern as `wt-button` — set `aria-label` directly on
  `<wt-dialog>` for a heading-less dialog that still needs an accessible name. The inner `<dialog>`
  also carries an explicit `role="dialog"`, which looks redundant (a native `<dialog>` already gets
  an implicit `dialog` role once shown modally) but isn't: axe-core's `aria-dialog-name` check —
  the rule that actually verifies the `aria-labelledby`/`aria-label` wiring above — only runs
  against elements with an *explicit* `role="dialog"`/`role="alertdialog"` attribute; it does not
  infer the implicit role of a bare `<dialog>`. Confirmed empirically while wiring up
  `wt-dialog.a11y.test.ts`: with the explicit `role` removed, stripping
  `aria-labelledby`/`aria-label` from an open dialog produced **zero** axe violations even though
  the dialog was left with no accessible name at all. Do not remove that `role` attribute — doing
  so silently blinds both `wt-dialog.test.ts`'s `declares an explicit dialog role...` test and the
  a11y suite to a real regression.
- `wt-input`: `invalid` sets `aria-invalid="true"|"false"` on the inner `<input>` as well as
  drawing the red bottom line, so a screen reader user gets the same signal a sighted user gets
  from the line.
- `wt-combobox`: declares the same `@property({ attribute: "aria-label" }) override ariaLabel` as
  `wt-button` and binds it onto the inner `.trigger` button when `label` is empty. The same
  fallback names the panel's search `<input>`, so a combobox named only by a forwarded
  `aria-label` does not leave its search box called just "Search". With `hide-label` and a
  `label`, the trigger is named by `label` and the host's `aria-label` is not used.
- `hide-label` with a `label` names the control from `label` (its `aria-label`) in `wt-input`,
  `wt-textarea`, `wt-price-input`, `wt-number-stepper` and `wt-combobox`.

### Hit targets must not overflow their container

A primitive's tap target must come from the element that actually forms its visible/layout box, not
from an inner control stretched past that box's edges with `position: absolute`. `wt-switch` used to
give the native `<input>` itself `min-height: var(--wt-tap-min)` while it was `position: absolute;
inset: 0`, inside an 18px-tall host — the input stretched to 44px tall and overflowed 24px+ past the
switch, silently stealing clicks from whatever was stacked next to or below it. The fix gives
`:host` and `.control` (the `input`'s actual containing block) the minimum size instead, and lets
the input fill exactly that box via `inset: 0` with no size of its own. If you build a primitive
where the hit target is a covering, invisible native control, size the *container*, not the
control.

### Focus delegation

A primitive that wraps exactly one native focusable control (a single `<button>` or `<input>`) sets:

```ts
static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };
```

Without this, calling `.focus()` on the host element leaves the shadow root's inner control
unfocused — `document.activeElement` becomes the host, but nothing inside its shadow root ever
receives focus, so keyboard interaction and `:focus-visible` styling never engage. A POS needs
"focus the quantity field" constantly (e.g. after adding a line item); `delegatesFocus: true` makes
`wtInput.focus()` actually focus the inner `<input>`.

A primitive isn't a candidate for this when it wraps no native focusable control of its own (a pure
container slotting other primitives, which already carry their own delegation). One that wraps
several can still set it — `wt-price-input` and `wt-combobox` do — and a host `.focus()` then lands
on the first focusable control inside. `wt-number-stepper` places the number box before its two
buttons, so focus lands on the number box.
`grep -n delegatesFocusShadowRootOptions
packages/ui/src/components/*.ts` shows which primitives set it today.

### Forms

`wt-button` has no `type` property. A `<button type="submit">` rendered inside a shadow root is
**not form-associated** — clicking it produces zero native `submit` events, and the enclosing
`<form>`'s `.elements` never lists any `wt-input`/`wt-button` inside a shadow root either. A `type`
property that looked like it selected native submit behaviour but silently did nothing would be
worse than no property at all. Full form association via `ElementInternals`
(`attachInternals().form`, `formAssociated = true`, etc.) is out of scope for this design system —
if a screen needs form-like behaviour, wire it up in JS: listen for `wt-change` on each field and
call your own submit handler on the triggering `wt-button`'s `click` event.

A form says nothing about errors until the operator first presses its primary action (owner rule,
2026-09-28). There is no error summary at the top of a form: it makes the page jump when it clears.
Only the form's own checks ever disable the action; an error that comes back from a request never
does (owner rule, 2026-09-29).

- mark every required field with `required`; `wt-input` renders the visible asterisk and forwards
  the native constraint;
- the primary action works until the first submission. If that submission is invalid, pass a
  plain-language sentence to each invalid field's `error` property, pass ONE localized sentence to
  `wt-form-actions`'s `error` property (it shows on its own line at the bottom of the form, above
  the buttons — in a dialog, at the end of the dialog's body — and is announced), move
  focus to the first invalid field with `focusFirstInvalid(form)`, passing the shadow root when it
  holds only the form, and the form or dialog element when the shadow root holds more (a table,
  other panels), so focus cannot land on a marked control elsewhere on the page, and keep the
  entered values;
- from then on the form re-checks itself on every change: a fixed field loses its message, a field
  broken again gets it back, and the primary action stays disabled while any field still fails the
  form's own checks. When the last one is fixed, the action works again and the bottom message goes;
- an error that comes back from a request — the server refused, a conflict, the server could not be
  reached — never disables the action by itself. When handling it empties or reveals a required
  field, that field's own check holds the action until the field is filled. A refusal whose code or
  params name a field the form shows puts its sentence under that field, and stays there until the
  operator changes that field or submits again — except a sign-in's refusal, which marks no
  field ("A login's refusal never says whether the account exists" in
  [conventions-ui.md](conventions-ui.md)). In the setup wizard the sentence under the field
  speaks about that field alone: a "Check the …" sentence, or one that says what is wrong with that
  field (owner, 2026-09-29, C62). A refusal that names no field the form shows (a
  network failure, a conflict, a field in a language the form does not show) goes in the bottom
  message instead, until the operator submits again;
- the bottom message is the refusal's own sentence when the refusal names no field the form shows.
  When a field is marked — by the form's own checks, or by a refusal placed under it — the bottom
  message is the form's generic sentence, equivalent to "Correct the highlighted fields to
  continue."; a field's own sentence is never repeated at the bottom. A refusal that names no field
  and a marked field together show both, one after the other;
- a folded section (`wt-disclosure`) holding an invalid field opens on a failed submission, so the
  focus lands on the field;
- reopening or resetting a form starts it again: no messages, the action enabled.

Give every field an explicit semantic `name`. Use the standard autocomplete purposes where they
exist: `username` for a login email, `current-password` for a login password, and `new-password`
for password creation and confirmation. A generated name such as `wt-input-2` describes the widget,
not the value, and gives automation nothing useful to work with.

Put an icon-only password visibility button in the input's `end` slot. Toggle the native input type
between `password` and `text`, retain the entered value, and give the button a localized accessible
label that describes its current action: “Show password” or “Hide password”. The slot reserves room
inside the field only while it contains an action.

Put the final action row at the bottom of the form with `wt-form-actions`. Its default slot stays on
the bottom right. Put the expected primary action there. Put Cancel or Back in the `cancel` slot so
it stays on the bottom left (the sign-in code step is an exception; see the login section). A
secondary action that belongs beside the primary action goes in the `secondary` slot. The row's
message runs from the form's left edge only when the row is the form's full width. Where the row
shares a line with something else, show the message with `formMessage` directly before that line,
as the sign-in steps do, or let the row take the full width (in a `wt-modal`, the form width) while
it has a message, as the Add printer dialog's address check does.

```ts
html`
  <wt-input
    name="email"
    autocomplete="username"
    required
    label=${t("login.email")}
    error=${emailError}
  ></wt-input>
  <wt-form-actions .error=${bottomMessage}>
    <wt-button slot="cancel" variant="secondary">${t("action.cancel")}</wt-button>
    <wt-button variant="primary" ?disabled=${attempted && failsOwnChecks}>
      ${t("action.continue")}
    </wt-button>
  </wt-form-actions>
`;
```

**A screen does not draw its own form field.** A `<select>`, a `<textarea>` or an `<input>` that
takes text is drawn by a field primitive; where none fits, add to one or add one. Guard:
`scripts/native-form-fields.test.ts`, weaker than its name — it reads text, and only the literals
of non-test `.ts` files under `apps/` and `packages/`, so a field made with
`document.createElement`, from markup no single literal holds, or with its tag name split across a
`${…}` is invisible to it, and the field primitives' own files, and `wt-data-table`'s (its search
box), are not read at all. It allows some files by name: the hidden username inputs the browser's
password manager reads, in two files, and the print agent's setup page, each held to the number of
lines it draws a field on, so a field swapped for another, a hidden input made visible, or a field
added on a line that already has one passes.

#### The field box

Every field primitive — `wt-input`, `wt-textarea`, `wt-price-input`, `wt-number-stepper` and
`wt-combobox` — draws the same filled field box, from one shared stylesheet, `fieldStyles`
(`packages/ui-core/src/field-styles.ts`; `packages/ui` imports it as
`@waitron/ui-core/field-styles`). The box is `.field`, exposed as the `field` part: a
`--wt-color-field-fill` background with `--wt-radius-md` top corners and square bottom ones, a
`--wt-field-line-width` line of `--wt-color-field-line` along its bottom and no border elsewhere,
at least `--wt-field-height` tall. Inside it sit the label, a real `<label for>` (see "Accessible,
clickable labels"), and the control, `.field-control`, which has no border or background of its
own. The value paints `--wt-color-field-value`; a placeholder or hint paints `--wt-color-text-muted`
in italics.

The box carries data attributes its primitive sets, and `fieldStyles` draws each:

- **The label rests or floats** (`data-label`, from `fieldLabelState`). It rests — centred in the
  box (in `wt-textarea`, on its first line) and at the value's size, because both inherit the field
  box's font size — while the field is empty and unfocused, has no hint and no placeholder, and is
  not a date or time type (`date`, `time`, `datetime-local`, `month`, `week`), whose empty field
  the browser fills with its own format text. Otherwise it floats, at `--wt-font-size-sm` at the
  top left, with the value or hint under it. A value set from code rather than typed floats it
  too. The resting rule also leaves out a box whose control the browser marks `:autofill`;
  `packages/ui-core/src/field-styles.test.ts` checks that the rule is there and parses.
  `packages/ui-core/src/components/wt-input.test.ts` forces Chromium's autofill pseudo-class and
  compares the field's painted fill and bottom line with a plain field in both themes; it does not
  exercise the browser's saved-password flow. Resting or floated, the label is
  `--wt-color-text-muted`. A label longer than the box is cut with an ellipsis on one line; the
  ellipsis is on the label's text, `.field-label-text`, so a required field's `*` after it is
  never the part cut.
- **Focus** (`:focus-within`): the bottom line becomes `--wt-field-line-width-active` of
  `--wt-color-primary` and the label `--wt-color-field-label-focus`. That line is the field's focus
  indicator; the control draws no focus ring of its own. A dropdown whose list is open (`data-open`)
  drops this marking, because typing then goes to the list.
- **Invalid** (`data-invalid`, from `invalid` or a non-empty `error`): the line becomes
  `--wt-field-line-width-active` of `--wt-color-danger` and the label `--wt-color-danger`, and both
  win over the focus marking, so the field `focusFirstInvalid` focuses stays red. The message is a
  paragraph under the box, read after the hint in the control's `aria-describedby`.
- **Disabled** (`data-disabled`): the fill is `--wt-color-field-fill-disabled`, the bottom line is
  a dashed `--wt-field-line-width` line of `--wt-color-field-line` drawn by the box's `::after`, so
  a disabled field is as tall as an enabled one, the label and value are `--wt-color-text-muted`
  (the label stays muted even when the field is invalid), and the cursor is `not-allowed`. A
  disabled field box is not dimmed by `--wt-opacity-disabled`.
- **Read-only** (`wt-input`'s `readonly`, which sets the native input's `readonly`): the value
  cannot be typed over, and no data attribute changes, so the box keeps the editable field's fill,
  line and value colour, and its label floats like any field holding a value — it looks neither
  empty nor disabled. Use it for a value a step shows but does not change: the sign-in screen's
  chosen email, with "Use another account" in its `end` slot.
- **Compact** (`data-compact`, whenever no label is drawn: `hide-label`, or no `label` at all): the
  box's least height is `--wt-tap-min` instead of `--wt-field-height`, which makes a single-line
  field exactly the tap-target height.

What each primitive adds in or around the box — `wt-input`'s `end` slot, the price field's sign and
unit, the stepper's buttons, the dropdown's chevron and list — is in its row of the primitives table
above.

Use `wt-help-tooltip` for short explanations that would distract from the form when always visible.
Give its question-mark button a localized `aria-label`. It opens on click, stays open while you
interact with it, and closes when you press Escape or click anywhere outside it. Place it in the
`help` slot of a `wt-input`, `wt-textarea` or `wt-combobox`, which puts it beside the field box, at
the box's trailing end and centred on it, outside the box, so it never sits in the control's own
click area. `wt-price-input` and `wt-number-stepper` have no `help` slot.

A field's hint is its placeholder, not a line under it (owner, 2026-09-30). The `hint` of
`wt-input`, `wt-textarea`, `wt-price-input` and `wt-number-stepper` shows inside the empty field as
its placeholder, and `wt-combobox`'s as the trigger's text while nothing is chosen, painted
`--wt-color-text-muted` in italics; in a single-line field a hint too long for the field is cut with
an ellipsis. Chromium draws
that ellipsis only while the field is not focused; a focused field clips the hint at its edge
(seen 2026-10-01 in Chromium screenshots of three 250px fields, one
focused; adding `text-overflow` and `overflow` to `::placeholder` did not change it). The
hint is also kept, hidden from sight, as the control's accessible description, because a
placeholder disappears once the field holds a value. A `placeholder` set as well wins: the field
shows it, and the hint is then only the description. Either way a hint is seen only while the field
is empty, so a field that starts with a value (a stepper at 0) shows its hint only once it is
cleared. A paragraph placed beside the `wt-input` cannot be its description: in Chromium an `aria-describedby` naming an id outside the input's shadow root gave the input
no description (measured 2026-09-26 with Playwright 1.63.0's Chromium, reading its accessibility
tree; the same reference inside the shadow root did describe it).

#### A field that falls back to another value

Some fields store a value only to override one they would otherwise take from somewhere else — a
variant's VAT, unit or photo from its parent product, an extra's price from its product's. Such a field is
**empty while it falls back**, and shows the value it falls back to as a placeholder hint, so the operator sees
what will apply without a copy being stored. Leaving it empty keeps the fallback; typing or choosing
a value overrides it; clearing it returns to the fallback and saves `null`. Never mark such a field
required. A translated field inherited as ONE value across its languages (a variant's description)
shows the parent's text as its placeholder hints only while every language is blank; once any
language has text, the record's own value applies and its blank languages show no placeholder hint
(whether they should show the variant's own default-language text instead is open: A220 in
`docs/backlog.md`). A blank description in a language other than the venue's default shows the
default language's description as its placeholder — a product's own, as it is typed, or, on a
variant still blank in every language, the parent's where the parent has none in that language
(`defaultLanguageHint`, `apps/dashboard/src/widgets/form-fields.ts`). That hint is the owner's
decision (A220); no reader fills a missing language with it, and nothing outside the product editor
shows a product description today (the reader check in A220, `docs/backlog.md`).

- **Text and price fields** (`wt-input`, `wt-price-input`, `wt-textarea`): the fallback value is the
  field's `placeholder`. All three primitives paint it `--wt-color-text-muted`, because Chromium's
  default grey measured 3.70:1 on `wt-input` against the dark theme's field (2026-09-24), under the
  4.5:1 text needs. axe does not check placeholder contrast, so an a11y test for a new placeholder-hinted field measures the ratio itself
  (`packages/ui-core/src/components/wt-input.a11y.test.ts`).
- **A single-choice `wt-combobox`** (the product editor's main category, VAT, unit and course): its
  first option has an empty value and reads as the fallback value itself, with no "Same as" before
  it (owner, 2026-10-02: "we just want to show the value"), e.g. "Reduced (10%)"; where the parent
  names nothing it reads as what will be used instead — `categories.uncategorised` for the main
  category, `product.no_course` for the course, `editor.unit_each` for the unit; and where the parent names a category, course or unit the loaded
  list lacks, it reads `editor.missing_choice` ("Unavailable selection"), while the VAT dropdown
  shows the class's code. Its placeholder
  reads the same, in the combobox's grey italic, and is what it shows while the stored value is
  null; it has no separate hint line. A choice that means "none" on a record of its own
  (`editor.unit_each` for the unit and `product.no_course` for the course) is left out where the empty value already means "fall
  back": offering both would read as one thing and save as another.
- **The allergen and dietary pickers**: a muted hint line beside each
  shows the fallback value while the stored value is empty, and goes away once the record sets its
  own. The allergen and dietary lines name the values in grey italic ("Allergens: Milk"), "None"
  where the parent has none (`editor.allergens_none`, `editor.diet_none`) and, for allergens the
  parent has not had reviewed, "Not yet reviewed" (`editor.allergens_unreviewed`) — never "None",
  which would claim a reviewed empty set. A variant's price in the variant table, where it has none of
  its own, is the product's price in the same grey italic. An image shows the fallback picture itself
  (`dashboard-image-upload`'s `inheritedImage`) without a caption or Remove action; its alt text names
  the main product's photo (`editor.inherited_image_alt`). A control whose empty state could also mean "none" (an allergen set,
  a dietary set) saves an emptied choice as `null` — "falls back" — never as an empty set, which
  would declare the record free of what the fallback contains.

A name is not hinted from a parent this way: a variant's names are its own. In the editors of
products, variants, options lists, options and extras lists, a blank kitchen name, and a blank
customer-facing name in the venue's default content language, show the record's own Name as their
placeholder (on a variant, the variant's Name); a blank customer-facing name in any other language
shows the default language's customer-facing name, or Name while that is blank too. Each follows the
field it copies as it is typed (`optionalTextFields`, `apps/dashboard/src/widgets/form-fields.ts`).

### Fold a long form into collapsible sections with summaries

A form that shows everything an entity can carry becomes one long stack of cards, and the fields
somebody actually changes most days get lost in it. Fold the optional detail away instead: keep the
frequently-edited fields always visible and put each group of the rest inside a `wt-disclosure`.
The product editor (`apps/dashboard/src/widgets/product-editor.ts`) is the pattern's first home —
Name, Category, Available, Standalone ordering, Variants and Modifiers stay on screen; Kitchen,
Descriptors and Nutritional info fold; Pricing stays on screen until the product has an Active
variant, and then folds too, with the base price and VAT on its closed line as named values
(`summaryFields`).

Three rules make the fold safe rather than merely tidy.

**Every collapsed section carries a summary of what is inside it**, passed as `summary`, or as named
values in `summaryFields`, so nothing a person has filled in becomes invisible. Build it from the
values themselves, skipping the empty ones, joined with a middot: the Kitchen section reads `Café
c/leche · Drinks` (kitchen name and course). An empty summary means an empty section, which is a
useful signal in itself. A names section (the Options and Extras editors' "Customer-facing names")
puts each language's customer-facing name after its upper-case code — `ES ¿Cómo la quiere hecha? ·
EN How would you like it cooked?` — leaving blank names out, so a section with every name blank
shows no line. It is built by `namesLine` (`apps/dashboard/src/widgets/form-fields.ts`). Those two
editors keep the kitchen name out of the section, as a field of its own directly under Name.

**A section holding a validation error opens itself and cannot be closed again while the error
stands.** That is `has-error`: setting it forces `open` true and makes the header inert, so the
header click does nothing and the chevron stops presenting itself as a live control. Without this,
an invalid submission can point at a field nobody can see. Clearing `has-error` does not re-collapse
the section — the person is left looking at the field they just corrected.

**Sections start collapsed, and open/closed state is not remembered.** A remembered fold is a second
piece of per-person state to get wrong, and it makes two people describing the same screen disagree
about what is on it. In the product editor, the Pricing fold starts open on a product never saved,
whose price and VAT are still being set (owner, 2026-10-02, A219).

A disclosure draws no border and no lines in either state; spacing above and below sets the section
apart (owner, 2026-10-01, A169). The heading and chevron stay exactly where they are when it opens,
the chevron directly after the heading. Closed, the summary sits under the
heading; open, the body shows in its place and the summary is not drawn.

The body is a plain default slot, so the section's content is ordinary form markup and every rule
under "Forms" above still applies inside it — including opening a folded section that holds an
invalid field when a submission fails.

Two notes on the primitives this pattern uses, both in the table above:

- `wt-disclosure` emits `wt-toggle` with `{ open }`, and reflects `open` and `has-error` as
  attributes, so a host can style or query the state from outside.
- `wt-price-input` is the money field a priced form wants: an amount joined to a trailing unit
  button. The button's visible text is its accessible name, so a unit button's `unit` must never be
  empty. A plain money field with no unit is `fixed-unit` with no `unit`, as `priceField`
  (`apps/dashboard/src/widgets/form-fields.ts`) draws it. Its `locale` draws the euro sign in the amount where that language writes it. A fixed-unit value that is not money, such as a percentage, is `fixed-unit` with `unit="%"` and no `locale`, as the bill discount limit draws it. It emits
  `wt-change` on input and `wt-unit-click` when the button is pressed. The product editor draws its
  price field with that button whether or not the product has variants, and opens the unit dropdown
  under the field on `wt-unit-click`. A product with variants also has a unit dropdown (`pricing-unit`)
  in the variants table's price heading. Both change the same product unit, on purpose. A table
  30rem wide or less hides its price column and that dropdown with it, so on a phone the price
  field's button is the only way to the unit. The extras list form's price cells set `fixed-unit`:
  a row shows its product's unit, which is chosen on the product, so a unit button there would be a
  control that does nothing. Where that form is 30rem wide or less, the unit moves under the amount
  as text that breaks inside a word where it must, so a long unit does not widen the table:
  `extra-list-form.test.ts` checks that with "kilogramos", "Unidadesdeembalaje" and a multi-word
  unit name against the one-letter "g". Its price cells pass `locale`, and the field's own growth
  keeps "9999.99" whole beside the sign. Measured 2026-09-29 in headless Chromium with the default
  font at `--wt-font-size-md`, then 15px: "9999.99" is 58.9px wide; with the sign inside a 96px box it had
  56.8px to 57.8px, and with the box grown by the sign it has the 70px to 71px it had without one
  (English and Spanish, with a unit button and a fixed unit). Re-measured 2026-10-01 for A179 in
  headless Chromium (Vitest browser mode, Playwright 1.63.0, macOS) in `--wt-font-family`: "9999.99"
  is 55.5px at 14px, against 59.0px at 15px in the same run; the box figures were not re-measured.

### Dashboard banner

Keep the dashboard's branded banner at the very top of the page, spanning its full width, on the
login screen and every authenticated screen. The menu and page content belong underneath it. The
banner shows the canonical Waitron lockup and the deployment tenant's legal name, not a location
name: one deployment database represents one tenant, while that tenant can contain several
locations. Once a session is active, put the account menu — a person-icon `wt-row-actions` popover
holding Account settings and Log out — at the banner's trailing (right-hand in the shipped locales)
edge. Do not show it before authentication. Below the drawer breakpoint (`48rem`) the banner takes
two rows: the menu toggle, the lockup and the menus share the first, with the lockup shrinking when
space runs short, and the legal name, the mode pill and, in a demo, the email inbox link take the
second in full. The language chooser sits at the trailing edge too, before the alerts bell and the
account menu, signed in and signed out (see "Navigation and language controls"). In a demo, an
"Email inbox" link to `/manage/email` (the Test inbox screen, the address the setup wizard's done
page links to) sits just before the language chooser: signed out it always shows, and signed in it
shows only to a session that may open the Test inbox screen (a manager or an admin). Below the
drawer breakpoint it goes on the second row, after the mode pill, so the lockup keeps its room on
the first.

When the session may see alerts, the alerts bell (`dashboard-alerts-bell`, a `wt-row-actions` with
the `bell` icon and a `wt-count-badge` in its `badge` slot) sits immediately before the account menu.
The badge is red when any open alert is an error and amber otherwise. While there are open alerts,
the trigger's accessible name includes the count, because the badge has no name of its own. The
panel lists at most five alerts and, below the drawer breakpoint (`48rem`), spans the screen's width
less a small gutter. When new alerts arrive while the page is open, a `wt-toast` appears just below the
banner's bottom edge at the trailing edge, and below that same breakpoint spans the banner's width
less a small gutter on each side.

### Dashboard sidebar navigation

A sidebar nav row is a `.nav-item` — a plain flat `<button>`, not `wt-button`. `wt-button`'s own
box (border, background, bold text) is right for a page action, but a sidebar lists ~20 of them;
stacking that many buttons reads as a wall of buttons, not navigation. A resting row is
`--wt-color-text-muted`, not full-strength text — at equal weight and colour, ~20 items compete
with the group headers above them and bury the current page's accent in a crowd of equally dark
siblings. The selected item carries `aria-current="page"` and is styled from that attribute: an
accent-coloured leading edge plus bold, full-strength coloured text, no background fill — the same
idiom `wt-tabs` already uses for its selected tab (`border-bottom-color` there,
`border-inline-start-color` here), not a new one — and it is now the one loud thing in an otherwise
calm list. Hovering a row moves it to full-strength text plus a `--wt-color-surface` background —
visible here because the sidebar itself sits on `--wt-color-bg`, unlike `wt-button`'s own secondary
variant (see `--wt-opacity-hover` above). A `.nav-group` header takes a small-caps treatment
(uppercase, `letter-spacing: 0.04em`) so it reads as a label, not a fainter link.

A headed group (the pinned first group — Overview, Sales — has no header and is never collapsible)
is also its own disclosure toggle, except while a search term is typed (below): the header is a
`<button>` with `aria-expanded` and `aria-controls` pointing at its item list, a `chevron-down`
`wt-icon` that rotates 180° when expanded (pointing down at rest — "expand this way" — up when open
— "collapse"). Every headed group starts collapsed (owner decision 2026-09-28, replacing
expanded-by-default). Collapsed state is a plain `Set<NavGroupId>` in component state, not
persisted, so each load starts collapsed again — except the group holding the page it opens.
Whenever the current screen changes (the first load, a reload, the Back button, a nav click, a
search pick), and whenever a nav row or a search pick opens a page even if it is the page already
shown, that page's group is taken out of the set, so it shows open. After that its header collapses
and reopens it like any other group's (A161, owner 2026-09-30): a header click records the opposite
of what the header shows, and outside a search the header's `aria-expanded` and the item list's
`hidden` follow the set alone. A collapsed group holding the current page hides that page's row;
arriving at another page in it opens it again. A group opened on arrival stays open after you leave
it, as one opened by hand does.

A search box sits at the top of the sidebar, above the groups: a `wt-input type="search"` with
`hide-label`, named `nav-search`, whose hidden label (its accessible name) and placeholder are both
**Search pages**. A staff session sees My schedule and Orders in its sidebar, without a search box.
While the box holds a term (spaces trimmed), the nav
shows only the pages whose label in the current language contains it, ignoring case and accents
("categorias" finds "Categorías"), plus every page of a group whose header contains it. The search
narrows the rows the nav would already show, so a page this person may not open never appears,
however exactly its name is typed. A group with no match is hidden, header and all. A group with a
match shows open whatever its collapsed state. While a term is typed each shown header stops being a
collapse control: it is a plain `<div>` with no `aria-expanded`, no click handler and no chevron (an
empty space of the chevron's width keeps the label where it was), so clicking one changes nothing.
Picking a page opens its group, as any arrival does. When nothing matches, the nav says **No pages
match.** in a `role="status"` message. Enter opens the first page shown, in nav order, and does
nothing when nothing matches or the box is blank.
Opening a page from a search, by Enter or by click, clears the term and closes the phone-width
drawer, as any nav click does. Escape clears a term and goes no further, so an open drawer stays
open; Escape in an empty box closes the drawer as it does anywhere else in the shell. An Enter or
Escape reported with `isComposing` set (an input method's composition) is left alone: it opens no
page, clears no term, and the shell's Escape handler does not close the drawer for it. The rows are
keyed by page, so at desktop width a result row pressed with Enter or Space keeps focus once the
full list comes back. A language switch keeps the term and searches the new
language's labels, and signing out empties the box.

A group that has ITS OWN scrolled-to items shrink when collapsed can leave the sidebar's
`scrollTop` past the new (shorter) scrollable range — the browser then clamps it down on its own,
snapping every visible row upward even though nothing above the clicked header moved. `#toggleGroup`
records the clicked header's own on-screen position before the toggle and corrects `scrollTop` by
the same delta once the DOM has updated, so the header stays where it was clicked. This can't
always be perfect — if the collapsing group's own items were propping up enough scroll range to
reach that position in the first place, restoring it exactly may be mathematically impossible once
they're gone — but it always gets as close as the remaining content allows, which reads as "stayed
put" in every case that matters (the group being collapsed isn't the last thing wedging the page
open). A group header can also carry an `icon` (a registered `wt-icon` name) — kept rare, used only
where it's as unambiguous as Settings' gear; most groups have none.

The sidebar and the content column both scroll independently, bounded to the space below the
banner (`.shell { height: 100%; max-height: 100vh }` filling `apps/dashboard/index.html`'s body,
which is one window tall with its padding inside, and `.sidebar`/`.main` both `max-height: 100%;
overflow-y: auto`) — the page itself never scrolls. Before this, only `.sidebar` was self-contained
(`max-height: 100vh`); `.main` just grew with its content and pushed the whole page taller, so once
a screen exceeded one viewport the sidebar — capped to one screen — visibly stopped short of where
the page actually ended. Both panes now share the same bound, so they always end at the same line.

### Dashboard authentication

Show **Please log in to continue** above the initial Email field and offer passive passkey autofill
when the browser supports it. Continue opens the password form for an email without a saved method.
An opted-in preference can select the returning method, but a modal passkey prompt still needs an
explicit action. Navigation, refresh, logout and session expiry must leave that prompt closed.
Never use server-side account status or passkey enrolment to select a public screen, because the
difference would reveal whether the account exists or has a passkey.

On method screens, use **Login with password**, **Login with passkey** or **Login with Google** as the heading. Show the
address in a read-only `wt-input` labelled Email (owner, 2026-10-02, A189), so its text lines
up with any other field on the step, with an accessible change-account icon in its `end` slot. That
icon clears both the current attempt and the saved email/method, then returns to blank email entry.
The reset and account-setup page and the passkey offer after sign-in show the same field without
the icon. The password step, the code step and the reset and account-setup page also keep a hidden
semantic username input for password managers; the read-only field is named `chosen-email`, so
that hidden input stays the only field named `email`. Ordinary login has no separate Cancel or
Forget button.

On password, passkey, Google and code screens, a step's other ways in are ONE persistent bulleted list of links, directly
after the step's field or hint, and after its refusal when one shows. On the password screen **I've forgotten my password** is its first
item, then the other ways to log in. The step's buttons sit on the row of the list's first item, at
the right; where that row is too narrow for both, they wrap below the list, still at the right. On
a form at its full width only the first link has to fit beside the buttons, and a longer later link
breaks inside the list; on a narrower form the row is sized by the widest link. On the code screen
Back therefore sits beside Log in at the right, an exception to the Forms rule that puts Back
bottom left. A refusal's message sits on its own line above the list and the buttons, from the
form's left edge.
Recovery opens **Check your email** with the address, delivery
guidance and a one-minute resend countdown. Use the same public acknowledgement for every address:
pending accounts receive a setup link and active accounts receive a reset link. Invitation emails
use links; the login screen has no manual invitation-code entry.

Offer **Remember my email on this device** only on initial email entry. Save the authenticated email
and successful method in localStorage only when selected; unchecked Remember writes neither local
nor session storage. Keep the current email in component memory while you change methods. Saving a
shortcut neither stores credentials nor extends the authenticated session, and one account's consent
must not carry over to a different account selected by a passkey or Google. Cancelling or completing an account-activation link leaves an unrelated saved shortcut alone; that flow has no Remember choice.

Keep an authenticator or recovery code off the password form. Request it on a separate screen only
after the server accepts the password and says the account requires a second factor. Keep the
password in component memory for the second request, and issue no session before both checks pass.

Account setup and password-reset links validate their action before showing new credentials. Show
the language chooser and the server-confirmed email on these forms. An invalid or expired action
can request a replacement with the same acknowledgement for every account state.

Three routes reach the optional passkey offer. Accepting an invitation signs the person in as part
of setting their password, so the offer follows straight away. A password reset signs nobody in, so
it sends the person to a normal sign-in first, including any enrolled second factor, and the offer
follows that sign-in. Both of those link routes always offer. An ordinary password sign-in offers as
well, but only when the server says to: someone who holds no passkey and has never settled the
offer. That answer arrives on the authenticated sign-in response itself, and must never come from
asking before sign-in whether an account exists or holds a passkey. Signing in with a passkey makes
no offer, because the person already holds one, and a Google sign-in ends in a redirect the login
screen never reads a response from, so it makes none either.

Ask for a recognizable passkey name on the offer screen. When the sign-in that led there used a
recovery code rather than an authenticator code, ask for a current authenticator code too, before
registering anything. Both ways out — adding a passkey and skipping — record that the offer has been
settled, so it is made once rather than at every sign-in, and both then sign the person in.
Recording is bookkeeping and never a gate: when it fails, sign the person in anyway, because the
worst that follows is being offered once more.

The authenticator setup screen presents the enrolment URI as a QR code, keeps the setup key behind
a manual fallback, and enables the factor only after the server accepts a current six-digit code.

Every authenticated dashboard banner includes a way to reach **Your profile** — the account menu's
"Account settings" item — including for staff with their two-page sidebar. Profile edits cannot expose role
or suspension controls.

### Empty slots don't reserve space

`wt-card`'s `header` slot, `wt-dialog`'s `footer` slot and `wt-data-table`'s `empty-action` slot
only add their spacing/divider when something is actually projected into them — an unused slot must
not leave a spurious gap or a bare bar in the layout. The three primitives get there differently:

- `wt-card` does it in pure CSS: the header's `margin-bottom` lives on `.header ::slotted(*)`, so
  it only applies when there is slotted content for that selector to match.
- `wt-dialog` does it imperatively: `updateHasFooter()` reads `assignedNodes({ flatten: true })`
  off the footer slot — once on first render, again on every `slotchange` — and toggles a
  `.has-content` class that the footer's padding and top border are conditioned on.
- `wt-data-table`'s `empty-action` slot sits in a flex column whose spacing is its `gap`; the
  slot has no fallback content and a `<slot>` is `display: contents` by default, so with nothing
  assigned it adds no flex item and no gap. Guard: "an empty table whose screen puts nothing in the
  empty-action slot draws a box the same height as the no-matches box" in
  `packages/ui/src/components/wt-data-table.test.ts`.

If you build a primitive with an optional slot that carries its own spacing, use one of these
patterns rather than reserving space unconditionally.

## Page composition

The rules above cover individual primitives; a screen built only from them with no further
guidance drifts into an unstructured stack of label/value pairs. These rules cover how to arrange
primitives into a settings- or detail-style screen. `wt-data-table` and `wt-tabs` (see "Tabbed
management pages" below) already carry their own composition guidance — this section is for
everything else, built from `wt-card`, `wt-input`, and `wt-button`.

### Group related fields into cards

One `wt-card` per logical group. Give the group a small label above the card — not inside it —
`--wt-font-size-sm`, bold, uppercase, `--wt-color-text-muted`. Inside the card, each field is a
row: label on top, value below, both left-aligned:

- field label: `--wt-font-size-sm`, normal weight, `--wt-color-text-muted`
- field value: `--wt-font-size-md`, bold, `--wt-color-text`

A group label and a field label are both small and muted; only the group label is bold and
uppercase. That distinction is the entire signal separating "this is a section" from "this is a
field" — apply it consistently or it stops working. (No page-content screen currently groups
fields into cards with a standalone group label above them — profile-screen.ts, the pattern's
original home, moved to `wt-tabs` instead — so this is the rule for the NEXT screen that needs it,
not a description of one that exists today; see the "Typography roles" table below.)

Separate rows with a `--wt-color-border` hairline ONLY where a row carries its own action (Password,
a passkey, "Add") — a plain field/value row (label on top, value below, no button) carries no
divider at all; between two of those, the extra line was clutter, not structure. Among rows that DO
get one, the first row in its container carries none, since the hairline marks the boundary between
rows, not a top border on every row.

### One action per row or card — matching what it actually opens

Never give a row a generic "edit this" affordance (a chevron, an icon) when the action actually
opens something bigger than that one field, and never give a card a single action when each row
inside it does something different. Four shapes cover what's needed so far:

- **A card edited as one form** (e.g. name, phone, email and language together): one "Edit" action,
  not per-row. Ordinarily that sits in a footer below the last row, separated by the same hairline
  border the rows use — UNLESS the card's own content is already wrapped in its own outer modal (a
  page-level entity like "Your profile" below), in which case Edit moves into that outer modal's own
  `wt-form-actions` footer instead, next to Close, rather than duplicating a second footer one level
  in.
- **A field whose value can't be shown** (a password, a PIN): don't render a fake masked value —
  there's nothing real to show. Put the label and its one action ("Change") on the same row.
- **A repeatable list** (passkeys and content languages today; the same shape applies to printers, staff, devices): each
  item is its own row carrying its own action ("Remove"), and an "Add" action sits in the same
  footer position the single-form case uses for "Edit".
- **A purely informational card** (a status sentence, nothing to edit): just the sentence, muted,
  with no action — unless there's actually something to configure, in which case that's the
  card's one action.

Every one of these actions opens a `wt-modal`, not an inline mode-swap that replaces the whole
page — the view stays on screen, dimmed behind the modal, exactly like a list opening its "Edit"
modal per row (`person-edit.ts`). This fixes two things an inline swap gets wrong on a page built
from these cards: the edit form no longer needs to fit the page's own (narrower) width, since a
modal sizes itself independently; and there's no more "why doesn't the current page highlight in
the sidebar while editing" confusion, since the page never stopped being the page. See "Card action
buttons" below for the button styling this pairs with, and the `wt-modal` entry under "Primitives"
above for the close-event race a shared, reused modal needs to guard against. One exception (C111,
owner 2026-09-30): Content languages' Set as default and Remove save straight away, without a modal
(removing a language keeps its translations); its Add language still opens one. A language the
venue's region requires has no Remove and shows "Required".

**A screen that isn't itself a navigable destination is the whole page in a modal, not just its
edits.** `dashboard-profile-screen` (Your profile) has no sidebar entry and is reached from the
banner on any face — `dashboard-app.ts` treats it as a boolean (`profileOpen`), never a `screen`,
and wraps the whole thing (the view-mode cards from above, not only the per-field edit modals) in
one outer `wt-modal` that opens over whichever face is current and closes back to it. This is what
the "one action opens a wt-modal" rule above already gives you, applied one level up: the page's
own per-field edits still open THEIR OWN modal exactly as documented, which now nests inside the
outer one — the same relationship a list has with its own per-row edit modal, just with the list
itself also being a modal here since it has no page of its own to be a list ON. Two things this
nesting makes non-optional, not just good practice:

- **`wt-close` is `composed: true` and bubbles**, and two modals in the same ancestry both listen
  for it — without a target === currentTarget guard, dismissing the INNER modal also dismisses the
  outer one, since its close event bubbles straight through it on its way up. Both modals in this
  pair guard for exactly this (`dashboard-app.ts`'s outer one and `profile-screen.ts`'s own inner
  one, even though nothing nests inside IT today) — reproduced live: Cancel on the inner "Your
  details" form dropped all the way back to the page behind Your profile, not back to Your
  profile's own view.
- **Mount the inner content only while the outer modal is actually open.** `dashboard-profile-screen`
  fetches on `connectedCallback` (`getProfile`/`getLocales`/`getGoogleConfig`); mounting it
  unconditionally alongside the modal (rather than gated on the SAME `profileOpen` the modal's own
  `.open` reads) would make every session pay for those calls on every page load, whether or not
  anyone ever opens their profile.

Reachability by URL still matters here even though it isn't a real destination: `/manage/profile`
opens the modal on load, with the underlying face resolving to this person's ordinary default
(never a page literally named "profile" — `#permittedScreen` never sees that value, since
`#applyRequestedScreen` intercepts it first) — closing the modal REPLACES the URL with that
underlying face's own path, so "profile" never lingers as its own stop in Back-button history.
Opening it (the banner's account menu, or the auto-open after account setup) PUSHes instead, the
same as selecting a real nav item, so the browser's own Back button closes it like any other
navigation.

### Card action buttons: calm at rest, accented on hover

A card or row's action button (Edit, Change, Add, Remove, Set up, Disable, Replace, Confirm) stays
`secondary` (plain/outlined) **at rest**, regardless of what it does — filling every action solid
at rest (an earlier version of this rule made "primary" mean "the card's one forward action" and
painted it blue always-on) reads as visual noise once a screen has several cards, each with its own
"primary" fighting for attention, and different-length labels at solid fill read as mismatched
pills. Colour appears only on **hover**, via `wt-button`'s exposed `button` CSS part:

```css
.card-action.accent-primary::part(button):hover {
  border-color: var(--wt-color-primary);
  color: var(--wt-color-primary);
}
.card-action.accent-danger::part(button):hover {
  border-color: var(--wt-color-danger);
  color: var(--wt-color-danger);
}
```

Use `accent-primary` for a forward/constructive action, `accent-danger` for one that removes or
disables something, and neither class for a purely maintenance action ("Replace recovery codes"
when 2FA is already on) — it gets only `wt-button`'s own generic hover dim. This is deliberately
**not** a change to what `variant="primary"`/`"danger"` mean on `wt-button` itself — those still
render solid at rest everywhere else (the till's checkout button, for one, needs to read as
"the important action" without anyone hovering it first, and there is no hover on a touchscreen at
all). The part hook lets a screen layer an accent onto specific buttons without touching that
contract.

Give every card action a fixed `min-width` (`ch`-based — see `--dashboard-sidebar-width` in
`dashboard-app.ts` for the same reasoning) so a row of differently-worded actions still reads as
one uniform set rather than a jumble of pill widths, and keep labels short — reuse the small shared
`action.*` vocabulary (`action.edit`, `action.remove`, `action.add`, `action.change`,
`action.setup`, `action.disable`, `action.replace`, `action.confirm`) rather than spelling out what
the surrounding row or card label already says. Where a short label repeats more than once on the
same screen for genuinely different things (two "Change" buttons, for Password and PIN; two "Set
up" buttons, for the authenticator and Google), give each an `aria-label` with the fuller wording —
otherwise a screen reader's "list all buttons" navigation can't tell them apart. A label that
appears once on the screen doesn't need one, matching the sitewide bare "Edit"/"Remove" convention.

Right-align a card's footer actions (`justify-content: flex-end`) — the same "primary action
bottom-right" rule `wt-form-actions` already applies to forms sitewide (see "Forms" above).

### Spacing rhythm

Using the existing `--wt-space-*` scale:

- `--wt-space-6` between the page title and the first group label
- `--wt-space-5` between one card and the next group label (i.e. between whole sections)
- `--wt-space-2` between a group label and its card
- row padding inside a card: `--wt-space-3` vertical, `--wt-space-4` horizontal

### Left-anchor narrow content — don't centre it

A narrower `max-width` on a settings/form screen keeps line length readable, but the screen itself
stays anchored to the body's left padding, the same as a full-width `wt-data-table` screen — never
`margin-inline: auto`. Centering a narrow screen in the *remaining* space beside the sidebar makes
it read as a visually different app from the wide table screens next to it; anchoring both to the
same edge and varying only the width does not. `backup-screen.ts` and `receipts-screen.ts` (its
form column) already follow this (`max-width` alone). `profile-screen.ts` no longer applies here at all — it isn't a
screen positioned beside the sidebar any more; it's a modal, bounded by `--wt-modal-max-width`
like any other, and its fields stop at `--wt-form-max-width`. The one legitimate exception among actual screens is a full-page one with no
sidebar at all, like the login screen — centering a freestanding form with nothing to anchor to is
the normal, expected treatment there.

### Typography roles

| Role | Token(s) | Example |
| --- | --- | --- |
| Page title | `--wt-font-size-xl`, bold | a screen's own `<h1>` — "Your profile" no longer qualifies: it's a `wt-modal` heading now (`--wt-font-size-lg`, its own role, not this one) |
| Group label | `--wt-font-size-sm`, bold, uppercase, muted | the receipts screen's section headings (`apps/dashboard/src/screens/receipts-screen.ts`); the nav's own small-caps group header is styled separately (primary-accent, not muted — see "Dashboard sidebar navigation" below) |
| Field label | `--wt-font-size-sm`, normal weight, muted | "Name" |
| Field value | `--wt-font-size-md`, bold | "Clinton Gormley" |

`wt-button` carries its own type sizing through its `size` property — these roles cover page text,
not button labels.

The till and kitchen-display surfaces reuse the same tokens but have their own constraints (touch
targets, glanceability at a distance) that these rules don't yet cover; treat them separately
rather than assuming this composition applies unchanged.

## Event discipline

Custom events crossing a shadow boundary are `composed: true`. A native event that is itself
composed, such as `input`, also crosses that boundary, so re-emitting it without care makes the
consumer see the change twice. Native `change` is not composed (the measurement is under "Event
discipline" in [conventions-ui.md](conventions-ui.md)). **Always `stopPropagation()` the native
event before dispatching your own.** `wt-input` and `wt-switch` are the reference implementations.

Custom events are named `wt-*` and carry data in `detail`.

## Testing

Component tests run in real Chromium via Vitest's browser mode and its Playwright provider
(`@vitest/browser-playwright`), not jsdom — the things being asserted (computed styles,
`adoptedStyleSheets`, shadow-DOM event composition) don't exist in a DOM simulator. Shared test helpers live in `packages/ui/src/test-helpers.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

test("paints from the primary token", async () => {
  const el = await mount('<wt-button variant="primary">Cobrar</wt-button>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const button = el.shadowRoot!.querySelector("button")!;
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(1, 2, 3)");
});
```

- `mount(html)` — creates a fresh `<div>`, appends it to `document.body`, calls `applyTokens` on it
  (making it its own theme root), sets `innerHTML` to `html`, awaits the mounted element's
  `updateComplete`, and returns that element (the markup's first child).
- `host` — a live binding to the wrapper `<div>` from the most recent `mount()` call. Set token
  overrides on it (`host.style.setProperty(...)`) to prove a component reads a token rather than
  hardcoding a value.
- `cleanup()` — removes every host mounted since the last call. Call it from `afterEach`.
- `chooseOption(el, value)` — picks `value` on a single-choice `wt-combobox` (it sets `value`,
  never `values`, so it cannot drive a `multiple` one): sets `value`, sends the `wt-change` a
  click on a row sends, with `detail: { value }` (bubbling and composed), and awaits the render.
  Unlike a click, it neither closes the list nor moves focus to the trigger. It is for a screen test
  that picks an option without driving the list; an app's test imports it as
  `@waitron/ui/src/test-helpers.js`. Its case is in `packages/ui/src/test-helpers.test.ts`.

### Accessibility testing (axe)

Every primitive also gets an automated accessibility test, in `packages/ui/src/components/*.a11y.test.ts`
(the `.a11y.test.ts` suffix keeps it out of `no-hardcoded-chrome.test.ts`'s component glob, same as
`*.test.ts`). These run [`axe-core`](https://github.com/dequelabs/axe-core) — the real engine, not
`vitest-axe`/`jest-axe` (those target jsdom; this project runs real Chromium) — directly against the
mounted, shadow-rooted markup. Shared helpers live in `packages/ui/src/a11y-helpers.ts`:

```ts
import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-button a11y (%s theme)", (theme) => {
  test("icon-only button", async () => {
    await mountThemed(
      '<wt-button aria-label="Cerrar"><wt-icon name="close"></wt-icon></wt-button>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
```

- `mountThemed(html, theme?)` — `mount()`, plus paints the host's own `background` from
  `--wt-color-bg` (exactly what `packages/ui/index.html`'s `.panel { background: var(--wt-color-bg) }`
  does) and, if `theme` is passed, sets `data-theme="light"|"dark"` on the host. Without the painted
  background, a component with no background of its own (e.g. `wt-switch`'s `<label>`) would be
  contrast-checked against the browser's default white page background regardless of theme —
  meaningless for dark mode.
- `expectNoA11yViolations(context)` — runs the full default axe ruleset against `context` (almost
  always `host`) and fails with a readable message (rule id, impact, offending selectors) if axe
  finds anything. **The ruleset is never narrowed** — every caller runs the same, full default set;
  narrowing it to make a test pass is exactly the kind of box-ticking this exists to prevent.

**Shadow DOM is the whole point here** — every interesting element in these components (the actual
`<button>`, `<input>`, `<dialog>`, ...) lives inside a shadow root, and `axe.run()` does traverse
into open shadow roots automatically. `a11y-helpers.test.ts` is the standing proof of that: it mounts
an icon-only `wt-button` with a deliberately missing `aria-label` (so the only accessible-name
candidate — the `<button>` — lives entirely inside the shadow root) and asserts axe's `button-name`
rule actually fires. Do not trust a green a11y run on a shadow-DOM component you haven't seen this
kind of test go red first.

**A rule not firing is not the same as a component being accessible.** While building this suite,
stripping `wt-dialog`'s `aria-labelledby`/`aria-label` produced zero axe violations until an explicit
`role="dialog"` was added to the inner `<dialog>` — axe's `aria-dialog-name` check does not infer the
implicit role of a bare native `<dialog>` (see "Accessible names" above). Breaking a component and
watching the relevant test *fail* is not optional busywork; it is the only way to know the test would
have caught the defect it's named after.

**Colour contrast** is checked as part of the same default ruleset, per theme, via `mountThemed`'s
`theme` argument — see the `describe.each(["light", "dark"])` pattern above, used throughout the
`*.a11y.test.ts` files. As of this writing axe reports zero contrast violations for any `--wt-color-*`
pairing actually used by every primitive in the table above, in either theme, across every documented state (`wt-input`
invalid, `wt-switch` checked/unchecked, `wt-dialog` open, `wt-button` icon-only and every variant,
disabled and loading states; `wt-spinner` as a status region and decorative — all verified
2026-09-11; `wt-button` as a menu trigger, open and closed — verified 2026-09-27 by running
`packages/ui-core/src/components/wt-button.a11y.test.ts`; `wt-combobox` closed, closed and named only by a forwarded `aria-label`, open with
results, open with the add row, open with no matches, multi-select with a selection, invalid with an
error message, disabled and required — verified 2026-09-13 by running
`packages/ui/src/components/wt-combobox.a11y.test.ts`, which covers those states in both themes;
`wt-count-badge` in its neutral, warning and error tones — verified 2026-09-14 by running
`packages/ui/src/components/wt-count-badge.a11y.test.ts`; `wt-toast` open in its info and error
tones, and closed — verified 2026-09-14 by running
`packages/ui/src/components/wt-toast.a11y.test.ts`; `wt-notice` on screen, fading and gone —
verified 2026-09-30 by running `packages/ui/src/components/wt-notice.a11y.test.ts`; `wt-language-chooser` closed, open
with the active language checked, and closed with a page's `::part` rules showing the short code
instead of the name — verified 2026-10-02 by running
`packages/ui/src/components/wt-language-chooser.a11y.test.ts`; the field primitives in the filled
field box — `wt-input` with its label resting in an empty field, focused, with its label hidden,
disabled holding a value, invalid with an error message, and with a help button beside it;
`wt-textarea` resting, floated over a value, with a hint, focused, invalid with and without a
message, required, disabled holding a value, with its label hidden, and with a help button;
`wt-price-input` invalid with no message, resting, resting over a hidden currency sign and fixed
unit, focused, and disabled with a fixed unit; `wt-number-stepper` resting, focused, invalid with no
message, with a long label its box widens to fit, with a label cut in a row too narrow for it, and
with its label hidden (the two long-label states verified 2026-10-02); `wt-combobox` closed with a
value chosen, open with the chosen row ticked, with icons, with groups, with an action row,
without a search box, with focus back on the trigger, compact, with a hint shown as the
placeholder, with a help button, disabled with a value chosen, and opened from the keyboard with
and without a search box — verified 2026-10-01 by running
`packages/ui-core/src/components/wt-input.a11y.test.ts`, `wt-textarea.a11y.test.ts` beside it, and
`packages/ui/src/components/wt-price-input.a11y.test.ts`, `wt-number-stepper.a11y.test.ts` and
`wt-combobox.a11y.test.ts`, each state in both themes). No token values needed changing. (axe does flag unrelated `incomplete` — not
violation — results: a `color-contrast` "background partially obscured" reading on `wt-dialog`'s
`.body` slot, an [axe/shadow-DOM slot-content limitation](https://github.com/dequelabs/axe-core), and
an `aria-prohibited-attr` note about `aria-label` on a light-DOM host that forwards it inward, which
axe can't know is deliberate. `wt-dialog` and `wt-combobox` both have that shape and both draw the
note — measured 2026-09-13 by running axe over `<wt-combobox aria-label="Dietary tags">` and, as a
control, over the same component with a visible `label` instead, which drew none. Both are engine
limitations, not defects —
verified by hand: `--wt-color-text` on `--wt-color-surface-raised` computes to ~13:1 in dark and >15:1
in light, both far past the 4.5:1 AA floor for the 14px body text involved.)

New primitives require an axe test covering every meaningfully distinct accessibility-relevant state
(not just the default render) — see the checklist below.

## Adding a primitive

1. Write the test first, in a real browser. Include a test proving it paints from a token — set
   the token on the `host` (see Testing, above) and assert the computed style changes. A component
   that renders correctly but ignores tokens is not a primitive.
2. Extend `LitElement`, and put `baseStyles` first in `static styles`.
3. Reflect variant-like properties so they are styleable via `:host([variant="..."])`.
4. If it's interactive (clickable/focusable/typeable), add `static override shadowRootOptions = {
   ...LitElement.shadowRootOptions, delegatesFocus: true }` and give the actual hit-target element
   (not just `:host`) `min-width`/`min-height: var(--wt-tap-min)` — see "Focus delegation" and
   "`--wt-tap-min`" above. Nothing needs registering with `no-hardcoded-chrome.test.ts` — it
   discovers `src/components/*.ts` automatically via `import.meta.glob`, so a new primitive is
   covered as soon as the file exists.
5. Add an axe a11y test, `src/components/<name>.a11y.test.ts` (see "Accessibility testing (axe)"
   above) — every meaningfully distinct state (open/closed, checked/unchecked, invalid, icon-only,
   ...), in both light and dark themes. Before trusting it, break the component's accessibility on
   purpose (remove an `aria-label`, unassociate a label) and confirm the test actually goes red,
   then restore the fix.
6. If it's a form field, draw it with `fieldStyles` (see Forms → "The field box"): render the
   `.field` box with `part="field"` and the `data-label` (from `fieldLabelState`), `data-invalid`,
   `data-disabled` and `data-compact` its primitive's state calls for, the label from
   `fieldLabel` (its text in a `.field-label-text` span inside the `.field-label`), and the control
   as `.field-control`, so it
   looks and behaves like the other fields. Give its host `max-width: var(--wt-field-max-width)`,
   so it stops at the form width in a `wt-modal`, and add a test that sets `--wt-field-max-width`
   on the `host` and asserts the field's width follows it
   (`packages/ui-core/src/components/wt-input.test.ts` does). Nothing else checks that a new field
   reads it, or that it uses `fieldStyles`.
7. Add it to the workbench and to the table above.

## Workbench

```bash
pnpm --filter @waitron/ui dev
```

Serves `packages/ui/index.html` on `http://localhost:5180`, showing every primitive in light and
dark side by side, each panel driven by its own `applyTokens` call — the same two-roots-at-once
behaviour `multi-root.test.ts` asserts. Check both before committing.

## Local checks before pushing

Use focused tests while you build a change, then push through the normal hook. You get quick local
feedback on sign-offs, dependency consistency, formatting, lint and types while CI runs the package
suites and enforces their coverage thresholds. You do not need a full local workspace test run just
to open a PR.

The Husky hook (`.husky/pre-push`) runs `pnpm install --frozen-lockfile`, `pnpm format:check`,
`pnpm lint` and the root guard suite (`pnpm vitest run --coverage`), then typechecks changed packages
and their dependents. Root guards stay local because they check the code that selects CI work.
The hook checks commit sign-offs first and stops at a failed check with a command to reproduce it.

A documentation-only push stops after formatting. Repository machinery changes (`scripts/`,
`.husky/`, `.github/`) stop after the root guards, unless they touch a file `ROOT_SCOPE_CONSUMERS`
lists. Shared configuration or an unknown push range selects all workspace typechecks. Deleting
branches without updating any ref skips the hook. Package browser and database suites run in CI
rather than in the hook.

Run a package's tests or coverage locally when you need them to reproduce a failure or investigate
changed behavior, for example `pnpm --filter @waitron/ui test:coverage`. A focused local pass does not
replace the required CI result: check that CI selected the expected packages and passed on your
current commit. CI also runs mutation and bundle checks where applicable.

`pnpm install` wires up the hook automatically through the root `prepare` script. Use the normal
hook when pushing; do not bypass a failed check to make the PR appear ready.

### Submit ordinary forms with Enter

When you finish typing a field, Enter should perform the same action as its submit button.
Bind `submitOnEnter` from `@waitron/ui` to that form's fields or dialog, and pass its specific
submit control:

```ts
html`<wt-input
  @keydown=${(event: KeyboardEvent) =>
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
></wt-input>`;
```

For a screen with several editable rows, select the Save button for that row. The helper clicks
that existing control, so your normal validation still runs. Keep the action's in-flight guard
and disabled binding: the keyboard path uses the same action as a click.

Only single-line input fields submit implicitly. Enter in a textarea inserts a newline, and
selectors, switches, file pickers, and keypad buttons retain their own keyboard behavior.
Composition, held keys, and Enter with Shift, Control, Alt, or Meta do not submit. Leave live
filters and controls that persist each edit immediately unbound. If a field edits a draft that you
commit with Save, bind it to that Save even when its preview updates as you type.

### Tabbed management pages

When one management area contains several lists, use `wt-tabs` to show one concern at a time.
Give each tab a stable key, a localized label and a matching named slot:

```ts
html`<wt-tabs
  label="Venue operations"
  .items=${[{ key: "status", label: "Status" }, { key: "departments", label: "Departments" }]}
  .value=${this.view}
  @wt-tab-change=${this.selectView}
>
  <div slot="actions">${this.view === "departments" ? this.renderAddDepartment() : nothing}</div>
  <section slot="status">${this.renderStatus()}</section>
  <section slot="departments">${this.renderDepartments()}</section>
</wt-tabs>`;
```

Your selection handler receives `event.detail.value`. The strip's event has its own name, so a
`wt-change` from a control inside a panel does not trigger a `wt-tab-change` handler. A `wt-tabs`
inside another strip's panel sends a `wt-tab-change` that bubbles out to the outer strip's
listener, carrying the inner strip's key; a listener that returns early unless
`event.target === event.currentTarget` ignores it and still handles the outer strip's own choice,
so a screen that nests one strip inside another's panel needs that check on the outer listener.
The component updates its own selection, while your screen records it with `UrlStateController`.
An unknown or omitted value shows the first tab. Arrow keys wrap between tabs; Home and End
select the first and last tab. The tab strip scrolls on narrow screens. Hidden panels remain
mounted, so switching tabs retains their input values. Supply unique, nonempty keys and a
localized `label` for the tab group.

If a tab has an Add or Create action, put it in the `actions` slot for the selected tab. This
places the action beside the tabs and outside the tab list's accessibility role. At phone width,
the tabs and a group of actions scroll separately, so the action area stays on screen when the tabs
scroll. Keep actions for other tabs out of sight until their tab is selected.

Put each list in `wt-data-table`. Use `wt-row-actions` for its kebab menu — three dots, not a
hamburger; it opens a small menu of actions for one row, not the app's whole navigation, so it
needs the icon that means "more options here," not "open navigation" (see "Icons" below) — with a
label that identifies the row, such as `Actions: Restaurant`. On a page without tabs, put Create in
a menu beside the table heading. Put Edit, Delete or domain-specific actions in each row's menu. A screen may instead
offer Create as a round icon-only `wt-button` (`shape="round"` with the `plus` icon and an
`aria-label`) beside the heading — but **no screen does today**, and no dashboard control uses
`shape="round"` at all, so read this as a permission rather than a pattern with a home. The menu
uses a native
popover: clicking outside or pressing Escape closes it. Its action buttons follow normal Tab
navigation. Give every `wt-button` slotted into a `wt-row-actions` popover `align="start"` — a
centred label reads oddly once the button has been stretched to the popover's full width, the way a
dropdown menu item never centres its text. This applies to every `wt-row-actions` popover, not just
per-row kebab menus — the account menu in the banner uses the same primitive and the same
alignment.

The menu itself is left-aligned by default: `wt-row-actions` pins the popup's left edge under its
trigger (`align="start"`), so the menu grows rightward, and a per-row kebab at the end of a table row
opens into the margin beside the table. A menu anchored at the trailing edge of a wide surface — the
banner's account menu — passes `align="end"` instead, pinning the popup's right edge so it grows
leftward, inward over the page rather than off the screen. A per-row menu in a table inside a modal
also passes `align="end"`, since a modal has no margin beside the table.

Open create and edit forms in `wt-modal`, with `wt-form-actions` in its footer. Keep validation
messages inside the modal, retain entered values after a failed save, and refresh the table after
success. Use the existing Forms contract for required markers, field errors and keyboard submission.
Only offer operations your domain supports: department removal deactivates the department; removing
a product from a menu removes that offer.

### Products: Active and Available are two different words

On the products screens, **Active / Inactive** says whether a product exists for the
venue, and **Available / Unavailable** says whether it is sold out for now. Delete makes a product
Inactive, and Restore makes it Active again; never label either of them "unavailable". The products
list's Status filter starts on Active, so an Inactive product is hidden until the filter is changed,
while an Unavailable one stays listed with an "Unavailable" badge beside its Active badge. A
variant's Remove makes it Inactive and its Restore makes it Active, on the products list and in the
product editor's variants section; an Inactive variant is hidden behind the list's same Status
filter, and in the editor until the "Show N inactive" link beside Add variant shows it. Other
screens' words for "switched off, kept for the record" are still being settled in `docs/backlog.md`.

### Navigation and language controls

Your selected tab belongs in the URL. `UrlStateController` reads path segments, updates them without
removing unrelated query parameters, and restores the screen on browser Back/Forward. The screen validates
identifiers against its loaded data and permissions; a URL never establishes authentication. Use
replacement history for defaults and invalid destinations, and push history for a new selection.
Keep passwords, PINs, pairing codes and unsaved form contents out of the URL.

Module management tabs use `/manage/<section>/view/<key>`; Venue operations uses `status`,
`departments`, `zones` and `kitchen` (Changes after sending). The dashboard preserves module-owned
`view` segments while the module validates its keys. The Menus screen (`/manage/menus`) puts the menu's id before
the tab:
`/manage/menus/menu/<id>/view/<key>`, with `structure`, `prices` and `preview` (`dashboardPath`,
`apps/dashboard/src/navigation.ts`).
The Modifiers screen's `/manage/modifiers/view/<extras|options>/list/<id>` opens that list's editor
once the screen has loaded its lists (`dashboardPath`, `apps/dashboard/src/navigation.ts`). An id
the selected tab's lists do not hold opens nothing and is dropped from the address without adding a
Back stop; closing the editor, with Cancel or a save, drops it the same way. Changing tab drops it
too and, like any tab change, adds a Back stop.

Use `/manage/<section>` for dashboard destinations and `/tabs/<key>` for till tabs. Nested views,
zones and saved canvas tabs extend those paths, such as `/manage/floor/view/plano/zone/<id>`.
Till Schedule, Kitchen, Pass and Allergens use `/tabs/<key>/view/<destination>`, with destinations
`schedule`, `station`, `expo` and `allergens`. The operator Kitchen picker adds `/station/<id>`;
embedded station cards keep their selection local to the enclosing tab. Restore these destinations
only after login and device validation. Kitchen displays keep their bound station and cannot open
operator destinations from a path. Unsaved canvas tabs stay out of both URL writes and history,
including when you reselect them; saved tabs become destinations after persistence.
Only meaningful navigation pushes history. Payment steps, modifier dialogs and draft edits do not;
an automatic return home after payment replaces the current entry. Menu choice is a browser-tab
preference in `sessionStorage`, retained through new and parked orders. Every successful login resets
it to the location default (or the first available menu). Refresh currently returns to PIN login,
so logging in after refresh also resets the menu. It belongs in neither the path nor browser history.

Dietary filters (vegan, vegetarian, no meat and no fish) follow the same login boundary. The till app
owns the selection and passes it to counter and table-order screens, including embedded cards.
Screen changes, menu changes, payment and new or parked orders retain the selection. Tapping the
selected filter clears it everywhere; a new login starts with no dietary filter. Changing a filter
never alters basket contents or browser history. Browser storage being blocked must not stop filtering.

The production server serves app HTML for browser navigation under `/manage` and `/tabs`. APIs and
static assets keep their own responses; setup continues to use its existing root page.

The language controls display the names from `SUPPORTED_LOCALES` before their options load. Each
app puts `wt-language-chooser` at the trailing end of its top bar: in the setup wizard's card
header, after the logo; in the dashboard's banner, before the alerts bell and the account menu, and
there on its own when nobody is signed in (in a demo, above the drawer breakpoint, the email inbox
link sits just before it); in the till's tab-shell bar, before the operator's name,
as in the counter screen's own header (which it draws only when not embedded in the shell, and the
app always embeds it). A till screen with no top bar — the sign-in and join screens, and the
kitchen display, whose shell draws no bar — holds it at the top right on its own, above the
content. At 40rem wide or less the trigger shows the language's short code instead of its full
name, by each app's own `::part` rule (`apps/setup/src/setup-app.ts`,
`apps/dashboard/src/dashboard-app.ts`, `apps/till/src/widgets/language-chooser-styles.ts`); its
accessible name is the full name either way. Its menu opens downwards. The parent passes the
page's language as `active` and decides what a pick means. A signed-in operator's choice uses the
existing preference write; login, pairing and kitchen-display choices are local UI changes.
