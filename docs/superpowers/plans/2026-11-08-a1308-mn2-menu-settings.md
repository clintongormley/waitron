# A1308 menu and photos, PR mn2: the menu's settings document, and a suggestion run's size stored once — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Every implementer is dispatched as
> `subagent_type: "implementer"`.

**Goal:** Replace the two one-row tables `catalogue_settings` and `unit_seed_states` with the menu's
document in the shared `settings` table (`settings.menu`), and store a translation run's size on its
first batch only.

**Architecture:** `MENU_SETTINGS`, declared with slice 1b's `defineSettingsDocument`, holds three
fields: the VAT class and colour a new product starts with, and whether the starter units were ever
created. Every reader and writer of the two tables goes through `readSettings`/`saveSettings`; the
document travels in a configuration export through slice 1b-ii's document path. `run_total` becomes
nullable with a CHECK that it is set on position 1 and nowhere else.

**Tech Stack:** TypeScript, drizzle on `node:sqlite`, Hono, Lit, Vitest.

**Spec:** [design README](../specs/2026-11-02-rationalisation/README.md) §3 R3, §5 U2;
[tables-menu.md](../specs/2026-11-02-rationalisation/tables-menu.md) §2 "`settings.menu`", §1.19,
§5 (rows `unit_seed_states`, `catalogue_settings`, `content_suggestion_jobs`); [slice
rules](2026-11-08-a1308-slice-rules.md) ("rules §n"); [build order](2026-11-08-a1308-build-order.md).

**Base and names:** cites are `file:line` at `a086eedfb7`. PR mn1 moved the files: a cite written
`packages/menu/src/settings.ts:15` is today's `packages/catalogue/src/settings.ts:15`, and
`packages/db/src/schema/menu/settings.ts` is today's `packages/db/src/schema/catalogue/settings.ts`.
Identifiers keep their old names in this PR (`readCatalogueSettings`, `CATALOGUE_TABLES`); mn3
renames them. Batch 1 and mn1 have landed; find a moved line by its identifier, and stop if the
identifier is gone (rules §5.1).

**Who lands:** the lane (rules §6). VAT class here is only the default a new product starts with;
the class a sale uses is frozen per product and its rate read at payment (memory "VAT class frozen,
rate at payment"), so no fiscal value changes.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2)

## What it builds

1. `MENU_SETTINGS` in `packages/menu/src/settings.ts`: module `"menu"`, version 1, `transfers: true`,
   fields and defaults exactly as tables-menu.md §2:
   `defaultProductVatClass` (`general | reduced | super_reduced | zero`, default `"general"`),
   `defaultColor` (lowercase `#rrggbb` or null, default null), `starterUnitsCreated` (boolean,
   default false). `parse` refuses a bad VAT class with field `defaultProductVatClass`, a colour that
   is not lowercase `#rrggbb` or null with field `defaultColor`, a non-boolean flag with field
   `starterUnitsCreated`, and an unknown key with that key's name.
2. The module descriptor `packages/composition/src/modules.ts:185-195` gains
   `settings: [MENU_SETTINGS]` (slice 1b's `WaitronModule.settings` seat), so the server admits the
   live type `settings.menu`.
3. Readers and writers moved onto the document:
   - `readCatalogueSettings` (`packages/menu/src/settings.ts:15-21`) returns the document's two
     product fields; `saveCatalogueSettings` (`:35-43`) and `saveCatalogueDefaultColor` (`:45-53`)
     keep their signatures, read the document and save it with `expectedRevision` set to the
     revision they just read, in the caller's transaction (decision D1). Their refusals keep their
     codes (`product.invalid { field: "defaultProductVatClass" }`, `category.invalid { field: "color" }`).
   - The seed (`packages/menu/src/provisioning.ts:58-100`): on revision 0 it saves the country
     pack's VAT class and `NEW_VENUE_DEFAULT_COLOR` (`:56`); while `starterUnitsCreated` is false it
     inserts `STARTER_UNITS` and sets the flag in the same save (decision D2).
   - `packages/menu/src/menu-document.ts:191` keeps calling `readCatalogueSettings`.
   - `apps/server/src/venue-settings-api.ts:117`, `:357` keep calling the same two functions.
4. The two tables are deleted, with every list that names them: classification
   (`packages/db/src/classification.ts:292`, `:294`; `packages/menu/src/classification.ts:6`, `:8`),
   the configuration-export entries and their checks (`packages/menu/src/configuration-transfer.ts:154-161`,
   `:214-215`), exports (`packages/db/src/index.ts:397`, `:418`; `packages/menu/src/index.ts:100`,
   `:121`), `apps/server/src/testing/clear-provision-fixture.ts:62`, the dashboard live-query lists
   (`apps/dashboard/src/api/live-queries.ts:5`, `:94`, `:519`) which name `settings.menu` instead.
5. `content_suggestion_jobs.run_total` is nullable, with CHECK `content_suggestion_jobs_run_total_ck`:
   `(position = 1) = (run_total is not null)`. The next batch is inserted without it
   (`packages/menu/src/content-suggestion-store.ts:259-268`); the first batch keeps it
   (`content-suggestion-jobs.ts:67-71`) and the update at `content-suggestion-store.ts:269-272`
   still targets position 1; the reader at `content-suggestion-jobs.ts:203` reads the first batch,
   as today.
6. The configuration bundle format moves on by one from what `main` holds
   (`packages/provisioning/src/configuration-transfer.ts:123`, `:160`, `:476`; 10 at `a086eedfb7`,
   moved by 4a and 1b-ii before this area starts), because two table entries leave it and the
   `menu` document joins it.

## Decisions this plan makes

- **D1. The two save functions keep their request shapes.** Each reads the document and saves it
  naming the revision it just read, inside the caller's one write transaction, so two saves cannot
  interleave and the later one stands, as today. The Products screen's default colour and the venue
  defaults panel's VAT class are each one value saved alone; the venue panel saves its own fields
  under sweep 5's `settings.venue` revision in the same request. Sending a revision from these two
  screens would only turn "the later choice stands" into a refusal with nothing to merge. Stated
  here so the reviewer can disagree.
- **D2. "Starter units are created at most once" keeps its guarantee, by turn-taking plus reading
  the flag in the same transaction.** Today the claim is `insert … on conflict do nothing returning`
  on `unit_seed_states` (`provisioning.ts:90-94`). Write transactions on the venue file take turns:
  a second one does not start while the first is open (`racePair` asserts exactly that,
  `packages/menu/test/fixtures.ts:254-267`). So the second seed reads the flag the first saved and
  inserts nothing; `settings.out_of_date` cannot fire here, and the plan does not rely on it. The
  marker's other job also stays: a starter unit someone deleted is not recreated, because the flag
  stays true (`packages/db/src/schema/menu/units.ts:30-31`).
- **D3. `run_total`'s first position is 1**, not 0 as tables-menu.md §1.19 says: runs start at 1
  (`content-suggestion-jobs.ts:67`) and the update already targets 1
  (`content-suggestion-store.ts:271`).

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Renaming `readCatalogueSettings`, `CatalogueSettings`, the route `/management-api/catalogue-settings` and the string keys `catalogue_settings.*` | mn3 (script) |
| A history of `settings.menu` saves | not this area: "the central `settings` design's business" (tables-menu.md §3); README §5 U11 makes audit kinds a follow-up |
| Content languages in `settings.venue` | slice 5 (done before this area) |

## Files

- Modify: `packages/menu/src/settings.ts`, `settings-types.ts`, `provisioning.ts`,
  `configuration-transfer.ts`, `classification.ts`, `index.ts`, `content-suggestion-store.ts`,
  `content-suggestion-jobs.ts`
- Modify: `packages/db/src/schema/menu/settings.ts` (delete `catalogueSettings`),
  `packages/db/src/schema/menu/units.ts:30-38` (delete `unitSeedStates`),
  `packages/db/src/schema/menu/suggestions.ts:57`, `:73-78`, `packages/db/src/schema/menu/index.ts`,
  `packages/db/src/index.ts`, `packages/db/src/classification.ts`
- Modify: `packages/composition/src/modules.ts:185-195`; `apps/dashboard/src/api/live-queries.ts`;
  `apps/server/src/testing/clear-provision-fixture.ts`; `packages/provisioning/src/configuration-transfer.ts`
- Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json` (slice 1a's command)
- Guards: `scripts/schema-constraints.test.ts` (CHECK list from `:527`: remove
  `catalogue_settings_singleton_ck`, `catalogue_settings_vat_class_ck`, `unit_seed_states_singleton_ck`;
  add `content_suggestion_jobs_run_total_ck`), `scripts/live-subscriptions.test.ts`,
  `packages/db/src/schema/menu/migrations.test.ts` (its pinned CHECK texts)
- Tests: `packages/menu/src/settings.test.ts`, `settings.live.test.ts`, `provisioning.test.ts`,
  `configuration-transfer.test.ts`, `content-suggestion-store.test.ts`, `content-suggestion-jobs.test.ts`;
  `apps/server/src/configuration-import.test.ts` (format refusal); the Madrid baseline test
  `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and a helper beside it
- Docs: `docs/developers/products.md` and `docs/developers/conventions-data.md` where they name
  `catalogue_settings` or `unit_seed_states` (find with `git grep -n -e catalogue_settings -e unit_seed_states -- docs/developers`)

## Size

| | Code | Tests |
| --- | --- | --- |
| Document, parse, readers and writers | 120 | 160 |
| Seed | 40 | 60 |
| Lists, transfer, format bump, live queries | 40 | 40 |
| `run_total` | 15 | 50 |
| Madrid baseline transform | 30 | 30 |
| **Counted** | **245** | **340** |

About 595 counted lines; not counted: generated migration files, deleted schema lines. About 2½
hours.

## Finish line

1. `pnpm --filter @waitron/menu exec vitest run src/settings.test.ts src/provisioning.test.ts src/content-suggestion-store.test.ts`
   passes, including "creates the starter units once, even when two seeds race" and "stores a run's
   size on its first batch only".
2. `git grep -n -e catalogue_settings -e unit_seed_states -e catalogueSettings -e unitSeedStates -- apps packages scripts`
   prints only the string keys `catalogue_settings.*` in `apps/dashboard/src/i18n/strings.ts` and
   `venue-defaults-panel.ts` (mn3 renames them) and the captured fixtures (never edited).
3. `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts` refuses the
   previous format as `setup.configuration_outdated`.
4. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Predicted by reading `apps/server/scripts/protection-list/compare.ts:66-246` and the schema; not run.
`node.db` prints nothing. `venue.db` prints a `DIFF` header for each of the six entries (both
compositions × `sql-only`, `migrated`, `change-feed`).

In all six:

```text
missing table catalogue_settings
missing table unit_seed_states
changed table content_suggestion_jobs.columns[run_total].notNull
old: true
new: false
extra table content_suggestion_jobs.checks[content_suggestion_jobs_run_total_ck]
```

In the two `change-feed` entries, also:

```text
missing trigger waitron_change_catalogue_settings_delete
missing trigger waitron_change_catalogue_settings_insert
missing trigger waitron_change_catalogue_settings_update
missing trigger waitron_change_unit_seed_states_delete
missing trigger waitron_change_unit_seed_states_insert
missing trigger waitron_change_unit_seed_states_update
```

Why, from tables-menu.md §5: `catalogue_settings`' singleton and VAT CHECKs and
`unit_seed_states`' singleton CHECK are part of their table objects and leave with them ("moved to
code (`settings.menu` validator)", "not needed (document field)"). Both tables' keys are integer row
ids, so no index line prints. `run_total`'s new CHECK is the design's §1.19 change. Change-feed
triggers follow the tables (§5, last row). `content_suggestion_jobs`' column names do not change, so
its update trigger's `when` does not either.

## Stop points (beyond rules §5)

1. Slice 1b's `defineSettingsDocument`, `readSettings`, `saveSettings` or `WaitronModule.settings`
   do not exist under those names, or 1b-ii's document transfer is absent.
2. Sweep 5 left `getVenueDefaults` (`apps/dashboard/src/api/live-queries.ts:519`) naming something
   other than `locations` or `settings.venue` beside `catalogue_settings`.
3. The Madrid baseline test needs a change beyond moving the two captured rows into the expected
   `settings` row (Task 4).

## Needs

- **Outside this area:** slice 1b (the `settings` table and API), 1b-ii (documents in a
  configuration export), slice 5 (venue settings document; content languages moved). 1a's rebuild
  command.
- **In this area:** mn1.

## Global Constraints

- Rules §1–§9 apply; core's starting migration is rebuilt with
  `pnpm --filter @waitron/server migration-baseline rebuild --set core`, never edited (rules §2).
- A behaviour test keeps its assertions (rules §4); the settings cases are re-pointed from the table
  to the document.
- Every commit `git commit -s`.

## Review Focus

1. **Two seeds cannot both create starter units, and a deleted starter unit is not recreated** (D2),
   pinned by a race test and a re-seed test.
2. **A venue that never saved reads the defaults** the old table defaults gave (`general`, null),
   and the seed's values (pack VAT class, `#abcced`) appear only after provisioning.
3. **The document travels in an export and is checked on import** through 1b-ii's path, with the
   same refusals the old table checks gave (`configuration-transfer.ts:154-161`).

---

### Task 1: The document, its readers and writers

**Files:** `packages/menu/src/settings.ts`, `settings-types.ts`, `index.ts`;
`packages/composition/src/modules.ts`; tests `packages/menu/src/settings.test.ts`,
`settings.live.test.ts`.

**Interfaces:**

```ts
// packages/menu/src/settings.ts
export interface MenuSettings {
  readonly defaultProductVatClass: VatClass;
  readonly defaultColor: string | null;
  readonly starterUnitsCreated: boolean;
}
export const MENU_SETTINGS: SettingsDocument<MenuSettings>; // module "menu", version 1, transfers true
export function readCatalogueSettings(tx: Transaction): Promise<CatalogueSettings>; // unchanged shape
export function saveCatalogueSettings(tx: Transaction, input: { defaultProductVatClass: unknown }): Promise<CatalogueSettings>;
export function saveCatalogueDefaultColor(tx: Transaction, color: unknown): Promise<CatalogueSettings>;
```

- [ ] **Step 1: Take the base protection list** (rules §3) in a throwaway worktree of the base.
- [ ] **Step 2: Write the failing cases** in `settings.test.ts` (suite `useVenueDb` with core's
  migrations):
  - `"reads the defaults when nothing was saved"`: `readCatalogueSettings` →
    `{ defaultProductVatClass: "general", defaultColor: null }`.
  - `"saves the VAT class into the menu document"`: after `saveCatalogueSettings(tx, { defaultProductVatClass: "reduced" })`,
    `readSettings(tx, MENU_SETTINGS)` → `doc.defaultProductVatClass === "reduced"`, `revision === 1`;
    a second save → revision 2.
  - `"refuses a VAT class outside the four"`: `"standard"` → `AppError` `product.invalid`
    `{ field: "defaultProductVatClass" }` (`toMatchObject({ code, params })`).
  - `"saves and clears the default colour"`: `"#abcdef"` then `null`; `"#ABCDEF"` →
    `category.invalid { field: "color" }`.
  - `"parse names each bad field"`: `MENU_SETTINGS.parse` on `{ …, defaultColor: "red" }` →
    `{ ok: false, field: "defaultColor" }`; on `{ …, starterUnitsCreated: 1 }` → field
    `starterUnitsCreated`; on an extra key `x` → field `x`.
  - Re-point the existing cases in `settings.test.ts` and `settings.live.test.ts` from the table to
    the document; their expected values stay (rules §4). The live case now subscribes to
    `settings.menu`.
- [ ] **Step 3: Run** `pnpm --filter @waitron/menu exec vitest run src/settings.test.ts src/settings.live.test.ts` — FAIL.
- [ ] **Step 4: Implement** the interfaces; add `settings: [MENU_SETTINGS]` to the catalogue module
  descriptor (`packages/composition/src/modules.ts:185-195`).
- [ ] **Step 5: Run** — PASS with a `Tests` count. **Commit.**

### Task 2: The seed, the lists, and deleting the tables

**Files:** `packages/menu/src/provisioning.ts`, `classification.ts`, `configuration-transfer.ts`;
`packages/db/src/schema/menu/settings.ts`, `units.ts`, `index.ts`; `packages/db/src/index.ts`,
`classification.ts`; `apps/dashboard/src/api/live-queries.ts`;
`apps/server/src/testing/clear-provision-fixture.ts`; guards; tests `provisioning.test.ts`,
`configuration-transfer.test.ts`.

- [ ] **Step 1: Write the failing cases:**
  - `provisioning.test.ts` `"saves the pack's VAT class and the new-venue colour once"`: after the
    seed, the document is `{ defaultProductVatClass: <ES pack's>, defaultColor: "#abcced",
    starterUnitsCreated: true }`; running the seed again leaves revision unchanged and inserts no unit.
  - `"creates the starter units once, even when two seeds race"`: two seeds through `racePair`
    (`packages/menu/test/fixtures.ts`), each in its own transaction; `racePair`'s own assertion shows
    the second waited; afterwards exactly `STARTER_UNITS.length` units exist, the second seed inserted
    none, and the document's revision is 1.
  - `"does not recreate a starter unit someone deleted"`: seed, delete one starter unit, seed again;
    that unit stays deleted.
  - `"keeps a saved VAT class when the seed runs again"`: save `zero`, run the seed, read `zero`.
  - Re-point the existing seed cases that read `unit_seed_states` or `catalogue_settings` to the
    document; expected values unchanged.
  - `configuration-transfer.test.ts`: the cases that refused a bad `catalogue_settings` row now feed
    the same bad values as the bundle's `menu` document and expect 1b-ii's refusal naming
    `settings.menu.defaultProductVatClass` / `.defaultColor` (use 1b-ii's field form; stop point 1
    if 1b-ii names fields differently and the old field strings cannot be kept).
- [ ] **Step 2: Run them; see them fail.**
- [ ] **Step 3: Implement** D2's seed; delete both tables and every list entry named in "What it
  builds" item 4; rebuild core: `pnpm --filter @waitron/server migration-baseline rebuild --set core`.
- [ ] **Step 4: Update the guards**, not loosen them (rules §4): the CHECK list in
  `scripts/schema-constraints.test.ts`; `scripts/live-subscriptions.test.ts`;
  `packages/db/src/schema/menu/migrations.test.ts`'s pinned texts.
- [ ] **Step 5: Run** the Task 1 and Task 2 files and the guards — PASS. **Commit.**

### Task 3: A run's size on its first batch only

**Files:** `packages/db/src/schema/menu/suggestions.ts`; `packages/menu/src/content-suggestion-store.ts`,
`content-suggestion-jobs.ts`; tests beside them.

- [ ] **Step 1: Write the failing cases:**
  - `content-suggestion-store.test.ts` `"stores a run's size on its first batch only"`: complete a
    first batch that queues a second; the second row's `run_total` is null and the first holds the
    run's size (`sent.size + next's sent + remaining`, as `:258` computes).
  - schema cases in the same file or `packages/db/src/schema/menu/migrations.test.ts`: a raw insert
    of position 2 with `run_total` 5 is refused naming `content_suggestion_jobs_run_total_ck`; position
    1 with null is refused the same; position 1 with 5 and position 2 with null are accepted.
  - The existing progress case (`content-suggestion-jobs.test.ts`, total read from the first batch)
    keeps its assertion.
- [ ] **Step 2: Run; see them fail.**
- [ ] **Step 3: Implement**: `runTotal: count("run_total")` (nullable) and the CHECK; drop `runTotal`
  from the next-batch insert. Rebuild core.
- [ ] **Step 4: Run — PASS. Commit.**

### Task 4: The bundle format, the Madrid baseline, and finishing

**Files:** `packages/provisioning/src/configuration-transfer.ts`; `apps/server/src/configuration-import.test.ts`;
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` and a new helper
`apps/server/scripts/demo-seed/testing/madrid-menu-settings.ts` with its test; docs.

- [ ] **Step 1: Format.** Move the bundle's `version` on by one (three sites, `:123`, `:160`,
  `:476`); add a row to the refusal table at `apps/server/src/configuration-import.test.ts:204`
  refusing the previous version as `setup.configuration_outdated`.
- [ ] **Step 2: Madrid baseline.** The capture (hashed, never edited, 4a's D3) holds a
  `catalogue_settings` row and a `unit_seed_states` row. Write `madridWithMenuSettings(capture)`:
  for each phase, check the captured rows exist, remove the two tables, and set the expected
  `settings` row for `menu` to `{ module: "menu", version: 1, revision: 1, doc: { defaultProductVatClass, defaultColor, starterUnitsCreated: true }, updated_by: null }`
  from the captured values (`updated_at` taken from the actual row, as the test's other time
  columns are). Its test feeds a two-row capture and asserts the output. Call it in
  `seed.madrid-baseline.test.ts` beside the other transforms (`:111-118`). If 1b-ii or slice 5
  already added a `settings` transform, extend that one instead.
- [ ] **Step 3: Docs.** Update the `docs/developers` lines that name the two tables (Files).
- [ ] **Step 4: Run** the Finish line commands; paste the protection-list report into the pull
  request, marking each line against the prediction (rules §3).
- [ ] **Step 5:** `/finish-branch`. Push once.
