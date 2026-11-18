# Set menus, piece 2: ordering set menus at a table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as `subagent_type: "implementer"`.

**Goal:** At a seated table, a waiter sets how many set menus of each type the table is having,
orders their dishes as ordinary dishes from the set-menu folders, and sees which set menu each dish
is on; each dish is placed once, when it is sent, and keeps its place and price.

**Architecture:** Each set menu on a bill is an order line of its own (`working_order_lines`,
`set_menu_role = 'set_menu'`, no product, its copy and its price). Each set-menu dish is an ordinary
dish line marked `set_menu_role = 'dish'`, carrying the set-menu line it is placed on, its place,
its price (0 or its surcharge) and the course it counts as there. A bill records one copy of each
set menu (`bill_set_menu_copies`) when that set menu is first added. Set menus are added and removed
by type, straight onto the bill. Dishes go through the draft as today; when they are sent, one
shared, browser-safe function places them in the order they were added, and the till runs the same
function to show where each draft dish will go. The landed calculation (`fitSetMenus`) is used only
by the till, to find the move it suggests when a dish has no place. Taking money on such a bill
waits for piece 4.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild`), Hono
routes in `apps/server`, Lit screens in `apps/till`, Vitest 4 (browser mode for the till).

**Spec:** [docs/superpowers/specs/2026-11-17-set-menus-design.md](../specs/2026-11-17-set-menus-design.md),
as revised on 18 November 2026 (`7eb3b8eef2`) and approved by the owner the same day: section 2
"Ordering on the till", section 3 "Placing a dish", section 4 "Moving dishes to another bill",
section 5, and item 2 of "The pieces, for planning". Read them before Task 1. Line numbers below
were read on `main` at `b31ec62e37` (after #3703 and #3741 landed). A code map of this area, read
at `33be7eaaf3` before those two landed, is in the owner's checkout at
`docs/handoffs/2026-11-18-set-menu-ordering-code-map.md` (gitignored); its line numbers are stale.

**Builds on:**
- **Piece 3's follow-up** ([2026-11-18-a1515-set-menu-fit-counts-as.md](2026-11-18-a1515-set-menu-fit-counts-as.md)):
  `SetMenuOfferDish` gains `countsAsCourseId`; `SetMenuDish` loses it. **Only the till calls
  `fitSetMenus`** (Task 3's `suggestMove`, run by Task 16a). No server path calls it: the server
  places dishes with `placeInOrder` and checks a chosen move with `checkMoves`, neither of which
  calls the fit, so `set_menu.fit_invalid_input` never reaches a server answer and needs no
  `STATUS` entry or server wording. The till catches it in `suggestMove` and offers no move.
- **Piece 1** ([2026-11-18-a1515-set-menu-dashboard.md](2026-11-18-a1515-set-menu-dashboard.md),
  decisions 4, 9, 10 and 12, Tasks 4b, 6a and 6b, as amended on 18 November). Piece 1 is the
  producer; this plan uses its names:
  - `ServedSetMenuCopy` (`key`, `menuId` the set menu, `name`, `terms`, `structure`, `offers`) and
    `ServedSetMenu extends ServedSetMenuCopy` (`versionIds`, `orderable`, `newestOnSale`), in
    `ServiceZoneOffers.setMenus`, which serves **every** copy on sale, each once. Exactly one copy
    of each set menu on sale has `newestOnSale: true`; a copy held only by a full menu not selling
    now is `orderable: false` and never `newestOnSale` (piece 1 decision 10, Task 6b). **A bill's
    set menu is started only from the `newestOnSale` copy** (Task 6).
  - `ServedSetMenuOffer`: a `LiveOffer` with `countsAsCourseId` (null only when each variant
    carries its own) and `variantCountsAs` (each kept variant's, by variant id): what the dish
    counts as placed in THAT set menu (piece 1 decision 4). Its `courseId` is the set menu's own
    course while that course exists, else the product's live course (piece 1 decision 9, Fable
    F7): the course the dish is sent with when tapped in that folder.
  - `SetMenuTerms`: `price`, `vatClass`, `names` (may be `{}`), `lines: { id; count; courseIds }[]`.
  - `serveRecordedSetMenus(tx, [{ versionId, menuId }]): Promise<ServedSetMenuCopy[]>`
    (`packages/venue-service/src/set-menu-copies.ts`, piece 1 Task 6b): a bill's recorded copies,
    in the order asked, with the same live fields, course rule and `key` as the zone read, also for
    versions that are no longer live. Task 5 reads every copy a bill uses through it.
  - `set_menu.dish_sold_by_measure` `{ productId }` (declared by piece 1 in
    `packages/menu/src/errors.ts`, decision 12): a product whose unit measures an amount
    (`units.measure`) is never a set-menu dish. Piece 2 throws the same code as a backstop.
  - A copy is identified by piece 1's `key` (equal copies share it, whichever versions hold them).
    A bill records, with the key, one version holding it: **the first of the copy's `versionIds`
    whose full menu is orderable in the zone's `menus`, else the first** (**my call (plan
    writer)**: a dish line's menu context is that full menu, and the late-send checks judge it by
    that menu's period). A till drafting a dish from a served copy names the same version.
- **For piece 4** ([2026-11-18-a1515-set-menu-bill.md](2026-11-18-a1515-set-menu-bill.md), owned by
  another session): what this piece stores and the names piece 4 reads are listed in "What this
  piece stores, for piece 4" below.

**Order:** after piece 1, piece 3's follow-up, A1515-REMOVE (#3703, merged 18 November 11:03) and
A1308 os5 (#3741, merged 18 November 10:41). The fit (#3730) is on main.

**Review:** the earlier version (one untyped count, refit, freezing) was read by a fresh-context
reviewer and by lane M's Fable read (`~/waitron-campaign-m/reports/sm.md`). This version follows
the revised spec. From the Fable read it applies F1 (refuse money where a ticket is priced, too),
F2 (what a dish counts as comes from the set menu it lands in; Task 7b's bravas test), F6 (a
weighed set-menu dish), F7's second half (a recorded copy sends with the set menu's course), F8
(the panel total no longer subtracts calculation totals), M1 (one copy per set menu), M3, M6, M7
and M8. It drops F3, F4, F9 and M5's refit case (freezing and refit are gone) and M2 (with every
type fixed the calculation considers one mix). F5's piece-2 half changes: the server never calls
the calculation (Task 8 checks a chosen move directly), so only the till can meet
`set_menu.fit_invalid_input`, and it then offers no move; piece 1 refuses an amount above the
limit when it is saved (its decision 13). It was reconciled with piece 1's amended plan
on 18 November, then read once by a fresh-context reviewer, whose findings are applied: the party
read serves a bill's recorded copies in full (I1), the payment-in-progress and simplified-limit
checks on the count and move writers and no refusal where captured money is recorded (I2), the
cancelled-dish rule (I3, decision 12), equal copies read once (I4), the lookup reading the line's
own copy (I5), decision 8 following what à la carte allows (I6), and its minor points.

## Decisions this plan makes

The spec's own **my call** marks were approved by the owner on 18 November. The owner's answers of
18 November to the earlier version's calls are carried where they survive (ledger
`docs/handoffs/2026-11-17-set-lunch-owner-review.md`, "Owner's answers on the 'my call'
decisions"): each tap saved at once (Q4); Cancel removes an empty set menu (Q5); the server checks
places at Send only (Q6); the bill keeps its copies after the period (Q7); each set menu decides
what a dish counts as, the folder only its sending course (Q8); one copy per set menu per bill, a
move or merge target keeps its own (Q9); ask as soon as a dish is tapped, and again if a later
choice leaves it with no place (Q10). Calls that are this plan's are marked **my call (plan
writer)** here and where they first appear in a task.

1. **Taking money on a bill holding set menus waits for piece 4** (kept; the spec's pieces list says
   so). Refused `set_menu.payment_not_ready` wherever a payment row is written, wherever an
   adjustment other than a cancel is planned, and where every ticket is priced
   (`priceStoredOrderForIssuance`, `apps/server/src/working-order.ts:1330`) (Task 10).
2. **A set menu is a line; a type's count is the number of its lines** (kept). Each set-menu line
   has quantity 1, is born sent and served, has no group, no course and no portion cohort, and is
   never shown to the kitchen.
3. **One shared function places dishes, not the calculation** (**my call (plan writer)**). The
   spec says the calculation places a dish with every placed dish pinned. With every other dish
   pinned, that answer is the cheapest open place, which `placeInOrder` (Task 2) finds directly.
   It also applies the spec's tie-break (fewer courses on the line, then the set menu added first),
   which the calculation does not: it sorts set menus and offers by id
   (`packages/shared/src/set-menu-fit.ts:226-227`), and on equal costs its shortest-path search
   keeps the first path it found (`packages/shared/src/set-menu-placement.ts:87`) (read, not run).
   The calculation is still used for the suggested move (Task 3), as the spec says.
4. **A dish whose question was answered keeps the place it was promised** (**my call (plan
   writer)**). When the waiter adds a set menu for a dish, or takes the suggested move, the draft
   line stores that place (`set_menu_reserved_line_id`, `set_menu_reserved_place`). No other dish
   is placed there, so a sirloin drafted earlier cannot take the new Menú especial's main from the
   sea bass it was added for. A reservation that is no longer open is ignored, and the dish is
   placed as any dish is.
5. **The suggested move is written at once, like a count tap** (**my call (plan writer)**). It
   moves dishes already sent and reserves the freed place for the new dish. If the waiter then
   deletes the new dish, the moved dishes stay where they went; the summary's **Move** (Task 15a)
   moves one back.
6. **A set-menu draft line has quantity 1 and never merges** (**my call (plan writer)**). Each unit
   is placed on its own (spec §3); a second soup is a second tap, asked about on its own. The
   basket shows no quantity stepper on such a line.
7. **A dish sold by measure is never a set-menu dish: piece 1's rule, with a backstop here**
   (piece 1 decision 12, a plan writer's call on Fable P2, which the owner has not answered). A
   stored line's amount is unit price × quantity, so a flat surcharge on 0.300 kg would be filed as
   30% of itself (Fable F6, run). Piece 1's editor refuses such a product and its publish refuses a
   set menu whose dish's unit was changed to one. In case a copy still holds one, piece 2 applies
   the same rule (the unit measures an amount, `units.measure`): the copy leaves the dish out, the
   folder does not draw it, and saving or sending it is refused with piece 1's own code,
   `set_menu.dish_sold_by_measure` `{ productId }`.
8. **A placed dish edits as an à la carte dish does, and raising its quantity places the new
   units** (**my call (plan writer)**). Today a stored line's variant cannot be changed at all (the
   edit body `OrderLinePatch` has no variant, `apps/server/src/working-order.ts:5582-5593`), and a
   sent row's quantity may only rise (`:5588-5591`). So a set-menu dish's variant is fixed, as à la
   carte. A rise adds units, each its own line (`expandPortionRows` in the edit path, `:6710`);
   each new unit is placed as a new dish would be, and the dish already placed stays where it is
   (spec: "once placed, a dish stays"). A new unit with no place refuses the edit
   `set_menu.no_place`. Options, extras, note, course and group edit as today and change no place.
   A cancelled dish (decision 12) frees its place.
9. **A set-menu line moved with its dishes keeps its own copy and price** (**my call (plan
   writer)**). Q9 says a target keeps its own copy: that copy is what new set menus of that type on
   the target are added from. The moved line keeps the copy it was added from, so its price never
   changes by a move.
10. **The summary's Move moves one placed dish to another open place on the same bill** (**my call
    (plan writer)**), so the refusal of − on a set menu holding dishes has something to point at
    (spec: "move them to another set menu"). Moving a placed dish to à la carte is cancel and
    re-order; the refusal says so.
11. **The table-service guide section and the help bubble on the count land here** (kept; CLAUDE.md
    §3: a screen change updates its guide).
12. **A cancelled dish no longer fills its place** (**my call (plan writer)**). A dish cancelled
    after the kitchen started it keeps its row, with a `cancel` adjustment taking its charge off
    (`apps/server/src/line-cancel.ts:225-300`: the row is removed only when nothing was started).
    Such a dish does not fill its place, does not count as "holds dishes" for − or Cancel, is never
    moved, and its link to the set-menu line is cleared by the link's `on delete set null` when
    that set menu is removed. A cancel that keeps the charge leaves the dish in its place.
13. **− may take a set menu a draft dish was going to use; the till shows the change** (**my call
    (plan writer)**). The removal is the waiter's own tap, and Send is the guard (owner, Q6). After
    it, the summary marks any draft dish left with no place, and the question (Task 16a) opens for
    the first one, as when a later choice leaves a dish with no place (owner, Q10).

## What this piece stores, for piece 4

| Row | Column | Holds |
| --- | ------ | ----- |
| set-menu line | `set_menu_role` | `'set_menu'` |
| set-menu line | `set_menu_id` | the set menu (`menus.id`) |
| set-menu line | `set_menu_version_id` | the full menu's version whose copy it is (`menu_versions.id`) |
| set-menu line | `unit_price_gross`, `line_total` | the copy's `terms.price`, written once when added |
| set-menu line | `name`, `descriptions` | the copy's name, and its `terms.names` over the venue's invoice languages |
| set-menu line | `vat_class`, `takeaway_vat_class` | the copy's `terms.vatClass` (both) |
| set-menu dish | `set_menu_role` | `'dish'` |
| set-menu dish | `set_menu_id` | the set menu whose folder it was tapped in (its offer, options, extras and sending course) |
| set-menu dish | `set_menu_line_id` | the set-menu line it is placed on (null only for a cancelled dish whose set menu was removed, decision 12) |
| set-menu dish | `set_menu_place` | the index of its line in that copy's `terms.lines` |
| set-menu dish | `unit_price_gross`, `line_total` | 0, or its surcharge in the set menu it is placed on |
| set-menu dish | `set_menu_counts_as_course_id` | the course it counts as in that set menu |
| bill | `bill_set_menu_copies` | one row per set menu: `(working_order_id, set_menu_id) → menu_version_id` |

- **The one writer of a dish's place.** `setMenuDishColumns(result, copy)` (`apps/server/src/set-menu-bill.ts`,
  Task 5) returns the place, price and counts-as columns, and is handed the landing copy, so
  piece 4 can add `vat_class` from `copy` without changing a caller. Every path that writes them
  calls it: placing at Send and a raised quantity (Task 7b's `placeSetMenuRows`, called by
  `insertTabRound` and by the edit path), the waiter's move on the bill (Task 8,
  `moveSetMenuDishes`) and re-placing a dish moved alone to another bill (Task 11a,
  `replaceMovedDishes`). Piece 4 adds `vat_class` there. This piece writes a dish's `vat_class`
  exactly as for any dish (its offer's class) and never changes it.
- **The one removal writer.** `removeSetMenuLines` (`apps/server/src/set-menu-count.ts`, Task 6) is
  called by − and by Cancel. Piece 4 adds `set_menu.remove_paid` there.
- **The money refusal.** `refuseSetMenuMoney` (`apps/server/src/set-menu-bill.ts`, Task 10), in
  `beginBillPayment`, `planAdjustment` and `priceStoredOrderForIssuance` only: it refuses starting
  a payment, never recording one already captured. Piece 4 removes every call and the function.
- **A cancelled dish** has a `cancel` adjustment on its line; it is left out of every set-menu
  state (decision 12).
- **A dish's movable mark.** `PlacedDish.movable` is false for a dish with a `bill_payment_lines`
  row or an adjustment that reduced it (Task 5); the suggested move never moves one (spec §2). In
  this piece no such dish exists; the mark is read so piece 4 needs no change to the move.
- **Until piece 4 lands, a bill holding set menus cannot be paid, comped or discounted.**

## Global Constraints

- **Money:** whole cents in the database, two-place decimal strings in API bodies; the shared
  functions take and return whole cents. Convert with `decimalToCents` / `centsToDecimal`.
- **Schema:** change the TypeScript schema; hand-written SQL only in `packages/db/triggers/core.sql`;
  then `pnpm --filter @waitron/db db:generate` (`packages/db/package.json:30`). No new migration
  file. Declare types through `packages/db/src/schema/columns.ts`. Name every new
  `working_order_lines` column in **each of the three column lists** of
  `working_order_lines_require_open_parent_update` (`core.sql:393`; the lists hold
  `new.descriptions IS old.descriptions` at `:415`, `:481` and `:562`) (Fable M6), in `carveLines`'
  source select and its new-row copy (`apps/server/src/working-order.ts:4764-4825`), and every new
  `order_draft_lines` column in the draft insert and upsert (`apps/server/src/order-drafts.ts:1278-1318`).
  Verify by RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts`,
  `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **One transaction per request** (`withTransaction`); every server function here takes `tx` and
  never opens its own; a refusal rolls back the whole write. Await queries on one transaction in
  turn.
- **Menu data once per request:** read set-menu copies once before any line loop, never per line
  (CLAUDE.md §3).
- **Seated:** the bill has a party (`party_id`), its zone's mode is `table_tab`
  (`packages/venue-service/src/operations.ts:452-485`), and its dining is `eat_in`. One function
  answers it, `refuseUnlessSetMenuBill` (Task 5).
- **Errors:** `AppError`, codes declared in `apps/server/src/errors.ts`, a status in `STATUS`
  (`apps/server/src/till-api.ts:443`), wording in English and Spanish in `apps/till/src/i18n/codes.ts`
  with a `codeMessage` branch (`:998`) for each param the wording reads. Every refusal says what
  happened and what each choice does (CLAUDE.md §3). The codes, all **my call (plan writer)**:

  | Code                           | Params                                   | Status | When                                                                      |
  | ------------------------------ | ---------------------------------------- | ------ | ------------------------------------------------------------------------- |
  | `set_menu.not_seated`          | `{}`                                     | 409    | a set menu or set-menu dish on a bill that is not a seated table's        |
  | `set_menu.takeaway`            | `{ setMenuName: string }`                | 409    | a set menu on a takeaway bill, or switching a bill holding one to takeaway |
  | `set_menu.not_selling`         | `{ setMenuName: string }`                | 409    | adding a set menu the bill holds no copy of while none is on sale         |
  | `set_menu.holds_dishes`        | `{ setMenuName: string; dishNames: string[] }` | 409 | − or Cancel on set menus that hold dishes                                 |
  | `set_menu.no_place`            | `{ dishName: string }`                   | 409    | Send meets a set-menu dish with no open place                             |
  | `set_menu.place_taken`         | `{ dishName: string }`                   | 409    | a chosen move whose target place is no longer open                        |
  | `set_menu.no_place_on_target`  | `{ dishName: string }`                   | 409    | a set-menu dish moved alone to a bill where it has no place               |
  | `set_menu.dish_sold_by_measure` | `{ productId: string }` (piece 1's code, `packages/menu/src/errors.ts`; add only its `STATUS` entry and till wording) | 409 | a set-menu dish sold by measure reaches a draft or a send (decision 7, backstop) |
  | `set_menu.remove_from_summary` | `{}`                                     | 409    | a cancel or adjustment route given a set-menu line                        |
  | `set_menu.payment_not_ready`   | `{}`                                     | 409    | money on a bill holding set menus, until piece 4                          |

- **English only** in code, tests and fixtures ("Daily menu", "Special menu"); Spanish only in
  `codes.ts`, `strings.ts` translations and the Spanish guide.
- **Running tests:** `pnpm --filter <pkg> exec vitest run <files>`, with `-t "<name>"` to pick a
  case (never `pnpm test <file> -t`, which drops the `-t`); read the `Tests` count. Till tests run
  in headless Chromium: check `memory_pressure | grep free` first.
- **Implementers** that pass about 150 tool calls stop at a passing or cleanly failing point,
  commit, and return a handover.
- **Commits:** `git commit -s`.

## The shared shapes, as every task sees them

```ts
// packages/shared/src/set-menu-bill.ts (browser-safe; exported from the shared index)
import type { SetMenuOffer } from "./set-menu-fit.js";

/** One copy of a set menu, as the bill uses it: the calculation's offer (`id` is piece 1's copy
 * `key`; `dishes` one per offer with no variants and per kept variant) plus what the bill needs. */
export interface SetMenuCopy extends SetMenuOffer {
  setMenuId: string;
  /** The version the bill records it from, or the till drafts it from (Builds on, piece 1). */
  versionId: string;
  name: string;
}
export interface BillSetMenu { lineId: string; copyId: string; lineNo: number }
export interface DishPlace { setMenuLineId: string; place: number }
export interface PlacedDish extends DishPlace {
  lineId: string;
  productId: string;
  variantId: string | null;
  priceCents: number;
  countsAsCourseId: string;
  /** False when a payment or an adjustment rests on it: the suggested move leaves it. */
  movable: boolean;
}
export interface BillSetMenuState {
  copies: readonly SetMenuCopy[];
  /** The bill's one copy of each set menu: set menu id → copy id. */
  recorded: Readonly<Record<string, string>>;
  setMenus: readonly BillSetMenu[];
  dishes: readonly PlacedDish[];
}
export interface DishToPlace {
  id: string;
  productId: string;
  variantId: string | null;
  reserved: DishPlace | null;
}
export interface PlacementResult extends DishPlace {
  id: string;
  priceCents: number;
  countsAsCourseId: string;
}
```

---

## Review Focus

1. **The owner's own case, in reverse.** A draft sirloin is previewed on an empty Menú del día at
   +€5; the waiter taps a sea bass, which only the Menú especial lists, and adds one. The sea bass
   goes in the new Especial ("the dish goes in the new one", spec §2), and the sirloin stays at +€5
   rather than taking the Especial's only main. Pinned in Task 2, "a reserved place is kept for its dish".
2. **Fewer dishes than set menus.** Four set menus and three dishes: every set menu is charged and
   the summary shows the open places. Pinned in Task 6, "an empty set menu is charged".
3. **Two tills at one table.** One presses − on the Menú del día while the other sends a soup that
   needs it. Whichever commits second is refused (`set_menu.holds_dishes`, or `set_menu.no_place`)
   and writes nothing. Pinned in Task 7b, "a send after the set menu was removed elsewhere is
   refused".
4. **Bravas tapped in either folder.** Bravas are a sharing plate on the Del día and a starter on
   the Especial. Tapped in the Especial folder on a bill holding only a Del día, they fill the Del
   día's sharing place, count as a sharing plate, and are sent with the Starters course. Pinned in
   Task 7b, "what a dish counts as comes from the set menu it lands in".
5. **The full menu republished, or its period ended, mid-meal.** A table holding Del día set
   menus keeps their price and folder, can add another Del día and send a dessert; a set menu the
   table does not hold cannot be added. Pinned in Tasks 6 and 7c.

---

### Task 1: A set menu's copy, as a bill uses it (shared)

**Files:**
- Create: `packages/shared/src/set-menu-bill.ts` (the shapes above); export it from `packages/shared/src/index.ts`
- Test: `packages/shared/src/set-menu-bill.test.ts`

**Interfaces:**
- Consumes: `SetMenuOffer` and `SetMenuOfferDish` with `countsAsCourseId` (piece 3's follow-up);
  piece 1's `ServedSetMenuCopy` (`packages/shared/src/menu-document/menu-document-types.ts`).
- Produces (`setMenuOfferOf` is the name piece 5 uses for the conversion):

```ts
/** A served copy as the calculation's offer: `id` the copy's `key`, `priceCents` from
 * `terms.price`, `lines` from `terms.lines`, `dishes` as below. */
export function setMenuOfferOf(copy: ServedSetMenuCopy): SetMenuOffer;
/** The same, with the set menu, its name and the version it is used from. */
export function setMenuCopyOf(copy: ServedSetMenuCopy, versionId: string): SetMenuCopy;
/** Every set menu among `copies` that lists this product and variant. */
export function copiesListing(
  copies: readonly SetMenuCopy[], productId: string, variantId: string | null,
): SetMenuCopy[];
```

- `dishes` hold one entry per offer without variants (`variantId: null`, `countsAsCourseId` the
  offer's `countsAsCourseId`) and one per kept variant (`countsAsCourseId` that variant's entry in
  `variantCountsAs`, so the course stored for a dish is always the one its chosen variant counts as
  in the set menu it lands in); `surchargeCents` is the variant's `unitPrice`, else the offer's.
  An offer whose unit measures an amount is left out (decision 7). Server and till both convert
  `ServedSetMenuCopy` (the zone read and `serveRecordedSetMenus` serve the same shape), so there is
  one converter.

- [ ] **Step 1: Write the failing tests:**
  - `"a copy lists each dish and each kept variant with its surcharge and its counts-as course"`:
    a Daily menu copy (14.00; Soup included as Starters; Sirloin +5.00 as Mains; Wine with Glass
    kept, Bottle left out, Glass in `variantCountsAs` as Drinks) gives `priceCents: 1400`, `id` the
    copy's `key`, and three dishes, the Glass counting as Drinks.
  - `"a dish sold by measure is not in the copy"`.
  - `"setMenuCopyOf carries the set menu, its name and the version given"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/shared exec vitest run src/set-menu-bill.test.ts`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it**; they pass.
- [ ] **Step 5: Commit** — "Set menus: a set menu's copy as a bill uses it".

### Task 2: Placing dishes in order (shared)

**Files:**
- Modify: `packages/shared/src/set-menu-bill.ts`
- Test: `packages/shared/src/set-menu-bill.place.test.ts`

**Interfaces:**
- Produces:

```ts
/** Places `dishes` one at a time, in the order given, each in its cheapest open place.
 * `heldFor` are places promised to other draft lines: nothing in `dishes` takes them. */
export function placeInOrder(
  state: BillSetMenuState,
  dishes: readonly DishToPlace[],
  heldFor?: readonly DishPlace[],
): { placed: PlacementResult[]; unplaced: string[] };
/** The state with these placements added as placed dishes (movable). */
export function withPlacements(
  state: BillSetMenuState, dishes: readonly DishToPlace[], placed: readonly PlacementResult[],
): BillSetMenuState;
```

- An **open place** for a dish is a set-menu line on the bill whose copy lists the dish's product
  and variant, and a line index `i` of that copy whose `courseIds` holds the course the copy gives
  the dish, with fewer dishes at `(setMenuLineId, i)` than `lines[i].count`. A held place is not
  open to anyone but its dish.
- A dish's `countsAsCourseId` and `priceCents` are those of the landing copy's `dishes` entry for
  its product and chosen variant (Task 1), never anything from the folder it was tapped in.
- A dish with a `reserved` place takes it when it is open to it; otherwise it is placed as any dish.
- Among open places, a dish takes, in this order (spec §2, and decision 3): the lowest surcharge;
  then the line with fewer `courseIds`; then the set-menu line added first (lowest `lineNo`); then
  the lowest line index (**my call (plan writer)**, so the answer never depends on ids).
- A dish with no open place is in `unplaced` and takes no place.

- [ ] **Step 1: Write the failing tests**, on one fixture: Daily menu 14.00 (`1 × Starters`,
  `1 × Mains`, `1 × Sharing`; Soup and Hake included, Sirloin +5.00, Bravas as Sharing), Special
  menu 20.00 (`1 × Starters`, `1 × Mains or Starters`; Soup, Sirloin and Sea bass included, Bravas
  as Starters):
  - `"a dish takes its cheapest open place, whichever folder it came from"`: one Daily and one
    Special on the bill; a Sirloin goes on the Special at 0.
  - `"a starter takes the Starters line before Mains or Starters"`.
  - `"between two Specials it takes the one added first"`.
  - `"dishes are placed in the order given"`: two Specials and three starters: the first two fill
    the Starters lines, the third a `Mains or Starters` line.
  - `"a reserved place is kept for its dish"` (Review Focus 1): Daily 1 holding Soup and Hake, an
    empty Daily 2, and a new empty Special; a draft Sirloin (no reservation), then a Sea bass
    reserved on the Special's `Mains or Starters` line → the Sirloin is placed on Daily 2's main at
    5.00 and the Sea bass on the Special at 0. With the Sea bass first in the list, the same. The
    control, with no reservation: the Sirloin takes the Special at 0 and the Sea bass is `unplaced`.
  - `"a held place is open only to its dish"`: `heldFor` the Special's main; a Sirloin is placed
    on the Daily's main at 5.00 instead.
  - `"a reserved place that is taken is ignored"`.
  - `"what a dish counts as comes from the set menu it lands in"`: Bravas on a Daily count as
    Sharing; on a Special as Starters.
  - `"a variant counts as its own course in the set menu it lands in"`: a Glass of wine whose
    `variantCountsAs` is Drinks fills the Drinks line.
  - `"a dish no set menu lists is unplaced"`, and `"a bill with no set menus places nothing"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/shared exec vitest run src/set-menu-bill.place.test.ts`; they fail.
- [ ] **Step 3: Implement.** A loop over the dishes; no search is needed, since each dish sees the
  places the earlier ones left.
- [ ] **Step 4: Run it**; they pass.
- [ ] **Step 5: Commit** — "Set menus: place dishes on a bill's set menus in the order they were added".

### Task 3: The suggested move, and checking a move (shared)

**Files:**
- Modify: `packages/shared/src/set-menu-bill.ts`
- Test: `packages/shared/src/set-menu-bill.move.test.ts`

**Interfaces:**
- Consumes: `fitSetMenus` (`packages/shared/src/set-menu-fit.ts`, after piece 3's follow-up).
- Produces:

```ts
export interface DishMove { lineId: string; to: DishPlace }
export interface MoveSuggestion {
  moves: (DishMove & { from: DishPlace; priceCents: number; countsAsCourseId: string })[];
  /** Where the new dish goes once the moves are made. */
  place: PlacementResult;
}
/** The cheapest rearrangement of the bill's movable placed dishes that makes room for `dish`;
 * `drafted` (earlier draft dishes, at their previewed places) are never moved. Null when none. */
export function suggestMove(
  state: BillSetMenuState,
  drafted: readonly PlacementResult[],
  dish: Omit<DishToPlace, "reserved">,
): MoveSuggestion | null;
/** Checks moves taken together; answers each moved dish's new place, or the first dish whose
 * target is not open to it. */
export function checkMoves(
  state: BillSetMenuState, moves: readonly DishMove[],
):
  | { kind: "ok"; results: PlacementResult[] }
  | { kind: "place_taken"; lineId: string }
  | { kind: "not_placed"; lineId: string };
```

- `suggestMove` calls `fitSetMenus` with one offer per copy on the bill (each `SetMenuCopy` is one, `id` its key), every
  set-menu line fixed to its copy, the bill's placed dishes unpinned when `movable` and pinned
  otherwise, `drafted` pinned at their places, and `dish` free; `previous` is today's places. When
  it answers `fitted`, the moves are the placed dishes whose place differs (spec §3). It answers
  null on `uncovered` and `too_large`, and when the fit throws `set_menu.fit_invalid_input` (an
  amount above `MAX_SET_MENU_AMOUNT_CENTS`, `set-menu-fit.ts:10`) (**my call (plan writer)**: the
  waiter still gets Add, à la carte and Cancel).
- `checkMoves` applies the moves together and checks every moved dish's target as an open place
  (Task 2's rule, ignoring the tie-break). A move naming a line that is not one of the state's
  placed dishes (a cancelled dish is not, decision 12) answers `not_placed`.

- [ ] **Step 1: Write the failing tests**, on Task 2's fixture:
  - `"moving the Sirloin to the Daily makes room for the Sea bass"` (the spec's example): one Daily
    holding Soup, one Special holding Soup and Sirloin; a Sea bass → one move, Sirloin to the
    Daily's main at 5.00, and the Sea bass on the Special's main at 0.
  - `"a dish that is not movable is never moved"` → null for the same bill with the Sirloin
    `movable: false`.
  - `"a drafted dish keeps its previewed place"`.
  - `"no rearrangement makes room"` → null.
  - `"an amount above the limit gives no suggestion"`: a copy priced 1,000,001 cents → null.
  - `"two moves into one place are refused"`, and `"a move to an open place is answered with its
    price"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/shared exec vitest run src/set-menu-bill.move.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, and `src/set-menu-fit.test.ts`**; they pass.
- [ ] **Step 5: Commit** — "Set menus: suggest a move that makes room for a dish".

### Task 4: Schema — set-menu lines, set-menu dishes, a bill's copies, a draft's set menu

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`working_order_lines` `:195-396`)
- Modify: `packages/db/src/schema/order-drafts.ts` (`order_draft_lines` `:58-114`)
- Create: `packages/db/src/schema/set-menu-copies.ts`; export it from the schema index
- Modify: `packages/db/triggers/core.sql` (the three lists), `packages/db/src/classification.ts`
  (beside `working_order_lines`, `:160-164`, class `state`)
- Modify: `apps/server/src/working-order.ts` (`carveLines` select and copy), `apps/server/src/order-drafts.ts` (draft insert and upsert)
- Regenerate: `packages/db/drizzle/0000_baseline.sql` and its snapshot
- Test: `packages/db/src/schema/set-menu-lines.test.ts`

**Interfaces:**
- On `working_order_lines`: `setMenuRole` (declared with `enumType(["set_menu", "dish"])` and an
  `enumCheck`, nullable), `setMenuId` (`id`, foreign key to `menus.id`), `setMenuVersionId` (`id`,
  foreign key to `menu_versions.id`), `setMenuLineId` (`id`, foreign key to
  `working_order_lines.id` **on delete set null**: `removeSetMenuLines` refuses a set menu holding
  a dish that is not cancelled, so the rule only ever clears a cancelled dish's link, decision 12),
  `setMenuPlace` (`count`), `setMenuCountsAsCourseId` (`id`, no key, with a one-line reason at the
  column as `extraListId` has, `orders.ts:249-253`: a course can be deleted while an open bill
  counts a dish as it; placing is what established it).
- CHECK `working_order_lines_set_menu_ck`:
  - role null ⇒ every `set_menu_*` column null;
  - role `set_menu` ⇒ `set_menu_id` and `set_menu_version_id` not null; `product_id`,
    `menu_item_id`, `parent_line_id`, `course_id`, `group_id`, `cohort_id`, `set_menu_line_id`,
    `set_menu_place` and the counts-as course null (with `menu_item_id` null, the context columns
    are null by `working_order_lines_context_ck`, `orders.ts:382-395`) (Fable M7);
  - role `dish` ⇒ `set_menu_id`, `menu_item_id`, `set_menu_place` and the counts-as course not
    null; `parent_line_id` and `set_menu_version_id` null. `set_menu_line_id` may be null, so the
    set-null delete is accepted (the earlier review's `node:sqlite` probe showed a CHECK tying it
    to the place refuses that delete).
  An extras child of a set-menu dish keeps role null: it is an ordinary paid extra.
- On `order_draft_lines`: `setMenuId` (`id`, nullable; foreign key to `menus.id`), and
  `setMenuReservedLineId` (`id`, no key: a reservation is checked when the dish is placed, and a
  stale one is ignored, decision 4) with `setMenuReservedPlace` (`count`); CHECK both null or both
  set, and set only with `setMenuId`.
- No trigger checks that a dish's set-menu line is on the dish's own bill (**my call (plan
  writer)**): a move takes a set menu and its dishes in one statement per bill pair, and a row
  trigger would see them in an order the statement does not fix, refusing a sound move. Task 11a
  tests it instead ("a set menu's dishes are on its bill after every move").
- `billSetMenuCopies` (`bill_set_menu_copies`): `workingOrderId` → `working_orders.id` on delete
  cascade, `setMenuId` → `menus.id`, `menuVersionId` → `menu_versions.id`; primary key
  `(working_order_id, set_menu_id)`. Classified `state`. Every classified table is a live-update
  change source unless listed otherwise (`classification.ts:437-440`), so it needs nothing more here.

- [ ] **Step 1: Write the failing tests** in `set-menu-lines.test.ts`, with `useVenueDb` on the
  core set and rows inserted directly:
  - `"a set-menu line holds a set menu and a copy and no product"`: with a `product_id` refused
    naming `working_order_lines_set_menu_ck`; without `set_menu_version_id` refused; with both and
    no product accepted.
  - `"a set-menu dish needs its set-menu line, place and counts-as course"`.
  - `"an ordinary line carries no set-menu values"`.
  - `"deleting a set-menu line clears its dishes' link"`: the delete is accepted, the dish's
    `set_menu_line_id` is null and its place and price are kept.
  - `"a bill has one copy of each set menu"`: a second row for the same bill and set menu is
    refused; the rows go with the bill.
  - `"a draft line's reservation needs its set menu"`.
  - `"a set-menu column cannot change on a placed bill"`: for each new column, the update is
    refused on a placed bill (follow the existing per-column case for this trigger; grep
    `working_order_lines_require_open_parent_update` under `packages/db/src` and `scripts/`).
- [ ] **Step 2: Run** `pnpm --filter @waitron/db exec vitest run src/schema/set-menu-lines.test.ts`; they fail.
- [ ] **Step 3: Add the columns, the table, the CHECKs, the trigger lists, the classification,
  the `carveLines` and draft-write column names; run `db:generate`.**
- [ ] **Step 4: Run the file and the schema verification list** (Global Constraints). All pass;
  read each count.
- [ ] **Step 5: Commit** — "Set menus: store set-menu lines, set-menu dishes and a bill's set-menu copies".

### Task 5: Reading a bill's set menus on the server

**Files:**
- Create: `apps/server/src/set-menu-bill.ts`, `apps/server/src/set-menu-offers.ts`
- Modify: `apps/server/src/errors.ts` (every code in Global Constraints), `apps/server/src/till-api.ts` (`STATUS`)
- Test: `apps/server/src/set-menu-bill.test.ts`

**Interfaces:**
- Consumes: Task 1's `setMenuCopyOf`; piece 1's `serveRecordedSetMenus` and `listZoneOffers(...).setMenus`.
- Produces in `set-menu-bill.ts`:

```ts
/** Refuses `set_menu.not_seated` unless the bill has a party, a `table_tab` zone and eat-in
 * dining; `set_menu.takeaway` when it is a table's takeaway bill. */
export function refuseUnlessSetMenuBill(tx: Transaction, workingOrderId: string): Promise<void>;
/** The bill's copies (each set-menu line's `(set_menu_version_id, set_menu_id)` and each
 * recorded row's, served in one `serveRecordedSetMenus` call, converted by `setMenuCopyOf` and
 * de-duplicated by `key`, since equal copies share it and the fit refuses a repeated offer id),
 * its set menus and its placed dishes, leaving out cancelled dishes and dishes whose link is
 * null. A bill with no set-menu row and no recorded copy answers empty without that call. */
export function readBillSetMenus(tx: Transaction, workingOrderId: string): Promise<BillSetMenuState>;
/** The one place a set-menu dish's place, price and counts-as columns are built (piece 4 adds
 * `vatClass` here). */
export function setMenuDishColumns(result: PlacementResult, copy: SetMenuCopy): {
  setMenuLineId: string; setMenuPlace: number; setMenuCountsAsCourseId: string;
  unitPriceGross: number; lineTotal: number;
};
```

- Produces in `set-menu-offers.ts`:

```ts
export interface SetMenuOfferLookup {
  /** The tapped copy's offer for a draft or order line with `setMenuId`, shaped as a
   * `ZoneMenuOffer` whose `menuId`/`menuName` are the FULL menu's and whose `id` is the set
   * menu's own menu item; undefined when no usable copy holds it. */
  offerFor(line: { setMenuId: string; menuVersionId: string | null; menuItemId: string }):
    | { offer: ZoneMenuOffer; copy: SetMenuCopy; fromRecordedCopy: boolean }
    | undefined;
}
/** Reads once, in one `serveRecordedSetMenus` call: the copy each line names
 * (`(menuVersionId, setMenuId)`), whichever bill it is for. It never reads the zone's served
 * copies: `listZoneOffers` serves `setMenus: []` when given `menuItemIds`, as every draft and
 * line write gives them (piece 1 Task 6a), and a read without them builds every offer of the
 * zone. The full menu's id and name for a dish line's context come from its version's
 * `menu_versions` row. */
export function setMenuOfferLookup(
  tx: Transaction, workingOrderId: string | null, zoneId: string,
): Promise<SetMenuOfferLookup>;
```

- A line's version is accepted when it is the version the bill recorded for that set menu, or,
  when the bill has none for it, one of the zone's live versions (`menus[].versionId` of the zone
  read `priceOrderLines` already makes, `apps/server/src/working-order.ts:557-561`). Otherwise
  `menu.version_changed`, as a stale à la carte line is refused
  (`packages/menu/src/menu-publication.ts:306-322`), so the till refreshes. This covers Review
  Focus 4: a dish tapped in a set menu the bill does not hold is found in its own copy.
- `PlacedDish.movable` is false when the dish has a `bill_payment_lines` row or an adjustment
  row that reduced it, both read in the same request as the dishes, one query each.
- The set-menu line's `descriptions` are built over the venue's invoice languages (`readInvoiceLocales`,
  `packages/menu/src/operations.ts:1163`), with the set menu's name where `terms.names` has none,
  as `customerPresentationText` does for a dish (`packages/shared/src/menu-document/product-presentation.ts:51-70`)
  (Fable M3). Task 6 writes them; put the builder here as `setMenuLineDescriptions`.

- [ ] **Step 1: Write the failing tests** (`useVenueDb`; a seated party venue from
  `apps/server/src/testing/party-venue.ts`; Daily and Special published in a full menu "Lunch"):
  - `"a counter order, a takeaway bill and a bill with no table-service zone are refused"`, one
    case each, with the code.
  - `"a bill's state holds its set menus, copies and placed dishes"`.
  - `"a set-menu line moved in from another bill brings its own copy"`: a line whose version is not
    the recorded one is read with its own copy.
  - `"a bill with no set menus reads no menu document"` (count statements).
  - `"a set menu moved in with a copy equal to the bill's own gives one copy"`.
  - `"a cancelled dish whose charge was taken off leaves its place open"`; control: a cancel
    keeping the charge leaves it placed.
  - `"a dish with an item payment row is not movable"` (insert the row directly).
  - `"a lookup finds a dish in the bill's recorded copy, and in the zone's copy before one is
    recorded"`; `"a stale version is refused as a changed menu"`; `"a lookup reads the copies once
    however many lines"` (count statements).
  - `"bravas the Special gives Starters are served with Starters from a recorded copy"` (Fable F7).
  - `"a set menu with no customer names gets descriptions in every invoice language"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-bill.test.ts`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it**; they pass.
- [ ] **Step 5: Commit** — "Set menus: read a bill's set menus and find a set-menu dish's offer".

### Task 6: Adding and removing set menus by type

**Files:**
- Create: `apps/server/src/set-menu-count.ts`
- Modify: `apps/server/src/till-api.ts` (routes beside `/api/parties/:id/bills`, `:3292-3324`),
  `apps/server/src/parties.ts` (`readPartyBills` `:532-536`: each bill gains `setMenus:
  BillSetMenuState` and `setMenuCopies: ServedSetMenuCopy[]`)
- Test: `apps/server/src/set-menu-count.test.ts`, `apps/server/src/till-api.set-menus.test.ts`

**Interfaces:**
- Routes, each behind `requireSession(deps, c, { action: "take-orders" })` and `checkZones`, each
  with `expectedPartyRevision` checked and bumped by `checkAndBumpParty`
  (`apps/server/src/parties.ts:458`) as the guest count is (`till-api.ts:3148-3163`), each answering
  `{ setMenus: BillSetMenuState; partyRevision: number }`:
  - `PUT /api/bills/:id/set-menus/:setMenuId` body `{ count: number }` (0–99): sets how many set
    menus of that type the bill holds (`setSetMenuCount`).
  - `DELETE /api/bills/:id/set-menu-lines/:lineId`: Cancel on one set menu (`removeSetMenuLines`).
  - `GET /api/bills/:id/set-menus`: the state, for the move screen (Task 17).
- Raising a count: when the bill has no recorded copy of that set menu, the zone's served copy of
  it with `newestOnSale: true` is taken (piece 1 decision 10); with none, `set_menu.not_selling`.
  The bill records `(menuId, versionId)`, the version chosen as "Builds on" says; the key need not
  be stored, since `serveRecordedSetMenus` serves it again. A bill that has a recorded copy always
  adds from it, on sale or not (owner, Q7).
  Each new line: role `set_menu`, the copy's `set_menu_id` and `set_menu_version_id`, quantity 1,
  `sent_at` and `served_at` now with `served_quantity` 1 (decision 2), `unit_price_gross` and
  `line_total` the copy's price, `vat_class` and `takeaway_vat_class` the copy's `vatClass`, `name`
  the copy's name and `descriptions` from `setMenuLineDescriptions`, `credited_to` the signed-in
  person, no group, course or cohort. A born-sent line also fixes the bill's dining by the
  existing trigger (`working_orders_dining_fixed`, `core.sql:672-689`); that is a backstop only.
- Lowering a count removes empty lines of that type, the last added first. Fewer empty ones than
  asked → `set_menu.holds_dishes` naming the dishes on the set menus of that type, and nothing is
  removed.
- `removeSetMenuLines(tx, workingOrderId, lineIds)` is the only code that deletes a set-menu line.
  It refuses `set_menu.holds_dishes` when any of them holds a dish (checked in the transaction).
  Piece 4 adds its own refusal here.
- Refusals at the start of each write: `refuseUnlessSetMenuBill`, then `refusePaymentInFlight`
  (as every draft write does, `apps/server/src/order-drafts.ts:161,301,431,646,756`). A raised
  count reads the total before and calls `refuseOrderOverSimplifiedLimit` after, as the other
  writers that raise a total do (`apps/server/src/working-order.ts:3139,4267,6891`).
- **The party read carries each bill's copies in full** (the reviewer's I1): after a mid-meal
  republish the zone read no longer serves a bill's recorded copy, and the till needs its
  `structure`, `terms` and `offers` to draw the folder. `readPartyBills` makes ONE
  `serveRecordedSetMenus` call for every copy the party's bills use, and each bill's
  `setMenuCopies` holds the ones it uses. A party with no set menus makes no call.

- [ ] **Step 1: Write the failing tests** in `set-menu-count.test.ts`:
  - `"setting 2 Daily menus adds two set-menu lines at 14.00 and records the copy"`.
  - `"an empty set menu is charged"` (Review Focus 2): the bill's stored total is 28.00 with no
    dishes.
  - `"a set menu the bill does not hold cannot be added once nothing sells it"`, and `"a bill
    holding Daily menus can add another after the period ended, at its recorded price"` (Review
    Focus 5).
  - `"after the full menu is republished at 15.00, a bill that holds Daily menus adds more at
    14.00, and a new bill gets 15.00"`.
  - `"with two copies on sale, a new bill takes the newestOnSale one"`: Daily in Lunch at 14.00
    and in Brunch at 15.00, Brunch's newest → the first Daily on a new bill is 15.00; and `"the
    version recorded is one whose full menu sells now"`.
  - `"lowering the count removes the last empty set menu"`, and `"refuses when the set menus hold
    dishes, naming them, and removes nothing"`.
  - `"Cancel removes one empty set menu, and refuses one holding a dish"`.
  - `"a repeated tap with the same revision is refused as stale and adds nothing"`.
  - `"a count tap is refused while a payment is in progress"`; `"a count past the simplified
    invoice limit is refused"`.
  In `till-api.set-menus.test.ts`: each route's answer and status; `"the party bills read carries
  each bill's set menus"`; `"after a republish, the party read serves a bill's recorded copy in
  full, in one call for the whole party"` (count statements).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-count.test.ts src/till-api.set-menus.test.ts`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and `src/till-api.session-person.test.ts`** (its walk must see the new
  routes; add them to `BODIES` where a body is needed, CLAUDE.md §3).
- [ ] **Step 5: Commit** — "Set menus: add and remove a bill's set menus by type".

### Task 7a: Saving set-menu dishes in a draft

**Files:**
- Modify: `apps/server/src/order-drafts.ts` (`saveDraft` `:277`, `offersFor` `:1426-1438`, `unavailable` `:1441`,
  the draft read's unavailable mark), `packages/shared/src/draft-merge.ts` (a set-menu line never merges)
- Test: `apps/server/src/set-menu-drafts.test.ts`

**Interfaces:**
- Consumes: `setMenuOfferLookup`, `refuseUnlessSetMenuBill` (Task 5).
- A draft line with `setMenuId` is looked up through the lookup, built once per save, never in
  the zone's `offers`; it is never marked unavailable for not being there. It is accepted on a
  seated bill only, with quantity exactly 1 (decision 6, else `management.request_invalid`
  `{ field: "quantity" }`), and never merges with another line. A dish sold by measure is refused
  `set_menu.dish_sold_by_measure` (decision 7). Saving never checks places (owner, Q6).
- A reservation is stored as given; nothing checks it until the dish is placed.

- [ ] **Step 1: Write the failing tests:** `"a set-menu soup is saved in the draft and read back
  with its set menu"`; `"two set-menu soups stay two lines"`; `"a set-menu line of quantity 2 is
  refused"`; `"a weighed dish from a set-menu folder is refused"`; `"a set-menu dish on a counter
  order is refused"`; `"a sold-out set-menu dish is marked unavailable, and an available one is
  not"`; `"a draft line's reservation is saved and read back"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-drafts.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, `src/order-drafts.test.ts` and
  `pnpm --filter @waitron/shared exec vitest run src/draft-merge.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: save set-menu dishes in a draft".

### Task 7b: Placing set-menu dishes when they are sent

**Files:**
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines` `:604`: the lookup built at `:679` and read at
  `:732-737`; `priceTabRound` `:3073`; `insertTabRound` `:3112-3141`),
  `packages/venue-service/src/operations.ts` (`lineContextColumns` `:1315-1392`), `apps/server/src/order-drafts.ts`
  (`submitDraft` `:720`: pass each line's draft position and reservation), `apps/server/src/order-groups.ts`
  (`placeGroups` `:279-400`)
- Test: `apps/server/src/set-menu-send.test.ts`, `apps/server/src/till-api.set-menu-send.test.ts`

**Interfaces:**
- Consumes: `setMenuOfferLookup`, `readBillSetMenus`, `setMenuDishColumns` (Task 5); `placeInOrder` (Task 2).
- Produces: `placeSetMenuRows` (below).
- `priceOrderLines` prices a set-menu dish from its lookup offer exactly as an ordinary dish
  (options, extras as child lines with their own prices, the sending course from the served
  offer's `courseId`), and `lineContextColumns` takes its version from the lookup's copy instead
  of the zone's live versions (today a plain `Error` when missing, `operations.ts:1346-1350`).
- `placeSetMenuRows(tx, workingOrderId, rows, order)` (in `apps/server/src/set-menu-bill.ts`) is
  the one placing step for new rows: it reads the bill's state, builds one `DishToPlace` per
  set-menu dish row (each whole-portion unit is already its own row, `expandPortionRows`,
  `apps/server/src/order-portions.ts:32`), in `order` (draft position, then unit), holds the
  reservations of the bill's other open-draft lines, calls `placeInOrder`, and writes
  `set_menu_role = 'dish'`, `set_menu_id` and `setMenuDishColumns(result, copy)` onto each row.
  Any dish unplaced → `set_menu.no_place` naming the first, and nothing is written.
  `insertTabRound` calls it before its insert, so every path that inserts a round
  (`placeGroups`, `addTabRound` at `working-order.ts:3018-3035`) places; Task 9 calls it for a
  raised quantity.
- A line with no `setMenuId` is an ordinary line, whatever product it is (spec §2).

- [ ] **Step 1: Write the failing tests** in `set-menu-send.test.ts`, on the Task 2 fixture with
  one Daily and one Special on a seated bill:
  - `"a set-menu soup is sent as an ordinary dish line, placed, at 0.00"`: its options and a paid
    extra (+1.50, its own child line at 1.50, role null) are stored as for an à la carte soup; its
    group and sending course are the draft's.
  - `"a sirloin from the Daily folder lands on the Special at 0.00"` (the owner's example).
  - `"what a dish counts as comes from the set menu it lands in"` (Review Focus 4, Fable F2):
    with only a Daily on the bill, Bravas tapped in the Special folder are placed on the Daily's
    Sharing line, count as Sharing, and are sent with Starters.
  - `"dishes are placed in the order they were added, not the order of their groups"`.
  - `"a reserved place is kept"`.
  - `"an à la carte sirloin on the same bill stays at 18.00 with no role"`.
  - `"a dish with no place refuses the whole send and writes nothing"`.
  - `"a send after the set menu was removed elsewhere is refused"` (Review Focus 3).
  - `"nothing already placed moves or changes price when a dish is sent"` (compare every row).
  In `till-api.set-menu-send.test.ts`: the submit route with a set-menu line, and the refusal's status.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-send.test.ts src/till-api.set-menu-send.test.ts`; they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, `src/working-order.test.ts`, `src/order-groups.test.ts`,
  `src/order-drafts.test.ts` and `src/till-api.drafts.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: place set-menu dishes when they are sent".

### Task 7c: Set-menu dishes after the period, late sends and sold out

**Files:**
- Modify: `apps/server/src/working-order.ts` (`priceOrderLines`' period check `:681-729`,
  `judgeLateUnsent` `:1997`, `unplacedLateDishes` `:2095`), `apps/server/src/till-api.ts` (the
  mark-sold-out routes: grep `sold-out` / `markSoldOut`)
- Test: `apps/server/src/set-menu-period.test.ts`

**Interfaces:**
- A set-menu dish tapped in the bill's recorded copy of its set menu takes no period check: a
  table can order its desserts after the full menu's period ends (spec §3). One tapped in a set
  menu the bill has not recorded is checked against the full menu's period as today.
- The late-send checks keep judging a stored line by its `menu_id`, which is the full menu, so
  #3414's question still applies to a set-menu dish saved before the period ended and sent after.
- The mark-sold-out routes accept a dish only a set menu lists.

- [ ] **Step 1: Write the failing tests:** `"a dessert from the bill's Daily copy sends after the
  period ended"`; `"and after the full menu was republished"`; `"a dish from a set menu the bill
  does not hold is refused after the period"`; `"a held set-menu main saved before the period
  ended asks before it is fired after"`; `"a dish only a set menu lists can be marked sold out,
  and is then refused"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-period.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, `src/working-order.late-send.test.ts` and
  `src/till-api.sell-published.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: a bill's set-menu dishes after the period, late sends and sold out".

### Task 8: The waiter's move of placed dishes

**Files:**
- Create: `apps/server/src/set-menu-moves.ts`
- Modify: `apps/server/src/till-api.ts` (route)
- Test: `apps/server/src/set-menu-moves.test.ts`

**Interfaces:**
- `POST /api/bills/:id/set-menu-moves` body `{ moves: DishMove[]; expectedPartyRevision: number }`,
  checked and bumped as Task 6's routes, answering `{ setMenus: BillSetMenuState; partyRevision }`.
  It serves the suggested move (decision 5) and the summary's **Move** (decision 10).
- `moveSetMenuDishes(tx, workingOrderId, moves)` first calls `refusePaymentInFlight`, then runs
  `checkMoves` (Task 3) on the bill's state in the transaction; `place_taken` →
  `set_menu.place_taken`; `not_placed` (a cancelled dish, decision 12, or another line) →
  `management.request_invalid` `{ field: "moves" }`; a dish
  that is not `movable` → `set_menu.place_taken` (none exists until piece 4). It writes each moved
  dish with `setMenuDishColumns(result, copy)` and calls `refuseOrderOverSimplifiedLimit`, since a
  move can raise the total (+5.00); nothing else on the bill changes.

- [ ] **Step 1: Write the failing tests:** `"moving the Sirloin to the Daily stores +5.00 and
  frees the Special's main"`; `"a move into a place taken since is refused and writes nothing"`;
  `"a move to a set menu that does not list the dish is refused"`; `"two dishes swap places in one
  request"`; `"a stale revision is refused"`; `"a cancelled dish cannot be moved"`; `"a move is
  refused while a payment is in progress"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-moves.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it and `src/till-api.session-person.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: move placed dishes between a bill's set menus".

### Task 9: Editing and cancelling set-menu dishes, and the cancel routes

**Files:**
- Modify: `apps/server/src/working-order.ts` (`applyLineEdits` `:5992`, `updateHeldOrder` `:7068-7084`,
  `updateOrderLine` `:7189`), `apps/server/src/adjustments-apply.ts` (`planAdjustment` `:801`),
  `apps/server/src/line-cancel.ts` (`cancelItem` `:92`)
- Test: `apps/server/src/set-menu-edits.test.ts`

**Interfaces:**
- Editing a stored set-menu dish re-reads its offer through the lookup, never the zone's offers.
  Options, extras, note, course and group edit as for any dish and never change its place, price
  or counts-as course (spec: "classification is fixed"). Raising a set-menu dish's quantity adds
  units that `applyLineEdits` already splits one per line (`working-order.ts:6710`); they are
  placed by `placeSetMenuRows` (Task 7b) before they are inserted, in the order of the edit, and
  the dish already placed keeps its place (decision 8). A new unit with no place →
  `set_menu.no_place`, and the edit writes nothing.
- A cancel that keeps the row (started work, a `cancel` adjustment) frees the dish's place
  (decision 12); one that deletes the row frees it too.
- Cancelling a set-menu dish (its one unit) through either cancel route removes or cancels the
  line as today; its place is open again, and nothing else on the bill changes.
- Both cancel routes refuse a set-menu line itself with `set_menu.remove_from_summary`; Cancel on a
  set menu is Task 6's route.

- [ ] **Step 1: Write the failing tests:** `"changing a sirloin's doneness keeps its place and
  price"`; `"raising a set-menu soup to 2 places the new soup and leaves the first where it was"`;
  `"a raise with no place for the new unit is refused and writes nothing"`; `"serving a starter as
  a main keeps it counted as a starter"`; `"a started dish cancelled with its charge taken off
  frees its place, and its set menu can then be removed"`; `"cancelling the sea bass opens its place and changes nothing
  else"`, through each cancel route; `"a cancel route refuses a set-menu line"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-edits.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, `src/working-order.test.ts` and the adjustments and
  line-cancel suites (`ls apps/server/src/adjustments*.test.ts apps/server/src/line-cancel*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: edit and cancel set-menu dishes without moving them".

### Task 10: Taking money on a set-menu bill waits for piece 4

**Files:**
- Modify: `apps/server/src/set-menu-bill.ts` (`refuseSetMenuMoney`), `apps/server/src/working-order.ts`
  (`priceStoredOrderForIssuance` `:1330-1345`), `apps/server/src/bill-payments.ts`
  (`beginBillPayment` `:1207`, before its insert at `:1271-1272`),
  `apps/server/src/adjustments-apply.ts` (`planAdjustment` `:801`)
- Test: `apps/server/src/set-menu-money.test.ts`

**Interfaces:**
- `refuseSetMenuMoney(tx, workingOrderId): Promise<void>` throws `set_menu.payment_not_ready` when
  the bill holds a set-menu line or a set-menu dish. One line at the function says piece 4's plan
  removes it.
- **It refuses STARTING to take money, never recording money already taken.** Called: in
  `beginBillPayment` before its insert; in `planAdjustment` for every action in
  `ADJUSTMENT_ACTIONS` except `cancel` (`packages/shared/src/adjustment-policy-types.ts:6-11`);
  `planAdjustment` only reads, so a preview is refused too; and at the start of
  `priceStoredOrderForIssuance` when `refuseUnsentUnavailable` is true (its default). Every whole
  payment and ticket goes through that function (callers at `bill-payments.ts:784`,
  `till-sale.ts:867,1432,1965,2419`, `working-order.ts:7429`); a whole payment writes no
  `bill_payments` row (Fable F1, which ran it). A call with `refuseUnsentUnavailable: false` files
  money already captured and is not refused: nothing can capture money on such a bill, since the
  reader path is priced first (`till-sale.ts:1432`, "Before the reader is asked"). For the same
  reason the two writers that record a capture already made are not refused: the retained-money
  write (`apps/server/src/payments-api.ts:1576`, `submissionId: capture:…`) and
  `retainShortCapture` (`apps/server/src/till-sale.ts:1611`, "The provider row already retains
  the money", its insert `:1626`). Refusing there would leave captured money unrecorded.
- The commit message lists every call site.

- [ ] **Step 1: Write the failing tests** (Fable F1's cases): `"a bill holding set menus cannot be
  paid"`, one case each: an item payment, a contribution, a whole payment in cash, by hand-keyed
  card and at the reader, place then collect, unpaid departure (`apps/server/src/unpaid-departure.ts`),
  a deferred close (`apps/server/src/deferred-close.ts`); `"a comp or a discount on it is
  refused, and so is its preview"`; `"cancelling a dish on it is allowed"`; `"a bill without set
  menus is paid as before"`. Start from the shapes in `apps/server/src/bill-editing.whole-payments.test.ts`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-money.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it and the bill-payments, till-sale and adjustments
  suites (`ls apps/server/src/{bill-payments,till-sale,adjustments}*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: hold payments on a set-menu bill until the receipt work lands".

### Task 11a: Moving set menus and set-menu dishes to another bill, and merging bills

**Files:**
- Modify: `apps/server/src/bill-actions.ts` (`moveDishes` `:270`, `moveCheckedDishes` `:356`,
  `mergeBills` `:116`, `mergeCheckedBills` `:156`), `apps/server/src/working-order.ts`
  (`moveOrderLines` `:4180`, `carveLines` `:4764`), `apps/server/src/set-menu-moves.ts`
  (`replaceMovedDishes`)
- Test: `apps/server/src/set-menu-bill-moves.test.ts`

**Interfaces:**
- A set-menu line moves with every dish placed on it, keeping their places and prices; its own
  copy and price stay (decision 9). When the target has no recorded copy of that set menu, the
  source's row is copied to the target; when it has one, it keeps it (owner, Q9).
- A set-menu dish moved without its set-menu line is placed again on the target by `placeInOrder`
  (no reservations), and written with `setMenuDishColumns` by `replaceMovedDishes`; with no place
  → `set_menu.no_place_on_target` naming it, whose wording says to move a set menu with it, and
  nothing moves (spec §4).
- A move of a set-menu line or dish to a bill that `refuseUnlessSetMenuBill` refuses is refused
  with its code. Nothing changes on the bill left behind (spec §4).
- Merging two bills keeps the target's recorded copies, adds the source's for set menus the target
  lacks, and keeps every line's place and price.

- [ ] **Step 1: Write the failing tests:** `"moving a Daily menu moves its dishes with it, prices
  unchanged"`; `"a sirloin moved alone onto a bill holding a Special is placed there at 0.00"`;
  `"a dish moved alone to a bill with no place for it is refused and nothing moves"`; `"the target
  keeps its own copy, and a moved set menu keeps its price"`; `"merging keeps every set menu and
  place"`; `"a set menu's dishes are on its bill after every move"` (in place of a database
  trigger, Task 4); `"a set menu cannot move to a counter order"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-bill-moves.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, `src/move-dishes.test.ts`, `src/move-merge.test.ts`
  and `src/transfer-lines.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: move set menus and their dishes between bills".

### Task 11b: Moving a whole bill, changing its dining, and splitting a table or draft

**Files:**
- Modify: `apps/server/src/move-bill.ts` (`moveBill` `:136`, `refuseUnseatable` `:461-470`),
  `apps/server/src/order-dining.ts` (`switchOrderDining` `:95-140`), `apps/server/src/table-actions.ts`
  (`splitTable` `:345`), `apps/server/src/order-drafts.ts` (`splitDraft` `:135`)
- Test: `apps/server/src/set-menu-bill-split.test.ts`

**Interfaces:**
- A bill holding set menus cannot move to a counter or to a zone that is not table service
  (`set_menu.not_seated`), nor switch to takeaway (`set_menu.takeaway`, checked before
  `order.dining_locked`, so the waiter reads the set-menu reason, spec §5). Moving it to another
  table keeps its copies, set menus and dishes.
- `splitTable` moves loose dishes through Task 11a's move, so its refusals apply.
- `splitDraft` carries a set-menu draft line's `setMenuId` and clears its reservation (it named the
  source bill's set menu).

- [ ] **Step 1: Write the failing tests:** `"a bill holding set menus cannot move to a counter or
  become takeaway"`; `"moving it to another table keeps its set menus and prices"`; `"splitting a
  table moves a set-menu dish only where it has a place"`; `"splitting a draft takes its set-menu
  dishes without their reservations"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-bill-split.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, `src/till-api.move-bill.test.ts`,
  `src/order-drafts.test.ts` and the split-table suites (grep `splitTable` under `apps/server/src/*.test.ts`).**
- [ ] **Step 5: Commit** — "Set menus: keep set menus to seated, eat-in bills when a bill moves or a table splits".

### Task 12a: A set-menu line never reaches a ticket or a station

**Files:**
- Modify, where Step 3 finds a reader can meet a set-menu line: `apps/server/src/kitchen-print.ts`,
  `kitchen-release.ts`, `dish-kitchen.ts`, `kitchen-allergy.ts`, `closed-station-alert.ts`,
  `station-closing.ts`, `station-delete.ts`, `station-move.ts`, `station-outputs-down.ts`,
  `made-here.ts`, and `fireLines` (`working-order.ts:2196`).
- Test: `apps/server/src/set-menu-kitchen.test.ts`

**Interfaces:**
- Each reader skips `set_menu_role = 'set_menu'` rows, or the commit message says why it cannot
  meet one (decision 2: sent, served, no group, no ticket item). A set-menu dish is an ordinary
  dish to every one of them. Tasks 12a and 12b together cover every non-test file under
  `apps/server/src` on the kitchen or service side that selects from or joins
  `working_order_lines` at `b31ec62e37`.

- [ ] **Step 1: Write the failing tests:** `"a set-menu line prints on no kitchen ticket and fires
  with no group"`; `"a station screen shows the set-menu dishes and not the set menu"`; `"closing
  or deleting a station is not held by a set-menu line"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-kitchen.test.ts`; they fail.
- [ ] **Step 3: Implement**, recording each reader and its choice in the commit message. **Step 4:
  Run the file and the suites of the files changed.**
- [ ] **Step 5: Commit** — "Set menus: keep a set-menu line off tickets and stations".

### Task 12b: A set-menu line in the pass and the service readers

**Files:**
- Modify, where Step 3 finds a reader can meet a set-menu line: `apps/server/src/pass-board.ts`,
  `pass-coverage.ts`, `service-step-signals.ts`, `line-service-state.ts`, `table-signals.ts`,
  `finish-party-service.ts`, `rest-of-order.ts`.
- Test: `apps/server/src/set-menu-service.test.ts`

**Interfaces:**
- As Task 12a, for these readers.

- [ ] **Step 1: Write the failing tests:** `"the pass shows the set-menu dishes and not the set
  menu"`; `"finishing a party's service is not held by a set-menu line"`; `"the rest of the order
  lists no set menu"`; `"a table's service signals ignore a set-menu line"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-service.test.ts`; they fail.
- [ ] **Step 3: Implement**, recording each reader and its choice in the commit message. **Step 4:
  Run the file and the suites of the files changed.**
- [ ] **Step 5: Commit** — "Set menus: keep a set-menu line out of the pass and service signals".

### Task 12c: A set-menu line in the till's other line readers

**Files:**
- Modify: `apps/server/src/order-groups.ts` (`readCurrentOrders` `:2103`), `apps/server/src/party-allergy.ts`,
  `apps/server/src/line-nutrition.ts`, `apps/server/src/order-state-counts.ts`, `apps/server/src/orders-list.ts`,
  `apps/server/src/order-preview.ts`
- Test: `apps/server/src/set-menu-readers.test.ts`

**Interfaces:**
- `readCurrentOrders` leaves set-menu lines out of its dishes (the till draws them in the summary,
  Task 15a). The allergy and nutrition readers skip set-menu lines and read set-menu dishes as
  dishes. Order counts and the orders list count a set-menu line as nothing still to do. Bill-side
  readers (receipts, invoices, payments) are piece 4's.

- [ ] **Step 1: Write the failing tests:** `"the current-orders read lists no set menu"`; `"the
  party's allergy check reads the set-menu dishes and skips the set menu"`; `"order counts do not
  count a set-menu line as waiting"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/set-menu-readers.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it and each changed reader's suite.**
- [ ] **Step 5: Commit** — "Set menus: read set-menu lines apart from dishes".

### Task 13: The till's set-menu data

**Files:**
- Modify: `apps/till/src/api/client.ts` (`ZoneOffers` `:446`, `FreshDraftLine` `:733`, `PartyBill`
  `:2193`, new calls beside the guest count `:5032-5040`), `apps/till/src/till-app.ts`
  (`ZoneOfferIndex` `:1899` and `setUnavailable` `:1932`), `apps/till/src/state/draft-lines.ts`
  (`toDraftLineInput` `:23`, `fromDraftLine` `:70`), `apps/till/src/state/menu-refresh.ts`
  (`isStale` `:211`), `apps/till/src/api/live-connection.ts` (`ORDER_TYPES` `:16-24`: add
  `bill_set_menu_copies`)
- Create: `apps/till/src/state/set-menus.ts`
- Test: `apps/till/src/state/set-menus.test.ts`, `apps/till/src/state/draft-lines.test.ts`

**Interfaces:**
- Client calls: `setSetMenuCount(billId, setMenuId, count, expectedPartyRevision)`,
  `removeSetMenu(billId, lineId, expectedPartyRevision)`, `moveSetMenuDishes(billId, moves,
  expectedPartyRevision)`, `readBillSetMenus(billId)`. `PartyBill` gains
  `setMenus: BillSetMenuState` and `setMenuCopies: ServedSetMenuCopy[]` (Task 6: the bill's
  recorded copies in full, which the zone read stops serving once the full menu is republished);
  `FreshDraftLine` gains `setMenuId` and `setMenuReserved: DishPlace | null`.
- `ZoneOfferIndex` gains `setMenus: ServedSetMenu[]`; a set-menu dish is looked up in its copy,
  never in the ordinary index; a sold-out update reaches the copies' dishes. `fromDraftLine` and
  `isStale` do the same for a line with `setMenuId`, looking first in the bill's `setMenuCopies`,
  so a line from a recorded copy is never stale for its version no longer being live.
- `apps/till/src/state/set-menus.ts` produces:

```ts
/** The copies a bill orders from, in full for drawing: its `setMenuCopies`, plus the zone's
 * `newestOnSale` copy of each set menu it has not recorded. */
export function orderingCopies(
  bill: Pick<PartyBill, "setMenus" | "setMenuCopies">, zone: readonly ServedSetMenu[],
): { copy: ServedSetMenuCopy; versionId: string }[];
/** Where each draft set-menu dish of this bill will go, in draft order (Task 2's rule). */
export function draftPlacements(
  bill: BillSetMenuState, draft: readonly OrderLine[],
): { placed: PlacementResult[]; unplaced: string[] };
```

- [ ] **Step 1: Write the failing tests** in `set-menus.test.ts`: `"a bill orders from its recorded
  copy, else the zone's newestOnSale copy, never one that is not on sale"`; `"after a republish
  the bill still orders from its recorded copy"`; `"the draft's set-menu dishes are placed after the bill's, in draft
  order"`; `"a draft dish's reservation is kept"`. In `draft-lines.test.ts`: `"a set-menu draft
  line is found in its copy, not marked removed"`, and `"a set-menu dish sold out reaches its copy"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/state/set-menus.test.ts src/state/draft-lines.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run them, `src/state/menu-refresh.test.ts` and
  `src/till-app-menu-refresh.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: the till's set-menu data".

### Task 14: The till — set-menu folders

**Files:**
- Modify: `apps/till/src/widgets/menu-browser.ts` (`#pick` `:577`, `#tile` `:786`, `#home` `:819`,
  `#sectionView` `:854`), `apps/till/src/widgets/product-pick.ts`, `apps/till/src/screens/till-table-order-screen.ts`
  (`canSelectProduct` `:2913`)
- Create: `apps/till/src/widgets/set-menu-folder.ts`
- Test: `apps/till/src/widgets/set-menu-folder.test.ts`, `set-menu-folder.a11y.test.ts`,
  `apps/till/src/widgets/menu-browser.set-menu.test.ts`

**Interfaces:**
- Consumes: `orderingCopies` (Task 13); piece 1's `set_menu` `DocumentMember`.
- A `set_menu` member draws as a folder tile with the set menu's name and price, on a seated
  table's bill only. It opens the bill's recorded copy of that set menu, else the zone's
  `newestOnSale` copy (a set menu with neither is not drawn).
- `till-set-menu-folder` draws the copy like its board: each line a heading worded from its
  courses' names ("Starter", "Main or starter", "2 × Starter" when its count is above 1), the
  dishes under the first line that accepts the course the copy gives them (spec, **my call**), each
  showing **Included** or its surcharge ("+€5.00"). A dish sold by measure is not drawn
  (decision 7). Tapping a dish goes to Task 16a's check first, then opens exactly what it opens à la
  carte (`pickProduct`, the modifier picker). The line it adds carries `setMenuId`, the copy's
  version and menu item, quantity 1 and `noMerge`, and its course is the served offer's `courseId`
  for the chosen variant (the set menu's course when it gives one), so `placeFor` places it.
- At the top of the folder, **Add a {set menu}** raises that type's count by one.
- When a set menu the bill holds is in no served tree (after the period), a **Set menus** tile on
  the home lists the bill's held set menus as folders (spec §3, **my call (plan writer)** on the
  tile).

- [ ] **Step 1: Write the failing tests:** `"a set-menu folder shows its lines as headings and each
  dish as included or with its surcharge"`; `"a dish two lines accept is listed under the first"`;
  `"tapping a sirloin opens its doneness question and adds a set-menu line of quantity 1"`;
  `"bravas the set menu gives Starters are drafted in the Starters course, and à la carte bravas
  in Sharing plates"`; `"a counter order draws no set-menu folder"`; `"Add a Special menu raises
  its count"`; `"after the period a bill holding set menus still opens their folders from the Set
  menus tile"`; `"after the full menu is republished mid-meal at 15.00, the bill's Daily folder
  still opens at 14.00 from its recorded copy, a soup tapped there is drafted, and a new bill's
  folder shows 15.00"`; a11y in both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/set-menu-folder.test.ts src/widgets/set-menu-folder.a11y.test.ts src/widgets/menu-browser.set-menu.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run them and the `src/widgets/menu-browser*.test.ts` files.**
- [ ] **Step 5: Look at it** on Claude's own stack (`wa-wt demo <worktree>`, never slot 1,
  CLAUDE.md §6) with set menus built on the dashboard, in both themes and at phone width.
- [ ] **Step 6: Commit** — "Set menus: set-menu folders on the till".

### Task 15a: The till — the counts and the summary

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`#ordering` `:3068`)
- Create: `apps/till/src/widgets/set-menu-counts.ts`, `apps/till/src/widgets/set-menu-summary.ts`
- Test: `apps/till/src/widgets/set-menu-counts.{test,a11y.test}.ts`,
  `apps/till/src/widgets/set-menu-summary.{test,a11y.test}.ts`,
  `apps/till/src/screens/till-table-order-screen.set-menus.test.ts`

**Interfaces:**
- On a seated bill, above the order's lines, `till-set-menu-counts` shows one `wt-number-stepper`
  (`packages/ui/src/components/wt-number-stepper.ts`, used as in `apps/till/src/widgets/guest-count.ts:56-70`)
  per set menu the bill holds or the zone has on sale: "Menú del día − 2 +". Each tap is saved at
  once (owner, Q4); a refusal shows its wording beside that stepper and puts the count back. A
  `wt-help-tooltip` with `mode="help-mode"` orients in two sentences and links to the guide's
  `{#set-menus}` section (Task 17).
- `till-set-menu-summary`, from the bill's state and `draftPlacements`, folds to the spec's two
  lines ("4 set menus · 2 Menú del día + 2 Menú especial", "open: 4 Dessert or coffee · 4 Bread ·
  4 Drink"; open places summed by line and named as the folder headings). **show** unfolds one row
  per set menu, each place filled with its dish (a draft dish drawn as not yet sent) or shown open.
  Each row offers **Cancel** (Task 6's route) and each placed dish **Move**, which lists the open
  places `checkMoves` accepts, with their prices (decision 10).
- After − or Cancel, a draft dish whose preview or reservation no longer has a place is marked
  "no place" in the summary and the basket, and Task 16a's question opens for the first such dish
  (decision 13).

- [ ] **Step 1: Write the failing tests:** `"a tap saves at once and a refusal puts the count back
  with its reason"`; `"the counts list held set menus and those on sale"`; `"the folded summary
  names the set menus and the open places"`; `"unfolded, each set menu shows its dishes, draft
  dishes and open places"`; `"Cancel on an empty set menu removes it; on one holding dishes it
  shows the refusal naming them"`; `"Move shows the open places with their prices and saves the
  move"`; `"− on the Daily a draft sea bass was previewed on marks it and asks"`; `"a counter order
  shows no counts"`; a11y for the counts and the summary, folded and
  unfolded, in both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/set-menu-counts.test.ts src/widgets/set-menu-counts.a11y.test.ts src/widgets/set-menu-summary.test.ts src/widgets/set-menu-summary.a11y.test.ts src/screens/till-table-order-screen.set-menus.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run them and the `src/screens/till-table-order-screen*.test.ts` files.**
- [ ] **Step 5: Commit** — "Set menus: the set-menu counts and summary on the order panel".

### Task 15b: The till — the total and the line tags

**Files:**
- Modify: `apps/till/src/state/draft-layout.ts` (`panelTotal` `:181-183`), `apps/till/src/screens/till-table-order-screen.ts`
  (`#totals` `:3193`), `apps/till/src/widgets/basket.ts` (the name slot `:873`, the quantity cell),
  `apps/till/src/widgets/sent-orders.ts`
- Test: `apps/till/src/state/draft-layout.test.ts`, `apps/till/src/widgets/basket.set-menu.test.ts`

**Interfaces:**
- `panelTotal(storedTotal, ownLines, placedPrice?: (line: OrderLine) => string | undefined)`: a
  set-menu draft line counts at its `draftPlacements` price (0 or the surcharge of the set menu it
  will land on), its paid extras as today; an unplaced one at 0. The stored total already holds the
  set menus and placed dishes, so nothing jumps on sending (Fable F8: no calculation total is
  subtracted, so a comp in piece 4 cannot skew it).
- In the basket and in sent orders, a covered set-menu dish shows a small **menu** tag and one with
  a surcharge shows it ("+€5.00") (spec, **my call**). A set-menu draft line shows no quantity
  stepper (decision 6). Sent orders merge identical stored set-menu dish lines into one row for
  display, as they merge any whole-portion dish's lines today (`portionLineIds`,
  `apps/till/src/state/working-order.ts:84,216`; spec §3), and only lines with the same price and set menu
  merge, so "2 × Soup menu" and "Sirloin +€5.00" stay apart.

- [ ] **Step 1: Write the failing tests:** `"the total with an unsent sea bass is the stored total
  plus 0.00"`; `"a draft sirloin that will sit on a Daily adds +5.00, and on a Special 0.00"`; `"a
  covered dish shows menu and a sirloin shows +€5.00"`; `"a set-menu draft line has no quantity
  stepper"`; `"two sent soups on two set menus show as one row of 2, and a surcharged sirloin as
  its own row"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/state/draft-layout.test.ts src/widgets/basket.set-menu.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run them and the `src/widgets/basket*.test.ts` files.**
- [ ] **Step 5: Look at it** on Claude's stack: four set menus and their dishes, both themes,
  phone width.
- [ ] **Step 6: Commit** — "Set menus: the order panel's total and set-menu tags".

### Task 16a: The till — a dish with no place

**Files:**
- Create: `apps/till/src/widgets/set-menu-place-dialog.ts`
- Modify: `apps/till/src/widgets/set-menu-folder.ts` (the tap), `apps/till/src/screens/till-table-order-screen.ts`
  (after the picker confirms), `apps/till/src/till-app.ts` (a send refused `set_menu.no_place`)
- Test: `apps/till/src/widgets/set-menu-place-dialog.{test,a11y.test}.ts`, `apps/till/src/till-app-set-menus.test.ts`

**Interfaces:**
- Consumes: `draftPlacements`, `orderingCopies` (Task 13), `copiesListing` (Task 1), `suggestMove`
  (Task 3), the client calls.
- **When it asks** (owner, Q10): as soon as a set-menu dish is tapped, before its choices, when no
  kept variant of it has a place after the draft's dishes; and again after its choices, when the
  chosen variant has none. A dish with more than one kept variant is asked at tap without the move
  suggestion, which needs the variant (**my call (plan writer)**).
- `till-set-menu-place-dialog` (a `wt-dialog`, built as `apps/till/src/widgets/late-send-dialog.ts`
  is) says "No place for {dish} in the set menus on this bill." and offers (spec §2):
  - **Add a {set menu} ({price})** for each copy `copiesListing` gives: it raises that count, then
    drafts the dish reserved on its place in the new set menu (decision 4);
  - **Move {dish} to the {set menu} ({+price}) and put {new dish} in its place** when `suggestMove`
    answers: it saves the moves, then drafts the dish reserved on its place (decision 5); with
    several moves, each is named with its new price;
  - **Order it à la carte ({price})** when the product is an orderable offer in the zone's
    ordinary `offers`: it opens that offer's picker afresh;
  - **Cancel**: nothing is added.
- A send refused `set_menu.no_place` opens the same dialog for the dish it names.
- [ ] **Step 1: Write the failing tests:** `"a sea bass with no place asks at once, and Add a
  Special adds one and drafts the sea bass on it"`; `"after Add, a sirloin drafted earlier stays
  on the Daily"` (Review Focus 1, on the till); `"the suggested move is offered with its price and
  saves the move"`; `"a wine whose glass has a place but whose bottle has none asks after the
  bottle is chosen"`; `"Order à la carte is offered only when the dish sells à la carte here"`;
  `"Cancel adds nothing"`; `"a send refused for no place opens the question"`; a11y for the dialog
  in both themes.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/widgets/set-menu-place-dialog.test.ts src/widgets/set-menu-place-dialog.a11y.test.ts src/till-app-set-menus.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run them and `src/till-app-late-send.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: ask when a dish has no place in the bill's set menus".

### Task 16b: The till — the set-menu refusals' wording

**Files:**
- Modify: `apps/till/src/i18n/codes.ts` (`CODE_MESSAGES`, `codeMessage` `:998`)
- Test: `apps/till/src/i18n/codes.test.ts`

**Interfaces:**
- Wording in English and Spanish for every code in Global Constraints, each saying what to do
  (**my call (plan writer)**). For example:
  - `set_menu.holds_dishes`: "{setMenuName} holds {dishNames}. Cancel those dishes (and order them
    à la carte if the table still wants them), or move them to another set menu with Move." /
    «{setMenuName} tiene {dishNames}. Anula esos platos (y pídelos a la carta si la mesa aún los
    quiere) o pásalos a otro menú con Mover.»
  - `set_menu.payment_not_ready`: "Bills with set menus can't be paid on this version yet. À la
    carte dishes can be moved to another bill and paid there." / «Las cuentas con menús aún no se
    pueden cobrar en esta versión. Los platos a la carta se pueden pasar a otra cuenta y cobrar
    allí.» (Fable M7: a set-menu dish moves only where it has a place.)
  Use the till's existing Spanish word for a set menu if `strings.ts` already has one.

- [ ] **Step 1: Write the failing test:** `"each set-menu code is worded in English and Spanish"`,
  a table over every code in Global Constraints through `codeMessage`, each with its params filled.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/i18n/codes.test.ts`; it fails.
- [ ] **Step 3: Implement.** **Step 4: Run it**; it passes.
- [ ] **Step 5: Commit** — "Set menus: word the set-menu refusals in English and Spanish".

### Task 17: The till — moving set menus to another bill, the guide, and the whole flow

**Files:**
- Modify: the move-dishes flow in `apps/till/src/till-app.ts` (grep `moveDishes`)
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`,
  `docs/backlog/menu.md` (the A1515 entry, `### A1515. Set menus`)
- Test: `apps/till/src/till-app-move-dishes.test.ts` (more cases)

**Interfaces:**
- The move screen lists the bill's set menus as rows; choosing one takes its dishes with it. A
  set-menu dish chosen alone shows its price on the target first, from the target's state
  (`readBillSetMenus`, placed with `placeInOrder`) (spec §4). Refusals show their wording.
- Guide: a `## Set menus at a table {#set-menus}` section in both languages, written from the code
  as built: setting the counts, ordering from the folders, reading the summary, what happens when
  a dish has no place, moving a dish between set menus, moving set menus to another bill, and that
  a counter order cannot have one. A sentence earns its place by changing what staff do
  (CLAUDE.md §3). Both languages share the `{#set-menus}` id.

- [ ] **Step 1: Write the failing tests:** `"a set menu moves to another bill with its dishes"`;
  `"a dish moved alone shows its new price first"`; `"a refused move shows its reason"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/till exec vitest run src/till-app-move-dishes.test.ts`; they fail.
- [ ] **Step 3: Implement.** **Step 4: Run it, then
  `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts` at the root.**
- [ ] **Step 5: Look at it end to end** on Claude's stack:
  - seat a table; set 2 Menú del día and 1 Menú especial;
  - order soups, a hake and a sirloin from the Del día folder; check the sirloin is shown on the
    Especial at 0.00 and the total before and after sending;
  - tap a sea bass; take the suggested move; check the sirloin now shows +5.00;
  - press − on the Del día while it holds dishes, and read the refusal;
  - move one Del día and its dishes to a new bill;
  - try to pay, and read the refusal.
  Record what was done and seen in the PR.
- [ ] **Step 6: Update `docs/backlog/menu.md`'s A1515 entry** to say piece 2 has landed, that
  paying a set-menu bill waits for piece 4, and what is next, in the same commit.
- [ ] **Step 7: Commit** — "Set menus: move set menus on the till, and the table-service guide".
