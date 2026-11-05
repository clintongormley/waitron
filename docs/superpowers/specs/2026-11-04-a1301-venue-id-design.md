# A1301 — The venue's id towards the outside world (design)

**Status:** Awaiting the owner's approval; nothing is built from it until then.

Written 2026-11-04 by lane B while planning S18, at Waitron main `6d2147332b` and Waitron Cloud
main `7b8ffec5`. Every `file:line` below was read at those heads; nothing was run. It settles the
open design point "the venue's stable id" in
[the A1301 plan](../plans/2026-11-01-a1301-remove-location.md) (dated amendment there), and its
build is slice S18e of [the S18 plan](../plans/2026-11-04-a1301-s18-contract-cleanup.md).

## The owner's decision (2026-11-02, relayed by the watcher)

From `~/waitron-campaign/questions.md:1690-1695`:

> The owner decided (2026-11-02, watcher session): **the venue's id for the outside world is
> assigned by Waitron Cloud and belongs to the Cloud account** ("one Cloud account could have
> multiple venues"; a box-made id cannot be guaranteed unique). So, replacing the plan's
> "controller's recommendation" (keep today's location id on the venue row):
> - Inside the box the venue needs no id (one venue, like the taxpayer row).
> - When a box is connected to Cloud, Cloud assigns the venue's id and the box stores it; it
>   replaces `localVenueId` (today `tradingContext.locationId`, signed into the pairing bytes in
>   `apps/server/src/cloud-client.ts`) as the venue's identity towards Cloud.
> - In Cloud's managed backup bucket the venue's folder (`venues/<id>/`,
>   `packages/stream/src/names.ts`) is named by that Cloud id; a restore, replacement box or standby
>   carries it because it is in the venue's data.
> - A venue not connected to Cloud backs up to its own bucket and needs no globally unique name
>   there — the design states its default (for example a fixed folder name), open to the owner.
> - Existing test boxes reconnect to Cloud (allowed before go-live).

The 07:32 addition (`questions.md:1700`) replaces the fourth bullet's "fixed folder name": "For
local backup folders, that's for the user to specify the path." So a box that is not connected to
Cloud backs up where its owner says, and nothing derives a folder name from a venue id.

## What the box sends today

**2026-11-05 (S18f):** `readNodeLocation` and `tradingContext.locationId` are gone. Boot reads
`venueLocationId(db)` once, and the backup checks take the id from `readCopyNodeAndVenue`
(`apps/server/src/restore.ts`). The `locationId` brand stays, for the fiscal golden test. The
table below is as written on 2026-11-04.

The box reads its `locations` row's id once at start (`readNodeLocation`, `apps/server/src/boot.ts:1742`)
and hands it out as `tradingContext.locationId`. Where it leaves the box:

| Use | Where | What it becomes |
| --- | --- | --- |
| Cloud pairing: written to `<stateDir>/cloud-connection.json` and signed into `waitron-cloud-pair-v1` | `boot.ts:3170`; `cloud-client.ts:75-86` (saved state), `:269-283` (signed bytes) | The Cloud id the venue's data holds, or nothing on a first pairing |
| Cloud pairing file check: a saved file whose `localVenueId` differs from the current one is refused `cloud.state_invalid` | `cloud-client.ts:194`, `:221`; Cloud's answer must echo it, `:122` | The saved registration's venue id must equal the id the venue's data holds |
| Cloud replacement (test environment only): saved and signed into `waitron-cloud-replacement-v1` | `boot.ts:3179`; `cloud-replacement.ts:95`, `:247`, `:284-296` | Dropped: Cloud's answer already carries its own `venueId`, checked against the registration (`cloud-replacement.ts:244`, `:261-265`) |
| Live backup stream folder `<prefix>venues/<id>/`, pointer `current.json` and replica URL | `venueId` sealed with the stream settings at Save (`stream-api.ts:245`), read back at `stream-host.ts:168`; `packages/stream/src/names.ts:26-29`, `pointer.ts:26-28`, `litestream.ts:104-117` | Cloud's bucket: a folder Cloud names. The owner's bucket: the owner's prefix itself |
| The pointer body's `venueId`, signed; a pointer naming another venue is refused `other_venue` | `pointer.ts:9-15`, `:113`, `:156` | Kept as a "same writer" check under a stream id (open question 4) |
| Archive folder `<prefix>/archives/<id>/`, in the bucket and in `WAITRON_BACKUP_DESTINATIONS` | `archive-settings.ts:63-77`, `:478-488`; `backup-config.ts:164-165`, `:276` | The owner's prefix itself; the overlap refusal (`archive-settings.ts:405-420`) compares the two owner-chosen places |
| The backup screen and status show `bucket/<prefix>/archives/<id>/` | `backup-api.ts:344`; `apps/dashboard/src/screens/backup-destination-model.ts:53-56` | `bucket/<prefix>/` |
| Recovery pack: the bucket code (a recovery kit) and the archives code carry the id; the archives part prints it | `backup-recovery-pack-parts.ts:142-148`, `:244-258`; `packages/stream/src/kit.ts:14-20`; `archive-recovery-pack.ts:18-23`, `:82-107` | No venue id; the kit names the bucket and prefix (and the stream id) |
| Restore from a bucket reads `venues/<kit.venueId>/current.json`, then the generation | `restore-stream.ts:264-283`, `:298`, `:312`; `rebuild-first-start.ts:224-225` | Reads `<prefix>current.json` |
| Backup checks pass it to `loadBackupConfig`, which only parses | `backup-data-placement.ts:70`; `backup-verification-secrets.ts:93` | The parameter goes |
| The fiscal module's recovery pack compares it with a paper block's signed `recipientVenueId` | `boot.ts:3160` → `recovery-pack.ts:54` → `packages/fiscal-verifactu/src/recovery-pack.ts:38`, `paper-evidence.ts:280` | Open question 6 |

Cloud's other calls already use the id Cloud assigned, `registration.venueId`
(`cloud-client.ts:38-43`): `cloud-installation.ts:143`, `cloud-backup.ts:105`,
`cloud-billing.ts:202,309`, `cloud-snapshot-worker.ts:171,256`. They do not change.

Reading suggests the location id is not hashed into an invoice record or sent to AEAT. That claim
was not run. Records are built, hashed and sent through `@waitron/verifactu`. Leaving out tests,
test helpers and `package.json` files, 26 files under `apps/` and `packages/` import it, and none
names `locationId`, `venueId` or `localVenueId`. The grep for that:
`git grep -n -w -E 'locationId|venueId|localVenueId' -- $(git grep -l '@waitron/verifactu' -- apps packages ':!*.test.ts' ':!**/package.json' ':!**/testing/**' ':!**/test/**')`
prints nothing.

## Where the box keeps Cloud's id

Today Cloud's id lives only in `<stateDir>/cloud-connection.json` (`cloud-client.ts:184-228`), one
file per box, which no backup carries (archives carry `secrets.env`, `trading.env` and `tls/*`,
`state-secrets.ts:16-23`). To travel with the venue it must be in `venue.db`.

**Proposed:** a one-row table `cloud_venue` in the core migration set, class `state` (so the stream,
archives and a standby's copy carry it), holding `venue_id` and a singleton check like `tenants`'
(`packages/db/src/schema/tenants.ts:38-55`). No row means "not connected to Cloud". S18e adds it in
one additive migration; no venue is reset for it.

- **Configuration transfer does not carry it.** Core transfers only the tables it lists in
  `CORE_CONFIGURATION_TRANSFER` (`packages/db/src/configuration-transfer.ts:62`),
  and a module transfers only what it opts into (`packages/composition/src/composition.test.ts:156-161`).
  `cloud_venue` is added to neither list, because an importing venue keeps its own id.
- **A1308.** If the owner approves A1308's rationalisation, `cloud_venue` folds into its settings
  rows. Its design already treats such an id as a plain field of `settings.venue`, carried by a
  restore and not by configuration transfer
  (`docs/superpowers/specs/2026-11-02-rationalisation/tables-venuebox.md:374-387`).

## The venue's life

- **Before pairing.** No row. Nothing outward needs an id: local folders and the owner's bucket
  use the place the owner typed; the recovery pack names the bucket and prefix.
- **At pairing.** The box signs `waitron-cloud-pair-v2`: the v1 fields with `localVenueId`
  replaced by the venue id its data holds, or `""` when it has none. With `""`, Cloud makes a new
  venue under the approving account and returns its id in `registration.venueId` (as it does
  today). The primary writes the `cloud_venue` row, in the venue database first and the pairing
  file after. With an id, Cloud attaches this installation to that venue if the approving account
  may register venues in its organisation, and refuses otherwise. A mirror does not write the row;
  it receives it through the stream.
- **A test box paired today.** Its saved `cloud-connection.json` is version 1 and holds
  `localVenueId`. Today's reader refuses any file it does not accept with `cloud.state_invalid`
  (`cloud-client.ts:188-221`). Status, refresh, revoke and start all read the file first
  (`:559-588`), and the dashboard's words for that code, "Check this server’s Cloud
  configuration" (`apps/dashboard/src/i18n/codes.ts:72-74`), offer no way out. A box operator has
  no terminal. **Recommended:** a version-1 file reads as "not connected", like a missing file;
  the owner connects again from the dashboard, and the new pairing overwrites the file. The
  test-only `cloud-replacement.json` (`cloud-replacement.ts:88-100`) is treated the same way.
- **Restore, replacement box, standby.** The row is in the copy, so the box pairs (or is
  re-paired by Cloud's replacement flow) presenting the venue's existing id. A version-2 pairing
  file whose venue differs from the copy's row is refused `cloud.state_invalid`, as today's check
  does for the location id.
- **Cloud's managed bucket.** The stream folder is the one Cloud names from its venue id. The box
  does not build it (open question 3).

## What Cloud must change (for the Cloud lanes)

Cloud is a separate repository; these are the changes this design asks of it, read at Cloud
`7b8ffec5`:

1. **Pairing.** Accept `waitron-cloud-pair-v2` (`packages/registration/src/pairing-proof.ts:13`
   builds v1). Stop finding a returning venue by `(environment, local_venue_id)`
   (`packages/registration/src/index.ts:219-228`); an empty id makes a new venue, a given id is
   checked against the approving account's organisation. Drop `venues.local_venue_id` and its
   unique key (`packages/registration/migrations/001_registration.sql:21,24`) and the copies in
   `008_pairing.sql:4`, `016_server_replacement.sql:12`, `018_managed_continuous_recovery.sql:7`.
2. **The owner's approval screen** shows the box's location id today
   (`apps/portal/src/pairing-screen.ts:19`); it shows "a new venue" or the venue being
   reconnected.
3. **Managed streams.** Key them by Cloud's venue id: the registration input
   `{localVenueId, sourceNodeId, pointerSignerPublicKey}`
   (`packages/account-http/src/managed-streams.ts:17-19`; `packages/backups/src/managed-streams.ts:131-132`)
   loses `localVenueId`; the pointer path (`managed-streams.ts:406`) and the pointer check
   (`:253`) use the venue's id; Cloud hands the box the stream's full folder.
4. **Recovery.** The Cloud-made recovery kit's `venueId: current.stream.localVenueId`
   (`packages/account-http/src/recovery.ts:91`) and the portal's recovery views
   (`apps/portal/src/recovery-types.ts:2,15,34`) follow item 3.
5. **Replacement (test only).** `waitron-cloud-replacement-v1` (`packages/backups/src/replacement.ts:12`)
   drops `localVenueId`, together with Waitron's `cloud-replacement.ts`.
6. **Test scripts** that read `ready.localVenueId` from Waitron's
   `apps/server/scripts/cloud-integration-fixture.ts` follow its new `venueId` (listed under
   "Cloud follow-up" in the A1301 plan).

Before go-live there is no compatibility period: Cloud and Waitron switch together, and test boxes
pair again (the owner's last bullet), as described under "A test box paired today".

## Who lands it, and in what order

S18e (Waitron) and the Cloud change land together. S18e is owner-landed by rule (c): it changes the
bucket restore path (`restore-stream.ts`), which goes on to start a new chain under a new
installation name (CLAUDE.md §5), and the input to the fiscal module's recovery-pack check. It adds
a migration, so it runs the schema guards. The S18 plan asks the owner to choose between two
schedules. In one, S18f (removing `TradingContext.locationId`, `readNodeLocation` and the
`LocationId` type) waits for S18e. In the cheaper one, S18f lands first, with the outward users
reading the interim `venueLocationId(tx)`, and only S28 waits for S18e.

## Open questions for the owner (each with the default the build uses unless told otherwise)

1. **Where Cloud's id lives.** Default: its own one-row `cloud_venue` table, added by S18e.
   The alternative is a column on S23's `venue_settings`. That only works under the S18 plan's
   cheaper schedule. Under the other schedule, S18f waits for S18e and S23 waits for S18f (the
   parent plan's S23 row), so S18e could not also wait for S23. Under the cheaper schedule, S18e
   simply lands after S23.
2. **A box with no id pairs.** Can the owner attach it to an existing Cloud venue in the portal?
   Default: no; it becomes a new venue. Carrying on a venue means restoring its data, which carries
   the id.
3. **Cloud's managed stream folder.** Default: Cloud hands the box the full folder (its prefix
   ending `venues/<venue id>/`) with the bucket grant, so the box never builds a folder from any
   id, and `venuePrefix` (`names.ts:26-29`) goes. No Waitron code receives a managed stream's
   settings from Cloud today (`git grep -n -i -E 'managed.?stream' -- apps packages ':!*.test.ts'`
   prints nothing), so S18e's plan names that path first.
4. **Two venues pointed at one folder.** Today the signed pointer's `venueId` refuses another
   venue's stream (`pointer.ts:113`, `:156`). Default: keep that check under a `streamId`: Cloud's
   venue id in Cloud's bucket, otherwise a random id made when the owner saves the stream settings
   and sealed with them, where `venueId` is sealed today. It names no folder.
5. **Existing backups and printed recovery packs.** Folders under `venues/<old id>/` and
   `archives/<old id>/`, and codes printed with the old layout, stop matching. Default: before
   go-live, test boxes set their backups up again and print new packs, as they pair again.
6. **The fiscal recovery-pack check.** It compares the box's id with a paper block's
   `recipientVenueId`. The writers `git grep` finds set that to the first-setup source
   (`packages/provisioning/src/first-setup-module-context.ts:28`) or `"throwaway-preproduction"`
   (`packages/fiscal-verifactu/src/throwaway-allocation.ts:16,77`), never a location id. That was
   read, not run, so whether the check can pass today is unproven. Default: S18e's first task
   establishes it with a test from a real first setup, and the owner chooses the value the check
   uses.
7. **Standbys and Cloud.** Cloud keeps one current installation per venue
   (`001_registration.sql:28`; `index.ts:232`). Default: unchanged. Only the box that sells writes
   the row, and a promoted standby pairs again as the venue.
