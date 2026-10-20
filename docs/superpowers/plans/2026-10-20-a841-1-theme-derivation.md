# A841 slice 1 — the theme derivation and the shared contrast checks: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Review path: FULL.** Design section 16 puts the whole build on it, and this slice creates the
contract slices 2 and 5 consume (`@waitron/ui-core/theme`). Implementers are dispatched as
`subagent_type: "implementer"`. An implementer that passes about 150 tool calls with its task
unfinished stops at a passing or cleanly failing point, commits, and hands over: done, left, files,
each check's state.

**Goal:** one pure function, `deriveThemeFrom(defaults, choices)`, that turns a venue's colour and
corner choices into a light and a dark set of the same 25 tokens, with readability warnings and
their fixes; the contrast rules Waitron's palette is tested against, moved out of `colors.test.ts`
into one list that both that test and the derivation run; the sweeps; and the token-list guard. No
screen, no migration, no server route.

**Architecture:** a new directory `packages/ui-core/src/theme/`. The derivation core takes
Waitron's own values as an argument and imports no CSS; it is exported as `@waitron/ui-core/theme`.
One small module, `waitron.ts`, reads the real `colors.css` and `structure.css` as raw text and
binds them (`WAITRON_DEFAULTS`, `deriveTheme`), exported as `@waitron/ui-core/theme/waitron`; in
slice 1 only browser code and tests import it. The algorithm is a port of the design's prototype,
with the differences listed under "The reference".

**Tech stack:** TypeScript, Vitest 4 browser mode (real Chromium, as every `ui-core` test runs),
esbuild for the package build, Stryker for mutation.

**Spec:** `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` — section 16 slice 1
(lines 2431-2434), and what it rests on: section 3 (the contrast rules, lines 311-323), section 5
(the 22 colours, lines 666-694), section 6 and "Colours set by hand" (lines 1002-1216), section 7's
per-version table and dark-own case (lines 1231-1266), section 9 (lines 1767-1924), section 10's
warning shape (lines 1940-1950), section 11's document shape (lines 2012-2023), section 14 (lines
2224-2280), section 15 (lines 2281-2413), and section 16's recorded rulings (lines 2571-2580). Line
numbers are those of this branch, whose last commit corrects the design (see "The design document
is corrected in this branch").

Every `file:line` outside the design was read on 2026-10-20 in this worktree, rebased on `main`
`0f2788281`, unless it names a command that was run.

**Ledger:** `docs/handoffs/2026-10-20-a841-1-theme-derivation.md` (gitignored), updated at the end
of every task.

---

## Decision: hand-set values stay in slice 1 (no slice 1b)

The design allows splitting hand-set values into a slice 1b "if this one grows past one
implementer" (spec lines 2431-2434). Judged by the rule that each implementer task finishes in well
under about 100 tool calls, slice 1 needs no split: the hand-set work is Tasks 7 and 8, each about
the size of Task 5, and no task below is expected past about 50 calls. Three further reasons:

- Slice 2's server validates and stores `handSet` and answers its warnings
  (`field: "handSet.light.bg"`, spec lines 2066-2067), so a 1b would have to land before slice 2
  anyway; splitting buys a smaller pull request, not an earlier server.
- Settling around fixed colours is one function in the reference (`settle`), and the brand-only
  path is that same function with nothing fixed. Writing it brand-only first and reshaping it later
  would change the core loop twice.
- The sweeps that hold the brand-colour rules and the hand-set rules share one rule list, one
  "unexplained failure" invariant and one Stryker exclusion.

---

## The reference, and which numbers the tests pin

The design's prototype is `~/waitron-campaign/a841-mockups-src/derive.mjs`. For this plan it was
copied to `~/waitron-campaign/a841-plan1-probes/` and changed in four ways, each run against this
worktree's token files (`A841_WT=<this worktree> node <script>`, Node v26.11.1, 2026-10-20):

1. **The 31 missing rules added.** The prototype's `checks()` holds 67 light and 72 dark rules but
   omits three kinds that `colors.test.ts` holds and that read a token the theme writes:
   `--wt-color-text` on `--wt-color-highlight` (`colors.test.ts:281-282`), and `--wt-color-text`
   and `--wt-color-text-muted` on each of the 15 station fills (`colors.test.ts:532-545`). With
   them: 98 light and 103 dark (`count-exact.mjs`). The plan review's census of the old file by
   token name, comparison and bound (`census/`, below) found the 93 light and 98 dark non-button
   rules identical to the old file's rules that name one of the 22 colours (`cmp.mjs` printed
   `onlyOld [] onlyProto []` in both modes).
2. **Exact comparisons**, as `colors.test.ts` makes them: `>=` for "at least", `>` for the lifted
   surface's 1.1 (`colors.test.ts:139-141` uses `toBeGreaterThan`), `<=` for "at most"; the
   prototype allowed 1e-9.
3. **Rules in `colors.test.ts`'s group order** (the table in Task 3), and **the tint's strength
   settled once, before any colour moves** (the prototype re-tried full strength on each round of
   moves, so a colour moved in that round kept the tint at full strength: on a contrived palette,
   `output-tint.txt`, the prototype reported tint 1 with the tinted track replaced by a grey).
4. **Each warned hand-set colour's fix searched on its own** (plan review H1, ruled 2026-10-20),
   with the brand colour as picked and every other hand-set value as typed, and **Fix all** as a
   function (`fixAll`). The prototype moved only the colour drawn on top, so a colour underneath
   that stopped being named got `fix: null` although a shade passed: text `#6a6a6a` with sunken
   areas `#bbbbbb` gave the sunken areas no fix (`two-hand.mjs ./derive-settle2.mjs`), where the
   per-colour search offers `#ebebeb` (`two-hand.mjs ./derive-h1.mjs`).
5. **A no-fix warning names the hand-set colours that block it** (`blockedBy`, `blockersOf`; lane A
   ruling 2026-10-20). Another hand-set colour blocks the warned one when, worked out instead, it
   would leave the warned colour a fix; when no single one does but working out all the others
   would, every other hand-set colour sharing a rule with it is named; otherwise none.

**The reference is `derive-h2.mjs`**, sha256
`dc8936f1b53bbd5c8a88692c8d4be6382c765992c19a5fe44cd685aea7e20e34`.

What each change did to the outputs, measured:

- Change 2: with and without it, the worked examples (`ex.mjs`, `ex2.mjs`, `ex3.mjs`) printed the
  same lines and the sweeps the same counts (that comparison ran in a scratch folder and was not
  kept).
- Change 3: `output-2026-10-20.txt` (changes 1 and 2, `derive-exact.mjs`), `output-order.txt` (rule
  order alone) and `output-settle2.txt` are byte-identical (`diff` printed nothing).
- Change 4: `output-h1.txt` is byte-identical to `output-settle2.txt` (`diff` exit 0), and `ex4.mjs`,
  `ex5.mjs`, `within-probe.mjs` and `brand-vs-hand.mjs` print the same under both; it changes only
  cases with two or more colours set by hand.
- Change 5: `output-h2.txt` is byte-identical to `output-h1.txt` (`diff` printed nothing), and the
  two-colour sweep printed the same totals line under both; it adds `blockedBy` and changes no
  colour or fix.
- Change 1, among the design's worked examples, changed only the sage warning's `against` list (18
  names, not 3) and the dark hand sweep's counts (78 / 98, not 79 / 97); every hex value in them and
  every brand-sweep count is unchanged. Outside the worked examples, the plan review's comparison of
  the original prototype with the reference also showed the made-up "no shade" probe naming 17
  colours, not 2, and the grey-alone control's fix `#636363` with 18 names, not `#696969` with 3
  (`/tmp/a841-plan1-review/orig-ex3.mjs.txt` and `s2-ex3.mjs.txt`, read).

**Every pinned number in this plan comes from the reference**, from the output files named beside
it in `~/waitron-campaign/a841-plan1-probes/`. The port must reproduce them exactly; a mismatch is a
porting fault to find, never a number to update. **A new pinned value** (Task 9 adds some) is
computed by running the reference in a script saved in that folder with its output file beside it,
never read off the port.

**Port, do not redesign.** Where a step says "port `X` (`derive-h2.mjs:a-b`)", keep every constant,
step size, iteration cap and loop order. The differences from the reference the port makes on
purpose:

- Output is the full list of 25 tokens per mode, filled from Waitron's values (the reference
  returns only what it wrote). With brand colour `null` the brand family is Waitron's own values.
- The reference's `adjust` / "Q2 A" path (`derive`, `adjust = true`) is not ported: colours are
  always as picked, and a fix is a flag (`brandFix`).
- Waitron's values come in as a `defaults` argument, never a module-level mutable object.
- The brand fix's shade comes from **one function**, `brandFixShade`, which paints `brandFix`
  (plan review M3), and the offered fix is the primary that flag paints, because hand-set colours
  can move the grounds between the two runs (Task 7 review ruling, 2026-10-20; the reference's
  `throw` at `derive-h2.mjs:350` fires on such a case, `output-ruling-brand-fix.txt`).
- Warnings carry keys without the `--wt-color-` prefix, ordered light then dark, and within a mode
  the brand colour first, then hand-set colours in `THEME_COLOURS` order.
- Hex input is lower-cased on entry (Review Focus 1).

---

## Global constraints

- **Package: `@waitron/ui-core`, directory `packages/ui-core/src/theme/`.** The tokens live in
  `packages/ui-core/src/tokens/` and the derivation reads them; `packages/shared`, the other
  mutation-tested home both the server and the browser import, may import no other package
  (`eslint.config.js:44-60`). The new files fall inside the coverage `include`
  (`packages/ui-core/vitest.config.ts:90`, `src/**/*.ts`) and the Stryker `mutate` list
  (`packages/ui-core/stryker.config.json:9-16`) with no new exclude of source. Coverage holds
  98/98/98/95 (`vitest.config.ts:101`); the mutation floor is 90 (`stryker.config.json`
  `thresholds.break`), bitten by the nightly `mutation` job (`.github/workflows/mutation.yml:29-35`).
- **The derivation core imports no CSS and touches no DOM.** Only `waitron.ts` imports the two token
  files, as `?raw`, and no other theme source imports `waitron.ts` (Task 3 guards both). This does
  not make the server able to import the theme code as it stands: see "Left for slice 2".
- **`?raw`, never `?inline`, for the token text.** Measured 2026-10-20 with this worktree's Vite
  8.3.4, a production build of `import a from "./x.css?inline"` and `import b from "./x.css?raw"`
  gave `a` minified — `--wt-color-surface:#fff;--wt-color-scrim:#0006` — and `b` as written. The
  dashboard's and till's production builds would hand an `?inline` parser `#fff`.
- **Contrast maths:** WCAG 2.2's 0.04045 cut-off. `colors.test.ts:18` uses 0.03928; for every 8-bit
  channel value 0-255 the two pick the same branch (a run printed `channels where the two cut-offs
  disagree: []`; the control, a cut-off of 0.5, disagreed on 117), so no `#rrggbb` changes ratio.
- **English only in code and tests** (CLAUDE.md §3). `ui-core` is not in `GENERIC_PACKAGES`
  (`packages/db/src/english-only.ts:15-58`), so review greps the diff. Test titles and identifiers
  never use the design's venue names: "the dark-green brand (#1e5b3a)", "the lemon brand
  (#f2d300)", "the burgundy brand (#7a1f2b)", "the cream page (#f8f1e1)", "the sage secondary text
  (#8fa898)". This plan's prose keeps the design's names so it can be read against the design.
- **Comments:** only an invariant or a non-obvious why; a pointer to this plan's reference is
  allowed once, in `derive.ts`.
- **Browser runs:** check `memory_pressure | grep free` before a `ui-core` run; run beside another
  session's browser run only when free memory is well above 15%.
- **Each task ends green on:** its focused test files,
  `pnpm --filter @waitron/ui-core typecheck`, `pnpm --filter @waitron/ui-core lint`, and
  `pnpm exec prettier --check <changed files>`; commit with `git commit -s`, message in plain
  English.
- **Read a run's `Tests` count**, never its exit status alone (CLAUDE.md §4). Under an AI agent,
  prefix `env -u AI_AGENT -u CLAUDECODE` when a step needs a passing test's console output.
- **Mutation, measured as you go.** After Tasks 3, 6 and 8, run
  `pnpm --filter @waitron/ui-core exec stryker run --mutate "src/theme/*.ts,!src/theme/*.test.ts"`
  and read the clear-text table's `All files` row, column `% Mutation score` → `total` (the plan
  review's run of the reference printed that row as `All files | 74.92 | 76.88 | 724 | 11 | 221 |
  25 | 0`, `/tmp/a841-plan1-review/mut/stryker.log`). Record the score and the survivors' files and
  lines in the ledger. The run exits non-zero below 90 (`thresholds.break`); at Tasks 3, 6 and 8
  that is recorded, not a stop — Task 9 brings it to 90 or above.

## Review Focus

The inputs most likely to bite that no design example exercises, each with its test in the owning
task:

1. **Uppercase hex** (`#1E5B3A`), which a colour picker or a script can send: the same theme as
   lowercase, and lowercase out. A 3-digit or bare value (`#abc`, `1e5b3a`) is a `RangeError`, never
   a silent wrong colour. Tests: Task 1 (parse), Task 5 (brand colour, both shapes), Task 7
   (hand-set value, both shapes).
2. **A hand-set key outside the 22** (`scrim`, `danger`) reaching the derivation before slice 2's
   validation exists: a `RangeError` naming the key, never a meaning colour moved. Test: Task 7.
3. **A brand fix flag where the colour already reads** (Bar Lucía light with `brandFix.light`): the
   brand colour paints unchanged, no warning. Test: Task 6.
4. **A brand fix flag with "Waitron's" brand colour** (`brandColor: null`, which slice 2 refuses
   but a draft may hold): ignored, Waitron's exact values. Test: Task 5.
5. **The caller's choices object**: never mutated, and the same choices give equal output. Test:
   Task 5 (frozen input, two calls deep-equal).

---

## File map

All under `packages/ui-core/`.

| File | Task | Responsibility |
| --- | --- | --- |
| `src/theme/colour.ts` | 1 | hex parsing, sRGB ↔ OKLCH, lightness moves, WCAG luminance and ratio |
| `src/theme/defaults.ts` | 2 | parse token CSS text into Waitron's light, dark and structure values (no CSS import) |
| `src/theme/waitron.ts` | 2, 5 | the `?raw` read of the two token files: `WAITRON_DEFAULTS`, and `deriveTheme` bound to it |
| `src/theme/index.ts` | 2, 3, 5, 8 | the barrel for `@waitron/ui-core/theme`; never re-exports `waitron.ts` |
| `src/theme/tokens.ts` | 3 | the 22 colours, 3 radii, the 25-token list, the brand family, corner radii |
| `src/theme/contrast-rules.ts` | 3 | every contrast rule, grouped as `colors.test.ts`'s tests are, and how to check them |
| `src/theme/derive.ts` | 5, 7 | one mode: worked-out colours, the brand fix's shade, the tint, moving worked-out colours |
| `src/theme/theme.ts` | 5-8 | `deriveThemeFrom`, the choices and output types, `normaliseChoices`, `fixAll` |
| `src/theme/warnings.ts` | 6, 8 | the brand colour's and hand-set colours' warnings and fixes; `groupAgainst` |
| `src/theme/*.test.ts` | each | tests; `*.sweep.test.ts` and `sources.test.ts` are skipped under Stryker |
| `src/tokens/colors.test.ts` | 4 | keeps every test name; the ratio tests run the shared rule groups |
| `scripts/build.mjs`, `package.json`, `tsconfig.build.json`, `test/consumer/main.ts`, `test/package-consumer.test.mjs`, `README.md` | 2 | the two new exports, built and tarball-tested |
| `vitest.config.ts` | 6 | skip the sweep and source-text files under Stryker |

Nothing else in the repository changes except `docs/developers/design-system.md` (one sentence,
Task 10) and, at land time, `docs/backlog.md` (a driver step).

## The design document is corrected in this branch

The design's passages that the plan's corrections retire were edited in the same commit as this
revision of the plan (CLAUDE.md §1), each citing the reference: the rule count (spec line 1049),
the fix rule and Fix all (section 6 step 3, lines 1112-1138), the sage (lines 1175-1190, and
section 4 step 5, lines 520-522), the dark hand sweep and the made-up no-shade case (lines
1192-1208), section 7's `rules 72 failing 0` (lines 1255-1259), section 14's token-list guard
(lines 2226-2233, 2252), section 15's cases (lines 2293-2305, 2396), and section 18's picture 15
row. Lane A's three rulings of 2026-10-20 on the questions this revision raised are in the design
too, recorded in section 16's "The answers, and the branches not taken" (lines 2571-2580):

1. **A warning's station colours are grouped**, fills and dots alike: "the 15 station colours",
   "the 15 station dots", or "{n} …" for some (product-text row, line 615).
2. **Fix and save is offered when running Fix all would leave no warning**, decided by running it,
   and applies Fix all (section 4 step 7, lines 533-539; section 9 (c), lines 1829-1840, with the
   trade-off and "No shade passes" paragraphs; the product-text rows and note; section 15's dialog
   case).
3. **A no-fix warning blocked by another colour set by hand names it**: "… while Sunken areas is set
   by hand to #000000"; with no blocker the sentence is unchanged (section 9's "No shade passes",
   lines 1875-1887; the warning gains `blockedBy`, section 10, lines 1940-1950; product-text rows).

Section 18 needs no change for them: picture 16 shows a single lemon warning that has its own fix,
which both the old and the new Fix-and-save rule offer.

---

### Task 1: Colour maths

**Files:** Create `src/theme/colour.ts`, `src/theme/colour.test.ts`.

**Interfaces — Produces:**

```ts
export interface Oklch { L: number; C: number; H: number } // H in radians
export function hexToRgb(hex: string): [number, number, number]; // 0..1; RangeError unless /^#[0-9a-f]{6}$/i
export function toOklch(hex: string): Oklch;
export function fromOklch(colour: Oklch): string; // lowercase #rrggbb, chroma reduced into sRGB
export function withLightness(hex: string, L: number): string;
export function relativeLuminance(hex: string): number;
export function contrastRatio(a: string, b: string): number;
```

- [ ] **Step 1: Write the failing tests** in `colour.test.ts`:
  - `contrastRatio("#000000", "#ffffff")` is `21` and symmetric; `contrastRatio("#1f6feb", "#f7f7f8").toFixed(2)` is `"4.33"`; `contrastRatio("#1f6feb", "#ffffff").toFixed(2)` is `"4.63"`.
  - "agrees with the 0.03928 cut-off colors.test.ts used, for every 8-bit channel": for `v` 0-255, `relativeLuminance` of the grey `#vvvvvv` equals, exactly, the old formula computed inline in the test (`colors.test.ts:14-20`'s body).
  - `toOklch("#ff0000")`: `L` ≈ 0.62796, `C` ≈ 0.25768, `H` ≈ 0.51023 (`toBeCloseTo(_, 4)`); `toOklch("#000000")` is `{ L: 0, C: 0, H: 0 }`; `toOklch("#ffffff").L` ≈ 1 and `.C` < 1e-6.
  - round trip: `fromOklch(toOklch(h)) === h` for all 216 colours of the 0/51/102/153/204/255 grid.
  - out of gamut: `fromOklch({ L: 0.7, C: 0.4, H: 2 })` is `"#9da81c"`.
  - `withLightness("#1e5b3a", 0)` is `"#000000"`, `withLightness("#1e5b3a", 1)` is `"#ffffff"`.
  - `contrastRatio("#FFFFFF", "#000000")` is `21`; `hexToRgb` throws `RangeError` for `"#fff"`, `"1f6feb"`, `"#gggggg"`, `"x#1f6feb"` and `"#1f6feb0"` (the last two pin the pattern's anchors).

  (Values from `~/waitron-campaign/a841-plan1-probes/output-colour.txt`.)

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/colour.test.ts` — FAIL, the import of
  `./colour.js` does not resolve.

- [ ] **Step 3: Implement** by porting `derive-h2.mjs:32-77` (`lin`, `unlin`, `hexToRgb`,
  `rgbToHex`, `toOklch`, `inGamut`, `fromOklch`, `withL`, `luminance`, `ratio`) with Ottosson's
  matrices and the chroma reduction (× 0.95, at most 60 times, tolerance 1e-4, then chroma 0)
  unchanged; add the `RangeError` and the lower-casing.

- [ ] **Step 4: Run, expect pass** (same command; read the `Tests` count).

- [ ] **Step 5: Commit** — `git add packages/ui-core/src/theme/colour*.ts && git commit -s -m "Add the colour maths the theme derivation needs"`.

---

### Task 2: Waitron's values from the real token files, and the package exports

**Files:** Create `src/theme/defaults.ts`, `src/theme/waitron.ts`, `src/theme/defaults.test.ts`,
`src/theme/index.ts`. Modify `scripts/build.mjs:23-33`, `package.json` (`exports` after `:47`,
`publishConfig.exports` after `:118-121`), `tsconfig.build.json:8`, `test/consumer/main.ts` (before
`:104`), `test/package-consumer.test.mjs` (after `:137`), `README.md`.

**Interfaces — Consumes:** nothing from Task 1. **Produces:**

```ts
// defaults.ts — pure: no CSS import
export type Mode = "light" | "dark";
export const MODES: readonly Mode[]; // ["light", "dark"]
export interface WaitronDefaults {
  readonly light: Readonly<Record<string, string>>; // every --wt-* declaration of the forced light block
  readonly dark: Readonly<Record<string, string>>; // … of the forced dark block
  readonly structure: Readonly<Record<string, string>>; // structure.css's one block
}
export function parseBlock(css: unknown, selector: string, from?: number): Record<string, string>;
export function readDefaults(colorsCss: unknown, structureCss: unknown): WaitronDefaults;

// waitron.ts — the one module that imports ../tokens/colors.css?raw and ../tokens/structure.css?raw
export const WAITRON_DEFAULTS: WaitronDefaults; // readDefaults(<colors.css text>, <structure.css text>)
// (Task 5 adds: export function deriveTheme(choices: ThemeChoices): DerivedTheme)
```

The forced blocks are `:where([data-wt-theme-root][data-theme="light"])` (`colors.css:243`) and
`…[data-theme="dark"]` (`colors.css:359`). `parseBlock` throws `TypeError("token CSS was not loaded
as text")` when `css` is not a string, and an `Error` naming the selector when the block is absent;
`readDefaults` throws when light lacks `--wt-color-primary` or structure lacks `--wt-radius-md`.
The `TypeError` is what turns a bundler with no text loader into a loud failure: esbuild 0.28.2,
bundling `import t from "./x.css?raw"` with no `.css` loader, made `t` an empty object and exited 0
(measured 2026-10-20; with `--loader:.css=text` it gave the text).

- [ ] **Step 1: Write the failing tests** in `defaults.test.ts` (importing `WAITRON_DEFAULTS` from
  `./waitron.js`):
  - `WAITRON_DEFAULTS.light["--wt-color-bg"]` is `"#f7f7f8"`, `.dark["--wt-color-bg"]` is `"#101216"` (the values `colors.test.ts:83,86` pin), and `.structure["--wt-radius-md"]` is `"8px"` (`structure.css:10`).
  - "the forced blocks hold what the default and the media blocks hold": parse `colors.css?raw` four times — the first `:where([data-wt-theme-root])`, the same selector searched from the index of `@media (prefers-color-scheme: dark)`, and the two forced blocks — and expect default deep-equal to forced light and media-dark deep-equal to forced dark, each with at least one `--wt-color-` name. (A run printed `default==forcedLight true mediaDark==forcedDark true`. No count is pinned, so a new colour token does not break this test.)
  - "the parsed values are what the browser resolves": for each mode, `mountTokenRoot(mode)` (`src/tokens/token-test-helpers.ts`), and for every name in `WAITRON_DEFAULTS[mode]`, `token(el, name)` equals the parsed value — `--wt-color-scrim` (`rgb(0 0 0 / 0.4)`, `colors.css:30`) included. If only the scrim differs, by spelling, stop and report rather than loosen the test.
  - `parseBlock({}, …)` throws `TypeError`; `parseBlock("a{}", ":where(x)")` throws; `readDefaults` of text with no primary throws, and of structure text with no `--wt-radius-md` throws.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/defaults.test.ts` — FAIL, `./waitron.js` does not resolve.

- [ ] **Step 3: Implement** `defaults.ts` (no import at all) and `waitron.ts` (the two `?raw`
  imports, typed by `vite/client`, which `src/vite-env.d.ts:1` references). `index.ts` re-exports
  `colour.ts` and `defaults.ts`, and never `waitron.ts`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: The package exports.** In `package.json` add `"./theme": "./src/theme/index.ts"`
  and `"./theme/waitron": "./src/theme/waitron.ts"` to `exports`, and to `publishConfig.exports`
  `"./theme": { "types": "./dist/types/theme/index.d.ts", "import": "./dist/theme/index.js" }` and
  `"./theme/waitron": { "types": "./dist/types/theme/waitron.d.ts", "import":
  "./dist/theme/waitron.js" }` (the package test asserts the two key sets are equal,
  `test/package-consumer.test.mjs:54`). `scripts/build.mjs` takes its entry points from `exports`
  (`:7`), so the entries need no line; widen its plugin's filter at `:25` to
  `/\.css\?(inline|raw)$/` and strip either query. Add `"src/theme/index.ts"` and
  `"src/theme/waitron.ts"` to `tsconfig.build.json:8`'s `include`. In `test/consumer/main.ts`,
  import `WAITRON_DEFAULTS` from `@waitron/ui-core/theme/waitron` and set
  `document.body.dataset.themePrimary` to its light `--wt-color-primary` before `data-ready`
  (`:104`); in the package test, after the `waitForSelector` at `:137`, assert that attribute is
  `"#1f6feb"`. One line in `README.md`'s first section names `@waitron/ui-core/theme` ("the theme
  derivation; it takes Waitron's values as an argument") and `@waitron/ui-core/theme/waitron`
  ("those values, read from the token files").

- [ ] **Step 6: Prove the build path by deletion.** Put `build.mjs:25`'s filter back to
  `/\.css\?inline$/` and run `pnpm --filter @waitron/ui-core test:package`: expected FAIL — the
  `waitForSelector('body[data-ready="true"]')` at `:137` times out, because the built `waitron`
  module throws the `TypeError` at import. Restore the filter; the same command passes.

- [ ] **Step 7: Commit** — `git commit -s -m "Read Waitron's own colours from the token files for the theme derivation"`, the message recording the step 6 run.

---

### Task 3: The token list, the contrast rules, and the guards on both

**Files:** Create `src/theme/tokens.ts`, `tokens.test.ts`, `contrast-rules.ts`,
`contrast-rules.test.ts`, `sources.test.ts`; extend `index.ts`.

**Interfaces — Consumes:** `Mode`, `MODES`, `WaitronDefaults` (Task 2), `WAITRON_DEFAULTS` in tests
only; `contrastRatio`, `relativeLuminance` (Task 1). **Produces:**

```ts
// tokens.ts
export const THEME_COLOURS: readonly [ // Advanced's order, spec lines 686-694
  "bg", "surface", "surface-raised", "surface-lifted", "surface-sunken", "track", "border", "text",
  "text-muted", "primary", "primary-hover", "on-primary", "primary-disabled", "on-primary-disabled",
  "primary-text", "focus", "field-fill", "field-line", "field-label-focus", "field-value",
  "field-fill-disabled", "stepper-button"];
export type ThemeColour = (typeof THEME_COLOURS)[number];
export const colourToken: (key: string) => string; // "bg" → "--wt-color-bg"
export const THEME_RADII: readonly ["--wt-radius-sm", "--wt-radius-md", "--wt-radius-lg"];
export const THEME_TOKENS: readonly string[]; // 22 colour tokens in that order, then the 3 radii
export const BRAND_FAMILY: readonly ThemeColour[]; // primary, on-primary, primary-hover, primary-text,
  // focus, field-label-focus, primary-disabled, on-primary-disabled, surface-lifted, stepper-button
export type Corners = "square" | "standard" | "round";
export function cornerRadii(corners: Corners, defaults: WaitronDefaults): Record<string, string>;
  // square 0/2/4 px, round 8/14/24 px (spec lines 705-707); standard = defaults.structure's values

// contrast-rules.ts — token names are full (`--wt-color-…`); `a` is the colour drawn on top
export type RuleKind = "at-least" | "above" | "at-most";
export type ContrastGroupId = /* the 21 ids in the table below */;
export interface ContrastRule { readonly group: ContrastGroupId; readonly a: string; readonly b: string;
  readonly kind: RuleKind; readonly need: number }
export const CONTRAST_GROUPS: readonly { readonly id: ContrastGroupId; readonly modes: readonly Mode[];
  readonly rules: readonly ContrastRule[] }[];
export function rulesIn(group: ContrastGroupId, mode: Mode): readonly ContrastRule[];
export function allRules(mode: Mode): readonly ContrastRule[]; // every group, in table order
export const THEME_RULES: Readonly<Record<Mode, readonly ContrastRule[]>>; // allRules filtered to
  // rules naming at least one THEME_COLOURS token, order kept
export function passes(rule: ContrastRule, ratio: number): boolean; // >=, >, <= need; no tolerance
export interface RuleResult { readonly rule: ContrastRule; readonly ratio: number; readonly pass: boolean }
export function checkRules(rules: readonly ContrastRule[], colourOf: (token: string) => string): RuleResult[];
export function failureLabels(results: readonly RuleResult[]): string[];
  // failing ones only, e.g. "--wt-color-text on --wt-color-track: 4.21, needs at least 4.5"
```

**The rule groups.** One group per `colors.test.ts` ratio test, in file order, then Waitron's own
button rules (spec lines 1787-1794). `≥` is at-least, `>` above, `≤` at-most. "Stations" are the
15 of `colors.test.ts:513-529`; "palette" the 16 of `:421-438`; loops keep the test's nesting
(outer list first).

| # | id | `colors.test.ts` | modes | rules (`a` on/vs `b`) | light / dark count |
| --- | --- | --- | --- | --- | --- |
| 1 | `lifted-surface` | 134-150 | both | surface-lifted vs bg, surface, surface-raised `>` 1.1; text, text-muted, danger on surface-lifted ≥ 4.5 | 6 / 6 |
| 2 | `sunken-surface` | 153-158 | both | text on surface-sunken ≥ 4.5 | 1 / 1 |
| 3 | `bar-track` | 172-178 | both | track vs bg ≥ 1.4; track vs surface ≥ 1.4; text on track ≥ 4.5 | 3 / 3 |
| 4 | `field` | 205-228 | both | field-line on field-fill, surface, bg ≥ 3; primary on field-fill ≥ 3; field-label-focus, text-muted, text, danger, field-value on field-fill ≥ 4.5; text-muted on field-fill-disabled ≥ 4.5 | 10 / 10 |
| 5 | `primary-text` | 253-266 | both | primary-text on bg, surface, surface-raised, surface-lifted ≥ 4.5 | 4 / 4 |
| 6 | `search-highlight` | 278-284 | both | on-highlight, text on highlight ≥ 4.5 | 2 / 2 |
| 7 | `hover-text` | 302-310 | both | on-primary on primary-hover; on-danger on danger-hover ≥ 4.5 | 2 / 2 |
| 8 | `hover-shows` | 312-320 | both | primary-hover vs primary; danger-hover vs danger ≥ 1.2 | 2 / 2 |
| 9 | `disabled-fill` | 339-349 | dark | primary-disabled, danger-disabled each vs surface, surface-raised ≤ 1.5 | 0 / 4 |
| 10 | `disabled-text` | 351-359 | dark | on-primary-disabled on primary-disabled; on-danger-disabled on danger-disabled ≥ 4.5 | 0 / 2 |
| 11 | `google-button` | 403-418 | both | google-button-text on google-button-fill ≥ 4.5; google-button-line on google-button-fill, surface-raised, surface, bg ≥ 3 | 5 / 5 |
| 12 | `calendar-text` | 447-451 | both | on-palette-X on palette-X (16), on-day-standard on day-standard, on-day-closed on day-closed ≥ 4.5 | 18 / 18 |
| 13 | `calendar-days` | 459-461 | both | day-standard vs day-closed ≥ 3 | 1 / 1 |
| 14 | `table-text` | 485-487 | both | on-table-X on table-X for free, seated, bill, clearing, reserved ≥ 4.5 | 5 / 5 |
| 15 | `table-dots` | 494-498 | both | success, danger on surface ≥ 3 | 2 / 2 |
| 16 | `station-text` | 532-545 | both | for each station fill: text, text-muted, warning, danger on it ≥ 4.5 | 60 / 60 |
| 17 | `station-dots` | 547-555 | both | for each station dot: on each station fill, then on surface ≥ 3 | 240 / 240 |
| 18 | `station-focus` | 559-566 | both | focus on each station fill, then on surface-lifted ≥ 3 | 16 / 16 |
| 19 | `button-text` | new | both | on-primary on primary ≥ 4.5 | 1 / 1 |
| 20 | `button-fill` | new | both | primary vs bg, surface ≥ 3 | 2 / 2 |
| 21 | `focus-ring` | new | both | focus vs bg, surface ≥ 3 | 2 / 2 |

Groups 1-18 total 377 light and 383 dark; Task 4 checks them, by name, comparison and bound,
against the old file.

- [ ] **Step 1: Write the failing tests.**

  `tokens.test.ts` — **the token-list guard** (spec lines 2226-2233):
  - "the theme writes exactly the colours that carry no meaning, less the scrim": the keys of `WAITRON_DEFAULTS.light` that start `--wt-color-`, prefix removed, filtered by the design's recount pattern (spec line 668: drop `/^(on-)?(station-|palette-|table-|day-|danger|success|warning|google-|highlight)/`) and less `scrim`, equal `[...THEME_COLOURS]` as sets, and `THEME_COLOURS` has 22 entries with no repeat. (A colour token added to `colors.css` that carries no meaning fails this test until it is either added to the theme or to the pattern; slice 8's `--wt-color-logo-plate` will, by design — see "Left for later slices".)
  - "every token the theme writes is declared in both modes": each of the 22 colour tokens is a key of `WAITRON_DEFAULTS.light` and `.dark`; each radius a key of `.structure`.
  - "the scrim and every meaning colour stay outside": `THEME_TOKENS` contains no `--wt-color-scrim`, nothing matching the meaning pattern, and nothing from `structure.css` but the three radii.
  - `THEME_TOKENS` is the 22 colour tokens then the 3 radii; `cornerRadii("standard", WAITRON_DEFAULTS)` equals `{ "--wt-radius-sm": "4px", "--wt-radius-md": "8px", "--wt-radius-lg": "16px" }` (`structure.css:9-11`), `"square"` 0/2/4 px and `"round"` 8/14/24 px.

  `contrast-rules.test.ts`:
  - each group's size per mode is the table's last column; `allRules("light").length` 382, `("dark")` 388.
  - "Waitron's own palette passes every rule": `checkRules(allRules(mode), (n) => WAITRON_DEFAULTS[mode][n])` has no failure, in both modes (the run printed `failing on Waitron defaults []` for the 98 / 103 theme rules; `colors.test.ts` passes for the rest).
  - "every rule bites": for each rule of `allRules(mode)`, a copy of Waitron's values with `a` set to `b`'s value (at-least, above) — or, for at-most, `a` set to `#000000` when `relativeLuminance(b) > 0.18`, else `#ffffff` — makes that rule fail.
  - `passes`: at-least 4.5 passes at exactly 4.5; above 1.1 fails at exactly 1.1; at-most 1.5 passes at exactly 1.5.
  - `THEME_RULES[mode]` equals `allRules(mode)` filtered to rules naming a `THEME_COLOURS` token, and has 98 light and 103 dark rules (`count-exact.mjs`).
  - `failureLabels` gives the shape above for a failing result and nothing for a passing one.

  `sources.test.ts` — **the purity guard**, weaker than its name (it reads source text, so an
  import built at run time or a global reached through another name passes it): with
  `import.meta.glob(["./*.ts", "!./*.test.ts"], { query: "?raw", import: "default", eager: true })`
  (the shape `packages/shared/src/conventions.test.ts:18-22` uses):
  - every `from "…"` and `import("…")` specifier in each source is `./<name>.js`, except that `waitron.ts` alone may also import `../tokens/colors.css?raw` and `../tokens/structure.css?raw`;
  - no source imports `./waitron.js` (tests may);
  - no source matches `/\b(document|window|customElements)\s*\.|\bgetComputedStyle\s*\(|\bHTMLElement\b/` — a member access or a call, so the word "document" in a comment (the design's word for the stored choices) does not trip it.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/tokens.test.ts src/theme/contrast-rules.test.ts src/theme/sources.test.ts`
  — FAIL, `./tokens.js` and `./contrast-rules.js` do not resolve (`sources.test.ts` may pass:
  colour, defaults, waitron and index already follow its rule).

- [ ] **Step 3: Implement** `tokens.ts` and `contrast-rules.ts` from the interfaces and the table.
  Export both from `index.ts`.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Prove the guards by deletion.**
  - Add `"scrim"` to `THEME_COLOURS`: `tokens.test.ts` FAILS on the set comparison and on "stay outside". Remove `"stepper-button"`: FAILS on the set comparison and the length. Restore.
  - Add `import { html } from "lit";` to `tokens.ts`: `sources.test.ts` FAILS naming `tokens.ts` and the `lit` specifier. Add `import "./waitron.js";` to `index.ts`: FAILS naming `index.ts`. Add the comment `// the theme's document` to `tokens.ts`: still PASSES (the control for the word check). Restore.
  - Delete one rule (station `red` dot on `surface`) from group 17: the group-size test FAILS (light 239). Restore.

- [ ] **Step 6: Mutation, measured** (Global constraints): record the score and survivors.

- [ ] **Step 7: Commit** — `git commit -s -m "List the contrast rules once, and the tokens a theme may write"`, recording step 5's controls and step 6's score.

---

### Task 4: `colors.test.ts` runs the shared rules, and nothing is lost

**Files:** Modify `src/tokens/colors.test.ts`. Throwaway (never committed):
`src/tokens/census-old.json`, `src/tokens/census.test.ts`.

**Interfaces — Consumes:** `rulesIn`, `checkRules`, `failureLabels`, `allRules`, `RuleKind`
(Task 3).

What stays exactly as it is: every test that asserts no ratio — `:39-132` (the contract, the
schemes, the nested root), every "the OS preference gives … the same value(s)" test, "every field
token is set" (`:200`), the two field-token preference tests (`:231-249`), the Google button's exact
colours (`:393-401`), the calendar palette's distinct values (`:455-458`), the table and station
fills' distinct values (`:489-492`, `:568-574`), the CIEDE2000 tests (`:589-679`) with their `lab`
helper and its own hex assertion (`:591`).

**The census is taken by token name, comparison and bound** (plan review M2: a census of values
cannot see `focus` written where the old file has `primary`, because the two share a value in both
modes). It uses the plan review's harness, copied to `~/waitron-campaign/a841-plan1-probes/census/`:
`run.mjs` runs a copy of `colors.test.ts` in Node with `vitest`, `vitest/browser` and the token
helper stubbed — `token()` returns `value|name`, `ratio` records the two names and the mode, and an
`expect` stand-in records the matcher (`toBeGreaterThanOrEqual` → `>=`, `toBeGreaterThan` → `>`,
`toBeLessThanOrEqual` → `<=`) and its bound — and writes `census.json`, one
`[a, b, mode, comparator, bound]` per comparison. Run on 2026-10-20 it printed
`total 760 light 377 dark 383`; its control, `cmp-control.mjs`, writes `focus` for `primary` in
"primary on field-fill" and the comparison prints that rule in both `onlyOld` and `onlyProto`,
per mode. The harness reads files beside it, never the tracked ones.

- [ ] **Step 1: Check the harness's copy is the file being moved.** In the census folder,
  `diff colors.test.ts <(git -C <worktree> show HEAD:packages/ui-core/src/tokens/colors.test.ts)`
  shows only the three import lines (`vitest-browser`, `./token-test-helpers.ts`, `./index.ts`) and
  the added `(globalThis as any).__last = …` line in `ratio`; `diff colors.css <worktree>/packages/ui-core/src/tokens/colors.css`
  prints nothing. Then `node run.mjs` prints `total 760 light 377 dark 383`. Copy `census.json` to
  `packages/ui-core/src/tokens/census-old.json`.

- [ ] **Step 2: Record the old file's test names.** `mkdir -p /tmp/a841-1`; with the file untouched:
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts --reporter=json --outputFile=/tmp/a841-1/colors-before.json`,
  then `jq -r '.testResults[].assertionResults[] | .fullName + " " + .status' /tmp/a841-1/colors-before.json | sort > /tmp/a841-1/names-before.txt`.
  Every line ends `passed`.

- [ ] **Step 3: Compare the new rules with the census, and its control.** Write the throwaway
  `src/tokens/census.test.ts`: for each mode, the multiset of `"<a and b sorted> <comparator>
  <bound>"` from `census-old.json` equals the same strings built from `allRules(mode)` restricted to
  groups 1-18 (at-least → `>=`, above → `>`, at-most → `<=`). Run it: PASS. Control: in
  `contrast-rules.ts` write `--wt-color-focus` for `--wt-color-primary` in group 4's "primary on
  field-fill": FAIL, the difference naming `--wt-color-field-fill --wt-color-primary >= 3` as only in
  the old file and `--wt-color-field-fill --wt-color-focus >= 3` as only in the new, in each mode.
  Change the bound of "text on track" to 4: FAIL naming `>= 4.5` and `>= 4`. Restore both.

- [ ] **Step 4: Rewire.** Delete `luminance` and `ratio` (`:14-24`). Add a helper
  `resolve(el)` returning `(token: string) => string` that reads `token(el, name)` and expects it to
  match `/^#[0-9a-f]{6}$/` — the hex check the old `luminance` made on every compared value
  (`:15`). Each ratio test keeps its name and `describe`/`each` shape, and its body becomes
  `expect(failureLabels(checkRules(rulesIn("<id>", theme), resolve(el)))).toEqual([])` for its
  group (the lifted test loops both modes as it does now; `disabled-fill` and `disabled-text` run in
  dark only, as `:339-359` do). The calendar "stand apart" test (`:453-462`) keeps its two
  distinctness assertions and replaces its `ratio` line with group `calendar-days`; the Google test
  (`:403-418`) becomes group `google-button`. Add one test, "Waitron's palette meets Waitron's own
  button rules", per mode, running groups `button-text`, `button-fill` and `focus-ring`.

- [ ] **Step 5: Run, and compare the names.**
  `pnpm --filter @waitron/ui-core exec vitest run src/tokens/colors.test.ts --reporter=json --outputFile=/tmp/a841-1/colors-after.json`,
  the same `jq | sort` into `names-after.txt`, and `diff names-before.txt names-after.txt`: the only
  lines are the added button-rules tests (`>`), and every line ends `passed`. Then delete
  `census.test.ts` and `census-old.json`.

- [ ] **Step 6: Prove the rewired file still bites.** In `colors.css`, change the light
  `--wt-color-track` value (in the block at `:1-123` and the forced block at `:243-357`) to
  `#f0f0f0`, run `colors.test.ts`: the "bar track (light)" test FAILS with a label naming
  `--wt-color-track on --wt-color-bg`. `git checkout` the CSS.

- [ ] **Step 7: Commit** — `git commit -s -m "Run the shared contrast rules in colors.test.ts"`. The
  message records: the census (760 comparisons, equal by name, comparator and bound) with its two
  controls, the names diff, and step 6.

---

### Task 5: The derivation for the main choices (brand colour, background, corners)

**Files:** Create `src/theme/derive.ts`, `src/theme/theme.ts`, `src/theme/derive.test.ts`; extend
`index.ts` (export `theme.ts`'s public names, not `derive.ts`) and `waitron.ts` (`deriveTheme`).

**Interfaces — Consumes:** Tasks 1-3. **Produces:**

```ts
// theme.ts
export type Background = "neutral" | "tinted";
export interface ThemeChoices {
  readonly brandColor: string | null; // null = "Waitron's"
  readonly brandFix: Readonly<Partial<Record<Mode, true>>>;
  readonly background: Background;
  readonly corners: Corners;
  readonly handSet: Readonly<Record<Mode, Readonly<Partial<Record<ThemeColour, string>>>>>;
}
export const WAITRON_CHOICES: ThemeChoices; // null, {}, "neutral", "standard", { light: {}, dark: {} }
export type WarningField = "brandColor" | `handSet.${Mode}.${ThemeColour}`;
export interface ThemeWarning { readonly field: WarningField; readonly mode: Mode;
  readonly against: readonly string[]; readonly fix: string | null; // against: keys without --wt-color-
  readonly blockedBy: readonly string[] } // hand-set keys blocking every shade when fix is null; else []
export interface DerivedTheme {
  readonly light: Readonly<Record<string, string>>; // keys exactly THEME_TOKENS, in that order
  readonly dark: Readonly<Record<string, string>>;
  readonly warnings: readonly ThemeWarning[];
  readonly tintStrength: Readonly<Record<Mode, number>> | null; // null for Neutral; 0..1 in tenths
}
export function normaliseChoices(choices: ThemeChoices): ThemeChoices;
export function deriveThemeFrom(defaults: WaitronDefaults, choices: ThemeChoices): DerivedTheme;

// waitron.ts
export function deriveTheme(choices: ThemeChoices): DerivedTheme; // deriveThemeFrom(WAITRON_DEFAULTS, …)

// derive.ts (internal)
export function brandFixShade(brand: string, mode: Mode, grounds: readonly string[]): string;
  // until(brand, dark ? +1 : -1, grounds, 3): the one place the fix's shade is worked out
export interface ModeResult { readonly tokens: Record<string, string>; // the 25, filled from defaults
  readonly failures: readonly RuleResult[]; readonly tintStrength: number }
export function settleMode(defaults: WaitronDefaults, choices: ThemeChoices, mode: Mode,
  hand: Readonly<Record<string, string>>): ModeResult; // hand: full token names; {} in this task
```

`blockedBy` is `[]` in every warning until Task 8. In this task `normaliseChoices` lower-cases `brandColor` (throwing `RangeError` on anything but
`#rrggbb`) and drops `brandFix` entirely when `brandColor` is `null`; Task 7 extends it.
`warnings` is `[]` until Task 6.

- [ ] **Step 1: Write the failing tests** in `derive.test.ts` (values from `output-h1.txt`,
  `output-ex4.txt` and `output-tint-contrived.txt`; titles in English, as Global constraints say):
  - **Waitron's look:** `deriveTheme(WAITRON_CHOICES)` — for each mode, every token equals `WAITRON_DEFAULTS[mode]` (colours) or `.structure` (radii); `tintStrength` `null`.
  - **Waitron's brand, Tinted:** tokens differing from Waitron's values number 6 light and 8 dark (the run printed `0 0 6 8` for Neutral light, Neutral dark, Tinted light, Tinted dark); none of the `BRAND_FAMILY` tokens differs; `tintStrength` `{ light: 1, dark: 1 }`.
  - **The dark-green brand** (Bar Lucía: `#1e5b3a`, Tinted, Round): light `--wt-color-primary` `#1e5b3a`, `--wt-color-on-primary` `#ffffff` (ratio `.toFixed(2)` `"8.04"`), `--wt-color-bg` `#f0f9f3`; dark as picked `--wt-color-primary` `#1e5b3a`, `--wt-color-bg` `#0b110d`, `--wt-color-surface` `#141b17`, `--wt-color-field-fill` `#202923`; radii 8/14/24 px.
  - **The dark-green brand with `brandFix.dark`:** dark primary `#417c59`, on-primary `#ffffff` (`"4.94"`), bg `#0b110d`; light unchanged from the line above.
  - **The lemon brand** (Café Limón: `#f2d300`, Neutral): light primary `#f2d300`; with `brandFix.light`, light primary `#9f8b18`, on-primary `#000000` (`"6.18"`), primary on `#ffffff` `"3.40"`, on the page `"3.17"`; dark primary `#f2d300` either way.
  - **Waitron's blue typed as a custom colour** (`#1f6feb`, Neutral): dark primary `#1f6feb`, on-primary `#ffffff`, primary-text `#67a0fd` — not Waitron's dark `#4c8dff` (`colors.css:136`).
  - **The list never changes:** `Object.keys(theme[mode])` equals `THEME_TOKENS` for each case above.
  - **The tint gives way** (a contrived palette; no real input does — 8,192 brand colours and the 352 hand-sweep cases never weakened it, `tint-probe.mjs`, `tint-probe-hand.mjs`): `deriveThemeFrom` with light `--wt-color-track` `#d0d0d0` and `--wt-color-text` `#585858` over `WAITRON_DEFAULTS`, the dark-green brand Tinted: `tintStrength.light` `0.6`, light track `#cacfcb`, bg `#f3f8f5`; the control, the real palette, `1`.
  - **A tinted case compared token by token:** for the dark-green brand, Tinted, every one of the 25 light and 25 dark tokens equals the reference's (`tinted-full.mjs` writes them to `output-tinted-full.txt` — Task 9's procedure for a new pinned value; write it in this task).
  - **Review Focus 1:** `brandColor: "#1E5B3A"` gives a theme deep-equal to `"#1e5b3a"`'s; `"#1e5"` and `"1e5b3a"` throw `RangeError`.
  - **Review Focus 4:** `{ ...WAITRON_CHOICES, brandFix: { light: true, dark: true } }` gives exactly Waitron's values.
  - **Review Focus 5:** a deep-frozen choices object derives without throwing, and two calls deep-equal.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/derive.test.ts` — FAIL, `./theme.js` does not resolve.

- [ ] **Step 3: Implement.** In `derive.ts` port `until` (`derive-h2.mjs:81-89`), `deriveAt`
  (`:152-206`, with `adjust` removed: the fix is taken only when `brandColor` is set and
  `brandFix[mode]` is true, its shade from `brandFixShade`), `TINTED` (`:227-230`), and `settle`'s
  step 1 (`:243-256`): the tint from full strength down in tenths, keeping the first strength at
  which no failing rule is between colours Waitron works out with one of them tinted, rules naming
  the brand colour as picked excluded. Rules come from `THEME_RULES[mode]`; colours missing from a
  mode's tokens are read from `defaults`. `theme.ts` runs both modes and fills the 25 tokens.

- [ ] **Step 4: Run, expect pass.**

- [ ] **Step 5: Commit** — `git commit -s -m "Work out a theme's light and dark colours from the brand colour, background and corners"`.

---

### Task 6: The brand colour's warning and fix, and the brand sweep

**Files:** Create `src/theme/warnings.ts`, `src/theme/brand-warnings.test.ts`,
`src/theme/brand.sweep.test.ts`. Modify `theme.ts`, `vitest.config.ts:76`.

**Interfaces — Consumes:** `settleMode`, `ModeResult`, `brandFixShade` (Task 5). **Produces:**
`warningsFor(defaults: WaitronDefaults, choices: ThemeChoices, mode: Mode, settled: ModeResult): ThemeWarning[]`
(internal), wired into `deriveThemeFrom`'s `warnings`.

The brand colour warns in a mode when it is set, not set by hand for that mode, and a rule naming
`--wt-color-primary` fails on the settled colours. `against` is the other colour of each such rule,
in rule order, de-duplicated, without the prefix. `fix` is `brandFixShade(brandColor, mode, [bg,
surface, surface-raised, field-fill])` on the settled colours — the same function the painting
path calls — kept only if deriving again with `brandFix[mode]` leaves no rule naming the primary
failing; otherwise `null` (port `derive-h2.mjs:333-351`, the brand half).

- [ ] **Step 1: Write the failing tests** in `brand-warnings.test.ts`:
  - **The lemon brand as picked:** `warnings` is exactly `[{ field: "brandColor", mode: "light", against: ["field-fill", "bg", "surface"], fix: "#9f8b18" }]`; the three ratios `"1.32"`, `"1.39"`, `"1.49"`. With `brandFix.light`: no warning, light primary `#9f8b18` — the shade the warning offered.
  - **The dark-green brand as picked:** `[{ field: "brandColor", mode: "dark", against: ["field-fill", "bg", "surface"], fix: "#417c59" }]`, ratios `"1.86"`, `"2.37"`, `"2.18"`. With `brandFix.dark`: no warning.
  - **The burgundy brand** (`#7a1f2b`, Tinted): dark warning with fix `#b05157`; with `brandFix.dark`, none.
  - **The control:** Waitron's blue typed as `#1f6feb` warns in neither mode; `WAITRON_CHOICES` warns in neither.
  - **Review Focus 3:** the dark-green brand with `brandFix.light` (where nothing warns): light primary `#1e5b3a`, no warning.

  `brand.sweep.test.ts` — the 216 colours of the 0/51/…/255 grid × Neutral, Tinted, one `test` per
  colour and background (so the browser's event loop gets a turn between them). For each, as picked
  and per mode: every failing rule of `THEME_RULES[mode]` on the output names
  `--wt-color-primary`; a failing mode has exactly one `brandColor` warning, its `fix` not `null`;
  tint `1` when Tinted. Then with `brandFix` set for each warned mode: no warning, no failing rule,
  the primary is the offered fix, tint `1`, keys `THEME_TOKENS`. A last test checks the totals the
  reference printed (`sweep-warn-exact.mjs brand`, `sweep-fixed.mjs`): 864 cases, 360 warnings,
  brands warning on light 111 of 216 and on dark 73 of 216, 0 without a fix, 0 failing after the
  fix, 0 unexplained, 0 tint weakened. (Counts are pinned so that a porting fault anywhere in the
  grid shows; they change only if the algorithm deliberately does.)

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/brand-warnings.test.ts src/theme/brand.sweep.test.ts`
  — FAIL: `warnings` is `[]`.

- [ ] **Step 3: Implement `warnings.ts`'s brand half** and wire it in. In `vitest.config.ts:76`
  add, as `packages/shared/vitest.config.ts:14` does, `src/theme/*.sweep.test.ts` and
  `src/theme/sources.test.ts` to `exclude` only when `process.env.STRYKER_MUTATOR_WORKER` is set:
  under Stryker every mutant of the theme would run the sweeps, and the source-text test would read
  instrumented copies. Source stays mutated and measured.

- [ ] **Step 4: Run, expect pass.** Note the sweep file's duration from the run's output.

- [ ] **Step 5: Prove by deletion** (spec lines 2287-2290). Make `brandFixShade` return `brand`
  unmoved. Expected: the lemon brand's warning has `fix: null`, not `#9f8b18` (deriving again with
  the flag leaves the primary failing); with `brandFix.light` the light primary is `#f2d300`,
  standing `"1.39"` on the page; the sweep's totals FAIL too. (The plan review ran this deletion on
  a copy of the reference with one shared search, `AB.mjs`: `null`, and 1.39.) Restore.

- [ ] **Step 6: Mutation, measured** (Global constraints).

- [ ] **Step 7: Commit** — `git commit -s -m "Warn when the brand colour is hard to read, and offer its fix"`, recording step 5, the sweep's duration and step 6's score.

---

### Task 7: Colours set by hand: fixed inputs, the button colour's family, worked-out colours moving

**Files:** Modify `derive.ts`, `theme.ts`. Create `src/theme/hand-set.test.ts`.

**Interfaces — Consumes:** Tasks 5-6. **Produces:** `settleMode`'s `hand` now honoured;
`normaliseChoices` extended.

`normaliseChoices` now also lower-cases every hand-set value (throwing `RangeError` on anything but
`#rrggbb`), throws `RangeError` naming any hand-set key outside `THEME_COLOURS`, and drops
`brandFix[mode]` when `handSet[mode].primary` is set (port `normalise`, `derive-h2.mjs:146-150`; spec
lines 493-497 and 2068-2069). In `derive.ts`: hand-set values are fixed inputs to `deriveAt`; a
hand-set `primary` is the colour the whole `BRAND_FAMILY` is worked out from, even with
`brandColor: null`; step 1 skips any rule naming a hand-set colour; step 2 is ported from `settle`
(`:257-282`): a worked-out colour named in a failing rule moves — never `--wt-color-primary`, never a
meaning colour, never for a rule naming the brand colour as picked — when moving it alone passes
that rule (by `passes`) and leaves fewer rules failing; at most 60 rounds. (Fix round 1, ruling I2:
nor when it newly fails a rule naming no owner-picked colour — the reference traded one there, e.g.
dark `bg` moved for a hand-set line and broke `google-button-line` on it; `random.sweep.test.ts` holds it.)

- [ ] **Step 1: Write the failing tests** in `hand-set.test.ts` (values from `output-h1.txt`,
  `output-ex4.txt`, `output-ex5.txt`, `output-within.txt`):
  - **The cream page** (dark-green brand, Tinted, `brandFix.dark`, light `bg` `#f8f1e1`): light bg exactly `#f8f1e1`; primary `#1e5b3a` (`"7.14"` on the cream), primary-text `"7.14"`, text `"15.78"`, track `"1.42"`; surface-lifted `#d3ecdb` (moved from the `#d8f1e0` it is without the cream); no warning; tint 1. The dark tokens deep-equal those with nothing set by hand.
  - **The burgundy brand keeping the cream** (`#7a1f2b`, Tinted, light `bg` `#f8f1e1`, no fix): light surface-lifted `#fce0e0`, surface-sunken `#e2d6d6`, field-fill `#f7eeed`, white on the button `"10.20"`, button on cream `"9.07"`, no light warning; without the hand-set page the light bg is `#fff3f3` ("Use worked-out colour").
  - **Waitron's brand, light Main buttons `#7a1f2b`:** primary-hover `#67081c`, primary-text and focus `#7a1f2b`, surface-lifted `#fee2e2`, no warning. With dark Main buttons `#9e4048` (the fix Task 8 offers for a dark `#7a1f2b`), dark primary-hover `#8a2e38`.
  - **The dark version's own button colour** (dark-green brand, Tinted, no fix, dark `primary` `#5fa77a`): dark on-primary `#001206` (`"6.70"`), primary on the dark page `"6.63"`, bg `#0b110d`, primary-hover `#72ba8c`, primary-text `#6ab284`; no rule failing in dark; every light token equal to the theme without it. The control that light reads its own hand-set values: the same `#5fa77a` set for light changes 8 light tokens. The control for the warning: the same theme with neither a fix nor an own colour has 3 dark rules failing.
  - **A fix dropped under a hand-set button** (spec lines 2302-2305; dark-green brand, `brandFix.dark`, dark `primary` `#5a9c74`): `normaliseChoices` drops `brandFix.dark`; dark primary `#5a9c74`. Removing the hand-set value from the normalised choices ("Use worked-out colour") gives dark primary `#1e5b3a` and the brand colour's dark warning again, fix `#417c59`.
  - **The at-most move:** dark-green brand, `brandFix.dark`, dark `surface` `#000000`: dark primary-disabled `#1a3023`.
  - **Review Focus 1:** a hand-set `"#F8F1E1"` gives the same theme as `"#f8f1e1"`; a hand-set `"#fff"` or `"f8f1e1"` throws `RangeError`.
  - **Review Focus 2:** a hand-set `scrim` or `danger` throws `RangeError` naming the key.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/hand-set.test.ts` — FAIL: the hand-set
  values are ignored (light bg `#f0f9f3`, not `#f8f1e1`).

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run, expect pass**, and re-run Tasks 5 and 6's files: unchanged (with nothing set
  by hand no worked-out colour ever moved — 1,736 brand cases, `moves-probe.mjs`).

- [ ] **Step 5: Commit** — `git commit -s -m "Keep colours set by hand and work the rest out around them"`.

---

### Task 8: Hand-set warnings and fixes, Fix all, and the hand sweeps

**Files:** Modify `warnings.ts`, `theme.ts`, `index.ts`. Create `src/theme/hand-warnings.test.ts`,
`src/theme/hand.sweep.test.ts`.

**Interfaces — Consumes:** Tasks 5-7. **Produces:** hand-set entries in `warnings`, and:

```ts
// theme.ts
export function fixAll(defaults: WaitronDefaults, choices: ThemeChoices): ThemeChoices;
export function canFixAll(defaults: WaitronDefaults, choices: ThemeChoices): boolean;
  // deriveThemeFrom(defaults, fixAll(defaults, choices)).warnings.length === 0: whether the Save
  // dialog offers Fix and save (lane A ruling 2026-10-20)
// warnings.ts
export type AgainstItem =
  | { readonly kind: "colour"; readonly key: string }
  | { readonly kind: "station-fills" | "station-dots"; readonly count: number };
export function groupAgainst(against: readonly string[]): AgainstItem[];
```

**The warning.** A hand-set colour named by a rule still failing after settling warns; a rule
between the brand colour and a hand-set colour is the hand-set colour's warning only (the brand's
warning counts rules whose other colour is not hand-set). Port `names` and the refusal half of
`deriveHand` (`derive-h2.mjs:283-323`, with `moveHand` false).

**The fix — searched for each warned colour on its own** (plan review H1; design section 6 step 3,
spec lines 1112-1138): port `fixFor` (`derive-h2.mjs:366-382`). With the brand colour as picked,
the stored fix flags, and **every other hand-set value as typed**, try the warned colour's hue at
lightness 0 to 1 in hundredths, nearest to its own first; skip a lightness at which a rule between
it and a colour that cannot move (a meaning colour or another hand-set value) fails; accept the
first at which, after settling, no rule names it, no rule between worked-out colours fails, and no
other hand-set colour is named that was not named before. None accepted → `fix: null`.
(Fix round 1, ruling I1: a rule naming the brand colour as picked — no fix flag in that mode — is not
"between worked-out colours", so a brand warning never takes a hand-set colour's fix away.) So a fix
taken alone always clears its own warning, and `null` means no shade of that colour works while the
others stay as typed — which another hand-set colour can cause.

**Fix all** — port `fixAll` (`derive-h2.mjs:386-400`), per mode: derive; in rule order, find the
first failing rule that names a colour whose warning has a fix; take the fix of the rule's `a`
(drawn on top) if it has one, else of its `b` (a brand fix sets `brandFix[mode]`, a hand-set fix
replaces that value); derive again; stop when no warning has a fix (at most 50 rounds).

**`blockedBy`** (lane A ruling 2026-10-20; spec lines 1875-1887) — port `blockersOf`
(`derive-h2.mjs:406-414`): empty for a warning with a fix and for the brand colour's; for a hand-set
warning with no fix, the other hand-set colours each of which, worked out instead, would give it a
fix; if none alone would but working out all of them would, every other hand-set colour that shares
a rule with it; otherwise empty.

**`canFixAll`** (lane A ruling 2026-10-20; spec lines 1829-1840) — whether Fix and save is offered:
run `fixAll` and derive again; `true` exactly when no warning is left. The dialog's Fix and save
applies `fixAll`.

**`groupAgainst`** — the design's new product-text row (spec line 615; lane A ruling 2026-10-20,
fills and dots alike): `station-<colour>` keys
become one `station-fills` item and `station-<colour>-dot` keys one `station-dots` item, each with
its count, placed where its first member was; every other key stays a `colour` item.

- [ ] **Step 1: Write the failing tests** in `hand-warnings.test.ts`:
  - **The sage secondary text** (dark-green brand, `brandFix.dark`, light `bg` `#f8f1e1` and `text-muted` `#8fa898`): one warning, `field` `"handSet.light.text-muted"`, `fix` `"#526a5b"`, `against` `surface-lifted`, `field-fill`, `field-fill-disabled`, then the 15 station fills (`station-red` … `station-brown`) — 18 names; the ratios on the first three `"2.04"`, `"2.24"`, `"2.38"`; no warning for `handSet.light.bg`; tint 1; field-fill `#ebf2ed`. With `#526a5b` set instead: no warning, ratios `"4.70"`, `"5.17"`, `"5.49"`, and `4.54` to `5.11` on the station fills (`output-sage-stations.txt`). `groupAgainst` of its `against` is `[colour surface-lifted, colour field-fill, colour field-fill-disabled, station-fills 15]`.
  - **Pure blue cards** (light `surface` `#0000ff`): `handSet.light.surface` warns with fix `#e2ecff`, 22 names in `against`, every station dot among them; with the fix, nothing fails. `groupAgainst` gives 8 items: `field-line`, `primary-text`, `google-button-line`, `success`, `danger`, `station-dots 15`, `primary`, `focus`.
  - **Two hand-set colours failing one rule** (plan review H1; `two-hand.mjs ./derive-h1.mjs`): light `text` `#6a6a6a` and `surface-sunken` `#bbbbbb` — `handSet.light.text` fix `#4a4a4a` (its `against` holds `surface-sunken`, `track` and 12 station fills; `groupAgainst` gives `surface-sunken`, `track`, `station-fills 12`), and `handSet.light.surface-sunken` fix `#ebebeb`, not `null`. Taking only the text's fix: no warning. Taking only the sunken areas' fix: the sunken areas no longer warn, the text still does, now with fix `#5b5b5b`. `fixAll`: text `#4a4a4a`, sunken areas kept at `#bbbbbb`, no warning. The control (`two-hand.mjs ./derive-settle2.mjs`, the old rule): the sunken areas' fix was `null`.
  - **The brand colour against a hand-set colour** (light `surface` `#000000`): only `handSet.light.surface` warns (fix `#ebebeb`), and its `against` includes `primary` (`output-brand-vs-hand.txt`).
  - **Black dark cards** (dark `surface` `#000000`): `handSet.dark.surface` warns, fix `#040404`, `against` `["danger-disabled"]` — a meaning colour never moves.
  - **Waitron's brand, dark Main buttons `#7a1f2b`:** `{ field: "handSet.dark.primary", mode: "dark", against: ["field-fill", "bg", "surface"], fix: "#9e4048" }`.
  - **No shade passes, blocked by another hand-set colour** (spec lines 1875-1887; made up): light `text-muted` `#808080` with light `field-fill-disabled` `#000000` — `text-muted` must read on a black fill and on light ones. One warning, `handSet.light.text-muted`, `fix: null`, 17 names, `blockedBy: ["field-fill-disabled"]`. The control: `text-muted` `#808080` alone gets fix `#636363` (`ex2.mjs`, `ex3.mjs`).
  - **Ruling 3, the blocker named** (`blocked.mjs`, `output-blocked.txt`): light `text` `#aaaaaa` with `surface-sunken` `#000000` — `handSet.light.text`, `fix: null`, `blockedBy: ["surface-sunken"]`. Two blockers together (`blocked2.mjs`): `text` `#aaaaaa` with `surface-sunken` and `track` both `#000000` — neither alone frees it — `blockedBy: ["surface-sunken", "track"]`. **No blocker, the sentence unchanged:** `deriveThemeFrom` over a contrived palette with light `--wt-color-station-red` `#000000` and `--wt-color-station-orange` `#ffffff`, light `text` `#808080` alone — `fix: null`, `blockedBy: []`. Every warning with a fix, in every case of this file, has `blockedBy: []`.
  - **Ruling 2, Fix and save** (`fix-and-save-cases.mjs`, `output-fix-and-save-cases.txt`): light `text` `#555555` with `surface-sunken` `#555555` — the text has no fix (`blockedBy: ["surface-sunken"]`), the sunken areas' fix is `#cacaca`; `canFixAll` is `true`, and `fixAll` gives sunken areas `#cacaca`, text kept, no warning. The control: `text` `#aaaaaa` with `surface-sunken` `#555555` — the sunken areas' fix is `#3d3d3d`; `canFixAll` is `false`, and after `fixAll` the text still warns with no fix, blocked by the sunken areas.
  - **Ruling 1, dots grouped:** the pure-blue-cards case above, whose `groupAgainst` holds one `station-dots 15` item (and the sage's, one `station-fills 15`).

  `hand.sweep.test.ts`:
  - **One colour at a time:** the dark-green brand (Tinted, `brandFix.dark`), each of the 22 colours set by hand in turn, for one mode, to each of `#000000 #0000ff #00ff00 #00ffff #ff0000 #ff00ff #ffff00 #ffffff`; one `test` per mode and colour. Per case: every failing rule names a hand-set colour or the brand colour (none unexplained); no `brandColor` warning; every warning has a fix; `fixAll` leaves no warning and nothing failing. A last test checks the reference's totals (`sweep-warn-exact.mjs hand light` / `dark`): light 176 cases, 87 with no warning, 89 with a hand-set warning; dark 176, 78 and 98; 0 without a fix, 0 unexplained, 0 failing after Fix all.
  - **Two colours at a time** (light only, to keep the run short): the same theme; the pairs `text`/`surface-sunken`, `text`/`track`, `field-value`/`field-fill`, `text-muted`/`field-fill-disabled`, `primary-text`/`bg`, `field-line`/`surface`, `focus`/`surface-lifted`, `track`/`bg`, each colour set to `#555555` or `#aaaaaa` (32 cases); one `test` per pair. Per case: none unexplained; each warning with a fix, taken alone, clears that warning; after `fixAll` no warning has a fix and nothing is unexplained. Totals (`two-hand-sweep.mjs ./derive-h1.mjs "#555555,#aaaaaa" light`, `output-two-hand-sweep-light-mid.txt`): 32 cases, 61 warnings, 20 without a fix, 0 unexplained, 0 fixes leaving their own warning, 0 warnings with a fix after Fix all, 7 cases still warning after Fix all (each such warning without a fix); and, for ruling 2, `canFixAll` true in 25 cases — 15 where every warning has its own fix and 10 where one has none but Fix all clears everything — and false in the 7 (`fix-and-save.mjs`, `output-fix-and-save.txt`). The reference took 4.1 to 7.1 s for these 32 in Node.

- [ ] **Step 2: Run, expect failure.**
  `pnpm --filter @waitron/ui-core exec vitest run src/theme/hand-warnings.test.ts src/theme/hand.sweep.test.ts`
  — FAIL: no hand-set warning is produced, and `fixAll`, `canFixAll` and `groupAgainst` do not exist.

- [ ] **Step 3: Implement.** Export `fixAll`, `canFixAll` and `groupAgainst` from `index.ts`.

- [ ] **Step 4: Run, expect pass**; re-run every file under `src/theme/`. Note the sweep's duration.

- [ ] **Step 5: Prove by deletion.**
  - Let the brand's warning count every rule naming the primary, hand-set or not: the "brand colour against a hand-set colour" case FAILS with an extra `brandColor` warning (the plan review's `C.mjs`: an extra warning with `fix: null`). Restore.
  - Search only the colour drawn on top (the old rule): the two-colour case FAILS — the sunken areas' fix is `null`. Restore.
  - Make `blockersOf` return `[]`: the three "blocker named" cases FAIL; the no-blocker case still passes (its control). Restore.
  - Make `canFixAll` return whether every warning has a fix (the old rule): the `#555555` / `#555555` case FAILS (`false`); its control still passes. Restore.
  - Group only the station fills: the blue-cards `groupAgainst` case FAILS with 15 separate dot items. Restore.

- [ ] **Step 6: Mutation, measured** (Global constraints).

- [ ] **Step 7: Commit** — `git commit -s -m "Warn when a colour set by hand is hard to read, offer its fix, name what blocks it, and fix them all"`, recording step 5, the duration and step 6's score.

---

### Task 9: Mutation survivors

**Files:** the theme test files; theme sources only where a code shape leaves a mutant no test can
tell apart.

The plan review ran Stryker 10 on the reference with this plan's pinned cases and no sweep
(`/tmp/a841-plan1-review/mut/`, 981 mutants, 1 min 47 s): 74.92% (724 killed, 11 timed out, 221
survived, 25 not covered). The port differs in shape, so that is an indication. The nightly job
gates the package-wide score (93.79 over 612 mutants on run 39373226000, read from `gh run view 39373226000 --log`); theme
files at 90 or above keep the package at 90 or above.

- [ ] **Step 1: Run** the mutation command (Global constraints) and list every survivor by file and
  line.
- [ ] **Step 2: Kill survivors with assertions on behaviour**, each value pinned by the procedure
  under "The reference" (run the reference, save the script and its output in the probes folder).
  The classes the review found, and the test shapes that reach them:
  - the colour lists (`THEME_COLOURS`, `TINTED`, `BRAND_FAMILY`): one small case per colour set by hand — one mode, one value each — asserting that value is kept exactly and the tokens that change, against the reference;
  - loop bounds and `<` / `<=` boundaries in `fromOklch`, `until`, `push`, the hover search and settling: a case whose answer sits on the boundary (for example a brand colour whose `until` stops on its last step);
  - the hover search's second direction and `-away`: a brand colour whose first direction fails;
  - `brandOwned`'s branches: brand set or not × Main buttons set by hand or not, per mode;
  - the at-most move: a case per side (surface and surface-raised, darker and lighter);
  - the fix search's pre-check and `against`: a case where the pre-check rejects the nearest lightness.
- [ ] **Step 3: A mutant no test can kill.** Prefer a code shape that has none (for example
  `while (C > …)` where a counted loop's count never binds). A mutant that is still equivalent is
  listed in the commit message and the ledger with why no input tells it apart. Never an exclude,
  an ignore comment or a `Stryker disable` (`git grep -n 'Stryker disable'` finds none today), and
  never a test that asserts nothing useful. If the theme files cannot reach 90 that way, stop and
  report to the driver with the list.
- [ ] **Step 4: Run again**: `All files` `% Mutation score` `total` at 90 or above; record it and
  the wall time. The nightly `mutation (ui-core)` job took 6 min 44 s on 2026-10-20 (run
  39373226000) against a 15-minute limit (`mutation.yml:35`); if the theme run alone takes more than
  6 minutes, report it to the driver rather than change the limit.
- [ ] **Step 5: Commit** — `git commit -s -m "Test the theme derivation until its mutation score holds"`, listing any equivalent mutant.

---

### Task 10: Coverage, the guards, and the docs pointer

**Files:** Modify `docs/developers/design-system.md` (one sentence).

- [ ] **Step 1: Coverage.** Check memory headroom, then `pnpm --filter @waitron/ui-core test:coverage`
  — read the per-file table: every `src/theme/*.ts` file listed, the package at or above
  98/98/98/95 (an uncovered branch gets a case, never an ignore comment). Record the run's wall
  time: the `test-ui` CI job, which runs `ui` and `ui-core` coverage together
  (`.github/workflows/ci.yml:1004-1072`), took 2 min 14 s to 2 min 32 s in its last three
  successful runs on `main` on 2026-10-20 (read with `gh run view <id> --json jobs`), against its
  4-minute target; report if the theme files add more than 30 s. Then
  `pnpm --filter @waitron/ui-core test:package`, `typecheck`, `lint`.

- [ ] **Step 2: The guards this slice must run** (each green, `Tests` count read):
  `pnpm exec vitest run scripts/style-token-names.test.ts scripts/guide-page-tokens.test.ts scripts/brand-icons.test.ts scripts/brand-build.test.ts scripts/coverage-thresholds.test.ts`
  (they read the token files or `ui-core`'s config:
  `git grep -ln 'colors.css\|structure.css' -- scripts` and the Vitest config change), and
  `pnpm --filter @waitron/layouts exec vitest run src/theme-registry.test.ts` (unchanged; still
  reads the token files). No new root guard: every guard this slice adds reads only `ui-core`'s own
  files, so it runs whenever `ui-core` is in scope.

- [ ] **Step 3: Claims about the moved rules.** `design-system.md` names cases in
  `colors.test.ts` at lines 87, 165, 175, 186, 197, 207, 250, 307, 328, 343 and 370; confirm each
  named case is still in `names-after.txt` (Task 4). Add, as the first paragraph under `### Colour`
  (`design-system.md:128`), one sentence: "The contrast rules the palette is held to are listed
  once, in `packages/ui-core/src/theme/contrast-rules.ts`: these cases run all of them against the
  browser's resolved tokens, and the theme derivation runs the ones that read a colour a theme
  writes against a venue's colours." (`docs/` is ignored by prettier, so
  `pnpm exec prettier --file-info docs/developers/design-system.md` prints `"ignored": true`.)

- [ ] **Step 4: Commit** — `git commit -s -m "Point the design system at the shared contrast rules"`.

---

## Driver steps (not implementer tasks)

- **`/finish-branch`** with this worktree's path and this plan's path. It runs in its own context.
  Do not merge; landing waits for the owner's `/land-branch`.
- **The backlog, at land time** (the last commit on the branch, right before `/land-branch`):
  replace the "Next: the build plan, 14 slices, only slice 2 adding a migration (design section
  16)." sentence of the A841 entry (`docs/backlog.md:3191-3201` on `main` `0f2788281`; find it by
  its text) with: "Slice 1 landed (#<PR>): the theme derivation, the contrast rules shared with
  `colors.test.ts`, the sweeps and the token-list guard, in `@waitron/ui-core/theme`. Next: slice 2
  (the stored themes and the server), which also decides how the server and its tsx scripts read
  the token files, makes `apps/server` depend on `@waitron/ui-core`, and deletes
  `packages/layouts/src/theme-registry.test.ts` with `THEMEABLE_TOKENS`." Commit with
  `git commit -s`.
- **Ruled by lane A, 2026-10-20** (the three questions the first review revision raised; recorded in
  the design's section 16): the station dots are grouped like the fills; Fix and save is offered
  when running Fix all would leave no warning and applies Fix all; a no-fix warning blocked by
  another colour set by hand names it. Each has its failing-first cases in Task 8.

---

## Left for slice 2 (named here so nothing is lost)

- **How the server reads the token files.** `waitron.ts` imports them as `?raw`, which Vite and
  Vitest handle and the server's two runners do not:
  - **tsx.** `apps/server`'s `dev` script starts `tsx watch … src/bin.ts`
    (`apps/server/scripts/dev-server.mjs:67`), and its `dev:setup`, `dev:reset`, `dev:onboard`,
    `dev:reset:onboard` and `demo:*` scripts run through tsx (`apps/server/package.json:19-36`).
    tsx 4.23.15 importing `./x.css?raw` failed with `SyntaxError: Unexpected token ':'` (the plan
    review's run, repeated for this revision in a fresh temporary folder; the control, the same
    file read with `readFileSync`, printed its text).
  - **The bundle.** `scripts/bundle-node.mjs:13-24` passes no `.css` loader to esbuild; without one a
    `?raw` CSS import becomes an empty object with exit 0 (Task 2's receipt), and `defaults.ts`'s
    `TypeError` makes that fail at start.
  - **Two ways, slice 2 decides:** (a) a server-side module that reads `colors.css` and
    `structure.css` from disk at a path resolved from the `@waitron/ui-core` package and passes the
    text to `readDefaults`, which works under tsx and, if the image ships the files, the bundle; or
    (b) a loader for both — `--loader:.css=text` for esbuild (measured to give the text) and a tsx
    loader hook. The derivation core needs neither: it imports no CSS.
- **The dependency.** `apps/server` does not depend on `@waitron/ui-core` today
  (`apps/server/package.json:41-76`), and `ui-core` declares `lit` as a peer
  (`packages/ui-core/package.json:49-51`); slice 2 adds the dependency and checks the peer warning
  and `scripts/workspace-cycles.test.ts`.
- **The old guard.** `packages/layouts/src/theme-registry.test.ts:15-20` checks `THEMEABLE_TOKENS`
  (`packages/layouts/src/theme.ts:12-20`), which slice 2 retires; `tokens.test.ts` (Task 3) is its
  replacement, so slice 2 deletes the file (spec lines 2226-2233, as corrected in this branch).
- **The stylesheet.** Building section 7's three-block sheet from `DerivedTheme` is slice 2's
  (`/api/theme`), as is validating the document (`theme.invalid`).

## Left for later slices

- **Slice 8** adds `--wt-color-logo-plate`, a colour no theme writes: `tokens.test.ts`'s
  "exactly the colours that carry no meaning" fails until the plate is added to the pattern of
  colours outside the theme. That failure is the guard working.
- **Slices 10 and 11** add the four sizes, three weights and `--wt-font-family` to the written list
  (spec line 2250): `THEME_TOKENS`, its tests and the "list never changes" assertions change with
  them.

## Changed test checks

- Every ratio-asserting test in `colors.test.ts` (one per group 1-18, run per mode where it was)
  keeps its name and asserts the same rules — by token name, comparison and bound — through its
  shared group (Task 4's census and names diff). The luminance cut-off moves from 0.03928 to
  0.04045 with no `#rrggbb` changing ratio (Global constraints). Nothing else in the repository
  changes an assertion.
