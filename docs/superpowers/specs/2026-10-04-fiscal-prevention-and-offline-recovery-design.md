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

### 7.1 Protocol receipt, 2026-10-05 (W41s-1)

Eight synthetic preproduction runs used `@waitron/verifactu` 0.2.1 with probe head
`d99e1077387dfa491ef3816c875ddc822bdbf3c4` in
[verifactu PR #132](https://github.com/waitron-io/verifactu/pull/132).
The local probe suite passed 97/97 with `node --test scripts/live-aeat.test.mjs`.
These observations describe the requests below. They do not settle legal remedies or
prove every rejection behaves like the tested code 1161.

| Case and source run | Observed individual outcomes |
| --- | --- |
| [Same batch, 3 records](https://github.com/waitron-io/verifactu/actions/runs/37283677375) | All 3 control records `Correcto`; rejected first record `Incorrecto`, code 1161, and both linked successors `Correcto`. Rejected envelope `ParcialmenteCorrecto`. |
| [Later batch](https://github.com/waitron-io/verifactu/actions/runs/37283909983) | Valid predecessor and both later control successors `Correcto`; invalid predecessor `Incorrecto`, code 1161, then both linked successors `Correcto` in a separate submission. |
| [1,000-record batches](https://github.com/waitron-io/verifactu/actions/runs/37283910284) | All 1,000 control records `Correcto`. Test first record `Incorrecto`, code 1161; all 999 successors `Correcto`. Each of the 2,000 submitted identities had exactly one response. Every adjacent successor projection named the preceding sent hash and invoice identity. |
| [Cancellation comparison](https://github.com/waitron-io/verifactu/actions/runs/37286358223) | Ordinary alta and its ordinary cancellation `Correcto`; separate absent-original cancellation with `SinRegistroPrevio=S` `Correcto`. The absent identity was never submitted as an alta in this run; this is not a cancellation of the rejected predecessor from the other runs. |
| [Changed-content duplicate](https://github.com/waitron-io/verifactu/actions/runs/37286361433) | Distinct control and original `Correcto`; same invoice identity with a changed total (1.21 to 2.42) and different sent hash `Incorrecto`, code 3000. The receipt does not contain a lookup of the stored original fingerprint. |
| [Fresh installation](https://github.com/waitron-io/verifactu/actions/runs/37286364837) | Two first records with distinct invoice identities and installation names under software ID `WT` both `Correcto`. The first installation was created by this probe, not restored from an old backup. No old-chain continuation or fencing experiment ran. |
| [Credit naming a rejected invoice](https://github.com/waitron-io/verifactu/actions/runs/37286368370) | Control original and credit `Correcto`; test original `Incorrecto`, code 1161; credit naming and chaining to that rejected invoice `Correcto`. This tests protocol acceptance, not the legal remedy. |
| [Registered-name mismatch](https://github.com/waitron-io/verifactu/actions/runs/37286371546) | Correct-name control and record-level issuer name `Nombre incorrecto para prueba` both `Correcto`; the authenticated request header retained the configured name. This does not test a wrong taxpayer identity or header name. |

The rejection trigger was `RechazoPrevio=S` without `Subsanacion=S`. AEAT's response says
“no podrá incluirse el campo RechazoPrevio con valor S” under that condition (same-batch run).
Each workflow completed successfully and its final evidence reported `incomplete=false`.
No transport or whole-envelope failure interrupted these eight runs; record-level rejection
is reported separately from the envelope status.

[Saved evidence](2026-10-05-aeat-protocol-evidence.json) retains the logged request projections
(invoice identities, sent hashes, previous links and distinguishing values) and parsed response
projections, including all large-batch line outcomes. Raw SOAP request and response bytes were
not captured by these modes. Download the source archive with
`gh api repos/waitron-io/verifactu/actions/runs/<run-id>/logs`; the ordinary
`gh run view 37283910284 --log` omitted the long batch-result lines when checked on 2026-10-05.
Read the archive's `live/6_Call AEAT preproduction.txt` for the complete large-batch projections.

The owner-approved temporary environment branch policy was removed after collection.
`gh api repos/waitron-io/verifactu/environments/aeat-preproduction/deployment-branch-policies`
returned only `main` (policy 60719401). Commit
`1ccb5093756e5c72d76315a49fafe85cd9125363` restored the workflow's original main-only job condition.
The library PR remains for owner review. D2 still requires the plan's owner-reviewed PR gate;
D5's old-chain survival and adviser gates remain. Targeted lookup returning `SistemaInformatico`
and the stored duplicate fingerprint are unverified by these probes.

## 8. Primary-source boundaries

The [adviser document's provenance table](../../compliance/asesor-questions.md#sources-checked-for-the-2026-10-04-revision)
records the official wording checked on 2026-10-04. In particular, Q40(c)'s absent-original
cancellation is documented in service specification §9.2.3, and developer FAQ §17 addresses
corrective operations. Neither source validates our recovery allocation algorithm or resolves
every legal scenario above. The source review and a live-service experiment are separate evidence.

## 9. Proposed allocation and recovery contract (W41s-0; owner review pending)

This appendix is a proposed implementation contract. It does not describe a shipped recovery
feature or establish a legal remedy. An allocation names a *set* of fresh fiscal identities for
one activation, not permission to resume a number found in an old database. The external register
is authoritative for whether a name was reserved or consumed. A restored database is evidence of
past use, never evidence that an absent name is free.

### 9.1 Names, scope and bounds

For one taxpayer NIF, `IdSistemaInformatico` and environment, use four disjoint ASCII spaces:

| Source | Installation identity | Example | Authority |
| --- | --- | --- | --- |
| Initial short allocation | `S` and six decimal digits | `S000001` | The taxpayer's paper allocation custodian or registry |
| Paper recovery allocation | `P` and six decimal digits | `P000042` | The taxpayer's current master paper register |
| Cloud reservation | `C` and six decimal digits | `C000042` | The subscription registry |
| Emergency recovery | `E` and 26 Crockford Base32 characters | `E3K4N2Q8R5T9V3W6X1Y0ZAHJPM` | Fresh operating-system cryptographic randomness and the administrator's incident record |

The prefixes separate the sources even if their counters coincide. A six-digit short space has a
finite capacity; exhaustion refuses another short allocation in that space. The custodian assigns
short serials monotonically within the full `(NIF, IdSistemaInformatico, environment, prefix)`
scope, across all of that taxpayer's venues and nodes. A second venue never starts its own `P000001`
book. Environments keep separate registers; copying a preproduction allocation to production is
refused. A taxpayer using another fiscal system must reserve its series outside this policy too;
Waitron cannot infer that system's history from its own database.

Each allocation lists every series to activate, with an explicit purpose. For example, a venue
whose configured bases are `A`, `R` and `FF` receives `A-P000042` (standard), `R-P000042`
(rectificative) and `FF-P000042` (standard). The list is frozen when the allocation is issued;
changing the configured bases requires a new allocation. It must contain exactly the category
set the venue needs, with no duplicate code. The activation binds all of them to the installation
identity in one transaction. The emergency example uses the same suffix rule. A later short
allocation retires the emergency series; it does not rename or renumber their invoices.

The proposed local format is stricter than the current wire format: uppercase ASCII letters,
digits and hyphen for the installation identity, and `[A-Za-z0-9/_.-]` for invoice numbers.
The installation identity is at most 27 characters. A series base is at most 21 characters:
`21 + 1 + 27 + 1 + 10 = 60` for `<base>-<installation>/<counter>`.
The counter is 1 through 9,999,999,999; reaching the bound refuses further issuance from that
series and requires a newly allocated identity. A candidate and a boundary-value record must pass
the actual `@waitron/verifactu` validator before the allocation is issued; no pack is printed from
an unvalidated candidate. The library checks `NumSerieFactura` for 1–60 characters and the stated
character set (`verifactu/src/validate.ts:583–591`), while it treats `NumeroInstalacion` as text
up to 100 characters (`verifactu/src/validate.ts:694`). The `IdSistemaInformatico` validator
requires exactly two uppercase letters or digits (`verifactu/src/validate.ts:650–661`). These
are library checks, not a claim that AEAT has accepted these example values.

Generate an emergency suffix from 128 unbiased random bits with the operating system's
cryptographic generator. Encode it as 26 Crockford Base32 characters using
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`; the first symbol must be `0`–`3`, so a decoded value outside
the 128-bit range is refused. Do not use the wall clock, a device identifier or the restored counter as
entropy. Distinct independent draws collide with probability about `n(n-1)/2^129` after `n`
emergency allocations; they provide a probability, never a uniqueness guarantee. A manual entry
shows the grouped identity and a checksum *outside* the fiscal identity, then verifies the
checksum before removing display separators. A checksum catches transcription mistakes, not an
allocation collision or a forged claim. The display checksum is four uppercase hexadecimal digits
of CRC-16/CCITT-FALSE over the 27 ASCII identity bytes; it is checked separately and never filed
as part of the identity. The administrator records the emergency name in the outside register
immediately. If a known name matches any outside evidence, discard it and draw
another. If the outside history is missing, the emergency route remains available after the
administrator records that uncertainty and confirms old-machine isolation; it makes no claim of
certain uniqueness.

### 9.2 Authority and consumption

Before printing a paper block, its custodian reserves its exact serials in the master register
and records the block ID, taxpayer, software ID, environment, allowed series bases, recipient
venue and pack version. A venue receives a signed snapshot of that block; the master remains
outside every venue backup. A paper block can be transferred only through the custodian, who
records the transfer before either venue can use it. The master has one named custodian and one
writable original; duplicate paper copies carry no claim authority. A venue cannot mint new short
paper serials from a restored pack. When connectivity exists, subscribers register their paper blocks with the
cloud registry before it can allocate in the same `P` space; the registry never generates `P`
names. Its own `C` space remains disjoint. Importing existing paper history is monotonic: the
registry accepts consumed and reserved entries, refuses contradictory ownership, and never turns a
missing entry in an old upload into a free name. A subscription transition preserves the paper
custodian and its register; it does not reset either namespace.

To claim a paper entry, an administrator marks it consumed on the current outside register,
with the recovery event and operator, *before* local activation. A crossed-out paper entry is
consumed even if setup fails or the box never trades. A cloud reservation is claimed through a
single registry operation that returns the same receipt on an idempotent retry; the offline box
may receive that receipt by manual entry from a phone. It checks the taxpayer, software,
environment, exact names, source and signed reservation evidence before activation. Merely seeing
a name in the cloud or in AEAT is not a reservation. A subscriber using pre-reserved paper during
an outage still marks the outside paper copy consumed first and later reports it to the registry;
a second administrator online can allocate only from `C`, never that paper name.

Every printed pack bears its generation and block IDs and says that its snapshot may be stale.
Reprinting an old pack cannot erase crossed-out entries or replace the master register. If the
current register is lost, damaged or exhausted, stop short-name allocation; retrieve a verified
new block or use the emergency procedure. Do not search a restored database for an apparently
unused short serial. If all outside evidence is unavailable, an incident record says so and the
emergency route uses a new random name with the uncertainty stated above.

### 9.3 Interrupted activation and selling authority

A recovery event gets an unpredictable event ID before claiming an allocation. Its outside
record contains the backup/source identifier, restored node, allocation ID, complete identity
set, operator, time, paper mark or registry receipt, and each activation attempt/result. The
record is kept with the current paper register or registry, not solely in the restored database.
The recovery pack contains the secret-bearing key separately from this incident record. Neither
`FiscalAllocation` nor `RecoveryApproval` carries that key.

On retry, read the outside event and the local activation result. Reuse the allocation only when
both bind the *same* event, backup/source, node and exact identity set, and the local committed
result can be shown. Return that committed result without activating again. If the local result
was lost, the outside record is uncertain, or the attempt could have committed on another box,
leave the allocation consumed and claim a different one. A restored event ID alone grants no
replay. Before any new claim, check the current outside register so two attempts restoring the
same old backup use different allocations. A failed validation before outside consumption writes
nothing; once an allocation is marked consumed, a later local rollback does not free it.

The administrator records that the former selling machine is offline and that no parallel
recovery is running, then re-authenticates. This is an operational assertion, not a network
fence. A declared restore always requires it. For an unexpected conflict, automatic switching is
allowed only if the node has an authenticated, unexpired outside grant of sole selling authority,
the previous seller has acknowledged fencing, and the node can consume an independently reserved
allocation with a durable receipt. A role bit copied in the restored database is insufficient.
Without an outside grant and fencing acknowledgement, including when offline, use the
administrator path.
Without those facts, stop new issuance on the colliding identity and ask an administrator to
isolate the old machine and perform this procedure. Staff may inspect existing orders and
incident evidence while it waits; neither a queued fiscal record nor an attempted new sale may
quietly take a known-colliding number. An unreachable AEAT service alone is not proof of conflict.

Keep the previous design's limit of at most one automatic switch in any rolling 24 hours, measured
from durable switch events. A second conflict inside that window is recorded and requires the
administrator path; the clock passing 24 hours does not retroactively activate a held switch.
A backward clock does not clear the limit. If durable outside switch history is absent, the
24-hour test is only a local warning, so automatic switching is refused and an administrator must
resolve the uncertainty. The administrator path may consume a distinct allocation after
isolation without waiting 24 hours. A new identity does not fence an old machine or fill missing
invoice history.

### 9.4 Shared values, refusals and migration boundary

`FiscalAllocation` is a versioned, immutable value containing `allocationId`, `taxpayerNif`,
`softwareId`, `environment`, `installationIdentity`, `series: [{code, purpose}]`, `source`
(`initial-paper`, `paper`, `cloud` or `emergency`), `reservationEvidence` and `issuedAt`.
`RecoveryApproval` contains `eventId`, `operatorId`, the backup/source and target node IDs,
`oldMachineOffline`, `noParallelRecovery`, `confirmedAt` and a reference to the outside incident
evidence. For an initial setup, the approval names the setup event and the absence of an old
machine. Neither value embeds the break-the-glass key. A generic module restore seat carries
these values as opaque module state into the fiscal hook; the host validates the envelope and the
fiscal module validates the contents. The host never imports a Veri*Factu type to interpret them.

Refuse with distinct typed causes: malformed candidate or checksum; taxpayer, software or
environment mismatch; missing or untrusted reservation evidence; already consumed or retired
allocation; stale pack without current outside authority; missing series purpose or code
collision; backup/event mismatch; absent operator confirmation; parallel recovery or old machine
still active; uncertain prior activation; and exhausted short space. Each refusal leaves issuance
disabled and preserves the incident evidence. A network failure during a cloud claim is an
unknown claim outcome to reconcile with the registry, never an invitation to spend the same name
on paper. Error-code names are proposals for the implementing item, not existing API codes.

This contract changes an existing representation, not just a parser. Today `SifRegistration` and
`registro_sif.numero_instalacion` are numeric (`packages/fiscal-verifactu/src/registro-sif.ts`,
`schema/sif.ts`), the reservation state and standby establishment parse a number
(`provisioning.ts`), restore raises a clock-derived numeric floor (`restore.ts`), and
`reserved-series.ts` derives and strips numeric suffixes. `backend.ts` converts that number to
wire text and includes it in `registrationId`. `contadores_instalacion` is a local numeric
allocator. The new contract needs a generated schema change, a text installation identity in
all those consumers and in `registro_sif`'s uniqueness key, and an allocation ledger whose local
copy is audit evidence rather than the outside authority. The issued fiscal records and hashes
remain untouched. The restore hook (`packages/module/src/restore.ts`) currently returns series
for the host's one transaction (`apps/server/src/restore.ts`); that seat needs the opaque
allocation and approval. The staged request, cold restore, promotion and adoption paths must all
carry or deliberately refuse a missing allocation before they can create a selling identity.
There is no compatibility promise for preproduction venues under `CLAUDE.md` §3; a reset may be
required, but the implementation must report the exact migration outcome rather than infer it.

The next implementation task must trace the complete call chain again on its starting `main` and
run the library validator over boundary examples, including the longest emergency series and
10-digit counter. Changing `registerSif`, `restoreFiscal`, an alta builder or the hash path is
outside RUNNER H2 until the owner records a narrow, item-specific exception. Approval of this
appendix alone does not grant that exception or enable issuance after recovery.
