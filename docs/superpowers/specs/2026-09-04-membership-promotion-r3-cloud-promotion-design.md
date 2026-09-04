# Membership Promotion R3 — cloud/mirror promotion (own identity from join)

**Status:** design. **Owner-reviewed:** yes — the central decisions below were taken with the owner
on 2026-09-04, in the session that landed R2 (#208).

**Refines** [reserved-standby-identity-and-promotion](2026-09-03-reserved-standby-identity-and-promotion-design.md)
**§6 R3**. That spec scoped R3 as "switch the runtime node id + split the sync axes **at promotion**,"
deliberately deferring the split so R2 could ship inert. This doc **moves the sync-axis split earlier —
to join (adopt)** — on the owner's call that *a node should have its own identity from the moment it
joins the cluster, and the cloud should never use the primary's node id.* The arc spec's §6 R3 text is
left as written (history); this refinement supersedes its "switch at promotion" boundary.

The move is cheap and safe because **the sync protocol is already axis-split**: the cursor key is
`(subscriber, origin, lane)` ([`packages/sync/src/apply.ts`](../../../packages/sync/src/apply.ts)), the
apply path preserves each row's own `originId` and already handles multiple origins per batch, and the
pull just fetches the peer's whole log past the cursor
([`packages/sync/src/pull.ts`](../../../packages/sync/src/pull.ts)). Nothing filters `origin ==
subscriber`. Today's shared identity is forced by only three wiring facts, all in one direction, listed
in §3.

---

## 1. Why this refinement

After R2 the cloud has its **own** nodeId, but only as a **dormant** identity (its own `nodes` row,
reserved `registro_sif`, reserved `invoice_series`, sealed `membership.node_key`). The **running
process still uses the primary's nodeId**: `config.till.nodeId = designated.nodeId` (the primary's),
and the sync peer token is enrolled with the primary's id as subscriber
([`enrolPeer(subscriberId: deps.designated.nodeId)`](../../../apps/server/src/mirror-bundle.ts)). So the
mirror **impersonates the primary** for sync, and its own identity is inert until promotion.

The owner's decision: eliminate the impersonation. The cloud runs as **its own node from adopt** — it
just does not *sell* yet (it stays `mode = mirror`, read-only). Promotion then becomes a mode/role flip
with **no identity switch**, because the identity is already the cloud's own.

## 2. Decomposition: R3a (split identity at join) → R3b (promotion)

Two slices, each its own plan off this doc; R3b depends on R3a.

## 3. R3a — the cloud runs as its own node from adopt

**Goal:** `config.till.nodeId` is the cloud's **own** reserved nodeId from the moment it adopts; the
mirror pulls the primary's log under `(subscriber = cloud, origin = primary)`; the cloud never uses the
primary's id for anything. Mode stays `mirror` — still read-only, still not selling.

**The distinct concepts (spec §9's "own identity vs. mirrored origin"):**
- **own identity** = the cloud's own nodeId → the sync **subscriber** id, and (after R3b) the
  selling/chain id. Lives in `config.till.nodeId`.
- **mirrored origin** = the primary's nodeId → the pull **peer/origin** whose rows the mirror applies.
  It is *not* per-config today (boot derives it from `config.till.nodeId`); R3a gives it its own home.

**The four cuts (this is the whole slice):**

1. **`mirror_config` gains `origin_node_id`** — the primary's nodeId, the node whose rows this mirror
   applies. `mirror_config` is a whole-DB singleton from the hand-written custom migration
   `0072_mirror_config.sql` (kept out of the schema barrel,
   [`schema/mirror-config.ts`](../../../packages/db/src/schema/mirror-config.ts)), so this is a **new
   hand-written custom migration** (`ALTER TABLE mirror_config ADD COLUMN origin_node_id uuid NOT
   NULL`), plus the field on `MirrorConnection` +
   [`writeMirrorConfig`/`readMirrorConfig`](../../../packages/db/src/mirror-config.ts). (Pre-production:
   no existing mirror to backfill; NOT NULL is free.)

2. **`assembleMirrorBundle` (primary) enrols the peer token for the cloud's OWN id.**
   `enrolPeer(retentionDb, { subscriberId: deps.standby.nodeId, name: "cloud mirror" })` — R2 already
   threads `standby.nodeId` into the assemble. The source then resolves the mirror's Bearer token to a
   `sync_peers` identity that is the cloud's own id.

3. **`adoptFromPrimary` (mirror) persists the two ids to their two homes.** `persistTrading` writes
   `nodeId: standby.nodeId` (the cloud's **own**, not `designated.nodeId`); `writeMirrorConfig` writes
   `originNodeId: designated.nodeId` (the **primary's**). `seriesId` may stay `designated.seriesId`
   (inert on a mirror) and is corrected to the cloud's own reserved standard series at R3b — a plan
   detail, not a decision.

4. **`boot.ts` derives the two ids from their two homes, and the shared-identity assumption is
   retired.** `subscriberId` stays `config.till.nodeId` (now the cloud's own, no code change — its
   *value* changed); `mirrorPeer.nodeId` becomes `mirror_config.origin_node_id` (the primary's) instead
   of `config.till.nodeId` ([boot.ts:1099](../../../apps/server/src/boot.ts)). The comment block
   asserting "the subscriber and the origin it pulls are the same adopted node"
   ([boot.ts:1073-1078](../../../apps/server/src/boot.ts)) is rewritten to describe the split.

**Nothing else moves.** The mirror still applies the primary's rows verbatim (each keeps `origin =
primary`), the cursor is `(subscriber = cloud, origin = primary, lane)` — already supported — and the
read-only serving path resolves data by tenant, never by `config.till.nodeId`. The cloud's reserved
`nodes`/`registro_sif`/`invoice_series` rows (R2) key to the id that `config.till.nodeId` now holds, so
every by-id resolution is satisfied.

## 4. R3b — promotion (restart-into-primary), trivial on identity

**Goal:** turn the cloud from a read-only mirror into the venue's primary, on the identity it already
has. An operator action, gated by a `FenceAttestation` that the old primary is neutralised — the same
gate [`promoteLocalSecondaryToPrimary`](../../../apps/server/src/promote.ts) uses (software cannot
verify a partitioned peer, parent spec §8).

The current promote path **refuses a mirror** (`promotion.not_a_local_secondary`,
[promote.ts:93](../../../apps/server/src/promote.ts)) precisely because a mirror could not become the
submitter by a bare role flip. R3b is that missing mirror path (parent SIF spec §5b), and — thanks to
R3a — it needs no identity ceremony:

1. **Build the promotion document BEFORE the point-of-no-return** (abortable): read the held org chart,
   `nextStandings(this node → serving-primary, outgoing primary → sell-only)`, sign with the cloud's
   **own** key (R2 sealed `membership.node_key` for it), attaching `endorsements:
   [readNodeEndorsement(cloudNodeId)]` — the primary's endorsement of the cloud's key (R2 stored it on
   `nodes.endorsement`), so a peer that trusts only the primary transitively trusts this document
   (parent wire-protocol §4). This is the first production document signed by a **non-setup** key.
2. **Point-of-no-return — ONE owner transaction:** `deployment.mode → primary`, `singleton_role →
   primary`, and **write the document term-guarded**. R1's local promote used the *unguarded*
   `writeNodeMembershipTx`; R3 is multi-node, so a promote that read held term N could race a
   gossip-adopt landing N+k and regress it — R3b writes via the **term-guarded**
   `persistNodeMembershipIfNewer` (or an advisory lock), the parent spec §8 **R3 sharp edge**. (This is
   the one place R3b's mint differs from R1's.)
3. **Persist + restart.** Point `config.till.seriesId` at the cloud's own reserved standard series,
   persist `trading.env`, restart — the same persist-then-restart transition `provision`/`adopt` use.
   The mirror is not selling, so a brief restart costs nothing (contrast the *local secondary*, which
   promotes live because it is already an active seller — parent SIF spec §5a).

**On reboot** the box comes up `mode = primary` on the identity it already had:
`currentSif(config.till.nodeId)` returns the reserved SIF — now the **live selling SIF** — the source
group + primary-only workers (submitter, reconciler, config-writer) start, and the pull subscriber does
not run (the old primary is dead; there is nothing to pull). No identity switch, because R3a already
made the cloud its own node.

## 5. Fiscal invariants preserved (receipts)

- **New chain on takeover, never resume the dead one's.** The cloud sells under its own nodeId on the
  reserved SIF's fresh both-null `cadenas` head (R2) — a distinct chain from the primary's (parent SIF
  spec §3). R3 activates it; it never touches the primary's chain.
- **NºInstalación never reused / series isolation.** Unchanged from R2 — the number and disjoint series
  were reserved at adopt from the primary's single-writer counter; R3 only *uses* them.
- **`registros_facturacion` immutability** untouched — R3a writes `mirror_config`/`trading.env` only;
  R3b writes `deployment` + `node_membership` + `trading.env`. Neither writes a fiscal record.
- **At most one primary per NIF.** The `FenceAttestation` gate (§4) plus the demote-never-promote
  membership witness (parent wire-protocol) keep the promoted cloud from coexisting with a live primary.

## 6. Deferrals (named, not gated)

- **Till-side reroute — out of scope** (parent spec §2, wire-protocol §9 item 4). R3 makes the cloud a
  *capable* primary — own live SIF, submitter, config-writer, its own membership standing — not a
  *sold-against* one. How tills discover and sell against a promoted cloud (the stable local origin /
  failover list) is its own slice.
- **H2 (fiscal-record sync to mirrors) — independent** (parent spec §6 H2). A promoted cloud starts a
  *fresh* chain and never resumes the dead primary's, so it needs none of the primary's historical
  `registros` to promote — consistent with the cold-recovery posture (destruction ⇒ data loss
  accepted, month-end AEAT `consultar` reconciles). H2 is sequenced after R3, its own owner-reviewed
  plan.
- **The promoted cloud's reachability** (does it keep the tunnel, or serve tills directly) rides the
  till-reroute slice.

## 7. Interactions

- **`config.ts`'s "no second `WAITRON_SYNC_NODE_ID`" decision**
  ([config.ts:298](../../../apps/server/src/config.ts)) is honoured, not broken: R3a does not add a
  second *spelling of one id*. It separates **two genuinely distinct concepts** — the node's own
  identity (`config.till.nodeId`) and the origin it mirrors (`mirror_config.origin_node_id`) — exactly
  the distinction parent spec §9 said the revisit would make.
- **`deployment` / `promote` / `FenceAttestation`** — R3b is the second caller of the promotion
  primitive family (R1 wired the local path); it reuses the fence gate and the one-owner-transaction
  point-of-no-return, differing only in the term-guarded write and the endorsed signature.
- **R2's landed tests** — R3a changes the enrolment subscriber id and the persisted node id, so the R2
  adopt / mirror-bundle / adopt-e2e suites that assert those values are updated by R3a (behaviour
  change, not regression).

## 8. What this decides, and what stays open

**Decided:** own-identity-from-join (§3); `mirror_config.origin_node_id` as the mirrored-origin home
(§3.1); enrol the peer token for the cloud's own id (§3.2); restart-into-primary promotion (§4);
term-guarded endorsed document mint at R3b (§4.2); till-reroute + H2 deferred, not gated (§6); slice
order R3a → R3b.

**Open (each its own later resolution):** the till-side reroute (§6); the promoted cloud's reachability
model; H2's wire detail; and whether R3b's promote is triggered by the same operator surface as the
local promote or its own (a plan detail — follow the existing promote trigger).
