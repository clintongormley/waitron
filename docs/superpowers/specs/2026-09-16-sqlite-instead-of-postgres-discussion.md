# SQLite instead of PostgreSQL — a discussion, not an approved design

**Date:** 2026-09-16. **Status:** superseded as a live question — the owner decided on 2026-09-16 to
make the switch, on the strength of the infrastructure simplification alone (§6 below). This note
stays as the record of what three reads established. Its §9 gate is half retired; see §9 and the
design's §12.1.

**The question (owner, 2026-09-16).** The cloud will host many venues per PostgreSQL server to keep
cost down. Would SQLite on the box, streamed to the cloud with Litestream, be a better fit? A
restaurant writes little, so one-writer-at-a-time is not a problem. The remaining objection seemed to
be that the fiscal ledger's protection rests on PostgreSQL roles and grants — how firm is that?

Three things were read for this note: the regulation's own words on tamper-protection, Litestream's
own documentation, and what the repo's join/promote/return flow actually asks of the replication
layer. The receipts are in the provenance table at the end.

---

## 1. The regulation does not ask for database privileges

Royal Decree 1007/2023, article 8.2(a), is the requirement. Its words (BOE consolidated text, read
2026-09-16):

> «La integridad e inalterabilidad de los registros de facturación de forma que, una vez generados y
> registrados, no puedan ser alterados sin que el sistema informático lo detecte y avise de ello.»

and, on how that is to be achieved:

> «La integridad e inalterabilidad de los datos registrados se asegurará utilizando cualquier proceso
> técnico fiable que garantice el carácter fidedigno y completo de los registros de facturación desde
> que hayan sido grabados en el sistema informático.»

"Any reliable technical process" — the mechanism is ours to choose. What the regulation does name is
the chain (8.2(b): records «encadenados de manera que pueda verificarse su rastro») and, for a system
that sends every record to AEAT, article 16.2:

> «se presumirá que los "Sistemas de emisión de facturas verificables" cumplen por diseño los
> requisitos establecidos en el artículo 8»

So a Veri\*Factu system — which Waitron is — is *presumed* to meet article 8 by design, because AEAT
holds a copy of every record and an altered local copy is detectable by comparison. Article 14.1 adds
that AEAT may demand «el código de usuario, contraseña y cualquier otra clave de seguridad» to reach
the records: the inspector expects to be given access, not to be kept out by it.

Nothing in the text mentions database roles, grants, or who may connect. The role split in this
repository (`app_user` cannot `UPDATE` or `DELETE` the ledger; `REVOKE ALL` plus append-only triggers,
CLAUDE.md §5) is our own engineering, and it is worth being exact about whom it protects against:

| Threat | PostgreSQL today | SQLite |
| --- | --- | --- |
| A bug in our code issuing `UPDATE`/`DELETE` on the ledger | Refused by the grant and by the trigger | Refused by a trigger (`RAISE(ABORT)` on `UPDATE`/`DELETE`); our code would have to drop the trigger on purpose |
| The venue owner with root on their own box | Root has the superuser; not prevented | Root has the file; not prevented |
| One cloud venue reading another's data | PostgreSQL enforces it per database | The filesystem and the per-venue process enforce it — ours to get right |
| Someone editing the ledger after the fact | Detected by the hash chain and by AEAT's copy | Same |

The first row is the one that matters day to day, and SQLite has an equivalent. The second row was
never prevented. The third row is a real change of responsibility but not a loss of capability. The
fourth is unchanged. **Conclusion: the role separation is not a legal requirement and is not, on its
own, a reason to stay on PostgreSQL.**

One honest cost remains here: the repo's grant tests and the "never widen a grant" discipline are a
live guard against our own mistakes today, and on SQLite that guard would be a trigger plus a test
that the trigger exists on every ledger table. Weaker in one way — the same process that writes can
also drop the trigger — but the hash chain verified at boot and at drain time, and AEAT's copy, are
the layers the regulation actually relies on.

## 2. The premise about the WAL is half right

Physical replication (copying a whole server's write-ahead log byte for byte) is whole-server.
What the repo uses since #280 is *logical* replication, which is per database: a publication lives in
one database, a subscription pulls only that database's rows, and many venue databases on one shared
server is a supported layout (`2026-09-05-outbox-to-native-replication-swap-design.md` §10 already
lists what a managed host must allow).

The cost the owner is pointing at is still real, just differently shaped. Every venue's subscription
holds a replication slot and a decoding process on the shared server, and — as I understand it, not
measured here — each decoding process reads the server's whole log to pick out its own database's
rows, so the CPU spent per venue grows with the write traffic of every venue sharing the server. Tens
of venues per server is plausible; hundreds is not obviously so. **"Not feasible" is too strong;
"scales badly with density" is fair, and it is the number to measure before deciding anything.**

## 3. What Litestream is, in its own words

Read from litestream.io on 2026-09-16 (v0.5.x, the "Latest - Actively maintained" line).

- **One direction, asynchronous, about a second behind.** «Litestream performs asynchronous replication
  which means that changes are replicated out-of-band from the transaction that wrote the changes …
  By default, Litestream will replicate new changes to an S3 replica every second. During this time
  where data has not yet been replicated, a catastrophic crash on your server will result in the loss
  of data in that time window.» And: «Synchronous replication is on the Litestream roadmap but has not
  yet been implemented.» (Tips & Caveats.) PostgreSQL logical replication is asynchronous too, so this
  is the same posture, not a worse one.
- **A live read-only copy is available.** `restore -f` «Continuously restores new data as it becomes
  available. The restored database should only be opened in read-only mode.» (Command: restore.) There
  is also a read-only virtual filesystem that serves a database straight from object storage and can
  "hydrate" a full local copy in the background (VFS Read Replicas; VFS Hydration, v0.5.9+).
- **Exactly one writer per replica path.** «Multiple applications replicating into the same bucket &
  path can cause situations where you will be unable to restore. It is your responsibility to ensure
  you do not have multiple applications replicating concurrently.» (Tips & Caveats.) Promotion must
  therefore move to a fresh path, never continue the old one.
- **Restore points are file boundaries, and they coarsen with age.** «Restore granularity is therefore
  coarser than the write rate, and it coarsens further over time as retention prunes the files that
  held the finer endpoints.» (How it works.) Latest-state restore is unaffected; point-in-time restore
  is approximate.
- **Where it can send to.** S3 and S3-compatible stores, Azure, GCS, Backblaze, SFTP, a local file
  path, NATS, WebDAV (How-To Guides index). SFTP or a local path over the box's WireGuard link to its
  own cloud instance keeps the standing "no relay, no third party in the path" decision intact; a
  provider bucket would be a new third party holding fiscal data.
- **Encryption in the stream is gone in 0.5.** «Age encryption is not available in v0.5.0+.» (Command:
  restore.) Whatever holds the replica must be encrypted by us or by the host.
- **It needs a short write lock at checkpoints**, so the app sets `PRAGMA busy_timeout = 5000`; and it
  only works in WAL journal mode (Tips & Caveats). Both are one-line settings.

## 4. What the join / promote / return flow actually needs — and how it maps

From `2026-09-05-outbox-to-native-replication-swap-design.md` §2 and §4, and the code in
`apps/server/src/adopt.ts`, `finish-adoption.ts`, `mirror-bundle.ts`. Every table is classified
`ledger` (copied to a standby *and* drained back from a returned box), `state` (copied, never drained
back) or `local` (this node's own record of itself; never copied). A standby's dormant identity — its
own node row, membership keypair, reserved installation number and disjoint series — is established
on the standby *after* the initial copy completes, in tables classified `local`.

| Step today (PostgreSQL) | With SQLite + Litestream |
| --- | --- |
| **Adopt**: create a disabled subscription, let the initial copy of every published table complete, then a boot-time finish step establishes the reserved identity | Restore the box's stream on the cloud and keep following it (`restore -f`); the reserved identity cannot live in the same file (the stream would overwrite it), so `local` becomes **a second, per-node SQLite file** — a clean mapping of the classification onto files, attachable with `ATTACH` when a query needs both |
| **Warm standby**: the cloud's subscription stays enabled and applies rows as they arrive | The cloud keeps following; a read-only dashboard while the box is off is exactly what follow mode and the VFS are for |
| **Promote**: fence the box, confirm drained (or accept the loss), activate the reserved identity, narrow the box→cloud subscription to `ledger` only | Stop following, open the file read-write, activate the identity from the local file, start replicating to a **new** replica path. Note: replication-lag checking in Postgres (`pg_stat_subscription`) becomes a Litestream question of "which transaction id did the follower reach" |
| **Return**: the box boots fenced and its `ledger` tail drains into the cloud automatically over the narrowed subscription; `state` never travels back | **The one thing Litestream cannot do.** A returned box's tail — everything it wrote after the last file the cloud received — sits in a file the cloud is no longer following. Waitron would ship it itself: read the box's `ledger` rows that carry the box's `node_id` and are missing on the cloud, and insert them. This is one direction, once, ledger tables only, keyed by writer — much smaller than the application outbox #280 deleted, but it is new code on the fiscal path and needs the same care that design gave the drain (the two natural-key clashes it names still apply) |
| **Rejoin**: wipe the box's database and re-adopt from the cloud | Delete the file, restore from the cloud's stream, resume following |
| **Cold restore** (no standby): restore a backup and start a fresh chain | Restore from the stream; fresh chain exactly as today |

So the shape survives. The redesign is real but bounded: the `local` split into a second file, a
replica-path "generation" at promotion, and a ledger tail shipper. Everything the swap design put in
`packages/sync` (publications, subscriptions, status, drain) is replaced rather than ported.

## 5. What else changes

Measured on the tree at `ba59aaf5`, 2026-09-16.

- **Column types.** The migrations declare 36 enum types, 19 array columns, 66 `jsonb` columns, 4
  `interval` columns and 38 `numeric` columns — including every money column (`numeric(12,…)`).
  SQLite has none of these as real types. Enums become text plus a check; arrays become JSON or a child
  table; `jsonb` becomes SQLite's JSON (adequate, different functions); and **money becomes integer
  cents**, which touches the fiscal hash inputs and must be proven against the shared alta fixture
  (CLAUDE.md §4: a fixture no check reads is unverified data).
- **Queries.** Only a handful of files use PostgreSQL-only SQL (`::jsonb` casts in 15 files, `unnest`
  in one, `NULLS FIRST/LAST` in two, `array_agg`/`string_agg` in two). The bulk is Drizzle, which has a
  SQLite dialect. Still every query is re-read, because `sql` fragments are strings.
- **Live updates and job queues.** `LISTEN`/`NOTIFY` (`packages/db/src/change-feed.ts`) and
  `FOR UPDATE SKIP LOCKED` (the fiscal drain, payments store, daily close) become in-process — trivial
  once there is exactly one server process per venue, which there would be.
- **Roles, grants, provisioning.** 51 non-test files touch `SET ROLE`/`GRANT`/`REVOKE`. Almost all of
  that — migrator ownership, `withRole`, `asAppUser`, the replication login, `pg_hba` rules — goes
  away. This is a large simplification, and it retires a third of CLAUDE.md §3's data rules.
- **Tests.** PGlite (the in-process PostgreSQL used as the fast test target) and Testcontainers both
  go; SQLite in-process is the only target, and it is the same engine production runs. Faster and
  simpler — and the `describeEachTarget` distinction disappears because there is nothing the two
  targets disagree on. What is lost: nothing can test "who connected", because nobody connects.
- **Backup and restore.** `pg_dump`/`pg_restore` paths (`apps/server/src/pg-restore.ts`, `restore.ts`,
  `backup-probe.ts`) are replaced by Litestream restore plus a file copy. The backup module contract
  (`2026-09-04-backup-restore-regime-design.md`) survives with a different storage plugin.
- **Multiple processes on the box.** The server, Litestream, the provisioning command and a restore
  all open the same file; SQLite handles that, with `busy_timeout` set everywhere.

## 6. What SQLite would buy

- **Cloud cost per venue is close to zero**: a process and a file, no shared database server, no
  per-venue decoding worker. The standing decision "a dedicated instance per tenant … density comes
  from many isolated instances per host" is easier to keep, not harder.
- **The box loses a daemon** and a database container; a backup is a bucket or a directory.
- **One test target, the production engine.**
- **Most of the provisioning and privilege machinery disappears**, with its rules and its guards.

## 7. Open risks, named so they are not discovered later

1. **Litestream is one project, one main author, at 0.5.** The features this depends on (follow mode,
   the VFS, hydration, v0.5's LTX format) are recent. Read the release history and the issue tracker
   before betting a venue's ledger on it.
2. **The tail shipper is new fiscal-path code** (§4, Return). Its correctness argument is the same one
   the swap design makes — ledger rows are keyed by writer — and it needs the same two-node proof.
3. **Money as integers** changes hash inputs; the alta fixture must pass the real validator afterwards.
4. **Encryption of the replica** is ours to arrange (Litestream 0.5 removed its own).
5. **Drizzle's SQLite dialect** and its migration tooling are less exercised than its PostgreSQL one.
6. **Promotion discipline**: continuing the old replica path from the cloud corrupts the stream (§3).
   The generation change must be structural, not a runbook step.
7. **Point-in-time restore is approximate** (§3). Latest-state restore — the case we care about — is
   exact.
8. **Nothing external may block a sale** (CLAUDE.md §5) still holds: Litestream is a separate process
   and the app must never wait on it beyond the checkpoint lock.

## 8. PGlite, SQLite, PostgreSQL — the three side by side

PGlite is real PostgreSQL compiled to WebAssembly and run *inside* our Node process, the way SQLite is
run inside a process. It is the fast test target in this repo (`packages/db/src/testing/harness.ts`,
`@electric-sql/pglite` 0.5.x).

| | PostgreSQL (server) | PGlite | SQLite |
| --- | --- | --- | --- |
| Runs as | a separate daemon, many connections | inside our process, one connection at a time | inside our process, one writer, many readers |
| SQL and types | PostgreSQL's | PostgreSQL's — our schema and queries run unchanged | its own; dynamic typing, no enums/arrays/decimal |
| Logical replication | yes | no | no (Litestream streams the file instead) |
| Roles and grants | enforced per connection | roles exist, but the process can always `RESET ROLE` (CLAUDE.md §4) | none |
| Maturity | decades | 0.x, young | decades, ubiquitous |
| Streaming backup tooling | pg_dump, WAL archiving, logical replication | none comparable | Litestream and similar |

PGlite is the "embedded PostgreSQL" that would let us keep the schema while dropping the daemon — and
it fails the same test SQLite does (no replication) without SQLite's compensations (Litestream, a
mature single-writer story, decades of production use). It is a test tool here, not a production
candidate.

## 9. The gate — one half retired (2026-09-16)

This section asked for two measurements before any design work. The design was written the same day
and the owner then took the decision, so both halves have moved:

1. **Cost the current design at density — RETIRED by the owner, 2026-09-16.** It read: stand up one
   PostgreSQL server with N venue databases each replicating to a standby, and measure CPU per venue at
   N = 10, 50, 200; if density was fine, this note was closed. The owner's reason for retiring it is
   that the infrastructure simplification is by itself sufficient to warrant the switch, so the number
   could no longer change the answer. Two further reasons it could not have decided anything as
   written — it tests a shared cluster while the standing decision is a dedicated instance per tenant,
   and §2's whole-cluster decoding cost therefore does not arise — are recorded in the design's §12.1,
   with what stays unmeasured as a result.
2. **Prove the SQLite failover loop end to end — STANDS.** A throwaway prototype: box (SQLite +
   Litestream) → cloud following → promote to a new path → box returns with an un-shipped tail → tail
   shipped → box rejoins by restore, with the two natural-key clash shapes from the swap design's §4.2
   injected. The design's §12.2 carries the fuller list the Fable review added, and is the version to
   work from.

**A correction to this note's own opening premise.** The question as put was "the cloud will host many
venues per PostgreSQL server to keep cost down". The standing decision in `docs/backlog.md` is the
opposite shape — *"The cloud is a dedicated instance per tenant… Density comes from many isolated
instances per host"* — and §2's analysis of logical-decoding cost was written against the premise, not
against that decision. §2 is still a correct description of a shared cluster; it is not a description
of what Waitron Cloud is designed to run.

---

## Provenance

| Claim | Source | How read |
| --- | --- | --- |
| Article 8.2, 8.4, 13, 14.1, 16.2 quotations | BOE consolidated text of RD 1007/2023, `https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840` | `curl`, HTML stripped, 2026-09-16; the page notes it is «de carácter informativo y no tiene valor jurídico» |
| Litestream quotations (async window, roadmap, one writer per path, restore -f, granularity, Age removed, busy_timeout, WAL mode) | `https://litestream.io/tips/`, `/how-it-works/`, `/reference/restore/`, `/guides/vfs/`, `/guides/vfs-hydration/`, `/reference/replicate/`, `/guides/` | `curl`, HTML stripped, 2026-09-16 |
| Logical replication is per database; decoding cost scales with server-wide write traffic | My understanding of PostgreSQL; **not measured here** — §9 item 1 is the measurement |
| Table classification and the promote/return sequence | `docs/superpowers/specs/2026-09-05-outbox-to-native-replication-swap-design.md` §2.1, §4.2, §7, §9, §10 | read |
| Reserved identity established after the initial copy, in `local` tables | same spec §2.1 (2026-09-08 note), `2026-09-03-reserved-standby-identity-and-promotion-design.md` §3, `apps/server/src/finish-adoption.ts` | read |
| Counts of types, files and SQL features | `grep` over `packages/*/drizzle/*.sql`, `packages`, `apps` at `ba59aaf5` | run 2026-09-16 |
| Why the earlier application-level sync was replaced | `2026-08-02-app-level-sync-design.md` §0, §13; swap design §0–§1 | read |
