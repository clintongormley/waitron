# Replication, failover and the cloud — detail

The open entries are listed in [the backlog](../backlog.md), under "Replication, failover and the cloud". This file holds
their full text.

## A1018. Agree and build the hosted writer stop-proof contract

**Direction update, 2026-10-23:** Lane G agrees the replacement at Cloud draft
[#312](https://github.com/waitron-io/waitron-cloud/pull/312), commit
`a9399a4a390a62f45e4d4c636635ae6d715c1ecd`. The shared contract remains on that
branch; its exact Cloud-main publication pin is still required before the one combined owner
question. Cloud account, venue and operation authority must explicitly bind to the proposed
venue `node.promote` actor. Organisation ownership, support, purchase, matching email or a
provider-resource stop alone grants no venue declaration/activation permission; missing binding
waits. Local-to-local has no Cloud binding dependency. The authentication bridge's format,
expiry/revocation/replay checks remain unbuilt and require joint specification and qualification.
The previous proposal-state wording below is historical. Design approval, build authority and
runtime acceptance remain pending.

**Proposed owner-directed revision, 2026-10-23; no build approval.** The owner rejected the
[old design](../superpowers/specs/2026-10-22-a1018-cloud-stop-proof-design.md) at ~02:25 for
requiring Cloud and excessive complexity, then supplied five points at ~02:58. The
[replacement design](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md) has completed fresh builder review
and awaits agreement with Cloud through Lane G, then **one owner design question**
containing both Harbour Kitchen examples and the recommended defaults. Keep this item open;
the original queue start is 2026-10-22 16:14.

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
checks M2 or a till before trading/filing, waiting for an authorised human if neither answers;
the emergency screen warns about business divergence; only fiscal records return, with a
recommended reconciliation list rather than imported payment totals; controlled M2 takes
M1's filing queue, while emergency M1 files on restricted return and M2 holds every predecessor
chain, including copied records; and the recommended declarant holds `node.promote` with fresh
passkey or password plus enrolled TOTP, never a till PIN alone. These recommendations await
approval. Audit the actor, declaration, reason, machines, last copy, time and operation.

Old nonfiscal changes stay in a restricted archive, never merged or re-run. Reconciliation
references are new M2-owned records. No automatic wipe precedes fiscal receipts, matching
transferred totals, health and verified archive gates. A lost disk leaves an explicit unknown
gap and the standing consultation/month-end follow-up, not invented fiscal originals or a
claim that AEAT restores business data. A947 §§6.3/7.1/7.2 and dependent slices need explicit
amendment for filing ownership, its broader ledger tail and archive/deletion policy.
Cold restore stays an explicit fresh-chain/data-loss choice with its existing recovery
source, operation, key and sole-recovery gates, no new hard-stop demand and no silent fallback.

The old Waitron `db7cddeb2d38984b284b23e8e391e7ebd7cb9156` / Cloud
`6700d6f2319ff0b62b0ccc27e833487935ad2174` direction agreement through Cloud #300 is
superseded. The shared Cloud contract home remains `docs/waitron-integration-contract.md`
in the Cloud repository. The revision proposes replacement A1018 text and identifies P6/P7,
D88 and production §§3/6/9/12 wording to amend through Lane G; no new agreement is asserted.
Wire details, the node-local inventory, Cloud authorisation mapping, separately authorised
implementation and joint behavioural/adverse controls remain open. Runtime checks are UNRUN
for this docs task; no provider work is authorised.

## A completed provision or adopt operation replayed on a later request still answers 200 without restarting and keeps the setup lock set

- Found by #657 (`apps/server` part f2: the node, identity and setup files), outside its files
  or not fixable in a comments-only change. A completed provision or adopt operation replayed on
  a later request still answers 200 without restarting and keeps the setup lock set (the Cloud
  restore's replay does restart). After a refused resend of a half-finished adopt (A50, #685),
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

- Found by #625 (`apps/server` part e1), outside its files or not fixable in a comments-only
  change. Docs: `docs/developers/conventions-data.md`'s `busy_timeout` receipt, which
  `recovery-lock.ts` now points at, should carry the date and Node version the deleted comment had
  (2026-09-24, Node v26.7.0). Tests and code, read not run unless stated: three `adopt.test.ts`
  titles say "before any mutation", but by then the primary has reserved an identity for the
  standby and added it to its membership list (the tests assert only on the mirror's own
  database); `adoptFromPrimary` (`adopt.ts`) spreads one adoption across several transactions with
  file writes between and no commented decision (CLAUDE.md §3), so a failure partway could leave a
  stamped mirror with no break-glass verifier; the restore guard's repeated-destination check
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

- Found by #617 (`apps/server` part f1), not fixable in a comments-only change. **Still open**
  (read, not run): the boot-time fetch is given only the URL (item (ii) of **Still open after A63**
  in the #657 item above), and boot never reads the `superseded` that
  `reconcileMembershipOnBoot` returns (`apps/server/src/boot.ts`, where it is called);
  `shouldFenceRestart` (`membership-fence.ts`) has no caller outside its test (`git grep`);
  `device-api.ts`'s ticket-item advance route did not enforce the `act-as-kds` capability
  (resolved by W97, 2026-10-06: it and the kitchen-notice acknowledge route now check the
  profile's `prepare-orders` action through `assertProfileAction`); `enrol-rate-limit.ts` keeps
  one global limit whose stated reason (snitun) is gone; `provision-till.test.ts` inserts its
  tenant with `onConflictDoNothing`, so a second call's new NIF is silently kept out;
  `provision.ts` stamps the deployment in its own transaction before `applyVenue`, a split with no
  commented decision (believed to predate #617, not checked); and `setup-operation.ts` (around
  lines 128–133) may treat a lock written by a different store as a previous boot's, so a live
  process's lock could be taken over (a belief, not verified). `node-entry.test.ts` fixtures are
  still PostgreSQL-shaped (a `Failed query` wrapper, code `42703`).
  Test titles #617 could not touch: "(SP-A.2 §16, device-profile §5)" in `device-session.test.ts`;
  "since Task 7" and "this tenant's devices" in `device-api.test.ts`; "(R1 behaviour preserved)"
  in `membership-mint.test.ts`.

## The tunnel's stand-in relay pairs with sockets that have already gone

**The tunnel's stand-in relay pairs with sockets that have already gone — OPEN (found 2026-09-23,
writing tunnel's coverage tests, PR #506).** `packages/tunnel/src/testing/relay.ts` is test-only:
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

- **Fiscal-certificate distribution** — rebuild on the asynchronous adopt (see the residuals). Open
  design question: how the dormant certificate is protected when the seal must happen after the
  initial copy ([design](../superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
  [plan](../superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
  question**: `tenant_credentials` is `local` and a blob sealed under one node's ring cannot be opened
  under another's, so `fiscal.aeat` and `payments.stripe` do not travel to a standby at all.

## Adding a mirror while the internet is down

- **Adding a mirror while the internet is down** (owner, 2026-10-02). Today the only way a second
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

- A stop made while `cloud-replacement.json` is unreadable is not recorded in it. If that file is
  later repaired and `cloud-connection.json` lost, the next start restores the connection without
  the stop and the next check sends `renew`, so a stop Cloud had not yet heard is lost (left open
  by C29, #808). Owner to choose: refuse Stop access while the replacement file is unreadable, or
  record the stop somewhere that survives the repair.

## Waitron retains

**Waitron retains:** the implemented Cloud connection screen and manager adapter; box-side networking
and `@waitron/tunnel`'s retirement; first-contact trust bootstrap; and the cloud-standby end-to-end
proof. **Do not restart the cloud-standby work until the Waitron↔Waitron-Cloud boundary contract is
settled.** The proof to run then: on-prem primary → adopt → mirror → human promotion → tills reroute
to the promoted cloud → the venue sells and files. Local maintenance requirements remain in
[Box maintenance and remote support](../superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md);
its cloud support-service proposal is tracked in Cloud and is not approved by this move.

## SQLite + Litestream replaces PostgreSQL

Next: slice 3, seats and promotion. Its first task is already decided: credentials move to a venue
key stored in `venue.db` only in locked form. Do not reopen it. See
[Decisions and deliberate limits](#decisions-and-deliberate-limits).

## Validate every supported object store

**What the prototype gate left open (the receipts are in the results note):**

- **Validate every supported object store.** Cloud owns its production-provider checks in the
  [Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md);
  Waitron retains the engine's required semantics and checks for claimed self-host targets.
  Topology §12.2's real-store gate remains open; the conditional-write promotion tie-break must be
  demonstrated on each target (risk 11). Each owner's bucket is checked by the Backups screen's Test
  and Save (`probeBucket`, `packages/stream/src/probe.ts`), which refuse a bucket that does not
  refuse a stale conditional write, and the loop test runs that check against versitygw. Waitron
  Cloud's production store still needs its own run.

## A restored box whose cloud peer does not answer during its first start signs the next term and removes the marker

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- A restored box whose cloud peer does not answer during its first start signs the next term and
  removes the marker; a fencing document the peer serves later at that same term reads as not
  newer, so the box is never fenced (reproduced with a temporary two-boot case in
  `apps/server/src/boot.reconcile.test.ts`). I believe it cannot happen today — the only writer of
  `mirror_config`, which the peer check needs, is `apps/server/src/adopt.ts`, for a standby that
  never finishes adoption — from reading, not a run. Recorded, not redesigned.

## The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the restored copy holds

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- The restored membership row's check (`assertRestoredMembershipValid`, #678) trusts the keys the
  restored copy holds: a copy whose `nodes.public_key` for this node was rewritten, with its
  document re-signed by the matching key, passes, and the next term is signed over the added node
  (the case "passes a document re-signed with a key the copy's own node row was changed to name"
  pins that).

## Only the start that finishes a restore checks the row's signature

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- Only the start that finishes a restore checks the row's signature. A mirror or fenced start
  checks only that it can be read and is shaped as a document (A53); a start still finishing an
  adoption checks neither. Promotion, `retireSelf` and the standby chart append
  (`apps/server/src/promote.ts`, `apps/server/src/retire.ts`, `apps/server/src/mirror-bundle-api.ts`)
  sign over the held row without checking it. Gating promotion on the same check was measured and
  not done, because it would refuse a genuine document: on 2026-09-26 a scratch case built the way
  `promote.test.ts` builds a mirror found, after `setDeploymentMode(…, "mirror")` alone (what
  `adoptFromPrimary` leaves), no document and an empty trust set; after
  `establishReservedStandbyIdentity`, a trust set naming the standby alone; and a document the
  primary signed with its real key, written there, verified as `untrusted_signer`. The owner's
  decision (2026-09-26) is under the failover residuals ("a standby checks a promotion against the
  primary's key"); a restored mirror's own start is not covered by it.

## On a start with NO restore marker, text that is not JSON or a machine list that is not a list fails with the generic text

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- On a start with NO restore marker, text that is not JSON or a machine list that is not a list
  fails with the generic text; a stored JSON null reads as no document, and a document breaking only
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
is in `venue.db` (#548). Read the residuals below as requirements for what failover is
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

D88's answered recovery choice stays cold recovery when needed. A947 owns writer,
fencing, promotion, clocks and fiscal identity; the tunnel, certificate or control
lease grants none of that authority. Production staff issuance/replacement, runtime,
provider and supported-device qualification remain separately gated. Source reading
and documentation checks qualify no composed network or recovery lifecycle.

## A mirror keeps a renamed server's old chart (A917)

**A mirror keeps a renamed server's old chart (A917).** A mirror node is given the venue's chart
when it is paired; A917's round-3 review found no path that delivers a later one, so after a
rename its copy would name the old address until it is paired again. No reader routing by a
mirror's copy was found (not exhaustive). [Design §7.2](../superpowers/specs/2026-10-20-a917-box-local-name-design.md#72-at-the-confirm-one-chart-write-then-a-swap-decided-from-what-is-on-disk)

## A947. Go-live on two local boxes

The owner approved the second revision on 2026-10-22 at about 02:40; the amendment adds his
03:12 direction. Slice 4a is [PR #1990](https://github.com/clintongormley/waitron/pull/1990), open for
the owner to land. The remaining slices are still open.

The owner, 2026-10-21: "For go live I want one box with failover to another
local box." The [design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md) re-cuts
slices 3–5 into pull requests (§11) and answers several entries below: the vault-ring question
(the spare gets the credentials key at joining), adding a spare with the internet down (the first
copy over the LAN), the stored primary key (A45), and the drain confirmations rejoin lost (the
tail receipt). All four questions are answered (§12): a manager switches from any till, signing
in with a passkey or a password plus authenticator code when enrolled — no recovery sheet; the
switch never waits for the next hour, because every series name is five symbols for the UTC
minute (`A-0CZZW`, §6.5; the owner's 22:25 follow-up), with no "last hour" question anywhere;
the recovery sheet and the restore form would drop the installation code once slice 4a's test
passes. Once slice 4a lands, every name a box takes would refuse a box
clock more than 30 seconds behind or ahead of another device's, and a setup or restore would wait
90–150 seconds before naming (§6.5, §6.7). Any device, even a reloaded one, reaches the
switch (§6.6); the returning box hands over and becomes the spare by itself after three checks
(§7.2); a spare is a choice per venue. Found while revising: both boxes put the same address in
the membership chart, so a till's router sees one server (§2).

[Mock-ups](mockups/a947-two-box-failover/README.md).

## Loose ends left by the Cloud connection integration

**Loose ends left by the Cloud connection integration (2026-09-24; #638, #808).**

- Customer remote setup UI and production deployment remain open.
- Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly
  beyond its current in-memory 512 MiB format limit. Cloud documentation:
  `docs/authenticated-captures.md` in waitron-cloud.
- After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step. Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog.
- A stop made while `cloud-replacement.json` is unreadable is not recorded in it. Owner to choose:
  refuse Stop access while the replacement file is unreadable, or record the stop somewhere that
  survives the repair.
  [Detail](../backlog/replication-cloud.md#a-stop-made-while-cloud-replacementjson-is-unreadable-is-not-recorded-in-it)
- The Litestream stream's sealed-state restore and activation still need integration with Cloud
  storage and owner recovery. Connected does not mean those services are configured. Cloud service
  ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
  behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work.

## Four Cloud reply and state readers accept a one-item list where they want text

**Four Cloud reply and state readers accept a one-item list where they want text.** Each turns
the field into text before checking it, so `["ready"]` passes as `"ready"`:
`apps/server/src/cloud-client.ts` (the pairing reply's and saved view's `state`),
`cloud-recovery.ts` (the saved recovery `phase`, and Cloud's `result.state`) and
`cloud-replacement.ts` (Cloud's `state`). A689's first PR fixed the same pattern in
`cloud-installation.ts` and `cloud-translation.ts`; these four predate it. Found by its review
(2026-10-15), not measured against a real Cloud.

## Loose ends left by the SQLite failover-loop prototype gate

**Loose ends left by the SQLite failover-loop prototype gate (#425; receipts in
[the results note](../research/2026-09-16-sqlite-failover-prototype.md)).**

- **Validate every supported object store.** Topology §12.2's real-store gate remains open; the
  conditional-write promotion tie-break must be demonstrated on each target (risk 11). Waitron
  Cloud's production store still needs its own run.
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

**Task 1a** (#548, each machine's own rows keyed by its node id). Deny's delete is the one
join-request node filter no test fails without (the `requirePending` read before it already
refuses another node's row); and the run-it review did not reach three claims within its budget —
holders torn by a concurrent promotion, credential sealing, and scheduler takeover. Left open by
SQLite slice 2.

## Loose ends left by SQLite slice 2 Task 9a

**Loose ends left by SQLite slice 2 Task 9a (#630, the first start after a restore).**

- A node row holding no endorsement still signs `endorsements: []`, and no first-start case
  asserts it.
- A comment claims more than the code keeps: `retireSelf`'s header (`apps/server/src/retire.ts`)
  says a signing failure "leaves the node exactly as it was". Signing empties pending
  `change_log` rows (measured by #655's Codex seat), so they are not strictly untouched; no case
  losing a real one is known. Narrow it the next time the file is edited.
- [Restore fencing when the cloud peer does not answer](#a-restored-box-whose-cloud-peer-does-not-answer-during-its-first-start-signs-the-next-term-and-removes-the-marker).
- The pointer's term is taken without checking its signature, as the supervisor already does, so
  whoever can write the bucket can push a restored box's term up (never down).
- A sell-only local secondary that is not fenced runs the first start and signs the next term.
- [Trust in the restored copy’s own keys](#the-restored-membership-rows-check-assertrestoredmembershipvalid-678-trusts-the-keys-the-restored-copy-holds).
- [Signature checks outside the restore first start](#only-the-start-that-finishes-a-restore-checks-the-rows-signature).
- [Curated refusal for malformed membership with no restore marker](#on-a-start-with-no-restore-marker-text-that-is-not-json-or-a-machine-list-that-is-not-a-list-fails-with-the-generic-text).
- A mirror that deferred its first start and is then promoted without a restart
  (`promoteMirrorToPrimary`) keeps the bucket copy held, reading off with the reason
  `first_start_pending` and raising no alert, until the box next starts. From reading, not a run.

## If a later slice moves local tables into node.db

**If a later slice moves `local` tables into `node.db`** (slice 2's design reserved it for slice
5), that slice decides again how the drain crosses the two files: SQLite refuses a trigger body
that writes another attached database, so either `change_log` is reclassified to the file its
writers live on, or the triggers stop writing it directly and something above them does (P3). Left
open by SQLite slice 1 (#490 and the preparation tasks).

## A promoting standby may list itself with an empty contactUrl

**A promoting standby may list itself with an empty `contactUrl`, so no till is told to dial it.**
Nothing the #600 review could find copies `node_membership` from the primary to a standby. A
standby whose own held membership list omits it takes the fallback in `nextStandings`
(`packages/membership/src/standings.ts`), which appends it with an empty `contactUrl`, and
`routableServers` (`packages/membership/src/fence.ts`) then drops it. Found by reading, not run.
[Detail](../backlog/replication-cloud.md#replication-membership--failover--residuals-afterwards)
