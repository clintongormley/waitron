# Preventing fiscal conflicts and recovering offline (W41s)

Status: **design approved by the owner, 2026-10-04 ("lgtm").** The recommendations in §6 are
accepted; detailed allocation formats and verification conditions still need resolution before
their dependent implementation tasks. The owner chose queue execution. The
[revised implementation plan](../plans/2026-10-04-fiscal-prevention-and-offline-recovery.md)
awaits review. No implementation or new live AEAT probe is claimed by this approval.

This updates the [2026-10-03 design](2026-10-03-fiscal-chain-divergence-design.md). Its incident
research and decision history remain available there; the changes below take precedence where
they differ. The [old implementation plan](../plans/2026-10-03-fiscal-chain-divergence.md) needs
replacement by the revised plan linked above. Adviser questions live in
[asesor-questions.md](../../compliance/asesor-questions.md), Q5(f) and Q33–Q41.

## 1. Start with prevention

The owner wants to prevent conflicts between issued invoices and records held by AEAT, including
when disaster recovery restores an old database or disk image. Recovery must work on completely
new hardware with only an old backup, without internet or any surviving box, till or handheld.
An administrator-led procedure is acceptable.

Fresh identities prevent reuse only under the allocation procedure's assumptions. They neither
recover missing invoices nor establish that the old machine has stopped. The product must state
those limits instead of promising that every rollback is detectable or that a random identifier
has certainly never been used.

## 2. Agreed recovery requirements

- Every database or disk restore is an explicit administrator recovery. An ordinary software
  rollback must preserve fiscal data; an incompatible version cannot silently rewind it.
- The administrator confirms that the old machine is offline and no other recovery is in
  progress. This is operational assurance, not a remotely enforced lock.
- Before issuing new invoices, allocate a fresh installation identity and new series for every
  invoice category the venue uses. Retire the restored series from further issuance; preserve
  their original records and numbers. Do not resume an old series by guessing its next number.
- The allocation history must survive independently of the restored backup. A separate file on
  the same restored disk is not the baseline solution.
- A recovery pack includes the break-the-glass key and a paper allocation register. The pack
  must be available without subscribing to a cloud service or configuring a backup bucket.
- A cloud allocation registry is an optional subscription, available whether the venue database
  runs on premises or in the cloud. It reserves allocations; merely reporting last-seen values
  is insufficient.
- An administrator can claim an allocation using a phone's cellular connection and enter it
  manually into the offline box. Subscribers may also keep allocations reserved in advance on
  paper. Non-subscribers rely on paper, without assuming cloud reservations exist for them.
- Available devices and an administrator's remembered invoice provide additional evidence.
  Recovery must not require enrolling tills or handhelds first. A last-seen invoice is only a
  lower bound on what was issued.
- Where allocation history is unavailable, a longer randomly generated emergency series prefix
  is accepted. Its uniqueness is probabilistic; its exact format and the corresponding emergency
  installation identity remain to be specified.
- Later, an administrator may explicitly close the emergency series and select a freshly
  allocated short series. Internet reconnection does not trigger this automatically. Already
  issued invoice identities remain unchanged; the retired series is not reused.

An undeclared full-disk rollback can restore the software's own evidence along with the data.
Without an independent witness, the restored state may look consistent. This design relies on
declared recovery and outside allocation history; it does not claim to detect every such rollback.

## 3. Proposed allocation procedure

Use one allocation policy across initial setup, recovery, re-registration and promotion to the
selling role. Account for all Waitron installations of the taxpayer and for invoice series used
by other systems. The short name is an allocation, not a counter trusted from an old backup.

1. Identify the taxpayer, environment and recovery event. Preserve the backup and available
   incident evidence before changing the restored installation's active identity.
2. Obtain the administrator's sole-recovery and old-machine-offline confirmations.
3. Select an allocation from the current paper register or optional cloud reservation. A phone
   reservation must be bound to the intended taxpayer and environment and checked when entered.
4. Record the installation identity, all series, operator and date outside the restored database
   before enabling issuance. Mark the allocation consumed even if the recovery is abandoned.
5. Activate it locally as one recoverable operation. If recovery is interrupted, resume that
   recorded allocation only with evidence that it belongs to this same recovery; otherwise
   consume another allocation. Never make a consumed allocation free again.
6. Retain the history in the recovery pack. A pack printed from an old backup must not replace
   the newer paper register or imply that its list is current. Incident exports never include the
   break-the-glass secret.

The implementation design must specify how paper and online allocation avoid overlapping names,
including a subscriber using paper while another administrator can reach the registry. It must
also cover importing existing paper allocations when a customer subscribes. Pre-reserving a
paper allocation in the registry is one supported case, not an assumption about every customer.

For the emergency route, propose a distinct naming space so later short allocations do not
collide with emergency names. Specify allowed characters, length, randomness, installation
identity and manual-entry checks before implementation. Do not use a clock value alone as the
uniqueness argument. Failed and repeated recoveries belong in the same design.

## 4. Ordinary issuance and filing

These are proposed requirements, not a claim that all current paths have been verified:

- Commit invoice allocation, sale, fiscal record and submission intent together before exposing
  the issued receipt. A retry with surviving transaction identity returns the original result.
  A restore that lost that identity requires investigation, not a guess that equal totals mean
  the same sale.
- Validate locally detectable mistakes before creating an immutable fiscal record. AEAT and the
  internet remain outside the sale path.
- Retry the original stored fiscal content, identity, fingerprint and chain link. Submission
  metadata may need different treatment; this is not a requirement that every envelope byte stay
  identical.
- Send records in generation order within each chain, with consecutive records allowed in a
  batch. A retry delay must not let a later record overtake an earlier unknown outcome.
- Persist each returned record outcome individually. A definitive rejection must remain
  distinct from an unknown outcome. D2 proposes allowing later records to proceed after a
  definitive rejection, subject to the direct predecessor tests in §7.
- Keep original rejected records and append the appropriate corrective records. Continuing the
  queue is not evidence that the rejected invoice is resolved.
- Compare fingerprints for every duplicate. Matching date, total and tax do not justify
  accepting a fingerprint mismatch as the same sale. Q38 applies only after independent evidence
  establishes that identity.
- A cancellation depends on establishing what happened to the invoice it names. Distinguish an
  unknown outcome, an accepted original, a rejected absent original and a conflicting identity.
  Do not require an accepted original for every possible cancellation operation; Q40(c) covers
  the documented absent-original case.

## 5. Existing W41s decisions

| Decision | Treatment in this revision |
| --- | --- |
| D1: automatic new chain after conflict | The approved §6 condition qualifies the 2026-10-03 automatic policy: a consumable allocation and established selling authority. Otherwise use administrator recovery. Declared restores are administrator-led. Remove the same-amounts exception. |
| D2: ordinary rejection does not stop later filing | Retain the condition that a live probe establishes what happens to successors linked to a rejected record. No new probe result is claimed. |
| D3: active series read per sale | Retain; it also enables the explicit later move to a fresh short series. |
| D4: staff actions allowed, conflicting fiscal records held | Retain as the interim proposal subject to Q35/Q40. Specify how a held record is eventually resolved; do not present the hold as a final legal remedy. |
| D5: surviving old-chain records filed unchanged | Retain its adviser and live-probe conditions. It cannot file missing records. |
| D6: Fiscal filing screen under Reporting | Retain location, permission and owner review. Show unresolved invoices separately from queue progress. |
| D7: external checks and device witnesses | Keep useful evidence optional during offline recovery. A signed external bucket witness differs from a file on the restored disk. Online fencing is additional protection; changing identity alone does not fence the old machine. |
| D8: clock warning without blocking sales | Retain the one-minute warning decision. |
| D9: short series checked against local/device/AEAT history | Replace the allocation method with §2–3. Lookups supply evidence, not reservations. Add the agreed emergency prefix and explicit later short-series change. |

## 6. Approved scope, remaining technical decisions and adviser questions

**Automatic unexpected-conflict recovery.** Approved with this design: automate only when an
allocation can be consumed under the agreed policy and the selling authority is established;
otherwise use the administrator recovery procedure. Specify the offline branch, the existing
24-hour loop guard and how trading proceeds while the conflict is investigated. Random series
alone do not settle competing-machine authority. This qualifies D1; the exact evidence and
offline procedure must be specified at the revised plan's allocation-contract checkpoint.

**Corrective workflow scope.** Approved with this design: include a usable path to resolve a
rejected invoice in the overall recovery plan. This supersedes the old plan's exclusion of a
correction-record builder. Do not leave the operator with only a continuing queue and an alert.
Q37 supplies the legal classification, and Q35/Q40 address ambiguous invoice identities.

**Emergency identity and uncertain paper history.** Longer random series are agreed. The
installation identity format, allocation collision policy and manual confirmations must still be
specified, including recovery where only an old pack survives. These are engineering decisions;
the adviser is asked about justification and evidence, not to certify randomness.

The updated adviser list retains Q33–Q40 and adds Q41:

- Q5(f): reasons and formats for new series, including retiring the emergency series.
- Q33: automatic conflict switching and evidence retained for manual offline recovery.
- Q34: surviving records from the old installation; Q41: issued invoices missing from the backup,
  including never-filed invoices, accounting treatment and history recovered later.
- Q35/Q36: two real sales sharing a number, on the same date or different dates.
- Q37: appropriate correction for each rejection; Q38: independently established duplicate sale.
- Q39: evidence that a purported sale never happened; Q40: held records and appropriate use of
  cancellation without a registered original.

## 7. Verification before implementation decisions are treated as settled

Retain the old plan's relevant probes, but strengthen the first one. A random nonexistent
predecessor does not by itself test the rejected-predecessor case the user raised.

| Experiment | Distinguishing observation |
| --- | --- |
| First record deliberately rejected, successors linked to it in the same batch | Compare each successor's status and error with a valid batch control. Save the complete per-record response. |
| Rejected predecessor, then successor in a separate submission | Compare with an accepted-predecessor control. This separately tests proceeding after a known rejection. |
| Unknown result after a lost response | Exercise recovery and retry without rebuilding original records; observe whether a dependent cancellation can overtake it. |
| Cancellation of an absent rejected original | Compare `SinRegistroPrevio=S` with an ordinary cancellation control using separate synthetic invoice identities. Acceptance tests the protocol, not whether cancellation is the legal remedy. |
| New installation with the same software identifier | Retain the old probe distinguishing a reused installation from a newly allocated one. |
| Duplicate with different contents, credit note naming a rejected invoice, registered-name validation | Retain the corresponding original probes and their controls. |

Run filings only against preproduction with synthetic data. Retain request/response evidence
without credentials. If the service results contradict D2 or D5, revise the design before
implementing the dependent behaviour. The existing first-record probe does not test a successor
linked to its rejected record: its corrected record retains the accepted predecessor's link
(`scripts/live-aeat.mjs` in the separate `verifactu` repository, inspected 2026-10-04).

Later local behavioural tests must cover an old-backup restore on fresh hardware without
network or devices, repeated and interrupted recovery, concurrent allocation, stale paper packs,
the phone-entry path, and switching to a fresh short series without renumbering old invoices.
Use controls that would expose allocation reuse and unintended dependence on online services.

## 8. Primary-source boundaries

The [adviser document's provenance table](../../compliance/asesor-questions.md#sources-checked-for-the-2026-10-04-revision)
records the official wording checked on 2026-10-04. In particular, Q40(c)'s absent-original
cancellation is documented in service specification §9.2.3, and developer FAQ §17 addresses
corrective operations. Neither source validates our recovery allocation algorithm or resolves
every legal scenario above. The source review and a live-service experiment are separate evidence.
