# Replication, failover and the cloud — detail

The open entries are listed in [the backlog](../backlog.md), under "Replication, failover and the cloud".

## A1018. Agree and build the hosted writer stop-proof contract

**Owner design approval, 24 October 2026, 04:07.** The owner approved the
[current design](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md)
as published at Waitron `2c13c7f55dd53a6a7b4d4423ccdc166df5af7397`: both Harbour
Kitchen handovers (§§8–9) and the retained defaults (§§3, 5 and 7). M2 alone handles
AEAT after either takeover; returning M1 transfers only fiscal originals and
received AEAT outcomes.
The owner gave build authority on 2026-11-01. The
[build plan](../superpowers/plans/2026-11-02-a1018-handover-build.md) sets the formats as
[local-only, version 1](../superpowers/plans/2026-11-02-a1018-handover-build.md#formats-local-only-version-1),
and the A947 amendment is written (the dated A1018 block at the top of the
[A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md)). Its
[two owner questions](../superpowers/plans/2026-11-02-a1018-handover-build.md#questions-for-the-owner)
were answered (a) by the owner on 2026-11-02: Q1, returned invoices count in modelo 303 (Slice
12b, pending the venue's tax adviser); Q2, the emergency takes the next free minute. Physical runtime
qualification on real boxes remains the owner's, after A947 3b/3c
([owner task](../superpowers/plans/2026-11-02-a1018-handover-build.md#owner-task-physical-qualification-on-real-boxes)).

**Built so far:** Slice 0 (docs, main `b0e22a9feb`), Slice 1 (#2417: `@waitron/handover`, the
handover tables in `node.db`, the server's handover store and signer), Slice 2 (the stepdown and
the restricted start), Slice 3 (#2436: a box asks the other box before it sells, and waits if it
cannot reach it), Slice 4 (the final copy and its indicator), Slice 4b (A764: every payment
records the box that started it, and each box's card sweep resolves only the payments it owns; what
it leaves open is under _Payments and card readers_ in [the backlog](../backlog.md)), Slice 5 (the
controlled handover's server half, proved only by a simulation of two boxes in one process and
reachable on real boxes after A947 3b; what it leaves open is under _Replication, failover and the
cloud_ in [the backlog](../backlog.md)) and Slice 9
(S2's Parts F and G and three controls in `bench/sqlite-failover`; S2's row reads PASS since the
owner's reading of 2026-11-03, see below).
Left for the slices that add the callers:
- A delayed `waitHandover` can overwrite the waiting reason a later step recorded.
- `currentBinding` (no taxpayer row) and `waitHandover` (unknown operation) treat a missing row as a
  fault in Waitron; the handover's routes check for a held chart first but refuse no missing
  taxpayer row with a code.
- A restriction already recorded is never rewritten (`handover.restriction_conflict`), so Slice 3
  and Task 10.3 skip the write when one exists.
- `@waitron/membership` checks the endorsement count twice (`src/verify.ts`); deleting either
  check alone fails no test.

Left by Slice 2:
- `stepDown`'s replay check reads only this process's in-memory record of its first call, a
  restricted box never builds a `stepDown`, and nothing checks the binding's `sourceNodeId`
  against this box: the first route to reach `stepDown` (Slice 3's Task 3.3) must decide each,
  and whether `handover.operation_conflict`'s wording fits a stepdown's refusal.
- A restricted box's `/health` body is the same as a box whose trading is not admitted yet, so an
  operator reading it cannot tell the two apart.
- The `handover.stepping_down` refusal names no next step.
- A streamed download leaves the gate's count when its response returns, before its body ends.
- The close-deadline log does not name the step still running.
- A drain stopped early reads as a successful pass to `/health`'s last-success time.
- Boot passes `pendingCardController.signal` to both `pendingCardPass` and its loop; the compiler
  requires a signal there, but nothing checks it is the loop's own.
- `withPendingSweep` never reads the stop signal itself: it hands it to each provider's
  `resolvePending` and still calls the remaining providers after it is raised.
- The four new server-starting test files (`boot.restricted*.test.ts`,
  `handover-stepdown.real.test.ts`, `handover-stepdown.crash.test.ts`) each rebuild the boot
  setup by hand; three carry their own clock-watch mock (`boot.restricted-quiet`,
  `handover-stepdown.real`, `handover-stepdown.crash`) and three their own drain stand-in
  (`boot.restricted`'s files nothing; the two `handover-stepdown` files fake AEAT's transport),
  instead of sharing them through `apps/server/src/testing/` (`copyMigrationsRoot` already exists
  there).

Left by Slice 9 (the S2 re-run, [research note](../research/2026-09-16-sqlite-failover-prototype.md#s2-re-run-with-a1018s-return-batch-2026-11-03)):
- S2's row reads PASS (owner, 2026-11-03): its gate is read from the new parts F (return batch
  from a fenced sender) and G (replay), and the old parts D and E's second half, which still model
  the tail ship from an unfenced sender and file a sale twice, are controls of the retired design
  ([research note](../research/2026-09-16-sqlite-failover-prototype.md#s2-reads-pass-the-owners-reading-2026-11-03)). The plan's gate for Slices 10 and 11 is met.
- The third control (no "being sent" → "waiting" return) shows a record never filed, not a second
  filing as Task 9.2 expected: the rig's filing run picks up only waiting rows.
- No control drives the receiver's per-chain pause; a one-off run on a throwaway copy with the
  pause ignored filed record 1 twice.

Left open by Slice 5a (the relinquished fact: a promotion whose old box relinquished filing stores
a version 2 approval):
- The context builders put their fixed fields before `...binding`, so a binding key such as `mode`
  would override one (`emergency-preparation.ts`); no test shows the binding's key checks stop that.
- In `hour-recovery-preparation.ts`, removing `promotion &&` from the offline rule or from `select`
  fails no test (the first is redundant).
- `node-operation-preparation.test.ts` has no promotion case that passes
  `oldMachineRelinquished: false` explicitly.
- `backup-verification-history.test.ts`'s `relinquishedPromotion` helper repeats about 55 lines of
  `activation()`.

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
direction and S2 full-state/replay controls. The A947 amendment (2026-11-02) covers §§6.3, 6.4,
7, 7.1, 7.2 and 11: the checkpoints, the fiscal-only tail, business reconciliation and the
archive's deletion, not a reversal of emergency filing ownership.
Cold restore stays an explicit fresh-chain/data-loss choice with its existing recovery
source, operation, key and sole-recovery gates, no new hard-stop demand and no silent fallback.

The shared Cloud contract home remains `docs/waitron-integration-contract.md`
in the Cloud repository.
Four questions for Cloud were sent on 2026-11-02 to the campaign watcher for Cloud's lane G: the
authentication bridge, the declaration's provider-resource field, a hosted M2 not in M1's chart,
and Cloud's resource journal bound to the same operation. No local slice waits for the answer.
Wire formats for a Cloud placement, Cloud authorisation mapping and joint behavioural/adverse
controls remain open; no provider work is authorised.

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

The implemented Cloud connection screen and manager adapter; publication of box-side networking;
first-contact trust bootstrap; and the cloud-standby end-to-end
proof. **Do not restart the cloud-standby work until the Waitron↔Waitron-Cloud boundary contract is
settled.** The proof to run then: on-prem primary → adopt → mirror → human promotion → tills reroute
to the promoted cloud → the venue sells and files. Local maintenance requirements remain in
[Box maintenance and remote support](../superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md);
its cloud support-service proposal is tracked in Cloud and is not approved by this move.

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
was put in `venue.db` (#548), and since A947 slice 3a only a box's own tables are in `node.db`. Read the residuals below as requirements for what failover is
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
  reserved identity on every boot and refuses with `mirror.venue_not_copied` while the database has
  no venue row. The refusal precedes the standby node insert and does not depend on its foreign key.
  **Operator-visible consequence:** a box that adopts stays in adoption-pending boot for good — `/api/box/status` keeps
  answering `adoption: pending`, no mirror session or node-scoped read path is ever mounted, and each
  boot logs `adoption.establish_failed`. The pending-file invariant is recorded in
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

## A1205: more than one spare box at a venue, after go-live (owner, 2026-10-29)

Today a venue
has one main box and at most one spare: Litestream 0.5 streams a database to one place only, so
the main box streams to a store on the spare and the spare passes it on to the bucket
([A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md), "The main box
streams to an S3 store that runs on the spare box"). The owner's idea: a till box (A1203) is
similar hardware, so it could also be a spare. Needs a design: how a second spare receives the
stream, which spare takes over, and how alerts and the update order (A950) work with two.

## A1171: the address forms need a provider from the Cloud address-lookup bridge

Nothing hands
`wt-address-lookup` a provider yet. Waitron Cloud's proposed design also asks for provider
attribution beside the list, a confirm call at Save, an allowance message, a province inferred
from a postcode shown for review, its own session token, and the provider's area codes turned
into the pack's. When the search first shows, the guides that describe these forms gain a line: the
till's full-invoice section in `table-service.md`, and the "Full invoices" entry's "Who receives
it" ("Destinatarios" in es) and the invoice notice in `data-protection.md`, en and es, with the
emailed notice in `apps/server/src/i18n/invoice-email-notice.ts`, since the provider then
receives what staff type into the till's address search and which suggestion they pick. Left
open by A1171.

## The waiting start's loose ends

Left open by A1018 Slice 3, each read in review rather than run:
- A refused stepdown leaves `steppingDown` set (`apps/server/src/waiting-start.ts`), which stops
  the re-ask and turns a carry-on away, so the box stays waiting until its process restarts.
- A stepdown request in flight on the waiting app after the wait ended (a carry-on finished, or a
  peer answered) writes the restriction and restarts the box, but its close does nothing, so the
  continuing start runs until the restart. Untested.
- `node-entry` releases its venue-folder hold when the waiting server returns
  (`apps/server/src/node-entry.ts`, its rule 5), before the start has finished; the open store holds
  the venue lock meanwhile.
- The dev entry's relaunch path into `failedLater` (`apps/server/src/first-setup-launch.ts`) has no
  test of its own; it uses the same wrapper as the tested first launch.

## The peer-status route's minor follow-ups

Left open by A1018 Slice 3 (`apps/server/src/peer-status-api.ts`):
- A bad signature from a box the chart knows answers 403 `handover.peer_unknown`, not 401.
- `operationId` is checked as a 1–64 character string, not as a UUID.
- The route, and the two handover source routes (Slice 4, `apps/server/src/handover-source-api.ts`)
  through the same `verifiedPeerQuery`, read a body of any size, read the chart and unseal this
  box's key before the signature is checked; a small body limit, or checking the envelope's shape first, would bound it.
- Slice 5's routes read the same way. A real mirror start took a 30 MiB unsigned body on the offer
  (`apps/server/src/handover-destination-api.ts`) and answered 400 after reading it, and an unsigned
  64 MiB body on the acceptance (`apps/server/src/handover-source-api.ts`) was buffered and parsed
  before its 400. Neither sets a `bodyLimit`, as `cloud-api.ts` does.
- `boot.adoption-allocation.test.ts` imports from `@waitron/db` twice, and its pending-adoption
  case repeats its sibling's setup; `boot.restricted.test.ts`'s full-start case checks only the
  answer's shape, not its signature.

## The handover summaries' and checks' minor follow-ups

Left open by A1018 Slice 4, each checked by reading the code, not run:
- In `packages/fiscal-verifactu/src/handover-summary.ts`, `ENVIO_STATES` and the acks column list
  are hand copies that no test ties to the schema; a misspelt column becomes the text
  `"undefined"`; a head lookup that finds no row gives an empty head instead of an error.
- `checkFiscalChains` (`packages/fiscal-verifactu/src/handover-chain-check.ts`) repeats the table
  query `walkFiscalChains` makes and converts its count to a bigint needlessly; no test drops a
  single fiscal table; a copy without the `nodes` table throws a raw error.
- `summariseOpenPayments` (`packages/payments/src/handover-summary.ts`) lists pending manual card
  refunds, though nothing on the new box would chase one (the refund recovery selects only
  connected refunds).
- `scripts/handover-manifest-complete.test.ts` has no reverse check: a manifest row naming a table
  or file that no longer exists still passes.

## A selling box that takes a newer chart naming another main box keeps selling and filing

A1342. The owner chose on 2026-11-05: settle it before A947 3b lands, and a box that sees another
main box stops selling. Left open by A1018 Slice 5 (Ruling R42). `apps/server/src/node-membership-api.ts` and
`apps/server/src/boot-peer-check.ts` stop a box only when the chart fences it (`isFencedStanding`),
and a third box's promotion leaves a box `serving-secondary`, which does not fence. Run through real
starts on the Slice 5 branch; on main since #2436. It needs a third box promoted over a running main
box, so no real venue reaches it before 3b.

The same class, from the 5.8b review: a chart naming a third box main with M2 `serving-secondary`,
saved after the role, then a kill: the real start answers `acceptingSales: true`, with M2 `activated`
and primary, and the third box is not asked because it has not joined. That chart was hand-signed
with M1's key. `nextStandings` would give `sell-only`, which does fence, but only for a box that was
main in the chart it minted from; a third box promoted from M1's first chart would leave M2
`serving-secondary`, which was not run.

## After a handover the new main box gives no certificate expiry warning

A1341. FISCAL. The owner chose on 2026-11-05: fix it before A947 3b lands, so the certificate's records
and warnings carry over to the new main box. Left open by A1018 Slice 5 (Ruling R51). Every reader looks the record up
by this box's node id, and the only row, inside the copy, names the old box: `certificate-card.ts`,
`certificate-alerts.ts`, `certificate-reminders.ts`, `certificate-diagnosis.ts`,
`certificate-install.ts`, `provisioning-secret.ts`, and its own SQL in
`backup-verification-secrets.ts`. Filing reads the sealed certificate, not this record.

Run on M2 after the whole simulated handover, with M1's certificate 5 days from expiry:
- no certificate alert, where M1 had `fiscal.certificate_expiring`, and no reminder email;
- the card reads "Installed: not recorded" with a "Replace certificate" button and no dates (the
  words are read from the card's code and a browser case);
- a backup of M2's file fails the certificate check as `invalid`;
- the sealed certificate opens, with the same fingerprint, and a real mutual-TLS request using it
  answered 200, and a renewal works.

Read, not run: when the certificate expires, sales go on and records wait, and the first thing that
speaks is `fiscal.submission_delayed` about 4 hours later, with nothing naming the certificate.
`handover-controlled.e2e.test.ts` records the missing record as `it.fails`.

## A placed copy can lose a newer chart

Three points from the reviews of A1018 Slice 5's placing, left open by that slice:
- A newer chart still naming the old box is lost at placing, so M2 then mints below a term another
  box may hold, and such a box would answer `not_newer`. Not run for that exact case.
- The check judges by who is main and ignores the term. With the copy at term 5 naming the old box
  and the old file at term 4 with a third box main, a real start did not place and waited on
  `handover.source_no_longer_main`, where placing was safe.
- Ruling R41's way back loses the chart that cleared the wait: after a start that placed, the chart
  read term 3, not 7. The superseded term 6 sent again was then accepted, which stops activation (the
  safe side). With no re-send M2 would mint term 4, below the 7 others hold.

Nothing real mints a chart naming the old box after a third box's promotion (read); the tests' way
back is signed by M2's own key. `mintNextMembershipDocument`'s `minTerm` exists if a ruling wants it.

## The module preparation file grows with every write, and a handover cannot promise room in it

Left open by A1018 Slice 5 (Rulings R29, R30). `module-preparation-state.json` repeats all earlier
entries in every revision and is capped at 1 MiB; a venue needs about 20 attempts to get near (Ruling
R30's figure), with no handover involved. At the limit every later module operation refuses
`setup.attempt_invalid`.

`modulePreparationMergeFits` (`packages/provisioning/src/module-preparation-state.ts`) estimates room
from the file itself for three writes now: the dormant setup, the wait and the selection. **Any
further write can still fill the file**, so it is a check on the likely shapes and promises nothing.
If it does fill, M2 fails to activate after the old box has given up filing, with no exit but the
file's owner clearing it. The cure is a format change: stop repeating the earlier entries, or lift
the cap. The owner sees this in Slice 5's PR.

## A waiting spare repeats work and log lines with no back-off

Left open by A1018 Slice 5 (Ruling R53). Each was a review's point, none loses data or files anything
wrong, and none is reachable on a real box before A947 3b.
- **A copy with a dangling row is fetched again for ever.** A real duty at the 5-second tick, a real
  download from the real route over 17 seconds, with the row written into each downloaded file
  standing in for an old box holding it: 4 whole fetches, the old box stopped, no back-off, and a
  `handover-destination.waiting` line each pass. On this branch nothing gets the old box out: from
  `source_stepped_down` the only moves are `filing_relinquished` or `replaced`
  (`packages/handover/src/states.ts:35`), moving a real old box to `abandoned` threw
  `handover.step_out_of_order`, and no code outside tests writes `emergency_declared`. A person's way
  out is Slice 7's emergency declaration. A check for such a row on the old box before it stops
  selling would avoid the stop; not built. `compareRetryMs` (60 s) does not apply to a refusal the
  spare fetches again.
- `handover.final_copy_changed` and `handover.summary_failed` repeat every 5 s.
- `handover-destination.post_failed` warns on every tick, about 17,000 lines a day with the old box
  off, for as long as the wait lasts.
- A closed operation's folder that could not be removed is tried again only when the duty starts and
  on a pass that finds no work, so it stays, with a whole venue's copy in it, while the duty has
  another operation to work on, and after the duty closes one itself until the next wake or start.
- With nothing free on the disk, every tick logs `handover-destination.waiting` and `pass_failed`
  `storage.disk_full`, and the named reason is not stored (a real 0-byte filesystem).

## Slice 6's list: the handover words no screen shows yet

Left open by A1018 Slice 5 (Ruling P29 allows such words until a screen shows them; Ruling R53). This
is read from `apps/dashboard/src/i18n/codes.ts` at Slice 5's tip, and which words name a next step is
a reader's judgement.

**The list's two names:** the words call the chart both "list of boxes / lista de equipos" and
"list of servers / lista de servidores" (`source_no_longer_main` and its neighbours); pick one.

**No words at all:** `provisioning.database_ahead`, a compare reason the duty stores and the status
route answers (`apps/server/src/handover-compare.ts`).

**Words naming no next step:** `stepping_down`, `known_handover`, `peer_unknown`, `not_stepped_down`,
`operation_unknown`, `final_copy_changed`, `not_a_spare`, `membership_mismatch`, `not_main_box`,
`venue_not_supported`, `destination_not_spare`, `destination_not_joined`, `destination_unaddressable`,
`backup_settings_differ`, `modules_differ`, `key_ring_mismatch`, `indicator_untrusted`, `chain_broken`,
`preparation_state_too_large`, `summary_mismatch`, `summary_unreadable`, `copy_lacks_destination`,
`authoriser_not_permitted`, `preparation_state_unusable`, `accepted_copy_missing`,
`indicator_mismatch`, `copy_check_failed` (all `handover.`).

**Words false, or misleading, where they appear:**
- `operation_in_progress` says "or abandon it", and the spare has no way to abandon. "Start a new
  handover" gets this code until the spare closes its copy.
- "Unreadable" settings: `settings_unreadable` and `destination_settings_unreadable` name a repair a
  person with no terminal cannot do. The first says "keeps selling" even if a newer chart stops the
  box during the status query, and the second says "start a new handover" with the old box stopped.
- `destination_unreachable` says "This box keeps selling" when a chart arrives during an offer that
  then fails, on a box that is stopping; `restarted_before_stepdown` says the same when stored after
  a chart naming no main box.
- `source_unreachable` also covers a local disk error on the spare, a real full disk on the old box
  (its 507) and a chart with the old box gone from it, and says "Nothing was changed".
- `not_main_box` says "Nothing was changed" when also answered after `abandoned`.
- `key_ring_mismatch` says "this box uses", the wrong box when the spare shows it.
- `indicator_mismatch`, `copy_check_failed`, `not_stepped_down` say nothing changed, reused at
  `copy_accepted`, after the spare accepted.
- `copy_damaged` says "damaged" and "fetching it again" for a row the old box itself holds, which a
  fresh fetch cannot cure.
- `no_room_to_place` with nothing free is not stored, so the screen shows the earlier reason.
- A module's name in `chain_broken` or `summary_mismatch` reaches only the log.
- The recovery page's entries for `accepted_copy_missing`, `copy_mismatch` and
  `preparation_state_unusable` offer only a retry.
- A third box is main: there is no way out to offer yet (see "A new box has no way out while a third
  box is main").
- Spanish uses both "traspaso" and "cambio de servidor"; pick one.

## A1185: a venue not yet connected sees no prices

The Cloud services screen shows the plan
and prices only once connected, because Cloud's "Venue billing display, version 1" answers a
paired installation alone; whether Cloud publishes a price list anyone can read is an open owner
question (2026-10-29). Until then the screen offers only "Create a Cloud
account". Left open by A1185.

## A1188. Someone at the venue can start the venue in the cloud when the box has died (owner, 2026-10-29)

Part of A1018 and Cloud's P6. The tills learn the venue's cloud address and
show the emergency link to an administrator when the box disappears. The locked copy Cloud
restores after a valid emergency code offers only an administrator sign-in; a manager
holding `node.promote`, signing in with password and authenticator code, makes A1018's
declaration that the box is off, and only if the Cloud owner agreed in advance.
[Cloud billing design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-29-cloud-billing-design.md) §7.
Design approved 2026-10-29: administrators by default, and other roles once A1002 lets a venue
give them the permission; printers and drawers wait for A1175's Android app, while card readers
follow, being reached over the internet (owner, 2026-10-29).
Building waits for A947's strip and Cloud's half:
[A1188 design](../superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md).

## A947 3b must make the held chart vouch for a joined box's key, or the main box can never check its answer and waits at every start.

The start check verifies a peer's signed status with
`peerKeyOf` (`apps/server/src/handover-signing.ts`): this box's own key, the main-box key a spare
pins at adoption, and keys the held chart's endorsements vouch for. A main box holds none of
these for its spare, so once 3b makes a spare finish joining, the spare's answers count as
silent. No box has a joined peer before 3b. 3b must also give each box its own address in the
chart: by default both advertise `https://waitron.local` (`deploy/Dockerfile`, sent at
`apps/server/src/adopt.ts:109`), and the check never asks a peer at its own address. Left open by
A1018 Slice 3 (Ruling R13).


## The boot peer reconcile cannot reach a real box's certificate.

`fetchPeerMembershipDocument`
(`apps/server/src/membership-reconcile.ts:66`) calls the plain global `fetch`, which refuses a
leaf from a box's own authority, and it sets no time limit. `git blame` shows the line from
e82588f349 (2026-09-08, "Outbox → native logical replication", #280), so it predates A1018. The
start check's transport (`askPeerStatus`, `apps/server/src/boot-peer-check.ts`) pins the
authority a spare holds, or skips the check behind its signed answer. Found by A1018 Slice 3's
review.


## The membership route ignores a different chart at the term this box holds.

The start check
counts a trusted chart at the held term with another body that fences this box, and names
another box as serving primary, as a takeover
(`apps/server/src/boot-peer-check.ts`), but `POST /api/node/membership` answers `{ accepted: false }`
and steps nothing down (`apps/server/src/node-membership-api.ts`). Left open by A1018 Slice 3.


## The start check may still stop for a chart whose signer was evicted while it asked.

If a
chart that fences this box is refused at the save because a chart committed during the check
evicts its signer, the check still answers "superseded" and names that chart's serving primary
as its successor. Read, not run. Left open by A1018
Slice 3.


## A spare learns it has no room to place the copy only after the old box has stopped selling.

The duty does not post its acceptance without room for the copy and the start floor, and waits on
`handover.no_room_to_place` (`apps/server/src/handover-destination-duty.ts`), but the old box has
stepped down by then. Finding it while the old box still sells needs the old box's database size
in the offer. Left open by A1018 Slice 5 (Ruling R35).


## A handover's manifest has no row for the box's other state-folder files.

`recovery.json`,
`setup-operation.json`, `restore-request.json`, `reset-request.json`, `cloud-replacement.json`,
`backup-room-note.json`, `spare-space` and `<state>/handover/<operationId>/` are not in
`packages/handover/src/manifest.ts`; whether a handover needs rows for them is not decided. Left
open by A1018 Slice 4 (Slice 4's Ruling R5).


## A hung integrity check on a copy has no time limit.

Only an answer, an exit or a stop ends the
wait, so the duty would wait with no reason recorded, and the frozen-process watchdog does not see
it (read, not run). A stop asks the thread to end and answers when it has, or after `STOP_WAIT_MS` with the file
possibly still open: a running `integrity_check` does not stop for it. Left open by
A1018 Slice 5 (Ruling R53).


## Bundle A1401: Find out why the failover bench reports a corrupt database

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Loose ends left by the SQLite failover-loop prototype gate.** Validate every supported object
  store. A promoted node's generation and Cloud's recovery orchestration remain; settle the
  Waitron ↔ Waitron Cloud contract before assigning them.
  [Detail](replication-cloud.md#loose-ends-left-by-the-sqlite-failover-loop-prototype-gate)
- **The bench's S3 sometimes throws `database disk image is malformed`.** Seen 2026-11-03 on one
  Mac in 5 of 14 whole-table `bench/sqlite-failover` runs, including 1 of 7 with S2's file from
  before A1018 Slice 3, so it also throws with main's bench code; S3 run alone passed 2 of 2. Cause not
  investigated.

## Bundle: Series and module-preparation gaps at handover

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A dormant setup held from an earlier event can drop a series the old box added; settle before
  Slice 13 or 3b-F.** The switch-on then activates on the old series and says nothing (run, A1018
  Slice 5's Ruling R39). Beside it: a second live standard series made a sale answer a plain
  `server.internal` 500 in a test fixture, cause not traced.
- **The first hand-back is refused after the giving box has stopped filing; settle before Slice 13
  or 3b-F.** M2 to M1 answers `sif.allocation_invalid` `standby_already_active` at the first request,
  because M1's registration stays active (run on a promoted database standing in for the copy).
  Left open by A1018 Slice 5 (Ruling R40).
- **The module preparation file grows with every write, and a handover cannot promise room in it.**
  Every revision repeats all earlier entries under a 1 MiB cap. The handover's size check keeps room
  for three writes now, and any further write can still fill the file. Left open by A1018 Slice 5
  (Rulings R29, R30).
  [Detail](replication-cloud.md#the-module-preparation-file-grows-with-every-write-and-a-handover-cannot-promise-room-in-it)

## Bundle: Check everything at the offer, while the old box still sells

3 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A spare learns it has no room to place the copy only after the old box has stopped selling.**
  Left open by A1018 Slice 5 (Ruling R35).
  [Detail](replication-cloud.md#a-spare-learns-it-has-no-room-to-place-the-copy-only-after-the-old-box-has-stopped-selling)
- **A spare needs the main box's backup settings, and nothing carries them yet.** The owner's answer
  (2026-11-04): joining gives `backup.env`, later changes follow, and a spare that was off catches
  up. Until then a venue with a recovery key is refused `handover.backup_settings_differ` at the
  offer, the main box still selling. Goes in A947 3b's plan, with A1273. Ruling O3.
- **A different key under the same version passes the handover's comparison.** It compares ring
  versions only, so M2 places a copy whose sealed rows it cannot open, and filing then refuses (both
  run in a test). A real join copies the ring (`apps/server/src/adopt.ts`), so no real box reaches
  it today. Left open by A1018 Slice 5 (Ruling R49).

## Bundle: The spare's wait loop: back-off, reasons, stop signals

7 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A new main box's chart post says too little in its log.** `chart_not_accepted` cannot tell a
  refusal from a chart the old box already holds, because the route answers one boolean, and a
  switched-off old box logs only `AggregateError`, with no ids. A fix to the route's answer needs a
  ruling. Left open by A1018 Slice 5 (Ruling R53).
- **A waiting spare repeats work and log lines with no back-off.** A copy with a dangling row was
  fetched whole 4 times in 17 s with the old box stopped, and other waits log every 5 s. On this
  branch nothing gets the old box out of that; a person's way out is Slice 7's emergency declaration,
  and a check for such a row on the old box before it stops selling is not built. Left open by A1018
  Slice 5 (Rulings R53, R56).
  [Detail](replication-cloud.md#a-waiting-spare-repeats-work-and-log-lines-with-no-back-off)
- **The spare's digest of a copy takes no stop signal.** A stop during it waits for the read to end;
  the cost on a large file was not measured. Left open by A1018 Slice 5 (Ruling R53).
- **A hung integrity check on a copy has no time limit.** Left open by A1018 Slice 5 (Ruling R53).
  [Detail](replication-cloud.md#a-hung-integrity-check-on-a-copy-has-no-time-limit)
- **A throw while checking a copy leaves no reason a person can read.** It reaches only the log, with
  the old box stopped (run with a journal with no `hash` column). Left open by A1018 Slice 5 (Ruling
  R53).
- **The spare's folder clean-up reads any `readdir` failure as an empty folder.** A refusal to read
  ends either sweep with no log line and leaves a closed operation's venue copy
  (`destinationOperationFolders`, `apps/server/src/handover-store.ts`, read, not run). Left open by A1018 Slice 5 (Ruling
  R53).
- **A box can refuse its start while its `venue.db` already holds the accepted copy.** Killed just
  after the swap with `accepted.db` then lost, two faults, entry's open has changed the digest, so
  the start refuses `handover.accepted_copy_missing` (run). Left open by A1018 Slice 5 (Ruling R53).

## Bundle: Re-read old failover lists after 3b, delete what it retired

6 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A completed provision or adopt operation replayed on a later request still answers 200 without
  restarting and keeps the setup lock set.**
  [Detail](replication-cloud.md#a-completed-provision-or-adopt-operation-replayed-on-a-later-request-still-answers-200-without-restarting-and-keeps-the-setup-lock-set)
- **`docs/developers/conventions-data.md`'s `busy_timeout` receipt … should carry the date and Node
  version the deleted comment had.**
  [Detail](replication-cloud.md#docsdevelopersconventions-datamds-busy_timeout-receipt--should-carry-the-date-and-node-version-the-deleted-comment-had)
- **The boot-time fetch is given only the URL … and boot never reads the `superseded` that
  `reconcileMembershipOnBoot` returns.**
  [Detail](replication-cloud.md#the-boot-time-fetch-is-given-only-the-url--and-boot-never-reads-the-superseded-that-reconcilemembershiponboot-returns)
- **Replication, membership & failover — residuals.** Until slice 3 a venue has ONE node and no
  failover at all. Read the residuals as requirements for what failover is rebuilt INTO, not as
  descriptions of code that exists today.
  [Detail](replication-cloud.md#replication-membership--failover--residuals-afterwards)
- **Task 1a** — Deny's delete is the one join-request node filter no test fails without. Holders
  torn by a concurrent promotion, credential sealing and scheduler takeover remain unverified.
  [Detail](replication-cloud.md#task-1a--node-filters-and-unverified-concurrency-claims)
- **Loose ends left by SQLite slice 2 Task 9a.** A node row holding no endorsement still signs
  `endorsements: []`, and no first-start case asserts it. Restore fencing, membership trust and
  signature checks, curated refusals and promotion with a pending first start remain open.
  [Detail](replication-cloud.md#loose-ends-left-by-sqlite-slice-2-task-9a)

## Bundle: Everything needing a third box or a Cloud peer

8 entries, size L. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1205: more than one spare box at a venue, after go-live (owner, 2026-10-29).** The owner's
  idea: a till box (A1203) is similar hardware, so it could also be a spare. Needs a design: how a
  second spare receives the stream, which spare takes over, and how alerts and the update order
  (A950) work with two.
  [Detail](replication-cloud.md#a1205-more-than-one-spare-box-at-a-venue-after-go-live-owner-2026-10-29)
- **The membership route ignores a different chart at the term this box holds.** Left open by A1018
  Slice 3.
  [Detail](replication-cloud.md#the-membership-route-ignores-a-different-chart-at-the-term-this-box-holds)
- **The start check may still stop for a chart whose signer was evicted while it asked.** Read, not
  run. Left open by A1018 Slice 3.
  [Detail](replication-cloud.md#the-start-check-may-still-stop-for-a-chart-whose-signer-was-evicted-while-it-asked)
- **A new box has no way out while a third box is main.** At `copy_accepted` or `filing_assumed` it
  waits on `handover.source_no_longer_main`, and the emergency path refuses from those states (read,
  not run); at `filing_assumed` neither the old box nor the new one files. Slice 6 has to show it.
  Left open by A1018 Slice 5 (Ruling R43).
- **A healthy third box makes a new main box wait, with nothing wrong.** The chart it minted carries
  only its own endorsement and `peerKeyOf` does not read `nodes`, so the third box's answer is
  `not_verified` (`apps/server/src/boot-peer-check.ts`, run). A neighbour of A1276, a different
  symptom. Predates A1018 Slice 5 (Ruling R44).
- **A placed copy can lose a newer chart.** Placing replaces the old file's chart, so a newer chart
  still naming the old box is lost and M2 can mint below a term another box holds; placing's check
  ignores the term; R41's way back loses the chart that cleared the wait. Nothing real mints such a
  chart today. [Detail](replication-cloud.md#a-placed-copy-can-lose-a-newer-chart)
- **A1275: a Cloud peer's chart is refused on the checked paths** (promotion, retiring, adding a
  spare). [Detail](replication-cloud.md#a1275-a-cloud-peers-chart-is-refused-on-the-checked-paths)
- **A1276: after two promotions, a box can refuse the main box's chart**, in a venue of three or
  more boxes, when no key it trusts vouched for that main box; the refusal names no next step.
  Measured at the helper, not end to end.
  [Detail](replication-cloud.md#a1276-after-two-promotions-a-box-can-refuse-the-main-boxs-chart)

## Bundle: Which state files a handover carries; summary checks

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A handover's manifest has no row for the box's other state-folder files.** Left open by A1018
  Slice 4 (Slice 4's Ruling R5).
  [Detail](replication-cloud.md#a-handovers-manifest-has-no-row-for-the-boxs-other-state-folder-files)
- **The handover summaries' and checks' minor follow-ups.** Untested choices and hand-kept lists in
  the module seat, the Veri*Factu summary and copy check, the payments summary and the manifest
  guard. Left open by A1018 Slice 4.
  [Detail](replication-cloud.md#the-handover-summaries-and-checks-minor-follow-ups)

## Bundle: Recheck that a spare gets later charts

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A mirror keeps a renamed server's old chart (A917).** After a rename its copy would name the
  old address until it is paired again. No reader routing by a mirror's copy was found (not exhaustive).
  [Detail](replication-cloud.md#a-mirror-keeps-a-renamed-servers-old-chart-a917)
- **A promoting standby may list itself with an empty `contactUrl`, so no till is told to dial it.**
  `nextStandings` appends it with an empty `contactUrl`, and `routableServers` then drops it.
  Found by reading, not run.
  [Detail](replication-cloud.md#a-promoting-standby-may-list-itself-with-an-empty-contacturl)

## Bundle: The waiting start's stuck and stale cases

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The waiting start's loose ends.** A refused stepdown leaves it waiting until its process
  restarts, and a stepdown request still in flight after the wait ended restarts the box but closes
  nothing. Left open by A1018 Slice 3.
  [Detail](replication-cloud.md#the-waiting-starts-loose-ends)
- **The waiting page does not change when the wait ends.** A person already looking at it keeps
  seeing "This box is waiting for…" until they reload (`apps/server/src/waiting-page.ts`). Left
  open by A1018 Slice 3.
- **The carry-on page's unexpected-failure sentence does not call itself a fault in Waitron**
  (`failed` in `apps/server/src/i18n/waiting-page.ts`). A refused disk write lands there too, so
  the wording is a judgement call. Left open by A1018 Slice 3.

## Bundle: Decide what the old promote route still does

3 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **After a plain promote nobody sweeps the old box's open card payments.** That route writes no
  activation row, and a fenced box no longer sweeps, so a payment stays `attempting` until a person
  resolves it on the new box. A text search found no screen calling the route. Left open by A1018
  Slice 5 (Rulings R47, R48).
- **A failed promotion leaves `trading.env` behind.** `apps/server/src/promote.ts` writes it inside
  the transaction's body, so a failed activation leaves it written (run: false, then true). On main
  since at least #1587 (`git log -S`). A start with that leftover and no retry was not run.
- **A1279: a local secondary promotes only over a chart it signed itself.** No production caller.
  [Detail](replication-cloud.md#a1279-a-local-secondary-promotes-only-over-a-chart-it-signed-itself)

## Bundle: Size and attempt limits on box-to-box and handover routes

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **The peer-status route's minor follow-ups.** A bad signature from a known box answers 403, the
  operation id is not checked as a UUID, and a body of any size is read before the signature check,
  here, on the two handover source routes (Slice 4), on the offer and on the acceptance (Slice 5).
  Left open by A1018 Slice 3. [Detail](replication-cloud.md#the-peer-status-routes-minor-follow-ups)
- **Nothing limits sign-in attempts on a box's operation routes.** Handover preparation, activation
  and promote have no throttle, and one belongs on all of them. 32 attempts on an administrator's
  email held their sign-in about 0.8 s and 64 about 2.5 s, with no refusal; nothing larger was run.
  Left open by A1018 Slice 5 (Ruling R38).

## Bundle: Address search provider, province names, guide lines

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1171: the address forms need a provider from the Cloud address-lookup bridge.** Nothing hands
  `wt-address-lookup` a provider yet. Left open by A1171.
  [Detail](replication-cloud.md#a1171-the-address-forms-need-a-provider-from-the-cloud-address-lookup-bridge)
- **A1171: the dashboard's Venue card knows a province only by its code and main name.** The server's
  `provinces` list carries no other names, so a chosen address naming "Alicante" for
  "Alicante/Alacant" is not recognised there and is left to the server's postcode check at Save.
  Matters once a provider exists. Left open by A1171 parts 1–2 (#2191).

## Bundle: One signed request helper; strict reply readers

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **Four Cloud reply and state readers accept a one-item list where they want text.** Each turns
  the field into text before checking it, so `["ready"]` passes as `"ready"`.
  [Detail](replication-cloud.md#four-cloud-reply-and-state-readers-accept-a-one-item-list-where-they-want-text)
- **The signing and size-capped reading of a request to Cloud is repeated across the
  `apps/server/src/cloud-*.ts` files.** One shared helper would serve them all; left out of #1729
  as a refactor larger than that PR (its simplify review, 2026-10-15).

## Decisions and deliberate limits

**Owner decision 2026-11-04 — a minute name the old box selected but never activated counts as
used** (A1018 Slice 4's Ruling R3, landed in #2442). The handover manifest marks
`module-preparation-state.json` transferred, and Slice 5's Task 5.7 merges the old box's retained
selections into the new box's own preparation file, so a new box never takes such a name. The
alternative the owner declined: such a name does not count, and the row goes back to source-only.

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

- **A stray "relinquished" fact outside a promotion is left handled two ways** (owner,
  2026-11-03, answer (a) to Slice 5a's choice). A binding that carries `oldMachineRelinquished`:
  the emergency context builder (`packages/fiscal-verifactu/src/emergency-preparation.ts`) drops
  the key after `...binding` and stores an ordinary version 1 approval; the cloud restore check
  (`packages/fiscal-verifactu/src/cloud-preparation.ts`) keeps it and refuses the request
  `event_mismatch`. Neither writes a version 2 row, and no product code sends such a binding.
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

**Owner decision, 6 November 2026: A951-S replaces the earlier build.** The old private branch
stays parked. Use the existing Cloud gateway and one outbound WireGuard container. Staff use
password sign-in on the box; staff-host passkeys enrol separately. Venue devices keep using
`.local`, and local sales never depend on Cloud or the internet. Customer pages stay later.

The first cut adds an optional dashboard-only HTTPS listener, using the existing staff key and
certificate files. It excludes the setup and recovery pages, till, device, print and machine-operation routes and marks requests
remote before the box's own-device check. Password guessing keeps the existing backoff. The local
listener and its passkey hostname keep their configuration.

On 6 November a manual Chromium session used the public gateway to sign in to the test box
with its ordinary password and normal certificate trust, then opened its overview. Installing
an issued replacement changed new TLS connections without restarting the server. This was a Mac
client on the home network using the public Internet path. A fresh Chromium session then
repeated the password sign-in through the rented server's outside-home exit with normal trust.
The bounded test app and peer were stopped afterwards. At the owner's request a separate
managed demo then replaced them: the unprivileged app and its separate tunnel recovered from
controlled process exits, and the public page returned 200. Both are enabled for startup; a
physical box reboot remains untested. The owner's containers were untouched.
[Receipt: PR #2525](https://github.com/clintongormley/waitron/pull/2525).

On 7 November the five reviewed cuts on private `feat/a951s-integration` completed the fresh
test-box path. After pairing, the boot worker submitted the container's saved public key, wrote
its assigned placement, requested and installed the staff certificate, and opened the staff
listener without restarting. Chromium signed in through the public gateway with normal certificate
trust. A peer-container restart recovered the trusted public page. The bounded test stopped its
own fixture and peer afterwards; the earlier managed demo remains separate and running.
[Receipt and limits](../operations/a951-host-evidence.md#a951-s-automatic-staff-connection-7-november-2026).

Remaining work, following the owner's certificate-first order:

- Qualify the certificate worker on the managed public demo. The worker uses the existing signed
  submit/status exchange, resumes pending requests after restart and renews before expiry. A local
  TLS handshake observed the renewed chain without restarting the listener; no new public
  certificate was issued for that synthetic test.
- Finish publication of the combined build and its installation path. Its normal
  server bundle passed a bounded systemd run: Settings off survived an app restart and Cloud
  refresh, local sign-in worked, and on restored trusted public access with the same registration,
  key and certificate. Systemd app recovery and a peer-container restart also passed. The temporary
  unit, peer and network were removed; the earlier persistent demo is unchanged.
  [Receipt and limits](../operations/a951-host-evidence.md#bounded-managed-server-restart-7-november-2026).
  The Settings review repairs have local checks, including the remote-only confirmation, but
  their fresh managed/public run remains unrun. The private combined build removes
  `@waitron/tunnel`, its boot worker and its four relay settings. The staff listener is the
  remote entrance; it supplies no relay for standby adoption.
- Qualify the managed demo across a physical reboot.
- Verify reconnect, reboot, certificate renewal, wrong-venue refusal, revocation, a sale without the
  internet and separation from other venues and LAN addresses.
- Once the browser path works, try Translate all and the existing address fields with a Cloud
  provider on the test box. Provider keys stay on the gateway host and come from the owner.

The owner accepts that a compromised Cloud could obtain a staff certificate and intercept logins,
that the sign-in page and a bug in the remote entrance face the internet, and that this version
has no protected owner service, strict instant shutdown or independent protection against a
compromised box server. The A760 landing freeze and no-new-tables hold remain in force.

The [old plan](../superpowers/plans/2026-10-22-a951-connection.md) and its linked protocol and host
artifacts describe the parked implementation. They do not add work or gates to A951-S.

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
certificate fingerprint before it receives the venue's keys. Slice 3b's build
[plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md) was written on 2026-11-04:
eight pull requests, two of them fiscal and landed by the owner (3b-G, the start steps that decide
whether a box files; 3b-F, letting a Veri*Factu venue add a spare, which waits on the owner's
question Q1). Its build has not started. Slices 3c onwards are still open;
A1273 to A1285, A1295 and A1296 are the loose ends slice 3a left.
A1018's simple handover amends §§6.3, 6.4, 7, 7.1, 7.2 and 11 (the dated A1018 block at the top
of the [design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md), 2026-11-02).

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
