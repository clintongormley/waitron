# A732: start fresh without opening the old business

**PROPOSED, 21 October 2026. Full owner approval is required before a plan or build.**

You have lost the administrator password and recovery sheet for a box that went live.
You need to use the hardware again without giving a new administrator access to the old
business. A732 proposes a narrowly authorised move to a separate empty workspace. It does
not recover your old account or business records, and it does not make the new workspace
ready to sell.

## Decisions already made, and proposals needing approval

The owner's direction is Lane E `questions.md:4676–4681`, point 3 of the 16 October
12:20 answer. Point 4 clarifies that signing keys are acceptable; the objection was to
typing and an offline computer ceremony. The earlier custodian-only wording in the queue
and backlog is superseded by that direction, not approval for another authority format.

| Fixed owner decision or scope constraint                                                   | Consequence                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The active country/fiscal module supplies its proof through a seat called by generic code. | Spain's Veri\*Factu module offers a fresh challenge signed with the taxpayer's AEAT-use certificate, matched to the retained NIF. Generic repair code does not parse Spanish certificates. |
| At least one route must work in every country, without requiring that certificate.         | Offer an independent route and disclose its conditions. Country coverage does not promise recovery when every source of authority is lost.                                                 |
| Preserve old records and exclude the new administrator from them.                          | No old password reset, decryption, business-data import, fiscal activation or restore. No assertion that an unknown former seller is fenced off.                                           |
| Retain A679's approved hour and naming policy.                                             | A732 reserves no fiscal names. Later authorised setup must retain every known used or uncertain hour as a lower bound.                                                                     |
| Design only.                                                                               | This document grants no permission to change protected code, build services or enable a recovery issuer.                                                                                   |

**Recommended proposal:** accept a deliberately narrow direct-taxpayer certificate route,
initially FNMT citizen certificates for a natural-person taxpayer, and a separate,
subscription-free Waitron recovery service for every country. Initially refuse all
representative certificates as standalone A732 authority, including a gestor's certificate.
Companies use the independent route. This is a product restriction, not a statement that
representative certificates lack legal effect.

The recovery service, its staffing, issuer trust, authority enrolment and isolated workspace
runtime below are new proposals. Existing Cloud accounts, receipts, local administrator
roles and exported files do not already provide them.

## What you see

You can reach **Repair this box** without the lost credentials, both from the sign-in
page of a live box and from first-setup or failed-start repair. Opening it does not stop
trading, change settings or expose history. It offers **Keep old data and start fresh**
with this explanation:

> Keep the old workspace offline. Your new account will not open its records. Prove your
> authority before you select a separate empty workspace. Setting up that workspace to
> trade is a later step.

Over trusted HTTPS, choose **Use your taxpayer certificate** when the retained module
supports it, or **Ask for recovery approval**. You can open the independent service on
your normal phone or computer. There is no offline computer, signing-key export or long
code to type. A request link identifies a case; possession of that link is not approval.

Before proof, show only connection guidance, an opaque case reference and generic progress
or refusal wording. Do not show taxpayer names/NIFs, account lists, addresses, sales,
invoice names, retained file paths, backups or contact addresses. You provide your claimed
identity privately; the verifier compares it without offering an account-discovery lookup.
Authorisers see only the authority and target information needed for consent, never old
business records. You explicitly approve **Select an empty workspace** after proof.

The public case endpoint returns only an opaque handle. Release the private challenge to
the certificate signer only after a preliminary key-possession check and taxpayer/profile
match, or to the independently authenticated recovery service after its mandate/hardware
check. That preliminary check grants no switch authority. A link or unauthenticated API
response never discloses the private identity report or challenge scope.
For the service route, the broker and desk first establish a private authenticated channel,
independent of the requester: the broker validates the shipped desk identity, while the desk
matches this broker's installation/TLS key against independently checked deployment or
hardware evidence. A requester-supplied URL, copied request or newly generated host ID
cannot establish that association. Without a verifiable match, approval waits.
Over that channel the broker discloses only the retained country/taxpayer/module identity,
its uncertainty classification and hardware binding needed to check the claimed mandate.
It retains the commitment salt locally; the desk returns its checked identity and hardware
scope with the mandate reference over the same channel. The broker compares those facts
with its private report before releasing a final challenge. A different business's mandate
refuses; hardware-only evidence permits only the unresolved-history effect. The desk never
receives old business records, paths, credentials or the commitment salt. This limited
private disclosure is part of the proposed recovery service, not a public lookup.

The preliminary certificate check signs a separate exact object containing `kind:
"waitron-a732-candidate-check"`, `version:1`, `purpose:"check-candidate-only"`, `requestId`,
`bootId`, a fresh 32-byte `nonce`, `requesterPublicKeySha256`, `certificateSha256`, `issuedAt`
and `expiresAt` within two minutes. Use the same canonical rules and certificate algorithms
below, prefixed by `waitron.a732.candidate.v1\n`. It is one-use and never accepted as the
final A732 proof.

Missing or unusable TLS leaves only public connection guidance on HTTP. A733 supplies
certificate/trust repair without the lost password and preserves old trust material.
**A732 cannot operate on such a box until A733, or another already trusted HTTPS path,
is available.** An encrypted socket alone is insufficient if your browser does not trust
that it reaches the intended box. Do not offer a bypass or accept a key, proof, grant or
authorisation on HTTP.

## What identity can actually be known

**No, the current source does not establish the active module on every live, partial or
damaged box.** Asking country before the fiscal step establishes a selection in the
browser, not universal durable recovery evidence.

These are source observations at `24e67eb96a6a9d8950f5a67754a5965596ac0f66`, which contains
A679 `4e318802f6e62a050aa754c5a343a527cd45ae3c`. They are not runtime qualification.

| Inspected path                                                                                                                                   | What it records or checks, and its limit                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/setup/src/screens/venue-screen.ts:619–646`; `apps/server/src/setup-api.ts:411–446`                                                         | The browser constructs country/taxpayer/location input; the server repeats country, geography and jurisdiction validation. This is not a retained live-module stamp.                                                                                   |
| `packages/provisioning/src/venue-fiscal.ts:23–31`; `first-setup-runtime.ts:129–156` in that directory                                            | Territory selects the fiscal contribution. Claim preparation freezes the request, environment and selected module names/versions. A valid retained attempt can therefore supply a candidate identity before venue creation.                            |
| `packages/provisioning/src/first-setup-state.ts:358–360,628–691`                                                                                 | Parsing checks the frozen digest and password verifier relationship; claim writes a venue marker before the state. Interruption can leave an incomplete pair. These are local consistency checks, not independent evidence of ownership.               |
| `packages/provisioning/src/venue-apply.ts:174–180,343–347`; `packages/db/src/schema/tenants.ts:39–53`; `schema/nodes.ts:20–35` in that directory | Provisioning writes taxpayer country/tax ID and the node's filing-module stamp. The node column is nullable; neither a missing node nor a damaged database supplies a module. The node public key concerns membership, not human entitlement.          |
| `apps/server/src/till-config.ts:109–140`; `boot.ts:1601–1605` in that directory; `packages/module/src/fiscal-slot.ts:12–29`                      | Trading boot reads the named node and cross-checks its stamp against exactly one enabled fiscal contribution. A null stamp skips the mismatch check. Successful selection from installed code is not evidence of the original module on a damaged box. |
| `apps/server/src/module-config.ts:12–28`; `packages/module/src/config.ts:25–29,54–64`                                                            | Missing `modules.json` enables modules by default. Installed or enabled modules alone cannot establish the old active module.                                                                                                                          |
| `apps/server/src/box-env.ts:6–32`; `trading-config.ts:18–43` in that directory                                                                   | Runtime files supply node/location/environment and secrets; unreadable files are skipped and process settings can override them. `trading.env` contains no taxpayer or fiscal-module stamp.                                                            |
| `apps/server/src/first-setup-entry.ts:65–90,123–135`; `packages/provisioning/src/first-setup-resolution-inspection.ts:77–122`                    | Repair is reachable with unresolved state and may lack readable module settings. Inspection distinguishes missing, partial, corrupt and unknown databases from empty ones.                                                                             |

The proposed broker, a small host repair service outside the new business application,
reads a bounded private identity report under exclusion. It cross-checks the selected
workspace, frozen attempt if present, taxpayer singleton, node stamp, deployment environment,
module-owned identity and retained module settings. Ordinary repair does not migrate or
repair the old database to obtain an answer. Read only identity and fiscal floor evidence;
never return business rows. Preserve originals before inspection that could create side files.

Classify the result explicitly:

- **Consistent retained identity:** call only that installed module's proof seat. A valid
  frozen attempt can identify a partial setup; it cannot overrule contradictory live rows.
- **Missing or unreadable identity:** record unknown fields as unknown. Hide the certificate
  route. The independent service may approve isolation using independently verified hardware
  entitlement, but cannot reconstruct the old taxpayer/module or clear its history.
- **Contradictory identity:** retain all conflicting observations privately. Refuse automatic
  module selection. Independent approval may permit only isolation with an unresolved-history
  hold, never choose whichever taxpayer matches the submitted certificate.
- **No independently verifiable association with this hardware:** refuse selection as well.
  A newly typed country/NIF, replacement module settings or regenerated host identifier is
  not evidence about the old installation.

Unknown identity may lead to an empty workspace that remains unable to activate. Later setup
cannot use a change of country, taxpayer or environment to evade unresolved old evidence.
Resolving that hold requires its own authorised process, outside A732.

## Two ways to prove authority

### Spain: sign as the retained taxpayer

The module offers a new `startFreshProof` seat on its provisioning contribution, with
method discovery and proof verification against host-supplied private identity facts.
The generic host owns admission, challenges, exclusion and workspace selection. The
module owns issuer/profile trust, certificate interpretation and the taxpayer comparison.
Other countries can add their own methods; absence of a method is an explicit result.

**Proposed initial acceptance:** an issuer-validated FNMT citizen certificate whose
natural-person taxpayer identity exactly matches the retained Spanish taxpayer after the
module's declared normalisation. Require a supported signing key, a valid chain to the
module's shipped issuer allowlist, the specific allowed certificate profile, current validity,
fresh acceptable revocation status and a valid signature over the complete A732 challenge.
Unknown profile, absent/ambiguous taxpayer identity, mismatch, stale status or unavailable
validation refuses this route. A submitted certificate cannot enrol its own issuer or trust
anchor. Production and preproduction do not borrow authority from one another.

Use a separate certificate file you select in your browser. Its private key and passphrase
stay transient on your device; signing requires an explicit action and the consent text.
Send only the public chain and signature over HTTPS. A supported online signer could be
added later under the same format. Do not read or use a certificate sealed in the old box,
upload a PFX/private key to the repair server, install the certificate, or make a fiscal query
that returns old invoices. Browser signing support must be qualified before this option is
enabled; a phone lacking it can use the independent route on the same phone.

This proves control of the accepted certificate's signing key for this exact request and a
module-checked match to the retained taxpayer. Accepting it as sufficient for this limited
product action is the proposed policy. It is not a finding of legal ownership, a general power
to act for the business, or authority to read old records.

**Gestor and other representative certificates are not accepted as standalone proof in v1.**
This includes a certificate mentioning the business's NIF and a certificate that can submit
to AEAT for it. Representation for a tax procedure does not establish A732's separate
product permission. The independent service may approve a representative only after
independently verifying a specific mandate for this action. Future direct acceptance needs
verified signer identity, represented taxpayer, current delegation and explicit authority
to isolate this installation and select an empty workspace. A NIF match, title string,
successful AEAT consultation or certificate signature alone does not cross that boundary.

Current certificate installation is not this verifier. `certificate-file.ts:46–68` in
`packages/fiscal-verifactu/src/` reads selected subject attributes; it does not establish
that every possible certificate is a direct-taxpayer certificate. `certificate-install.ts:133–155`
permits an absent extracted tax ID through its local comparison, and `certificate-check.ts:64–69`
performs an invoice consultation. Do not reuse either result as an entitlement decision.
This design specifies no new meaning for their existing fields.

### Every country: independent recovery approval

**Proposed new service:** a Waitron recovery desk, funded independently of Cloud subscriptions,
with a dedicated issuer key whose public trust anchor and permitted purpose ship with the
software. It is not the retired allocation custodian and does not issue fiscal names. This
requires a real staffed service and reviewed issuer operation before release. No existing
Cloud signature is accepted merely because Waitron signed it.

You can enrol a named recovery authoriser in advance, or request assisted verification after
loss. The desk, not a local staff account, enrols and verifies the authoriser:

1. Establish the person's identity through a live identity check and independently checked
   identity evidence. Verify their relationship to the business and this hardware using
   independently obtained supplier/deployment records, current business records and direct
   confirmation from an independently verified principal. A local administrator can nominate
   someone but cannot grant legal entitlement merely by nominating them.
2. Verify that the principal is entitled to control this installation. For a delegate, obtain
   the principal's explicit A732 mandate. The mandate names the hardware/business scope and
   permission to retain the old workspace offline and select an empty one. A supplier receipt
   can establish acquisition or deployment association; it does not by itself establish a
   present business mandate. Record the basis and its limits rather than declaring legal title.
   Sufficient business authority requires all three: verified personal identity, independently
   checked current principal status, and that principal's explicit action-specific consent or
   delegation. Check status against a current authoritative business record, or an independently
   verified original supplier/principal's current attestation where no such register exists.
   Conflicting or unverifiable status refuses; reviewing an uploaded document alone is insufficient.
3. Bind that verified mandate to a dedicated recovery role and a passkey, with a verified
   contact for notices. Email verification proves mailbox control only. Any tenant account,
   any email address, staff status, device possession or a phone call alone is insufficient.
4. For each request, require a fresh passkey authentication, current mandate check and explicit
   consent to the exact challenge. Issue the purpose-limited approval only after those checks.
   The service keeps a single-use issuance ledger and supports mandate revocation. Account or
   contact recovery repeats assisted verification; email alone never resets this role.

When no enrolment or retained contact exists, two independent desk reviewers must check the
identity, principal/mandate and hardware association before enrolling an authoriser. Obtain
confirmation through an independently sourced contact or verified original supplier/principal,
not solely a number or email supplied by the requester. Existing enrolment is notified where
reachable; unresolved conflicting claims block approval. For a sole proprietor without a
company register entry, verified personal identity plus independently verified acquisition/
deployment association and a checked current business relationship can supply the evidence.
Do not require an AEAT certificate or a country-specific electronic identity system.

If the old taxpayer/module is missing, independently verified entitlement to the hardware can
authorise only **isolate with unresolved history**. The desk does not certify a reconstructed
old identity. If no independent evidence of either the business mandate or hardware entitlement
can be obtained, refuse. This route is available in every country under the same evidence
policy; it does not guarantee that every claimant can satisfy it.

You use the service online, with your phone's normal passkey interaction. If the issuer,
required verification channel, your usable device or network is unavailable, approval waits.
Use another verified channel/device or repeat assisted verification. There is no telephone
override, email-only fallback or offline-key ceremony. A still-valid issued approval can finish
only while the box can perform its required live issuer-status check; cached approval does
not bypass revocation or availability checks. That dependency is acceptable during repair,
not on the sale path.

Assisted verification can take longer than a challenge lifetime. Keep the case open, then
issue a new ten-minute challenge when the verified authoriser is ready to approve it.

### What a person on the restaurant network can do

| Evidence or route                              | What it establishes                                                                              | What LAN access alone permits                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device possession or public repair link        | Access to hardware/network or a case reference.                                                  | Open guidance and submit a bounded case request. It cannot stop trading, select a workspace or see private context.                                |
| Email or ordinary account control              | Control of a mailbox or that account's existing permissions.                                     | No A732 authority, no self-enrolment and no reset of the old administrator.                                                                        |
| Accepted direct-taxpayer certificate signature | Key control and the module's taxpayer match for this challenge.                                  | No signature without that key. A stolen usable certificate can satisfy this product policy; no claim of identifying the human behind a stolen key. |
| Recovery-service approval                      | A current independently verified mandate or limited hardware entitlement, bound to this request. | Cannot appoint oneself authoriser or substitute a new issuer. A compromised authoriser/passkey or mistaken desk decision is a residual risk.       |

The resulting approval grants selection only to the initiating session. Even an approved
attacker obtains no old records. Rate limits reduce request flooding; they cannot make an
open LAN immune to denial of service or a compromised host administrator.

## Exact fresh request and proof

These are proposed new formats, not the earlier signed allocation/Cloud receipt formats.
Each object has exactly the named fields. Reject duplicate keys, unknown fields, malformed
values and unsupported versions. Canonical bytes are UTF-8 JSON with object keys sorted by
ASCII order, no whitespace, arrays in their specified order, integers only, no undefined
values, and strings preserved without implicit Unicode normalisation. Identifier strings
are bounded ASCII; the module normalises taxpayer input before constructing private context.

The request has this complete shape; angle-bracket values describe types, not wire values:

```text
{
  kind: "waitron-start-fresh-request", version: 1,
  purpose: "select-empty-workspace-only",
  requestId: <UUID>, attemptId: <new UUID>, nonce: <32 random bytes, base64url>,
  issuedAt: <UTC ISO milliseconds>, expiresAt: <issuedAt plus 10 minutes>,
  host: { anchorId: <UUID>, tlsSpkiSha256: <hex SHA-256>, bootId: <UUID> },
  requester: { publicKey: { kty: "EC", crv: "P-256", x: <base64url>, y: <base64url> },
               sessionGeneration: <positive integer> },
  old: { workspaceId: <opaque ID>, manifestSha256: <hex SHA-256>,
         selectionGeneration: <nonnegative integer>,
         attemptId: <retained UUID or null>, revision: <integer or null> },
  scope: { status: <consistent | unknown | contradictory>,
           country: <country code or null>, taxpayerCommitment: <hex SHA-256>,
           nodeId: <retained UUID or null>, moduleId: <ID or null>,
           moduleVersion: <version or null>,
           environment: <production | preproduction | null> },
  target: { workspaceId: <new UUID>, locatorCommitment: <hex SHA-256>, empty: true },
  policyVersion: "a732-v1",
  effect: <isolate | isolate-with-unresolved-history>
}
```

The manifest binds canonical source roots, database files and side files, settings, attempts,
selection/retirement witnesses, recovery artifacts, known fiscal floors and every missing,
unreadable or contradictory observation. Retain a streaming digest of each readable file;
do not inherit the current inspection's size cap as a maximum supported venue size. Refuse
unstable, unsafe or unidentifiable source roots. A missing optional file is a bound observation;
an unreadable required preservation source blocks selection until preservation is possible.

`taxpayerCommitment` hashes a private random 32-byte salt and the canonical private identity
report, including normalised taxpayer identity and all contradictions. Keep that salt and
report only in the broker's protected case store. It binds unknown observations too; it is
not an invented taxpayer. Do not expose a plain hash of a guessable NIF. Raw identity and
source locators are absent from the public repair UI. The target locator commitment binds
server-chosen canonical roots; a browser cannot supply a destination path.

The initiating browser holds a transient, non-exportable P-256 private key. It signs the
request digest at final confirmation. Only its public key appears in the request; neither
a copied proof nor a public request link can replace that possession check.

Certificate proof is exactly `{kind:"waitron-start-fresh-certificate-proof", version:1,
requestSha256, profileId, algorithm, chainDer, signature}`. The signature covers the bytes
`waitron.a732.certificate.v1\n` followed by the canonical request. Initial algorithms are
RSA PKCS#1 v1.5 with SHA-256 and keys of at least 2048 bits, or ECDSA P-256 with SHA-256
and fixed 64-byte `r || s` encoding. The module must allow the certificate's actual algorithm
and profile, validate the chain independently and compare the private taxpayer identity.
`profileId` is a claim to check, not a source of trust.

Service proof is exactly `{kind:"waitron-start-fresh-service-proof", version:1, issuerKeyId,
requestSha256, approvalId, mandateRef, basis, authorityEvidenceSha256, issuedAt, expiresAt,
signature}`. `basis` is `verified-business-mandate` or `verified-hardware-isolation`.
Sign all fields except `signature`, canonically encoded after `waitron.a732.service.v1\n`,
with the dedicated issuer's Ed25519 key. Expiry cannot exceed the request expiry. The
issuer's authenticated status response must bind the approval ID, request digest, mandate
status and a fresh box nonce. Require it within 30 seconds of final admission. A service
proof cannot be converted into a certificate proof or into a fiscal operation.
The service records consumption for this request and target before the host prepares its
switch. Retrying that exact consumption returns the same result; another request refuses.
If the host then fails, the consumed approval stays evidence and grants no different operation.

Both proofs bind host, retained node or its explicit absence, taxpayer commitment, module,
environment, old workspace bytes, target workspace, attempt, nonce, expiry and policy through
the complete request digest. Module ID and package/version are compared through composition;
a country choice never selects a verifier for an inconsistent old scope.

## Admission, restart and preservation

An unauthenticated request is not permission to acquire the old venue for a switch. An intact
live server may prepare a private identity snapshot without disruption. After valid proof and
your final confirmation, its supervisor drains and stops that local workspace's duties,
including filing, printing, backup and Litestream, before acquiring folder exclusion. If a
stable final snapshot differs, require a new request and proof; do not carry approval across
changed business bytes. Keep repair available. Another process holding the folder refuses
the operation; never delete a lock file or kill an unrelated process to get past it.

Your confirmation explicitly permits pausing the old workspace for this final check. If
draining changed its bytes, retain the paused workspace, make the final frozen manifest and
obtain a fresh challenge/proof against it. Broker progress uses a separate journal, outside
that frozen source set, so progress messages do not continually invalidate the request.
Until selection commits, cancelling may resume only the unchanged, previously admitted local
runtime through its ordinary checks; an uncertain or damaged runtime stays in repair.

Before any selection, the broker must:

- Check trusted HTTPS, expected Host/origin, same-origin JSON requests, CSRF protection and
  the initiating session/key. Proposed limits: one current challenge per session, five new
  challenges per host per minute and five failed submissions per case per ten minutes, with
  bounded request sizes. A stranger cannot invalidate another session's request by opening one.
- Recheck private identity, module policy, proof freshness, authority status, old manifest,
  target emptiness and generation under one host switch queue and cross-process exclusion.
  Acquire anchor then selected venue locks in the established order. Nest recovery-state
  locking only where needed, consistently after venue locks; no external wait inside a
  database transaction. Serialise same-process callers too, since venue locks are shared
  within a process.
- Retain the original workspace and all relevant state, side files, backup remnants, logs,
  uncertain hour evidence and original selection records in protected storage. Failure to
  preserve required bytes or durable evidence refuses selection. Never wipe the old root,
  overwrite a staged recovery, lower a floor or label missing data empty.
- Durably write the checked approval, request/proof digests, minimal authority facts, evidence
  manifest and prepared switch intent **before** altering selection or access. Reserve the
  target ID and consume that approval for this operation. Then install the old-workspace
  retirement barrier and new isolation, publish the checked selection witnesses, and record
  the applied result. Acknowledge success only after rereading the complete result.

The proposed operation states are `requested`, `approved`, `prepared`, `isolated`, `selected`,
`applied`, `refused` and `uncertain`. Every transition checks its predecessor digest and
generation. There is no atomic transaction spanning files and databases. Flush each durable
record and its parent directory; boot reconciles the journal and witnesses before opening
any business database or running staged reset/restore. A cut between any two writes keeps
repair mode and all evidence. Never silently fall back to an old root.

Restart invalidates unconsumed challenges and transient session grants. Clock reversal,
changed TLS/host binding, identity, source bytes or policy also requires fresh proof. Check
both elapsed monotonic time and wall-clock expiry during a boot; no trusted monotonic value
survives restart. Once `prepared` is durable, expiry does not undo its recorded decision:
reconcile that exact operation without a new selection or an additional workspace. If its
artifacts disagree, stop as uncertain. A prepared approval is never reusable for another
attempt. Two competing valid proofs can produce at most one accepted selection generation.
Full-disk rollback, cloned host state and host-root compromise remain outside the local
journal's assurance; the issuer ledger helps its route but is not universal seller fencing.

Only the still-valid initiating session gets the restricted handoff into the empty workspace.
After a lost session or restart, obtain fresh proof to resume that handoff; do not ask for the
lost password or select another target. For this case, the exact request schema above has a
second variant: `purpose` is `resume-empty-workspace-handoff-only`; add exactly
`completedOperation: { requestSha256, approvalId, appliedResultSha256 }`; `target.workspaceId`
is the already selected UUID; and `effect` is `resume-handoff`. All other fields stay, with a
new request/attempt ID, nonce, boot binding, expiry and browser key. The old manifest/scope
must match the durable completed operation, and the target must still be empty, isolated,
selected at that operation's generation and without a newly enrolled account. Both proof
methods verify this distinct purpose through the same authority checks and signature formats.
The broker consumes fresh approval only for handoff, records its predecessor and new session,
and changes no selection, workspace ID, fiscal floor or generation. A consumed selection
approval is never the new proof. If the target has acquired an account or business state,
use its normal authenticated entry or a separately authorised recovery; this handoff refuses.
Successful A732 handoff still grants no old login or fiscal authority. An abandoned target
remains evidence, not an automatically reusable folder.

## What stays offline and unreadable

The retained workspace includes `venue.db`, `node.db`, SQLite side files, stream state,
credentials, account/vault keys, old sessions, backups and recovery artifacts. A732 does
not decrypt them, extract their secrets or change the old administrator's verifier. Some old
records are ordinary database bytes, not encrypted data; keeping a folder is not encryption.

**Proposed isolation requirement:** the new business process receives only the new workspace
mount and fresh credentials, under an identity that cannot read the retained roots. The
host broker alone manages retention and selection. It exposes no arbitrary file reader,
old backup download, configuration export, SQL access or old log tail to the new account.
Keep connection termination/trust outside the new account; do not copy old business keys,
SMTP credentials, memberships or recovery verifiers into the new workspace. Test OS access
denial as well as every application route. Application administration does not include host
root access; a person controlling the host OS lies outside this product boundary.

The current workspace selector supplies durable witnesses and path checks, not this process
isolation guarantee (`packages/provisioning/src/first-setup-workspace.ts:315–427`). A builder
must not claim that choosing another directory meets the unreadability requirement. A732
needs the broker/runtime isolation described here before it can report success.

Stop and retire the old workspace on this host; do not resume its seller on a later reboot.
That local barrier does not stop a clone, an absent box or another venue. The screen records
your replacement declaration and says that stopping other sellers remains unresolved where
it cannot be established. A732 itself creates no current seller, activates no fiscal identity
and cannot certify that the old box has been fenced off.

The empty workspace has no old accounts, catalogue, customers, invoices, counters or private
keys. It receives only a broker-provided, read-only, minimal fiscal floor/hold interface.
Never grant the new account access to the old database in order to calculate floors. Preserve
all used, uncertain and abandoned hours, not just a PDF's current code. Damaged history
stays unknown and blocks later activation until separately resolved; it is not replaced by
an empty-history assertion or the current clock.

Later setup requires its own authorisation, taxpayer and sole-seller checks, readiness,
certificate/settings steps and recovery-document retention. It uses the existing epoch,
four-character UTC-hour code, clock comparisons, strict history/release floors and one
prefix per purpose. It cannot reuse an old series or its invoice numbers. This is a separate
process, not an extra permission hidden inside the A732 approval.

## Worked example

Suppose your retained Olivo workspace used `A-06RB`, `FF-06RB` and `R-06RB`, and an interrupted
attempt spent `06RC`. You have lost both password and sheet. You open Repair over a trusted
connection. A consistent taxpayer/node/module report enables the Spanish option.

If you are the natural-person taxpayer, your accepted FNMT citizen certificate signs the
new request. If Olivo is a company and you hold its representative certificate, the proposed
initial policy directs you to independent approval. The desk verifies your identity, current
mandate and association with this box; your email and the certificate alone do not enrol you.

You approve selecting workspace `W2`. The broker checks the final retained bytes, records
approval and switch intent durably, isolates `W1` and selects empty `W2`. A power failure
after isolation returns to repair and reconciliation, not trading in either workspace.
The new administrator cannot search, export or restore `W1` through their account.

At the end of A732, **no new invoice series exists**. If separately authorised setup later
runs at 15:05 Madrid summer time on 16 October 2026, `06RD` is that UTC hour's candidate.
The known `06RC` floor permits consideration of `06RD`; clock, recent-setup and all other
checks still apply. New series would be `A-06RD`, `FF-06RD` and `R-06RD`, starting at one
only after that setup is authorised. Existing `A-06RB/1` is never issued again. The example
uses the approved A679 epoch and alphabet; it does not establish unseen history or stop a clone.

## Audit and secret handling

The private broker journal keeps case/approval IDs, request and proof digests, policy/module
version, authority basis, opaque mandate/evidence references, times, generations and switch
outcomes. The desk retains its identity/mandate evidence separately under restricted access.
Public logs contain only event code, opaque case ID, phase and bounded refusal category.
No taxpayer identity, certificate subject, email, document contents, file paths, private
keys, passphrases, bearer grants or raw request bodies go into public logs or error params.

No private signing material or raw recovery, account or vault secrets enter A732 persistent storage, public
artifacts or HTTP. The browser's signing key/passphrase is transient; the broker records
public keys or digests and hashes transient bearer grants. The issuer uses protected signing
infrastructure, never a downloadable signing secret. Protect raw public-certificate material
as identity data during verification; retain minimal authority facts and proof digest rather
than publishing the chain. Existing retained secret files remain private evidence, never
inputs for the new account. Redaction is not the enforcement boundary.

## Evidence and remaining source limits

| Inspected source                                                                                                                           | Consequence for this proposal                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/provisioning/src/first-setup-owner.ts:178–221`                                                                                   | Existing recovery checks the old password and issues a capability. A732 needs separate selection authority; it must not weaken or reuse ownership recovery.                                                                   |
| `apps/server/src/break-glass.ts:20–48`; `packages/db/src/deployment.ts:196–231`                                                            | Node recovery verifies a submitted secret against the saved verifier. A732 cannot recover the lost secret or mint a replacement for old data.                                                                                 |
| `packages/provisioning/src/first-setup-node-key.ts:84–105`; `packages/fiscal-verifactu/src/recovery-document.ts:5–18,91–108`               | Current first-setup key staging persists a verifier, while the recovery document carries the recovery secret and public labels. That sheet is a recovery credential, not a new A732 authoriser.                               |
| `packages/store/src/venue-lock.ts:53–83`; `apps/server/src/recovery-lock.ts:21–42`                                                         | Cross-process folder and recovery-state locks exist. Folder holds are shared inside one process; use a switch queue too. Never unlink either lock file.                                                                       |
| `packages/provisioning/src/durable-host-json.ts:65–84`; `first-setup-workspace.ts:362–387,393–427` in that directory                       | Durable single-file writes and multi-file selection reconciliation are precedents, not a filesystem-plus-database transaction. Current resolution authority variants do not include A732 (`first-setup-resolution.ts:29–48`). |
| `apps/server/src/first-setup-launch.ts:32–62`; `node-entry.ts:277,362–387` in that directory                                               | First-setup resolution is considered before normal start and staged mutations. Extend admission to A732 without requiring a readable normal runtime configuration.                                                            |
| `apps/server/src/recovery-listener.ts:25–26,65–93`; `setup-first-fiscal-api.ts:65–77,625–626` in that directory                            | Recovery may serve without a minted leaf. Existing request-origin/socket checks are useful precedents; they do not establish browser trust or solve missing TLS. A733 remains a dependency.                                   |
| `packages/fiscal-verifactu/src/hour-identity.ts:3–21`; `hour-history-reader.ts:45–105,118–170`; `hour-history.ts:58–105` in that directory | The landed hour implementation uses the approved epoch/alphabet and projects history/contradictions. Preserve all such evidence across isolation; these functions do not grant A732 authority.                                |

Read alongside the approved [A679 hour design](2026-10-16-a679-hour-coded-series-design.md),
[first Live procedure](../../operations/first-live-fiscal-setup.md),
[hour recovery procedure](../../operations/hour-recovery.md) and
[data conventions](../../developers/conventions-data.md). The
[offline fiscal restore document](../../developers/offline-fiscal-restore.md) explicitly
marks its former custodian protocol historical. Neither historical qualification nor A679's
approval qualifies this proposed proof route.

Primary-source provenance, accessed **21 October 2026**. Quotes precede the limited reading
used here. These sources describe certificates, not permission to perform A732.

| Official source and short quotation                                                                                                                                                          | Reading used, and boundary                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [FNMT citizen certificate](https://www.sede.fnmt.gob.es/certificados/persona-fisica): “confirma su identidad”                                                                                | FNMT describes a certificate identifying its subscriber. This supports separating identity/key proof from the proposed product permission. It does not specify the exact subject-field parser or A732 authority. |
| [AEAT certificate FAQ](https://www3.agenciatributaria.gob.es/Sede/certificado-dni-electronico/preguntas-frecuentes.html): “La Agencia Tributaria no es emisora de certificados electrónicos” | “AEAT certificate” here means a certificate used with AEAT, not one issued by AEAT. The same page distinguishes individual and representative certificates. This design makes no NIF-only legal conclusion.      |
| [FNMT representative certificate](https://www.sede.fnmt.gob.es/en/certificados/certificado-de%2Brepresentante/persona-juridica/): “tiene poderes específicos de representación”              | FNMT describes representative issuance conditions. Refusing representatives initially is Waitron policy, not a claim that those certificates cannot represent a company.                                         |

Before enabling the certificate method, the builder must obtain and cite the issuer's current
profile specification for policy identifiers and exact taxpayer attributes, then qualify
chain/revocation/signature verification with distinguishing direct and representative cases.
No subject semantics are inferred here from CN, serialNumber or organizationIdentifier.
Until that entry is qualified it remains disabled; the independent route is the universal
proposal, not a guessed parser fallback.

## Acceptance boundaries for the later builder

This is an outcome matrix for a later approved plan, not an implementation task sequence.

| Situation                                                                                                         | Required result                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost password/PDF, consistent Spanish natural-person identity, accepted valid certificate and fresh signature     | Selection can be approved; no old login, data access or fiscal activation.                                                                                            |
| Gestor/company representative certificate, or certificate containing a matching NIF but wrong/unknown profile     | Certificate route refuses. Independently verified specific mandate may use the universal route.                                                                       |
| Any supported country, verified current recovery mandate and fresh service approval                               | Same limited selection, with no certificate, Cloud subscription or old credential.                                                                                    |
| No enrolment/contact; sufficient independently checked evidence                                                   | Two-reviewer assisted enrolment and new request approval. Email, LAN, local account or self-signed receipt alone refuses.                                             |
| Missing/conflicting taxpayer, module, node or environment                                                         | No module guess. Verified hardware isolation may select an empty workspace with a durable unresolved-history activation hold. Insufficient hardware evidence refuses. |
| Wrong target/source/environment, changed manifest, expired challenge, revoked authority, copied session or replay | Refuse without selection; retain evidence. Restart needs fresh proof unless reconciling an already prepared exact operation.                                          |
| Selection completed, then its session was lost                                                                    | Fresh resume-purpose proof binds the completed operation and same still-empty selected target; no second selection. A target with a new account refuses this handoff. |
| Desk verifies a mandate for a different business or cannot independently associate the broker                     | Private matching refuses; no final challenge or approval. A copied opaque request cannot substitute for that association.                                             |
| Issuer, mandatory certificate-status source or network unavailable; missing trusted TLS                           | The dependent route waits/refuses. No weaker fallback. Public repair guidance stays reachable.                                                                        |
| Concurrent approvals, a foreign folder holder, stalled duties or unsafe source paths                              | At most one checked selection; refuse when exclusion/preservation cannot be established. Do not stop unrelated processes.                                             |
| Power/storage failure at every durable boundary                                                                   | Retain originals and approval/intents; reconcile the exact result or remain uncertain in repair. No extra workspace and no automatic old-seller boot.                 |
| New administrator tries old guides/export/backup/recovery/files or new process tries old mounts                   | No old records or secrets available. Verify both application denial and OS isolation in the intended runtime.                                                         |
| Known spent/uncertain hour, damaged history, later setup or reboot                                                | Preserve floors and unknown holds; no invoice-number reuse, second current seller, activation, counter reset or history clearance from A732.                          |

Builder choices are bounded to UI layout/shared primitives, internal seat/type names,
the supported browser signing library, journal storage representation and runtime isolation
mechanics that meet the stated outcomes. They cannot broaden accepted certificate classes,
replace independent verification with email, add a new issuer, weaken preservation/holds or
turn selection into setup/restore. Issuer deployment and operational readiness need their
own reviewed work. Parent owns the fresh builder check, backlog reconciliation and publication.

## One bundled owner question

**Which complete A732 policy do you approve, including its authority, isolation and failure
limits, before any plan or build?**

1. **A: narrow certificate route plus independent assisted recovery, recommended.** Accept
   qualified direct natural-person taxpayer certificates initially; refuse representative
   certificates as standalone authority. Fund the subscription-free desk with verified mandates,
   assisted enrolment and explicit hardware-only isolation for damaged identity. Accept the
   online dependencies, separate runtime isolation and unresolved-history activation holds.
2. **B: narrow certificate route plus pre-enrolled recovery authorisers only.** Keep the same
   certificate/isolation rules, but remove assisted enrolment after loss. The desk must verify
   and enrol the mandate before loss. It covers every country, but a box without prior
   enrolment and without an accepted certificate has no A732 route.
3. **C: revise before approval.** In particular, broader representative-certificate acceptance
   needs an explicit delegated-authority evidence policy; a NIF match or tax-submission ability
   alone is not the proposed substitute. No plan or build starts until the revised full design
   is approved.
