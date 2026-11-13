# D-PAGE-TITLES: one shared page-title style

Finish line: dashboard and module page titles use `--wt-font-size-xl` and bold, as required by
`docs/developers/design-system.md` → Typography roles. Their layout and other text keep their existing styles.
Source: Lane D `queue.md`, D-PAGE-TITLES, queued by the watcher on 13 November at 19:34.
A separate Sol-high author drafted this plan; Claude reviewed it in 220 seconds and the driver applied
its corrections. No owner design approval is recorded. The watcher cleared the revised plan and
floor-plan modal exclusion on 2026-11-13 at 20:34, recorded in Lane D’s `questions.md` under
“D-PAGE-TITLES: plan CLEARED by the watcher”; build within the queued ask.

The literal-H1 inventory at `7484fce5bb` found 44 files under `apps/dashboard/src/screens/` and
`packages/*/src/dashboard/`. Re-inventory at build time rather than pinning a count.
Exclude `packages/fiscal-verifactu/**`, `apps/dashboard/src/screens/staff-screen.ts`,
`packages/staffing/src/dashboard/staff-roles-screen.ts`, and `apps/dashboard/src/screens/floor-plan-editor.ts`: its H1 is inside a
full-size modal, whose heading keeps the LG role. Login's centred-card H1s are page titles and change to XL.

Reuse Lit stylesheet composition: export `pageTitleStyles` from `packages/ui-core/src/base-styles.ts`,
containing only a plain `h1` rule for XL size and bold weight. Leave `baseStyles` unchanged so excluded
screens and primitives do not inherit a new size. Re-export through `packages/ui/src/base-styles.ts` and
`packages/ui/src/index.ts`; ui-core's existing wildcard barrel already exposes it.
Add it after `baseStyles` in each in-scope heading owner's static styles; remove all competing local H1
font sizes, including classes on H1, while retaining margins, colours, wrapping, focus attributes and markup.
In `apps/dashboard/src/screens/printers-screen.ts`, qualify the existing `.title` LG size as `h2.title`:
the calibration headings share that class with the page title and keep their current size.

1. Extend `packages/ui-core/src/base-styles.test.ts`: an opt-in browser fixture follows distinct XL/bold
   token values; H2/body and a base-only fixture stay unchanged. One theme suffices for these structure tokens.
   Add the export to the existing no-literal-colours table; preserve existing weight/inheritance assertions.
   Run `pnpm --filter @waitron/ui-core exec vitest run src/base-styles.test.ts` red, implement exports, then green.
2. Extend the existing “opens on the width step and has three steps, the last one saving” case in
   `apps/dashboard/src/screens/printers-screen.test.ts`: H1 computes to the resolved XL token and each
   calibration `h2.title` stays LG. Check the H1 exists in that fixture before relying on its assertion.
   Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/printers-screen.test.ts -t 'opens on the width step'`
   red before screen adoption; rerun it green after step 3. Compare resolved tokens rather than literal pixels.
3. Add root `scripts/page-title-styles.test.ts`, a small text guard using existing file traversal with `isFile()`.
   For each in-scope literal-H1 owner, require `pageTitleStyles` in static styles and reject local H1 size
   overrides, including unqualified classes on H1; accept `h2.title`. Confirm the one-screen-class assumption
   while inventorying. Cover compliant/missing adoption, unused import, override, legitimate H2 and exclusions.
   Run `pnpm exec vitest run scripts/page-title-styles.test.ts` red, migrate the scoped files, then rerun green.
   Delete Content languages' adoption in a disposable copy: the guard must fail naming that file.
   In Typography roles, document adoption and the guard's limit: literal templates/styles, not the full cascade.
4. Look at Content languages at desktop width, Orders at 390px, and Printers/calibration at 390px, each in
   English/Spanish and both themes; inspect title wrapping and adjacent controls. Keep screenshots local.
   Shrink only the resolved title portion of `docs/backlog/dashboard.md` → Text size after A179; retain setup,
   excluded-area gaps, the scale decision, code-size exceptions and the real-phones bundle's phone check.

Expected production change: roughly 120–180 lines; tests: roughly 80–120, reusing browser fixtures and one small guard.
No setup/till typography, phone redesign, framework, AST machinery, bulk formatting or whole-package local suites.
