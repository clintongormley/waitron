# An included menu shown as a folder or directly, with its own folder name — implementation plan (A322)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`; one
> implementer per task, in this worktree
> (`/Users/clintongormley/workspace/worktrees/waitron-feat-included-menu-direct-sections`, branch
> `feat/included-menu-direct-sections`), in order. Steps use checkbox (`- [ ]`) syntax. Every task
> is test-first: write the failing behavioural test, run it, watch it fail for the stated reason,
> then the minimal implementation. Each task is sized for one implementer well under 100 tool
> calls. An implementer that passes about 150 calls with its task unfinished stops at a passing
> (or cleanly red) point, commits, and returns a handover: what is done, what is left, the files,
> and each check's state. A fresh implementer continues from it.
>
> **Existing assertions** (this lane's THE RULE with the owner's 2026-10-05 test-change decision):
> a check may change when this item's spec changes what it checks — each such change is listed
> under "Changed test checks" at the end and goes in the PR's section of that name plus one FYI in
> `~/waitron-campaign-b/questions.md`. It is a STOP (ask in questions.md, carry on with other
> tasks) only when controversial: a check that broke as a side effect, a deletion or weakening, a
> fiscal/golden/`inmutabilidad` test, a `scripts/` guard changed other than by the addition this
> plan names, money/VAT/login/permissions/cash-drawer values the spec does not spell out.

> Written 2026-10-07 against `main` at `3328d3a35` (after W99, #1358). Every `file:line` below was
> read at that commit. Nothing in this plan was measured; every "today" fact is a reading.

**Goal:** each include of a menu (the `section_members` row holding the included menu's root) gets
an Edit dialog with a "Show as a folder" switch (on by default, today's behaviour). Switched off,
the included menu's top-level sections and loose products appear in the folder's place, in their
own order, on the till, the Menus screen preview and the device home page. Switched on, the folder
can take its own customer-facing names, image and colour; a field left equal to the included
menu's value keeps following that menu.

**Architecture:** two new columns on `section_members` (`show_as_folder`, `folder_overrides`).
The section graph carries them; the menu document carries the folder's effective presentation
and, for an include shown directly, `direct: true` on the included menu's node. The node stays in
the document tree, so change lists, placements, change navigation and home shortcuts keep working
unchanged; every reader that DRAWS a list passes it through one shared browser-safe function,
`shownMembers`, which puts a direct node's members in its place. A media migration guards the
folder image like `sections.image`. A new management route writes the setting; a new dashboard
dialog edits it.

**Tech stack:** TypeScript, drizzle-orm 0.45 / drizzle-kit 0.31.11 on SQLite (`node:sqlite`), Hono,
Lit, `@waitron/ui` primitives (`wt-modal`, `wt-switch`, `wt-form-actions`), Vitest (`useVenueDb`
real-database suites; browser mode in Chromium for `apps/till` and `apps/dashboard`). No new
dependency or workspace package.

**Spec:** [catalogue, menus and routing design](../specs/2026-09-30-catalogue-menus-routing-design.md)
§4.2 ("one folder" bullet) and §7 decision 3, both amended 2026-10-07 in the commit that adds this
plan. The binding requirements are the queue entry A322 in `~/waitron-campaign-b/queue.md:211-221`,
quoted in the ledger `docs/handoffs/2026-10-07-a322-included-menu-direct-sections.md`.

**Risk triggers present** (review weight): a catalogue migration and a media migration whose
triggers sit on and read a catalogue table; a cross-package contract (the published menu document,
read by the till, the dashboard and, through `@waitron/module`'s `ZoneMenuMember`, any module;
media's `ImageUsage`; the translation-gap report's kinds). FULL `/finish-branch` path. Own PR.

---

## Survey of the current code (what the tasks change)

### Storage

- `section_members` (`packages/catalogue/src/schema/sections.ts:53-89`): `id`, `section_id`,
  `position`, `product_id`, `child_section_id`, `missing_name`; one CHECK
  (`section_members_one_ref_ck`, `:79-82`). An include is a row whose `child_section_id` is a
  section of role `menu_root` (`sections.role`, `:19-27, :36`); a menu's root is created by
  `createMenuShell` with the menu's name as `internal_name` (`packages/catalogue/src/menu-structure.ts:29-47`).
- A section's presentation is three columns on `sections`: `names` (`json<Record<string,string>>`,
  default `{}`), `image` and `color` (`label`, nullable) (`schema/sections.ts:35-39`). The root's
  are written by `updateMenuDetails` (`packages/catalogue/src/operations.ts:804-828`) through
  `sectionPatchValues` (`packages/catalogue/src/sections.ts:334-345`); `updateSection` refuses a
  `menu_root` (`sections.ts:184-198`).
- Column builders: `flag`, `json` from `@waitron/db` (`packages/db/src/schema/columns.ts:47, 146`);
  precedent `flag("active").notNull().default(true)` (`packages/catalogue/src/schema/extras.ts:24`).
- The section graph reads members with an explicit column list (`packages/catalogue/src/section-graph.ts:93-109`);
  `MemberRow` (`:15-22`) and `buildSectionGraph` (`:51-91`).
- `replaceMember` swaps a member's ref IN PLACE (`sections.ts:310-324`, the update at `:320`), so a
  column on the row survives a swap from one included menu to another.

### Validation and refusal codes a section's presentation uses today

- `namesOf` (`sections.ts:53-70`): `{}` accepted; a non-empty map needs text in the venue's default
  content language → `menu_section.translation_required { field: "names", language }`; a non-object
  → `menu_section.invalid { field: "names" }`. The rule itself is `contentTranslationGap`
  (`packages/catalogue/src/content-languages.ts:34-48`).
- `colorOf` (`sections.ts:82-86`) → `menu_section.invalid { field: "color" }`; `imageOf`
  (`:88-93`) → `menu_section.invalid { field: "image" }` when the photo is not in the media library.
- Other codes in the family (`packages/catalogue/src/errors.ts:138-150`): `menu_section.not_found
  { sectionId, memberId? }`, `menu_section.wrong_role { sectionId, role }`,
  `menu_section.membership_invalid {}`. `heldMember` throws the first
  (`packages/catalogue/src/section-members.ts:53-60`).
- Route-level shape refusals are `management.request_invalid { field }`
  (`apps/server/src/catalogue-api.ts:160-195`, `sectionInput` and `memberRef`). Every catalogue
  route is gated by `CATALOGUE_WRITE_PERMISSION` (`catalogue-api.ts:130-133`, the gate at `:709-751`).
- The dashboard places a refusal beside a field with `fieldOf`
  (`apps/dashboard/src/widgets/section-writes.ts:5-10`): `menu_section.translation_required` →
  `names-<language>`, otherwise `params.field`.

### The menu document and every reader of its structure

- `buildMenuDocuments` (`packages/catalogue/src/menu-document.ts:90-247`). `listOf` (`:178-206`)
  walks `loaded.children(sectionId)`; for a `menu_root` child it drops an inactive included menu
  (`:189`) and otherwise emits a section node with `includedMenu: { id, name }` (`:196-198`) and the
  root's own `names`, `image`, `color` (`:199-202`). Home shortcuts are kept only for sections the
  structure reached (`:207-220`). `includedMenuHashes` holds each direct inclusion's working hash
  (`:230-234`). The hash is SHA-256 of canonical JSON that skips `undefined` keys (`:344-357`), so
  an optional key left out does not change an existing document's hash.
- `DocumentMember` (`packages/catalogue/src/menu-document-types.ts:49-60`); `SectionChangeField`
  (`:264`); `MenuField` (`:139-156`). The till's `ServedMenu.structure` is the document's `root`
  (`menu-document-types.ts:357-369`; built at `packages/venue-service/src/operations.ts:815-822`),
  and `@waitron/module`'s contract mirrors the node as `ZoneMenuMember`
  (`packages/module/src/module.ts:198-210`). Grep on 2026-10-07: `ZoneMenuMember`/`structure.members`
  outside tests is read only by `apps/till/src/widgets/menu-browser.ts`.
- **Change lists:** `shapeOf` (`menu-document.ts:596-628`) records every section node by id with
  its parent paths; `namesOf` (`:647-649`) dereferences `shape.sections.get(id)!` for every id in a
  path; `listSource` (`:651-660`) attributes a change to an included menu by finding a node with
  `includedMenu` on the path. Product events use each offer's `placements` (`:887-983`), which are
  GRAPH paths from the root (`packages/catalogue/src/operations.ts:477-488`, `placementsByProduct`
  in `section-graph.ts:163-177`), so they contain the included menu's root id. `section_changed`
  compares `names`, `image`, `color` (`menu-document.ts:859-883`).
- **Change navigation:** `indexMenuOccurrences` (`packages/catalogue/src/menu-navigation.ts:17-44`)
  walks the tree; `section_changed` targets compare `was[field]` with `node[field]`
  (`menu-navigation.ts:482-505`).
- **`includedMenu` readers** (grep 2026-10-07, non-test): `listSource` only
  (`menu-document.ts:657`); `includedMenuHashes` is written at `:230` and read by no non-test code.
- **Till:** `indexMenu` → `indexDocument` (`apps/till/src/widgets/menu-browser.ts:50-57`;
  `packages/catalogue/src/device-home.ts:91-114`, which keys sections by id with `Map.set`);
  `#trail` (`menu-browser.ts:363-378`) finds the first id anywhere in the index and each next one
  among the previous node's `members`; `#tile` (`:486-503`) opens `[...path, sectionId]`; `#home`
  (`:506-534`) maps `menu.structure.members`; `#sectionView` (`:536-563`) maps `current.members`.
- **Device home preview** (dashboard) mirrors it: `indexDocument` at
  `apps/dashboard/src/widgets/device-home-preview.ts:257`, `#trail` `:269-283`, home members
  `:359-363`, section members `:422`.
- **Menus screen preview:** `renderCustomerMenu` → `members()`
  (`apps/dashboard/src/widgets/customer-menu-renderer.ts:476-520`), which keys every target by the
  path of section ids including an included root; field labels `SECTION_FIELDS`
  (`apps/dashboard/src/widgets/menu-preview.ts:54-58`), `section_changed` text (`:600-605`).
- **Images:** `documentImages` walks section nodes' `image` (`menu-document.ts:360-381`); a
  published or queued version records them in `menu_version_images`
  (`packages/catalogue/src/menu-publication.ts:643`).
- **Unpublished changes:** `statusOf` compares the working hash with the live version's
  (`menu-publication.ts:187-197`).

### Media's image references

- `sections.image` is guarded by four triggers (`packages/media/drizzle/0002_section_image_references.sql`,
  recreated in `0006_recreate_section_image_triggers.sql`); W99 added `0008`. The trigger names are
  pinned by EQUALITY in `scripts/behavioural-triggers.test.ts:96-119` (`IMAGE_REFERENCE_TRIGGERS`).
  `packages/media/src/schema/name-only-upgrade.test.ts:377-413` compares every trigger naming
  `media_images` after applying the whole media folder.
- Usages: `ImageUsage` (`packages/media/src/images.ts:40-80`), `listImageUsagesForFilename`
  (`:141-230`) and `countUsages` (`:577-…`), which must stay in step (`:34-38`); the dashboard copy
  of the type (`packages/media/src/dashboard/client.ts:20-30`), its link and label
  (`packages/media/src/dashboard/image-library.ts:30-37, 349-361`).
- Configuration import order: media's tables go `before: ["products", "sections"]`
  (`packages/media/src/module.ts:15-21`), so a photo exists before a row naming it is inserted.
- Media requires catalogue (`module.ts:30`), so its trigger edges onto catalogue tables are
  declared (`docs/developers/conventions-data.md`, "A migration set depends on another…").

### Translations

- Candidates for the default-language check (`readContentTranslationCandidates`,
  `content-languages.ts:84-115`) include `sections.names` of roles `section` and `menu_root`
  (`:111-112`); `listContentTranslationGaps` (`:68-73`) refuses a default-language change that
  would leave a gap. The report (`packages/catalogue/src/content-translation-report.ts:49-170`) maps
  candidate kinds to `TranslationGapKind` (`content-translation-report-types.ts:6-14`); the
  dashboard links each kind (`apps/dashboard/src/screens/content-languages-screen.ts:50-70`) and
  labels it `content_gaps.kind_<kind>` (`:418-438`).
- Configuration import checks colours (`packages/catalogue/src/configuration-transfer.ts:29-35,
  64-69`); `section_members` is transferred whole (`:117-118`).

### Dashboard

- Structure table: `#rows` (`apps/dashboard/src/widgets/menu-structure-table.ts:640-665`) labels an
  include `menus.menu_prefix` with the included menu's name and makes everything under it
  read-only; the "Read-only here" note (`:735-745`); the swatch shows `node.color` (`:767-773`);
  the include's ⋮ holds the link `menus.edit_included` ("Edit {name}") and Remove
  (`:815-826`); a section's ⋮ sends `wt-member-edit` (`:827-834`).
- `MenuStructureNode` (server `menu-structure.ts:14-24`, built by `nodesOf` `:79-97`; dashboard
  copy `apps/dashboard/src/api/client.ts:181-191`).
- The section dialog `dashboard-section-details-form`
  (`apps/dashboard/src/widgets/section-details-form.ts`) composes `textField`,
  `optionalTextFields` (`apps/dashboard/src/widgets/form-fields.ts:198-218`), `colorField`
  (`color-field.ts`) and `dashboard-image-upload`, registers a draft scope with
  `leaveCoordinatorFor` (`:97-134`), and shows refusals beside fields (`:148-168`). Its unsaved
  test is `section-details-form.unsaved.test.ts`. `wt-switch` emits `wt-change { checked }`
  (`apps/dashboard/src/screens/receipts-screen.ts:898-906`).
- Menus screen: `refusal()` (`apps/dashboard/src/screens/menus-screen.ts:125-127`); `#saveSection`
  (`:1399-1424`); `#includeMenu` (`:1445-1466`); `wt-member-edit` handling (`:2144-2150`);
  `#renderNewSection` (`:2489-2512`).
- Strings: `menus.menu_prefix`, `menus.edit_included`, `menus.read_only_here`
  (`apps/dashboard/src/i18n/strings.ts:2107-2110`, Spanish `:4551-4554`).

---

## Decisions taken in this plan

1. **Where the splice happens: the document carries the setting; drawing a list applies it, through
   one shared function.** The included menu's node stays in the document with `direct: true`, and
   `shownMembers(members)` (new, in the browser-safe `packages/catalogue/src/device-home.ts`) puts
   a direct node's members in its place. The queue suggested splicing inside `listOf`. Taking the
   node OUT of the tree breaks four things that read the tree by section id: `namesOf` dereferences
   every id of an offer's graph `placements` (`menu-document.ts:647-649`; placements come from the
   graph, `operations.ts:477-488`, and contain the root id), `listSource` loses the node that
   attributes a change to the included menu (`:651-660`), change navigation keys targets by the
   tree's paths (`menu-navigation.ts:17-44`), and a home shortcut to the included menu needs its
   node (`menu-document.ts:207-220`, `menu-browser.ts:494`). It would also report a toggle as a
   `product_moved` for every product inside. Keeping the node, every one of those keeps working
   unchanged and a toggle is one `section_changed` with field `direct`. "Every reader sees the
   same thing" is kept by the setting living in the document (so W99's frozen editions capture
   it, and its hash) and by every reader that draws a list calling the same function: the till's
   browser, the dashboard's device-home preview and its menu preview. `@waitron/module`'s
   `ZoneMenuMember` gains the optional field with a comment saying a reader draws a direct node's
   members in its place; its only reader is the till (grep above).
2. **Storage: two columns on `section_members`, added with no CHECK.** `show_as_folder`
   (`flag`, not null, default true) and `folder_overrides` (`json<IncludeFolderOverrides>`, not
   null, default `{}`). In `folder_overrides` a key that is PRESENT is fixed on this include; an
   absent key follows the included menu. JSON rather than one column per field because a fixed
   "no image" or "no colour" must differ from "follow" (null cannot say both) and names are fixed
   per language. No CHECK: on drizzle-kit 0.31.11 a CHECK turns the generation into a table
   rebuild (`docs/developers/conventions-data.md`, "A generated table rebuild can copy a new
   column…"), and after Task 2 media's triggers read this table, which a later rebuild would trip
   over ("A migration set depends on another…"). The writer and the import check hold the shape.
   The owner's "on the include row" is kept; there is no sibling table.
3. **Follow or fixed is decided in the dashboard, against the included menu's values as the dialog
   loaded them; the server stores the overrides it is sent.** A field whose value equals the
   included menu's is sent as "follow" (absent); a different one is sent fixed. For names this is
   per language. Deciding on the server instead would fix a field the manager never touched
   whenever the included menu was renamed while the dialog was open. Languages the dialog does not
   show (a language since switched off) keep whatever was stored.
4. **A blank fixed name is allowed, and blanks are dropped from the effective names.** Blanking a
   language the included menu has text in fixes "no name in this language". The effective names
   are `{ ...own, ...fixed }` with blank values removed, and they are checked by the section rule:
   `{}` is accepted; otherwise the default language needs text, else
   `menu_section.translation_required { field: "names", language }`.
5. **The folder fields apply only while the include is shown as a folder.** Switched off, the node
   carries the included menu's own names, image and colour plus `direct: true`; the stored
   overrides are kept, so switching back restores them (owner, ~10:50). A save with the switch off
   sends no `overrides`, and the server leaves the stored ones untouched.
6. **A home shortcut to an included menu shown directly opens it as a folder** (point 3, "leads to
   its sections"). Its node is in the document and in `indexDocument`'s index, so the till's
   `#trail([root])` finds it and the section view lists its members. The tile and breadcrumb show
   the included menu's own presentation (Decision 5).
7. **Unpublished changes follow from the hash.** The setting and the effective presentation are in
   the INCLUDING menu's document, so a save changes its hash and `statusOf` reports `changed`; the
   included menu's own document and `includedMenuHashes` do not change. `diffEntries` reports a
   toggle as `section_changed` with the new field `direct` (with `names`/`image`/`color` when they
   differ too).
8. **`MENU_DOCUMENT_FORMAT` stays 3.** `direct` is optional and present only when true; the hash
   skips absent keys (`menu-document.ts:344-357`), so every document without a direct include
   hashes exactly as before — a test pins it (Task 4). A live document published before this
   change has no `direct` and is drawn with folders, which is what it published.
9. **Route:** `PUT /management-api/sections/:id/members/:memberId/folder`, gated like its siblings.
   Body `{ showAsFolder: boolean, overrides?: { names?, image?, color? } }`; `overrides`, when
   sent, REPLACES the stored overrides. Shape refusals are `management.request_invalid { field }`;
   domain refusals reuse existing codes: `menu_section.not_found` (list or member),
   `menu_section.wrong_role` (a Device Home Page list, or a member holding an owned section),
   `menu_section.membership_invalid` (a member holding a product), `menu_section.invalid { field:
   "names" | "image" | "color" }`, `menu_section.translation_required { field: "names", language }`.
   No new error code, so no registry entry; `scripts/errors-reachable.test.ts` and
   `scripts/alert-codes.test.ts` are run anyway (Task 7). Answer: 200 with the stored
   `IncludeFolder`.
10. **Image references: a media migration, so "one migration" becomes two.** The owner said one
    migration; a folder photo must be held like a section's photo, and those guards are media's
    triggers, created by media's migration set because the catalogue set cannot name media's
    table (media requires catalogue, not the reverse). Four triggers named
    `section_members_media_image_fk_*` read `json_extract(folder_overrides, '$.image')`; a usage
    kind `menu_include` lists and counts it; configuration import puts media before
    `section_members`.
11. **Folder names join the translation checks.** A candidate of kind `menu_include` (the
    effective names, `json_patch` of the root's names and the fixed ones) feeds the default-language
    refusal, and the report lists it under a new gap kind `included_menu`, named after the included
    menu, parented by the including menu, linked to that menu's structure. Stored names count
    whether or not the include is shown as a folder (they are restored by switching back).
12. **`replaceMember` resets both columns** to a folder that follows: a swapped-in menu must not
    wear the previous one's folder name.
13. **Dashboard:** the include's ⋮ gains **Edit** (`action.edit`), opening a new
    `dashboard-include-folder-form`; the link becomes **"Open {name}"** under a renamed key
    `menus.open_included`; the row adds a note `menus.include_as_folder` ("Shown as a folder") or
    `menus.include_direct` ("Sections shown directly"); its swatch shows the effective colour. The
    "Menu: <name>" label keeps the included menu's own name.
14. **The Menus screen preview draws a direct include as one muted line,
    "{name}: shown directly", followed by its members at the same level.** The line is the
    include's summary and `direct` change target, so a toggle is navigable; the members keep their
    paths through the included root, which `indexMenuOccurrences` gives them.
15. **The graph carries the setting** (`graph.folder(memberId)`), read in `loadSectionGraph`'s
    existing member statement: no extra statement for `buildMenuDocuments`, `readMenuStructure` or
    any statement-count pin.
16. **One included menu in two lists of one menu, with different settings:** each node carries its
    own setting and presentation and draws correctly in its list. The index keys sections by id
    (`device-home.ts:105-107`), so a home shortcut to that menu opens the node indexed last. Accepted
    and pinned by a test (Task 5), not engineered around.
17. **Configuration import refuses a malformed `folder_overrides` or a bad override colour**
    (`setup.request_invalid { field: "section_members.folder_overrides" }`), as it refuses a bad
    section colour.

## Where the code contradicts the queue text

- "Store the overrides … (one migration)": image references need a second, media, migration
  (Decision 10).
- "Decide WHERE the splice happens … in the published menu document (`listOf`)": the setting is in
  the document, but the splice is applied where a list is drawn (Decision 1, with the four
  `file:line` reasons).
- "grep every reader of `includedMenu` / `includedMenuHashes`": the only non-test reader of either
  is `listSource` (`menu-document.ts:657`); the till and the previews never read `includedMenu`.
- "`indexDocument` … sees the same thing": `indexDocument` needs no change; it must keep indexing
  the direct node for shortcuts (Decision 6).
- "update `docs/backlog.md`": A322 has no entry there today (grep `A322`, `included menu` on
  2026-10-07); Task 12 adds one.

---

## Schema (Task 1)

```ts
// packages/catalogue/src/schema/sections.ts — added to sectionMembers' columns
showAsFolder: flag("show_as_folder").notNull().default(true),
folderOverrides: json<IncludeFolderOverrides>("folder_overrides").notNull().default({}),
```

Generated with `pnpm --filter @waitron/catalogue db:generate --name=include_folder` (drizzle-kit
picks the number). The generated SQL must be two `ALTER TABLE \`section_members\` ADD …` statements
and nothing else; if it is a table rebuild, stop and report.

## Seams and signatures

```ts
// packages/catalogue/src/section-types.ts (browser-safe leaf: types only)
/** What one include fixes for its folder. A key that is absent follows the included menu. */
export interface IncludeFolderOverrides {
  /** Only the languages fixed here; a blank value fixes "no name in this language". */
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
}
/** How one include shows the menu it includes. */
export interface IncludeFolder {
  showAsFolder: boolean;
  overrides: IncludeFolderOverrides;
}
/** A section's customer-facing presentation. */
export interface Presentation {
  names: Record<string, string>;
  image: string | null;
  color: string | null;
}

// packages/catalogue/src/section-graph.ts
export interface MemberRow { /* existing fields */ showAsFolder?: boolean; folderOverrides?: IncludeFolderOverrides; }
export interface SectionGraph { /* existing */ folder(memberId: string): IncludeFolder; }
// folder() answers { showAsFolder: true, overrides: {} } for a member with no stored setting.

// packages/catalogue/src/include-folder-presentation.ts (NEW, browser-safe: no runtime imports
// beyond other browser-safe catalogue leaves)
export const FOLLOWING_FOLDER: IncludeFolder; // { showAsFolder: true, overrides: {} }
export function folderPresentation(own: Presentation, folder: IncludeFolder): Presentation;
export function folderOverridesFrom(
  own: Presentation,
  shown: Presentation,
  languages: readonly string[],
  stored: IncludeFolderOverrides,
): IncludeFolderOverrides;

// packages/catalogue/src/include-folder.ts (NEW, server)
export interface IncludeFolderInput { showAsFolder: boolean; overrides?: IncludeFolderOverrides }
export async function setIncludeFolder(
  tx: Transaction,
  listId: string,
  memberId: string,
  input: IncludeFolderInput,
  fallbackLanguage?: string,
): Promise<IncludeFolder>;
export function checkIncludeFolderRows(rows: Rows | undefined): void; // configuration import

// packages/catalogue/src/menu-document-types.ts
// DocumentMember section kind gains:  direct?: true;
// SectionChangeField = "names" | "image" | "color" | "direct";
// MenuField's single-kind union gains "direct".

// packages/catalogue/src/device-home.ts
export function shownMembers(members: readonly DocumentMember[]): DocumentMember[];

// packages/catalogue/src/menu-structure.ts — MenuStructureNode gains
folder?: IncludeFolder; // present exactly when includedMenuId is

// apps/dashboard/src/api/client.ts
setIncludeFolder(listId: string, memberId: string, input: IncludeFolderInput): Promise<IncludeFolder>;
```

`folderPresentation(own, folder)`: when `!folder.showAsFolder` it returns `own` unchanged.
Otherwise `names` is `own.names` when `overrides.names` is absent, else `{ ...own.names,
...overrides.names }` with every entry whose trimmed value is `""` removed; `image` and `color` are
the override when the key is present (`!== undefined`), else `own`'s.

`folderOverridesFrom(own, shown, languages, stored)`: names — start from the entries of
`stored.names` whose language is NOT in `languages`; for each language in `languages`, if
`(shown.names[l] ?? "").trim() !== (own.names[l] ?? "").trim()` fix it to the trimmed shown value;
leave `names` out when nothing is fixed. `image` / `color` — present (set to `shown`'s) exactly when
`shown.image !== own.image` / `shown.color !== own.color`.

## Global constraints

- One PR. No backwards-compatibility or data-migration code (CLAUDE.md §3, "No
  backwards-compatibility…"); the new columns' defaults are today's behaviour, so no venue reset.
- Never hand-edit a drizzle snapshot or `_journal.json`; regenerate on a number clash
  (CLAUDE.md §3). A hand-written migration's last statement takes no trailing
  `--> statement-breakpoint`.
- `MENU_DOCUMENT_FORMAT` stays 3; `direct` appears only when true.
- No new error code. Error refusals beside fields per `design-system.md` → Forms.
- Every colour, spacing and font reads a `--wt-*` token. A screen draws no native form field; the
  dialog uses `wt-switch`, `textField`/`optionalTextFields`, `colorField`, `dashboard-image-upload`.
  Every input has a semantic `name`.
- Spanish UI copy: "carta" for menu, as the screen's other strings.
- English-only identifiers (no Spanish in code outside translations).
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1).
- Coverage bar 98/98/98/95 per package. Focused tests while implementing; the pre-push hook once;
  CI owns package suites.
- Commit with `git commit -s`, explicit paths staged.

## Review focus

1. **One included menu in two lists of the same menu, one as a folder and one directly:** each list
   draws its own way, and a home shortcut to that menu still opens something with its members
   (Task 4 document case, Task 5 till case).
2. **An include swapped for another menu with `replaceMember`:** the new one starts as a folder that
   follows; it does not wear the old folder name (Task 1).
3. **The included menu renamed while the Edit dialog is open, the manager changing only the
   colour:** the names still follow after the save (Task 10 helper case; Task 11 screen case).
4. **The venue's default content language changed after a folder name was fixed in one language
   only:** the change is refused if the folder's effective names would lack the new default, and
   the report lists the folder (Task 8).
5. **A photo used only as a folder override, deleted from the library:** refused while the include
   names it, and the library lists the use with a link to the including menu (Task 2).

---

### Task 1: Store the setting on the include and carry it in the section graph

**Files:**
- Modify: `packages/catalogue/src/schema/sections.ts:53-62` (two columns), `packages/catalogue/src/section-types.ts`
  (the three types above), `packages/catalogue/src/section-graph.ts:15-22, 24-36, 51-109`,
  `packages/catalogue/src/sections.ts:310-324` (`replaceMember`).
- Create (generated): `packages/catalogue/drizzle/00NN_include_folder.sql` and its snapshot/journal
  entries.
- Test: `packages/catalogue/src/sections.db.test.ts`, `packages/catalogue/src/section-graph.test.ts`.

**Interfaces:** Produces `IncludeFolderOverrides`, `IncludeFolder`, `Presentation` (section-types),
`MemberRow.showAsFolder?/folderOverrides?`, `SectionGraph.folder(memberId)`.

- [ ] **Step 1: failing tests.**
  - `section-graph.test.ts`, new cases in a `describe("folder")`:
    `it("answers a following folder for a member with no stored setting")` — `buildSectionGraph`
    with a `MemberRow` lacking both fields; `graph.folder(id)` equals
    `{ showAsFolder: true, overrides: {} }`.
    `it("answers the stored setting for an include")` — a row with `showAsFolder: false,
    folderOverrides: { color: "#112233" }` answers exactly that.
  - `sections.db.test.ts`, `describe("an include's folder setting")`:
    `it("loads show_as_folder and folder_overrides through loadSectionGraph")` — include menu B in
    menu A's root (`addMember`), then `fx.db.update(sectionMembers).set({ showAsFolder: false,
    folderOverrides: { names: { en: "Bar" } } })` on that member; `(await
    app(loadSectionGraph)).folder(memberId)` equals it.
    `it("a replaced include starts as a folder that follows")` — store a setting as above, then
    `replaceMember(tx, rootA, memberId, section(rootC))`; the row's `show_as_folder` is true and
    `folder_overrides` is `{}`.
- [ ] **Step 2:** `pnpm --filter @waitron/catalogue exec vitest run src/section-graph.test.ts
  src/sections.db.test.ts` — FAIL (no `folder`, no columns).
- [ ] **Step 3:** add the columns (schema block above; import `flag` from `@waitron/db` and the
  type from `../section-types.js`), then `pnpm --filter @waitron/catalogue db:generate
  --name=include_folder`. Read the SQL: exactly two `ALTER TABLE … ADD` lines (stop if a rebuild).
- [ ] **Step 4:** `section-graph.ts`: extend `MemberRow`; `loadSectionGraph` selects
  `showAsFolder` and `folderOverrides` in its existing member statement (`:95-104`);
  `buildSectionGraph` keeps a `Map<memberId, IncludeFolder>` of rows whose `showAsFolder === false`
  or whose overrides have a key, and `folder(id)` answers it or a fresh `{ showAsFolder: true,
  overrides: {} }`.
- [ ] **Step 5:** `replaceMember` sets `{ ...refColumns(ref), showAsFolder: true, folderOverrides:
  {} }` in its update (`sections.ts:320`).
- [ ] **Step 6:** the tests of Step 2 pass.
- [ ] **Step 7: guards** (from the worktree root): `pnpm exec vitest run
  scripts/schema-constraints.test.ts scripts/append-only-triggers.test.ts
  scripts/behavioural-triggers.test.ts scripts/classification-complete.test.ts
  scripts/two-file-foreign-keys.test.ts scripts/migrations-match-schema.test.ts
  scripts/module-graph-honesty.test.ts scripts/journal-monotonic.test.ts
  scripts/column-vocabulary.test.ts scripts/migration-upgrade.test.ts`;
  `pnpm --filter @waitron/fiscal-verifactu exec vitest run inmutabilidad`;
  `pnpm --filter @waitron/catalogue exec vitest run src/schema/schema-conformance.test.ts
  src/migrations.test.ts`; `pnpm --filter @waitron/catalogue typecheck`; `pnpm lint`;
  `pnpm format:check`. Read each `Tests` count.
- [ ] **Step 8: commit** — `git add` the schema, types, graph, sections, tests and the generated
  migration files; `git commit -s -m "An include remembers whether it shows its menu as a folder,
  and the folder's own names, image and colour"`.

### Task 2: A folder photo is held like a section's photo

**Files:**
- Create: `packages/media/drizzle/00NN_include_folder_image_references.sql` via
  `pnpm --filter @waitron/media db:generate:custom --name=include_folder_image_references`.
- Modify: `packages/media/src/images.ts` (`ImageUsage`, `listImageUsagesForFilename`,
  `countUsages`, the comment at `:34-38`), `packages/media/src/module.ts:15-21`,
  `packages/media/src/dashboard/client.ts`, `packages/media/src/dashboard/image-library.ts:30-37,
  349-361`, `packages/media/src/dashboard/strings.ts` (EN and ES),
  `packages/media/src/dashboard/live-queries.ts:1-11` (add `section_members` to the `images`
  query, which lists `sections`), `scripts/behavioural-triggers.test.ts:107-119`.
- Test: `packages/media/src/image-references.test.ts`, `packages/media/src/images.test.ts`,
  `packages/media/src/dashboard/image-library.test.ts`,
  `packages/media/src/schema/name-only-upgrade.test.ts:377-413`.

**Interfaces:** Consumes the `folder_overrides` column (Task 1). Produces the usage
`{ kind: "menu_include"; id: string /* member id */; menuId: string /* menu owning the list */;
menuName: string; includedMenuName: string }`.

- [ ] **Step 1: failing tests.**
  - `image-references.test.ts`, `describe("an image an include's folder names")`, with the file's
    fixture (`PRESENT`, `ABSENT`) plus a second catalogue whose root is included in the first's
    root:
    1. `it("refuses a folder image that is not in the library")` — updating the member's
       `folder_overrides` to `{ image: ABSENT }` is refused `section_members_media_image_fk`; the
       control `{ image: PRESENT }` is accepted; so is `{ image: null }` (a fixed "no image").
    2. `it("refuses deleting or renaming a photo a folder names, and allows it once the folder
       stops naming it")` — with `{ image: PRESENT }` stored and no other use, deleting and
       renaming `PRESENT` are refused with that message; after setting `folder_overrides` to `{}`
       both succeed.
    3. `it("a folder switched off still holds its stored photo")` — `show_as_folder = false` with
       `{ image: PRESENT }`: the delete is still refused.
  - `images.test.ts`: `listImageUsages` lists `{ kind: "menu_include", id: memberId, menuId:
    lunchId, menuName: "Lunch Menu", includedMenuName: "Drinks" }`, `listImages` counts it (the two
    stay in step), and `deleteImage` answers `{ deleted: false, uses: [that usage] }`.
  - `image-library.test.ts`: the usage reads "Drinks folder in Lunch Menu" in English and
    "Carpeta Drinks en Lunch Menu" in Spanish, linked to
    `/manage/menus/menu/<lunchId>/view/structure`.
  - Run `pnpm --filter @waitron/media exec vitest run src/image-references.test.ts
    src/images.test.ts src/dashboard/image-library.test.ts` — FAIL.
- [ ] **Step 2: the migration.** A one-line header (what it guards, as `0002`'s does), then four
  triggers shaped like `0002_section_image_references.sql`, with
  `json_extract(new.folder_overrides, '$.image')` in place of `new.image`:
  `section_members_media_image_fk_insert` (BEFORE INSERT ON section_members),
  `section_members_media_image_fk_update` (BEFORE UPDATE OF folder_overrides ON section_members),
  `section_members_media_image_fk_parent_delete` and `…_parent_rename` (on `media_images`, bodies
  `exists (SELECT 1 FROM section_members WHERE json_extract(folder_overrides, '$.image') =
  old.filename)`), all raising `'section_members_media_image_fk'`. `json_extract` of a JSON `null`
  is SQL `NULL`, so a fixed "no image" passes the insert/update triggers — case 1 proves it. No
  trailing `--> statement-breakpoint`.
- [ ] **Step 3:** `images.ts`: the usage kind, a `sectionMembers` read joined to the list's
  `sections` row (`owner_menu_id`), that menu's `catalogues.name`, and the included root's
  `sections.internal_name`, with `sql\`json_extract(${sectionMembers.folderOverrides}, '$.image') =
  ${filename}\``; the same predicate counted in `countUsages`. Dashboard copy of the type,
  `usageHref` → structure of `menuId`, label `image.included_menu_folder`:
  `"{included} folder in {menu}"` / `"Carpeta {included} en {menu}"`.
- [ ] **Step 4:** `module.ts`: both media tables `before: ["products", "sections",
  "section_members"]`.
- [ ] **Step 5:** `scripts/behavioural-triggers.test.ts`: add the four names to
  `IMAGE_REFERENCE_TRIGGERS` and one clause to its comment naming the new file. This is an
  ADDITION to a list the guard holds by equality, not a changed check; list it under "Changed test
  checks" anyway.
- [ ] **Step 6:** `name-only-upgrade.test.ts`'s "then upgrading to the end of media's folder"
  (`:377-413`): `latest` now also holds the four new triggers. Add `const ADDED = [the four
  names]`; compare `untouched(latest).filter((t) => !ADDED.includes(t.name))` with
  `untouched(after.triggers)` (the nine stay word for word, as strict as before), and add
  `it("adds the four include-folder image triggers")` requiring each name in `latest` with
  `json_extract` and `folder_overrides` in its SQL. Commit this setup change on its own first
  (message names the file, `:399-404`, and why).
- [ ] **Step 7:** tests of Step 1 pass; then `pnpm --filter @waitron/media exec vitest run
  src/schema/name-only-upgrade.test.ts src/configuration-transfer.test.ts src/module.test.ts`;
  root guards of Task 1 Step 7; `pnpm --filter @waitron/composition exec vitest run`;
  `pnpm --filter @waitron/media typecheck`; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 8: commit** (explicit paths): "Keep a photo while an include's folder names it, and
  list that use in the photo library".

### Task 3: Write an include's setting, and read it with the menu's structure

**Files:**
- Create: `packages/catalogue/src/include-folder-presentation.ts`,
  `packages/catalogue/src/include-folder-presentation.test.ts`,
  `packages/catalogue/src/include-folder.ts`, `packages/catalogue/src/include-folder.db.test.ts`.
- Modify: `packages/catalogue/src/sections.ts` (export `colorOf` and `imageOf` as
  `sectionColorOf`/`sectionImageOf`, unchanged bodies), `packages/catalogue/src/menu-structure.ts:14-24,
  79-97`, `packages/catalogue/src/configuration-transfer.ts:64-69`,
  `packages/catalogue/src/index.ts` (export `setIncludeFolder`, `IncludeFolderInput`, the types),
  `packages/catalogue/src/configuration-transfer.test.ts`.

**Interfaces:** Consumes `graph.folder` (Task 1). Produces `FOLLOWING_FOLDER`,
`folderPresentation`, `folderOverridesFrom`, `setIncludeFolder`, `checkIncludeFolderRows`,
`MenuStructureNode.folder`.

- [ ] **Step 1: failing pure tests** (`include-folder-presentation.test.ts`):
  - `it("a folder that follows shows the included menu's own presentation")`.
  - `it("switched off, the own presentation shows whatever is stored")` — overrides
    `{ names: { en: "Bar" }, color: "#112233" }`, `showAsFolder: false` → `own`.
  - `it("a fixed language replaces only that language, and a blank one is dropped")` — own
    `{ en: "Drinks", es: "Bebidas" }`, fixed `{ es: "Barra", en: "" }` → `{ es: "Barra" }`.
  - `it("a fixed null image or colour hides the included menu's")`.
  - `folderOverridesFrom`: `it("fixes only the fields that differ from the included menu")`;
    `it("a language set back to the included menu's text follows again")`;
    `it("keeps a stored fixed language the dialog does not show")`;
    `it("an untouched field follows even when the stored value differed")` — stored
    `{ names: { en: "Old" } }`, own `{ en: "Drinks" }`, shown `{ en: "Drinks" }` → no `names`.
- [ ] **Step 2: failing database tests** (`include-folder.db.test.ts`, `useCatalogueDb` and
  `menusFixture`, whose Lunch root includes Drinks, `packages/catalogue/test/menus-fixture.ts:99-113`):
  - `it("stores the switch and the overrides, and readMenuStructure answers them on the include")`
    — `setIncludeFolder(tx, f.lunchRoot, member, { showAsFolder: false, overrides: { names: { en:
    "Bar" } } })`; `readMenuStructure(tx, f.lunch)`'s Drinks node has `folder` equal to that, and
    keeps `names`/`image`/`color` = the Drinks root's own; Soup's node has no `folder`.
  - `it("leaves the stored overrides alone when none are sent")`.
  - `it("refuses a member that is not an include")` — a product member →
    `menu_section.membership_invalid`; an owned section member → `menu_section.wrong_role`
    `{ sectionId, role: "section" }`; an unknown member → `menu_section.not_found`; a Device Home
    Page list → `menu_section.wrong_role`. Each asserts the CODE (CLAUDE.md §4).
  - `it("refuses effective names without the default language beside the names field")` — Drinks'
    own names `{ en: "Something to drink" }`, venue default `en`, fixed `{ en: "" , es: "Bebidas" }`
    → `menu_section.translation_required { field: "names", language: "en" }`; the control fixed
    `{ es: "Bebidas" }` is accepted.
  - `it("refuses a bad colour, a photo not in the library, and names that are not text")` —
    `menu_section.invalid` with `field` `color`, `image`, `names`; `showAsFolder: "no"` →
    `menu_section.invalid { field: "showAsFolder" }`.
  - `it("does not change the included menu, or which menus reach the include")` — Drinks' own
    `readMenuStructure` and `menu_items` rows are unchanged.
  - `configuration-transfer.test.ts`: `it("refuses imported folder overrides that are not an object
    or carry a bad colour")` → `setup.request_invalid { field:
    "section_members.folder_overrides" }`; a well-formed row is accepted.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/include-folder-presentation.test.ts
    src/include-folder.db.test.ts src/configuration-transfer.test.ts` — FAIL.
- [ ] **Step 3:** `include-folder-presentation.ts` per "Seams and signatures" (type-only imports).
- [ ] **Step 4:** `include-folder.ts` `setIncludeFolder`: `loadSectionGraph`; list role undefined →
  `menu_section.not_found { sectionId: listId }`, `home_layout` → `menu_section.wrong_role`;
  `heldMember(graph.children(listId), listId, memberId)`; product ref →
  `menu_section.membership_invalid`; child role not `menu_root` → `menu_section.wrong_role
  { sectionId: child, role }`; `typeof showAsFolder !== "boolean"` → `menu_section.invalid
  { field: "showAsFolder" }`. When `overrides` is sent: names must be a plain object of strings
  (else `invalid names`; each key through `contentLanguageCode`), values trimmed, an empty map
  dropped; `image` through `sectionImageOf`, `color` through `sectionColorOf`; then
  `folderPresentation(own, { showAsFolder: true, overrides })`'s names, when non-empty, through
  `findContentTranslationGap` → `translation_required { field: "names", language }`. Update the
  row; answer the stored `IncludeFolder`. No `onStructureChanged` (reach is unchanged).
- [ ] **Step 5:** `nodesOf` adds `folder: graph.folder(memberId)` on a `menu_root` child.
- [ ] **Step 6:** `checkIncludeFolderRows(tables.section_members)` in
  `validateCatalogueConfiguration`: `folder_overrides`, when present, parses (string or object) to a
  plain object whose `names` (if any) is an object of strings and whose `color` (if any) passes
  `colorOrNull`; else `setup.request_invalid { field: "section_members.folder_overrides" }`.
- [ ] **Step 7:** Step 1-2 tests pass; `pnpm --filter @waitron/catalogue exec vitest run
  src/sections.db.test.ts src/menu-structure.test.ts src/sections.test.ts`;
  `pnpm --filter @waitron/catalogue typecheck`; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 8: commit** — "Set how an include shows its menu, checked like a section's names,
  photo and colour".

### Task 4: The menu document carries the setting and the folder's presentation

**Files:**
- Modify: `packages/catalogue/src/menu-document-types.ts:49-60, 139-156, 264`,
  `packages/catalogue/src/menu-document.ts:178-206, 859-883`,
  `packages/catalogue/src/menu-navigation.ts:482-505` (only if `field === "direct"` needs a case;
  the generic `same(was[field], node[field])` branch already covers it — verify),
  `packages/module/src/module.ts:198-210`.
- Test: `packages/catalogue/src/menu-document.test.ts`, `packages/catalogue/src/menu-publication.test.ts`,
  `packages/catalogue/src/menu-navigation.test.ts`.

**Interfaces:** Consumes `graph.folder`, `folderPresentation`, `setIncludeFolder`. Produces
`DocumentMember.direct?: true`, `SectionChangeField` `"direct"`.

- [ ] **Step 1: failing database tests** (`menu-document.test.ts`, new `describe("an include shown
  as a folder or directly")`, `menusFixture`; set the switch with `setIncludeFolder`):
  1. `it("a folder include is unchanged, and so is the hash of a menu with no direct include")` —
     record `menuDocumentHash(await build(f.lunch))` before any setting; after
     `setIncludeFolder(…, { showAsFolder: true })` the document and hash are identical.
  2. `it("an include shown directly keeps its node, marked direct, with its members in their
     order")` — Lunch root is `[Drinks node with direct: true, includedMenu, Drinks' own names,
     members [Lemonade, Beer]], Soup]`; `shownMembers(document.root.members)` lists Lemonade, Beer,
     Soup in that order.
  3. `it("the same menu is a folder in one including menu and direct in another")` — Dinner's
     Drinks node has no `direct` while Lunch's has.
  4. `it("an include inside the flattened menu keeps its own setting")` — create menu Wine with
     root holding a product; include Wine inside Drinks' root as a FOLDER (setting on Drinks'
     include row); Lunch shows Drinks directly → Lunch's shown top level is Lemonade, Beer, Wine
     (a folder node), Soup; switching Drinks' Wine include to direct makes Lunch's shown top level
     Lemonade, Beer, Wine's product, Soup.
  5. `it("a section named like one of the including menu's shows beside it")` — create a section
     "Beer" in Lunch's root; Lunch shows two Beer nodes with different `sectionId`s.
  6. `it("an inactive included menu still drops out")` — deactivate Drinks; no Drinks node,
     whatever the setting.
  7. `it("the folder shows the fixed names, image and colour, and follows every field left
     alone")` — fix `{ names: { en: "Bar" }, color: "#112233" }`; the node's names are `{ en:
     "Bar" }`, colour `#112233`, image Drinks' own. Then `updateMenuDetails(tx, f.drinksMenu, {
     names: { en: "Drinks and more", es: "Bebidas" }, image: PHOTO })`: Lunch's node shows `{ en:
     "Bar", es: "Bebidas" }` (en fixed, es followed) and `PHOTO` (followed). Both directions of
     the queue's "rename after saving".
  8. `it("switched off, the node shows the included menu's own presentation and keeps the stored
     overrides")` — after 7, `setIncludeFolder(…, { showAsFolder: false })`: the node has
     `direct: true` and Drinks' own names; switching back on restores `{ en: "Bar", … }`.
  9. `it("a home shortcut to an included menu shown directly is kept")` — add a Lunch home tile to
     the Drinks root (`addTile`); with Drinks direct, `document.home.shortcuts` holds `{ kind:
     "section", sectionId: f.drinks }`, not `empty`.
  10. `it("the same included menu in two lists of one menu keeps each list's setting")` — include
      Drinks also inside a Lunch section "Bar" as a folder while the root include is direct; both
      nodes present, only the root one `direct`.
  - `diffMenuDocuments` cases: `it("switching an include to direct is one section change named
    direct")` — live = Lunch published as folder; proposed with direct → exactly one
    `section_changed { sectionId: f.drinks, fields: ["direct"] }` (no `product_moved`); with fixed
    names also present, fields `["names", "direct"]`.
  - `menu-publication.test.ts`: `it("an include's new setting makes the including menu changed and
    leaves the included menu current")` — publish Lunch and Drinks; `setIncludeFolder` on Lunch's
    include; `menuStatus(Lunch).state` is `changed`, `menuStatus(Drinks).state` is `current`.
  - `menu-navigation.test.ts`: `it("a direct change targets the include's direct field before and
    after")`.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/menu-document.test.ts
    src/menu-publication.test.ts src/menu-navigation.test.ts` — FAIL.
- [ ] **Step 2:** types: `direct?: true` with a one-line comment (the members are drawn in its
  place; a shortcut still opens it); `SectionChangeField` and `MenuField` gain `"direct"`.
- [ ] **Step 3:** `listOf`: take `memberId` from `children()`; for an include, `const folder =
  loaded.folder(memberId)`, `const shown = folderPresentation(section, folder)`; emit
  `names/image/color` from `shown` and `...(folder.showAsFolder ? {} : { direct: true as const })`.
  `shownMembers` lives in `device-home.ts` (Task 5 adds its own tests; add the function here so
  case 2 can call it): `members.flatMap((m) => m.kind === "section" && m.direct === true ?
  shownMembers(m.members) : [m])`.
- [ ] **Step 4:** `diffEntries` section loop: `if (was.direct !== node.direct)
  fields.push("direct")`.
- [ ] **Step 5:** `ZoneMenuMember` section kind gains `readonly direct?: true` with the same
  one-line comment.
- [ ] **Step 6:** tests pass; then `pnpm --filter @waitron/catalogue exec vitest run
  src/menu-change-navigation.test.ts src/menu-inclusion.test.ts src/menu-schedule.test.ts
  src/device-home.test.ts src/integration.test.ts`; `pnpm --filter @waitron/venue-service exec
  vitest run src/operations.test.ts`; typecheck catalogue, module, venue-service; `pnpm lint`;
  `pnpm format:check`.
- [ ] **Step 7: commit** — "The published menu carries whether each include is a folder or shown
  directly, and the folder's own name, photo and colour".

### Task 5: The till and the device-home preview draw an included menu shown directly in its place

**Files:**
- Modify: `packages/catalogue/src/device-home.ts` (doc comment of `shownMembers`; tests),
  `apps/till/src/widgets/menu-browser.ts:363-378, 506-510, 556-562`,
  `apps/dashboard/src/widgets/device-home-preview.ts:269-283, 359-363, 422`.
- Test: `packages/catalogue/src/device-home.test.ts`, `apps/till/src/widgets/menu-browser.test.ts`,
  `apps/dashboard/src/widgets/device-home-preview.test.ts`.

**Interfaces:** Consumes `shownMembers`, `DocumentMember.direct`.

- [ ] **Step 1: failing tests.**
  - `device-home.test.ts`: `it("shownMembers puts a direct node's members in its place, one level
    at a time")` — a direct node holding `[a, folderB, directC[c1]]` between `x` and `y` →
    `[x, a, folderB, c1, y]`; `it("indexDocument still indexes a direct node, so a shortcut can
    open it")`.
  - `menu-browser.test.ts`, new `describe("an included menu shown directly")`, with the file's
    `section()` helper plus `{ ...drinks, direct: true }` placed in `lunch()`'s structure instead
    of `drinks`:
    `it("shows its sections and products on the home page, with no extra level")` — home
    `structure` entries read Favourites (EN), Cola, Lemonade, Beer (EN), Food…; no "Drinks (EN)".
    `it("opens one of its sections with a breadcrumb that skips the included menu")` — tap Beer:
    breadcrumb `Home › Beer (EN)`.
    `it("inside a section, a direct include's members stand in its place")` — a direct node nested
    in Food: Food's view lists its members in its place.
    `it("a shortcut to the included menu still opens it as a folder")` — `sectionTile("sec-drinks")`
    → breadcrumb `Home › Drinks (EN)`, its view lists Cola, Lemonade, Beer (EN).
    `it("paints a folder's override colour and photo")` — a folder node whose `color` is a palette
    colour and `image` a file paints as the existing painted-tile cases do (`mountPainted`,
    `:1468`) — the document already carries the effective values, so this pins that the till
    reads the node's own fields.
    `it("the same menu as a folder in one list and direct in another")` — both draw correctly.
  - `device-home-preview.test.ts`: the home block shows the direct node's members; a section of it
    opens with breadcrumb skipping it; a shortcut opens it.
  - Run `pnpm --filter @waitron/catalogue exec vitest run src/device-home.test.ts`,
    `pnpm --filter @waitron/till exec vitest run src/widgets/menu-browser.test.ts`,
    `pnpm --filter @waitron/dashboard exec vitest run src/widgets/device-home-preview.test.ts` —
    FAIL where the widgets still draw the node (check free memory first:
    `memory_pressure | grep free`).
- [ ] **Step 2:** in both widgets: the home block maps `shownMembers(structure.members)`; the
  section view maps `shownMembers(current.members)`; `#trail`'s "next among the previous node's
  members" searches `shownMembers(previous.members)` as well as `previous.members` (the latter keeps
  a shortcut path `[root, section]` working).
- [ ] **Step 3:** tests pass; `pnpm --filter @waitron/till exec vitest run
  src/widgets/menu-browser.a11y.test.ts`; `pnpm --filter @waitron/dashboard exec vitest run
  src/widgets/device-home-preview.a11y.test.ts`; typecheck till and dashboard; `pnpm lint`;
  `pnpm format:check`.
- [ ] **Step 4: commit** — "The till and the device-home preview show an included menu's sections
  in its place when it is shown directly".

### Task 6: The Menus screen preview draws it, and names the change

**Files:**
- Modify: `apps/dashboard/src/widgets/customer-menu-renderer.ts:476-520`,
  `apps/dashboard/src/widgets/menu-preview.ts:54-58`, `apps/dashboard/src/i18n/strings.ts`
  (`menu_preview.field_direct`, `menu_preview.shown_directly`, EN and ES).
- Test: `apps/dashboard/src/widgets/customer-menu.test.ts`,
  `apps/dashboard/src/widgets/menu-preview.test.ts`,
  `apps/dashboard/src/widgets/menu-preview-navigation.test.ts`.

- [ ] **Step 1: failing tests.**
  - `customer-menu.test.ts`: `it("draws an included menu shown directly as one line and its
    members at the same level")` — a document whose root holds a direct node: no section button
    for it; a note `"Drinks: shown directly"` / Spanish `"Drinks: se muestra directamente"`; its
    sections are buttons at the top level, and their `data-section` paths include the included
    root's id. `it("the note is the include's change target")` — highlighted `{ kind: "section",
    sectionIds: [root], field: { kind: "direct" } }` marks the note.
  - `menu-preview.test.ts`: a `section_changed` with fields `["direct"]` reads
    `"Drinks: shown as a folder or directly"` / Spanish `"Drinks: mostrada como carpeta o
    directamente"`.
  - `menu-preview-navigation.test.ts`: following that change focuses the note.
  - Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/customer-menu.test.ts
    src/widgets/menu-preview.test.ts src/widgets/menu-preview-navigation.test.ts` — FAIL.
- [ ] **Step 2:** `members()`: for `member.kind === "section" && member.direct === true` (and not a
  path repeat) render `value(input, base, value(input, fieldTarget(base, { kind: "direct" }),
  html\`<p class="note" data-direct=…>${label("shown_directly", { name })}</p>\`))` followed by
  `members(input, member.members, sectionIds)`; `name` is the node's resolved text as the section
  heading resolves it. Strings: `menu_preview.shown_directly` "{name}: shown directly" / "{name}:
  se muestra directamente"; `menu_preview.field_direct` "shown as a folder or directly" /
  "mostrada como carpeta o directamente"; `SECTION_FIELDS.direct`.
- [ ] **Step 3:** tests pass; `customer-menu.a11y.test.ts` and `menu-preview.a11y.test.ts`;
  dashboard typecheck; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 4: commit** — "The Menus preview shows an included menu's sections in its place, and
  says when an include changes how it is shown".

### Task 7: The management route and the dashboard client

**Files:**
- Modify: `apps/server/src/catalogue-api.ts:532-631` (route in `mountSectionRoutes`, body parser
  beside `sectionInput`), `apps/dashboard/src/api/client.ts:181-191, ~2414` (`folder` on the node;
  `setIncludeFolder`; re-export the types from `@waitron/catalogue/src/section-types.js`).
- Create: `apps/server/src/catalogue-api.include-folder.test.ts` (setup modelled on
  `apps/server/src/catalogue-api.menu-schedule.test.ts:1-100`).
- Test: `apps/dashboard/src/api/client-routes.test.ts` (if it pins every client route).

- [ ] **Step 1: failing route tests.**
  - `it("a manager sets the switch and the overrides; the structure read answers them")` — `PUT
    /management-api/sections/<lunchRoot>/members/<include>/folder` `{ showAsFolder: false }` → 200
    `{ showAsFolder: false, overrides: {} }`; `GET` the menu structure: the include node's
    `folder` matches.
  - `it("a staff-role session is refused 403 authorization.not_permitted, and nothing is
    written")`.
  - `it("refuses a body of the wrong shape with management.request_invalid naming the field")` —
    `showAsFolder` missing → `field: "showAsFolder"`; `overrides: []` → `field: "overrides"`;
    `overrides.names: "x"` → `field: "names"`; `overrides.image: 3` → `field: "image"`.
  - `it("answers the domain refusals with their codes")` — unknown member 404
    `menu_section.not_found`; product member `menu_section.membership_invalid`; translation gap
    `menu_section.translation_required { field: "names", language }`; bad colour
    `menu_section.invalid { field: "color" }`. Status codes as the server's error map gives them
    for these codes today (read `apps/server/src/errors.ts` or the sibling route tests; assert
    what it maps, do not change it).
  - `it("a malformed member id is refused before the transaction")` — as sibling routes.
  - Run `pnpm --filter @waitron/server exec vitest run src/catalogue-api.include-folder.test.ts` —
    FAIL (404 route).
- [ ] **Step 2:** the route: `requireManagementSession`, `sectionId(c)`, `memberId(c)`, parse with
  a new `includeFolderInput(body)` (`showAsFolder` boolean; `overrides` absent or a plain object
  whose `names` is absent or a plain object of strings and whose `image`/`color` are absent, null
  or a string), `gated(c, session, (tx) => setIncludeFolder(tx, id, held, input, venueLocale))`,
  answer JSON.
- [ ] **Step 3:** client method `setIncludeFolder(listId, memberId, input)` → `PUT …/folder`.
- [ ] **Step 4:** tests pass; `pnpm --filter @waitron/dashboard exec vitest run
  src/api/client-routes.test.ts`; from the root `pnpm exec vitest run
  scripts/errors-reachable.test.ts scripts/alert-codes.test.ts scripts/live-subscriptions.test.ts`;
  typecheck server and dashboard; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 5: commit** — "A route sets how an include shows its menu".

### Task 8: Folder names count in the translation checks and the missing-translations report

**Files:**
- Modify: `packages/catalogue/src/content-languages.ts:84-115`,
  `packages/catalogue/src/content-translation-report.ts:18-170`,
  `packages/catalogue/src/content-translation-report-types.ts:6-14, 29`,
  `apps/dashboard/src/screens/content-languages-screen.ts:35, 50-70`,
  `apps/dashboard/src/api/live-queries.ts:36-45` (`getContentTranslationGaps` gains
  `section_members`; `scripts/live-subscriptions.test.ts` checks the name),
  `apps/dashboard/src/i18n/strings.ts` (`content_gaps.kind_included_menu`).
- Test: `packages/catalogue/src/content-translation-report.test.ts`,
  `packages/catalogue/src/content-languages.test.ts`,
  `apps/dashboard/src/screens/content-languages-screen.test.ts`.

- [ ] **Step 1: failing tests.**
  - `content-languages.test.ts`: `it("refuses a default language a folder's names would lack")` —
    languages `en, es`, default `en`; Drinks' own names `{}`; Lunch's include fixes `{ en: "Bar" }`
    (accepted: effective has `en`); switching the default to `es` is refused as other gaps are
    (read the existing refusal case in that file and assert the same code); the control with the
    folder fixing `{ en: "Bar", es: "Barra" }` is accepted.
  - `content-translation-report.test.ts`: `it("lists a folder's fixed names missing a language as
    an included menu, under the including menu")` — gap `{ kind: "included_menu", id: memberId,
    name: "Drinks", reason: "partial", parent: { id: lunch, name: "Lunch Menu" } }`; a folder of a
    switched-off including menu is left out (as the report leaves out what a switched-off menu
    owns).
  - `content-languages-screen.test.ts`: the gap's kind reads "Included menu folder" / "Carpeta de
    carta incluida" and links to `/manage/menus/menu/<lunch>/view/structure`.
  - Run the three files — FAIL.
- [ ] **Step 2:** candidates: `union all select 'menu_include' as kind, m.id, null,
  json_patch(s.names, json_extract(m.folder_overrides, '$.names')) as translations from
  section_members m join sections s on s.id = m.child_section_id where s.role = 'menu_root' and
  json_type(m.folder_overrides, '$.names') = 'object'`. `contentTranslationGapsIn` treats blank
  values as gaps already (`resolveContentText`), matching Decision 4.
- [ ] **Step 3:** report: `TranslationGapKind` gains `"included_menu"`; `KIND_ORDER` places it after
  `"section"`; `candidateKind` maps `menu_include` → `included_menu`; a `named` row for includes
  (member id, the included root's `internal_name`, the list's `owner_menu_id`); `gap()` answers it
  with the including menu as `parent` when that menu is active. No `absent` reason for an include.
- [ ] **Step 4:** screen: `GAP_KINDS` and `gapHref` (`included_menu` → the parent menu's structure),
  strings EN/ES.
- [ ] **Step 5:** tests pass; catalogue and dashboard typecheck; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 6: commit** — "A folder's own names count when the default content language changes,
  and the missing-translations report lists them".

### Task 9: The structure table shows the setting and offers Edit and Open

**Files:**
- Modify: `apps/dashboard/src/widgets/menu-structure-table.ts:640-665, 735-745, 752-785, 815-826`,
  `apps/dashboard/src/i18n/strings.ts` (rename key `menus.edit_included` → `menus.open_included`
  with "Open {name}" / "Abrir {name}"; add `menus.include_as_folder` "Shown as a folder" / "Se
  muestra como carpeta", `menus.include_direct` "Sections shown directly" / "Sus secciones se
  muestran directamente").
- Test: `apps/dashboard/src/widgets/menu-structure-table.test.ts`,
  `apps/dashboard/src/widgets/menu-structure-table.a11y.test.ts`, and every test that reads
  `menus.edit_included` (grep).

**Interfaces:** emits `wt-include-edit` `{ path: string[] /* the list's path */, memberId: string }`
(`bubbles: true, composed: true`, as `wt-member-remove` is sent).

- [ ] **Step 1: failing tests** (fixture `lunchNodes()` gains `folder` on its included node):
  - `it("an include's menu offers Open, Edit and Remove")` — `menuItems(el, "included-wine")`
    equals `["source-included-wine", "edit-included-wine", "remove-included-wine"]` (CHANGED from
    `:343`'s two items); the link reads `t("menus.open_included")` with "Wines" (CHANGED from
    `:347`).
  - `it("Edit sends wt-include-edit with the list's path and the member")`.
  - `it("the row says whether the include is a folder or shown directly")` —
    `folder-setting-<key>` reads `menus.include_as_folder`, then `menus.include_direct` with
    `showAsFolder: false`; the label stays `Menu: Wines`.
  - `it("the swatch shows the folder's fixed colour while it is a folder")` — and the included
    menu's own colour when switched off.
  - Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/menu-structure-table.test.ts`
    — FAIL.
- [ ] **Step 2:** implement: the note beside "Read-only here"; `#swatch` uses
  `folderPresentation(node, node.folder ?? FOLLOWING_FOLDER).color` for an include; `#menuItems`
  for an include: the link (new key), an Edit button `edit-${key}` sending `wt-include-edit
  { path: row.path.slice(0, -1), memberId: node.memberId }`, then Remove. Rename the string key
  everywhere it is read (`git grep -n "menus.edit_included"`).
- [ ] **Step 3:** tests pass; the a11y file; dashboard typecheck; `pnpm lint`;
  `pnpm format:check`.
- [ ] **Step 4: commit** — "An include's row says how it is shown, and its menu offers Edit beside
  Open <menu>".

### Task 10: The include's Edit dialog

**Files:**
- Create: `apps/dashboard/src/widgets/include-folder-form.ts` (`dashboard-include-folder-form`),
  `include-folder-form.test.ts`, `include-folder-form.unsaved.test.ts`,
  `include-folder-form.a11y.test.ts`.
- Modify: `apps/dashboard/src/i18n/strings.ts` (`menus.include_edit_heading` "{name} in this menu"
  / "{name} en esta carta"; `menus.include_show_as_folder` "Show as a folder" / "Mostrar como
  carpeta"; `menus.include_direct_hint` "Off: its sections and products appear in this list
  directly, in their own order." / "Desactivado: sus secciones y productos aparecen directamente
  en esta lista, en su propio orden.").

**Interfaces:** properties `open`, `busy`, `api` (`ImageUploader`), `languages`, `menuName`,
`own: Presentation` (the included root's), `value: IncludeFolder | null`, `fieldErrors`,
`draftParent`; emits `wt-submit` with `IncludeFolderInput` and `wt-cancel`; methods
`commitSaved(input)` and `closeSaved(input)`, as `section-details-form.ts:203-210`.

- [ ] **Step 1: failing tests** (model on `section-details-form.test.ts` and its unsaved file):
  - `it("opens with the switch on and every field filled with the folder's current values")` —
    own `{ en: "Drinks", es: "Bebidas" }`, stored fixed `{ en: "Bar" }` → name fields read `Bar`
    and `Bebidas`; colour and photo show the effective ones.
  - `it("switching off hides the names, colour and photo, and switching on shows the values
    again")` — values typed before switching off are back after switching on.
  - `it("submits only the switch when it is off")` → `{ showAsFolder: false }`.
  - `it("submits only the fields that differ from the included menu")` — change es to "Barra",
    leave en as Bar (fixed) → `{ showAsFolder: true, overrides: { names: { en: "Bar", es: "Barra"
    } } }`; set en back to "Drinks" → `names: { es: "Barra" }`.
  - `it("shows a refusal beside the field it names and in one message at the bottom")` —
    `fieldErrors` `{ "names-en": "…" }`, `{ color: "…" }`, `{ image: "…" }`; the bottom line reads
    `form.fix_fields`.
  - `it("every input has a semantic name")` — `show-as-folder`, `names-en`, `names-es`,
    `include-color`, the photo control.
  - Unsaved (`*.unsaved.test.ts`, W69): closing with a change asks to discard; closing unchanged
    does not; after `closeSaved` it does not ask; a change only in a hidden field while the switch
    is off does not count, and switching on makes it count again (Decision 5).
  - a11y: axe clean, switch on and off, both themes.
  - Run `pnpm --filter @waitron/dashboard exec vitest run src/widgets/include-folder-form.test.ts
    src/widgets/include-folder-form.unsaved.test.ts src/widgets/include-folder-form.a11y.test.ts`
    — FAIL.
- [ ] **Step 2:** implement by following `section-details-form.ts` (same modal, draft scope,
  `#errors`/`#fieldKeys`, bottom message, footer), minus the internal-name field, plus `wt-switch
  name="show-as-folder"` with the hint as its description text; the names fieldset, `colorField`
  (`name: "include-color"`) and `dashboard-image-upload` render only while the switch is on. The
  submission value is `{ showAsFolder: false }` when off, else `{ showAsFolder: true, overrides:
  folderOverridesFrom(own, shown, languages.languages, value.overrides) }`. The draft scope's
  `current()` is that submission value; `restore` puts back the switch and the shown values.
- [ ] **Step 3:** tests pass; dashboard typecheck; `pnpm lint`; `pnpm format:check`.
- [ ] **Step 4: commit** — "A dialog edits how one include shows its menu".

### Task 11: The Menus screen opens the dialog, saves it and puts refusals beside their fields

**Files:**
- Modify: `apps/dashboard/src/screens/menus-screen.ts` (state `editingInclude: { path, memberId,
  node } | null`, a `@wt-include-edit` handler beside `:2144`, render the form beside
  `#renderNewSection` `:2489`, `#saveInclude(input)` modelled on `#saveSection` `:1399-1424`).
- Test: `apps/dashboard/src/screens/menus-screen.test.ts` (its `api()` fake, `:473-…`, gains
  `setIncludeFolder: vi.fn()`), `apps/dashboard/src/screens/menus-screen.a11y.test.ts`.

- [ ] **Step 1: failing tests**, new `describe("an include's Edit dialog")`:
  - `it("opens from the include's menu with the folder's values")` — the dialog's heading reads
    "Wines in this menu".
  - `it("saves the switch and the changed fields to the include's list, and refreshes")` —
    `setIncludeFolder` called with `(listId, memberId, { showAsFolder: false })`; the fake's next
    structure answers `folder.showAsFolder: false`; the row reads "Sections shown directly".
  - `it("an untouched field still follows after the included menu was renamed while the dialog
    was open")` — the fake's structure changes the included root's names between open and save;
    change only the colour; the call carries `overrides: { color }` and no `names`.
  - `it("puts a translation refusal beside the name field and keeps the dialog open")` — the fake
    rejects with `menu_section.translation_required { field: "names", language: "en" }`; the
    message is under `names-en`, the bottom line reads `form.fix_fields`.
  - `it("a refusal that names no shown field shows at the bottom")` — `menu_section.not_found`.
  - Run `pnpm --filter @waitron/dashboard exec vitest run src/screens/menus-screen.test.ts -t
    "include's Edit dialog"` — FAIL.
- [ ] **Step 2:** implement; refusals through the existing `refusal()` (`fieldOf`); the list id is
  resolved from the path as `#listWrite` does for `wt-member-remove` (`:2131-2136`); the write runs
  in `#writes.run(listId, …)` like `#saveSection`; on success `closeSaved`, clear the state,
  `#refresh()`.
- [ ] **Step 3:** tests pass; then the whole `menus-screen.test.ts` once (it is large: check
  `memory_pressure | grep free` first) and `menus-screen.a11y.test.ts`; dashboard typecheck;
  `pnpm lint`; `pnpm format:check`.
- [ ] **Step 4: commit** — "The Menus screen edits how an include shows its menu".

### Task 12: Documentation, backlog, and the look

**Files:** `docs/backlog.md` (an A322 entry: what landed, the PR number once known, and what is left
open — see below), `docs/developers/design-system.md` → Forms (one rule: a switch that hides fields
keeps their values; switching back shows them; a save with the switch off leaves stored values
untouched), `docs/developers/conventions-data.md` (the media trigger paragraph at ~`:986-1004`
names `section_members` and the new file; a catalogue rebuild of `section_members` now fails on an
upgrade like `sections`), `docs/developers/products.md` only if it describes folder names.

- [ ] **Step 1:** write the three doc changes; `pnpm exec prettier --file-info` on each to see
  whether it is format-checked; `pnpm exec vitest run scripts/claude-md-pointers.test.ts`.
- [ ] **Step 2: LOOK.** Start the stack with `wa-wt demo waitron-feat-included-menu-direct-sections`
  (lsof the venue folder and port 8080 before any reset). In the dashboard: a menu including
  another; the include's ⋮ (Open, Edit, Remove); the dialog with the switch on and off, a refusal
  beside a name; the row note; the preview with the direct include; the device-home preview.
  On the till: home with the include shown directly, a section of it opened (breadcrumb), a
  shortcut to the included menu. Each in light and dark, at 1280 and 390 px, in English and
  Spanish. Save the screenshots under `~/waitron-campaign-b/a322-shots/` and look at every one.
- [ ] **Step 3: commit** — `docs: …` with the explicit paths.

**Left open (for the backlog entry):** a folder's override photo shows on the till only in
Thumbnails mode, as a section's does; a home shortcut to an included menu shown in two lists of one
menu with different settings opens one of them (Decision 16).

---

## Changed test checks (expected)

- `apps/dashboard/src/widgets/menu-structure-table.test.ts:343` — the include's ⋮ items gain
  `edit-included-wine` between the link and Remove (spec: owner addition ~10:50, "the include
  row's ⋮ menu gets Edit").
- `apps/dashboard/src/widgets/menu-structure-table.test.ts:347` and every other reader of
  `menus.edit_included` (e.g. `apps/dashboard/src/screens/menus-screen.test.ts:3634` checks the
  link's `href`, which stays) — the link text becomes "Open {name}" under `menus.open_included`
  (owner: "renamed Open <menu>").
- `packages/media/src/schema/name-only-upgrade.test.ts:399-404` — the "untouched" comparison
  leaves out the four new triggers, keeping the nine word for word; a new case requires the four.
- `scripts/behavioural-triggers.test.ts:107-119` — four names added to `IMAGE_REFERENCE_TRIGGERS`.
  An addition the equality requires, not a changed or weakened check; listed for the FYI.
- Any whole-shape pin of `MenuStructureNode` for an include, `ImageUsage`, `TranslationGapKind` or
  the `section_members` columns that gains the new key — an addition, listed with its `file:line`.

Anything else that fails is a side effect: STOP for that check (THE RULE).

## Self-review (writer)

- Spec coverage: points 1-6 and the owner addition map to Tasks 1-12 — setting per include (1, 3,
  7, 9-11), splice in place in order and read-only at the included menu's prices (4, 5, 6;
  read-only and prices are unchanged code paths: Lunch's offers still come from `listMenuOffers`),
  till/preview/device home and shortcut (4, 5, 6), nested includes (4 case 4), name clashes (4 case
  5), spec amendment (committed with this plan), follow vs fixed both ways (4 case 7, 10, 11),
  switch hides fields (10), required-language refusals beside the field (3, 7, 10, 11),
  image/colour painting (5, 9), W69 rules (10), Open <menu> (9), backlog (12).
- No placeholders; the interfaces block names every function a later task uses.
