# Replication, failover and the cloud — detail

The open entries are listed in [the backlog](../backlog.md), under "Replication, failover and the cloud".

## A1018. Agree and build the hosted writer stop-proof contract

**Local completion audit, 14 November 2026:** A947 3b-F
([#3172](https://github.com/clintongormley/waitron/pull/3172), main 5cdf681c05)
adds the controlled handover and reset/rejoin emergency takeover test. Running
`pnpm --filter @waitron/server exec vitest run src/handover-two-boxes.test.ts`
on main 95275f0bca gives one pass and one failure: the emergency fixture at line 464 sends only the
preview's identifier and time; the declaration API requires its source too
(`handover-emergency-api.ts:152–155`, added by A1188 part 0, #3142).
It returns `handover.request_invalid` for `expectedCopy.source` before activation.
This contract mismatch still needs correction and a passing two-box run. Physical-box
qualification remains the owner's; hosted placements remain A1188 and A1505. The earlier
simulated-slice receipts below do not qualify those settings.

**14 November fixture correction:** the test sends the complete preview copy, retaining its
source, as the sibling declaration tests do. The command above now passes both cases, including
the fresh identities, invoice writes and preservation of the copied fiscal rows. Every existing
assertion is retained. This resolves the fixture mismatch between the separately CI-passed #3172
and #3142 branches; it changes no production request contract. Physical qualification remains open.

**Owner design approval, 24 October 2026, 04:07.** The owner approved the
[current design](../superpowers/specs/2026-10-23-a1018-simple-handover-design.md)
as published at Waitron `2c13c7f55dd53a6a7b4d4423ccdc166df5af7397`: both Harbour
Kitchen handovers (§§8–9) and the retained defaults (§§3, 5 and 7). M2 alone handles
AEAT after either takeover. The owner’s later returned-fact decision is recorded under
[Decisions and deliberate limits](#decisions-and-deliberate-limits); it supersedes the original
fiscal-only return boundary.
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
**2026-11-11 — Slice 7:** simulated clients can declare, prepare and activate the spare.
The signed declaration in `handover_activations.evidence` records the last dated activity
the copy holds; Reporting → Handover intervals now reads these committed emergency activations. The watcher
deferred both gap tables and the preview, and accepted no declaration withdrawal for this
simulated-only slice.
**2026-11-12 — Slice 8:** `/handover/emergency` on a joined spare checks the copy after sign-in,
records the one-way shutdown declaration and opens the existing clock check and activation.
A reload or another device resumes the saved declaration without declaring it again. A process
restart rechecks the copy against its signed declaration at activation. The page retains the one
entered password/code in memory and asks for a replacement only if the authenticator code expires,
as the watcher cleared at 03:59. Real-box and Cloud qualification remain open. The bounded
[page plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1018-8-emergency-page.md) was cleared by the watcher on 12 November;
the last checked address it needs is kept across restarts since A947 3b-5a ([#2898](https://github.com/clintongormley/waitron/pull/2898)), so it no longer waits on that.

The read-only interval list shows both current box names, the copy’s latest sale/order time or Unknown, labelled
venue-zone declaration and activation times, and the entered reason. **12a follow-up PR 1** adds a [warning beside sales/cash-up/category reports and VAT](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1018-12a-warnings-return-completion.md), linking report viewers to the handover dates. It does not identify affected report periods. The interval read remains passive. The [durable receiver completion work](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1018-return-completion.md) records accounted batch digests against the matched emergency takeover in venue.db; a complete advertised inventory confirms receipt across restart and later venue copies. Report warnings remain general date reminders; receipt does not reconstruct cash-ups or confirm missing activity and amounts. Already stopped senders need a restricted restart to resend; no backfill is performed. Acknowledgement, assignment and resolution remain outside this cut. A1342’s marker is now stored and returned invoices are listed. Reports show a general notice, without identifying affected invoices or periods; duplicates are not identified.

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
**2026-11-12 clarification:** the fiscal-only boundaries in this October agreement are historical;
the [later returned-fact decision](#returned-originals-and-their-recorded-facts-a1342-2026-11-10)
also carries the recorded payment facts without replaying live effects.
[Cloud #323](https://github.com/waitron-io/waitron-cloud/pull/323), signed
`08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec`, publishes the
[canonical correction](https://github.com/waitron-io/waitron-cloud/blob/08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018); full shared-contract SHA-256
`157556c31753ccf64cc9f8f0a7144f20683325231d212cd344e259b644366d02`.
Cloud accepts the revised direction at Waitron `d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`:
M2 alone handles AEAT after either takeover, preserving old originals' generating identities;
returning M1 transfers missing fiscal originals and all received outcomes without AEAT contact.

Cloud account, venue and operation authority must explicitly bind to the proposed
venue `node.manage` actor. Organisation ownership, support, purchase, matching email or a
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
recommended declarant holds `node.manage` with fresh passkey or password plus enrolled TOTP,
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

## Setup replay, incomplete adoption and membership trust

From source reading, a completed provision or adopt replay returns the recorded success without scheduling
another restart and leaves the setup latch set. `setup-api.test.ts` checks the adoption replay
and the successful-adoption latch separately; neither closes the restart gap. After a refused
resend of a half-finished adopt, the identity reserved on the primary and the local leftovers
remain unmeasured. The reset page still needs a way to identify this box in the primary's list.
From source reading, removal treats a `serving-secondary` entry with no `nodes` row as a standby
that never finished joining (A61, #708; `membership-removal.ts`).

The following remain source-reading findings unless a test is named.

**Still open after A63 (#712):** (i) a removed trust anchor can vouch for a non-anchor machine
unless the receiver's held chart supplies that machine's verifiable endorsement (see
`resolveSignerKey`); (ii) boot reconciliation's peer fetch sends no credential, while
`GET /management-api/membership` requires one, so that fetch cannot obtain a real box's chart
from this route. The HTTPS and boot tests supply a peer fixture; they do not qualify this
credential-free production path. (iii) A cleared machine is refused promotion by its own held
chart only once that chart contains the clearing. (iv) The primary's join and mint paths refuse
removed ids and full charts; the credential-free fetch in (ii) does not deliver those changes.
(v) A receiver with an older chart may accept a removed machine until it learns of the removal.
(vi) Bundle fetch passes only login refusals and `JOIN_REFUSALS`; removal and full-chart refusals
still become `mirror.bundle_fetch_failed`. (vii) Removing a live standby as though it never
finished joining could leave its later charts refused as `signer_removed`, logged without an
alert. That removal/promotion sequence on started boxes remains unmeasured.

Incomplete-adoption reset still accepts the email/password proof recorded at join time without
rechecking that account or requesting another one-time code. A record without that proof is
refused. Whether a failure after `trading.env` was written leaves this reset reachable remains
unmeasured. Also unmeasured: `operation.complete()` failing after the restart was scheduled can
release the setup latch while that restart is pending.

Remaining wording: the no-profile explanation in `apps/server/src/till-api.test.ts`, and the
history tags in `device-session.test.ts` and `setup-api.test.ts`. From source reading,
`cookieDomainFor` lowercases the request host but not the configured venue domain; whether the
configuration normalizes that domain remains unchecked.

## Adoption transaction boundaries and remaining fixture wording

From source reading, adoption writes files and the deployment stamp before its single `node.db`
transaction. A failure partway through those steps remains unqualified. The optional
`MirrorBundle.wireguardPublicKey` still has no production supplier or consumer beyond bundle
assembly. `recovery-race.test.ts`'s header still lacks the house rule's “weaker than its name”
qualification. Remaining test wording: the obsolete media-directory title in `backup-sweep`,
“C2b Task 9” in `mirror-bundle-fetch`, “swap S2” in `mirror-bundle`, and the historical-file
wording in `recovery-state`.

## Boot membership fetch and remaining entry fixtures

The credential-free fetch remains item (ii) of **Still open after A63** above. Boot re-reads the
saved chart after reconciliation, so ignoring the helper's `superseded` return does not by itself
mean the persisted fence is ignored. The helper and boot fixture tests exercise those separate
steps; the authenticated production fetch remains unqualified.

`node-entry.test.ts` still uses PostgreSQL-shaped failure fixtures (`Failed query`, `42703`).
This is a source-reading finding.

## Fiscal-certificate distribution

Rebuild on the asynchronous adopt (see the residuals). Open
design question: how the dormant certificate is protected when the seal must happen after the
initial copy ([design](../superpowers/specs/2026-09-07-fiscal-cert-distribution-design.md),
[plan](../superpowers/plans/2026-09-07-fiscal-cert-distribution.md)). Beside it, **the vault-ring
question**: `venue_credentials` is `local` and a blob sealed under one node's ring cannot be opened
under another's. Since A947 slice 3a a spare receives the main box's ring when it joins
(`credentialsRing` in `apps/server/src/mirror-bundle.ts`, written by `apps/server/src/adopt.ts`), so
rows a copy of `venue.db` brings open there. Since 3b-6a a spare receives that copy, and since 3b-F
a spare of a venue that files with Veri*Factu does too; nothing yet delivers a ring the main box
changes after the join (A1273). Re-encrypting the certificate when restoring onto Cloud also
remains open.

## A stop made while `cloud/replacement.json` is unreadable is not recorded in it

If that file is
later repaired and `cloud/connection.json` lost, the next start restores the connection without
the stop and the next check sends `renew`, so a stop Cloud had not yet heard is lost (left open
by C29, #808). Since A1500, **Get a fresh reconnection request** is a second way back: it sets the
unreadable file aside and, once the Cloud owner approves, imports the connection without the stop. Owner to choose: refuse Stop access while the replacement file is unreadable, or
record the stop somewhere that survives the repair.

## Waitron retains

The implemented Cloud connection screen and manager adapter; first-contact trust bootstrap; and the cloud-standby end-to-end
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
  `apps/server/src/boot.reconcile.test.ts`). Adoption now finishes and writes the mirror link.
  Whether this two-start sequence affects two started boxes remains unmeasured.

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

A spare can join a Veri*Factu venue and take over. `handover-two-boxes.test.ts` exercises the
handover and the reset old box's later emergency switch on separate databases, without real
box restarts. Real hardware, disconnected internet and power-loss qualification remain open in
[A947](#a947-go-live-on-two-local-boxes). The owner's 2026-10-21 request, “For go live I want one
box with failover to another local box”, remains the target of the
[A947 design](../superpowers/specs/2026-10-21-a947-two-box-failover-design.md). A second box is a
choice for later venues (the owner's answer to question 4 of that design).

- **Setup wizard choice, open since #443.** Whether to keep offering “Add a mirror node” remains
  an owner decision. Joining and takeover run in tests, but two started boxes remain unqualified.
  Decide `apps/setup/src/screens/mode-screen.ts`'s Join or recover row and `role-screen.ts`'s row
  together; removing or disabling the option is a product decision. Read the A947 design, §4,
  when settling this choice.
- **Retirement and rejoin still lack a drain confirmation.** From source reading, `retireSelf`
  checks membership before self-eviction, and `rejoinAsSecondary` checks fencing and a carrier
  before wiping. Neither proves the old box's tail was carried forward. `rejoin --accept-loss`
  logs an acknowledgement but waives no drain check. Return handling belongs with A1342/A1418;
  do not treat successful joining or a handover test as qualification of these wipe paths.
- **Re-admission and chart capacity.** A returned `sell-only` box occupies a chart slot until it
  retires; an administrator can clear an `evicted` entry. Re-admission must retire the node's
  previous chart entry and delete its live `fiscal.aeat` row. It must retire, not add.
- **Chart addresses.** A post-setup `WAITRON_MANAGEMENT_ORIGIN` change is not republished.
- **Restore restart and promotion.** A persistent wiped-state marker and in-process mirror
  promotion remain open. Role repair from a committed chart is tested by `promoted-role.test.ts`.
- **Fiscal-certificate distribution.** The old distribution design was reverted. The spare gets
  the shared ring at join, but later ring changes, restore onto Cloud and the dormant certificate's
  protection still need the [distribution work](#fiscal-certificate-distribution).
- **Remaining operator surfaces.** A dashboard promote UI and a break-glass-panel accessibility
  test remain open.
- **Split-brain and payments.** Examine selling, the fiscal chain, pending card payments and
  printing together (owner, 2026-08-26), including the till's timed-out-card choices. Settle
  [provider cancellation ownership](payments.md#decisions-and-deliberate-limits) (A764).
- **Carry-in qualification.** Measure the installation reservation cost of a bundle fetch and
  qualify provision/adopt serialization on one box. Verify that node identity is established
  before signing. The old returned-primary and one-more-filing-pass risks need start/fencing
  qualification against today's A947 start checks; they are not established by the sequential
  handover test. The design says slice 5a decides the role before the first filing pass; this
  remains unqualified on two started boxes.

The streaming and stored-primary-key decisions remain under
[Decisions and deliberate limits](#decisions-and-deliberate-limits).

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

## A1342: return a stopped box's records before reset

**Automatic duplicate identification:** agree which returned invoices count as duplicates before
planning it; no matching rule has been agreed. This is the remaining replication entry requested
by the watcher on 14 November at 00:48. Acknowledgement, responsibility and resolution stay
unplanned.

Payment-clash acceptance is an internal API without a screen. Sale lines, reprints and real-box
qualification remain open. A1342’s marker is now stored and returned invoices are listed. Reports show a general notice, without identifying affected invoices or periods; duplicates are not identified.

Normal return preserves original identities and chains and uses the main box’s outbox.
Completed and pending tender refunds travel with their payments. Pending card refunds carry
their original capture and its settled-order anchor, without order lines; the new main uses its
existing recovery worker to check the provider outcome without sending another refund. Reset deletes the old box's venue data, including the sale lines
and local backups that this return does not carry. Correction
is an internal authenticated API; it appends a corrective record on the main box’s own chain.
The correction refuses a returned sale whose invoice lines did not travel (the whole-credit probe reported `sale.correction_lines_mismatch` on main at `febf58a351` after the probe supplied the department by hand, and on the A1308 os8 candidate).
Sale lines, reprints and real-box qualification remain outside this cut. Reset-to-clean-setup is qualified; completed current-contract rejoin remains
with A947 3b-6. The return compares stored row shapes without negotiating software versions;
complete the return before upgrading either box to a different table layout.

## A box the chart no longer names main keeps filing its earlier records

Enrollment prerequisite (2026-11-09): new enrollment retains this box’s signed spare endorsement in
its held chart, and later charts retain its own verified endorsements of listed, non-evicted nodes.
Earlier enrollments are not backfilled. Records-return recovery remains separate from the bucket stop.

The third-box admission cases below remain separate work.

Remaining third-box cases from A1342. Owner 2026-11-09 17:04 accepted the two-box bucket-evidence
stop as clearing the before-A947-3b-6 gate; it does not close these third-box cases. The older
receipts below describe those cases, rather than the returned-main T versus T+1 incident.

Since A1425 the Veri\*Factu backend's `refuseNewIssuance` and `appendToChain` refuse a box the held
chart does not name `serving-primary` (`fiscal.chain_handed_over`), so such a box writes no new record
and refuses sales and bill payments before money moves; refunds call `refuseNewRefund`, which does not
read the chart, so they still go through. The filing loop (`packages/fiscal-verifactu/src/drain.ts`)
does not read the chart, so it still sends the records it wrote before.

A venue with no fiscal regime (`NoneBackend`, `packages/fiscal-none/src/backend.ts`) has neither
check, so neither refuses a GB box left `serving-secondary` with another box named main. In #2570's
review on 2026-11-08 such a box committed a cash sale through the core write path; the probe did not
start a real server. The owner's ruling that a box that is not the main one refuses a
sale before money moves does not yet reach this regime.

A box left `serving-secondary` by a third box's promotion also keeps the tills opened from it, because it still answers
that it accepts sales, at the same term as the main box, and on a tie the till's server router takes
the first server in its list, which is the address the till's page came from. So on those tills 'Wait
for the till to move to the main server' does not come true until this entry is done. In #2570's
review on 2026-11-08 the real `/api/node` handler and `ServerRouter`, given those answers and opened
from the old box, stayed on the old box for ten polling rounds, and moved to the main box when the old
box answered `acceptingSales: false`. A real three-box start has not been run for this.

The same class, from the 5.8b review: a chart naming a third box main with M2 `serving-secondary`,
saved after the role, then a kill: the real start answers `acceptingSales: true`, with M2 `activated`
and primary, and the third box is not asked because it has not joined. That chart was hand-signed
with M1's key. `nextStandings` would give `sell-only`, which does fence, but only for a box that was
main in the chart it minted from; a third box promoted from M1's first chart would leave M2
`serving-secondary`, which was not run.

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

Left open by A1018 Slice 5 (Rulings R29, R30). Each `module-records/<module>.json` keeps prepared
revisions that repeat earlier entries. Prepared revisions are capped at 1 MiB across modules; each
record, including retained history, also has a 1 MiB limit. At the limit later module operations
refuse `setup.attempt_invalid`.

`modulePreparationMergeFits` (`packages/provisioning/src/module-preparation-state.ts`) estimates room
from all prepared revisions for three writes now: the dormant setup, the wait and the selection. **Any
further write can still fill the file**, so it is a check on the likely shapes and promises nothing.
If it does fill, M2 fails to activate after the old box has given up filing, with no exit but the
file's owner clearing it. The cure is a format change: stop repeating the earlier entries, or lift
the cap. The owner sees this in Slice 5's PR.

## A1185: a venue not yet connected sees no prices

The Cloud services screen shows the plan
and prices only once connected, because Cloud's "Venue billing display, version 1" answers a
paired installation alone; whether Cloud publishes a price list anyone can read is an open owner
question (2026-10-29). Until then the screen offers only "Create a Cloud
account". Left open by A1185.

## A1188. Someone at the venue can start the venue in the cloud when the box has died (owner, 2026-10-29)

Before A1188 activation ships, recheck A1187-2’s printed emergency steps against the actual hosted flow; printing the page does not qualify hosted activation.

Part of A1018 and Cloud's P6. The tills learn the venue's cloud address and
show the emergency link to an administrator when the box disappears. The locked copy Cloud
restores after a valid emergency code offers only an administrator sign-in; a manager
holding `node.manage`, signing in with password and authenticator code, makes A1018's
declaration that the box is off, and only if the Cloud owner agreed in advance.
[Cloud billing design](https://github.com/waitron-io/waitron-cloud/blob/main/docs/superpowers/specs/2026-10-29-cloud-billing-design.md) §7.
Design approved 2026-10-29: administrators by default, and other roles once A1002 lets a venue
give them the permission; printers and drawers wait for A1175's Android app, while card readers
follow, being reached over the internet (owner, 2026-10-29).
Local selected-backup placement preserves an admitted spare's identity and records its archive
source in the emergency declaration. Since A947 3b-F (#3172) a spare of a venue that files with
Veri*Factu can join, with nothing fiscal written at the join. The locked Waitron entry
uses A1425 part 3's placement of the copy under its own identity; the hosted start still waits for Cloud's launcher, part 4's declaration and activation, and year-sized timing qualification. The emergency-card adapter is built; its facts need
Cloud's display endpoint. The card can reveal a fresh code and list permission/authenticator
readiness; Cloud's code endpoint remains required. The till entrance and recovery-pack emergency page are built, including the entrance without a spare. Backups checks the printed emergency code and Cloud links to the existing pack maker. The hosted runtime remains open.
The [part 1 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-14-a1188-part1-emergency-card.md) proposes two
card slices and pins Cloud’s 14 November 13:33 CET agreement to the contract values.
The [part 2 plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a1188-part2-till-facts.md) covers saved facts and the till entrance; Claude reviewed it and the watcher cleared slice 2a on 15 November.
Cloud agreed the [part 3 proposal](../superpowers/plans/2026-11-15-a1188-part3-locked-start.md) on 15 November: fresh-node placement, the emergency TLS/lease profile, copy status and a repeated-start bound. The [dated design amendment](../superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md#9-what-waitron-needs-cloud-to-agree) pins the agreement. Part 3a now provides the separate locked HTTPS process and read-only sign-in API; part 3b adds the separate English/Spanish sign-in and actor/expiry page. Cloud launcher and production qualification remain open.
The [reconciled build plan](../superpowers/plans/2026-11-15-a1188-part3-locked-entry-build.md) and [purpose-key proposal](../superpowers/plans/2026-11-17-a1188-locked-totp-purpose-keys.md) replace the retired account-key input, with [synthetic examples](../superpowers/plans/2026-11-17-a1188-locked-totp-examples.md). Claude reviewed the amendment and its corrections; the watcher cleared publication and independent placement/lifecycle work on 17 November at 17:16. Cloud agreed the replacement input in #1276 at `42b58657453af6f802c89580925090fe97ac9a28`; watcher 18:30 released the reviewed reader/API scope. The source-derived purpose keys open authenticator text without loading the source vault ring; sessions and pending recovery-code use stay in memory. See the [developer API](../developers/cloud-connection.md#locked-emergency-copy-api). No owner approval of this amendment is claimed.
Lane G agreed the [part 4 confirmation request, replies, expiry and replay](../superpowers/plans/2026-11-17-a1188-part4-declaration-contract.md) on 18 November. The [Waitron plan](../superpowers/plans/2026-11-18-a1188-part4-waitron.md) keeps declaration and activation pending. Live access to the signed-in status read waits for Cloud D115/P6. Before live activation, Cloud must prove that the old box's remote access and backup writes, including outstanding grants, are refused before it replies confirmed.
Part 4's activation must move the copy's role in its `node.db` off `mirror` and keep it off: while
it is `mirror`, an ordinary start refuses with `node.emergency_copy_unactivated` (A1425 part 3).
Part 3's locked start runs on a copy this check refuses, so it must choose its mode before
`bootServer`'s and `runAdmittedEntry`'s call to `refuseUnactivatedEmergencyCopy`.
The watcher resumed the card on 2026-11-15 at 05:46, requiring a post-agreement plan read
before build. Cloud hosting, endpoint and authenticated-route qualification remain open:
[A1188 design](../superpowers/specs/2026-10-29-a1188-cloud-emergency-start-design.md).

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


## Bundle: Series and module-preparation gaps at handover

2 entries, size M.

- **A second live standard series made a sale answer `server.internal` in a test fixture;
  the production cause is untraced.** Left open by A1018 Slice 5 (Ruling R39).
- **The module preparation file grows with every write, and a handover cannot promise room in it.**
  Every revision repeats all earlier entries under a 1 MiB cap. The handover's size check keeps room
  for three writes now, and any further write can still fill the file. Left open by A1018 Slice 5
  (Rulings R29, R30).
  [Detail](replication-cloud.md#the-module-preparation-file-grows-with-every-write-and-a-handover-cannot-promise-room-in-it)

## Bundle: The spare's wait loop: back-off, reasons, stop signals

2 entries, size M.

- **A chart post's yes/no answer cannot distinguish a refusal from an already-held chart.**
  The route's answer needs a ruling. Left open by A1018 Slice 5 (Ruling R53).
- **A box can refuse its start while its `venue.db` already holds the accepted copy.** Killed just
  after the swap with `accepted.db` then lost, two faults, entry's open has changed the digest, so
  the start refuses `handover.accepted_copy_missing`. The real placement case “cannot identify an
  opened accepted copy by its signed size and empty summaries alone” in `handover-place-copy.test.ts`
  confirms the refusal for the placed file and a different valid file with the same signed size
  and empty summaries. In this fixture, opening changes only bytes 18, 19, 27 and 95; replacing
  those bytes with the accepted file's bytes recovers its signed digest. Recognition after normalizing the
  header remains to be qualified through a real start and its WAL; the fixture alone does not
  establish what may be ignored after a killed start.
  Left open by A1018 Slice 5 (Ruling R53).

## Bundle: Remaining setup and failover gaps

- **Setup replay, incomplete adoption and membership trust.** Replay restart, reset reachability,
  removal and stale-trust qualification remain open.
  [Detail](replication-cloud.md#setup-replay-incomplete-adoption-and-membership-trust)
- **Adoption transaction boundaries and remaining fixture wording.** Partial-write qualification,
  the optional WireGuard field and named wording notes remain.
  [Detail](replication-cloud.md#adoption-transaction-boundaries-and-remaining-fixture-wording)
- **Boot membership fetch and remaining entry fixtures.** The credential-free chart read and
  PostgreSQL-shaped fixtures remain.
  [Detail](replication-cloud.md#boot-membership-fetch-and-remaining-entry-fixtures)
- **Replication, membership & failover residuals.** The setup-wizard choice, carry-in qualification,
  retirement, re-admission, restore/promotion, certificates and payment qualification remain.
  [Detail](replication-cloud.md#replication-membership--failover--residuals-afterwards)
- **Task 1a: unverified concurrency claims.** Promotion, sealing and scheduler takeover.
  [Detail](replication-cloud.md#task-1a--unverified-concurrency-claims)
- **SQLite slice 2 Task 9a.** First-start coverage, restore fencing, trust and deferred promotion.
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

## Bundle: Decide what the old promote route still does

2 entries, size S. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **After a plain promote nobody sweeps the old box's open card payments.** That route writes no
  activation row, and a fenced box no longer sweeps, so a payment stays `attempting` until a person
  resolves it on the new box. A text search found no screen calling the route. Left open by A1018
  Slice 5 (Rulings R47, R48).
- **A1279: a local secondary promotes only over a chart it signed itself.** No production caller.
  [Detail](replication-cloud.md#a1279-a-local-secondary-promotes-only-over-a-chart-it-signed-itself)

## Bundle: Address search provider, province names, guide lines

2 entries, size M. Their text is unchanged from the index they came from (backlog review, 2026-11-06).

- **A1171: the address forms need a provider from the Cloud address-lookup bridge.** Nothing hands
  `wt-address-lookup` a provider yet. Left open by A1171.
  [Detail](replication-cloud.md#a1171-the-address-forms-need-a-provider-from-the-cloud-address-lookup-bridge)
- **A1171: the dashboard's Venue card knows a province only by its code and main name.** The server's
  `provinces` list carries no other names, so a chosen address naming "Alicante" for
  "Alicante/Alacant" is not recognised there and is left to the server's postcode check at Save.
  Matters once a provider exists. Left open by A1171 parts 1–2 (#2191).

## Decisions and deliberate limits

**`cloud/replacement.json` and `cloud/recovery.json` stay until a reset (owner, 2026-11-09).** They are not deleted when the replacement flow ends: every start resumes a completed replacement, and a later stop is recorded in it. The owner's answer: "option A — move the files only; both stay until a reset, as today." Since 2026-11-20 (CLOUD-RECONNECT-AFTER-REMOVAL, lane C's choice, not the owner's): **Connect again** moves a completed `cloud/replacement.json` to a second name in the same folder (`replacement.json.set-aside-<time>`), so the next start does not bring back the forgotten Cloud venue; its contents still stay until a reset.

### Integrity waits and waiting reasons

Restore and emergency handover use the same provisional, unmeasured thirty-minute
SQLite integrity budget as controlled handover, plus up to five seconds waiting for worker stop.
This bounds the caller's wait, not native execution or file closure; other module checks and the
backup download are outside it. A check that needs longer than the budget will be refused on
another attempt too. A closed HTTP connection aborts its check; retry the request. Discarding an
attempt can leave its deleted file's space held until native work ends; another attempt needs
room for a fresh copy meanwhile.
The background joining check has no interactive deadline and keeps its duty stop signal.
Closed-folder cleanup retries independently every sixty seconds, skipping files whose integrity
worker still runs. `handover-fetch.test.ts` covers a worker exit and failed removal while a live
comparison remains pending, and stopping the timer.

The same suite's “persists a reason after failed writes without repeating waiting and error log
lines” injects a write refusal: `recordWait` calls the logger before trying the row write, and
stores the reason after a retry succeeds. While node.db refuses writes, it cannot retain the new
reason in that row. A log call does not establish that a log sink on a full disk retained it.


**HANDOVER-WORDS, 16 November 2026:** the watcher cleared keeping a refused copy’s module name
in the log only (`handover.chain_broken` and `handover.summary_mismatch`). The screen describes
the failed check without naming the module. This is watcher clearance, not an owner decision.

**A1321 retiring a spare, 2026-11-14:** Servers' Remove takes a spare that finished joining once
an administrator declares it switched off and no other recovery in progress; the declarations are
not stored. A removed spare that is offline is not told (the
[design's return boundary](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/specs/2026-11-08-a1321-retire-spare-design.md)); it is
reused only by resetting it and adding it as a new spare.

**A1018 local scope, 14 November 2026:** The watcher dropped Slice 13's archive/wipe/self-wipe
work on 14 November at 00:48 under the warn-only reset decision. Slice 14's selected-backup
placement moved to A1188 part 0 and landed as
[#3142](https://github.com/clintongormley/waitron/pull/3142), ae5413fe34.
Task 7.4b's extra emergency wait is deliberately unbuilt: the owner chose the next free minute
on 2 November ([Q2](../superpowers/plans/2026-11-02-a1018-handover-build.md#questions-for-the-owner)).
The watcher said not to rebuild Slices 10/11 on 12 November at 10:10; Task 10.6 stays with A1342.
Automatic duplicate identification needs an agreed matching rule, retained with A1342;
acknowledgement, responsibility and resolution remain unplanned.

**A1018 R40, 2026-11-14:** A box goes back to being main only by being reset, rejoining as a spare
and taking the normal controlled handover; a hand-back to a former main that kept its files is
not built (owner, closing #3126, 09:44), so every new main starts with a clean fiscal slate.

**A1018 R39, 2026-11-14:** The dormant-series prerequisite is dropped: the bounded source check
found no production route or duty that changes a filing box's live series outside an allocation.
The fixture-only mismatch does not authorise a build.

### Returned originals and their recorded facts (A1342, 2026-11-10)

The watcher’s 2026-11-09 20:11 note records the owner’s choice of inserts into fiscal records,
sales, devices, chain heads, delivery outcomes, tenders, settlements, voids and substitutions,
using existing source metadata and dead registrations for absent devices. This supersedes the
18:59 records-only boundary; it does not replay drawer, printing, stock or other live effects.
The watcher’s 2026-11-10 15:40 note records the owner’s “Approve all three (Recommended)” for
bounded batches of at most 100 and exact-clash acceptance. The owner then said “Split it into two
PRs” (watcher 19:30). The watcher cleared ordinary return/correction as PR1 at 19:45, with clashes
stopped and no return filing case or acceptance.

**2026-11-11:** The owner's 10 November 21:41 choice “1” puts exact-clash acceptance in a separate
signed handover record, checked against signed return evidence. The 19:30 split says “no new
acceptance rule in fiscal-verifactu”; `filing-cases.ts` remains untouched. The watcher cleared the
payment-only [PR2 plan](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-11-a1342-clash-acceptance.md) at 16:59 on
11 November. Node-local signed evidence and decisions drive retry; venue activity history retains
who accepted which clash across backup and handover for the live log’s 30-day retention,
without deciding product behaviour. Earlier backup points retain their own history.

**2026-11-12, A1342-3:** The owner's 13:52 direction is that a spare taking over becomes the new
main, and the old main returns its data to it; switching roles again uses the same handover.
The watcher at 15:58 cleared the [plain-stop rework](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-12-a1342-plain-stop-rework.md):
record clashes stop the return with a specific message on the old box, without record acceptance,
downloads or a new receipt field. Payment-clash acceptance stays separate.

The owner said at 16:25 on 11 November, recorded by the watcher in Lane J's `questions.md`:
“i don't think we should refuse, just warn. It may be impossible to transfer the data for some
reason, we shouldn't block them from reusing the box”. Reset therefore remains available, with a
warning that it deletes venue data and that an unfinished return is not confirmed.
The reviewed plan is [return originals before reset](https://github.com/clintongormley/waitron/blob/465e5915389b464a5d6f34937b02f777a0305ec0/docs/superpowers/plans/2026-11-09-a1342-return-records.md).

**A mirror serves no dashboard (owner, 2026-10-26; scope narrowed by the watcher, 2026-11-08).**
A spare shows its status and refuses restaurant screens and data. Its ambient administrator is
retired; an already-issued viewer token is revoked at trading boot. The authenticated switch
screen belongs to A947. Promotion and signed-peer endpoints retain their own authentication.


**Owner decision 2026-11-04 — a minute name the old box selected but never activated counts as
used** (A1018 Slice 4's Ruling R3, landed in #2442). The handover manifest marks
`module-preparation-state.json` transferred, and Slice 5's Task 5.7 merges the old box's retained
selections into the new box's own preparation file, so a new box never takes such a name. The
alternative the owner declined: such a name does not count, and the row goes back to source-only.
2026-11-14: fl9 carries the same selections in the one `module-records/<module>.json#prepared`
indicator row and places them in each module's prepared section.

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
- **A Demo venue does not offer a bucket copy** (watcher, 2026-11-17 19:30, lane B questions, point 2,
  answer (a); not the owner's). Its copy could not be restored, since restoring needs a server key a
  Demo venue never has and no restore path names a Demo invoice series. The Backups screen shows a
  line saying so in place of the bucket-copy settings when the venue's setup choice is Demo; an
  unknown choice still shows them.
- **A placed Cloud emergency copy seals its new signing key with a fresh key ring of its own; the
  venue's ring, and with it the AEAT certificate and card credentials, reaches the copy only at
  A1188 part 4's activation** (watcher, 2026-11-17 02:31, A1425-3 decision 5, answer (a); not the
  owner's). The plan's words: "The venue's ring, and with it the AEAT certificate and card
  credentials, reaches the copy only at part 4".
- **Approving or refusing a Cloud owner recovery is allowed only from the venue's own network; a
  request through the Cloud remote-staff tunnel is refused** (watcher, 2026-11-17 14:51; built by
  #3653). The plan's words: "Venue access only: refuse Cloud remote-staff tunnel access, since
  recovery through Cloud itself does not establish local presence".

From the Cloud connection integration (2026-09-24): Cloud owns the two-server WireGuard/HAProxy proof, bot gate, DNS
override, gateway replacement and revocation.

From the shared account controls: Cloud has published private `@waitron-io/ui-core@0.1.0` (see the [release receipt and setup](https://github.com/waitron-io/waitron-cloud/blob/main/docs/shared-ui-release.md))
and owns the release workflow and account screens.

Cloud product and infrastructure work moved to the
[Waitron Cloud backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)
on 2026-09-22: provisioning, cloud-only redundancy, trials, remote access, provider integration
and cloud operations. See [documentation ownership](../cloud-ownership.md).

## A951. The box's lasting tunnel and public-certificate client

**Owner decision, 9 November 2026: the original A951 is dropped.** A951-S replaces it.
Use the existing Cloud gateway and one outbound WireGuard container. Staff use
password sign-in on the box; staff-host passkeys enrol separately. Venue devices keep using
`.local`, and local sales never depend on Cloud or the internet. Customer pages stay later.

Remote dashboard access, Settings on/off and retirement of the old TCP relay are implemented in
[PR #2543](https://github.com/clintongormley/waitron/pull/2543). Trial details and limits stay in its
thread.

Translate all returned one editable menu suggestion on the test box. Address completion still
needs its trial Cloud provider. Provider keys stay on the gateway host and come from the owner.

The owner accepts that a compromised Cloud could obtain a staff certificate and intercept logins,
that the sign-in page and a bug in the remote entrance face the internet, and that this version
has no protected owner service, strict instant shutdown or independent protection against a
compromised box server. The watcher lifted the A760 landing freeze and table hold on 7 November.

The [old plan](../superpowers/plans/2026-10-22-a951-connection.md) and its linked protocol and host
artifacts are historical references for the dropped implementation. They do not add work or
gates to A951-S.


## A947. Go-live on two local boxes

The owner approved the second revision on 2026-10-22 at about 02:40; the amendment adds his
03:12 direction. Slice 4a landed as [#1990](https://github.com/clintongormley/waitron/pull/1990) on
2026-10-24. Slice 3a ([plan](https://github.com/clintongormley/waitron/blob/9faf8661ebd08545d96518b1d7d09305dcdd654c/docs/superpowers/plans/2026-10-31-a947-3a-node-db.md)) landed as
[#2371](https://github.com/clintongormley/waitron/pull/2371) on 2026-11-01: what a box remembers
about itself is in its own `node.db`. The owner answered yes to both its questions on 2026-10-31:
the box's role is saved a moment after the switch's fiscal save, and a spare checks the main box's
certificate fingerprint before it receives the venue's keys. Slice 3b's build
[plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md) was written on 2026-11-04:
eight pull requests, split on 2026-11-10 into eleven, two of them fiscal and landed by the owner (3b-G, the start steps that decide
whether a box files; 3b-F, letting a Veri*Factu venue add a spare, under option (c) of question Q1, which the campaign
watcher relayed as the owner's answer on 2026-11-04: its dormant tax-filing setup is written when the spare is switched on). 3b-1 landed as [#2721](https://github.com/clintongormley/waitron/pull/2721); 3b-2 (each
box's own name) as [#2742](https://github.com/clintongormley/waitron/pull/2742); 3b-3 (a joining spare
takes the venue's certificate authority as its own) as
[#2761](https://github.com/clintongormley/waitron/pull/2761); 3b-4 (box-to-box calls find a `.local` box by
asking the network, a spare listens on the venue's network, and what it serves there is walked by a
test) as [#2779](https://github.com/clintongormley/waitron/pull/2779); 3b-5a (the pair link: a spare joins with no Cloud relay,
the main box refuses before reserving anything and hands out the pair's access key and its backup settings) as [#2898](https://github.com/clintongormley/waitron/pull/2898); 3b-5b (a spare runs its store behind a listener
that admits only its main box's client certificate, a venue with a standby refuses bucket-copy settings, and key ring
rotation is refused while a pair link exists) landed too, and so did 3b-G (the start check trusts only the venue's authority and sets aside a spare still joining, the start's chart check reaches a real box, and a box that lost its own record does not start selling or filing), and so did 3b-6a (a spare of a venue that does not file with Veri*Factu takes its first copy over the venue's network and finishes joining), 3b-6b (a test runs a main box and a spare together over the venue's network, and the Servers guide explains adding a spare) and 3b-6c-email (a spare's join and its reset take the administrator's sign-in email) and 3b-6c (the main box sends its backup settings to its spare, again after every change and to a spare that was off), and 3b-F (a Veri*Factu venue's spare joins with nothing fiscal written) landed too. Box status, Servers and the bell show measured spare progress and warnings. 4b (2026-11-14) makes an emergency switch first bring the spare's copy up to date from the followed copy; the activation writes the spare's dormant setup first (A947 3b-F, built). 4c (2026-11-15) gives a till or handheld a red strip after 20 s without the main box, whose button opens the spare's switch page and comes back; the switch's passkey, the dashboard's entry, the spare's banner and the same-site cookie measurement moved to 4d (watcher, 2026-11-14 22:01). 4d-1 (2026-11-15, [plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a947-4d-reach-the-switch.md)) landed as [#3329](https://github.com/clintongormley/waitron/pull/3329): a spare asks its main box every 5 s and, after 20 s of silence, answers the venue's name, sending a reloaded page there to its switch page (which tries the main box itself) and withdrawing the name when the main box answers; a switch label opened on the selling box goes to Servers; the spare's own page says how long the main box has been silent, or that the spare cannot reach it. 4d-2 (2026-11-15) lets a manager print a switch label for the main box and the spare from Servers: a QR code for that box's switch page and its address. 4d-3a (2026-11-15) lets the dashboard's passkey sign-in, enrolment and sign-in check accept each box's own https name that the box's held chart lists, as well as the venue's name, reading the chart at each local passkey check; a spare still shows its closed page at its own name, so in practice this is the selling box's own name. The box image sets `WAITRON_VENUE_DOMAIN=waitron.local` (2026-11-15), so a till's device cookie, set at `waitron.local`, names that domain. Such a cookie reaching a box's own name was measured in Chromium ([note](../research/2026-11-15-a947-4d-measurements.md)), and a till's move to the spare's own name after a switch is the case "follows the promoted box at its own name, then back to the page when the page answers as it" in `apps/till/src/api/server-router.test.ts`. A till enrolled at `waitron.local` by a box whose image did not yet set it holds a cookie for `waitron.local` only; enrolling it again replaces that cookie, because the enrolment's answer expires it before setting the new one, and the browser then sends only the new one (measured in Chromium 158 with `setDeviceCookie`'s own headers, 2026-11-15; WebKit was not run). Without that expiry the browser sent both, the old one first. 4d-3b (2026-11-15) lets a manager sign in to the emergency switch's steps with a passkey; the spare then carries a signed proof for 15 minutes, so a reload after the take needs no new unlock, and the controlled handover still asks for the password. Left: the measurements on till hardware (two-part `.local` names, the name cache after the main box dies, a passkey at each way in, and the same-site cookie).

**14 November 2026, 3c measurement:** pinned `restore -f` applied an ordinary data-growth
transaction but failed complete-byte equality against the same frozen generation's direct
restore. Only header offsets 18, 19 and 24–27 differed. The watcher-revised integrity, every-table
and other-byte checks passed, as did the small reconnect/restart/generation experiments.
[Measurement and limits](../research/2026-11-14-a947-follow-mode.md). The joined spare now follows into isolated scratch output, and the main box shows its signed, cached progress on Box status, Servers and the bell. Since 4b an emergency switch promotes the followed copy, after checking it and the person's sign-in against it.

A1273 to A1285 and A1296 are the loose ends slice 3a left (A1295 went with 3b-3: no box keeps a second authority).
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
the membership chart, so a till's router sees one server (§2); 3b-2 gives each box its own name in
the chart, and the till hides a line for its page's own box.

- **A second box in setup mode, while the main box is silent, can be trusted by mistake in three
  ways.** It answers `waitron.local` once its ask hears no other box (3b-2). By default a till
  refuses it: each box makes its own certificate authority, and a connection trusting only the
  venue's refuses a second box's certificate (`apps/server/src/box-secrets.venue-name.test.ts`,
  "refuses a second box's certificate for waitron.local"). The three ways round that:
  - a person opens `http://waitron.local`, reaches the setup box's plain-HTTP page and installs the
    authority it offers for download (#330), without meaning any harm;
  - a person clicks past the browser's certificate warning: the server sends no
    `Strict-Transport-Security` header, and `landing-listener.test.ts` asserts it is absent (#290);
  - an operator gives the second box a `WAITRON_TLS_*` pair from an authority the tills already
    trust, which setup mode serves (#141).

  Settle it before two-box failover goes live: it can only happen once a venue has a second box,
  which is what A947 builds.

- **Three limits 3b-3 ([#2761](https://github.com/clintongormley/waitron/pull/2761)) left in a
  box's certificate check.** A box in the waiting start (waiting for its peers) or a restricted
  start (handed over or superseded) serves its certificate before `ensureLeaf`
  (`apps/server/src/box-secrets.ts`) checks it, so a certificate missing a new name or address is
  served there until the next full start. A stop while a failed reissue is putting the old
  certificate back can leave a certificate and key that do not belong together; the next start
  reissues it, but the start's connection check may send the box to connection repair first. A
  spare later promoted keeps `tls/joined.json`, so a plain reset of it also removes `tls/`, and its
  devices must trust it again.

## A1273: the shared key ring has no rotation path to the spare

Left open by A947 slice 3a, for slices 3b and 3c. A spare receives the main box's key ring once,
when it joins (`credentialsRing` in `apps/server/src/mirror-bundle.ts`; `apps/server/src/adopt.ts`
writes it over the spare's `secrets.env`). `waitron-credentials rotate` re-seals the main box's
vault rows and its own signing key under the ring's current version (`rotateCredentials`,
`packages/credentials/src/store.ts`), and nothing sends that ring to a spare that has already
joined. From reading, not run: a spare holding a copy of `venue.db` taken after a rotation could
not open the rows sealed under the new version. Wanted: a way for the ring to reach the spare, or a
rule that a rotation re-joins it.
Since 3b-5b the plan's decision D7 holds instead: `rotate` refuses `credentials.rotation_spare_joined`
while `node.db` holds a pair link, re-sealing nothing (`packages/credentials/src/cli.test.ts`). A
ring changed by hand in `secrets.env` is not stopped, and the bucket-copy risk below is untouched.
A related risk, found by reading only, not run (2026-11-09): a ring rotated after the bucket copy's sealed state bundle was last refreshed could leave a bucket
restore unable to read newer rows (`credentials.key_version_unknown`).

## A1274: a box that handed over and then loses its node.db can start as a second main box

Left open by A947 3b-G, which refuses a start with `node.state_missing` when a box's `node.db`
holds neither a role group nor a signing key for it in `box` and its held chart lists it as anything
but the serving primary, or names another box serving primary (Task G.3 of the
[plan](../superpowers/plans/2026-11-04-a947-3b-spare-hosts-store.md); read, not run, found by the
2026-11-10 Fable review). A box that handed over keeps its proof of that in `node.db` only, and
stepping down mints no chart. So if it loses `node.db` before it hears the new chart, its chart
still names it the main box, the refusal does not fire, and Carry on's check for a known handover
reads the lost file (`apps/server/src/carry-on.ts`). With the new main box silent, an administrator
who carries on gets two boxes selling and filing, which could cost a filing. Closing it needs a
record of the handover outside `node.db`, which changes A1018 Slice 5's handover code.

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
generic text with no next step, which the [refusal rule](../developers/conventions-ui.md#refusals-name-a-self-service-next-step) allows only for a state only a bug produces. Two
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

## A1296: code-quality follow-ups from A947 slice 3a's finish review

Raised by the finish-branch simplify review (2026-11-01) and not applied there, because each is a
restructuring wider than a review fix:

- The venue and node handles travel as separate fields under four names (`nodeDb`, `node`,
  `ownerNode`, `nodeDatabase()`), with three near-identical pair types (`VenueDatabase`,
  `VenueAndNodeHandles`, `MigrationFiles`). Pass one pair type.
- "Opening a staged folder must not create an empty `node.db`" is enforced by about fifteen
  callers (`writeStagedNodeCopy`, `openStagedCopy` and `assertStagedNodeCopy`). Let
  `validateDatabaseEntries` write the copy, and give the store an option that refuses a missing `node.db`.
- Matching lock nests use `withVenueAndNodeTransaction`; the remaining sites do work before or
  between venue transactions. Keep their separate commit/check stages when consolidating them:
  credential rotation, spare join, recovery-pack replacement, first setup and return records.

## A1279: a local secondary promotes only over a chart it signed itself

Left open by A947 slice 3a. `promoteLocalSecondaryToPrimary` (`apps/server/src/promote.ts`) runs the
trust check with no pinned main-box key, because only joining pins one, so it trusts its own key
alone. It has no production caller: the promote endpoint never calls it
(`apps/server/src/boot.ts`, "it NEVER calls `promoteLocalSecondaryToPrimary`"), and the in-process
handle a started server carries (`makeStartedServer`, `apps/server/src/boot.ts`) is used only by
tests. Decide its trust set if it gains a caller. That same slice owns the immediate runner role
notifications and a real promotion test including a mirror. Codex attached that follow-through
here after the watcher deferred immediate wiring from A1308 jr2 on 2026-11-11 at 05:18.

## A1282: browser trust after a connection repair replaces the certificate authority

After a connection repair issues a new certificate authority, a browser accepting only the old
certificate refuses new HTTPS connections. In the 2026-11-12 disposable-box check, the existing
one-minute refresh requested Servers, alerts and the disk stop; all three failed with
`ERR_CERT_AUTHORITY_INVALID`. Servers kept the old fingerprint and showed a connection error;
a fresh navigation was refused too. The open work is how you trust the box again after a repair,
not a notification to refresh the fingerprint.

Evidence: `~/waitron-campaign-d/receipts/a1282/refresh.log`, `browser-events.json` and screenshots.
The Chromium check accepted only the original served leaf key through a temporary SPKI exemption,
with `ignoreHTTPSErrors: false`; it did not install an authority in the operating system.

## Loose ends left by the Cloud connection integration

- Customer remote setup UI and production deployment remain open.
- Shutdown waits for an in-progress local database copy or encryption step. Next: measure that
  shutdown latency, real venue uplink budgets and spool disk use, and stream archive assembly
  beyond its current in-memory 512 MiB format limit. Cloud documentation:
  `docs/authenticated-captures.md` in waitron-cloud.
- After a Cloud replacement (#638), installing the new tunnel and TLS certificate remains an
  operator step. Continuous complete-server recovery, planned final-write handover and production
  recovery remain open. Cloud owns route placement and fencing in its backlog.
- A stop made while `cloud/replacement.json` is unreadable is not recorded in it.
  [Detail](../backlog/replication-cloud.md#a-stop-made-while-cloudreplacementjson-is-unreadable-is-not-recorded-in-it)
- The Litestream stream's sealed-state restore and activation still need integration with Cloud
  storage and owner recovery. Connected does not mean those services are configured. Cloud service
  ownership stays in the Cloud backlog; this repository owns its adapter, screen and node-side
  behavior. Public hosting, ingress controls and Cloud audit/retention remain deployment work.

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

## Task 1a — unverified concurrency claims

Holders torn by a concurrent promotion, credential sealing and scheduler takeover remain
unverified. The sequential promotion and sealed-row tests do not qualify those concurrent cases.

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
