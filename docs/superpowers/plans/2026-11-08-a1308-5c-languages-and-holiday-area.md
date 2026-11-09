# A1308 slice 5c: receipt languages, content languages and the holiday area join the venue document — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order, shared
> words and the reviewer's re-run: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).
> The 1b-i API names: [5b](2026-11-08-a1308-5b-venue-document.md#the-api-this-slice-uses-slice-1b-i-exact-names).

**Lands:** the lane (rules §6): no `sales` row, invoice number, fiscal record, fiscal identity, AEAT
message or hashed value changes. **Owner, 2026-11-09:** the lane lands 5c. (Why it was asked: under
A1301's own rule (a) this slice would be owner-landed, because each sale's invoice languages (`sales.invoice_locales`, copied at
issue) are then read from a new place; under A1308's rule (§6) it is the lane's. The default content
language's text is printed on invoice lines, but it is neither filed nor hashed.)

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

**Needs before it:** 5b; 1b-ii (the bundle's format numbering).

## What it builds

1. **Receipt languages join `settings.venue`** (tables-venuebox §2.1). `VenueSettings` gains
   `invoiceLocales: string[]` (1–2 entries, no repeats, each non-empty). `locations.invoice_locales`
   and `locations_invoice_locales_len` go. `readVenueInvoiceLocales` (`packages/db/src/venue.ts:66-72`)
   reads only the document. Writers: setup (`venue-apply.ts`, `create-venue`, and its re-apply
   comparison), the receipt language route (`apps/server/src/venue-settings-api.ts:105-109`:
   `saveVenueFields(tx, { invoiceLocales }, personId)`), `seedVenueSettings`' defaults
   (`invoiceLocales: ["es"]`).
2. **The receipt-language rule stays a database rule** (tables-venuebox §5, owner 2026-11-04), as a
   pair of `settings` triggers in `packages/db/triggers/core.sql`:

   ```sql
   CREATE TRIGGER settings_venue_invoice_locales_insert
   BEFORE INSERT ON settings
   FOR EACH ROW
   WHEN new.module = 'venue'
     AND (json_type(new.doc, '$.invoiceLocales') IS NOT 'array'
          OR json_array_length(new.doc, '$.invoiceLocales') NOT BETWEEN 1 AND 2)
   BEGIN
     SELECT raise(abort, 'settings.invalid');
   END;
   ```

   and `settings_venue_invoice_locales_update`, the same `WHEN` and body, `BEFORE UPDATE OF doc ON
   settings`. `IS NOT` (not `<>`) is what makes a document with no `invoiceLocales` key refused: its
   `json_type` is NULL, and NULL `<> 'array'` is NULL, which a `WHEN` treats as false (the reviewer
   ran the first draft's `NOT (… = 'array' AND …)` on `node:sqlite`: `{}` and `{"name":"V"}` were
   accepted). The message is the code the document's validator throws; a caller that writes raw SQL
   gets the database's error carrying that text, not the validator's refusal with its field, so it
   matches with `triggerRaised(error, "settings.invalid")` (1b-i).
3. **The four language triggers read the document** (A1301 design §2.3, source changed per
   tables-venuebox §5): `working_order_lines_check_locales_insert`, `_update`,
   `working_order_lines_check_variant_locales_insert`, `_update` keep their names, timing, `UPDATE OF`
   list and `WHEN`; in their bodies every
   `FROM working_orders wo JOIN locations l ON l.id = wo.location_id … JOIN json_each(l.invoice_locales) configured WHERE wo.id = new.working_order_id`
   becomes `FROM json_each((SELECT doc FROM settings WHERE module = 'venue'), '$.invoiceLocales') configured`,
   and the first clause becomes `NOT exists (SELECT 1 FROM settings WHERE module = 'venue')`. A line on
   a box with no venue document is refused in the same words; a line whose order does not exist is
   now refused only by the open-parent trigger.
4. **§8.2 is measured first, before anything is built** (tables-venuebox §8 item 2; Task 1).
5. **Content languages join `settings.venue`** (tables-menu §2; owner 2026-11-04). `VenueSettings`
   gains `contentLanguages: string[] | null` and `defaultContentLanguage: string | null`, both null or
   both set; when set, 1–200 entries, no repeats, the default in the list. Null keeps today's "no
   setting saved": `readSavedContentLanguages` (`packages/catalogue/src/content-languages.ts:132-143`)
   answers `undefined`, and `contentLanguagesOr` (`:145-158`) falls back as today. The
   `content_languages` table and its three CHECKs go (tables-menu §5: the CHECKs become the
   document's validation). `writeContentLanguages` (`:181-191`) keeps its checks and saves through
   `saveVenueFields`, gaining `personId: string | null` (the route at
   `apps/server/src/catalogue-api.ts:956` passes the signed-in person; the demo seed
   `apps/server/scripts/demo-seed/seed-catalogue.ts:111` passes null, and its raw read of
   `locations.province` at `:104` becomes `readVenue`).
6. **The holiday area joins `settings.venue`** (tables-venuebox §2.3): `holidayArea:
   { country: string; provinceCode: string; cityKey: string; areaKey: string | null } | null`, the
   place the choice was made for, so a later address change reads as "no area chosen", as
   `readHolidays` does today when no row matches (`packages/venue-service/src/holidays.ts:134-144`).
   In `createHolidayStore` (`:86-339`), `geographiesOf` and `createGeography` go; the readers match the
   one `holidayArea` against the address as `matches` does; `saveHolidayArea` keeps its checks and saves
   through `saveVenueFields` with the signed-in person (`routes.ts:606`), returning null when a choice
   is cleared at a place with none (`:309`). `HolidayGeography` loses `id` (R4). `holiday_geographies`,
   its place key and city CHECK go (tables-venuebox §5: the city check becomes code). This ends the
   A1301 leftover "`saveHolidayArea` reads the venue row twice" (S8).
7. **The configuration export changes, so its format rises by one from `main`'s value** (rules §9).
   - **Content languages and the holiday area travel as top-level bundle fields**, beside
     `privacyContact`: `contentLanguages: { defaultLanguage: string; languages: string[] } | null` and
     `holidayArea: { country; provinceCode; cityKey; areaKey } | null`. This departs from
     tables-venuebox §2.4 ("That field gains `holidayArea` … and the two content-language fields") on
     purpose: neither is a setup field, and CLAUDE.md §3 keeps such values out of `venue`'s own keys
     because one there refused every production setup from an export
     (`docs/developers/conventions-data.md:1830-1855`; `CLAIM_VENUE_FIELDS`,
     `apps/setup/src/setup-app.ts:195-206`). The pull request corrects tables-venuebox §2.4 and
     tables-menu §2's "The two fields join the bundle's `venue` field" with a dated note.
   - **The export's `venue` cannot carry them by accident, decided:** `readVenue` builds `Venue` by
     naming each field (`venue.ts:31-52` today), never by spreading the document, and `Venue` gains no
     content-language, holiday or Cloud field; so `{ …fields }` at
     `packages/provisioning/src/configuration-transfer.ts:112-137` holds only `Venue`'s fields. A case
     pins it (Task 5).
   - `content_languages` and `holiday_geographies` leave the transfer lists
     (`packages/catalogue/src/configuration-transfer.ts:208`, `packages/venue-service/src/configuration-transfer.ts:725`).
   - The module contract's `validate(tables, bundle?)` context (`packages/module/src/module.ts:1477-1486`)
     gains `readonly contentLanguages: { defaultLanguage: string; languages: readonly string[] } | null`.
     Catalogue's `checkContentLanguages` (`packages/catalogue/src/configuration-transfer.ts:80-…`)
     checks that field with the same codes (`content.language_required`, `content.languages_invalid`)
     and geography rule; media's check (`packages/media/src/configuration-transfer.ts:63-67`) reads
     `bundle.contentLanguages?.defaultLanguage`. The holiday area's shape is checked by
     `VENUE_SETTINGS.parse`.
   - Import: after the tables, `saveVenueFields(tx, { contentLanguages, defaultContentLanguage,
     holidayArea }, null)` (1b-ii: an import saves with no person).
8. **Live types** (rules §9): `"content_languages"` and `"holiday_geographies"` dependencies become
   `"settings.venue"`, deduplicated (`apps/dashboard/src/api/live-queries.ts`,
   `apps/dashboard/src/screens/content-languages-screen.ts:204`, `department-receipt-editor.ts:269`,
   `packages/media/src/dashboard/live-queries.ts:7`, `packages/venue-service/src/dashboard/live-queries.ts`).
9. **Madrid** (5b's `madrid-documents.ts`, extended): `invoice_locales` moves from the captured
   `locations` row into the document; a "table rows into document fields" mode moves
   `content_languages`' captured row into `contentLanguages`/`defaultContentLanguage` and
   `holiday_geographies`' (if the capture holds one) into `holidayArea`, and removes those tables
   (`REMOVED_TABLES` requires them empty, `seed.madrid-baseline.test.ts:129-135`).

## What it leaves out

| Left out | Taken by |
| --- | --- |
| The default menu (`catalogues.is_default`) | 5e |
| Folding the content-language screen or route elsewhere | nobody: only the storage moves |
| The privacy contact | venue and box (see 5b) |

## Files

```zsh
git grep -l -w -E "contentLanguages|content_languages" -- apps packages scripts ':!**/drizzle/**' ':!*.md'
git grep -l -w -E "holidayGeographies|holiday_geographies" -- apps packages scripts ':!**/drizzle/**' ':!*.md'
git grep -l -E "invoice_locales|invoiceLocales: locations" -- apps packages scripts ':!**/drizzle/**'
```

Modify: `packages/db/src/venue-settings.ts`, `venue.ts`, `schema/tenants.ts`, `schema/catalogue/menu.ts`
(the `contentLanguages` table goes), `schema/venue-service/holidays.ts` (deleted), `schema/index.ts`,
`index.ts`, `classification.ts`, `testing/seed.ts`, `triggers/core.sql`;
`packages/catalogue/src/content-languages.ts`, `configuration-transfer.ts`, `classification.ts`;
`packages/venue-service/src/holidays.ts`, `configuration-transfer.ts`, `classification.ts`, `routes.ts:606`,
`index.ts`; `packages/media/src/configuration-transfer.ts`; `packages/module/src/module.ts:1477-1486`;
`packages/provisioning/src/configuration-transfer.ts`, `venue-apply.ts`,
`test/configuration-bundle.ts`; `apps/server/src/venue-settings-api.ts`, `catalogue-api.ts:956`,
`testing/clear-provision-fixture.ts` (`content_languages` leaves its list);
`apps/server/scripts/demo-seed/seed-catalogue.ts:104-111`; live-query files (item 8); tests:
`packages/db/src/tenancy.test.ts:80-100`, `packages/db/src/schema/orders.test.ts:592,605` (set-up),
`scripts/behavioural-triggers.test.ts`, the content-language, holiday and bundle suites, the raw-SQL
files 5b edited (their `settings` row gains `invoiceLocales`); guards `scripts/schema-constraints.test.ts:695`,
`scripts/live-subscriptions.test.ts`, `packages/composition/src/composition.test.ts`;
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, `testing/madrid-documents.ts`; docs:
`docs/superpowers/specs/2026-11-02-rationalisation/tables-venuebox.md` §2.4 and `tables-menu.md` §2
(dated correction), `docs/developers/conventions-data.md`.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| Receipt languages: field, writers, cases | ~40 + ~40 |
| Triggers (two new, four bodies) | ~60 |
| `behavioural-triggers.test.ts`, `tenancy.test.ts` | ~110 |
| Content languages | ~50 + ~50 |
| Holiday area | ~80 + ~70 |
| Bundle (export, import, validate context, two checks, format rows) | ~100 + ~80 |
| Madrid extension and its cases | ~40 + ~30 |
| Live types, guards, raw fixtures, spec notes, docs | ~70 |
| **Total** | **~920** |

## Finish line

1. Task 1's §8.2 numbers are in the pull request.
2. `pnpm exec vitest run scripts/behavioural-triggers.test.ts scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/live-subscriptions.test.ts scripts/migration-upgrade.test.ts` passes.
3. `pnpm --filter @waitron/db exec vitest run src/venue-settings.test.ts src/tenancy.test.ts src/schema/orders.test.ts` passes, with "a venue document with no invoiceLocales key is refused".
4. `pnpm --filter @waitron/catalogue exec vitest run src/content-languages.test.ts src/configuration-transfer.test.ts`,
   `pnpm --filter @waitron/venue-service exec vitest run src/holidays.test.ts src/configuration-transfer.test.ts`,
   `pnpm --filter @waitron/server exec vitest run src/configuration-import.test.ts src/configuration-transfer.test.ts src/first-fiscal-setup.e2e.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts` pass.
5. `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts` passes (browser:
   check free memory first, CLAUDE.md §2).
6. `git grep -n -P "l\.invoice_locales|locations\.invoiceLocales\b|holidayGeographies|\bcontentLanguages\b.*from\(contentLanguages\)" -- apps packages scripts ':!**/drizzle/**'`
   prints nothing; control: on the base it prints `packages/db/src/venue.ts:36` and `:68`.
7. The fiscal pair passes unedited.
8. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers; `waitron_change_*` lines only under `change-feed`; in the tool's order
(missing and changed by object name, then extras, `compare.ts:292-302`). Written from the schema
change, in 5a's simulated shapes.

```text
missing index holiday_geographies.primary key(id)
missing index holiday_geographies_location_place_key
missing table content_languages
missing table holiday_geographies
changed table locations.columnOrder
missing table locations.columns[invoice_locales]
missing table locations.checks[locations_invoice_locales_len]
missing trigger waitron_change_content_languages_delete
missing trigger waitron_change_content_languages_insert
missing trigger waitron_change_content_languages_update
missing trigger waitron_change_holiday_geographies_delete
missing trigger waitron_change_holiday_geographies_insert
missing trigger waitron_change_holiday_geographies_update
changed trigger waitron_change_locations_update.when
changed trigger working_order_lines_check_locales_insert.body
changed trigger working_order_lines_check_locales_update.body
changed trigger working_order_lines_check_variant_locales_insert.body
changed trigger working_order_lines_check_variant_locales_update.body
extra trigger settings_venue_invoice_locales_insert
extra trigger settings_venue_invoice_locales_update
```

(`holiday_geographies` keeps its `location_id` until here: 5a left it, since this slice deletes the
table.) Reasons: tables-venuebox §5 rows `locations_invoice_locales_len` and "four triggers";
tables-menu §4 for `content_languages`; tables-venuebox §4 for `holiday_geographies`. Lost by design:
the content-language CHECKs and the holiday city CHECK become code. `content_languages`' integer
primary key has no index, so no index line is expected for it.

## Stop points (beyond rules §5)

1. **§8.2's failing result:** the four triggers reading the document cost more than 10 ms across a
   2,001-line order. The design's fallback is a typed column (a one-row venue table); the watcher
   confirms before it is taken.
2. The `claimFrom: "preview"` setup row fails.
3. A content-language refusal changes code or words on import or on the screen.
4. A screen or route reads `HolidayGeography.id`.

## Assertions that change, by design

- `packages/db/src/tenancy.test.ts`'s "rejects an empty locale list" and "rejects three locales"
  (`:85-100`): still refused by the database, now by the `settings` trigger, so they assert
  `triggerRaised(error, "settings.invalid")` instead of `CHECK_VIOLATION` with
  `locations_invoice_locales_len` (tables-venuebox §5). They write a `venue` row through raw SQL.
- `scripts/behavioural-triggers.test.ts` (A1301 design §2.3):
  - "refuses a line whose order resolves to no location, in the same words" (`:1314-1320`) becomes
    "refuses a line on a box with no venue document, in the same words", in a database of its own
    with no `settings` row `venue`;
  - "refuses a line inserted under an order that does not exist" (`:885-894`) accepts either refusal
    today; it is tightened to `OPEN_PARENT_REFUSAL` alone (the language triggers no longer read the
    order), and its comment above loses the "TWO rules" sentence;
  - the two "reads the order's location, not its device's" cases are deleted — the descriptions one
    (`:1331-1340`) and the variant twin (`:1368-1383`) — with the `loc-es-only` seed lines (a
    second-location case);
  - the `loc-relocale` cases keep their purpose (a line written before the venue's languages change
    survives it): the one inside the served-exception group (`:1046`, "accepts a served mark on a
    settled line once its venue's invoice locales changed") and the `loc-relocale-text` group
    (`:1393-…`) move to a database of their own, a second `migratedDatabase()` seeded with the
    document at `["es","ca"]`, lines written, then
    `update settings set doc = json_set(doc, '$.invoiceLocales', json('["es"]')) where module = 'venue'`.
    The design let the plan choose between this and "the file's last case"; a database of its own
    does not depend on case order.
- Bundle-format rows: the new number, the old refused as outdated; content languages and the holiday
  area asserted at the top level, not as table rows.
- Content-language CHECK cases become `parse` cases with the same inputs.

---

### Task 1: Measure §8.2 first, on the base

Before any code (the measurement can change the design's choice).

- [ ] **Step 1:** In a throwaway worktree of the base commit (`git worktree add --detach <dir> <base>`,
  `pnpm install`), a scratch script outside the repository (pasted whole into the pull request) on
  `node:sqlite`: migrate a `venue.db` with `applyMigrations` (every manifest set), seed one tenant, one
  venue (its `locations` row with `invoice_locales '["es","ca"]'`, and a `settings` row `venue` holding
  the same list) and one open order.
- [ ] **Step 2:** Three variants on copies of that file, each one transaction inserting 2,001
  `working_order_lines` with two-language `descriptions`, 41 runs, median reported: (a) today's four
  triggers; (b) the four rewritten as item 3 says (drop and create in the copy); (c) the four dropped.
- [ ] **Step 3:** **Failing result:** (b) minus (c) is more than 10 ms. Say which machine ran it (the
  design asks for the reference micro PC; the design's Mac stand-in gave 4.3 ms for a document against
  3.9 ms for a typed row). A failing result is stop point 1. Otherwise continue.

### Task 2: Receipt languages and the triggers, test first

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:** in `venue-settings.test.ts`, "parse refuses `invoiceLocales` `[]`,
  three entries, a repeat, `[""]`, a string"; the re-pointed `tenancy.test.ts` cases plus "a venue
  document with no invoiceLocales key is refused" (`{"name":"V"}`) and the legitimate writes (one and
  two languages insert; an update keeping two is accepted, one emptying it refused);
  `venue-apply.test.ts` "re-applying with other receipt languages refuses `provisioning.second_venue`".
- [ ] **Step 3:** Schema (item 1), the two triggers and the four bodies (items 2, 3); rebuild core;
  writers; `seedVenueSettings`' default.
- [ ] **Step 4:** `behavioural-triggers.test.ts` as under "Assertions that change, by design"; its
  seed's `locations` insert loses `invoice_locales` and its `settings` row gains it; add the two new
  triggers to the file's pinned list (`:439`). `orders.test.ts:592,605`: set-up only.
- [ ] **Step 5:** Fixtures: re-run `venue-document-fixtures.mjs --move invoiceLocales=seedVenueSettings`
  over `$FILES` (5a), commit the output alone; hand-edit the raw-SQL `settings` rows.
- [ ] **Step 6:** Run Finish lines 2, 3. Commit.

### Task 3: Content languages

- [ ] **Step 1: Failing cases:** "parse refuses a default outside the list, a repeat, an empty list,
  201 entries, one of the two fields null alone"; in `content-languages.test.ts` "with nothing saved
  the fallback answers", "a save normalises the default first and keeps the venue's other fields",
  "the saver is named".
- [ ] **Step 2:** Item 5; delete the table, its classification and transfer entries; rebuild core.
  Run; commit.

### Task 4: The holiday area

- [ ] **Step 1: Failing cases** in `holidays.test.ts`: "a chosen area is read back at the same place";
  "an address moved to another city reads as no area chosen"; "clearing at a place with no choice
  writes nothing"; "the saver is named".
- [ ] **Step 2:** Item 6; delete the table and its entries; rebuild core. Run; commit.

### Task 5: The bundle

- [ ] **Step 1: Failing cases:** "an export carries content languages and the holiday area at the top
  level"; "the export's venue holds exactly the setup fields" (its keys equal `PreparedVenue`'s, so a
  document field cannot ride in); "an import refuses content languages missing the target's required
  language (`content.language_required`)"; "the previous format is refused as outdated".
- [ ] **Step 2:** Item 7. Update the bundle fixtures and format rows. Run Finish lines 4, 5. Commit.

### Task 6: Madrid, lists, docs, finish

- [ ] **Step 1:** Item 9, test first; item 8; guards; the spec notes; docs.
- [ ] **Step 2:** Backlog: "What A1308 retires" loses "`content_languages`: decide the remaining
  DELETE restriction (A805 follow-up)"; the A1301 entry loses the S8 `saveHolidayArea` note and the
  S5 `readVenueInvoiceLocales` note (A1301 plan, "Carried to the schema plan").
- [ ] **Step 3:** Protection list: compare, paste, mark.
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`.
