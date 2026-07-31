# Design system

Every screen in this project is built from `wt-*` primitives styled by `--wt-*` tokens.
This document is the contract. If you are building a view, read this first.

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

If a token you need does not exist, add it to the token layer — do not inline a value.

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
`packages/ui/src/tokens/multi-root.test.ts` pins down with an assertion: two roots mounted at once,
each still reporting its own resolved `--wt-color-bg`.

## Themes

Light and dark ship by default. Selection order:

1. `prefers-color-scheme` — the default, read from the OS/browser.
2. `data-theme="light" | "dark"` on the theme root — always wins, in both directions.

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
`packages/ui/src/tokens/structure.test.ts`'s `deployment rules override the token layer's defaults
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

`--wt-color-bg`, `--wt-color-surface`, `--wt-color-surface-raised`, `--wt-color-text`,
`--wt-color-text-muted`, `--wt-color-primary`, `--wt-color-on-primary`, `--wt-color-danger`,
`--wt-color-on-danger`, `--wt-color-success`, `--wt-color-border`, `--wt-color-focus`,
`--wt-color-scrim`

Colours are semantic, not literal. There is no `--wt-color-blue`. `--wt-color-scrim` was added
after the rest of the palette to back `wt-dialog`'s `::backdrop` — if you need a similar
overlay/veil colour elsewhere, reuse it rather than inventing a new one.

### Structure

`--wt-space-1` … `--wt-space-6` (4–32px), `--wt-radius-sm|md|lg`, `--wt-font-family`,
`--wt-font-size-sm|md|lg|xl`, `--wt-font-weight-normal|bold`, `--wt-shadow-1|2`,
`--wt-focus-ring`, `--wt-focus-offset`, `--wt-dialog-max-width`

`--wt-dialog-max-width` (`min(90vw, 32rem)`) exists so `wt-dialog` never spells out a literal
`rem` value inline — the no-hardcoded-chrome guard (see below) checks `rem`/`em` sizing, not just
`px`, so any component-level size, including one wrapped in `min()`/`max()`/`clamp()`, must resolve
through a token.

### `--wt-tap-min`

Minimum interactive target, 44px, **on both axes**. POS screens are touched under time pressure by
staff who are not looking carefully — a numpad key ("1", "+", "−") fails just as badly if it's
44px tall but only 32px wide as if it were too short. `wt-button`, `wt-input`, and `wt-switch`
apply `min-width` and `min-height` to the element that actually forms the hit target (the inner
`button` for `wt-button`; the inner `input` for `wt-input`; both `:host` and `.control` for
`wt-switch`) — never to an element that can overflow its own container (see "Hit targets must not
overflow their container" below).

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
| `wt-button` | `variant` (`primary`\|`secondary`\|`danger`\|`ghost`), `size` (`sm`\|`md`\|`lg`), `disabled`, `aria-label` | native `click` |
| `wt-icon` | `name`, `size` (`sm`\|`md`\|`lg`) | — |
| `wt-card` | `raised`; default slot (body), `header` slot | — |
| `wt-input` | `value`, `label`, `type`, `placeholder`, `disabled`, `invalid` (also sets `aria-invalid`) | `wt-change` — `detail: { value: string }` |
| `wt-switch` | `checked`, `disabled`, `label` | `wt-change` — `detail: { checked: boolean }` |
| `wt-dialog` | `open`, `heading`, `aria-label` (fallback name when there is no `heading`); default slot (body), `footer` slot | `wt-close` |

`wt-button` has no `type` property — see "Forms" below.

Variant- and state-like properties (`variant`, `size`, `name`, `raised`, `disabled`, `checked`,
`invalid`, `open`) all reflect to attributes, which is what makes `:host([variant="..."])`-style
styling possible — see "Adding a primitive" below.

Icons are registered by the consuming app, so `packages/ui` depends on no icon library:

```ts
import { registerIcons } from "@waitron/ui";
registerIcons({ check: "M2 8 L6 12 L14 4" });
```

An unregistered `name` renders nothing — there is no broken-icon fallback markup.

### Accessible, clickable labels (`wt-input`, `wt-switch`)

Both associate their visible `<label>` with the native control through a real `for`/`id` pair —
not by wrapping the control inside the `<label>` — so the existing layout and font sizing stay
untouched. The `id` comes from a module-level counter (`wt-input-N` / `wt-switch-N`), so multiple
instances on one page never collide.

- `wt-input`: `<label for="wt-input-N">` + `<input id="wt-input-N">`. The label supplies the
  input's accessible name purely through that native association.
- `wt-switch`: the same `for`/`id` pairing is what makes clicking the visible label text toggle the
  switch. Because the control also carries `role="switch"` (re-purposing a native checkbox), its
  `<input>` *additionally* sets `aria-label` directly from the `label` property, so the accessible
  name doesn't depend on how a given screen reader resolves a `for`/`id` pair against a
  non-default role.

This is a fix, not the original shape: both primitives used to render `<label>` and the control as
unconnected siblings — no `for`/`id`, no `aria-label` — which left every `wt-input` silent to a
screen reader and made `wt-switch`'s visibly pointer-cursored label inert on click. If you add a
labelled primitive, follow this pattern, not the unconnected-siblings one.

### Accessible names (`wt-button`, `wt-dialog`, `wt-input`)

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
- `wt-input`: the `invalid` property was visual-only (it only reddened the border). It now also
  sets `aria-invalid="true"|"false"` on the inner `<input>`, so a screen reader user gets the same
  signal a sighted user gets from the red border.

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

### Focus delegation (`wt-button`, `wt-input`, `wt-switch`)

Each interactive primitive sets:

```ts
static override shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };
```

Without this, calling `.focus()` on the host element leaves the shadow root's inner control
unfocused — `document.activeElement` becomes the host, but nothing inside its shadow root ever
receives focus, so keyboard interaction and `:focus-visible` styling never engage. A POS needs
"focus the quantity field" constantly (e.g. after adding a line item); `delegatesFocus: true` makes
`wtInput.focus()` actually focus the inner `<input>`.

### Forms

`wt-button` has no `type` property. A `<button type="submit">` rendered inside a shadow root is
**not form-associated** — clicking it produces zero native `submit` events, and the enclosing
`<form>`'s `.elements` never lists any `wt-input`/`wt-button` inside a shadow root either. A `type`
property that looked like it selected native submit behaviour but silently did nothing would be
worse than no property at all. Full form association via `ElementInternals`
(`attachInternals().form`, `formAssociated = true`, etc.) is out of scope for this design system —
if a screen needs form-like behaviour, wire it up in JS: listen for `wt-change` on each field and
call your own submit handler on the triggering `wt-button`'s `click` event.

### Empty slots don't reserve space

`wt-card`'s `header` slot and `wt-dialog`'s `footer` slot only add their spacing/divider when
something is actually projected into them — an unused slot must not leave a spurious gap or a bare
bar in the layout. The two primitives get there differently:

- `wt-card` does it in pure CSS: the header's `margin-bottom` lives on `.header ::slotted(*)`, so
  it only applies when there is slotted content for that selector to match.
- `wt-dialog` does it imperatively: `updateHasFooter()` reads `assignedNodes({ flatten: true })`
  off the footer slot — once on first render, again on every `slotchange` — and toggles a
  `.has-content` class that the footer's padding and top border are conditioned on.

If you build a primitive with an optional slot that carries its own spacing, use one of these two
patterns rather than reserving space unconditionally.

## Event discipline

Custom events crossing a shadow boundary are `composed: true`, so a native event re-emitted
without care fires twice. **Always `stopPropagation()` the native event before dispatching your
own.** `wt-input` and `wt-switch` are the reference implementations.

Custom events are named `wt-*` and carry data in `detail`.

## Testing

Component tests run in real Chromium via `@vitest/browser` + Playwright, not jsdom — the things
being asserted (computed styles, `adoptedStyleSheets`, shadow-DOM event composition) don't exist
in a DOM simulator. Shared test helpers live in `packages/ui/src/test-helpers.ts`:

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
  background, a component with no background of its own (e.g. `wt-input`'s `<label>`) would be
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
pairing actually used by the six primitives, in either theme, across every documented state (`wt-input`
invalid, `wt-switch` checked/unchecked, `wt-dialog` open, `wt-button` icon-only and every variant,
disabled states). No token values needed changing. (axe does flag two unrelated `incomplete` — not
violation — results on `wt-dialog`: a `color-contrast` "background partially obscured" reading on the
`.body` slot, an [axe/shadow-DOM slot-content limitation](https://github.com/dequelabs/axe-core), and
an `aria-prohibited-attr` note about `aria-label` on the light-DOM `<wt-dialog>` host itself, which axe
can't know is deliberately forwarded into the shadow root. Both are engine limitations, not defects —
verified by hand: `--wt-color-text` on `--wt-color-surface-raised` computes to ~13:1 in dark and >15:1
in light, both far past the 4.5:1 AA floor for the 15px body text involved.)

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
6. Add it to the workbench and to the table above.

## Workbench

```bash
pnpm --filter @waitron/ui dev
```

Serves `packages/ui/index.html` on `http://localhost:5180`, showing every primitive in light and
dark side by side, each panel driven by its own `applyTokens` call — the same two-roots-at-once
behaviour `multi-root.test.ts` asserts. Check both before committing.

## Local checks before pushing

A Husky `pre-push` hook (`.husky/pre-push`) runs before any push leaves your machine, and **what it
runs depends on what the push contains.** On a push carrying code, in order: the sign-off (DCO)
check, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, then `typecheck` and
`test:coverage` **scoped to the changed packages and their dependents**. A documentation-only push
stops after `format:check`; a push that only deletes refs skips the gate entirely; and anything the
hook cannot attribute to a package — root config, `.github/`, `.husky/`, `scripts/`, the lockfile —
widens the run back to the whole workspace. It runs from the repo root regardless of which
subdirectory you're in, stops at the first failing step, and prints both which step failed and the
exact command to reproduce it locally.

(This paragraph has twice described a hook that no longer existed. It said
`pnpm --filter @waitron/ui …` for `typecheck` and `test` after #9 had widened both, and then said
the hook "always runs everything" and had no coverage thresholds after `feat/scoped-pre-push-hook`
had given it both scoping and `test:coverage`. `git log -p -- .husky/pre-push` is the authority;
this file is a paraphrase of it.)

Coverage thresholds ARE in the hook now — `test:coverage` is the same script CI's shards run, and
closing that gap is most of why the hook was rewritten. **Mutation testing and the `bundle-smoke`
builds are still deliberately out**, so a green hook does not imply a green CI; the hook's own
header names both and gives the measurement behind each. Both the hook and CI narrow on a change,
so a green from either is evidence about the packages that ran. A merge to `main` is the only run
that is unfiltered, and that is what verifies the narrowing was right.

`pnpm install` wires the hook up automatically (via the root `prepare` script), including on a
fresh clone — nothing else to set up.

**Emergency bypass:** `git push --no-verify` skips the hook entirely. Use it when the hook is
wrong, blocking on something unrelated to your change, or an environment issue you don't have time
to fight — CI runs the same checks and will still catch a real problem on the PR either way. The
hook's own output repeats this on every failure so you're never stuck without it.
