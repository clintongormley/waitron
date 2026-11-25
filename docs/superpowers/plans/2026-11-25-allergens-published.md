# ALLERGENS-PUBLISHED Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Status: approved by the watcher 2026-11-25 06:05 with the CHANGE points of the Codex plan read; revised for them. Lane A, 2026-11-25. Read on `origin/main` `54a675dae2`.
Revised 2026-11-25 10:30 for the owner's scheduled-menus answer (10:02; "Scheduled menus" under Decisions): PRs 3a, 3b and 4 grow by about 60, 40 and 40 production lines.
Reviews: the fresh-context plan review (findings 1–11, all taken) is
lane A's folder (`allergens-published-reviews/plan-review-1-20261125-0550.md`); the Codex plan read
whose CHANGE points this revision takes is `plan-review-2-codex-20261125-0601.md` beside it.
Nothing here was run except the reads named; every `file:line` is from that commit.

**Goal:** A dish's allergens and diet labels are part of the published menu again, every screen
(till, kitchen screens, kitchen tickets, the allergy check) reads them from the same published
version, and saving a corrected allergen offers "Update the live menus now?", which puts the
correction live on every menu holding the dish in one step and prints a kitchen correction slip
for a sent dish ticked for a guest with that allergy.

**Architecture:** The frozen menu document carries declarations again (format 5). Bill lines read
them through one resolver in `@waitron/menu` that looks each line up in its menu's live version,
falling back to the version the line was ordered from. The correction is a new "declarations"
patch field whose value is always copied from the product on the server, applied by a new
route to every live version that disagrees, in one transaction that also refreshes the kitchen's
allergy clashes. Queued versions that differ are listed with their dates and corrected only where
staff leave them ticked (owner, 2026-11-25 10:02; see "Scheduled menus" below).

**Tech Stack:** TypeScript, Drizzle on `node:sqlite`, Hono routes, Lit dashboard and till, Vitest
(`useVenueDb` for database tests, browser mode for dashboard and till).

**Spec:** `docs/superpowers/specs/2026-11-24-customer-menu-design.md` §8 and Delivery piece 2; the
lane's design `~/waitron-campaign/allergens-published-design.md` (watcher 2026-11-25 04:33: "the
design stands", with the six points copied under Decisions below). The plan commits beside the
spec as `docs/superpowers/plans/2026-11-25-allergens-published.md` once approved.

## Global Constraints

- Five pull requests: 1, 2, 3a, 3b, 4 (watcher 06:05 point 1: four as drawn, PR 3 split).
- Every venue resets (PR 1). PR 1's first line says so. Till and kitchen switch to the published
  values together, in PR 2; PR 2's first lines say that until PR 3a lands a corrected allergen
  reaches tills and kitchen only by publishing (watcher point 4).
- One reset only: the three unread line columns go in PR 1 too (watcher point 1), so core's one
  starting migration is rebuilt once (`pnpm --filter @waitron/db db:generate`; never a new
  migration or a hand edit, CLAUDE.md §3).
- No compatibility code for format-4 documents: they are refused with `menu.reset_required`, as
  today (`packages/menu/src/menu-publication.ts:197-199`).
- Resolve shared menu data once per batch of lines, never per line (CLAUDE.md §3).
- Golden huella and `inmutabilidad` pass unedited. Nothing here touches invoices, the chain or
  filing; receipts carry no declarations (design §2).
- Product text: concise; English and Spanish strings; the guide updated in both languages in the
  same PR as the screen (CLAUDE.md §3). Wording below is the lane's draft for the watcher.
- `apps/server/src/menu-api.ts` is at 1,835 of its 2,000-line cap
  (`scripts/product-file-size-limits.json:36`): route bodies stay thin; logic lives in
  `@waitron/menu` and new server files.
- Full review path on every PR (allergens can harm someone); the owner lands every PR.

## Decisions in force

From the watcher, 2026-11-25 04:33 (lane A questions.md), not the owner's; the owner is told:
1. Design §6 defaults 1, 2, 4, 5 stand: no "contents changed" slip without a declared allergy; the
   patch dialog only copies the product's current values; no second question after a save that
   did not change declarations; a menu waiting on other unpublished changes is still patched.
   Default 3: drop `working_order_lines.allergens`, `diet`, `diet_override` in PR 1, after checking
   for readers outside SQL text.
2. Yes corrects every live version holding the product, and each queued version (also of a menu
   whose only version is a scheduled first one) that staff leave ticked: "Scheduled menus" below.
3. "Live menus" means every menu's live version, also one not sold at this hour or in this zone.
4. PRs 1 to 3 land the same day if possible.
5. The guide says, in two sentences, where a sent till line and the kitchen may differ after a
   correction.
6. Every doc saying "live product" for declarations gets a dated pointer in the PR that changes the
   behaviour.

Lane's own calls, for the watcher to confirm:
- **Scheduled menus (owner, 2026-11-25 10:02: "Ask, menu by menu (Recommended)").** The option
  reads: "The correction window lists each scheduled menu that differs, ticked only when it still
  has the old value; untick to leave it". Allergens and diets only; names, prices and photos keep
  A1151 (`docs/backlog/menu.md:332-337`). It applies to the question after a save and to Patch live
  menu, with the menus' dates. How the lane reads it, for the watcher:
  - A queued version is listed when one of its copies of the product (dish, variant, extra, set-menu
    copy) differs from the product's current declarations.
  - "Still has the old value" compares each differing copy with the value being corrected: after a
    save, the product's declarations before that save; in Patch live menu, that copy's declarations
    on the live version the patch is built on. Ticked when every differing copy equals it; a copy
    holding anything else (someone already changed that version on purpose), or one the live version
    lacks, leaves the menu unticked.
  - A ticked queued version is cancelled and queued again under a new number with the corrected
    document, at its own time, by `requeueAfter`, which already does that with the document
    unchanged. An unticked one is requeued as today. A menu with only a scheduled version goes
    through the same function with no live patch.
  - An id that is no longer queued when the request arrives is ignored: it started (then it is live,
    and corrected as live) or was cancelled.
- **No import or bulk path asks or reports.** The spec's "an import, or a change to many products
  at once ... names the menus waiting" has no surface today: the only bulk product routes are
  availability and menu membership (`menu-api.ts:1630,1648`), and the configuration import is
  staged for first setup only (`packages/provisioning/src/configuration-import.ts:121`). A future
  bulk declaration edit calls `waitingDeclarationMenus` (Task 3.2).
- **An extra's diet labels are compared and served as its expanded `suitableFor`.** The frozen
  extra keeps only `addAllergens` and `suitableFor` (as before #3389), so the resolver hands an
  extra line `dietaryDeclarations = suitableFor`. Every kitchen reader already expands
  (`working-order-station-queue.ts:285,295,312`), and expansion is idempotent
  (`packages/shared/src/menu-document/dietary-declarations.ts:26-34`).
- **The question is asked only when the save changed declarations** (design default 4): the server
  compares the product's and its variants' effective declarations before and after the save in the
  save's transaction, so the dashboard needs no knowledge of what changed.

## Review Focus

1. A line whose menu's live version no longer holds the dish (dropped in a later publish): kitchen
   and allergy check use the line's own version, never the product row. Task 2.1.
2. A variant with blank allergens inheriting its parent's: saving the parent makes the variant's
   frozen values differ too, so the question names its menus and Yes corrects the variant copy.
   Tasks 3.2, 3.3.
3. A product held only as an extra on another dish's list, or only inside a set menu: named and
   corrected. Tasks 3.2, 3.3.
4. Yes pressed after somebody else already published or patched the correction: the route
   recomputes inside its own transaction and answers `menus: []` (not an error), and prints no
   second slip. Tasks 3.3, 3.4.
6. A paid table whose ticked dish is not served yet still gets its slip (Codex CHANGE, Task 3.4):
   the slip path's own rules decide, never the order's status.
5. A correction that fails half way (a menu made read-only, or a forced throw on the second menu):
   nothing is patched, no slip is queued, the product stays saved. Tasks 3.3, 3.4.

---

## File map

| File | PR | Responsibility |
| --- | --- | --- |
| `packages/menu/src/menu-document.ts` | 1, 2 | PR 1: `freezeOffer` keeps declarations; format 5. PR 2: `serveOffer` stops overlaying them; `readLiveRows` and `liveFieldsDigest` drop them |
| `packages/shared/src/menu-document/menu-document-types.ts` | 1, 2 | PR 1: declarations back on frozen types; `ProductChangeField` regains `allergens`, `diet`. PR 2: `DeclarationField`/`DeclarationOffer`/`DeclarationDocument` removed |
| `apps/till/src/till-app-menu-refresh.test.ts`, `state/menu-refresh.test.ts` | 2 | the #3394 cases re-aimed at a new version |
| `packages/menu/src/menu-navigation.ts` | 1 | Preview compares `allergens` and `diet` again (product, variant, extra) |
| `apps/dashboard/src/widgets/menu-preview.ts`, `apps/dashboard/src/i18n/strings.ts` | 1 | labels for the two change fields (the four strings #3389 deleted) |
| `packages/db/src/schema/orders.ts`, `packages/venue-service/src/operations.ts`, `apps/server/src/working-order-transfer.ts` | 1 | the three line columns go |
| `packages/menu/src/published-declarations.ts` (new) | 2 | `declarationsInDocument`, `readPublishedDeclarations` |
| `packages/menu/src/product-declarations.ts` | 2 | gains `readProductDeclarationValues` (moved from `apps/server/src/line-nutrition.ts:85-100`) |
| `apps/server/src/line-nutrition.ts` | 2 | reads through the resolver |
| `apps/server/src/working-order-station-queue.ts`, `working-order-held-read.ts`, `party-allergy.ts` (incl. `readArrivingAllergyDishes`) | 2 | their direct product joins replaced by the resolver |
| `packages/venue-service/src/set-menu-copies.ts` | 2 | recorded set-menu copies take the live version's declarations |
| `apps/till/src/api/live-connection.ts` | 2 | kitchen channel lists `menu_versions`, `menu_releases` |
| `packages/menu/src/menu-patch-types.ts`, `menu-patch.ts` | 3a | the `declarations` patch field |
| `packages/menu/src/menu-publication.ts` | 3a | `patchLiveMenu` reads product values for it; queued versions requeue unchanged |
| `apps/dashboard/src/widgets/menu-patch-draft.ts`, `menu-patch-dialog.ts`, `menu-patch-review.ts` | 3a | the copy-from-product field |
| `packages/menu/src/declaration-correction.ts` (new) | 3b | `declarationChanges`, `findDeclarationDrift`, `waitingDeclarationMenus`, `correctMenuDeclarations` |
| `apps/server/src/declaration-correction-kitchen.ts` (new) | 3b | `refreshCorrectedKitchenLines` |
| `apps/server/src/menu-api.ts`, `apps/server/src/boot.ts` | 3b | save answer gains `declarationMenus`; new route; the patch route refreshes the kitchen; `venueCfg` dep |
| `apps/dashboard/src/widgets/live-declarations-dialog.ts` (new), `screens/products-screen.ts`, `api/client.ts` | 4 | the question and its failure message |
| `packages/menu/src/menu-publication.ts` (`previewMenu`), `apps/dashboard/src/widgets/menu-preview.ts` | 4 | the "not live yet" warning |

---

## PR 1 — Freeze declarations again (resets every venue)

Branch `feat/allergens-published-freeze`. First line of the PR: "Resets every venue: the menu
document format goes from 4 to 5 and core's starting migration is rebuilt." Second: "Nothing staff
see changes yet apart from Preview, which lists allergen and diet changes again: tills and kitchen
still read the product row until the next PR."

**Size (estimate):** production about +90 / −60 lines; tests about +180 / −80; generated: core's
starting migration and snapshot, the Madrid snapshot and fingerprints, both Madrid fixtures.

### Task 1.1: The frozen document carries declarations; format 5

**Files:**
- Modify: `packages/menu/src/menu-document.ts:105` (format), `:511-547` (`freezeOffer`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts:18-25,138-150` and the
  `FrozenExtraItem` type (frozen types regain the fields). `serveOffer`, `readLiveRows`,
  `liveFieldsDigest` and the `Declaration*` types stay until PR 2 (Task 2.0).
- Test: `packages/menu/src/menu-document.test.ts`

**Interfaces:**
- Produces: `FrozenOffer` and `FrozenOfferVariant` carry `allergens`, `diet`, `dietOverride`,
  `dietaryDeclarations`; `FrozenExtraItem` carries `addAllergens`, `suitableFor`;
  `MENU_DOCUMENT_FORMAT === 5`. Served offers are unchanged in this PR.

- [ ] **Step 1: Write the failing tests** in `menu-document.test.ts`, replacing the #3389 cases that
  assert stripping (find them with `rg -n 'allergens' packages/menu/src/menu-document.test.ts`):
  - `freezes a dish's, a variant's and an extra's declarations`: build a menu whose dish declares
    `{ milk: "contains" }` and `dietaryDeclarations: ["vegan"]`, a variant inheriting it, an extra
    declaring `{ eggs: "contains" }`; publish; read the stored `menu_versions.document`; assert
    `offer.allergens` equals `{ milk: "contains" }`, the variant's equals the parent's, and the
    extra item's `addAllergens` equals `{ eggs: "contains" }` and `suitableFor` holds the expanded
    labels.
  - `a declaration change alters the document hash`: the working document's `menuDocumentHash`
    differs after a product allergen edit.
  - `format 4 is refused`: a version whose document says `format: 4` makes `readLiveDocuments`
    throw `menu.reset_required`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/menu-document.test.ts`;
  expected FAIL on the frozen values (stripped today).
- [ ] **Step 3: Implement.** `freezeOffer` no longer omits the four dish/variant fields or the two
  extra fields. Format constant 5.
- [ ] **Step 4: Run** the same file plus `pnpm --filter @waitron/shared exec vitest run src/menu-document`
  and `pnpm --filter @waitron/menu exec vitest run src/menu-publication.test.ts src/backup-verification.test.ts`;
  expected PASS. Any other check pinning `format: 4` is found with
  `rg -n 'format: 4|MENU_DOCUMENT_FORMAT' packages apps -g '*.test.ts'` and moves to 5.
- [ ] **Step 5: Commit** `git commit -s -m "Freeze allergens and diets in the published menu again"`.

### Task 1.2: Preview lists allergen and diet changes again

**Files:**
- Modify: `packages/menu/src/menu-navigation.ts:171-176,250,353` (restore the keys #3389 removed:
  `allergens: ["allergens"]`, `diet: ["diet", "dietOverride", "dietaryDeclarations"]` in
  `PRODUCT_KEYS`; `"allergens", "diet"` in the variant field list; `allergens: ["addAllergens"]`,
  `diet: ["suitableFor"]` in `extraFields`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`ProductChangeField` regains
  `"allergens" | "diet"`)
- Modify: `apps/dashboard/src/widgets/menu-preview.ts`, `apps/dashboard/src/i18n/strings.ts` (the
  labels; recover the exact strings with `git show 52db586877 -- apps/dashboard/src/i18n/strings.ts apps/dashboard/src/widgets/menu-preview.ts`)
- Test: `packages/menu/src/menu-change-navigation.test.ts`, `apps/dashboard/src/widgets/menu-preview.test.ts`

- [ ] **Step 1: Failing tests.** `menu-change-navigation.test.ts`: `lists a dish's allergen change`
  (dish allergens edited after publishing → `previewMenu(...).changes` holds one change for that
  dish whose fields include `"allergens"`), `lists a variant's diet change`, `lists an extra's
  allergen change`. `menu-preview.test.ts`: a preview with an `allergens` change renders the
  English label and, with the screen in Spanish, the Spanish one.
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/menu-change-navigation.test.ts`
  and `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-preview.test.ts`; FAIL.
- [ ] **Step 3: Implement** the restorations listed under Files.
- [ ] **Step 4: Run** both again; PASS.
- [ ] **Step 5: Commit** `-s`.

### Task 1.3: Drop the three line columns; demo snapshot; docs

**Files:**
- Modify: `packages/db/src/schema/orders.ts:289-291` (remove `allergens`, `diet`, `dietOverride`)
- Modify: `packages/venue-service/src/operations.ts:1278-1310,1501-1503` and
  `packages/module/src/module.ts:1213` (line contexts lose the three fields);
  `apps/server/src/working-order-transfer.ts:434-436`
- Regenerate: core's starting migration (`pnpm --filter @waitron/db db:generate`); the Madrid
  snapshot and fingerprints (`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, by its
  own refresh helper); `packages/country-es/test-fixtures/demo/madrid-before-move.en.json` and
  `.es.json` — by their generator, never by hand
- Docs: only the backlog line in Step 4; every "live product" doc changes in PR 2, the PR that
  changes what staff see (watcher point 6).

- [ ] **Step 1: Prove no reader.** The plan review read every `listLineContexts` caller and found
  none reading the three fields (only the held read declares them, in its own types,
  `working-order-held-read.ts:156-162`, which go too); product readers are only
  `working-order-transfer.ts:434` and `operations.ts:1306`. Re-run the whole-repo search
  `rg -n 'allergens|diet_override|dietOverride|\bdiet\b' apps packages -g '!*.test.ts' -g '!**/drizzle/**' | rg -i 'line'`
  and confirm nothing new. Tests that name the columns and will change: 
  `apps/server/src/order-portions.filing.test.ts:1447` and
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts:1641`.
- [ ] **Step 2: Failing test.** `packages/db/src/schema/menus.test.ts` (beside `:100`'s column
  presence check): `working_order_lines no longer has allergens, diet or diet_override`.
- [ ] **Step 3: Implement**, regenerate, then run the schema guards:
  `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/starting-migrations.test.ts scripts/classification-complete.test.ts scripts/two-file-foreign-keys.test.ts`
  and `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad src/write-path.e2e.test.ts`
  (both unedited); `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/guide-content.test.ts`;
  `pnpm exec vitest run scripts/guide-links.test.ts`. All PASS.
- [ ] **Step 4: Backlog.** `docs/backlog.md:469-470`: the entry stays until PR 4, with "PR 1
  landed" appended. Commit `-s`.

As built (2026-11-25): the Madrid captures are pinned by checksum in
`madrid-before-move.manifest.json` and stay unchanged, and the baseline test gains a format 4 to 5
step instead. The held read's product `diet`/`dietOverride` types stay: they are filled from the
current product row, or from a sent line's saved nutrition, not from the dropped columns.

---

## PR 2 — Till and kitchen read the published declarations

Branch `feat/allergens-published-readers`. No reset. First lines of the PR: "Tills, kitchen
screens, tickets and the allergy check now show a dish's allergens and diets from the published
menu. Until the Patch PR lands, a corrected allergen reaches them only when the menu is published."

**Size (estimate):** production about +330 / −120 lines; tests about +450 / −150; test support
about +40.

**Test ownership (Codex CHANGE):** Task 2.1 owns "live version versus the line's own version"
(patched, dropped dish, dropped variant, dropped extra). Each reader in 2.2 and 2.3 proves only
that an unpublished product edit does not show; it does not repeat the patched case.

### Task 2.0: Served offers carry the frozen values; open till views follow a new version

(Moved from PR 1 by the Codex plan read, so the till and the kitchen switch together.)

**Files:**
- Modify: `packages/menu/src/menu-document.ts:620-760` (`LiveProductRow`, `readLiveRows`,
  `liveFieldsDigest`), `:875-926` (`serveOffer`)
- Modify: `packages/shared/src/menu-document/menu-document-types.ts` (`DeclarationField`,
  `DeclarationOffer`, `DeclarationDocument` removed, folded into `MenuDocument` at every user,
  `rg -n 'DeclarationDocument|DeclarationOffer|DeclarationField'`; `LiveExtraItem`);
  `packages/shared/src/menu-document/guest-menu.ts:39` (takes `MenuDocument`);
  `packages/shared/src/index.ts:407-408` (drop the two exports)
- Test: `packages/menu/src/menu-document.test.ts`, `apps/till/src/till-app-menu-refresh.test.ts`,
  `apps/till/src/state/menu-refresh.test.ts`
- Modify (only if a till test fails for a real reason): `apps/till/src/state/menu-refresh.ts`,
  `apps/till/src/till-app.ts:7127,7646-7650`. `refreshProductDeclarations`
  (`state/menu-refresh.ts:313`) stays.
- Docs (watcher point 6, in this PR because this is the PR that changes what staff see):
  `docs/backlog/menu.md:332-337` (A1151 line: "allergens and diet labels are always read from the
  live product" gets "Replaced 2026-11-25: published with the menu (ALLERGENS-PUBLISHED)"),
  `:359-362` (the A1150 entry becomes "Published declarations (owner, 2026-11-24)" with the spec
  link and a dated pointer to A1150's design); `docs/developers/products.md` (the published rule;
  the kitchen line at `:802` becomes the resolver); the Products and Modifiers guides, EN and ES
  (`apps/server/src/guide/{en,es}/products.md`, `modifiers.md`: "Allergens and diet labels are part
  of the published menu: publish the menu to put a change live." PR 3a adds the patch and PR 4 the
  question); the Table service guide's live-product sentence, EN `:508` and ES `:540`, becomes
  "Allergens and diet labels come from the published menu." Any CLAUDE.md or developer-doc line
  saying "live product" for declarations gets a dated pointer
  (`rg -n -i 'live product' CLAUDE.md docs/developers docs/backlog`).

- [ ] **Step 1: Failing tests.** `menu-document.test.ts`: `serves the published declarations, not
  the product's` (publish, change the product's allergens to `{ fish: "contains" }` without
  publishing; `applyLiveFields` returns `{ milk: "contains" }` for the dish, the variant and the
  extra's `addAllergens`); `a declaration change leaves the live-fields digest alone`
  (`readLiveState`'s `liveFields` is unchanged by it, and still changes with availability).
  Till: re-aim the #3394 cases. Each case that drives a declaration refresh by changing the polled
  `liveFields` digest now drives it by a new menu version (the poll answering a new `versionId`
  and the reload returning offers with the new declarations). Assertions stay as strict: the open
  basket line, the extras picker and product info show the new allergens; a sent line keeps its
  capture. Add `a product save with no new version changes nothing on the till`. Record each
  re-aimed case in the PR's "Changed test checks" (file:line, before, after, spec §8).
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/menu-document.test.ts` (FAIL
  on the served values) and `pnpm --filter @waitron/till exec vitest run src/till-app-menu-refresh.test.ts src/state/menu-refresh.test.ts`.
- [ ] **Step 3: Implement.** `serveOffer` no longer spreads `productDeclarationValues` /
  `extraDeclarationValues`; `readLiveRows` stops selecting `allergens`, `dietOverride`,
  `dietaryDeclarations`; `liveFieldsDigest` drops `productDeclarationValues(row)`. A till case
  that fails is fixed in the reload path, not the test.
- [ ] **Step 4: Run** the A1150-era server suites that assert live-product values:
  `pnpm --filter @waitron/server exec vitest run src/menu-allergen-workflow.test.ts src/sent-line-nutrition.test.ts src/till-api.sell-published.test.ts src/working-order.test.ts`,
  plus the step 2 files, `src/guide-content.test.ts` and `pnpm exec vitest run scripts/guide-links.test.ts`.
  Cases asserting that an unpublished product edit reaches the till now assert the published
  value (spec §8; "Changed test checks"). PASS. Commit `-s`.

### Task 2.1: The resolver

**Files:**
- Create: `packages/menu/src/published-declarations.ts`, exported from `packages/menu/src/index.ts`
- Modify: `packages/menu/src/product-declarations.ts` (gains `readProductDeclarationValues`, moved
  from `apps/server/src/line-nutrition.ts:83-100`, renamed from `readProductDeclarations`; server
  callers re-pointed)
- Test: `packages/menu/src/published-declarations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DeclarationValues = ReturnType<typeof productDeclarationValues>;
  export interface PublishedLine {
    id: string;
    menuVersionId: string | null;
    menuItemId: string | null;
    productId: string | null;
    extraListId: string | null;
  }
  /** The declarations `document` holds for the line's dish, variant or extra; undefined when it
   * does not hold that exact one. An extra (extraListId set) reads the item for productId in an
   * extras list with that id; a dish reads the ordinary offer or set-menu copy whose id is
   * menuItemId when productId is that offer's productId, or that offer's variant whose id is
   * productId. A missing variant or extras item is undefined: never the parent dish's values. */
  export function declarationsInDocument(
    document: MenuDocument,
    line: Pick<PublishedLine, "menuItemId" | "productId" | "extraListId">,
  ): DeclarationValues | undefined;
  /** Each line's declarations from its version's menu's live version, else (any miss) from its own
   * version; a line found in neither is absent. Reads through the per-handle document caches:
   * `menusOfVersions`, `readLiveDocuments`, `readRecordedDocuments`
   * (`menu-publication.ts:253,325,368`), never `liveVersions(..., "document")`, since kitchen
   * screens call this every 15 seconds. */
  export async function readPublishedDeclarations(
    tx: Transaction,
    lines: readonly PublishedLine[],
  ): Promise<Map<string, DeclarationValues>>;
  export async function readProductDeclarationValues(
    tx: Transaction,
    productIds: readonly string[],
  ): Promise<Map<string, DeclarationValues>>;
  ```
- An extra's values are `productDeclarationValues({ allergens: item.addAllergens,
  dietaryDeclarations: item.suitableFor, dietOverride: null })`.
- "Its version's menu" is `menu_versions.menu_id` of `line.menuVersionId`, which for a set-menu
  dish is the menu holding the set-menu copy (`packages/venue-service/src/operations.ts:1487`;
  `set-menu-copies.ts:54-61`).

- [ ] **Step 1: Failing tests** (`useVenueDb`, menus built through the existing menu test support —
  search `packages/menu/src/testing/` first):
  - `reads a dish from its menu's live version after a patch`: publish v1 with milk, patch the dish
    to fish; a line ordered from v1 resolves to fish.
  - `falls back to the line's own version when the live version dropped the dish`: publish v1 with
    the dish (milk), publish v2 without it, change the product to fish; the line resolves to milk,
    not fish and not absent. Same for `... dropped the variant` (the parent dish's values differ
    from the variant's and must not be used) and `... dropped the extras item`.
  - `reads a variant, an extra and a set-menu dish`: one line each; values equal the frozen ones.
  - `reads a menu's live version even when it is not sold now`: a menu with no current period still
    resolves (watcher point 3).
  - `a line with no version or found nowhere is absent`.
  - `one read per table however many lines`: 2,001 lines across three menus resolve, and
    `readLiveDocuments` and `readRecordedDocuments` are each called once (spies).
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/published-declarations.test.ts`; FAIL.
- [ ] **Step 3: Implement** as the Interfaces block says; batches through the package's `batches`.
- [ ] **Step 4: Run** again; PASS. Commit `-s`.

Changed in review (2026-11-25): a line its menu's live version lacks reads the newest earlier
version that was once live and holds it, and its own version last, so a published correction
outlives a later drop. This replaces "else its own version" above, in Architecture and in Review
Focus 1.

### Task 2.2: Kitchen tickets, the allergy check and the first-send capture use it

**Files:**
- Modify: `apps/server/src/line-nutrition.ts:57-83` (`currentLineDeclarations` selects the line's
  `menuVersionId`, `menuItemId`, `productId`, `extraListId` and calls `readPublishedDeclarations`;
  `readLineNutrition`, `readDisplayLineNutrition`, `captureSentLineNutrition` keep their signatures)
- Test: `apps/server/src/sent-line-nutrition.test.ts`, `apps/server/src/kitchen-allergy.reads.test.ts`,
  the kitchen ticket test that asserts "Contains:" (`rg -ln 'Contains' apps/server/src/*.test.ts`)

**Interfaces:** consumes Task 2.1. Callers unchanged: `kitchen-ticket-items.ts:199`,
`kitchen-allergy.ts:66`, `working-order-kitchen-fire.ts:685`, `working-order-counter.ts:106`,
`stored-order-lines.ts:486`, `order-group-reads.ts:555`.

- [ ] **Step 1: Failing tests** (only the unpublished-edit case; Task 2.1 owns the patched and
  dropped cases). `kitchen-allergy.reads.test.ts`: `an unpublished product edit does not reach the
  allergy check` (publish milk, edit product to fish, no publish: clashes read milk). Ticket test:
  the "Contains:" line prints the published allergen after an unpublished product edit.
  `sent-line-nutrition.test.ts`: the capture at first send holds the published value, not an
  unpublished product edit.
- [ ] **Step 2: Run** those files with `pnpm --filter @waitron/server exec vitest run ...`; FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them plus `src/kitchen-allergy.capture.test.ts src/kitchen-allergy.lifecycle.test.ts src/kitchen-allergy.notices.test.ts src/menu-allergen-workflow.test.ts`;
  cases that asserted the live product now assert the published value ("Changed test checks").
  PASS. Commit `-s`.

### Task 2.3: Kitchen screens, held dishes and the party's allergy screen use it

**Files:**
- Modify: `apps/server/src/working-order-station-queue.ts:244-325` (child rows and parents: drop the
  `products`/`parentProducts` joins for declarations; resolve child and parent lines in one
  `readPublishedDeclarations` call)
- Modify: `apps/server/src/working-order-held-read.ts:314-344` (unsent lines resolve through
  `readPublishedDeclarations`, keyed by line id instead of product id)
- Modify: `apps/server/src/party-allergy.ts:62-70,80-100` (stored lines through the resolver; draft
  extras read the served offer's extras item, as draft dishes already read the served offer) and
  `:186-215` (`readArrivingAllergyDishes`, which Move bill calls, `move-bill.ts:127`: its
  `productNutrition` read by product id becomes `readPublishedDeclarations` by line)
- Modify: `packages/venue-service/src/set-menu-copies.ts:54-70` (a bill's recorded set-menu copies,
  served to the till through `applyLiveFields`, take each dish's, variant's and extra's
  declarations from `declarationsInDocument` on the holding menu's live document, keeping their
  own when it lacks that exact one). Without this, after PR 1 the till basket shows a recorded
  copy's old allergens while the kitchen shows the correction (plan review finding 3; today
  `serveOffer` hides it by overlaying the product, `menu-document.ts:880`).
- Test: the station queue suite (`rg -ln 'readStationQueue\|station-queue' apps/server/src/*.test.ts`),
  `apps/server/src/working-order.test.ts` (held read), `apps/server/src/party-allergy.*.test.ts`,
  the set-menu copies suite (`rg -ln 'set-menu-copies\|serveRecordedSetMenus' packages/venue-service/src apps/server/src -g '*.test.ts'`)

- [ ] **Step 1: Failing tests,** one per reader, each only the unpublished-edit shape: publish
  milk, edit the product to fish without publishing → the reader shows milk. The station queue case
  covers a dish and its extra; the held-read case a variant; the party case a stored line and a
  draft extra; `readArrivingAllergyDishes` a dish and its extra (in the Move bill suite,
  `rg -ln 'readArrivingAllergyDishes\|move-bill' apps/server/src/*.test.ts`). The recorded
  set-menu case is different in kind and stays: a bill that recorded set-menu version v1, the dish
  changed in v2 (a new version published with a corrected allergen and a different price): the
  served copy keeps v1's price and shows v2's allergen.
- [ ] **Step 2: Run**; FAIL.
- [ ] **Step 3: Implement.** After it, `rg -n 'effectiveProductColumns\.(allergens|dietaryDeclarations)' apps/server/src -g '!*.test.ts'`
  prints nothing.
- [ ] **Step 4: Run** the four suites; PASS. Commit `-s`.

### Task 2.4: Kitchen screens hear menu changes; guide

**Files:**
- Modify: `apps/till/src/api/live-connection.ts:38-63` (`KITCHEN_TYPES` gains `"menu_versions"`,
  `"menu_releases"`)
- Docs: `apps/server/src/guide/{en,es}/table-service.md` (EN `:508`, ES `:540`; watcher point 5),
  after Task 2.0's sentence: "A dish already sent keeps, on the till, what it was sent with; the
  kitchen screens show any correction made since." PR 3b adds: "If the dish is ticked for a guest
  with that allergy, correcting it with Update now or Patch live menu also prints a correction slip
  in the kitchen; publishing the menu prints none." 
- Test: `apps/till/src/api/live-connection.test.ts` if it pins the list, and
  `pnpm exec vitest run scripts/live-subscriptions.test.ts`

- [ ] **Step 1: Failing test:** the kitchen subscription names `menu_versions` and `menu_releases`.
- [ ] **Step 2–4:** run, implement, run (`pnpm --filter @waitron/till exec vitest run src/api/live-connection.test.ts`,
  the root guard, `src/guide-content.test.ts`). Commit `-s`.

---

## PR 3a — Patch live menu can put the product's current allergens and diets live

Branch `feat/allergens-published-patch`. No reset. Task 3.1 and the dashboard half, Task 4.2
(Codex CHANGE: Patch is usable soon after the reset). Kitchen correction slips from this route
arrive in PR 3b.

**Size (estimate):** production about +190 / −10 lines (menu about 100, dashboard about 90);
tests about +300.

### Task 3a.1: A `declarations` patch field, always copied from the product

**Files:**
- Modify: `packages/menu/src/menu-patch-types.ts:20-27` (`offer`, `variant`, `extra` gain
  `"declarations"`)
- Modify: `packages/menu/src/menu-patch.ts:77-104` (`checkedValue`: `"declarations"` accepts only
  the string `"product"`, else `menu_patch.invalid`), `:244-270` (`patchFieldValue` returns the
  copy's frozen values: the four fields for a dish or variant, `addAllergens` and `suitableFor` for
  an extra), `:288-340` (`applyMenuPatch`)
- Modify: `packages/menu/src/menu-publication.ts:765-870` (`patchLiveMenu` reads the product values)
- Test: `packages/menu/src/menu-patch.test.ts`, `packages/menu/src/menu-patch.live.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function applyMenuPatch(
    document: MenuDocument,
    changes: readonly MenuPatchChange[],
    languages: ContentLanguages,
    declarations?: ReadonlyMap<string, DeclarationValues>, // by product id; required for a declarations change
  ): MenuDocument;
  /** The product ids a list's declarations changes copy from: the offer copies' productId, the
   * variant's id, the extra's productId. */
  export function declarationProductIds(
    document: MenuDocument,
    changes: readonly MenuPatchChange[],
  ): string[];
  ```
- `applyMenuPatch` for `declarations`: each dish copy takes the four fields of
  `declarations.get(copy.productId)`, each variant copy of `declarations.get(copy.id)`, each extra
  copy `extraDeclarationValues`'s two fields; a missing entry throws `menu_patch.invalid` with
  `field: "declarations"`.
- `patchLiveMenu` reads `readProductDeclarationValues(tx, declarationProductIds(...))` before
  applying.
- `patchLiveMenu`'s options gain `queued?: readonly string[]` (version ids), and `requeueAfter`
  gains `corrections?: ReadonlyMap<string, MenuDocument>`: a queued version named in it is queued
  again with that document (and its own hash and photos); every other one as today. `patchLiveMenu`
  builds the corrections by applying only its `declarations` changes, for the copies the queued
  version holds, to each named queued document. Any other field of a patch never reaches a queued
  version (A1151).
- `GET` of the patch draft answers, for a `declarations` target, the queued versions that differ:
  `{ versionId, activatesAt, stillOld }[]` (the route the dialog already loads from; a pure
  `queuedDeclarationDrift(queued, live, current)` in `menu-patch.ts`, also used by PR 3b).

- [ ] **Step 1: Failing tests.** `menu-patch.test.ts`: `declarations copies the product's values to
  the dish, its set-menu copies, a variant and an extra`; `refuses a declarations value other than
  "product"`; `patchFieldValue reads the frozen declarations`. `menu-patch.live.test.ts`:
  `patchLiveMenu puts the product's current allergens live`; `a queued version named in the
  request is queued again at its own time with the corrected allergens, and one not named keeps its
  document`; `a price in the same patch does not reach the named queued version` (A1151); `an id
  that is not queued is ignored`. `menu-patch.test.ts`: `stillOld is true only when every differing
  copy holds the live version's value` (a third value, and a copy the live version lacks, give
  false).
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/menu-patch.test.ts src/menu-patch.live.test.ts`; FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**; PASS. Commit `-s`.

### Task 3a.2: Patch live menu offers "Use the product's current allergens and diets"

**Files:**
- Modify: `apps/dashboard/src/widgets/menu-patch-draft.ts`, `menu-patch-dialog.ts` (cap 1,250),
  `menu-patch-review.ts`, strings
- Test: `menu-patch-draft.test.ts`, `menu-patch-dialog.test.ts`, `menu-patch-review.test.ts`,
  `menu-patch-dialog.a11y.test.ts`

The dialog also lists each scheduled version that differs, with its date: a checkbox ticked when
`stillOld`, sent as `queued` (owner, 2026-11-25 10:02). Nothing is listed until the declarations
checkbox is ticked.

- [ ] **Step 1: Failing tests.** The scheduled list: ticked and unticked rows, the date in the
  screen's language, only ticked ids are sent, nothing listed with the box unticked or no queued
  version. For a dish, a variant and an extra target, the dialog draws one
  checkbox "Use the product's current allergens and diets"; ticking it adds exactly
  `{ target, field: "declarations", value: "product" }`; the review lists "Allergens and diets:
  from the product". No free-typed allergen field exists (default 2). The Products guide, EN and
  ES, gains one sentence: "Patch live menu can also put a product's current allergens and diets
  live without publishing." 
- [ ] **Step 2–4:** run, implement (field primitives only, CLAUDE.md §3), run. Commit `-s`.

---

## PR 3b — "Update the live menus": which menus disagree, the correction route, kitchen slips

Branch `feat/allergens-published-correction`. No reset. Tasks 3.2–3.4.

**Size (estimate):** production about +300 lines (menu about 180, server about 120); tests about
+500.

**Test ownership (Codex CHANGE):** Task 3.2 owns which copies drift (dish, variant inheriting its
parent, extra, set-menu copy, a menu not sold now, a queued-only menu). Task 3.3 keeps only
corrects-all, second-call-empty and rollback. Task 3.4 owns who gets a slip.

### Task 3.2: Which menus disagree with the product, and the save's answer

**Files:**
- Create: `packages/menu/src/declaration-correction.ts` (exported from `index.ts`)
- Modify: `apps/server/src/menu-api.ts:1705-1724` (the editor PUT)
- Test: `packages/menu/src/declaration-correction.test.ts`, the editor route suite
  (`rg -ln 'products/.*/editor' apps/server/src/*.test.ts`)

**Interfaces:**
- Reads documents through `readLiveDocuments` and the queued versions' rows; a product save is rare,
  so one read per save that changed declarations is enough.
- Produces:
  ```ts
  export interface DeclarationDrift {
    menuId: string;
    name: string;
    liveVersionId: string | null;
    /** The changes the live version needs; empty when it agrees or there is none. */
    live: MenuPatchChange[];
    /** Each disagreeing queued version, earliest first (owner, 2026-11-25 10:02). */
    queued: QueuedDeclarationDrift[];
  }
  export interface QueuedDeclarationDrift {
    versionId: string;
    activatesAt: string; // ISO
    changes: MenuPatchChange[];
    /** Every differing copy still holds the value before the save. */
    stillOld: boolean;
  }
  /** Every declarations change `document` needs so each copy of `productIds` matches `current`. */
  export function declarationChanges(
    document: MenuDocument,
    productIds: ReadonlySet<string>,
    current: ReadonlyMap<string, DeclarationValues>,
  ): MenuPatchChange[];
  /** Menus whose live or a queued version disagrees with the products' current declarations. */
  export async function findDeclarationDrift(
    tx: Transaction,
    productIds: readonly string[],
    before: ReadonlyMap<string, DeclarationValues>,
    at?: Date,
  ): Promise<DeclarationDrift[]>;
  export interface DeclarationMenu {
    menuId: string;
    name: string;
    /** The live version disagrees, so Update now corrects it. */
    live: boolean;
    queued: { versionId: string; activatesAt: string; stillOld: boolean }[];
  }
  /** [] when the products' declarations equal `before`; else every drifting menu. */
  export async function waitingDeclarationMenus(
    tx: Transaction,
    productIds: readonly string[],
    before: ReadonlyMap<string, DeclarationValues>,
  ): Promise<DeclarationMenu[]>;
  ```
- The editor PUT answers `{ ...product, declarationMenus }`: it reads the product's and its
  variants' `readProductDeclarationValues` before `saveProductEditor`, and calls
  `waitingDeclarationMenus` after it, in the same transaction.
- Comparison is on the canonical JSON of the four fields (two for an extra).

- [ ] **Step 1: Failing tests** (`declaration-correction.test.ts`):
  - `names a live menu holding the dish, its variant, or it as an extra`
  - `names a set-menu's holding menu`
  - `names a menu whose live version lacks the dish but a queued version holds it, and a menu with
    only a scheduled first version, with live: false and the dates they start`
  - `stillOld is true while a queued copy holds the value before the save, and false once it holds a
    third value`
  - `names a live menu not sold at this hour` (point 3)
  - `a variant inheriting the parent's allergens drifts when the parent is saved` (Review Focus 2)
  - `names nothing once the menus agree` and, for `waitingDeclarationMenus`, `answers [] when the
    save did not change declarations although menus still drift` (default 4)
  - Route: `the editor save answers declarationMenus`, and `answers [] for a save of the price alone`.
- [ ] **Step 2: Run**; FAIL. **Step 3: Implement. Step 4: Run**; PASS. Commit `-s`.

### Task 3.3: Correct every drifting live version (menu package)

**Files:**
- Modify: `packages/menu/src/declaration-correction.ts` (adds `correctMenuDeclarations`)
- Test: `packages/menu/src/declaration-correction.test.ts`

**Interfaces:**
- Consumes: `findDeclarationDrift`, `declarationChanges` (3.2); `patchLiveMenu` (3a.1).
- Produces:
  ```ts
  /** Puts the product's and its variants' current declarations on every drifting LIVE version, and
   * on each queued version named in `queued`, in the caller's transaction, through `patchLiveMenu`
   * and, for a menu with no drifting live version, `requeueAfter`. Versions already agreeing, and
   * queued ones not named, keep their documents. `menus` lists only the menus it changed. */
  export async function correctMenuDeclarations(
    tx: Transaction,
    productId: string,
    personId: string,
    options?: { at?: Date; fallbackLanguage?: string; queued?: readonly string[] },
  ): Promise<{ menus: { menuId: string; name: string }[]; productIds: string[] }>;
  ```

- [ ] **Step 1: Failing tests** (which copies drift is 3.2's; here only): `corrects every drifting
  live version and each named queued version in one call, and leaves an unnamed queued version
  unchanged` (one menu with a dish, another holding the product as an extra in a set menu, a third
  with two queued versions, a fourth with only a scheduled first version);
  `a second call corrects nothing and answers menus: []` (Review Focus 4);
  `a throw on the second menu leaves the first unpatched` (Review Focus 5: run it inside one
  `withTransaction` that the test lets throw, then read both menus' live versions; force the throw
  with a spy on `patchLiveMenu`'s second call).
- [ ] **Step 2: Run** `pnpm --filter @waitron/menu exec vitest run src/declaration-correction.test.ts`; FAIL.
- [ ] **Step 3: Implement. Step 4: Run**; PASS, plus `pnpm exec vitest run scripts/write-path-tables.test.ts`
  (it writes `menu_versions`/`menu_releases` only through `menu-publication.ts`). Commit `-s`.

### Task 3.4: The route and the kitchen correction slips (server)

**Files:**
- Create: `apps/server/src/declaration-correction-kitchen.ts`
- Modify: `apps/server/src/menu-api.ts` (route; `MenuApiDeps.venueCfg?: TradingContext`),
  `apps/server/src/boot.ts:3421` (passes it, as `mountManagementApi` gets it)
- Test: `apps/server/src/declaration-correction.test.ts` (`useVenueDb`)
- Docs: `apps/server/src/guide/{en,es}/table-service.md` (the third sentence from Task 2.4)

**Interfaces:**
- Consumes: `correctMenuDeclarations` (3.3); `refreshKitchenAllergyClashes`
  (`apps/server/src/kitchen-allergy.ts:229`).
- Produces:
  ```ts
  /** Refreshes allergy clashes for every sent line (one with a ticket item) whose product (dish,
   * variant or picked extra) is one of `productIds`, on an order whose party is open: one
   * `refreshKitchenAllergyClashes` per order, with extra lines mapped to their dish line. */
  export async function refreshCorrectedKitchenLines(
    tx: Transaction,
    cfg: TradingContext,
    productIds: readonly string[],
  ): Promise<void>;
  ```
- Route: `POST /management-api/products/:id/live-declarations`, `menu.manage`, body
  `{ queued: string[] }` (version ids), answers `{ menus }`. `MenuApiDeps.venueCfg` stays optional for the other routes' harnesses, but this
  route throws a configuration error when it is absent (the `requireVenueCfg` pattern,
  `management-api.ts:338-349`), so slips are never skipped silently. Inside `gated`:
  `correctMenuDeclarations`, then `refreshCorrectedKitchenLines`. One transaction: any throw rolls
  back every menu and every queued slip and notice.
- The Patch live menu route (`menu-api.ts`, the route calling `patchLiveMenu`) also calls
  `refreshCorrectedKitchenLines` in its transaction when its changes hold a `declarations` change,
  with the product ids `declarationProductIds` names (Codex CHANGE: otherwise the same correction
  through Patch prints no slip and the guide sentence would be false). An ordinary Publish prints
  none, and the guide says so.
- Which orders (Codex CHANGE: a paid table's food can still be unserved): no filter on the order's
  status. The query is bounded by the slip path's own rule that the party is open
  (`kitchen-allergy.ts:364-367` skips `partyState !== "open"`, collected and abandoned); the rest
  (served, cancelled, not exposed, made here) is left to `enqueueKitchenAllergyUpdates`.
- Who gets a slip: `refreshKitchenAllergyClashes` only changes a block that already exists, and a
  block exists only for a dish line ticked for a guest with an allergy (`resolveKitchenAllergyBlocks`,
  `kitchen-allergy.ts:85-130`; `changedIngredientBlocks` returns null with no block, `:262`). The
  guide and the PR say "a dish ticked for a guest with that allergy", not "a table".

- [ ] **Step 1: Failing tests:** `a dish ticked for a guest who declared milk, sent and not served,
  gets one correction slip and a kitchen notice when corrected to contain milk`; `the same on a
  bill already paid whose dish is not served yet`; `the same correction through Patch live menu
  prints the slip too`; `a guest at the table who is not ticked on the dish gets none`; `a served
  dish gets none`; `a table with no
  declared allergy gets none` (default 1); `pressing it twice queues one slip`; `the route's failure
  leaves no slip, no notice and the product saved`; `the kitchen screen reads the corrected
  allergen` (station queue after the route); `the route refuses when venueCfg is absent`. Before
  asserting no slip, run the print worker to its end point and show once, by queueing a slip
  deliberately, that the assertion fails (runner §0a Tests); record that control in one sentence
  in the PR.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/declaration-correction.test.ts`; FAIL.
- [ ] **Step 3: Implement**, and the guide sentence. **Step 4: Run** it plus
  `src/kitchen-allergy.notices.test.ts src/menu-allergen-workflow.test.ts src/guide-content.test.ts`
  and `pnpm exec vitest run scripts/errors-reachable.test.ts scripts/guide-links.test.ts`; PASS.
  Commit `-s`.

---

## PR 4 — The dashboard: the question and Preview's warning

Branch `feat/allergens-published-dashboard`. No reset. Closes the backlog entry
(`docs/backlog.md:469-470`, deleted). Tasks 4.1, 4.3, 4.4 (4.2 went to PR 3a).

**Size (estimate):** production about +220 lines (dialog about 120, screen and client about 45,
Preview warning about 40, strings); tests about +350.

### Task 4.1: "Update the live menus now?" after a save

**Files:**
- Create: `apps/dashboard/src/widgets/live-declarations-dialog.ts` (a `wt-dialog`; plus
  `.a11y.test.ts` and `.test.ts`)
- Modify: `apps/dashboard/src/screens/products-screen.ts:435-470` (`#save`: after
  `updateProductEditor` resolves with a non-empty `declarationMenus`, open the dialog),
  `apps/dashboard/src/api/client.ts:4000` (`updateProductEditor`'s answer type gains
  `declarationMenus`; new `correctLiveDeclarations(productId, queued: string[]): Promise<{ menus: {menuId: string; name: string}[] }>`),
  `apps/dashboard/src/i18n/strings.ts` (EN, ES)

Draft words (for the watcher): title "Update the live menus now?"; body "These live menus still
show the old allergens and diets: {live menus}." Buttons "Update now" (primary) and "Not now".
When queued versions differ, a list under it (owner, 2026-11-25 10:02): "These scheduled menus
differ too:", one checkbox per version, "{menu}, from {date}", ticked when `stillOld`. With no live
menu to correct, the title is "Update the scheduled menus now?" and only that list shows; "Update
now" waits, disabled and quiet, while nothing is ticked.
Failure, on its own line above the buttons: "The product is saved, but these menus were not
updated: {menus}. Try again, or publish them." Buttons "Try again" and "Close".

- [ ] **Step 1: Failing tests.** Dialog: lists every live menu name, and each scheduled one with
  its date in the screen's language, ticked or not by `stillOld`; with only scheduled ones and none
  ticked, "Update now" is disabled; "Update now" calls `correctLiveDeclarations` once with the
  ticked version ids and closes on success; a refused call shows the failure line naming
  every menu, keeps the dialog open, and "Try again" calls once more; "Not now" calls nothing.
  Screen: a save answering `declarationMenus: []` opens nothing; a save answering two menus opens
  the dialog with both. a11y: each state, both themes.
- [ ] **Step 2–4:** run (`pnpm --filter @waitron/dashboard exec vitest run src/widgets/live-declarations-dialog.test.ts src/widgets/live-declarations-dialog.a11y.test.ts src/screens/products-screen.test.ts`),
  implement, run. Commit `-s`.

### Task 4.3: Preview warns that an allergen change is not live

**Files:**
- Modify: `packages/shared/src/menu-document/menu-document-types.ts:389-402` (warnings gain
  `{ kind: "declarations_not_live"; products: { id: string; name: string; parentName: string | null }[] }`)
- Modify: `packages/menu/src/menu-publication.ts:427` (`previewMenu`: products whose changes carry
  an `allergens` or `diet` field)
- Modify: `apps/dashboard/src/widgets/menu-preview.ts`, strings
- Test: `packages/menu/src/menu-publication.test.ts`, `apps/dashboard/src/widgets/menu-preview.test.ts`

Draft words: "Allergen or diet changes are not live yet: {products}. Publish, or patch them, to put
them live."

- [ ] **Step 1: Failing tests:** an unpublished allergen edit yields the warning naming the dish; a
  price edit alone yields none; the dashboard renders it in EN and ES.
- [ ] **Step 2–4:** run, implement, run. Commit `-s`.

### Task 4.4: Guides, pictures, backlog

- [ ] Products guide EN and ES: one short paragraph — saving a dish on a live menu asks whether
  to update the live menus; Not now leaves the change waiting until the menu is published or
  patched. Run `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts` and
  `pnpm exec vitest run scripts/guide-links.test.ts`.
- [ ] Pictures for the owner, not committed: the dialog (both states), the patch field and the
  Preview warning, at 1440 and 390 px, EN and ES, light and dark, in
  `~/waitron-campaign/allergens-published-shots/`.
- [ ] `docs/backlog.md:469-470` deleted. Commit `-s`.

---

## Size

Per PR, estimated before building (each PR reports the real added and removed lines separately for
production, tests and test support, from its diff, runner §0a):

| PR | Production | Tests | Note |
| --- | --- | --- | --- |
| 1 | +90 / −60 | +180 / −80 | plus generated files (migration, snapshot, Madrid fixtures, fingerprints); resets |
| 2 | +330 / −120 | +450 / −150, support +40 | the largest |
| 3a | +190 / −10 | +300 | |
| 3b | +300 | +500 | |
| 4 | +220 | +350 | |
| Total | about +1,130 / −190 | about +1,780 / −230 | |

Each is meant to fit one implementer run per task (well under 100 tool calls) and a few hours'
build; PR 2 is the one most likely to run long, and is split at Task 2.2/2.3 if it does.
