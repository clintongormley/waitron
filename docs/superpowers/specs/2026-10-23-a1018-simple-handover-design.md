> **Amended Cloud agreement published, 2026-10-23 (D133).** Cloud
> [PR #323](https://github.com/waitron-io/waitron-cloud/pull/323) publishes the
> [accepted correction](https://github.com/waitron-io/waitron-cloud/blob/08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018) at
> `08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec`. Full shared-contract SHA-256:
> `157556c31753ccf64cc9f8f0a7144f20683325231d212cd344e259b644366d02`.
> It accepts this design's M2-only AEAT direction at Waitron
> `d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`, full-document SHA-256
> `5fabaad0ff946f410c68fd71f46cffa497c3f562ae7f8776c71f61de96265aa3`.
> This supersedes every Cloud-agreement/publication wait below, including §11;
> the earlier blocks retain their dated positions. The single short revised owner
> design question can now proceed, with §§8–9, the retained proposed defaults and
> §6's completed A1034 observation and limits. The proposal below is unchanged.
> Owner design approval, exact formats, compatible A947 amendments, separate build
> authority and physical runtime acceptance remain pending. Cloud's publication still
> calls A1034 unrun; §6 records the later completed test-service observation.

| Pinned Cloud source                                                                                                                                                                                             | Actual wording                                                                                                            | What this establishes                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [D133 canonical A1018 section](https://github.com/waitron-io/waitron-cloud/blob/08a2a0d4290cf7fbd54a87d2493b6d9727f8f7ec/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018) | “Cloud accepts its direction and the boundaries below.”; “After either takeover M2 alone handles all AEAT communication.” | Agreement on the revised direction, including sole M2 filing and fiscal-only return. Publication does not qualify implementation or runtime behaviour. |

---
> **AEAT test observation, 2026-10-23 (A1034).** The authorised probe completed in
> [run 39970201368](https://github.com/waitron-io/verifactu/actions/runs/39970201368).
> The queued/not-run notes below describe the earlier revision; §6 now records the result.
> This updates the test evidence only. Cloud agreement, owner design approval, build authority
> and physical handover qualification remain separate.

---

> **Owner correction, 2026-10-23, after the 15:37 and 15:40 answers.** The owner
> rejected the filing assignment below: once M2 takes over, **M2 alone handles all
> AEAT communication in both controlled and emergency handovers**. Returning M1 transfers
> missing fiscal originals and every received AEAT outcome, including outcomes for originals
> already copied to M2; it never contacts AEAT. M2 preserves each original's generating fiscal
> identity and uses its own identity only for new sales. The historical publication and
> direction blocks immediately below retain the previous position; their filing assignment
> and next-question status are obsolete. Cloud #312 at `7e3ba8246a6d5dbeb4275ed7c00f2f34124c944a`
> still carries the rejected assignment. G/D133 must amend and pin acceptance of this correction
> before the one short revised owner design question (§11). No revised Cloud agreement or build
> approval is claimed. A1034 is authorised and queued next; its AEAT test-service old-tail,
> interleaving and duplicate checks have not run. The source basis and limits are in §6.

---

> **Canonical publication update, 2026-10-23.** Cloud has published the direction
> agreement in [PR #312](https://github.com/waitron-io/waitron-cloud/pull/312), at
> [`7e3ba8246a6d5dbeb4275ed7c00f2f34124c944a`](https://github.com/waitron-io/waitron-cloud/blob/7e3ba8246a6d5dbeb4275ed7c00f2f34124c944a/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018).
> Full shared-contract SHA-256:
> `d0c203622de665f5ebfb8e139e778ee9af19ff36b71c65911e1ad84aaf983d46`.
> Its wording is “Cloud accepts its direction and the boundaries below.” This supersedes
> the draft-publication wait recorded below. The next step is the single owner design
> question with both Harbour Kitchen examples, every proposed default and the explicit
> venue-to-Cloud actor mapping. The reviewed protocol below is unchanged. Design approval,
> exact transfer and authentication formats, A947 amendments, separate build authority
> and all eight runtime combinations remain pending.

---

> **Direction agreement update, 2026-10-23.** Lane G agrees the two-scenario,
> four-direction proposal in [Cloud draft PR #312](https://github.com/waitron-io/waitron-cloud/pull/312)
> at `a9399a4a390a62f45e4d4c636635ae6d715c1ecd`. Its replacement
> [shared contract](https://github.com/waitron-io/waitron-cloud/blob/a9399a4a390a62f45e4d4c636635ae6d715c1ecd/docs/waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018)
> is on that draft branch, not published on Cloud main. Wait for its exact publication pin
> before the one combined owner question. The earlier awaiting-agreement wording below
> records the proposal's previous state; owner design approval and build authority remain pending.
>
> **Actor mapping clarification for that question:** explicitly bind the venue actor's
> proposed `node.promote` permission to the Cloud account, venue and operation.
> Organisation ownership, support access, a hosting purchase or matching email alone supplies
> no venue declaration or activation permission. A separately authorised provider-resource stop
> supplies neither permission by itself. Missing binding waits. This agrees the boundary, not
> an existing authentication bridge: its format, expiry, revocation and replay checks still need
> joint specification and qualification before implementation. Local-to-local needs no Cloud
> binding or internet. The protocol and recommendations below remain proposed; runtime controls
> remain **UNRUN**.

---

# A1018: a simple handover between two machines

**2026-10-23 | PROPOSED owner-directed REVISION after the 15:37 correction.** The preceding
revision received builder review, but the owner rejected its emergency filing assignment.
This revision awaits amended Cloud acceptance through G/D133, then **one short owner design
question** referring to both examples below. No build approval or implementation plan.
The owner's 02:25 rejection, 02:58 five-point direction and 15:37 correction settle the model;
the other proposed defaults remain as presented. The 15:40 “Test it” answer authorises A1034,
queued next, rather than opening another owner choice.

You need to replace the machine running your venue without needing Cloud to exist. Call the
old machine M1 and the selected replacement M2. If M1 answers, it stops its work and gives M2
its complete final state. If M1 cannot answer, you declare it shut down and explicitly accept
that M2's last copy may miss records. M2 keeps its own node identity and starts a fresh fiscal identity, chain and invoice series
in both cases, through the approved module gates. It never continues M1's writer chain with
new sales. After takeover M2 alone handles AEAT communication, including filing M1's unchanged
originals already copied or recovered later, in their original generating fiscal identities.

This replaces the [rejected proposal](2026-10-22-a1018-cloud-stop-proof-design.md), rather than
qualifying its external proof mechanism. The old Waitron `db7cddeb2` / Cloud `6700d6f` direction
agreement, published through Cloud #300, is historical and **no longer current agreement**.

## 1. Direction and placement

The owner's exact messages are in `/Users/clintongormley/waitron-campaign-e/questions.md`, from
`**OWNER ANSWER (2026-10-23 ~02:25` through the five points at ~02:58. Queue A1018 retains its
original start, 2026-10-22 16:14. Its old stop-proof brief is replaced by those messages and
the exact headings `OWNER ANSWER — A1018 combined design question` (15:37) and
`OWNER ANSWER — "Test it"` (15:40), which control this correction.

There is one protocol. Cloud supplies somewhere to run a machine, storage and connectivity.
Local handovers use no Cloud service, outside authority, supervisor, hardware attestation or
provider proof. Neither scenario adds a periodic lease or an outside dependency to each sale.

| Direction      | Controlled: M1 reachable                                                                    | Emergency: M1 unreachable                                                                             |
| -------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local to local | M1 durably steps down; M2 checks the final state over the local link. No internet or Cloud. | Authorised person declares the physical M1 switched off; M2 accepts its last local copy.              |
| Local to Cloud | Same handover over the configured secure connection.                                        | Same declaration about physical M1; accept the selected Cloud copy's missing-tail risk.               |
| Cloud to Cloud | Same handover between the two hosted machines.                                              | Authorised person stops M1 in the provider console and declares it stopped; accept the selected copy. |
| Cloud to local | Same handover to the local replacement.                                                     | Same provider-console stop declaration; accept the selected local copy.                               |

Physical power-off and a provider-console stop are **human declarations**, not automatically
verified facts. A route change, missed heartbeat or unavailable page is not that declaration.
Cloud cannot automatically make it for you. Hosted tills still need a connection to their primary.

## 2. Controlled handover: stop, copy, compare, activate

You authenticate freshly, select M2 and start one durable operation bound to the venue, M1,
M2 and the expected signed membership revision, the chart saying which machine has which role.

1. M1 records the operation and **handed-over restriction on its own durable disk before
   acknowledging stepdown**. It closes admission to business writes with the write queue.
   No new sale, order, payment, refund, cash, stock, print, drawer or filing work starts.
   Webhooks, background jobs, passive-read housekeeping, commands and module writers are included.
2. Finish admitted transactions and wait for already sent external requests only to their
   existing deadlines. Save received answers and unresolved payment or filing facts, including
   request identities. A timeout does not mean a card was not charged. Cancellation is not reversal.
   Stop remaining mutators, including backup/checkpoint writers, before taking the final snapshot.
   M1 retains its pre-takeover filing assignment until the verified-copy checkpoint below,
   but starts no new AEAT communication while stepped down.
3. M1 transfers the complete consistent final state and its signed final-state indicator (§3).
   M2 compares them and durably records acceptance before acknowledging that acceptance to M1,
   before any activation or business work. A missing entry, mismatched digest,
   failed capture or unfinished local transaction leaves M2 waiting. An older bucket copy cannot
   substitute. M1 remains stepped down after a failure or lost answer; it does not resume by timeout.
4. Only after M2's durable acceptance does M1 record irrevocable filing relinquishment to
   this M2. Its signed operation status binds that assignment to the final-state indicator (§6).
   M2 checks that status and records the filing assignment and its activation outcome before enabling
   work. It uses its own node identity and fresh fiscal chain/series under existing module,
   authentication, clock and allocation gates. Tills then bind to M2 and sign in as A947 requires.

Handover does not wait for AEAT or for the internet to drain M1's outbox, its queue of records
waiting to be filed. M2 files those copied records **in M1's recorded fiscal identity**, while
new sales join M2's new chain. Required credentials travel only through the approved secret and
module transfer paths. Do not copy M1's private node identity to make M2 impersonate its writer.

## 3. A simple final-state indicator

**Recommendation for approval:** one M1-signed indicator, checked against the enrolled node key
and existing signed membership, plus the two machines' durable operation state. No outside
signer or many-party receipt exchange. It binds:

- operation id, venue, source M1, selected M2, membership revision and document digest;
- digest of the consistent snapshot, schema versions and enabled-module inventory;
- a manifest of required node-local continuity state, its digests and how M2 treats each item;
- each immutable fiscal chain's identity, head and count, its outbox state, received results,
  and external requests whose results remain uncertain, with their original request identities.

The snapshot covers shared business/configuration rows, immutable fiscal records and filing
state. The node-local manifest separately covers durable roles, handover/filing assignments,
recovery preparations, spent allocation choices, follower positions, required module files and
secret versions. Classify each as transferred continuity data, retained source-only data,
destination-owned data or rebuildable data. M2 keeps its own node key, recovery verifier and role
state; source-only private identity stays restricted on M1. Shared credential material needed to
use the copied data must be present through the approved transfer, not assumed from a DB copy.
A947's node-local identity separation is a prerequisite for this shared snapshot, not an
assumed capability of a raw database copy at the inspected base.

Compare the received frozen snapshot before destination-local mapping and activation change it;
validate those declared mappings separately. Include all committed journal changes in the
consistent snapshot. A single chain head, timestamp or stream-lag reading is insufficient.
The builder must enumerate the actual module/file inventory and comparison format before build.
Store the indicator, final-copy acceptance, later filing relinquishment and retry outcome
outside the frozen payload so those handover records cannot change the state whose digest
M2 checks. The snapshot's filing map describes ownership at capture; the signed operation
status records the later assignment. Neither authorises business writes on M1.

Under cooperating, uncompromised machines this establishes equality with M1's frozen database
and its durable self-stepdown. It does not prove provider process death, defeat an unknown old
clone or assure anything against arbitrary old-disk rollback, copied private identities or root
compromise. Do not describe it as those guarantees. Never run two physical clones with the same
private node identity concurrently.

## 4. Emergency handover and the first two owner points

**Point 1: durable stepdown and emergency boot wait.** A controlled M1 reads its durable
handed-over restriction after power loss and stays restricted. An emergency M1 may know nothing
about its replacement: before trading or any AEAT communication on boot, it asks M2 or a till
for the current signed membership and operation information. A verified newer role stops it immediately.
No reachable peer or till means wait for an authorised human, not assume primary. A stale chart
alone cannot clear that wait. A947's same-authentication continue-without-spare choice must name
the other machine and confirm it is off with no parallel recovery; it cannot undo a known handover.

On M2, stop following, apply the available copy and check integrity and fiscal chains without
starting business work. Show which copy is available and when it last advanced, explicitly say
the final tail is unknown, and ask the freshly authenticated person to confirm **M1 is shut
down, no parallel recovery is in progress, and this copy's uncertainty is accepted**. Persist the
declaration, M1's restricted role and M2's sole AEAT responsibility in the operation before
activation. M2 then uses its own node identity and a fresh fiscal identity/chain/series through
the same module gates, not M1's old writer identity. It files M1's copied originals in their
recorded fiscal identities under §6; emergency takeover adds no predecessor ownership hold.

**Point 2: a network split can leave both machines selling.** M1 may still serve tills on its
side of a broken switch while M2 starts on your statement. It stops admitting work immediately
when it learns of the newer role through a verified chart, then bounds admitted work as in §2.
There is no promise of stopping an isolated, already running M1 before it learns. Distinct node
chains avoid sharing one writer chain; bills, payments, cash and stock still diverge. They do
not merge afterwards. One machine per till is not proof of one writer for the whole venue.
Do not treat the sole-M2 AEAT assignment as a remote stop guarantee for an isolated process;
it relies on the declared shutdown and the returning M1 gate.

**Proposed screen warning:** “Switch off M1 before continuing. A broken connection can look
like a failed machine. If M1 is still running, both machines may take sales and payments, and
your bills, cash and stock will disagree. M2 may be missing M1's latest records. Only fiscal
records will return later; the business difference will need reconciliation.” For a Cloud M1,
add “Stop M1 in the provider console. Confirm the correct machine and prevent its restart.”
Tills keep one selected machine and never send the same uncertain payment to a second one.
For either scenario, copied pending payment commands keep their original request identities
and known outcomes. Hold uncertain actions for the existing domain recovery checks; no blind
charge, refund or settlement replay is authorised by handover. A764's payment ownership remains
a build qualification dependency, including background workers as well as till requests.

## 5. Point 3: fiscal-only return, with a visible business gap

The owner says only fiscal records sync back, never M1's other changes. **Recommendation for
approval: show an explicit reconciliation list, rather than import the sale's payment totals.**
Transfer missing original immutable fiscal records and the fiscal chain and filing rows needed
to understand them, plus **all received AEAT outcomes**, including those for originals M2
already holds, and unresolved request facts. M1 contacts no AEAT service after takeover;
M2 performs the filing and reconciliation in §6. Do not replay orders, payments, cash, drawer, stock,
printing or other business side effects. Changes to old nonfiscal business rows stay in a
restricted consistent archive, never merged or re-run on M2. A later manual correction is a
new, authorised M2-owned business record with a reference and explanation, never an import of
M1's row. A reconciliation reference itself is likewise an M2-owned record.

For each recovered invoice absent from the business history, the list shows old source node,
installation/chain, invoice series/number and original identifiers, issue date, taxable amount,
tax and gross amount. It links the retained original and any available archived evidence. Show
the resulting fiscal-versus-business difference alongside cash-up and affected reports, with
dated totals, known amounts and explicitly unknown amounts. Track acknowledgement, responsible
person, evidence, resolution and any new correction reference. Acknowledgement alone is not
resolution, and a reference does not turn a fiscal record into a paid business sale.

Do not automatically wipe M1 before record-by-record fiscal receipts, per-chain counts/heads,
outbox coverage and matching transferred fiscal totals, successor health, and a verified archive
all pass. Matching totals here means the transferred fiscal set, not invented business equality.
Unresolved filing or reconciliation cases keep their originals and archive. **Recommendation:
no automatic archive expiry while a gap remains; decide retention under A664's separate policy.**
After the gates, M1 may become a dormant spare under an amended A947 return procedure.

If the disk never returns, retain a known-unknown missing-tail gap with the last known copy and
affected interval. Keep the owner's standing AEAT consultation/month-end fallback as an operator
follow-up, not a claim that AEAT supplies missing bills, payments or other operational data.
No new AEAT legal claim or live consultation has been verified in this documentation task.
Never mint replacement fiscal originals for the missing chain.

## 6. Point 4: M2 alone communicates with AEAT after takeover

**Owner direction, 15:37, for both scenarios:** M2 files M1's originals already in its copy and
any missing originals returned later, preserving each record's generating fiscal identity,
chain links and fingerprint. This includes queues M1 inherited from earlier nodes. M2's new
sales use M2's own fresh identity/chain/series. Returning M1 never files, consults or otherwise
contacts AEAT, even for a pending record or an uncertain earlier submission. It only transfers
fiscal originals and received evidence to M2, while remaining restricted from business work.
There is no emergency predecessor ownership hold prohibiting M2 from filing copied old records.
Existing domain holds for unresolved filing cases still apply.

**Controlled checkpoint:** handover does not depend on AEAT draining the queue. After M2 durably
verifies the complete final copy and acknowledges it, M1 records irrevocable relinquishment to
the selected M2 outside the frozen payload. Its signed operation status binds that decision to
the operation and final-state indicator. M2 verifies and records it before assumption and
activation. M1 remains durably stepped down throughout; a lost acknowledgement or relinquishment
reply never permits it to resume AEAT communication. Retry reads the same operation. If possible
activation or the filing assignment cannot be resolved, wait on that selected M2 as §7 requires.

**Emergency takeover:** the durable declaration and operation assign all AEAT communication to
M2 when it activates. M2 reconciles known outcomes in its copy and files unfiled copied originals
without waiting for M1 to return. M1's missing tail remains unknown until recovered. On return,
M1 learns its restricted role before any business or fiscal worker starts (§4), then freezes
and transfers the missing fiscal originals, required chain/filing state, all received AEAT
outcomes and unanswered request identities. Outcomes for originals M2 already holds must travel
too; filtering the transfer to missing originals would discard that evidence.

M2 applies known results before deciding what remains to send. It uses the existing recovery,
duplicate-handling and filing-case paths for uncertainty, including a record M1 may have sent
before failure. An uncertain record may be resent through those paths; a duplicate response is
not by itself proof of acceptance. Keep both facts and an open case when terminal results
conflict, rather than letting the last arrival win. Preserve A947 §7.1's temporary per-chain
filing pause while a return batch applies; this is not a continuing predecessor ownership hold.
No new transfer, authentication or AEAT protocol is specified here to fill unknown formats.

The durable operation retains source restrictions, M2's assumption and transfer progress.
Each frozen return batch retries identically; any later received evidence uses a new frozen
batch in the same operation. Unresolved filing or reconciliation cases retain their originals
and archive, with no wipe or archive deletion before §5's gates. Losing M1's disk leaves an
explicit missing-originals gap, but does not prevent M2 filing the originals it already holds.

**Source basis and limits.** M2's old-record relay accords with A947 §7.1 and asesor Q2;
it does not create a new legal conclusion or establish runtime acceptance:

| Local source | Actual wording | What it supports and does not establish |
| --- | --- | --- |
| [A947 §7.1](2026-10-21-a947-two-box-failover-design.md#71-the-tail-and-the-fix-for-the-failed-prototype-scenario) | “the receiver files it and AEAT's duplicate handling settles it”; “A fenced sender files nothing after it is fenced” | The promoted receiver files old originals; the returning sender does not. Its S2 full-state/replay controls and real duplicate checks remain required. |
| [Asesor Q2](../../compliance/asesor-questions.md#q2-may-a-node-other-than-the-till-transmit-the-tills-records-to-aeat) | “the record must carry the **generating till's** `IdSistemaInformatico` and `NumeroInstalacion`, never the relaying node's” | Relay preserves the generating identity. Q2 is closed on primary source, not a new owner or asesor question. |
| [5 October observation beside Q34](../../compliance/asesor-questions.md#q34-sending-the-old-installations-unsent-records-after-the-switch-added-2026-10-03) | “The fresh-installation probe received `EstadoRegistro: "Correcto"` for each of its two first records” | Run 37286364837 accepted two first records. It did not continue an old chain after a new one started, interleave their tails or resend an old-server-filed record. |

**Observed in AEAT's preproduction environment, 2026-10-23 (A1034).** In
[run 39970201368](https://github.com/waitron-io/verifactu/actions/runs/39970201368), A1–A3
returned `Correcto`; B1/B2 started a separate installation in one batch. Saved A4, then B3,
then saved A5 also returned `Correcto`. A4/A5 were prepared before B started and retained A's
installation and their original predecessor links. Resending unchanged A3 returned
`Incorrecto`, code `3000`, “Registro de facturación duplicado.” and stored state `Correcta`.
Expanded issuer consulta returned A3 as `Correcto`, with its original fingerprint and generating
software identity, including installation `CI-HANDOVER-39970201368-A`.

The [saved records and parsed/raw replies](2026-10-23-aeat-handover-tail-evidence.json) come from
one synthetic run, one certificate and one process with two generating installation identities.
No physical handover, fencing, missing-history transfer, conflicting tail, production or legal
acceptance was exercised. The live mode retains record objects and raw response SOAP, not raw
request SOAP. A947's broader ledger transfer and archive/deletion policy still need explicit
amendment under §10.

| Test-service source                                                                                                                        | Actual wording                                                                                   | Scope                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [A1034 saved evidence](2026-10-23-aeat-handover-tail-evidence.json), run 39970201368, verifactu `754f6332c1e3308c7f714c94a9803804d2dd9596` | `EstadoRegistro: "Correcto"`; `CodigoErrorRegistro: 3000`; `EstadoRegistroDuplicado: "Correcta"` | The ordered original/tail records were accepted, the unchanged A3 retry was a duplicate, and targeted consulta matched its original fingerprint and generating installation in this run. No physical handover or legal conclusion. |

## 7. Point 5: who may declare, and simple retry rules

**Recommendation for approval, consistent with A947 §6.2:** the owner or an authorised manager
holding `node.promote`, with fresh dashboard-equivalent passkey authentication or password plus
TOTP when enrolled. TOTP is the authenticator app's one-time code. A till PIN alone is inadequate.
This is the proposed default for this revision, not a newly approved A1018 owner decision.
Cloud-account authority must map to this venue permission by agreement with Lane G. Bind the
actor to the Cloud account, venue and operation; organisation ownership, support access,
purchase, matching email or a provider-resource stop alone grants no venue declaration or
activation permission. Missing binding waits. Its format, expiry, revocation and replay checks
still need joint specification and qualification; local-to-local needs no Cloud binding.

Audit the exact declaration and accepted uncertainty, reason, venue, both machines, actor,
last known copy, time and operation id. A Cloud declaration also identifies the provider resource
the person stopped; it asserts no automatic provider verification. For reachable M1, offer the
controlled path; never silently downgrade a failed controlled handover to an emergency or restore.

Keep one durable operation per selected M2 and expected membership revision. Persist progress
locally as prepared, source stepped down or emergency declared, copy checked, filing
relinquished/assumed as applicable, activated, and return reconciliation pending/complete,
with the result or reason for waiting. Same id and same
inputs return the stored result; changed inputs conflict. Serialise concurrent requests at each
machine; a competing target or operation waits. A lost activation reply queries the same M2 and
resumes its recorded result, never allocates again or selects M3 on timeout. Signed membership
authenticates changes; it does not prove that every isolated machine has seen them.
Do not claim these local rules prevent independent promotions across a network split (§4).
Changing destination after possible activation needs explicit resolution of that selected
machine and another authorised operation, not erasure of the first one's state.

**Designer recommendation for approval: a crash during controlled handover.** M1 cannot
relinquish filing before M2 has durably accepted the final snapshot and acknowledged it.
If M1 disappears before that checkpoint, a manager may explicitly replace the incomplete
controlled operation with an emergency operation on the same M2. M2's retained operation
state must show no final-copy acceptance, no authorised relinquishment and no possible
activation; persist the replacement, continued M1 restriction and M2's sole AEAT assignment
before activation. M1 stays stepped down and, on return, transfers only fiscal originals and
received outcomes, with no AEAT contact. Once final-copy acceptance exists, activation is
possible, or either history is unknown, keep the original controlled operation and selected M2
until its state and filing assignment are recovered. A lost relinquishment reply is recovered from
M1's durable record, never treated as permission for both to file. This may delay that
controlled move; a new emergency label cannot erase a possible filing assignment.

## 8. Harbour Kitchen: planned replacement

Illustrative proposed behaviour, not a runtime receipt. M1 is the counter server; M2 is the
back-room spare. The internet is disconnected.

1. Manager Nora authenticates freshly and selects M2 in operation HK-41. M1 durably steps down.
   A card request already sent has no answer at its deadline; its identity and uncertainty stay.
2. M1 freezes all writers and transfers its final snapshot and indicator. M2 verifies the
   digest, modules, continuity manifest and each chain/outbox, then durably accepts the copy.
   Table 4's saved bill is in that snapshot.
3. M1 receives that acceptance and records relinquishment. M2 verifies its signed status,
   records assumption and activates its own fresh
   chain/series under the module gates. Tills select M2. Nora checks the uncertain card through
   the payment recovery path; the handover does not charge it again.
4. A power blip restarts M1; its disk says handed over, so it sells nothing and contacts no AEAT
   service. M2 alone handles AEAT, filing M1's copied outbox in M1's fiscal identity and its own
   new sales in M2's identity when AEAT is reachable. No internet gated the move.

## 9. Harbour Kitchen: emergency loss and the fiscal/business gap

Illustrative proposed behaviour. M2's last copy is 21:39. Before M1 fails, it issues invoice
`A-0CNNW/218` at 21:40 for €110.00 gross, €100.00 taxable plus €10.00 tax, paid in cash.
That invoice and its business rows never reached M2.

1. Nora switches off M1, authenticates freshly, selects M2 in HK-42 and accepts the warning and
   last-copy uncertainty. The durable operation records M1's restricted role and M2's sole
   AEAT responsibility. The reconciliation list shows an unknown missing-tail interval after 21:39,
   not invoice 218 or its amounts, which M2 does not yet have.
2. M2 activates its own fresh identity/chain/series. It files unfiled M1 originals already copied
   in their original identities, and its new sales in M2's identity, using known outcomes and
   existing uncertainty/duplicate handling. Each till selects M2. If M1 was only cut off
   and remained on, tills on its side might still sell until it learns; Nora's declaration is
   the defence against that, not a technical proof that the venue has only one writer.
3. M1 returns, learns M2's newer role and stays restricted from business work and all AEAT
   contact. It freezes and transfers missing fiscal originals, including invoice 218, plus
   every received AEAT outcome, even for originals already copied, and unresolved request facts.
   M2 reconciles that evidence and files invoice 218 in its original M1 identity if unfiled;
   uncertainty or a duplicate goes through the existing paths, retaining conflicts. M2 receives
   no cash payment or bill. The list now shows 23 October, €100.00 taxable, €10.00 tax, €110.00
   fiscal gross absent from business sales and the cash record, tracking Nora's acknowledgement
   and later resolution.
4. Keep M1's nonfiscal changes archived and do not replay them. Wipe only after §5's gates. If
   its disk never returns, invoice 218 is unknown to M2: show the unresolved interval, not these
   invented known amounts, and retain the consultation/month-end follow-up. No replacement invoice.

## 10. Relationship to approved designs and inspected code

A947 §§6.2, 6.4 and 7 already choose a manager, reachable-source handover and a returning boot
check. Preserve its fresh chain/series and approved clock/module gates, plus §7.1's receiver-files,
sender-files-nothing direction and full-state/replay controls (§6 quotes the source).
Amend §§6.3, 7.1, 7.2 and their dependent slices explicitly for this protocol's checkpoints,
fiscal-only transfer, business reconciliation and archive/deletion policy; its broader ledger
tail is not compatible by assertion. This correction withdraws the previous A1018 proposal to
reverse emergency filing ownership. §10's reuse across placements remains useful; §13's unresolved
payment, clock, address/browser and physical rehearsal issues remain acceptance work, not solved here.

Standing cold restore also starts a fresh chain with an accepted missing tail. Preserve the
existing selected recovery source, backup key, node recovery key, operation and sole-recovery
gates. No A1018 hard-stop demand is added. A cold restore remains an explicitly selected recovery
action; failed handover never converts into it silently, and a new identity supplies no missing data.

**Read-only observations, runtime UNVERIFIED**, all at Waitron base
`9ebcbb9c2b2c6de4f3f32195ab6dbd7f9516b64d`; none establishes this proposed protocol:

| Exact source                                                                                                                      | Observed boundary                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/promote.ts:148`, `:202`; `packages/fiscal-verifactu/src/allocation.ts:434`                                       | Promotion calls module activation and series checks before committing roles/membership; allocation changes the activating node's fiscal rows.                                                         |
| `apps/server/src/membership-reconcile.ts:33`; `apps/server/src/boot.ts:1442`                                                      | A null peer answer returns unsuperseded; boot invokes this for a configured non-mirror peer. Emergency boot wait requires a change.                                                                   |
| `packages/fiscal-verifactu/src/drain.ts:239`, `:481`, `:569`, `:1726`                                                             | Blocking is built per pass; reset requeues claims; claim SQL selects waiting chains; duplicate handling distinguishes matched, unknown and conflicting results. Durable source restrictions and M2 assignment still need implementation; no emergency predecessor ownership hold is proposed. |
| `apps/server/src/operation-authentication.ts:39`; `apps/server/src/recovery-entry.ts:68`; `apps/server/src/restore-stream.ts:127` | Recovery authority checks a target/action/key; recovery context carries offline/sole declarations; the source-live check accepts `oldBoxGone`. These are not process-death proofs.                    |
| `apps/server/src/node-identity.ts:24`; `packages/membership/src/accept.ts:12`                                                     | Node identity writes a sealed private key; membership acceptance verifies and requires a newer term. Neither establishes clone resistance.                                                            |

## 11. Future acceptance and the Cloud agreement

**UNRUN for this docs task.** Before a build qualifies, exercise both scenarios across all four
placements, including local-to-local with Cloud absent and the internet unplugged. Required
behaviour and adverse controls, meaning deliberately weakening each guard to see its check fail:

| Required behaviour                                                                                                  | Adverse control                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controlled move copies final shared and required local state; M1 stays down across reboot.                          | Remove durable stepdown, omit one manifest item or mutate one late row; reboot/compare must expose it.                                                            |
| Every writer freezes, including webhook, housekeeping and checkpoint work; uncertain external facts survive.        | Race each writer with capture, lose a payment reply, and remove the freeze/uncertainty preservation separately.                                                   |
| Emergency boot checks peer/till before first sale or AEAT contact; no answer waits; newer chart stops work.        | Use stale disk, unavailable peer and a newer till chart; remove the boot gate and observe forbidden work.                                                         |
| Split network warning is shown; tills bind one target; old running M1 stops when informed.                          | Keep M1 live behind a partition to demonstrate the disclosed overlap, then deliver the newer chart.                                                               |
| After either takeover M2 alone handles all AEAT communication; it files copied and later-returned old originals in their generating identities, and new sales in its own. | Reinstate an emergency predecessor ownership hold or substitute M2's identity in an old original; each must fail. Reboot/reset/retry must keep M1 from filing, consulting or otherwise contacting AEAT. |
| Controlled M2 files copied M1 records only after source relinquishment; M1 never resumes that queue.                | Lose replies and reboot both machines between relinquishment and assumption; remove the source restriction.                                                       |
| Tail transfer includes all received outcomes and missing originals; known results, uncertainties, duplicates and conflicts use existing paths without losing evidence. | Re-run A947's amended S2 with its fence-removed and missing-only-batch controls, plus the replay variant. Use real drain/duplicate handling for an earlier copied row, an uncertain send and conflicting outcomes. |
| A1034 must check old-tail continuation after the new chain starts, interleaving and an old-server-filed record resent by M2 on AEAT's test service. | Retain exact requests/replies and identity comparisons; an accepted first record alone cannot satisfy these checks. Record objects and response SOAP are observed in the 2026-10-23 A1034 receipt above; raw request SOAP was not captured, and physical transfer and fencing remain unrun. |
| Fiscal-only return produces the dated gap list and retained archive; no business replay or early wipe.              | Include changed orders/payments/cash/stock rows, missing fiscal filing rows and a failed archive/health check.                                                    |
| Concurrent requests, mid-handover crashes and lost activation replies preserve selected M2 and one filing owner.    | Crash before/after durable copy acceptance and relinquishment, request emergency replacement, lose each reply and remove the respective checkpoint/input binding. |
| Authorised restore remains usable without hard-stop proof; no silent fallback; PIN alone cannot declare.            | Add a proof requirement, automatic conversion or PIN-only authentication and require the respective check to fail.                                                |

Cloud files were read only at local HEAD `b85a6a0f72f8414f0fbb359603263f367d33b9ba`:
production design §§3/6/9/12, deployment plan P6/P7, D88 hosting recovery wording and the
integration contract's A1018 section. These are historical inputs, not current agreement or
runtime evidence. The shared Cloud home remains **`docs/waitron-integration-contract.md`**.

The currently pinned Cloud #312 publication at `7e3ba8246a6d5dbeb4275ed7c00f2f34124c944a`
still assigns emergency predecessor filing to M1 and prohibits M2 from filing those chains.
That assignment is rejected by the 15:37 owner answer. **G/D133 must amend the canonical text
and pin acceptance of this revision before the short owner question.** The historical direction
blocks above are not Cloud agreement with this correction, runtime evidence or build approval.

**Proposed replacement for its A1018 section, for Lane G to agree:** “A1018 uses the same
controlled and emergency handover for local and hosted machines. Controlled: durable M1
self-stepdown, bounded admitted work, complete final state checked by selected M2, then M2's
fresh-chain activation. Emergency: freshly authenticated authorised human declares M1 stopped
and no parallel recovery, accepts last-copy uncertainty, and M2 activates a fresh chain.
After either takeover M2 alone handles all AEAT communication: copied and later-returned old
originals retain their generating fiscal identities; new sales use M2's identity. Returning M1
contacts no AEAT service and transfers missing fiscal originals, all received outcomes including
those for copied originals, and uncertainties. M2 reconciles known results, uncertainty and
duplicates through existing paths, retaining conflicts. Only fiscal data returns, with a visible
business reconciliation gap and retained archive. No emergency predecessor ownership hold
prohibits M2 filing. No outside authority, hardware/provider proof or periodic lease is required.
Controlled copy acceptance and source relinquishment still precede M2's assumption; unresolved
possible activation waits. Operation state and existing signed membership bind retries to M2. The
2026-10-22 direction agreement is superseded; this revision awaits agreement and owner approval.”

Ask G to replace P6's stop-proof dependency with this joint protocol; make P7's venue recovery
use one of these explicit scenarios without inventing authority during region recovery; amend
D88's hard-fence requirement and cold-recovery table; replace production §9's universal stop
proof and same-chain-fork wording with the two scenarios and disclosed business split risk.
Align production §§3/6/12: an automation permission or restart exception supplies no emergency
human declaration, final-state equality or fiscal authority. Agree the Cloud actor mapping,
node-local manifest, source restrictions, sole M2 AEAT assignment and retry bindings; pin the
revised shared contract publication and its acceptance through G/D133.

After G's pinned acceptance, the driver cites [A947 §7.1](2026-10-21-a947-two-box-failover-design.md#71-the-tail-and-the-fix-for-the-failed-prototype-scenario)
and [asesor Q2](../../compliance/asesor-questions.md#q2-may-a-node-other-than-the-till-transmit-the-tills-records-to-aeat),
and cites the dated A1034 test-service observation in §6 with its physical-handover and legal limits.
Then ask **one short question**, with §§8–9 and the unchanged proposed defaults available:
“Do you approve the revised Harbour Kitchen handovers and retained defaults, with M2 alone
handling AEAT after either takeover and M1 returning only fiscal originals and received outcomes?”
That question is not asked here. Design approval, A947/Cloud amendments, build authority and
runtime acceptance remain separate pending steps.
