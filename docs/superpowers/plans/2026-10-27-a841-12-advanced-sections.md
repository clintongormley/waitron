# A841 slice 12 — Advanced in sections: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`; one that passes about 150 tool calls with its task unfinished stops at a passing (or cleanly red) point, commits, and returns a handover (what is done, what is left, the files, each check's state).

**Goal:** In the Look card's editor, Advanced holds five folding sections — Page and surfaces, Text
colours and links, Buttons, Fields and focus, and Text — each closed when Advanced opens, each
with a closed line saying what in it is set by hand and how many of its values are hard to read; a
section holding an error opens itself; a section stays as the manager left it until the editor
closes and is closed again the next time; and **Pick a different colour for dark screens** opens
the Buttons section.

**Architecture:** One new data module (`advanced-sections.ts`) says which colours each section
holds and which warnings it counts; `theme-words.ts` words a section's closed line. The existing
element `dashboard-theme-advanced` keeps its outer `wt-disclosure` and draws the five sections
inside it, each its own `wt-disclosure`; the colour rows are drawn by the code that draws them
today, and the Text section's body is the existing `dashboard-theme-text`, unchanged. Open/closed
state lives only in the `wt-disclosure` elements, which the Look card already rebuilds for every
edit session (`keyed(this.#session, …)`), so nothing is stored. No change to `@waitron/ui`,
`@waitron/ui-core`, the server, the theme document or any route. **No migration** (design section
16: "Only slice 2 adds a migration", line 2521).

**Tech Stack:** Lit 3 in `apps/dashboard` (Vitest 4.1.x browser mode, real headless Chromium,
`apps/dashboard/vitest.config.ts`), the shared `wt-disclosure` (`packages/ui/src/components/wt-disclosure.ts`),
Markdown user guides served by `apps/server`.

**Spec:** `docs/superpowers/specs/2026-10-19-a841-theme-editor-design.md` — section 16 item 12
(lines 2628-2630) is the scope; section 16 item 6 (lines 2575-2578) is the focus change; section 5a
"Advanced, in sections" (lines 990-1015) is the detail; section 4 step 3 (lines 496-519) and the
product-text table (lines 596-599); section 15's browser list (lines 2473-2476); pictures 12, 13,
28 and 29 (section 18, lines 2922, 2938-2939). Earlier plans: slice 6
(`docs/superpowers/plans/2026-10-23-a841-6-advanced.md`, its D11, D13 and "Left for later slices",
line 1161) and slice 11 (`2026-10-27-a841-11-text-by-hand.md`, its D11 and "Left for later").

**Review path: FULL** (design section 16, lines 2518-2519 and 2645-2646). This slice touches no risk
trigger of its own; the design fixes the path for every slice.

---

## What main has now (receipts, main `16910205f`)

- **Advanced is one `wt-disclosure`** drawn by `dashboard-theme-advanced`
  (`apps/dashboard/src/widgets/theme-advanced.ts:358-399`): heading `appearance.advanced`, summary
  `advancedSummary(…)` (`:362`), `has-error` while any hand or text error has a message
  (`:363-365`); inside, the intro (`:367`), ONE column-head row marked `aria-hidden` (`:369-372`),
  the 22 colour rows in `THEME_COLOURS` order (`:373-380`; order at
  `packages/ui-core/src/theme/tokens.ts:4-27`), an `h3.text-group` "Text" (`:382`), the Text rows
  `dashboard-theme-text` (`:383-388`), and Reset all to worked-out (`:389-397`).
- **`reveal(mode, key)`** opens the outer disclosure and focuses that value's code field
  (`theme-advanced.ts:191-200`). The Look card's **Pick a different colour for dark screens** calls
  `reveal("dark", "primary")` (`apps/dashboard/src/screens/look-card.ts:743-757`, the call at
  `:753`).
- **A new element per edit session:** the card renders the section inside
  `keyed(this.#session, …)` (`look-card.ts:1070-1088`); `#session` is raised in `#begin`
  (`:337-338`, `:420`). `#adopt`, a newer read of the same theme, does not call `#begin`
  (`look-card.ts:463-475`), so it keeps the element.
- **Errors:** the card passes `.errors` (hand-set code errors and a refused hand field) and
  `.textErrors` (`look-card.ts:651-669`, `:1075-1076`); Save's failed check calls
  `#focusInvalid` → `focusFirstInvalid(form)` (`look-card.ts:803-824`, `:923-927`), which walks
  open shadow roots and light children in document order, waiting for each pending Lit render
  (`packages/ui-core/src/interactive.ts:52-66`).
- **`wt-disclosure`:** `has-error` forces `open` (`wt-disclosure.ts:211-219`) and makes the header
  inert (`:259-266`); a cleared error leaves it open (`:212-213`); the body is `hidden` and `inert`
  while closed (`:306-315`); the summary shows only while closed (`:302`). A click on an inner
  section's header does not toggle the outer one because each disclosure listens on its own header
  button (`:299`), which an inner click's path never passes through (the `stopPropagation` at
  `:261` is not what prevents it, and is skipped while `has-error`). An inner section's `wt-toggle`
  bubbles out of `dashboard-theme-advanced`; nothing on the Look card listens for it (`git grep -n
  "wt-toggle" -- apps/dashboard/src` lists only box-status, printers and product-editor sites).
  **Opening animates:** opening measures the body's `scrollHeight` once, in `updated`
  (`:221-246`), and animates to that fixed height with `overflow: hidden`; a disclosure opened
  while an ancestor's body is `hidden` measures 0 and opens at once. Nesting one `wt-disclosure`
  inside another is new: of the 20 non-test sites `git grep -n "<wt-disclosure" -- apps
  packages` lists, the plan reviewer opened the product editor's seven (siblings; Selling's body
  holds `renderOrdering`, no fold), printers' three (siblings), device profiles', the setup first
  hour's, `extra-list-form.ts:747` and the hosts of that form (`catalogue-screen.ts:874`,
  `modifiers-screen.ts:655`, neither inside a fold), and `exportGuidesView`'s one caller
  (`certificate-dialog.ts:320`, no fold); box status, prep stations and the `packages/ui` demo
  hold one fold each or siblings. None sits inside another.
- **Wording:** `advancedSummary` (`apps/dashboard/src/widgets/theme-words.ts:239-251`) names every
  hand-set colour (`handNames`, `:228-237`: light first, `THEME_COLOURS` order, "Page (light)") then
  every hand-set text row (`textNames`, `:75-77`), and counts every warning except the brand one
  (`:247`) with `countOf("appearance.hard_to_read_count", n)`. A colour warning exists only for a
  colour set by hand (`packages/ui-core/src/theme/warnings.ts:173-205`, `field:
  handSet.{mode}.{key}`); a text warning has `field: text.size.{key}` and `mode: null`
  (`packages/ui-core/src/theme/text.ts:162`).
- **Strings:** `appearance.text_group` "Text" / "Texto" (`apps/dashboard/src/i18n/strings.ts:3133`,
  `:6617`), read only by the `h3` above (`git grep -n text_group` lists those two and
  `theme-advanced.ts:382`, plus `theme-advanced.test.ts:659`). Advanced's keys are at
  `strings.ts:3216-3224` (English) and `:6701-6710` (Spanish).
- **Column heads** show only from a 600 px container: each `.table` is its own
  `container-type: inline-size` (`theme-advanced.ts:66-69`, `@container (min-width: 600px)` at
  `:147`), so a `.table` per section keeps that rule with no style change.
- **Phone width:** the Text rows already put the value under the name below a 600 px section
  (`apps/dashboard/src/widgets/theme-text.ts:74-80,152-167`; case "at phone width each row puts the
  value under its name", `theme-text.test.ts:362`).
- **Tests that reach inside Advanced** open it by clicking its header and nothing more:
  `theme-advanced.test.ts:69-74` (`open`), `look-card.advanced.test.ts:112-130` (`openAdvanced`,
  `typeHand`, `closeAdvanced`), `look-card.unsaved.test.ts:229-252`, `look-card.a11y.test.ts:90-107`,
  `theme-advanced.a11y.test.ts:102-110`. Once rows sit in closed sections, a click or `fill` on
  them would hit a `hidden` body, a layout reading would read zero boxes, and axe skips hidden
  content (so an axe state could pass while checking less).
- **Test support is outside coverage:** `src/widgets/test-helpers.ts` is excluded
  (`apps/dashboard/vitest.config.ts:120-122`).
- **Guides:** `apps/server/src/guide/en/appearance.md` `{#edit}` says the link "opens Advanced and
  puts the cursor in the code box" (`:66-68`); `{#advanced}` (`:196-227`) describes one list with
  the text rows "under **Text**" after the colours (`:215-216`) and "Advanced opens to show it"
  (`:225-227`); `{#text-by-hand}` opens "Under **Text**, after the colours" (`:231`) and ends "opens
  Advanced to show it" (`:263-264`). Spanish twins: `es/appearance.md:70-72`, `:218-251`, `:255`,
  `:288-289`. The page's section ids are pinned by `apps/server/src/guide-content.test.ts:88-103`.
- **Docs saying "until slice 12":** `docs/developers/design-system.md:4215` and `:4226-4227`;
  `docs/backlog.md:3031` ("Until slice 12 it is one flat list.") and the entry at `:3146-3148`.

## Where the design and main disagree (or the code goes further)

1. **Row order.** The design's sections move three colours away from the flat list's order: Links
   and accent text joins Text and Secondary text, + and − buttons joins the Buttons, and Focus ring
   comes last in Fields and focus (design lines 995-1001), where `THEME_COLOURS` puts `primary-text`
   and `focus` between the buttons and the fields and `stepper-button` last (`tokens.ts:4-27`).
   The rows follow the design (R2).
2. **Column heads.** Pictures 12 and 28 draw "Colour · Light screens · Dark screens" at the top of
   each opened colour section; main draws one head row for the whole list
   (`theme-advanced.ts:369-372`). Each colour section gets its own (R6).
3. **What opens.** Design section 4 step 3 (lines 516-519): a value's error opens Advanced "and so
   does the section holding it"; main has no sections, so only Advanced opens.
4. **Pick a different colour for dark screens** opens Advanced and focuses the dark Main buttons
   code field (`theme-advanced.ts:191-200`); the design wants the Buttons section opened first
   (line 2577). That is this slice's change. The design's "moves focus to the Dark value of its Main
   buttons row" is the code field, as slice 6 D13 ruled; kept.
5. **Text rows at phone width** already do what section 5a asks (value under the name); no change.
6. The design's section 5 list writes "Main buttons pointed at" where the strings say "Main buttons,
   pointed at" (`strings.ts:3201`); the strings stand (slice 6 wording).

## Rulings made by the planner (for the plan reviewer)

- **R1. Where the sections are drawn.** Inside the existing `dashboard-theme-advanced`, one element,
  not one element per section: the rows' code (`#value`, `#notes`, `theme-advanced.ts:247-356`), the
  one-pick-per-frame handling and `reveal` already live there. The Text section's body is the
  existing `dashboard-theme-text`, untouched (slice 11 D11 built it to "move whole into its Text
  section").
- **R2. Row order** within each colour section is the design's list (lines 995-1001), not
  `THEME_COLOURS`. Advanced's own closed line, the saved card's Colours set by hand row and the kept
  note keep `handNames`' `THEME_COLOURS` order (no change to code that works).
- **R3. A section's closed line** is "None set by hand" (new key) or the existing
  `appearance.advanced_set` / `_one` with that section's names; colour names light first, then
  dark, each in the section's row order (the `handNames` convention); then " · " and
  `countOf("appearance.hard_to_read_count", n)` while `n > 0`, as `advancedSummary` joins them.
- **R4. Which warnings a section counts.** A colour warning counts in the section of the colour its
  `field` names; every text warning counts in Text; the brand warning (`field: "brandColor"`)
  counts in no section — it sits under Brand colour, and Advanced's own count leaves it out
  (`theme-words.ts:247`). A dark Main buttons set by hand that warns has field
  `handSet.dark.primary` and counts in Buttons. So the five counts always add up to Advanced's.
- **R5. Strings.** New keys `appearance.section.surfaces`, `.text-colours`, `.buttons`, `.fields`,
  `.text` and `appearance.section_none`; `appearance.text_group` is deleted with the `h3`, its only
  reader. Spanish: "Página y superficies", "Colores del texto y enlaces", "Botones", "Campos y
  foco", "Texto", "Ninguno fijado a mano". New text the design lacks: the Spanish only; each PR
  description lists it with its English.
- **R6. Column heads per colour section,** each `aria-hidden="true"` as today (every control
  carries its own full name, slice 6 D3); the Text section has none (picture 28 draws none).
- **R7. Separating the sections:** a 1 px `--wt-color-border` line above each section, as pictures
  12 and 28 draw; not `ruled` (which draws a line under the title, `design-system.md:832`).
- **R8. Every row is still rendered while its section is closed,** inside the disclosure's `hidden`
  and `inert` body: `focusFirstInvalid` and `reveal` need the fields in the tree, and the render
  cost (44 values) is unchanged from main. Not lazily rendered.
- **R9. What opens or closes a section:** the manager's click on its header, `has-error`, and
  `reveal`. Nothing else: not Use Waitron's look, Reset all, Fix all, a warning, a newer read
  (`#adopt`), a locale change, or closing and reopening Advanced (the sections are still in the
  tree, so they keep their state). Opened by `has-error`, a section stays open after the error
  clears (`wt-disclosure.ts:212-213`), as Advanced does.
- **R10. `reveal("dark", "primary")` opens Advanced and the Buttons section and leaves the other
  four as they were.** Generalised: `reveal(mode, key)` opens the section holding `key`.
- **R11. Nothing is stored.** No storage key, no property on the card; "closed the next time" is
  the per-session element (`look-card.ts:1070-1088`). A case snapshots `localStorage` and
  `sessionStorage` around a section's opening.
- **R12. Guides: no new heading.** `{#advanced}`, `{#edit}` and `{#text-by-hand}` are reworded; the
  page's ids, pinned at `guide-content.test.ts:88-103`, are unchanged.
- **R13. One shared test helper** for opening the folds around an element, in
  `src/widgets/test-helpers.ts` (outside coverage), used by the five suites that reach inside
  Advanced, rather than five copies.
- **R14. No help badge on the sections** (slice 11 D17: no control on the card carries one).
- **R15. Use Waitron's look, Reset all and Fix all keep sections open** (R9); a closed section's
  count updates in place.

## Departures from the design

None beyond the planner rulings above. Expected differences in the look check (Task 7): the size
rows' stepper with − and + where pictures 28-30 draw a plain box (slice 11 D12); fixes
`#9d8a15` / `#437e5b` where the pictures show `#9f8b18` / `#417c59` (design line 476).

## Global Constraints

- **No migration, no route, no theme-document change, no change to `@waitron/ui` or
  `@waitron/ui-core`.** A task that finds it needs one stops and reports.
- Coverage `98/98/98/95` in `apps/dashboard` (CLAUDE.md §2), never an exclude or ignore comment
  over reachable code. `apps/dashboard` is not mutation-tested.
- English only in general code; Spanish only in the `es` block of `apps/dashboard/src/i18n/strings.ts`
  and `apps/server/src/guide/es/appearance.md`. A test of a Spanish screen reads its expected words
  from `es` (CLAUDE.md §3, general code English only).
- Every colour, spacing, radius and font reads a declared `--wt-*` token
  (`scripts/style-token-names.test.ts`); no hex, `rem` or `em`.
- A warning is never an error: it never opens a section, never marks a field, never disables Save
  (design lines 517-519, 574-576).
- Browser-test traps (CLAUDE.md §4): `userEvent.click` where an update a listener schedules decides
  the outcome; restore `setLocale("en-GB")` in `afterEach`; read the `Tests` count, never a blank
  output; `vi.waitFor` or `expect.poll` for anything an animation frame decides. `wt-disclosure`
  animates opening over `--wt-duration-disclosure` (900 ms, `packages/ui-core/src/tokens/structure.css:49`)
  unless `has-error` or reduced motion; a measurement taken right after a click measures a body
  still growing — layout cases emulate reduced motion with `commands.emulateReducedMotion("reduce")`
  and `onTestFinished(() => commands.emulateReducedMotion(null))`, as
  `menu-preview-navigation.test.ts:307-308` does.
- Before each commit: `pnpm format:check` and `pnpm --filter @waitron/dashboard typecheck` (Task 6:
  `pnpm --filter @waitron/server typecheck`); every commit `git commit -s`. Focused tests while
  implementing; CI owns the package suites.

## Review Focus

1. **A half-typed code in a closed section, Advanced closed, then Save** (`#12` in dark Field
   underline, in Fields and focus). Expected: Advanced and Fields and focus open, the other four
   stay closed, focus lands on that code field, the bottom message asks to fix the fields. Test:
   Task 4.
2. **Errors in two sections at once** (`#12` in light Page and `7` typed into Small text, then
   Save). Expected: Page and surfaces and Text open, the other three closed, focus on light Page's
   code field (first in document order). Test: Task 4.
3. **Fix all, Reset all or Use Waitron's look while sections are open or closed.** Expected: no
   section opens or closes; a closed section's count changes in place ("· 1 hard to read" goes).
   Test: Task 4.
4. **The screen language changes while a section is open.** Expected: headings and closed lines
   re-word in Spanish, the open section stays open. Test: Task 3a.
5. **The brand warning beside a hand-set colour's warning** (Café Limón's lemon plus a hand-set
   Text that warns). Expected: Text colours and links counts 1, every other section 0, Advanced
   counts 1 — the brand warning is counted nowhere in Advanced. Test: Task 1.

---

## File map

| File | Task | What |
| --- | --- | --- |
| `apps/dashboard/src/widgets/advanced-sections.ts` (new, + `.test.ts`) | 1 | which colours each section holds; which warnings and errors it counts |
| `apps/dashboard/src/widgets/theme-words.ts` (+ `.test.ts`) | 1 | `sectionSummary` |
| `apps/dashboard/src/i18n/strings.ts` | 1, 3a | six new keys; `appearance.text_group` deleted (3a) |
| `apps/dashboard/src/widgets/test-helpers.ts` | 2 | `openDisclosure`, `openFoldsAround` |
| `theme-advanced.test.ts`, `theme-advanced.a11y.test.ts`, `look-card.advanced.test.ts`, `look-card.unsaved.test.ts`, `look-card.a11y.test.ts` | 2 | helpers open the folds around what they touch |
| `apps/dashboard/src/widgets/theme-advanced.ts` (+ `.test.ts`) | 3a, 3b | the five sections, their lines, what opens, `reveal` |
| `apps/dashboard/src/screens/look-card.sections.test.ts` (new) | 4 | the card-level section cases |
| `look-card.advanced.test.ts` | 4 | the changed Pick a different colour case |
| `look-card.unsaved.test.ts`, `look-card.a11y.test.ts`, `theme-advanced.a11y.test.ts` | 5 | leave and axe cases |
| `apps/server/src/guide/{en,es}/appearance.md` | 6 | the guides |
| `docs/developers/design-system.md`, `docs/backlog.md` | 8 | docs |

---

### Task 1: The sections as data, and their closed lines

**Files:**
- Create: `apps/dashboard/src/widgets/advanced-sections.ts`, `apps/dashboard/src/widgets/advanced-sections.test.ts`
- Modify: `apps/dashboard/src/widgets/theme-words.ts` (beside `advancedSummary`, `:239-251`),
  `apps/dashboard/src/i18n/strings.ts` (after `appearance.advanced_set_one`, `:3221` and `:6707`)
- Test: `apps/dashboard/src/widgets/theme-words.test.ts`

**Interfaces:**
- Produces (`advanced-sections.ts`):
  ```ts
  export type ColourSectionId = "surfaces" | "text-colours" | "buttons" | "fields";
  export type AdvancedSectionId = ColourSectionId | "text";
  export interface ColourSection { readonly id: ColourSectionId; readonly keys: readonly ThemeColour[] }
  export const COLOUR_SECTIONS: readonly ColourSection[];
  export const ADVANCED_SECTIONS: readonly AdvancedSectionId[]; // the four, then "text"
  export function sectionOfColour(key: ThemeColour): ColourSectionId;
  export function inSection(id: AdvancedSectionId, warning: ThemeWarning): boolean;
  export function sectionHasError(
    id: AdvancedSectionId,
    errors: Readonly<Partial<Record<HandField, string>>>,
    textErrors: Readonly<Partial<Record<TextField, string>>>,
  ): boolean; // a key with a non-empty message, as theme-advanced.ts:363-365 counts
  ```
  `COLOUR_SECTIONS`, in this order, exactly (design lines 995-1001):
  ```ts
  surfaces:     bg, surface, surface-raised, surface-lifted, surface-sunken, track, border
  text-colours: text, text-muted, primary-text
  buttons:      primary, primary-hover, on-primary, primary-disabled, on-primary-disabled, stepper-button
  fields:       field-fill, field-line, field-label-focus, field-value, field-fill-disabled, focus
  ```
- Produces (`theme-words.ts`):
  `export function sectionSummary(id: AdvancedSectionId, choices: ThemeChoices, warnings: readonly ThemeWarning[]): string;`
  and `export function sectionHeading(id: AdvancedSectionId): string;`
  (`` t(`appearance.section.${id}`) ``: a template literal, because `t` takes only a `StringKey`,
  `apps/dashboard/src/i18n/t.ts:9`, and `"…" + id` is a plain `string` the typecheck refuses).

- [ ] **Step 1: Write the failing cases.** In `advanced-sections.test.ts`:
  - The four sections' keys, flattened, hold each of the 22 `THEME_COLOURS` exactly once
    (`flat.length === 22`, `new Set(flat).size === 22`, every `THEME_COLOURS` key included). Proof
    by deletion, run once and not committed: removing `focus` from `fields` makes the case fail;
    say so in the commit message.
  - `ADVANCED_SECTIONS` is `["surfaces", "text-colours", "buttons", "fields", "text"]`; each
    section's keys in the order above; `sectionOfColour("primary-text")` is `"text-colours"`,
    `("focus")` `"fields"`, `("stepper-button")` `"buttons"`, `("bg")` `"surfaces"`.
  - `inSection`: a warning `{ field: "handSet.light.text", … }` is in `text-colours` only;
    `handSet.dark.primary` in `buttons` only; `handSet.light.primary-text` in `text-colours` only
    (a key the flat list placed among the buttons); a text warning (`field: "text.size.sm"`,
    `mode: null`) in `text` only; a brand warning (`field: "brandColor"`) in none of the five.
  - `sectionHasError`: `{ "handSet.dark.field-line": "x" }` → true for `fields` only;
    `{ "handSet.dark.stepper-button": "x" }` → true for `buttons` only;
    `{ "handSet.light.bg": undefined }` → false everywhere; `textErrors { "text.family": "x" }` →
    true for `text` only.

  In `theme-words.test.ts` (fixtures from the file: Bar Lucía; "two fixes"; the cream page; the
  hover `#787878`; Café Limón's lemon), English, then Spanish with every expected word built from
  `es` through `fill` (CLAUDE.md §3):
  - Bar Lucía, nothing set: each of the five → `"None set by hand"`.
  - Cream page: `surfaces` → `"1 set by hand: Page (light)"`, the other four `"None set by hand"`.
  - "two fixes" (light `text` `#6a6a6a`, `surface-sunken` `#bbbbbb`): `surfaces` → `"1 set by hand:
    Sunken areas (light) · 1 hard to read"`; `text-colours` → `"1 set by hand: Text (light) · 1 hard
    to read"`.
  - Light Page and dark Page both set: `surfaces` → `"2 set by hand: Page (light), Page (dark)"`
    (light first).
  - Light Focus ring and light Field background set: `fields` → `"2 set by hand: Field background
    (light), Focus ring (light)"` (the section's order, not `THEME_COLOURS`', which puts `focus`
    first: R2).
  - Light Focus ring and dark Field background set: `fields` → `"2 set by hand: Focus ring (light),
    Field background (dark)"` (light before dark wins over row order; the case above cannot tell
    the two rules apart, this one can).
  - Dark Main buttons `#5fa77a` on Bar Lucía: `buttons` → `"1 set by hand: Main buttons (dark)"`.
  - The hover `#787878`: `buttons` ends `" · 1 hard to read"`.
  - Text: Bar Lucía with `text.size.md` 16 → `"1 set by hand: Normal text"`; with `sm` 10 →
    `"1 set by hand: Small text · 1 hard to read"`; with `xl` 33 at 100% (drawn above the 29 px
    limit, so a larger-than-checked note and no warning; first assert `derived.warnings` is empty
    and `textNotes(choices, WAITRON_DEFAULTS)` holds one, as `theme-text.ts:321` reads it, the
    control) → `"1 set by hand: Largest text"`, no count (design section 5a: the note "does not
    count as hard to read").
  - Review Focus 5: Café Limón's lemon with light `text` set to a grey that warns (the file's
    "two fixes" Text value, `#6a6a6a`, over Café Limón's choices; the case first asserts the
    derived warnings hold one `brandColor` warning and one `handSet.light.text` warning, the control
    that the fixture is the shape it claims): `text-colours` counts 1, every other section 0, and
    `advancedSummary` ends `" · 1 hard to read"`.
  - The sum over the five sections of `warnings.filter((w) => inSection(id, w)).length` equals the
    count `advancedSummary` words, for every fixture above (R4).
  - `sectionHeading` reads "Page and surfaces", "Text colours and links", "Buttons", "Fields and
    focus", "Text"; in Spanish, from `es`.

- [ ] **Step 2: Run them to see them fail.**
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/advanced-sections.test.ts src/widgets/theme-words.test.ts`
  Expected: FAIL — `advanced-sections.js` cannot be resolved; `sectionSummary` is not exported.

- [ ] **Step 3: Add the strings** (both blocks; `es` is typed by `en`'s keys, so a missing one fails
  the typecheck):

  | Key | English | Spanish |
  | --- | --- | --- |
  | `appearance.section.surfaces` | Page and surfaces | Página y superficies |
  | `appearance.section.text-colours` | Text colours and links | Colores del texto y enlaces |
  | `appearance.section.buttons` | Buttons | Botones |
  | `appearance.section.fields` | Fields and focus | Campos y foco |
  | `appearance.section.text` | Text | Texto |
  | `appearance.section_none` | None set by hand | Ninguno fijado a mano |

  `appearance.text_group` stays until Task 3a removes its reader.

- [ ] **Step 4: Implement** `advanced-sections.ts` (the order above is data the design fixes) and
  `sectionSummary`. Share the "names, then count" joining with `advancedSummary` through one
  private helper taking the names, the count and the none-sentence; `advancedSummary`'s output is
  unchanged (its existing cases, `theme-words.test.ts`, stay as they are).

- [ ] **Step 5: Run them to see them pass,** then `pnpm --filter @waitron/dashboard typecheck` and
  `pnpm format:check`.

- [ ] **Step 6: Commit** — `git commit -s -m "Say which colours each Advanced section holds, and word its closed line (A841 slice 12)"`.

---

### Task 2: Tests open the folds around what they touch (no product change)

Main's suites open Advanced and then touch rows directly. Once rows sit in closed sections, those
touches would hit hidden bodies. This task changes only test helpers, on main's code, so every
suite stays green before and after; Task 3a then builds the sections under them.

**Files:**
- Modify: `apps/dashboard/src/widgets/test-helpers.ts`
- Modify (helpers only): `apps/dashboard/src/widgets/theme-advanced.test.ts` (`open` `:69-74`, the
  layout `rowAt` `:288-297`, and the cases that click inside), `theme-advanced.a11y.test.ts`
  (`:102-110`), `apps/dashboard/src/screens/look-card.advanced.test.ts` (`:112-130` and every helper
  that clicks, types or measures inside Advanced: `typeHand`, `pickThen` `:889-903`, `typeSize`
  `:1001`, `choose` `:1007`, `:1194`, `pressText` `:1012`), `look-card.unsaved.test.ts`
  (`:229-252`, `:465-470`), `look-card.a11y.test.ts` (`:90-107` and each state's `reach`,
  `:228-311`)

**Interfaces:**
- Produces (`test-helpers.ts`):
  ```ts
  /** Clicks a closed wt-disclosure's header and waits for it to render open; does nothing when open. */
  export async function openDisclosure(disclosure: HTMLElementTagNameMap["wt-disclosure"]): Promise<void>;
  /** Opens, outermost first, every wt-disclosure that holds `node`, crossing shadow roots. */
  export async function openFoldsAround(node: Element): Promise<void>;
  ```
  `openFoldsAround` walks up from `node` through `parentElement`, and at a shadow root's top
  through `(getRootNode() as ShadowRoot).host`, collecting each `wt-disclosure` met as a
  `parentElement` (one that holds the node in its body), then opens them from the outermost in;
  a `wt-disclosure` met as a shadow root's host is skipped, because the node is in that
  disclosure's own header, not its body (without the skip, a helper about to click a section's
  header would open it first and the click would close it). `openDisclosure` ends with
  `expect(disclosure.open).toBe(true)`.

- [ ] **Step 1: Add the two helpers.**
- [ ] **Step 2: Rewire the helpers by one rule:** a helper that clicks, types into, presses or
  measures an element inside `dashboard-theme-advanced` calls `await openFoldsAround(element)`
  first, in place of `if (!disclosure(el).open) await openAdvanced(el)`; `openAdvanced` and `open`
  become `openDisclosure` on the outer section. A case that asserts Advanced is closed before it
  acts keeps that assertion. A case that clicks a row element inline (not through a helper) gets
  the same call before its click. No assertion changes in this task.
- [ ] **Step 3: Run the five suites on main's code.**
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-advanced.test.ts src/widgets/theme-advanced.a11y.test.ts src/screens/look-card.advanced.test.ts src/screens/look-card.unsaved.test.ts src/screens/look-card.a11y.test.ts`
  Expected: PASS, with the same `Tests` count as the same command on the task's starting commit
  (record both counts in the commit message). A count that differs means a case was lost.
  Record each run's `Duration` line too: Task 3a re-reads it, because a click on a row inside a
  section that is still animating open (900 ms) waits for Playwright's hit test, and nested folds
  add one such wait per fold (CLAUDE.md §2, about 4 minutes per CI job).
- [ ] **Step 4:** `pnpm --filter @waitron/dashboard typecheck`, `pnpm format:check`; commit —
  `git commit -s -m "Open the folds around what Advanced's tests touch (A841 slice 12)"`.

---

### Task 3a: The five sections inside Advanced

**Files:**
- Modify: `apps/dashboard/src/widgets/theme-advanced.ts` (`render`, `:358-399`; styles `:57-166`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (delete `appearance.text_group`, `:3133` and `:6617`)
- Test: `apps/dashboard/src/widgets/theme-advanced.test.ts`

**Interfaces:**
- Consumes: Task 1's `COLOUR_SECTIONS`, `ADVANCED_SECTIONS`, `sectionSummary`, `sectionHeading`,
  `sectionHasError`; Task 2's helpers.
- Produces: test hooks `[data-test=section-{id}]` on each section's `wt-disclosure`
  (`section-surfaces`, `section-text-colours`, `section-buttons`, `section-fields`,
  `section-text`). Every existing hook (`hand-row-{key}`, `hand-status-…`, `reset-all`,
  `advanced-intro`, `advanced`) keeps its name.

- [ ] **Step 1: Write the failing cases** (new `describe("sections")`; `sections(el)` reads the five
  `[data-test^=section-]` disclosures in document order):
  - Mounted (Advanced closed) and then opened: five sections, in `ADVANCED_SECTIONS` order, each
    `open === false`; headings `sectionHeading(id)`; each `summary` equals `sectionSummary(id,
    draft.choices, derived.warnings)`; for the cream page, `section-surfaces`'s summary is "1 set by
    hand: Page (light)" and the other four "None set by hand". Advanced's own `summary` is unchanged
    (`advancedSummary`).
  - Each `hand-row-{key}` sits inside `section-{sectionOfColour(key)}` (`section.contains(row)`),
    and the rows of a section come in its `keys` order.
  - Each colour section holds one `.head` row (`aria-hidden="true"`, "Colour", "Light screens",
    "Dark screens"), before its first row; the Text section holds none.
  - The Text section holds `dashboard-theme-text`, receiving the element's `draft`, `derived`,
    `textErrors` and `busy` as the existing "passes the text errors and busy" case checks; no
    `h3.text-group` remains anywhere in the element.
  - Reset all to worked-out comes after the Text section, inside Advanced
    (`compareDocumentPosition`).
  - A section's closed line follows the draft: setting `el.draft` to "two fixes" and awaiting the
    render → `section-surfaces`'s summary ends " · 1 hard to read" while it stays closed.
  - A warning leaves every section closed (the "two fixes" draft: no section `open`, none
    `has-error`).
  - Clicking `section-buttons`'s header (Advanced open) opens it and leaves Advanced and the other
    four as they were; clicking it again closes it.
  - Review Focus 4: open Page and surfaces, then `setLocale("es-ES")` → its heading is
    `es["appearance.section.surfaces"]`, the closed sections' summaries are Spanish (built from
    `es`), and Page and surfaces is still open.
  - Closing Advanced and opening it again keeps Page and surfaces open and the rest closed (R9).

- [ ] **Step 2: Change the existing checks this design line changes** (see "Changed test checks"):
  1-3 there. Run them all to see the new ones fail.
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-advanced.test.ts`
  Expected: FAIL — no `[data-test=section-surfaces]`.

- [ ] **Step 3: Implement.** Inside the outer `wt-disclosure`, after the intro: for each
  `COLOUR_SECTIONS` entry a `wt-disclosure data-test="section-{id}"` with `heading`,
  `summary=${sectionSummary(…)}` and `?has-error=${sectionHasError(id, errors, textErrors)}`,
  holding a `.table` with its own head row and its rows (the existing row template, in the
  section's order); then `section-text` holding `dashboard-theme-text` as today; then Reset all.
  The outer `has-error` is unchanged. A 1 px `--wt-color-border` line above each section (R7);
  styles read tokens only. Delete the `h3` and its `.text-group` rule, and the
  `appearance.text_group` key in both blocks.

- [ ] **Step 4: Run the suite to see it pass,** then the guards that read this file:
  `pnpm exec vitest run scripts/native-form-fields.test.ts scripts/style-token-names.test.ts scripts/primary-coloured-text.test.ts`.
  Expected: PASS. Then Task 2's Step 3 command over the five suites, which this change is the
  first to put under nested folds. Expected: PASS with Task 2's `Tests` count plus this task's new
  cases. A case that now fails because it touches a row in a closed section missed Task 2's rule:
  give it `openFoldsAround`, with no assertion change; it is not a `look-card.ts` defect. Compare
  each suite's `Duration` with Task 2's; a suite more than about a quarter slower is reported in
  the commit message with both durations. Then `pnpm --filter @waitron/dashboard typecheck` and
  `pnpm format:check`.

- [ ] **Step 5: Commit** — `git commit -s -m "Fold Advanced into five sections with their own closed lines (A841 slice 12)"`.

---

### Task 3b: What opens a section, `reveal`, and the sections at phone width

**Files:**
- Modify: `apps/dashboard/src/widgets/theme-advanced.ts` (`reveal`, `:191-200`)
- Test: `apps/dashboard/src/widgets/theme-advanced.test.ts`

**Interfaces:**
- Consumes: Task 3a's sections; Task 1's `sectionOfColour`.
- Produces: `reveal(mode: Mode, key: ThemeColour): Promise<void>` — opens
  `section-{sectionOfColour(key)}` FIRST and awaits its render, then Advanced and awaits its
  render, then focuses that value's code field; the other sections are left as they were (R10).
  The order matters (`wt-disclosure.ts:221-246`, read, not run): a section opened while Advanced's
  body is still `hidden` measures 0 and opens at once, so Advanced then animates once to its full
  height with the section open. Opened the other way, Advanced animates to the height of five
  closed sections with `overflow: hidden` while the section grows inside it, then jumps when its
  transition ends, with focus already moved into a clipped box.

- [ ] **Step 1: Write the failing cases:**
  - `errors = { "handSet.dark.field-line": "x" }` → Advanced and `section-fields` open with
    `has-error`; the other four closed and not `has-error`. Then `errors = {}` → `section-fields`
    stays open and loses `has-error` (`wt-disclosure.ts:212-213`).
  - `textErrors = { "text.size.sm": t("appearance.bad_text_px") }` → `section-text` open with
    `has-error`, the four colour sections closed.
  - Errors in `surfaces` and `text` at once → both open, the other three closed.
  - An error key with no message (`{ "handSet.light.bg": undefined }`) opens no section.
  - `reveal("dark", "primary")` on a closed Advanced → Advanced and `section-buttons` open, the other
    four closed, focus on the inner `input` of `wt-input[name="handSet.dark.primary"]` (walk
    `shadowRoot.activeElement`, as the existing case at `:270-282` does). With Page and surfaces
    opened first by its header, `reveal("dark", "primary")` leaves it open (R10).
  - `reveal("light", "focus")` opens `section-fields` (the generalisation; a control that `reveal`
    does not always open Buttons).
  - The order (motion NOT reduced; Chromium's default): `reveal("dark", "primary")` on a closed
    Advanced → right after it resolves, `section-buttons`' shadow `.body` has no `animating` class
    and an empty `style.height` (it opened at once), and after one animation frame Advanced's
    shadow `.body` `style.height`, parsed, is at least its `scrollHeight` − 1 (its one animation
    targets the height with Buttons open). Control, run once and not committed: swap the two opens
    in `reveal` and the first reading fails; say so in the commit message. If the swapped order
    passes too, stop and report it rather than weakening the case — the reasoning above was read
    from the code, not run.
  - Phone width, with reduced motion emulated (Global Constraints): at 390 px, Advanced and every
    section opened, the five sections share a left edge within 1 px and each starts at or below
    the previous one's bottom (they stack), the existing "stacks name, Light and Dark at phone width" readings hold
    for `bg` inside Page and surfaces and for `focus` inside Fields and focus, and the element's
    `scrollWidth` is not more than its `clientWidth` (nothing scrolls sideways); inside the opened
    Text section, the Typeface row's value top is at or below its name's bottom.

- [ ] **Step 2: Change existing check 4** (see "Changed test checks"); run to see the new cases fail.
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/widgets/theme-advanced.test.ts`
  Expected: FAIL — `reveal("dark", "primary")` leaves `section-buttons` closed.

- [ ] **Step 3: Implement** the `reveal` above. `has-error` per section came with Task 3a; if a case
  here shows a section's error does not open it, fix it in this task.

- [ ] **Step 4: Run to see them pass;** `pnpm --filter @waitron/dashboard typecheck`,
  `pnpm format:check`; commit — `git commit -s -m "Open the section holding an error or a revealed value (A841 slice 12)"`.

---

### Task 4: The Look card's section cases

**Files:**
- Create: `apps/dashboard/src/screens/look-card.sections.test.ts` (its small mount helpers shaped
  like `look-card.advanced.test.ts:22-130`: Bar Lucía in use, Christmas beside it, a `saveTheme`
  that echoes, no leave coordinator)
- Modify: `apps/dashboard/src/screens/look-card.advanced.test.ts` (changed check 5 only)
- Modify: `apps/dashboard/src/screens/look-card.ts` only if a case below fails on Tasks 1-3b's code

**Interfaces:**
- Consumes: Tasks 2-3b.

- [ ] **Step 1: Write the failing cases:**
  - The editor opens with Advanced closed; opened, all five sections closed.
  - Review Focus 1: open Advanced and Fields and focus, type `#12` into dark Field underline, close
    Fields and focus, close Advanced, press Save → no request; Advanced and Fields and focus open
    with `has-error`, the other four closed; focus on that code field's inner `input`; the bottom
    message is `t("form.fix_fields")`; Save disabled.
  - Review Focus 2: `#12` in light Page and `7` typed into Small text, every fold closed again,
    Save → Page and surfaces and Text open, the other three closed, focus on light Page's code
    field.
  - A refusal (`saveTheme` rejecting `theme.invalid { field: "handSet.light.bg", reason:
    "bad_value" }`) with every section closed → Page and surfaces opens; one naming
    `text.weight.bold` opens Text.
  - Review Focus 3, each from a fresh editor on the fixture named, with Text colours and links
    opened and the other sections closed: Fix all on "two fixes" → Text colours and links still
    open, Page and surfaces still closed and its summary no longer ends "hard to read"; Reset all →
    the same sections open and closed, every summary "None set by hand"; Use Waitron's look → the
    same. Read the folds after `await el.updateComplete` and the section's own `updateComplete`.
  - A newer read of the theme in use (a `list` with different stored choices, nothing changed in
    the editor, as slice 6's `#adopt` case does) leaves Page and surfaces open.
  - Save with a warning then Back: on "two fixes" with Text colours and links opened, Save opens
    the Hard to read dialog; Back closes it (wait for its `hard-to-read-back` event and the card's
    render, `look-card.ts:935-937`, CLAUDE.md §4) →
    Text colours and links still open, the other sections closed, nothing sent.
  - Cancel, then Edit → Advanced and every section closed. Bold weight set to 700 (a weight never
    warns) and Save, then Edit → closed.
    `edit({ id: christmas.id })` with Page and surfaces open → Christmas's sections closed, with
    Christmas's closed lines (extend the slice 6 case's idea, `look-card.advanced.test.ts:270-290`).
  - R11: snapshot every `localStorage` and `sessionStorage` key and value, open Advanced, open and
    close two sections, snapshot again → equal. Control, run once and not committed: a
    `localStorage.setItem` in a `wt-toggle` listener makes the case fail; say in the commit message
    that it did.

- [ ] **Step 2: Change check 5** (Pick a different colour for dark screens) and run both files.
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/look-card.sections.test.ts src/screens/look-card.advanced.test.ts`
  Expected: the cases Tasks 1-3b already make true PASS; record which fail and why. A failure
  that points at `look-card.ts` (for example focus not reaching a field in a just-opened section)
  is fixed there, test-first, in this task.

- [ ] **Step 3: Run the card's other suites:**
  `pnpm --filter @waitron/dashboard exec vitest run src/screens/look-card*.test.ts src/screens/appearance-screen*.test.ts`
  Expected: PASS. Then `pnpm --filter @waitron/dashboard typecheck`, `pnpm format:check`.

- [ ] **Step 4: Commit** — `git commit -s -m "Check the Look card's Advanced sections open, close and forget as the design says (A841 slice 12)"`.

---

### Task 5: Leave and accessibility cases

**Files:**
- Modify: `apps/dashboard/src/screens/look-card.unsaved.test.ts`, `apps/dashboard/src/screens/look-card.a11y.test.ts`,
  `apps/dashboard/src/widgets/theme-advanced.a11y.test.ts`

- [ ] **Step 1: Leave cases** in `look-card.unsaved.test.ts` (helpers `mount`, `unload`, `leave`,
  `choose`, and Task 2's):
  - Opening Advanced and opening and closing every section, nothing else → leaving asks nothing,
    `unload()` false, `leave(app)` "proceeded".
  - A value set by hand in Buttons, then Buttons and Advanced closed → leaving asks; Discard returns
    to the saved card without a write.
  - A text size set in Text, then Text closed → leaving asks.
  - Changed check 6 (Pick a different colour for dark screens alone asks nothing).

- [ ] **Step 2: Axe states for the element,** `theme-advanced.a11y.test.ts` (each runs at 1280 and
  390 px, light and dark, English and Spanish, through the file's `it.each`, `:78-114`). The state
  record gains `sections: readonly AdvancedSectionId[]` (the sections the case opens by header,
  through `openDisclosure`) beside `open`; every state's `check` asserts its checked element's
  `checkVisibility()` is true, the control that axe sees it (axe skips hidden content, so without
  this a state could pass while checking less).
  - Keep `closed`; "open, every section closed"; "open, every section open, nothing set by hand";
    "a value set by hand" (Page and surfaces open); "a warning and its fix" ("two fixes", Page and
    surfaces and Text colours and links open); "a fixed line" (Text colours and links open); "an
    error" (opened by `has-error` alone: the check asserts `section-surfaces` is open without a
    click); "sections closed, counting warnings" ("two fixes", every section closed, the check reads
    " · 1 hard to read" in two summaries); "the Text section open with a text warning" (Small text
    10).
- [ ] **Step 3: Axe states for the card,** `look-card.a11y.test.ts` (`states`, `:228-311`, run in
  both themes and both languages by the existing `it.each`). Most Advanced states return
  `"dashboard-theme-advanced"` as the element axe scans (`look-card.a11y.test.ts:235-275`), so
  opening the folds around THAT element opens no section, and its `checkVisibility()` is true with
  every section closed: axe would then check five closed lines and nothing inside. So each state
  names the inner elements it is about, opens their folds with `openFoldsAround`, and asserts
  `checkVisibility()` on each of those inner elements:
  - "Advanced open, nothing set by hand": every section opened (a `hand-row-*` of each colour
    section and `dashboard-theme-text` visible);
  - "Advanced open with a text size warning": the Text section, `[data-test="text-warning-size.sm"]`
    inside `dashboard-theme-text`'s shadow root visible;
  - "Advanced open with two warnings": Page and surfaces and Text colours and links,
    `hand-warning-light-text` and `hand-warning-light-surface-sunken` visible;
  - "a fixed-from line": Text colours and links, `hand-fixed-light-text` visible;
  - "a hand code's error": opened by `has-error`, `wt-input[name="handSet.light.bg"]` visible with
    no section opened by a click;
  - "the dark own colour line": unchanged (its element is on the card, outside Advanced).
  Add "Advanced open, every section closed" (the five closed lines are what it checks) and "Pick a
  different colour for dark screens pressed" (Advanced and Buttons open, the dark Main buttons
  code field visible and focused). Do not use the sage or "blocked" fixtures:
  their preview draws text under 4.5:1 on purpose (slice 6 Task 7).
- [ ] **Step 4: Run them.**
  Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/look-card.unsaved.test.ts src/screens/look-card.a11y.test.ts src/widgets/theme-advanced.a11y.test.ts`
  Expected: PASS. A state that fails axe is a defect in Tasks 3a-4, fixed there, never by dropping
  the state.
- [ ] **Step 5: Coverage of the changed files** (CI owns the package run). From `apps/dashboard`,
  after `memory_pressure | /usr/bin/grep free`:
  `pnpm exec vitest run src/widgets/advanced-sections.test.ts src/widgets/theme-words.test.ts src/widgets/theme-advanced.test.ts src/widgets/theme-advanced.a11y.test.ts src/screens/look-card*.test.ts --coverage --coverage.include=src/widgets/advanced-sections.ts --coverage.include=src/widgets/theme-words.ts --coverage.include=src/widgets/theme-advanced.ts --coverage.reportsDirectory=$(mktemp -d)`
  (the command line's `include` replaces the config's and the thresholds still bite: slice 6 probe
  `output-coverage-include.txt`). Read the `Tests` count and the three rows: each at or above
  98/98/98/95; add the missing cases where not.
- [ ] **Step 6:** `pnpm --filter @waitron/dashboard typecheck`, `pnpm format:check`; commit —
  `git commit -s -m "Check Advanced's sections for leave questions and accessibility (A841 slice 12)"`.

---

### Task 6: The user guide, English and Spanish

**Files:**
- Modify: `apps/server/src/guide/en/appearance.md` (`:66-68`, `:196-227`, `:231`, `:263-264`),
  `apps/server/src/guide/es/appearance.md` (`:70-72`, `:218-251`, `:255`, `:288-289`)

- [ ] **Step 1: English, then Spanish with the same `{#id}`s** (no heading added or renamed, R12):
  - `{#edit}`: the link opens Advanced and its **Buttons** section and puts the cursor in the code
    box of **Main buttons** on dark screens.
  - `{#advanced}`: Advanced holds five sections, named in order — **Page and surfaces**, **Text
    colours and links**, **Buttons**, **Fields and focus** and **Text** — each closed when you open
    Advanced, each with a closed line such as "1 set by hand: Page (light)" or "None set by hand",
    ending with "· 1 hard to read" while one of its values warns; press a section's heading to open
    it; a section stays open or closed as you leave it until the editor closes, and starts closed
    the next time; at the top of each colour section, the Light screens and Dark screens headings
    on a wide card; Reset all to worked-out at the bottom of Advanced, after the sections; a code
    that is not a colour opens Advanced and the section holding it. Keep every other sentence that
    is still true.
  - `{#text-by-hand}`: "In Advanced's **Text** section" in place of "Under **Text**, after the
    colours"; an invalid size "opens Advanced and its Text section to show it"; the sentence that
    lists where a too-small size counts as hard to read (en `:254`, "Advanced's closed line, **Fix
    all**, …"; es `:279-280`) also names the Text section's closed line.
  - `{#advanced}`'s kept-colours example ends "Advanced shows it." (en `:220`, es `:244`): still
    true; keep it.
  - Every sentence checked against the code as built (CLAUDE.md §1), section names as the strings
    give them in each language.
- [ ] **Step 2: Run the guide checks:**
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts src/guide-pages.test.ts`
  and `pnpm exec vitest run scripts/guide-links.test.ts`. Expected: PASS. Then
  `pnpm --filter @waitron/server typecheck` and `pnpm format:check`.
- [ ] **Step 3: Commit** — `git commit -s -m "Describe Advanced's sections in the user guide (A841 slice 12)"`.

---

### Task 7: Look check (the controller dispatches a subagent)

Start the stack from this worktree (`wa-wt demo waitron-feat-a841-12-advanced-sections`), sign in as
a manager, put a Bar Lucía theme in use (brand `#1e5b3a`, Tinted, Round, dark fix taken). Slice
11b's scripts in `~/waitron-campaign/a841-11b-script/` (`lib.mjs`, `editor.mjs`,
`shoot-advanced.mjs`, `put-theme.mjs`, `restore.mjs`) may be copied into
`~/waitron-campaign/a841-12-script/` and adapted; do not edit the originals. Screenshots into
`~/waitron-campaign/a841-12-shots/`, each opened and looked at; a report
`~/waitron-campaign/a841-12-shots/look-report.md` listing every difference from the pictures with
its screenshot.

- [ ] Before each shot, read `getComputedStyle` of the preview's light panel `--wt-color-bg` and the
  page's own: with the cream typed, the panel reads `#f8f1e1` and the page Bar Lucía's saved page
  colour; the failing case, a draft leaking onto the page, prints `#f8f1e1` for both.
- [ ] 1280 px, light and dark, English: Advanced opened with every section closed, the cream typed
  for light Page and Normal text set to 16 (against `28-advanced-sections-light.png`, left); Page
  and surfaces opened (against `12-advanced-{light,dark}.png`); Text opened (picture 28, right).
- [ ] 390 px, light, English and Spanish: every section closed; Page and surfaces opened (against
  `29-advanced-sections-phone-light.png`); nothing scrolls sideways (`scrollWidth` against
  `clientWidth` of the page, recorded).
- [ ] "Two fixes" saved with Save anyway, the editor reopened: two closed sections ending "· 1 hard
  to read"; then Fix all with both closed: the counts gone, the sections still closed.
- [ ] Pick a different colour for dark screens pressed from a closed Advanced: Advanced and Buttons
  open, the cursor in dark Main buttons' code box (against `37-theme-versions-light.png`), light and
  dark.
- [ ] A half-typed `#12` in dark Field underline, every fold closed, Save: Advanced and Fields and
  focus open, the message under the field and at the bottom.
- [ ] Cancel, Edit: every section closed again.
- [ ] Expected differences, not defects: the stepper with − and + (slice 11 D12); `#437e5b` where
  the pictures show `#417c59`. Any other difference is reported; a layout defect goes back to a
  high-effort fix agent, a design difference to the driver.

---

### Task 8: Docs — the design system and the backlog

**Files:**
- Modify: `docs/developers/design-system.md`, `docs/backlog.md`

- [ ] **Step 1: `design-system.md`:**
  - The Appearance entries (`:4205-4235`): "Under Brand colour's lines" — the link opens Advanced
    and its Buttons section; "Advanced" — five `wt-disclosure` sections inside it, in order, each
    closed when Advanced opens, each with "None set by hand" or "{n} set by hand: {names}" and the
    count, its own column heads in each colour section, a line above each section, `has-error` on
    the section holding an error as well as on Advanced, nothing stored, rows rendered while closed;
    drop "one flat list until slice 12" and "until slice 12 folds Advanced into sections"; "Advanced's
    Text rows" — they are the Text section's body.
  - "Fold a long form into collapsible sections with summaries" (`:3430-3510`): one line that a
    folded section may hold folded sections (Advanced on the Look card), each with its own closed
    line; an invalid field opens every fold around it, outermost first, and nothing else opens one.
    Then the Forms bullet (`:2528-2529`), "a folded section … holding an invalid field opens", gains
    "— every fold around it, when folds nest". This is the one new pattern.
  - The leave list (`:2858-2860`): the Look card's leave cases include Advanced's sections.
- [ ] **Step 2: `docs/backlog.md`:**
  - Delete the entry "Advanced's Text rows sit after the colours in one flat list until A841 slice
    12 folds Advanced into sections" (`:3146-3148`): this slice finishes it.
  - In the A841 entry (`:2999-3074`), delete "Until slice 12 it is one flat list." (`:3030-3031`)
    and after slice 11b's sentence add "Slice 12 landed {date} (#PR): Advanced is folded into five
    sections — Page and surfaces, Text colours and links, Buttons, Fields and focus, and Text — each
    closed when Advanced opens and saying what in it is set by hand and how many are hard to read; a
    section holding an error opens itself; Pick a different colour for dark screens opens Buttons.";
    the last sentence becomes "Next: 14 (with A1096's last part, below)."
  - Anything Task 7 or a review leaves open becomes its own short entry in the A841 area, with
    this plan as its pointer. If nothing is left, add nothing.
- [ ] **Step 3:** `pnpm exec prettier --file-info docs/backlog.md` (expected `"ignored": true`; docs
  are ignored whole, so `format:check` says nothing about them); commit —
  `git commit -s -m "Describe Advanced's sections in the design system; backlog for A841 slice 12"`.

---

## Changed test checks

Every existing assertion this plan changes, and the design line behind it:

1. `apps/dashboard/src/widgets/theme-advanced.test.ts:99-128`, "draws the intro, the column heads
   and 22 rows": the rows' order becomes `COLOUR_SECTIONS`' keys flattened (not `THEME_COLOURS`),
   and the head check reads each colour section's head — design lines 995-1001 and pictures 12, 28
   (R2, R6). The 44-field counts stay.
2. `theme-advanced.test.ts:655-669`, "holds the Text block after the colours and before Reset all,
   under a Text heading": the Text block is the body of `section-text`, the last section, before
   Reset all; its heading is `sectionHeading("text")`; no `h3.text-group` — design lines 1002 and 990-993.
3. `theme-advanced.test.ts:688-696`, "opens itself while a text value holds an error": also
   `section-text` opens and the colour sections stay closed — design lines 1006-1007 and 516-519.
   And `:244-253`, "an error under a value opens the section": also `section-surfaces` opens, the
   other four stay closed — the same lines.
4. `theme-advanced.test.ts:270-282`, "reveal opens the section and focuses that value's code
   field": also `section-buttons` is open — design line 2577 ("open the Buttons section first").
5. `apps/dashboard/src/screens/look-card.advanced.test.ts:763-780`, "Pick a different colour for
   dark screens opens Advanced at the dark Main buttons code, changing nothing": renamed "… opens
   Advanced's Buttons section at …"; after the click `section-buttons` is open and the other four
   closed; focus and Save as before — design line 2577 (the slice 6 plan's line 936 said this case
   would change).
6. `apps/dashboard/src/screens/look-card.unsaved.test.ts:367-375`, "Pick a different colour for dark
   screens alone asks nothing": also asserts `section-buttons` open — the same line.
7. `look-card.a11y.test.ts` and `theme-advanced.a11y.test.ts` states (Task 5): each opens the
   sections its element is in and asserts it visible; no state is dropped — design line 2476 ("axe
   in both themes").
8. Task 2 changes helpers only; every assertion is unchanged.
9. Unchanged and still holding: every `advancedSummary` case (`theme-words.test.ts`; Advanced
   "keeps its heading and its closed line", line 992) and `look-card.advanced.test.ts:1305-1311`.

## Driver steps (not implementer tasks)

- **Before the PR:** rebase; `/finish-branch` on the FULL path. The PR description: what a manager
  now sees, R1-R15 in plain words, the "Where the design and main disagree" list, the new Spanish
  strings with their English (R5), Task 7's screenshots and readings, and "no migration, no server
  change".
- **After it lands:** replace "(#PR)" in the backlog's A841 sentence; record in the design's
  decisions list (section 16, "The answers, and the branches not taken") as lane A rulings dated
  the day they are made: the rows follow the design's grouping, not the token order (R2), not
  taken: the flat list's order; a section counts the warnings of its own colours, and the brand
  warning none (R4); `reveal` leaves the other sections as they were (R10); nothing stored (R11),
  not taken: remembering open sections, which the design rules out (line 1008).

## Left for later

- Nothing the design gives slice 12 is left. Slice 14 (the counter till's logo) is the last A841
  slice.
