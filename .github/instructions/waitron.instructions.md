---
applyTo: "**"
---

# Waitron custom instructions

Project-specific rules for reviewing this repo. These are not generic best practice — each one
reflects something already true of the codebase, most enforced by an automated check. Read
`docs/developers/design-system.md` for the full design-system contract before reviewing anything
under `packages/ui`.

## No hardcoded chrome

Every colour, spacing, radius, and font value in a `packages/ui/src/components/*.ts` component's
`static styles` must read a `--wt-*` custom property: no hex, no `rgb()`/`hsl()`/`hwb()`/`lab()`/
`lch()`/`oklab()`/`oklch()`/`color()`/`color-mix()`, no named colours, no `px` above `1`, no
`rem`/`em` at all (including inside `min()`/`max()`/`clamp()`). `transparent`, `currentColor`, and
`inherit` are legitimate escape hatches, not chrome.

This is enforced automatically by `packages/ui/src/no-hardcoded-chrome.test.ts`, which discovers
every component via `import.meta.glob("./components/*.ts", ...)` — a new component is covered the
moment the file exists, with nothing to register. If a needed token doesn't exist, it belongs in
`packages/ui/src/tokens/`, not inlined.

## Real Chromium only — never jsdom

`packages/ui` tests run in real Chromium via Vitest 3 browser mode (`@vitest/browser` +
Playwright), not jsdom. Token/theming tests depend on `getComputedStyle` resolving CSS custom
properties and on `adoptedStyleSheets`, neither of which jsdom implements — a jsdom-based version
of these tests would pass regardless of whether the component actually works. Never suggest
introducing jsdom, `happy-dom`, or DOM-mocking test utilities into this package, and never suggest
swapping a Playwright/Chromium test for a jsdom one "for speed."

## A new primitive needs two specific tests, not just "some tests"

A new `wt-*` primitive under `packages/ui/src/components/` is incomplete review-wise without:

1. A token-painting test — set a `--wt-*` token on the mounted host
   (`host.style.setProperty(...)`) and assert the computed style follows it. A component that
   renders correctly but ignores its tokens is not a compliant primitive.
2. An axe accessibility test in a sibling `*.a11y.test.ts` file (see
   `packages/ui/src/a11y-helpers.ts`), covering every meaningfully distinct accessibility-relevant
   state (open/closed, checked/unchecked, invalid, disabled, icon-only, ...) in both light and
   dark themes.

## Event discipline

Custom events are named `wt-*`, carry their payload in `detail`, and are dispatched with
`bubbles: true, composed: true` so they can cross the component's own shadow boundary. Before
re-emitting, the native or internal event that triggered them must be stopped with
`event.stopPropagation()` — otherwise the native event (itself `composed: true` for things like
`input`/`change`) independently crosses the same boundary and the consumer observes the change
twice.

## Treat "there is a test" as an unfinished sentence

This project has a documented history of tests that passed while the behaviour they were named
after was absent or broken (see `.superpowers/sdd/coverage-mutation-report.md`). Coverage
percentage does not rule this out — it only proves a line executed, not that anything asserted on
the result. When reviewing a test, ask specifically: if the behaviour under test were deleted or
reverted, which assertion would fail, and how? "It calls the component and doesn't throw" is not
an answer. `pnpm --filter @waitron/ui mutation` is the tool this repo uses to check that
systematically — a surviving mutant on a boolean flag, a comparison operator, or a conditional
guard means some test suite member exercises that code without noticing when it's wrong.

## Workspace package boundaries

`packages/verifactu` (Spain's VeriFactu/SII invoicing-compliance package — not yet created as of
this writing, see `docs/superpowers/specs/2026-07-18-pos-architecture-design.md` §8) must never
import from any other `packages/*` or `apps/*` workspace package, including `@waitron/ui`. It
exists to be certified/audited in isolation; a dependency on another internal package would pull
unrelated, non-audited code inside that boundary. This is already enforced by an
`import-x/no-restricted-paths` zone in `eslint.config.js` scoped to `packages/verifactu/**/*.ts` —
if a PR touching that package needs to loosen or work around that rule, treat it as a design
question to raise, not a lint config nit to wave through.
