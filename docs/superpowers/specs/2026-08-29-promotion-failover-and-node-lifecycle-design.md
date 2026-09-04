# Promotion, failover, and node lifecycle

**Date:** 2026-08-29
**Status:** APPROVED — landed 2026-08-29. Captures the decisions from the 2026-08-29 design conversation
and its review round. Extends the areas [`2026-08-01-local-server-sif-and-failover-design.md`](2026-08-01-local-server-sif-and-failover-design.md)
(hereafter **#33**) §14 and [`2026-08-02-app-level-sync-design.md`](2026-08-02-app-level-sync-design.md)
(hereafter **sync**) §15 both deferred as "promotion/fencing tooling and the till-side failover list".
**Decides:** how a node resolves its role on boot/return, how promotion fences the old node, when a
node may be retired, what produces and restores a backup, how lost records are reconciled against
AEAT, how the cloud failover instance behaves and scales, and how a sale fails over between boxes
without blurring the single-writer partition. **Does not decide:** the exact promotion step-sequence
or the witness/relay wire-protocols — §9 lists these as still open.

This spec inherits its topology from #33 and its replication protocol from sync, and does not
relitigate either. Where a decision here corrects or extends a claim in those specs, it says so and
adds a dated pointer (per `CLAUDE.md` §6, historical docs are pointed-to, not rewritten).

---

## 1. Why this spec exists

Spec **#33** decided the **topology** (server-as-SIF, active-active, human-driven failover, a
relocatable submitter, a cloud mirror that can hold any role) and sync decided the **replication
protocol** (an application outbox, ownership-partitioned, applied as the non-superuser role). Both
explicitly punted the *operational lifecycle*: what promotion actually does, what a till's failover
list contains, how a fresh node is seeded, when a node is safe to throw away.

A design conversation on 2026-08-29 walked that deferred ground and surfaced concrete decisions plus
several corrections to the inherited specs. Two corrections are the seed of this document:

- **Replication is not one-way.** The active-active model is **bidirectional** — partitioned
  ownership with full cross-replication (#33 §4): each server is the sole writer of its own partition
  and streams that partition *outward* to every mirror. Replication direction follows **ownership,
  not role**; there is no fixed "primary → mirror" arrow. A record chained on a secondary flows back
  to the primary like any other row.
- **The durability tail is unbounded under a partition.** #33 §3 reassures that a physically
  destroyed server loses only "say, thirty seconds of un-replicated sales… a tuning knob." That
  reassurance **silently assumes replication is flowing.** Under a partition it is not, so an
  isolated-but-selling node accumulates an *unbounded* un-replicated tail. Not a chain-correctness
  bug (§4), but it changes what "safe to discard a box" means (§5).

Everything below builds on those two facts.

---

## 2. The load-bearing principle: ownership decides who writes and who replicates

One rule underlies every section: **a row is owned by the node that created it (`node_id`), that node
is its sole writer for life, and the row streams from its owner outward to every mirror.** Three
consequences the rest of the spec leans on:

- **Selling never needs a role.** Producing a fiscal record — chaining, hashing, appending — is done
  by a node on *its own* reserved SIF/chain/series and needs no cluster-wide authority (#33 §8). A
  node that has just booted, come back from the dead, or lost sight of its peer can **sell
  immediately** (subject to membership — §3.5). Only the **singleton roles** wait on role resolution:
  config writes, AEAT filing, payment reconcile (#33 §7).
- **"Primary" means exactly the singletons, nothing more.** Being primary changes nothing on the sale
  path — which is what lets role resolution be slow, human-arbitrated, and continuous without ever
  blocking trade.
- **Replication direction is derived, not configured.** Each partition flows from its current owner,
  so the streams reconfigure themselves when ownership moves: a promoted mirror's partition streams
  *outward from it*; a recovered old node subscribes to it. There is no arrow to flip by hand.

---

## 3. Role resolution, fencing, and rejoin

**Scenario.** Server 1 (primary) dies. An admin promotes Server 2. Server 1 comes back, but a network
partition stops it seeing Server 2. Does Server 1 resume as primary? Does it wait?

**Decision.** Server 1 does **not** resume the singleton roles. It never self-appoints while a
primary-capable peer might be contesting the role. Whether it even *sells* now depends on membership
(§3.5), not only on role resolution.

### 3.1 A stale "I am primary" stamp is not self-authorizing

The invariant that prevents split-brain: **a node that was primary before it stopped must NOT trust
its own persisted `role = primary` on the way back up.** On boot it re-resolves from scratch. A peer
(Server 2) may have been promoted meanwhile — which is exactly this scenario. If the stamp were
self-authorizing, two nodes would file and config-write concurrently. It is not.

### 3.2 Conflict detection is continuous — but this is not a cluster manager

If a human mis-promotes Server 1 while Server 2 is alive-but-partitioned, two primaries coexist until
the partition heals. #33 §8's continuous re-resolution catches it on reconnect and surfaces it; the
fiscal side is protected regardless (#33 §3: new chain, disjoint series, AEAT 3000 dedup), and the
only genuinely conflicting shared state is config — versioned, merge-resolvable.

**This deliberately does NOT require a distributed cluster-management stack** (no Raft/Paxos, no
etcd, no leader-election service). Because failover is **human-driven and physically fenced** (§3.5),
**the human is the consensus** — two nodes never have to auto-elect. What remains is lightweight and
rides the sync channel that already exists: a per-node `role` field, the membership list (config that
flows down, §3.5), and **conflict *detection* that alarms a human** when it sees a second primary. A
fixed automatic tie-break (e.g. lowest node-id keeps the singletons, the loser drops to sell-only) is
an **optional refinement**, not a requirement — "alarm the human, who resolves at the box" is a
complete and much simpler answer, and it is the one to build first.

### 3.3 A witness helps only when its knowledge is current — so it is not the mechanism

"Ask a witness (the peer, or the cloud) and auto-demote" is attractive but **unreliable on its own**,
and an earlier draft over-trusted it. A witness gives the right answer only if it holds the *current*
membership. The failing case is concrete: **Server 1 reaches a cloud that never learned Server 2 was
promoted** (Server 2 could not reach the cloud, or was itself partitioned when promoted) — the cloud
answers stale "Server 1 is primary," and Server 1 wrongly re-assumes the role. Two nodes that cannot
see each other cannot safely auto-elect. So a witness is a **latency optimisation when it demonstrably
holds fresh membership**, never the safety mechanism. The safety mechanism is §3.5.

### 3.4 "No configured peer" is not "peer unreachable"

Key off **configured** peers, not reachable ones, or a legitimately single-server venue (one local
box, or cloud-standalone) waits for a human on every boot forever. **Decision.** A node with **zero
configured peers** is the sole node by construction and self-assumes primary on boot. A node **with** a
configured peer it currently cannot reach withholds the singletons (§3, §3.5). The distinction is the
count of *configured* peers, checked before reachability.

### 3.5 Fencing: a physical fence the human throws, plus a membership fence the network carries

The hard case is a **partition where both boxes stay functional** — not "the primary rebooted." A
human promotes Server 2, but Server 1 still believes it is primary and keeps selling, and the tills on
Server 1's side never receive Server 2's updated list. Two fences answer this, and the physical one is
primary because it does not depend on the network that just failed.

**(a) The physical fence — the human, at the box.** Promotion's runbook instructs the operator to
**physically neutralise Server 1**, using the physical access a venue always has. Two options,
operator's choice:

- **Power it off** — tidiest: no dual-anything. Cost: tills that could *only* reach Server 1 cannot
  sell until the partition heals, and Server 1's un-replicated tail is stranded on it unless it had
  already shipped to the cloud (§5.1). Choose this when the isolated segment does not need to trade.
- **Demote it to *sell-only* at the box** — Server 1 stops all **singleton** work (no filing, no
  config writes) but keeps **selling on its own chain and keeps acting as a replication source**.
  Choose this when the isolated segment must keep trading: there is then exactly one holder of the
  singletons (Server 2), no dual-submitter/dual-config, while both boxes still sell — which #33 §3
  already makes non-catastrophic.

Either way the physical fence is what actually stops the *dual-primary* the software cannot reach
across a partition. "Reboot/turn off Server 1" therefore belongs in the promotion instructions,
exactly as raised in review.

**(b) The membership fence — carried by config, for the reachable side.** Promotion also **edits the
authoritative node list**, primary-owned config that flows down (like the catalogue, #33 §5/§7, sync
§2). Reachable devices act on the newest list and stop routing new sales to Server 1 — so even a
Server 1 that wrongly thinks it is primary is ignored by any device that got the update, without
relying on Server 1 self-demoting (§3.3). A returning Server 1 that reaches the cluster sees it has
been evicted and must **rejoin as secondary** — catch up as a mirror (§6), then be re-admitted by the
current primary. It never re-enters as primary. **Limitation:** the update cannot cross the partition,
so a till isolated *with* Server 1 keeps selling via it — which the physical fence (a) is what closes,
and which §5 durability-guards if the operator chose sell-only.

**Eviction from *serving* is not eviction from *replication* (review Point 2).** A node removed from
the serving list — or demoted to sell-only — **remains a replication source** until its owned partition
is fully drained into the survivors. The two memberships are distinct: *"route new sales here"* vs.
*"we still need your records."* Server 1's records must reach Server 2 (directly on heal, or via the
cloud relay if built — §5.1/§9) before Server 1 is retired; the disposal guard (§5.1) already forbids
discarding it before that. Dropping a node from *serving* must never be wired to also stop *pulling*
its tail.

The list-propagation and rejoin *wire-protocol* is **open — §9**. This refines #33 §8's "fencing is
optional hygiene" into "promotion physically fences and actively evicts"; dated pointer added to #33 §8
at land (2026-08-29).

---

## 4. The durability tail is unbounded under partition (correction to #33 §3)

Spec **#33** §3's "thirty seconds… a tuning knob" holds only while replication flows. Under a
partition, an isolated-but-selling node's un-replicated tail grows for the whole partition. State it
plainly so no future reader inherits the wrong bound:

- **The chain is never corrupted by this.** Those records are the node's own, on its own chain; a fork
  or reused number is structurally impossible across two SIF identities (#33 §3).
- **The records are only *lost* if the node is destroyed before the tail is safe** — physically (fire,
  theft, dead disk) or administratively (an admin junks the box). The administrative case is guardable
  (§5); the physical case is narrowed by §5.2 and bounded by the residual in §5.1.

Dated pointer added to #33 §3 at land (2026-08-29).

---

## 5. Losing and recovering records

### 5.1 Disposal: durability is not convergence

**The dangerous verb is "discard the box", not "sell".** Blocking selling on an isolated node is the
wrong guard: in the very partition where blocking would save records, the isolated node's tills cannot
reach any other node either, so blocking blacks them out — turning a tolerated partition into a
self-inflicted outage and discarding the point of local redundancy. The sales lost by discarding the
box are the same sales refused by blocking, but blocking costs you on **every** partition, including
the common benign ones.

**Decision — guard the disposal, and separate two distinct guarantees the earlier draft conflated:**

> **Durability** — the record exists on ≥1 surviving node. **A node may be retired only once its owned
> partition has fully replicated to at least one surviving node** (peer *or* cloud). The node proves
> this locally (its replication cursor vs. its own latest `sync_log.seq`); a non-empty tail means "not
> safely disposable." The ops surface shows the at-risk state continuously so no box is junked blind.

Durability keeps a record from being *lost*. It does not, on its own, put the record where the new
primary can *use* it:

> **Convergence** — the *new primary* actually holds the record. This is **not** implied by durability.
> It needs a replication *path* from the record's owner to the new primary. In the current design the
> cloud is a **sink, not a relay** (sync §9: "read-only downstream… never originates"), so under this
> topology — Server 1 → {Server 2, cloud}, then Server 1↔Server 2 partitioned, Server 2 promoted,
> Server 1 returns still partitioned from Server 2 and ships its tail to the cloud — **Server 2 never
> receives Server 1's records even though the cloud holds them.** The data is *durable and not lost*;
> it is temporarily **invisible** to the new primary, and converges when any link heals. Because there
> is no filing deadline (#33 §6), that delay is tolerable.

The convergence gap surfaces a real design choice: **should the cloud be a relay** — re-publishing
each owner's partition to other subscribers — rather than a pure sink? A relay keeps the two locals
converged through a LAN split as long as both reach the internet, which is robustness for exactly the
partition the redundancy exists for; the cost is the cloud doing more than passively mirror. Left
**open — §9**.

> **Note (2026-09-04, from the H2 fiscal-sync design review).** The durability bar above — retire once the
> partition has replicated to "at least one surviving node (peer *or* cloud)" — counts a tail that reached
> **only the passive cloud sink** as safe to dispose. That is durable (not lost) but **not converged**:
> because the cloud is a sink not a relay, a surviving or promoted *local* primary never receives that
> tail, so disposing the box on the strength of a sink-only copy can strand records that are safe yet
> permanently invisible to the node that keeps serving. The guard as written measures durability; what an
> operator retiring a box actually wants is that the tail reached **the node that will carry the partition
> forward** — the current primary for a secondary/mirror disposal, the promoted successor for a primary
> disposal. Candidate tightening: gate disposal on *that* node's cursor having drained the tail, not merely
> *some* survivor's. This is the disposal facet of the relay-vs-sink question (§9 item 3) and the
> convergence gap (§9 item 4), recorded so the disposal-guard implementation does not silently adopt the
> weaker "any survivor" bar. H2 (fiscal-record sync) is unaffected: it only makes the fiscal
> `sync_log.seq` measurable by whichever cursor the guard chooses — see its design §7.

**Residual, named honestly.** A node *physically destroyed* while isolated from **all** replication
targets (peer *and* cloud) loses its tail; no policy on a returning box helps, because there is no
returning box. Only **synchronous** replication closes it — block each sale until a peer acknowledges
— which is "don't sell until rejoined" per transaction, reintroducing the outage-on-partition cost the
design rejected (#33 §3). This residual is the accepted price of asynchronous replication, and §5.2
narrows it further.

**Optional posture.** A risk-averse venue may prefer "an isolated node goes read-only, route to cash".
Offer it as a **configurable posture**, not the default.

### 5.2 Reading lost-but-submitted records back from AEAT

A record that reached AEAT before the crash has a **second home independent of our replication.** AEAT
exposes a `consultar` (query) operation on the VeriFactu SOAP endpoint — proven reachable unattended
over mTLS in pre-production, returning the obligado's registered records
(`ResultadoConsulta`/`registros[]`, [`docs/compliance/first-aeat-contact.md`](../../compliance/first-aeat-contact.md)
2026-07-28). So the loss set splits:

- **Submitted-then-lost** (chained, submitted to AEAT, then the node destroyed before the tail
  replicated): **recoverable from AEAT** via `consultar`, for **fiscal** completeness — invoice
  totals, tax breakdown, huella, and chaining data. **Caveat:** `consultar` returns the *fiscal
  record*, not our *commercial* detail (order lines, tenders, tips), so the reconciliation is
  **partial** — enough for VAT/daily-close completeness, not to fully reconstruct the sale. The exact
  returned fields must be verified against the consulta response XSD before this is relied on
  (receipt owed, `CLAUDE.md` §1). This path also supplies the original invoice's data for a
  **rectificativa** against a lost invoice.
- **Chained-but-neither-submitted-nor-replicated, then destroyed:** gone from everywhere except the
  customer's paper factura. Irreducible.

**Consequence for design — submission is off-box durability.** Because a submitted record survives at
AEAT, a **fast-draining submitter narrows the truly-unrecoverable window to "un-replicated *and*
un-submitted."** This is an independent argument (alongside the replication fast lane) for draining
promptly. Note we never *resume* the lost chain (#33 §3, new chain on takeover); `consultar` restores
our internal/reporting view and enables corrections — it does not continue Server 1's chain.

**`consultar` is better run proactively than reactively (review Point 5).** Rather than reaching for
it only after a known disaster, run a **periodic (month-end) reconciliation** that queries AEAT for
the period and compares against our records, flagging anything AEAT holds that we do not (or the
reverse). This catches silent loss from *any* cause — not just a destroyed box — and fits the existing
monthly VAT / daily-close cadence, giving standing assurance that our books match AEAT's. It most
likely belongs **with the reporting/close subsystem** (cross-referenced there), not built inside the
failover tooling; recorded here as the natural home of the mechanism. Marked *possibly* pending that
subsystem's owner — §9.

---

## 6. Backups and adding a node

### 6.1 What produces a backup — replication is redundancy, not backup

**Decision.** Peer replication and backup are **different guarantees** and the draft must not lean on
one for the other. A mirror holding the union protects against a *node* dying; it does not protect
against all nodes lost, operator error, or (less likely on an append-only ledger) corruption
propagating. **Every node that can be a *sole* system of record maintains an independent backup
regime:** continuous WAL archiving + periodic base backups to object storage, giving point-in-time
recovery. This is what §6.2 restores from.

The regime is **non-optional for a cloud-standalone or a promoted cloud-primary**, because with both
local boxes gone the object-storage backup is the *only* thing behind the live database — there is no
peer to fall back to. For the two-local topology the peers give redundancy and the backups give the
disaster floor; both are wanted.

### 6.2 Adding a node — restore a backup, then stream the delta

sync §7 does the full copy by snapshotting the **live peer** (a large `COPY` off a running box).
**Decision.** Prefer **restore-from-backup** as the source for the full-copy step, especially for the
cloud: restore from object storage in-region and let the tunnel carry only the *delta* since the
backup, instead of dragging the venue's whole history off the on-prem box. It slots into sync §7's
idempotent apply path unchanged. Three safety conditions:

1. **Cursor at-or-before the backup's high-water, never after.** Apply is idempotent (`ON CONFLICT DO
   NOTHING` on append-only tables, watermark no-op on mutable ones, sync §5), so a snapshot/stream
   overlap dedupes harmlessly; a cursor set *ahead* of the backup's contents leaves a **silent gap**.
   **The backup must include `sync_log`** so the new node reads the exact per-origin `max(seq)` it
   restored to and streams forward — no guessing.
2. **Restore the data, mint your own identity.** The new node restores the *union of every owner's
   records* but takes a **fresh `node_id`, install number, and series** (sync §7 step 1). It must
   never adopt the identity of the node whose backup it restored, nor write into a partition it does
   not own. Restoring Server 1's backup onto a new Server 3 makes Server 3 a *mirror* of Server 1's
   chain, not a second writer of it.
3. **Environment handshake on restore.** The backup carries a `deployment.environment` stamp; the new
   node checks it against its intended environment before going live (sync §10), so a preproduction
   backup can never seed a production mirror.

This supersedes sync §7's tentative "native logical decoding may serve the bulk backfill" — restore
from object storage beats draining a slot and needs no `REPLICATION` privilege (sync gate 6 left
native decoding N/A anyway).

---

## 7. Cloud failover: cheap by default, powerful only when promoted

The product goal is that subscribing to cloud failover is a trivially cheap decision, and that running
it costs us little until a venue actually depends on it.

### 7.1 The cloud serves zero sales until promoted

**Decision.** The cloud mirror is **passive until a human promotes it** — it holds the union, files
nothing, serves the dashboard read-only, and never originates a sale (sync §9's recommended default,
made a hard rule). No automatic "use the cloud for sales if the two locals look unavailable": that
would force sales-sizing on the cloud always (defeating §7.2), and auto-electing a third node is the
split-brain #33 §8 makes human-driven on purpose. The cloud still appears in the failover list but as
**"reachable, pending promotion"** — a till that fails all the way over to an unpromoted cloud gets
"I am a mirror, I will not sell," never a silent sale on a node that must not originate.

### 7.2 Sizing: plain Postgres on a VM — headroom, load-shedding, and resize

**Constraint (review Point 3): no proprietary/managed-database dependency.** The design must run on
**basic Postgres on a VM available in any data centre** — no Neon, no Aurora Serverless, nothing that
ties a venue to one provider. So the resize is a plain **stop → change instance size → relaunch** (a
brief downtime, which is acceptable), or an in-place resize where the provider supports it. The
overload-before-resize risk that autoscaling would have removed is instead managed by three basics:

1. **Size the always-on mirror with modest headroom, not the absolute floor.** Enough to serve a busy
   period as primary without an immediate resize. This is cheap because a deli's **sale path is light
   even when busy** — a handful of tills writing a few rows per sale — and the submitter is
   AEAT-rate-limited (60 s / 1,000 per envío, #33 §6) so it cannot overload the box.
2. **Shed the heavy load to protect the sale path.** The heavy, spiky work is **reporting/dashboard
   aggregation**, which is off the sale path and deferrable. Under pressure, throttle or defer it so
   selling never contends with a report. This is what keeps a modest box safe through a busy
   promotion.
3. **Resize (stop/relaunch) only for *sustained* heavy operation** — the disaster has become days, not
   minutes — as a deliberate follow-up, never the thing selling waits on. The brief downtime is
   tolerable because the venue was already in a disaster when the cloud was promoted.

**The mirror must be always-on.** Stopping the instance to save money is a false economy: a stopped
mirror stops applying the stream, goes stale, and cannot be caught up at promotion time, because
promotion happens when the on-prem boxes are dead — there is nothing to catch up *from*. Continuously
keeping up *is* the value. "Cheap" means *small always-on*, not *on-demand*.

### 7.3 Cost model and the residency constraint

The subscriber pays a **low standing fee** (small always-on instance + storage + backups + tunnel) and
a **higher usage fee only while the cloud is actually their primary** (the scaled-up compute). Our cost
tracks our revenue. The standing floor is dominated by storage (immutable records grow, slowly for a
deli) plus the tunnel and minimal compute.

**Constraint carried, not resolved:** where an *active* cloud SIF may legally run (records issued from
outside Spain/EU) is an open asesor question (#33 §13, cloud-storage §8a) that scopes which region the
promoted instance may occupy. A gate on offering cloud-primary / cloud-standalone topologies, not on
this design.

### 7.4 Hot failover *for* a cloud primary — the topology is fractal (review Point 6)

The question the earlier draft missed: when the cloud **is** the primary, what is its Server-2? On-prem,
Server 1 has Server 2 as a hot standby; a cloud primary needs the same. **Decision.** The topology is
**fractal — whatever holds the primary role wants a peer, and in the cloud that peer is a second cloud
node** (a different availability zone / rack), cross-replicating exactly like the two local boxes, on
the same plain-Postgres mechanism. Backups (§6.1) are the *durability* floor; a peer is the *hot
failover* — they are not substitutes (a restore-from-backup is cold: minutes of downtime plus the tail
lost since the last backup).

How this lands per topology:

- **Cloud-standalone venue wanting HA:** run **two cloud nodes across AZs** from the start (active-active
  or primary + warm standby) + backups. This is the case where the fractal genuinely bites — there is
  no local box behind the cloud.
- **Cloud-standalone basic tier:** **one** cloud node + object-storage backups, accepting **cold**
  recovery instead of hot failover — a deliberate cost/resilience tier the operator chooses.
- **Promoted cloud during a disaster** (both locals dead, cloud was the tertiary): **single node is
  acceptable** — the venue is already in a disaster, the priority is getting a local box back, and
  backups are the floor. Optionally spin a second cloud node as its standby if the outage drags on.

So "how many nodes back the primary role" is one topology knob applied uniformly, on-prem and in the
cloud; the cloud does not get a special HA mechanism, it gets a second cloud node.

---

## 8. Sale failover between boxes without blurring the single-writer partition

Load between the two local boxes balances by **ownership of a sale, not a per-request balancer.** The
write-partition is keyed by the owning node, so if a single logical entity had some writes routed to A
and some to B it would straddle two owners and need conflict resolution — the thing banned near
anything fiscal. The unit that must stick to one owner is the **tab** (an open order and everything on
it, through to settlement).

### 8.1 Per-tab ownership, assigned at open time — no manual home list

**Decision (from the review round).** Do not maintain a static per-till "home box" list. Instead,
**each new tab (or walk-up sale) is assigned to a reachable box at open time**, load-balanced across
the boxes, and **all that tab's writes stick to that box until settlement.** The **tab is the unit of
ownership**, which aligns with §8.3 (settlement is a single atomic birth by one box). This:

- **auto-balances** — tabs spread across the boxes regardless of which till opened them, with no list
  to maintain;
- **keeps every tab single-writer** — one owning box for its whole life; and
- **makes failover granularity uniform** — everything is a tab.

Independent, non-tab writes (each a standalone row with no cross-write consistency need — e.g. a
time-clock punch) may go to **any** reachable box; only the multi-write entity needs sticky routing. A
boot-time per-till home assignment is a valid **coarser fallback** if per-tab routing proves too much
for the till client. (A consequence either way: a single till's sales spread across both boxes' series
over time — fine fiscally, since series are disjoint per box, #33 §3.)

### 8.2 Failover and return move ownership; they never share it

Single-writer is violated only by two boxes writing the same row **concurrently**; a **sequential**
handoff — A stops, B takes over — never violates it. So ownership **transfers**, never shares, with
exactly one owner at any instant.

- **New tabs after a box dies** are simply assigned to a surviving box — trivially clean.
- **An open tab whose box died** is held read-only on the survivors (the dead box's partition); to
  continue it, a survivor **adopts** it (re-stamps ownership) or opens a continuation. One owner at a
  time throughout.
- **"Return" is a load nicety, not a correctness need**, done lazily at a **tab boundary**: in-flight
  tabs settle on their current owner; only new tabs get assigned to a recovered box. No single tab is
  ever written by two boxes. Do not auto-return eagerly — a flapping link would scatter a session's
  tabs. Whether return is manual, scheduled, or lull-triggered is **open — §9**.

### 8.3 Why the chain is safe through all this

The row that must be single-writer *and* immutable — the **fiscal record** — is born **once, at
settlement**, by **one** box, on that box's chain/series, and is frozen forever. Single-writer holds
trivially: written once, never touched again. Failover and return only ever move the **mutable open
tab** (`working_orders`), which before settlement is working state — non-fiscal, versioned, mergeable
like config (#33 §8), never the chain.

### 8.4 The bounded danger: partitioned-not-dead

The one case that can genuinely blur is **A partitioned but alive**: a survivor adopts a tab while A
also still believes it owns it (another till on A's side is editing it). Tab-level split-brain,
bounded exactly like the server-level version:

- **It cannot fork the chain.** If both boxes *settle* the same tab, they mint **two separate valid
  fiscal records on two separate chains** — a **double-bill** (customer charged twice), which is
  **detectable and refundable** (the class of #33 §10's double-charge), not an unrecoverable fork.
- **The open-tab divergence** is working state, hand-mergeable on heal.

Membership fencing (§3.5) shrinks this window on the *reachable* side (a promoted box evicts the old
one, so reachable tills stop feeding the old box); the irreducible remainder is the isolated segment,
whose worst case is a detectable double-bill, never a corrupted chain.

---

## 9. What this decides, and what stays open

**Decided here:**

- Ownership (not role) decides who writes and the direction each partition replicates (§2).
- A returning node never trusts a stale primary stamp; conflict detection is continuous but needs **no
  cluster-management stack** — human-driven + physically fenced, the human is the consensus, and the
  "tie-break" can be alarm-the-human; a witness is only a latency optimisation when its membership is
  provably current (§3.1–§3.3).
- Zero *configured* peers → self-assume primary; an unreachable configured peer → withhold singletons
  (§3.4).
- **Promotion physically fences the old node** (power-off *or* demote-to-sell-only, at the box) **and**
  evicts it from the serving list; **eviction from *serving* is not eviction from *replication*** — an
  evicted/sell-only node stays a source until its tail is drained; returning node rejoins as secondary
  (§3.5).
- The durability tail is unbounded under partition (§4).
- Retire a node only after its partition replicated to a surviving node; **durability ≠ convergence**;
  guard the disposal, show the at-risk state, offer an optional read-only posture (§5.1).
- Lost-but-**submitted** records are recoverable from AEAT via `consultar` (fiscal fields only, XSD to
  verify); submission is off-box durability, so prompt draining narrows the unrecoverable window; run
  `consultar` proactively as a **month-end reconciliation**, likely in the reporting subsystem (§5.2).
- Replication is redundancy; a sole-system-of-record node keeps an independent backup regime; new
  nodes restore-then-stream under three conditions (§6).
- Cloud passive until promoted; **plain Postgres on a VM (no managed-DB dependency)**, sized with
  headroom, shed reporting to protect the sale path, resize/relaunch for sustained load, always-on
  (§7.1–§7.2).
- **Hot failover for a cloud primary is a second cloud node** — the topology is fractal; backups are the
  durability floor, a peer is the hot failover (§7.4).
- **Per-tab ownership assigned at open time** (no manual list); ownership transfers never shares;
  settlement is a single atomic birth that protects the chain (§8).

**Still open (each needs its own resolution before the tooling is built):**

1. **Membership & rejoin wire-protocol (§3.5).** How the node list is versioned and propagated, how a
   device trusts a newer list, how the returning node's rejoin-as-secondary is sequenced, and how a
   witness may safely supply *current* membership (§3.3).
   > **Design resolved 2026-09-02** by
   > [membership-and-rejoin-wire-protocol](2026-09-02-membership-and-rejoin-wire-protocol-design.md): a
   > signed, self-verifying membership document (`term` + per-node identity keys chained from setup),
   > distributed over `/sync-api/hello`; a demote-never-promote witness rule; a drain-then-restore rejoin;
   > and primary-wins + a conflict surface for the shared/config class. Design only — the tooling is still
   > to build.
2. **What "promotion" actually executes** — the ordered runbook a human's "make this primary" triggers.
   §3.5 fixes the fencing steps (physically neutralise the old node; evict from serving but keep as a
   replication source); the rest of the sequence remains to assemble: claim the singletons,
   inject/rotate the key ring, enable capture/origination on a formerly-passive mirror, reverse the
   relevant streams, resize (§7.2), and — for a cloud primary wanting HA — bring up its second node
   (§7.4). The biggest remaining gap, and the natural next design pass.
3. **Cloud as relay vs. sink (§5.1).** Whether the cloud re-publishes each owner's partition to other
   subscribers, to keep the two locals converged through a LAN split — trading cloud complexity for
   partition robustness.
4. **The promoted-node (Server 2) side.** While it cannot see the old primary, does it keep filing?
   How does it treat the records it is missing (the convergence gap, §5.1)? Named, not yet worked
   through.
5. **Till-failover tooling detail (§8.2):** auto-return vs. manual vs. lull-triggered; adopt vs.
   continuation as the default; how a till learns a box is back.
6. **Disposal-guard UX (§5.1):** the override flow, and when an operator may declare a subscriber dead
   and prune past its cursor (also sync §12 open item 4).
   > **Added 2026-09-04 (§5.1 note):** and *which survivor counts* — whether the guard should require the
   > tail to reach the node that carries the partition forward rather than any survivor, so a sink-only
   > copy does not green-light disposal. Facet of items 3 and 4.
7. **Residency for an active cloud SIF (§7.3; #33 §13; cloud-storage §8a):** the asesor/legal question
   gating cloud-primary and cloud-standalone topologies.

---

## 10. What this supersedes and interacts with

- **Extends** #33 §14 and sync §15 (the deferred promotion/fencing tooling and till-side failover
  list) — the first document to work that ground. §9 lists what remains.
- **Corrects** #33 §3's durability-tail bound (unbounded under partition, §4) and the one-way-
  replication misconception (§1–§2). **Refines** #33 §8's "fencing is optional hygiene" into
  "promotion physically fences the old node and actively evicts it from serving" (§3.5). Dated pointers
  added to #33 §3 and §8 at land (2026-08-29); their text is left as written (`CLAUDE.md` §6).
- **Hardens** sync §9's "passive cloud tertiary" into a rule (§7.1); prefers restore-from-backup over
  sync §7's live-peer snapshot / native-decoding backfill (§6.2); and adds the **cloud-relay** question
  against sync §9's sink-only cloud (§5.1, §9). Dated pointer added to sync §9 at land (2026-08-29).
- **Depends on** sync's ownership map, idempotent apply, and environment handshake; #33's role model,
  boot resolution, and cloud topologies; cloud-storage §5's restore promise, §6a's installation-number
  allocator, and §9's cloud-ingest role; and `packages/verifactu`'s `consultar` client (§5.2).
- **`docs/backlog.md`** — the *SIF topology follow-ups* section was updated at land (2026-08-29) to
  point here and mark the promotion runbook (§9 item 2) as the flagged next design pass. **Does not
  touch** `docs/compliance/*`.

---

## 11. Out of scope

The wire-protocol and versioning of the sync channel (sync §15); the counter/till UX for the
timed-out card case (#33 §10); the double-charge and double-**bill** remediation UI (#33 §10/§13 — this
spec adds the double-bill to what that surface must eventually handle, but does not build it); the
analytics/reporting projection; data export. This document decides the **node lifecycle and failover
behaviour**; each open item in §9 gets its own resolution.
