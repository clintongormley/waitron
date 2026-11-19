# The new Waitron brand on every screen — design

Status: approved. The owner answered "go" in conversation on 2026-11-19, as the session that wrote this
spec recorded in its ledger. The owner chose the colour roles (option 2 of three
mock-ups), approach B and keeping seated tables blue, in conversation on 2026-11-19.

## Why

Waitron has a new logo and colours from a designer. The owner wants them used instead of the current
look: the blue `#1F6FEB` and the cloche logo beside a lower-case "waitron".

## What the designer delivered

The files are in `~/Downloads/wetransfer_waitrion-grey-svg_2026-11-18_1157/`:

| File                       | What it is                                                            |
| -------------------------- | --------------------------------------------------------------------- |
| `Waitron Line.svg`         | The horizontal logo: the W mark beside the spaced capitals "WAITRON". |
| `Waitron Colour.svg`       | The stacked logo: the W above the word.                               |
| `Waitron IconCol.svg`      | The W mark alone, in colour.                                          |
| `WaitronType.svg`          | The word alone.                                                       |
| `… Grey`, `Waitron Icon`   | Greyscale versions of the same.                                       |
| `Waitron Colour codes.pdf` | The colour guide.                                                     |

The W is three pieces: a near-black left stroke, a light sky-blue middle and a dark teal right
stroke. The colours, as the guide states them:

| Name           | RGB           | Hex       | Pantone |
| -------------- | ------------- | --------- | ------- |
| Near-black     | 35, 31, 32    | `#231F20` | Black   |
| Dark teal      | 0, 115, 146   | `#007392` | 314     |
| Light sky blue | 113, 207, 235 | `#71CFEB` | 305     |
| Grey 70%       | —             | `#6D6E71` | —       |
| Grey 30%       | —             | `#BCBEC0` | —       |

The SVG files use slightly different hex values for the two blues from file to file (for example
`#0C7291`, `#107391`). **Use the guide's values everywhere**, and repaint the SVGs with them. The
SVGs are drawn on an A4 page (`viewBox="0 0 595.3 841.9"`), so each needs cutting to a tight box
around the drawing.

## Goals

- Every screen Waitron draws itself uses the new colours by default: the dashboard, the till, the
    setup pages, and the pages the server builds as text (the certificate page, the connection page,
    the guide page, and every venue's public guest menu, whose links and headings use the guide
    page's colours unless the menu uses a paper design).
- The new logo replaces the cloche everywhere the Waitron logo appears, and the W replaces the
    cloche in the favicons and home-screen icons.
- A venue that has chosen its own brand colour keeps its brand colour and everything worked out from
    it. Its text and muted-text colours do change, slightly, because venues' colours start from
    Waitron's own (`apps/server/src/venue-theme.ts`). Measured by the builder check: a venue with a
    red brand colour moves from `#16181d` to `#231f20` (text) and `#5c626e` to `#626366` (muted).
    Claude's call: accepted, since no venue is live and keeping the old values for venues would need
    a second set of starting colours.

## Non-goals

- The stacked logo, the word-only file and the greyscale versions are not used yet. Nothing in the
    product needs them today.
- The calendar colours, prep-station colours and every table-state colour, "seated" included, stay
    as they are. They are their own palette, not the brand.
- No second brand colour for venues. A venue still picks one colour.

## Anti-goals

- The W's two blues must never be repainted, in either mode or on any venue's screens. It is a brand
    mark. (Its near-black pieces follow the text colour so they stay readable; see The logo.)
- No pairing of text and background may become harder to read than the checks venues' colours
    already pass.

## The colour roles (the owner chose this from three mock-ups)

**Light mode uses the dark teal as the brand colour; dark mode uses the light sky blue.** The sky
blue is too pale to read on white (about 1.7 to 1), so in light mode it never appears as text, an
icon or a focus outline. On a dark background it is very readable (about 10 to 1). The teal has
about 5.4 to 1 against white, enough for white text on a teal button.

Also in both modes' starting points:

- Light-mode text becomes the logo's near-black `#231F20` (now `#16181D`).
- Light-mode muted text becomes `#626366`, a shade darker than the brand's 70% grey (now `#5C626E`).
    The builder check ran the engine: `#6d6e71` itself is too faint on the new `surface-lifted` and
    on all 15 prep-station fills, and the engine's own fix is `#626366`, with no warnings left.
- Dark-mode text, backgrounds and surfaces stay as they are.

What the engine works out from those inputs (the builder check's run; the builder re-runs it and
uses its own output):

| Token                                                   | Light     | Dark      |
| ------------------------------------------------------- | --------- | --------- |
| `primary`, `primary-text`, `focus`, `field-label-focus` | `#007392` | `#71cfeb` |
| `primary-hover`                                         | `#09607a` | `#8ae2fd` |
| `on-primary`                                            | `#ffffff` | `#001016` |
| `primary-disabled`                                      | `#7acae9` | (engine)  |
| `surface-lifted`                                        | `#d2effb` | `#1e3d46` |
| `stepper-button`                                        | `#ddf5ff` | `#102a32` |

## How the full set of colours is chosen (the owner chose approach B)

**Approaches considered:**

- **A. Pick every shade by hand**, as the current `colors.css` was made. Most control, but every
    pairing is checked one by one, and Waitron's own look can drift from what a venue gets choosing
    the same colours.
- **B. Let the venue-colour engine work them out (chosen).** The engine in
    `packages/ui-core/src/theme/` already works out the whole colour set (hover, disabled, selected,
    field outline, focus outline and the rest) from one brand colour, and checks every pairing for
    readability. Give it the teal for light mode and the sky blue for dark mode, keep its output as
    Waitron's own colours, then hand-set only the text and muted-text colours above.

The engine supports a different brand colour per mode: a hand-set `primary` for one mode becomes
that mode's brand colour (`deriveAt` in `derive.ts` reads `fixed[PRIMARY] ?? chosen`). So the input
is, in effect:

```ts
{ brandColor: "#007392", handSet: { light: { text: "#231f20", "text-muted": "#6d6e71" },
                                    dark: { primary: "#71cfeb" } }, background: "neutral" }
```

The builder runs that once, against today's defaults, and writes the result into
`packages/ui-core/src/tokens/colors.css`: the plain block, the `prefers-color-scheme: dark` block,
and the two forced `[data-theme="light"]` / `[data-theme="dark"]` blocks, which must agree with the
first two. The script used to produce the values is a one-off and is not committed; the PR says the
command that was run.

**Table states keep today's blue** (the owner, 2026-11-19, in conversation). The builder check
measured the teal as almost as dark as the green of a "ready" table, close enough in hue that staff
could confuse "seated" and "ready" at a glance. A table's state is a working signal, not branding.
So these stay exactly as they are, in both modes: `--wt-color-table-seated`,
`--wt-color-on-table-seated`, `--wt-color-table-calm`, `--wt-color-on-table-calm`,
`--wt-color-table-calm-edge` and `--wt-color-tab-seated-tint`.

**Any other token outside the engine's set** whose value is plainly a tint of `#1F6FEB` / `#4C8DFF`
and is not a table state is chosen by hand from the two blues, matching how the engine treated
`surface-lifted` and `stepper-button`. The builder lists each one in the PR. Each must pass the
rules in `packages/ui-core/src/theme/contrast-rules.ts` that name it.

## The logo

**On screens:** the horizontal logo (`Waitron Line.svg`) is the Waitron logo, with the spacing the
designer drew between the W and the word kept as drawn. It replaces the generated lockup.

**How it is painted** (this is Claude's call; the owner may overrule it):

- The teal and sky-blue pieces of the W are **fixed** in every mode and on every venue's screens.
- The near-black pieces (the W's left stroke and the word) follow `--wt-color-text`, so they turn
    light on dark screens and stay readable even where a venue has set its own text colour.
- The fixed teal against today's dark backgrounds, measured by the builder check: `bg` 3.45,
    `surface` 3.14, `surface-raised` 2.79, the new `surface-lifted` 2.14 (a graphic needs 3 to 1).
    The designer's teal is kept as is (Claude's call). The builder lists each place the logo sits in
    dark mode (the dashboard banner, the setup header, the Powered by line, the Look card preview)
    with the background it sits on and the measured contrast, and brings any place under 3 to 1 to
    the owner before changing anything.
- So `wt-waitron-lockup` stops painting anything from `--wt-color-primary`. It now paints by piece,
    not "first group, last group"; the builder decides how the pieces are marked in the source (for
    example a class per colour), and updates `WORD_BASELINE` for the new word.

**Icons:** the W alone (`Waitron IconCol.svg`) replaces the cloche in `waitron-mark.svg`, the SVG
and `.ico` favicons, `apple-touch-icon.png`, and the till's `icon-192.png` / `icon-512.png`. The
opaque icons keep their white ground.

**The favicon stops following the page's colours** (Claude's call): the blues are fixed, so
`startThemedFavicon` (`packages/ui/src/themed-favicon.ts`) and its three callers in
`apps/{dashboard,setup,till}/src/main.ts` are removed. The SVG favicon keeps a
`prefers-color-scheme` rule that turns its near-black stroke light, because a browser tab is drawn
in the browser's own light or dark, not the page's.

**Regeneration:** `packages/ui/brand/build-icons.mjs` is changed to take the designer's lockup and
mark as its sources, instead of assembling the lockup from a mark and a wordmark. Inkscape is
installed at `/opt/homebrew/bin/inkscape`. `packages/ui/brand/README.md` is rewritten to match. The
old cloche files are deleted.

## Other copies to update

Each holds its own copy of colours or of the logo, because the page is built as text with nothing to
fetch:

- `apps/server/src/html-page-tokens.ts` (guide page; `scripts/guide-page-tokens.test.ts` compares it
    with `colors.css`)
- `apps/server/src/connection-bootstrap-page.ts`
- `apps/server/src/trust-page.ts` (its button, muted text, and its links and focus outline, which
    are a separate hand-kept blue today and become `--wt-color-primary-text`'s values — Claude's
    call, so the page does not show a teal button beside blue links) and
    `apps/server/src/trust-page-logo.ts` (the whole logo, shown on the certificate page and the
    connection page; `scripts/trust-page-logo.test.ts` compares the drawing)
- `apps/till/vite.config.ts` reads the light primary for the till's `theme-color` and manifest;
    check it picks up the teal.

## Tests and documents that name the old look

About fifty files name `#1f6feb` or the cloche (`git grep -l -i "1f6feb\|cloche"`). Old plans and
specs among them record what was true when written and stay as they are. The rest are two kinds:

- **Tests that compare a colour with what the tokens file says** — update the expected value.
- **The engine's reference fixtures**
    (`packages/ui-core/src/theme/__fixtures__/reference-cases.json` and
    `reference-palette-cases.json`): these record what the engine works out for given venue choices.
    Their expected answers came from a separate prototype outside the repo, so the test checks the
    engine against something independent of it. The builder check found all 56 cases change under
    the new defaults, and 3 change their warnings. **Do not regenerate them** (Claude's call):
    `reference-cases.test.ts` instead passes a frozen copy of today's colours in place of
    `WAITRON_DEFAULTS`, kept beside the fixtures as JSON (a `.css` copy would let a root guard
    accept any colour name it declares), so no fixture line changes and the test stays independent.
    The new colours themselves are held to every readability rule by "Waitron's own palette passes
    every rule" in `packages/ui-core/src/theme/contrast-rules.test.ts`.

Tests that check the logo is painted from `--wt-color-primary` now check the opposite: the blues
stay fixed when a venue's colour or the theme changes, and the near-black pieces follow the text
colour.

Documents: `docs/developers/design-system.md` (the lockup's description and its painting, around its
"Primitives" table and the graphics paragraph) and `packages/ui/brand/README.md`. No user guide
mentions the cloche (checked with `git grep -l -i cloche -- '*.md'`). The guides call Waitron's
colour and the till's information line "blue"; that stays true of both the teal and the sky blue, so
they are not changed.

**The logo's size** (Claude's call): the new logo is about 8:1 wide to tall, against 5.85:1 today.
Each place keeps the height the logo has today and lets it grow wider, so it reads as large as
before. A place that no longer fits at phone width keeps its width instead, and the owner sees the
screenshots.

## Checking it looks right

Open the dashboard, the till and the setup page in both themes and at phone width
(`wa-wt demo <worktree>`), and the server's text-built pages written out to a file and opened in
Chromium. Screenshots go to the owner directly, never committed.

## Left to the builder

- How the logo's pieces are marked in the SVG for painting.
- The exact hand-picked shades for the tokens outside the engine's set.
- How `build-icons.mjs` is reshaped, as long as one command still regenerates every derived file.
