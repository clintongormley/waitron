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

Overriding `--wt-color-primary` leaves every token that holds Waitron's blue as its own value at
that blue — among them `--wt-color-primary-text`, `--wt-color-primary-hover`, `--wt-color-focus` and
`--wt-color-field-label-focus` — and overriding `--wt-color-danger` leaves `--wt-color-danger-hover`
at Waitron's red. Set each one too, with a light and a dark value (see Tokens → Colour).

## Tokens

### Colour

`--wt-color-bg`, `--wt-color-surface`, `--wt-color-surface-raised`, `--wt-color-surface-lifted`,
`--wt-color-surface-sunken`, `--wt-color-text`, `--wt-color-text-muted`, `--wt-color-primary`,
`--wt-color-on-primary`, `--wt-color-primary-text`, `--wt-color-primary-hover`, `--wt-color-danger`,
`--wt-color-on-danger`, `--wt-color-danger-hover`, `--wt-color-success`, `--wt-color-warning`, `--wt-color-on-warning`,
`--wt-color-border`, `--wt-color-focus`, `--wt-color-scrim`, `--wt-color-field-fill`,
`--wt-color-field-line`, `--wt-color-field-label-focus`, `--wt-color-field-fill-disabled`,
`--wt-color-field-value`, `--wt-color-google-button-fill`, `--wt-color-google-button-line`,
`--wt-color-google-button-text`, `--wt-color-stepper-button`, and the calendar's
`--wt-color-palette-{red,amber,grey,blue,green,purple}`, `--wt-color-day-standard` and
`--wt-color-day-closed`, each with an `--wt-color-on-…` text colour

`--wt-color-stepper-button` is the hover tint of `wt-number-stepper`'s − and + buttons: `#e8f0ff`
in the light theme and `#172946` in the dark.

The three `--wt-color-google-button-*` tokens are the colours Google's sign-in branding guidelines
give its button, for the dashboard's Google sign-in button only: fill `#ffffff`, line `#747775` and
text `#1f1f1f` in the light theme, and `#131314`, `#8e918f` and `#e3e3e3` in the dark.

Colours are semantic, not literal. There is no `--wt-color-blue`. The one named set is the
calendar palette below, because there the colour's name is what the operator picks. `--wt-color-scrim` was added
after the rest of the palette to back `wt-dialog`'s `::backdrop` — if you need a similar
overlay/veil colour elsewhere, reuse it rather than inventing a new one.

`--wt-color-surface-sunken` is the fill of a sold-out till tile: `#d6d9e0`, the value of
`--wt-color-border`, in the light theme, and `#101216`, the value of `--wt-color-bg`, in the dark,
so in the dark theme a sold-out tile sits at the page's own level, below an available tile's
`--wt-color-surface`.

`--wt-color-surface-lifted` is the background of something picked up and moving, or of a row being
pointed at or focused — for example a table row while a pointer drags it
(`packages/ui/src/reorder-table.ts`), a `wt-data-table` row that opens something while it is
hovered or while anything in it has focus, and a `wt-choice-row` under the pointer. A dragged row
can sit inside a `wt-modal`, which is painted `--wt-color-surface-raised`, so the lifted surface
differs from `--wt-color-bg`, `--wt-color-surface` and `--wt-color-surface-raised` in both themes,
and keeps `--wt-color-text` and `--wt-color-text-muted` at 4.5:1 or more; the "lifted surface" test
in `packages/ui-core/src/tokens/colors.test.ts` holds both. The dragged row follows the pointer,
held inside its list, and is drawn above the rows it covers. Each row it passes slides out of its
way, and the row itself slides into its slot when released, both over `--wt-duration-move`. Under
reduced motion (`prefers-reduced-motion: reduce`) passed and released rows land at once, while the
dragged row still follows the pointer.

`--wt-color-primary-text` is the primary blue as small text: `#1a5fd0` light, `#78a9ff` dark.
`--wt-color-primary` itself is 4.32:1 on the light `--wt-color-bg` a hovered `wt-combobox` row
paints, which axe refused for 14px text, and 3.58:1 on the dark `--wt-color-surface-lifted` of a
highlighted table row; the new value is 4.5:1 or more on `--wt-color-bg`, `--wt-color-surface`,
`--wt-color-surface-raised` and `--wt-color-surface-lifted` in both themes, which the "primary
text" cases in `packages/ui-core/src/tokens/colors.test.ts` hold. It
holds its own value rather than reading `--wt-color-primary`, so a deployment that overrides the
primary colour has to override this one as well, with a light and a dark value: no single colour
reaches 4.5:1 on both themes' `--wt-color-bg`. A tenant theme cannot set it: `THEMEABLE_TOKENS`
(`packages/layouts/src/theme.ts`) does not list it, and no screen applies a stored tenant theme
yet.

`--wt-color-primary-hover` and `--wt-color-danger-hover` are the fills a primary and a danger
`wt-button` take under the pointer: `#1a5fd0` and `#9a1f18` light, `#78a9ff` and `#ff8a7f` dark,
each further from its button's text colour than the resting fill, so the label reads at 4.5:1 or
more on it (the "hover fills" cases in `colors.test.ts`). Like `--wt-color-primary-text` they hold
their own values, so a deployment rule that overrides `--wt-color-primary` or `--wt-color-danger`
must set the matching hover token too, in both
themes; and `THEMEABLE_TOKENS` does not list them either, so a tenant theme cannot set them.

Opening hours → Calendar (`packages/venue-service/src/dashboard/hours-calendar.ts`) paints a
public holiday red, an own Holiday purple and an own Working day blue. Public-holiday facts take
precedence for the fill when an own day shares their date; both names remain visible. An ordinary
open day uses `--wt-color-day-standard`, and an ordinary closed day `--wt-color-day-closed`.
A named or public date keeps its kind's fill even when closed, adding Closed in words. An own-hours
date also shows a clock icon and an accessible Own hours label. Text uses the corresponding
`--wt-color-on-palette-…` or `--wt-color-on-day-…` token. Colour is never the only signal.

**2026-10-09, A366 slice 2:** the date colour picker and transitional stored `colour` are retired
(`packages/venue-service/src/schema/hours.ts` and migration `0038_clammy_klaw.sql`). The palette
below remains available as shared tokens; Calendar's named mode uses only the red, purple, blue,
standard and Closed fills. The earlier six-colour date choice is recorded in the historical
[Hours plan](../superpowers/plans/2026-10-05-hours.md).

| Fill                        | Light     | Text on it | Dark      | Text on it |
| --------------------------- | --------- | ---------- | --------- | ---------- |
| `--wt-color-palette-red`    | `#c62828` | `#ffffff`  | `#ff7a70` | `#2a0705`  |
| `--wt-color-palette-amber`  | `#f5a623` | `#241500`  | `#f5b34a` | `#241500`  |
| `--wt-color-palette-grey`   | `#6b6e78` | `#ffffff`  | `#8b8d98` | `#101216`  |
| `--wt-color-palette-blue`   | `#2f55d4` | `#ffffff`  | `#7aa2ff` | `#06101f`  |
| `--wt-color-palette-green`  | `#1e7a4f` | `#ffffff`  | `#4ac08d` | `#06190f`  |
| `--wt-color-palette-purple` | `#7e3fb8` | `#ffffff`  | `#c39bf0` | `#1d0b33`  |
| `--wt-color-day-standard`   | `#dff3e8` | `#16181d`  | `#183626` | `#eceef2`  |
| `--wt-color-day-closed`     | `#3a3b42` | `#ffffff`  | `#d5d7de` | `#101216`  |

The "calendar day colours" cases in `packages/ui-core/src/tokens/colors.test.ts` hold, in both
themes, that each text colour is 4.5:1 or more on its fill, that the six palette fills differ from
each other and from both reserved fills, that the standard and Closed fills are 3:1 or more apart,
and that the `prefers-color-scheme` blocks give the same values as the explicit themes. They do not
hold that two palette colours are told apart by eye: the light standard fill, for one, is only
about 1.2:1 against `--wt-color-surface`, which is why the words carry the meaning.

`--wt-color-warning` is the amber for a warning that is not yet an error, such as the alerts count
badge when no open alert is an error. Text on it uses `--wt-color-on-warning`.

The five `--wt-color-field-*` tokens paint the filled form field (see "The field box" under Forms):

| Token                            | Light     | Dark      | Paints                                                    |
| -------------------------------- | --------- | --------- | --------------------------------------------------------- |
| `--wt-color-field-fill`          | `#f0f1f4` | `#262a33` | the field's background                                    |
| `--wt-color-field-line`          | `#7d8390` | `#7a8291` | the bottom line at rest, and the dashed one when disabled |
| `--wt-color-field-label-focus`   | `#1a5fd0` | `#5c98ff` | the label of the focused field                            |
| `--wt-color-field-fill-disabled` | `#f7f7f8` | `#1f2229` | a disabled field's background                             |
| `--wt-color-field-value`         | `#000000` | `#ffffff` | the value typed or chosen                                 |

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

A user-chosen data colour is the one deliberate exception to "no hex, no hardcoded chrome": the
colour a person gave a category, a product or a menu section is painted as it is, never mapped to a
token. Its users are the colour chooser's palette (`apps/dashboard/src/widgets/color-field.ts`), the
category swatches in the Products tree, the product and section swatches in a menu's Structure tree,
and the till's product and section tiles (`apps/till/src/widgets/menu-browser.ts`). A painted till
tile takes black or white for its labels and its icon, whichever `readableTextColor`
(`packages/ui/src/category-color.ts`) picks for that colour, because the label still carries the
meaning and the colour is never the only signal. `wt-lozenge` takes a colour the same way, filling
its background and computing black or white text, though no screen passes it one. This is a
different idiom from the one the floor plan and service statuses
already use for a data colour — a neutral chip with the colour shown only as a border and a dot —
which was tried for categories and declined: a pale colour nearly disappears as a border in the
theme where it's already pale (light colours in light mode, dark colours in dark mode). A painted
sold-out till tile borrows that idiom's neutral tile, without the dot. Every sold-out till tile,
painted or not, is filled `--wt-color-surface-sunken` with `--wt-color-text` labels in place of
`wt-button`'s disabled fade, and a painted one keeps its colour only on its left edge, as an inset
stripe `--wt-space-1` wide edged on the tile's side by a one-pixel `--wt-color-text` line, which
reaches 3:1 against both the fill and the stripe wherever the stripe alone does not
([products.md](products.md), _Colour_, has the measurements). A section tile a diet filter
emptied keeps `wt-button`'s disabled fade instead. Reach for the filled-background idiom only for a colour that is itself the data,
never as a shortcut around a `--wt-color-*` token.

**A menu's Device Home Page, on the till and in the dashboard's preview.** Both draw it from one
set of rules (`packages/catalogue/src/device-home.ts`): the till in its menu browser
(`apps/till/src/widgets/menu-browser.ts`) and the dashboard in a menu's Home page tab
(`apps/dashboard/src/widgets/device-home-preview.ts`). Under search come two blocks, the shortcuts
and the menu's own structure, in the order the menu sets for that kind of device. The first block
has no visible heading, only an accessible name. Between the two sits a divider: the second
block's name ("Full menu" or "Shortcuts") in `--wt-font-size-sm` and `--wt-color-text-muted`,
between two 1px `--wt-color-border` lines, as that block's heading. A block with nothing to show is
not drawn, and then there is no divider. Every grid has up to the menu's column count of tracks,
fewer where a tile would be narrower than its minimum (`HOME_GRID_COLUMNS`). Handheld tiles use
`--wt-tap-min * 1.5` when they follow the menu’s column setting; till tiles and canvas cards
with their own column count keep twice `--wt-tap-min` plus `--wt-space-4`. Handheld settings
offer 2–3 columns and till settings 4–10. The handheld grid and its preview show three columns at
360px and 390px. The handheld preview uses `--wt-space-4` side insets to fit inside the dashboard's
own phone-width padding; narrower grids keep the same reading order. In Colours
mode a tile is painted as above. In Thumbnails mode a tile with an image shows it above its name,
4:3 with `--wt-radius-sm` corners, and is not painted; a tile with no image is painted as in
Colours mode, or neutral. A section tile always has a second line under its name — "Section", or
on the till "Nothing matches the filter" for one a diet filter emptied — so a section and a product
differ without colour; its image, when shown, takes the folder icon's place.

**A menu's shortcuts are edited in its Home page tab's preview** (owner decision 2026-10-07, A336).
The tab is one column, the preview first, until its box is 800px wide, then two: the preview on
the left, the device choice and display settings on the right. In the preview's home view each
shortcut tile keeps its look and gains a grip ("Reorder: <name>") and a ⋮ holding Remove shortcut.
On the grip, the arrow keys move the shortcut one position, Up and Down included, and a drag moves
it among the shortcuts with a drop marker; Escape cancels a drag. A shortcut whose target the menu
no longer reaches and one the menu reaches but a device would not show (an empty section, a product
with no price) are both dashed, muted tiles; the first reads "Missing: <name>", the second "Not
shown on devices". After the last shortcut come two dashed add tiles, Add products and Add
sections, drawn even when there are none, so an empty shortcut block shows in the dashboard but
never on a device. Each opens a window whose one multi-select list offers the active products, or
the sections, the menu reaches that are not already shortcuts, and one Add adds every choice in the
order chosen. The Structure tab shows no shortcuts.

**Menu wording.** Spanish restaurant menus are "cartas"; an account menu remains "menú".
The Structure tree and shortcut picker label an included menu "Menu: <name>" / "Carta: <name>",
so you can distinguish it from a section with the same name.

**The till's menu search.** The till and dashboard Home preview label the field "Search" / "Buscar".
The search field sits above both blocks, on home and inside a
section; typing replaces the view with results, and clearing returns to where it was. Its results
list the shown menu first, headed "<menu> (this menu)", then each other menu the device's service
zone serves that has a match, headed with that menu's name, in the zone's order; the group
headings are `h3`s, a thin line (1px, `--wt-color-border`) separates one group from the next, and
each tile is that menu's own offer at its own price. The results' "Search results" `h2` is visually
hidden on the till and in the dashboard preview: it still names the results region and is still a
heading for screen readers, but takes no space on screen. When the shown menu has no match but
another menu has, its group says "No products match in this menu"; when no menu has one, there are
no groups, only "No products match in any menu". A device served one menu sees one list with no
group headings and no line. The group sections carry no accessible name, because two menus may
share one. The dashboard's preview searches its one menu only and says so above its search field.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-family-mono` (text read or copied character by character, such as a key or a log line),
`--wt-font-family-google` (the Google sign-in button only), `--wt-font-size-sm|md|lg|xl`,
`--wt-font-weight-normal|medium|bold`, `--wt-google-mark-size` (20px), `--wt-google-mark-gap`
(10px) and `--wt-google-button-line-height` (20px) (the Google sign-in button's "G", the gap after
it and its label's line height), `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`, `--wt-dialog-max-width`, `--wt-modal-compact-width`,
`--wt-modal-standard-width`, `--wt-modal-max-width`, `--wt-modal-inline-margin`, `--wt-modal-inline-padding`, `--wt-form-max-width`,
`--wt-field-max-width`, `--wt-cell-name-max-width`,
`--wt-stepper-field-width` (88px), `--wt-stepper-button-width` (24px), `--wt-price-field-width`,
`--wt-price-range-field-width` (168px),
`--wt-opacity-disabled`, `--wt-opacity-hover`, `--wt-duration-fade`, `--wt-duration-move`,
`--wt-duration-disclosure`,
`--wt-field-height`, `--wt-field-line-width`, `--wt-field-line-width-active`,
`--wt-dropdown-row-height`

The field tokens size the filled form field (see "The field box" under Forms):
`--wt-field-height` (56px) is a labelled field's height, above `--wt-tap-min`, which
`packages/ui-core/src/tokens/structure.test.ts` holds; `--wt-field-line-width` (1px) is the bottom
line at rest and `--wt-field-line-width-active` (2px) the focused or invalid one;
`--wt-dropdown-row-height` (48px) is the least height of a row in `wt-combobox`'s open list.

The type scale is 12px, 14px, 18px and 22px (`--wt-font-size-sm|md|lg|xl`), in each device's own
system font (A179, 2026-10-01 — before it the scale was 13, 15, 19 and 24px). The only font file
any app bundles is Google Sans Medium, which the dashboard uses on its Google sign-in button alone
(A228; see the login section). Body text is `--wt-font-size-md`: `baseStyles` sets it on the host of each component
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
`--wt-duration-disclosure` is how long a disclosure body takes to open or close (900 ms).

Secondary and ghost `wt-button` variants keep their fill and text at full opacity on hover;
their default border reads `--wt-color-primary-text`. If your screen paints the border through
`::part(button)`, give it its own hover cue too: an outside part rule overrides the shared border
rule. Google sign-in uses its text token for the hovered border, painted tiles use their readable
ink, and an invalid image choice adds an inset line in the error colour. Primary and danger variants use their hover fill
tokens at full opacity. A hover must preserve the label's contrast, including coloured text and
muted prices in a till tile.

`wt-combobox`'s option rows hover onto `--wt-color-bg`, not the raised surface: the raised
surface equals the popover panel's own background in the light theme, so a raised-surface hover
would not show.

`wt-button` also exposes its inner `<button>` as a CSS part (`part="button"`), so a consuming
screen can layer its own hover accent onto specific buttons — `wt-button.foo::part(button):hover`
— without changing what a variant looks like everywhere else `wt-button` is used. See "Card action
buttons" under "Page composition" below for the pattern this exists for. The dashboard's Google
sign-in button uses the same part to repaint its fill, line, text colour, font, line height and
the gap before its label (`wt-button.google::part(button)` in `apps/dashboard/src/screens/login-screen.ts`; see
the login section).

`--wt-dialog-max-width` (`min(90vw, 48rem)`) exists so `wt-dialog` never spells out a literal
`rem` value inline — the no-hardcoded-chrome guard (see below) checks `rem`/`em` sizing, not just
`px`, so any component-level size, including one wrapped in `min()`/`max()`/`clamp()`, must resolve
through a token. `wt-modal` has three sizes, each a token: compact, `--wt-modal-compact-width`
(`28rem`, 448px); standard, `--wt-modal-standard-width` (`42rem`, 672px); and wide,
`--wt-modal-max-width` (`64rem`, 1024px), which is also the width of a modal given no size (see
the `wt-modal` entry below). `wt-dialog`, `wt-help-tooltip` and `wt-relative-time`'s box read their own token and are at most
`48rem` (768px). Some add and edit forms are built in `wt-dialog` rather than `wt-modal` (the
ingredient form is one), so they are held to 768px too. Besides `wt-modal`, only the product
editor's Pricing unit chooser reads one of the three size tokens: it sets its `--wt-dialog-max-width` from
`--wt-modal-compact-width`. To resize any other dialog, set `--wt-dialog-max-width` (the till's
device chooser does).

`--wt-form-max-width` (`36rem`, 576px at the default text size) is the form width: the one width
of a form inside a `wt-modal` (owner, 2026-09-30, C105). A field there grows no wider than it,
however wide the modal is, and in a modal whose body is narrower (a compact one, or any size on a
phone) it takes the body's whole width instead. The form width is not the standard modal size: a
standard modal is wider, so its body holds a form at the form width beside a classic scrollbar
(17px allowed for it). `wt-modal` sets `--wt-field-max-width` to it on its body, and every shared field reads
`--wt-field-max-width` as its `max-width` — `wt-input`, `wt-textarea`, `wt-combobox`, `wt-price-input`,
`wt-number-stepper`, `wt-switch`, `wt-slider`, and the line that shows a form's message
(`formMessageStyles`, so both the message a dialog shows at the end of its body and the one a
`wt-form-actions` placed in the body shows above its buttons). `--wt-field-max-width` is `none` at
the theme root. It narrows nothing else: a table, a preview, a `wt-disclosure`, a screen's own
paragraphs and the footer's buttons keep the modal's full width. A screen does not set its own
form width; it chooses the modal's size.

The seven field elements' label, hint and error are inside the element, so the cap holds them too.

Outside a `wt-modal`, `--wt-field-max-width` is the theme root's `none`, so a field on a page, or in a `wt-dialog`
that is not inside a `wt-modal`, is as wide as its container, as before; a `wt-dialog` placed
inside a modal's body inherits the cap. Page forms are bounded by their screen's own column instead
(the setup wizard's raised column, the `max-width` of screens such as backup and sign-in, and the
receipts screen's form column),
so they were left alone. At 390px wide a modal's body is narrower than the token, so a field there
still takes the body's whole width.

A screen that styles its own native control reads the same variable on the element wrapping it.
A screen whose own layout
makes a row of fields grow to fill the modal reads it on that row, so a button beside a field stays
beside it: the Printers screen's `.field-row` does, for the calibration wizard's "Print width ruler"
button beside the ruler's answer. Guards: the form-width
cases in `packages/ui/src/components/wt-modal.test.ts` (`wt-input`, `wt-textarea`, `wt-combobox`,
`wt-price-input`, `wt-number-stepper` and `wt-switch`, and the message at 1280px; each field and the
message bounded by the narrower of the form width and the body in every modal size at 1280px; wide
content and the footer row at full width; each field at the body's width at 390px; each field at its container's width outside a modal); `wt-slider`'s own case "the field max-width token bounds the slider's width" (`packages/ui/src/components/wt-slider.test.ts`); the calibration case in
`apps/dashboard/src/screens/printers-screen.test.ts`; and one 1280px case each in
`packages/adjustments/src/dashboard/reasons-screen.test.ts` and
`packages/venue-service/src/dashboard/department-dialogs.test.ts` (these two measure the
reasons screen's two role `wt-combobox`es and the department Rename dialog's `wt-input` and
field error). A new field primitive that does not read
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
columns leave. The unit button in the price heading goes with its column; the price field
above the table keeps its own unit button, which opens the same unit chooser. The name is the one column that
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
Available heading sits on one line, that the heading's unit button is hidden, and that the price
field's unit button is a tap target on both axes.

As a **flex basis** it sizes the extras list form's product picker, which is a combobox rather
than a table cell.

As a **floor** (`min-width`) it is in the options list form's two single-input cells. An input
alone in a cell has no width of its own, so the automatic table layout shrinks it to `wt-input`'s
tap-target minimum and cuts the value off mid-word; the same value gives it room. That table then
does scroll sideways, which is exactly what the cap exists to avoid — it carries its own focusable
horizontal scroller so the dialog does not scroll instead. **So the two uses disagree about the
sideways scroll.** Whether the floor deserves a token of its own is an open design question, not a
settled convention; it is recorded in `docs/backlog.md` under "Users, sign-in and the dashboard
shell", the entry on `--wt-cell-name-max-width`.

### `--wt-tap-min`

Minimum interactive target, 44px, **on both axes**. POS screens are touched under time pressure by
staff who are not looking carefully — a numpad key ("1", "+", "−") fails just as badly if it's
44px tall but only 32px wide as if it were too short. `wt-button`, `wt-input`, `wt-textarea`,
`wt-price-input`, `wt-number-stepper`, `wt-switch`, `wt-slider` and `wt-combobox` size the element that actually
forms the hit target (the inner `button` for `wt-button`; the inner `input` for `wt-input`; the
inner `textarea` for `wt-textarea`; the inner `input` and the unit button for `wt-price-input`; the
inner `input` for `wt-number-stepper`; both `:host` and `.control` for `wt-switch`; the inner
range `input` for `wt-slider`;
the `.trigger` button for `wt-combobox`) — never an element that can overflow its own container
(see "Hit targets must not overflow their container" below). A field's control (`.field-control`
in `fieldStyles`) takes `min-width: var(--wt-tap-min)` and `min-height: var(--wt-field-height)`
(`wt-textarea` moves the floated label's share of that height into its field box's top padding,
but never lets the textarea itself fall below `--wt-tap-min`, growing the box instead), or
`--wt-tap-min` in a compact field. Among the field primitives, `wt-number-stepper`'s two buttons are
the one exception, by the owner's decision (A263, 2026-10-03): each is `--wt-stepper-button-width` (24px) wide, because the
number between them keeps them apart and 24 by 24 CSS px is WCAG 2.2's level AA minimum (criterion
2.5.8; the 44px figure is the level AAA criterion 2.5.5).

The dashboard sidebar's page rows and group headers use `--wt-space-6` (32px) minimum
height with a fine pointer (A325, owner 2026-10-07). With a coarse pointer they retain
`--wt-tap-min` (44px). This exception applies to sidebar navigation only.

Outside the field primitives, `wt-relative-time`'s words are an inline button below `--wt-tap-min`, under criterion 2.5.8's
exception for a target in a sentence (quoted in its row of the component table); that is the
implementer's choice and awaits the owner's view (`docs/backlog/till.md`, W106's open point (f)). `wt-switch`'s `:host` and `.control` and
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

| Element                 | Properties                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Events                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wt-button`             | `variant` (`primary`\|`secondary`\|`danger`\|`ghost`), `size` (`sm`\|`md`\|`lg`), `shape` (`default`\|`round`), `disabled`, `loading`, `aria-label`, `aria-description`, `aria-haspopup`, `aria-expanded`, `aria-invalid` (forwarded to the inner `<button>`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | native `click`                                                                                                                                                                                                                                          |
| `wt-icon`               | `name`, `size` (`sm`\|`md`\|`lg`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                       |
| `wt-spinner`            | `size` (`sm`\|`md`\|`lg`), `label` (the status region's accessible name), `decorative`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                                                                                                                                                                       |
| `wt-card`               | `raised`; default slot (body), `header` slot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                       |
| `wt-disclosure`         | `heading`, `summary` (shown under the heading while the section is closed), `summaryFields` (`{ label, value, placeholder? }[]`; when it holds any, the closed line is these instead of `summary`: each value after its bold label and a colon, joined with a middot; a value marked `placeholder` is drawn in italic, as a field's placeholder is), `summaryRows` (`{ label, value, lines, placeholder? }[]`; when it holds any, it is used instead of both: one row per entry, the value after its bold label and a colon, each row cut with an ellipsis after its own `lines` lines, so a long value never widens the header, and a `placeholder` value in italic), `open` (reflected), `has-error` (reflected); default slot (body). The header is a `<button aria-expanded>` and the shadow root delegates focus to it; clicking it toggles `open`. `has-error` forces the section open and makes the header inert, so a section holding a validation error cannot be collapsed out of view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `wt-toggle` — `detail: { open: boolean }`                                                                                                                                                                                                               |
| `wt-lozenge`            | `color` (a hex string; empty or invalid renders the neutral chip); default slot (label)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                                                                                                                                                                                                                                       |
| `wt-count-badge`        | `count` (renders nothing at zero; shows `99+` above 99), `tone` (`neutral`\|`warning`\|`error`, reflected). It has no accessible name: the control it decorates must say the count                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                       |
| `wt-demo-bar`           | `modeLabel`, `navigationLabel` (the navigation landmark's name), `links` (`{ label, href, current? }[]`; the current page is text with `aria-current="page"`, the others are links). Used above the dashboard banner in Demo and Preparation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                       |
| `wt-choice-row`         | `heading`; `href` (when not empty, the row is one native link to that address instead of a button, drawn the same way and not underlined; for a row that goes to another page, such as the setup wizard's last screen's Till, Dashboard and Email inbox); default slot (a short description under it; a row with no child nodes hides the description line, leaving the heading alone in the row). The whole row — heading, description and a trailing arrow — is one native button (or link), at least `--wt-tap-min` tall and the full width it is given; it takes `--wt-color-surface-lifted` under the pointer. For a list of choices that each lead somewhere, such as the setup wizard's Demo, Prepare and Live. Each row draws a `--wt-color-border` line on its top and sides, and only the last `wt-choice-row` in its parent element (`:last-of-type`) draws a bottom line; the first takes `--wt-radius-lg` top corners and the last bottom ones; each row keeps its own height. So rows placed next to each other, with nothing between them, read as one box, and a row alone in its parent is a box of its own. A hidden row still counts as its parent's first or last, so hiding one can leave the box open or square-cornered. The corners are drawn on the rows' own buttons and links, with no clipping parent, so nothing clips a hovered row's background or the focus ring                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | native `click`                                                                                                                                                                                                                                          |
| `wt-toast`              | `open`, `tone` (`info`\|`error`, reflected; info is announced politely through `role="status"`, error assertively through `role="alert"`), `message`, `close-label` (required: the close button's accessible name, and an empty one leaves that button nameless), `duration` (milliseconds, default `8000`; `0` keeps it open); `show()` opens it and restarts the full countdown (unless the pointer or keyboard focus is on it, when the countdown waits), which is how to re-announce an identical message. While the pointer or keyboard focus is on it the countdown never runs, even when the message changes; once both have left, the full duration restarts. An `action` slot takes a control (such as an Undo button) drawn between the message and the close button, only while the toast is open; pressing it neither closes the toast nor fires `wt-activate`, so the consumer closes or replaces the toast itself, and the pointer or focus on it pauses the countdown like anywhere else in the toast. Taken off the page it stops counting down and starts no countdown, even from `show()`; an open toast put back counts its full duration again, with the pointer no longer counted as on it. Positioning belongs to the consumer, which must also register the `close` icon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `wt-activate` — `detail: {}` (the message was pressed; the toast then closes); `wt-close` — `detail: {}` (closed by the timer, the close button, or after activation)                                                                                   |
| `wt-notice`             | `duration` (milliseconds on screen, default `4000`; `0` keeps it until the consumer removes it; a new value is counted from when it is set), `reducedMotion` (property only; overrides the `prefers-reduced-motion` query, which is read when the time is up); default slot (the words). An inline status message: the host takes `role="status"` unless given a role, so a change to its words is announced politely. When its time is up it fades out over `--wt-duration-fade`, then hides itself (`hidden`); under reduced motion it hides at once, with no fade. Taken off the page it stops counting, and counts its full duration again when put back. After hiding itself it shows again when put back or given a new duration; a `hidden` its page set while it was showing is kept, and a duration set while it is off the page starts no count until it is put back. It paints no colour of its own, so the consumer colours it (the Printers screen's Bluetooth rows do, through `::part`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `wt-notice-gone` — `detail: {}` (its time is up and it is hidden). Not `wt-close`, which `wt-modal` and `wt-dialog` send and consumers listen for on them, so a notice inside one would read as the dialog closing                                      |
| `wt-input`              | `value`, `label`, `name`, `type` (a date or time type always floats the label, because the browser draws its own format text in the empty field), `autocomplete`, `placeholder`, `hint` (shown inside the empty field as its placeholder unless `placeholder` is set, and always the native input's description; see Forms), `maxlength` (a number passed to the native input; none by default), `step` (a number passed to the native input; omitted by default; time controls count seconds), `required`, `disabled`, `readonly` (see Forms → "The field box"), `invalid`, `error`, `hide-label` (names the input with `label` for assistive technology but draws no label, and makes the field compact); `help` and `end` slots. Drawn as the filled field box (Forms → "The field box"); an action in the `end` slot sits inside the box at its trailing end, and a long label stops short of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `wt-change` — `detail: { value: string }`                                                                                                                                                                                                               |
| `wt-textarea`           | `value`, `label`, `name`, `rows` (default `3`), `maxlength`, `placeholder`, `hint` (as `wt-input`'s), `required`, `disabled`, `invalid` (reflected), `error`, `hide-label` (as `wt-input`'s), `spellcheck` (the attribute `spellcheck="false"` turns it off, as it does in HTML), `autocapitalize`; `help` slot. A multi-line field in the filled field box. The `<textarea>` is the `control` part, so a screen can set, say, a monospace font on it through `::part(control)`, and it can be resized vertically only. The floated label's room is the field box's top padding, so text the textarea scrolls never runs under the label, and a resting label sits on the first line's band rather than in the middle of a tall box. Enter inserts a newline: `submitOnEnter` acts only on single-line inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `wt-change` — `detail: { value: string }` (on every input)                                                                                                                                                                                              |
| `wt-price-input`        | `value`, `label`, `name`, `unit`, `placeholder`, `hint` (shown inside the empty amount as its placeholder unless `placeholder` is set, and always read first in the amount's description, before any error, the sign and a fixed unit; see Forms), `required` (reflected), `disabled` (reflected), `invalid` (reflected; marks the field invalid without a message, as `wt-input`'s does), `error`. `overriding` (reflected) marks a field that holds its own value rather than the fallback its placeholder shows: the value is drawn `--wt-font-weight-bold` and upright, with a `--wt-field-line-width-active` bar of `--wt-color-primary` along the box's start edge (not on a disabled field); a menu's Price overrides tab sets it. `placeholder` shows on the amount only while it is empty, painted `--wt-color-text-muted` in italics. A money field in the filled field box (Forms → "The field box") with a `<button>` inside the box at its trailing end, `--wt-space-1` from its edge, a rounded bordered button of its own, whose visible text is `unit` (which is also that button's accessible name, so supply one). Beside that button the label sits in the amount's part of the box, so a long label stops short of the button; with a fixed unit it spans the whole box. `disabled` locks the amount AND the unit button, so a form that suspends itself while saving cannot be edited through the price. `error` marks the field `aria-invalid` and links the message. `hide-label` names the field with `label` for assistive technology but draws no label, and makes the field compact. `fixed-unit` shows `unit` as plain text rather than a button, for a field whose unit is not chosen here; the field's description then reads the unit after any error, and an empty `unit` draws no unit at all. A fixed unit is text with no box of its own, painted `--wt-color-text`, and `--wt-color-text-muted` while the field is disabled. The amount input is the `amount` part and a fixed unit the `unit` part; a field box holding a fixed unit wraps, so a host can move the unit under the amount with `flex-basis: 100%` on the unit part. The amount box is `--wt-price-field-width` wide where nothing stretches it and no sign is drawn, and fills a wider field unless it carries a fixed unit; a sign drawn by `locale` sits inside the box, and an unstretched box grows by the sign's measured width plus `--wt-space-1`, so the amount keeps the room it had without a sign. A host that lays the field out narrower than that box (a wrapping flex row with a small `min-width`) lets it run under its neighbour; the purchase form's VAT line gives its money fields `min-width: min-content` so the line wraps them instead. `locale` (default empty, which draws no sign) draws the euro sign inside the amount box on the side that locale writes it — before the amount for English, after it for Spanish (the amount then aligned to the sign), `--wt-space-1` from the amount — painted `--wt-color-text-muted`, as the `currency` part, and read in the field's description after any error and before a fixed unit. The label rests like any field's; while it rests on a labelled field that is empty and unfocused, the sign and a fixed unit are hidden under it (`visibility: hidden`) and stay named in the amount's `aria-describedby`, and focus or a value shows them again. With no label drawn they always show. EUR is the only currency; the sign and its side come from `currencySymbol` in `@waitron/shared`, and a dashboard form sets it to `currentLocale()`. It also serves a value in a fixed unit that is not money, such as a percentage: `fixed-unit` with `unit="%"` and no `locale` draws `%` as text beside the narrow amount box and no euro sign, as the bill discount limit in `packages/adjustments/src/dashboard/reasons-screen.ts` does. A table that shows a range as a placeholder widens the amount box by setting `--wt-price-field-width` on the field's host to `--wt-price-range-field-width`, or wider where the widest range it shows, measured in the placeholder's own font, needs more, as a menu's Price overrides tab does (`apps/dashboard/src/widgets/menu-prices-table.ts`); at phone width that tab narrows it again, no further than `--wt-price-field-width`, and while a field in it shows a range the names give up width first and the field is never narrower than that measured range: where the row still does not fit, the table scrolls sideways under its pinned row menu. The method `focusUnit()` puts focus on the unit button, where a host `.focus()` lands on the amount; with a fixed unit there is no button and it does nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `wt-change` — `detail: { value: string }` (on input); `wt-unit-click` — `detail: {}` (the unit button was pressed)                                                                                                                                      |
| `wt-number-stepper`     | `value` (text), `label`, `name`, `min` (default `0`), `max` (default none), `clearable` (boolean attribute: − on any finite number at or below `min`, a fraction included, clears the box to blank and emits `""` instead of being disabled there; − stays disabled while the box is blank, holds a fraction above `min`, or holds no finite number), `placeholder`, `hint` (shown inside the empty box as its placeholder unless `placeholder` is set, and always the box's description; see Forms), `required` (reflected), `disabled` (reflected, and locks the box and both buttons), `invalid` (reflected), `error`, `hide-label` (names the box with `label` for assistive technology but draws no label, and makes the box compact), `decreaseLabel` and `increaseLabel` (functions given `label` that return the buttons' accessible names, property only, default "Decrease …" and "Increase …"; set translated ones). A whole-number field in the filled field box (Forms → "The field box"). Its label always floats on the top line, even while the box is empty, and runs across the whole box, inset `--wt-space-2` from each edge. Under it, in one row, − sits at the box's start and + at its end, and the number is centred between them; the number box itself spans the whole box under the buttons, padded by a button's width on each side. Each button is `--wt-stepper-button-width` wide (below `--wt-tap-min`; see "`--wt-tap-min`") and takes the height left under the label, or the whole compact box with `hide-label`. The buttons have no fill and no separator: each draws its icon in `--wt-color-primary`, and a hover tints that button's area with `--wt-color-stepper-button`, stopping short of the box's bottom line. A disabled button fades only its icon through `--wt-opacity-disabled`, while the box takes the disabled field look. + is disabled at `max`. Without `clearable`, − is disabled at `min` and on a box holding no whole number. + on a blank value or one that is not a whole number gives the larger of `min` and 1, never above `max`; without `clearable`, − never goes below `min`, so only clearing the box reaches blank. Typing emits exactly what was typed, never a clamped number, so the form's own validation sees a typed 0, a blank or a non-number. Its baseline is the number's, so a row aligned by baseline lines the text up. The box is at least `--wt-stepper-field-width` wide (88px: both buttons and room for a three-digit number). A label longer than that widens the box to show it whole on one line, and the number box widens with it; in a row too narrow for that, the box narrows again, never below `--wt-stepper-field-width`, and the label is cut with an ellipsis on one line, keeping a required field's `*`; in a row narrower than the box, the stepper overflows the row. Focusing the element focuses the box. The consuming app registers the `minus` and `plus` icons                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `wt-change` — `detail: { value: string }` (on typing, and on each step that changes the value, a clear included)                                                                                                                                        |
| `wt-switch`             | `checked`, `disabled`, `label`, `name`, `hide-label` (hides the drawn text while keeping `label` as the native switch's default accessible name), `accessible-name` (overrides the native switch's accessible name, for a row-specific name in a table whose column heading supplies the action), `description` (read to assistive technology as the switch's description and not drawn; the screen draws any visible text itself, as the device profile editor's "Every zone" switch does). The drawn label is the `label` part. When drawn, its text supplies the switch's baseline for rows aligned by baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `wt-change` — `detail: { checked: boolean }`                                                                                                                                                                                                            |
| `wt-slider`             | `label`, `name`, `min` (default `0`), `max` (default `10`), `step` (default `1`), `value` (a number), `disabled` (reflected), `error` (shown under the control in a `role="alert"` paragraph that is the input's `aria-describedby`, and marks the input `aria-invalid`). A labelled native range input with its current value drawn beside the label (the `value` part, hidden from assistive technology, which hears the range's own value). Dragging updates the drawn number and sends no event; the value and the event change on release or on a keyboard step. The range takes `--wt-color-primary` as its accent and is at least `--wt-tap-min` tall and wide. It is not drawn in the filled field box (Forms → "The field box"), because a range has no text for the box to hold, so Adding a primitive's item 6 applies only as far as `--wt-field-max-width`, which bounds its width. Focusing the element focuses the range                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `wt-change` — `detail: { value: number }` (on release, or a keyboard step)                                                                                                                                                                              |
| `wt-dialog`             | `open`, `heading`, `aria-label` (fallback name when there is no `heading`), `opener` (property only; the element focus should go to on close when it would otherwise be left on the page body or inside the closed dialog — usually the button that opened the dialog, or one standing in for it; below), `dismissible` (default true; set the property `.dismissible=${false}` so Escape cannot close it, which holds through repeated Escape presses; while it is off and `open` is still true, a close the caller did not ask for shows the dialog again and sends no `wt-close`); default slot (body), `footer` slot. The message of a `wt-form-actions` placed directly in the `footer` slot shows at the end of the body instead, every such row's message joined, and is scrolled into view when it changes and when the dialog opens; a `wt-form-actions` in the body keeps its own message, which the dialog scrolls into view when it changes. Neither is scrolled to when it changes from an `input` event inside the dialog until a zero-delay timer the dialog then sets has run. The `<h2>` heading wraps, breaking inside a word where it must (`overflow-wrap: anywhere`). A body taller than the browser's own height limit for a modal dialog scrolls, heading included, and the footer stays in view; the dialog element itself does not scroll, and a short dialog is as tall as its content. While the body has more than it shows it is a Tab stop, so it can be scrolled from the keyboard, and opening focus moves on from it to the first thing in the body that takes focus.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `wt-close`                                                                                                                                                                                                                                              |
| `wt-modal`              | `open`, `heading`, `aria-label`, `dismissible`, `opener`, `size` (`compact`, `standard` or `wide`; unset is wide; reflected); default slot (scrolling body), `footer` slot (fixed actions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `wt-close`                                                                                                                                                                                                                                              |
| `wt-form-error-summary` | `heading`, `errors`. Retiring: a form no longer shows a summary (see Forms); no product form uses it any more; it is deleted once its remaining users, listed in `docs/backlog.md`, are gone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                                       |
| `wt-form-actions`       | `error` (the form's one message about a failed submission: shown on its own line above the buttons, full width (in a `wt-modal`, no wider than `--wt-form-max-width`) and aligned to the start, announced as an alert, painted `--wt-color-danger`); `showError` (property only, default `true`; `wt-dialog` turns it off for each row directly in its footer and shows the message itself); `cancel`, `secondary`, and default slots. The same module exports `formMessage(message)` and `formMessageStyles`, which draw that message for a screen that has to place it itself; a shadow root using `formMessage` includes `formMessageStyles`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `wt-form-error` — `detail: { message: string }` (whenever `error` changes)                                                                                                                                                                              |
| `wt-help-tooltip`       | `aria-label`; default slot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                                                                                                                                                                                                                                                       |
| `wt-relative-time`      | `datetime` (an ISO-8601 instant; one that does not parse draws nothing), `locale` (empty is the browser's), `time-zone` (an IANA zone for the exact time; empty is the browser's), `future` (for a deadline: a moment already gone reads "now"), `now` (property only; `() => Date`, for a test or a screen whose clock is replaced). Draws how long ago or how long ahead the moment is ("12 minutes ago", "in 4 minutes", "hace 12 minutos", "dentro de 4 minutos") from `Intl.RelativeTimeFormat`, in whole seconds, minutes, hours or days rounded towards zero; zero reads "now" ("ahora") and every other count keeps its number, so one day reads "1 day ago", never "yesterday". It redraws itself the moment the words would change (each second under a minute, each minute under an hour, and so on) on one timer, cleared when it leaves the page. The words are a native button in the surrounding text's colour and type, underlined with dots; the exact date and time ("5 October 2026 at 11:49", "5 de octubre de 2026 a las 11:49") is the button's description for a screen reader, and shows in a box under it, or above it where the window has no room below, while a mouse is over it and from a tap or click until a second one, a click elsewhere, focus moving away, the page or any box it sits in scrolling, or Escape (which, as in `wt-help-tooltip`, goes no further). A resized window moves the box back to the words. Put the words in a sentence of the screen's own ("Updated {time}"). In a clickable `wt-data-table` row it sits above the row's activator, so a tap shows the time rather than opening the row. It is inline text, not a `--wt-tap-min` target: WCAG 2.2's 24-pixel criterion, 2.5.8, excepts a target where _"The target is in a sentence or its size is otherwise constrained by the line-height of non-target text"_ (<https://www.w3.org/TR/WCAG22/>, read 2026-10-06)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                       |
| `wt-tabs`               | `items` (`{ key, label, marked? }[]`), `value`, `label`; named slots matching item keys and `actions`; parts: `tab-row`, `tablist`, `tab-actions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `wt-tab-change` — `detail: { value: string }`                                                                                                                                                                                                           |
| `wt-row-actions`        | `label`, `icon` (default `kebab`), `iconSize` (property; `wt-icon`'s `sm`\|`md`\|`lg`, default `md`), `align` (`start`\|`end`, default `start` — which trigger edge the popup lines up with; the popup's text starts at the start edge either way); default slot of action buttons and links; `badge` slot (drawn inside the trigger, in its top trailing corner); `part="trigger"` (the button that opens it, so a consumer can draw its border) and `part="popup"` (so a consumer can size the menu); methods `show()` and `hide()` open and close it from code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | native events from actions                                                                                                                                                                                                                    |
| `wt-data-table`         | `rows`, `columns` (each has `cell` — `(row, { ancestorOnly }) => content` — and may carry `sortValue`, `searchValue` and a `filter` — `{ label, allLabel, value, options, initial, multiple }`, which adds a choice to the Filters panel whether or not the table is `searchable`, and whose optional `initial` is the option value it starts on while no choice has been made or restored and the column's options include it; an optional `multiple` — `{ countLabel: (count) => string }` — makes the filter multi-select, with `countLabel` the closed dropdown's text once two or more values are chosen (below, "Remembered, searchable, filterable tables"); and `choosable` — `"shown"`\|`"hidden"` — which offers the column in the column chooser, starting shown or hidden; and `pinned` — `"end"` — which, set on the last column, keeps it at the trailing edge of the table's box while the others scroll sideways), `rowKey`, `rowParent` (opts into tree mode), `collapseLabel`, `expandLabel`, `rowToggleLabel` (`(row, expanded) => string` — names each row's toggle in place of the two fixed labels), `rowToggleParts` (`(row) => string` — extra part names for that row's toggle button, after `tree-toggle`), `initiallyCollapsed`, `rowGroup` (`(row) => number` — siblings sort by it first, smallest first in either direction, and by the chosen column only within a group, as the Products tree keeps categories above products; not applied to the children of a row `rowKeepsChildOrder` keeps in order), `rowCollapsible` (`(row) => boolean` — a branch it refuses is always open, draws no toggle and is never seeded closed), `rowJoinsParent` (`(row) => boolean`, default false — in tree mode a row it returns true for is drawn at its parent's indent on the `--wt-color-bg` band, while its `aria-level` still puts it a level down), `rowKeepsChildOrder` (`(row) => boolean`, default false — in tree mode the children of a row it returns true for are drawn in the order `rows` lists them, ignoring `rowGroup` and any sort, as the Products tree keeps a product's variants in the order the product holds them; their own children still sort), `loading`, `loadingMessage`, `emptyMessage`, `errorMessage`, `aria-label`, `selectable`, `rowSelectable` (`(row) => boolean` — leaves a row without a checkbox, for example a variant that moves with its product), `selected`, `selectionLabel` (`(row) => string`), `selectAllLabel`, `sortKey`, `sortDirection`, `searchable`, `searchLabel`, `searchPlaceholder` (defaults to `searchLabel`), `noMatchesMessage` (default `"Nothing matches your search or filters."`; a dashboard table passes `tableNoMatches()`, below), `filterSearchPlaceholder` and `filterNoResultsLabel` (every column filter's search box text and its no-match text, which a filter shows only above seven rows, its all row included; default `"Search"` and `"No results"`), `filtersLabel`, `filteredColumnLabel`, `filtersClearAllLabel`, `filtersCloseLabel` (the Filters panel and filtered heading label); `customiseColumnsLabel`, `customiseLabel`, `restoreColumnsLabel`, `doneLabel`, `moveColumnLabel`, `showColumnLabel`, `hideColumnLabel`, `columnPositionLabel`, `alwaysShownColumnLabel` (default `"Always shown"`), `lastShownColumnLabel` (default `"Keep at least one shown"`) (the Customise dialog and its controls), `viewKey`, `searchTerm` (narrows rows as a typed search would while `searchable` is off — for a screen that draws its own search box), `expandAllLabel` and `collapseAllLabel` (in a tree, a toolbar button that opens every branch, reading the second label while all are open), `expandAllIncludes` (`(row) => boolean` — the branches that button opens, closes and counts as open; unset, every branch), `rememberExpanded` (with `initiallyCollapsed` and `viewKey`, keeps the open branches in local storage under `${viewKey}:expanded`), `searchOpensPath` (in a tree, while a search is typed, holds every row above a match open and keeps what is under a match reachable), `rowClick` (`(row) => void` — makes each row clickable, except on a flat table a row `rowClickable` refuses, via a stretched activator button rendered in the first cell, in a tree too; while such a row is hovered, or while anything in it has focus, every cell, the pinned one included, paints `--wt-color-surface-lifted`), `rowClickLabel` (`(row) => string` — the activator's accessible name; defaults to `"Open row"`), `rowClickable` (`(row) => boolean` — on a flat table, a row it returns false for draws no activator, is not marked clickable and does not open from its pinned cell, as the Devices list leaves a disabled device; unset, every row clicks; a tree uses `rowActivation`), `rowActivation` (`(row) => "toggle" \| "click" \| "none"` — in a tree, a "toggle" branch opens and closes from a click or Enter anywhere on its row and draws its arrow as a picture, "none" draws no activator; unset, every row clicks), `stickyHeader` (`sticky-header`: rows scroll inside the table's own box under headings held at its top; below), `topAligned` (`top-aligned`: every body cell's content starts at the cell's top rather than on the first line's baseline; below), `narrow` (an attribute the table sets on itself while a tree's box is 440px wide or less; below); `stacked-search` (an attribute a `searchable` table sets on itself while it is 640px wide or less; below);`empty-action` slot (shown only while `rows` is empty); `toolbar-start` and `toolbar-end` slots (a screen's own buttons before Expand all and before Customise); `toolbar-search` slot (a screen-owned search field after the buttons);`part="tree-toggle"` (the toggle button of a branch row whose `rowActivation` is not `"toggle"`, plus any part names `rowToggleParts` returns for that row); `part="tree-heading"` (in tree mode, wraps the heading of the column the tree is drawn in) | `wt-selection-change` — `detail: { selected: string[] }`; `wt-filter-change` — `detail: { filters: Record<string, string \| string[]> }` (a single-choice filter's value is a string, a multi-select one's a list; reports a filter a person or `chooseFilter` changes; not one restored from storage, nor a choice of what is already chosen); `wt-sort-change` — `detail: { sortKey, sortDirection }`; `wt-expand-change` — `detail: { key, expanded }` (a person opening or closing one branch; not `setExpanded`); `wt-columns-change` — `detail: { shown: string[] }` (every shown column's key, in column order); native events from consumer-provided cells |
| `wt-combobox`           | `options` (`{ value, label, icon?, group?, action?, primary?, description?, disabled?, depth?, valueLabel? }[]`: `icon` is a registered `wt-icon` name drawn before the label and hidden from screen readers; a non-empty `description` is a second line under the label in the open list, `--wt-color-text-muted` at `--wt-font-size-sm`, that wraps inside the list rather than widening it and is never shown on the closed trigger, and the row is then named by its label alone (`aria-labelledby`) with the description as its `aria-describedby`; consecutive options with the same `group` render under that heading, inside a `role="group"` the heading names, and the arrow keys step over the heading; an `action` row sends `wt-combobox-action` and never becomes the value or shows as chosen; a `primary` row draws its label and icon in `--wt-color-primary-text`, hovered or not, unless it is disabled, for a row that makes or opens something rather than choosing a value, such as the product editor's "Add extras list…" at the end of its group; a `disabled` row is marked `aria-disabled="true"`, draws its label and icon in `--wt-color-text-muted` (its description is already that colour), even when it is also `primary`, with a `not-allowed` cursor and no hover background, is still matched by the search and reached by the keyboard, and is never chosen, toggled or run — a click, Enter or Space on it chooses nothing and sends no event, and the list stays open; it says why on its `description` line, as the extras list form's product picker does for a product with an Active variant; `depth` indents the row in the open list by that many steps of `--wt-space-4` beyond its usual start padding, for a tree such as the product editor's category list; `valueLabel` is what the closed trigger shows once that option is chosen, where the row shows `label` (the category's whole path, where its row shows only its own name); while something is typed in the search box, rows are matched on `valueLabel` where they have one, shown by it, and not indented, so a match deep in a tree still says where it is), `multiple`, `value`, `values`, `showEmptyOption` (`show-empty-option`: display an offered empty-string row as a selected value without changing its value; in a `multiple` choice that row is the chosen one, with its label shown as a value, while `values` is empty, and choosing it empties `values` and sends `wt-change` with `values: []` — or nothing, when they were already empty), `stableWidth` (`stable-width`: the closed trigger reserves the width of every option's closed text, and in a `multiple` choice also `countLabel(k)` for every k from 2 to the number of choosable options (options that are not an action, not disabled and not the empty value), so it does not change width as the choice does; ignored with `appearance="link"`), `allowAdd` (`allow-add`), `label`, `name`, `placeholder`, `hint` (shown as the trigger's text while nothing is chosen unless `placeholder` is set, and always the trigger's description, before the error), `required`, `disabled`, `invalid`, `error`, `hide-label` (names the trigger with `label` but draws no label, and makes the field compact), `appearance` (`"field"`, the default, or `"link"`, below) and `actionLabel` (`action-label`, the word a link trigger shows after its value, such as "Change"), `search` (`"always"`, the default; `"auto"`, which shows the search box only above `SEARCH_THRESHOLD`, 7, options; `"never"`; `allow-add` shows it whatever this says, because the new option is typed into it), `countLabel`, `noResultsLabel`, `searchPlaceholder`, `addLabel`; `help` slot. The one dropdown: the trigger is the control of the filled field box (Forms → "The field box"), showing the chosen option's `valueLabel`, or its `label` where it has none (cut with an ellipsis on one line) and a `chevron-down` icon at its trailing end; while nothing is chosen it shows the placeholder or hint, muted and italic, and with neither the label rests. In a single choice, an empty value shows the placeholder or hint, muted and italic, by default; with `showEmptyOption`, an offered empty-string row instead shows its label as a selected value. The emitted value remains `""` either way. The Units screen's reassign choice and the product unit dropdown's Each use non-empty stand-in values in their own contracts. While the list is open the field box drops its focus marking if the list has a search box, whose own line then marks focus, and keeps it if not. The open list is at least as wide as the trigger and otherwise as wide as its longest row, so a row stays on one line; it is never wider than the viewport less 16px unless its trigger is, and is pulled left far enough to leave 8px at the right edge (its left edge stops at the screen's edge); a row too long for that width wraps. The list's rows are at least `--wt-dropdown-row-height` tall and a hovered row paints `--wt-color-bg`; a chosen row's label is bold, and in a single choice the row also carries a `check` icon at its trailing end (a multiple choice shows its checkbox picture instead). A click opens the list scrolled so the chosen row (in a multiple choice, the first chosen row) is in view, without making it the active row. The search box sits on `--wt-color-surface` with one `--wt-field-line-width` line of `--wt-color-primary` all round, `--wt-radius-md` corners and no focus ring, in an area that carries `--wt-shadow-1`. With `appearance="link"` the trigger is inline text instead of a field box: the chosen value (or the placeholder) in `--wt-color-text-muted` at `--wt-font-size-sm`, then the action word in bold `--wt-color-primary-text`, with no drawn label, no chevron and no `required` marker. `label` still names it, as visually hidden text before the value, so its accessible name is, for example, "Category: Drinks › Cocktails Change". It is at least `--wt-tap-min` tall, draws the focus ring, wraps a long value rather than cutting it, shows `error` under itself with `aria-invalid`, paints its action word `--wt-color-text-muted` while disabled, and opens its list with the list's left edge at the value's; the product editor's category path is its first use. The consuming app registers the `chevron-down` and `check` icons, which `DROPDOWN_ICONS` holds. Its keyboard is described under the table | `wt-change` — `detail: { value: string }` or `detail: { values: string[] }`; `wt-combobox-add` — `detail: { text: string }`; `wt-combobox-action` — `detail: { value: string }` (an action row was picked: the list closes and the value is left alone) |
| `wt-language-chooser`   | `active` (the code of the page's language; the parent sets it and the component never changes it), `loadLocales` (property; `() => Promise<{ code, label }[]>`, called on the first open and again after a failed load; defaults to `SUPPORTED_LOCALES`; one load at a time; while it is pending, a second press, Escape, or a press or focus outside cancels the opening, and a further press asks for it again). The language chooser for an app's top bar: an inline element with no footer and no padding of its own, so the bar places it. Its `wt-button` trigger draws two parts: `name`, the active language's full name (from the loaded list, then `SUPPORTED_LOCALES`, then the bare code), shown by default; and `code`, hidden by default and hidden from screen readers, the language's short code (the code's language subtag uppercased — `en-GB` shows `EN` — or a code with no subtag uppercased whole). The trigger's accessible name is always the full name (an `aria-label` the `wt-button` forwards to its inner button), whichever part shows. The app swaps the parts at phone width with its own rule — `@media (max-width: 40rem) { wt-language-chooser::part(name) { display: none } wt-language-chooser::part(code) { display: inline } }` — because a `packages/ui` primitive may hold no literal breakpoint (`packages/ui/src/no-hardcoded-chrome.test.ts`) and a media query cannot read a token; the page's rule beats the component's own hiding, whether it sits in the document or in the shadow root of the app that holds the chooser (both cases in `packages/ui/src/components/wt-language-chooser.test.ts`). Its menu of `menuitemradio` options, each naming its language in full, opens downwards: below the trigger, lined up with the trigger's trailing edge, as wide as its longest option but at least the trigger's width and at most the viewport's width less any scrollbar and 16px, and pulled in far enough to stay 8px clear of both sides of the viewport — so a trigger within 8px of the screen's edge loses the alignment. It is a native popover in the page's top layer, so nothing outside the top layer paints over it — a table's pinned column included — and it moves with its trigger when the window resizes or a container scrolls in the document or in a shadow root whose own tree holds the chooser; a container in a shadow root the chooser is only slotted into is not heard (cases in `packages/ui/src/components/wt-language-chooser.test.ts`). Opening focuses the checked option (or the first); ArrowDown and ArrowUp move between options and wrap, Home and End reach the ends; Escape closes it and returns focus to the trigger, and goes no further only when it closed the menu; a press or focus outside closes it without moving focus; `data-test` hooks `lang-trigger` and `lang-<code>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `wt-locale-selected` — `detail: { code: string }`; a pick closes the menu and returns focus to the trigger                                                                                                                                              |

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
row and a disabled row are never chosen, and a closed multiple choice ignores it). In the open list, ArrowDown and
ArrowUp move the active row and wrap at both ends, ArrowUp with no row active going to the last row;
Home and End reach the first and last row; Enter picks the active row (an action row sends its
event), and its default is prevented whether or not a row is active. A disabled row is a row like any
other to the arrows, Home, End and the open list's type-ahead, so `aria-activedescendant` can point
at it, named by its label and described by its second line. That follows the WAI-ARIA Authoring Practices
(<https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/>, "Focusability of disabled
controls", read 2026-10-03): _"When a disabled element does need to remain discoverable,
aria-disabled="true" is applied so that it will remain focusable"_, with "Options in a Listbox"
among its examples. Enter or Space on it picks nothing (cases from "a disabled option is marked aria-disabled…" on, in
`wt-combobox.test.ts`). Without a search box the list itself
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
also applies to pinned columns. Without it, a control in a clickable row's cell — a `button`, `a`,
`input`, `select`, `label`, `wt-button`, `wt-row-actions` or `wt-relative-time` — still sits above the row's activator, so
a click on it reaches that control and not the row: the Menus list's name button opens its menu once,
by its own click (the "opens its menu once" cases in `apps/dashboard/src/screens/menus-screen.test.ts`).
The Menus list's middle-width Status column and phone-width Name column depart from this rule, a
deviation recorded for the owner in `docs/backlog/catalogue.md` (W87): each shows the menu's own state or name
with the Unpublished changes link under it and does not set `activatesRow: false`, so a click
beside the link opens the menu while the link opens only Preview. The middle-width half is guarded
by the "opens the menu once from a click on the Status cell's blank space" cases in
`apps/dashboard/src/screens/menus-screen.test.ts`; the phone-width half is not tested.

The product editor's Modifiers table is a plain table, not a `wt-data-table`, and its rows open
too: a transparent `.row-activate` button lies over each attached list's row, so a click on the
name or on blank space, or Enter or Space on that button, sends the same `wt-edit-related` as the
row menu's Edit. The drag handle and the row menu are lifted above it and keep their own actions,
and a hovered row, or one holding focus, paints `--wt-color-bg`. Guard: the "attached row" cases in
`apps/dashboard/src/widgets/product-editor.test.ts`.

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
Text sort values use `compareLabels` from `@waitron/shared`, matching the dashboard pickers:
number runs compare as exact decimals with either comma or point, so "0,25 kg" precedes
"0,5 kg" and "1.10 Postres" precedes "1.2 Sopas". Number sort values compare numerically;
a tie preserves the incoming row order, and missing values sort last in either direction.
The decimal rule also applies to dotted version and address names: "v2.10.0" precedes "v2.9.0",
and "Printer 192.168.1.100" precedes "Printer 192.168.1.9".

In the options and extras list forms, the reorder grip and other control columns take only the
width their contents need. The option name takes the spare width; the extras product, quantity and
price columns share it. Control headings can break inside a word, even in English, to stay as
narrow as the controls below them.

A table with no rows draws `emptyMessage` in a padded box with the table's own border, corners and
background, centred, and under it whatever the screen puts in its `empty-action` slot: the screen's
own Add button, rendered there only while its list is empty, so a screen whose Add button also
sits above the table shows it twice while empty (owner, A176). Devices keeps only its heading's
Add a device button, including while empty (owner, A413, 2026-10-08). A table with no Add action
leaves the slot empty. A widget that draws a table with an Add button for a screen passes the button through:
`apps/dashboard/src/widgets/staff-list.ts` forwards the slot
(`<slot name="empty-action" slot="empty-action">`), while the Products screen has no Add button in its table: its tree always shows the All products
row, whose menu holds the screen's adds (spec `docs/superpowers/specs/2026-10-02-products-category-tree-design.md`
§3), so its box appears only when a search matches nothing, holding the no-matches sentence. A
menu's Structure tab has a root row like it, whose ⋮ holds the menu's top-level adds, and an empty
menu's box repeats them as buttons (below, after tree mode). When the first item made from the slotted button empties the slot,
the screen moves focus to its other Add button rather than leaving it on the page; the Printers
screen does this by naming that button as the dialog's `opener` (see the `wt-modal` entry). When
rows exist but the table's own search or filters hide them all, the same box holds
`noMatchesMessage` and the slot is not drawn.

The no-matches sentence is one sentence, the same on every screen: `tableNoMatches()` from
`@waitron/dashboard-kit` ("Nothing matches your search or filters." / "Nada coincide con tu búsqueda
ni con tus filtros."), which every dashboard table passes as `noMatchesMessage`, including a table
with no search or filter today, so a filter added later is covered (owner, A177). The empty sentence
stays the screen's own and reads "No <things> yet." ("No extras lists yet.", "Todavía no hay listas
de extras."), except where the table lists the answer to a question rather than things made, such as
the Alerts screen's "Nothing needs attention." The Departments list says
"No departments yet." when empty. A screen that filters its rows before handing them to
the table chooses the empty sentence itself, because the table cannot tell nothing made from nothing
matching: the Orders screen's rows are always the result of its search and filters, so it passes
`tableNoMatches()` as `emptyMessage`; and the Users and Payments screens do while they hold people or
readers that their own filters hide. The Units screen's delete dialog hands its table every product
using the unit with its search as `searchTerm`, so the table's own `noMatchesMessage` covers a
search that finds nothing.

Table cells line up by their first line of text (`vertical-align: baseline`). A flex-row cell takes
its line from its first item, so that item must carry text, or the row uses `align-items: baseline`.
A picture beside the text goes inline with `vertical-align: middle`.

A table given `topAligned` (the `top-aligned` attribute) starts every body cell's content at the
cell's top instead, the pinned cell included; its headings keep the baseline. Only the Menus list
sets it (W87, owner, 2026-10-04). There the name button and the row menu are a `--wt-tap-min` tall
with their text centred, so the state's first line is pushed down by half of `--wt-tap-min` less one
line, and the Changes link is at least a `--wt-tap-min` tall, centring its text: on a wide list all
four start on one line, whether or not the state has a second line. Guards: the `topAligned` case in
`packages/ui/src/components/wt-data-table.test.ts` and the "at the row's top, on one line" cases in
`apps/dashboard/src/screens/menus-screen.test.ts`, which measure three rows at 1280 px only.

A reorderable table (`ReorderController.tableStyles`, `packages/ui/src/reorder-table.ts`) lines its
body cells up by the baseline (`vertical-align: baseline`), so on a tall row the drag handle sits on
the first line of the plain text beside it, not in the row's middle (W75b, owner 2026-10-04). The
Courses list, the Product editor's Modifiers table, the variant table and the option list form start
their cells at the top instead and push the text's first line down by half of `--wt-tap-min` less
one line, as the Menus list does. Under the baseline rule, the Courses list's name button lined the
grip up with the button's last line (`course-list.ts`). Under the baseline rule, a one-line row's
text and controls sat up to 1.5 px apart in the Product editor's Modifiers table (measured in
Chromium); the Product editor already had a one-line test that allows only half a pixel, so it
moved to the top. The option list form moved for the same kind of reason: on CI's Linux Chromium its
existing one-line test measured the radio 1.5 px from the name under the baseline rule, and that
test allows 1 px. Like the Courses list, it pads the name's button rather than the cell. The variant
table does not use the shared styles; its own
rules also start its cells at the top and push the text down. Guards, weaker than their name: the
first-line cases in `packages/ui/src/reorder-table.test.ts` (in a 300 px wide table, one theme only)
and in the tests of the Product editor, variant table, Courses list, option list, section member
list, Extras list and Prep stations screen check only that a control's middle falls within the
first line's box, so a control up to about half a line off still passes. For a one-line row, the
shared table's case checks only that the handle's icon has its middle inside the line; only the
Product editor's and the option list form's check that the text shares one centre line with
controls beside it (the option list form's checks the radio and the row menu, not the grip), to
within half a pixel and one pixel respectively. The option list form's one-line case still passed with
its name's padding removed, because the button's minimum height centres one line; only its
wrapping-name case failed.

**The Menus list links a menu's unpublished changes beside its state.** Status says what is live:
"Unpublished" for a menu never published, and "Published" with the live version and its time for
one that has been, whether or not it has changes since. A menu with changes since its live version
has an "Unpublished changes" link, named "Unpublished changes: <menu>", that opens the menu's
Preview tab (`/manage/menus/menu/<id>/view/preview`) straight away; a click with a modifier key is
left to the browser. A menu never published, one with no changes, and every menu while the states
are read or after their read fails have no link. Sorting by Status still puts the menus waiting for
a publish first. Where the link sits depends on the list's own width, read through container
queries on probe elements:

- From `50rem`, four columns: Name, Status, Changes and Actions, with the link under Changes. The
  name wraps within the list's width less `30rem`, so the four columns fit without sideways
  scrolling, a long name with no spaces or hyphens included.
- Above `30rem` and below `50rem`, three columns: Name, Status and Actions, with the link on its own
  line under the state in the Status cell, so wherever the state shows, the link is under it. A
  click on the Status cell's blank space opens the menu, as before Changes was added; a click on
  the link opens only its Preview tab. The name wraps within the list's width less three
  `--wt-tap-min` and `8.5rem`, room for the row menu and for the link. A long name can still make
  the table wider than its box, and the end of the version's time then scrolls under the pinned
  Actions column; the link stays in view. With Status its only movable column, this layout has no Customise
  columns button.
- At `30rem` or less, the state and then the link stack under the name, as the variants table's
  prices do (above).

The two name widths come from container queries of their own rather than from the layout the
probes choose, so they already apply in the frame before the probes are read; set from the chosen
layout, a 600 px list was briefly drawn with four columns and the wide width, and fitted its box.

The breakpoint and the two widths were measured in Chromium with the names
"Menú-del-mediodía-de-lunes-a-viernes-con-postre", "Menú del mediodía de lunes a viernes, con
postre y bebida incluidos" and "Menúdelmediodíadelunesaviernesconpostreybebidaincluidos", in
English and Spanish (W87, 2026-10-04): at 800 px the four columns needed at most 774 px of a 798 px
box; at 600 px the link ended 18 px (Spanish) and 22 px (English) before the row menu while the
table overflowed by 29 and 20 px. Guards: the "between the phone layout and a wide list" and "on a
wide list" cases in `apps/dashboard/src/screens/menus-screen.test.ts`, which run at 600, 700, 790,
816 and 1280 px only. The list keeps its column choices under `waitron.menus.list.table`, shared by
the two wider layouts: a choice made on a wide list does not hide Status or the link in the middle
layout, and applies again once the list is wide. The key changed when Changes was added, so a choice
saved before it, when Status was the only movable column, is not read.

**A menu's queued versions sit on its Preview tab, under Publish.** The "Scheduled versions" panel
lists every scheduled version, soonest first, then the ten most recently numbered settled ones, each
with its time on the venue's clock and its state: "Scheduled", "Cancelled" or "Activated", the last
two in the muted text colour. The time adds its UTC offset only when the venue's clock shows that
minute twice. The menus list does not show the queue: a menu whose only version is scheduled still
reads "Unpublished" there until it goes live. "Schedule a publication…" opens a form with a date
and a time; it is offered only when the preview has loaded with no clashes and the draft
differs from the version it would follow. Each scheduled row has a row menu, pinned at the end,
with two separate actions: "Change time", which opens the same form starting at that version's date
and time, and "Cancel this version", which asks first. A request that would put a newer version live
before an older one is refused with a sentence naming each version in the way and its time, under
the time field (for a new schedule or a changed time) or in the publish result (for Publish): those
that must go live first, then those that must go live after this one. The refusal never offers to
cancel anything; the manager cancels or moves the version in the way through its own row, then tries
again; a refused Publish clears only once each version in the way is cancelled or has gone live, so
its sentence says to cancel the version or publish once it is live, never to move it (A376). The
form's dismiss button reads "Close", not "Cancel", because a refusal shown above it can tell the
manager to cancel a version.

**Style your own cell markup with `part=` and `::part()`, never with a CSS class.** A cell callback
returns a template, but the nodes it produces are rendered by `wt-data-table` and so end up inside
`wt-data-table`'s shadow root — not your screen's. A stylesheet only reaches nodes inside the shadow
root that adopted it, so a `.swatch` rule in your screen's `static styles` silently matches nothing:
the element is in the page, correct in every attribute, and completely unstyled. Put `part="swatch"`
on the markup and write `wt-data-table::part(swatch)` in your screen instead — that crosses exactly
the one boundary involved. A nested primitive (`wt-button`, `wt-lozenge`) is unaffected, because it
carries its own styles wherever it is mounted. Reaching _inside_ such a primitive is one boundary
further than `::part()` can select on its own: set the token it reads on the host instead — the
categories screen's muted ancestor row points `--wt-color-text` at `--wt-color-text-muted` through
`wt-data-table::part(name-muted)`, and the button's own ghost-variant rule picks it up by
inheritance. For a property whose token is a shared scale value it would be wrong to redefine
(its padding or weight), or one it reads no token for (an underline), put
`exportparts="button: <name>"` on the `wt-button` and style `wt-data-table::part(<name>)`, as
`apps/dashboard/src/screens/modifiers-screen.ts` does for its Used by count. The tree swatches
follow this: a category's or section's swatch is `part="swatch-button"` (or `part="swatch-box"`
where it opens nothing) around `part="color-swatch"`, styled by `swatchPartStyles`
(`apps/dashboard/src/widgets/swatch-styles.ts`); a product's is `part="product-media media-link"`,
plus `media-link-busy` while the tree is busy (or `product-media swatch-box` where it opens
nothing), styled by `productMediaStyles` (`apps/dashboard/src/widgets/product-media.ts`).
Cost: the categories
screen's colour swatches, thumbnail boxes and ancestor-row muting
never rendered at all in the browser, through a full review and a green suite — DOM-presence tests
cannot see it, so assert a computed width or colour when you add a styled cell.

**A last column with `pinned: "end"` stays at the trailing edge of the table's box while the other
columns scroll sideways under it**, so a row menu can be kept on a phone's screen without the table
fitting it. It is set per column, and every row-menu column keyed `actions` sets it (A155; guard:
`scripts/pinned-actions-column.test.ts`, weaker than its name: it knows a row-menu column only by
a literal `key: "actions"` and reads only non-test `.ts` files under `apps/` and `packages/`, and never checks that the column is
the table's last; its header lists the rest). A pinned `actions` column takes only the width its
heading or widest cell needs, including when another column follows it. Any pinned last column gets
the same width rule regardless of its key; other columns take spare width. The pinned header and cells paint the row's own
background (`--wt-color-surface`, `--wt-color-surface-raised` while a row that opens nothing is
hovered, and `--wt-color-surface-lifted` while a clickable row is hovered or anything in it has
focus; a row that joins its parent paints `--wt-color-bg` while it is not hovered and, if it opens
something, nothing in it has focus), sit above a clickable row's lifted controls, and draw a
`--wt-color-border` line on their leading side from the cell's own `::before`: the table collapses
its borders, and in the 2026-09-30 screenshots a border set on the pinned cell itself showed only
once the table was scrolled to its end, never while the cell was held at the edge. A table with no
pinned column puts no `data-pinned` attribute on any cell. Guards: the pinned cases in
`packages/ui/src/components/wt-data-table.test.ts` and `wt-data-table.a11y.test.ts`, a phone-width
case per dashboard table in its own suite, most built on `expectRowMenusOnScreen`
(`packages/ui/src/test-helpers.ts`) — the alerts and in-use products tables, whose column holds a
button, check it by hand — and `scripts/pinned-actions-column.test.ts`. In a table with
`rowClick`, a click on a pinned cell's empty space opens the row, unless on a flat table
`rowClickable` refuses that row, and a click on anything inside the cell does not (the
pinned-click cases in `wt-data-table.test.ts`).

Cost: most tables put the menu past a phone's right edge.

**What the guard does not see.** `scripts/pinned-actions-column.test.ts` misses a key not written as the
literal `key: "actions"` (a variable, a shorthand, a computed name, an `as const`). It does not know
which objects are table columns, so every object with that literal key is held to the rule and a
data column must take another key.

**`stickyHeader` keeps a table's toolbar and column headings in view while its rows scroll.** With
it set, the table's box scrolls its own rows, up and down as well as sideways, and the headings stay
at the top of that box with the rows passing underneath. The toolbar sits above the box, so it does
not move either. The headings are still the table's own header row, so they line up with their
columns at every sideways position and after a column is hidden or moved. Each heading paints `--wt-color-surface` and draws the line beneath itself in
`--wt-color-border`; a filtered heading keeps its coloured line, and the pinned heading stays at the
trailing corner over both the other headings and the pinned cells. Revealing a row (`revealRow`) or
tabbing to a control in one scrolls the row clear of the headings (a row taller than the view
excepted, below), not under them: the box's
scroll padding follows the header row's measured height. The row menus, the Customise dialog and
the full-screen Filters panel (below) open in the page's top
layer, so the headings do not cover them and the box does not clip them.

The table does not decide its own height. It fills the height a flex column with a bounded height
gives it, but never less than three `--wt-tap-min` steps of box. Given no bounded column, it is
exactly that minimum, so a screen that turns it on must give it one. The Products screen does this:
on that screen alone the screen's body inside the dashboard's content column (`.main`) becomes a
flex column, and the screen, the catalogue browser and the product list each pass the space down
(`stickyHeader` on each of them). The dashboard page itself never scrolls; when `.main` is too short
to give the box its minimum, `.main` scrolls, carrying the toolbar and headings with it. The
dashboard shell test measures the Products screen at 390×844 and 375×667 with a stub catalogue of
40 uncategorised products, no category open and no message above the list: there the content column
does not overflow. A one-off measurement in that setup (2026-10-04, W83, a temporary test not kept)
found the box 83px above its minimum at 375×667, so a longer toolbar, a wrapped banner or a message
can still make the column scroll; in selection mode the toolbar is taller, and the same measurement
found the content column overflowing by 25px at 375×667. No test covers selection mode there. Only the
Products table sets it.
Guards: the sticky cases in `packages/ui/src/components/wt-data-table.test.ts` and
`wt-data-table.a11y.test.ts`, the sticky cases in the product list, catalogue browser and catalogue
screen suites, and "the Products screen in the shell" in `apps/dashboard/src/dashboard-app.test.ts`.

Supply `rowParent` — a `(row) => string | null` returning the parent row's own key, or `null` for a
top-level row — to switch the same table into tree mode, as the Products screen does for its
categories, products and variants. A row whose declared parent key isn't present among the current rows floats to the top
level rather than disappearing. A row that has children gets its own expand/collapse toggle
(`collapseLabel`/`expandLabel` give it a localized accessible name, or `rowToggleLabel` one naming its own row),
unless `rowCollapsible` refuses it or the table holds it open (below), when it draws none; where
`rowActivation` returns `"toggle"`, the arrow is only a picture and a button over the whole row carries
that name instead. Collapsed state lives inside the component, not the caller. The table renders `role="treegrid"` with `aria-level`/`aria-expanded` on
each row, and a sortable column sorts each level of siblings independently rather than flattening the
whole tree into one sort, except the children of a row `rowKeepsChildOrder` returns true for, which
keep the order `rows` gives them. Leave `rowParent` unset for the ordinary flat table — the two modes share
every other property. Set `initiallyCollapsed` when parent rows are summaries and children are
on-demand detail; a branch is seeded closed once, so a later row refresh does not close it again
after the person expands it. When search keeps an ancestor solely to reveal a matching descendant,
the table opens that branch without showing an ineffective collapse control; clearing search restores
the branch's own collapsed state. With `searchOpensPath`, as the Products tree sets it, every row above a match is held open
while a search is typed, even one that matches itself, and what passes the filters under a match
stays reachable, closed as the person left it. With filters alone, only a row kept solely to hold a
match's place is held open. A tree whose box is 440px wide or less indents each level
`--wt-space-2` instead of `--wt-space-4`, and no deeper than four levels, and its arrow slot is
one cell padding (`--wt-space-3`) narrower than `--wt-tap-min`. A branch's toggle button stays
`--wt-tap-min` wide by reaching back over the 12 px before it, which on every row is inside its own cell, so it takes no more of the row than the other slots and its tap target stays
whole; its focus ring is then drawn inside the button, because a top-level
one can sit against the scrolling box's edge. The table publishes
the arrow slot's width as `--tree-arrow-width`, which a screen reads to line up its Name heading
or its own slots (W85e, owner 2026-10-05). A CSS condition cannot
read a token, so the table watches a tree's box in code and, a frame after each change to the box's
width, sets a `narrow` attribute on itself if the box is that narrow and removes it if not; a flat
table is not watched and carries no `narrow`. A screen may style its cells on
`wt-data-table[narrow]`, as the Products tree does for its category name box.

A tree also answers `isExpanded(key)`, opens or closes a branch with `setExpanded(key, expanded)`
(no event), reports the order it would draw a set of siblings in with `sortedSiblings(rows)`, and
`revealRow(key)` opens every closed branch above a row and scrolls the row into view. Under
`stickyHeader`, Chromium rounds the scroll position to a whole pixel (measured at a device pixel
ratio of 1), which can leave a row brought in at the top edge part of a pixel under the headings;
`revealRow` then scrolls back to the whole pixel below. It corrects an overlap of less than one
pixel only, so a row taller than the view that already spans it keeps its scroll position. The
tests ran rows 30.3 px tall at a device pixel ratio of 1, each revealed from the box's end, and one
900 px row revealed while it spanned the view. A row brought in at the bottom edge gets no
correction.

Any table, flat or a tree, answers `filterValues(key)` and takes a filter choice with
`chooseFilter(key, values)` (below, "Remembered, searchable, filterable tables"). `shownKeys()`
lists the keys of the rows the search and filters show now, in a tree with the rows it keeps around
a match, and including rows a closed branch hides.

**A menu's Structure tab is the second tree** (`dashboard-menu-structure-table`,
`apps/dashboard/src/widgets/menu-structure-table.ts`; W88, owner 2026-10-04). Its first row is the
menu itself, like Products' All products row (A453, 2026-10-10; it replaced A337's toolbar plus
button): the menu's name in bold, then its counts, such as "3 sections, 12 products", each section
and product counted once, those inside included menus too. The menu's colour chip is drawn before
the name only when the menu has a colour; it is a picture, not a button, since the colour is edited
in the menu's settings. That row's ⋮ holds the menu's own adds — Add section, Include a menu and Add
products. It cannot close, has no checkbox in Select mode and no grip in Reorder mode, nothing can
be dropped on it, and no search or filter matches it, so while one is set the row is drawn only
above a match. Under it the menu's members are the top-level rows,
in menu order, with no sort, and any of them can close. While the menu is empty the table draws no
rows and no toolbar, so its empty box says
"Nothing is on this menu yet." with the same three adds as buttons under it, and Reorder and Select
turn off. A row's key
is the member ids from the top level down to it, so a section shown in two places is two rows. The ⋮
of a section the menu owns holds the same three adds, then Edit and Delete; an add acts on that
section from whichever place it was chosen, and makes that row the current one, whose name is drawn
bold and underlined with `aria-current="true"`. A product's ⋮ holds Edit product, a link to the
product's page, then "Remove from <list>", naming the
list that holds it. An included menu's row reads "Menu: <name>" with "Shown as a folder" or
"Sections shown directly" under it. Its ⋮ holds "Open <name>", a link to that menu's own Structure
tab; Edit, which opens the include's dialog (`dashboard-include-folder-form`) with a
"Show as a folder" switch and, while the switch is on, the folder's customer-facing names, colour
and photo, each following the included menu until it is changed; and "Remove from this menu". The
rows inside an included menu open and close for browsing but have no grip, no ⋮ and a muted name; in
Reorder mode each keeps an unseen grip-sized space. Only an owned row has a grip.
In Reorder mode, put every grip in one leading column before the tree arrow and indentation.
Reserve that column on read-only rows. Keep the arrow and media slot inside
the indented name column, so names at one level and the Name heading stay aligned. The media slot
holds a section's colour square or a product's colour square or photo. A photo has a ring in the product's own colour, falling back to its category's inherited
colour, then to the venue's default. On an owned row the product slot is a link to the product's Edit dialog on the Catalogue
screen, which opens with its photo field focused; on an included menu's row, or for a product the
library no longer holds, it opens nothing. Section squares still open their colour picker directly. Hide
media in both trees when the tree's box is at most 440px wide. In the Products list the product
editor remains available through the row's Actions menu, and a Menus Structure product row's
Actions menu offers Edit product at every width.

The toolbar has a search box ("Search this menu" / "Buscar en esta carta") that matches the names the
rows show and opens the sections above a match, and the Available column has a Yes / No filter; a
section or an included menu answers neither, so it stays only on the way to a match. There is no
filter on Type: its three values are already told apart by the folder frame and the arrow. A search
draws the closest matches first rather than in the menu's order, so while the search box holds
anything but spaces, punctuation alone included, Reorder draws no grips and a drag already held ends
with no move; clearing the search brings the grips back. While the Available filter alone hides rows,
ArrowUp and ArrowDown move a member past the next sibling that is drawn, never past a hidden one.
The search clears when another menu opens or the menu empties.

Beside Reorder is a Select icon button (the Products tree's, "Select" / "Seleccionar"). In Select
mode every row the menu owns has a box named "<name>, in <list>" (rows inside an included menu have
none), and a bar under the toolbar shows how many rows are ticked with three buttons: **Move to
section…**, **Remove from menu** and Done, which leaves the mode and puts focus back on Select.
Select and Done cannot be pressed while a change is being saved. While a search or filter is on, a section
shown only because something inside it matches has no box, so Select all never ticks a section whose
hidden rows would go with it; a section whose own name matches keeps its box, and none has one under
the Available filter, which no section answers. The selection clears when the mode turns off, the
search or a filter changes, another menu opens, or a bulk change succeeds; a re-read of the menu or its products (a live update, or the screen's own after a save) drops a
ticked row it takes away, or one the search or the Available filter no longer shows with a box (a
row inside a section the person closed stays), from the selection and from an open confirm or
dialog, which closes once nothing is left. Only the outermost selected rows are acted on: a row inside a selected section
travels with it, wherever that section is shown, and a member ticked in two places is sent once, so
the confirm and the dialog count what is sent. Remove from menu asks first ("Remove 2 items?", "¿Quitar 2 elementos?")
and lists each item with the list it leaves; it stays quiet and disabled while a section the menu owns is selected, with a line saying a
section is deleted from its own row's ⋮, because a section the menu owns is deleted, never removed.
Move to section… opens a dialog with one required destination: "Top level" first, then every section
the menu owns, by its path joined with " › ", leaving out each selected section and every section
below it; never a list inside an included menu. Its Move action is quiet until a destination is
chosen, and again if a live update takes the chosen one away; closing it with one chosen asks
first (`draftScopeFor`, `menus-screen.structure-move.unsaved.test.ts`). Both send one request: `POST
/management-api/section-members/remove` and `POST /management-api/sections/:id/members/move-in`,
which moves the member rows themselves, so a moved product keeps the menu's price for it and an
included menu keeps its folder setting (`moveMembersInto`, `packages/catalogue/src/sections.ts`).
Copying products into another section is not built.

The grips show only in Reorder mode, so a menu is not rearranged by a stray drag while you browse
it. The tab's toolbar starts with a Reorder icon button (a grip mark, Reordenar in Spanish; "Icon
buttons with a tooltip", below), pressed (`aria-pressed`) while the mode is on. While it is on, a
Done button at the toolbar's end turns it off and puts focus back on Reorder, since Done itself
disappears; pressing Reorder again turns it off too. Opening a menu, or going back to the list,
turns it off, so each menu opens with it off (`structureReordering`,
`apps/dashboard/src/screens/menus-screen.ts`). Outside the mode no row has a grip, so neither a
pointer nor the keyboard can move a member.

A grip moves a member anywhere in its own menu, not only among its siblings (owner decision
2026-10-07, A338: "if i drag a product in the menu into a different section, it doesn't move"). A
pointer drag starts from the grip only, with Products' ghost and gap (the shared
`apps/dashboard/src/widgets/tree-drag.ts`). Over the middle half of the row of a closed or empty
section the menu owns, a release puts the member at the end of that section; the row's first cell
is marked `part="drop-target"`, every cell of the row is tinted `--wt-color-surface-lifted` inside a
`--wt-color-primary` ring (`markInto`; the Products tree marks a category the same way), and no gap is drawn. Over any other row, or the top or bottom
quarter of that one, the gap shows beside the row. Beside a sibling the release reorders the
list (`wt-member-move`), with the gap before a sibling above the member and after the last drawn
row of one below it. Beside a row of another list it moves the member into that list at that place
(`wt-member-move-into`), with the gap before the row while the pointer is in its upper half and
after its last drawn row while in its lower half. Nothing is offered — no gap, no mark, and a
release sends nothing — over the dragged row or anything drawn inside it, over a list inside a
dragged section wherever that list is drawn, over a row inside an included menu, over another list
that already holds the same product or section, over the dragged member's own list where it is drawn in
another place, and, for a product no longer in the catalogue, anywhere but beside its siblings. On
a grip, ArrowUp and ArrowDown move the member one place within its own list. ArrowRight moves it to
the end of the sibling drawn directly above it, when that sibling is a section the menu owns that
does not already hold the same product or section and is not the moved section or one inside it.
ArrowLeft moves a member out of its section to the place directly after that section, unless that
list already holds the same product or section; at the top level it does nothing. Neither of
these two keys moves a product no longer in the catalogue. Each key
announces the move, and the grip lists the four keys in `aria-keyshortcuts`. A move into another
list sends the same request as Move to section… (`moveMembersInto`), so a moved product keeps the
menu's price for it. The screen then reads the menu again and, while the menu on screen still has the
destination where it was, opens it so the moved row is drawn; otherwise the member error line says
the move was saved but another change took the destination away; after ArrowLeft or ArrowRight, focus goes to the moved row's grip, or back to the old
grip when no such row is drawn. A refusal shows in the tab's member error line, naming the
destination list when it is not the list on screen, and the menu is read again; a move whose source or
destination list another change has moved or taken off the menu by the time it is sent, or one
still waiting when another menu is opened, sends nothing and reads the menu again. When a window
opened from a row's ⋮ closes, focus goes back to that ⋮ once nothing is being saved or read, or to
the ⋮ of the nearest row above it still drawn; a removal hands it to the ⋮ of the row that held the
member; at the top level, to the root row's ⋮, or in an empty menu to the empty box's first add. Guards: `apps/dashboard/src/widgets/menu-structure-table.test.ts`,
`menu-structure-table.a11y.test.ts` beside it, and the Structure tree cases in
`apps/dashboard/src/screens/menus-screen.test.ts`, inside `describe("the Structure tree")` and the member-move cases above it.

Hold a dragged row or tile near the visible top or bottom edge to reach rows outside the current
view. `DragEdgeScroll` (`packages/ui/src/drag-edge-scroll.ts`) follows the nearest scrolling box
across shadow roots, using `--wt-tap-min` for the edge band; the closer you hold to the edge, the faster it
scrolls. Each scroll refreshes the drop target. Leaving the band, releasing, cancelling or pressing
Escape ends the scrolling loop. Products, Menu Structure, shared reorder tables, preparation
stations, the Customise column list and the Home page tab's shortcut preview use this helper. Shared
reorder tables and preparation stations keep the moves already made when a drag is cancelled, as
they do on pointer cancellation; Products, Menu Structure and the shortcut preview apply their move
only on release.

### Remembered, searchable, filterable tables

`wt-data-table` shows its empty message and `empty-action` slot alone when `rows` is empty.
When the table has source rows, it draws a toolbar if `searchable` is set, a column carries a
`filter`, a column is `choosable` and the columns hold at least two movable ones (every column
but the first and a `pinned: "end"` one), a tree has an `expandAllLabel`, or the screen supplies a
`toolbar-start`, `toolbar-end` or `toolbar-search` control. A filter or search that hides every source row leaves
the toolbar available so you can change the choice.

The search box appears only when `searchable` is set. **Filters sits at the toolbar's start and
opens its panel beside the rows.** It is an icon button (a funnel) drawn before the `toolbar-start`
slot and the search box, named by `filtersLabel`, with the shared tooltip ("Icon buttons with a
tooltip", below). Its count badge, which is also its accessible description, counts each filter
whose current choice is not "all", including an `initial` choice, and the button reads as pressed
while the panel is open. The panel lists every filtered column, including one that is hidden. Each
section keeps its heading and choice control visible. Choose the column's "Any …" option to clear
it; Clear all resets every filter. Opening focuses the first choice. A filtered column's heading
has a coloured inset bottom line and includes the filtered state in its accessible name. The
panel's labels are supplied through `filtersLabel`, `filteredColumnLabel`, `filtersClearAllLabel`
and `filtersCloseLabel`.

While the table is at least 768px wide (`SIDE_FILTERS_WIDTH`), the panel opens in the flow at the
rows' leading side, seven `--wt-tap-min` steps wide. The rows' box narrows beside it and takes its
full width back when the panel closes; column widths held for a choice made there are let go on
closing. A press outside does not close it: its Close button, Escape inside it, or the Filters
button do, and the first two return focus to the button. Under `stickyHeader` it fills the rows'
height with `overflow-y: auto`, so it and its button stay put while the rows scroll. Narrower than
768px, it opens as a full-screen popover, with Tab kept inside.
A width change across 768px while it is open moves it to the other form, still open and with its
choices. It stays open when a choice in it hides every row (beside the no-matches message from
768px wide), so the choice can be changed back, and focus stays on the filter used, as it does when a choice brings rows back.
Toolbar controls follow their markup order at every width: Filters, `toolbar-start`,
Expand all, `toolbar-end`, Customise, then search. Put a screen-owned search field in
`toolbar-search`; Products forwards that slot through its product list. Search comes last so
Tab follows the buttons across the first line before reaching the search line on a narrow table.
The Products browser puts Select in `toolbar-start` and gives search a full line when its own
width is 40rem or less. A table's own search (`searchable`) takes a full line at 640px
(`STACKED_SEARCH_WIDTH`) or less. Wider tables leave search beside the buttons where they fit.
Guards: the "Tab follows" cases in `packages/ui/src/components/wt-data-table.test.ts` and
`apps/dashboard/src/widgets/catalogue-browser.test.ts` press Tab at 390 and 1280 px in both themes.
A container query whose width condition reads a token did not match in Chromium (a probe,
2026-10-07), and a `packages/ui` component may hold no literal breakpoint, so a `searchable` table measures its own width in code and, a frame after each change, sets a
`stacked-search` attribute on itself; a hidden table, measured 0 wide, does not carry it. Guards:
the "in a table … px wide", hidden-table and "only while it is searchable" cases in `packages/ui/src/components/wt-data-table.test.ts`, and the stacked-search case in `wt-data-table.a11y.test.ts`.

Each section retains the `wt-combobox` choices its column's `filter` descriptor supplies. Its
"all" row is shown as a chosen value while its empty string means no filter. A filter with
`multiple` holds any number of choices at once: its dropdown is a `multiple` `wt-combobox`, the
"all" row still first and shown chosen while nothing is ticked, and picking that row unticks
everything. A row passes it when it matches any chosen value, and it counts once in the Filters
badge however many it holds. The search box is
named `search` and each dropdown `<column key>-filter`. A row must pass every active filter and
the search to show. A column exposes text to the search with `searchValue`; a column without one is
not searched. A filter's `value` may return a list for a row that belongs under several options
at once, such as a product placed in two sections; the row shows when the list holds a chosen
option. Pass `sortKey`/`sortDirection` to choose the starting sort; the table then owns it and
emits `wt-sort-change`.

**One search rule.** The table, `wt-combobox`, the screens with their own search and the server's
searches all use the matcher in `@waitron/shared` (`textSearch`, `packages/shared/src/text-search.ts`;
the venue store registers it with SQLite as `waitron_search_rank`). A row matches when its
`searchValue` columns — its names, and on the Users screen also email and telephone — hold every word typed, in any order, ignoring accents, capitals and
punctuation. A word followed by a space or punctuation must be a whole word; the word still being
typed may be any part of one. A search of only spaces is no search, and a search of only
punctuation matches nothing. Matches are listed closest first (`compareSearchRanks`: a whole word,
then the start of a word, then the inside of one), ahead of the table's own sort, which then orders
rows that tie; `rowGroup` still comes before both. In a tree the closest come first among the rows
under each parent, and in a grouped `wt-combobox` within each group.

Give the table a `viewKey` and it remembers its sort and filter choices in the tab's session storage
— never the search text. It restores them once it has columns: a stored sort only if a current
column can still sort by it — its direction is restored with that column or not at all, so the
starting sort stands whole — and every stored filter value that is a string or a list of strings. Once its column is declared
with a `filter` (a column the chooser hides included), a stored value of the wrong shape for it (a
string for a `multiple` filter, a list for a single-choice one, as a view saved before a filter
became multi-select holds) is dropped and the view rewritten without it. Once the column offers a
non-empty options list, a stored list loses the values that list does not include, and a list left
with none is removed, so the column starts again as if nothing were stored; while the column offers
an empty list, a stored list waits unchanged, as a single choice does. A stored empty list, an
explicit "all", is kept only where the column names an `initial`. A `filter` may name
an `initial` option, which it starts on until a choice is made or restored, while the column's
options include it; choosing the "all"
option over it is then stored as a choice of its own (an empty string, or an empty list for a
`multiple` filter), so it survives a reload. A
filter choice, restored or picked, narrows rows only while its column offers it, and its dropdown
in the panel then shows it. Each time the columns change, every choice is checked against its column. A chosen
option the column's current option values no longer include is cleared, and the stored view is
rewritten without it, rather than hiding every row behind a panel choice that reads "all". A
single-choice dropdown then returns to the column's `initial` option when it names one still
offered, and to its "all" option otherwise; a multi-select list loses only that value, and returns
the same way only once it holds none. A chosen option whose column is not rendered, has no `filter`, or has
an empty option list (a screen still loading the data it builds them from) waits instead: it hides
no rows, stays in storage when the view is saved for another change, and is checked when the column
next has a non-empty list. Clear all removes those waiting choices too; choosing a column's
"Any …" option removes its own waiting choice. So one `viewKey` can serve two layouts that show different columns. A
stored "all" does not wait: it is kept only while its column is rendered with a `filter` that names
an `initial`, and otherwise cleared and the stored view rewritten without it, so a layout that
leaves the column out forgets that "all" was chosen.

`filterValues(key)` answers the values a column's filter narrows rows by now — a choice, a
restored choice or its `initial` option — and none while it narrows by "all" or its choice waits.
`chooseFilter(key, values)` chooses as a person would: only the values the filter offers now, the
first of them on a single-choice filter, and "all" when given none. The choice is reported with
`wt-filter-change` and remembered under the `viewKey`. Given one or more values, none of which the
filter offers now (which is every value while its option list is empty), it changes nothing, so unlike a restored
choice it does not wait for options to load; a column without a `filter` is left alone too.
Guards: the `filterValues` and `chooseFilter` cases in
`packages/ui/src/components/wt-data-table.test.ts`.

A table with `choosable` columns draws a Customise columns icon button at the toolbar's trailing
end, but only while its current columns hold at least two movable ones — every column but the first
and a `pinned: "end"` one. With one, the dialog could change nothing: that column can neither move
nor be hidden, because the last shown movable column stays shown. So a list whose only movable
column sits between its name and its buttons draws no Customise button, and nor does the Menus list
below `50rem`, where Changes is not a column and, at phone width, Status is not either. A
stored choice is kept meanwhile and applies again when the columns offer a choice; one that hides
that single column leaves it shown. An open dialog closes when the columns stop offering a choice.
The dialog lists every column in table order. A column the person can hide has an eye control. A
column that can never be hidden — the first column, any
`pinned: "end"` column, and a column with no `choosable` — has no eye: its row says
`alwaysShownColumnLabel` ("Always shown") in muted text where the eye would be. The first and the
pinned columns are fixed in place, with no drag handle; an empty space of the handle's width stands
in its place, so every column name starts at the same point. Other columns move by pointer drag or
by the handle's arrow keys. While a pointer drags a column, its name follows the pointer and the row
it can land on is highlighted. The preview and highlight disappear when the drag ends or the dialog
closes. The dialog's Restore defaults button resets order and visibility. Escape closes it and
returns focus to the trigger. The first column remains shown, and the last visible movable column
cannot be hidden: its eye stays, checked and disabled, with `lastShownColumnLabel` ("Keep at least
one shown") under its name, which the eye names as its description (`aria-describedby`). Being a
disabled native checkbox, it is out of the tab order. Guards: the chooser cases in
`packages/ui/src/components/wt-data-table.test.ts` and the Customise cases in
`wt-data-table.a11y.test.ts`. A hidden column keeps its filter in the Filters
panel, which keeps narrowing rows, and search still reads it; it stops sorting the rows while
hidden, but `sortKey` still names it, so showing it again restores the sort. With a `viewKey`,
visibility is remembered per browser in local storage under `<viewKey>:columns` as
`{ [column key]: boolean }`, and order under `<viewKey>:column-order` as a list of keys. Unknown
stored keys are ignored and newly added columns take their declared place. Sort and filter memory
remains in session storage. Blocked storage and malformed JSON leave the defaults in place.

Every list a dashboard screen or dashboard module shows as its main content with `wt-data-table`
offers customisation for every column except the one that names the row and the one holding the row's
buttons, which are always shown. A column starts shown unless the screen has a reason to hide it
(the adjustments report hides its people table's Approvals given and its entries table's Credited
to, `packages/adjustments/src/dashboard/adjustment-report-screen.ts`); the table passes translated dialog labels, the two
"always shown" and "keep at least one" words included, and a `viewKey` of its own. A table inside a
dialog or picker does not offer customisation, a list whose only other column is its buttons
(servers) has nothing to offer, and a list with one column between its name and its buttons shows
no Customise button, as above.

In tree mode the table keeps a match's ancestor rows and tells each cell, via its second argument's
`ancestorOnly`, whether the row is present only to hold a descendant's place — mute those with a
`part` on the cell.

A tree row for which `rowJoinsParent` returns true is drawn as part of its parent's row: at its
parent's indent rather than a level deeper, on a band of `--wt-color-bg`, while its `aria-level`
still puts it a level down. The Products list draws a product's variants this way, and keeps them
in the order the product holds them whatever sorts the table, through `rowKeepsChildOrder`;
`sortedSiblings` answers that order too. The toggle
button a branch row draws when its `rowActivation` is not `"toggle"` carries `part="tree-toggle"`,
so a screen can restyle its arrow (colour, size, where it sits in the button); its width, and at
phone width its start margin and start padding, belong to the table (above). `rowToggleParts` adds part names after it, so a screen can style one
kind of row's toggle apart from another's: the Products list names a product's toggle
`variant-toggle` and makes only that one small and muted. In tree mode the
heading over the tree's column is wrapped in `part="tree-heading"`, so a screen can line it up with
what its rows draw there. Supply `rowControls` to render controls in the leading column shared with
selection checkboxes, outside tree indentation. Name that column with `rowControlsLabel`. Keep
its default baseline alignment for Products' wrapped names; Structure uses
`rowControlsAlign="center"` for its name-and-note stacks. Put a full-width lower toolbar in the
`toolbar-bottom` slot; Products forwards that slot for its selection bar.

In Select mode, put selection checkboxes and drag grips together in the leading column, before
the tree arrow and indentation. Leave a blank grip on All products and a category being added;
outside that mode, draw no grip or its space and allow no drag. In the name column, first comes
the table's arrow or its blank space, narrower at phone width as above.
Last comes a slot a product photo wide: on a category
row it holds the category's colour square, centred, and on All products the venue's default colour
square, an empty outline when there is none; on a product row, the product's photo with a
colour ring, or a filled colour square when it has no photo. Both use the product's own colour,
falling back to its category's inherited colour, then to the venue's default; without any of them
the frame is empty. A category with no colour of its own shows the colour it inherits the same way:
from the nearest coloured category above it, else the venue's default, else an empty outline. An
inherited colour is marked, not by colour alone (owner, 2026-10-08, A423): its square keeps its size
but takes a dashed 1px `--wt-color-text-muted` outline with a `--wt-space-1` gap before the fill, and
`--wt-radius-md` corners, which a product's square always has (an `inherited` part beside `color-swatch`), and a photo's coloured ring is dashed. Its accessible name says
where it comes from (`folders.edit_color_inherited`, `product.edit_named_inherited`), naming the
category or All products. Opening an inheriting category's colour picker starts on No colour. Clicking
the product slot opens the product's Edit dialog with its photo field focused. Category squares and
All products' square open their colour picker directly. On a category being added or renamed the slot holds the name box's colour square (below). No row draws a folder icon, though the picture that follows the pointer while you drag
a category keeps one. Then come `--wt-space-3` and the name. So on those rows names step in by the
table's indent per level whether the row is a category or a product, and the Name heading, which
moves with the mode, sits over the All products name. Each row's colour square sits at its own row's
indent, one step in per level, rather than every square sharing one column (owner, 2026-10-08, A415). A colour square and a product's photo or
placeholder each occupy a `--wt-tap-min` square, including their border. This keeps the square's
colour action at the minimum tap size and gives photos the same visual size. At phone width, when
the table carries `narrow` (its box is 440px wide or less), both trees hide the category, All products or section
slot — except a category's while it is being named (below) — and the product photo or placeholder, so names at the same level start together. The Products
tree visually hides each category's count, including All products', with the shared visually hidden
pattern. The text remains in the row's accessible name, so screen readers retain the contents count
while the visible name gets more room. A category's cell is laid out as a product's is, so when its
name wraps, keep its grip and wider-layout colour square beside the name's first line. A
variant's row draws no grip. Its photo square sits in its product's column and shows the variant's
own photo, else its product's, in the same frame its product's square uses; it opens the variant's own
editor at its photo. At phone width the square is hidden, as a product's is, and the name starts
under its product's name. Each name, with what follows it on its row (a category's count and the asterisk that marks a
category with no active station; a product's variant count), takes
only the room between its own start and the row's pinned Actions cell, measured as if the table
were unscrolled, and wraps inside it, a single long word included; a name that fits stays on one
line (`#fitNames`, `apps/dashboard/src/widgets/product-list.ts`). The box that names a new category
or renames one is capped at the same room, though never below `--wt-tap-min`. The one exception,
while the table does not carry `narrow`: while a category is being renamed, its count and asterisk
follow the name box and are not capped. At phone width (while the table carries `narrow`) the name
box of a category being renamed or added goes on a line of its own under the row's first slot
instead, starting in the name column after the tree arrow,
taking the room from there to the pinned cell. Keep the grip in its leading column and a renamed category's asterisk on
the line above, and the asterisk wraps in what they leave of that room; the count is hidden
at that width (above). While a category is being renamed or added, the name box's colour square
takes the row's colour-square slot, where the row's own square sits at rest, and the box starts
where the name started. The name box's square shows only a colour chosen for the category itself,
so an inheriting category's shows the empty outline while it is being named. At phone width that slot shows only while naming, on the row's first line
above the box. That square is not a Tab stop, so Tab still leaves the box.

Use `wt-modal` for an add or edit form. Its fields stop at `--wt-form-max-width` (see "Structure"
above). Give it a `size` chosen by its content:

- `size="compact"` (`--wt-modal-compact-width`, 448px): a confirmation, or one or two short fields.
- `size="standard"` (`--wt-modal-standard-width`, 672px): an ordinary editor. Its body holds a form
  at the form width beside a classic scrollbar (17px allowed for it).
- `size="wide"` (`--wt-modal-max-width`, 1024px): a table wider than a form, a side-by-side layout,
  an image grid, or a toolbar that needs one line.

A modal given no size, or a value not listed, is wide. Choose one anyway, so a reader can see the
choice; do not widen a modal past what its content needs. Each size is bounded by the viewport less
the modal's side margins, so on a phone every size is the same width (measured at 390px and 320px
wide). Each size reads only its own
token: an ancestor's `--wt-modal-max-width` resizes an unsized or wide modal and leaves a compact or
standard one alone, and to resize one sized modal you set its own size token on it. A size is not
passed down: a wide or unsized modal opened inside a compact or standard one is still wide. Changing
`size` on an open modal resizes it, and the property is reflected to the `size` attribute.
Guards: the size cases in `packages/ui/src/components/wt-modal.test.ts`, and the order of the sizes
and the standard modal's room for a form in `packages/ui-core/src/tokens/structure.test.ts`. The
compact modal fits its content, up to the viewport height less 24px top and bottom margins.
Standard and wide modals keep that full height even with short content.
Its side margins (`--wt-modal-inline-margin`) and the inline padding of its body and footer
(`--wt-modal-inline-padding`) are 24px from 800px wide and shrink on a phone to 4px and 12px, so the
width goes to the content. They are fluid `clamp()` values rather than a breakpoint because a media
query cannot read a custom property, and the no-hardcoded-chrome guard
(`packages/ui/src/no-hardcoded-chrome.test.ts`) refuses a literal `px` or `rem` breakpoint in a
`packages/ui` primitive. Unlike `wt-dialog`, its width is not held to 90% of the viewport. As in `wt-dialog`, the body scrolls
independently, so your footer actions stay visible; unlike it, the body is a Tab stop even when it
does not scroll, and the modal opens with focus on its body. It uses the raised surface and shadow tokens:
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
<wt-modal heading="Add printer" size="compact">
  <wt-input name="printer-name" label="Printer name"></wt-input>
  <wt-form-actions slot="footer">
    <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
    <wt-button variant="secondary" disabled>Save</wt-button>
  </wt-form-actions>
</wt-modal>
```

Save opens quiet and disabled; bind it with `saveActionState` as shown under Forms.

A section's Add products (`apps/dashboard/src/widgets/section-add-products.ts`) draws its own count
and buttons, so they cannot go in the window's footer slot; it keeps them in a block stuck to the
bottom of the scrolling body (`position: sticky`) instead.

The setup wizard is not a modal: its screens sit in a raised column centred on the page, with the
Waitron logo at the top of every screen (owner decision 2026-09-28, C39).

**A page with a persistent view and one reused `wt-modal` for every edit action** (a settings-style
screen editing itself, as opposed to a list opening a modal per row) has one more thing to get
right: the underlying native `<dialog>`'s `close` event lands asynchronously relative to the
`open` property change that triggers it. If your own code (Cancel, or a successful Save) already
switched to a different mode/state _before_ that pending `close` event arrives — because the
caller opened a new edit right after closing the old one — a plain `@wt-close=${() =>
closeHandler()}` will stomp the newer state back to closed. Reproduced only under real timing load
(passed reliably in isolation, failed intermittently in the full suite) — arm a flag when _you_
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
to handle dismissal, including Escape. The native dialog keeps focus inside while open. In Chromium,
on close the browser hands focus back to whatever had it when the dialog opened, including an
element inside another shadow root. That is the button that opened the dialog only if the button
still had focus then; a screen that opens a dialog after focus has moved on hands focus back itself
if it wants it elsewhere.

In Chromium, when what had focus at opening was removed, disabled or hidden while the dialog was
open, or nothing had focus at opening, the browser leaves focus on the page body or inside the
closed dialog. In that case `wt-dialog` (and `wt-modal`) moves it: to `opener`, an optional property
a screen may set to the element focus should go to instead (usually the button that opened the
dialog, or one standing in for it), when that is still on the page and takes focus (a host that
passes focus into its own shadow root counts). Otherwise it walks outward from the element that had
focus at opening, or from the dialog when that element is gone or the page body had focus. At each
enclosing element it tries every element inside it with tabindex 0 or above that is not disabled, in
document order with a host's open shadow root before its own children, skipping the dialog; then the
enclosing element itself, when its tabindex is 0 or above and it is not disabled. The first that
takes focus keeps it. When none of those takes focus, focus stays where the browser left it. This
happens before `wt-close` is sent, and for a close by setting `open` false it has happened by the
time that update completes, so a screen that hands focus back itself, from `wt-close` or after the
update, still has the last word. A screen whose own hand-back runs only when focus has been lost
usually no longer sees it lost, because the dialog has already moved it; it still does when nothing
takes focus. Cases: `packages/ui/src/components/wt-dialog.test.ts`, and for a hand-back after the
update the describe block "focus after the unit form opened from the unit chooser closes" in
`apps/dashboard/src/screens/catalogue-screen.test.ts`. Use `wt-dialog` for a compact confirmation.

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
or the nav toggle looking like just another row's overflow menu. The till's top-bar More menu is a
hamburger (`apps/till/src/widgets/tab-shell.ts`, registered in `apps/till/src/till-app.ts`): it
holds the screen's own navigation and tools, not one item's actions. Kebab stays for one row's or
one card's actions.

### Selection mode

When you need to act on several rows together, give the list a **Select** button. Show
checkboxes only while selecting, with an action bar for the selected count, actions and
**Cancel**. Clear the selection when you navigate, search or change a table filter, so an
action cannot apply to rows you have just hidden. Cancel clears the selection and exits
selection mode, restoring the ordinary toolbar. It does not cancel a Delete you have
already requested.

On Products, name the mode button Select (Seleccionar in Spanish). The mode shows selection
checkboxes and drag grips; a drag files rows into a category and keeps the table's name sort.
Put the checklist icon button after Filters and before Search. Show its pressed state while
selecting. Pressing it again clears the selection and leaves the mode.

While selecting, show a separate bar directly below Search, above the table body. Put the live
selected count, Move to…, Disable or Delete as the selection allows, and Done in that bar. Let
its controls wrap at phone width. Keep the table's Expand all and Customise in the search toolbar.

Products leaves the mode by **Done** rather than Cancel, the one exception to the rule above. A drag
made in the mode is saved as soon as it is dropped (`#drop`,
`apps/dashboard/src/widgets/catalogue-browser.ts`), so Cancel would promise an undo it cannot give.
Done clears the selection, leaves the mode and puts focus back on Select, since Done
itself disappears.

For example, selecting Drinks and Bread shows **2 selected** and lets you move both in one
step. Confirm destructive actions in a `wt-modal` with a `danger` button. Keep a refused
action open and show its message at the bottom of the form, so you can correct the choice.
For folder deletion, read what every selected folder contains before enabling Delete.
When the selection is only folders with no products, subfolders or routing rules (cells on their
rows in the routing grid), they are deleted without asking; when they hold only routing rules, the
confirmation gives the rule count and asks
nothing about contents; otherwise offer moving their contents up as the default, reversible choice.

### Icon buttons with a tooltip (`iconButtonStyles`, `trackIconTooltip`)

The `wt-data-table` Filters button, the Products Select button and the Structure tab's
Reorder and Select buttons each take the `icon-button` class from `iconButtonStyles` (`packages/ui/src/icon-button.ts`, exported by `@waitron/ui`): at
least `--wt-tap-min` each way, with the toolbar's border and surface, and pressed —
`--wt-color-primary` border, `--wt-color-surface-lifted` fill, `--wt-color-primary-text` icon —
while the button's `aria-pressed` or `aria-expanded` is `true`; disabled, it is drawn at
`--wt-opacity-disabled` with the default cursor, as the Structure tab's Select is while a change is
being saved. Its name is its `aria-label`. An
`aria-hidden` `.icon-tooltip` inside it repeats that name on one line under the button, from its leading edge, on keyboard focus,
and on hover where the primary pointer can hover (a touch screen leaves a tapped button in
`:hover`), drawn above a sticky table's headings. It stays shown while the pointer is on the tooltip
itself, and an invisible strip covers the gap between it and the button (WCAG 1.4.13's hoverable
condition); a hidden tooltip is `display: none`. Bind `trackIconTooltip` to the button's
`pointerenter`, `pointerleave`, `focus` and `blur`: while the pointer is on it or it has focus,
Escape hides the tooltip, which can show again once both have left (WCAG 1.4.13). Binding it also
means a click on a showing tooltip does not press its button. The table's
Customise columns button, icon-only in the same toolbar, does not use it yet: it has no tooltip and
no pressed look. Guards: `packages/ui/src/icon-button.test.ts`, and the tooltip cases in
`packages/ui/src/components/wt-data-table.test.ts`,
`apps/dashboard/src/widgets/catalogue-browser.test.ts` and
`apps/dashboard/src/screens/menus-screen.a11y.test.ts`.

### Accessible, clickable labels (`wt-input`, `wt-textarea`, `wt-price-input`, `wt-number-stepper`, `wt-switch`, `wt-slider`, `wt-combobox`)

All of them associate their visible `<label>` with the control through a real `for`/`id` pair —
not by wrapping the control inside the `<label>` — so the existing layout and font sizing stay
untouched. A named `wt-input` or `wt-combobox` uses that semantic name for its `name` and `id`. An
unnamed legacy input, an unnamed combobox, every `wt-switch` and every `wt-slider` use a
module-level counter (`wt-input-N` / `wt-combobox-trigger-N` / `wt-switch-N` / `wt-slider-N`).

- `wt-input name="email"`: `<label for="email">` + `<input id="email" name="email">`. The label
  supplies the input's accessible name through that native association, while automation and
  password managers receive a stable field purpose instead of a generated component id.
- `wt-switch`: `name` forwards your semantic field name to the native input; unnamed switches
  omit it. The same `for`/`id` pairing is what makes clicking the visible label text toggle the
  switch. Because the control also carries `role="switch"` (re-purposing a native checkbox), its
  `<input>` _additionally_ sets `aria-label` directly from the `label` property, so the accessible
  name doesn't depend on how a given screen reader resolves a `for`/`id` pair against a
  non-default role.
  A click on the knob (drawn over the input), the gap beside the label, or the space above and
  below the label is handed to the input, so the switch flips once, sends one `wt-change`, and a
  listener above the switch in the bubbling phase sees one click. A click in the empty space a
  container stretches the host into past the label does not flip it (W76).
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
  against elements with an _explicit_ `role="dialog"`/`role="alertdialog"` attribute; it does not
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
where the hit target is a covering, invisible native control, size the _container_, not the
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

For a price, amount, percentage or measured quantity, accept either `2.80` or `2,80` in every
screen language. Show the decimal mark of the screen language, including when you fill or restore
an input: English `2.80`, Spanish `2,80`. Keep digits and trailing zeros; do not add thousands
separators to editable values. A single comma or point is a decimal mark. Multiple marks or spaces
inside the number are refused beside the field, with a localized message, rather than interpreted
as grouping. Keep the field's existing limits on sign, precision and range.

Use `wt-price-input` with `locale` for money. For a decimal without a currency sign, give
`wt-input` or `wt-price-input` `decimal-locale=${currentLocale()}`. The controls forward a valid
entry as an exact dot-decimal string in `wt-change.detail.value`; invalid text stays available to
your form's checks. Decimal mode uses a text control with a decimal keyboard. Preserve the native
selection when converting a mark during typing. `parseDecimalInput` and `formatDecimalInput` from `@waitron/ui-core` (also
exported by `@waitron/ui`) share this conversion. The server still receives its exact dot-decimal
format. Keep the conversion in the browser so a Spanish keyboard does not change the amount stored.

A form says nothing about errors until the operator first presses its primary action (owner rule,
2026-09-28). A device profile whose department has no active allowed zone left shows its
zones and starting-zone errors on open, with the bottom correction message (owner, 2026-10-08,
A396). Its unchanged Save stays quiet and disabled; an edit stays blocked until its scope is fixed. There is no error summary at the top of a form: it makes the page jump when it clears.
Besides an unchanged draft, a save already in progress or a nested window open (below), only the
form's own checks disable the action; an error that comes back from a request never does (owner rule, 2026-09-29).

- mark every required field with `required`; `wt-input` renders the visible asterisk and forwards
  the native constraint. A field with `hide-label` draws no asterisk, so where one sits in a table
  column with a visible heading, that heading carries the `*` while any row's field is required (the
  Extras list's Portion column);
- the primary action works until the first submission (for a form that saves, once its draft has
  changed — below). If that
  submission is invalid, pass a plain-language sentence to each invalid field's `error` property,
  pass ONE localized sentence to `wt-form-actions`'s `error` property (it shows on its own line at
  the bottom of the form, above the buttons — in a dialog, at the end of the dialog's body — and is
  announced), move focus to the first invalid field with `focusFirstInvalid(form)`, passing the
  shadow root when it holds only the form, and the form or dialog element when the shadow root
  holds more (a table, other panels), so focus cannot land on a marked control elsewhere on the
  page, and keep the entered values;
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
- reopening or resetting a form starts it again: no messages; a form that saves (below) has its
  action quiet and disabled until something changes (enabled at once if it opens already savable),
  and any other form has it enabled unless it waits for a choice, a selection or a load (below).

The zone's normal-week editor draws seven closed-time columns over its department's periods.
Dragging stages a closed range; opening a closed block edits its two times or deletes it, with
no period choice. Copy this day and Clear change only the closed ranges. One Save writes all
seven weekdays; a refusal naming a submitted day appears in that day's header and leaves the
staged week available to retry. Its Save follows the draft comparison below, including after
removal and reconnect. In a real week, a named day with own hours shows its dated closed
times over the department’s dated periods. Each date has its own Save; plain dates stay read-only
and offer Give this date its own hours. A whole-venue closure says Closed and offers no action.

The Opening hours normal-week editor stages its seven days before one Save. Each day's menu
copies its ranges to selected weekdays or clears them locally. A range dialog stages its two
times and period; Add period… opens the period editor above it, then returns to the same range.
Save on the week waits while a child chooser is open. A server refusal that names a day sits in
that day's header, with the form's generic message immediately above Save; the refusal leaves
Save available for retry. A venue viewer gets the grid without day menus or Save. Real week
starts at the venue's current business week, Monday first; Previous cannot go earlier. The URL
holds `week=<Monday's date>`, and each column names its calendar date. Named days apply on their
occurrences, including later years of a repeat. A whole-venue closure says Closed and has no
action. Only a named day with own hours can be edited; each date has its own draft scope and Save,
so saving it leaves another staged date protected. Closed all day stages an empty department
override. Its comparison includes the override's presence as well as its ranges, so choosing
Closed on an inherited empty weekday still enables Save. Other dates offer Give this date its own
hours after the calendar facts load: a public holiday prefills its name and kind; an existing
named day opens its own editor, with own hours staged and its original repeating identity kept.
Changing weeks or returning to the normal week asks before discarding staged drafts. A dated
range explains endpoints the venue clock repeats on their calendar morning; its ending
changeover belongs to the next morning. A skipped-time refusal
names the clock gap at the date header and keeps Save available for retry. The Day tab starts on your venue's business date; Previous cannot go earlier. Each active
department is followed by a narrow column for each of its active zones. Dragging in a zone stages
closed times over the department's periods; opening a closed block edits its times or deletes it.
Previous/next date actions ask before discarding a staged draft. A date without own hours shows
“Changes every {weekday}” and saves that weekday in the normal week. Its heading offers Give this
date its own hours after its calendar facts load, opening an existing named day's editor or
prefilling a public holiday's name and kind. A named day with own hours saves that date's
department ranges and zone closed times. A whole-venue closure says Closed and offers no editing
action. One Save writes changed departments, then changed zones. If a later write is refused,
earlier successful writes stay saved and the remaining draft stays available to retry. A refusal
naming a shown field sits beside its department or zone, with the generic message above Save.
A dirty draft keeps its original department, zone and named-day facts through background reads
and reconnect.

A form that saves opens with its primary action (Save, Add…) disabled and drawn
`secondary`. As soon as its draft differs from what was opened, the action is enabled and drawn
`primary`; undoing the change back to the opened values makes it quiet and disabled again (owner
decision, 2026-10-07, A331). "Changed" is the draft scope's `isDirty()`, never a second comparison
written per screen (one stated exception, the till's profile dialog, is in the batch 4c entry below):

- take the scope with `draftScopeFor(this, owner)` from `@waitron/ui`. It hands back the
  application's `coordinator` — `undefined` where no `LeaveController` is above the form, as in a
  widget test — and a `scope` that follows the draft either way. Keep gating the leave paths
  (`beforeClose`, Cancel's `requestClose`) on the coordinator, not on the scope. The scope's
  `commit` and `dispose` redraw the host, so a form left open after a save draws its action quiet
  again;
- a form that takes its scope in `willUpdate` and disposes it on disconnect takes a new scope only
  while `this.isConnected`, and asks for an update when it is put back (Lit runs none on
  reconnect). Disposing the scope redraws the form, so without that check a form taken out of the
  page takes a new scope while detached, and once put back it does not ask before discarding an
  edit made after that. The till's party name, invoice recipient, extras picker and station
  dialogs, the dashboard's unit, ingredient, extras list, option
  list and option label forms, recipe editor, Add to menus picker, a section's Add products picker
  and the Home page tab's shortcut picker, the menus screen's section and menu details form and an
  include's Edit dialog, the staff
  edit and new person forms, the variant, purchase and shift forms, the bookings form, the
  product editor and the department dialogs, Settings and zone settings
  do this; with the check deleted, a reconnect case in the `*.unsaved.test.ts` that
  covers it fails (the unit form's is in `catalogue-forms.unsaved.test.ts`);
- an edit made BEFORE the form is taken out still counts once it is put back: keep the value the
  scope last committed — the opened value, then each saved value — in a field the disconnect does
  not clear, commit it into the new scope, and clear it wherever the form really reopens, or a
  reopened form starts changed. A form that forgets on disconnect which record it opened re-seeds
  its fields when put back and replaces the edit; it keeps that identity instead, and renews on
  disconnect only the token that stops a write started before it left from saving or closing it.
  The staff edit and new person, variant, purchase, shift and bookings forms, the product
  editor, the unit form, the menus screen's section and menu details form, an include's Edit
  dialog, the Home page tab's shortcut picker and the department dialogs, Settings and zone settings do this, each with an edit-first reconnect case. The recipe editor
  clears its choice on removal by design (batch 2a). The till's party name, invoice recipient,
  extras picker and station dialogs keep it and count it, each with a reconnect case in its
  `*.unsaved.test.ts`. The other forms in the list above are untried;
- bind the action through `saveActionState(scope)`: `variant=${s.variant}` and
  `?disabled=${s.unchanged || <the form's own conditions>}`;
- return early from the save handler while `saveActionState(scope).unchanged`. `disabled` stops a
  person, not a test: a `.click()` on the `wt-button` host still reaches the host's click listener
  while its inner button is disabled;
- a create form with nothing typed is unchanged. A form whose opened state is already savable (a
  duplicate, a pre-filled value the operator must confirm) passes `{ savableAtOpen: true }`, so it
  is never stuck disabled;
- a changed form that is blocked — failing its own checks after the first press, busy, a nested
  window open — stays drawn `primary` and disabled. A refused save leaves the draft changed, so the
  action stays enabled;
- the setup wizard's step navigation is not a save, and neither is a sign-in;
- the Products browser's Move and Delete dialog draws its confirm `secondary` while it waits for a
  destination or for the folder summary, or after the summary failed, and its own variant once it
  can act; while it is working (`loading`) it keeps its own variant (owner, 2026-10-08, A409).
  Change unit and the image picker are `secondary` throughout, and so are the Products browser's
  toolbar Move and the Structure tab's Move to section… (owner, 2026-10-09, A442). The owner made this the rule for the
  dashboard and the till (2026-10-08, A416; the till's two buttons are A417): a button that is not a
  save is drawn `secondary` while it waits for a choice, a selection or a load, and its own variant
  once it can act, keeping its own variant while its own action is being sent. A416 brought these
  under it: the Products browser's toolbar Delete (Archive when only products are selected); on the
  Modifiers screen, the Delete confirmation, Add extras list, Add options list and the Used by
  window's Edit; Print on an equipment label; Print a copy on Reprint the receipt; the profile
  window's Edit; and the backup key's Change the key. The owner extended it (2026-10-08, A427) to a
  button disabled because its row's own state rules the action out: it is drawn `secondary` while
  ruled out and its own variant otherwise; which conditions disable it is unchanged. A427 brought
  these under it: Disable on a printer that is already disabled; Disable on a service status whose
  Active switch is off, saved or not; Publish on a menu's Preview while the menu has clashes, which
  keeps its own variant while its own publish is being sent; and a modifier's Remove in the product
  editor while the variant window, the image picker or any window the Products screen opens for the
  editor is open, which keeps its own variant while the Products screen is sending a request for the
  product (its `busy`). Not covered: a button disabled only while a
  request is being sent, an action blocked by its own field checks, the sign-in screens, and the
  canvas editor's Delete on a canvas's last tab (canvases are being retired, A182). Nothing guards it
  across screens.

These forms follow the rule
([backlog](../backlog/dashboard.md#a-forms-save-stays-quiet-and-disabled-until-something-changes-a331-owner-2026-10-07) A331,
[plan](../superpowers/plans/2026-10-07-a331-save-follows-changes.md)),
and nothing guards it across screens:

- batch 1: the product editor and the variant form;
- batch 2a: the "VAT class for new products" default on Venue settings; the recipe editor and the
  ingredient form; the unit form, new and existing; the options list and its option window; the
  extras list; Add to menus after a product is created; a section's Add products; a menu's
  Schedule and Change time on its Preview tab. Units' Change unit, the Products browser's Move and
  Delete dialog and the image picker act on what is selected rather than save a draft, so they keep
  their own rules; the reason for each is in
  [the Batch 2a notes](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-2a--catalogue-and-menus-forms-outside-lane-ds-preview-bundle-15-files);
- batch 3a: the floor plan's table rows and Add table; the service-status rows and Add; the
  kitchen's late flags; the venue details editor; My schedule's cover and time-off requests; the
  receipts page; the backup screen's turn-on form and settings editor; the bucket copy form; your
  profile's details and its credential dialogs; the edit-person and new-person dialogs; the purchase
  form; the shift dialog;
- batch 3b: the print agent's Edit dialog; a printer page's name and connection editors; the
  calibration wizard; the Bluetooth printer Pair dialog; the Edit device dialog; the device profile
  editor, new and existing; the card reader's Rename dialog; the bill attestation's Record; the
  canvas editor;
- batch 4a: adjustment reason create/edit and the bill-discount limit; booking create/edit; image
  upload and names edit;
- A366 slice 2: Station hours' weekday, Configure and named-day station-cell editors.
  Clear hours stays a confirmation. The weekday and named-day editors retain an edit
  made before removal and ask before discarding an edit made after reconnect; their cases are in
  `packages/venue-service/src/dashboard/hours-screen.unsaved.test.ts`. Opening hours' normal week,
  a day, the period editor and the date range dialog follow it too;
- Departments: Add and Rename department, Add and Rename zone, Move and Add to department,
  the Settings form (including transfers) and the selected zone's settings. Their sibling
  `*.unsaved.test.ts` suites cover reconnect. Disable confirmations have no draft and stay `danger`.
  Slice 6 replaces the inline editors described in
  [the earlier Batch 4b table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4b--the-venue-service-screens-slice-1-rewrote-lane-b-a331-4b);
- batch 4c: the venue-service local holiday Add and Edit (its Remove and Forget stay `danger`
  confirmations, and the holiday area saves on choice); and the
  till's profile dialog, whose Switch waits until another profile is chosen. The profile dialog is
  the one form that writes its own comparison (`chosen !== activeProfileId`) instead of a draft
  scope: a scope registered with the till's coordinator would be unsaved whenever another profile is
  chosen, so the app's unsaved-changes check before a switch (`#onProfileSwitch` in
  `apps/till/src/till-app.ts`) would ask about the switch itself every time. See
  [the Batch 4c table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4c--the-venue-service-forms-nobody-else-is-changing-and-the-tills-profile-dialog-lane-c-a331-4c);
- batch 2b, the menus screen: the menu details form, new and rename; the section form, new and
  edit (one form, `dashboard-section-details-form`, mounted twice); and an include's Edit dialog.
  The screen's other windows, the menu price fields and Publish act at once, confirm an operation or
  only show, so they have no Save to gate, except the Add products window and the publication
  schedule, which are batch 2a's, and the Home page tab's shortcut window, whose Add follows the rule
  since A336, and the Structure tab's Move to section… dialog, whose Move follows the rule since A337; the list is in
  [the Batch 2b table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-2b--the-menus-screen-and-the-preview-bundles-files-lane-c-a331-2b);
- batch 5, the till: the party name dialog; the schedule's cover and time-off requests; the full
  invoice recipient dialog; the extras picker when it edits a line (adding a dish never waits for a
  change, through `savableAtOpen`); the station dialog's Make at (its Move keeps today's look).
  Every other till dialog that tracks unsaved changes takes an action — pay, refund, override, sign
  in, seat, send — and keeps its own rules; the list, with the reason for each, is in
  [the Batch 5 table](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-5--the-till-app-lane-c-a331-5).
  The till's forms that track no unsaved changes wait for Batch 7's follow-up audit.

These open already savable:

- the backup settings editor, when the stored schedule is not a wall-clock one, or no retention is
  stored: the form cannot show what is running, so it opens with its own defaults and Save ready
  (`#policyReplaced` in `apps/dashboard/src/screens/backup-screen.ts`);
- the printers' name dialog (Add, or Enable for a switched-off printer): pressing it is the add;
- the calibration wizard when an add opened it: after a fresh add it confirms a new printer's
  default settings, and after a re-add pressing Save is what keeps the printer on, because closing
  the wizard switches it off again (`#calibrationOpenedByAdd` in
  `apps/dashboard/src/screens/printers-screen.ts`). This is the campaign runner's ruling of
  2026-10-08, still awaiting the owner's word. Opened from a printer's page, it opens quiet;
- the device pairing dialog's Pair: its settings step opens holding the name the device asked
  with, and pressing Pair approves the device;
- each reader's Add (Enable for a disabled one) in "Add a card reader", holding the provider's name;
- the canvas Duplicate dialog, holding `<name> (copy)`;
- the routing cell editor on an inherited cell: Save pins the inherited choice as the cell's own
  (`savableAtOpen`, `packages/venue-service/src/dashboard/routing-cell-editor.ts`);
- the option window when it opens showing a refusal the options list handed it: pressing Save
  untouched gives the option back to the list, which clears that option's refusal (`#refusedAtOpen`
  in `apps/dashboard/src/widgets/option-label-form.ts`; owner, 2026-10-08, A410). Opened by Add
  option, or by Edit on an option with no refusal, it opens quiet;
- a new canvas's editor, with no flag: its draft has no stored canvas to compare with, so it counts
  as changed from the start.

Stripe Connect/Add and SumUp Connect/Pair/Try again are provider operations. Their actions keep
their existing validation and retry behavior. See the
[Batch 4a classifications](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-4a--module-forms-lane-e-a331-4a)
for each provider call path.

Preparation stations' Save editors follow the rule too (A331 batch 4d; A366 slice 4 for the
station and routing cell editors): Add station, the station editor, the routing cell editor,
watcher Rename/follows/zones/pass/printers, and Settings fallback/timing. An unchanged Settings
fallback opens no confirmation; an edited fallback keeps its two presses. Routing Confirm and station service operations remain actions.

The setup audit (A331 batch 6, 2026-10-08) found no stored-setting editor to adopt this gate.
Admin, venue and certificate Next buttons continue the wizard; Connect adopts a primary with
credentials; Import stages configuration for provisioning; reset and restore controls run recovery
operations. Review confirms provisioning. These actions stay outside the Save rule, including when
the wizard reopens with filled input. The per-screen call paths and the remaining setup controls are
listed in [the Batch 6 audit](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-6--setup-stored-setting-editors-lane-e-a331-6).
If you add a setup editor that saves already stored settings, use `draftScopeFor` and
`saveActionState` with the early return, as described above.

The remaining-form audit (A331 batch 7, 2026-10-08) found no unreserved no-scope Save editor.
A selection that writes immediately, an inline Enter/blur commit, and a control that opens another
editor have no staged primary Save to gate. The print agent's setup button labelled Save restarts
connection and enrolment, including with its saved address after denial, so it remains available
without an edit. Recovery Retry also performs an operation. The
[Batch 7 audit](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-7--remaining-forms-and-string-pages-lane-e-a331-7)
lists the call paths and the forms it left to their owning batches.
The 2026-10-08 [Batch 7b follow-up](../superpowers/plans/2026-10-07-a331-save-follows-changes.md#batch-7b--revisit-the-landed-reservations-lane-e-a331-7b)
revisited the hardware, till, menus and invoice foundation after landing and found no additional
staged Save editor. Batch 4b audited the service-period forms after A366 slice 1; a re-check
after A366 slice 7 is in the backlog (A331).

The switch in the include dialog on a menu's Structure tab
(`apps/dashboard/src/widgets/include-folder-form.ts`) keeps the values of the fields it hides.
Switching it off hides the fields without clearing them, and switching it back on shows what they
held. A save with the switch off sends the switch alone, and the values stored for the hidden fields
stay as they were. Its cases "switching off hides the names, colour and photo, and switching on
shows the values again" and "submits only the switch when it is off" in
`apps/dashboard/src/widgets/include-folder-form.test.ts`, and "leaves the stored overrides alone
when none are sent" in `packages/catalogue/src/include-folder.db.test.ts`, hold it.

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
it stays on the bottom left. A secondary action that belongs beside the primary action goes in the
`secondary` slot. The row's message runs from the form's left edge only when the row is the form's
full width. Where the row shares a line with something else, show the message with `formMessage`
directly before that line, or let the row take the full width (in a `wt-modal`, no wider than the form width)
while it has a message, as the Add printer dialog's address check does. The sign-in email,
password, passkey and Google screens put their own way in outside `wt-form-actions`, as a
full-width button with the form's message on its own line directly above it (shown with
`formMessage`); see the login section.

The sign-in example below is not a save. A form that saves binds its action to its draft:

```ts
const s = saveActionState(this.#draftScope);
html`
  <wt-form-actions .error=${bottomMessage}>
    <wt-button slot="cancel" variant="secondary">${t("action.cancel")}</wt-button>
    <wt-button
      variant=${s.variant}
      ?disabled=${s.unchanged || busy || (attempted && failsOwnChecks)}
      @click=${this.save}
    >
      ${t("action.save")}
    </wt-button>
  </wt-form-actions>
`;
// save(): if (saveActionState(this.#draftScope).unchanged) return;
```

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

#### Protect an edited dialog before closing it

When a dialog holds staged edits, give its owner a draft scope with `draftScopeFor(this, owner)`
from `@waitron/ui`, which registers it with the shared coordinator when one is above the form; that
package also exports the `DraftOwner`, `DraftScope`, `LeaveCoordinator` and `LeaveReason` types for
form owners. Compare the values your
form would submit with its detached
starting snapshot. Call `changed()` after edits and reverts, and `commit(submitted)` as soon as
that write succeeds, before refreshing. Saving a child form commits its child scope; the
parent's server write still has its own baseline.

Bind the dialog's `beforeClose` property to a scoped coordinator request and return whether its
outcome is `"proceeded"`. Keep the callback reference stable while that editor is open:
`WtDialog.requestClose` rejects a pending close if its `beforeClose` callback changes. A background
render must not replace it while you are answering the question. Route Cancel, close controls and
an existing backdrop action through `requestClose(reason)`. Native Escape uses the same gate. The
dialog stays open while asking, and a later answer cannot close a different opening. `closeAfter("saved")` and
`closeAfter("security")` bypass a pending question for a successful write or forced teardown.
An owner's `open` binding still controls rendering; it is not a user-dismissal path.

Use one `LeaveController` from `@waitron/ui` in each application shell. Render its confirmation
with `render(copy)` and resolve that same coordinator from a connected descendant with
`leaveCoordinatorFor(element)`; the request crosses shadow roots and stops at the nearest shell.
Dispose each form scope when its owner leaves. The controller disposes its registry on shell
disconnect and creates a new one on reconnect. Call its `forceReset()` for a forced security exit;
that call also tolerates a shell whose teardown has already run.

For an action that leaves every registered editor, call
`coordinator.request({ scopes: "all", reason, proceed })`. Keep editing preserves every selected
input; Discard restores only dirty inputs before your continuation runs. An explicit ID list
selects those owners and their descendants, while `[]` selects none. Supply `except: [retainedOwner]`
when the action keeps an editor mounted; its descendants are retained too. A new or changed
affected owner invalidates an unanswered question. Application shells use these selections for
voluntary logout, locale changes and navigation; retained order drafts are explicitly excluded
from transitions that keep them.

The controller renders one `wt-unsaved-changes` per application, supplying `heading`, `message`,
`keepLabel` and `discardLabel` from that application's translations. The compact confirmation focuses Keep
editing, offers a danger-styled Discard changes action and emits `wt-unsaved-choice` with
`detail: { decision: "keep" | "discard" }`. Escape chooses Keep. Closing its `open` property
for an aborted request emits no choice. Its message is the inner dialog's accessible description.
Keep the original editor mounted until the coordinator approves leaving, so Keep restores focus
and preserves the draft. Read-only and automatically saved forms need no draft scope.

The dashboard, till and setup shells share this controller and the accepted-history adapter.
Its leave callback receives the destination URL so Account settings can retain underlying
page drafts. Sidebar and product-link requests defer screen changes until acceptance. Plain
same-app anchors use the dispatched click's composed path; modified clicks, new-tab targets
and downloads keep browser handling. Fragment-only form links keep their target's handler,
which owns any leave request. The dashboard catches a link click before the link's own handler
sees it, so a link that handles a plain click itself (the product swatch that opens Edit in
place) carries `data-own-click` to keep it, and a link with `aria-disabled="true"` is cancelled
there and goes nowhere. Preview department changes and same-page receipt Back retain
staged inputs; a tab or management-link departure asks before leaving them.

Each form owns its comparison and successful-write boundary. Compare membership for selected
ID sets and preserve order for submitted positions. Nested image forms retain File identity;
a child save commits that child without committing its parent. Independent receipt, credential
and inline-row writes commit separately. A failed refresh after a successful write cannot make
that submitted value dirty again. Read-only views, immediately saved controls and safety
acknowledgements remain exempt. The [dated owner audit](../superpowers/plans/2026-10-05-unsaved-changes-audit.md)
records the coverage and limits of the rollout checks.

The dirty-only unload listener requests the browser's own warning. Activated desktop Chromium
checks cover reload, external navigation and closing with a Schedule draft. The
[design](../superpowers/specs/2026-10-05-unsaved-changes-warning-design.md) records activation and
platform limits; mobile process termination and every-platform reliability are unverified.
PIN sign-in compares ephemeral keypad input and asks on voluntary Cancel; explicit submission
remains direct, and disconnect clears proof without asking.

#### A value saved from its own table row

A few lists edit a value in its own row, saving each change as it is made, with no `wt-modal`
(owner-approved exceptions, listed under "One action per row or card"). The course list
(`apps/dashboard/src/widgets/course-list.ts`) is the first; a menu's Price overrides tab
(`apps/dashboard/src/widgets/menu-prices-table.ts`) is the second. Each field is a one-field edit
of its own, so the rules above for a form with a primary action apply like this instead:

- the field takes `hide-label`, so its `label` is read to a screen reader but not drawn;
- typing sends nothing; Enter, or leaving the field, saves it, and Escape puts back the saved value;
- the field's own check runs when it is saved, and a failure puts its sentence under the field and
  sends nothing;
- a refusal that names the field puts its sentence under that field; any other refusal is said for
  the list as a whole;
- there is no form-level message above the buttons and no Save button to disable.

Where the two differ, and why:

- The course list makes its one field read-only while its save is out. The price table keeps every
  field editable: `wt-price-input` has no read-only setting, and many fields are in view at once, so
  a slow save would otherwise freeze the field the person wants to correct. Its saves go one at a
  time in the order they were made (`ListWriteQueue`, `apps/dashboard/src/widgets/section-writes.ts`),
  and a save of a value the field already holds sends nothing.
- The price table's `label` names its row ("Price override for Lemonade — Large"), adding ", set on
  this menu" while this menu stores a price for it, so a screen reader hears which row the field belongs to. The course list's label names no row: a course's
  field is labelled "Name", and the new course's field "New course" (`#nameField`).
- The price table moves focus to the field a refusal names, even when the person has moved on to
  another row, opening a size's product first if it is folded shut (`#focusField`). The course list
  marks the field and moves focus nowhere (`#commit`).
- The course list shows a Delete refused while its confirmation dialog is open in that dialog, and any other refusal as an alert
  under the list. The price table says each
  refusal, including one already shown under its field, in a message floating at the bottom end of
  the window (a `wt-toast`), because a save made far down the list must still be seen; a refusal
  stays until it is closed or replaced, because some are said nowhere else. It says a success there
  for 5 seconds, longer while the pointer or focus is on it, only for the last save made, once the
  prices have been read again after it and the tab still shows them, and only when no refusal said
  since it was made is still open, with an Undo inside it that writes the previous value back; an
  earlier save is not said, so an Undo never reaches past a later write (`#savePrice`, `apps/dashboard/src/screens/menus-screen.ts`). A refusal
  that arrives after the person has left the menu or the tab, or after its row has left the list,
  is said in the Menus screen's own message above the tabs or the menus list instead
  (`memberError`, `apps/dashboard/src/screens/menus-screen.ts`).

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

The box carries data attributes its primitive sets, and `fieldStyles` draws each, except
`data-search`, which only `wt-combobox`'s own styles read:

- **The label rests or floats** (`data-label`, from `fieldLabelState`; `wt-number-stepper`'s
  always floats, see its row). It rests — centred in the
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
  with a search box (`data-search`) drops this marking, because the search box's own line marks
  focus. `wt-combobox` owns both open-list rules: it drops the marking when a search box is present,
  and keeps it when there is none, wherever focus is; an
  invalid field shows its red line instead, and disabling the field closes the list without drawing
  the marking first.
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
  chosen email, with "Use another account" in its `end` slot; and the course list's name while its
  save is still being answered, read-only because that keeps focus where `disabled` would drop it.
- **Compact** (`data-compact`, whenever no label is drawn: `hide-label`, or no `label` at all): the
  box's least height is `--wt-tap-min` instead of `--wt-field-height`, which makes a single-line
  field exactly the tap-target height.

What each primitive adds in or around the box — `wt-input`'s `end` slot, the price field's sign and
unit, the stepper's buttons, the dropdown's chevron and list — is in its row of the primitives table
above.

A short explanation of a field is its hint (below), not a question-mark button (owner, 2026-10-03).
Use `wt-help-tooltip` for an explanation too long for a hint, and for a field that starts filled in,
where a hint would never show. The setup wizard's shop step decides which field gets which in its
`FIELD_HINT` and `FIELD_HELP` maps for its text fields. The location name is in both: `#field` gives
it the "?" and no hint in Demo, where it starts filled in, and the hint otherwise. The
receipt-language choice keeps its own
"?" (`apps/setup/src/screens/venue-screen.ts`).
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
variant's VAT or photo from its parent product, an extra's price from its product's. Such a field is
**empty while it falls back**, and shows the value it falls back to as a placeholder hint, so the operator sees
what will apply without a copy being stored. Leaving it empty keeps the fallback; typing or choosing
a value overrides it; clearing it returns to the fallback and saves `null`. Never mark such a field
required. A translated field inherited as ONE value across its languages (a variant's description)
shows the parent's text as its placeholder hints only while every language is blank; once any
language has text, the record's own value applies: a blank language other than the default shows
the record's own default-language text where there is some, as a product's does, and no hint while
the default language is blank (owner decision 2026-10-03, A220b, below).
A blank description in a language other than the venue's default shows the
default language's description as its placeholder — a product's or a variant's own, as it is typed,
or, on a variant still blank in every language, the parent's where the parent has none in that
language (`defaultLanguageHint`, `apps/dashboard/src/widgets/form-fields.ts`). That hint is the owner's
decision (A220); no reader fills a missing language with it, and nothing outside the product editor
shows a product description today (the reader check in A220, below).

A220's reader check and the owner's decisions behind these hints (#1069, #1073), moved here from
`docs/backlog.md`:

**What a description reader shows — checked by running, 2026-10-02.** A throwaway catalogue test
built a product described only in Spanish (the default), a variant with its own Spanish description
and a variant with none, then read them through `listProducts`'s effective read, the product
editor's read, the published menu (`buildMenuDocument`) and the live offers the till receives
(`applyLiveFields`). Nothing fills a missing language anywhere: (a) the product carries `{ es: … }`
only; (b) the described variant's effective description is its own `{ es: … }`, not the parent's;
(c) the bare variant's effective description is the parent's map. The published menu and the till's
offers carry only the dish's own description and NO variant description at all, and nothing outside
the product editor shows a product description today — no till screen, receipt, ticket or menu.
This command printed nothing:
`grep -rn "\.description\b\|description:" apps/till/src apps/server/src --include='*.ts' | grep -v '\.test\.ts'`
(a control over `apps/dashboard/src` printed 30 lines). The wider `grep -rln description` hits in
those folders, read one by one, include no product description (they are names of lines, options,
sections, products and units, a location's operation description, and comments); under
`packages/*/src` the first command's only product-description hits are in `packages/catalogue` and
the column's declaration in `packages/db`. So the hint and the reader disagree in one way: the hint
shows the default-language description in another language, while every reader carries nothing
there — there is no printed menu text to match yet.
Precedence on a variant with both: its own description wins, as (b) showed, and wins as one value
across every language (the coalesce of the whole column in `effectiveProductColumns.description`,
`packages/catalogue/src/variant-fallback.ts`, read, not run with a parent in a second language).
**Decided (owner, 2026-10-02):** a customer-name field in another language shows the
default-language name as its hint, _"which is what we'd show on the menu anyway if it is missing"_
(the owner's account of the menu; check it against the reader before relying on it). The kitchen
name shows its hint too: the staff name, which is what `kitchenPresentationName` prints. A
description field in a secondary language shows the default-language description as its hint.
**Decided (owner, 2026-10-03, A220b):** on a variant's page whose own description has text, a
blank language other than the default shows the variant's own default-language description as its
hint, where there is one, as a product's does; the parent's description is a hint only while the
variant describes itself in no language.

- **Text and price fields** (`wt-input`, `wt-price-input`, `wt-textarea`): the fallback value is the
  field's `placeholder`. All three primitives paint it `--wt-color-text-muted`, because Chromium's
  default grey measured 3.70:1 on `wt-input` against the dark theme's field (2026-09-24), under the
  4.5:1 text needs. axe does not check placeholder contrast, so an a11y test for a new placeholder-hinted field measures the ratio itself
  (`packages/ui-core/src/components/wt-input.a11y.test.ts`). A price field that holds its own value
  can say so with `wt-price-input`'s `overriding` state (see its row in the component table), which a
  menu's Price overrides tab uses.
- **A single-choice `wt-combobox`** (the product editor's VAT and course): its
  first option has an empty value and reads as the fallback value itself, with no "Same as" before
  it (owner, 2026-10-02: "we just want to show the value"), e.g. "Reduced (10%)"; where the parent
  names nothing it reads as what will be used instead, `product.no_course` for the course; and
  where the parent names a course the loaded
  list lacks, it reads `editor.missing_choice` ("Unavailable selection"), while the VAT dropdown
  shows the class's code. Its placeholder
  reads the same, in the combobox's grey italic, and is what it shows while the stored value is
  null; it has no separate hint line. A choice that means "none" on a record of its own
  (`product.no_course` for the course) is left out where the empty value already means "fall
  back": offering both would read as one thing and save as another. A variant's unit is not such a
  field: it is always its product's, and its page shows it beside the price as fixed text (A222).
- **The allergen and dietary pickers**: a muted hint line beside each
  shows the fallback value while the stored value is empty, and goes away once the record sets its
  own. The allergen and dietary hint lines name the values in grey italic ("Allergens: Milk"), "None"
  where the parent has none (`editor.allergens_none`, `editor.diet_none`) and, for allergens the
  parent has not had reviewed, "Not yet reviewed" (`editor.allergens_unreviewed`) — never "None",
  which would claim a reviewed empty set. A variant's price in the variant table, where it has none of
  its own, is the product's price in the same grey italic. An image shows the fallback picture itself
  (`dashboard-image-upload`'s `inheritedImage`). In the variant form it has no visible caption, and
  its alt text names the main product's photo (`editor.inherited_image_alt`); Remove sits beside
  Choose image where it would for a photo of the variant's own, disabled, with the accessible
  description "Uses the main product's photo" (`image.remove_inherited_hint`). The widget sets
  `wt-button.ariaDescription`; the inner button receives `aria-description`.
  With no photo at all, own or inherited, there is no Remove. In the
  product editor, where the photo is a thumbnail beside Name, it has a dashed border, and "The main product's photo"
  (`editor.inherited_image_alt`), hidden from sight, describes the photo button to a screen reader. A control whose empty state could also mean "none" (an allergen set,
  a dietary set) saves an emptied choice as `null` — "falls back" — never as an empty set, which
  would declare the record free of what the fallback contains.

A name is not hinted from a parent this way: a variant's names are its own. In the editors of
products, variants, options lists, options and extras lists, a blank kitchen name, and a blank
customer-facing name in the venue's default content language, show the record's own Name as their
placeholder (on a variant, the variant's Name); a blank customer-facing name in any other language
shows the default language's customer-facing name, or Name while that is blank too. Each follows the
field it copies as it is typed (`optionalTextFields`, `apps/dashboard/src/widgets/form-fields.ts`).
The menu section form, which is also a menu's Add and Rename form
(`apps/dashboard/src/widgets/section-details-form.ts`), hints its blank customer-facing names the
same way, with its first field (Internal name on a section, Name on a menu) in place of Name; it has
no kitchen name.
The Edit dialog of a menu included in another (`apps/dashboard/src/widgets/include-folder-form.ts`)
hints each blank customer-facing name with what the customer menu would then show: the default
language's name, or the included menu's staff name when every name is blank — and nothing when the
save would be refused, because the default language's name is blank while another language has one.

### Fold a long form into collapsible sections with summaries

A form that shows everything an entity can carry becomes one long stack of cards, and the fields
somebody actually changes most days get lost in it. Fold the optional detail away instead: keep the
frequently-edited fields always visible and put each group of the rest inside a `wt-disclosure`.
The product editor (`apps/dashboard/src/widgets/product-editor.ts`) is the pattern's first home —
Name, Category, the colour chooser, Available, Standalone ordering, Variants and Modifiers stay on
screen; Kitchen, Descriptors and Nutritional info fold; Pricing stays on screen until the product
has an Active variant, and then folds too, with the base price and VAT on its closed line as named
values (`summaryFields`).

Three rules make the fold safe rather than merely tidy.

**Every collapsed section carries a summary of what is inside it**, passed as `summary`, as named
values in `summaryFields`, or as rows in `summaryRows`. Each
`summaryRows` row is cut after its own number of lines, which can hide a later value in that row
completely (a long English name hides the Spanish one), so opening the section is what shows every
value. Build it from the values themselves, joined with a middot. The product editor's Kitchen,
Descriptors and Nutritional info sections name every field they hold, filled or not, each value
after its field's name in bold, and a field with nothing set reads "None specified" ("Sin
especificar", `modifiers.none_specified`), the words the open allergen and dietary lines use
(A211). The Kitchen section reads "**Kitchen name:** Café c/leche ·
**Course:** Drinks", or "**Kitchen name:** None specified · **Course:** None specified" with
neither set. The Descriptors section has one row per field, its languages
side by side and only the field name bold — "**Name:** EN: Beef tenderloin · ES: Solomillo de
ternera", cut after one line, then "**Description:** EN: … · ES: …", cut after two — so it stays two
rows however many languages the venue has; a blank language reads "None specified" in its place,
and a row with every language blank reads "None specified" alone. Nutritional info lists the
allergens and the dietary preferences separated by commas, as the open lines do. On a variant's
page, a field the variant leaves blank to take its parent's value (the course, the description,
the allergens, the dietary preferences) shows the parent's value in italic (`placeholder`), or,
where the parent has none either, "None specified", or "Not yet reviewed" for allergens the parent
has not had reviewed. A variant's blank kitchen and customer-facing names fall back to its own
Name, not the parent's, so they read "None specified" as on a product. The Pricing fold still
leaves a blank base price, and a VAT class the form does not offer, off its line. A names section
(the Options and Extras editors' "Customer-facing names") puts each language's customer-facing
name after its upper-case code in bold — "**ES:** ¿Cómo la quiere hecha? · **EN:** How would you
like it cooked?" — and a blank one, in italic, as the open field hints it while empty: the default
language's name, then the list's staff name. A language with nothing to fall back to is left out.
It is built by `effectiveNamesLine` (`apps/dashboard/src/widgets/form-fields.ts`) and passed as
`summaryFields`. Those two editors keep the kitchen name out of the section, as a field of its own
directly under Name.

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

The body takes roughly a second to open or close, moving the following content with it. Its
closed summary gives way to the body when opening starts. Closing makes the body inert while it
shrinks, then hides it; reduced motion opens and closes at once. A validation error exposes the
body at once, including when a close was in progress. Repeated toggles reverse from the current
height.

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
  `wt-change` on input and `wt-unit-click` when the button is pressed. On a product's own page the
  product editor draws its price field with that button, whether or not the product has variants,
  and on `wt-unit-click` opens the unit chooser: a `wt-dialog` titled Pricing unit, placed beside
  the editor's `wt-modal` rather than in the Pricing section, which may be folded shut. It is the
  compact modal width (448px at 1280px wide): its `--wt-dialog-max-width` is
  `min(90vw, var(--wt-modal-compact-width))`, and its contents take the body's full width. It holds the
  unit dropdown, with the product's unit chosen, and Add unit; its footer's Close button and Escape
  shut it without changing the unit, and choosing a unit changes it and shuts the dialog. Either
  way focus goes back to the button that opened it (`focusUnit()` on the price field). A refused
  unit opens the chooser once, with the refusal under the dropdown, and the price field shows the
  refusal while the chooser is shut, after the price's own message when the price is wrong too.
  The dropdown, like Add unit, is disabled while the editor is saving or has another of its windows
  open. Add unit leaves the chooser open under the unit form, so a
  cancelled form returns focus to Add unit; a saved one chooses the new unit and shuts the
  chooser. On a variant's page the editor sets `fixed-unit` and shows the product's unit as text,
  because a variant's unit is always its product's (A222), and draws no chooser. A product with
  variants also has a unit button (`pricing-unit`) in the variants table's price heading, with a
  `--wt-space-2` gap between it and the word Price, naming the unit and opening the same chooser. A
  table 30rem wide or less hides its price column and that button with it, so on a phone the price
  field's button is the only way to the unit. The extras list form's price cells set `fixed-unit`: a
  row shows its product's unit, which is chosen on the product, so a unit button there would be a
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

Inside Nutritional info, `dashboard-allergen-dietary-picker` draws each field as one borderless
line: its name in bold, then its values or "None specified" (`modifiers.none_specified`). The line is
a native button named "Allergens: Milk, Eggs, edit" (`modifiers.edit_named`). A click or Enter swaps
it for a multiple `wt-combobox` with focus in it. Escape swaps it back with focus on the line (the
second Escape, when the first closed the open list), without closing the window around it; moving
focus out of the combobox swaps it back too.

### Dashboard banner

Keep the dashboard's branded banner across the full page width, on the login screen and every
authenticated screen. In Demo and Preparation, put `wt-demo-bar` above it; in Live, the banner is
at the top. The menu and page content belong underneath the banner. The
banner shows the canonical Waitron lockup and the deployment tenant's legal name, not a location
name: one deployment database represents one tenant, while that tenant can contain several
locations. Once a session is active, put the account menu — a person-icon `wt-row-actions` popover
holding Account settings and Log out — at the banner's trailing (right-hand in the shipped locales)
edge. Do not show it before authentication. Below the drawer breakpoint (`48rem`) the banner takes
two rows: the menu toggle, the lockup and the menus share the first, with the lockup shrinking when
space runs short, and the legal name and Live mode pill take the second in full. The language chooser
sits at the trailing edge too, before the alerts bell and the account menu, signed in and signed out
(see "Navigation and language controls"). In Demo and Preparation, `wt-demo-bar` shows the mode,
the current dashboard page, a link to the device page, and an "Email inbox" link to `/manage/email`
(the inbox screen, also linked from setup's done page). Signed out, the inbox link always shows;
signed in, it shows only to a session that may open the inbox screen (a manager or an admin). The
sidebar has no entry for that screen. The bar wraps its links at phone width while each link keeps
the minimum tap height.

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
variant, whose hover changes its border. A `.nav-group` header takes a small-caps treatment
(uppercase, `letter-spacing: 0.04em`) so it reads as a label, not a fainter link. The headers' text
and the selected item's text read `--wt-color-primary-text`, and the selected item's leading edge
reads `--wt-color-primary`: `--wt-color-primary` measured 4.32:1 as text on the light
`--wt-color-bg` the sidebar sits on (A306).

A headed group (the pinned first group — Overview alone — has no header and is never collapsible)
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
arriving at another page in it opens it again. Opening a headed group, by clicking its header
or arriving at one of its pages, closes every other headed group (A325, owner 2026-10-07).
Opening Overview, the page without a group header, closes every headed group. A same-page
address change or Back step leaves a manually opened group alone. Typing a search term leaves
those stored choices unchanged.

A group draws no header when this session cannot open any of its pages. Search also hides a group
when it removes all of its pages. A group may mix module pages with core pages: a core item listed in
`itemsAmongModules` uses its `order` to sort among the module pages, with the core item first
when orders match. Floor plan uses this order in Venue operations.

A search box sits at the top of the sidebar, above the groups: a `wt-input type="search"` with
`hide-label`, named `nav-search`, whose hidden label (its accessible name) and placeholder are both
**Search pages**. A staff session sees My schedule and Orders in its sidebar, without a search box.
While the box holds anything but spaces (a trailing space finishes the last word), the nav
shows only the pages whose label in the current language matches it by the one search rule (see
Remembered, searchable, filterable tables), so "categorias" finds "Categorías", plus each page that
matches only with its group's header read beside its label. Within a group the pages whose own label
matches come first, closest first, then the others, closest first but without the label-length tie-break,
then in nav order. The search narrows the rows the nav would already show, so a page this person may not open never appears,
however exactly its name is typed. A group with no match is hidden, header and all. A group with a
match shows open whatever its collapsed state. While a term is typed each shown header stops being a
collapse control: it is a plain `<div>` with no `aria-expanded`, no click handler and no chevron (an
empty space of the chevron's width keeps the label where it was), so clicking one changes nothing.
Picking a page opens its group, as any arrival does. When nothing matches, the nav says **No pages
match.** in a `role="status"` message. Enter opens the first page shown, in the order shown, and does
nothing when nothing matches or the box is blank.
Opening a page from a search, by Enter or by click, clears the term and closes the phone-width
drawer, as any nav click does. Escape clears a term and goes no further, so an open drawer stays
open; Escape in an empty box closes the drawer as it does anywhere else in the shell. An Enter or
Escape reported with `isComposing` set (an input method's composition) is left alone: it opens no
page, clears no term, and the shell's Escape handler does not close the drawer for it. The rows are
keyed by page, so at desktop width a result row pressed with Enter or Space keeps focus once the
full list comes back. A language switch keeps the term and searches the new
language's labels, and signing out empties the box.

A header's text starts at the same leading edge as its page labels; an optional group icon
occupies the gutter before it. The trailing chevron uses `--wt-space-4` (16px), reserves its
space while hidden, and centres on the label's first line. It appears under hover or keyboard
focus, and stays visible on devices without hover. Search labels reserve that same trailing space.
The sidebar is 34ch wide, capped at 85vw in the phone drawer, with a border and `--wt-shadow-1`.

`#toggleGroup` records the clicked header's position and corrects the sidebar's scroll offset
after the DOM changes. The browser still bounds that offset to the available scroll range.
The Chromium case opening Team while Products closes checks preservation with the clicked
header visible and enough content to scroll in both states. Its fixture disables browser scroll
anchoring so that heuristic cannot mask the application correction.

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

Every step sits in a card drawn like the setup wizard's: a 1px `--wt-color-border` border,
`--wt-radius-lg` corners and the `--wt-color-surface-raised` background. It draws no logo, because
the banner above it carries the Waitron lockup; it starts with any notice, then the heading. A
notice that reports a failure (session expired, account suspended) is drawn as an error: bold
(`--wt-font-weight-bold`) `--wt-color-danger` text in a box with a 1px `--wt-color-danger` border,
`--wt-radius-md` corners and `--wt-space-2` `--wt-space-3` padding. A success notice (password reset
complete) is plain `--wt-color-text`. On the email, password and passkey screens the step's
own way in is ONE full-width primary `wt-button`, and on the Google screen it is the Google button,
each with the form's one message on its own line directly above it. When there is any other way
in, an **or** line follows, then each other way in as a full-width outlined (`secondary`) button
with a leading icon hidden from assistive technology: a key for **Use your password**, a person
with a key for **Log in with passkey**, and Google's "G" for **Continue with Google**. The Google
button follows Google's custom-button rules
(<https://developers.google.com/identity/branding-guidelines>) wherever it appears, except that it keeps
several things from `wt-button` rather than Google's drawing, among them: it is at least 44px tall (`--wt-tap-min`) where Google's drawing is
40px, it spans the card's full width with its content centred, and it keeps `wt-button`'s corner
radius. From Google's rules it takes the gradient
"G" from Google's download bundle (`apps/dashboard/src/assets/google-g.svg`) at
`--wt-google-mark-size`, `--wt-google-mark-gap` from its label, Google's light and dark colours
through `--wt-color-google-button-fill`, `--wt-color-google-button-line` and
`--wt-color-google-button-text`, and Google Sans Medium, bundled
(`apps/dashboard/src/assets/google-sans-medium-latin.woff2`, registered on `document.fonts`). The
Google screen has no blue button, because Google's button must carry its "G" on a light, dark or
neutral fill (A228). The email screen offers **Continue with Google** when the venue has Google
set up, because starting a Google sign-in takes no email; whether it shows depends on the venue's
settings alone, so every visitor sees the same choices there. **I've forgotten my password** is a
small link at the right directly under the password field, on the password screen only. On the code
screen the switch between an authenticator code and a recovery code is the same kind of link under
the code field, and Back and Log in are an ordinary `wt-form-actions` row, Back bottom left. Both
small links keep a `--wt-tap-min` tap area.
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
- **A repeatable list** (passkeys today; the same shape applies to printers, staff, devices): each
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
owner 2026-09-30): Content languages' Make default and Delete save straight away, without a modal
(deleting a language from the enabled list keeps its translations). Its table shows each language's
missing-name count, or a loading/read-failure message while the report cannot supply that count.
Every row has a pinned Actions menu; the default has no Make default or Delete, and a language kept
enabled for the venue's area has no Delete and shows "Required". Add language opens its own dialog.
Edit translations opens the existing grouped report in a read-only dialog with its Kind and Why
filters and links to the relevant editors. Direct text entry is pending A420 part 2's spec approval. A second exception (A212): the course
list, on Venue settings' Kitchen tab and in the product editor's Courses window, adds, renames and disables
courses in place without a modal, saving each change as it is made, and asks in a dialog before a Delete; the Courses window has one Done
button. A third exception (W89, owner 2026-10-04): a menu's Price overrides tab sets each product's
and each size's price in its own row, saving each change as it is made (Forms → "A value saved from
its own table row").

Printer details are a navigable destination with a different edit pattern. The printer name edits
beside the heading, network host and port edit inside Connection, and Active saves in Status. Status
starts open; Connection and Calibration start closed, each with a summary. Calibration opens its
wizard at paper settings. The list's Edit action navigates to the details page and opens the name
field. A draft name or connection change asks to be discarded before leaving that page.

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
when 2FA is already on) — it gets only `wt-button`'s own border accent. This is deliberately
**not** a change to what `variant="primary"`/`"danger"` mean on `wt-button` itself — those still
render solid at rest everywhere else (the till's checkout button, for one, needs to read as
"the important action" without anyone hovering it first, and there is no hover on a touchscreen at
all). The part hook lets a screen layer an accent onto specific buttons without touching that
contract.

The account and content-language hover cases scan these actions with axe in both themes,
English and Spanish, at phone and desktop widths (`profile-screen.a11y.test.ts` and
`content-languages-screen.a11y.test.ts`).

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
bottom-right" rule `wt-form-actions` already applies to forms sitewide (see "Forms" above). One owner-approved exception (W78, 2026-10-04): the image library's cards
(`packages/media/src/dashboard/image-library.ts`) put Delete at the left and Edit at the right
(`justify-content: space-between`), so the destructive action does not sit beside the everyday one.

### Spacing rhythm

Using the existing `--wt-space-*` scale:

- `--wt-space-6` between the page title and the first group label
- `--wt-space-5` between one card and the next group label (i.e. between whole sections)
- `--wt-space-2` between a group label and its card
- row padding inside a card: `--wt-space-3` vertical, `--wt-space-4` horizontal

### Left-anchor narrow content — don't centre it

A narrower `max-width` on a settings/form screen keeps line length readable, but the screen itself
stays anchored to the body's left padding, the same as a full-width `wt-data-table` screen — never
`margin-inline: auto`. Centering a narrow screen in the _remaining_ space beside the sidebar makes
it read as a visually different app from the wide table screens next to it; anchoring both to the
same edge and varying only the width does not. `backup-screen.ts` and `receipts-screen.ts` (its
form column) already follow this (`max-width` alone). `profile-screen.ts` no longer applies here at all — it isn't a
screen positioned beside the sidebar any more; it's a modal, and its fields stop at
`--wt-form-max-width`. The one legitimate exception among actual screens is a full-page one with no
sidebar at all, like the login screen — centering a freestanding form with nothing to anchor to is
the normal, expected treatment there.

### Typography roles

| Role        | Token(s)                                    | Example                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page title  | `--wt-font-size-xl`, bold                   | a screen's own `<h1>` — "Your profile" no longer qualifies: it's a `wt-modal` heading now (`--wt-font-size-lg`, its own role, not this one)                                                                                 |
| Group label | `--wt-font-size-sm`, bold, uppercase, muted | the receipts screen's section headings (`apps/dashboard/src/screens/receipts-screen.ts`); the nav's own small-caps group header is styled separately (primary-accent, not muted — see "Dashboard sidebar navigation" below) |
| Field label | `--wt-font-size-sm`, normal weight, muted   | "Name"                                                                                                                                                                                                                      |
| Field value | `--wt-font-size-md`, bold                   | "Clinton Gormley"                                                                                                                                                                                                           |

`wt-button` carries its own type sizing through its `size` property — these roles cover page text,
not button labels.

The till and kitchen-display surfaces reuse the same tokens but have their own constraints (touch
targets, glanceability at a distance) that these rules don't yet cover; treat them separately
rather than assuming this composition applies unchanged.

### Wording

- **Keep text as short as its meaning allows** (owner, 2026-10-09, A443). Leave out what the reader
  can infer: the kitchen ticket's rest-of-order heading reads just "Also on this order" (A366-4A).
- **An action label starts with a verb** (owner, 2026-10-09, A443): Add, Delete, Move, Remove, Save. A
  button or menu item that creates something reads "Add …" / "Añadir …", never "New …" / "Nuevo …"
  — "Add" is a verb like "Delete"; "New" is an adjective. A create action never says "Create" /
  "Crear", and the dialog it opens is headed "Add …" to match it (owner, 2026-10-09, A450).

## Event discipline

Custom events crossing a shadow boundary are `composed: true`. A native event that is itself
composed, such as `input`, also crosses that boundary, so re-emitting it without care makes the
consumer see the change twice. Native `change` is not composed (the measurement is under "Event
discipline" in [conventions-ui.md](conventions-ui.md)). **Always `stopPropagation()` the native
event before dispatching your own.** The exception is a click on an action inside a
`wt-row-actions` menu, which is not stopped, or the menu stays open (see "Tabbed management
pages"). `wt-input` and `wt-switch` are the reference implementations.

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
- `chooseOptions(el, values)` — picks `values` on a `multiple` `wt-combobox` (it sets `values`,
  never `value`, so it cannot drive a single-choice one): sets `values`, sends the `wt-change` a
  click on a row sends, with `detail: { values }` (bubbling and composed), and awaits the render.
  Unlike clicks, it sends one event for the whole list, where a person ticks one row per click and
  each click sends its own. An app's test imports it as `@waitron/ui/src/test-helpers.js`. Its
  cases are in `packages/ui/src/test-helpers.test.ts`.

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
  always `host`) and fails with a readable message (rule id, impact, offending selectors) on any
  violation, and on a `color-contrast` check axe left undecided for `equalRatio`, `fgAlpha` or
  `colorParse` (shown as `color-contrast [undecided]` with axe's message and the selectors). Any
  other undecided result passes. **The ruleset is never narrowed** — every caller runs the same,
  full default set; narrowing it to make a test pass is exactly the kind of box-ticking this exists
  to prevent.

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
watching the relevant test _fail_ is not optional busywork; it is the only way to know the test would
have caught the defect it's named after.

**Colour contrast** is checked as part of the same default ruleset, per theme, via `mountThemed`'s
`theme` argument — see the `describe.each(["light", "dark"])` pattern above, used throughout the
`*.a11y.test.ts` files. `expectNoA11yViolations` fails on a contrast violation, and on a contrast
check axe left undecided for a reason about the colours themselves (`equalRatio`, `fgAlpha`,
`colorParse` — text the same colour as its background is one; its helper tests show it failing;
axe 4.13.0 never sets `fgAlpha`). A check axe left undecided for any other reason (among them an
overlapping element, such as an empty `wt-input`, a background image or gradient, and content too
short or not text) still passes, so contrast there is not checked. As of
this writing axe reports zero contrast violations for any `--wt-color-*`
pairing actually used by every primitive in the table above, in either theme, across every documented state except the disabled `wt-combobox` rows below, which axe does not score (`wt-input`
invalid, `wt-switch` checked/unchecked, `wt-dialog` open, `wt-button` icon-only and every variant,
disabled and loading states; `wt-spinner` as a status region and decorative — all verified
2026-09-11; `wt-button` as a menu trigger, open and closed — verified 2026-09-27 by running
`packages/ui-core/src/components/wt-button.a11y.test.ts`; `wt-button` in each variant under the
pointer on `--wt-color-surface` and `--wt-color-surface-raised`, and primary and danger focused from
the keyboard and then hovered — verified 2026-10-07 by running
`packages/ui-core/src/components/wt-button.a11y.test.ts`; `wt-modal` with a primary or a danger
footer button under the pointer, and `wt-unsaved-changes`' Discard under the pointer — verified
2026-10-07 by running `packages/ui/src/components/wt-modal.a11y.test.ts` and
`packages/ui/src/components/wt-unsaved-changes.a11y.test.ts`, both themes; `wt-combobox` closed, closed and named only by a forwarded `aria-label`, open with
results, open with the add row, open with no matches, multi-select with a selection, invalid with an
error message, disabled and required — verified 2026-09-13 by running
`packages/ui/src/components/wt-combobox.a11y.test.ts`, which covers those states in both themes —
and, verified 2026-10-03 by running the same file, open with rows indented by `depth`, and
`appearance="link"` closed with and without a value, focused, open, with an error and disabled;
`wt-count-badge` in its neutral, warning and error tones — verified 2026-09-14 by running
`packages/ui/src/components/wt-count-badge.a11y.test.ts`; `wt-choice-row` as a button at rest, focused
and hovered, and as a link with no description at rest and focused and with one hovered, in both
themes — verified 2026-10-03 by running `packages/ui/src/components/wt-choice-row.a11y.test.ts`;
`wt-toast` open in its info and error
tones, and closed — verified 2026-09-14 by running
`packages/ui/src/components/wt-toast.a11y.test.ts` — and, verified 2026-10-07 by running the same
file, open in its info and error tones holding an action button, in both themes; `wt-relative-time` at rest, focused, with the
exact time shown, and as a deadline already gone — verified 2026-10-06 by running
`packages/ui/src/components/wt-relative-time.a11y.test.ts`; `wt-notice` on screen, fading and gone —
verified 2026-09-30 by running `packages/ui/src/components/wt-notice.a11y.test.ts`; `wt-language-chooser` closed, open
with the active language checked, and closed with a page's `::part` rules showing the short code
instead of the name — verified 2026-10-02 by running
`packages/ui/src/components/wt-language-chooser.a11y.test.ts`; the field primitives in the filled
field box — `wt-input` with its label resting in an empty field, focused, with its label hidden,
disabled holding a value, invalid with an error message, and with a help button beside it;
`wt-textarea` resting, floated over a value, with a hint, focused, invalid with and without a
message, required, disabled holding a value, with its label hidden, and with a help button;
`wt-price-input` invalid with no message, resting, resting over a hidden currency sign and fixed
unit, focused, and disabled with a fixed unit; `wt-number-stepper` empty with no hint, focused, invalid with no
message, with a long label its box widens to fit, with a label cut in a row too narrow for it,
with its label hidden, and clearable at its lowest number and blank (the two long-label states
verified 2026-10-02, the two clearable states 2026-10-03); `wt-combobox` closed with a
value chosen, open with the chosen row ticked, with icons, with groups, with an action row,
without a search box, with focus back on the trigger, compact, with a hint shown as the
placeholder, with a help button, disabled with a value chosen, and opened from the keyboard with
and without a search box — verified 2026-10-01, and open with options described by a second line
— verified 2026-10-02, and with the pointer over a described row, opened from the keyboard with a
described row active, open with a primary row in each group, with the pointer over a primary row,
and opened from the keyboard with a primary row active, closed with a disabled option chosen,
open with a disabled option and its second line, with the pointer over a disabled row, and opened
from the keyboard with a disabled row active — verified 2026-10-03, by running
`packages/ui-core/src/components/wt-input.a11y.test.ts`, `wt-textarea.a11y.test.ts` beside it, and
`packages/ui/src/components/wt-price-input.a11y.test.ts`, `wt-number-stepper.a11y.test.ts` and
`wt-combobox.a11y.test.ts`, each state in both themes). No token values needed changing, except that a primary row needed the
new `--wt-color-primary-text` (A218), because `--wt-color-primary` measured 4.32:1 on a hovered
light row. axe scores no contrast for a disabled `wt-combobox` row, because it skips
`aria-disabled` content, so `wt-combobox.a11y.test.ts` measures that row's label and second line
against the open list's panel at 4.5:1 itself (`expectReadableDisabledRow`). (axe does flag unrelated `incomplete` — not
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
or `GLOBAL_ROOT_FILES` lists. Shared configuration, a file `GLOBAL_ROOT_FILES` lists, or an unknown push range selects all workspace typechecks. Deleting
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

### Station hours named days

Station hours offers Week and Named days. Add, copy or delete a named day through the links
in Named days to Opening hours → Calendar. You see one-off days from the venue’s yesterday
onward; repeating days follow each station’s standard week. Edit shows the stored date and name
as text and saves station cells with the day’s other fields unchanged. A stored whole-venue closure
locks those cells; the default station stays open. Station hours has no local-holiday editor (Task 26 implementation checkpoint, 2026-10-09).

### Tabbed management pages

When a management page separates concerns into selectable panels, use `wt-tabs`.
Give each tab a stable key, a localized label and a matching named slot:

```ts
html`<wt-tabs
  label="Venue settings"
  .items=${[
    { key: "receipts", label: "Receipts" },
    { key: "tables", label: "Tables" },
  ]}
  .value=${this.view}
  @wt-tab-change=${this.selectView}
>
  <section slot="receipts">${this.renderReceipts()}</section>
  <section slot="tables">${this.renderTables()}</section>
</wt-tabs>`;
```

An item may carry `marked`, the words for a state that tab resolves: the tab is drawn in
`--wt-color-primary-text`, selected or not, with a "*" after its label that a screen reader skips,
and is named "<label>, <marked>".

Your selection handler receives `event.detail.value`. The strip's event has its own name, so a
`wt-change` from a control inside a panel does not trigger a `wt-tab-change` handler. A `wt-tabs`
inside another strip's panel sends a `wt-tab-change` that bubbles out to the outer strip's
listener, carrying the inner strip's key; a listener that returns early unless
`event.target === event.currentTarget` ignores it and still handles the outer strip's own choice,
so a screen that nests one strip inside another's panel needs that check on the outer listener.
The component updates its own selection, while your screen records it with `UrlStateController`.
An unknown or omitted value shows the first tab. Arrow keys wrap between tabs; Home and End
select the first and last tab. The tab strip scrolls on narrow screens and brings the selected tab
into view when a page opens directly on it and whenever the strip changes width (a tab wider than
the strip shows its start). When the tabs overflow, the strip fades each cut end over twice
`--wt-space-6`, so a person sees that it scrolls: `wt-tabs` sets `data-overflow` (`start`, `end`
or `both`) from the scroll position, and a mask draws the fade. A selected tab stops clear of a
faded end that has another tab beyond it, and where the room beside the selected tab is short the
fade narrows to at most half of it, so that tab is not drawn faint after the strip brings it into
view. A scroll by hand only redraws the fades (`wt-tabs` handles `scroll` with its overflow check
alone), so it can leave the selected tab under one (the
"fades only the cut end", "a selected middle tab stops clear of the fade" and "the fade narrows to
leave that tab clear" cases in `packages/ui/src/components/wt-tabs.test.ts`). Hidden panels
remain mounted, so switching tabs retains their input values. Supply unique, nonempty keys and a
localized `label` for the tab group.

Prep stations uses `stations`, `routing`, `watchers` and `settings` at
`/manage/prep-stations/view/<key>`; an old `tickets` address opens Stations. Stations shows no
live kitchen numbers: each station's name with its Default or Disabled mark, Printed on (its
printers, or "No printer"), Shown on (the devices whose kitchen screens show it, and a link to
Devices) and Today (`packages/venue-service/src/dashboard/station-table.ts`). Its Today column
reports the station's status and destination without close/open controls.
Use the till's Station screen or the kitchen display for Close for today and Open for today.
Closing asks where new work goes and offers the default station first; a manager PIN step
keeps the destination draft after a refused PIN. The counter and table order screens show the
period's end beside Keep open later. Its dialog offers server-provided times, explains the next
period's delay and allows ending an existing extension. Both destination and endpoint dialogs
use the shared draft scope and save-action state, with reconnect cases in their
`*.unsaved.test.ts` suites under `apps/till/src/widgets/`.
Routing shows the routing grid (`packages/venue-service/src/dashboard/routing-grid.ts`): a row for
All categories, each category, each top-level product and, while a product has no category or the
row holds a saved choice, No category; a column for Every zone and each active service zone. Below
40rem the row-label column is at most 96 px and table cells pad by `--wt-space-1`, so a 390 px
window shows the labels, Every zone and one zone column without scrolling (the "at phone width"
cases in `routing-grid.test.ts`). Each cell is a button showing its station (an inherited one muted
and in italics) and one line per period choice ("Lunch, Afternoon: Downstairs bar"). Under a line
the cell stores whose period's menus offer none of the row's active products, the grid shows "Not
on Lunch menus" in the warning colour; the editor shows it under that saved line until the line's
periods or station change, and it does not change Save. It opens the
routing cell editor (`routing-cell-editor.ts`): "Any other time" holds the cell's own station,
and "+ Different station during some periods" adds a line of periods with a station. A zone column offers only its
department's periods, and none when the zone has no department; a line offers only periods whose
menus include the row's products, or one the cell already stores with the same choice as that line, a station or No preparation. An inherited cell opens holding
what it inherits, with Save ready so it can be pinned, and names the inherited periods it did not
copy. The default cell (All categories × Every zone) takes no period lines. A choice that moves
products opens a preview listing each one with its old and new destination ("… during Lunch" for a
period's move) before anything is saved; a choice that moves nothing saves at once. Edit, in a
Stations row's menu, opens the station editor (`station-editor.ts`): name, Printers and "Show the
rest of the order", saved in one request. Printers offers a printer a watcher uses as disabled,
unless the station already has it, and is a read-out for a switched-off station; the editor also has
a read-out for a person without `printer.manage`, which the screen cannot yet select. Add station
also sets Printers. Watchers keeps its own printer selections. Settings edits each station value in
its own cell, with blank late-flag overrides inheriting the venue's Kitchen defaults. The configured
fallback field reads "Outside its hours, work goes to". Station Edit, Make default and
Disable/Enable actions belong to the Stations row menu; Routing's All categories × Every zone cell
also sets the default station, for someone with `venue.configure`. The page is offered only to
someone with `venue_service.manage`; a supervisor is not offered it.

Station hours (`packages/venue-service/src/dashboard/hours-screen.ts`) uses `week` and `dates`
at `/manage/hours/view/<key>`. `/manage/hours/station/<id>` opens the week
with focus on the station's heading once it is read. Department opening hours belong to
`/manage/opening-hours`, with Week, Periods, Day and Calendar tabs; `/department/<id>` selects the
department and `/view/periods` selects its periods. The Week and Day editing contract is in
Forms above. After provisioning, setup's completion screen shows the first saved Open schedule,
when it is still Monday to Friday, 09:00–17:00, with a link to that department's Opening hours.

- **Standard week.** Days are rows, Monday first, with today marked; prep stations are columns.
  The editable cells share one Tab stop and the arrow keys move between
  days and columns. Each editable column's heading has its own menu, a separate Tab stop, holding
  Clear schedule, or Configure hours for a subject with no hours.
  The default station's column reads Always open and has nothing to open. A subject with no hours
  reads "No hours restriction"; Prep stations says
  "Always open" for that station state. A cell opens that day's editor; a subject with no hours
  opens a seven-day draft that starts Closed and saves only after a confirmation.
- **Named days.** A `wt-data-table` of one-off named days from yesterday onward, with prep station
  columns; a value kept from the standard week is muted. Edit changes station cells only; the date
  and name are text, and the save carries the stored kind, repeat, own-hours, closure
  values unchanged. A whole-venue closure keeps the station cells locked. Add, copy and delete
  lead you to Opening hours → Calendar. Repeating named days follow the stations' standard weeks.

- **Calendar.** Add, edit, copy and delete named days here. The editor asks for Holiday or
  Working day, annual repeat and the day's hours choice; name and date are required. Own hours
  replace that day's schedules as a shared choice, while Keep the normal week follows the week.
  Copy opens a staged draft for a new date. `named-day-editor.ts`, `named-day-copy.ts` and
  `opening-hours-screen.ts`, under `packages/venue-service/src/dashboard/`, own these actions.
  Calendar keeps a selected month across date refreshes and offers one keyboard Tab stop in its
  grid. Public names remain visible beside your own name.
- **Local holidays.** Add your town's holidays as own Holiday days in Calendar. There is no separate
  Local holidays editor. The country's yearly number is information and caps no own entries;
  a holiday occurring in a year, including a repeat, supplies owner-entered local coverage for
  that year. Calendar reports official and owner-entered coverage independently, even without
  official country data or a completed holiday address. Choose a holiday area here when the
  official list needs it. `hours-calendar.ts` renders the area control and coverage, and
  `packages/venue-service/src/holidays.ts` reads both sources.

In the week grid and date panel a period stays on one line, so hours wrap only between periods.
The day, date and duplicate editors are `standard` modals; the seven-day confirmation,
Delete and Clear schedule are `compact`.

Venue settings fills its tabs with panels from several owners. The page draws the only `h1`;
each panel leaves it out because its tab already names the panel through `aria-labelledby`.

**A sub-page puts its parent's name above its own** (owner, 2026-10-08, A335). A page reached from
a list or from another page draws "<parent> ›" on a line of its own above the heading,
left-aligned, at normal text size, in `--wt-color-primary-text`: the parent's name is an
underlined link back to it, inside a `nav` landmark with its own name. The page's own name is its
one `h1`, at the list page's heading size and outside the landmark, so no other heading repeats it;
the page's tabs come under it. A one-word name longer than the screen breaks inside the `h1`. A
short fact about the item sits in brackets after the `h1`, on its line where there is room, in
normal muted text. A click on the parent link with a modifier key is left to the browser. The menu and canvas
editors draw this pattern. The canvas editor's parent link uses the same unsaved-changes check as
Cancel; a modified click keeps the browser's link handling. The printer page still names the printer
after "All printers ›" inside its `nav`; A405 plans to turn its details into a modal instead.

The menu editor (`apps/dashboard/src/screens/menus-screen.ts`) reads "Menus ›" above the menu's
name, then its live version in brackets — "(Live: version 2 · <time>)", or "(Unpublished)" for a
menu never published. A state resolved on one of the page's own tabs marks that tab rather than
adding a link to it: while a menu has unpublished changes its Preview tab reads "Preview*", drawn
in `--wt-color-primary-text` whether it is selected or not, and is named "Preview, unpublished
changes" for a screen reader (`marked` on the `wt-tabs` item). A menu whose publishing waits on
clashes says so on a line under the heading, as a link to its own Price overrides tab in
`--wt-color-danger`, and as plain words on the Price overrides tab itself. Guards:
`apps/dashboard/src/screens/menus-screen.heading.test.ts` and `menus-screen.heading.a11y.test.ts`
beside it.

The Preview clash link opens Price overrides with Clashes selected, including in a new tab.
That explicit destination overrides a remembered price filter once after the rows load. Later
filter choices stay in place through refreshes; an ordinary tab change keeps the remembered choice.

A menu's Preview shows frozen customer content beside unpublished changes. Choose a content
language independently of the dashboard language, or select Internal names for staff inspection.
Keep the live version in the editor header rather than repeating it in Preview. Show price clashes
as a red sentence, with each conflicting price and its source below it. A menu included by other
menus names those includers as links to their Preview tabs beside Publish; omit that note when
there are none. Keep publication actions outside the two scrolling panes. Put unpublished changes
on the left and the proposed menu on the right. Stack the panes with changes first when the host
has less than 800px available. Each pane has its own accessible name and keyboard focus.

Group changes by type under small headings, with one plain bullet per change. Keep a source note
for a shared product or an included menu. A native View link expands the proposed tree's ancestors,
scrolls its product or section row into view and marks it with `aria-current`. Keep keyboard focus
on the link. Another View or an outside click clears the previous mark. Removed items point to
their surviving parent section; a deleted product with no place has no View. Home changes link to
that menu's Home tab.

Draw the proposed document as a read-only Structure-style tree. Share row presentation with
Structure, including indentation and the swatch slot; an image occupies that same slot, with a
colour fallback when absent. Read names from the frozen document, with visible requested/default/
staff fallback notes and the actual translation's language tag. Internal names have an empty
language tag rather than inheriting the dashboard language. A replacement preview resets the
tree's expansion and highlight without moving focus. Changing Content view makes no request.

A Hide link removes a bullet and its group when the group becomes empty. Show all changes restores
them and is disabled when nothing is hidden. Show the hidden count beside it and explain that
Publish still includes every change. Keep hidden IDs in component state for the same menu,
intersecting them with each refreshed change list; leaving the menu forgets them.

Widget checks: `apps/dashboard/src/widgets/menu-preview-tree.test.ts` and
`menu-preview-navigation.test.ts` beside it; publication and accessibility checks remain beside
them. Screen freshness checks in `apps/dashboard/src/screens/menus-screen.test.ts` keep the
displayed snapshot and publish hash together. A failed refresh retires warning confirmation and
publish controls, drops the Preview heading's old clash count and keeps its known publication
facts and existing refresh error. Recovery supplies the new count. After a stale-hash refusal,
hide the old document while reading its replacement. Changing the dashboard interface language
rebuilds its screen, so that separate operation reads the preview again.

If a tab has an Add action, put it in the `actions` slot for the selected tab. This
places the action at the end of the tab row, outside the tab list's accessibility role, and keeps it
there on the tabs' line at every width: never let the row wrap the action onto a line of its own
(owner, 2026-10-08, A424). The tab strip takes the rest of the row and scrolls sideways beside the
action, ending where the actions area begins. The actions area keeps its whole width up to the row
less two touch targets; actions wider than that scroll within it. A selected tab wider than the
strip shows its start: in Spanish at a 390 px window (a 310 px screen), Printers' "Agentes de
impresión" tab is cut that way beside "Añadir un agente" (the "shows the selected tab whole at
every window width except the Spanish Agents tab on a phone" case in
`apps/dashboard/src/screens/printers-screen.test.ts`). Prep stations shows its one add button,
Add station, on Stations alone, and caps its action area at half the row through the
`tab-actions` part so its tabs keep that half whatever the font (the "shows Add station on the
Stations tab alone" and "keeps half of a … px tab row for the tabs" cases in
`packages/venue-service/src/dashboard/prep-stations-screen.test.ts`).
Keep actions for other tabs out of sight until their tab is selected.
A tab whose list is a tree puts its adds in the tree rather than the tab's `actions` slot: the Products tree in its All products row's ⋮, and a menu's
Structure tab in its root row's ⋮ and in the ⋮ of
each section the menu owns (the "the Structure tree" cases in
`apps/dashboard/src/screens/menus-screen.test.ts`).

Put each list in `wt-data-table`. Use `wt-row-actions` for its kebab menu — three dots, not a
hamburger; it opens a small menu of actions for one row, not the app's whole navigation, so it
needs the icon that means "more options here," not "open navigation" (see "Icons" below) — with a
label that identifies the row, such as `Actions: Restaurant`. On a page without tabs, put Add in
a menu beside the table heading. Some lists, Menus, Staff and Units among them, instead put a text
button that creates one, such as "Add menu", in the heading's row at its trailing edge (Menus at
the owner's request, W79, 2026-10-04); Menus' button moves under the heading, still at the trailing
edge, when it does not fit. Put Edit, Delete or domain-specific actions in each row's menu. A
screen may instead offer Add as a round icon-only `wt-button` (`shape="round"` with the `plus`
icon and an `aria-label`) beside the heading — but **no screen does today**, and no dashboard
control uses `shape="round"` at all, so read this as a permission rather than a pattern with a home.
The menu uses a native popover: clicking outside or pressing Escape closes it. Clicking an action
inside it closes it too; `onAction` in `packages/ui/src/components/wt-row-actions.ts` decides which
clicks count. The menu learns of the click only when the click reaches it, so an action's click
handler must not stop the click's propagation, or the menu stays open. Its action buttons
follow normal Tab navigation. Give every `wt-button` slotted into a `wt-row-actions` popover
`align="start"` — a centred label reads oddly once the button has been stretched to the popover's
full width, the way a dropdown menu item never centres its text. This applies to every
`wt-row-actions` popover, not just per-row kebab menus — the account menu in the banner uses the
same primitive and the same alignment. A link (`<a href>`) slotted into the popover takes the look
of a `variant="secondary"` `align="start"` button — border, background, padding, start alignment,
hover border and focus ring — from `wt-row-actions` itself, and stays a link. One marked
`aria-disabled="true"` takes the disabled button's faded look and no hover border, and choosing it
leaves the menu open; `wt-row-actions` does not stop it navigating.

The menu itself is left-aligned by default: `wt-row-actions` pins the popup's left edge under its
trigger (`align="start"`), so the menu grows rightward, and a per-row kebab at the end of a table row
opens into the margin beside the table. A menu anchored at the trailing edge of a wide surface — the
banner's account menu — passes `align="end"` instead, pinning the popup's right edge so it grows
leftward, inward over the page rather than off the screen. A per-row menu in a table inside a modal
also passes `align="end"`, since a modal has no margin beside the table.

Open create and edit forms in `wt-modal`, with `wt-form-actions` in its footer. Keep validation
messages inside the modal, retain entered values after a failed save, and refresh the table after
success. Use the existing Forms contract for required markers, field errors and keyboard submission.
Only offer operations your domain supports: Disable on a department switches it off and keeps it;
removing a product from a menu removes that offer.

### Switching off versus deleting

Something switched off but kept — an options or extras list, a zone, a
department, a station, a table, a table status, an adjustment reason, a user, a printer, a print
agent, a device, a card reader, and a watcher or a kitchen course that something refers to — is switched off with **Disable** (options and extras lists and
table statuses are switched back on with an **Active** switch in their form), and where a screen has
an action that brings it back, that action is **Enable**. Its status reads **Active**
or **Disabled**; there is no "Enabled" status. **Delete** is only for something really deleted, and **Remove** for taking a row out of a list or a link off a record,
which may delete that row (Remove from this list, Remove image, a passkey). "Restore", "Add again", "Deactivate", "Reactivate" and
"Inactive" are not used for a record that is kept.

In Spanish the action is **Deshabilitar** and **Habilitar**, and the status agrees with the noun the
screen uses: **Activo** or **Deshabilitado** for a departamento, estado, motivo, usuario,
lector, agente, dispositivo, punto de seguimiento or curso; **Activa** or **Deshabilitada** for a lista, zona,
estación, mesa or impresora. "Desactivar", "Reactivar", "Restaurar", "Volver a añadir" and
"Inactivo" are not used for a record that is kept. A setting turned off (backups, a toggle) is not a record and keeps its own
words.

Where a screen has both, the action follows what the code does: a watcher's or a kitchen course's row offers Delete when nothing refers to it and Disable when something does; Disable only switches it off, and a confirmed Delete switches it off instead when something refers to it by then.

Products use **Archive**, with **Active / Archived** status, and **View** for an archived row.
In Spanish these are **Archivar**, **Activo / Archivado** for a product,
**Activa / Archivada** for a variant, and **Ver**. Archive is permanent; it has no Enable action.
With only products selected, the bulk action reads Archive and is absent when every selected
product is already archived. With a category selected it reads Delete: the category is deleted,
and its contents are moved or archived according to the dialog's answer. Products selected
directly are archived in either case.

### Products: Active and Available are two different words

**Active / Archived** describes the product's retained state. **Available / Unavailable** says
whether an active product is sold out for now. Archive keeps the row and past sales, but you
cannot bring it back. Take it out of every live or scheduled menu and publish before archiving;
a refusal names the menus that still include it. This also applies to variants and to products
offered as extras or home-screen shortcuts.

The Status filter starts on Active. Change it to Archived to find a retained product, then choose
View to open its plain-text details panel. The panel has no Save or availability control and does
not open the editor. A variant of an archived product is archived too. An Unavailable active
product stays listed with its Unavailable badge.

The editor hides variants archived before it opened. Archive on a saved variant stages the
change: its row remains visible with **Archived when saved** and **Keep** until Save. Keep cancels
that staged archive; it cannot restore an archive already saved. An unsaved variant uses Remove.
There is no Show disabled toggle or Archive action in the editor footer.

A menu's Price overrides tab lists active products and sizes reached by its working structure.
Archiving removes a product from drafts and clears the archived variants' menu prices. Its
Available column still reads Yes or No from the product's or size's own Available flag, and each
row's ⋮ holds Edit product. The Structure tab's product rows show the same Available word.

### Navigation and language controls

Your selected tab belongs in the URL. `UrlStateController` reads path segments, updates them without
removing unrelated query parameters, and restores the screen on browser Back/Forward. The screen validates
identifiers against its loaded data and permissions; a URL never establishes authentication. Use
replacement history for defaults and invalid destinations, and push history for a new selection.
Keep passwords, PINs, pairing codes and unsaved form contents out of the URL.

Module management tabs use `/manage/<section>/view/<key>`. Departments always opens its list
at `/manage/venue-operations`. A department opens at
`/manage/venue-operations/department/<id>` (Settings); its Zones tab adds `/view/zones`,
and a selected zone adds `/zone/<id>`. The parent link returns to the list. Unknown
departments show a missing-department message; a stale zone selection falls back to a visible zone.
Old top-level tab addresses are replaced with the list URL. Venue settings
(`/manage/venue-settings`) starts with `venue-details`, followed by `receipts`, `tables`,
`adjustment-reasons` and `kitchen`; a tab
appears only when a panel on it is visible to the session, and an address naming a hidden tab
opens the first visible tab. Venue details needs `venue.view`; its editor needs `venue.configure`.
An explicit Receipts link keeps that tab selected. The dashboard preserves module-owned
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
only after login and device validation. A kitchen display opens the one kitchen screen its device
chose and cannot open operator destinations from a path. Unsaved canvas tabs stay out of both URL writes and history,
including when you reselect them; saved tabs become destinations after persistence.
Only meaningful navigation pushes history. Payment steps, modifier dialogs and draft edits do not;
an automatic return home after payment replaces the current entry. The till holds the menu choice in
memory for the tab, retained through new and parked orders. At a counter where nobody has picked
a menu by hand, the till moves to its department's current customer menu, as the till's periodic
menu check reports it, provided the basket is empty: it
does so when that check arrives, unless a sale, a hold or an order is being sent, and when the
basket is cleared. A table's menu is not moved to follow the default. A person who signs in again
with nobody else signed in between comes back to the zone they left, while it is still offered, and
the menu they chose there, while that zone still offers it. A different person, a sign-in after a
reload (refresh returns to PIN login) or a profile switch starts at the device's starting zone (the
profile's, or else the venue's counter default) and that zone's default menu, or its first. It
belongs in neither the path nor browser history.

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
there on its own when nobody is signed in; in the till's tab-shell bar, before the operator's name
while that is on the bar, and before the More menu when the bar has one, as in the counter screen's
own header (which it draws only when not embedded in the shell, and the
app always embeds it). A till screen with no top bar — the sign-in and join screens, and the
kitchen display, whose shell draws no bar — holds it at the top right on its own, above the
content.

The till's tab-shell bar is one row at every width. On a phone (40rem wide or less) it holds the
tabs, the language chooser and a More menu with everything else. Wider, it measures itself when
its width, its content or the language changes, and moves items into More one at a time, only as many as it needs to stay on one row,
in this order: the Waitron name is hidden first, then Allergens, Equipment, Profile, My schedule,
Pass, Kitchen, Find a bill, Department transfers (the count and its button together), and last the
operator's name with Log out. Inside More the items keep the bar's order. The tabs and the language
chooser never leave the bar; once everything else has left, the tabs scroll sideways. Items come
back when the screen grows wider, the bar's content other than the transfer count changes, or the
language changes, but not while More is open. While the transfers are in More, its button carries the pending count. Cases:
`apps/till/src/widgets/tab-shell.test.ts`.

At 40rem wide or less the language chooser's trigger shows the language's short code instead of
its full name, by each app's own `::part` rule (`apps/setup/src/setup-app.ts`,
`apps/dashboard/src/dashboard-app.ts`, `apps/till/src/widgets/language-chooser-styles.ts`); its
accessible name is the full name either way. Its menu opens downwards. The parent passes the
page's language as `active` and decides what a pick means. A signed-in operator's choice uses the
existing preference write; login, pairing and kitchen-display choices are local UI changes.

At phone width the till's page keeps `--wt-space-2` at its edges (`apps/till/index.html`), and the
Floor, table Order, Expo, Station, Counter, Schedule and Allergens screens add no side padding of
their own; Schedule and Allergens also drop their card's border there. Cases:
`apps/till/src/screens/device-screens.phone-margin.test.ts`.

### Counter basket and payment space

On the standard counter canvas, the menu sits beside a basket that scrolls within its own card.
Menu and dietary controls stay in the menu side. Total and payment controls take the space their
contents need underneath the basket. Held orders follow the products within that side's scroll area. The counter
uses this arrangement when its first four cards are Product grid, Basket, Total and Tender/pay,
with the menu and basket filling one row and the total and payment cards matching the basket's
width; only Held orders with the menu's width may follow. Other arrangements keep their configured row spans.
At phone width the cards stack in their configured order and the page scrolls. Basket rows wrap
controls that do not fit beside the dish name. Full invoice and Hold share a row in both payment
modes. When Place is offered, it fills the row above them. The cash-at-till explanation spans the
payment card. Cash, Card and Hold use the shared medium button size. The Chromium payment-mode
cases in `apps/till/src/screens/till-counter-screen.layout.test.ts` hold those arrangements.

### Departments and zones

You open a department from the list, even when the venue has only one. Its page keeps a
Departments parent link above the name and offers Settings and Zones tabs. Settings holds the
name, trading name, service settings and transfers. Zones shows the department's zones and the
selected zone's settings. The Receipt tab belongs to slice 7; Edit the receipt currently opens
Venue settings' Receipts tab. The Zones tab shows the selected zone's normal-week closed times under its name, with a link
that opens that zone in Opening hours. Identical ranges share a day group; more than two groups
show a day count. A week without closed ranges says the zone opens with its department. Named-day
exceptions stay in Opening hours. Disabled zones have no hours summary or link.
Floor-plan previews remain separate work.

How orders start chooses Table service or Counter service. Counter service has a separate
paid-when choice and collection-ticket choice. Print a receipt offers Always (`auto`) or
On request (`on_request`). A zone's empty choice follows its department: the placeholder
contains only the inherited value, without a Follow prefix. Explicit choices remain overrides,
even when equal to the department's value. Cancel precedes Save in the forms and dialogs.

The list's disabled note and the Zones tab's disabled note use the muted text token.
The list's row menus stay pinned at the end. The dialogs ignore Escape and close requests
while their write is pending. Regression cases live in
`packages/venue-service/src/dashboard/department-dialogs.test.ts`,
`packages/venue-service/src/dashboard/departments-list.test.ts` and
`packages/venue-service/src/dashboard/department-zones.test.ts`.
