# Patch live menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** A manager can patch a few values in the version of ONE menu that is live now — wording,
price, picture, VAT class — and put the patch live at once, without touching the products, any
queued version or any other menu.

**Architecture:** A pure, browser-safe function applies a list of field changes to a copy of a
frozen `MenuDocument`, refusing anything outside the allowed fields. A catalogue transaction writes
the result as a new version under the next number, moves the live pointer to it, and re-queues
every still-queued version under later numbers with the same date and content. Two management
routes expose the live document and the patch. A dashboard dialog ("pick an item, then edit it")
stages the changes, shows "old → new" on a review step, and posts them.

**Tech Stack:** TypeScript, drizzle on SQLite (`@waitron/db`), Hono routes in `apps/server`, Lit
in `apps/dashboard`, Vitest (browser mode for the dashboard).

**Spec:** `docs/superpowers/specs/2026-10-27-patch-live-menu-design.md`. Read it before any task. Backlog/queue item: A1151.

## Global Constraints

- User-facing words: the action is **"Patch live menu…"**; the version it makes is a **patch**.
  Never "hot patch" in user text.
- Patchable fields only: wording, price, picture, VAT class. **Never** allergens, diet labels,
  unit, availability, course, category, ordering, colour, structure or Device Home Page
  (spec decisions 1 and 10).
- A patch changes ONLY the live version of the menu being patched. No write to `products`,
  `menu_items`, sections, any other catalogue table, any other menu's versions.
- Lines already on open orders keep their price and VAT class.
- Queued versions keep their `activates_at` and their document (same `content_hash`).
- No knock-on: patching a dish never changes its variants.
- An extras item, options label or list name is patched in EVERY copy within the version; a
  section in every copy except one whose included-menu folder fixes that field (`fixed`).
- Translated text is merged with `mergeOptionalTranslations` against the venue's content
  languages: a switched-off language's stored text is kept, a blank language is dropped.
- Coverage holds `98/98/98/95` in every package touched. No exclude or ignore comment over new code.
- General code is English only; dashboard strings go in both columns of `strings.ts` / `codes.ts`.
- Forms contract (`docs/developers/design-system.md` → Forms): inline field errors, one localized
  bottom message on its own line above the buttons, save disabled until the draft changes
  (`draftScopeFor`, `saveActionState`), a `*.unsaved.test.ts` for the dialog.
- A refusal explains what happened and what each choice does; it never sends the person elsewhere.
- Every commit `git commit -s`. Run `pnpm format:check` before each commit.
- Comments only for an invariant or a non-obvious why.

## Review Focus

1. **A section, extras list or options list that appears more than once in the version.**
   Expected: every copy changes, except a section copy whose included-menu folder fixes that
   field. Pinned in Task 2.
2. **A queued version comes due, or someone else publishes, while the dialog is open.** Expected:
   the save is refused `menu_patch.base_changed`; reloading keeps the staged changes that still
   apply and says how many could not be kept. Pinned in Tasks 3 and 8.
3. **Two queued versions.** Expected: both re-queued in their original order, same dates, same
   content, and each still goes live at its date. Pinned in Task 3.
4. **A price typed "5,5" in Spanish, or "5.5".** Expected: stored "5.50"; "abc" or a negative is
   refused under the price field. Pinned in Tasks 1 and 7.
5. **Clearing one language's customer name, with a switched-off language stored.** Expected: the
   cleared language is dropped (falls back to the staff name), never stored as `""`, and the
   switched-off language's text is kept. Pinned in Task 1.

---

### Task 1: Patch shapes, and applying them to dishes and variants

**Files:**
- Create: `packages/catalogue/src/menu-patch-types.ts` (browser-safe leaf: types and the field table)
- Create: `packages/catalogue/src/menu-patch.ts` (browser-safe: no `@waitron/db` import)
- Modify: `packages/catalogue/src/errors.ts` (register `menu_patch.invalid`)
- Test: `packages/catalogue/src/menu-patch.test.ts`

**Interfaces:**
- Produces, in `menu-patch-types.ts`:
  ```ts
  export type MenuPatchTarget =
    | { kind: "offer"; menuItemId: string }
    | { kind: "variant"; menuItemId: string; variantId: string }
    | { kind: "extra"; listId: string; productId: string }
    | { kind: "option_label"; listId: string; labelId: string }
    | { kind: "list"; listKind: "extras" | "options"; listId: string }
    | { kind: "section"; sectionId: string };
  export interface MenuPatchChange { target: MenuPatchTarget; field: string; value: unknown }
  export const PATCH_FIELDS: { readonly [K in MenuPatchTarget["kind"]]: readonly string[] } = {
    offer: ["name", "customerName", "kitchenName", "description", "image", "price", "vatClass"],
    variant: ["name", "customerName", "kitchenName", "image", "price", "vatClass"],
    extra: ["name", "customerName", "kitchenName", "image", "price", "vatClass"],
    option_label: ["name", "customerName", "kitchenName"],
    list: ["name", "customerName", "kitchenName"],
    section: ["internalName", "names", "image"],
  };
  export interface MenuPatchResult { versionId: string; number: number; requeued: QueuedEdition[] }
  export interface LiveMenu { versionId: string; number: number; since: string; document: MenuDocument }
  ```
- Produces, in `menu-patch.ts`:
  - `parseMenuPatch(body: unknown): MenuPatchChange[]` — shape, target kind, field name against
    `PATCH_FIELDS`, and each value's own checks.
  - `applyMenuPatch(document: MenuDocument, changes: readonly MenuPatchChange[], languages: ContentLanguages): MenuDocument`
    — a patched deep copy (`structuredClone`); never mutates the input, which may be deep-frozen.
  - `patchFieldValue(document: MenuDocument, target: MenuPatchTarget, field: string): unknown` —
    the current value at the first copy that takes the patch, or `undefined` when the target is
    not in the document.
- Refusal: `AppError("menu_patch.invalid", { change: number; field: string; reason?: string })`.
  `change` is the index; `field` is `"target"`, `"field"` or the field's name; `reason` is the
  code a validator underneath threw (e.g. `content.translation_invalid`), so the dashboard can
  show that code's own wording. Register it in `errors.ts` beside `menu_publication.*`. A body
  that is not an array refuses with `change: -1, field: "changes"`. (2026-10-27, finish-branch
  review: a body whose `changes` is not a list is now refused `management.request_invalid` with
  `field: "changes"`, like the route's other body checks.)

Value rules:
- `name`, `internalName`: string, trimmed, non-blank.
- `customerName`, `names`, `description`: `null` or a language→text map whose keys pass
  `contentLanguageCode`; applied as
  `mergeOptionalTranslations(stored, supplied, languages)` (`./optional-translations.js`); for
  `names` a `null` result is stored as `{}`.
- `kitchenName`: `null` or string; trimmed; blank becomes `null`.
- `image`: `null` or a non-empty string (existence is Task 3's job).
- `price`: string passing `isProductPrice` (`./modifier-limits.js`), stored as
  `toScale(decimal(value), 2)`.
- `vatClass`: one of `VAT_CLASSES`.

Write rules for this task:
- Offer (`document.offers[menuItemId]`): each field to the same-named key, except `price` writes
  `unitPrice`, and also `grossPrice` when it is not `null`.
- Variant (in `offers[menuItemId].variants` by `id`): same; `price` writes `unitPrice`, and also
  `menuPrice` when it is not `null`. No `description`.
- A target missing from the document: `field: "target"`.

- [ ] **Step 1: Write failing tests** in `menu-patch.test.ts`. Build documents with the menus
  fixture (`packages/catalogue/test/menus-fixture.ts`) published through `publishMenu`, read with
  `liveVersions(tx, [f.lunch], "document")`. Cases:
  - `"patches a dish's price on the menu, keeping a menu price in step"`: Lemonade on Lunch (Lunch
    sets its own 2.80) patched to `"5.5"` → `unitPrice` and `grossPrice` both `"5.50"`; Soup (no
    menu price) patched → `grossPrice` stays `null`.
  - `"patches a variant's price and VAT class and leaves its dish alone"` (Large).
  - `"patching a dish leaves every variant as it was"`: `variants` deep-equal before and after.
  - `"merges translated text with the venue's languages"`: languages `en`,`es` on; stored
    `{ en, es, fr }`; patch `{ en: "Lemonade", es: "  " }` → `{ en: "Lemonade", fr: <kept> }`;
    all enabled blank and nothing else stored → `null`.
  - `"refuses a field outside the list, naming the change"`: index 1 with `"unit"`, `"allergens"`,
    `"dietaryDeclarations"`, `"color"` → `{ change: 1, field: "field" }`; unknown target kind →
    `field: "target"`; a non-array body → `{ change: -1, field: "changes" }`.
  - `"refuses each bad value under its field"`: price `"abc"` and `"-1"`, vatClass `"luxury"`,
    blank name, a non-string kitchen name, a non-object customer name, an unknown language key
    (with `reason`), an empty-string image, a missing variant.
  - `"never mutates the document it is given"`: deep-freeze the input; apply succeeds.
  - `"patchFieldValue reads the current value, or undefined for a missing target"`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/catalogue exec vitest run src/menu-patch.test.ts`.
  Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** the same command. Expected: PASS, with a `Tests` count.
- [ ] **Step 5: Commit** `feat(catalogue): apply a patch's field changes to a menu version's dishes and variants`.

### Task 2: Applying patches to extras, option labels, lists and sections — every copy

**Files:**
- Modify: `packages/catalogue/src/menu-patch.ts`
- Test: `packages/catalogue/src/menu-patch.test.ts`

**Interfaces:**
- Consumes: Task 1's functions.
- Produces: the same functions, now covering every target kind.

Write rules:
- `extra`: every `offers[*].offeredModifiers[*]` with `kind === "extras" && id === listId`, every
  item with `productId`. Fields map 1:1. A wording change (`name`, `customerName`, `kitchenName`)
  also rewrites `presentation` to
  `{ name, customerName, kitchenName, variantName: null, variantCustomerName: null, variantKitchenName: null }`
  from the item's resulting three values, so receipts (which read `presentation` through
  `newCustomerPresentation`) show the patched wording. A variant extra's parent and variant names
  become one name; that is intended.
- `option_label`: every options list with `id === listId`, every label with `id === labelId`.
- `list`: every offered modifier with `kind === listKind && id === listId`.
- `section`: every `DocumentMember` of kind `section` with `sectionId`, walked recursively from
  `document.root.members`; `internalName` → `internalName`, `names` → `names`, `image` → `image`.
  A copy whose `fixed` holds that field (`fixed.names` for `names`, `fixed.image` for `image`) is
  left as it is.
- A target with zero copies that take the patch: `field: "target"`.

- [ ] **Step 1: Write failing tests** (attach lists to a second dish with `writeProductModifiers`,
  as the fixture does at `menus-fixture.ts:164`, before publishing):
  - `"patches an extra's price on every dish that offers its list"`.
  - `"rewrites an extra's presentation with its wording"`: after a name patch,
    `presentation.name` is the new name and every `variant*` field is `null`.
  - `"patches an option label and a list name in every copy"`: the ice list on two dishes.
  - `"patches a section everywhere it appears, except where an included folder fixes it"`: one
    section reached directly and through an included menu whose folder fixes its names; the direct
    copy changes, the fixed copy keeps its names and its `fixed`.
  - `"refuses a target the version does not hold"` for each new kind.
- [ ] **Step 2: Run** the file. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalogue): patch extras, labels, lists and sections in every copy`.

### Task 3: Putting a patch live and re-queuing what waits

**Files:**
- Modify: `packages/catalogue/src/menu-publication.ts` (add `readLiveMenu`, `patchLiveMenu`)
- Modify: `packages/catalogue/src/sections.ts` (export `mediaImageExists`)
- Modify: `packages/catalogue/src/errors.ts`
- Modify: `packages/catalogue/src/index.ts` (export the new functions and types)
- Test: `packages/catalogue/src/menu-patch.live.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2; existing `settleDue`, `liveVersions`, `nextNumber`, `insertVersion`,
  `menuDocumentHash`, `readContentLanguages`.
- Produces:
  - `readLiveMenu(tx: Transaction, menuId: string, at?: Date): Promise<LiveMenu | null>`
  - `patchLiveMenu(tx: Transaction, menuId: string, baseVersionId: string, changes: unknown, personId: string, options?: { at?: Date }): Promise<MenuPatchResult>`
- New codes in `errors.ts`:
  - `"menu_patch.not_published": { menuId: string }`
  - `"menu_patch.base_changed": { menuId: string; baseVersionId: string; liveVersionId: string; liveNumber: number }`
  - `"menu_patch.unchanged": { menuId: string }`

`patchLiveMenu` order, all in the caller's transaction:
1. `settleDue(tx, at, [menuId])`.
2. Live = `liveVersions(tx, [menuId], "document", at)`; none → `not_published`; its `versionId !==
   baseVersionId` → `base_changed`.
3. `parseMenuPatch(changes)`; for each `image` change with a non-null value,
   `mediaImageExists(tx, value)` or `menu_patch.invalid { change, field: "image" }`.
4. `applyMenuPatch(live.document, parsed, await readContentLanguages(tx, FALLBACK_LOCALE))`
   (match the fallback `sections.ts` uses); hash equal to live's `contentHash` → `unchanged`.
5. `insertVersion` under `nextNumber`, `publishedAt: at`, `publishedBy: personId`; upsert
   `menu_publications` exactly as `publishMenu` does.
6. Read every `menu_scheduled_publications` row of the menu with `state = 'queued'` and
   `activates_at > at`, joined to its version, ascending by number. Mark ALL of them cancelled
   (`cancelledAt: at`, `cancelledBy: personId`) first — the queued-time unique index forbids two
   queued rows at one instant — then for each, in order, `insertVersion` with the SAME `document`,
   `contentHash`, `publishedAt` and `publishedBy` under `nextNumber`, and insert its schedule row
   with the SAME `activatesAt`, `queuedAt` and `queuedBy`.
7. Return `{ versionId, number, requeued }`.

- [ ] **Step 1: Write failing tests** (copy the clock, `ANA`, `publicationTables`, `statements`
  and `writtenTables` helpers from `menu-schedule.test.ts`):
  - `"puts the patch live at once under the next number"`; `readLiveMenu` answers it.
  - `"leaves the products and the working menu untouched"`: `previewMenu(f.lunch)`'s `hash`
    before equals after.
  - `"leaves every other menu's live version untouched"`: Dinner shares Drinks; its live
    `versionId` and hash unchanged after patching a Drinks dish on Lunch.
  - `"moves every queued version after the patch with the same date and content"`: queue two
    (day 8, day 9); patch; `listMenuPublications` shows two queued editions numbered above the
    patch, same `activatesAt`, same `contentHash`, same order; the original rows are `cancelled`.
  - `"a re-queued version still goes live at its date"`: `activateDueMenuPublications` at day 8.
  - `"refuses a stale base"`: after a publish made v2 live → `base_changed` naming v2; and when a
    queued version's date passes before the save → the same refusal naming it.
  - `"refuses an unpublished menu and a patch that changes nothing"`.
  - `"refuses a picture the library does not hold, under the picture field"` (the catalogue test
    database has no media tables, so every picture is refused here; Task 5 proves the accepted case).
  - `"writes only the publication tables"`: `writtenTables` ⊆ `menu_versions`,
    `menu_version_images`, `menu_publications`, `menu_scheduled_publications`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/catalogue exec vitest run src/menu-patch.live.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then run `src/menu-schedule.test.ts` and
  `src/menu-publication.test.ts`: still PASS.
- [ ] **Step 5: Commit** `feat(catalogue): put a menu patch live and keep queued versions after it`.

### Task 4: Management routes

**Files:**
- Modify: `apps/server/src/catalogue-api.ts` (two routes beside `/publish`, ~:1094)
- Test: `apps/server/src/catalogue-api.menu-patch.test.ts` (pattern: `catalogue-api.menu-schedule.test.ts`)

**Interfaces:**
- Consumes: Task 3's `readLiveMenu`, `patchLiveMenu`.
- Produces:
  - `GET /management-api/catalogues/:id/live` → `LiveMenu | null` (through `gated`).
  - `POST /management-api/catalogues/:id/patch`, body `{ baseVersionId: string; changes: unknown[] }`
    → `MenuPatchResult` (through `gated`: the publish permission applies and the menu revision
    advances). `baseVersionId` checked with `requireString` then as a uuid, as `MenuId` is.

- [ ] **Step 1: Write failing tests:** a session without the catalogue-write permission is
  refused exactly as `/publish` refuses it; GET answers `null` before the first publish and the
  live document after; POST answers the new number; each `menu_patch.*` refusal reaches the
  response with the status `/publish` gives `menu.changed_since_preview`; **a picture patch naming
  a photo in the media library is accepted and its `menu_version_images` row written** (the full
  module set is installed here).
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/catalogue-api.menu-patch.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the routes.
- [ ] **Step 4: Run** it, then from the root `pnpm vitest run scripts/errors-reachable.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): routes to read and patch a menu's live version`.

### Task 5: Open orders keep their price after a patch

**Files:**
- Test: `apps/server/src/menu-patch-open-lines.test.ts` (harness copied from
  `apps/server/src/vat-class-at-line-add.test.ts`: `setupVenue`, `park`, `stored`, `one`;
  `setupVenue` must also return the counter menu's id for the patch call)

**Interfaces:**
- Consumes: Task 3's `patchLiveMenu`.

- [ ] **Step 1: Write the test:** park an order with one Caña; patch Caña's price and VAT class
  through `patchLiveMenu`; the stored line's `unitPriceGross` and `vatClass` are unchanged; a line
  added after the patch (asserting the new version) takes the new price and class; a line
  asserting the OLD version id is refused `menu.version_changed`.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/menu-patch-open-lines.test.ts`.
  Expected: PASS (this pins existing behaviour; there is no new code). Then prove it pins something:
  temporarily make the patch skip the price change, re-run, see the "new line takes the new price"
  case FAIL, and restore.
- [ ] **Step 3: Commit** `test(server): open orders keep their price and VAT class after a menu patch`.

### Task 6: Dashboard client, live reads, and refusal wording

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (beside `publishMenu`, ~:2818)
- Modify: `apps/dashboard/src/api/live-queries.ts` (~:320)
- Modify: `apps/dashboard/src/i18n/codes.ts` (English and Spanish)
- Test: the client's existing test file for menu calls, and `live-queries`' test

**Interfaces:**
- Produces on `DashboardApi`:
  - `getLiveMenu(menuId: string): Promise<LiveMenu | null>`
  - `patchLiveMenu(menuId: string, body: { baseVersionId: string; changes: MenuPatchChange[] }): Promise<MenuPatchResult>`
- In `live-queries.ts`, `getLiveMenu` depends ONLY on `menu_publications`,
  `menu_scheduled_publications` and `menu_versions` (the file maps reads to the tables they
  depend on; there is no per-write invalidation to add).
- Code messages (exact English; Spanish to match in meaning and register):
  - `menu_patch.base_changed`: "Version {liveNumber} went live while you were patching. Reload to patch it instead; changes that still fit are kept."
    (2026-10-27, finish-branch review: the code message no longer holds `{liveNumber}`; the
    numbered sentence is the `strings.ts` key `menu_patch.base_changed_live`, filled by the dialog.)
  - `menu_patch.unchanged`: "These values are already live. Nothing was saved."
  - `menu_patch.not_published`: "This menu has never been published, so there is nothing live to patch. Publish it first."
  - `menu_patch.invalid`: "Check this value."

- [ ] **Step 1: Write failing tests** for the two calls' method, path and body, and for
  `getLiveMenu`'s table dependencies.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): client calls for reading and patching the live menu`.

### Task 7: The patch draft and tree

**Files:**
- Create: `apps/dashboard/src/widgets/menu-patch-draft.ts` (pure)
- Test: `apps/dashboard/src/widgets/menu-patch-draft.test.ts`

**Interfaces:**
- Consumes: `applyMenuPatch`, `patchFieldValue`, `PATCH_FIELDS`, imported from
  `@waitron/catalogue/src/menu-patch.js` (browser-safe).
- Produces:
  - `type PatchTreeNode = { target: MenuPatchTarget; label: string; children: PatchTreeNode[] }`
  - `patchTree(document: MenuDocument): PatchTreeNode[]` — sections in document order holding
    their dishes; under each dish its variants; then one "Extras and options" group listing each
    extras list and options list once (not once per dish), each holding its items or labels.
  - `class MenuPatchDraft { constructor(document: MenuDocument, languages: ContentLanguages); set(change: MenuPatchChange): void; changes(): MenuPatchChange[]; changed(target: MenuPatchTarget): boolean; rebase(document: MenuDocument): { dropped: number } }`
    — `set` with a value equal to the live value removes that change; `rebase` keeps each change
    `applyMenuPatch` still accepts on the new document and counts the rest.

- [ ] **Step 1: Write failing tests:** tree order; lists appear once; `set` then back to the live
  value leaves no change; `rebase` drops a change whose target vanished and counts it.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-patch-draft.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): a draft and tree for patching a live menu`.

### Task 8: The patch dialog — shell, tree, search and forms

**Files:**
- Create: `apps/dashboard/src/widgets/menu-patch-dialog.ts` (`dashboard-menu-patch-dialog`)
- Modify: `apps/dashboard/src/i18n/strings.ts` (keys `menu_patch.*`, both languages)
- Test: `apps/dashboard/src/widgets/menu-patch-dialog.test.ts` (stub api in the style of
  `menu-publications.test.ts`)

**Interfaces:**
- Consumes: Task 6's client calls, Task 7's draft and tree.
- Produces the element with properties `api: DashboardApi`, `menuId: string`, `menuName: string`,
  `open: boolean`; emits `wt-menu-patched` (detail `MenuPatchResult`, `bubbles: true, composed: true`)
  after a save. (The save itself is Task 9.)

Layout (spec decision 5, mockup option A):
- Heading "Patch version {number} of {menu}". A search box (`textField`, placeholder "Search
  dishes, extras and sections") filters the tree by label. The tree on the leading side, with a dot
  on changed items. The picked item's form on the other side, showing ONLY its `PATCH_FIELDS`.
- Fields: staff name and section internal name via `textField(..., required = true)`; customer
  names, section names and description via `optionalTextFields` (one per content language); kitchen
  name via `textField`; price via `priceField` (`wt-price-input`); VAT via the `wt-combobox` options
  built as `product-editor.ts`'s `taxes` getter; picture via `dashboard-image-upload` with
  `.api = { imageLibraryRequest: api.imageLibraryRequest }`.
- A dish's form lists its variants beneath as links that pick them. A dish with variants shows,
  beside price and VAT class: "Sold through its variants: the till charges each variant's own price
  and VAT class."
- Values are checked in the browser with the same parsers before staging; a bad value shows its
  error under the field and is not staged.
- A refresh of the live document while the dialog is open never resets staged changes.

- [ ] **Step 1: Write failing tests:** the heading shows the live number; search narrows the tree;
  picking Soup shows exactly its patchable fields (no unit, allergens or diet field); editing the
  price marks Soup changed; `"5,5"` with the Spanish locale stages `"5.50"`; Lemonade shows the
  variants note; a list entry shows only the list's three name fields.
- [ ] **Step 2: Run** `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-patch-dialog.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): the patch dialog's tree and item forms`.

### Task 9: The review step, saving, and refusals

**Files:**
- Modify: `apps/dashboard/src/widgets/menu-patch-dialog.ts`, `apps/dashboard/src/i18n/strings.ts`
- Test: `menu-patch-dialog.test.ts`

Behaviour:
- Footer: "Review {count} changes", quiet and disabled until the draft has a change
  (`draftScopeFor` + `saveActionState`).
- The review step lists each change as "{item}: {field} {old} → {new}" (money with `formatMoney`,
  VAT with `vatClassName`). Under the list, always: "Lines already on open orders keep their old
  price and VAT class." When the menu has a queued version: "The version going live on {date}
  does not include these changes." (by date, not number: the save renumbers it). Always: "The next
  normal publish from the products puts the old values back unless you fix the products too."
  Buttons: "Keep editing" and "Put live now" (primary).
- `menu_patch.invalid` returns to the form, picks the item of the named change, and shows the
  `reason` code's own message (or "Check this value.") under the named field, plus the one bottom
  message the Forms contract requires.
- `menu_patch.base_changed` shows its message with a "Reload" button that fetches `getLiveMenu`,
  calls `draft.rebase`, and when `dropped > 0` says "{dropped} changes no longer fit the live
  version and were dropped."
- Success: the scope commits, `wt-menu-patched` is emitted, the dialog closes.

- [ ] **Step 1: Write failing tests:** review lists old → new; each note appears under its
  condition; "Put live now" posts `{ baseVersionId, changes }`; an invalid-field refusal lands
  under that field with the bottom message; base-changed → Reload → the dropped count; success
  emits and closes.
- [ ] **Step 2: Run** the file. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): review and put a menu patch live`.

### Task 10: Leaving with staged changes, and accessibility

**Files:**
- Test: `apps/dashboard/src/widgets/menu-patch-dialog.unsaved.test.ts` (pattern:
  `menu-publications.unsaved.test.ts`), `apps/dashboard/src/widgets/menu-patch-dialog.a11y.test.ts`
  (pattern: `menu-publications.a11y.test.ts`)
- Modify: `menu-patch-dialog.ts` only if a test exposes a gap

- [ ] **Step 1: Write the tests:** closing with staged changes asks first, and Keep/Discard do
  what they say; closing after a save asks nothing; axe passes on the form step and the review
  step, in both themes.
- [ ] **Step 2: Run** both files. Expected: FAIL only where behaviour is missing; fix it.
- [ ] **Step 3: Run** again. Expected: PASS.
- [ ] **Step 4: Commit** `test(dashboard): unsaved-changes and accessibility cases for the patch dialog`.

### Task 11: The entry point on the menu editor

**Files:**
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (`#renderLiveWords`, ~:3287; mount the
  dialog)
- Modify: `apps/dashboard/src/i18n/strings.ts`
- Test: the menus screen's existing test file

Behaviour: beside the live words in the editor header, a secondary `wt-button`
`data-test="patch-live-menu"` reading "Patch live menu…", shown only while `status.state` is
`current` or `changed`. It opens the dialog. On `wt-menu-patched` the screen RE-READS the menu's
status (`api.getMenuStatus`) rather than calling `publishedStatus`, which would wrongly mark it
`current` (`menus-screen.ts:127-133`, `:1478-1480`).

- [ ] **Step 1: Write failing tests:** the button shows for a published menu and not for an
  unpublished one; clicking opens the dialog; after `wt-menu-patched` with the products unchanged
  since the original publish, the live words show the new number AND the status is `changed`.
- [ ] **Step 2: Run** the screen test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(dashboard): patch the live menu from the menu editor`.

### Task 12: The guide, the help link, and a look

**Files:**
- Modify: `apps/server/src/guide/en/products.md` and `apps/server/src/guide/es/products.md`
  (new section `## Patch the live menu in an emergency {#patch-live-menu}` after `{#menus}`)
- Modify: `apps/server/src/guide/en/content-and-images.md` and its Spanish twin, where they say
  which photos a published menu holds (en :217–227): a patch holds its own photos the same way
- Modify: `apps/dashboard/src/help-guide.ts` (`GUIDE_LINKS["products.patch-live-menu"]`), and a
  `wt-help-tooltip mode="help-mode"` beside the button linking to it
- Test: `apps/server/src/guide-content.test.ts`, root `scripts/guide-links.test.ts`

Guide content (both languages): when to use it (a mistake in what is live while the products
already hold the next menu's work); what it can change, and that allergens and diet labels are
fixed in the product instead; it changes only this menu's live version; open orders keep their
price; a queued version still goes live at its date without the patch; the next normal publish
puts the old values back unless the products are fixed too.

- [ ] **Step 1: Write** the sections and the link.
- [ ] **Step 2: Run** `pnpm --filter @waitron/server exec vitest run src/guide-content.test.ts`
  and, from the root, `pnpm vitest run scripts/guide-links.test.ts scripts/help-tooltip-mode.test.ts`.
  Expected: PASS.
- [ ] **Step 3: Look:** start the dev stack (`wa-wt demo <your-worktree-name>`), open the
  dialog in both themes and at phone width, patch a price, ring the dish up on the till, and check
  the new line carries the patched price.
- [ ] **Step 4: Commit** `docs(guide): patching the live menu`.
