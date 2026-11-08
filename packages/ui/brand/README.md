# Brand assets

The mark is a cloche: a serving dome with a knob and a highlight cut out of it, on a plate. The
wordmark is "waitron" in lower case, set in Outfit Medium (SIL Open Font License) at -0.03em and
drawn as outlines, so nothing loads a font. The lockup is the two together, side by side.

## Sources and derived files

You edit the two source drawings by hand. `build-icons.mjs` writes the derived files from those
drawings and the dark colour tokens. The derived files are committed, so run the command whenever
you change a source drawing or a dark token. Two things are kept by hand outside the drawings:
`WORD_BASELINE` in `packages/ui/src/components/wt-waitron-lockup.ts`, where the word's letters sit,
which changes when the wordmark is redrawn; and the certificate page's copy of the lockup (below),
which changes when either drawing is.

| File                          | Kind    | Read by                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `waitron-mark.svg`            | source  | The cloche alone, fixed blue, transparent, tight viewBox. Use for anything that is not a favicon.                                                                                                                                                                                                             |
| `waitron-wordmark.svg`        | source  | The word alone, ink, cut to the mark's height: its viewBox is `0 0 <width> <the mark's height>`, and the generator refuses any other.                                                                                                                                                                         |
| `waitron-lockup.svg`          | derived | The mark, a gap, then the word, both unscaled. The logo. `wt-waitron-lockup` draws it inline.                                                                                                                                                                                                                 |
| `waitron-lockup-dark.svg`     | derived | The lockup in the dark theme's colours, for an `<img>` on a dark ground (addresses in `packages/ui/src/waitron-lockup.ts`; outside tests, only the UI demo reads it).                                                                                                                                         |
| `public/favicon.svg`          | derived | Chrome, Edge, Firefox, Safari 26+. Carries a `prefers-color-scheme` rule; the rasters below cannot. Once a page starts, `startThemedFavicon` (`packages/ui/src/themed-favicon.ts`) replaces it with a copy painted in the page's `--wt-color-primary`, so it follows the Theme setting and a venue's colours. |
| `public/favicon.ico`          | derived | Safari below 26, and a browser's implicit `/favicon.ico` request. 16, 32 and 48 as embedded PNGs.                                                                                                                                                                                                             |
| `public/apple-touch-icon.png` | derived | iOS and iPadOS home screens. 180x180, and deliberately **opaque** — see below.                                                                                                                                                                                                                                |
| `png/waitron-lockup.png`      | derived | The lockup in the light colours, 1200 px wide, transparent: for places that cannot draw an SVG or read the theme.                                                                                                                                                                                             |
| `png/waitron-lockup-dark.png` | derived | The same in the dark theme's colours, for a dark ground.                                                                                                                                                                                                                                                      |
| `png/waitron-mark.png`        | derived | The cloche alone in the light blue, 512 px wide, transparent.                                                                                                                                                                                                                                                 |

`public/` is what the apps serve: `apps/{till,dashboard,setup}/vite.config.ts` each point `publicDir`
at it, so there is one copy rather than three. Vite prefixes the URLs with each app's `base` at build
time — verified by building all three: the dashboard emits `/manage/favicon.ico`, till and setup
`/favicon.ico`. `scripts/brand-icons.test.ts` (root project, so it runs on every non-docs push) fails
if an app links to a file this directory does not hold, or points its `publicDir` somewhere else.

Standalone SVGs carry literal colours because an `<img>` cannot read the page's CSS custom
properties. The screens do not use them as images: `wt-waitron-lockup`
(`packages/ui/src/components/wt-waitron-lockup.ts`) imports `waitron-lockup.svg` through a `?raw`
import and repaints its first top-level group with `--wt-color-primary` and its last with
`--wt-color-text`, so the dashboard's banner, `wt-powered-by`, the Look card preview and the setup
wizard's header follow light, dark and a venue's own colours. When you change a dark token in `packages/ui-core/src/tokens/colors.css`, re-run the
generator: it reads `--wt-color-primary` and `--wt-color-text` from that file's
`@media (prefers-color-scheme: dark)` block for the dark lockup and the favicon's dark rule.
It expects six-digit hex values and an unindented closing brace for that block; a missing block or
token stops generation before any output is written. Explicit `data-theme` blocks and deployment
overrides are not read. `scripts/brand-build.test.ts` runs the generator in scratch copies with
changed and missing tokens; its raster renderer is a stub, so it checks SVG generation, not PNG paint.

The light source SVGs still carry `#1f6feb` and `#16181d`; keep these in step with the light
tokens by hand. `apps/server/src/trust-page-logo.ts` holds a copy of the whole lockup for the certificate page,
which must stay one self-contained string with nothing to fetch. `scripts/trust-page-logo.test.ts`
compares the two DRAWINGS and deliberately ignores paint, so it will not catch a colour that drifts.
`scripts/brand-icons.test.ts` does check both lockups' two colours against `colors.css`, weaker than
that sounds: it reads the file as text, takes each light value from the file's first declaration
and each dark value from the `@media (prefers-color-scheme: dark)` block, so a `[data-theme]` block
that disagrees with either is not seen, and it checks neither the favicon nor the certificate page's
copy.

`wt-waitron-lockup` paints by position, so it relies on the order `build-icons.mjs` writes the groups
in, cloche first. The
paint cases in `apps/setup/src/setup-app.test.ts` find each group by the ink this file gives it, so a
reordered file fails them.

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

One case the `.ico` does not cover. A box that mounts **only** the dashboard serves
`/manage/favicon.ico` but answers 404 for the root `/favicon.ico`, because nothing is mounted there.
Run, not reasoned: booting the server's routes with only the dashboard dir configured and issuing
both requests returned `200 image/x-icon` and `404` respectively. The explicit `<link>` still resolves, so the dashboard's own tab is fine; it is a
browser's implicit root request that misses. A normal box mounts the till at the root, which serves
it.

## Regenerating

```sh
node packages/ui/brand/build-icons.mjs
```

Run this by hand: Inkscape is not a workspace dependency. The root tests use a stub raster renderer,
so they do not replace regeneration with real Inkscape. Set `INKSCAPE` if the binary is not on PATH.
The command prints what it wrote and which Inkscape it used.
