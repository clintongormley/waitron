# SQLite + Litestream: storage engine, replication and failover topologies — design

**Date:** 2026-09-16. **Status:** design, awaiting owner review. Not in any track — this is the
architecture that would replace PostgreSQL if the two gates in §12 pass. **Model note:** brainstormed
with Fable, written by Opus from the whole brainstorm; a fresh-context Fable read of the fiscal
sections is owed before implementation (owner's model rule, and CLAUDE.md §1 — a spec touching fiscal
invariants gets a second model reading cold).

**Companion:** [SQLite instead of PostgreSQL — a discussion](2026-09-16-sqlite-instead-of-postgres-discussion.md)
(2026-09-16) is the feasibility note this builds on. It carries the receipts this spec cites: the
regulation's own words, Litestream's documented behaviour, and the counts. Read it first.

**Supersedes, if built:** the mechanism half of
[outbox → native logical replication swap](2026-09-05-outbox-to-native-replication-swap-design.md)
(the `ledger`/`state`/`local` classification and the promotion/return *shape* survive; the Postgres
publications/subscriptions do not); the "no relay — replication rides WireGuard" standing decision for
the replication path (the stream goes to object storage; WireGuard's fate for remote dashboard access
is a separate, untouched question); and decision 5 of the
[backup & restore regime](2026-09-04-backup-restore-regime-design.md) **for the stream only** (see §7).

---

## 0. Decisions taken with the owner (2026-09-16)

Each was put to the owner in the brainstorm and answered.

1. **The steer is worth pursuing.** A friend with cloud experience — for whom PostgreSQL is the
   favourite database — advised looking at SQLite because of the cost and complexity of running and
   maintaining thousands of PostgreSQL instances in the cloud, and dealing with major-version
   upgrades. The regulation names no database privilege (§1 of the discussion note), so the fiscal
   defence does not depend on PostgreSQL roles. The steer holds; this spec works it out.

2. **A switched-off box is not a case to design for.** The box normally runs overnight, so a live
   cloud dashboard while the box is off is not needed for the MVP. The cloud side of an on-prem
   venue is therefore the blob store and nothing else. A future aggregation layer (for example
   Elasticsearch pulling sales across many venues for the owner) is a completely separate solution,
   out of scope here.

3. **The stream lands in a provider object store** (S3-compatible), in an EU/Spain region, one prefix
   per venue, with the provider's server-side encryption under a per-venue key. Litestream 0.5 removed
   its own encryption, and the fiscal records the bucket holds are already sent to AEAT, so provider
   encryption is the floor for the stream. (Chosen over running our own object storage, and over
   the box encrypting before upload.)

4. **Cloud-primary failover is minutes, human-driven, no warm instance.** When the host running a
   cloud primary dies, recovery is "start a fresh instance on another host, restore from the bucket,
   carry on" — the same procedure a human promotion uses. This matches the standing "warm standby plus
   human promotion; active-active is shelved" decision. No second running instance per cloud venue, so
   no lease and no split brain to arbitrate.

5. **The bucket is the hub; reserved identities travel inside the database** (Approach 1 of the
   brainstorm). A promoted node claims a dormant *seat* that reached it in the stream. The two
   rejected approaches (identity in the control plane; no reservation, mint from the copied counter)
   are recorded in §3 with the reason each was rejected.

6. **Archiving stays as a user option; Waitron Cloud is the premier backup.** The existing archive
   path (manifest, module hooks, encryption under the operator's recovery key, fan-out to any
   destination the owner configures — a USB stick, a second provider) remains available. The product
   steers people to Waitron Cloud as the default, premier backup service.

7. **A venue with no offsite destination does not stream.** The stream only earns its keep landing
   somewhere other than the box's own disk. With Waitron Cloud it goes to the bucket; with an
   owner-supplied destination (a LAN NAS, a USB disk, their own bucket) it goes there; with neither,
   Litestream does not run and the scheduled archive is the only backup. The dashboard keeps the
   existing "your box holds the only copy" warning until something offsite exists.

---

## 1. What this changes, in one paragraph

Today every node is a PostgreSQL database; nodes replicate to each other with native logical
replication (publications and subscriptions), and the box is defended by roles and grants. After this
change every node is a SQLite database in the node's own process; a node's file is streamed to object
storage by Litestream, which is a full continuous backup on its own; a *mirror* is either just that
stored stream or a process that continuously restores from it into a read-only copy; and promotion,
return and rejoin are one procedure regardless of where the nodes sit. The fiscal defence moves from
grants to an append-only trigger plus the hash chain the regulation actually relies on, verified at
boot and at every promotion. The `ledger`/`state`/`local` table classification the outbox-swap design
introduced is kept and does more work: it now decides which of two files a table lives in.

---

## 2. Storage: two files, and generations

### 2.1 Two files per node

SQLite is one file per database, so the classification splits across two:

| File | Holds | Classes | Streamed? |
| --- | --- | --- | --- |
| `venue.db` | the venue: sales, payments, fiscal records, catalogue, config, live service | `ledger`, `state` | yes |
| `node.db` | this node's own identity: its `nodes` row, membership document, sessions, pairing codes, seats' private keys | `local` | no |

They are opened together with SQLite's `ATTACH`, so a query that needs both (rare — identity rarely
joins the venue) still can. The split is what lets a follower hold a byte-exact copy of `venue.db`
without it overwriting who the follower is. A module's `classify(table, class, reason)` contribution
now also determines the file; the existing completeness guard (every table classified exactly once)
still holds, and gains a second assertion: no `local` table has a foreign key into a streamed table or
vice versa, or the two files could not be backed up independently.

> **Open item for the plan.** A handful of tables may straddle — for instance a `state` config row
> that a `local` session references. Each such edge is resolved in slice 1 by moving the column or
> denormalising; the plan enumerates them from the FK graph. This is named, not hand-waved: the FK
> graph is machine-readable and the plan lists every cross-file edge before writing code.

### 2.2 Generations

Each venue owns one prefix in the store, `venues/<venue-id>/`. Under it the history is a sequence of
**generations**: `gen-0001/`, `gen-0002/`, … A generation is one primary's unbroken stream. Litestream
documents that two applications must never replicate into one path ("it is your responsibility to
ensure you do not have multiple applications replicating concurrently" — Tips & Caveats), so **a new
primary always opens a new generation** and nothing ever writes an old one again. The generations are
also the audit trail of every promotion: which node wrote what, and for how long.

A small **`current.json`** beside the generations names the live generation and the node writing it,
**signed with that node's membership key**. A restorer, or a returning box, learns who is primary from
the store alone — no peer need answer. `current.json` is the store-side twin of the membership
document: same term, same signer, cross-checkable.

Retention prunes generations older than the configured window (§7).

---

## 3. Node identity: seats

A **seat** is a dormant identity for a node that might one day be promoted: its own node id, a reserved
Veri\*Factu installation number (the "número de instalación" that must never be reused), and disjoint
invoice series codes. This is exactly the reserved dormant identity the current design establishes at
adopt (R2, landed #208; memory `reserved-sif-seeded-at-join`), carried onto the new mechanism.

Seats live in a `node_seats` table in `venue.db`, classified `state`, so they travel in the stream and
every restorer has them. The primary is the sole allocator, as today. A seat is minted when a mirror is
enrolled:

- **A second box** generates its keypair at enrolment; the primary endorses the public key into the
  trust set and mints the seat. This is today's adopt flow with the subscription removed.
- **Cloud backup switched on** mints a *cloud seat* with no key yet. Whoever is promoted from the
  store claims it, generates a keypair *then*, and has it endorsed by a venue-scoped key that Waitron
  Cloud holds and that entered the box's trust set at enrolment (§6). That endorsement is the one
  place the closed-source control plane touches the trust chain — and it is the same point at which
  it already must, since it starts the instance.

A seat is **claimed exactly once**, in the same transaction that activates it, and the claim records
the term that claimed it. An unclaimed seat is a cheap sequential number, fiscally inert — a
never-promoted tertiary just burns one number, which AEAT permits (many "SIF virtuales" per NIF, each
with its own installation number; discussion note §1, memory `reserved-sif-seeded-at-join`). A venue
with a box mirror and cloud backup carries two seats.

**Two rejected alternatives** (recorded so a future session does not silently reintroduce them):

- **Identity in the control plane, not the database.** The primary hands the seat to Waitron Cloud
  over an API; a promoted instance fetches it. Rejected: promotion could not be tested in this
  repository without the closed-source service, and a never-reused installation number would live
  outside the hash-chained database that already tracks it.
- **No reservation; mint at promotion from the copied counter.** The store holds the whole database,
  counter included, so a promoted node could allocate the next number itself. Rejected on a fiscal
  receipt: the stream can be ~1 second stale, so a number the primary minted in its last second
  before dying would be re-minted by the promoted node — unlikely, unrecoverable, the class CLAUDE.md
  §5 exists to remove. Reservation costs one cheap number and removes the case.

---

## 4. The four topologies, as one mechanism

Legend: **P** writes and streams; **F** follows (continuously restores a read-only copy — Litestream's
`restore -f`, "continuously restores new data as it becomes available"); **B** is the store.

The whole point: a mirror is not a database that receives rows. It is a place the stream lands, plus
optionally a follower that keeps a local read-only copy warm. Every topology is the same three verbs.

### 4.1 On-prem primary → cloud mirror

```
  box (P) ──stream──▶ B: gen-n
```

Nothing runs in the cloud. Promotion (§5): the control plane starts an instance, which restores the
latest state from `gen-n`, claims the cloud seat, and streams to `gen-n+1`. Tills reroute to it. When
the box returns it sees the higher term, ships its ledger tail (§5.2), wipes and follows `gen-n+1`.

### 4.2 Cloud primary → on-prem mirror

```
  cloud (P) ──stream──▶ B: gen-n ──follow──▶ box (F)
```

The box holds a read-only copy a second or two behind. Promotion (the venue's internet is gone for
good, or the owner moves back on-prem): the box stops following, claims its seat, opens read-write,
publishes the higher term, and streams to `gen-n+1` — **buffering to a local directory until the
internet returns**, then copying up (the same copy-up job as §4.4). What the box **cannot** do while
the internet is down is fence the cloud; that is accepted and safe, because nothing inside the venue
can reach the cloud primary either, and when the link returns the cloud sees the higher term, goes
read-only and ships its own ledger tail.

### 4.3 Cloud primary → cloud mirror

```
  cloud host A (P) ──stream──▶ B: gen-n
```

Topology 4.1 with the box removed. The "mirror" is the store; there is no second running instance. Host
A dies → the control plane starts an instance on host B, restores from `gen-n`, streams to `gen-n+1`.
There is never more than one running instance per venue, so there is no lease and no split brain by
construction. The cost is the restore time (seconds for a restaurant-sized file) plus the ~1 second of
un-streamed writes — the same loss window logical replication has today. **This answers the owner's
third question directly: a cloud primary needs no second instance; the store is the mirror.**

### 4.4 On-prem primary → on-prem mirror

The one topology the store-as-hub does not cover on its own, because the second box exists to survive
the internet going away.

```
  box A (P) ──stream over LAN──▶ box B: replica dir ──follow──▶ box B (F)
                                            │
                                            └──copy-up (when online)──▶ B: gen-n
```

Litestream allows one destination per database, and box B must keep up with no internet, so **box A
streams to box B over the LAN** (Litestream's SFTP destination; box B hosts the replica directory). Box
B does two things with that directory: **follows it locally**, so it is always ~1 second behind
regardless of the internet; and **copies it to the object store whenever the internet is up** — a plain
file sync that preserves Litestream's layout, so a cloud restore from the copied replica works exactly
as in 4.1. The cloud is downstream of the mirror box.

Two failures fall out:

- **Box A dies** → box B promotes as in 4.2 (claim seat, open read-write, stream to `gen-n+1`; to the
  store if online, else locally then copy up). The venue keeps selling with no internet — the reason
  the two-box venue exists.
- **Box B dies** → box A loses its stream target, notices (Litestream reports the failed sync), opens a
  new generation and streams **to the store directly** (it becomes topology 4.1) until a replacement
  box B is enrolled, then retargets to the LAN again. Every retarget opens a generation, so a restorer
  never meets two writers in one path.

**Prototype obligation (§12):** prove that a restore from box B's *copied* replica is byte-identical to
a restore from a directly streamed one. Litestream compacts and deletes files in its replica as it
goes, so the copy-up must propagate deletions, not only additions.

---

## 5. Promotion, return, and the tail shipper

### 5.1 Promotion — one procedure for every node

Whether box B, a fresh cloud instance, or a box taking over from the cloud:

1. **Reach latest.** A follower stops following; a fresh instance restores the current generation. If
   the old primary is reachable, ask it to fence and flush (`litestream sync`, then compare its last
   transaction id with ours); if not, the human accepts the loss — the choice R3 records today. Then
   `PRAGMA integrity_check` and the existing hash-chain verifier over the tail of the fiscal ledger.
2. **Claim the seat, in one transaction:** take the reserved node id, activate the reserved number and
   series, write this node's identity into `node.db`, and mint membership term *n+1* signed with the
   endorsed key. **Committing this is the point of no return**, as today.
3. **Open the next generation:** write a signed `current.json` naming `gen-n+1` and this node, then
   start Litestream streaming to it. If the target is unreachable (a box promoting with no internet),
   stream to a local directory and let the copy-up job drain it later.
4. **Tell the tills** through the existing reroute path — the till follows the primary named by the
   newest membership document (`2026-09-05-till-reroute-design.md`); nothing here changes how it learns
   that.

### 5.2 Return, and the tail shipper

The old primary boots **fenced** (read-only), as Ruling C7 already has it. It looks for a newer term in
two places — a peer's management API and the signed `current.json` in the store — and if neither is
reachable it proceeds as primary (the accepted human-promotion window today). If a newer term exists:

1. **Ship the tail.** For each `ledger` table, the rows this node owns (its `node_id`, or children off
   its rows) that the new primary lacks. The new primary reports, per table, what it holds for this
   node — the highest chain position for the chained tables, the id set in batches for the uuid-keyed
   ones — and the box sends the difference over the management API as an **append-only batch**. The
   receiver inserts them **verbatim, no recompute**, and **refuses any row not keyed by the sender's
   node** — the rule the deleted application-level apply had for append-only tables (app-level sync
   design §5). For the ledger tables the owner updates in place (`payments`, `sales`, `cadenas`,
   `envios`, the close chain) the sender's version wins for sender-owned rows. The one natural-key
   clash that can remain — a supplier invoice number typed on both nodes — is reported and skipped by a
   human, the single review step the outbox-swap design also keeps (§4.2); the working-time chain is
   per node since 2026-09-07 so it cannot clash.
2. **Confirm** (receiver's counts match the sender's), then **wipe** `venue.db`, restore the current
   generation, and follow. `state` never travels back and never lingers — the wipe removes it — so
   primary and standby cannot diverge on a settings row (the outbox-swap design's reasoning, unchanged).

**Why the tail shipper is bounded** where the deleted outbox was not: one direction, once per return,
`ledger` tables only, keyed by writer, no cursors, no retention, no peer table. Its correctness
argument is the outbox-swap design's own: ledger rows cannot collide because they are keyed by the
node that wrote them (every fiscal table carries `node_id` since the server-as-SIF rekey; children hang
off `sale_id`/`registro_id`; everything else is uuid-keyed). This is the **largest new fiscal-path
component** and gets the §12 two-node proof and the Fable read.

---

## 6. Trust and fencing

Almost all of this exists. Membership documents with increasing terms (R1), the trust set, the
read-only gate, and the till following whichever node the newest document names, are unchanged. Three
additions:

- **`current.json` is signed** with the membership key of the node that opened the generation, so a
  node learns who is primary from the store even when no peer answers.
- **A venue-scoped endorsement key held by Waitron Cloud** joins the box's trust set when cloud backup
  is enabled. It endorses the key a promoted cloud instance generates. It **cannot** itself become
  primary or sign a membership document — it only vouches for a key.
- **Periodic self-check.** A node already checks for a higher term at boot (Ruling C7). A primary also
  re-reads `current.json` on a slow timer, so a box promoted past while it was running fences itself
  within minutes rather than at its next reboot. Two writers into one generation stay impossible
  regardless: a promoted node always opens a new generation.

---

## 7. Backups

### 7.1 The stream is the backup

Litestream is not only a change feed: on a schedule it uploads a **full snapshot**, and between
snapshots the change files, so the store holds everything needed to rebuild the venue to any
transaction-file boundary within the retention window ("How it works"; "Command: restore"). We would run
frequent snapshots (hourly) and 30 days' retention. **This replaces the scheduled `pg_dump`.** A venue
does **not** also upload a second copy of the database next to the stream — that is the same data twice
in one place.

### 7.2 A second copy stays a user option

The backup regime's decision 4 (copies in more than one place, so a dead box and a lost bucket are not
one event) stays available, but as an **owner option, not a default**. `VACUUM INTO 'file'` produces a
consistent single-file snapshot of a live SQLite database in one statement, so the existing archive
mechanism — manifest, module reintegration hooks, encryption under the operator's recovery key, fan-out
to every configured `StorageBackend` — is kept with `VACUUM INTO` in place of `pg_dump`. The archive
also carries `node.db`'s sealed secrets, as `stateDir` secrets are carried today. **Waitron Cloud is
the premier, default backup; the archive is the self-host / extra-copy path.**

### 7.3 Where the stream goes, by tier

| Venue | Stream destination |
| --- | --- |
| Waitron Cloud subscribed | the provider object store (premier, default) |
| No cloud, owner supplies a destination | a LAN NAS, a USB disk, or their own S3-compatible bucket — same Litestream, different target URL |
| No offsite destination at all | Litestream does not run; the scheduled archive is the only backup; the "only copy is on the box" warning stays up |

A free-tier venue has a **coarser loss window** (the archive interval, not ~1 second). That is the
product difference, not a safety difference — the fiscal records are at AEAT either way. When the owner
later switches on Waitron Cloud, the primary opens `gen-0001`, Litestream takes its first full snapshot,
and the cloud seat is minted; the venue becomes topology 4.1 with no restart and no wipe.

### 7.4 Superseded: ciphertext-only offsite, for the stream

The regime's decision 5 required offsite storage to see only ciphertext under the operator's recovery
key. The stream cannot honour that — Litestream 0.5 removed its own encryption. **For the stream** the
floor becomes the provider's server-side encryption under a per-venue key (§0.3). The **archive keeps**
the recovery-key floor unchanged. This split is the one place this spec weakens a stated posture, and it
is weakened knowingly: the records the stream holds are already transmitted to AEAT.

### 7.5 Three restore shapes

1. **Rejoin or return** — a fresh copy of the current generation; `node.db` identity kept (§5.2).
2. **Cold restore, no surviving peer** (box destroyed) — restore the latest state from the store (or an
   archive if the store is gone) onto a new box or cloud instance; the fiscal module's restore hook
   mints a fresh chain and series (SP-3d,
   `2026-09-06-module-sp3d-fiscal-restore-hook-design.md`). Going live again is never blocked — the
   standing priority (memory `cold-recovery-no-hot-failover-posture`).
3. **Point-in-time** (an operator mistake) — restore to a **side** file and inspect. **Never over a
   live ledger**: rolling the ledger back would re-issue invoice numbers. Going back for real is a cold
   restore with a fresh chain, by design.

### 7.6 The legible export the regulation requires

Art. 8.2(c) of RD 1007/2023 requires "un procedimiento de descarga, volcado y archivo seguro de los
registros de facturación … exportados a un almacenamiento externo en formato electrónico legible". A
single self-contained file the owner can download — produced by `VACUUM INTO`, or served straight from
the store — satisfies this. It is an **export** feature, distinct from backup, and belongs to the
fiscal module's surface.

### 7.7 Freshness

Litestream exports its own status (a `status` command and Prometheus metrics) reporting how far behind
the store is; this feeds the existing backup-age incident, which bounds the loss window for a venue with
no second box.

---

## 8. What the repo deletes, keeps, adds

### 8.1 Deleted

PostgreSQL and everything that exists because of it: the `pg` driver and PGlite; Testcontainers and the
real-PG test harness; `packages/sync`'s Postgres layer (publications, subscriptions, status, drain);
the role/grant provisioning in `packages/provisioning`, `withRole`, `asAppUser`, `pg_hba` and the
replication login; `pg-restore.ts` and the `pg_dump` path; `LISTEN`/`NOTIFY` (an in-process event feed
replaces it — one process per venue); `FOR UPDATE SKIP LOCKED` job queues (in-process); `ENABLE ALWAYS`
triggers (the follower is our own restore, not a replication apply worker); and the guards that only
exist for those (`append-only-enable-always`, the migrator-ownership checks, the `EXECUTE FUNCTION`
cross-module trigger honesty check). WireGuard leaves the **replication** path; its fate for remote
dashboard access is a separate decision this spec does not touch.

### 8.2 Kept

The module contract and the `ledger`/`state`/`local` classification (now also choosing the file, §2.1);
the membership, promotion and rejoin flow; the till-reroute path; the fiscal module and hash chain; the
backup manifest and module hooks; the append-only rule (as SQLite `RAISE(ABORT)` triggers, guarded by a
test that every `ledger` table carries them); the error-code registry and its guards; the
no-tenant-column guard.

### 8.3 Added

- **`packages/store`** — opens `venue.db` + `node.db`, sets pragmas (`busy_timeout = 5000`, WAL mode,
  `foreign_keys = ON`, `wal_autocheckpoint = 0` per Litestream's high-write guidance), attaches, and
  installs the append-only trigger set.
- **A Litestream supervisor** — runs the daemon, opens a generation, retargets (LAN ⇄ store), reports
  lag; the box-image and provisioning wiring to install the pinned binary.
- **`node_seats` and the claim** (§3).
- **`current.json` signing and reading** (§2.2, §6).
- **The tail shipper** — sender and receiver (§5.2).
- **The mirror box's copy-up job** (§4.4), deletions included.
- **`VACUUM INTO` archiving**, replacing `pg_dump` in the archive path (§7.2).
- **Drizzle on its SQLite dialect** — enums → text + check; arrays → JSON; `numeric` money → **integer
  cents**; timestamps → ISO-8601 text; uuids → text. The money change touches fiscal hash inputs and is
  proven against the real validator (§9, §12).

---

## 9. Testing

One target — the production engine, in process, no containers. `describeEachTarget` disappears because
there is nothing two targets disagree on.

The replacement for the two-node fixture is a **loop test**: two "nodes" in one run, each with its own
directories, the **real pinned Litestream binary** (downloaded in CI), and a local directory as the
store. It runs the whole arc — stream, follow, promote, return-with-a-tail, ship, rejoin — and every
slice in §11 adds a step to it.

Proved by deletion (CLAUDE.md §4):

- the append-only trigger on each `ledger` table (delete it, a mutation must start succeeding);
- a seat cannot be claimed twice (concurrent claims: one wins);
- a second writer into an existing generation is refused;
- the tail receiver refuses a row not keyed by the sender;
- a restore from box B's **copied** replica equals one from a direct stream (§4.4);
- money fixtures pass the **real fiscal validator** after the integer-cents change — the shared alta
  fixture is re-run against the real check, per CLAUDE.md §4 ("a fixture no check reads is unverified
  data").

Point-in-time restore lands only on file boundaries (discussion note §3) — a test asserts the *latest*
restore is exact and that a between-boundaries request resolves to the nearest boundary, so no test
quietly assumes finer granularity than Litestream gives.

---

## 10. Fiscal safety — the receipts

- **Immutability** is the hash chain plus AEAT's copy — what the regulation actually relies on (RD
  1007/2023 art. 8.2(a) and art. 16.2, quoted in the discussion note §1), not database privileges. The
  append-only trigger is our defence against our own code, and it survives as a SQLite trigger.
- **Never-reused installation numbers** are preserved by seats: reserved by the sole allocator at
  enrolment, claimed once at promotion, never minted from a stale copied counter (§3).
- **A promoted node starts a fresh chain**, never resumes the dead one — the seat's own node id and
  series (fiscal §5; memory `cold-recovery-no-hot-failover-posture`).
- **Nothing external blocks a sale** (CLAUDE.md §5): Litestream is a separate process and the sale path
  never waits on it beyond the sub-second checkpoint write-lock (`busy_timeout` absorbs that).
- **Money as integer cents** changes hash inputs; §9 and §12 require the real validator to pass the
  converted fixtures before the change is believed.

---

## 11. Build order

Several specs, not one. Each gets its own spec and plan.

0. **The two gates (§12)** — the PostgreSQL density measurement and the throwaway loop prototype —
   before any rewrite.
1. **Storage swap.** SQLite + the Drizzle SQLite dialect, the type conversions, the two-file split,
   single test target, in-process event feed and job queues. **No replication at all**: a standalone
   venue works end to end. The largest slice by far.
2. **Stream and cold restore.** Litestream supervisor, generations, the store, archive via
   `VACUUM INTO`, freshness on `/health`. Topologies 4.1 and 4.3 without promotion.
3. **Seats and promotion.** A cloud instance or a box promoted from the store.
4. **Return, tail shipper, rejoin.**
5. **The on-prem mirror.** LAN target, follower, copy-up, retarget when the mirror dies.

Pre-production means no data migration: schema drops and recreates (CLAUDE.md §3).

---

## 12. Before any plan: the two gates

Both from the discussion note §9; neither is optional.

1. **Cost the current design at density.** Stand up one PostgreSQL server with N venue databases each
   replicating to a standby, drive restaurant-shaped write load, and measure CPU per venue at N = 10,
   50, 200. Logical replication decoding reads the whole server's WAL per subscription, so per-venue
   cost grows with everyone's write traffic (discussion note §2 — *my understanding, this is the
   measurement that confirms it*). **If PostgreSQL density is fine, this whole spec is closed** and the
   friend's concern does not apply at Waitron's scale.
2. **Prove the SQLite failover loop end to end**, as a throwaway prototype: box (SQLite + Litestream) →
   store → promote to a new generation → box returns with an un-shipped tail → tail shipped → box
   rejoins by restore. With the two natural-key clash shapes from the outbox-swap design's §4.2
   injected, and the copied-replica-equals-direct-stream check from §4.4.

Only if (1) says PostgreSQL density is a real problem **and** (2) passes does slice 1 begin.

---

## 13. Risks, named

From the discussion note §7, plus what the design added:

1. **Litestream is one project, one main author, at 0.5.** The features this leans on (follow mode, the
   VFS, v0.5's LTX format) are recent. Read its release history and issue tracker before betting a
   venue's ledger on it.
2. **The tail shipper is new fiscal-path code** (§5.2); its correctness argument is the outbox-swap
   design's and it needs the two-node proof and the Fable read.
3. **Money as integers** changes hash inputs; the alta fixture must pass the real validator afterwards.
4. **Stream encryption is ours to arrange** (Litestream 0.5 removed its own) — §7.4.
5. **Drizzle's SQLite dialect** and its migration tooling are less exercised than its PostgreSQL one.
6. **Promotion discipline:** continuing an old generation from the store corrupts the stream (§2.2,
   §4). The generation change must be structural, not a runbook step.
7. **Point-in-time restore is approximate** (§7.5); latest-state restore is exact.
8. **The on-prem-mirror copy-up must propagate deletions** or a cloud restore from it silently diverges
   (§4.4) — the prototype's explicit check.

---

## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| Owner decisions §0.1–§0.7 | brainstorm with the owner, 2026-09-16 | this session |
| Regulation names no DB privilege; hash chain + AEAT copy is the mechanism | RD 1007/2023 art. 8, 16 | quoted in the discussion note §1 (BOE text, `curl`, 2026-09-16) |
| Litestream: full snapshots, follow mode, one writer per path, no encryption in 0.5, granularity | litestream.io docs | quoted in the discussion note §3 (`curl`, 2026-09-16) |
| `ledger`/`state`/`local` classification; promotion/return shape; tail-clash shapes | `2026-09-05-outbox-to-native-replication-swap-design.md` §2, §4 | read |
| Seats = reserved dormant identity at enrolment | `2026-09-03-reserved-standby-identity-and-promotion-design.md`; #208; memory `reserved-sif-seeded-at-join` | read |
| Cold restore mints a fresh chain, never blocked | `2026-09-06-module-sp3d-fiscal-restore-hook-design.md`; memory `cold-recovery-no-hot-failover-posture` | read |
| Backup regime decisions 4 and 5; manifest and hooks | `2026-09-04-backup-restore-regime-design.md` §3 | read |
| Product images live in the DB (`media_image_data.bytes`), so the stream carries them | `packages/media/src/images.ts:223`; `packages/media/drizzle/0000_media_baseline.sql` | read 2026-09-16 |
| Density cost of logical replication per subscription | PostgreSQL behaviour, **not measured** | §12 gate 1 is the measurement |
