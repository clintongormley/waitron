# A1308 slice 5b: the venue document — name and address — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order, its
> shared words and how a committed script run is re-run by the reviewer are in
> [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).

**Lands:** the lane (rules §6). The venue's name and address are printed on receipts and invoices,
but neither is sent to AEAT or hashed: the issuer AEAT receives is the taxpayer row
(`tenants.legal_name`, `tax_id`). No caller of `readVenue` changes, only where it reads from.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

**Needs before it:** 5a; slice 1b-i (the `settings` table and API,
[plan](2026-11-08-a1308-1b-settings-table.md)) and 1b-ii (documents in the configuration export,
[plan](2026-11-08-a1308-1b-ii-adjustments-settings.md)).

## The API this slice uses (slice 1b-i, exact names)

`defineSettingsDocument`, `readSettings`, `saveSettings`, `SettingsDocument`, `SettingsRead`,
`SettingsChange`, the table `settings` (`module`, `version`, `revision`, `doc`, `updated_at`,
`updated_by`), the codes `settings.out_of_date` and `settings.invalid` (`{ module, field }`),
`settingsChangeType(module)` (`settings.<module>`), the descriptor seat `WaitronModule.settings`,
and `liveResourceTypes(sources, settingsModules)`. Per 1b-i: an absent row reads as the
definition's `defaults()` at revision 0, and a per-module database rule is a pair of triggers in
`packages/db/triggers/core.sql` named `settings_<module>_<rule>_insert` / `_update`,
`before insert` / `before update of doc on settings`, `when new.module = '<module>'`,
`raise(abort, '<code>')`, matched with `triggerRaised` (1b-i Task 5). Per the coordinator
(2026-11-08), 1b ships no document-upgrade step before go-live: `readSettings` refuses a stored
version other than the definition's with `settings.invalid` (field `version`). A name here that
differs on `main` is a stop (rules §5.1).

## What it builds

1. **`settings.venue`, version 1, owned by core** (tables-venuebox §2.1), in a new file
   `packages/db/src/venue-settings.ts`:

   ```ts
   export interface VenueSettings {
     name: string;                    // trimmed, not empty
     addressLine1: string | null;
     addressLine2: string | null;
     postalCode: string | null;
     city: string | null;
     province: string | null;
   }
   export const VENUE_SETTINGS: SettingsDocument<VenueSettings>; // module "venue", version 1, transfers: false
   ```

   `transfers: false`: the venue's fields travel in the bundle's `venue` field, not as a document
   (tables-venuebox §2.4). 5c, 5d and 5g add fields (receipt languages, content languages, the
   holiday area; fiscal territory and operation description; Cloud's venue id and the stream id).
   Each of those slices resets every venue, so the version stays 1 until go-live (README §6).

   **`defaults()`, decided:** `{ name: "", addressLine1: null, addressLine2: null, postalCode: null,
   city: null, province: null }` — a document `parse` refuses and nothing serves: every reader goes
   through `readVenueSettings` (item 2), which answers `venue.not_found` at revision 0.
   **"An operational venue exists" means "the `settings` row `venue` exists", the same as
   `readSettings(…, VENUE_SETTINGS).revision > 0`** (tables-venuebox §2.1; A1301 design §3). The
   live-venue guard switches to it in 5f; this slice only writes the row.
2. **The accessor reads it** (`packages/db/src/venue.ts`). `Venue` keeps every field it has
   (`venue.ts:9-24`); `readVenue` merges the document's six fields with the `locations` columns that
   have not moved yet (`invoice_locales`, `operation_description`, `fiscal_territory`, `time_zone`,
   `day_cutover`, `catalogue_id`). `readVenueClockAndPlace`'s place (`:78-116`) takes `province` and
   `city` from the document; its clock still reads `locations` until 5d. Refusals stay today's: no
   venue → `venue.not_found`; two `locations` rows → `provisioning.second_venue` (`:54-58`). New
   exports:

   ```ts
   export async function readVenueSettings(tx: Transaction): Promise<SettingsRead<VenueSettings>>; // venue.not_found at revision 0
   export async function saveVenueFields(tx: Transaction, fields: Partial<VenueSettings>, personId: string | null): Promise<void>;
   export async function createVenueSettings(tx: Transaction, doc: VenueSettings, personId: string | null): Promise<void>; // expectedRevision 0; setup only
   ```

   `saveVenueFields` reads, merges and saves with the revision it read, in one transaction under the
   venue file's one write lock (`packages/db/src/tenancy.ts:35`), for writers that today
   `update locations set …` with no revision of their own.
3. **Writers:**
   - first setup (`packages/provisioning/src/venue-apply.ts:244-327`, `create-venue`): calls
     `createVenueSettings` with the request's six fields and `personId: null`; the `locations` insert
     keeps only the columns that have not moved; the re-apply comparison (`:284-295`) reads the six
     fields from `readVenueSettings`;
   - venue details (`apps/server/src/venue-details.ts:240-271`): the delta's `name`, address,
     `province` and `city` keys go to `saveVenueFields(tx, …, personId)` with the signed-in person;
     `timeZone` still updates `locations` until 5d;
   - the test seeds (`packages/db/src/testing/seed.ts:39-55`): `seedVenue` writes the document and
     the `locations` row. **New `seedVenueSettings(db, overrides = {})`, decided: it creates the venue
     document from defaults plus `overrides` when none exists, and when one exists it overwrites only
     the fields `overrides` names** (through `saveVenueFields`). Defaults: `name: "Test venue"`, the
     address fields null. fiscal-verifactu's seed (`packages/fiscal-verifactu/src/testing/seed.ts:72-81`)
     calls it after its insert.
4. **The bucket restore keeps a clean refusal** (backlog A1301 entry: "A bucket restore reads the
   venue from the downloaded copy before any migration runs"). `readRestoredVenue`
   (`apps/server/src/restore-stream.ts:205-229`) checks `sqlite_master` for the `settings` table
   first, as `readRestoredCopy` does for `node_sealed_state` (`:248-251`), and maps a missing table,
   `venue.not_found`, `provisioning.second_venue` and `settings.invalid` to
   `restore.identity_unknown { nodeId }`. A copy from before this reset is refused that way; with no
   upgrade step before go-live (README §6), so is a copy holding another document version.
5. **The scripts and fixtures that read the venue's name from `locations`** read `readVenue`:
   `apps/server/scripts/cloud-backup-fixture.ts:120,185` and `cloud-recovery-client-fixture.ts:120`
   (the server's typecheck includes `scripts/`). `apps/server/src/testing/clear-provision-fixture.ts:54-…`
   clears `settings` as well (before `tenants`), or the next setup in the same database is refused
   `settings.out_of_date`.
6. **`scripts/a1301-seed-codemod.mjs` and its test are retired** (deleted): F1–F5 finished their
   job, its rules assume `locations` holds the venue's name, and patching it would only keep a dead
   tool alive. The A1301 plan gave it to S28; it goes here instead. Pure deletion.
7. **The Madrid capture gains a "columns into a document" transform** (the capture is frozen, A1301
   plan "Carried to the schema plan"): a new `apps/server/scripts/demo-seed/testing/madrid-documents.ts`
   (with its test) takes named columns of a captured table's one row, removes them from the row and
   the column list, and builds the expected `settings` row (`module`, `version`, `revision`, `doc`)
   from their values, in each phase whose capture holds the row (`provisioned`, `seeded`). `settings`
   leaves `ADDED_TABLES` (1b-i put it there with zero rows). `updated_at` and `updated_by` are
   compared the way `madrid-semantics.ts` already treats generated values (read its normalisation,
   `:270-311`, first); if it compares them literally, stop (stop point 4). 5c, 5d and 5e extend this
   transform.
8. Housekeeping (rules §9): core's descriptor declares `settings: [VENUE_SETTINGS]`
   (`packages/composition/src/modules.ts:151-161`); every dashboard query that depends on
   `"locations"` gains `"settings.venue"` beside it — `"locations"` stays until 5d, which still writes
   the clock there.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| Receipt languages, the four language triggers, the §8.2 timing; content languages; the holiday area | 5c |
| The default menu | 5e |
| Fiscal territory, operation description, time zone, day start | 5d (owner) |
| The privacy contact (`tenants.privacy_*` → `settings.venue`, tables-venuebox §2.1) | venue and box: it changes the taxpayer row, which that slice renames (README U9) |
| The live-venue guard and `verifyCoreBackupData`'s venue count | 5f (owner) |
| Cloud's venue id | 5g |

## Files

```zsh
git grep -l 'insert(locations)' -- '*.test.ts' | wc -l          # 90 test files (110 lines) at a086eedfb7
git grep -l 'insert(locations)' -- ':!*.test.ts' ':!docs/**'    # helpers and sources
git grep -l -i 'insert into locations' -- apps packages scripts  # 18 raw-SQL files
```

Create: `packages/db/src/venue-settings.ts` (+ test); `scripts/a1308/venue-document-fixtures.mjs`
(+ test, Task 3); `apps/server/scripts/demo-seed/testing/madrid-documents.ts` (+ test).

Modify: `packages/db/src/venue.ts`, `index.ts`, `schema/tenants.ts` (`locations` loses `name` and
the five address columns), `testing/seed.ts`; `packages/fiscal-verifactu/src/testing/seed.ts`;
`packages/provisioning/src/venue-apply.ts`; `apps/server/src/venue-details.ts`, `restore-stream.ts`,
`testing/clear-provision-fixture.ts`; `apps/server/scripts/cloud-backup-fixture.ts`,
`cloud-recovery-client-fixture.ts`; `packages/composition/src/modules.ts`; the live-query lists
(`apps/dashboard/src/api/live-queries.ts` entries `:195,215,227,291,335,372,496,498,506,510,518,519`,
`apps/dashboard/src/screens/department-receipt-editor.ts:268`, `packages/adjustments/src/dashboard/live-queries.ts:10,20`,
and the `"locations"` entries of the venue-service and workforce dashboard `live-queries.ts`); the
server helpers that insert `locations` (`apps/server/src/testing/boot-harness.ts:57,333`,
`backup-verification-fixture.ts:187`, `handover-placed-copy.ts:158,187`, `allocated-contract.ts:86`,
`zone-process-child.ts:42`, `zone-offers.ts:122`) and `packages/fiscal-verifactu/test/fixtures.ts`,
`drain-fixtures.ts`, `packages/reporting/test/fixtures.ts`, `packages/workforce/test/fixtures.ts`
(script targets); the 18 raw-SQL files (hand edits); `scripts/schema-constraints.test.ts` if it
lists `locations` columns; `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`; docs
(`docs/developers/conventions-data.md`: the venue's name and address live in `settings.venue`).

Delete: `scripts/a1301-seed-codemod.mjs`, `scripts/a1301-seed-codemod.test.mjs`.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| `venue-settings.ts` and its cases | ~70 + ~90 |
| `venue.ts` and its cases | ~70 + ~50 |
| Writers (setup, details, seed helpers) and their cases | ~90 + ~60 |
| Restore read and its cases | ~15 + ~30 |
| Fixture script and its test | ~110 + ~90 |
| Raw-SQL fixtures (each gains a `settings` insert) | ~60 |
| Madrid "into a document" transform and its test | ~60 + ~40 |
| Cloud fixtures, clear fixture, live lists, descriptor, docs | ~60 |
| **Total** | **~895** |

Not counted: the fixture script's output, deletions (the retired codemod), regenerated files.

## Finish line

1. `pnpm --filter @waitron/db exec vitest run src/venue-settings.test.ts src/testing` passes.
2. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/live-subscriptions.test.ts scripts/write-path-tables.test.ts scripts/migration-upgrade.test.ts scripts/a1308/venue-document-fixtures.test.mjs` passes.
3. `pnpm --filter @waitron/server exec vitest run src/venue-details.test.ts src/restore-stream.test.ts src/recovery-backup-preview.older.test.ts src/first-fiscal-setup.e2e.test.ts scripts/demo-seed/seed.madrid-baseline.test.ts`, `pnpm --filter @waitron/server typecheck` and
   `pnpm --filter @waitron/provisioning exec vitest run src/venue-apply.test.ts` pass.
4. `git grep -n -P "locations\.(name|addressLine1|addressLine2|postalCode|city|province)\b" -- apps packages scripts ':!**/drizzle/**'`
   prints nothing. Control, run on the base first: it prints `packages/db/src/venue.ts:35` and the
   other lines this slice changes (a pattern that prints nothing on the base checks nothing).
5. The fiscal pair passes unedited (A1301 plan, "The fiscal pair").
6. The reviewer's re-run of the fixture script gives the output commit (5a, "The location sweep, in
   one place").
7. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six `DIFF … database=venue` headers, except the `waitron_change_*` line (the two
`change-feed` headers only), in the tool's order (missing and changed objects by name, then extras:
`apps/server/scripts/protection-list/compare.ts:292-302`; a table's fields in the order
`canonicalTable` lists them, `:72-129`). Written from the schema change, in 5a's simulated shapes.

```text
changed table locations.columnOrder
missing table locations.columns[name]
missing table locations.columns[address_line1]
missing table locations.columns[address_line2]
missing table locations.columns[postal_code]
missing table locations.columns[city]
missing table locations.columns[province]
changed trigger waitron_change_locations_update.when
```

Reason: the columns leave `locations` for `settings.venue` (tables-venuebox §2.1, §4 row
`locations`). The `settings` table does not change.

## Stop points (beyond rules §5)

1. A 1b-i name above is missing or different on `main`.
2. A caller of `readVenue` outside the files listed needs a change.
3. `apps/server/src/first-fiscal-setup.e2e.test.ts`'s `claimFrom: "preview"` row fails: the bundle's
   `venue` must keep exactly its keys (CLAUDE.md §3).
4. The Madrid test compares `settings.updated_at` or `updated_by` literally (item 7).

## Assertions that change, by design

- Cases that inserted a `locations` row with a name or address now give those to
  `seedVenueSettings`; what they read back is the same (tables-venuebox §2.1).
- The Madrid comparison expects a `settings` row `venue` in the `provisioned` and `seeded` phases
  (the capture's `locations` values, moved).

---

### Task 1: The document and the accessor, test first

- [ ] **Step 1:** Base protection list (rules §3), in a throwaway worktree of the base commit.
- [ ] **Step 2: Failing cases** in `venue-settings.test.ts` (`useVenueDb({ migrations: [CORE_MIGRATIONS] })`):
  - "parse refuses each bad field": `name` `""` and `"  "`; an address field that is a number — each
    answers `{ ok: false, field: <that field> }`; a valid document answers `ok: true`, `name` trimmed;
  - "defaults are a document parse refuses" (the decision, pinned);
  - "readVenue with no venue document answers venue.not_found" (a `locations` row alone is not a
    venue any more);
  - "readVenue merges the document with the columns that have not moved";
  - "saveVenueFields keeps the fields it was not given and names the saver" (a person created first,
    rules §4; `revision` rises by one);
  - "createVenueSettings refuses a second venue document" (`settings.out_of_date`, revision 1);
  - "seedVenueSettings creates the document, then overwrites only the fields it is given".
- [ ] **Step 3:** Run; fail. Write `venue-settings.ts` and the accessor (item 2); export; the
  descriptor seat. Run; pass. Commit.

### Task 2: The schema and the writers

- [ ] **Step 1: Failing cases:** `venue-apply.test.ts` "first setup writes the venue document";
  "re-applying the same request reuses the venue"; "re-applying with another name refuses
  `provisioning.second_venue`"; `venue-details.test.ts` "a name save writes the document and names
  the person"; `restore-stream.test.ts` "refuses a copy with no venue document as an unknown
  identity" and "refuses a copy from before the settings table" (the table dropped in the scratch
  copy).
- [ ] **Step 2:** Schema: the six columns leave `locations`. Rebuild core
  (`pnpm --filter @waitron/server migration-baseline rebuild --set core`). Writers (item 3), restore
  (item 4), the scripts and clear fixture (item 5). Delete the retired codemod (item 6).
- [ ] **Step 3:** Run; pass. Commit (the tree does not typecheck until Task 3's fixtures; this is the
  commit the reviewer re-runs the script from).

### Task 3: Fixtures

Split point for a fresh implementer.

The script (structure as 5a's: `createSourceFile`, position splices, no reprint, `--write`, a
report, the fiscal pair skipped, idempotent):

```text
node scripts/a1308/venue-document-fixtures.mjs --move <field,…>=<helper> [--move …] [--write] <file…>
```

Rules, decided:

- For each statement `await <x>.insert(locations).values(<object literal>)`, **an
  `await <helper>(<x>, { … })` statement is always inserted directly after it for every `--move`
  helper, with an empty object when none of that helper's properties is present** (tests that rely on
  a column default still get the document). The properties named for a helper leave the literal and
  go into its object. If a call to that helper already follows the insert, the properties merge into
  it and no second call is added.
- **A file with more than one `insert(locations)`** (a second-location case 5a or 5e removes): only
  the first insert gets helper calls; from the others the moved properties are deleted, and each is
  reported.
- The helper's import is added from `@waitron/db/testing/seed.js`, or extended, when missing.
- A `values` that is not an object literal, or a property with a spread or computed key, is
  reported, not edited.

This slice runs it as `--move name,addressLine1,addressLine2,postalCode,city,province=seedVenueSettings`;
5c and 5d re-run it with their own fields.

- [ ] **Step 1: Failing tests:** a move into a new call; an empty call when nothing moves; a merge
  into an existing call; an import added; the second insert in a file stripped and reported; a spread
  reported; a second run changes nothing; the fiscal pair untouched.
- [ ] **Step 2:** Write the script; run the test; read its coverage row (root coverage, 98/98/98/95).
  Commit.
- [ ] **Step 3:** Run it over 5a's `$FILES` list, prettier on the touched files, commit the output
  alone.
- [ ] **Step 4:** Hand-edit what it reported and the 18 raw-SQL files: each raw
  `insert into locations (…)` loses the moved columns and is followed by
  `insert into settings (module, version, revision, doc, updated_at) values ('venue', 1, 1, '<that file's values as JSON>', '<the file's timestamp>')`.
  List them in the pull request (rules §1).
- [ ] **Step 5:** Run the touched suites by package (check free memory first). Commit.

### Task 4: Madrid, lists, docs, finish

- [ ] **Step 1:** Test first for `madrid-documents.ts` (moves named columns of a one-row table into a
  document row; refuses a table with two rows; leaves other columns), then the transform and its use
  in `seed.madrid-baseline.test.ts` (item 7).
- [ ] **Step 2:** Live-query lists (item 8), docs.
- [ ] **Step 3:** Backlog, A1301 entry: delete "A bucket restore reads the venue from the downloaded
  copy …" (item 4 settles it for this reset; after go-live the upgrade rule covers it).
- [ ] **Step 4:** Protection list: list `B`, compare with `A`, paste and mark (rules §3).
- [ ] **Step 5:** `pnpm format:check`; commit; `/finish-branch`.
