# A1425 part 3, cut to Cloud's emergency copy: a placed copy under a fresh machine identity

**Status:** plan, written 2026-11-17 by lane L (Claude). Not reviewed, not cleared. FISCAL lane: the owner
lands it. Ask: watcher 2026-11-16 02:06, recorded at `~/waitron-campaign-l/queue.md:109-110` and
`~/waitron-campaign-shared/watcher-handoff.md:3116`. Unless a line says "ran", every receipt below was
read at `main` 1de957e795, not run.

## Should this exist?

1. **The need.** The watcher: "fresh machine identities for the locked emergency copy; 'the existing
   source-identity restore is unchanged' … It unblocks lane J's A1188." Cloud's agreement: "Real
   placement still waits for A1425 part 3 / Waitron part 0" (Cloud contract, `origin/main` 34a0731e3,
   "Agreed part 3 values, 15 November 2026", item 1). **Once this lands nobody can do anything
   new yet**: lane J's locked start (A1188 part 3) gets a tested function that makes a downloaded copy of
   the venue's database a machine of its own. Starting the venue in Cloud stays unavailable until A1188
   parts 3–6 and Cloud's build land. **Alternatives:** change nothing (A1188 stays blocked); let lane J
   build placement inside its sign-in build (loses the separate fiscal review asked for); reuse #3142's
   spare placement (cannot work: it needs a box that already joined, below). No route, screen or schema
   change is added.
2. **True size (estimate, nothing built):** about 400 production lines and 750 test lines over three
   pull requests, about 40 lines of docs, no generated files, no migration rebuild.
3. **Approvals.** The A1425 design is owner-approved 2026-11-07 (its Status line, read). Cloud's 15
   November answer is "a technical agreement, not owner approval of a new design" (contract, same
   section); the watcher cleared that answer. The cut to the emergency copy is the watcher's (queue entry
   above), not the owner's. This plan's own choices (below) are unapproved.

## What exists today

| Piece | Today |
| --- | --- |
| Today's stream restore becomes the old box | It unseals the source box's saved state with the recovery key and writes the source's whole `node.db` (`node.dump`) beside the venue file (`apps/server/src/restore-stream.ts:363-368`); the identity is the backup's `trading.env` node id (`apps/server/src/restore.ts:913-947`); "a restore that keeps the box's identity keeps its node.db too" (`restore.ts:425`). Cloud's text still describes this for both restores (contract `:794-799`). It stays unchanged. |
| #3142, a spare picks a backup | `stageBackupAsCopy` decrypts an archive file with the recovery key, `skipSecrets: true` (`apps/server/src/handover-copy-from-backup.ts:85-109`); `stageCheckedCopy` checks the file's integrity, its schema, the fiscal chain (`checkHandoverCopy`) and then that the copy's `nodes` row holds **this spare's own public key** and its chart lists **this spare** as `serving-secondary` under the held chart's main box (`:39-64`). `placeFirstCopy` swaps the copy in at start only when this box's `node.db` says `mirror` (`spare-copy-placement.ts:40-53`). |
| How close #3142 is | Reusable as they stand: the integrity check (`handover-integrity.ts:51`), the read-only schema check that ignores node sets (`spare-copy.ts:188-209`), the module chain check (`packages/module/src/handover.ts:65-84`) and the read-only reader (`packages/store/src/backup-query.ts:10-40`, which denies every write through an authorizer). **Not reusable:** everything that presumes the box already joined: an existing `node.db` with a signing key and `mirror` role, a held chart, a `nodes` row for itself in the copy, a pair link, the recovery key, an archive file rather than a placed database. A fresh Cloud node has none of these. |
| Where the venue's own ids live | Cloud's venue id and the stream id are fields of the venue settings document (`packages/db/src/venue.ts:41-51`); the environment is `deployment.environment` (`packages/db/src/schema/deployment.ts:10-23`); a generation's name carries the node that wrote it (`packages/stream/src/names.ts:47-60`). So the binding's venue, environment, stream and source can all be checked against the placed file itself. |
| The machine's own key (#2371) | `node.db`'s `box` row holds the sealed signing key, the role and the recovery-key check (`packages/node-db/src/schema/box.ts:5-61`); `sealNodeSigningKeyTx` seals a key on the venue's key ring, bound to the node id (`packages/credentials/src/node-signing-key.ts:34-48`). |
| A node with no recorded role | Reads as a sole primary (`packages/node-db/src/mode.ts:36-46`). **Ran:** `pnpm exec vitest run src/mode.test.ts -t "sole primary"` in `packages/node-db`: `Tests 8 passed | 14 skipped`, including "reads as a sole primary when the node has no row". So a fresh `node.db` holding only a key would read as a box that sells. |
| "Whose history is mine" (#2570) | `readHistoryNodes` walks `handover_activations` from this box back (`packages/db/src/history-nodes.ts:11-30`); `readTakenOverFrom` is the same list without this box (`apps/server/src/handover-collection.ts:9-14`). Its one writer, by grep of `insertHandoverActivationTx` outside tests, is activation (`apps/server/src/handover-activation.ts:149-157`), which takes source and destination from this box's `node_handover_operations` row, begun at the emergency declaration (`handover-emergency-api.ts:622-631`). |
| Recording something in `node.db` with no schema change | `node_handover_events` takes any `kind` and a JSON `detail`, and its `operation_id` need not name an existing operation (`packages/node-db/src/schema/node-handover.ts:69-81`); `readHandoverEvent` reads one by operation and kind (`packages/node-db/src/handover.ts:127-145`). |
| Ordinary start | Places #3142 copies, then checks the environment "before ANY write, including migrations" (`apps/server/src/boot.ts:1296-1317`); a `mirror` without a mirror link is refused only much later (`boot.ts:2502-2510`). |

## Which parts of the A1425 design this cut builds

Builds now: a new node id and signing key for the copy; the source's history left under the source's id
(§4 "Kept as history"); the source recorded as what the copy takes over from, so activation can write the
row `readHistoryNodes` reads (§2, §9 first bullet: "a handover activation row").

Belongs to A1188 part 4 (activation, after the declaration), not here: the copy's `nodes` row and public
key in `venue.db`, the next chart, its own filing identity, chain and series, a new bucket generation.
Part 4 reuses today's emergency activation, which already writes `handover_activations`.

Left for a later "every restore" part (the copy never holds the source's private key): §4's
replacement statement and old-key destruction, the recovery pack following statements, the carry-overs
and restore marker; §5's no-re-pairing test; §6's two machines; §7's earlier-text changes. The copy's
evidence against the old box is A1018's declaration signed with its own key, as on a spare today.

## The build

**One function, `placeEmergencyCopy`, in `apps/server/src/emergency-copy-placement.ts`**, which A1188
part 3's locked start calls before it enters the locked mode, with launcher inputs: the copy binding
exactly as the A1188 part 3 proposal item 1 lists it, the folder where Cloud's reader put `venue.db`, the
state folder, the venue's key ring (the "account-key source") and this process's environment. It fetches
nothing; the copy holds no bucket credential (decision 1).

It holds the venue folder's lock throughout (`lockVenueDatabase`), then:

1. **Checks the binding's shape:** lowercase UUID v4 ids, `sourceNodeId ≠ copyNodeId`,
   `copyOperationId` distinct from both, instants in ISO UTC with milliseconds, `expiresAt` exactly 30
   minutes after `startedAt` and not yet passed by this machine's clock.
2. **Checks the placed file without opening it for writing:** no `-wal` beside it (its contents would
   not be covered by the hash); its SHA-256 equals `databaseSha256`; integrity; schema not ahead of this
   software; `deployment.environment` equals the binding's and this process's; the settings' Cloud venue
   id equals `venueId` and stream id equals `streamId`; the generation's name parses and names
   `sourceNodeId`; `sourceNodeId` has a `nodes` row and the held chart names it `serving-primary`;
   `copyNodeId` has no `nodes` row; every module's handover chain check passes. The chart is checked
   against keys held in the same file, so it proves consistency, not authenticity: authenticity rests on
   Cloud's hash of the stream it chose.
3. **Makes the copy's own `node.db`** in `<state>/scratch/`, migrated with the node set, and in ONE node
   transaction writes: a fresh key pair sealed for `copyNodeId` on the venue's ring; the role
   `mirror`/`secondary` (so any reader of the role sees a box that does not sell, and part 4 promotes it
   as it promotes a spare); and one `node_handover_events` row, kind `emergency_copy.placed`,
   `operation_id = copyOperationId`, detail = the binding. Then it moves `node.db` beside `venue.db`,
   flushing both the file and the folder, so `venue.db` never sits with half a `node.db`.
4. **A second call** with the same binding returns without a new key; another binding is refused.
   Nothing of the source's `node.db`, sealed state or recovery key is read.

`venue.db` is not written or migrated (decision 2); no restore hook runs, so no series, chain or filing
identity is made; no worker starts, since this is a function, not a start.

A reader, `readPlacedEmergencyCopy(node, copyNodeId)`, returns the recorded binding for parts 3 and 4.
**An ordinary start refuses a placed copy** before any write, beside the environment check
(`boot.ts:1316`): a `node.db` holding an `emergency_copy.placed` event for a box still recorded as
`mirror` with no mirror link answers `node.emergency_copy_unactivated`. Exported as a check part 3 uses to
choose its locked mode. After part 4's activation the role is `primary` and the check passes.

## Pull requests

Each leaves `main` green and working: nothing in production calls the function until A1188 part 3, and
the start check only fires on files the function made.

**PR 1: the checks (read-only).** New `apps/server/src/emergency-copy-binding.ts` (shape) and
`apps/server/src/emergency-copy-check.ts` (step 2), `emergency_copy.*` codes in `apps/server/src/errors.ts`
(one per refusal, a bad binding naming its `field`). First failing test: `emergency-copy-check.test.ts`
"accepts a copy whose binding matches", then one refusal per check beside a control differing only in
that field, and the file's bytes unchanged afterwards. About 180 production, 320 test lines.

**PR 2: the copy's own `node.db`.** `apps/server/src/emergency-copy-placement.ts` (steps 3–4 and the
reader). First failing test: `emergency-copy-placement.test.ts` "a placed copy has its own key and the
venue file is byte for byte the one Cloud chose". Then: the key opens only under `copyNodeId`; `node.db`
holds no row for `sourceNodeId`; the role reads `mirror`; a repeat keeps the same key; a different binding
is refused; a failure before the move leaves no `node.db` beside `venue.db`. A hand-off case: copy the
placed `venue.db` aside, add the copy's `nodes` row and `insertHandoverActivationTx` from the recorded
binding, then `readHistoryNodes(copyNodeId)` answers `[copy, source]` and `readTakenOverFrom` answers
`[source]`. This proves the record feeds the walk, not that part 4 writes it. About 170 production, 300
test lines.

**PR 3: an ordinary start refuses it, and the docs.** `apps/server/src/boot.ts` (the check), the check
itself in `emergency-copy-placement.ts`, its error code, and recovery-page wording if
`recovery-surface.test.ts` requires one for a start refusal. First failing test:
`boot.emergency-copy.test.ts` "an ordinary start on a placed copy refuses before any write": `startServer`
on PR 2's output refuses, and `venue.db`'s SHA-256 is unchanged. Docs: the A1425 and A1188 backlog
entries, a line in `docs/developers/conventions-data.md`, and the scratch subfolder's name in
`packages/store/src/state-layout.ts` if `scripts/state-layout.test.ts` asks for it. About 50 production,
130 test lines.

**Unedited, and run beside each PR:** in `apps/server/src/`, `restore.test.ts`, `restore-stream.test.ts`,
`restore-request*.test.ts`, `restore-fiscal-e2e.test.ts`, `handover-copy-from-backup.test.ts`,
`spare-copy-placement.test.ts`, `boot.place-copy.test.ts`, `boot.node-state-missing.test.ts`,
`handover-two-boxes.test.ts`, `handover-controlled.e2e.test.ts`; `packages/db/src/history-nodes.test.ts`,
`packages/workforce/src/restore-continuation.test.ts`, `packages/node-db/src/mode.test.ts`; root
`scripts/write-path-tables.test.ts`, `state-layout.test.ts`, `no-tmpdir-scratch.test.ts`.

## Fiscal contact

None of `computeHuella`, the chain or `Encadenamiento`, invoice-number allocation, `registros_facturacion`
or its triggers, the alta builders, `registerSif` or `restoreFiscal` changes or is called. The one
fiscal-adjacent call is each module's handover chain check, through the read-only reader.
`packages/fiscal-verifactu/src/write-path.e2e.test.ts` and `inmutabilidad.test.ts` stay unedited and run
on PR 2.

## Schema

None in any PR: the record is a row of the existing `node_handover_events`, the key and role use the
existing `box` columns through their listed writer (`packages/node-db/src/box.ts`), and `venue.db` gains
nothing. No starting migration is rebuilt.

## Risks

- **A copy with no recorded role reads as a box that sells** (ran, above). Whether an ordinary start on
  one would get as far as selling was not tested; the `mirror` role and PR 3 remove the question.
- **The copy's role is `mirror` with no mirror link**, a combination I believe no box has today (not
  checked). Today's emergency declaration requires `mirror` and takes the source from the held chart's
  serving primary (`handover-emergency-api.ts:327-336`), which on the copy is the source, so part 4 may
  reuse it; part 4 must also check it against this record.
- **The hash covers one file**, so a `-wal` is refused; and it proves the file is the one Cloud chose,
  not the newest. Freshness stays Cloud's choice and the declaration's.

## Decisions (defaults, each open to the watcher)

1. **A function the locked start calls, no command.** Alternative: a `waitron.commands` command run by
   Cloud's launcher first, added only if Cloud wants a separate step.
2. **No migration at placement; an older schema is admitted**, so `venue.db` stays as hashed and part 4
   migrates after the declaration. Alternatives: migrate here (a write before the declaration), or refuse
   an older schema (Cloud must run the box's exact version).
3. **`copyOperationId` is also the handover operation id** part 4 begins. Alternative: a separate id.
4. **Cloud mints `copyNodeId`**, as its binding holds it; Waitron only checks it. Alternative: Waitron
   mints it, which the agreed binding does not allow.
5. **The record lives in `node.db`, not a state file**, so it travels and commits with the key.

## Questions

- **Lane J / Cloud (default: as written):** Cloud's `environment` spelled as Waitron's, and
  `databaseSha256` as lowercase hex of the file? Settled by the shared vectors the agreement requires.
- **Watcher (default: decision 2):** admit an older schema at placement, or refuse it?
