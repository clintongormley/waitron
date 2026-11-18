# Set menus, piece 2: ordering set menus at a table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At a seated table, a waiter sets how many set menus the table is having, orders their
dishes as ordinary dishes from the set-menu folders, and sees how the bill is counting them; the
server keeps every set-menu price on the open bill right as the order changes.

**Architecture:** Each set menu on a bill is a line of its own on `working_order_lines` (role
`set_menu`, no product, priced by the fit). Each set-menu dish is an ordinary dish line marked role
`dish`, carrying the set menu it was ordered from, the course it counts as and the set-menu line
that covers it. A bill records the set-menu copies it may use (`bill_set_menu_copies`: a full
menu's version and a set menu id) when its first set menu is added. One server function,
`refitBill`, reads the bill's set menus, dishes and recorded copies, runs piece 3's `fitSetMenus`
and writes the outcome into the lines, inside the transaction of every write that changes them. The
till runs the same fit, through a shared browser-safe input builder, over the bill plus its unsent
draft, to draw the summary and the total and to ask before adding a dish no set menu can cover.
Taking money on such a bill waits for piece 4.

**Tech Stack:** TypeScript 7, drizzle (core migration set, `migration-baseline rebuild`), Hono
routes in `apps/server`, Lit screens in `apps/till`, Vitest 4 (browser mode for the till).

**Spec:** [docs/superpowers/specs/2026-11-17-set-menus-design.md](../specs/2026-11-17-set-menus-design.md),
section 2 "Ordering on the till", section 3 from "Which set menus it may use" to "What is stored",
section 4 "Moving dishes to another bill", section 5 and item 2 of "The pieces, for planning". Read
those before Task 1. A code map of this area, read at `33be7eaaf3`, is in the owner's checkout at
`docs/handoffs/2026-11-18-set-menu-ordering-code-map.md` (gitignored). Line numbers below are from
`33be7eaaf3`.

**Builds on:** piece 3, the fit (`packages/shared/src/set-menu-fit.ts`, landed in #3730; read its
plan's "The function, as every task sees it"). Piece 1 (plan
[2026-11-18-a1515-set-menu-dashboard.md](2026-11-18-a1515-set-menu-dashboard.md), Tasks 5 and 6:
`PublishedSetMenu`, `ServedSetMenu` with `key`, `versionIds` and `orderable`, and
`ServiceZoneOffers.setMenus`).

**Order:** after piece 1; after A1515-REMOVE (#3703), which deletes the set-lunch paths these files
share (`readLunchOffers`, `RECORDED_OFFER`, `service-dishes.ts`, the till's Choose later); and after
A1308 os5 (#3741), which rewrites `working_order_lines`' portion columns, the move, cancel and split
code, and the core baseline. Re-read every cited line range once those land: several will have
moved. A set-menu line takes the form os5 gives any line of quantity 1 (its own cohort of one, one
whole portion). os7 (planned) adds a foreign key on `order_draft_lines.menu_item_id`; a set-menu
dish's menu item is a real `menu_items` row, so it is unaffected.

**Review:** read once against the spec by a fresh-context reviewer on 18 November 2026, by reading
and grep, plus one `node:sqlite` probe with a control (the cover key). Its findings are applied.
Taking money waiting for piece 4 (decision 1) is its suggestion. So are the dish's menu context
being the full menu (decision 5), the content-based copy key (decision 7), the revision check on
count changes, the batched lookup, the missed writers (table and draft splits, the cancel route,
the sold-out routes, other payment writers), the panel total from the fit, and the task splits.

## Decisions this plan makes (the builder's, for the plan review and the owner)

Marked **my call** where they first appear in a task.

1. **Taking money on a bill holding set menus waits for piece 4.** Until piece 4 lands, a payment,
   a comp or a discount on such a bill is refused `set_menu.payment_not_ready` (Task 6). The spec's
   "When it stops changing" (freezing at the first payment, discount or comp) is therefore all
   piece 4's, with the receipt and invoice. The owner lands piece 4. This piece stores the outcome
   on the open bill, because the till's total, the count refusal and the moves read it. Cancelling
   a dish is an adjustment but not money: it is allowed and refits.
2. **A set menu is a line; the count is the number of such lines.** No count column: "Set menus 4"
   means four `set_menu` lines, each of quantity 1, so moving one set menu is moving one line.
3. **Set menus are written straight onto the bill, not through the draft.** A count change or a
   fixed type is saved at once, under the party's revision as the guest count is
   (`till-api.ts:3149-3162`), so every till at the table sees the same count and a stale or
   repeated request is refused. The dishes go through the draft and are sent like any dish.
4. **A set-menu line is born sent and served, and only the count removes it.** It is inserted with
   `sent_at` and `served_at` set and its served quantity equal to its quantity, so every reader of
   "still to send" or "still to serve" skips it unchanged; Tasks 8a and 8b handle readers that list
   every line. The cancel routes refuse a set-menu line (`set_menu.remove_by_count`); the count
   route deletes it directly, which is safe because no money can be on the bill (decision 1).
5. **A set-menu dish's menu context is its full menu; the set menu is a column of its own.** Its
   `menu_id`, `menu_name` and `menu_version_id` are the full menu whose published version holds the
   copy, as for any dish of that menu, so the late-send checks (`judgeLateUnsent`,
   `unplacedLateDishes`, `working-order.ts:2090-2179`) judge it by that menu's period. Its
   `menu_item_id` is the set menu's own menu item, and `set_menu_id` names the set menu.
6. **The server checks cover when dishes are sent, never when a draft is saved.** A draft is the
   waiter's scratchpad; the till asks while ordering, and sending refuses `set_menu.uncovered`.
7. **A bill's copies are recorded when its first set menu is added: every orderable copy the zone
   serves then.** A copy is named by `${setMenuId}:${hash}`, the `menuDocumentHash` of its
   `PublishedSetMenu`. That never changes, whichever versions hold it, so the till and the server
   agree and a stored key never goes stale. Piece 1's `ServedSetMenu.key` is changed to this in the
   same commit as this plan. A dish moved in from another bill brings that bill's copies with it.
   After the full menu's period ends, or after it is republished, the bill keeps ordering from its
   recorded copies; a bill with no set menus cannot start one once nothing is selling.
8. **The "Add a set menu?" question is asked once the dish's choices are made, just before it is
   added**, because its variant can decide whether it is covered (the glass of wine, not the bottle).
9. **The till's − button removes an unfixed set menu; a fixed one is removed from its summary row.**
   The server picks which unfixed line to delete: one the current outcome leaves empty, else the
   last added.
10. **A set-menu dish sold by measure counts as one dish per line.** Whole-portion dishes are sent
    one line per unit already (`order-portions.ts:69-94`); a measured dish is never split
    (`:69-72`), and a 0.3 kg fish is one main.
11. **The table-service guide section and the help bubble on the count land here** (CLAUDE.md §3).
    Piece 1's decision 8 is corrected to say so; piece 5 keeps the demo.

## Global Constraints

- **Money:** whole cents in the database, two-place decimal strings in API bodies; the fit takes
  and returns whole cents. Convert with `decimalToCents` / `centsToDecimal`.
- **Schema:** change the TypeScript schema, hand-written SQL only in `packages/db/triggers/core.sql`,
  then `pnpm --filter @waitron/db db:generate`. No new migration file. Classify the new table in
  `packages/db/src/classification.ts` with `working_order_lines`' class. Name every new
  `working_order_lines` column in the line update trigger that pins columns on a placed or settled
  bill (`core.sql:369-420`) and in the part-by-quantity row copy (`working-order.ts:5217-5251`).
  Name the new `order_draft_lines` column in the draft insert and upsert (`order-drafts.ts:1281-1322`).
  Verify by RUNNING `scripts/schema-constraints.test.ts`, `scripts/append-only-triggers.test.ts`,
  `scripts/behavioural-triggers.test.ts`, `scripts/starting-migrations.test.ts`,
  `scripts/classification-complete.test.ts`, `scripts/two-file-foreign-keys.test.ts` and
  `packages/fiscal-verifactu/src/inmutabilidad.test.ts`.
- **One transaction per request** (`withTransaction`); `refitBill` takes `tx` and never opens its
  own; a refusal it throws rolls back the whole write. Await queries on one transaction in turn.
- **Menu data once per request:** resolve set-menu copies and their offers once before any line
  loop, never per line (CLAUDE.md §3, "Resolve shared menu data once before a basket's line loop").
- **Errors:** `AppError`, codes declared in `apps/server/src/errors.ts`, given an HTTP status in
  `STATUS` (`apps/server/src/till-api.ts:443-516`), and worded in English and Spanish in
  `apps/till/src/i18n/codes.ts`, with a `codeMessage` branch (`:999-1027`) for each param the
  wording uses. Every refusal says what happened and what each choice does (CLAUDE.md §3). The
  codes, all **my call**:

  | Code                          | Params                                                     | When                                                                             |
  | ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
  | `set_menu.not_seated`         | `{}`                                                       | a set menu or set-menu dish on a bill that is not a seated table's               |
  | `set_menu.takeaway`           | `{}`                                                       | a set menu on a takeaway bill, or switching a bill holding one to takeaway (T17) |
  | `set_menu.none_selling`       | `{}`                                                       | a bill's first set menu while no set menu is orderable in its zone               |
  | `set_menu.uncovered`          | `{ setMenusNeeded: number \| null }`                       | sending or editing dishes would leave a set-menu dish uncovered                  |
  | `set_menu.count_below_needed` | `{ setMenusNeeded: number }`                               | removing a set menu the dishes need                                              |
  | `set_menu.move_uncovered`     | `{ side: "from" \| "to"; setMenusNeeded: number \| null }` | a move or split would leave a set-menu dish uncovered on either bill             |
  | `set_menu.too_many`           | `{}`                                                       | the fit answers `too_large`                                                      |
  | `set_menu.copy_not_on_bill`   | `{}`                                                       | a dish or key naming a copy the bill did not record                              |
  | `set_menu.remove_by_count`    | `{}`                                                       | a cancel route given a set-menu line                                             |
  | `set_menu.payment_not_ready`  | `{}`                                                       | a payment, comp or discount on a bill holding set menus, until piece 4           |

- **Seated** means all three: the bill has a party (`party_id`), its zone's mode is `table_tab`
  (`operations.ts:134-136`), and its dining is `eat_in`. A party bill can be takeaway
  (`packages/venue-service/src/dining.ts:120-138`).
- **English only** in code, tests and fixtures ("Daily menu", "Special menu"); Spanish only in
  `codes.ts`/strings translations and the Spanish guide.
- **Write paths:** if `scripts/write-path-tables.json` lists a table this plan writes by the time a
  task starts, write it only from the files it names.
- **Running tests:** `pnpm --filter <pkg> exec vitest run <files>`; read the `Tests` count. Till
  tests run in headless Chromium: check `memory_pressure | grep free` first.
- **Commits:** `git commit -s` for every commit.

## The shared shapes, as every task sees them

```ts
// packages/shared/src/set-menu-bill.ts (browser-safe; exported from the shared index)
import type { ServedSetMenu } from "./menu-document/menu-document-types.js";
import type { SetMenuDish, SetMenuFitInput, SetMenuOffer } from "./set-menu-fit.js";

export interface BillSetMenuLine {
  lineId: string;
  /** The copy the fit (or the waiter) chose: a `ServedSetMenu.key`. */
  key: string;
  fixed: boolean;
  price: string;
}
export interface BillSetMenuDish {
  lineId: string;
  /** The offer's product; the chosen variant goes in `variantId`. */
  productId: string;
  variantId: string | null;
  countsAsCourseId: string;
  coverLineId: string | null;
  place: number | null;
  surcharge: string;
}
export interface BillSetMenus {
  /** The bill's recorded copies, keyed as decision 7 says; empty until its first set menu. */
  copies: ServedSetMenu[];
  setMenus: BillSetMenuLine[];
  dishes: BillSetMenuDish[];
}

export function setMenuOfferOf(copy: ServedSetMenu): SetMenuOffer;
/** The fit's input for this bill plus `extra` dishes not yet on it (the till's draft, or a send). */
export function fitInputOf(bill: BillSetMenus, extra: readonly SetMenuDish[]): SetMenuFitInput;
```

- `setMenuOfferOf`: `id` is `copy.key`, `priceCents` the terms' price, `lines` the terms' lines,
  and one `dishes` entry per offer with no variants (`variantId: null`) and per kept variant
  (`productId` the offer's product, `variantId` the variant), `surchargeCents` its `unitPrice`.
- `fitInputOf`: a set menu is `fixedOfferId: key` when `fixed`, else null; no dish is pinned in
  this piece (piece 4 adds freezing); `previous` is the stored outcome (every set menu's `key`,
  every dish with a cover). A dish whose `coverLineId` names no set menu on the bill is passed with
  no previous place.
- A dish line's fit id is its line id; a till draft line of quantity q gives q dishes with ids
  `${draftLineId}#${i}` (a measured dish gives one, decision 10).

---

## Review Focus

1. **Fewer dishes than set menus.** Four set menus and three dishes: all four are charged at the
   cheapest type and the summary shows the open places. Pinned in Task 2, "charges a set menu
   with no dishes".
2. **The same product ordered à la carte and from a set-menu folder on one bill.** The à la carte
   line keeps its à la carte price and is never covered; the set-menu one is. Pinned in Task 4b,
   "an à la carte line is never a set-menu dish".
3. **One till lowers the count while another sends dishes that need it.** Whichever commits second
   is refused (`set_menu.count_below_needed`, or `set_menu.uncovered`) and writes nothing. Pinned
   in Task 4b, "a send after the count was lowered elsewhere is refused".
4. **A sirloin ordered from the Special menu's folder.** It lands wherever the bill is cheapest,
   which may be a Daily menu at +€5.00 rather than an extra Special: a folder never costs money.
   Pinned in Task 4b, "the folder a dish came from does not decide its set menu".
5. **The full menu republished, or its period ended, mid-meal.** A table already holding set menus
   keeps its recorded prices and folders and can still send a dessert; a new table gets the new
   copy; a table with none cannot start one once nothing is selling. Pinned in Tasks 3, 4a and 10.

---

### Task 1: Schema — set-menu lines, set-menu dishes and a bill's recorded copies

**Files:**
- Modify: `packages/db/src/schema/orders.ts` (`working_order_lines` `:195-387`)
- Modify: `packages/db/src/schema/order-drafts.ts` (`order_draft_lines` `:58-114`)
- Create: `packages/db/src/schema/set-menu-copies.ts`; export it from the schema index
- Modify: `packages/db/triggers/core.sql` (line update trigger `:369-420`), `packages/db/src/classification.ts`
- Regenerate: `packages/db/drizzle/0000_baseline.sql` and its snapshot
- Test: `packages/db/src/schema/set-menu-lines.test.ts`

**Interfaces:**
- On `working_order_lines`: `setMenuRole` (`enumType(["set_menu","dish"])`, nullable), `setMenuId`
  (`id`, nullable, foreign key to `menus.id`), `setMenuKey` (`label`, nullable),
  `setMenuFixed` (`flag`, not null, default false), `setMenuCountsAsCourseId` (`id`, nullable; no
  key, with a one-line reason at the column as `extraListId` has: a course can be deleted while an
  open bill counts a dish as it), `setMenuCoverLineId` (`id`, nullable, foreign key to
  `working_order_lines.id` on delete set null), `setMenuPlace` (`count`, nullable).
- CHECK `working_order_lines_set_menu_ck`:
  - role null ⇒ every `set_menu_*` column null and `set_menu_fixed` false;
  - role `set_menu` ⇒ `set_menu_id` and `set_menu_key` not null; `menu_item_id`, `product_id`,
    `parent_line_id`, `course_id`, the counts-as course, the cover and the place null;
  - role `dish` ⇒ `set_menu_id`, `menu_item_id` and the counts-as course not null;
    `parent_line_id` and `set_menu_key` null; `set_menu_fixed` false.
  The cover and the place are not tied together in the CHECK: deleting a set-menu line clears only
  the cover (set null), and the next refit rewrites both. (The review's probe on `node:sqlite`
  showed a "together" clause refuses that delete.) An extras child of a set-menu dish keeps role
  null: it is an ordinary paid extra.
- On `order_draft_lines`: `setMenuId` (`id`, nullable): the set menu a dish was ordered from. Its
  copy is the one holding `(menu_version_id, menu_item_id)` for that set menu.
- `billSetMenuCopies` (`bill_set_menu_copies`): `workingOrderId` → `working_orders.id` on delete
  cascade, `menuVersionId` → `menu_versions.id`, `setMenuId` → `menus.id`; primary key
  `(working_order_id, menu_version_id, set_menu_id)`.

- [ ] **Step 1: Write the failing database tests** in `set-menu-lines.test.ts`, with `useVenueDb`
  on the core set and rows inserted directly:
  - `"a set-menu line holds a set menu and a key and no product"`: role `set_menu` with a
    `product_id` is refused naming `working_order_lines_set_menu_ck`; without `set_menu_key`
    refused; with a key and no product accepted.
  - `"a set-menu dish needs its set menu, a counts-as course and a menu item"`.
  - `"an ordinary line carries no set-menu values"`.
  - `"deleting a set-menu line leaves its dishes' cover empty"`: delete is accepted; the dish's
    cover is null.
  - `"a bill's recorded copy names a real version and set menu, and goes with the bill"`.
  - `"a set-menu column cannot change on a placed bill"`: the line update trigger refuses changing
    `set_menu_key` once the bill is placed (find the trigger's existing test by grepping for its
    name and follow it).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Add the columns, the table, the CHECK, the trigger's column names and the
  classification; run `db:generate`.** Add `bill_set_menu_copies` to the live-update change sources
  beside `working_order_lines` (`packages/db/src/classification.ts:450`).
- [ ] **Step 4: Run the test file and the schema verification list.** All pass; read each count.
- [ ] **Step 5: Commit** — "Set menus: store set-menu lines, set-menu dishes and a bill's set-menu copies".

### Task 2: A bill's set menus, and fitting it

**Files:**
- Create: `packages/shared/src/set-menu-bill.ts` (the shared shapes above)
- Create: `apps/server/src/set-menu-bill.ts`
- Modify: `apps/server/src/bill-payments.ts` (`assertBillInvariant` `:459`), if Step 4 places the
  refit there
- Test: `packages/shared/src/set-menu-bill.test.ts`, `apps/server/src/set-menu-bill.test.ts`

**Interfaces:**
- Consumes: `fitSetMenus` (piece 3); `readRecordedDocuments` (`packages/menu/src/menu-publication.ts:325`);
  piece 1's `PublishedSetMenu` and its set-menu-aware `applyLiveFields`.
- Produces in `apps/server/src/set-menu-bill.ts`:

```ts
/** The bill's recorded copies, served from their recorded versions with today's availability,
 * keyed `${setMenuId}:${hash}`; identical copies held by several recorded versions are one. */
export function readBillCopies(tx: Transaction, workingOrderId: string): Promise<ServedSetMenu[]>;
export function readBillSetMenus(tx: Transaction, workingOrderId: string): Promise<BillSetMenus>;
/** Fits the bill as it now stands and writes the outcome into its lines; throws `refusal(fit)`
 * when the outcome is not `fitted`, so the caller's transaction rolls back whole. */
export function refitBill(
  tx: Transaction,
  workingOrderId: string,
  refusal: (fit: Exclude<SetMenuFit, { kind: "fitted" }>) => AppError,
): Promise<BillSetMenus>;
```

- `refitBill` writes, for each set-menu line, `set_menu_key`, `unit_price_gross`, `line_total`,
  `name` and `descriptions` (from the copy's names), and for each set-menu dish `unit_price_gross`,
  `line_total` (its surcharge), `set_menu_cover_line_id` and `set_menu_place`, changing only rows
  whose values differ. Paid extras are never touched. A bill with no set-menu lines and no
  set-menu dishes writes nothing and reads no copies.
- `refusal` maps `uncovered` to the caller's code and `too_large` to `set_menu.too_many`.
- **Where the refit runs.** Every writer that changes a bill's set-menu lines or dishes (Tasks 3,
  4b, 5, 7a, 7b) calls `refitBill` before its transaction ends. Step 4 checks whether
  `assertBillInvariant` is already called by every such writer; if it is, the refit is called
  from there once (one place for future writers to inherit), and each writer passes the refusal
  its own code needs. Otherwise each writer calls it, and the commit message lists them.

- [ ] **Step 1: Write the failing shared tests** in `set-menu-bill.test.ts`:
  - `"a copy's offer lists each dish and each kept variant with its surcharge"`.
  - `"a fixed set menu keeps its key, and previous is the stored outcome"`.
  - `"a dish covered by a set menu no longer on the bill has no previous place"`.
  - `"a draft line of quantity 3 gives three dishes, a measured line one"`.
- [ ] **Step 2: Write the failing server tests** in `apps/server/src/set-menu-bill.test.ts`, with
  the spec's worked example as the fixture (Daily menu €14 with Sirloin +€5; Special menu €20 with
  Sirloin and Sea bass included), as set-menu lines and dish lines on a seated bill:
  - `"four set menus with 4 soup, 1 hake, 2 sirloin and 1 sea bass are charged €72"`: three lines
    keyed Daily at 14.00 and one Special at 20.00; both sirloins on Daily lines at 5.00; the sea
    bass on the Special at 0.00; the bill's stored total is 72.00.
  - `"charges a set menu with no dishes"`: two set menus and no dishes give two Daily lines at 14.00.
  - `"adding a dish only the Special lists turns one set menu into a Special"`, and only that
    line's key and price change (count updated rows).
  - `"a fixed set menu keeps its type"`.
  - `"a refused fit writes nothing"`: a dish no copy lists gives the caller's refusal, and every
    row is as before.
  - `"a bill keeps its recorded prices after the full menu is republished"`: record copies,
    republish the full menu at €15, refit: still 14.00.
  - `"identical copies in two recorded versions are one copy with one key"`.
  - `"a bill with no set menus reads no copies"` (count statements).
- [ ] **Step 3: Run; they fail.** **Step 4: Implement**, deciding where the refit runs as above.
- [ ] **Step 5: Run both files.** **Step 6: Commit** — "Set menus: fit a bill and store the outcome on its lines".

### Task 3: Adding, removing and fixing set menus on a bill

**Files:**
- Create: `apps/server/src/set-menu-count.ts`
- Modify: `apps/server/src/till-api.ts` (routes beside `/api/parties/:id/bills` `:3293-3325`;
  `STATUS`), `apps/server/src/errors.ts`, and the party bills read (`GET /api/parties/:id/bills`,
  `:3312`) so each bill carries `setMenus: BillSetMenus`
- Test: `apps/server/src/set-menu-count.test.ts`, `apps/server/src/till-api.set-menus.test.ts`

**Interfaces:**
- Consumes: `readBillSetMenus`, `refitBill` (Task 2); `ServiceZoneOffers.setMenus` (piece 1).
- Routes, each with `expectedPartyRevision` in the body, refused as stale the way
  `PUT /api/parties/:id/guests` refuses it (`till-api.ts:3149-3162`), each bumping the party's
  revision, each behind `requireSession(deps, c, { action: "take-orders" })` and `checkZones`, and
  each answering `{ setMenus: BillSetMenus; partyRevision: number }`:
  - `PUT /api/bills/:id/set-menus` body `{ count: number }` (0–99): adds or removes unfixed
    set-menu lines until the bill holds `count` set menus in all (decision 9).
  - `POST /api/bills/:id/set-menus` body `{ key: string }`: adds one set menu fixed to that copy.
  - `PUT /api/bills/:id/set-menus/:lineId` body `{ key: string | null }`: fixes or frees one.
  - `DELETE /api/bills/:id/set-menus/:lineId`: removes one.
- The first set menu on a bill records every copy in the zone's served `setMenus` with
  `orderable: true`, one row per `versionIds` entry (decision 7); with none, `set_menu.none_selling`.
  A key naming a copy the bill did not record is `set_menu.copy_not_on_bill`.
- A new set-menu line: role `set_menu`, `set_menu_id` the copy's set menu, quantity 1, sent and
  served at once (decision 4), `vat_class` and `takeaway_vat_class` the copy's `vatClass`,
  `credited_to` the signed-in person, no group and no course; then `refitBill` prices it.
- Refusals: not seated → `set_menu.not_seated`; takeaway → `set_menu.takeaway`; a removal the dishes
  do not allow → `set_menu.count_below_needed` `{ setMenusNeeded }`.

- [ ] **Step 1: Write the failing tests** in `set-menu-count.test.ts`:
  - `"setting the count to 4 adds four set menus at the cheapest type and records the zone's
    orderable copies"`.
  - `"a counter order, a takeaway bill and a bill with no party are refused"`, one case each.
  - `"the first set menu is refused when no set menu is selling"`, and `"a bill already holding set
    menus can add another after the period has ended"`.
  - `"lowering the count removes an empty unfixed set menu first"`.
  - `"the count cannot go below what the dishes need"`: four set menus and four starters, then
    `{ count: 3 }` is refused with `setMenusNeeded: 4` and nothing is removed.
  - `"fixing a type keeps it whatever the dishes, and freeing it lets the fit choose"`.
  - `"a repeated add with the same revision is refused as stale and adds nothing"`.
  In `till-api.set-menus.test.ts`: each route's answer and status, and `"the party bills read
  carries each bill's set menus"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them and
  `till-api.session-person.test.ts`** (its walk must see the new routes; add them to `BODIES`
  where a body is needed, CLAUDE.md §3).
- [ ] **Step 5: Commit** — "Set menus: add, remove and fix a bill's set menus".

### Task 4a: Finding a set-menu dish's offer, everywhere a line is looked up

**Files:**
- Modify: `apps/server/src/set-menu-bill.ts`, `apps/server/src/order-drafts.ts` (`offersFor` and the
  draft read's unavailable mark, `:1429-1446`), `apps/server/src/working-order.ts`
  (`readBasketOffers` `:546-582`, `priceOrderLines`' lookup, period and version checks `:743-771`,
  `judgeLateUnsent` / `unplacedLateDishes` `:2090-2179`), `packages/venue-service/src/operations.ts`
  (`lineContextColumns` `:1401-1478`), `apps/server/src/till-api.ts` (the mark-sold-out routes
  `:1614`, `:1648`)
- Test: `apps/server/src/set-menu-offers.test.ts`

**Interfaces:**
- Produces in `set-menu-bill.ts`:

```ts
export interface SetMenuOfferLookup {
  /** The copy's offer for a line with `setMenuId`, or undefined when no copy of this bill or zone holds it. */
  offerFor(line: { setMenuId: string; menuVersionId: string; menuItemId: string }):
    | { copy: ServedSetMenu; offer: ServedSetMenuOffer }
    | undefined;
}
/** Reads once: the bill's recorded copies when it has any, else the zone's orderable copies
 * (read from the zone's live documents' `setMenus`, never through the full offers read). */
export function setMenuOfferLookup(
  tx: Transaction,
  workingOrderId: string | null,
  zoneId: string,
): Promise<SetMenuOfferLookup>;
```

- Every place that looks a draft or order line up by `menuItemId` in the zone's offers uses the
  lookup for a line with `setMenuId`, built once per request: `offersFor` and the draft read (a
  set-menu draft line is never marked unavailable for not being in `offers`); `priceOrderLines`'
  offer lookup; its live-version check and its period check, which a dish from a recorded copy
  passes even after a republish or after the period ended; and `lineContextColumns`' version
  (today a plain `Error` when missing). The late-send checks keep judging by `menu_id`, which is
  the full menu (decision 5), so #3414's question still applies to a set-menu dish saved before
  its full menu's period ended and sent after it, and to nothing else.
- The mark-sold-out routes accept a dish only a set menu lists (piece 1 Task 5 left these here).

- [ ] **Step 1: Write the failing tests:** `"a set-menu dish is found in the bill's recorded copy,
  not the zone's offers"`; `"before the first set menu, it is found in the zone's orderable copy"`;
  `"one request reads the copies once however many lines"` (count statements); `"a dessert from a
  recorded copy sends after the full menu is republished"`; `"and after its period ended"`; `"a
  held set-menu main is not late at lunch, and is late once its full menu's period has ended"`;
  `"a dish only a set menu lists can be marked sold out"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file,
  `working-order.late-send.test.ts`, `order-drafts.test.ts` and `till-api.sell-published.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: find a set-menu dish's offer in its copy".

### Task 4b: Ordering set-menu dishes through the draft and sending them

**Files:**
- Modify: `apps/server/src/order-drafts.ts` (`saveDraft` `:277-407`, `splitDraft` `:135-185`),
  `apps/server/src/working-order.ts` (`priceOrderLines` `:613-1108`, `insertTabRound` `:3341-3370`),
  `apps/server/src/order-groups.ts` (`placeGroups` `:283-488`)
- Test: `apps/server/src/set-menu-dishes.test.ts`, `apps/server/src/till-api.set-menu-dishes.test.ts`

**Interfaces:**
- Consumes: `setMenuOfferLookup` (Task 4a), `refitBill` (Task 2).
- Saving a draft accepts set-menu dishes for a seated bill only (`set_menu.not_seated`), never
  checks cover (decision 6), and refuses a copy the bill did not record (`set_menu.copy_not_on_bill`).
  `splitDraft` carries a set-menu dish's `setMenuId`, and copies the source bill's copies onto the
  new bill for the copies the moved lines use.
- Sending: each set-menu dish becomes one line per unit, as today, with role `dish`, its
  `set_menu_id`, the counts-as course (the copy offer's `countsAsCourseId`, or the chosen
  variant's) and its menu context per decision 5. Its options and extras are priced and stored
  exactly as for an ordinary dish; extras children keep role null and their own prices. Then the
  refit with `set_menu.uncovered`, in the same transaction as the insert.
- An ordinary draft line (no `setMenuId`) is never a set-menu dish, whatever product it is.

- [ ] **Step 1: Write the failing tests** in `set-menu-dishes.test.ts`, on the Task 2 fixture with
  four set menus on the bill:
  - `"a set-menu soup is sent as an ordinary dish line, counted as a starter, at 0.00"`: its
    options answers and a paid extra (+1.50, its own child line at 1.50) are stored as for an à la
    carte soup, and its group and course are as the draft gave.
  - `"a sirloin from the Daily menu with its doneness costs its surcharge"`.
  - `"the folder a dish came from does not decide its set menu"`: two Daily set menus fixed, a
    sirloin ordered from the Special's copy → it sits on a Daily at 5.00.
  - `"an à la carte line is never a set-menu dish"`: Sirloin ordered à la carte on the same bill
    stays at 18.00 with role null and does not change the fit.
  - `"sending a dish the set menus cannot cover is refused and writes nothing"`: five starters for
    four set menus → `set_menu.uncovered` `{ setMenusNeeded: 5 }`, no line written.
  - `"a send after the count was lowered elsewhere is refused"`: lower the count to 3 through
    Task 3, then send the fourth starter → refused, nothing written.
  - `"a set-menu dish needs a seated bill, and a copy the bill recorded"`.
  - `"splitting a draft onto a new bill takes the set-menu dishes and their copies"`.
  In `till-api.set-menu-dishes.test.ts`: the draft save and submit routes with a set-menu line, and
  the refusal's status.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.**
- [ ] **Step 4: Run the files, `working-order.test.ts`, `order-drafts.test.ts`,
  `order-groups.test.ts` and `till-api.drafts.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: order and send set-menu dishes as ordinary dishes".

### Task 5: Editing and cancelling set-menu dishes

**Files:**
- Modify: `apps/server/src/working-order.ts` (`applyLineEdits` `:6240-` and its offer re-read
  `:6329-6377`, `updateHeldOrder` `:7413-`, `removePortions` `:3545`, `removeFromLine` `:3404`),
  `apps/server/src/adjustments-apply.ts` (`planAdjustment` `:802`, `applyAdjustment` `:1386`),
  `apps/server/src/line-cancel.ts` (`cancelItem` `:92`, its adjustment row `:429`)
- Test: `apps/server/src/set-menu-edits.test.ts`

**Interfaces:**
- Consumes: `setMenuOfferLookup`, `refitBill`.
- Editing a saved set-menu dish re-reads its offer through the lookup, never the zone's offers. A
  change of variant re-reads its counts-as course; options and extras do not refit. Moving a dish
  to another course or group never changes its counts-as course and never refits (spec:
  "classification is fixed").
- After an edit that changes a set-menu dish's variant or quantity, and after a cancel of a
  set-menu dish or one of its units (through `applyAdjustment` or `cancelItem`), the refit runs
  with `set_menu.uncovered`.
- Both cancel routes refuse a set-menu line itself with `set_menu.remove_by_count` (decision 4).

- [ ] **Step 1: Write the failing tests:** `"changing a sirloin's doneness does not refit"`;
  `"changing the wine from glass to bottle, which the set menu leaves out, is refused uncovered"`;
  `"serving a starter as a main keeps it counted as a starter"`; `"cancelling the sea bass turns
  the Special back into a Daily menu"`, through each cancel route; `"a cancel route refuses a
  set-menu line"`; `"a held order's whole-order edit refits once"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file,
  `working-order.test.ts` and the adjustments and line-cancel suites (grep their file names).**
- [ ] **Step 5: Commit** — "Set menus: keep the bill right when set-menu dishes are edited or cancelled".

### Task 6: Taking money on a set-menu bill waits for piece 4

**Files:**
- Modify: `apps/server/src/set-menu-bill.ts` (`refuseSetMenuMoney`), `apps/server/src/bill-payments.ts`
  (`takeBillPayment` `:1326`, the payment row write near `:1272`), `apps/server/src/payments-api.ts`
  (`:1576`), `apps/server/src/till-sale.ts` (`:1580`), `apps/server/src/adjustments-apply.ts`
  (`planAdjustment`)
- Test: `apps/server/src/set-menu-money.test.ts`

**Interfaces:**
- Produces `refuseSetMenuMoney(tx, workingOrderId): Promise<void>`, throwing
  `set_menu.payment_not_ready` when the bill holds a set-menu line or dish. It is called before
  each payment row is written and before an adjustment whose action is `comp` or a discount
  (every action in `ADJUSTMENT_ACTIONS`, `packages/shared/src/adjustment-policy-types.ts:6`, except
  `cancel`). Grep for every insert into `bill_payments` and `adjustments` and call it at each; list
  them in the commit message.
- Piece 4 deletes this function and adds freezing in its place. Record, in one line at the
  function, that piece 4's plan owns its removal.

- [ ] **Step 1: Write the failing tests:** `"a payment on a bill holding set menus is refused"`,
  through each payment path; `"a comp or a discount on it is refused"`; `"cancelling a dish on it
  is allowed"`; `"a bill without set menus is paid as before"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file and the
  bill-payments and adjustments suites.**
- [ ] **Step 5: Commit** — "Set menus: hold payments on a set-menu bill until the receipt work lands".

### Task 7a: Moving set menus and set-menu dishes between bills, and merging bills

**Files:**
- Modify: `apps/server/src/bill-actions.ts` (`moveDishes` `:270-366`, `mergeBills` `:116-192`),
  `apps/server/src/working-order.ts` (`moveOrderLines` `:4409-4499`, `carveLines` `:5001-5320`)
- Test: `apps/server/src/set-menu-moves.test.ts`

**Interfaces:**
- Set-menu lines move like dish lines (whole lines only). A move copies the source's recorded
  copies onto the target for every copy a moved line uses, then refits the target with
  `set_menu.move_uncovered` `{ side: "to" }` and the source with `{ side: "from" }`, in the move's
  transaction. A move of a set-menu line or dish to a bill that is not seated, or is takeaway, is
  refused (`set_menu.not_seated`, `set_menu.takeaway`).
- Merging two bills unions their copies and refits the result once.

- [ ] **Step 1: Write the failing tests:** `"moving two set menus and their dishes to a new bill
  leaves both covered"`; `"moving a dish without a set menu for it is refused, saying how many to
  move"` (`side: "to"`, `setMenusNeeded: 1`); `"moving set menus away from their dishes is
  refused"` (`side: "from"`); `"the target takes the source's copies"`; `"merging bills keeps
  every set menu and refits once"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file,
  `move-dishes.test.ts`, `move-merge.test.ts` and `transfer-lines.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: move set menus and their dishes between bills".

### Task 7b: Moving a whole bill, changing its dining, and splitting a table

**Files:**
- Modify: `apps/server/src/move-bill.ts` (`moveBill` `:137`, `MoveTarget` `:63`,
  `refuseUnseatable` `:462-472`), `apps/server/src/order-dining.ts` (`switchOrderDining` `:128-171`),
  `apps/server/src/table-actions.ts` (`splitTable` `:427`, and `takeIntoParty` wherever it is defined)
- Test: `apps/server/src/set-menu-bill-moves.test.ts`

**Interfaces:**
- A bill holding set menus cannot move to a counter (`set_menu.not_seated`) or switch to takeaway
  (`set_menu.takeaway`). Moving it to another table keeps its copies, set menus and dishes; when
  the move changes its zone to one that is not table service, it is refused `set_menu.not_seated`.
- `splitTable` moves loose dishes through Task 7a's move (so its refusals apply) and moves whole
  bills as above.

- [ ] **Step 1: Write the failing tests:** `"a bill holding set menus cannot move to a counter or
  become takeaway"`; `"moving it to another table keeps its set menus and prices"`; `"splitting a
  table moves set-menu dishes only with set menus to cover them"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file,
  `till-api.move-bill.test.ts` and the split-table tests (grep `splitTable`).**
- [ ] **Step 5: Commit** — "Set menus: keep set menus to seated, eat-in bills when a bill moves or a table splits".

### Task 8a: A set-menu line never reaches the kitchen

**Files:**
- Modify: `apps/server/src/kitchen-print.ts`, `apps/server/src/order-groups.ts` (`fireLines`),
  `apps/server/src/dish-kitchen.ts`, `apps/server/src/closed-station-alert.ts`,
  `apps/server/src/station-delete.ts`, and the station screens' line reads (grep under
  `apps/server/src` for readers of `working_order_lines` that feed tickets or stations)
- Test: `apps/server/src/set-menu-kitchen.test.ts`

**Interfaces:**
- Each of these readers skips `set_menu_role = 'set_menu'` rows, or is shown in the commit message
  to be unable to reach one (decision 4 keeps them out of "still to send"). A set-menu DISH is an
  ordinary dish to every one of them.

- [ ] **Step 1: Write the failing tests:** `"a set-menu line prints on no kitchen ticket and fires
  with no group"`; `"a station screen shows the set-menu dishes and not the set menu"`; `"a reprint
  of a ticket leaves the set menu off"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement**, recording each reader and its choice in
  the commit message. **Step 4: Run the file and the kitchen and station suites.**
- [ ] **Step 5: Commit** — "Set menus: keep a set-menu line out of the kitchen".

### Task 8b: A set-menu line in the other line readers

**Files:**
- Modify: `apps/server/src/order-groups.ts` (`readCurrentOrders` `:2148`), `apps/server/src/kitchen-allergy.ts`,
  `apps/server/src/line-nutrition.ts`, `apps/server/src/party-allergy.ts` (`:121`),
  `apps/server/src/order-state-counts.ts`, `apps/server/src/orders-list.ts`
- Test: `apps/server/src/set-menu-readers.test.ts`

**Interfaces:**
- `readCurrentOrders` answers set-menu lines in a separate `setMenus` field, not among the dishes.
  The allergy and nutrition readers skip set-menu lines and read set-menu dishes as dishes. Order
  counts and the orders list count a set-menu line as nothing to do. Each choice is recorded in the
  commit message.

- [ ] **Step 1: Write the failing tests:** `"the current-orders read lists set menus apart from
  dishes"`; `"the party's allergy check reads the set-menu dishes and skips the set menu"`; `"order
  counts do not count a set-menu line as waiting"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run the file and each reader's
  suite.** **Step 5: Commit** — "Set menus: read set-menu lines apart from dishes".

### Task 9: The till's set-menu data

**Files:**
- Modify: `apps/till/src/api/client.ts` (`ZoneOffers` `:447-461`, `PartyBill`, `FreshDraftLine`
  `:735-760`, new calls), `apps/till/src/till-app.ts` (`ZoneOfferIndex` `:1935-1986` and its
  `setUnavailable`, the `billDraft` live set `:5210-5216`), `apps/till/src/state/draft-lines.ts`
  (`toDraftLineInput` `:23-48`, `fromDraftLine` `:70-133`), `apps/till/src/state/menu-refresh.ts`
  (`isStale` `:211-214`)
- Create: `apps/till/src/state/set-menus.ts`
- Test: `apps/till/src/state/set-menus.test.ts`, `apps/till/src/state/draft-lines.test.ts`

**Interfaces:**
- Client calls: `setSetMenuCount(billId, count, expectedPartyRevision)`,
  `addFixedSetMenu(billId, key, expectedPartyRevision)`,
  `fixSetMenu(billId, lineId, key | null, expectedPartyRevision)`,
  `removeSetMenu(billId, lineId, expectedPartyRevision)`, each answering
  `{ setMenus: BillSetMenus; partyRevision: number }`. `PartyBill` gains `setMenus: BillSetMenus`;
  `FreshDraftLine` gains `setMenuId`.
- `ZoneOfferIndex` gains `setMenus: ServedSetMenu[]` and looks a set-menu dish up by its copy,
  never in the ordinary index; its sold-out update reaches the copies' dishes too. `fromDraftLine`
  and `isStale` do the same for a line with `setMenuId`, the bill's copies first, so a set-menu
  draft line is never marked removed or stale for not being in the zone's offers.
- `apps/till/src/state/set-menus.ts` produces:

```ts
/** The copies a bill orders from: its recorded ones, else the zone's orderable ones. */
export function copiesFor(bill: BillSetMenus, zone: readonly ServedSetMenu[]): ServedSetMenu[];
/** The fit of the bill with its unsent draft for that bill, `previous` the stored outcome. */
export function draftFit(
  bill: BillSetMenus,
  copies: readonly ServedSetMenu[],
  draftDishes: readonly SetMenuDish[],
): SetMenuFit;
/** Would adding this dish leave the bill uncovered? */
export function coverFor(
  bill: BillSetMenus,
  copies: readonly ServedSetMenu[],
  draftDishes: readonly SetMenuDish[],
  dish: Omit<SetMenuDish, "id" | "pinnedTo">,
): { kind: "covered" } | { kind: "uncovered"; setMenusNeeded: number | null } | { kind: "too_large" };
```

- Add `bill_set_menu_copies` to the tables whose changes re-read the bill and the draft.

- [ ] **Step 1: Write the failing tests** in `set-menus.test.ts`: `"a bill with recorded copies
  orders from them, else from the zone's orderable copies"`; `"the draft's set-menu dishes are
  counted with the bill's"`; `"a sixth starter for five set menus is uncovered, needing 6"`. In
  `draft-lines.test.ts`: `"a set-menu draft line is found in its copy, not marked removed"`, and
  `"a set-menu dish sold out reaches its copy"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them, `menu-refresh.test.ts`
  and `till-app-menu-refresh.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: the till's set-menu data and its own fit".

### Task 10: The till — set-menu folders

**Files:**
- Modify: `apps/till/src/widgets/menu-browser.ts` (`#tile` `:786-807`, `#home` `:819-852`,
  `#sectionView` `:854-882`, `#pick` `:577-582`), `apps/till/src/widgets/product-pick.ts`,
  `apps/till/src/screens/till-table-order-screen.ts` (`canSelectProduct` `:2942-2945`)
- Create: `apps/till/src/widgets/set-menu-folder.ts`
- Test: `apps/till/src/widgets/set-menu-folder.test.ts`, `set-menu-folder.a11y.test.ts`,
  `apps/till/src/widgets/menu-browser.set-menu.test.ts`

**Interfaces:**
- Consumes: `copiesFor` (Task 9); piece 1's `set_menu` `DocumentMember`.
- A `set_menu` member draws as a folder tile with the set menu's name and price, on a seated
  table's bill only; on a counter order it is not drawn. It opens the bill's recorded copy of that
  set menu when the bill has one, else the copy served from the same full menu's version.
- `till-set-menu-folder` draws the copy like its board. Each line is a heading, worded from the
  courses' names: "Starter", "Main or starter", "Dessert or coffee", and "2 × Starter" when its
  count is above 1. Under each heading come the dishes whose counts-as course the line accepts. A
  dish more than one line accepts is listed under the first (spec, **my call**). Each dish shows
  **Included** or its surcharge ("+€5.00"). Tapping a dish opens exactly what it opens à la carte
  (`pickProduct`, the modifier picker), and the line it adds carries `setMenuId` and its copy's
  version and menu item.
- At the top of the folder, **Add a {set menu}** adds one set menu fixed to this copy.
- After the period ends, a bill holding copies whose set menu is in no served tree gets a **Set
  menus** tile on the home that lists them as folders (decision 7, **my call**).
- The table screen's `canSelectProduct` allows a set-menu dish from a copy `copiesFor` returns.

- [ ] **Step 1: Write the failing tests:** `"a set-menu folder shows its lines as headings and each
  dish as included or with its surcharge"`; `"a dish two lines accept is listed under the first"`;
  `"tapping a sirloin opens its doneness question and adds a set-menu line"`; `"a counter order
  draws no set-menu folder"`; `"Add a Special menu adds a fixed set menu"`; `"after the period a
  bill holding set menus still opens its folders from the Set menus tile"`; a11y in both themes.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them and the
  `menu-browser*.test.ts` files.**
- [ ] **Step 5: Look at it** on Claude's own stack (`wa-wt demo <worktree>`, never slot 1,
  CLAUDE.md §6) with a set menu built on the dashboard, in both themes and at phone width.
- [ ] **Step 6: Commit** — "Set menus: set-menu folders on the till".

### Task 11: The till — the count, the summary, the total and the line tags

**Files:**
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (`#ordering` `:3097-3119`, the draft
  heading `:3112-3114`, `#totals` `:3222-3246`), `apps/till/src/state/draft-layout.ts`
  (`panelTotal` `:181-183`), `apps/till/src/widgets/basket.ts` (markers `:72-100`, name span
  `:883-893`), `apps/till/src/widgets/sent-orders.ts`
- Create: `apps/till/src/widgets/set-menu-summary.ts`
- Test: `apps/till/src/widgets/set-menu-summary.{test,a11y.test}.ts`,
  `apps/till/src/screens/till-table-order-screen.set-menus.test.ts`, `basket.set-menu.test.ts`

**Interfaces:**
- Consumes `draftFit`, the client calls (Task 9).
- On a seated bill, above the order's lines: **Set menus** with a `wt-number-stepper`
  (`packages/ui/src/components/wt-number-stepper.ts`, as `guest-count.ts:56-70` uses it), saved at
  once with the party revision. A refusal shows its wording beside the stepper and puts the count
  back. Beside it, a `wt-help-tooltip` with `mode="help-mode"` orients in two sentences and links
  to the guide's `{#set-menus}` section (Task 12b).
- `till-set-menu-summary`, from `draftFit`, folds to two lines:
  "4 set menus · charged as 3 Daily menu + 1 Special menu" and "open: 4 Dessert or coffee · 4 Drink".
  The open places are summed by line and named as the folder headings. **show** unfolds one row per
  set menu, each place filled with the dish the fit put there or shown as open, as the spec draws
  it. Each unfolded row offers **Fix as…** (the bill's copies) or **Free**, and **Remove**.
- When a change moves the mix or moves a dish between set menus, the rows that changed are
  marked, and a note shows once with the change in total. When one added dish changed one set
  menu's type: "{dish} is only on the {type}, so one set menu is now a {type}: +€6.00". Otherwise:
  "The set menus are now counted as {mix}: {+/−amount}" (**my call** on the second form). The
  heading says "charged as", so the rows read as how the bill counts, never as people.
- **The panel's total includes the draft's set-menu outcome**: `panelTotal` takes the stored total,
  adds the draft's ordinary lines and paid extras as today, and replaces the set-menu part with
  `draftFit`'s `totalCents` less the stored set-menu total. So the total never jumps on sending
  (spec anti-goal). A draft set-menu dish's own price shown in the basket is the fit's, not its
  copy's surcharge.
- Order lines: a covered set-menu dish shows a small **menu** tag, and one with a surcharge shows
  it ("+€5.00"), in the basket and in sent orders (spec, **my call** in the till mock-ups).

- [ ] **Step 1: Write the failing tests:** `"the count saves at once and a refusal puts it back
  with its reason"`; `"the folded summary names the mix and the open places"`; `"unfolded, each set
  menu shows its dishes and open places"`; `"adding a sea bass shows the note once with +€6.00"`;
  `"the total with an unsent sea bass already includes the +€6.00"`; `"a draft sirloin that will
  sit on a Special shows no surcharge"`; `"fixing a row as the Special keeps it"`; `"a covered dish
  shows menu and a sirloin shows +€5.00"`; `"a counter order shows no count"`; a11y for the summary,
  folded and unfolded, in both themes.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them,
  `till-table-order-screen*.test.ts` and `basket*.test.ts`.**
- [ ] **Step 5: Look at it** on Claude's stack: the worked example's order, both themes, phone width.
- [ ] **Step 6: Commit** — "Set menus: the set-menu count, summary and total on the order panel".

### Task 12a: The till — asking before an uncovered dish, and the refusals' wording

**Files:**
- Create: `apps/till/src/widgets/set-menu-cover-dialog.ts`
- Modify: `apps/till/src/screens/till-table-order-screen.ts` (the add path after the picker
  confirms), `apps/till/src/till-app.ts` (a send refused `set_menu.uncovered`),
  `apps/till/src/i18n/codes.ts` (`CODE_MESSAGES`, `codeMessage` `:999-1027`)
- Test: `apps/till/src/widgets/set-menu-cover-dialog.{test,a11y.test}.ts`,
  `apps/till/src/till-app-set-menus.test.ts`

**Interfaces:**
- Consumes `coverFor` (Task 9).
- When a set-menu dish's choices are confirmed (decision 8) and `coverFor` answers `uncovered`,
  the dish is not added. `till-set-menu-cover-dialog` (a `wt-dialog`, built as
  `late-send-dialog.ts` is) says "Not covered by the set menus on this bill." and offers:
  - **Add a set menu**, or "Add {n} set menus" when `setMenusNeeded` is more than one higher: it
    raises the count, then adds the dish;
  - **Order à la carte**, only when the same product is an orderable offer in the zone's ordinary
    `offers` (spec, **my call**): it opens that offer's picker afresh;
  - **Cancel**.
  `too_large` shows `set_menu.too_many`'s wording instead. A send refused `set_menu.uncovered`,
  when another till's dishes got there first, opens the same dialog for the draft.
- Wording in English and Spanish for every code in Global Constraints, each saying what to do
  (**my call**). For example:
  - `set_menu.count_below_needed`: "The dishes ordered need {n} set menus. Remove a dish first, or
    order it à la carte." / «Los platos pedidos necesitan {n} menús. Quita primero un plato o
    pídelo a la carta.»
  - `set_menu.payment_not_ready`: "Bills with set menus can't be paid on this version yet. Move the
    dishes you want to pay now to another bill, or wait for the update." / «Las cuentas con menús
    aún no se pueden cobrar en esta versión. Pasa a otra cuenta los platos que quieras cobrar
    ahora, o espera a la actualización.»
  Use the till's existing Spanish word for a set menu if its strings already have one.

- [ ] **Step 1: Write the failing tests:** `"a sixth starter for five set menus asks, and Add a set
  menu adds both"`; `"Order à la carte is offered only when the dish sells à la carte here, and
  opens its own picker"`; `"Cancel adds nothing"`; `"a send refused uncovered opens the question"`;
  `"each set-menu code is worded in English and Spanish"` (a table over the codes, through
  `codeMessage`); a11y for the dialog in both themes.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them and
  `till-app-late-send.test.ts`.**
- [ ] **Step 5: Commit** — "Set menus: ask before adding a dish no set menu covers".

### Task 12b: The till — moving set menus, the guide, and the whole flow

**Files:**
- Modify: the move-dishes flow (`apps/till/src/till-app.ts`; grep `moveDishes`)
- Modify: `apps/server/src/guide/en/table-service.md`, `apps/server/src/guide/es/table-service.md`,
  `docs/backlog/menu.md`
- Test: `apps/till/src/till-app-move-dishes.test.ts` (more cases)

**Interfaces:**
- The move screen lists the bill's set menus as rows that can be moved like dishes, and shows
  `set_menu.move_uncovered`'s wording when refused.
- Guide: a `## Set menus at a table {#set-menus}` section in both languages, written from the code
  as built. It covers setting the count, ordering from the folders, fixing a type, reading the
  summary, what happens when a dish is not covered, moving set menus, and that a counter order
  cannot have one. Keep it short: a sentence earns its place by changing what staff do (CLAUDE.md
  §3). Both languages share the `{#set-menus}` id.

- [ ] **Step 1: Write the failing tests:** `"set menus can be moved to another bill with their
  dishes"`; `"a refused move says how many set menus to move"`.
- [ ] **Step 2: Run; they fail.** **Step 3: Implement.** **Step 4: Run them,
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.**
- [ ] **Step 5: Look at it end to end** on Claude's stack:
  - seat a table and set 4 set menus;
  - order the worked example's dishes from the folders;
  - check that the summary says 3 Daily menu + 1 Special menu and the total reads €72.00 before
    and after sending;
  - add a fifth starter and answer the question;
  - move one set menu and its two dishes to a new bill;
  - try to pay, and read the refusal.
  Record what was done and seen in the PR.
- [ ] **Step 6: Update `docs/backlog/menu.md`'s A1515 entry** to say piece 2 has landed, that
  paying a set-menu bill waits for piece 4, and what is next, in the same commit.
- [ ] **Step 7: Commit** — "Set menus: move set menus on the till, and the table-service guide".
