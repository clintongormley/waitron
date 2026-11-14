# A1308 slice 5h: `locations` and `venueLocationId` go — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order and
> shared words: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).

**Lands:** the lane (rules §6). Every value on a fiscal path left `locations` in 5d, the restore and
promotion refusals moved in 5f, and the Cloud and bucket ids in 5g. What is left reads the table only
for its id, which nothing uses any more.

**Pull request's first line:** "Every venue is reset: core; backups and exports from before this
cannot be restored or imported." (rules §2).

**Needs before it:** 5g (it removed `boot.ts:2095`, the last product reader of `venueLocationId`).

## What it builds

1. **`locations` goes** (A1301 design S28: a plain drop once nothing points at it; 5a–5f removed every
   key into it), with `bump_mode` and `fire_control` (`packages/db/src/schema/tenants.ts`: `bumpMode`,
   `fireControlMode`, `locations`; A1301 design §2.1; A773-2 PR D plan D113 for `fire_control`). The
   tests that still set `fire_control` lose those cases or lines: the list in
   `docs/backlog/kitchen.md:341-344` (`packages/db/src/schema/kitchen-courses.test.ts`,
   `apps/server/src/order-groups.test.ts:5930-5942`, `management-api.test.ts:3026-3044`,
   `till-api.test.ts:1641-1650`, `configuration-import.test.ts:96`,
   `packages/provisioning/src/configuration-transfer.boundaries.test.ts`) and the till fixtures that
   carry a `fireControl` key (`git grep -l -w fireControl -- apps/till`).
2. **`venueLocationId` goes** (A1301 design §6: "S28 deletes it with the last column"), with its test
   helpers' reads (`git grep -l -w venueLocationId`) and the two S18f helpers that hand out the venue
   row's id (`apps/server/test/hour-recovery-host.ts`'s `node`, `apps/server/src/testing/staged-hour-crash.ts`
   and its assertion in `restore-emergency-crash.e2e.test.ts`). `readVenue`'s `theOneRow` and its
   `provisioning.second_venue` branch (`packages/db/src/venue.ts:54-58`) go: nothing can hold two venue
   rows. `seedVenue` and `seedVenueSettings` stop writing `locations` (A1301 plan, "Carried to the schema
   plan"). Tests that insert a `locations` row under a fixed id that a backup, archive, `trading.env` or
   assertion names (the F-slice leftovers, backlog A1301 entry) lose the insert, and the raw-SQL files 5b
   edited lose their `locations` insert. `fiscal-verifactu`'s seed loses its insert.
3. **Places that look for the table** look for `settings`: `apps/server/scripts/dev-setup.ts:184-193`,
   `apps/server/scripts/demo-seed/testing/madrid-semantics.ts:145`,
   `apps/server/src/testing/clear-provision-fixture.ts:54`; classification (`packages/db/src/classification.ts:103`).
4. **The committed sweep scripts are deleted**: `scripts/a1308/drop-location-id.mjs`,
   `venue-document-fixtures.mjs`, `drop-argument.mjs` and their tests (their receipts are in 5a–5f-ii).
5. **Madrid:** the capture's `provisioned` and `seeded` phases hold one `locations` row, and
   `REMOVED_TABLES` requires a dropped table to have held none (`seed.madrid-baseline.test.ts:129-135`),
   so a "removed with rows" mode is added beside it (test first): the table leaves the expected phases
   whatever it held, and only the tables the test names may.
6. **The whole-tree done-check** (A1301 design §6, S18 and S28; Finish line 3).

## What it leaves out

| Left out | Taken by |
| --- | --- |
| The privacy contact; renaming `tenants`, `tenant-guard.ts`, `provisioning.foreign_tenant` | venue and box (README U9) |

## Files

```zsh
git grep -l -E "(^|[^A-Za-z])locations([^A-Za-z]|$)" -- apps packages scripts ':!**/drizzle/**' ':!*.md' ':!**/i18n/**' ':!**/guide/**'
git grep -l -w -E "venueLocationId|fireControl|fire_control|bumpMode" -- apps packages scripts ':!**/drizzle/**'
```

Modify: `packages/db/src/schema/tenants.ts`, `schema/index.ts`, `index.ts`, `classification.ts`,
`venue.ts`, `testing/seed.ts`; `packages/fiscal-verifactu/src/testing/seed.ts`; item 3's files; the tests
named in items 1–2; `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`; guards
`scripts/schema-constraints.test.ts`; `scripts/no-till-as-issuer.mjs` stays (its ban on
`WAITRON_LOCATION_ID` still bans a variable no one should add, A1301 design §5).

Delete: item 4's scripts.

Docs: `docs/backlog/architecture.md` (the A1301 entry is finished and deleted; "What A1308 retires" loses
"`locations`: decide the remaining DELETE restriction (A805 follow-up)"; A1308's entry and its build
order row record slice 5 done); a dated pointer at the top of the A1301 design, its plan, the S18 plan
and the venue-id design ("built by A1308 slice 5, parts 5a–5h; see those plans"), since historical docs
are not rewritten (CLAUDE.md §6); `docs/developers/conventions-data.md` lines that still name
`locations` (read each hit of `git grep -n -w locations docs/developers`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| `readVenue` without `theOneRow`, seeds, item 3 | ~50 |
| Fixed-id and raw `locations` inserts replaced by `seedVenue` where a test still needs a venue | ~80 |
| Madrid "removed with rows" mode and its cases | ~30 + ~30 |
| Docs and pointers | ~40 |
| **Total** | **~230** |

Not counted: deletions (the `fire_control` cases, the scripts, `venueLocationId`, most `locations`
inserts), regenerated files.

## Finish line

1. The fiscal pair passes unedited.
2. `pnpm exec vitest run scripts/schema-constraints.test.ts scripts/classification-complete.test.ts scripts/starting-migrations.test.ts scripts/append-only-triggers.test.ts scripts/behavioural-triggers.test.ts scripts/live-subscriptions.test.ts scripts/migration-upgrade.test.ts scripts/two-file-foreign-keys.test.ts scripts/errors-reachable.test.ts scripts/no-till-as-issuer.test.ts` and
   `pnpm --filter @waitron/server exec vitest run scripts/demo-seed/seed.madrid-baseline.test.ts src/order-groups.test.ts src/till-api.test.ts src/management-api.test.ts src/configuration-import.test.ts src/restore-emergency-crash.e2e.test.ts` pass.
3. **The whole-tree done-check** (the A1301 S18 plan's grep, anchored so that `allocationId` and
   `AllocationContext` in the fiscal module, about 1,389 lines, do not match):

   ```zsh
   P='(^|[^A-Za-z])([Ll]ocations?([^A-Za-z]|$)|[Ll]ocation(Id|_id|Name|[A-Z_]))|[a-z]Location'
   git grep -n -E "$P" -- 'apps/**' 'packages/**' 'scripts/**' ':!*.md' ':!packages/country-es/test-fixtures/**'
   git grep -n -w venueLocationId -- apps packages scripts        # prints nothing
   ```

   Control for the anchor: `print -r -- 'const allocationId = 1' | grep -E "$P"` prints nothing and
   `print -r -- 'const locationId = 1' | grep -E "$P"` prints the line (use `/usr/bin/grep`: the shell's
   `grep` is a function, CLAUDE.md global). Read every line the first command prints. Each must be a
   word that is not Waitron's location (the S18 plan's table "What was measured": `location.reload()`,
   `ServerKeyLocation` and the like) or product text using "location" in another sense. Anything else
   is unfinished: finish it here or stop.
4. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers, except `waitron_change_*` lines (change-feed only), in the tool's order.

```text
missing index locations.primary key(id)
missing table locations
missing trigger waitron_change_locations_delete
missing trigger waitron_change_locations_insert
missing trigger waitron_change_locations_update
```

Reason: A1301 design §4 and S28; tables-venuebox §4 row `locations`. Its two CHECKs
(`locations_bump_mode_ck`, `locations_fire_control_ck`) leave inside the missing table: they guarded
columns read by nothing (tables-venuebox §5).

## Stop points (beyond rules §5)

1. A foreign key into `locations` still exists (`pragma_foreign_key_list` over every table of a migrated
   database): an earlier part missed it.
2. The done-check prints a line that is Waitron's location and is not in this plan's files.

## Assertions that change, by design

- `readVenue`'s "two venue rows refuse `provisioning.second_venue`" case is deleted: two venue rows
  cannot exist (primary key on `module`, A1301 design §3).
- `fire_control` cases deleted (D113).

---

### Task 1: The drop

- [x] **Step 1:** Base protection list (rules §3).
- [x] **Step 2:** Delete `locations`, `bumpMode`, `fireControlMode`; rebuild core. Items 2, 3.
- [x] **Step 3:** Item 1's tests; item 4's scripts.
- [x] **Step 4:** Item 5, test first. Run Finish line 2. Commit.

### Task 2: Docs, done-check, finish

- [x] **Step 1:** Backlog, pointers, conventions-data.
- [x] **Step 2:** Finish line 3; fix or stop on each line.
- [x] **Step 3:** Protection list: compare, paste, mark.
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`.


## Build notes, 2026-11-14

The watcher cleared these implementation details in Lane E's local `questions.md`:

- 11:54: use the existing Madrid removed-with-rows mode and permit historical input names only in its translation files. The exception covers `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`, `testing/madrid-dropped-columns.ts`, `testing/madrid-dropped-columns.test.ts`, `testing/madrid-documents.ts`, `testing/madrid-documents.test.ts` `testing/madrid-semantics.test.ts` and `testing/madrid-semantics.ts`, all under that demo-seed directory. The capture-presence checks stay.
- 12:16: delete only obsolete location receipt/drawer route cases; port retained-state snapshots to settings and cutovers with their refusal codes and before/after checks intact.
- 12:42: remove the unused shared `LocationId` type, constructor and exports, keeping the remaining id checks.
- 12:47: delete the completed fk0/fk1 sweep transformers and their tests; keep the generic engine with neutral sample fields and unchanged assertions.
- 12:52: leave the fiscal pair byte-identical. The comment at `packages/fiscal-verifactu/src/write-path.e2e.test.ts:514` is the sole non-Madrid exception to the whole-tree check.
- 12:57: finish the removal without another size stop, with no new test behaviour or product change, and report additions and deletions separately in the PR. This supersedes the earlier size estimates.

These are watcher clearances inside the existing request, not new owner approvals of this design. The old format-1 capture is retired with its removed schema; the outdated-format check uses a version-1 envelope. `parseConfigurationBundle` rejects the version before inspecting its fields (`packages/provisioning/src/configuration-transfer.ts`). The format-9 checks retain the same outdated refusal with the same version.

The watcher cleared updating the english-only exact-count guard to 1152 at 14:07, because this slice deletes its old format-1 fixture. The owner's A1308 instruction, “build all of it as planned”, is recorded in [the build order](2026-11-08-a1308-build-order.md); the watcher pointed the reviews to that record at the same time.
