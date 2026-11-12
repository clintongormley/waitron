# A1308 slice 5g: Cloud assigns the venue's id; the bucket stream and the recovery kit name no venue id — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order, shared
> words and the reviewer's re-run: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).
> The 1b-i API names: [5b](2026-11-08-a1308-5b-venue-document.md#the-api-this-slice-uses-slice-1b-i-exact-names).

**Lands: the owner** (rules §6), **together with the Cloud lane's pull request**. The venue-id design
makes S18e owner-landed by rule (c): it changes the bucket restore path, which goes on to start a new
chain under a new installation name (CLAUDE.md §5) ([design](../specs/2026-11-04-a1301-venue-id-design.md),
"Who lands it, and in what order": "S18e (Waitron) and the Cloud change land together"; "Before
go-live there is no compatibility period").

**Pull request's first line:** "No venue reset; every box paired with Waitron Cloud pairs again, and
bucket copies and printed recovery packs from before this cannot be used." (venue-id design, "A test
box paired today", question 5.)

**Needs before it:** 5f; **the Cloud lane's plan for pairing v2, written and agreed before this slice
starts** (stop point 1), and the Cloud lane's pull request ready to land in the same window. Waitron
Cloud at `d13c34961` still checks `localVenueId` as a UUID (`apps/portal/src/pairing-types.ts:11`).

## What the Cloud lane's plan must cover

From the venue-id design's "What Cloud must change" (items 1–6) and the coordinator's review
(2026-11-08), so that both sides build one contract:

1. **The pairing message, byte for byte:** `waitron-cloud-pair-v2`'s fields in order, where the venue's
   Cloud id sits (the position `localVenueId` holds in v1, `cloud-client.ts:269-283`), that `""` means
   "no id yet: make a new venue", and what Cloud's answer echoes back (`registration.venueId`, which the
   box checks, `cloud-client.ts:122-134`).
2. **One shared pairing test vector** both repositories pin: fixed inputs and the exact bytes (and their
   SHA-256) of the v2 message. Today the v1 vector is byte-identical on both sides (sha `08feffdf…`, per
   the reviewer); the v2 vector replaces it on both sides in the same window.
3. **Every Cloud file that names `localVenueId` or `local_venue_id`**: the reviewer counted 18
   production files, among them `packages/registration/src/pairing-codes.ts`, `pairing.ts`,
   `index.ts:82,138,205`; `packages/account-http/src/managed-streams.ts`, `recovery.ts:91` (it builds
   version-1 kits); `packages/backups/src/managed-streams.ts:131-132,253,406` (stream registration, the
   pointer check, the pointer path); `apps/portal/src/pairing-controller.ts`, `pairing-screen.ts:19`,
   `pairing-types.ts`, `recovery-controller.ts`, `recovery-types.ts`; and the migrations
   `001_registration.sql:21,24`, `008_pairing.sql:4`, `016_server_replacement.sql:12`,
   `018_managed_continuous_recovery.sql:7` (design items 1–5).
4. **The managed stream's folder and pointer**: Cloud keys it by its venue id and reads
   `<folder>current.json` (design question 3: Cloud hands the box the full folder); the pointer body
   carries `streamId` (item 3 below) instead of `venueId`.
5. **Recovery kits version 2** (item 4 below), built by Cloud's recovery path and read by the box.
6. **Replacement v2** (item 6 below).
7. **The integration script** both sides run before landing (this plan's Finish line 7), and its
   fixture field `venueId` in place of `ready.localVenueId`
   (`apps/server/scripts/cloud-integration-fixture.ts:134-161`).

## What it builds

1. **`settings.venue` gains `cloudVenueId: string | null` and `streamId: string | null`** (tables-venuebox
   §2.1, "The venue's id"; the design's `cloud_venue` table folds into the document). Neither is part of
   `Venue`, so the configuration export, which copies `Venue`'s named fields (5c item 7), cannot carry
   them (design: "Configuration transfer does not carry it"); a restore and a standby's copy do, because
   they are in `venue.db`. Functions in `packages/db/src/venue.ts`: `readCloudVenueId`,
   `saveCloudVenueId(tx, venueId)`, `readStreamId`, `ensureStreamId(tx): Promise<string>` (makes a
   `randomUUID()` the first time and returns the stored one after). Both save through `saveVenueFields`,
   person null.
   - **Why the stream id lives here** (coordinator's decision c): it must survive removing and
     re-adding the bucket-copy settings and changes of bucket or prefix, so it cannot sit inside the
     sealed stream settings (`streamSettingsPayload`, `stream-api.ts:114,245`) or inside a part that is
     deleted with them. env6's `settings.backup` stream part
     (`docs/superpowers/plans/2026-11-08-a1308-env6-backup-document.md:105,131`) planned
     "new only when stream was null"; env6 now reads this field instead (env6 aligned, 2026-11-08).
2. **Pairing v2** (design "At pairing"), in `apps/server/src/cloud-client.ts`:
   - the signed bytes become `waitron-cloud-pair-v2` (`:269-283`), the venue's Cloud id or `""` where v1
     put `localVenueId`, exactly as the Cloud plan's shared vector says;
   - `createCloudConnection`'s option `localVenueId` (`:48,75`) becomes `readVenueId(): Promise<string | null>`
     and `recordVenueId(venueId: string): Promise<void>`; boot passes `readCloudVenueId` and
     `saveCloudVenueId` over `db` (`boot.ts:3246-3252`);
   - on success the box writes `registration.venueId` with `recordVenueId` **before** it writes
     `cloud-connection.json` (design: the venue database first, the pairing file after);
   - **only the main box pairs, decided:** the pairing routes already refuse a box that is not the main
     one with `cloud.not_primary` (`apps/server/src/cloud-api.ts:59`, `deps.isPrimary`, which boot sets
     from the box's role and fence, `boot.ts:3265-3268`). So a spare never pairs before the venue has a
     Cloud id; it receives the id with the venue's copy, and after a promotion it pairs presenting that
     id (design question 7). `createCloudConnection` itself does not decide roles;
   - the saved state becomes `version: 2` holding `venueId` (`:80-84,535-545,674-676`). A saved file whose
     `venueId` differs from `readVenueId()`'s non-null answer is refused `cloud.state_invalid`
     (`:194-197,221`), as today's check does for the location id;
   - **a version-1 file reads as "not connected"**, like a missing file (design, recommended and
     approved): status, refresh, revoke and start (`:559-588`) say "not connected", and the owner connects
     again, which overwrites the file.
3. **The bucket stream's folder is the owner's prefix itself, under a stream id** (design rows "Live
   backup stream folder" and "The pointer body's `venueId`"; question 4): `venuePrefix` goes
   (`packages/stream/src/names.ts:26-29`); `pointerKey` (`pointer.ts:26-28`) is `<prefix>current.json`;
   the pointer body's `venueId` (`:9-15,47,55`) becomes `streamId`, a pointer naming another stream is
   refused as today (`:113,156`; the reason value `other_venue` keeps its name); the signed generation
   marker (`packages/stream/src/generations.ts:16-91`: `generationPrefix`, `markerKey`, the canonical body
   at `:39`) carries `streamId`; `litestream.ts:104-117`, `supervisor.ts`, `bucket-times.ts` and
   `restore.ts` (`:24,62`) follow. The sealed stream settings lose `venueId`
   (`apps/server/src/stream-api.ts:43,114,145,151,245`; `stream-host.ts:40-79,168`); the stream id comes
   from `ensureStreamId` when the owner saves the settings.
4. **Recovery kits version 2** (design row "Recovery pack"): `RecoveryKit` (`packages/stream/src/kit.ts:14-20`)
   holds `streamId` and no `venueId`, under `KIT_PREFIX` `WAITRON-RECOVERY-KIT-2:`, so a version-1 kit is
   refused by name; the bucket part of a pack (`apps/server/src/backup-recovery-pack-parts.ts:142-148,244-258`;
   `backup-recovery-pack-api.ts` kit part) prints the bucket, prefix and stream id.
5. **The bucket restore and the rebuild read `<prefix>current.json`** and check the pointer's stream id
   against the kit's (`apps/server/src/restore-stream.ts:127-136,176-183,264-283,298,312`;
   `rebuild-first-start.ts:224-225`); the operation ids `stream:${kit.venueId}:…`
   (`recovery-preparation.ts:518`, `recovery-backup-preview.ts:121`) use the stream id.
6. **Replacement v2 (test environment only)** (`apps/server/src/cloud-replacement.ts`): the saved file and
   the signed bytes drop `localVenueId` (`:28,44,56,95,205,229,246,284-296`), the bytes become
   `waitron-cloud-replacement-v2`, and a version-1 file reads as absent; Cloud's answer carries its own
   `venueId`, checked against the registration (`:244,261-265`).
7. **The Cloud fixtures** (design item 6): `cloud-integration-fixture.ts:134-161` reports `venueId`;
   `cloud-recovery-client-fixture.ts:152-173` and `cloud-backup-fixture.ts` read the Cloud id through
   `readCloudVenueId`.
8. **Boot hands out no venue row id**: `boot.ts:2095`'s `venueLocationId(db)` and its last users (the
   stream API, the recovery-pack make API's kit, the Cloud connection and replacement) go; 5h then
   deletes `venueLocationId`.

## What it leaves out

| Left out | Taken by |
| --- | --- |
| Cloud's own changes | the Cloud lane, landed together (above) |
| A managed stream handed its folder by Cloud on the box's side | the Cloud lane's managed-stream work; no Waitron code receives one yet (design question 3) |
| `locations`, `venueLocationId`, `bump_mode`, `fire_control`, the done-check | 5h |

## Work beside this slice (rules §8)

- **#2543** (A951) landed on main as `f317c21cea` (2026-11-09). It added an optional
  `remoteAccessEnabled` to `SavedCloudState` and `CloudConnectionStatus` (`cloud-client.ts:59,80`),
  checked in the saved-file read beside `localVenueId` (`:199-202`), and the
  `POST /management-api/cloud/remote-access` route (`cloud-api.ts`). It left the v1 signed bytes
  (`:279-284`) and the `localVenueId` option (`:76`) as they were, and changed only a tax id in
  `cloud-integration-fixture.ts`. No table. Pairing v2 keeps `remoteAccessEnabled` as it is.
- **#2599** (A1404 slice 1) and its second pull request (a key salted with the stream's id): A1404 reads
  the stream id from item 1.

## Files

```zsh
git grep -l -w -E "localVenueId|venuePrefix|venueId" -- apps/server/src packages/stream/src apps/server/scripts ':!*.test.ts'
```

Modify: `packages/db/src/venue-settings.ts`, `venue.ts`, `index.ts`; `packages/stream/src/names.ts`,
`pointer.ts`, `generations.ts`, `kit.ts`, `litestream.ts`, `supervisor.ts`, `bucket-times.ts`,
`restore.ts`, `index.ts`; `apps/server/src/cloud-client.ts`, `cloud-replacement.ts`, `stream-api.ts`,
`stream-host.ts`, `backup-recovery-pack-parts.ts`, `backup-recovery-pack-api.ts`, `restore-stream.ts`,
`rebuild-first-start.ts`, `recovery-preparation.ts`, `recovery-backup-preview.ts`, `boot.ts`;
`apps/server/scripts/cloud-integration-fixture.ts`, `cloud-recovery-client-fixture.ts`,
`cloud-backup-fixture.ts`; the stream loop and pause scenarios (`apps/server/src/testing/stream-loop-scenario.ts:317`,
`stream-pause-scenario.ts:335`) and their suites; the guides' words for the stream folder
(`git grep -n -i "venues/" apps/server/src/guide`).

## Size

| Part | Counted |
| --- | --- |
| `cloudVenueId`, `streamId` and their functions, cases | ~40 + ~50 |
| Pairing v2, the v1 file as not connected, the file check, the record-before-file order | ~110 + ~150 |
| Stream folder, pointer, generation marker, stream id from the document | ~110 + ~120 |
| Kit v2, the pack's bucket part, restore and rebuild reads, operation ids | ~70 + ~90 |
| Replacement v2 | ~40 + ~50 |
| Fixtures, boot, guides | ~50 |
| **Total** | **~880** |

## Finish line

1. The fiscal pair passes unedited.
2. `pnpm --filter @waitron/stream exec vitest run` passes, with "the pointer lives at the prefix's
   current.json and names the stream id", "a version-1 kit is refused by name", "the generation marker
   signs the stream id".
3. `pnpm --filter @waitron/server exec vitest run src/cloud-client.test.ts src/cloud-replacement.test.ts src/cloud-api.test.ts src/stream-api.route.test.ts src/stream-host.test.ts src/restore-stream.test.ts src/rebuild-first-start.test.ts src/backup-recovery-pack-parts.test.ts` passes, with:
   - "pairing signs v2 with an empty venue id and records Cloud's id before the pairing file";
   - "pairing again presents the venue's Cloud id";
   - "a version-1 pairing file reads as not connected";
   - "a pairing file naming another venue is refused `cloud.state_invalid`";
   - "a box that is not the main one is refused `cloud.not_primary` before any pairing";
   - "the stream id survives removing and re-adding the bucket copy, and a change of bucket or prefix:
     the re-added stream carries on in the same folder under the same id";
   - "the export carries no Cloud id and no stream id".
4. The shared v2 pairing vector passes on both sides (the Cloud plan's item 2).
5. The stream loop and pause e2e suites pass after `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`
   (missing binaries skip locally: read the `Tests` count for skips, CLAUDE.md §4).
6. `git grep -n -w -E "localVenueId|venuePrefix" -- apps packages scripts` prints nothing; control on
   the base: it prints `packages/stream/src/names.ts:26`.
7. The Cloud lane's integration script passes against this branch and theirs, run by the watcher before
   both land.
8. `pnpm protection-list compare` prints `EQUAL` (no schema change: the two fields are inside the
   `settings` document).

## Expected protection-list difference

None: `EQUAL`.

## Stop points (beyond rules §5)

1. **The Cloud lane's plan for pairing v2 does not exist, or does not fix items 1–2 of "What the Cloud
   lane's plan must cover"**: do not start.
2. The Cloud pull request is not ready: build and commit, but do not open this one until both can land
   together.
3. The shared vector differs between the two sides.
4. A restore or rebuild case changes its refusal code.

## Assertions that change, by design

- Pairing cases: v2 bytes, `venueId` instead of `localVenueId`, the v1 file reading as not connected
  (design "At pairing", "A test box paired today").
- Stream, pointer, marker, kit, restore and recovery-pack cases: no `venues/<id>/`, `streamId` instead of
  `venueId`, kit format 2 (design rows 4–9, question 4).
- Replacement cases: v2 bytes, no `localVenueId`.

---

### Task 1: The two document fields

- [ ] **Step 1: Failing cases:** "`ensureStreamId` makes one id and keeps it"; "the venue document's
  Cloud id is read back"; "the export's venue holds neither".
- [ ] **Step 2:** Item 1. Run; commit.

### Task 2: Pairing v2

- [ ] **Step 1: Failing cases** (Finish line 3's pairing cases, and the shared vector).
- [ ] **Step 2:** Item 2; boot's wiring. Run; commit.

### Task 3: The stream and the kit

- [ ] **Step 1: Failing cases** (Finish line 2; Finish line 3's stream-id case: save, delete, save
  again with another prefix → same id, folder at the new prefix, the pointer naming the same stream).
- [ ] **Step 2:** Items 3, 4, 5. Run Finish lines 2, 5. Commit.

### Task 4: Replacement, fixtures, boot

- [ ] **Step 1:** Items 6, 7, 8, test first for replacement v2. Run Finish line 3. Commit.

### Task 5: Finish

- [ ] **Step 1:** Backlog, A1301 entry: delete what is left of "Until `venueLocationId` goes, boot takes
  the venue row's id …"; mark the S18e line done.
- [ ] **Step 2:** Finish lines 6–8.
- [ ] **Step 3:** `pnpm format:check`; commit; `/finish-branch`. The owner lands it with the Cloud
  lane's pull request.

2026-11-12, watcher clearance 08:53: 5f adapts the archive-only callers in `backup-recovery-pack-parts.ts` and `stream-api.ts`, plus dashboard status/display types; stream and kit ids, signed bytes, prefixes and Cloud calls stay for 5g.
