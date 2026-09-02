# Membership & rejoin wire-protocol — design

**Status:** design (spec-only; no code in this cycle).
**Resolves:** [promotion-failover-and-node-lifecycle](2026-08-29-promotion-failover-and-node-lifecycle-design.md)
§9 **item 1** — "Membership & rejoin wire-protocol." That parent spec fixed the *policy* (human is the
consensus, physical fence + config-borne membership fence, witness is a latency optimisation only); this
spec fixes the *wire-protocol* underneath it.
**Owner-reviewed:** yes — it sets topology direction. Decisions below were taken with the owner on
2026-09-02.

---

## 1. Why this spec exists

The parent spec's §3.5 introduces a **membership fence**: promotion "edits the authoritative node list,
primary-owned config that flows down… reachable devices act on the newest list and stop routing new sales
to Server 1." §9 then records that "the list-propagation and rejoin *wire-protocol* is open." Today there
is **no such list at all**: node identity lives one-row-per-venue on `nodes`
([`packages/db/src/schema/nodes.ts`](../../../packages/db/src/schema/nodes.ts) — whose header deliberately
forbids a `role` column there), role lives on the `deployment` singleton
([`packages/db/src/schema/deployment.ts:27-41`](../../../packages/db/src/schema/deployment.ts) — `mode ∈
{primary,mirror}` × `singleton_role ∈ {primary,secondary}`, minus the forbidden `(mirror,primary)`), and
the peer *set* is `WAITRON_SYNC_PEERS` env on the puller plus the `sync_peers` auth table on the source
([`apps/server/src/config.ts:296`](../../../apps/server/src/config.ts),
[`packages/sync/drizzle/0005_sync_peers.sql`](../../../packages/sync/drizzle/0005_sync_peers.sql)). Nothing
records **who is currently in charge** in a way a returning or reachable node can trust.

This spec defines that record — a small, self-verifying **membership document** — plus how it is trusted,
distributed, and how a returned node rejoins around it.

## 2. Scope

**Topology this protocol targets (owner decision):** **at most three nodes** — two on-prem boxes in a
venue plus one optional cloud node. This is the spec's "Server 1 / Server 2 + cloud" framing and it lets
the design stay deliberately small: membership mostly reduces to *which one node holds the singletons* and
*who is still owed replication*. No general N-node membership algorithm, no quorum.

**In scope:** the membership document format (`term`, node identity keys, endorsement chain, signature);
the two-part acceptance test; self-verifying distribution over the existing `/sync-api/hello` handshake;
the demote-never-promote asymmetry that makes a witness safe (§3.3 of the parent); the **drain-then-restore**
rejoin sequence; setup/adopt trust-root establishment; the conflict-resolution **policy** for the
non-fiscal shared tables; and the `node_membership` storage singleton.

**Out of scope (deferred, named in §8):** the full promotion runbook (parent §9 item 2 — this spec supplies
the membership-edit primitive it *invokes*); break-glass secret mint (parent hard-gated — the option-B
hardening, unneeded here); till-side failover *tooling/UX* (parent §9 item 5); cloud relay-vs-sink (parent
§9 item 3); **interactive per-field conflict merge** (a follow-on — this spec fixes only the policy and the
detection surface); and the concrete signature primitive (Ed25519 via `node:crypto` is the intended choice,
an implementation detail for the plan).

## 3. The membership document

The heart of the protocol is one small document — the venue's current "org chart" — that any box or till
can verify **on its own**, without trusting whoever handed it over. That self-verifying property is what
lets it travel safely even over the semi-trusted cloud relay.

**Contents:**

- **`term`** — a monotonic counter, `0` at setup, incremented by **one on every authoritative membership
  edit** (promote, evict, re-admit, add a node). Higher `term` always wins. `term` counts membership
  *generations*, not only promotions — any edit that must supersede the prior document has to out-rank it,
  so any edit bumps it.
- **`nodes`** — at most three entries `{ nodeId, contactUrl, standing }`, where `standing ∈`
  - **`serving-primary`** — holds the singleton duties (AEAT submitter, payment reconciler, config owner);
  - **`serving-secondary`** — sells, holds no singletons;
  - **`sell-only`** — fenced out of serving but **still a replication source** until its tail drains;
  - **`evicted`** — drained and retired.
- **`signature`** — the whole document signed by the **current serving-primary's node identity key** (§4).
- **`endorsements`** (present only when a node's identity key is not yet in the receiver's trust set) — each
  a new member's public key signed by the serving-primary that admitted it; the chain back to setup (§4).

**Storage:** a new whole-DB singleton `node_membership` (`id = 1`; columns `term bigint`, `document` (the
signed blob), `updated_at`) — mirroring the `mirror_config` singleton pattern
([`packages/db/src/schema/mirror-config.ts`](../../../packages/db/src/schema/mirror-config.ts)): **no
`tenant_id`, no RLS**, because it is whole-DB operational state like `sync_cursor`/`sync_peers`, not
tenant data. The signature is over the **canonical whole document**, so it is stored and moved as one unit
— *not* a per-row synced table (a row-image would not carry a signature over the list).

## 4. Trust: node identity keys chained from setup

The authority mechanism is **forgery-resistant / signed** (owner decision), rooted by a **chain from
setup** (owner decision) — not by a human-held secret (that is the deferred option-B hardening, which
would pull in the hard-gated break-glass).

**Each node has one long-lived identity keypair, not a per-term key.** This is the refinement that makes
"chain from setup" concrete *and* avoids ever sharing a private key:

- **At setup / adopt**, members exchange their **public** keys over a trusted channel — the LAN pairing for
  a second local box, or the already-authenticated adopt bundle for the cloud
  ([`adoptFromPrimary`, `apps/server/src/adopt.ts:76`](../../../apps/server/src/adopt.ts), which already
  fetches a signed bundle from the primary; the endorsed key set rides in it). Each node stores the set of
  trusted member public keys. That mutual endorsement **is** the setup root.
- **The membership document is signed by the current serving-primary's own node key** — which every member
  already trusts from setup. So **a promotion needs no key ceremony**: the newly-promoted box issues the
  next document, signed by its own key, at a higher `term`; everyone already trusts that key. Crucially,
  this works even though the fenced ex-primary is unreachable — there was never a shared private key that
  needed handing over.
- **The endorsement chain is only for *adding* a member later** (a replacement box, or the cloud joining
  after initial setup): the serving-primary signs "I vouch for this new key," which chains back to the
  setup-trusted set. Trust set = setup-endorsed keys **+** primary-endorsed additions, each verifiable
  back to setup.

**The two-part acceptance test** a node/till applies to any document it receives:

1. **Authentic** — signature valid, and the signing key is in the receiver's trust set (directly, or via a
   verifiable `endorsements` chain back to setup).
2. **Newer** — `term` strictly greater than the held `term`. Equal-or-lower is ignored.

Only a document passing **both** replaces the held one.

**Coverage under this model, stated honestly.** It defends against exactly what the owner asked and no
more: the **cloud relay** and any **never-member** box hold no trusted key and cannot forge a document. The
**residual** is a *tampered ex-member* — a box that was legitimately a member, holds its own trusted key,
and is now running altered code; it could in principle sign a higher-`term` document. That box is precisely
the one the **physical fence** (parent §3.5(a): powered off, or demoted to sell-only at the box) removes
from the network. The two mechanisms compose: the membership fence closes the network/relay/outsider case
cryptographically; the physical fence closes the tampered-member case. Fully closing the tampered-member
case *in software* requires the human-rooted option-B secret and is deferred with break-glass.

## 5. Distribution: self-verifying gossip

Because the document is self-verifying, it needs **no trusted transport**. It piggybacks on the existing
peer handshake: `/sync-api/hello` today returns `{ nodeId, environment }`
([`apps/server/src/sync-api.ts:108-111`](../../../apps/server/src/sync-api.ts)); we add the current
membership document to that response. Any node — including the cloud — can re-serve whatever document it
holds, and the receiver's acceptance test (§4) decides whether to adopt it. No new authenticated channel is
introduced.

**Witness safety (parent §3.3), as a one-way rule.** A signed document proves **authenticity**, never
**freshness**: the cloud can hand you a validly-signed but *stale* `term` because it never learned of a
promotion (Server 2 could not reach it). So every received document is treated as able to **strip authority
but never grant it**:

> A newer signed document can **demote or evict** the receiver. It can **never** promote the receiver or
> authorise it to claim the singletons.

Giving up power cannot cause a split-brain, so acting on a witness's document to *demote* is always safe;
*claiming* power stays behind the human physical fence
([`FenceAttestation` / `assertFenced`, `apps/server/src/promote.ts:12-39`](../../../apps/server/src/promote.ts)).
That asymmetry is the whole reason a witness is a safe latency optimisation rather than the stale-answer
trap of §3.3: the wire-protocol only ever needs to authenticate **demotions and evictions**; promotions
are authorised out-of-band by the human at the box. The membership document therefore *supersedes* the
node's own persisted role — consistent with parent §3.1 ("a stale 'I am primary' stamp is not
self-authorising"): on boot a node re-resolves its axes
([`readDeploymentAxes`, `packages/db/src/deployment.ts`](../../../packages/db/src/deployment.ts)) **and**
adopts the newest membership document it can reach before it acts.

## 6. Rejoin: a returned node is a re-add, not a fast-forward

**Scenario.** Server 1 was serving-primary at `term N`. A partition; the operator promotes Server 2 to
`term N+1` and fences Server 1. Server 1 returns.

A returned ex-primary's database has **diverged**, not merely fallen behind: it holds its own committed rows
Server 2 never saw, and it is missing everything Server 2 wrote since. You cannot fast-forward a diverged
copy. The fiscal twist makes it sharper — those un-replicated rows are immutable `registros` on Server 1's
own hash chain (CLAUDE.md §5), so they can be neither surgically rolled back nor *lost* (parent §4/§5). The
sequence is therefore **drain-first, then rebuild**:

1. **Boot & re-resolve.** Server 1 never trusts its own saved `role`; it re-resolves axes and looks for a
   newer membership document (§5).
2. **Learn superseded.** The first node or cloud it reaches hands it a document with higher `term` naming a
   different serving-primary and marking Server 1 `sell-only`/`evicted`. The acceptance test passes → it
   accepts and **relinquishes the singletons** (`setSingletonRole('secondary')`), and never files or
   config-writes while superseded.
3. **Drain the tail first (mandatory, before anything overwrites the local DB).** Server 1's un-replicated
   rows still sit in its own `sync_log` outbox. It rejoins the topology first as a **replication source**:
   the current primary pulls `originId = Server 1, after = <its cursor>`
   ([`readSyncLogSince` / `runSyncPull`, `packages/sync/src`](../../../packages/sync/src)) until Server 1's
   tail is **fully** drained onto a survivor. Completion is the parent §5.1 **disposal guard** — the
   node's replication cursor versus its own latest `sync_log.seq`. Those rows land on Server 2 as
   **Server 1-origin** rows (Server 1's chain, its SIF, disjoint series — capture stamps `origin_id` from
   `app.node_id`, [`0000_sync_outbox.sql:138-140`](../../../packages/sync/drizzle/0000_sync_outbox.sql));
   they never merge into Server 2's chain, they are simply now durably held there (parent §5.1
   convergence).
4. **Then rebuild from the primary's baseline.** Once the tail is fully drained, Server 1 **discards its
   diverged database and restores the current primary's baseline, then streams** — the restore-then-stream
   path the parent §6.2 already defines for adding a node. It does **not** reconcile in place. Because
   step 3 already shipped Server 1's own records up to Server 2, they come **back down** inside the restored
   baseline (as Server 1-origin rows) — nothing is lost by the wipe.

The gate between 3 and 4 is strict: **drain to completion, *then* wipe-and-restore** — a wipe before the
tail is safe would destroy exactly the records parent §5 exists to protect. An in-place delta-pull is valid
*only* in the provably-clean case (the node was stopped with everything already replicated); given the
fiscal stakes the sound default is to **always** drain-then-restore.

## 7. Conflict resolution for the non-fiscal shared tables

Drain-then-restore is clash-free for two of the three table classes, and the third needs a policy.

1. **Fiscal (`registros`, chains)** — safe by construction. Disjoint SIF/chains and disjoint series; a
   drain is pure insert, never a clash (CLAUDE.md §5).
2. **Commercial / dining (sales, orders, tabs, tables)** — safe by the design's **single-writer-per-row**
   discipline (per-tab ownership assigned at open time, parent §8). Server 1's rows and Server 2's rows
   have different owners/PKs and do not collide. This is why the codebase builds every feature
   single-writer-per-row.
3. **Shared / primary-owned config (catalogue, menu, prices, floor plan)** — the **genuine conflict
   class**, already named in parent §3.2 ("the only genuinely conflicting shared state is config —
   versioned, merge-resolvable"). Both sides *can* legitimately write the same config row.

The conflict window for class 3 is **bounded and specific**: the **partitioned-not-dead window** (parent
§3.5) — the interval where Server 1 wrongly still believed it was primary and let a manager edit config
*after* Server 2 was promoted but *before* the physical/membership fence reached it. Concretely: during the
outage a manager re-prices a dish on the isolated box, not knowing it has been superseded.

**Policy (owner decision): primary-wins + a conflict surface — not last-writer-wins.** It falls out of a
rule the design already implies rather than adding new machinery:

- **Config-class rows only ever flow *down* from the serving-primary; a secondary's config writes are never
  accepted upward.** A properly-fenced sell-only node already writes no config (parent §3.5: "stops all
  singleton work — no config writes"); the split-window edits are the escapes from that discipline. On
  rejoin, the current primary does **not** accept Server 1's config rows (they are not from the config
  owner), and Server 1 adopts the primary's config wholesale in the restore (§6 step 4). This is
  **primary-authoritative**, chosen over last-writer-wins because a stale isolated-box edit could otherwise
  silently clobber the real primary.
- **Nothing is lost silently.** The rejected/superseded config writes are logged to an **ops conflict
  surface** — "these changes made on the isolated box during the outage were overridden; review them." This
  is the "versioned" half of parent §3.2's "versioned, merge-resolvable," and it is the seam the deferred
  interactive-merge tooling attaches to.

**Interactive per-field merge is deferred** (a follow-on design pass): detect-and-surface + primary-wins is
the sound first cut for a pre-production system with a human in the loop.

Enforcement note: the guard that *prevents* config writes on a non-primary is the singleton gating that
already exists (parent §3.5; the per-pass `singletonPass` / the `isSingletonPrimary` boot gate). The
conflict surface handles only what escapes that guard inside the fence window.

## 8. Interaction with existing infrastructure

- **`WAITRON_SYNC_PEERS` env vs. the signed document** — clean separation, **no migration** (pre-production,
  CLAUDE.md §3). The **env** stays *bootstrap contact* plus the **count** of *configured* peers that parent
  §3.4 keys off (zero configured → self-assume primary; configured-but-unreachable → withhold singletons);
  it is static. The **signed document** carries *current standing* (who serves, who is primary, who is
  evicted); it is dynamic and layered on top. The two never conflict: env says "these boxes exist and here
  is how to reach them," the document says "and here is who is currently in charge."
- **`deployment` axes** — the document is authority *above* the persisted axes: a node adopts the newest
  document (§5) and reconciles its `mode`/`singleton_role` to match (demotions only, §5). The `deployment`
  singleton and its CHECKs are unchanged.
- **`promote` / `FenceAttestation`** — promotion becomes the caller that *mints the next document* (bump
  `term`, set standings, sign with the promoting node's key) after `assertFenced`. This spec supplies that
  primitive; the ordered runbook around it (claim singletons, reverse streams, resize, bring up cloud HA)
  is parent §9 item 2.
- **`adopt` / cloud-mirror** — adopting the cloud (or a replacement box) is where a new identity key is
  endorsed into the trust set (§4); the endorsed key set rides in the existing adopt bundle.
- **The sync registry / lanes** — `node_membership` is **not** enrolled as a synced table (§3); it moves
  via the `/hello` handshake, so the `ENROLLED` registry and its lanes
  ([`packages/sync/src/registry.ts`](../../../packages/sync/src/registry.ts)) are untouched by this spec.

## 9. What this decides, and what stays open

**Decided here:** the membership document (`term` + node identity keys + endorsement chain + signature);
the two-part acceptance test; self-verifying distribution via `/hello`; the demote-never-promote asymmetry
(witness safety); the drain-then-restore rejoin sequence gated on the disposal guard; the primary-wins +
conflict-surface policy for shared config; the `node_membership` singleton; and the env-vs-document split.

**Still open (each its own later resolution):**

1. **Promotion runbook (parent §9 item 2)** — the ordered sequence that *invokes* the membership-edit
   primitive this spec defines.
2. **Interactive conflict merge** — the UX over the conflict surface of §7; primary-wins ships first.
3. **Break-glass / option-B hardening** — the human-rooted trust that would close the tampered-ex-member
   residual of §4 in software; deferred with break-glass (parent hard-gated).
4. **Till-side membership behaviour detail (parent §9 item 5)** — a till *runs* the §4 acceptance test to
   stop routing to an evicted node, but the till failover UX (auto-return vs. manual, adopt vs.
   continuation) is item 5.
5. **Cloud relay vs. sink (parent §9 item 3)** — orthogonal; the signed document travels safely over a
   relay if one is built, but does not require it.

## 10. What this supersedes and interacts with

- **Resolves** [promotion-failover-and-node-lifecycle](2026-08-29-promotion-failover-and-node-lifecycle-design.md)
  §9 **item 1**, and gives §3.5's "membership fence" its concrete wire-protocol. Leaves parent §9 items
  2–7 as written; a dated pointer should be added to parent §9 item 1 at land noting this spec resolves it.
- **Depends on** the parent's role model, boot resolution, disposal guard (§5.1), restore-then-stream
  (§6.2), and per-tab ownership (§8); the sync layer's capture/apply, environment handshake, and pull
  transport; and the adopt bundle for key endorsement.
- **Does not touch** `docs/compliance/*`. **Backlog:** the *Track 2 → SIF topology / Sync* start-here menu
  should be updated at land to mark §9 item 1 resolved and point here.

## 11. Out of scope

The sync channel's own versioning/wire-format (sync spec); the counter/till failover UX; any N>3 topology;
managed-cluster machinery (no Raft/Paxos/etcd — the human is the consensus, parent §3.2); and the concrete
cryptographic primitive and key-storage vault mechanics (implementation detail — Ed25519 via `node:crypto`,
private key vault-sealed the way [`mirror-token.ts`](../../../apps/server/src/mirror-token.ts) seals the
sync token).
