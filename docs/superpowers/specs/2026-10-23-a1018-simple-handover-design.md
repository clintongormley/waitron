# A1018: a simple handover between two machines

**2026-10-23 | PROPOSED owner-directed REVISION.** Fresh builder review completed; awaiting Cloud
agreement through Lane G, then **one owner design question** containing both examples below.
No build approval or implementation plan. Recommendations below need approval; the owner's
02:25 rejection and 02:58 five-point direction settle the model, not these policy defaults.

You need to replace the machine running your venue without needing Cloud to exist. Call the
old machine M1 and the selected replacement M2. If M1 answers, it stops its work and gives M2
its complete final state. If M1 cannot answer, you declare it shut down and explicitly accept
that M2's last copy may miss records. M2 keeps its own node identity and starts a fresh fiscal identity, chain and invoice series
in both cases, through the approved module gates. It never continues M1's writer chain.

This replaces the [rejected proposal](2026-10-22-a1018-cloud-stop-proof-design.md), rather than
qualifying its external proof mechanism. The old Waitron `db7cddeb2` / Cloud `6700d6f` direction
agreement, published through Cloud #300, is historical and **no longer current agreement**.

## 1. Direction and placement

The owner's exact messages are in `/Users/clintongormley/waitron-campaign-e/questions.md`, from
`**OWNER ANSWER (2026-10-23 ~02:25` through the five points at ~02:58. Queue A1018 retains its
original start, 2026-10-22 16:14. Its old stop-proof brief is replaced by those messages.

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
   M1 remains the restricted filing owner until the verified-copy checkpoint below.
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
about its replacement: before trading or filing on boot, it asks M2 or a till for the current
signed membership and operation information. A verified newer role stops it immediately.
No reachable peer or till means wait for an authorised human, not assume primary. A stale chart
alone cannot clear that wait. A947's same-authentication continue-without-spare choice must name
the other machine and confirm it is off with no parallel recovery; it cannot undo a known handover.

On M2, stop following, apply the available copy and check integrity and fiscal chains without
starting business work. Show which copy is available and when it last advanced, explicitly say
the final tail is unknown, and ask the freshly authenticated person to confirm **M1 is shut
down, no parallel recovery is in progress, and this copy's uncertainty is accepted**. Persist the
declaration and predecessor-chain holds before activation. M2 then uses its own node identity and a fresh fiscal
identity/chain/series through the same module gates, not M1's old writer identity.

**Point 2: a network split can leave both machines selling.** M1 may still serve tills on its
side of a broken switch while M2 starts on your statement. It stops admitting work immediately
when it learns of the newer role through a verified chart, then bounds admitted work as in §2.
There is no promise of stopping an isolated, already running M1 before it learns. Distinct node
chains avoid sharing one writer chain; bills, payments, cash and stock still diverge. They do
not merge afterwards. One machine per till is not proof of one writer for the whole venue.

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
Transfer original immutable fiscal records and the fiscal chain, filing rows and received
outcomes needed to understand them. Do not replay orders, payments, cash, drawer, stock,
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

## 6. Point 4: exactly one filing owner for each predecessor chain

**Controlled recommendation:** hand M1's outbox to M2, without making handover depend on AEAT.
After M2 durably verifies the final copy and acknowledges it, M1 records relinquishment for
the selected M2 outside the frozen payload. Its signed operation status binds that decision
to the operation and final-state indicator. M2 verifies and records it before assumption.
A lost acknowledgement leaves M1 unable to file; retry reads the same operation. M1 must never
file that queue after M2 assumes it. Preserve unanswered requests and use the existing real
duplicate-handling path when their results need checking, never an automatic blind resend.

**Emergency owner direction:** M1 files when it returns. M2 must not file any emergency
predecessor chain assigned to M1, **including records already present in M2's last copy**.
Persist a chain-specific hold before any restart-reset, claim, retry, reconciliation or filing
worker can send them. Enumerate every chain M1 owned, including previously inherited filing
queues; unknown ownership remains held. M2 may file its own new chain while those holds remain.

Returning M1 first learns its restricted role. It may then run in **filing-only mode** for its
assigned chains, with no new sales, orders, settlement, payment actions, drawer or stock effects.
Exchange received terminal outcomes and uncertainties for those chains with M2, check conflicts
through the existing duplicate-handling and filing-case paths, then freeze the fiscal tail and
transfer it with counts, heads and fiscal totals. Include outcomes for records M2 already holds,
not only missing originals. A received terminal answer must not be lost on a retry.

The durable local operation records chain ownership, relinquishment/assumption and transfer
progress. The emergency transfer of records **does not transfer filing ownership to M2**.
If M1 still has pending or uncertain results, it remains the restricted filing owner, M2 keeps
the hold, and neither wiping nor archive deletion proceeds. Later outcome transfers use a new
frozen batch within the same operation; retries of one batch return identical data. Conflicting
terminal outcomes retain both facts and an open case, rather than whichever arrived last winning.
If M1's disk is lost, its missing originals and unsent chains remain an explicit unresolved gap.

This changes A947 §6.3's receiver-files rule and §7.1's sender-files-nothing rule for emergency
return. It requires an explicit amendment, including its prototype controls, before implementation.
It is not how the current drain or the approved A947 return design already works.

## 7. Point 5: who may declare, and simple retry rules

**Recommendation for approval, consistent with A947 §6.2:** the owner or an authorised manager
holding `node.promote`, with fresh dashboard-equivalent passkey authentication or password plus
TOTP when enrolled. TOTP is the authenticator app's one-time code. A till PIN alone is inadequate.
This is the proposed default for this revision, not a newly approved A1018 owner decision.
Cloud-account authority must map to this venue permission by agreement with Lane G.

Audit the exact declaration and accepted uncertainty, reason, venue, both machines, actor,
last known copy, time and operation id. A Cloud declaration also identifies the provider resource
the person stopped; it asserts no automatic provider verification. For reachable M1, offer the
controlled path; never silently downgrade a failed controlled handover to an emergency or restore.

Keep one durable operation per selected M2 and expected membership revision. Persist progress
locally as prepared, source stepped down or emergency declared, copy checked, activated, and
return reconciliation pending/complete, with the result or reason for waiting. Same id and same
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
state must show that it never accepted the final copy or authorised relinquishment; persist
the replacement and predecessor-chain holds before activation. M1 stays stepped down and,
on return, follows the emergency filing assignment. Once final-copy acceptance exists, or
its history is unknown, keep the original controlled operation and selected M2 until its
state and filing assignment are recovered. A lost relinquishment reply is recovered from
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
4. A power blip restarts M1; its disk says handed over, so it sells and files nothing. M2 files
   M1's copied outbox in M1's fiscal identity when AEAT is reachable. No internet gated the move.

## 9. Harbour Kitchen: emergency loss and the fiscal/business gap

Illustrative proposed behaviour. M2's last copy is 21:39. Before M1 fails, it issues invoice
`A-0CNNW/218` at 21:40 for €110.00 gross, €100.00 taxable plus €10.00 tax, paid in cash.
That invoice and its business rows never reached M2.

1. Nora switches off M1, authenticates freshly, selects M2 in HK-42 and accepts the warning and
   last-copy uncertainty. M2 holds all M1 predecessor chains, including their copied outbox rows.
2. M2 activates its own fresh identity/chain/series. Each till selects M2. If M1 was only cut off
   and remained on, tills on its side might still sell until it learns; Nora's declaration is
   the defence against that, not a technical proof that the venue has only one writer.
3. M1 returns, learns M2's newer role and stays out of business work. In restricted filing-only
   mode it files its assigned records, reconciles received answers/uncertainties, then freezes
   and transfers the fiscal tail. M2 receives invoice 218 and its filing evidence, not its cash
   payment or bill. The list shows 23 October, €100.00 taxable, €10.00 tax, €110.00 fiscal gross
   absent from business sales and the cash record, tracking Nora's acknowledgement and later resolution.
4. Keep M1's nonfiscal changes archived and do not replay them. Wipe only after §5's gates. If
   its disk never returns, invoice 218 is unknown to M2: show the unresolved interval, not these
   invented known amounts, and retain the consultation/month-end follow-up. No replacement invoice.

## 10. Relationship to approved designs and inspected code

A947 §§6.2, 6.4 and 7 already choose a manager, reachable-source handover and a returning boot
check. Preserve its fresh chain/series and approved clock/module gates. Amend §§6.3, 7.1, 7.2
and their dependent slices explicitly for emergency filing ownership, fiscal-only transfer,
business reconciliation and archive/deletion policy; its broader ledger tail is not compatible
by assertion. §10's reuse across placements remains useful; §13's unresolved payment, clock,
address/browser and physical rehearsal issues remain acceptance work, not solved here.

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
| `packages/fiscal-verifactu/src/drain.ts:239`, `:481`, `:569`, `:1726`                                                             | Blocking is built per pass; reset requeues claims; claim SQL selects waiting chains; duplicate handling distinguishes matched, unknown and conflicting results. Durable ownership holds are proposed. |
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
| Emergency boot checks peer/till before first sale or filing; no answer waits; newer chart stops work.               | Use stale disk, unavailable peer and a newer till chart; remove the boot gate and observe forbidden work.                                                         |
| Split network warning is shown; tills bind one target; old running M1 stops when informed.                          | Keep M1 live behind a partition to demonstrate the disclosed overlap, then deliver the newer chart.                                                               |
| Emergency holds cover already-copied predecessor rows through reset/retry and reboot; only M1 files them on return. | Remove chain ownership filtering; an attempted M2 predecessor submission must fail the test.                                                                      |
| Controlled M2 files copied M1 records only after source relinquishment; M1 never resumes that queue.                | Lose replies and reboot both machines between relinquishment and assumption; remove the source restriction.                                                       |
| Tail transfer includes old terminal results and missing originals; unknown/conflicting results stay visible.        | Re-run A947's amended S2 and replay controls using real drain/duplicate handling, including an earlier copied row.                                                |
| Fiscal-only return produces the dated gap list and retained archive; no business replay or early wipe.              | Include changed orders/payments/cash/stock rows, missing fiscal filing rows and a failed archive/health check.                                                    |
| Concurrent requests, mid-handover crashes and lost activation replies preserve selected M2 and one filing owner.    | Crash before/after durable copy acceptance and relinquishment, request emergency replacement, lose each reply and remove the respective checkpoint/input binding. |
| Authorised restore remains usable without hard-stop proof; no silent fallback; PIN alone cannot declare.            | Add a proof requirement, automatic conversion or PIN-only authentication and require the respective check to fail.                                                |

Cloud files were read only at local HEAD `b85a6a0f72f8414f0fbb359603263f367d33b9ba`:
production design §§3/6/9/12, deployment plan P6/P7, D88 hosting recovery wording and the
integration contract's A1018 section. These are historical inputs, not current agreement or
runtime evidence. The shared Cloud home remains **`docs/waitron-integration-contract.md`**.

**Proposed replacement for its A1018 section, for Lane G to agree:** “A1018 uses the same
controlled and emergency handover for local and hosted machines. Controlled: durable M1
self-stepdown, bounded admitted work, complete final state checked by selected M2, then M2's
fresh-chain activation. Emergency: freshly authenticated authorised human declares M1 stopped
and no parallel recovery, accepts last-copy uncertainty, and M2 activates a fresh chain while
holding M1's filing queues. M1 files on restricted return; only fiscal data returns, with a
visible business reconciliation gap. No outside authority, hardware/provider proof or periodic
lease is required. Operation state and existing signed membership bind retries to M2. The
2026-10-22 direction agreement is superseded; this revision awaits agreement and owner approval.”

Ask G to replace P6's stop-proof dependency with this joint protocol; make P7's venue recovery
use one of these explicit scenarios without inventing authority during region recovery; amend
D88's hard-fence requirement and cold-recovery table; replace production §9's universal stop
proof and same-chain-fork wording with the two scenarios and disclosed business split risk.
Align production §§3/6/12: an automation permission or restart exception supplies no emergency
human declaration, final-state equality or fiscal authority. Agree the Cloud actor mapping,
node-local manifest, chain holds and retry bindings; pin the revised shared contract publication.

After Lane G agreement, the driver asks **one question**, with §§8–9:
“Do you approve Harbour Kitchen's planned and emergency handovers as shown, including the
split-network warning, the recommended `node.promote` manager with fresh passkey or password
and enrolled TOTP, the reconciliation list instead of imported payment totals, M2 filing M1's
controlled queue but M1 filing after emergency return, archives kept while gaps remain, and an uncertain controlled move waiting for its recorded filing assignment?”
That question is not asked here. Design approval, A947/Cloud amendments, build authority and
runtime acceptance remain separate pending steps.
