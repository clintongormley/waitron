# Brand assets

The logo is the designer's W beside the word "WAITRON" in spaced capitals. The W is three pieces: a
near-black left stroke, a sky-blue middle (`#71cfeb`) and a teal right stroke (`#007392`). The word
is near-black (`#231f20`). Everything is drawn as outlines, so nothing loads a font.

## Sources and derived files

The two source drawings are kept by hand, cut from the designer's `Waitron Line.svg` and
`Waitron IconCol.svg` to a tight `viewBox` around the drawing (the origin is not `0 0`). Each holds,
in this order: `<g class="ink" fill="#231f20">` with every near-black piece, one element
`class="sky" fill="#71cfeb"` and one element `class="teal" fill="#007392"`. No other fills, no
`<style>`, no `id`s. `wt-waitron-lockup` (`packages/ui/src/components/wt-waitron-lockup.ts`) finds
the pieces by those class names.

`build-icons.mjs` writes the derived files from the two sources and one dark colour token. The
derived files are committed, so run it whenever you change a source drawing or that token.

| File                          | Kind    | What it is                                                                                                                                                                           |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `waitron-lockup.svg`          | source  | The logo: the W and the word. `wt-waitron-lockup` draws it inline.                                                                                                                   |
| `waitron-mark.svg`            | source  | The W alone. Use for anything that is not a favicon.                                                                                                                                 |
| `waitron-lockup-dark.svg`     | derived | The logo with the ink in the dark theme's text colour, for an `<img>` on a dark ground (addresses in `packages/ui/src/waitron-lockup.ts`; outside tests, only the UI demo reads it). |
| `public/favicon.svg`          | derived | Chrome, Edge, Firefox, Safari 26+. The W on a square, with a `prefers-color-scheme` rule that turns the ink light; the rasters below cannot.                                         |
| `public/favicon.ico`          | derived | Safari below 26, and a browser's implicit `/favicon.ico` request. 16, 32 and 48 as embedded PNGs, transparent.                                                                       |
| `public/apple-touch-icon.png` | derived | iOS and iPadOS home screens. 180x180, and deliberately **opaque** — see below.                                                                                                       |
| `public/icon-192.png`         | derived | The till's web app manifest icon (`apps/till/src/manifest.ts`), 192x192. Opaque, drawn on the same white ground as `apple-touch-icon.png`.                                           |
| `public/icon-512.png`         | derived | The till's web app manifest icon (`apps/till/src/manifest.ts`), 512x512. Opaque, drawn on the same white ground as `apple-touch-icon.png`.                                           |
| `png/waitron-lockup.png`      | derived | The logo in the light colours, 1200 px wide, transparent: for places that cannot draw an SVG or read the theme.                                                                      |
| `png/waitron-lockup-dark.png` | derived | The same with the dark ink, for a dark ground.                                                                                                                                       |
| `png/waitron-mark.png`        | derived | The W alone in the light colours, 512 px wide, transparent.                                                                                                                          |

`public/` is what the apps serve: `apps/{till,dashboard,setup}/vite.config.ts` each point `publicDir`
at it, so there is one copy rather than three. Vite prefixes the URLs with each app's `base` at build
time: the dashboard emits `/favicon.ico`, the till `/till/favicon.ico`, and the setup
build keeps its relative `./favicon.ico`. `scripts/brand-icons.test.ts` (root project, so it runs on every non-docs push) fails
if an app links to a file this directory does not hold, or points its `publicDir` somewhere else.

## Colours

The W's sky blue and teal are fixed: the same in light and dark, on every venue's screens, and
never painted from a token. Only the ink changes. Standalone SVGs carry literal colours because an
`<img>` cannot read the page's CSS custom properties; on screens, `wt-waitron-lockup` paints the
ink with `--wt-color-text`.

The generator reads one value: `--wt-color-text` from the `@media (prefers-color-scheme: dark)`
block of `packages/ui-core/src/tokens/colors.css`, for the dark lockup's ink and the favicon's dark
rule. It expects a six-digit hex value and an unindented closing brace for that block; a missing
block or token stops generation before any output is written. Explicit `data-theme` blocks and
deployment overrides are not read. `scripts/brand-build.test.ts` runs the generator in scratch
copies with changed and missing tokens; its raster renderer is a stub, so it checks SVG generation,
not PNG paint.

The sources' ink, `#231f20`, is the light `--wt-color-text`; keep the two in step by hand.
`scripts/brand-icons.test.ts` checks the two lockups' ink against `colors.css` and the three SVGs'
blues against the fixed values, weaker than that sounds: it reads the files as text, takes the
light value from the file's first declaration and the dark value from the
`@media (prefers-color-scheme: dark)` block, so a `[data-theme]` block that disagrees with either is
not seen, and it checks neither the favicon's paint nor the server pages' copy.

`apps/server/src/trust-page-logo.ts` holds a copy of the whole logo for the certificate page and
the connection page, which must stay one self-contained string with nothing to fetch; its own
`<style>` turns the ink light in dark mode, and the blues stay literal.
`scripts/trust-page-logo.test.ts` compares the two DRAWINGS and deliberately ignores paint, so it
will not catch a colour that drifts.

## Why an .ico and a PNG as well as the SVG

Two independent reasons, neither of which SVG solves:

- Safari read no SVG favicon before version 26. [caniuse: link-icon-svg](https://caniuse.com/link-icon-svg)
  records Safari and iOS Safari as _"3.1 - 18.7: Not supported"_ and _"26.0: Supported"_. Anything
  older falls back to the `.ico`.
- `apple-touch-icon` has always been PNG only, regardless of Safari version.

`apple-touch-icon.png` is opaque rather than transparent because iOS fills an icon's transparent
pixels with black. Apple's own forum puts it as _"You can't have transparent icons, so the system
uses black"_ ([thread 713895](https://developer.apple.com/forums/thread/713895)); realfavicongenerator
as _"iOS forbids transparent icons ... it fills the gaps with black"_
([apple touch icon turns black](https://realfavicongenerator.net/blog/apple-touch-icon-turns-black)).
That it is in fact opaque was checked rather than assumed: decoding the PNG gives alpha 255 for all
32,400 pixels.

## Regenerating

```sh
node packages/ui/brand/build-icons.mjs
```

Run this by hand: Inkscape is not a workspace dependency. The root tests use a stub raster renderer,
so they do not replace regeneration with real Inkscape. Set `INKSCAPE` if the binary is not on PATH.
The command prints what it wrote and which Inkscape it used.
