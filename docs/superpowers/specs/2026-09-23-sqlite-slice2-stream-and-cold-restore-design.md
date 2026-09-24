# SQLite slice 2: stream and cold restore — design

**Date:** 2026-09-23. **Status:** approved by the owner 2026-09-23, and amended the same day while planning — §0 items 11–17 and the passages they touch. The plan is `docs/superpowers/plans/2026-09-23-sqlite-slice2-stream-and-cold-restore.md`.

**Builds on:** [SQLite + Litestream topologies](2026-09-16-sqlite-litestream-topology-design.md)
(the architecture; its §11 names this slice) and
[the failover prototype's results](../../research/2026-09-16-sqlite-failover-prototype.md) (the gate
that had to pass before this slice; read its "What this gate leaves to be built"). Slice 1 —
[storage swap](2026-09-16-sqlite-slice1-storage-swap-design.md) — is complete.

**In one sentence:** a single venue continuously streams its database to an S3-compatible bucket the
owner supplies, a dead box can be rebuilt from that bucket and carry on trading under a fresh fiscal
chain with nothing re-entered but one recovery kit, and staff can see how current the copy is.

---

## 0. Decisions taken with the owner (2026-09-23)

1. **Owner-supplied bucket first.** Slice 2 streams to a destination configured on the box. The
   Waitron ↔ Waitron Cloud contract is unsettled (`docs/backlog.md` → *Cloud integration and SQLite
   work*), and Waitron Cloud's bucket plugs into the same setting once it says how a box receives a
   bucket address and key. Ownership: Waitron owns Litestream, backup and restore
   (`docs/cloud-ownership.md`).
2. **S3-compatible buckets only.** Litestream 0.5 cannot encrypt what it uploads, so a folder on a NAS
   or USB disk would hold the venue's whole database in the clear. The bucket's own server-side
   encryption is the floor (topology §0.3, §7.4). The encrypted archive stays the way to put a copy on
   a USB disk.
3. **The side file is alerted on, then bounded by stopping Litestream.** See §4.5.
4. **Rebuild from the stream is in this slice**, through today's restore path, not deferred to
   slice 3's seats (§5).
5. **Screens are in this slice:** a dashboard settings screen, and "restore from my bucket" in the
   setup wizard. A real box's operator has no terminal.
6. **Per-machine tables stay in `venue.db`, keyed by node id** (owner's proposal) — replacing the
   topology design's plan to move them into `node.db` (§2).
7. **A rebuild must not make the owner re-enter configuration while the venue cannot trade.** The
   owner rejected a draft in which provider credentials were lost on a rebuild. The rebuild asks for
   ONE thing: the recovery kit (§3, §5.3).
8. **What unlocks a rebuild is the recovery key the owner already holds for archives**, carried inside
   the recovery kit.
9. **One full copy a day, and a 7-day history window** (§4.4) — replacing the topology design's
   hourly copies and 30 days.
10. **Litestream runs as a child process of the server** (§4.1), not a separate container and not a
    host service.

**Taken while planning (2026-09-23), after the design was approved:**

11. **Images are shrunk on upload.** The owner expects up to 5,000 product images, and they were
    stored full-size inside `venue.db`, which would have made every daily copy, every rebuild and every
    archive 10–24 GB. Each upload is resized (at most 1,600 pixels on the long side, WebP) with its
    location data removed; the upload limit rises from 5 MiB to 20 MiB. The resizing library, sharp,
    loads libvips (LGPL-3.0-or-later) as a separate shared library; its notices ship in the box image
    and the legal track gets a line for the advisor to confirm.
12. **A login survives a rebuild and a promotion.** Sessions are venue data, not keyed by node.
13. **One recovery key per venue.** Turning archives on reuses the key streaming set up.
14. **An archive restore gets the same first start as a bucket rebuild**: a certificate for this
    machine's addresses and a membership document one term higher (§5.1 step 7).
15. **The break-glass and `waitron-credentials` tools keep working beside a running server**; the
    single-process lock (§6) refuses everything else.
    > 2026-09-24: the lock is built (`packages/store/src/venue-lock.ts`). Five callers open without
    > it: break-glass, `waitron-credentials`, and the scripts `record-one-sale.ts`,
    > `settle-invoice-first.ts` and `cloud-backup-fixture.ts`'s capture step. `deploy/waitron.sh`'s
    > stamp read opens `venue.db` with its own read-only `node:sqlite` connection, not through the
    > store, so it takes no lock either. See `docs/developers/conventions-data.md`, "One process per
    > venue folder".
16. **A box never replaces a pointer that names a higher term than its own**; it stops streaming and
    raises `backup.stream_refused` (§4.4).
17. **The venue id is the node's location id** (`config.till.locationId`), which boot already treats as
    the single operational venue.

---

## 1. What slice 2 is, and is not

**Delivers:**

- `venue.db` streamed continuously to the owner's S3-compatible bucket, one generation per primary,
  with a signed pointer naming the live one.
- A bound on the write-ahead side file while the bucket is unreachable.
- Freshness on `/health`, the box status page and dashboard alerts.
- A rebuild of a dead box from the bucket — setup wizard and command line — that comes back as the
  same node, with its certificate authority and credentials, under a fresh fiscal chain.
- The restart reset the topology design's §5.2 requires, and the single-process lock on the venue
  folder that makes it safe. (2026-09-23: the reset landed first, see §6; the lock is still to build.
  2026-09-24: the lock is built, see §6.)

**Does not deliver**, stated so nobody assumes otherwise: promotion, seats, a second live node, the
tail shipper, the mirror box, fencing a running box remotely, the Waitron Cloud bucket, streaming to a
folder, point-in-time restore as a product feature, and sharing credentials between two live nodes
(§3.3 records that last one as a decided requirement for slice 3). **A venue still has one node and no
failover** — a rebuild is a cold restore, used only when the old box is gone.

---

## 2. Per-machine rows stay in `venue.db`

**Why this changed.** The topology design (§2.1) moves every `local` table into `node.db`, so only
`venue.db` streams. Today that split exists only on paper: `packages/migrations/src/apply.ts` applies
every migration set to the venue file, and `node.db` holds no tables (`packages/credentials/src/bin.ts`
says so in its comment on `store.venue`). Doing the split would take a migration set per file per
module, would make any transaction that writes both files all-or-nothing per file only, and would
still leave `change_log` with nowhere to go, because a trigger cannot write another attached file
(measured 2026-09-22, `docs/backlog.md`). Worse for recovery: a rebuild from the stream would come
back without what `node.db` held.

**What happens instead:**

- Every table stays in `venue.db` and streams.
- A table whose rows really belong to one machine gains a `node_id` column and every read and write
  names it. The `local` tables today, across every `classification.ts`: `deployment`, `mirror_config`,
  `node_membership`, `join_requests`, `change_log` (`packages/db`); `sessions`, `management_sessions`,
  `webauthn_challenges`, `totp_enrollments`, `google_oidc_states` (`packages/identity`);
  `scheduled_runs` (`packages/scheduler`); `tenant_credentials` (`packages/credentials`). The plan
  decides each. Two are settled here: `node_membership` stays a single row, because the membership
  document is the same on every node of a venue, and `change_log` needs nothing (below). Settled
  during planning: the session and sign-in tables become `state`, because a login survives a rebuild
  and a promotion (§0.12); `deployment` keeps only the environment stamp, a single `state` row, and
  this node's role moves to a new `local` table keyed by node id; `tenant_credentials` stays `local`
  without a node id until slice 3 replaces the per-machine key (§3.3).
- **Anything that works as a live login is stored as a hash**, because the bucket now holds it. Two
  identifiers are bearer cookies stored raw today: a management session's id, sent as the dashboard
  cookie (`apps/server/src/management-api.ts`), and a till session's id, sent as the shift cookie
  (`apps/server/src/till-session.ts`, `setSessionCookie`). Both become hashed at rest. Already hashed,
  so unchanged: pairing tokens (`token_hash` on `join_requests`, `devices`, `print_agents`) and the
  Google sign-in state (`state_hash`). A WebAuthn challenge stays raw: it signs nobody in without the
  authenticator. Reading the bucket must never let anyone into the live box.
- **The `local` class changes meaning** from "lives in `node.db`" to "belongs to one node, keyed by its
  id, still streamed". Its reason strings — `tenant_credentials`' describes a per-node vault and is
  rewritten — and its guards (`scripts/classification-complete.test.ts`,
  `scripts/two-file-foreign-keys.test.ts`) are updated to say so.
- **`node.db` stays, empty, reserved for slice 5**, whose mirror box follows `venue.db` read-only and
  may need somewhere writable of its own. Slice 5 decides.
- **`change_log` needs nothing.** `withTransaction` deletes its rows inside the transaction that wrote
  them (`packages/db/src/tenancy.ts`, `drainChangeLog`). A write made outside `withTransaction` leaves
  its rows until the next drain, so a few can be at rest in the stream; they name only which resource
  changed, and nothing reads them from a restored copy.

---

## 3. What a rebuild brings back

### 3.1 The box's own secrets, locked with the recovery key, in the stream

Much of what a box needs lives in its state folder, not the database: the vault master key
(`secrets.env`, written by `apps/server/src/box-secrets.ts`), `trading.env`, the box's certificate
authority and server certificate (`RECOVERY_FILES`, `apps/server/src/state-secrets.ts`), and two
optional files, `backup.env` — which holds the recovery key — and `modules.json`, without which the
default module set enables both fiscal modules and boot fails `module.fiscal_slot_ambiguous`
(`OPTIONAL_BACKUP_STATE`, `apps/server/src/backup-optional-state.ts`; the consequence is stated in
`provision.ts`'s comment, read, not run). Tills and handhelds trust the box through that certificate
authority, installed from `/setup/trust` (`apps/server/src/discovery-api.ts`). The encrypted archive
carries all of it, plus a manifest and any module files declared outside the database
(`apps/server/src/backup-sweep.ts`, `runOnce`), which is why an archive restore brings a box back
whole.

**Slice 2 puts everything the archive carries except the database into the stream, locked with the
same key:**

- The box packs the archive's own entries minus `db.dump` — the manifest, the state files, the
  optional state and any declared module files — with the archive's own packer and cipher
  (`backup-archive.ts`, `apps/server/src/artifact-cipher.ts`), and writes the result into one row of a
  new table keyed by node id. The row streams with everything else.
- It rewrites the row whenever one of those files changes, and at every start after migrations, so the
  manifest's schema versions match the database the row travels with.
- The bucket therefore holds nothing that the archive's off-box copies do not already hold, and
  nothing usable without the recovery key.
- **Streaming needs a recovery key, and switching it on sets one if there is none.** Today the key is
  read only alongside an archive destination: `loadBackupConfig` returns nothing when no destination
  is configured, before it reads the key (`apps/server/src/backup-config.ts`). The plan separates the
  two, so a venue can stream without also archiving.
- **Rotating the recovery key re-locks the row and reissues the recovery kit** (§4.3). Rows already in
  the 7-day history stay locked with the old key, so restoring to a point before the rotation needs
  the old kit; the screen says to keep it for seven days.

> 2026-09-24: Task 2a (branch `feat/sqlite-slice2-recovery-key`) changed the "today" above —
> `loadRecoveryKey` reads the key without an archive destination, and a box can hold one with none.

### 3.2 Why not simply stream the credentials

Credentials are locked under the box's vault master key, which only that box holds. Streaming them
bare would make every Stripe, SumUp and AEAT credential readable to anyone with bucket access;
streaming them without the master key makes them useless to a rebuild. §3.1 brings back the master key
itself, locked, so the credentials open as they always did.

### 3.3 Decided for slice 3: a venue credentials key

A rebuild brings back the one box's own keys, so slice 2 needs nothing more. From slice 3 a DIFFERENT
machine takes over, and it cannot open another box's vault. **Decided, 2026-09-23: credentials move to
a venue key**, stored in `venue.db` only in locked form — locked with the recovery key, and with each
enrolled node's key, and with a key Waitron Cloud holds — so promotion needs nobody to type anything.
This is slice 3's first task. It is recorded here so slice 3 does not reopen it.

---

## 4. The stream

### 4.1 Where it runs

- A new package, **`@waitron/stream`**: Litestream's configuration writer, the supervisor for the
  child process, a small S3 client for the pointer file and generation housekeeping, and the freshness
  reader. It opens no database itself; `apps/server` passes it the venue folder, a way to learn when
  the last write committed, and a function that folds the side file back through `packages/store`
  (§4.5).
- `apps/server` starts it **on the primary only**, the way `BackupSupervisor`
  (`apps/server/src/backup-supervisor.ts`) is started today, and stops it at shutdown.
- The supervisor writes the configuration, starts `litestream replicate`, restarts it with a backoff if
  it exits, and passes bucket credentials through the child's environment, never the configuration
  file (the bench rig's pattern, `bench/sqlite-failover/src/litestream.ts`).

### 4.2 The binary

Litestream **0.5.17**, the version the prototype measured, pinned. The box image
(`deploy/Dockerfile`) downloads it at build time for both processor types and checks its checksum.
Developers get it from a setup script like the bench rig's `setup:litestream`. A version bump re-runs
the measurements of §8.1 and the prototype, whose verdicts do not carry across a version.

### 4.3 Settings, the Test button and the recovery kit

- A dashboard screen takes the bucket: address, region, an optional endpoint for non-Amazon stores,
  and the access key. They are stored in the credentials vault under a new purpose.
- **Test** writes, reads and deletes a probe object and proves the conditional write (§4.4): a write
  "only if absent" of an existing object must be refused, and a write "only if unchanged" against a
  stale version must be refused. A bucket that fails is refused with the reason. This turns the
  prototype's standing obligation — check the conditional write on every store the product supports —
  into a check run on each owner's own bucket.
- **The recovery kit.** When streaming is switched on, the dashboard offers one file (also shown as a
  single string) holding the bucket details, the venue id, the recovery key, and the public key of the
  node that signs `current.json`. **The kit is as sensitive as the recovery key**, and the screen says
  so. It is what a rebuild asks for, and nothing else (§5).

### 4.4 Generations, the pointer, and history

- Everything lives under `venues/<venue-id>/` in the bucket.
- **A generation** is one primary's unbroken stream. The topology design names it
  `gen-<term>-<node-id>` (§2.2), which is unique only while node ids are never reused — and a slice-2
  rebuild reuses the dead box's id. A rebuilt box can die before its pointer moves, and the next
  rebuild restores from the same older generation and signs the same next term; an archive restore can
  bring back an even lower term. **So a generation's name also carries when it was opened**
  (`gen-<term>-<node-id>-<opened-at, UTC>`), and opening one begins with a create-only write of a
  marker object inside it (`If-None-Match: *`): a folder that already exists is never written into.
  Term still orders generations for humans and audit; the pointer, not the name, says which is live.
  A box only ever writes a generation it opened.
- **`current.json`** names the live generation: venue id, term, node id, generation, and the time it
  was written, signed with the node's membership key (`packages/membership`, `signDocumentBody`).
  (2026-09-24: as built, the pointer is signed with `signBytes` over a purpose-tagged message,
  `packages/stream/src/pointer.ts`; the plan's appendix, Spec problems item 1 under the Task 4–5
  notes, explains why.)
- **Order of opening a generation:**
  1. start Litestream into the new generation;
  2. wait until its first full copy has landed in the bucket;
  3. replace `current.json` **only if unchanged since read** (`If-Match` on the version read, or
     `If-None-Match: *` when there is none).
  A restore that starts between steps 1 and 3 still finds the previous, complete generation.
  **Trading does not wait for step 3** — nothing external may block a sale. The cost: sales made
  before the first full copy lands are in a generation no restore follows yet. That window is normally
  seconds; if the bucket fails inside it, `backup.stream_behind` fires and the window lasts until the
  bucket answers.
- **A refused pointer write** ("precondition failed") means another box is writing this venue — with
  one exception found during planning: the S3 client resends a write after a server error, so a write
  that landed but lost its answer is refused on the resend. A refusal is therefore a loss only if the
  pointer does not now hold exactly the bytes this box wrote. On a real loss the box stops streaming
  and raises `backup.stream_refused`. **A pointer naming a higher term than this box's is never
  replaced**, whatever the conditional write would allow (§0.16). **A "conflict" answer is retried, not treated as
  a loss** — Amazon documents that a conditional write can be answered with a conflict when a delete
  races it, and that the write may be retried (topology §13, risk 11's note).
- **History.** Litestream's own words, from its configuration reference
  (<https://litestream.io/reference/config/>, fetched with `curl` 2026-09-23): full copies are
  `snapshot: interval` ("How often Litestream takes a full snapshot. Defaults to 24h") and
  `snapshot: retention` ("How long Litestream keeps snapshots and their associated LTX files"); between
  full copies, change files are merged through `levels` (defaults 30s, 5m, 1h) "so recent transactions
  stay fine-grained while older data is consolidated". Retention "is controlled globally", in hours
  only ("days, weeks, & years are not supported"). **Slice 2 sets one full copy a day and 168 hours'
  retention.** Restoring to the latest point is exact whatever the interval; more frequent full copies
  only shorten the replay.
- **Old generations.** Litestream tidies only the generation it writes. The supervisor deletes a whole
  generation once its newest file is older than the window **and** the pointer does not name it.

### 4.5 The side file while the bucket is unreachable

The prototype measured the problem (results note, S4): while Litestream is running and cannot reach
its store, SQLite cannot fold the write-ahead side file back, it grew about 41 KB a sale on the rig's
model, and our own checkpoint blocked for seconds and freed nothing. The only thing that reclaimed it
was stopping Litestream.

- **Alert first:** `backup.stream_behind` once freshness (§7) passes a threshold — 15 minutes to
  start.
- **Then a hard limit of 256 MiB.** When the side file reaches it, the supervisor stops Litestream,
  folds the file back, raises `backup.stream_paused`, and restarts Litestream when the bucket answers
  again. The figure sits below the largest side file the prototype sold against without slowing (310
  MB, results note S4), and below Litestream's own emergency threshold: its configuration reference
  (`truncate-page-n`, default "121359, ~500MB") says that past it Litestream "forces a blocking
  TRUNCATE (which blocks both readers and writers)" — a pause on the sale path this limit exists to
  keep us short of. No box disk size is recorded anywhere to set it against instead.
  **2026-09-23:** arm 2b drove an offline side file past that threshold, for a few seconds only; it did
  not shrink, the longest commit over the whole arm was 6.861 ms, and what the emergency checkpoint does over longer was
  not established (results note, Slice 2 measurements §2).
- **The fold-back runs on the writer connection, in a write-queue slot, with no transaction open.**
  Measured during planning (Node v26.7.0, SQLite 3.53.4): run from a separate connection while a sale's
  transaction was open, it waited out the whole busy timeout, and because `node:sqlite` is synchronous
  the whole process waited with it. On the writer, between transactions, it took under a millisecond,
  or answered "busy" in under a millisecond when a reader held the file.
- **What restarting after that looks like is measured first** (§8.1, item 1). If Litestream uploads a
  fresh full copy on restart, the same generation continues. If it does not, the supervisor opens a new
  generation after every pause; generation names already carry when they were opened (§4.4), so no
  extra counter is needed.
  **2026-09-23, measured:** the restarted daemon did NOT upload a new level-9 full copy; it uploaded
  the missed sales into the same generation, and a restore after the restart held every sale. So the
  condition as worded above does not describe what happened: the recorded `RESTART_RESYNCS = true`
  rests on the restore being complete. Which branch the supervisor takes is for Task 6 and the owner
  to confirm against this result (results note, Slice 2 measurements §1).
- **Whether SQLite's automatic folding should be switched off at all** is measured too (§8.1, item 2).
  The topology design says to (§8.3); the prototype found the setting makes no difference while the
  store is unreachable. Until the measurement says otherwise, `packages/store` keeps SQLite's default,
  and its comment (`packages/store/src/index.ts`) is updated to point here.

---

## 5. Rebuilding from the bucket

### 5.1 Setup wizard: "Restore from my bucket"

Beside the existing "Restore from an archive file":

1. The owner uploads or pastes the **recovery kit**.
2. The box reads `current.json` and verifies its signature against the public key carried in the kit,
   not the one in the restored database — a key read from the bucket would vouch for a pointer read
   from the same bucket. What this proves, and what it does not: the pointer was written by the node
   the owner's kit names. It does not prove the generation's files are untampered; **whoever can write
   the bucket can replace the venue's data**, and the bucket's own access control is the defence. Step
   5 adds that the secrets row was locked by someone holding the recovery key. An unverified pointer
   stops here, before anything is downloaded.
3. **It checks whether the old box still looks alive.** If the live generation received a change file
   in the last 10 minutes, the wizard says so and requires the owner to confirm the old box is gone.
   This is the only protection against two boxes selling that slice 2 can offer.
4. It has Litestream restore the latest point of the named generation into a **side file**, and runs
   SQLite's `integrity_check` and the existing "is this database ahead of this software" check. A
   failure stops here with nothing on the box changed. **Litestream leaves two tables of its own in
   the database it streams, and so in the restored copy** — `_litestream_seq` and `_litestream_lock`,
   measured during planning on 0.5.17 — plus a `.venue.db-litestream/` folder beside the live file.
   Any check that lists a live or restored database's tables leaves the two tables out by name, and
   the code that wipes or replaces `venue.db` (`apps/server/src/db-wipe.ts`, `restoreDatabase`)
   removes the folder with it.
5. It unlocks that node's locked secrets row (§3.1) with the kit's recovery key.
6. It stages the restore for the existing restore-on-next-start path
   (`apps/server/src/restore-request.ts`, `runStagedRestore`). **That path takes only an encrypted
   archive today** — `RestoreRequest` is `{artifact, recoveryKey, environment}`, and
   `restoreFromArtifact` refuses anything without `manifest.json` and `db.dump`
   (`apps/server/src/restore.ts`, `validateArtifact`). The request gains a second source kind: the
   restored database file plus the unlocked row's entries. Its validation replaces "decrypt and
   unpack" with steps 4 and 5, then runs the same compatibility gate (on the row's manifest), the same
   entry-name guard, and the same `writeValidated`: place the database, run the restore hooks — the
   fiscal one retires the node's registration and mints a fresh installation number above the clock
   floor, fresh series and a fresh chain head (`packages/fiscal-verifactu/src/restore.ts`,
   `registro-sif.ts`) — and write the state files last. The box does not assemble an archive from
   the pieces, which would write a second full copy of the database into the state folder.
7. **On first start** — after a bucket rebuild or an archive restore alike (§0.14) — the box:
   - re-issues its server certificate from the restored certificate authority for THIS machine's
     addresses. The restored certificate names the dead box's IP addresses, and today it is minted
     only when `server.key` is absent (`apps/server/src/box-secrets.ts`); devices trust the authority,
     not the certificate, so a re-issued one is accepted;
   - signs a membership document one term above the HIGHER of its own term and the bucket pointer's
     (when bucket settings exist and the pointer is readable), carrying this machine's contact
     address. An archive can be older than several rebuilds, and §0.16 would otherwise refuse its
     stream for good; an archive restore whose database holds bucket settings runs step 3's liveness
     check before it is staged;
   - opens its generation and starts streaming per §4.4;
   - trades.

Tills and handhelds keep trusting the box without re-pairing, because the certificate authority came
back with it. **Finding the box at a changed address**, read from the code during planning and not
run on hardware: tills, handhelds and kitchen screens opened at `https://waitron.local`, and a print
agent on the box itself, find it by themselves (on iPhones this rests on `waitron.local` resolving,
which a design spec lists as unverified); a device opened at an IP address, and a print agent on
another computer given an IP address, need a person to point them at the new address. The wizard's
last screen says so.

### 5.2 Command line

`waitron-restore --from-bucket <kit>` runs the same steps, for development and support. One restore
uses one source, the stream or an archive file, never both — or one event would mint two installation
numbers (topology §7.5).

### 5.3 Going live is never blocked

Cash sales start as soon as the box is up. Filing and card payments need the credentials, which step 5
already unlocked. **If a step of the first start fails** (step 7), the box still goes live, does not
stream, raises an alert, and retries the step at the next start.

---

## 6. The restart reset

A restored copy — from the stream or from an archive — can hold sales marked "being sent to AEAT right
now". Today they wait five minutes (`recoverStaleClaims`, `packages/fiscal-verifactu/src/drain.ts`).
**On every start, before filing anything, the box puts every such sale back to waiting.** This is the
reset the topology design's §5.2 requires and the prototype listed as unbuilt.

**2026-09-23: the reset itself is built** — `resetInFlightClaims` (`packages/fiscal-verifactu/src/drain.ts`) returns every `enviando` row to `pendiente`, raising `incidencia`, and `resetBeforeFirstDrain` (`apps/server/src/restart-reset.ts`) runs it before a boot's first filing pass, and again only if that attempt failed. The single-process lock below is not.

**What a resend costs.** A sale AEAT already holds is answered with error 3000, and that answer
may say what state AEAT's stored copy is in. The drain acts on that state. If AEAT's copy is
accepted, the sale is marked accepted; if it is accepted with errors, the sale is marked accepted
with errors and a warning incident (`fiscal.aceptado_con_errores`) is raised. In both cases no
fingerprint (huella) is compared (`resolveEstadoEfectivo` in `@waitron/verifactu`, then
`applyOutcome` in `drain.ts`). If AEAT's copy
is annulled, the sale and every later one in its chain stop and an incident is raised for a person. If
AEAT does not say what state its copy is in, the drain asks AEAT for its copy and compares
fingerprints (`handleDuplicate`): a match marks the sale accepted, and a difference stops the sale and
its chain with an incident. An unchanged resend of a sale that was accepted takes the first path. That
is read from the code and the prototype's results note (S2), not run against AEAT.

**What a rebuild cannot recover.** Sales the old box filed in its last moments but did not stream are
not in the restored database at all, so nothing resends them: AEAT holds records the venue's books
lack. The fresh installation number and series keep the new chain's numbers apart from them, and they
are reconciled from AEAT's copy — the accepted cold-recovery posture, which trades a small loss of
data for never being stuck offline.

**Precondition: one server process per venue folder.** The reset is safe only if nothing else is
filing from the same database — it runs before the first filing pass, so it cannot race its own
process's drain, but an unconditional reset would undo another process's claim. Nothing stops a second
process opening the folder today (no single-instance lock was found in `packages/store` or
`apps/server`). **Slice 2 enforces it:** the store takes an exclusive lock on the venue folder at open,
and a second opener is refused with a named error. The plan checks whether the migrator's existing
lock can serve.

> 2026-09-24: the lock is built (`packages/store/src/venue-lock.ts`); a second process is refused
> `provisioning.database_in_use`. Five callers open without it: break-glass, `waitron-credentials`,
> and the scripts `record-one-sale.ts`, `settle-invoice-first.ts` and `cloud-backup-fixture.ts`'s
> capture step. `deploy/waitron.sh`'s stamp read opens `venue.db` with its own read-only
> `node:sqlite` connection, not through the store, so it takes no lock either. The migrator's lock
> could not serve: it queues a second migrator instead of refusing it. See
> `docs/developers/conventions-data.md`, "One process per venue folder".

---

## 7. Freshness, `/health` and alerts

- **Freshness is how long the oldest change not yet in the bucket has been waiting.** It is zero when
  the bucket holds everything up to the last committed write. It is not time since the last upload,
  which would call an overnight copy with nothing to upload stale.
- **It is read from the bucket**, by listing the live generation's newest file about once a minute,
  not from Litestream's own report — a Litestream writing somewhere else, or nowhere, would otherwise
  look healthy. Litestream's status can go in the logs.
- **`/health`** (`apps/server/src/health.ts`) gains a `stream` section: on or off, lag, last confirmed
  upload, paused or not. **It never fails `/health`**: a bucket outage is external and must not touch
  the sale path. Nothing restarts an unhealthy container today (`deploy/compose.yml` sets
  `restart: unless-stopped` only), but `deploy/waitron.sh` waits for a healthy container at install
  and update, and an update must not stall on a bucket outage. The box status page and
  `/api/backup/status` show the same.
- **Alerts** beside the existing `backup.*` family (`apps/server/src/alert-sources.ts`), each with
  English and Spanish wording checked by `scripts/ongoing-alert-codes.test.ts` (these are ongoing
  alerts, whose area comes from the alert source; `scripts/alert-codes.test.ts` covers recorded
  incident codes only):
  `backup.stream_behind`, `backup.stream_paused`, `backup.stream_refused`, and
  `backup.stream_bucket_unusable` for a bucket whose key stopped working or which stopped honouring
  the conditional write. These names are proposals: codes are never renamed once shipped, so the plan
  checks each against its siblings before it is written.
- **`backup.disabled`** ("Backups are not set up…") is tied to archive destinations today. It stops
  firing while the stream is on and current, and returns if not; the plan rewords it so it describes
  both kinds of copy.
- **The scheduled archive is unchanged.** It remains the copy locked with the recovery key, on local
  disk or a USB stick.

---

## 8. Measurements and tests

### 8.1 Measurements, one task, before any stream code

Each on 0.5.17, each stating in advance what the failing result would print:

1. **Restart after an outside fold-back.** Stop Litestream, fold the side file back, restart it, write,
   restore. Failing case: the restore lacks the writes made while it was stopped, or Litestream exits
   0 having uploaded no fresh full copy. Decides §4.5's fallback.
2. **Automatic folding with the bucket reachable.** Failing case for keeping SQLite's default: the side
   file grows past its size with the bucket reachable, or Litestream logs a conflict.
3. **Which restore points survive a 168-hour window:** 30-second, 5-minute or hourly boundaries.
   Decides what the spec may promise about going back in time.
4. **Restore time with a day of changes** on a database of realistic size, product images included —
   they live in the database (`media_image_data.bytes`). Realistic, after §0.11's shrinking: up to
   5,000 images at about 171 KiB each, roughly 0.87 GB — estimated from ten real 2.6–5.0 MB food
   photos shrunk during planning, not from a venue.
5. **The pinned binary on Linux, both processor types.** Every prototype run was darwin/arm64.

> **Measured 2026-09-23.** Results, and the values later tasks read — RESTART_RESYNCS, AUTOCHECKPOINT_OFF_NEEDED, LINUX_BINARIES_RUN and arm 2b's reading of truncate-page-n — are in the prototype results note under [Slice 2 measurements](../../research/2026-09-16-sqlite-failover-prototype.md#slice-2-measurements).

### 8.2 Tests

- **Unit:** the S3 client's conditional write against scripted responses ("precondition failed" is a
  loss, "conflict" is retried); the supervisor against a fake child process; the freshness figure; the
  locked secrets row (the wrong recovery key opens nothing).
- **One loop test with the real pinned Litestream**, in the package suite and in CI: stream, rebuild,
  sell under a fresh chain, stream into the new generation. It needs a real S3 endpoint, and no package
  suite may start a container (CLAUDE.md §4), so it runs a small S3-compatible server as a plain child
  process. Which server is chosen in the plan, after checking that it honours conditional writes, that
  a pinned binary is obtainable, and its size against the CI cache, which this repository already has
  full (CLAUDE.md §2). **Chosen during planning: versitygw 1.8.0**, which refused both conditional
  writes with 412, let one of twenty racing writers win, publishes checksummed binaries for every
  platform needed, and which Litestream 0.5.17 streamed to and restored from on the owner's Mac;
  SeaweedFS is the recorded fallback. Garage and rclone overwrote the object instead of refusing. MinIO
  is not an option: its repository is archived and its binaries are no longer published. The
  prototype rig stays as a record.
- **Proved by deletion** (CLAUDE.md §4), each with the case in the other direction:
  - removing the "only if unchanged" condition fails a test;
  - moving the pointer before the first full copy fails a test;
  - treating "conflict" as a loss fails a test;
  - taking freshness from Litestream instead of the bucket fails a test;
  - with the bucket unreachable, sales still commit within their normal time;
  - a failed integrity check stops a restore before anything changes;
  - the restart reset runs before the first filing;
  - a second process opening the venue folder is refused, and the first is not disturbed;
  - opening a generation whose marker already exists is refused;
  - a rebuilt box presents a certificate naming its own addresses;
  - a raw session identifier read from the bucket cannot sign in, for both the dashboard and the till
    cookie.

---

## 9. Order of work

Each lands on its own. The first three do not need Litestream.

0. Shrink every uploaded image before it is stored (§0.11).
1. Per-machine rows keyed by node id; session identifiers stored as hashes (§2).
2. The secrets row locked with the recovery key, and a recovery key without an archive destination
   (§3.1).
3. The single-process lock on the venue folder, then the restart reset (§6). (2026-09-23: the reset
   landed first, so this step is now the lock alone.)
4. The measurements (§8.1), results recorded. (2026-09-23: done; results note, Slice 2 measurements.)
5. `@waitron/stream`: the S3 client, the pointer and generations (§4.4).
6. The supervisor, the binary in the box image, the side-file limit (§4.1, §4.2, §4.5).
7. Freshness, `/health`, alerts (§7).
8. The settings screen, Test, the recovery kit (§4.3).
9. Restore from the bucket, command line and setup wizard: the second restore-request source, the
   certificate re-issue, the device-address check (§5).
10. The loop test (§8.2), and the documentation sweep: `CLAUDE.md`, `docs/backlog.md`, and dated
    pointers in the topology design at every place §10 lists.

---

## 10. What this changes in the topology design

Dated pointers go into the topology design in task 10, not rewrites:

| Topology design | Slice 2 |
| --- | --- |
| §2.2 — generations named `gen-<term>-<node-id>` | the name also carries when it was opened, and opening starts with a create-only marker, because a rebuild reuses the node id (§4.4) |
| §2.1 — `local` tables in `node.db` | stay in `venue.db`, keyed by node id; `node.db` reserved for slice 5 (§2) |
| §7.1 — hourly full copies, 30 days | daily full copies, 7 days (§4.4) |
| §7.3 — owner's NAS or USB disk as a stream target | S3-compatible buckets only (§0.2) |
| §7.5 — a restore from the store claims a seat | slice 2's rebuild resumes the dead node's identity from the locked secrets row; seats arrive with promotion in slice 3 (§5) |
| §7.7 — freshness from Litestream's status, "backup-age incident" | freshness read from the bucket; dashboard alerts (§7) |
| §8.3 — `wal_autocheckpoint = 0` | measured 2026-09-23: `AUTOCHECKPOINT_OFF_NEEDED = false` on a close comparison (A's peak side file below B's in both recorded runs, by 0.5% and 1.5%); results note, Slice 2 measurements §2 |
| §11 slice 2 — "archive via `VACUUM INTO`" | already landed in slice 1 (slice-1 spec, decision 7) |

---

## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| Every migration set is applied to `venue.db`; `node.db` has no tables | `packages/migrations/src/apply.ts` (`migrateEverySet`); `packages/credentials/src/bin.ts` comment | read 2026-09-23 |
| A trigger cannot write another attached file | `docs/backlog.md`, F1's measurement on Node v26.7.0 | cited, measured 2026-09-22 by F1 |
| `change_log` rows are deleted inside the writing transaction | `packages/db/src/change-log.ts`, `drainChangeLog` | read |
| The archive carries `secrets.env`, `trading.env` and the four TLS files | `apps/server/src/state-secrets.ts`, `RECOVERY_FILES` | read |
| Devices trust the box through its certificate authority | `apps/server/src/discovery-api.ts`, `/setup/trust` | read |
| The vault master key is generated per box into `secrets.env` | `apps/server/src/box-secrets.ts` | read |
| The box holds the recovery key | `WAITRON_BACKUP_RECOVERY_KEY`, `apps/server/src/backup-config.ts` | read (search agent, spot-checked) |
| Fiscal restore mints above a clock floor | `packages/fiscal-verifactu/src/restore.ts`, `installationFloor` | read |
| Error 3000: accepted when AEAT reports its copy accepted, with no fingerprint compared; halted when it reports it annulled; an unstated state is looked up and compared by fingerprint | `resolveEstadoEfectivo` (`@waitron/verifactu`); `applyOutcome` and `handleDuplicate` in `packages/fiscal-verifactu/src/drain.ts` | read, not run |
| The archive also carries `backup.env`, `modules.json`, a manifest and declared module files | `apps/server/src/backup-optional-state.ts`, `backup-sweep.ts` | read |
| The restore request takes only an encrypted archive | `apps/server/src/restore-request.ts` (`RestoreRequest`), `restore.ts` | read |
| Dashboard and till session ids are raw bearer cookies; pairing tokens and Google state are hashed | `management-api.ts` (`setManagementCookie`), `till-session.ts`; `token_hash` / `state_hash` columns | read |
| The server certificate names the box's IPs and is minted only when `server.key` is absent | `apps/server/src/box-secrets.ts` | read |
| No single-instance lock on the venue folder | search of `packages/store`, `apps/server` by the fresh-context reviewer | searched, not run |
| Spec claims checked by a fresh-context reader | review of this spec, 2026-09-23: two blockers, seven should-fix, four nits, all folded in; the load-bearing ones re-read before folding | read, one `curl` |
| Litestream snapshot, retention and level settings and their wording | <https://litestream.io/reference/config/> | `curl`, 2026-09-23, quoted |
| Litestream 0.5 rejects client-side encryption | same page: "age encryption is not currently supported" | `curl`, 2026-09-23 |
| The side file cannot be reclaimed while an offline Litestream is attached | results note, S4 | measured by the prototype, 2026-09-18 |
| A conditional write may answer "conflict" and be retried | topology §13, risk 11's note, quoting Amazon | cited |
| Owner decisions §0 | brainstorm with the owner, 2026-09-23 | this session |
