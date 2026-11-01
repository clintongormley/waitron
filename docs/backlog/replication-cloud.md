# Replication, failover and the cloud — detail

The open entries are listed in [the backlog](../backlog.md), under "Replication, failover and the cloud".

## A1018. Agree and build the hosted writer stop-proof contract

**Owner design approval, 24 October 2026, 04:07.** The owner approved the
[current design](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md)
as published at Waitron `2c13c7f55dd53a6a7b4d4423ccdc166df5af7397`: both Harbour
Kitchen handovers (§§8–9) and the retained defaults (§§3, 5 and 7). M2 alone handles
AEAT after either takeover; returning M1 transfers only fiscal originals and
received AEAT outcomes.
Keep the remaining work open: exact formats, compatible A947 amendments, separate
build authority and physical runtime qualification.

**Amended Cloud agreement published, 2026-10-23 (D133):**
[Cloud #323](https://github.com/waitron-io/waitron-cloud/pull/323), signed
`08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec`, publishes the
[canonical correction](https://github.com/waitron-io/waitron-cloud/blob/08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018); full shared-contract SHA-256
`157556c31753ccf64cc9f8f0a7144f20683325231d212cd344e259b644366d02`.
Cloud accepts the revised direction at Waitron `d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`:
M2 alone handles AEAT after either takeover, preserving old originals' generating identities;
returning M1 transfers missing fiscal originals and all received outcomes without AEAT contact.

Cloud account, venue and operation authority must explicitly bind to the proposed
venue `node.promote` actor. Organisation ownership, support, purchase, matching email or a
provider-resource stop alone grants no venue declaration/activation permission; missing binding
waits. Local-to-local has no Cloud binding dependency. The authentication bridge's format,
expiry/revocation/replay checks remain unbuilt and require joint specification and qualification.

One protocol covers local-to-local, local-to-Cloud, Cloud-to-Cloud and Cloud-to-local. Local
handover works with no Cloud or internet. Controlled: reachable M1 durably steps down, quiesces
every business writer, finishes bounded admitted work and transfers complete final state;
M2 checks its indicator before using its own node identity and fresh fiscal identity, chain and series. Emergency:
a freshly authenticated authorised person declares M1 shut down and no parallel recovery,
accepts the last copy's uncertainty, and M2 activates its own fresh chain. Physical power-off
and provider-console stop are human declarations, not automatic proof. No outside authority,
supervisor, attestation or periodic lease is required. An isolated old M1 can keep selling until
it learns of the takeover; tills selecting one machine do not prove one venue writer.

The five points are explicit in the revision: stepdown survives reboot and an uninformed M1
checks M2 or a till before trading or AEAT contact, waiting for an authorised human if neither answers;
the emergency screen warns about business divergence; only fiscal records return, with a
recommended reconciliation list rather than imported payment totals; **M2 alone handles all
AEAT communication after either takeover**, filing old originals it already holds or receives
later in their original generating identities, and new sales in its own identity; and the
recommended declarant holds `node.promote` with fresh passkey or password plus enrolled TOTP,
never a till PIN alone. The other proposed defaults remain as presented; the M2 assignment is
the owner's direction. Audit the actor, declaration, reason, machines, last copy, time and operation.

Returning M1 stays restricted from business work and all AEAT contact. It transfers missing
fiscal originals, necessary chain/filing state, every received AEAT outcome even for originals
already copied, and unresolved request facts. M2 applies known results and handles uncertainty
and duplicates through existing recovery/filing-case paths, retaining conflicting facts.
No emergency predecessor ownership hold prohibits M2 from filing copied old records; existing
domain holds and the temporary filing pause while a return batch applies remain.
Controlled moves still require complete final-copy acceptance, source relinquishment and
M2's recorded assumption before activation. Durable restrictions and checkpoints survive
retries/reboots; unknown possible activation waits on the selected M2. A pre-acceptance crash
may use the explicit same-M2 emergency replacement only under the design's retained-state
checks, never as a timeout escape from a possible filing assignment.

This relay accords with [A947 §7.1](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md#71-the-tail-and-the-fix-for-the-failed-prototype-scenario):
“the receiver files it and AEAT's duplicate handling settles it”. [Asesor Q2](../compliance/asesor-questions.md#q2-may-a-node-other-than-the-till-transmit-the-tills-records-to-aeat)
requires the generating installation's `IdSistemaInformatico` and `NumeroInstalacion`, rather
than the relaying node's identity. The [5 October observation beside Q34](../compliance/asesor-questions.md#q34-sending-the-old-installations-unsent-records-after-the-switch-added-2026-10-03)
reports “`EstadoRegistro: "Correcto"` for each of its two first records”; it does not verify
old-tail continuation after M2's new chain starts, interleaving or resending an old-server-filed
record. The authorised A1034 [run 39970201368](https://github.com/waitron-io/verifactu/actions/runs/39970201368)
now records those synthetic test-service observations, including an unchanged A3 duplicate and
consulta matching its original fingerprint and generating installation. The [current design §6](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md#6-point-4-m2-alone-communicates-with-aeat-after-takeover) gives the receipt and limits. No physical transfer,
fencing, conflicting tail, production or legal acceptance is established, and no transfer or
authentication format is invented.

Old nonfiscal changes stay in a restricted archive, never merged or re-run. Reconciliation
references are new M2-owned records. No automatic wipe precedes fiscal receipts, matching
transferred totals, health and verified archive gates. A lost disk leaves an explicit unknown
gap and the standing consultation/month-end follow-up, not invented fiscal originals or a
claim that AEAT restores business data. Preserve A947 §7.1's receiver-files/sender-files-nothing
direction and S2 full-state/replay controls. A947 §§6.3/7.1/7.2 and dependent slices still need
explicit amendment for the checkpoints, fiscal-only scope of its broader ledger tail,
business reconciliation and archive/deletion policy, not a reversal of emergency filing ownership.
Cold restore stays an explicit fresh-chain/data-loss choice with its existing recovery
source, operation, key and sole-recovery gates, no new hard-stop demand and no silent fallback.

The shared Cloud contract home remains `docs/waitron-integration-contract.md`
in the Cloud repository.
Wire details, the node-local inventory, Cloud authorisation mapping, separately authorised
implementation and joint behavioural/adverse controls remain open. Runtime checks are UNRUN
for this docs task; no provider work is authorised.

## A completed provision or adopt operation replayed on a later request still answers 200 without restarting and keeps the setup lock set

- The Cloud restore's replay does restart. After a refused resend of a half-finished adopt (A50, #685),
  what the first identity leaves behind on the primary and on this node is still not measured.
  The standby's reset page does not show this server's machine id, so an operator cannot tell
  which row on the primary's Servers screen is this server's (left for the owner from A70's
  review). Removing a standby that "never finished joining" (A61, #708) reads that as
  `serving-secondary` with no `nodes` row in the primary's database, and a remote standby writes
  that row in its own database, so the check cannot see a remote standby that finished — none can
  today (`finish-adoption.ts`).
  **Still open after A63 (#712):** (i) a removed trust anchor (a machine whose key sits in the
  receiver's own `nodes` table) can still make up a key for a machine in good standing that is not
  an anchor, vouch for it, and sign as that machine — unless that machine signed the receiver's
  held chart and the chart carries the endorsement its signature verifies under, so a standby is
  not covered, nor a primary the receiver holds no chart signed by (after the former primary's own
  retirement chart, for one) (stated at `resolveSignerKey`); (ii) boot reconciliation's peer fetch
  sends no credential (`boot.ts` gives `fetchPeerMembershipDocument` only the URL) and
  `GET /management-api/membership` refuses a request without one, so in production that path
  accepts no chart today and the receiver checks above never run there (read, not run); (iii) a
  cleared machine is refused its own promotion only if its own held chart contains the clearing,
  and a standby that never finished joining never receives it; (iv) so, of these guards, only
  those that run where a chart is made or a join is served work in production today: the
  primary's join refusals (`mirror.standby_removed` for a removed or cleared id,
  `mirror.membership_full` for a full chart) and the mint's size refusals; (v) a receiver whose
  held chart predates a removal accepts the removed machine's charts until it learns of the
  removal; (vi) a joining standby sees `mirror.bundle_fetch_failed` rather than the primary's
  reason, because `apps/server/src/mirror-bundle-fetch.ts` turns every non-2xx answer into that
  code except a refused login, which it relays as `password.invalid` (C95) — this predates A63,
  and `mirror.standby_removed` has the same gap; (vii) if A61's removal ever mis-classifies a live
  standby that an operator later promotes, the old primary refuses the new primary's charts
  (`signer_removed`) and keeps selling; the refusal is logged at warn and raises no alert. No adopt
  can finish today (`finish-adoption.ts`), so no such standby exists yet.
  A56's open items (the "Reset this server" path for a half-finished adopt, #694): (2) An adopt
  saved before that change carries no proof, so the reset refuses it (`password.invalid`). (3) The
  proof shows the login the primary accepted at join time, not that the admin is still active
  there, and the one-time code is not asked again. (4) A join that failed after writing
  `trading.env` boots the trading branch, where no setup route is mounted, so this reset cannot
  reach it.
  Also open from A42's review (#674), read and not run: if `operation.complete()` throws after
  `execute` has scheduled the restart, the lock is now released while that restart is pending.
  Stale wording outside f2: "a device with no profile" in `apps/server/src/till-api.test.ts` (near
  lines 1377–1395) and `apps/till/src/till-app.test.ts` (near line 5765), though a device's
  profile column is NOT NULL; `config.ts`'s "minted once and reused" for the box certificate, which a
  restore re-issues; and `errors.ts` describing `setup.already_provisioning` as a persistent-lease
  refusal, when it mostly comes from the in-memory lock. Test titles carrying history, left
  because titles are code: "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`, and
  "(SP-1b fiscal gate)" and "(unchanged)" in `setup-api.test.ts`. Read, not run: `cookieDomainFor`
  (`device-session.ts`) lowercases the request's host but not the configured tenant domain
  (whether configuration normalises it is unchecked), and `DeviceBinding`'s `deviceProfileId` is
  typed `string | null` for a column that cannot be null.

## `docs/developers/conventions-data.md`'s `busy_timeout` receipt … should carry the date and Node version the deleted comment had

- `recovery-lock.ts` now points at this receipt; the missing date and version are
  2026-09-24, Node v26.7.0. Tests and code, read not run unless stated: three `adopt.test.ts`
  titles say "before any mutation", but by then the primary has reserved an identity for the
  standby and added it to its membership list (the tests assert only on the mirror's own
  database); `adoptFromPrimary` (`adopt.ts`) spreads one adoption across several transactions with
  file writes between and no commented decision (CLAUDE.md §3), so a failure partway could leave a
  stamped `venue.db` with none of the box's `node.db` rows (since A947 slice 3a its mode, signing
  key, link, recovery-key check and pinned key share one `node.db` transaction); the restore guard's repeated-destination check
  compares resolved path text, so two names reaching one file through a symlink may pass;
  `mirror-session.ts`'s keepalive keeps an `isNull(lastSeenAt)` arm on a `not null` column (dead,
  kept on purpose); `MirrorBundle.wireguardPublicKey` is set by no production caller and read by
  nothing outside tests; `recovery-race.test.ts`'s header has no "weaker than its name" hedge
  though CLAUDE.md describes the guard that way. Test titles #625 could not touch:
  "…even when the retired variable is set" (`backup-config.test.ts`, still sets a `postgres://`
  URL), "…without copying the obsolete media directory" (`backup-sweep.test.ts`), "(C2b Task 9)"
  (`mirror-bundle-fetch.test.ts`), "(swap S2)" (`mirror-bundle.test.ts`) and "as a file from before
  the field existed" (`recovery-state.test.ts`).

## The boot-time fetch is given only the URL … and boot never reads the `superseded` that `reconcileMembershipOnBoot` returns

- (Read, not run.) The fetch is item (ii) of **Still open after A63** above;
  `reconcileMembershipOnBoot` is called in `apps/server/src/boot.ts`.
  `shouldFenceRestart` (`membership-fence.ts`) has no caller outside its test (`git grep`);
  `enrol-rate-limit.ts` keeps
  one global limit whose stated reason (snitun) is gone;
  `provision.ts` stamps the deployment in its own transaction before `applyVenue`, a split with no
  commented decision (believed to predate #617, not checked); and `setup-operation.ts` (around
  lines 128–133) may treat a lock written by a different store as a previous boot's, so a live
  process's lock could be taken over (a belief, not verified). `node-entry.test.ts` fixtures are
  still PostgreSQL-shaped (a `Failed query` wrapper, code `42703`).
  Test titles #617 could not touch: "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`;
  "since Task 7" and "this tenant's devices" in `device-api.test.ts`; "(R1 behaviour preserved)"
  in `membership-mint.test.ts`.

## The tunnel's stand-in relay pairs with sockets that have already gone

`packages/tunnel/src/testing/relay.ts` is test-only:
nothing outside `packages/tunnel`'s own suites imports it, and Waitron ships no relay. When a parked
box closes, it stays in `idle` until a client takes it, so the next client is paired with the dead
box and its bytes go nowhere. When a waiting client closes,
it stays in `waiters` until its wait window (`waitForBoxMs`) runs out, so a box registering inside
that window is sent `go` and paired with the dead client. Three tests in `relay.test.ts` pass anyway
because they check only the next `ack`: the two reset cases say so, and the older "drops an idle box
that sends garbage after registering, and keeps serving" claims more than it checks. **Next
action:** only if `@waitron/tunnel` outlives its planned retirement (see _Waitron retains_ below) —
drop the entry on close, test-first (a live client after the reset is paired with a live box), and
narrow or extend that older test.

## Fiscal-certificate distribution

Rebuild on the asynchronous adopt (see the residuals). Open
design question: how the dormant certificate is protected when the seal must happen after the
initial copy ([design](../superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
[plan](../superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
question**: `tenant_credentials` is `local` and a blob sealed under one node's ring cannot be opened
under another's. Since A947 slice 3a a spare receives the main box's ring when it joins
(`credentialsRing` in `apps/server/src/mirror-bundle.ts`, written by `apps/server/src/adopt.ts`), so
rows a copy of `venue.db` brings open there; nothing yet delivers that copy, nor a ring the main box
changes after the join (A1273).

## Adding a mirror while the internet is down

Owner, 2026-10-02. Today the only way a second
machine gets a copy of `venue.db` is from the owner's bucket — the rebuild
(`waitron-restore restore --from-bucket`, or the setup wizard's "Restore from my bucket").
Adoption (`apps/server/src/adopt.ts`) fetches its identity bundle from the primary by URL but
carries no data, and nothing in the tree follows a stream yet. So with the internet down there is
no way to add a mirror, which is the very case an on-prem mirror exists for. Wanted: a new mirror
takes its first copy straight from the primary over the LAN. The topology design's §4.4 already
has the primary stream to the mirror box over the LAN once that box is enrolled, and a stream to a
new place should begin with a full copy of the database (to be checked on the pinned Litestream),
so the design may cover it — but it never says so, and it does not list what else enrolling needs
from the internet. Slice 5 should name this as the way a mirror is added and prove it with the
internet unplugged. A cloud mirror needs the internet anyway and is outside this item.

## A stop made while `cloud-replacement.json` is unreadable is not recorded in it

If that file is
later repaired and `cloud-connection.json` lost, the next start restores the connection without
the stop and the next check sends `renew`, so a stop Cloud had not yet heard is lost (left open
by C29, #808). Owner to choose: refuse Stop access while the replacement file is unreadable, or
record the stop somewhere that survives the repair.

## Waitron retains

The implemented Cloud connection screen and manager adapter; box-side networking
and `@waitron/tunnel`'s retirement; first-contact trust bootstrap; and the cloud-standby end-to-end
proof. **Do not restart the cloud-standby work until the Waitron↔Waitron-Cloud boundary contract is
settled.** The proof to run then: on-prem primary → adopt → mirror → human promotion → tills reroute
to the promoted cloud → the venue sells and files. Local maintenance requirements remain in
[Box maintenance and remote support](../superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md);
its cloud support-service proposal is tracked in Cloud and is not approved by this move.

## SQLite + Litestream replaces PostgreSQL

Next: slice 3, seats and promotion. See
[Decisions and deliberate limits](#decisions-and-deliberate-limits).

## Validate every supported object store

Cloud owns its production-provider checks in the
[Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md);
Waitron retains the engine's required semantics and checks for claimed self-host targets.
Topology §12.2's real-store gate remains open; the conditional-write promotion tie-break must be
demonstrated on each target (risk 11). Each owner's bucket is checked by the Backups screen's Test
and Save (`probeBucket`, `packages/stream/src/probe.ts`), which refuse a bucket that does not
refuse a stale conditional write, and the loop test runs that check against versitygw. Waitron
Cloud's production store still needs its own run.

## A restored box whose cloud peer does not answer during its first start signs the next term and removes the marker

- A fencing document the peer serves later at that same term reads as not
  newer, so the box is never fenced (reproduced with a temporary two-boot case in
  `apps/server/src/boot.reconcile.test.ts`). I believe it cannot happen today — the only writer of
  `node_mirror_link` (in `node.db`), which the peer check needs, is `apps/server/src/adopt.ts`, for a
  standby that never finishes adoption — from reading, not a run. Recorded, not redesigned.

## The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the restored copy holds

- A copy whose `nodes.public_key` for this node was rewritten, with its
  document re-signed by the matching key, passes, and the next term is signed over the added node
  (the case "passes a document re-signed with a key the copy's own node row was changed to name"
  pins that). Since A947 slice 3a the three paths that sign over the held chart check it against
  keys `node.db` holds instead, and refuse a chart signed by a key only `venue.db` names (the case
  "refuses a document signed by a key only venue.db names" in
  `apps/server/src/membership-trust.test.ts`); this restore start's check is unchanged.

## A mirror, fenced or adopting start does not check the held row's signature

- A mirror or fenced start
  checks only that it can be read and is shaped as a document (A53); a start still finishing an
  adoption checks neither. Promotion, `retireSelf` and the standby chart append
  (`apps/server/src/promote.ts`, `apps/server/src/retire.ts`, `apps/server/src/mirror-bundle-api.ts`)
  check the held row against the keys `node.db` holds since A947 slice 3a
  (`assertHeldDocumentTrusted`, `apps/server/src/membership-trust.ts`; limits A1275, A1276). A
  restored mirror's own start is not covered.

## On a start with NO restore marker, text that is not JSON or a machine list that is not a list fails with the generic text

- A stored JSON null reads as no document, and a document breaking only
  a shape limit is read and used unchecked. From reading its writers, nothing this program writes
  produces one. Once starts have failed repeatedly the recovery page shows the generic text (code
  `unknown`), not `restore.membership_invalid`. Whether to give it a curated code is open.

## Replication, membership & failover — residuals (Afterwards)

**Slices 3 and 4 rebuild failover**
([the topology design](../superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md)). **Until
slice 3 a venue has ONE node and no failover at all.** **Owner, 2026-10-21 (A947): "For go live I want one box with
failover to another local box"**, with the Cloud shortly after. A second box is a choice for
every later venue (the owner's answer to the A947 design's question 4). Slices 3–5 as re-cut by
[the A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md) meet it. What stayed: `packages/membership` whole (documents, signing,
canonicalisation, verification, trust), node enrolment and its rate limiting
(`apps/server/src/node-enrol-api.ts`, `enrol-rate-limit.ts`), node retirement, and the
`ledger` / `state` / `local` classification — which no longer chooses a database file: every table
was put in `venue.db` (#548), and since A947 slice 3a only a box's own five tables are in `node.db`. Read the residuals below as requirements for what failover is
rebuilt INTO, not as descriptions of code that exists today. A standby holds its full dormant
identity from JOIN and promotion never mints a chain.

The streaming and stored-primary-key decisions are under
[Decisions and deliberate limits](#decisions-and-deliberate-limits). Before enabling a second venue
node, settle [provider cancellation ownership](payments.md#decisions-and-deliberate-limits) (A764).

Two of those keepers came through CHANGED, not untouched, and the change is a real loss of safety
that slice 3 has to restore:

- **`retireSelf` and `rejoinAsSecondary` lost their drain confirmations.** Both used to prove, before
  an irreversible step, that every row this node originated had reached the carrier.
  `node.retire_carrier_changed`, `node.retire_carrier_attached`, `node.retire_not_drained`,
  `rejoin.carrier_attached` and `rejoin.not_drained` were deleted with it. What survives is
  membership-only: `retire_not_fenced`, `retire_no_carrier` (now a direct `servingPrimaryNodeId`
  check), `retire_superseded`, `rejoin.not_fenced` and `rejoin.no_carrier`. So a fenced node can now
  self-evict, and a returned box can now be wiped, without any proof its tail was carried forward.
- **`rejoin --accept-loss` waives nothing today.** The flag and its `rejoin.accept_loss` warning are
  kept so the operator's acknowledgement survives the switch, but the drain confirmation it used to
  waive is gone.
- **Adopt copies no data, and an adopted mirror can no longer leave adoption-pending.** Adopt stamps
  the mirror's identity and config and writes the finish-adoption latch; the initial copy that used
  to bring the venue's rows went with the subscription. `runFinishAdoption` tries to establish the
  reserved identity on every boot, and that attempt cannot succeed, because the standby's own `nodes`
  row references a `locations` row the mirror does not have and nothing supplies. **Operator-visible
  consequence:** a box that adopts stays in adoption-pending boot for good — `/api/box/status` keeps
  answering `adoption: pending`, no mirror session or node-scoped read path is ever mounted, and each
  boot logs `adoption.establish_failed`. The full account is in
  `apps/server/src/finish-adoption.ts`'s `PendingAdoption` header; whatever replaces the initial copy
  in slice 3 has to close this.

- **OWNER DECISION, open since #443: should the setup wizard still OFFER "Add a mirror node"?** The
  wizard's copy was made honest rather than the option removed — `apps/setup`'s role, connect and done
  screens say plainly that joining does not work in this version and that the box ends up holding
  none of the restaurant's data, with no till and no dashboard. But the option is still there and the
  flow still runs, so an operator can still spend a box on it. Removing or disabling it until slice 3
  lands the replacement is a product call, not a wording one. Whoever takes it should decide for
  `apps/setup/src/screens/mode-screen.ts`'s Join or recover row and the `role-screen` card together.

- **Re-admission `sell-only → serving-secondary`** — the primary-minted un-fence that makes a rejoined
  box sell again. Must retire the node's previous chart entry and delete its live `fiscal.aeat` row.
- **The membership chart fills up, and not every entry can be cleared.** It APPENDS, every
  wipe-and-re-adopt mints a fresh nodeId, and `MAX_NODES = 8` (`packages/membership/src/verify.ts`)
  caps it. A full chart is refused at the mint (`membership.chart_too_large`) and at the join
  (`mirror.membership_full`), and an admin can clear a REMOVED (`evicted`) machine to free its place,
  from the Servers screen (A63). What stays open: only an `evicted` entry can be cleared, and A61's
  Remove refuses a standby only when the primary's own database holds a `nodes` row for it
  (`judgeRemoval`, `apps/server/src/membership-removal.ts`). The only writers of a `nodes` row
  found are provisioning (`packages/provisioning/src/venue-apply.ts`, the row of the box being set
  up) and `insertReservedNodeTx`, which a standby runs on its OWN database
  (`apps/server/src/reserved-identity.ts`). So today a remote standby's old entry (a
  wiped-and-re-adopted box's previous id, for one) reads as never-joined even if it finished, and
  can be removed and then cleared. Once adoption can finish (`finish-adoption.ts`) and that check
  can see a finished standby, nothing will free such an entry. A `sell-only` former primary keeps
  its place until that box retires itself (`apps/server/src/retire.ts` marks it `evicted`).
  Re-admission must retire, not add.
- **Chart hygiene:** a post-setup change to `WAITRON_ADVERTISED_ORIGIN` is never re-published, and a
  node that promotes while absent from the chart appends itself address-less, which `routableServers`
  drops.
- **Resume-at-restore marker** — a persisted wiped-state marker to tell a wiped-mid-restore box from
  a never-provisioned one.
- **Worker-lifecycle manager** (promote Slice 3) — in-process promotion without the restart; the
  node-role collapse decides.
- **Power-loss durability and the selling gate.** `writeFileAtomic` does NOT fsync while the
  point-of-no-return is a database commit, so a power cut between the env write and the commit could
  reboot a box `mode=primary` still carrying the primary's series. Fsync the env write or resolve the
  series at boot — and selling must gate on REBOOT COMPLETION.
- **Getting the AEAT certificate onto a promoted standby needs a new design.** The
  [2026-09-07 design](../superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md) landed as #279
  and was reverted by #281, and the replication it was rebuilt against was itself removed on
  2026-09-19 — so the design and its plan describe a mechanism that no longer exists. Redesign it with
  slice 3. Installing or renewing the certificate on the primary, on the dashboard's AEAT certificate
  card (A795), does not wait for this (A9).
- **Still owed after the cert-distribution rebuild:** the restore-onto-cloud re-encrypt; a dashboard
  promote UI; an a11y test for the break-glass panel.
- **Carry-ins, accepted or to be stated in a threat model:** the primary burns an installation number
  per bundle fetch; provision and adopt are assumed mutually exclusive per box; `establishNodeIdentity`
  must run once per node before any document is signed; on the first boot after returning, a node runs as its
  stale-held-doc primary until the reconciliation restarts it; restart-based fencing leaves a one-tick
  window for one more fiscal pass on the superseded chain.
- **Split-brain** — the promoted node's side while partitioned spans selling, the fiscal chain,
  payments (`resolvePending`) and printing — **examine in detail, not scoped to printing** (owner,
  2026-08-26).
- **Till UX for the timed-out card case** — retry, alternative tender, or wait.

## Decisions and deliberate limits

**SQLite + Litestream replaces PostgreSQL** (owner decision 2026-09-16). The architecture is
[SQLite + Litestream topologies](../superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md).
The prototype's S2 result, a handed-over batch re-filing a sale the receiver already filed,
costs one wasted AEAT call (error 3000, already read as filed). It produced the fence-before-ship
rule in topology design §5.2; the
[results note](../research/2026-09-16-sqlite-failover-prototype.md) holds the completed gate's receipts.

**Owner decision 2026-09-24 — a cut-off primary keeps streaming, into its own copy.** Raised by #590
(slice 2 Task 6), whose `StreamHost` streams on any node whose role is primary, while the Cloud
snapshot worker also requires the node not be fenced (`cloudPrimary`, `apps/server/src/boot.ts`).
Invoices a primary has recorded and chained but not yet sent to AEAT exist only in its database, and
Litestream copies the whole file page by page — it cannot pick out the fiscal tables — so the way to
carry them across is to keep streaming everything and extract the fiscal records afterwards, from a
restore of that node's copy, on the promoted side. So when slice 3 builds fencing and promotion: a
fenced primary does NOT stop streaming; it streams into its OWN generation and never writes over the
live one, and the tail shipper files what that copy holds that the promoted side lacks. Watch for the
rule #590's review described — a node refuses itself once the bucket's pointer names another
generation — which, if it stops a fenced node's stream the moment the promoted node claims the
pointer, would cut off exactly the tail this decision is meant to keep. Invoices already sent to AEAT
stay recoverable from AEAT either way.

**Owner decision 2026-09-26 (A45's first point) — a standby checks a promotion against the
primary's key, built in slice 3.** A restored membership document's signature is checked only at
the start that finishes a restore (#678); A53 added a check that it can be read and is shaped as a
document on every restored start not finishing an adoption. Promotion, `retireSelf` and the standby chart append
(`apps/server/src/promote.ts`, `apps/server/src/retire.ts`, `apps/server/src/mirror-bundle-api.ts`)
sign over the held document without checking it, because a mirror's stored keys name only itself,
so a document its primary genuinely signed fails the check there (measured, see Task 9a's #678
entry). The owner chose to leave those paths unchecked now and, as part of the failover work: a
standby stores the primary's key when it joins, and promotion, `retireSelf` and the standby chart
append check the held document against it. Not built; until then those paths stay unchecked.
_2026-11-01: built in A947 slice 3a._ Joining pins the main box's key in `node.db`
(`pinPrimaryKeyTx`, `apps/server/src/adopt.ts`), and the three paths check the held document
against this box's own key and that pinned key (`assertHeldDocumentTrusted`,
`apps/server/src/membership-trust.ts`). Its limits are A1275 and A1276.

- **Translate all keeps the suggestion routes’ existing primary checks** (owner, 2026-10-15,
  lane B question 3, answer (a)). Do not add a separate primary check to discarding a suggestion;
  follow the sibling translation-save route and the shared read-only guard for writes.
- **A missing or revoked Cloud connection uses `cloud.not_configured`** (owner, 2026-10-15,
  lane B question 4, answer (b)). Say “This server is not connected to Waitron Cloud” in English
  and “Este servidor no está conectado a Waitron Cloud” in Spanish.

From the Cloud connection integration (2026-09-24): Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS
override, gateway replacement and revocation.

From the shared account controls: Cloud has published private `@waitron-io/ui-core@0.1.0` (see the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md))
and owns the release workflow and account screens.

Cloud product and infrastructure work moved to the
[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)
on 2026-09-22: provisioning, cloud-only redundancy, trials, remote access, provider integration
and cloud operations. See [documentation ownership](../cloud-ownership.md).

## A951. The box's lasting tunnel and public-certificate client

The owner approved the complete [plan](../superpowers/plans/2026-10-22-a951-connection.md)
and all five build cuts on 2026-10-23 (“Go ahead and build.”, watcher relay about
06:45). The [design](../superpowers/specs/2026-10-22-a951-box-public-access-design.md)
and plan retain their earlier approval statements beneath dated updates. Cut A's
[build intake](../developers/cloud-connection.md#a951-build-intake) records the
inspected contract pins and scoped acceptance still needed before affected code.

The plan stages the transport foundation with an empty customer manifest, the
existing opt-in test-only staff CSR exchange, independent customer upstream mutual
TLS, movement/replacement and separately qualified staff-browser access. It proposes
synced private node-owned files without a database migration. Exact appliance,
helper, grant, upstream identity, authority, move and diagnostic contracts still
need pinned bilateral acceptance before their affected code or enablement. The
foundation does not wait for customer pages or product policies.

A951 supplies reachability only. Staff TLS passes through Cloud and ends at the
box; customer HTTPS ends at Cloud for filtering, then uses verified encrypted
transport to a separate box listener. Customer ingress denies staff/till/setup/
recovery/fiscal/backup/hardware routes. Public credentials do not grant staff API
access. Customer-on-staff routes remain a separate interface decision, default
denied in the proposed plan. These are planned controls, not runtime proof.

Venue devices keep `.local`; remote customer work follows soon after go-live.
A1013 bookings, A508 table QR, A509 collection and later A1012 delivery own their
pages, exact route/assets, customer authentication, business operations and service
availability. Connecting Cloud enables none of them. The earlier per-service
publication question is superseded and is not asked again.

Cloud's published [Cut A review](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23)
requires amendments; no appliance, helper or parser artifact is accepted. Lane E
owns the client and local helper boundary; Lane G owns the Cloud response, with
Lane D retaining D88 and gateway deployment. The [intake](../developers/cloud-connection.md#a951-build-intake)
pins the review document and remaining scoped requests. Reconcile exact artifact
digests and both consumer revisions before each affected adapter. Cloud's existing [confirmed architecture](https://github.com/waitron-io/waitron-cloud/blob/35af2d396d916223ff4f319d8f44093685d62da5/docs/product-and-platform.md#L89)
is separate from acceptance of every contract detail. Cloud sees customer plaintext
for filtering; that grants no general retention authority. A980/D101 must accept
metadata fields, purpose, access, location, bounds and retention for the affected
flow, including staff transport metadata. Keep bodies, credentials and QR/session
secrets out of shared diagnostics and shared private-state caches.

The [versioned local-helper proposal](../superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md)
now gives Lane G a concrete G1/T3 boundary to accept or amend. It proposes local
framing, resource ownership, network scope and expiry/removal observations. It is
unaccepted and unimplemented; the separate appliance, routing, authority and
runtime agreements remain open. Record the accepted digest and both consumer pins
before helper code starts.

The [routing v1 proposal](../superpowers/specs/2026-10-23-a951-routing-v1-proposal.md)
returns G6/T4's empty manifest, raw-request vectors and verified context boundary
for Lane G review. Shared parser acceptance, upstream authentication and the separate
diagnostic/privacy artifacts remain open. The proposal supplies no running parser
or customer route. Record accepted bytes and both consumer pins before coding it.

The [appliance v1 proposal](../superpowers/specs/2026-10-23-a951-appliance-v1-proposal.md)
returns G1/T1's authenticated bytes, trust, independent counters and establishment/
recovery boundary for Lane G review. Its publication is not acceptance. Record
its accepted version/digest, both full consumer revisions and permitted scope
before codec or affected state adapters; the helper/routing proposals and all
other scoped gates remain separate.

D88's answered recovery choice stays cold recovery when needed. A947 owns writer,
fencing, promotion, clocks and fiscal identity; the tunnel, certificate or control
lease grants none of that authority. Production staff issuance/replacement, runtime,
provider and supported-device qualification remain separately gated. Source reading
and documentation checks qualify no composed network or recovery lifecycle.

## A mirror keeps a renamed server's old chart (A917)

A mirror node is given the venue's chart
when it is paired; no path was found that delivers a later one, so after a
rename its copy would name the old address until it is paired again. No reader routing by a
mirror's copy was found (not exhaustive). [Design §7.2](../superpowers/specs/2026-10-20-a917-box-local-name-design.md#72-at-the-confirm-one-chart-write-then-a-swap-decided-from-what-is-on-disk)

## A947. Go-live on two local boxes

The owner approved the second revision on 2026-10-22 at about 02:40; the amendment adds his
03:12 direction. Slice 4a landed as [#1990](https://github.com/clintongormley/waitron/pull/1990) on
2026-10-24. Slice 3a ([plan](../superpowers/plans/2026-10-31-a947-3a-node-db.md)) landed as
[#2371](https://github.com/clintongormley/waitron/pull/2371) on 2026-11-01: what a box remembers
about itself is in its own `node.db`. The owner answered yes to both its questions on 2026-10-31:
the box's role is saved a moment after the switch's fiscal save, and a spare checks the main box's
certificate fingerprint before it receives the venue's keys. Slices 3b onwards are still open;
A1273 to A1285, A1295 and A1296 are the loose ends slice 3a left.

The owner, 2026-10-21: "For go live I want one box with failover to another
local box." The [design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md) re-cuts
slices 3–5 into pull requests (§11) and answers several entries below: the vault-ring question
(the spare gets the credentials key at joining), adding a spare with the internet down (the first
copy over the LAN), the stored primary key (A45), and the drain confirmations rejoin lost (the
tail receipt). All four questions are answered (§12): a manager switches from any till, signing
in with a passkey or a password plus authenticator code when enrolled — no recovery sheet; the
switch never waits for the next hour, because every series name is five symbols for the UTC
minute (`A-0CZZW`, §6.5; the owner's 22:25 follow-up), with no "last hour" question anywhere;
since slice 4a the recovery sheet and the restore form have no installation code, every name a
box takes outside the preproduction throwaway refuses a box clock more than 30 seconds behind or
ahead of another device's, and a setup or restore waits 90–150 seconds before naming (§6.5,
§6.7). Any device, even a reloaded one, reaches the
switch (§6.6); the returning box hands over and becomes the spare by itself after three checks
(§7.2); a spare is a choice per venue. Found while revising: both boxes put the same address in
the membership chart, so a till's router sees one server (§2).

[Mock-ups](mockups/a947-two-box-failover/README.md).

## A1273: the shared key ring has no rotation path to the spare

Left open by A947 slice 3a, for slices 3b and 3c. A spare receives the main box's key ring once,
when it joins (`credentialsRing` in `apps/server/src/mirror-bundle.ts`; `apps/server/src/adopt.ts`
writes it over the spare's `secrets.env`). `waitron-credentials rotate` re-seals the main box's
vault rows and its own signing key under the ring's current version (`rotateCredentials`,
`packages/credentials/src/store.ts`), and nothing sends that ring to a spare that has already
joined. From reading, not run: a spare holding a copy of `venue.db` taken after a rotation could
not open the rows sealed under the new version. Wanted: a way for the ring to reach the spare, or a
rule that a rotation re-joins it.

## A1274: a lost node.db beside an intact venue.db reads as a sole primary

Left open by A947 slice 3a. A box with no row in `node_mode` reads as a sole primary
(`readNodeMode`, `packages/node-db/src/mode.ts`). So a spare whose `node.db` is deleted, while its
copy of `venue.db` stays, reopens with a new `node.db` holding no row for it and reads its mode and
singleton role as primary. Guard: the case "reads as a sole primary once its node.db is lost" in
`apps/server/src/node-db-copy.test.ts`, which asserts the reader and the holder refresh; it starts no
server, so what boot then does is not run. A start-up refusal for a missing `node.db` was not taken
in slice 3a because it needs a new recovery-page code with English and Spanish title and action.

## A1275: a Cloud peer's chart is refused on the checked paths

Left open by A947 slice 3a. Promotion (both functions), retiring and the spare-adding route check
the held chart against the keys this box stores itself: its own, and the main box's key pinned when
it joined, plus a spare one of those endorsed (`readStoredTrustSet` and `assertHeldDocumentTrusted`,
`apps/server/src/membership-trust.ts`). A chart a Cloud peer signs is vouched for by none of them,
so once one exists those paths would refuse it `membership.held_untrusted`, and the screens show
the generic text. Not run with a Cloud peer: none signs charts today. Decide with the Cloud standby
work which keys a box trusts.

## A1276: after two promotions, a box can refuse the main box's chart

Left open by A947 slice 3a. A box trusts only its own key and the ONE main-box key it pinned when it
joined (`pinPrimaryKeyTx` has one production caller, `apps/server/src/adopt.ts`), and a chart carries
only its signer's own endorsement. So in a venue of three or more boxes, after two promotions, a box
can hold a chart from a main box that no key it trusts vouched for. It then refuses to be promoted
or to retire (`membership.held_untrusted`, reason `endorsement_invalid`), and the screen shows the
generic text with no next step, which CLAUDE.md §3 allows only for a state only a bug produces. Two
sequences:

- (a) Main box M; spares S1 and S2 join under M. M fails and S1 is promoted. Spare D joins under S1,
  so D trusts D and S1. S1 fails and S2 is promoted. S2's chart carries M's endorsement of S2, and D
  never trusted M, so D refuses it. The main box changed only once since D joined. Control: the
  same chart with S1 vouching for S2 is trusted.
- (b) The original main box M, which trusts only itself, holds the chart of S2 after S1 and then S2
  are promoted, with S1 vouching for S2. M refuses it. Control: S1's chart with M vouching for S1
  is trusted.

Measured at the helper the trust check calls (`verifyDocumentSigner` in `@waitron/membership`, with
trust sets built by hand), on the slice's branch; not run end to end. That replication delivers
S2's chart to D, or to a returned M, is not proven. Go-live is two boxes, where this cannot arise.
Fix idea: at join, also pin the main box's own trusted keys.

## A1277: a malformed chart signed by a trusted key is copied into the next chart

Left open by A947 slice 3a. The readability check (`assertHeldDocumentReadable`,
`apps/server/src/membership-trust.ts`) checks only the fields a chart declares, so a held chart
signed by a key this box trusts whose `nodes` entry carries an extra key passes it and the trust
check, and retiring and the spare-adding route copy that extra key into the chart they sign.
Measured on the slice's branch at those two paths; promotion was not measured, and on main it was
not run. Waitron never writes such a chart.

## A1278: the spare-adding route spends a reservation on a held chart it then refuses

Predates A947 slice 3a. On main (01945cbce, in a throwaway worktree), the case "refuses 409
membership.revoked_duplicate when the held chart's revoked list names a machine twice" in
`apps/server/src/mirror-bundle-api.test.ts`, with a snapshot of the reservations added before and
after, failed only on the snapshot: the route answered 409 `membership.revoked_duplicate` after
making one signed outside reservation (`allocationId contract-P000042`). On the slice's branch the
trust check and the readability check (`assertHeldDocumentReadable`) both run before the
reservation, and both pass this chart: the main box signed it, and the readability check does not
look for repeated ids. The same snapshot added on the branch still fails with that reservation.
Wanted: refuse repeated ids before reserving.

## A1295: a backup's venue authority is not checked as a pair, and a restore without one keeps the box's old pair

Left open by A947 slice 3a. A spare's `tls/venue-ca.crt` and `tls/venue-ca.key` travel as optional
backup state (`apps/server/src/backup-optional-state.ts`). Backup verification checks that
`tls/ca.crt` and `tls/ca.key` match, but only accepts the venue pair's entries, so a backup holding
the certificate without its key, or a mismatched pair, passes. And a restore of a backup without
the pair onto a box that has one leaves the box's old pair in place, as it does for `backup.env`
and `modules.json`. Read in the finish-branch fix, not run.

## A1296: code-quality follow-ups from A947 slice 3a's finish review

Raised by the finish-branch simplify review (2026-11-01) and not applied there, because each is a
restructuring wider than a review fix:

- The key ring's file format (`WAITRON_CREDENTIALS_KEY*`) is spelled out in
  `apps/server/src/box-secrets.ts` (`keyRingEnv`) and `mirror-bundle.ts` (`encodeKeyRing`) as well
  as `packages/credentials/src/keyring.ts`; adopt decodes the bundle's ring through the env format.
  Own the format in `keyring.ts`.
- `apps/server/src/mirror-bundle-fetch.ts` hand-writes an HTTPS client on `node:https`;
  `tunnel-http.ts` already uses undici's `Agent({ connect: { ca } })` with `fetch`.
- `node.dump` is opened twice in one verification run: read-only with an authorizer
  (`backup-verification-compatibility.ts`) and writable in memory without one
  (`packages/composition/src/node-backup-verification.ts`). Open it once, through the hardened
  opener.
- `packages/provisioning/src/first-setup-start-again-set-aside.ts` (`writeRingFile`) repeats
  `writeFileDurable` (`fs-atomic.ts`) plus an exact mode and a refusal to overwrite; add those as
  options instead.
- The venue and node handles travel as separate fields under four names (`nodeDb`, `node`,
  `ownerNode`, `nodeDatabase()`), with three near-identical pair types (`VenueDatabase`,
  `VenueAndNodeHandles`, `MigrationFiles`). Pass one pair type.
- The staged node copy is hashed twice in the staging digest
  (`apps/server/src/first-setup-backup-recovery.ts`, `fingerprint()`).
- "Opening a staged folder must not create an empty `node.db`" is enforced by about fifteen
  callers (`writeStagedNodeCopy`, `openStagedCopy`, `assertStagedNodeCopy`, and a hand-rolled
  `lstat` in `first-setup-publication.ts`). Let `validateDatabaseEntries` write the copy, and give
  the store an option that refuses a missing `node.db`.
- The rule "take `node.db`'s lock outside `venue.db`'s" lives only in comments at four nesting
  sites; one `withVenueAndNodeTransaction` helper would enforce it.
- `collectStateParts`'s `snapshotNode` callback is the same expression at two of its callers
  (`backup-sweep.ts`, `sealed-state.ts`).

## A1279: a local secondary promotes only over a chart it signed itself

Left open by A947 slice 3a. `promoteLocalSecondaryToPrimary` (`apps/server/src/promote.ts`) runs the
trust check with no pinned main-box key, because only joining pins one, so it trusts its own key
alone. It has no production caller: the promote endpoint never calls it
(`apps/server/src/boot.ts`, "it NEVER calls `promoteLocalSecondaryToPrimary`"), and the in-process
handle a started server carries (`makeStartedServer`, `apps/server/src/boot.ts`) is used only by
tests. Decide its trust set if it gains a caller.

## A1280: a retried join leaves the abandoned node id's node.db rows

Left open by A947 slice 3a. A join retried after a failure under a new node id leaves the first
attempt's `node_signing_key`, `node_mode` and `node_mirror_link` rows for an id nothing else names
(a probe case added to `apps/server/src/adopt.test.ts` in the slice's Task 10 review, then
removed). Nothing reads a row by any id but its own, and a rotation re-seals the key, but it is a
private key for an identity the main box endorsed. Wanted: remove them when a new attempt starts.

## A1281: the venue command reads a missing or unmigrated node.db as version 0

Left open by A947 slice 3a. `waitron-provision venue` refuses an unmigrated `venue.db`
(`provisioning.database_unmigrated`, `packages/provisioning/src/cli.ts`), but does not check
`node.db`: the node set's version reads as 0 when its table is missing (`appliedSchemaVersion`,
`packages/migrations/src/schema-version.ts`). A real box's folder is migrated, both files, before the
command runs (`applyMigrations`), so this needs a folder put together by hand. Wanted: the same
refusal for `node.db`.

## A1282: the Servers screen's main-box fingerprint is stale after a connection repair

Left open by A947 slice 3a. The dashboard's Settings → Servers screen shows the serving box's
certificate authority fingerprint (`readBoxCaFingerprint`, `apps/server/src/box-tls-repair.ts`), refreshed only when `node_membership` or `nodes` change (`listServers` in
`apps/dashboard/src/api/live-queries.ts`). A connection repair that makes a new authority would show
the old fingerprint until the page reloads. From reading, not run.

## A1283: no guide page covers the Servers screen or adding a spare

Left open by A947 slice 3a. CLAUDE.md §3 asks a screen change to update its guide. Slice 3a changed
the Servers screen (the fingerprint line) and the joining steps (a spare compares the main box's
fingerprint before it sends a password), and no page in `apps/server/src/guide/en/` or
`apps/server/src/guide/es/` covers either. Wanted: a section in English and Spanish, with shared
`{#id}` headings, on adding a spare and the fingerprint comparison.

## Loose ends left by the Cloud connection integration

- Customer remote setup UI and production deployment remain open.
- Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly
  beyond its current in-memory 512 MiB format limit. Cloud documentation:
  `docs/authenticated-captures.md` in waitron-cloud.
- After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step. Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog.
- A stop made while `cloud-replacement.json` is unreadable is not recorded in it.
  [Detail](../backlog/replication-cloud.md#a-stop-made-while-cloud-replacementjson-is-unreadable-is-not-recorded-in-it)
- The Litestream stream's sealed-state restore and activation still need integration with Cloud
  storage and owner recovery. Connected does not mean those services are configured. Cloud service
  ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
  behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work.

## Four Cloud reply and state readers accept a one-item list where they want text

Each turns
the field into text before checking it, so `["ready"]` passes as `"ready"`:
`apps/server/src/cloud-client.ts` (the pairing reply's and saved view's `state`),
`cloud-recovery.ts` (the saved recovery `phase`, and Cloud's `result.state`) and
`cloud-replacement.ts` (Cloud's `state`). A689's first PR fixed the same pattern in
`cloud-installation.ts` and `cloud-translation.ts`; these four predate it. Not measured against a
real Cloud.

## Loose ends left by the SQLite failover-loop prototype gate

Receipts in
[the results note](../research/2026-09-16-sqlite-failover-prototype.md).

- **Validate every supported object store.**
  [Detail](../backlog/replication-cloud.md#validate-every-supported-object-store)
- The store pointer and a new generation are exercised for a rebuild, not for a promotion. A
  promoted node's generation, and Cloud's recovery orchestration (tracked in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)), remain;
  settle the Waitron ↔ Waitron Cloud contract before assigning them.
- 250 sales a day is still an assumption nothing in this repository measures, so the days-per-GiB
  figure rescales but does not hold.
- Three scenarios have no mutation receipts (S1, S6, `smoke`), two branches of the litestream
  wrapper are driven by no scenario, and the runner's own `main()` is undriven — a later task
  should pin them or delete them.

## Task 1a — node filters and unverified concurrency claims

Deny's delete is the one join-request node filter no test fails without (the `requirePending`
read before it already refuses another node's row). Holders torn by a concurrent promotion,
credential sealing and scheduler takeover remain unverified.

## Loose ends left by SQLite slice 2 Task 9a

- A node row holding no endorsement still signs `endorsements: []`, and no first-start case
  asserts it.
- [Restore fencing when the cloud peer does not answer](#a-restored-box-whose-cloud-peer-does-not-answer-during-its-first-start-signs-the-next-term-and-removes-the-marker).
- The pointer's term is taken without checking its signature, as the supervisor already does, so
  whoever can write the bucket can push a restored box's term up (never down).
- A sell-only local secondary that is not fenced runs the first start and signs the next term.
- [Trust in the restored copy’s own keys](#the-restored-membership-rows-check-assertrestoredmembershipvalid-678-trusts-the-keys-the-restored-copy-holds).
- [Signature checks on a mirror, fenced or adopting start](#a-mirror-fenced-or-adopting-start-does-not-check-the-held-rows-signature).
- [Curated refusal for malformed membership with no restore marker](#on-a-start-with-no-restore-marker-text-that-is-not-json-or-a-machine-list-that-is-not-a-list-fails-with-the-generic-text).
- A mirror that deferred its first start and is then promoted without a restart
  (`promoteMirrorToPrimary`) keeps the bucket copy held, reading off with the reason
  `first_start_pending` and raising no alert, until the box next starts. From reading, not a run.

## If a later slice moves local tables into node.db

A947 slice 3a moved five tables into `node.db` with no change-log triggers: `node.db` has no
`change_log`, and `withTransaction`, which drains it, refuses the node handle
(`packages/db/src/tenancy.ts`). A later slice that moves a table whose changes must be delivered,
or `change_log` itself, decides again how the drain crosses the two files: SQLite refuses a trigger
body that writes another attached database, so either `change_log` is reclassified to the file its
writers live on, or the triggers stop writing it directly and something above them does (P3).

## A promoting standby may list itself with an empty contactUrl

No path was found that copies `node_membership` from the primary to a standby. A
standby whose own held membership list omits it takes the fallback in `nextStandings`
(`packages/membership/src/standings.ts`), which appends it with an empty `contactUrl`, and
`routableServers` (`packages/membership/src/fence.ts`) then drops it. Found by reading, not run.
[Detail](../backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)
