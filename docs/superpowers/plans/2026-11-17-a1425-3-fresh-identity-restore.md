# A1425 part 3, cut to Cloud's emergency copy: a placed copy under a fresh machine identity

**Status:** plan, written 2026-11-17 by lane L (Claude); one fresh-context review ("Ready after fixes"),
its nine findings folded in the same day. Cleared by the watcher 2026-11-17 02:31 (`~/waitron-campaign-l/questions.md`,
"A1425-3: build PR 1 now; PRs 2–3 on decision 5 (a)"): decision 5 is (a). FISCAL lane: the owner
lands it. Ask: watcher 2026-11-16 02:06, recorded at `~/waitron-campaign-l/queue.md:109-110` and
`~/waitron-campaign-shared/watcher-handoff.md:3116`. Unless a line says "ran", every receipt below was
read at `main` 1de957e795, not run.

## Should this exist?

1. **The need.** The watcher: "fresh machine identities for the locked emergency copy; 'the existing
   source-identity restore is unchanged' … It unblocks lane J's A1188." Cloud's agreement: "Real
   placement still waits for A1425 part 3 / Waitron part 0" (Cloud contract, `origin/main` 34a0731e3,
   "Agreed part 3 values, 15 November 2026", item 1). **Nobody can do anything new yet**: lane J's locked
   start gets a tested function making a downloaded venue database a machine of its own; a Cloud start
   waits for A1188 parts 3–6 and Cloud's build. **Alternatives:** change nothing (A1188 stays blocked);
   build it inside lane J's sign-in work (loses the separate fiscal review); reuse #3142 (needs a box
   that already joined, below).
2. **True size (estimate):** about 440 production, 780 test and 40 docs lines in three PRs; nothing generated.
3. **Approvals.** A1425's design: owner, 2026-11-07 (its Status line). Cloud's answer: "a technical
   agreement, not owner approval of a new design", cleared by the watcher. The cut: the watcher's (queue
   entry above). This plan's own decisions: unapproved.

## What exists today

| Piece | Today |
| --- | --- |
| Today's stream restore becomes the old box | It unseals the source box's saved state with the recovery key and writes the source's whole `node.db` (`node.dump`) beside the venue file (`apps/server/src/restore-stream.ts:363-368`); the identity is the backup's `trading.env` node id (`apps/server/src/restore.ts:913-947`); "a restore that keeps the box's identity keeps its node.db too" (`restore.ts:425`). Cloud's text still describes this for both restores (contract `:794-799`). It stays unchanged. |
| #3142, a spare picks a backup | `stageBackupAsCopy` decrypts an archive file with the recovery key, `skipSecrets: true` (`apps/server/src/handover-copy-from-backup.ts:85-109`); `stageCheckedCopy` checks the file's integrity, its schema, the fiscal chain (`checkHandoverCopy`) and then that the copy's `nodes` row holds **this spare's own public key** and its chart lists **this spare** as `serving-secondary` under the held chart's main box (`:39-64`). `placeFirstCopy` swaps the copy in at start only when this box's `node.db` says `mirror` (`spare-copy-placement.ts:40-53`). |
| How close #3142 is | Reusable: the integrity check (`handover-integrity.ts:51`), the module chain check (`packages/module/src/handover.ts:65-84`) and the read-only reader (`packages/store/src/backup-query.ts:10-40`, which denies every write through an authorizer). Reusable once factored out: the not-ahead check over the venue's migration sets inside `checkCopy` (`spare-copy.ts:194-200`); `checkCopy` itself also needs this box's own `nodes` row and key (`:201-205`). **Not reusable:** everything that presumes the box already joined: an existing `node.db` with a signing key and `mirror` role, a held chart, a `nodes` row for itself in the copy, a pair link, the recovery key, an archive file rather than a placed database. A fresh Cloud node has none of these. |
| Where the venue's own ids live | Cloud's venue id and the stream id are fields of the venue settings document (`packages/db/src/venue.ts:41-51`); the environment is `deployment.environment` (`packages/db/src/schema/deployment.ts:10-23`); a generation's name carries the node that wrote it (`packages/stream/src/names.ts:47-60`). So the venue, environment and stream id are checked against the placed file. `venue.db` does not record its generation, so "the generation names the source" checks the binding against itself; `sourceInstallationId` and the copy's `installationId` cannot be checked at all, since Cloud's connection files are outside the backup (contract `:785-786`). |
| Two different keys (#2371) | The signing key in `node.db`'s `box` row (`packages/node-db/src/schema/box.ts:5-61`) is sealed on the **vault ring**, `WAITRON_CREDENTIALS_KEY` (`packages/credentials/src/keyring.ts:5-8`, `node-signing-key.ts:34-48`), which also seals card credentials and the AEAT certificate; the venue's ring travels only in the source's sealed `secrets/secrets.env`, beside `node.dump`. TOTP comes from the separate **account key**, `WAITRON_ACCOUNT_KEY`, or one derived from the ring when unset (`apps/server/src/account-key.ts:9-25`, `boot.ts:1951-1955`). Cloud's launcher inputs name only the account-key source. |
| A node with no recorded role | Reads as a sole primary (`packages/node-db/src/mode.ts:36-46`). **Ran:** `pnpm exec vitest run src/mode.test.ts -t "sole primary"` in `packages/node-db`: `Tests 8 passed | 14 skipped`, including "reads as a sole primary when the node has no row". So a fresh `node.db` holding only a key would read as a box that sells. |
| "Whose history is mine" (#2570) | `readHistoryNodes` walks `handover_activations` from this box back (`packages/db/src/history-nodes.ts:11-30`); `readTakenOverFrom` is the same list without this box (`apps/server/src/handover-collection.ts:9-14`). Its one writer, by grep of `insertHandoverActivationTx` outside tests, is activation (`apps/server/src/handover-activation.ts:149-157`), which takes source and destination from this box's `node_handover_operations` row, begun at the emergency declaration (`handover-emergency-api.ts:622-631`). |
| Recording something in `node.db` with no schema change | `node_handover_events` takes any `kind` and a JSON `detail`, and its `operation_id` need not name an existing operation (`packages/node-db/src/schema/node-handover.ts:69-81`); a kind with no operation id is already read that way (`apps/server/src/return-clash-acceptance.ts:107-112`). |
| Ordinary start | Migrates (`boot.ts:~1397`), then refuses a configured id with no `nodes` row (`server.node_config_invalid`, `:2112`), before the mirror-link refusal (`:2502-2510`). The node id comes from `trading.env`'s `WAITRON_NODE_ID` (`trading-config.ts:31-43`). The reviewer's probe (ran, by the reviewer, not me): a placed copy started under the copy's id is refused at `:2112` with `venue.db` unchanged; started under the **source's** id it started and changed `venue.db`. Only a copy with an older schema would be written before the `:2112` refusal. |

## Which parts of the A1425 design this cut builds

Builds now: a new node id (in `trading.env`) and signing key for the copy; the source's history left under
the source's id (§4 "Kept as history"); the source recorded as what the copy takes over from, so part 4's
activation can write the row `readHistoryNodes` reads (§2, §9 first bullet).

A1188 part 4's (after the declaration): the copy's `nodes` row and public key, the next chart, its
filing identity, chain and series, the venue's ring, a new bucket generation, and `handover_activations`.

Left for a later "every restore" part (the copy never holds the source's private key): §4's
replacement statement and old-key destruction, the recovery pack following statements, the carry-overs
and restore marker; §5's no-re-pairing test; §6's two machines; §7's earlier-text changes. The copy's
evidence against the old box is A1018's declaration signed with its own key, as on a spare today.

## The build

**One function, `placeEmergencyCopy`, in `apps/server/src/emergency-copy-placement.ts`**, which A1188
part 3's locked start calls before it enters the locked mode, with launcher inputs: the copy binding as
the A1188 part 3 proposal item 1 lists it, the folder where Cloud's reader put `venue.db`, the state
folder and this process's environment. It fetches nothing and holds no bucket credential (decision 1).
It holds the venue folder's lock throughout (`lockVenueDatabase`), then:

1. **Checks the binding's shape:** lowercase UUID v4 ids, `sourceNodeId ≠ copyNodeId`,
   `copyOperationId` distinct from both, the generation's name names `sourceNodeId`, instants in ISO UTC with milliseconds, `expiresAt` exactly 30
   minutes after `startedAt` and not yet passed by this machine's clock. The two installation ids are
   recorded, not checked (above).
2. **Checks the placed file without opening it for writing:** no `-wal` or `-journal` beside it (the hash
   would not cover it, and an immutable open ignores it); no `node.db` beside it unless it holds this binding's record (so the source's `node.dump`
   is never adopted); SHA-256 equals `databaseSha256`; integrity; schema not ahead of this software;
   `deployment.environment` equals the binding's and this process's; the settings' Cloud venue id and
   stream id match; `sourceNodeId` has a `nodes` row and the
   held chart names it `serving-primary`; `copyNodeId` has no `nodes` row; every module's handover chain
   check passes. The chart is checked against keys in the same file: consistency, not authenticity,
   which rests on Cloud's hash of the stream it chose.
3. **Makes the copy's own `node.db`** in `<state>/scratch/`, migrated with the node set, and in ONE node
   transaction writes: a fresh signing key for `copyNodeId`, sealed on a **fresh vault ring made for
   this copy alone** (decision 5), saved durably as the copy's `secrets.env`; the role
   `mirror`/`secondary`, so any reader sees a box that does not sell and part 4 can promote it as it
   promotes a spare; and one `node_handover_events` row, kind `emergency_copy.placed`, with **no
   operation id** and the binding (with `copyOperationId`) in `detail`, so the restricted page's step
   list (`restricted-page.ts:85-94`) never shows it (decision 3). Then it writes `trading.env` naming
   `copyNodeId` through `writeTradingEnv` (decision 6), and moves `node.db` beside `venue.db`, flushing
   file and folder, so `venue.db` never sits with half a `node.db`. (As built, 2026-11-17: it copies
   `node.db` in as `node.db.incoming`, owner-only, flushes it and renames it inside the venue folder,
   which may be on another filesystem; placements in one process take turns.)
4. **A repeat** with the same binding makes no new key; another binding is refused. Nothing of the
   source's `node.db`, sealed state or recovery key is read.

`venue.db` is not written or migrated (decision 2); no restore hook runs, so no series, chain or filing
identity is made; no worker starts. A reader, `readPlacedEmergencyCopy(node)`, returns the record.

**An ordinary start refuses an unactivated placed copy**, before migrations, beside the environment
check (`boot.ts:1316`): when `node.db` holds an `emergency_copy.placed` record whose box is still
`mirror`, **whatever `WAITRON_NODE_ID` says**, and also when the configured id differs from the recorded
`copyNodeId`, it answers `node.emergency_copy_unactivated`. Part 3's locked start uses the same check to
choose its mode and **must never reach `:2112`**: the copy's `nodes` row only arrives at part 4's
activation, which sets the role to `primary` and so ends the refusal.

## Pull requests

Each leaves `main` green: nothing calls the function until A1188 part 3; the refusal fires only on its files.

**PR 1: the checks (read-only).** New `apps/server/src/emergency-copy-binding.ts` (shape) and
`emergency-copy-check.ts` (step 2); the venue-set not-ahead check factored out of `checkCopy`
(`spare-copy.ts`) for both; `emergency_copy.*` codes in `errors.ts` (one per refusal, a bad binding
naming its `field`). First failing test: `emergency-copy-check.test.ts` "accepts a copy whose binding
matches", then one refusal per check beside a control differing only in that field, a `node.db` already
beside the file (a stand-in for the source's `node.dump`) refused, and the file's bytes unchanged
afterwards. Its opens are immutable, so checking a WAL-mode file leaves no `-wal` or `-shm` beside it.
About 190 production, 340 test lines.

**PR 2: the copy's own `node.db`.** `emergency-copy-placement.ts` (steps 3–4, the reader; as built,
2026-11-17, the reader is in `emergency-copy-check.ts`, which needs it). First failing
test: `emergency-copy-placement.test.ts` "a placed copy has its own key and the venue file is byte for
byte the one Cloud chose". Then: the key opens only under `copyNodeId` on the copy's ring; `node.db`
holds no row for `sourceNodeId`; the role reads `mirror`; `trading.env` names `copyNodeId`; a repeat
keeps the same key; a different binding is refused; a failure before the move leaves no `node.db`.
PR 1's check refuses any `node.db` beside the file, so PR 2 admits one holding this binding's record
(the repeat). PR 1 checks the expiry only when it reads the binding, and the checks can run for many
minutes, so placement checks the expiry again before it writes anything. About 190 production, 280 test
lines.

**PR 3: an ordinary start refuses it, and the docs.** `boot.ts` (the check, before migrations), the
check in `emergency-copy-placement.ts`, and the new code `node.emergency_copy_unactivated` with its
alert-codes, errors-reachable and recovery-page wording. First failing test,
`boot.emergency-copy.test.ts`: under the **source's** id the start refuses with that code and
`venue.db`'s SHA-256 is unchanged (the reviewer's probe saw such a start succeed). Also: under the
copy's id (the new code before migrations, not `:2112` after); an older schema (refused unmigrated).
Docs: A1425 and A1188 backlog entries, `docs/developers/conventions-data.md`, and `state-layout.ts` if
its guard asks. About 60 production, 160 test lines.

**Unedited, run beside each PR:** `apps/server/src/` `restore.test.ts`, `restore-stream.test.ts`,
`restore-request*.test.ts`, `restore-fiscal-e2e.test.ts`, `handover-copy-from-backup.test.ts`,
`spare-copy.test.ts`, `spare-copy-placement.test.ts`, `boot.place-copy.test.ts`,
`boot.node-state-missing.test.ts`, `handover-two-boxes.test.ts`, `handover-controlled.e2e.test.ts`;
`packages/db/src/history-nodes.test.ts`, `packages/workforce/src/restore-continuation.test.ts`,
`packages/node-db/src/mode.test.ts`; `scripts/` `write-path-tables`, `state-layout`, `no-tmpdir-scratch`,
`alert-codes`, `errors-reachable` tests.

## Fiscal contact

None of `computeHuella`, the chain or `Encadenamiento`, invoice-number allocation, `registros_facturacion`
or its triggers, the alta builders, `registerSif` or `restoreFiscal` changes or is called. The one
fiscal-adjacent call is each module's handover chain check, through the read-only reader. The AEAT
certificate stays sealed on the venue's ring, which the copy does not hold (decision 5).
`write-path.e2e.test.ts` and `inmutabilidad.test.ts` (`packages/fiscal-verifactu/src/`) stay unedited.

## Schema

None: existing `node_handover_events` and `box` columns via their listed writers; no migration rebuilt.

## Risks

- **Started ordinarily under the source's id, a copy starts and changes `venue.db`** (reviewer's probe).
  PR 3 closes it; until part 3 calls placement, no such files exist outside tests.
- **`mirror` with no mirror link** is, I believe, new (not checked). Today's emergency declaration needs
  `mirror` and takes the source from the held chart (`handover-emergency-api.ts:327-336`), which on the
  copy names the source; part 4 may reuse it, checking it against this record.
- **The hash covers one file** (a `-wal` or `-journal` is refused) and proves Cloud's choice, not the newest copy.
- **Time:** integrity (provisional 30-minute limit, `handover-integrity.ts:48-49`), hash and chain checks
  run inside Cloud's fixed 30-minute window; part 3's qualification measures placement on the bench's
  year-size `venue.db` (my call: placement and locked start share the window).

## Decisions (defaults, each open to the watcher)

1. **A function the locked start calls, no command.** Alternative: a `waitron.commands` command.
2. **No migration at placement; a copy is admitted when every migration it records is one this
   software ships**; part 4 migrates after the declaration. Before go-live a starting migration is
   rebuilt rather than added to, so a copy made before a rebuild is refused as
   `provisioning.database_ahead` (a run-it review's probe, 2026-11-17, on a copy migrated from an
   earlier core baseline).
   Alternatives: migrate here (a write before it), or refuse (Cloud runs the box's exact version).
3. **The record carries no operation id**; `copyOperationId` sits in `detail` and part 4 begins the
   handover operation under it. Alternative: record under `copyOperationId` and add the kind to
   `HANDOVER_EVENT` (`handover-store.ts:29-37`) so the restricted page names the step.
4. **Cloud mints `copyNodeId`** (its binding holds it); Waitron checks it. **The record lives in
   `node.db`**, so it travels and commits with the key. Alternatives: Waitron mints; a state file.
5. **A fresh vault ring for the copy alone** seals the new signing key. The venue's ring, and with it the
   AEAT certificate and card credentials, reaches the copy only at part 4 ("Re-encrypting the
   certificate when restoring onto Cloud also remains open", `docs/backlog/replication-cloud.md:273`).
   Alternative: amend the agreement so the launcher delivers the venue's ring, naming who extracts
   `secrets.env` without `node.dump`.
6. **Placement writes `trading.env` naming `copyNodeId`** (design §4: "a new node id in `trading.env`"),
   refusing one that names another id; PR 3 refuses a start whose id differs from the record.
   Alternative: the launcher passes the id on every start.

## Questions

- **Watcher and lane J / Cloud (default: decision 5):** fresh ring now and the venue's at part 4, or the
  launcher delivers the venue's ring? Under the default the account key must arrive as an explicit
  `WAITRON_ACCOUNT_KEY`: a venue that never set one derives it from the venue's ring.
- **Lane J / Cloud (default: as written):** Cloud's `environment` spelled as Waitron's, and
  `databaseSha256` as lowercase hex of the file? Settled by the shared vectors the agreement requires.
- **Watcher (default: decision 2):** admit an older schema at placement, or refuse it?
