---
name: Waitron
description: Restaurant point of sale, kitchen and back office, self-hosted on a box in the venue.
colors:
  waitron-teal: "#007392"
  waitron-teal-hover: "#09607a"
  waitron-teal-disabled: "#7acae9"
  sky: "#71cfeb"
  sky-hover: "#8ae2fd"
  on-teal: "#ffffff"
  on-sky: "#001016"
  page: "#f7f7f8"
  surface: "#ffffff"
  surface-lifted: "#d2effb"
  surface-sunken: "#d6d9e0"
  ink: "#231f20"
  ink-muted: "#626366"
  hairline: "#d6d9e0"
  field-fill: "#f0f1f4"
  field-line: "#7d8390"
  field-value: "#000000"
  danger: "#b3261e"
  danger-hover: "#9a1f18"
  success: "#1a7f5a"
  warning: "#8a5300"
  highlight: "#fff3b0"
  night-page: "#101216"
  night-surface: "#191c22"
  night-surface-raised: "#22262e"
  night-ink: "#eceef2"
  night-ink-muted: "#a1a7b3"
  night-hairline: "#333945"
  night-field-fill: "#262a33"
  night-field-line: "#7a8291"
  night-field-value: "#ffffff"
  night-danger: "#ff7f73"
  night-success: "#4ac08d"
  night-warning: "#f2b24c"
  table-free: "#dff3e8"
  table-seated: "#1f6feb"
  table-bill: "#7e3fb8"
  table-reserved: "#fde7c8"
  table-calm: "#e4ecfb"
typography:
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  control:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "max(1rem, 1em, 0.875rem)"
    fontWeight: 400
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button-primary:
    backgroundColor: "{colors.waitron-teal}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.waitron-teal-hover}"
    textColor: "{colors.on-teal}"
  button-primary-disabled:
    backgroundColor: "{colors.waitron-teal-disabled}"
    textColor: "{colors.on-teal}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-teal}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.danger-hover}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  field:
    backgroundColor: "{colors.field-fill}"
    textColor: "{colors.field-value}"
    rounded: "{rounded.md}"
    height: "56px"
  lozenge:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 12px"
  table-token:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
---

# Design System: Waitron

This file is a summary for design work. The full contract, with every rule's reasons and guards,
is [docs/developers/design-system.md](docs/developers/design-system.md), and it wins where the two
disagree. The token values come from `packages/ui-core/src/tokens/colors.css` and
`packages/ui-core/src/tokens/structure.css`; code reads the `--wt-*` custom properties, never the
hex values written here.

## Overview

**Creative North Star: "The Quiet Pass"**

A kitchen pass in good order: everything in its place, nothing shouting, and only what needs
attention lights up. Waitron's screens are calm grey and white surfaces with plain type, so
that the few things carrying colour, such as the one action to take, a table waiting for its bill
or a dish running late, are seen at a glance by someone who is not looking carefully.

The mood is calm, plain and dependable. Density follows the device: the till and station screens
use large touch targets and big, glanceable status marks; the dashboard is a quieter, denser
working space of tables, cards and forms. The venue's own logo, colours and text settings fill
the frame through Appearance, so Waitron's own identity stays in the background.

**Key Characteristics:**

- One accent, Waitron Teal, for the action to take, the current place and focus.
- Strong colour reserved for meaning: table states and warnings, and the colours a venue picks for
  prep stations, calendar entries and products.
- The device's system font unless a venue's Appearance picks serif; hierarchy from size and
  weight, not from typefaces.
- Thin hairline borders do most of the separating; dialogs, menus, dropdowns, tooltips and toasts
  carry a shadow.
- Light and dark themes are equal citizens, each with its own tuned values.
- Tap targets are at least 44 by 44 pixels, apart from the exceptions the contract lists under
  `--wt-tap-min`.

## Colors

A cool neutral ground with a single teal accent taken from the Waitron logo, and a separate,
deliberately wide set of status colours that only ever mean something.

### Primary

- **Waitron Teal** (`waitron-teal`): the main action's fill (Pay, Continue, Use this device),
  focus rings, a focused field's bottom line, the selected item's edge in navigation and tabs.
  Text in the brand colour uses the separate primary-text token, which happens to share the value
  today, so that a venue theme can tune the two apart.
- **Sky** (`sky`): Waitron Teal's role on dark screens. It is the logo's second colour, and on a
  dark ground it carries the accent with dark text on top (`on-sky`).

### Neutral

- **Page** (`page`): the ground every screen sits on.
- **Surface** (`surface`): cards, banners, secondary buttons, table tokens.
- **Surface lifted** (`surface-lifted`): a pale teal wash for something picked or being moved:
  a dragged row, a chosen portion, the order preview.
- **Surface sunken** (`surface-sunken`): wells and tracks set into a surface.
- **Ink** (`ink`) and **Ink muted** (`ink-muted`): body text, and labels, hints and resting
  navigation items.
- **Hairline** (`hairline`): borders and dividers.
- **Field fill** (`field-fill`), **Field line** (`field-line`) and **Field value**
  (`field-value`): the filled field box, its bottom line and the value inside it.
- The `night-*` values are the dark theme's counterparts of the roles they name.

### Status

- **Danger** (`danger`), **Success** (`success`), **Warning** (`warning`): refusals and
  destructive actions, done and ready states, and things running late. Each has a dark-theme
  counterpart; danger and warning also have a dimmed shade their pulses fade to.
- **Table states**: free (`table-free`, pale green), seated (`table-seated`, strong blue), bill
  asked (`table-bill`, purple), reserved (`table-reserved`, pale amber), and a calm fill
  (`table-calm`) for the floor map. Each has its own text colour in the token file.
- **The palette family**: named colours (red to grey) that staff pick for calendar entries, and,
  for each but grey, a pale fill and a strong dot for prep stations, all with tuned dark versions.
  They live only in `colors.css`; never use them as decoration.
- **Highlight** (`highlight`): a soft yellow that marks found text in the guide and a highlighted
  cell in a grid.

### Named Rules

**The One Teal Rule.** Waitron Teal marks the thing to do or the place you are, and nothing else.
A screen with several teal-filled buttons has lost its one signal.

**The Colour Means Something Rule.** Never use a status colour (danger, success, warning or a
table state) as decoration: a status colour used for decoration teaches staff to ignore it.

**The Paired Colour Rule.** The accent, status, table-state and calendar palette fills each come
with their own text colour in the token file (`on-*`). Prep-station fills take ordinary body text,
and a colour that is data, such as a lozenge's category colour, takes black or white text,
whichever reads better.

## Typography

**Body Font:** the device's system font (`system-ui`, then `-apple-system`, `Segoe UI`,
sans-serif), unless a venue's Appearance picks serif (`ui-serif`, then Georgia, Times New Roman)
**Mono Font:** `ui-monospace`, then SF Mono, Menlo, Consolas

**Character:** One familiar typeface, by default the one the device already uses, so screens feel
native and read at once. Hierarchy comes from four sizes and three weights.

### Hierarchy

- **Title** (600, 1.375rem): a page's own heading.
- **Headline** (600, 1.125rem): dialog headings, setup's section headings, large till buttons and
  a table token's name.
- **Body** (400, 0.875rem): running text on the dashboard. A field value's weight follows the
  contract's "Typography roles" table.
- **Control** (400, at least 1rem): text inside inputs, so phones do not zoom on focus.
- **Label** (600, 0.75rem, uppercase with 0.04em spacing for group labels): group labels and
  navigation group headers; field labels use the same size at normal weight in muted ink.

Waitron's own weights are 400 (normal), 500 (medium) and 600 (bold), and the sizes above are its
own. A venue's Appearance can set each of the four sizes and each of the three weights (from 400
to 800) itself, and its text-size setting scales all of it.

### Named Rules

**The Label Versus Section Rule.** A group label is small, bold, uppercase and muted; a field label
is small, normal weight and muted. That difference is the only signal separating a section from a
field, so keep it exact.

## Layout

Spacing runs on a six-step scale (4, 8, 12, 16, 24 and 32 pixels). On a settings or detail page:
32 between the page title and the first group, 24 between sections, 8 between a group label and
its card, and 12 by 16 padding inside a card's rows.

- **Dashboard:** a full-width banner with the venue's logo and legal name, a sidebar of navigation
  on the left, and content anchored to the left edge. Narrow forms keep a maximum width but are
  never centred beside the sidebar. At 48rem and below the sidebar becomes a drawer, the banner
  takes two rows, and the page frame drops away to give tables room.
- **Till:** the screens a device offers come from its device profile. The profile's kind (till,
  handheld or prep display) sets the built-in screens; the profile can add others, such as
  Stations, Pass and My schedule, and can make one of those three open first. At 40rem and below
  the till's choosers switch to a phone layout. The till keeps its page and dialogs clear of a
  device's on-screen keyboard.
- **Dialogs** come in three widths: compact (28rem) for a confirmation, standard (42rem) for an
  ordinary editor, and wide (64rem). Fields inside stop at 36rem. On a phone the side margins
  shrink smoothly rather than at a breakpoint.
- A form's actions sit in a row along its bottom, the main action last at the right;
  `wt-form-actions` keeps a slot at the left for Cancel.

## Elevation & Depth

Today the system is mostly flat. Hairline borders and the step from page grey to white surface do
most of the separating; raised cards and switches carry a faint shadow, and dialogs, menus,
dropdowns, tooltips and toasts carry a real one. The owner has chosen to allow more depth than
this: future work may use shadows more freely to lift cards and buttons. Start from the two shadows
below, and add a token rather than an inline value when a new step is needed.

### Shadow Vocabulary

- **Shadow 1** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.08)`): a raised card, a switch, a selected
  calendar entry, the till's ticket, and the dashboard's sidebar, the panel its folded strip of
  icons opens, and its phone drawer.
- **Shadow 2** (`box-shadow: 0 8px 24px rgb(0 0 0 / 0.16)`): dialogs, popover menus, dropdown
  lists, tooltips, toasts, a row being dragged.
- **Scrim** (`rgb(0 0 0 / 0.4)`): the dimming behind a modal.

## Shapes

Gently rounded throughout. Small details such as dashed badges use 4px corners; buttons, fields,
table tokens and list rows use 8px; cards and dialogs use 16px; lozenges, round icon buttons and
status dots are fully rounded. The filled field box rounds only its top corners and runs a straight
line along its bottom. A table token carries a coloured left edge that names its state; under
reduced motion, when nothing pulses, a forgotten table's edge widens instead.

## Components

Calm at rest, clear on touch: controls stay plain until they matter, and the one action that must
be found is solid teal from the start.

### Buttons

- **Shape:** gently rounded (8px), at least 44 by 44 pixels at the default size; a large size
  (about 62 pixels tall) for till actions; the small size is 32 pixels tall, below the tap target.
- **Primary:** Waitron Teal fill, white bold text, 8 by 16 padding. Used for the one main action.
- **Secondary (the default):** white surface, ink text, hairline border; the border turns teal on
  hover.
- **Danger:** red fill for a destructive action.
- **Ghost and link:** no fill; link is teal, underlined and normal weight.
- **Disabled:** primary and danger switch to their own pale disabled colours; others fade to half.
- **Loading:** the label stays and a small spinner leads it; the button ignores presses but keeps
  focus.
- **Card actions** on the dashboard stay secondary at rest and take a teal or red accent only on
  hover, with a fixed minimum width so a row of them reads as one set.

### Cards / Containers

- **Corner Style:** 16px.
- **Background:** the surface colour; a raised card takes the raised surface, which is lighter
  than the plain surface on dark screens.
- **Shadow Strategy:** none at rest; Shadow 1 when raised.
- **Border:** one hairline.
- **Internal Padding:** 16px. Rows divide with a hairline only when a row carries its own action.
- **Headings:** the contract's rule for fields grouped into cards puts a small group label above
  the card, but no screen does that yet; the Venue settings cards put their heading inside the
  card.

### Inputs / Fields

- **Style:** a filled box (`field-fill`), 56px tall, top corners rounded, a 1px `field-line` along
  the bottom and no other border. The label rests in the middle while the field is empty, then
  floats small at the top left.
- **Focus:** the bottom line thickens to 2px of Waitron Teal and the label turns teal; no separate
  focus ring.
- **Error:** a red bottom line and the error under the field; one short message above the form's
  buttons.
- **Placeholder and hints:** muted ink, italic.

### Navigation

- **Dashboard sidebar:** flat text rows in muted ink on the page grey; hover brings full ink and a
  white surface. The current page is bold teal text with a teal leading edge and no fill. Group
  headers are small, uppercase and teal, each a collapsible toggle; a search box sits on top.
- **Tabs:** the selected tab carries a teal underline, the same idea as the sidebar's edge.
- **Banner:** full width, the venue's logo (or the Waitron lockup) and the legal name on the left,
  the account menu at the right once signed in.

### Lozenges

Fully rounded pills, 12px side padding, small text, for short labels such as "Archived". A plain
lozenge sits on white with a hairline, in normal weight. Given a category colour it fills with that
colour, in bold, with black or white text, though no screen passes it one yet. Counts use
`wt-count-badge`, not a lozenge.

### Table Token (signature)

The till's picture of one table: a white rounded card with a left edge in its state's colour, the
table name at headline size, the covers in small muted text, an open tab's total in bold, and small
marks for a forgotten table, an unsent order or a course due to fire. Urgent states pulse: slowly
(two seconds) for overdue or time to fire, quickly (one second) for forgotten.

### Motion

Motion is functional only: a notice fades out over 400ms, a dragged row slides to its new place in
150ms, a disclosure opens over 900ms, and urgency pulses at the two speeds above.

## Do's and Don'ts

### Do:

- **Do** read every colour, space, radius and font size from a `--wt-*` token; add a token when one
  is missing.
- **Do** keep Waitron Teal for the one action, the current place and focus.
- **Do** give every tappable thing at least 44 by 44 pixels, apart from the exceptions the
  contract lists under `--wt-tap-min`.
- **Do** check a new screen in both themes and at phone width, by looking at it.
- **Do** fix a look problem in the shared `wt-*` component, for every screen that uses it.
- **Do** let the venue's logo, brand colour and text size show through; draw brand-coloured text
  with the primary-text token, not the fill token.

### Don't:

- **Don't** use hex values, named colours, `rem` or `em` in a component's styles; this file's hex
  values are for reading, not copying.
- **Don't** use a status colour as decoration.
- **Don't** fill every card action solid teal on the dashboard; colour there comes on hover.
- **Don't** centre a narrow form beside the sidebar; anchor it to the left like the table screens.
- **Don't** put text on a coloured fill without that fill's own text colour.
- **Don't** draw a form field by hand; use the field primitives.
