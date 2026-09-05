# Reserved standby identity & membership promotion — design

**Status:** design. **Owner-reviewed:** yes — decisions below were taken with the owner on 2026-09-03,
in the session that started membership Slice 5.

**Implements / extends:**
[membership-and-rejoin-wire-protocol](2026-09-02-membership-and-rejoin-wire-protocol-design.md) — its
**§8** ("promotion becomes the caller that mints the next document") and **§4** (the endorsement chain,
built but never yet called in production). It also carries the wire-protocol's promotion primitive into
the fiscal layer defined by
[local-server-sif-and-failover](2026-08-01-local-server-sif-and-failover-design.md) **§8** ("pre-allocate
the standby's identity").

**Supersedes a scheduling posture, not a fiscal one.** The backlog parked the failover/membership stack
behind "owner-gated / fiscal-adjacent / never landed unattended" labels. Owner directive, 2026-09-03:
*stop deferring work merely because it touches fiscal code — build the whole system.* Correctness on the
unrecoverable invariants (append-only records, never-reused numbers, disjoint chains — the parent SIF
spec §12 and CLAUDE.md §5) and owner review of the actual PRs are unchanged; only the *scheduling* gate
is lifted. So **H2 (fiscal-record sync to mirrors)** moves from "deferred indefinitely" into the build
sequence here (§7).

---

## 1. Why this spec exists

Three facts about the tree today make promotion impossible to complete, and this spec closes all three:

1. **No membership document is ever minted locally.** `writeNodeMembership`
   ([`packages/db/src/node-membership.ts:48`](../../../packages/db/src/node-membership.ts)) has **zero
   production callers**: documents only ever enter by gossip adoption
   (`persistNodeMembershipIfNewer`, called from
   [`apps/server/src/membership-adopt.ts:53`](../../../apps/server/src/membership-adopt.ts)). So a
   freshly-provisioned primary boots with a trust set but **no org chart** — `readNodeMembership`
   returns `null` — and there is nothing for a promotion to "bump." Membership Slice 4 deliberately
   deferred all private-key *signing* to Slice 5, so `readNodeIdentityKey`
   ([`apps/server/src/node-identity.ts:52`](../../../apps/server/src/node-identity.ts)) sits ready as
   "the Slice-5 signer's entry point" with nothing calling it.

2. **The cloud mirror runs *as* the primary's nodeId.** At adopt, `nodeId: designated.nodeId` (the
   primary's) is persisted as this box's own identity
   ([`apps/server/src/adopt.ts:96`](../../../apps/server/src/adopt.ts)), and `config.till.nodeId` is the
   single runtime node id everywhere. That is a passive-read-mirror **shortcut**: the mirror re-applies
   the primary's rows, whose FKs name the primary's nodeId, so sharing the id makes them resolve with no
   bundle rewriting. It breaks the instant you want to *promote* the cloud — a promoted node must issue
   under its **own distinct** SIF, never resume the dead one's chain (parent SIF spec §3).

3. **A promoted node needs a fresh SIF, and the allocator is unreachable at promotion.** A promotion
   mints a new installation number from the counter `contadores_instalacion`
   ([`packages/fiscal-verifactu/src/schema/sif.ts:78`](../../../packages/fiscal-verifactu/src/schema/sif.ts)),
   which is *"exactly one writer per NIF."* At a real promotion the primary — the natural single writer —
   is dead, and a cloud node is only reachable when the internet is up anyway. So the identity has to be
   **reserved ahead of time, while the link is up** (parent SIF spec §8).

The unifying move — the owner decision this spec is built on — is to establish the standby's **entire
dormant identity at the moment it joins**, the earliest guaranteed-connected checkpoint, and have
promotion merely *activate* it.

## 2. Scope

**In scope:** the membership-document lifecycle (seed at setup, mint at promotion); the dormant-identity
model (own nodeId + membership keypair + reserved installation number + disjoint series, established at
adopt, inert until promotion); the primary-as-sole-allocator decision; the sync-axis split that lets a
mirror keep a stable identity while re-pointing which origin it pulls; and H2's sequence position.

**Out of scope (named, not gated):** the second-*local*-box enrolment flow (LAN pairing) — the concrete
join path this spec wires is the **cloud adopt** path, which is built; the local secondary already sells
under its own live SIF and needs no reservation (§5). The till-side failover UX (parent wire-protocol §9
item 4). Interactive conflict merge (wire-protocol §7). Break-glass / option-B hardening (unchanged).

## 3. The model: a dormant standby identity, established at join

A standby is handed, at adopt, a complete-but-inert identity across three layers, all activated together
on promotion:

- **Identity/sync:** its **own** `nodes` row (a distinct uuid, its own `public_key`), stable for life —
  it never changes when a peer is promoted. Separately, the node tracks **which origin it currently
  mirrors** (the primary today; a promoted peer tomorrow). These are two axes that today are conflated
  into one id (§4).
- **Membership:** its **own** Ed25519 keypair — private half generated *on the standby* and sealed
  locally (it never travels), public half **endorsed by the primary** (`endorseKey`,
  [`packages/membership/src/endorsement.ts:18`](../../../packages/membership/src/endorsement.ts)) so
  every member's trust set accepts a document the standby later signs (parent wire-protocol §4).
- **Fiscal:** its **own reserved SIF** — an installation number the **primary** allocates from
  `contadores_instalacion` and hands down, materialised as a `registro_sif` row keyed to the standby's
  own nodeId, plus its **own disjoint invoice series** (parent SIF spec §3's "series isolation is a real
  trap").

**Dormancy needs no new schema.** A SIF is "live" to a sale through exactly one gate: `currentSif`
resolves `registro_sif WHERE revocado_en IS NULL` for the **`(tenant, node)`** being sold on
([`packages/fiscal-verifactu/src/registro-sif.ts:180`](../../../packages/fiscal-verifactu/src/registro-sif.ts),
[`backend.ts`](../../../packages/fiscal-verifactu/src/backend.ts)). A reserved SIF keyed to the standby's
own nodeId — which **no sale touches until promotion** — is therefore inert for free. No "reserved"
status column; dormancy falls out of the node-keying.

## 4. Decision: the primary is the sole installation-number allocator

`contadores_instalacion` is *"exactly one writer per NIF"* — two servers minting numbers would collide
(parent SIF spec §4; the schema comment at
[`sif.ts:64-77`](../../../packages/fiscal-verifactu/src/schema/sif.ts) explains why an RLS predicate or a
`max()+1` derivation is unsafe). The standby's DB is a *copy*; if it allocated its own number it could
hand out a number the primary later reuses. So **the primary allocates the standby's reserved number and
hands it down in the adopt bundle; the standby never writes `contadores_instalacion`.** The global
never-reuse guarantee rests on one writer per NIF, and that writer is the primary.

**Rejected: a separate cloud allocator service.** The parent SIF spec names an eventual cloud allocator,
but it is not built, does not remove the need to pre-reserve (a promoting cloud cannot depend on a
service that might share the dead primary's fate), and adds a component. The primary-as-writer model is
sufficient for the ≤3-node topology this spec targets.

**Why the bundle, not sync.** Fiscal tables are *not* replicated: the sync registry is explicitly *"the
tenant-scoped, non-fiscal tables"*
([`packages/sync/src/registry.ts:1`](../../../packages/sync/src/registry.ts)) — `registros_facturacion`,
`cadenas`, `registro_sif` are enrolled in no lane — and adopt *deliberately never `registerSif`s*
([`packages/provisioning/src/venue-adopt.ts:139`](../../../packages/provisioning/src/venue-adopt.ts)).
The reserved identity is a one-time establishment at the join handshake, so it rides the adopt bundle.
(The primary's *historical* records reaching the mirror is a different problem — H2, §7.)

(2026-09-05: SP-3a enrols the six fiscal tables on the ordered lane; this "not replicated" statement is
superseded — see [`2026-09-05-module-sp3a-fiscal-record-lane-design.md`](2026-09-05-module-sp3a-fiscal-record-lane-design.md).)

## 5. The three promotion paths, and what each needs

| Path | Has its own live SIF already? | Needs reservation? | Status |
| --- | --- | --- | --- |
| **Local secondary → primary** | **Yes** — it sells active-active on its own chain/series | No | Primitive built (#160, `promoteLocalSecondaryToPrimary`); this spec adds the membership-document mint (R1) |
| **Cloud/mirror → primary** | No — passive read-mirror, holds no SIF | **Yes** — reserved at adopt (§3) | This spec, R2 + R3 |
| **Second local box → primary** | Yes (active-active) — needs only its membership identity at pairing | No SIF reservation; endorsement at pairing | Out of scope (no local-box enrolment flow yet) |

The asymmetry the owner flagged — *why does the cloud share the primary's id but the local secondary
doesn't?* — resolves here: the local secondary is an **active seller** (own SIF ⇒ own id from birth); the
cloud is a **passive replica** (the shortcut of §1.2). Giving the cloud its own stable id (§3/§4) removes
the asymmetry and makes it promotable.

## 6. Slice decomposition

Each slice is its own implementation plan off this spec; dependencies are strict.

### R1 — Document lifecycle + local-secondary promotion *(no cloud, no reserved-SIF; buildable now)*

Closes §1.1. Three pieces:

1. **Seed the term-0 document at setup.** In the provision handler, after `establishNodeIdentity` stamps
   the primary's key, mint and persist
   `body = { term: 0, nodes: [{ nodeId: primary, contactUrl, standing: "serving-primary" }] }`, signed
   with the primary's own key (`signDocumentBody` +
   [`readNodeIdentityKey`](../../../apps/server/src/node-identity.ts)), no endorsements (self-trusted),
   via `writeNodeMembership`. First production signing. Safe once — provision only mounts on an
   unprovisioned box.
2. **`mintNextMembershipDocument` primitive** (server layer — needs signer key + storage). One helper
   serves seeding and promotion: read the held term (`null → −1`), `newTerm = held + 1`, build the body
   from a caller-supplied node list, sign with *this* node's key, persist. Splits into a **pure
   build-and-sign** step (key + held doc → signed document) and a **persist** step.
3. **Wire `promoteLocalSecondaryToPrimary`.** After the singleton-role flip, mint the next document from
   the held org chart: flip **this** node to `serving-primary` and the outgoing primary to `sell-only`
   (parent wire-protocol §6 — still a replication source until drained), re-signed with this node's
   already-trusted key (no endorsement — parent §4 "a promotion needs no key ceremony").

**Two design decisions (follow from the code + spec, not open):**
- **The singleton flip and the document write commit in ONE owner transaction.** Both are owner-role
  writes with no non-DB step between (the key read + held-doc read + in-memory sign happen *before*),
  so per CLAUDE.md §3 they go together — closing the partial-failure gap where a crash between
  `setSingletonRole` and the mint would leave a primary with no document. Both already run on `ownerDb`.
- **Outgoing primary → `sell-only`, not `evicted`** — drain-then-restore needs it to remain a
  replication source (parent wire-protocol §6).

*Detail pinned in the R1 plan, not here:* the primary's own `contactUrl` source (its advertised sync URL
vs. empty for a single-node term-0).

### R2 — Reserve the cloud's dormant identity at adopt *(depends on R1)*

The "reserved SIF at join." The adopt handshake gains a small round-trip: the cloud generates its keypair
(private sealed locally), sends its **public key + its own nodeId** to the primary; the primary allocates
the installation number (single-writer, §4) + computes the disjoint series + **endorses** the cloud's key;
the bundle returns the number, series, and endorsement. The cloud persists a dormant `nodes` row + a
reserved `registro_sif` (using the primary-supplied number, **not** re-allocating) + reserved
`invoice_series` rows + the sealed private key + the endorsement — **all inert; `config.till.nodeId` is
unchanged, so the read-mirror keeps running exactly as today.** This isolates the sync-axis ripple into
R3.

### R3 — Cloud/mirror promotion *(depends on R1 + R2; overlaps promote-action Slice 3)*

> **Refined 2026-09-04** by
> [membership-promotion-r3-cloud-promotion](2026-09-04-membership-promotion-r3-cloud-promotion-design.md):
> on the owner's call, the sync-axis split moves **from promotion to JOIN** (R3a) — the cloud runs as
> its own node from adopt and never uses the primary's id — so promotion (R3b) becomes a mode/role flip
> with no identity switch. That doc supersedes the "switch at promotion" boundary in the paragraph
> below; the rest (endorsed term-guarded document, primary-only workers) stands.

Activation. Promotion switches the runtime node id to the cloud's own, **splits the sync axes**
(subscriber = the cloud's own stable id; origin = the primary it was mirroring — the invariant
"subscriber id == pulled origin id == the one adopted node",
[`apps/server/src/boot.ts:1073`](../../../apps/server/src/boot.ts), is retired here and only here),
activates the SIF (a sale now resolves `currentSif` for the cloud's node), mints the next membership
document signed with the cloud's own endorsed key, and starts the primary-only workers.

### H2 — Fiscal-record sync to mirrors *(independent; now sequenced, not gated)*

The primary's `registros`/`cadenas` reaching the mirror so it is a **complete** backup and can drain a
tail before wipe (parent wire-protocol §6, the disposal guard). **Not a prerequisite for R2/R3** — a
promoted cloud starts a *fresh* chain (parent SIF spec §3), consistent with the cold-recovery posture
(destruction ⇒ data loss accepted, month-end AEAT `consultar` reconciles). Sequenced after R3; its own
owner-reviewed plan, honouring the immutability triggers on the subscriber side (CLAUDE.md §5).

## 7. Fiscal invariants preserved (receipts)

- **`NºInstalación` never reused.** The primary is the sole `contadores_instalacion` writer per NIF (§4);
  the `registro_sif_instalacion_uq` unique on `(nif, id_sistema_informatico, numero_instalacion)`
  ([`sif.ts:50`](../../../packages/fiscal-verifactu/src/schema/sif.ts)) is the backstop, enforced across
  tenants even under FORCE RLS. A reserved-but-never-promoted standby permanently *consumes* one cheap
  sequential number (gaps permitted; AEAT recommends a sequential autonumber — parent SIF spec §12).
- **Series isolation.** Each node's reserved series is disjoint (`invoice_series` keyed
  `(tenant, node, code)`,
  [`packages/db/src/schema/series.ts:66`](../../../packages/db/src/schema/series.ts)), so the identity
  triple `(NIF, NumSerieFactura, Fecha)` can never duplicate across the primary and a promoted standby
  (parent SIF spec §3; duplicate ⇒ AEAT error 3000, §12).
- **New chain on takeover, never resume the dead one's.** The standby chains under its own nodeId; the
  reserved `registro_sif` gets a fresh empty `cadenas` head (both-null pointer per `cadenas_puntero_ck`),
  distinct from the primary's chain (parent SIF spec §3).
- **Multiple SIFs per NIF are lawful** ("SIF virtuales", parent SIF spec §12), so a dormant reserved SIF
  is a legitimate second identity, not a compliance edge.
- **`registros_facturacion` immutability** (REVOKE ALL + append-only + TRUNCATE-blocking triggers,
  CLAUDE.md §5) is untouched by R1–R3 and honoured by H2 on the subscriber side.

## 8. What this decides, and what stays open

**Decided:** the dormant-identity-at-join model (§3); the primary-as-sole-allocator (§4); dormancy via
node-keying, no new schema (§3); the reserved identity riding the adopt bundle not sync (§4); the
membership-document lifecycle — seed at setup, mint at promotion (§6 R1); the sync-axis split at
promotion (§6 R3); H2 sequenced not gated (§6/§7); and the slice order R1 → R2 → R3, with H2 independent.

**Open (each its own later resolution):** the second-*local*-box enrolment/pairing flow (§2); the
promote-action worker-lifecycle manager (promote-action Slice 3, converges with R3); the till-side
failover UX (parent wire-protocol §9 item 4); H2's wire detail (the fiscal lane's capture/apply and the
subscriber-side immutability handling); and `establishNodeIdentity`'s missing re-run guard — it has no
idempotency guard today, only the provision route's post-provision unreachability protects it
([`apps/server/src/node-identity.ts:29`](../../../apps/server/src/node-identity.ts)), so R2 must guard the
standby's establish so a re-run cannot mint a fresh keypair and orphan a previously-signed document
(parent Slice-4 follow-up (b)). **R3 sharp edge (from R1 review):** R1's promote writes the minted
document with the *unguarded* `writeNodeMembershipTx` (plain upsert), not the term-guarded
`persistNodeMembershipIfNewer`. Safe in R1 because the local-secondary promote is fenced (the old
primary is neutralised, so nothing else mints), but in R3 (cloud, multi-node) a promote that read held
term N could race a gossip-adopt landing a newer term N+k and regress it — R3's promote write should
term-guard (or advisory-lock) the mint.

## 9. Interactions

- **`deployment` axes / `promote` / `FenceAttestation`** — unchanged; promotion becomes the caller that
  mints the document (parent wire-protocol §8). R1 wires the *local* path; R3 the *cloud* path.
- **`WAITRON_SYNC_PEERS` env vs. the document** — unchanged separation (parent wire-protocol §8); the env
  is bootstrap contact, the document is standing.
- **The `WAITRON_SYNC_NODE_ID` decision** ([`apps/server/src/config.ts:298`](../../../apps/server/src/config.ts),
  which declined a second node-id variable as "two variables that must agree") is *revisited* in R3, but
  as **two genuinely distinct concepts** (own identity vs. mirrored origin), not two spellings of one id —
  so the one-source-of-truth rule is respected, not broken.
- **Backlog:** the *SIF topology* and *membership* start-here menus should be updated at each slice's land
  to replace the "owner-gated / deferred" framing with this build sequence.
