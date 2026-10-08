# Replication, failover and the cloud — detail

The open entries are listed in [the backlog](../backlog.md), under "Replication, failover and the cloud". This file holds
their full text.

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
box and its bytes go nowhere (both reviewers of that branch ran this). When a waiting client closes,
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

**SQLite + Litestream replaces PostgreSQL** (owner decision 2026-09-16). The architecture is
[SQLite + Litestream topologies](../superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
whose §11 is the build order. The failover-loop prototype gate is done (#392, #395, #406, #411, #415, #417, #422, #425;
[the results note](../research/2026-09-16-sqlite-failover-prototype.md)); its one
negative result, **S2** — a handed-over batch can re-file a sale the receiver already filed, which
costs one wasted AEAT call (error 3000, already read as filed) — produced the fence-before-ship rule
in topology design §5.2. The tag `pre-sqlite-migration` (`c9d80c59`) marks the last commit before
any of this code. **Slice 1, the storage swap, is complete (2026-09-23; F1 #489, T1 #490, T2 #492,
T3 #494, and its preparation tasks).** **Slice 2, stream and cold restore, is complete
(2026-09-25;** #513, #540, #543, #548, #554, #557, #560, #566, #569, #590, #619, #627, #628, #630, #642, #646
and #652, with follow-ups #573, #576, #594, #599, #608, #643, #647, #649 and #650).
**Next: slice 3, seats and promotion. Its first task is already decided: credentials move to a
venue key** stored in `venue.db` only in locked form — do not reopen it.

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

## Two comments claim more than the code keeps

**Task 9a** (#630, the first start after a restore — `apps/server/src/rebuild-first-start.ts`). A
node row holding no endorsement still signs `endorsements: []`, and no first-start case asserts it.
Open:

- Two comments claim more than the code keeps: `retireSelf`'s header (`apps/server/src/retire.ts`)
  says a signing failure "leaves the node exactly as it was", and `promoteMirrorToPrimary`'s
  (`apps/server/src/promote.ts`) says a failure before the commit "leaves the mirror as it was".
  Signing empties pending `change_log` rows (measured by #655's Codex seat), so they are not strictly
  untouched; no case losing a real one is known. Narrow both the next time either file is edited.

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
slice 3 a venue has ONE node and no failover at all.** The "MVP for go-live" requirement of two boxes
plus cloud failover is met by slices 3–5, not before, and it is accepted for exactly as long as
Waitron is pre-production. What stayed: `packages/membership` whole (documents, signing,
canonicalisation, verification, trust), node enrolment and its rate limiting
(`apps/server/src/node-enrol-api.ts`, `enrol-rate-limit.ts`), node retirement, and the
`ledger` / `state` / `local` classification — which no longer chooses a database file: every table
is in `venue.db` (#548). Read the residuals below as requirements for what failover is
rebuilt INTO, not as descriptions of code that exists today. A standby holds its full dormant
identity from JOIN and promotion never mints a chain.

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
  slice 3. Installing or renewing the certificate on the primary does not wait for this (A9).
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

From the Cloud connection integration (2026-09-24): Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS
override, gateway replacement and revocation.

From the shared account controls: Cloud has published private `@waitron-io/ui-core@0.1.0` (see the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md))
and owns the release workflow and account screens.

Cloud product and infrastructure work moved to the
[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)
on 2026-09-22: provisioning, cloud-only redundancy, trials, remote access, provider integration
and cloud operations. See [documentation ownership](../cloud-ownership.md).
