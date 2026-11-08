# A1308 slice 5g: Cloud assigns the venue's id, and `locations` goes — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order and
> shared words: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).
> The 1b-i API names: [5b](2026-11-08-a1308-5b-venue-document.md#the-api-this-slice-uses-slice-1b-i-exact-names).

**Lands: the owner** (rules §6):

- the Cloud half of S18e: the venue-id design makes S18e owner-landed by rule (c)
  ([design](../specs/2026-11-04-a1301-venue-id-design.md), "Who lands it");
- the live-venue guard moves to the `settings` row, and its readers include adoption
  (`apps/server/src/adopt.ts:131`) and the standby's identity step
  (`apps/server/src/reserved-identity.ts:68-69`): A1301 made that change owner-landed (design §3,
  "The live-venue guard": "S23, an owner slice because `adopt.ts` is on the adoption path").

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported; every box paired with Waitron Cloud pairs again." (rules §2; the
venue-id design, "A test box paired today").

**Needs before it:** 5f; **the Cloud lanes' change** (the design's "What Cloud must change", items
1–6), landed together with this pull request ("S18e (Waitron) and the Cloud change land together";
"Before go-live there is no compatibility period"). Waitron Cloud at `d13c34961` still checks
`localVenueId` as a UUID (`apps/portal/src/pairing-types.ts:11`), so that change has not been made.

## What it builds

1. **`settings.venue` gains `cloudVenueId: string | null`** (tables-venuebox §2.1, "The venue's id";
   the design's `cloud_venue` table folds into it, design "A1308"). Null means not connected. It is
   not part of `Venue` (`packages/db/src/venue.ts`), so the configuration export, which spreads
   `readVenue`'s fields into the bundle (`packages/provisioning/src/configuration-transfer.ts:112-137`),
   cannot carry it (design: "Configuration transfer does not carry it"). Two functions in
   `packages/db/src/venue.ts`: `readCloudVenueId(tx): Promise<string | null>` and
   `saveCloudVenueId(tx, venueId: string): Promise<void>` (through `saveVenueFields`, person null).
   A restore and a standby's copy carry it, because it is in `venue.db`.
2. **Pairing v2** (design "The venue's life", "At pairing"), in `apps/server/src/cloud-client.ts`:
   - the signed bytes become `waitron-cloud-pair-v2` (`:269-283`): the v1 fields with `localVenueId`
     replaced by the venue's Cloud id, or `""` when it has none;
   - `createCloudConnection`'s option `localVenueId` (`:48,75`) becomes
     `readVenueId: () => Promise<string | null>` and `recordVenueId: (venueId: string) => Promise<void>`;
     boot passes `readCloudVenueId` and `saveCloudVenueId` over `db` (`apps/server/src/boot.ts:3246-3252`);
   - on a successful pairing the primary writes `registration.venueId` with `recordVenueId` **before**
     it writes `cloud-connection.json` (venue database first, the pairing file after: the design's
     order, and CLAUDE.md §3's "save `venue.db` first … so a re-run repairs"). A box that is not the
     primary does not write it (design question 7: only the box that sells writes the row);
   - the saved state becomes `version: 2` holding `venueId` (`:80-84,535-545,674-676`). A saved file
     whose `venueId` differs from `readVenueId()`'s non-null answer is refused `cloud.state_invalid`
     (`:194-197`, `:221`), as today's check does for the location id; Cloud's answer must still echo
     the venue (`:122-134`, now `registration.venueId`);
   - **a version-1 file reads as "not connected"**, like a missing file (design "A test box paired
     today", recommended and approved): status, refresh, revoke and start (`:559-588`) answer
     "not connected", and the owner connects again from the dashboard, which overwrites the file.
3. **Replacement (test environment only)** (`apps/server/src/cloud-replacement.ts`): the saved file
   and the signed bytes drop `localVenueId` (`:28,44,56,95,205,229,246,284-296`), the bytes become
   `waitron-cloud-replacement-v2`, and a version-1 file reads as absent. Cloud's answer already
   carries its own `venueId`, checked against the registration (`:244,261-265`).
4. **The Cloud fixtures follow** (design, Cloud item 6): `apps/server/scripts/cloud-integration-fixture.ts:134-161`
   reports `venueId` instead of `localVenueId`; `cloud-recovery-client-fixture.ts:120,152-173` and
   `cloud-backup-fixture.ts:120,185` read the venue's name through `readVenue` and its Cloud id
   through `readCloudVenueId` instead of selecting from `locations`.
5. **The live-venue guard reads the `settings` row** (A1301 design §3: "an operational venue exists"
   means the `settings` row `venue` exists; 5b decided this is the same as `revision > 0`). In
   `packages/provisioning/src/tenant-guard.ts:22-35`: `readOperationalVenueIds` becomes
   `hasOperationalVenue(target: Pick<Database, "execute">): Promise<boolean>`
   (`select 1 from settings where module = 'venue' limit 1`); `assertSingleOperationalVenue(ids)`
   becomes `assertOperationalVenue(present: boolean)` and `assertNoOperationalVenue(present: boolean)`,
   both still refusing `provisioning.second_venue` (name and meaning kept, design §3). Readers:
   `adopt.ts:131`, `boot.ts:1121,1752`, `reserved-identity.ts:68` (the `mirror.venue_not_copied`
   refusal, S4, keeps its code), `reset-request.ts:62`,
   `packages/provisioning/src/first-setup-resolution-inspection.ts:93`. "Exactly one" becomes "the row
   exists": the primary key on `module` makes a second one impossible (design §3).
6. **Backup verification's venue check reads the row** (tables-venuebox §2.4, last paragraph):
   `verifyCoreBackupData` (`packages/db/src/backup-evidence.ts:258-275`) asks
   `select count(*) as n from settings where module = 'venue'` = 1; the compatibility check's table
   test (`apps/server/src/backup-verification-compatibility.ts:368`) asks for `settings` instead of
   `locations`.
7. **`locations` goes** (A1301 design S28: a plain drop once nothing points at it; 5a–5f removed every
   key into it), with `bump_mode` and `fire_control` (`packages/db/src/schema/tenants.ts`: `bumpMode`,
   `fireControlMode`, `locations`; A1301 design §2.1, and A773-2 PR D plan D113 for `fire_control`).
   The tests that still set `fire_control` lose those cases or lines: the list in
   `docs/backlog/kitchen.md:341-344` (`packages/db/src/schema/kitchen-courses.test.ts`,
   `apps/server/src/order-groups.test.ts:5930-5942`, `management-api.test.ts:3026-3044`,
   `till-api.test.ts:1641-1650`, `configuration-import.test.ts:96`,
   `packages/provisioning/src/configuration-transfer.boundaries.test.ts`) and the till fixtures that
   carry a `fireControl` key (`git grep -l -w fireControl -- apps/till`).
8. **`venueLocationId` goes** (A1301 design §6: "S28 deletes it with the last column"), with its last
   callers: `boot.ts:2095` (its value now reached only the Cloud connection, which item 2 replaced),
   `promote.ts:256-257` and `restore.ts:935-936` (interim second-venue refusals: they call
   `readVenueSettings` instead, which refuses `venue.not_found` when the copy holds no venue; a second
   venue cannot exist), the test helpers that still read it (`git grep -l -w venueLocationId`), and the
   two S18f helpers that hand out the venue row's id (`apps/server/test/hour-recovery-host.ts`'s `node`,
   `apps/server/src/testing/staged-hour-crash.ts` and its assertion in
   `restore-emergency-crash.e2e.test.ts`). `readVenue`'s `theOneRow` and its `provisioning.second_venue`
   branch (`venue.ts:54-58`) go: nothing can hold two venue rows. `seedVenue` stops writing `locations`
   (A1301 plan, "Carried to the schema plan"). Tests that insert a `locations` row under a fixed id
   that a backup, archive, `trading.env` or assertion names (the F-slice leftovers, backlog A1301
   entry) lose the insert: the venue has no row id any more.
9. **Committed scripts that only served the sweep are deleted:** `scripts/a1301-seed-codemod.mjs` and
   its test (A1301 plan, "Carried to the schema plan"), `scripts/a1308/drop-location-id.mjs`,
   `scripts/a1308/venue-document-fixtures.mjs` and their tests. Their receipts are in 5a–5f's pull
   requests.
10. **The done-check over the whole tree** (A1301 design §6, S18 and S28): see Finish line 4.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| Cloud's own changes (pairing v2, `venues.local_venue_id`, the approval screen, managed streams keyed by venue, recovery views, replacement v2, test scripts) | the Cloud lanes, landed together (design "What Cloud must change") |
| The privacy contact; renaming `tenants`, `tenant-guard.ts` and `provisioning.foreign_tenant` | venue and box (README U9) |
| Text and docs that still say "location" as prose (A1301 S19, landed) beyond those this slice's code touches | already swept by S19; any line the done-check shows is fixed here |

## Work beside this slice (rules §8)

- **#2543** (A951, remote staff access and the legacy relay) changes `apps/server/src/cloud-client.ts`,
  `cloud-api.ts`, `cloud-tunnel.ts`, `cloud-integration-fixture.ts` and `boot.ts`
  (`gh pr view 2543 --json files`, 2026-11-08). No table; a rebase, whichever lands second. If it
  changes the pairing state's shape, this slice builds on its shape.
- The Cloud lanes' pull request must be ready to land in the same window; the watcher schedules both.

## Files

```zsh
git grep -l -w -E "venueLocationId|readOperationalVenueIds|assertSingleOperationalVenue|assertNoOperationalVenue|localVenueId" -- apps packages scripts ':!*.md'
git grep -l -E "\blocations\b" -- apps packages scripts ':!**/drizzle/**' ':!*.md' ':!**/i18n/**' ':!**/guide/**'
git grep -l -i "insert into locations" -- apps packages scripts
```

Modify: `packages/db/src/venue-settings.ts`, `venue.ts`, `schema/tenants.ts`, `schema/index.ts`,
`index.ts`, `classification.ts:103`, `backup-evidence.ts`, `testing/seed.ts`;
`packages/provisioning/src/tenant-guard.ts`, `first-setup-resolution-inspection.ts`, `index.ts`;
`apps/server/src/cloud-client.ts`, `cloud-replacement.ts`, `adopt.ts`, `boot.ts`,
`reserved-identity.ts`, `reset-request.ts`, `promote.ts`, `restore.ts`,
`backup-verification-compatibility.ts`; `apps/server/scripts/cloud-integration-fixture.ts`,
`cloud-recovery-client-fixture.ts`, `cloud-backup-fixture.ts`, `dev-setup.ts:184-193` (it looks for
`locations` in `sqlite_master`: look for `settings`), `demo-seed/testing/madrid-semantics.ts:145`;
the dashboard live-query lists if any `"locations"` entry is left (5d removed them);
`apps/server/src/testing/clear-provision-fixture.ts:54`; the tests named in items 7 and 8; the 18
raw-SQL files 5b edited (their `locations` inserts go);
`apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts` (a transform for a table dropped with
rows: `REMOVED_TABLES` requires the dropped table to have held none, `:125-130`, and the capture's
`provisioned` and `seeded` phases hold one `locations` row — A1301 plan, "Carried to the schema
plan"); guards `scripts/schema-constraints.test.ts`, `scripts/no-tenant-column.test.ts` (unchanged),
`scripts/write-path-tables.json` (no entry for `locations` today: check).

Delete: item 9's scripts; `packages/db/src/schema/location-*` remnants if any.

Docs: `docs/backlog/architecture.md` (the A1301 entry is finished and deleted; "What A1308 retires"
loses "`locations`: decide the remaining DELETE restriction (A805 follow-up)"); a dated pointer at the
top of the A1301 design, its plan, the S18 plan and the venue-id design ("2026-11-xx: built by A1308
slice 5, parts 5a–5g; see those plans"), since historical docs are not rewritten (CLAUDE.md §6);
`docs/developers/conventions-data.md` lines that still name `locations` (read each hit of
`git grep -n -w locations docs/developers`); the Cloud follow-up note
(`~/waitron-campaign/a1301/cloud-followup.md`, outside the repository) marked done.

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| `cloudVenueId` field and its two functions, cases | ~30 + ~40 |
| Pairing v2, the v1 file as not connected, the file check, the record-before-file order (code, cases) | ~120 + ~160 |
| Replacement v2 (code, cases) | ~40 + ~50 |
| Cloud fixtures | ~40 |
| Live-venue guard and its six readers, cases | ~50 + ~50 |
| Backup verification's venue check, compatibility table test | ~10 + ~20 |
| `locations` drop: `readVenue` without `theOneRow`, `seedVenue`, interim refusals, raw fixtures, Madrid transform | ~60 + ~90 |
| Docs and pointers | ~30 |
| **Total** | **~790** |

Not counted: deleted tests and lines (`fire_control` cases, fixed-id `locations` inserts, the
scripts), regenerated files.

## Finish line

1. The fiscal pair passes unedited.
2. `pnpm --filter @waitron/server exec vitest run src/cloud-client.test.ts src/cloud-replacement.test.ts src/cloud-api.test.ts src/adopt.test.ts src/reserved-identity.test.ts src/reset-request.test.ts src/boot.test.ts src/promote.test.ts src/restore.test.ts src/backup-verification-compatibility.test.ts src/first-fiscal-setup.e2e.test.ts` passes, with:
   - "pairing signs v2 with an empty venue id and records Cloud's id before the pairing file";
   - "pairing again presents the venue's Cloud id";
   - "a version-1 pairing file reads as not connected";
   - "a pairing file naming another venue is refused `cloud.state_invalid`";
   - "a mirror does not record the venue id".
3. `pnpm --filter @waitron/provisioning exec vitest run src/tenant-guard.db.test.ts src/first-setup-resolution-inspection.test.ts` and
   `pnpm --filter @waitron/db exec vitest run src/backup-evidence.test.ts src/venue-settings.test.ts` pass.
4. **The whole-tree done-check** (the A1301 S18 plan's grep, widened to the generated folders it
   left out, A1301 design §6):

   ```zsh
   P='(^|[^A-Za-z])[Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_])|[a-z]Location'
   git grep -n -E "$P" -- 'apps/**' 'packages/**' 'scripts/**' ':!*.md' ':!packages/country-es/test-fixtures/**'
   git grep -n -w venueLocationId -- apps packages scripts        # prints nothing
   git grep -n -w localVenueId -- apps packages scripts           # prints nothing
   ```

   Read every line the first prints. Each must be a word that is not Waitron's location (the S18
   plan's table "What was measured", for example `location.reload()`, `ServerKeyLocation`), or product
   text using "location" in another sense. Anything else is unfinished: finish it here or stop.
5. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/live-subscriptions.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/errors-reachable.test.ts scripts/no-till-as-issuer.test.ts` passes (`scripts/no-till-as-issuer.mjs`' ban on `WAITRON_LOCATION_ID` stays, A1301 design §5).
6. The Cloud lanes' integration script passes against this branch (their item 6), run by the
   watcher before both land.
7. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers, except `waitron_change_*` lines (change-feed only). Written from the
schema change and the tool's naming.

```text
missing table locations
missing index locations.primary key(id)
missing trigger waitron_change_locations_delete
missing trigger waitron_change_locations_insert
missing trigger waitron_change_locations_update
```

Reason: A1301 design §4 and S28 (`locations` dropped); tables-venuebox §4 row `locations`. Its two
CHECKs (`locations_bump_mode_ck`, `locations_fire_control_ck`) leave inside the missing table: they
guarded columns read by nothing (tables-venuebox §5).

## Stop points (beyond rules §5)

1. The Cloud lanes' change is not ready: everything in this slice except items 1–4 can be built and
   committed; the pull request is not opened until both can land together.
2. The done-check prints a line that is Waitron's location and is not on this plan's files list.
3. A restore, promotion or adoption case changes its refusal code.
4. #2543 changed the pairing state in a way item 2 does not fit.

## Assertions that change, by design

- Pairing cases: v2 bytes, `venueId` instead of `localVenueId`, the v1 file reading as not connected
  (design "At pairing", "A test box paired today").
- Guard cases assert on a boolean "a venue row exists" instead of a list of ids; the refusal codes
  stay (design §3).
- `verifyCoreBackupData`'s venue case counts the `settings` row.
- `readVenue`'s "two venue rows refuse `provisioning.second_venue`" case is deleted: two venue rows
  cannot exist (primary key on `module`, design §3). Boot's own `provisioning.second_venue` refusal
  keeps its code for a missing venue row only through `assertOperationalVenue`.
- `fire_control` cases deleted (D113).

---

### Task 1: The guard and backup verification, test first

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases** in `packages/provisioning/src/tenant-guard.db.test.ts`: "a database
  with the venue document has an operational venue"; "one with none has not"; adoption's case
  "adoption onto a box with a venue document is refused `provisioning.second_venue`"; boot's "a start
  with no venue document refuses `provisioning.second_venue`" (both today's codes).
- [ ] **Step 3:** Item 5's functions and six readers; item 6. Run; pass. Commit.

### Task 2: `cloudVenueId` and pairing v2

- [ ] **Step 1: Failing cases** (Finish line 2's five, plus "the export carries no Cloud id").
- [ ] **Step 2:** Items 1, 2; boot's wiring. Run; pass. Commit.

### Task 3: Replacement and fixtures

- [ ] **Step 1:** Failing cases for replacement v2 and the v1 file read as absent; item 3; item 4.
  Run; commit.

### Task 4: `locations` goes

Split point for a fresh implementer.

- [ ] **Step 1:** Delete `locations`, `bumpMode`, `fireControlMode` from the schema; rebuild core.
- [ ] **Step 2:** Item 8 (accessor, seed, interim refusals, helpers, fixed-id inserts), item 7's
  tests, the 18 raw-SQL files, the Madrid transform.
- [ ] **Step 3:** Item 9 (delete the scripts). Run Finish lines 3–5. Commit.

### Task 5: Docs, done-check, finish

- [ ] **Step 1:** Backlog (delete the A1301 entry; update A1308's "Open" and the build-order row
  "5a–5f" → done), the dated pointers, conventions-data.
- [ ] **Step 2:** Finish line 4's done-check; fix or stop on each line.
- [ ] **Step 3:** Protection list: compare, paste, mark.
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`. The owner lands it with the Cloud
  lanes' pull request.
