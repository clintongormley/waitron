# Brand assets

The mark is a running waiter carrying a covered tray. The wordmark is WAiTRON, upright, whose only
three diagonals are the W's second and fourth arms and the A's left arm, with the T's bar running the
full width of the word above the other letters. The lockup is the two together.

## Sources and derived files

Only the two sources are edited by hand. Everything else is written by `build-icons.mjs` from them,
so the geometry exists in exactly one place per drawing and redrawing the mark is one edit plus one
command. The derived files are committed and nothing checks them against their source, so skipping
the command leaves stale derivatives behind a green gate — run it whenever you touch a source.

| File                          | Kind    | Read by                                                                                             |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `waitron-mark.svg`            | source  | The waiter alone, fixed blue, transparent, tight viewBox. Use for anything that is not a favicon.   |
| `waitron-wordmark.svg`        | source  | The word alone, ink.                                                                                |
| `waitron-lockup.svg`          | derived | Mark at the word's cap height, then the word. The logo.                                             |
| `waitron-lockup-dark.svg`     | derived | The lockup in the dark theme's colours, for an `<img>` on a dark ground (the dashboard's banner).   |
| `public/favicon.svg`          | derived | Chrome, Edge, Firefox, Safari 26+. Carries a `prefers-color-scheme` rule; the rasters below cannot. |
| `public/favicon.ico`          | derived | Safari below 26, and a browser's implicit `/favicon.ico` request. 16, 32 and 48 as embedded PNGs.   |
| `public/apple-touch-icon.png` | derived | iOS and iPadOS home screens. 180x180, and deliberately **opaque** — see below.                      |

`public/` is what the apps serve: `apps/{till,dashboard,setup}/vite.config.ts` each point `publicDir`
at it, so there is one copy rather than three. Vite prefixes the URLs with each app's `base` at build
time — verified by building all three: the dashboard emits `/manage/favicon.ico`, till and setup
`/favicon.ico`. `scripts/brand-icons.test.ts` (root project, so it runs on every non-docs push) fails
if an app links to a file this directory does not hold, or points its `publicDir` somewhere else.

Four token values are inlined and **kept in step by hand**: `#1f6feb` and `#4c8dff` are
`--wt-color-primary` light and dark, and `#16181d` / `#eceef2` are `--wt-color-text` light and dark,
all declared in `packages/ui-core/src/tokens/colors.css`. A standalone SVG cannot read a CSS custom
property, so the usual rule against inlining a token value does not reach here; change a token and
change these with it.

**They are inlined in three places.** The two source SVGs here carry `#1f6feb` and `#16181d`;
`build-icons.mjs` carries `#4c8dff` and `#eceef2`, for the favicon's dark rule and the dark lockup;
and `apps/server/src/trust-page-logo.ts` holds a copy of the whole lockup for the certificate page,
which must stay one self-contained string with nothing to fetch. `scripts/trust-page-logo.test.ts`
compares the two DRAWINGS and deliberately ignores paint, so it will not catch a colour that drifts.
`scripts/brand-icons.test.ts` does check the dark lockup's two colours against `colors.css`, weaker
than that sounds: it reads the file as text, from the `prefers-color-scheme: dark` block alone, and
checks neither the favicon nor the certificate page's copy.

The setup wizard (`apps/setup/src/setup-app.ts`) also draws the lockup inline, but copies nothing:
it imports `waitron-lockup.svg` as-is through a `?raw` import and repaints its two top-level groups
by position — the first `<g>` (the waiter) with `--wt-color-primary`, the last (the word) with
`--wt-color-text`. That is the order `build-icons.mjs` writes them in, so the wizard depends on it
staying that way; the paint cases in `apps/setup/src/setup-app.test.ts` find each group by the ink
this file gives it, so a reordered file fails them. The dashboard's sign-in card
(`apps/dashboard/src/screens/login-screen.ts`) imports and repaints the lockup the same way, so it
depends on that order too; its paint cases in `apps/dashboard/src/screens/login-screen.test.ts` find
the groups by ink in the same way.

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

Hand-run, not a build step — Inkscape is not a workspace dependency, so nothing in CI or the pre-push
hook can call it. Set `INKSCAPE` if the binary is not on PATH. It prints what it wrote and which
Inkscape it used.

Re-running it twice over on one machine, with Inkscape 1.4.4 (dcaf3e7), reproduced all four derived
files byte for byte. That is the whole experiment: it is not a claim about other Inkscape builds,
which may well render differently.

## If the mark is redrawn

The hand-drawn Inkscape export draws the cloche as a **full circle with its lower half hidden under a
white rectangle**. That works on a white page and nowhere else: reversed out, the rectangle shows as
a white box across the tray and the dome reads as a whole circle floating above it. In
`waitron-mark.svg` it is a real clipped arc instead — same centre, same radius, cut at the same line
— and because the cut sits below the circle's centre the arc subtends more than 180 degrees, so it
needs `large-arc-flag` set. Reapply that whenever a new export comes in, then re-run the generator.
