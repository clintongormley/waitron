# A1308 slice 5f: archives name no venue id; `nodes` loses `location_id`; the live-venue guard reads the venue document — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order, shared
> words and the reviewer's re-run: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).

**Lands: the owner** (rules §6):

- the fiscal module's recovery-pack check stops comparing a venue value (the venue-id design's
  question 6, answered by the owner on 2026-11-09; [design](../specs/2026-11-04-a1301-venue-id-design.md),
  "Who lands it": S18e is owner-landed by rule (c));
- `nodes.location_id` goes, and its writers write the box's identity row (`insertReservedNodeTx`, the
  setup `create-node` step): A1301 made that slice (S25) owner-landed under its rule (c);
- the live-venue guard moves to the venue document, and its readers include adoption
  (`apps/server/src/adopt.ts:131`) and the standby's identity step (`reserved-identity.ts:68-69`):
  A1301 made that owner-landed (design §3, "The live-venue guard").

**This slice is Waitron-only** (coordinator's decision, 2026-11-08). Everything Waitron Cloud reads
moves in 5g, which lands with the Cloud change: the bucket stream's folder and pointer (Cloud reads
`venues/<local_venue_id>/current.json`, Cloud `packages/backups/src/managed-streams.ts:406`), the
stream's signed generation marker, and the recovery kit (Cloud builds version-1 kits, Cloud
`packages/account-http/src/recovery.ts:91`). Cloud recovery must not break between 5f and 5g.

**Pull request's first line:** "Every venue is reset: core; backups and printed archive recovery
packs from before this cannot be restored or used." (rules §2; venue-id design question 5).

**Needs before it:** 5e. (The owner answered the venue-id design's question 6 on 2026-11-09; see
below.)

## The recovery pack's venue check (the venue-id design's question 6)

**Owner, 2026-11-09:** drop the venue half of the check. In the owner's words: "There is only one
venue so there is no point comparing the ID. We have the name on the sheet that the user can check,
but the important bit for us is the recovery key."

What that means for the code (read at `4a6211786e`, not run). The fiscal module's recovery pack
compares the box's venue value with a paper block's signed `recipientVenueId`
(`apps/server/src/recovery-pack.ts:36,54` → `packages/fiscal-verifactu/src/recovery-pack.ts:38` →
`verifyPaperBlockSnapshot`, compared at `paper-evidence.ts:280`; the value reaches the module through
`packages/module/src/module.ts:1427`, `ProvisionedNode & { venueId }`, and `boot.ts:3234-3243`). After
this slice nothing compares a venue value there. What stays:

- the recovery key: `createRecoveryPack` refuses a wrong `nodeRecoveryKey` as
  `promotion.break_glass_invalid` (`apps/server/src/recovery-pack.ts:62-63`);
- the paper block's signature against the custodian's key (`paper-evidence.ts:267-278`,
  `untrusted`), and its taxpayer, software and environment (`:281-287`, `scope_mismatch`) and series
  (`:289-298`, `series_mismatch`) checks;
- the generation and block-id checks where a block is consumed (`paper-evidence.ts:533-536`,
  `:601-604`); those compare against the custodian's authority, not the box's venue, so this slice
  leaves them as they are;
- the venue's name printed on the sheet for the person to check by eye
  (`apps/server/src/backup-recovery-pack-api.ts:327-329`, `legalName` and `venueName`), unchanged.

The signed block keeps its `recipientVenueId` field: its writers, its parse, its signed bytes and the
register sheet's line (`register-pdf.ts:115`) do not change, so no paper block already signed needs
re-signing. Only the snapshot check stops reading it. The other caller of `verifyPaperBlockSnapshot`,
`paper-recovery-export.ts:80`, then relies on `verifyPaperEvidence`'s later comparison at
`paper-evidence.ts:601-604`, which still holds the block to its authority's `recipientVenueId`.

## What it builds

1. **The archive folder is the owner's prefix itself** (venue-id design, table row "Archive folder").
   `archiveNamespace(prefix, venueId)` (`apps/server/src/archive-settings.ts:63-77`) becomes the prefix;
   the bucket destination loses `venueId` (`:193-202`, `:478-488`; `apps/server/src/storage-backend.ts:62`;
   `backup-config.ts:147-195,276-390`, including `WAITRON_BACKUP_DESTINATIONS`' parse); its other users
   follow: `backup-backends.ts:18`, `backup-supervisor.ts:72`, `backup-settings-evidence.ts:209`.
   - **The overlap rule** (`archivePlace`, `:397-402`; the refusal `:405-420`, `:426-449`) compares the
     two places the owner chose. Today it also refuses one folder nested inside the other; that stays
     and is tested. A bucket stream and archives in the same bucket and prefix work today (two
     different sub-folders) and are refused after this slice, because the archives now live at the
     prefix itself, which holds the stream's `venues/<id>/` folder until 5g and its pointer after. The
     refusal's wording and the backup guide tell the owner to choose a different folder (prefix) for
     each.
2. **The backup screen and status show `bucket/<prefix>/`** for archives (`apps/server/src/backup-api.ts:65,344,435,454`;
   `apps/dashboard/src/screens/backup-destination-model.ts:53-56`), with the guide words that named the
   folder (`apps/server/src/guide/en/backup-recovery.md`, `es/backup-recovery.md`; find them with
   `git grep -n -i -E "archives/|venues/" apps/server/src/guide`). Backlog A1301 entry: "the backup
   screen's folder wording goes with S18e".
3. **The archives part of a recovery pack prints no venue id** (`apps/server/src/archive-recovery-pack.ts:18-23,82-107`;
   `backup-recovery-pack-api.ts:118,230,307` for the archive part only). The bucket part (the kit) is
   5g's.
4. **Backup checks stop reading the copy's venue row.** `loadBackupConfig(env, venueId)` loses the
   parameter (`backup-config.ts:276`); S18f's interim `readCopyNodeAndVenue`
   (`apps/server/src/restore.ts:963-978`) becomes `readCopyNode` (its `locations` read goes) for
   `backup-data-placement.ts:60-70`, `backup-verification.ts:253`, `backup-verification-secrets.ts:93`.
5. **Boot:** `venueId` (`boot.ts:2095`) stops reaching the backup supervisor (`:2862-2868`) and the
   backup API (`:3315`). It still reaches the stream API, the recovery-pack make API's kit and the Cloud
   connection until 5g.
6. **The fiscal recovery-pack check compares no venue value** (owner, 2026-11-09; the section
   above). `verifyPaperBlockSnapshot`'s context loses `recipientVenueId` and its comparison at
   `paper-evidence.ts:280`; `packages/fiscal-verifactu/src/recovery-pack.ts:38` stops passing
   `node.venueId`; `module.ts:1427`'s `recoveryPack` takes a plain `ProvisionedNode`;
   `createRecoveryPack` loses its `venueId` dependency (`apps/server/src/recovery-pack.ts:36,54`);
   `mountRecoveryPackApi` takes its dependencies from that type (`recovery-pack-api.ts:11`), so only
   its call at `boot.ts:3234-3243` and the two test files' set-up stop passing it. `paper-recovery-export.ts:76-80` keeps `recipientVenueId` in its `scope`, which it also hands to
   `validateAllocationEnvelope`, but the snapshot check no longer reads it.
7. **`nodes` loses `location_id`** (A1301 design §4, S25): the column and its foreign key
   (`packages/db/src/schema/nodes.ts:22`, prose comment `:16`); `ReservedNodeInput.locationId`
   (`packages/db/src/reserved-identity.ts:13`) and its fill at `apps/server/src/reserved-identity.ts:76-79`
   (the `mirror.venue_not_copied` refusal at `:68-69` keeps its code); setup's `create-node`
   (`packages/provisioning/src/venue-apply.ts:331-363`: the re-apply lookup at `:342` reads `nodes`
   ordered by id without the location filter; with one venue it finds the same row); `seedNode`'s
   location argument (`packages/db/src/testing/seed.ts:58-65`). The copy checks that join a node to its
   location ask only that the node exists: `apps/server/src/backup-verification-compatibility.ts:368-376`,
   `restore.ts:940-948` (`requireCopyNode`), `apps/server/scripts/dev-setup.ts:184-193`,
   `packages/db/src/backup-evidence.ts:260` (`select id from nodes where id = ?`). The Cloud fixtures that
   read `nodes.location_id` read the venue through `readVenue` instead:
   `apps/server/scripts/cloud-integration-fixture.ts:139`, `cloud-recovery-client-fixture.ts:158`.
8. **The live-venue guard reads the venue document** (A1301 design §3: "an operational venue exists"
   means the `settings` row `venue` exists; 5b decided this equals `revision > 0`). In
   `packages/provisioning/src/tenant-guard.ts:22-35`: `readOperationalVenueIds` becomes
   `hasOperationalVenue(target: Pick<Database, "execute">): Promise<boolean>`
   (`select 1 from settings where module = 'venue' limit 1`); `assertSingleOperationalVenue(ids)`
   becomes `assertOperationalVenue(present: boolean)`, `assertNoOperationalVenue(present: boolean)`, both
   still refusing `provisioning.second_venue` (design §3). Readers: `adopt.ts:131`, `boot.ts:1121,1752`,
   `reserved-identity.ts:68`, `reset-request.ts:62`,
   `packages/provisioning/src/first-setup-resolution-inspection.ts:93`. "Exactly one" becomes "the row
   exists": the primary key on `module` makes a second impossible. The two interim second-venue
   refusals on the restore and promotion paths (`apps/server/src/restore.ts:935-936` in
   `resolveArtifactNode`, `promote.ts:256-257`) call `readVenueSettings` instead of `venueLocationId`:
   a copy with no venue document is still refused `venue.not_found`, and a second venue cannot exist.
   They are on paths that start a new chain (CLAUDE.md §5), so they move here, in an owner-landed
   slice, and 5h's `locations` drop touches no fiscal path.
9. **Backup verification's venue check reads the row** (tables-venuebox §2.4): `verifyCoreBackupData`
   (`packages/db/src/backup-evidence.ts:258-275`) asks `select count(*) as n from settings where module = 'venue'` = 1;
   the compatibility check's table test (`backup-verification-compatibility.ts:368`) asks for
   `settings` instead of `locations`.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| The stream's folder (`venuePrefix`), pointer, generation marker and stream id; the recovery kit; the bucket restore and rebuild reads; operation ids `stream:${kit.venueId}:…` | 5g, with the Cloud change |
| Pairing v2, `cloudVenueId` | 5g |
| `void cfg;` in `till-sale.ts` and `working-order.ts` | [5f-ii](2026-11-08-a1308-5f-ii-invoice-path-parameters.md) (owner) |
| `locations`, `venueLocationId` | 5h |

## Work beside this slice (rules §8)

- **#2599** (A1404 slice 1, bucket encryption) changes `stream-api.ts`, the stream package, the
  backup guides and `boot.ts` (`gh pr view 2599 --json files`, 2026-11-08). No table; a rebase.
- **env6** (`docs/superpowers/plans/2026-11-08-a1308-env6-backup-document.md`) moves the archive's
  non-secret settings into a `settings.backup` document. Whichever lands second takes the other's
  shape; neither reintroduces `venueId`.
- **#2570** has landed (`df7fc95182`): `packages/fiscal-verifactu/src/backup-verification-secrets.ts`
  now reads the source's install rows across its takeover history (`:32-45`, `:94-98`). That is the
  fiscal module's file, not `apps/server/src/backup-verification-secrets.ts`, which this slice
  modifies; #2570 changed no file this slice lists.

## Files

```zsh
git grep -n -w venueId -- apps/server/src apps/dashboard/src/screens/backup-destination-model.ts packages/module/src ':!*.test.ts'
git grep -l "insert(nodes)" -- '*.test.ts' '**/testing/**' '**/test/**' | wc -l    # 69 at a086eedfb7
```

Modify — server: `archive-settings.ts`, `storage-backend.ts`, `backup-config.ts`, `backup-backends.ts`,
`backup-supervisor.ts`, `backup-settings-evidence.ts`, `backup-api.ts`, `archive-recovery-pack.ts`,
`backup-recovery-pack-api.ts` (archive part), `restore.ts`, `backup-data-placement.ts`,
`backup-verification.ts`, `backup-verification-secrets.ts`, `backup-verification-compatibility.ts`,
`recovery-pack.ts`, `reserved-identity.ts`, `adopt.ts`, `reset-request.ts`, `promote.ts`, `boot.ts`;
`apps/server/scripts/dev-setup.ts`, `cloud-integration-fixture.ts`, `cloud-recovery-client-fixture.ts`.

Modify — elsewhere: `apps/dashboard/src/screens/backup-destination-model.ts`; `packages/module/src/module.ts:1427`;
`packages/fiscal-verifactu/src/recovery-pack.ts`, `paper-evidence.ts`, `paper-recovery-export.ts`
(only if typecheck asks for it); `packages/db/src/schema/nodes.ts`,
`reserved-identity.ts`, `backup-evidence.ts`, `testing/seed.ts`; `packages/provisioning/src/venue-apply.ts`,
`tenant-guard.ts`, `first-setup-resolution-inspection.ts`, `index.ts`.

Tests: the suites of those files, including `packages/fiscal-verifactu/src/paper-pack.test.ts`,
`paper-custodian.test.ts`, `apps/server/src/recovery-pack.test.ts`, `recovery-pack-api.test.ts` and
`boot.recovery-pack.test.ts`; `apps/server/src/reserved-identity.no-venue-key.test.ts` (deleted:
its first assertion, `:19`, checks the `nodes` → `locations` key exists before removing it in a scratch
table, and `reserved-identity.test.ts:247` already makes its point on the real schema).

Guides: `apps/server/src/guide/en/backup-recovery.md`, `es/backup-recovery.md` (CLAUDE.md §3).

Guards: `scripts/schema-constraints.test.ts`, `apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts`
(5a's dropped-columns list gains `nodes.location_id`).

Regenerated: `packages/db/drizzle/**`, `scripts/migration-baseline-epoch.json`.

## Size

| Part | Counted |
| --- | --- |
| Archive folder, overlap (nesting kept), config parse, screen and status (code, tests) | ~100 + ~130 |
| Archive recovery-pack part | ~20 + ~25 |
| Backup checks without the copy's venue row | ~30 + ~40 |
| Fiscal recovery-pack check without a venue value (code, tests) | ~15 + ~45 |
| `nodes` column, writers, copy checks, seed, fixtures; hand fixture edits | ~55 + ~80 |
| Live-venue guard and its six readers; the two interim refusals; verification's venue check | ~70 + ~80 |
| Guides EN/ES, boot, Madrid | ~40 |
| **Total** | **~730** |

Not counted: the script's output for `nodes`, deletions, regenerated files.

## Finish line

1. The fiscal pair passes unedited (A1301 plan, "The fiscal pair"), in every task.
2. `pnpm --filter @waitron/server exec vitest run src/archive-settings.test.ts src/backup-config.test.ts src/backup-api.route.test.ts src/backup-verification.test.ts src/backup-data-placement.test.ts src/archive-recovery-pack.test.ts src/reserved-identity.test.ts src/adoption-allocation-refusal.test.ts src/adopt.test.ts src/reset-request.test.ts src/boot.test.ts src/backup-verification-compatibility.test.ts` passes.
3. `pnpm --filter @waitron/provisioning exec vitest run src/tenant-guard.db.test.ts src/first-setup-resolution-inspection.test.ts src/venue-apply.test.ts` and
   `pnpm --filter @waitron/db exec vitest run src/backup-evidence.test.ts` pass; `pnpm --filter @waitron/server typecheck` passes (it includes `scripts/`).
   `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/paper-pack.test.ts src/paper-custodian.test.ts`,
   `pnpm --filter @waitron/server exec vitest run src/recovery-pack.test.ts src/recovery-pack-api.test.ts src/boot.recovery-pack.test.ts`
   and `pnpm --filter @waitron/fiscal-verifactu typecheck` pass.
4. `git grep -n -w -E "readCopyNodeAndVenue|readOperationalVenueIds|assertSingleOperationalVenue" -- apps packages` prints nothing.
5. `git grep -n -w venueId -- apps/server/src packages/module/src ':!*.test.ts' ':!**/testing/**'` prints only the
   stream's and the kit's lines (5g: `stream-api.ts`, `stream-host.ts`, `restore-stream.ts`,
   `rebuild-first-start.ts`, `backup-recovery-pack-parts.ts`, `backup-recovery-pack-api.ts`, `recovery-preparation.ts`,
   `recovery-backup-preview.ts`), the Cloud connection's (5g: `boot.ts`, `cloud-client.ts`,
   `cloud-replacement.ts`), `mirror-bundle-api.ts`, `mirror-bundle-fetch.ts`, `mirror-bundle.ts` and `stream-key.ts`, and the lines that already use Cloud's own id and stay (the design's "They
   do not change": `cloud-installation.ts`, `cloud-backup.ts`, `cloud-billing.ts`,
   `cloud-snapshot-worker.ts`, `cloud-recovery*.ts`, `cloud-tunnel.ts`, `backup-verification-protocol.ts`).
   Control, on the base first: it also prints `archive-settings.ts:64`.
6. `git grep -n -P "nodes\.locationId|n\.location_id" -- apps packages scripts ':!**/drizzle/**'`
   prints nothing; control on the base: it prints `apps/server/src/backup-verification-compatibility.ts:371`.
   Audit `seedNode` calls by their import: the database helper loses its location argument; the
   fiscal fixture helper retains its optional label. A name-only grep cannot distinguish them.
7. `pnpm protection-list compare` prints exactly the next section.

## Expected protection-list difference

Under each of the six headers, except the `waitron_change_*` line (change-feed only), in the tool's
order. Written from the schema change, in 5a's simulated shapes.

```text
changed table nodes.columnOrder
missing table nodes.columns[location_id]
missing table nodes.foreignKeys[location_id->locations(id)]
changed trigger waitron_change_nodes_update.when
```

Reason: A1301 design §4 (`nodes.location_id` deleted, S25); tables-venuebox §5 row "`nodes.location_id`
FK". The backup and guard changes touch no schema.

## Stop points (beyond rules §5)

1. Removing the venue comparison from `verifyPaperBlockSnapshot` changes any assertion other than
   the one listed under "Assertions that change, by design", or a caller other than
   `recovery-pack.ts` and `paper-recovery-export.ts` turns up.
2. A restore, adoption or verification case can only pass with a changed refusal code.
3. A file this slice changes turns out to carry the stream's or the kit's `venueId` as well (it is
   5g's): leave that half and say so in the pull request.

## Assertions that change, by design

- Archive folder paths lose `archives/<id>/` (design table, row "Archive folder"); a stream and
  archives at the same bucket and prefix are now refused as overlapping (item 1).
- Nested selected folders are refused in both directions: stream at the bucket root and archives
  in `backups/`, or stream in `copy/` and archives at the root or in `copy/backups/`.
- The dashboard no longer offers the stream's own folder as an archive destination; use the
  custom S3 fields with a separate folder (watcher, 2026-11-12 10:15).
- `backup-evidence.test.ts`'s node read; the copy checks that joined `locations`;
  `verifyCoreBackupData`'s venue case counts the `settings` row.
- Guard cases assert "a venue row exists" (a boolean) instead of a list of ids; the codes stay.
- Setup's re-apply finds the node without the location filter (one venue: the same row).
- `reserved-identity.no-venue-key.test.ts` is deleted (Files).
- `paper-pack.test.ts`'s "refuses a signed block belonging to a different scope" loses its
  `{ recipientVenueId: "venue-two" }` row (owner, 2026-11-09: the venue half of the check goes); its
  taxpayer, software and environment rows stay. `boot.recovery-pack.test.ts:66` no longer needs the
  block's `recipientVenueId` set to `node.locationId` (set-up only).

---

### Task 1: The archives and the screen

- [ ] **Step 1:** Base protection list (rules §3).
- [ ] **Step 2: Failing cases:** "an archive destination lives at the owner's prefix"; "archives
  nested inside the stream's folder, or the stream's inside the archives', are refused as
  overlapping"; "the stream and archives at the same bucket and prefix are refused, and the refusal
  says to choose another folder"; "a destination in `WAITRON_BACKUP_DESTINATIONS` with a `venueId` key
  is refused"; "the backup status shows `bucket/<prefix>/`"; the dashboard model's case; "the archives
  part of a recovery pack prints no venue id".
- [ ] **Step 3:** Items 1–3, the guides. Run; pass. Commit.

### Task 2: Backup checks and boot

- [ ] **Step 1:** Failing case "backup verification reads no venue row from the copy". Items 4, 5. Run
  Finish line 2's verification suites. Commit.

### Task 3: `nodes.location_id`

- [ ] **Step 1:** `reserved-identity.test.ts` and `adoption-allocation-refusal.test.ts` keep their
  `mirror.venue_not_copied` assertions (run them first: they pass before and must pass after);
  failing case `venue-apply.test.ts` "re-applying the same request reuses the node".
- [ ] **Step 2:** Schema; rebuild core. Commit the schema alone (the reviewer's starting point, 5a).
- [ ] **Step 3:** Script run over 5a's `$FILES`: `node scripts/a1308/drop-location-id.mjs --tables nodes --helper-arg seedNode#1 --write $FILES`;
  prettier; commit the output alone.
- [ ] **Step 4:** Writers and copy checks (item 7), the two Cloud fixtures; hand-edit what the script
  reported (raw `insert into nodes (…, location_id, …)`); delete
  `reserved-identity.no-venue-key.test.ts`. Run Finish lines 1, 6. Commit.

### Task 4: The guard and verification

- [ ] **Step 1: Failing cases** in `packages/provisioning/src/tenant-guard.db.test.ts`: "a database with
  the venue document has an operational venue"; "one with none has not"; adoption's "adoption onto a
  box with a venue document is refused `provisioning.second_venue`"; boot's "a start with no venue
  document refuses `provisioning.second_venue`".
- [ ] **Step 2:** Items 8, 9. Run Finish line 3. Commit.

### Task 5: The recovery-pack check, and finish

- [ ] **Step 1: Failing cases**, then item 6. In `paper-pack.test.ts`: "a signed block is accepted
  whatever venue value it names" (a block whose `recipientVenueId` is `"venue-two"`, scope unchanged:
  `{ ok: true }`; fails before item 6 with `scope_mismatch`). In `boot.recovery-pack.test.ts`, on the
  real boot path: "a recovery pack is made from a block naming the first-setup source, not the
  venue's row id" (leave the fixture's `recipientVenueId` as the allocation fixture made it; fails
  before item 6). The cases that must keep refusing, run before and after: a wrong recovery key →
  `promotion.break_glass_invalid` (`recovery-pack.test.ts`); a block signed by another key →
  `untrusted`; another taxpayer, software or environment → `scope_mismatch`; a missing series →
  `series_mismatch` (`paper-pack.test.ts`). Proof by deletion: with the recovery-key check in
  `createRecoveryPack` removed, the wrong-key case fails; restore.
- [ ] **Step 2:** Backlog, A1301 entry: delete the archive half of "Until `venueLocationId` goes, boot
  takes the venue row's id for backup settings …" (keep the stream, kit and Cloud parts for 5g); the
  `verifyCoreBackupData` sentence; the S4/S25 node note; "the backup screen's folder wording goes with
  S18e".
- [ ] **Step 3:** Protection list: compare, paste, mark.
- [ ] **Step 4:** `pnpm format:check`; commit; `/finish-branch`. The owner lands it.

2026-11-12, watcher clearance 09:23: configuration exports stay version 19; the reset notice does not claim they are refused. Missing-venue verification now deletes `settings.venue` and refuses through the core module check (`module_integrity`).
