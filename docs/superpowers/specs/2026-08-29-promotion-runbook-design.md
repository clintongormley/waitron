# The promotion runbook: what "make this primary" executes

**Date:** 2026-08-29
**Status:** APPROVED — landed 2026-08-29; implementation plan to follow. The next design pass flagged by
[`2026-08-29-promotion-failover-and-node-lifecycle-design.md`](2026-08-29-promotion-failover-and-node-lifecycle-design.md)
§9 item 2 (hereafter **the lifecycle spec**), which called it "the biggest remaining gap." Inherits its
topology from [`2026-08-01-local-server-sif-and-failover-design.md`](2026-08-01-local-server-sif-and-failover-design.md)
(**#33**), its replication protocol from [`2026-08-02-app-level-sync-design.md`](2026-08-02-app-level-sync-design.md)
(**sync**), and its mirror-mode mechanism from
[`2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md`](2026-08-28-sync-cloud-mirror-c2a-mirror-server-design.md)
(**C2a**).

**Decides:** the ordered action a human's "make this primary" triggers on a target node — its trigger
surface and authority, the state it moves, the live in-process mechanism that avoids restarting the sale
path, the per-target step sequences (including the **no-hot-failover cold-restore-from-backup** path,
where data loss is accepted but trading is not blocked), and how the sequence interleaves the physical
fence of the old node so two submitters never coexist. **Does not decide:** the membership-list wire-protocol and re-admission
format (lifecycle §9.1), the promoted-node-while-partitioned filing question (lifecycle §9.4), or
cloud-relay-vs-sink (lifecycle §9.3) — §9 keeps these open.

Where a decision here corrects or extends an inherited claim it says so and a dated pointer is added at
land time; historical docs are pointed-to, not rewritten (`CLAUDE.md` §6).

---

## 1. Why this spec exists, and its scope

The lifecycle spec decided *what promotion must guarantee* (fencing, durability, ownership) but left
*what promotion executes* to this pass. C2a built the seam a live promotion needs — a `deployment.mode`
flag read through a refreshable holder, a per-request read-only gate, and an ambient-viewer teardown that
fires on the flip — but C2a's own §10/§11 put **the promote action itself, and the worker start/stop it
entails, out of scope**. This spec designs that action.

**Four targets, each a different step-set:**

- **Local secondary → primary.** The on-prem failover. The node is already selling active-active on its
  own SIF; promotion claims the singletons only.
- **Passive cloud mirror → primary.** The disaster case (both locals dead). The node has no SIF and runs
  no workers; promotion mints a fresh SIF, starts selling, injects the key ring, and starts the workers.
  Heaviest.
- **Rejoining old primary → secondary** (the inverse). A returning node relinquishes the singletons,
  keeps its own chain, catches up as a mirror, and requests re-admission.
- **Cold restore → primary (no hot failover).** The majority single-box case: the only node is gone, and
  there is no peer or mirror to promote — it is rebuilt from an object-storage backup. Mint a fresh SIF,
  go live immediately, reconcile the lost tail at month-end. **Data loss is accepted; being unable to
  trade is not.** A recovery-to-primary rather than a promotion of a live node, but it reuses the same
  go-live machinery (§5d).

**A principle all four share, sharpest in the cold-restore case: trading never blocks on filing or
reconciliation.** Selling needs neither a peer, nor the cert, nor a reconciliation pass — the huella is a
plain hash (#33 §9) — so a node can always be brought into service to trade; filing and reconciliation are
off the critical path and catch up afterwards (no filing deadline, #33 §6).

**Three boundaries, so this pass does not collide with adjacent open items:**

- The **list-versioning/propagation wire-protocol** — how a device trusts a newer node list, and the
  re-admission handshake format — stays in lifecycle §9.1. This spec produces the *inputs* and the
  *node-local sequence*, not the wire format.
- The **promoted-node-while-partitioned filing** question (lifecycle §9.4) is referenced, not re-decided.
- **Cloud-relay-vs-sink** (lifecycle §9.3) stays open; this spec assumes today's sink, so the
  durability-≠-convergence gap persists until a link heals.

---

## 2. The state model is two orthogonal axes

Promotion moves a node along **two independent axes**, and the schema already fixes where each lives.

- **Axis 1 — read/write posture:** `deployment.mode` ∈ {`mirror`, `primary`}. **Built** (C2a, migration
  `packages/db/drizzle/0069_deployment_mode.sql`; `packages/db/src/deployment.ts`). A whole-*database*
  fact: `mirror` means read-only, enforced by the method-based `node.read_only` gate.
- **Axis 2 — singleton ownership:** whether *this* node holds the submitter / config-writer / reconciler
  singletons (#33 §7). This is #33 §8's `role` (primary|secondary), and it is **not built**.
  `packages/db/src/schema/nodes.ts` (the header comment, ~lines 7–16) explicitly defers it —
  "active-active/failover — a `role` column, a second node — are later specs" — *and* warns it must not
  be conflated with the mode flag, which is the *mirror/primary* (read-write vs read-only) split. Like
  mode, it is a per-*deployment* fact ("each server holds a `role` it can answer for", #33 §8), so it
  lands as a **new `deployment` column**, never on `nodes`.

Two axes are unavoidable because a **local secondary** is read-*write* (it sells) yet holds *no*
singletons — a state a single mirror|primary flag cannot express. The legal combinations:

| `deployment.mode` | singleton-role | who |
| --- | --- | --- |
| `mirror` | — (n/a) | passive cloud mirror — read-only, no singletons |
| `primary` | `secondary` | local secondary — sells, no singletons |
| `primary` | `primary` | the one venue primary — sells + singletons |
| `mirror` | `primary` | **invalid** — cannot hold singletons while read-only |

**Decision — the field.** Add a `deployment.singleton_role` column (values `primary` | `secondary`), a
singleton row like `mode`, written by the owner/provisioning connection and read through a refreshable
holder exactly as `mode` is. It is **set explicitly, not defaulted into correctness**: provisioning stamps
a sole / venue-primary node `primary` and a mirror `secondary`, and the promote/relinquish action (§5)
moves it thereafter — a blanket `secondary` default would silently stop a one-node venue filing. How it
interacts with #33 §8's boot-time resolution (a zero-configured-peers node self-assumes primary, lifecycle
§3.4) belongs with the deferred conflict-detection watcher (§9). **Selling never reads it** (#33: selling
needs no role); only the workers of §3c gate on it. The `mirror` + `primary` combination is rejected at
the write boundary.

> The name follows the domain concept, not the throwing package (`CLAUDE.md` §3). "singleton_role" says
> what it governs — the singleton duties — rather than reusing the overloaded word "role" (which in this
> tree already names identity/permission roles). Grep the siblings before the final name at implementation.

---

## 3. The mechanism — live in-process promotion (no sale-path restart)

The sale path must never restart (a local secondary is *selling* when promoted, with its peer already
dead, so a restart would black out its tills). The chosen mechanism keeps the process up throughout.

### 3a. Mount-and-gate everything

C2a already mounts the whole HTTP surface in both modes and gates *writes* per-request via the mode
holder; the one hold-out is `mountSyncApi`, skipped on a mirror (the `!isMirror` gate in
`apps/server/src/boot.ts`). **Decision.** Mount it always, gated by mode at request-time like the
read-only gate. Result: **promotion re-mounts nothing** — every route is already up, and the mode flip
changes only which routes accept work. This is C2a's established pattern, extended to its last exception.

### 3b. Mode-holder + singleton-role-holder refresh

The promote action writes the DB state (`setDeploymentMode('primary')` — the primitive C2a built but only
tests call today — and `setSingletonRole('primary')`, new) *and* refreshes the in-process holders. C2a's
per-request middleware already reads the mode holder, so the read-only gate opens and the ambient-viewer
teardown fires (both built in C2a: `apps/server/src/mirror-session.ts` ends the ambient session and
clears its cookie when the holder reads `primary`) with **no restart**.

### 3c. A worker-lifecycle manager — the real new code

The primary-only background loops — fiscal `drain`, `reconcile`, `retention`, and (role/location
dependent) the sync-source activity and the tunnel client — are frozen at boot today as a `const isMirror`
captured once (`apps/server/src/boot.ts`). This spec replaces that freeze with a small manager that can
**start** those workers in-process, in order, gating on `singleton_role` rather than a boot-time constant.
Ordering matters: the submitter/`drain` must not start before the key ring is unlocked (§3e). Starting
background loops live is tractable — nothing on the sale path is touched, and every route is already
mounted (§3a). A cloud primary runs the sync **source**, not the tunnel client (it is not behind NAT); the
manager starts the set appropriate to the node's role *and* location.

### 3d. Capture/origination is a consequence, not a step

The capture triggers are schema, created **unconditionally** by migration on every node
(`packages/sync/drizzle/0000_sync_outbox.sql` lines ~149–179; `packages/db/drizzle/0037_gate_triggers_on_sync_apply.sql`),
their WHEN clause gated on the `app.sync_apply` GUC — **not** on `deployment.mode`. On a mirror every
write is an *apply* (the apply worker sets `app.sync_apply='on'`, so the trigger skips); the moment a
promoted node writes its *own* row (GUC unset), the trigger fires and the row is captured into `sync_log`.
**So there is no explicit "enable capture" switch** — capture begins the instant the node originates.
(Receipt still owed on the real DB — §9.)

### 3e. Crash-safety — an idempotent, checkpointed sequence

A promote that dies half-way (SIF minted but axes unflipped; key ring unlocked but workers unstarted) must
converge on re-run — the discipline C2b's provisioning used (a synchronous one-shot latch + a
double-provision guard). Each step is idempotent: a SIF already minted from the reserve is not minted
twice; workers already up are not double-started; a half-flipped axis is completed. A concurrent second
promote is refused by the latch.

### 3f. Two preconditions the action depends on (does not create)

1. **A passive cloud mirror must hold a pre-reserved SIF identity** — installation number + disjoint
   series codes, staged *while the link was up* (#33 §8) — because the allocator is unreachable in the
   disaster the mirror is promoted for. The promote mints the SIF *from* that reserve; it never calls the
   allocator at promote time.
2. **The ex-mirror must have the tables the operational write-GETs touch** (`print_jobs`, `devices`, …)
   provisioned before the read-only gate lifts. C2a's read-only method-gate is method-based, so a few
   operational GET handlers that write (e.g. `GET /print-api/agent/jobs` → `claimPrintJobs`) are inert on
   a mirror today *only* because those tables are not synced/provisioned there; promotion lifts the gate
   and makes them live (C2a's own deferred caveat, `apps/server/src/read-only-gate.ts` header). Receipt
   owed — §9.

---

## 4. Authority and trigger: remote-first, local fallback, one break-glass secret

The "at the box, offline" constraint belongs to the physical fence of the **old** node (§6), not to the
promote action on the **new** node — a different machine. Promotion is therefore location-independent
(#33 §8 already says role resolution is), and:

- **Remote-first.** The promote action is an authenticated API on the target node, reachable remotely (the
  cloud-mirror disaster case is reachable *only* remotely) and locally. A **local console/CLI path**
  exists solely as the offline fallback for the internet-down local failover, where remote is unreachable.
- **One break-glass secret, both jobs.** A promotion/recovery secret minted at provisioning/enrolment
  (the setup wizard, alongside C2b's mirror-bundle work) and held by the operator offline. Presented at
  promote time it **authorizes** the action *and* **unlocks** the key ring to unseal the replicated cert
  blob so the node can become the submitter. It travels operator→node over the authenticated admin channel
  (TLS), never the node→node sync channel #33 keeps secrets off. One thing to safeguard — and one thing to
  lose; §9 notes the custody question.
- **The deliberate hole in the read-only gate.** A mirror refuses every non-GET. The promote endpoint is
  the one exception — exempt from the method gate, guarded by the break-glass secret, **never** the
  unauthenticated ambient viewer. On success the mode flip tears the ambient session down (C2a), so no
  auto-admin outlives promotion.

---

## 5. The ordered sequences (all idempotent, checkpointed per §3e)

Each begins: operator presents the break-glass secret → the node authenticates → the checkpointed
sequence runs. Notation: `(mode, singleton_role)`.

### 5a. Local secondary → primary — already `(primary, secondary)`, already selling

1. **Fence gate (§6):** operator attests the old node is physically neutralised; the membership list is
   edited to evict it from serving. This gate must pass before step 3.
2. **Unlock the key ring** with the break-glass secret → unseal the cert blob → submitter-capable.
3. **Claim the singletons:** `singleton_role → primary` (mode unchanged — it already sells). Checkpoint.
4. **Start the singleton workers live** (§3c). One primary, still selling throughout, no restart.

### 5b. Cloud mirror → primary — `(mirror, —)`, the disaster case

1. **Fence gate (§6):** attest both locals dead/neutralised.
2. **Unlock the key ring** → unseal the cert (the cloud now holds it — the standing-exposure the lifecycle
   spec flags; **rotate after failback**, §5c step 5).
3. **Mint a fresh SIF** from the pre-reserved installation number + disjoint series; **new chain**, never
   resume a dead node's (#33 §3, `CLAUDE.md` §5). Checkpoint — the point-of-no-return (§7).
4. **Flip both axes:** `mode mirror→primary` (read-only gate off, ambient viewer torn down) and
   `singleton_role → primary`.
5. **Start selling** (origination begins → capture triggers fire, §3d) and **start the singleton workers**
   (§3c — sync source, not the tunnel client).
6. **(HA option)** bring up a second cloud node as its peer (lifecycle §7.4 — the topology is fractal).

### 5c. Rejoining old primary → secondary — was `(primary, primary)`

1. **Boot / link-return re-resolves role from scratch** — never trusts its stale `primary` stamp
   (lifecycle §3.1).
2. **Detect eviction:** a newer membership list, or a peer claiming primary → it is not primary.
3. **Relinquish the singletons:** `singleton_role → secondary`; stop the singleton workers — **but stay a
   replication source** until its own un-drained tail has replicated to a survivor (lifecycle §3.5:
   eviction from *serving* is not eviction from *replication*).
4. **Catch up as a mirror**, then **request re-admission** to serving (the request is produced here; its
   wire format is lifecycle §9.1).
5. **Rotate the key ring** if this node had held the cert as a disaster-primary (#33 failback rotation).
   Keeps its own chain throughout — a returning (non-reimaged) node never starts a new chain.

### 5d. Cold restore → primary — no hot failover (the majority single-box case)

The only node is gone (dead disk, theft, fire) and there is no peer or mirror to promote. Recovery rebuilds
a node from the object-storage backup regime, which is non-optional for a sole system of record (lifecycle
§6.1). There is no fence step — there is no old node still running to fence.

1. **Restore the latest backup** onto new/reinstalled hardware — base backup + WAL PITR to the last
   archived point. The backup **includes `sync_log`** (lifecycle §6.2), so cursors are exact.
2. **Environment handshake:** the backup's `deployment.environment` stamp is checked against the intended
   environment (lifecycle §6.2 / sync §10) — a preproduction backup can never seed production.
3. **Mint a fresh SIF / new chain** from a fresh installation number + new series — **never resume the old
   chain.** Records chained after the last WAL archive are lost, and resuming would chain the next record
   from the backup's last while AEAT saw the lost records chain from that same huella — a fork, the one
   unrecoverable failure (#33 §3, `CLAUDE.md` §5). The same NIF files the new chain, so the cert is reused;
   only the installation number and series are fresh. (Same-series resume, `cloud-storage §5`, is available
   *only* when loss is provably zero — not the async-PITR default.) This is the point-of-no-return (§7).
4. **Unlock the key ring** (break-glass) to unseal the cert from the restored blob, *if the operator holds
   the secret* — the node then files its new chain. If the secret is lost, skip it: the node still trades
   (step 5), and filing waits on a re-provisioned cert. Filing is never on the critical path to trading.
5. **Set `(mode, singleton_role) = (primary, primary)`** — a sole node with zero configured peers
   self-assumes primary (lifecycle §3.4). **Go live immediately:** the only preconditions to trading are a
   successful restore, a passed handshake, and a minted SIF. Nothing waits on reconciliation or a human
   decision about the lost data.
6. **Month-end reconciliation via VeriFactu** (lifecycle §5.2): `consultar` recovers the *submitted*-but-
   lost records into the reporting view; the irreducible gap (un-submitted *and* un-replicated) is the
   customer's paper factura only. This belongs with the reporting/close subsystem, cross-referenced there —
   it is **not** a gate on going live.

---

## 6. The one-primary invariant during the transition (fencing interleave)

The danger is **two submitters under one NIF** racing the AEAT flow-control budget (#33 §6). The physical
fence of the *old* node is what prevents it, and software cannot verify across a partition. So:

- **A required human-attestation checkpoint.** The promote action **refuses to claim the singleton-role
  without an operator attestation** that the old node is physically neutralised — powered off, or demoted
  to sell-only at the box (lifecycle §3.5a). Membership eviction (a config edit) closes the *reachable*
  side automatically; the attestation closes the *partitioned* side the software cannot reach.
- **Sequencing rule:** fence (physical + membership) → *then* claim the submitter. Never the reverse.
- **Backstop if the attestation is wrong:** new-chain + disjoint series + AEAT `3000` dedup keep the
  fiscal side non-catastrophic (#33 §3). The worst case is a config divergence or a detectable, refundable
  double-bill (lifecycle §8.4), never a forked chain. The attestation is the primary guard; the fiscal
  invariants are the backstop.

Selling on both boxes is safe throughout — active-active never violates single-writer (#33 §3).

---

## 7. Failure, rollback, and the point-of-no-return

The sequence is ordered so **every reversible step precedes the point-of-no-return (PONR).** Auth → fence
attestation → key-ring unlock are all abortable with **zero lasting effect**: a failed promote here leaves
the node exactly as it was (still selling if a secondary, still read-only if a mirror). The **irreversible**
steps — mint the SIF, start the chain, flip the axes — come *after*, and only once (§5b step 3 is the PONR
for a mirror; for a local secondary the PONR is claiming the submitter, §5a step 3; for a cold restore it
is minting the fresh SIF, §5d step 3). The cold-restore path has no fence step (no old node runs), so its
only abort-before-PONR failures are a failed restore or a failed environment handshake.

- **Wrong break-glass / missing cert blob** → key-ring unlock fails → abort *before* claiming singletons (a
  node that cannot unseal the cert must never become the submitter).
- **No fence attestation** → refuse to claim the singleton-role; node unchanged.
- **Crash mid-sequence** → re-run converges (§3e).
- **No clean "un-promote"** once the chain starts — records are permanent. By design the PONR is late and
  explicit, so recovery is always "abort before PONR," never "undo a chain."
- **Mis-promotion / two primaries** → not fatal: #33 §8's continuous conflict-detection + tie-break
  resolves it on reconnect; the fiscal backstop (§6) holds meanwhile.

---

## 8. Testing (real Postgres — this touches roles, workers, and the read-only gate; `CLAUDE.md` §4)

- **A real-PG e2e per target.** *mirror→primary:* mode flips, read-only gate opens, SIF minted from the
  reserve, capture triggers fire on the first originating write, singleton workers start. *local
  secondary→primary:* the singleton-role flips and **the sale path stays responsive across the live flip**
  — the zero-downtime claim, proven by hitting a till route throughout, not asserted. *rejoin:* relinquishes
  singletons, **stays a replication source**, catches up as a mirror. *cold restore:* restore a backup +
  `sync_log`, pass the environment handshake, mint a fresh SIF, and **assert the node trades on the new
  chain even with the key ring absent** (filing withheld, selling not).
- **Proven by deletion** on the two guards: remove the fence-attestation gate → confirm two submitters
  become possible; remove the key-ring precondition → confirm a non-submitter can wrongly claim the role.
  Restore, confirm green (`CLAUDE.md` §4 — prove a guard by deletion).
- **Idempotency / crash-safety:** kill the promote at each checkpoint, re-run, assert convergence (one SIF,
  workers running once).
- **The read-only-gate hole** is openable *only* with the break-glass secret, never the ambient viewer.
- **The invalid combination** `(mirror, primary)` is rejected at the write boundary.

---

## 9. What stays open, and receipts owed

**Receipts owed before the implementation relies on them** (verify, don't assert — `CLAUDE.md` §1; each is
a real-PG check the plan must run):

1. **Capture triggers fire on a promoted mirror.** The migrations create them unconditionally, GUC-gated
   (§3d), so the plan need only confirm on a real mirror DB that the first *originating* write after a
   flip is captured into `sync_log` (and that a mirror's apply path still does not self-capture).
2. **The operational write-GET tables are provisioned on an ex-mirror** before the read-only gate lifts
   (§3f.2), or promotion must provision them — otherwise `claimPrintJobs`-style GET-writes break on the
   new primary.
3. **The pre-reserved SIF identity exists on a mirror** to be minted from at promote time (§3f.1) — where
   it is staged, and that a promotion consumes it without reaching the allocator.

**Deliberately left open** (handed to their owners, not re-decided here):

1. **Membership-list wire-protocol & re-admission format** (lifecycle §9.1) — this spec produces the
   inputs and the node-local sequence, not the format.
2. **Promoted-node-while-partitioned filing** (lifecycle §9.4).
3. **Cloud-relay-vs-sink** (lifecycle §9.3) — assumed sink; the convergence gap persists until a link
   heals.
4. **A dashboard promote surface.** CLI/API-first here; a friendly dashboard action waits on real
   per-user auth on the box (the C2b / hosting slice).
5. **Break-glass secret custody & rotation** — where it is stored, how it is rotated, and the key-ring
   rotation mechanics after a failback (§5c step 5) may want their own treatment.
6. **The continuous conflict-detection watcher** that auto-demotes a mis-promoted loser (#33 §8's
   always-on re-resolution). This spec lands the `singleton_role` field and the promote/relinquish
   transitions; the standing watcher is arguably its own slice.
7. **The backup regime the cold-restore path (§5d) stands on** — WAL archiving + periodic base backups to
   object storage (lifecycle §6.1), and the month-end `consultar` reconciliation (lifecycle §5.2). This
   spec *assumes* both and sequences the restore; **building and verify-restoring** the backup regime, and
   building the reconciliation, most likely belong with the provisioning and reporting/close subsystems,
   not this action. A single-box venue must not rely on §5d before the backup regime is proven restorable.

---

## 10. What this supersedes and interacts with

- **Extends** the lifecycle spec §9 item 2 — the promotion runbook it flagged as the next design pass.
- **Builds on** C2a's `deployment.mode` seam (the refreshable holder, the read-only gate, the ambient
  teardown) and closes what C2a §10/§11 deferred — the promote action and the worker start/stop.
- **Adds** the `deployment.singleton_role` column that #33 §8's `role` needs and `nodes.ts` deferred —
  on `deployment`, not `nodes`, per that file's own guidance.
- **Assembles**, for the cold-restore path (§5d), lifecycle §5.2 (`consultar` month-end reconciliation),
  §6.1 (the non-optional backup regime), §6.2 (restore-then-stream), and §7.4 (the cold-recovery tier)
  into a single-box recovery-to-primary runbook.
- **Depends on** sync's ownership map, idempotent apply, capture triggers, and environment handshake;
  #33's role model, new-chain-on-takeover, and key-ring-follows-the-primary; the C2b break-glass/mirror
  bundle for the promotion secret; and `packages/verifactu`'s `consultar` client via the cold-restore
  path's month-end reconciliation (§5d step 6), which most likely lives in the reporting/close subsystem,
  not this action.
- **`docs/backlog.md`** — the *SIF topology follow-ups* section was updated at land (2026-08-29) to record
  that the promotion runbook design is done and its implementation plan is next. **Does not touch**
  `docs/compliance/*`.

---

## 11. Out of scope

The membership/rejoin wire-protocol and list versioning (lifecycle §9.1); the promoted-node-while-
partitioned filing behaviour (lifecycle §9.4); the cloud-relay decision (lifecycle §9.3); a dashboard
promote UI; the double-bill remediation surface (#33 §10 — this spec only relies on it as the backstop,
does not build it); and the always-on conflict-detection watcher. This document decides **the promote
action and its runbook**; each open item in §9 gets its own resolution.
