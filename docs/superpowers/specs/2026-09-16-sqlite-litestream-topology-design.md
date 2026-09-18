# SQLite + Litestream: storage engine, replication and failover topologies — design

**Date:** 2026-09-16. **Status:** design, awaiting owner review. This is the architecture that
replaces PostgreSQL: the owner decided on 2026-09-16 to make the switch on the strength of the
infrastructure simplification alone, which retired the density measurement that used to gate it. One
gate remains (§12.2). **Model note:** brainstormed with Fable, written by Opus from the whole
brainstorm, then read cold by a fresh-context Fable reviewer (owner's model rule, and CLAUDE.md §1 — a fiscal-touching spec gets a second model reading
cold). That read produced nine findings, all folded in; the ones that changed the design carry an
inline "Fable review finding N" marker, and the tail shipper still owes its own Fable read before it
is built (§5.2, risk 2).

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
   its own encryption, and the fiscal records the bucket holds are, once submitted, held by AEAT too, so
   provider encryption is the floor for the stream. (Chosen over running our own object storage, and
   over the box encrypting before upload.)

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

8. **The switch is warranted by the simplification alone; the density measurement is retired**
   (2026-09-16, after the seven above). The owner's decision: the infrastructure this removes — a
   database server, a replication link and most of the role-and-grant machinery, replaced by a process
   and a file per venue (discussion note §6) — is on its own sufficient reason to switch, so a
   PostgreSQL cost curve could no longer change the answer. §12.1 records what that gate would have
   measured, why it could not have decided anything as it was written, and what consequently stays
   unmeasured.

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

Each venue owns one prefix in the store, `venues/<venue-id>/`. Under it the history is a set of
**generations**, one per primary's unbroken stream. Litestream documents that two applications must
never replicate into one path ("it is your responsibility to ensure you do not have multiple
applications replicating concurrently" — Tips & Caveats), so **a new primary always opens a new
generation** and nothing ever writes an existing one again.

**A generation's name must be unique to the promoter, not a shared sequence** (Fable review finding 1,
2026-09-16). A plain `gen-0001`, `gen-0002`, … lets two nodes that promote independently — the offline
double-promotion of §4.2/§4.4 — both pick `gen-n+1` and stream into one path, the exact corruption
Litestream warns about. So a generation is named `gen-<term>-<node-id>` (term for ordering and audit,
node id to break a term tie). Two rules follow, both enforced structurally, not by runbook:

- **Open only your own.** A node streams or copies up **only** into the generation whose node id is its
  own. The mirror box's copy-up job (§4.4) refuses to write a generation box A did not open.
- **A term tie is broken deterministically, by the store.** If two nodes promote to the same term while
  partitioned, the one whose signed `current.json` write the store **accepts** wins; the loser, on
  seeing it, fences and ships its ledger tail (§5.2). The mechanism is a **conditional write**, not a
  read-check-write (§5.1 spells out the sequence): a promoter reads `current.json` with its version
  handle and writes the new one *only if the version is unchanged*, so of two nodes writing from the
  same base exactly one succeeds — the store decides, not a clock. This is the one place the design
  handles two nodes believing they are primary at the same term; every other path is a strictly
  increasing term.

A small **`current.json`** at the venue prefix names the live generation and the node writing it,
**signed with that node's membership key**. A restorer, or a returning box, learns who is primary from
the store alone — no peer need answer. `current.json` is the store-side twin of the membership document:
same term, same signer, cross-checkable. The whole tie-break rests on the store offering a conditional
write (GCS generation preconditions, Azure ETag conditions, S3 `If-Match`/`If-None-Match`); §12 pins
which store and verifies it, since an older S3-compatible target may lack it.

> **Consequence for fencing.** `persistNodeMembershipIfNewer` adopts a document only when its term is
> **strictly** higher (`packages/db/src/node-membership.ts:97` — the UPDATE fires only on a strictly
> lower held term). So a term tie is invisible to the term guard and cannot be left to it: the tie
> break above lives in the generation/`current.json` layer, and the losing node fences on the
> `current.json` compare-and-set failing, not on a higher term arriving. This is why §6's self-check
> reads `current.json`, not only the membership term.

Retention prunes generations older than the configured window (§7).

---

## 3. Node identity: seats

A **seat** is a dormant identity for a node that might one day be promoted: its own node id, a reserved
Veri\*Factu installation number (the "número de instalación" that must never be reused), and disjoint
invoice series codes. This is exactly the reserved dormant identity the current design establishes at
adopt (R2, landed #208; memory `reserved-sif-seeded-at-join`), carried onto the new mechanism.

Seats live in a `node_seats` table in `venue.db`, classified `state`, so they travel in the stream and
every restorer has them. The primary is the sole allocator, as today. A seat is minted at three moments:

- **A second box is enrolled** — it generates its keypair, the primary endorses the public key into the
  trust set and mints the seat. This is today's adopt flow with the subscription removed.
- **Cloud backup is switched on** — mints a *cloud seat* with no key yet. Whoever is promoted from the
  store claims it, generates a keypair *then*, and has it endorsed by a venue-scoped key that Waitron
  Cloud holds and that entered the box's trust set at enrolment (§6). That endorsement is the one
  place the closed-source control plane touches the trust chain — and it is the same point at which
  it already must, since it starts the instance.
- **A returned node rejoins** (Fable review finding 2, 2026-09-16) — the new primary mints it a **fresh
  seat** as part of rejoin (§5.2). A seat is consumed by the promotion that claims it, so a node that
  has already been promoted once has no seat to claim on its next promotion; rather than let it resume
  its own old node id, number and chain, the new primary allocates it a new one. This costs one cheap
  sequential number per round trip and keeps CLAUDE.md §5's "re-registering a node starts a new chain"
  literally true — a returned box never continues a chain across a promotion boundary.

A seat is **claimed exactly once**, in the same transaction that activates it, and the claim records
the term that claimed it; the claim is a compare-and-set on the seat row so two nodes racing for the
same seat cannot both win (proved by deletion, §9). An unclaimed seat is a cheap sequential number,
fiscally inert — a never-promoted tertiary just burns one number, which AEAT permits (many "SIF
virtuales" per NIF, each with its own installation number "propio y distinto"; the receipt is the AEAT
FAQ quoted in
[local-server-sif-and-failover](2026-08-01-local-server-sif-and-failover-design.md) §12, not the
discussion note). A venue with a box mirror and cloud backup carries two seats.

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
(`gen-n` / `gen-n+1` in the diagrams is shorthand for "the current / the next generation"; the actual
name is `gen-<term>-<node-id>` per §2.2, which is what keeps two independent promotions from colliding.)

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
publishes the higher term, and streams to its own `gen-<term>-<box-id>` — **buffering to a local
directory until the internet returns**, then copying up (the same copy-up job as §4.4). What the box
**cannot** do while the internet is down is fence the cloud. This is **assumed** safe, not proven
(Fable review finding 7, 2026-09-16): the reasoning is that nothing inside the venue reaches the cloud
primary either, but a handheld on mobile data or a till on a second uplink can follow the newest
membership document it fetches and could reach the cloud while the box cannot. It is still fiscally
survivable — each node sells under its own seat, so no chain forks — and when the link returns the tie
break of §2.2 decides which generation is authoritative; the loser fences and ships its ledger tail.

### 4.3 Cloud primary → cloud mirror

```
  cloud host A (P) ──stream──▶ B: gen-n
```

Topology 4.1 with the box removed. The "mirror" is the store; there is no second running instance. Host
A dies → the control plane starts an instance on host B, restores from `gen-n`, streams to `gen-n+1`.
There is never more than one running instance per venue, so there is no lease and no split brain by
construction. The cost is the restore time (seconds for a restaurant-sized file) plus the ~1 second of
un-streamed writes — comparable to the loss window of today's asynchronous logical replication (both
are asynchronous; the exact window is a §12 measurement, not a claim). **This answers the owner's third
question directly: a cloud primary needs no second instance; the store is the mirror.**

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
2. **Claim the seat, in one transaction:** take the reserved node id from the seat this node holds
   (§3 — minted at enrolment, or minted fresh for it at its last rejoin; a node without a seat cannot be
   promoted, which is caught here, not discovered later), activate the reserved number and series, write
   this node's identity into `node.db`, and mint membership term *n+1* signed with the endorsed key.
   **Committing this is the point of no return**, as today.
3. **Open the next generation.** How this orders against step 2's point of no return depends on whether
   the promoter can reach the store:
   - **A promoter that can reach the store** (a cloud instance, or a box that still has internet) makes
     winning the **conditional write** of `current.json` *part of* the point of no return. It reads
     `current.json` with its version handle, and commits step 2 **only if** the conditional write —
     `current.json` = `gen-<term>-<this-node-id>`, signed, written only if the version is unchanged —
     succeeds. If the write is rejected (another node promoted first), it commits nothing, activates no
     seat, and fences. So two online promoters racing cannot both commit.
   - **A promoter that cannot reach the store** (a box promoting with no internet, §4.2) cannot do the
     conditional write. It commits step 2 locally — the point of no return is local — sells under its
     own seat, streams to a local directory, and performs the conditional write when the internet
     returns. If it then loses, it fences and ships (§5.2, §5.3). This is safe fiscally because it sold
     under its own distinct seat; the cost is in-flight service, which §5.3 covers.
4. **Tell the tills** through the existing reroute path — the till follows the primary named by the
   newest membership document (`2026-09-05-till-reroute-design.md`); nothing here changes how it learns
   that.

### 5.2 Return, and the tail shipper

The old primary boots **fenced** (read-only), as Ruling C7 already has it. It looks for a newer term in
two places — a peer's management API and the signed `current.json` in the store — and if neither is
reachable it proceeds as primary (the accepted human-promotion window today). If a newer term exists:

1. **Ship the tail.** For each `ledger` table, the rows this node owns that the new primary lacks. The
   new primary reports, per table, what it holds for this node — the highest chain position for the
   chained tables, the id set in batches for the uuid-keyed ones — and the box sends the difference over
   the management API as an **append-only batch**, applied by the receiver in one transaction with
   `foreign_keys = ON`, parents before children. Three rules govern the apply, and the spec **owns**
   them rather than borrowing them (Fable review finding 4, 2026-09-16 — the cited app-level sync §5 is
   about applying under `withTenant` with `ON CONFLICT (id) DO NOTHING`; it carries no refuse-by-origin
   rule, so that rule is new here):
   - **Verbatim, no recompute.** For the insert-only tables (`registros_facturacion`, `cadenas`) a
     re-shipped row is a no-op, never a duplicate chain link. For `envios`/`acks`/`envio_flujo` it is
     deliberately not a no-op: the apply below updates a row the receiver already holds.
   - **Keyed by the sender.** A row is accepted only if it belongs to the sending node — by `node_id`
     on the tables that carry one (`sales`, `payments`, `registros_facturacion`, `cadenas`,
     `registro_sif`, `envios`' parent), and by a join to a sender-owned parent for the child tables that
     do not (`sale_lines`, `acks`, `envio_flujo`). A row keyed to any other node is refused.
   - **Submission state never regresses** (Fable review finding 3, 2026-09-16). The receiver's fiscal
     drain (`packages/fiscal-verifactu/src/drain.ts`, `claimBatch`) claims across **every** SIF with no
     node filter, so once a shipped `registros_facturacion` row lands the receiver may submit it to AEAT
     and mark its `envios` row `enviado`. A retried or partial ship must **not** let the sender's older
     `pendiente` version overwrite that terminal state and cause a **double submission**. So for
     `envios`/`acks`/`envio_flujo` the apply is **terminal-state-wins**, which has two sides and needs
     both: a row already `enviado`/acked on the receiver is never regressed by the sender's older
     `pendiente` copy, AND a row the receiver still holds `pendiente` ADOPTS the sender's terminal
     state. The prototype (scenario S2) measured the first side as already satisfied and the second as
     the one that carries the risk — without adoption the receiver files a record its owner had
     already filed. And the whole ship for a given SIF runs with that SIF's drain
     paused (the `blockedSifIds` mechanism `claimBatch` already takes). The append-only
     `registros_facturacion`/`cadenas` rows are unaffected — they are insert-only and idempotent.

   **Fence before ship: decommission the old primary before the tail moves (owner decision,
   2026-09-17).** The old primary does not have to resolve its own in-flight submissions first — the
   receiver is what covers those: today its drain's five-minute reset, and, for the copy it inherited
   through the stream, the boot reset this section requires once that is built. Terminal-state-wins narrows a *same-identity*
   double submission to a refused duplicate — a real AEAT answers error 3000 and our drain records
   that as filed (`packages/verifactu/src/xml/parse-suministro.ts`, `resolveEstadoEfectivo`) — so it
   is not by itself a double *filing*. It does not remove two shapes the SQLite failover prototype
   surfaced (scenario S2, `bench/sqlite-failover/README.md` → "What the FAIL means against the real
   system"). (a) **The operating procedure is decommission-then-promote:** the operator takes the old
   primary down before the secondary is promoted, so the two never file concurrently. §5.3's split
   brain is the case where that assumption is violated — the box alive but unreachable — and it is the
   *only* case in which a receiver drains a chain while its live owner drains the same chain. (b) **The in-flight (`enviando`) row is NOT a real-system stuck row — the drain already recovers it, and the mirror does hold the state (owner question, 2026-09-17).** The real drain commits `estado = 'enviando'` BEFORE the AEAT call (`packages/fiscal-verifactu/src/drain.ts`, the T1/T2 split guarded by `RECUPERACION_ENVIANDO_MS`), so a crash leaves a committed `enviando` row — and Litestream is assumed to stream committed state, so a promoted mirror holds it — an assumption this design rests on and has not run, which plan Task 6 is where the stream is actually driven. That same drain resets any `enviando` older than five minutes back to `pendiente` at the top of every pass (`recoverStaleClaims`), raising `incidencia`, then re-files it with AEAT's duplicate check (error 3000) resolving the ones already filed. The prototype's Part E shows a row stuck `enviando` only because its MINIMAL drain omits `recoverStaleClaims`: a model gap, not a real-system filing hole. The unconditional reset belongs on RESTART, not specifically on promotion (owner, 2026-09-17). On boot, before a node starts filing, it has no submission of its OWN in flight — whatever process could have held one is gone — so **boot must reset EVERY `enviando` row to `pendiente` unconditionally**, with no staleness gate, and the duplicate check resolves any that were actually filed. A promotion is followed by a restart, so the boot check covers the promoted node too and nothing promotion-specific is needed. **This reset is a requirement of this design and is not built**: read on 2026-09-17, `recoverStaleClaims` (`packages/fiscal-verifactu/src/drain.ts:449`, `where estado = 'enviando' and enviado_en < cutoff`) is the only write in non-test `packages/` or `apps/` code that returns a row to `pendiente` without an answer from AEAT, apart from the backoff taken when a submission throws (`drain.ts:717`) and reconcile's `noTrace` remediation (`reconcile.ts:394`); rows leave `enviando` by the response path and by the two chain-halt sweeps as well, but none of those is a recovery, and `apps/server/src/boot.ts` writes nothing to `envios` at all. `recoverStaleClaims` already exists and runs at the top of EVERY drain pass (`packages/fiscal-verifactu/src/drain.ts`), resetting any `enviando` older than five minutes; today it is the ONLY recovery, so a crashed node waits out that gate on its first post-boot pass. The boot reset above is what would make recovery immediate after a restart, superseding that crash-recovery role; until it is built, a restarted node waits out the five-minute gate. What the five-minute rule still uniquely covers is the one case a restart does NOT — a row left `enviando` on a node that stays UP: `persistResponse` defensively skips a response line it cannot match to a claimed row, leaving that row `enviando`, and the same rule catches an abandoned `enviando` a returning node ships into an already-running primary's tail. The normal failures never reach it — a thrown `submit` is backed off to `pendiente` at once, and a response carrying per-line rejections is resolved inline.

   For the ledger tables the owner updates in place (`payments`, `sales`, `cadenas`, the close chain)
   the sender's version wins for sender-owned rows, since the receiver's copy of them is by construction
   older. The one natural-key clash that can remain — a supplier invoice number typed on both nodes — is
   reported and skipped by a human, the single review step the outbox-swap design also keeps (§4.2); the
   working-time chain is per node since 2026-09-07 so it cannot clash.
2. **Confirm** (receiver's counts match the sender's), then **wipe** `venue.db`, restore the current
   generation, take a **fresh seat** the new primary mints for this returning node (§3, finding 2), and
   follow. `state` never travels back and never lingers — the wipe removes it — so primary and standby
   cannot diverge on a settings row (the outbox-swap design's reasoning, unchanged). The returning node
   is now a follower holding a dormant fresh identity; if it is ever promoted again it claims that new
   seat, never its old one.

**Why the tail shipper is bounded** where the deleted outbox was not: one direction, once per return,
`ledger` tables only, keyed by writer, no cursors, no retention, no peer table. Its append-only half
cannot collide because those rows are keyed by the node that wrote them (every fiscal table carries
`node_id` since the server-as-SIF rekey; children join to a `node_id`-carrying parent; everything else
is uuid-keyed). Its in-place half is the part that needs the state-regression guard above — that is
where the care goes. This is the **largest new fiscal-path component** and gets the §12 two-node proof
and a Fable read of its own before it is built.

### 5.3 What the losing side of a split brain loses

The tail shipper carries `ledger` back. `state` does not travel back — the wipe removes it (§5.2). For a
**clean** failover (the old primary was genuinely dead) that is correct: the winner's live state is the
only real one (the reasoning of the outbox-swap design's §4.3, owner-confirmed). But in an **offline
double promotion** — a human promotes the cloud because the box's stream stopped and it *looks* dead,
while the box is in fact alive and still serving — both sides served real customers, and the loser's
live state is not stale. This is the case §4.2's "assumed, not proven" fencing gap opens.

**Fiscally it is safe.** Each side sold under its own seat (its own node id, installation number,
chain), so no chain forks and no number is reused; the loser's completed sales are `ledger` and ship to
the winner verbatim. That half is settled by seats, independently of who won.

**Operationally the loser's in-flight service is lost.** Open tabs and their lines (`working_orders`,
`working_order_lines`), amendments, table state and unfinished kitchen tickets are all `state`, so when
the loser fences and wipes they vanish from the authoritative primary. And the loser is usually the
**box** — where the dinner service physically is — because it is the box that was wrongly superseded
while cut off. Food already cooked, tabs about to be paid, tables mid-meal: gone from the primary,
though no money is misfiled.

**The MVP contract, short of the shelved conflict-merge work:**

1. **Promotion asserts that *every* other node that could take over is gone — enumerated, not
   generic** (owner, 2026-09-16). Across a partition a node cannot be *proven* dead — unreachable is
   indistinguishable from switched-off — so promotion is the operator taking that risk, and the
   promotion surface must say so plainly. But "is the box gone?" is not enough when the venue runs more
   than one on-prem node: a two-box venue's mirror can promote itself on-site (§4.4, box A dies → box B
   promotes), so promoting the cloud while box B is alive is the same split brain. The cloud knows the
   venue's node set — `nodes` and `node_seats` travel in the stream, and their roles are in the cloud's
   membership view from adopt — so the promotion surface **lists every peer that could be promoted (the
   primary box AND the mirror box) and requires the operator to assert each is offline and will not be
   promoted**, one line per node, with whatever freshness evidence the cloud holds (the last stream or
   copy-up time) shown beside it. Not creating the split brain is the real defence; enumerating the
   nodes is what makes the assertion honest rather than a single vague "the box is gone".
2. **If the assertion is wrong, fiscal is safe and completed sales ship back; in-flight service is
   lost** — the same family as the already-accepted "box-down and internet-down together is no
   failover" (`docs/backlog.md` → MVP for go-live).
3. **The mitigation is a fence-time export, not an auto-merge.** Before the loser wipes, it produces a
   human-readable list of its open tabs, their lines, and unfinished kitchen tickets, so staff can
   re-key or settle them on the new primary. Automatically merging two divergent live states — the
   winner may hold its own tab for the same table — is the interactive conflict merge deliberately
   shelved (wire-protocol §7); it is named here, not gated.

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
  within minutes rather than at its next reboot. Because a term tie is invisible to the strictly-higher
  term guard (§2.2), this self-check compares the **live generation** in `current.json` against its own,
  not only the term: a primary whose generation is no longer the one `current.json` names fences, even
  at an equal term. Two writers into one generation stay impossible by the naming and compare-and-set of
  §2.2, not by term ordering alone.

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

**The stream and the archive are two independent recovery ladders, not one that refines the other**
(owner question, 2026-09-16). What Litestream brings up to date is a *replica* — a store holding one of
its snapshots plus the change files (LTX) since — which it restores to the latest point and can advance
further as more change files arrive. It does **not** advance a loose database file. So an archive
snapshot recovers to **the moment it was taken**, full stop; the stream's change files cannot
fast-forward it. Two reasons, either sufficient: `VACUUM INTO` repacks the pages, so its layout matches
the source at no point in the lineage and page-level LTX cannot apply to it; and Litestream advances
from its own replica by transaction id, never from an external base. This costs nothing, because the two
ladders are used in the alternative, never together: if the stream survived you restore from it (~1 s
behind) and ignore the archive; the archive matters only when the stream and its store are gone, and
then there are no change files to apply anyway. There is no case where you hold last night's archive and
the live change files but no restorable stream — the change files *are* the stream.

The reason the archive is a `VACUUM INTO` file rather than a copy of the stream is decision 5's
recovery-key encryption (§7.4): the offsite archive must be ciphertext under the operator's recovery
key so a lost USB stick leaks nothing and it survives the box's own key, and Litestream 0.5 cannot
encrypt — so a stream copy cannot be the recovery-key archive, while a `VACUUM INTO` file can. **If an
owner wants a fine-grained second copy** they replicate the stream to two places instead — copying the
Litestream *replica* (snapshot + change files) to the second destination, the same mechanism §4.4 uses
for the mirror box's copy-up. That is ~1-second-granular and stays current, but it is encrypted by the
destination (server-side), not under the recovery key. So the trade is explicit: recovery-key-encrypted
but coarse (`VACUUM INTO`), or fine-grained but not recovery-key-encrypted (a replica copy).

### 7.3 Where the stream goes, by tier

| Venue | Stream destination |
| --- | --- |
| Waitron Cloud subscribed | the provider object store (premier, default) |
| No cloud, owner supplies a destination | a LAN NAS, a USB disk, or their own S3-compatible bucket — same Litestream, different target URL |
| No offsite destination at all | Litestream does not run; the scheduled archive is the only backup; the "only copy is on the box" warning stays up |

A free-tier venue has a **coarser loss window** (the archive interval, not ~1 second). That is the
product difference more than a safety one — a lost record that was already **submitted** is recoverable
from AEAT (a still-`pendiente` tail and the commercial detail are not, the accepted cold-recovery
posture, memory `cold-recovery-no-hot-failover-posture`). When the owner
later switches on Waitron Cloud, the primary opens `gen-0001`, Litestream takes its first full snapshot,
and the cloud seat is minted; the venue becomes topology 4.1 with no restart and no wipe.

### 7.4 Superseded: ciphertext-only offsite, for the stream

The regime's decision 5 required offsite storage to see only ciphertext under the operator's recovery
key. The stream cannot honour that — Litestream 0.5 removed its own encryption. **For the stream** the
floor becomes the provider's server-side encryption under a per-venue key (§0.3). The **archive keeps**
the recovery-key floor unchanged. This split is the one place this spec weakens a stated posture, and it
is weakened knowingly: the records the stream holds are, once submitted, already transmitted to AEAT.

### 7.5 Three restore shapes

1. **Rejoin or return** — a fresh copy of the current generation; `node.db` identity kept (§5.2).
2. **Cold restore, no surviving peer** (box destroyed) — and here the identity rule depends on **which
   artifact** is restored, because `node.db` is not in the stream (Fable review finding 6, 2026-09-16):
   - **From the store** (stream only, no `node.db`): the restored `venue.db` has no identity, so the new
     box or instance **claims a seat** exactly as a promotion does (§5.1) and comes up under a fresh
     node id, number and chain. This is a promotion in all but name.
   - **From an archive** (which carries `node.db`, §7.2): the fiscal module's restore hook re-registers
     under the recovered node id, minting a fresh chain and series for it (SP-3d,
     `2026-09-06-module-sp3d-fiscal-restore-hook-design.md`).

   Exactly one path runs per restore, chosen by the artifact — never both, or one event would mint two
   installation numbers. Either way going live again is never blocked — the standing priority (memory
   `cold-recovery-no-hot-failover-posture`) — and either way the chain is fresh, never resumed. **The
   two artifacts differ in how much they lose** (§7.2): a store restore reaches ~1 second before the
   loss; an archive restore reaches the last `VACUUM INTO` snapshot and no further, since the stream
   cannot fast-forward it. Prefer the store when it survived; the archive is the fallback for when it
   did not.
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
- **Drizzle on its SQLite dialect** — enums → text + check; arrays → JSON; timestamps → ISO-8601 text;
  uuids → text; and the money and quantity conversion, which is **not** a blanket rule (Fable review
  finding 5, 2026-09-16):
  - **Money** (`numeric(12,2)` amounts) → **integer cents**. It does **not** touch the stored fiscal
    hash fields — `cuota_total` and `importe_total` in `registros_facturacion` are already `text`
    (`packages/fiscal-verifactu/src/schema/registros.ts:91-92`) and the huella hashes formatted strings
    (`packages/verifactu/src/huella.ts` joins `trimValue`-formatted values). What it touches is the
    **input to that formatting** — the arithmetic that produces the amount before it is formatted — so
    the risk is a rounding difference, not a changed hash field.
  - **Quantities and rates are not cents.** `quantity numeric(12,3)` and the `numeric(5,2)` rate columns
    (`vat_rate`, `deductible_proportion`, `night_premium_pct`, `rate`) keep their scale — integer
    thousandths for quantity, integer basis-points or an exact decimal string for rates. The plan reads
    the scale off each column; "everything numeric becomes cents" would silently truncate them.

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
- a seat cannot be claimed twice (concurrent claims: one wins) — the compare-and-set of §3;
- two independent promotions do not collide: distinct generation names, and the `current.json`
  compare-and-set decides the term tie (§2.2, finding 1);
- a copy-up into a generation this node did not open is refused (§4.4, finding 1);
- the tail receiver refuses a row not keyed by the sender; a re-shipped batch does **not** regress an
  `envios` row already `enviado` on the receiver, AND a row the receiver still holds `pendiente` DOES
  adopt the sender's terminal state (§5.2, finding 3; the second side was added on 2026-09-17, after
  scenario S2 found the first outcome already produced by the rig's earlier conflict-do-nothing write
  and the second the one carrying the risk) — the
  deletions that prove them are the rig's `applyTailRegressing` and `applyTailInsertOnly` variants,
  exercised by a ship retried after the RECEIVER's drain has submitted and by one retried after the
  SENDER's, each asserting no second submission;
- a restore from box B's **copied** replica equals one from a direct stream (§4.4);
- money and quantity conversion is exact: the same fixture sale yields **byte-identical**
  `CuotaTotal`/`ImporteTotal` and huella before and after the conversion (finding 5 — this is the test
  that catches a rounding drift; "passes the validator" only proves the string is well-formed), and the
  shared alta fixture is re-run against the real fiscal check, per CLAUDE.md §4 ("a fixture no check
  reads is unverified data").

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
  series (fiscal §5; memory `cold-recovery-no-hot-failover-posture`). A **returned** node is no
  exception: it takes a fresh seat at rejoin (§3, §5.2), so it never continues its own chain across a
  promotion boundary either.
- **Nothing external blocks a sale** (CLAUDE.md §5): Litestream is a separate process, and the sale
  path waits on it only for the checkpoint write-lock, which Litestream documents as "periodic but
  short" and covers with a recommended 5-second `busy_timeout` — short, not proven sub-second (Fable
  review finding 8). With `wal_autocheckpoint = 0` only Litestream checkpoints, so the one shape that
  could put our own process on the sale path is a long offline stretch (§4.2) letting the WAL grow
  unbounded; **§12's prototype must run a multi-day offline write load and confirm the sale latency and
  WAL size stay bounded** before this bullet is believed.
- **Money and quantity conversion** does not change the stored hash fields (already `text`), only the
  arithmetic feeding them; §9's byte-identical-huella test and §12 gate the change (finding 5).

---

## 11. Build order

Several specs, not one. Each gets its own spec and plan.

0. **The gate (§12)** — the throwaway failover-loop prototype — before any rewrite. The PostgreSQL
   density measurement that used to stand beside it was retired by the owner on 2026-09-16 (§0.8).
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

## 12. Before any plan: the gate that remains

### 12.1 Retired: the PostgreSQL density measurement (owner decision, 2026-09-16)

This gate read: stand up one PostgreSQL server with N venue databases each replicating to a standby,
drive restaurant-shaped write load, measure CPU per venue at N = 10, 50, 200, and close this whole
spec if the answer was "density is fine". The owner retired it on 2026-09-16 (§0.8): the
simplification is sufficient reason to switch, so a cost curve could no longer change the decision.

Two things found while scoping the measurement are recorded here, because they say why this gate
could not have decided anything in the shape it was written:

- **It measured a deployment the standing decision does not use.** `docs/backlog.md`, under "Standing
  decisions", says: *"The cloud is a dedicated instance per tenant, hosted in Spain. Density comes from
  many isolated instances per host."* The gate's method — many venue databases in one shared cluster —
  came instead from the premise in the discussion note's opening question ("the cloud will host many
  venues per PostgreSQL server to keep cost down"), which conflicts with that standing decision. The
  whole-cluster WAL-decoding cost the gate existed to test (discussion note §2) arises only on a shared
  cluster, so under instance-per-tenant it does not arise.
- **Under instance-per-tenant the cost is a per-instance floor, not a decoding curve** — one PostgreSQL
  process, container and memory reservation per venue, whatever that venue writes. That is the quantity
  SQLite removes, and it is an infrastructure argument rather than a throughput one.

**What consequently stays unmeasured, stated so nobody later assumes otherwise:** no number in this
repository says what PostgreSQL costs per venue at any density, or what SQLite costs instead. The
switch rests on the simplification, not on a measured saving, and no sentence anywhere may claim a
cost reduction as established. If a cost claim is ever needed — for pricing, or to answer the friend
who raised this — it is a new measurement, and it must be taken against instance-per-tenant.

### 12.2 The gate that stands: prove the failover loop end to end

Unchanged, and not optional. Retiring §12.1 was a decision about cost; this one is about whether the
mechanism works at all. Five of §13's risks name it as their check: 2 (the tail shipper's
double-submit), 6 (promotion discipline and generation naming), 8 (copy-up propagating deletions),
9 (an offline stretch with `wal_autocheckpoint = 0`) and 11 (the store's conditional write).

**Prove the SQLite failover loop end to end**, as a throwaway prototype: box (SQLite + Litestream) →
store → promote to a new generation → box returns with an un-shipped tail → tail shipped → box rejoins
by restore. It must exercise the shapes the Fable review surfaced (2026-09-16): the two natural-key
clashes from the outbox-swap design's §4.2; the offline **double promotion** of §4.2/§4.4 (both nodes
reach term *n+1*), confirming the generation naming and `current.json` tie-break keep the stream
restorable and fence the loser; a tail ship **retried after the receiver's drain has submitted**,
confirming no second AEAT submission (§5.2, finding 3); the copied-replica-equals-direct-stream check
from §4.4; and a **multi-day offline write load** with `wal_autocheckpoint = 0`, confirming sale
latency and WAL size stay bounded (§10, finding 8). It must also **verify the target object store's
conditional-write support** — the atomic version-conditional `current.json` write the whole tie-break
rests on (§2.2) — on the actual store Waitron Cloud will use, and on any self-host target the product
claims to support.

**Moved, 2026-09-16 (owner decision): this gate now runs immediately before SLICE 2, not before slice
1.** It is not dropped, weakened, or made optional — every scenario above still runs, and slice 2 does
not begin until it passes.

The reason is that the gate protects nothing in slice 1. Each of the five risks it checks lives in a
later slice:

| Risk this gate checks | The slice it lives in |
| --- | --- |
| 2 — the tail shipper's double-submit | 4 (return, tail shipper, rejoin) |
| 6 — promotion discipline and generation naming | 3 (seats and promotion) |
| 8 — copy-up propagating deletions | 5 (the on-prem mirror) |
| 9 — an offline stretch with `wal_autocheckpoint = 0` | 2 (stream and cold restore) |
| 11 — the store's conditional write | 2 (the store) |

Slice 1 contains no streaming, no store, no generations, no seats and no promotion (§11), so none of
these can arise in it. Risk 9 is the clearest case: it is conditioned on `wal_autocheckpoint = 0`, and
the slice-1 spec leaves automatic checkpointing at SQLite's default precisely because Litestream — the
thing that would do the checkpointing instead — does not arrive until slice 2.

**What moving it gives up, stated so it is not discovered later.** If the topology is wrong, that is
found at slice 2 rather than now. The exposure is limited, because slice 1 commits the repository to
SQLite as its engine and to nothing else in this document — not Litestream, not generations, not seats,
not the object store as the hub. The one piece of slice 1 shaped by this design is the two-file split
(§2.1), which would have to be revisited if the streaming design changed; it is cheap and defensible on
its own terms, and that is the accepted risk.

---

## 13. Risks, named

From the discussion note §7, plus what the design added:

1. **The Litestream features this leans on are recent, though the project is mature.** Litestream
   itself is not the risk the earlier draft implied: it is ~5.9 years old (created 2020-10-06), 14,381
   stars, 415 forks, not archived, actively maintained (last push 2026-09-14, latest release v0.5.17 on
   2026-08-31), and carried by more than one hand — two primary maintainers (benbjohnson 368 commits,
   corylanou 295) and 30+ contributors (GitHub API, 2026-09-16). What IS recent is the specific 0.5-line
   machinery this design depends on: the LTX replication format, follow mode (`restore -f`), and the VFS.
   The mitigation is therefore narrow — pin a 0.5.x release and let the gate-2 prototype (§12.2)
   establish, on that pinned version, that those specific features behave as the design assumes — not
   "read the tracker before betting on the project".
2. **The tail shipper is new fiscal-path code** (§5.2); its in-place half can double-submit to AEAT if
   the state-regression guard is wrong (§5.2 finding 3), so it needs the two-node proof and a Fable read
   of its own before it is built.
3. **Money and quantity conversion** feeds the hash inputs; the byte-identical-huella test (§9) must
   pass, and the scale must be read per column, not assumed to be cents (§8.3 finding 5).
4. **Stream encryption is ours to arrange** (Litestream 0.5 removed its own) — §7.4.
5. **Drizzle's SQLite dialect** and its migration tooling are less exercised than its PostgreSQL one.
6. **Promotion discipline:** continuing an old generation, or two nodes promoting into the same
   generation name, corrupts the stream (§2.2, §4). The generation naming and the `current.json`
   compare-and-set must be structural, not a runbook step — this is the review's most serious finding
   and the prototype exercises it directly (§12).
7. **Point-in-time restore is approximate** (§7.5); latest-state restore is exact.
8. **The on-prem-mirror copy-up must propagate deletions** or a cloud restore from it silently diverges
   (§4.4) — the prototype's explicit check.
9. **A long offline stretch with `wal_autocheckpoint = 0`** could grow the WAL unbounded and put our own
   process on the sale path (§10 finding 8) — the prototype's multi-day offline check bounds it.
10. **A split brain loses the losing side's in-flight service** (§5.3, owner-raised 2026-09-16): open
    tabs and kitchen tickets are `state` and are wiped on the loser, usually the box. Fiscally safe;
    operationally real. The MVP defence is human-promotion discipline plus a fence-time export; a true
    live-service merge is shelved.
11. **The tie-break depends on the object store's conditional write** (§2.2) — an older S3-compatible
    target may not offer it, which would silently break the "one primary" guarantee. §12 verifies it per
    store.

---


    **Partly established, 2026-09-16, from the providers' own documentation rather than a rig.** The
    mechanism exists in the S3 API itself. Amazon's own words, from the markdown source of *How to
    prevent object overwrites with conditional writes*: *"If multiple conditional writes or copies
    occur for the same object name, the first write operation to finish succeeds. Amazon S3 then fails
    subsequent writes with a `412 Precondition Failed` response."* That is exactly the property §2.2's
    tie-break needs — of two nodes writing from the same base, one succeeds and the other is told so.
    `If-None-Match` and `If-Match` are both supported on `PutObject` and `CompleteMultipartUpload`.
    Cloudflare R2's S3 compatibility table lists `If-Match` and `If-None-Match` as supported on
    `PutObject`, so at least two candidate targets have it.

    **A caveat the implementation must not get wrong**, from the same AWS page: a concurrent request
    can return `409 Conflict` rather than `412`, when a delete on that object completes before the
    conditional write does. AWS says a `PutObject` may simply be retried after a `409`. **A `409` is
    therefore not a lost tie-break**, and a promoter that treated it as one would fence itself when it
    had not lost. The `412` is the loss; the `409` is a retry.

    **What stays unverified:** the design does not yet name the provider (§0.3 says only "a provider
    S3-compatible store, EU/Spain region"), so this is evidence that the mechanism is available, not
    that the chosen store implements it correctly. Scenario S6 on the real target still owes that, and
    a store that is merely "S3-compatible" is exactly where this can fail.
## Provenance

| Claim | Source | How established |
| --- | --- | --- |
| Owner decisions §0.1–§0.7 | brainstorm with the owner, 2026-09-16 | this session |
| Owner decision §0.8 — switch on the simplification, retire the density gate | owner, 2026-09-16 | stated directly while gate 1 was being scoped; the two supporting reads are in §12.1 (`docs/backlog.md` standing decisions, and the discussion note's opening premise) |
| Regulation names no DB privilege; hash chain + AEAT copy is the mechanism | RD 1007/2023 art. 8, 16 | quoted in the discussion note §1 (BOE text, `curl`, 2026-09-16) |
| Litestream: full snapshots, follow mode, one writer per path, no encryption in 0.5, granularity | litestream.io docs | quoted in the discussion note §3 (`curl`, 2026-09-16) |
| Litestream maturity (age, stars, forks, maintainers, latest release) | GitHub API `repos/benbjohnson/litestream` and its contributors/releases | `curl`, 2026-09-16 — corrected risk 1, which had called it "essentially one author, at 0.5" |
| `ledger`/`state`/`local` classification; promotion/return shape; tail-clash shapes | `2026-09-05-outbox-to-native-replication-swap-design.md` §2, §4 | read |
| Seats = reserved dormant identity at enrolment | `2026-09-03-reserved-standby-identity-and-promotion-design.md`; #208; memory `reserved-sif-seeded-at-join` | read |
| Cold restore mints a fresh chain, never blocked | `2026-09-06-module-sp3d-fiscal-restore-hook-design.md`; memory `cold-recovery-no-hot-failover-posture` | read |
| Backup regime decisions 4 and 5; manifest and hooks | `2026-09-04-backup-restore-regime-design.md` §3 | read |
| Product images live in the DB (`media_image_data.bytes`), so the stream carries them | `packages/media/src/images.ts:223`; `packages/media/drizzle/0000_media_baseline.sql` | read 2026-09-16 |
| Density cost of logical replication per subscription | PostgreSQL behaviour, **not measured, and now never will be** | the measurement was retired 2026-09-16 (§12.1); it would also have tested a shared cluster, which the standing instance-per-tenant decision does not use |
| Fiscal soundness of seats, tail shipper, money conversion, offline promotion | fresh-context Fable read, 2026-09-16 | nine findings folded in; the load-bearing code claims (strict-term guard `node-membership.ts:97`, node-filterless `claimBatch` in `drain.ts`, `cuota_total`/`importe_total` already `text`, the non-money `numeric` columns) verified against the tree before folding |
| Split brain loses the loser's in-flight service; conditional-write mechanism of the tie-break | owner, 2026-09-16 | owner raised the live-service loss; `working_orders`/`working_order_lines`/`dining_tables`/`kitchen_courses`/`print_jobs` confirmed `state` in `packages/db/src/classification.ts` |
| Promotion enumerates every promotable peer, not just the primary | owner, 2026-09-16 | `nodes`/`node_seats` are streamed `state`, so the cloud holds the node set |
| The archive is a standalone coarse recovery tool; the stream cannot fast-forward a `VACUUM INTO` file | owner question, 2026-09-16 | Litestream advances a replica (snapshot + LTX) by TXID, not a loose file; `VACUUM INTO` repacks pages — from the Litestream docs read for the discussion note §3 |
