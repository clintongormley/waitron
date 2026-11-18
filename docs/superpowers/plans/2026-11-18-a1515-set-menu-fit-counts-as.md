# Set menus, piece 3 follow-up: what a dish counts as comes from the set menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The landed set-menu calculation (`fitSetMenus`, #3730) takes what a dish counts as
(starter, main, sharing plate) from the set menu it is placed in, not from the dish, so the folder a
waiter tapped can no longer change what a table pays.

**Architecture:** One input moves. Each dish a set menu lists (`SetMenuOfferDish`) gains
`countsAsCourseId`; the bill's dish (`SetMenuDish`) loses it. The calculation already looks a dish
up in each set menu by product and variant to find its surcharge; it now finds the dish's course
there too, and checks that course against the set menu's lines. Nothing else in the calculation
changes.

**Tech Stack:** TypeScript 7, Vitest 4, in `packages/shared` only.

**Spec:** [docs/superpowers/specs/2026-11-17-set-menus-design.md](../specs/2026-11-17-set-menus-design.md),
section 2 "What a dish counts as" and section 3 "One function, two uses" ("each offered dish in the
calculation carries its own counts-as course; this is a small change to the landed function"), and
piece 3 of "The pieces, for planning". The owner's answer behind it: "each set menu decides"
(18 November 2026, ledger item 8), after the Fable review's finding F2
(`~/waitron-campaign-m/reports/sm.md`).

**Order:** may land at any time; pieces 2 and 5 build on the new shape. Line numbers below are
from `b31ec62e37`.

## Decisions this plan makes

1. **`countsAsCourseId` is required on every listed dish, and has no check of its own** (**my
   call (plan writer)**). A course that no line of that set menu accepts simply gives the dish no
   place there, as a dish whose course no line accepts gets none today (the case "cannot cover a
   course that no line accepts", `set-menu-fit.test.ts:195-197`). Piece 1 refuses to publish a set
   menu listing such a dish, so the till never meets one.
2. **Dishes are grouped by product, variant and previous place only** (**my call (plan
   writer)**). Today the group key also holds the dish's course (`set-menu-fit.ts:322`). With the
   course on the set menu, two dishes of one product and variant are always interchangeable.
3. **The price limit stays where it is; no change for Fable's F5** (**my call (plan writer)**).
   The limit is `MAX_SET_MENU_AMOUNT_CENTS`, €10,000.00 (`set-menu-fit.ts:10`), checked for every
   set menu handed in (`:115-119`, `:233`, `:239`). Run on `b31ec62e37` from a scratch Vitest file
   importing `set-menu-fit.ts`: a bill holding one €14.00 set menu, handed a second set menu priced
   1,400,000 cents, threw `set_menu.fit_invalid_input` `{ reason: "invalid_amount", id: "bad" }`;
   the same bill without that second set menu fitted at 1400; at exactly 1,000,000 it fitted. So F5
   still holds, and the fix is piece 1's: refuse a set-menu price or surcharge above the limit
   when it is saved (piece 1, Tasks 2 and 4). No server path calls the calculation (piece 2,
   "Builds on"); the till's suggested move catches this error and offers no move.

## Global Constraints

- General code is English only, tests included (CLAUDE.md §3).
- `packages/shared` holds 98/98/98/95 coverage and a mutation floor of 90 (CLAUDE.md §2); the
  timing test `set-menu-fit.bound.test.ts` is already outside mutation
  (`packages/shared/vitest.config.ts:14-17`).
- When refactoring a test's input, keep what it asserts (global CLAUDE.md: "preserve behavioural
  assertions"). The worked example still costs 7200, the refit still 7800.
- Run focused tests with `pnpm --filter @waitron/shared exec vitest run <files>` and read the
  `Tests` count.
- `git commit -s`.

## Review Focus

1. **One product counting as different courses in two set menus on one bill.** Bravas a sharing
   plate on the Daily and a starter on the Special: each set menu places them by its own course.
   Pinned in Task 1, Step 1.
2. **A dish pinned to a place its set menu does not give it.** Refused `pinned_place_invalid`, as
   a pinned dish in the wrong course is today. Pinned in Task 1, Step 1.
3. **The cross-check against the brute-force reference.** Its random bills must include a product
   whose course differs between set menus, or the reference never tests the new lookup. Pinned in
   Task 1, Step 2.

---

### Task 1: Move `countsAsCourseId` from the bill's dish to the set menu's dish

**Files:**
- Modify: `packages/shared/src/set-menu-fit.ts` (`SetMenuOfferDish` `:12-16`, `SetMenuDish`
  `:40-46`, the per-set-menu lookup built at `:232-244`, the pinned check `:292-295`, the group key
  `:322`, the places a dish may go `:328-333`)
- Test: `packages/shared/src/set-menu-fit.test.ts`, `packages/shared/src/set-menu-fit.bound.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SetMenuOfferDish {
  readonly productId: string;
  readonly variantId: string | null;
  /** What this dish counts as when it is placed in this set menu: the set menu's own course for
   * it, else its product's course, as copied when the full menu was published. */
  readonly countsAsCourseId: string;
  readonly surchargeCents: number;
}

export interface SetMenuDish {
  readonly id: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly pinnedTo: SetMenuPlace | null;
}
```

  Every other export of `set-menu-fit.ts` is unchanged. Consumers: piece 2 builds
  `countsAsCourseId` from the served copy's `countsAsCourseId` and `variantCountsAs` (piece 1,
  Task 6a); piece 5's demo test uses the same.

- [ ] **Step 1: Write the failing tests** in `set-menu-fit.test.ts`. Change the helpers first, so
  the existing cases keep their meaning:
  - `offer(id, priceCents, items, lines)`: each listed dish takes `countsAsCourseId` from a
    test-file table `COURSE = { soup: "starter", salad: "starter", hake: "main", sirloin: "main",
    "sea bass": "main", lobster: "main", water: "drink", coffee: "drink" }`, falling back to
    `"starter"` (oysters, in the case at `:128`), and an item may be written `[product, surcharge, course]` to give its own.
  - `dish(id, productId)` loses its third parameter. Where a case passed a course (`"main"` for
    hake, sirloin, sea bass and lobster at `:50-53`, `:142`, `:416`, `:435`, `:507`; `"drink"` at
    `:196`), the table already gives it;
    the case at `:196` lists soup as `["soup", 0, "drink"]` in its own offer instead.
  - The inline offer at `:181-183` gives its wine `countsAsCourseId: "starter"`, so the case still
    fits at 2900.

  Then add a `describe("what a dish counts as")` block, with
  `const lines = [{ count: 1, courseIds: ["starter"] }, { count: 1, courseIds: ["main"] }]`,
  `dailyBravas = offer("daily", 1400, ["soup", "hake", ["bravas", 0, "sharing"]], [...lines, { count: 1, courseIds: ["sharing"] }])`
  and `specialBravas = offer("special", 2000, ["soup", "hake", ["bravas", 0, "starter"]], lines)`:
  - `"a dish counts as the course the set menu it is placed in gives it"`: one set menu fixed to
    `daily`, dishes soup, hake, bravas → `{ kind: "fitted", totalCents: 1400 }`, bravas at
    `lineIndex: 2`. The same dishes with the set menu fixed to `special` →
    `{ kind: "uncovered" }` (the bravas are a second starter there).
  - `"two bravas on one Daily need a second set menu"`: one set menu fixed to `daily`, dishes
    soup, hake, two bravas → `uncovered`; with two set menus fixed to `daily` →
    `{ kind: "fitted", totalCents: 2800 }`. (Fable's F2 sequence, where one bravas "tapped in the
    Special folder" shared a Daily's single sharing place, can no longer be written: nothing on the
    dish says where it was tapped.)
  - `"each set menu on one bill places the same product by its own course"`: set menus `s1`
    fixed to `daily` and `s2` fixed to `special`, dishes one soup, one hake, two bravas → fitted
    at 3400, the soup at `{ setMenuId: "s1", lineIndex: 0 }`, one bravas at
    `{ setMenuId: "s1", lineIndex: 2 }` and the other at `{ setMenuId: "s2", lineIndex: 0 }`. These
    three places are forced; the hake fits either Mains place, so the test does not assert it.
  - `"a pinned dish is checked against the course its set menu gives it"`: bravas pinned to
    `{ setMenuId: "s1", lineIndex: 0 }` with `s1` fixed to `special` is accepted; the same pin with
    `s1` fixed to `daily` throws `set_menu.fit_invalid_input`
    `{ reason: "pinned_place_invalid", id: <the bravas' id> }`.
- [ ] **Step 2: Make the brute-force cross-check see per-set-menu courses.** In
  `smallTables` (`:268-300`), give each listed dish the course `courses[Math.floor(product / 2)]`
  (today's dish course), except that `next(4) === 0` moves it to the next course in `courses`, so
  some bills hold one product counting differently in two set menus. Build the bill's dishes with
  `dish(id, product)`. In `exhaustiveFit` (`:303-338`), find the listed dish first and test
  `pair.courseIds.includes(listed.countsAsCourseId)`; in `checkPlacement` (`:94`), assert the line
  accepts the chosen set menu's `listed.countsAsCourseId`. Add to the cross-check case (`:256`):
  `expect(samples.some(differs)).toBe(true)`, where `differs` is true for a bill with a product two
  of its set menus list under different courses, so the cross-check is proved to cover it.
- [ ] **Step 3: Move the course in the timing test.** In `set-menu-fit.bound.test.ts`, the set
  menus' dishes (`:22-27`) carry `countsAsCourseId: course` from `products`, and the bill's dishes
  (`:43-49`) drop it. The table stays the same size and every seed must still fit.
- [ ] **Step 4: Run; they fail to compile or fail.**
  `pnpm --filter @waitron/shared exec vitest run src/set-menu-fit.test.ts src/set-menu-fit.bound.test.ts`
  — the new cases fail (`countsAsCourseId` is not on the set menu's dish yet).
- [ ] **Step 5: Implement in `set-menu-fit.ts`.** The per-set-menu lookup at `:235-242` keeps, for
  each product and variant, both the surcharge and `countsAsCourseId`. The pinned check (`:292-295`)
  and the places a dish may go (`:328-333`) test the line against the course that lookup gives for
  that set menu; the group key (`:322`) drops the course (decision 2). Update the doc comment on
  `SetMenuDish` if one is added; add none that restates the code.
- [ ] **Step 6: Run the two files again; all pass.** Read the `Tests` count. Then
  `pnpm --filter @waitron/shared typecheck` and
  `pnpm --filter @waitron/shared exec vitest run src/set-menu-placement.test.ts src/set-menu-search.test.ts`
  (unchanged files, run to show nothing they rely on moved).
- [ ] **Step 7: Prove the new lookup by deletion.** Temporarily make the places a dish may go
  (`:328-333`) test every set menu's line against the course the FIRST set menu gives the dish.
  `"each set menu on one bill places the same product by its own course"` and the cross-check must
  fail; restore the code and run again.
- [ ] **Step 8: Commit** — "Set menus: a dish counts as the course its set menu gives it". In the
  message: the owner's "each set menu decides" (18 November 2026) and that the bill's dish no
  longer carries a course.
