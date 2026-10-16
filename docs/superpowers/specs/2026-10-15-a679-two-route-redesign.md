# A679: keep invoice names distinct after recovery

> **2026-10-16 direction:** Tasks 9–12 wait for owner approval of the
> [hour-coded series proposal](2026-10-16-a679-hour-coded-series-design.md) and a replacement implementation plan.
> This document retains the earlier register-based design as history; the new naming
> policy is proposed, not implemented. Owner PDF acceptance is viewing generated
> EN/ES PDFs through Drive, replacing the physical owner typing exercise.

**Owner update, 2026-10-15 at 22:15:** group each typed field independently in fours.
Register continuation takes 20 entered characters, 23 including grouping spaces.
A generated named node recovery key takes 47 entered characters, 57 displayed;
together, 67 entered and 80 displayed. Paper-to-Cloud import is no longer required:
paper S/P and Cloud C names are disjoint. When joining Cloud, keep your paper PDF
for later paper allocations. When leaving Cloud, continue your existing S/P register.
Signed Cloud receipts remain unchanged. Paper machine reporting remains unavailable;
this decision authorises no new reporting implementation. The
[authoritative revision](#authoritative-revision-owner-decision-2026-10-15-at-2130),
amended below, overrides conflicting earlier requirements. Earlier source, test,
drawing and import-dependency receipts remain historical and do not qualify this implementation.

**Redesign under the owner’s existing requirements, 2026-10-15 at 18:55.** Product implementation stays paused. Behavior below is proposed; source observations are unverified at runtime except for the selected existing checks recorded in the qualification section. No Cloud, provider or physical-printer operation ran. The earlier `N` proposal is withdrawn.

The purpose is simple: **restoring an old backup must not make an old invoice series available again.** The backup cannot tell you which names were used after it was made. You therefore keep the allocation history outside the restored box: in your current paper register, or in Cloud’s current register.

The existing allocation spaces survive unchanged:

| Route | Installation names | Where reservations are recorded |
|---|---|---|
| Paper, without Cloud or while offline | `S000001`–`S999999` for initial setup; `P000001`–`P999999` for recovery | Your current register PDF, saved or printed |
| Cloud customer, online and authorised | `C000001`–`C999999` | Cloud’s outside register |
| Emergency recovery with unavailable history | `E` plus 26 Crockford characters encoding 128 random bits | The recovery incident and its retained output |

Paper and Cloud cannot allocate the same name because their prefixes differ. This does not make two competing paper copies safe. Paper allocation still depends on one current history, used in turn across the taxpayer’s venues. Emergency uniqueness remains probabilistic. These are the approved boundaries, not new qualifications.
Sources: **M** `docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md:22–58,355–410`; **M** `docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md:32–45`.

## What you see, click and keep

You connect to the box through your normal browser and network. After the venue, administrator and separate readiness steps, the page shows **Reserve invoice series**.

For paper, you either choose **Use my current register PDF** or confirm that this taxpayer, software and environment have no existing paper register. You can select the saved PDF or scan its printed pages. The page handles the names and signatures; you do not type keys or invoice names.

The page shows the selected installation and every invoice series it covers. You confirm that you supplied the current register and that another paper allocation is not underway. It then offers **Download PDF** and **Print** for **one combined document**. Both actions use the same document revision. You keep either output, or both, in the office.

Before activation, that document already records the selected allocation as **consumed**. Here, consumed means “never available for another activation”, including when setup fails. You continue after keeping the updated document. There is no downloaded tool, separate custodian or computer, offline requirement, ink mark, transcription exercise, handover procedure or loss drill.

**Keeping the current document is the necessary action. A download or print event cannot prove that you kept it.** Continue records your confirmation; it does not certify printer success.

Sources: **Q** `questions.md:4402–4416,4479–4485`; inherited outside-before-activation rule at **M** `docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md:66–78,423–451`.

### Paper example: Olivo and a replacement box

Elena sets up Olivo for the fictional taxpayer shown in this example. Its configured bases are `A` standard, `FF` full and `R` rectificative.

| Step | What Elena sees and does | What she keeps |
|---|---|---|
| First setup | Confirms there is no existing paper register for this taxpayer/software/production scope. Reviews `S000001`, covering `A-S000001`, `FF-S000001`, `R-S000001`. | One PDF recording `S000001` consumed for this exact setup. It can also contain a separately reserved `P000001` recovery allocation for Olivo. |
| Another venue | Supplies the same current register. The page proposes `S000002`, never another venue-local `S000001`. | Its successor PDF preserves Olivo’s entries and adds the second venue. |
| Months later, Olivo’s box dies | Selects its backup, supplies the PDF matching the backup’s named node recovery key, and supplies the **current register**, which may be a newer PDF. Confirms the old box is disconnected and no parallel recovery is running. | A successor register recording Olivo’s `P000001` consumed before activation. Existing `S` series remain retired for further issuance. |
| Backup is older than the register | The page uses the backup for recorded business data and the current register for allocations. | Neither document replaces the other’s purpose. |
| Setup stops after the PDF was kept | The allocation remains consumed. An exact committed result may finish publication. Otherwise a new attempt takes a different allocation and produces a successor register. | The interrupted document remains evidence; failure never frees its names. |

A printed register is scanned as a complete document, including its machine-readable history. An incomplete scan refuses rather than silently dropping pages. The old backup’s PDF can supply a matching old recovery key, but cannot supply current allocation authority merely because its signature is valid.

The guided repair-page backup entry belongs to **A731**. The ordinary archive, bucket and managed-Cloud restore paths retain their existing authentication and allocation checks. This story does not claim A731 is built.
Sources: **M** `docs/developers/offline-fiscal-restore.md:3–13,63–83,141–144`; **Q** `questions.md:4374–4381`; **P** `docs/superpowers/plans/2026-10-15-a679-first-setup-repair.md:178–201,233–239`.

### Cloud example: a subscribed venue

Elena chooses **Use Cloud register** for a venue already admitted to Cloud’s fiscal-allocation service. The setup page supplies its frozen taxpayer scope, complete bases and purposes, local operator, event, source and target bindings to the Cloud journey.

1. Cloud reserves, for example, `C000042`.
2. Elena confirms initial-machine absence for first setup, or old-machine isolation and no parallel recovery for recovery.
3. Cloud consumes that reservation and returns its signed receipt.
4. The local module verifies the consumed receipt and the exact local authority before activation.
5. Elena keeps the setup page’s one PDF containing the receipt, recovery information and any existing paper history. The Cloud register remains authoritative for `C` names.

A lost reply shows **Check uncertain result**. The same operation ID and frozen request are retained. A reserved receipt, an unknown result or a Cloud login alone cannot enable local activation.

**Current limitation:** Cloud’s protocol and account journey exist in source, but production custody, entitlement, continuity and signer capabilities are not supplied by default. Waitron’s current Cloud preparation also admits recovery and re-registration, not first setup. This design proposes that missing Waitron integration; it does not describe a free or already activated Cloud service.

Sources: **C** `docs/fiscal-allocation-registry.md:3–14,80–105,148–160,191–220,288–324,372–375`; **M** `packages/fiscal-verifactu/src/cloud-preparation.ts:61–136`.

### When Cloud is unavailable, and when subscriptions change

- **Offline or unavailable Cloud:** explicitly choose paper and supply its current register. Use `S` for a genuine first setup or `P` for recovery. A Cloud timeout never converts an uncertain `C` claim into a paper claim.
- **An unresolved Cloud operation:** retain its ID and uncertainty. Switching routes requires retiring the local attempt and creating fresh bindings. A delayed Cloud response cannot activate the retired attempt. If local activation might already have committed, resolve that state first.
- **Advance reservations:** keep signed `S/P` blocks in the PDF before an outage. Reserved `C` receipts alone are insufficient for offline activation; Cloud’s consume step still matters.
- **Joining Cloud:** import the original signed paper blocks and linked consumption/transfer facts through `import-paper`. Imports add facts; omitted entries never become free. Future Cloud allocations use `C`.
- **Leaving Cloud:** occupied `C` names remain occupied. Retained reads require current authorised access under Cloud’s policy. New paper allocations continue the existing `S/P` history, without restarting counters.
- **Simultaneous paper and online work:** an online administrator receives `C`; the paper administrator receives `S/P`. Two paper administrators must use the one current master in turn.

Sources: **C** `docs/fiscal-allocation-registry.md:95–121,193–206,213–220,310–331`; **M** `docs/superpowers/plans/2026-10-12-cloud-fiscal-allocation-registry.md:40–45`.

## Why an old PDF cannot certify itself

The proposed register is **editable through the setup page**, which produces a successor PDF. Arbitrary edits in a PDF editor are not accepted signed history.

Each revision contains its scope, predecessor digest and complete accumulated reservation history. Those links expose missing or contradictory history when another trusted record is available. They cannot reveal a newer revision that nobody supplies.

Consider two venues:

- Revision 7 says the next unallocated initial name is `S000002`.
- Elena uses it at the second venue and keeps revision 8, recording `S000002` consumed.
- Someone later brings revision 7 to a restored Olivo box. Its signatures remain valid.
- If they incorrectly declare revision 7 to be current, a disconnected box cannot discover revision 8 and could propose the same name.

The design therefore requires this explicit statement:

> **This is the current register for this taxpayer, software and environment. No other paper allocation is underway.**

This preserves the approved single-current-history assumption. It replaces ink updates with page-generated document updates; it does not introduce a witness service or claim that signatures establish freshness. The owner can be the named recordkeeper. No separate person or computer is required.

If currency is uncertain, the answer is **Unknown**. The page offers obtaining the current register, an authorised Cloud allocation, or the existing emergency recovery route where its authentication conditions apply. It never guesses a short name from the restored disk.

This design retains the approved current-register and old-machine-isolation declarations. Its prevention claim is conditional on those declarations. A stale signed PDF cannot establish that no newer document exists, and the design makes no such claim.

Sources: **M** `docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md:22–25,56–58,423–451,462–478`; current verifier separation at **M** `packages/fiscal-verifactu/src/paper-evidence.ts:784–815`; proposed owner-bound evidence mechanism already present in **P** `apps/server/src/first-fiscal-evidence.ts:185–260`.

## Appendix A: the PDF and its secrets

### Register contents

The paper-route PDF is the reserved-series record, not merely a recovery-key sheet. It contains:

| Part | Required contents |
|---|---|
| Scope | Taxpayer NIF, software ID, fiscal environment; all venues covered by this register |
| Register identity | Format, register/custody identity, full public-key fingerprint, revision, predecessor digest, generation/block IDs, date and named recordkeeper |
| Every occupied name | Installation identity; complete bases, resulting series and purposes; recipient; reservation/consumption bindings and time |
| State | Reserved, consumed, abandoned/burned, retired or uncertain; no transition back to free |
| Next state | Separate `S/P` high-water marks and next unallocated candidates; existing reserved entries remain listed with their restrictions |
| Attempts | Event, source/backup, target and operator bindings; consumption before activation; uncertainty retained rather than invented success |
| Cloud facts | Relevant original receipts and import acknowledgements, clearly distinguished from the paper master |
| Recovery | Named node keys and their node IDs, short instructions and the backup/key distinction |
| Complete machine-readable content | Embedded data plus numbered, checksummed scan segments; no remote URL is needed to reconstruct the document |

A pre-activation PDF says **“Consumed; activation completion not yet confirmed.”** It records the safe allocation outcome before any activation attempt. It does not falsely certify that setup succeeded. Exact committed results remain checked locally; subsequent register exports can append established completion facts without changing consumption.

History is never truncated to fit one page or one Cloud request. One PDF may have several pages. Public Cloud exports split at original block boundaries and respect Cloud’s limits: at most 20 allocations, consumptions and transfers per import, plus its byte limit. Splitting transport never alters signed objects or discards history.
Sources: **M** approved contract `:423–469`; **C** `docs/fiscal-allocation-registry.md:168–172`.

### Exact secret choice

**The combined PDF contains two distinct kinds of secret:**

1. **The paper custodian’s Ed25519 signing key.** This preserves the ability to sign paper allocations and, when separately built, A732’s fresh-deployment authorisation. It is not a node recovery key.
2. **Named node recovery keys**, labelled by node and key name. These authenticate the existing recovery operations against matching verifiers.

The custody key is generated or recovered within the browser’s setup page and used transiently there. Public signed evidence goes to the box and, when requested, Cloud. The custody private key does not enter the venue database, backups, browser persistence, logs or public evidence. Ordinary PDF download and network printing are intended outputs.

The PDF excludes administrator passwords, backup/archive encryption passwords, provider credentials, Cloud sessions, machine signing credentials and TLS private keys.

For initial setup, the proposed host preparation creates the named node key before document delivery and retains only its verifier and frozen binding. It installs that verifier after the node exists and before trading publication. **This preparation/install split is new host work**, not behavior provided by today’s `mintBreakGlassKey`. Publication recovery checks the same staged verifier; it does not silently rotate it or rerun fiscal activation.

Source observations:

- **M** `apps/server/src/break-glass.ts:20–38` currently generates a secret, stores its verifier and returns the raw secret.
- **M** `packages/db/src/deployment.ts:196–231` contains the existing verifier/name readers and writer.
- **M** `apps/server/src/recovery-pack.ts:44–88` requires the actual matching secret and exports it; it cannot reconstruct that secret from the verifier.
- **M** `apps/server/src/operation-authentication.ts:39–79` checks the node secret and permits event-bound recovery authority for restore, re-registration and promotion.
- **Q** `questions.md:4378–4380` preserves A732; **Q** `questions.md:4407–4415` authorises setup-page generation and the single PDF experience.

### What the box keeps and forgets

The box retains frozen setup bindings, public trust, signed public allocations/consumption, audit history, retirement evidence, checked committed results and node-key verifiers. These local records support checking and replay; they do not become outside allocation history after a restore.

Raw custody material, raw node keys and secret-bearing PDF bytes remain transient for delivery. Continue or closing the page ends that delivery session. No guaranteed memory erasure is claimed.

A public operation importer continues rejecting secret-bearing inputs. The dedicated PDF reader separates public history from secrets in the browser. A node secret is sent only to the appropriate authenticated recovery request over trusted HTTPS. Selecting a PDF never enrols its public key or grants authority by itself.

For A732, match retained independent custody trust whenever it survives. If that trust is lost, display the full public fingerprint and require the owner to compare it against the actual current original, then record that comparison. This is a visual comparison, not hand-typing or a routine setup drill. A self-signed or stale PDF cannot enrol itself. The box records the owner’s statement and cannot prove the comparison happened. This preserves the approved V2 boundary at **Q** `questions.md:4311`; it does not create a new reset authority.

### Reprint, reissue, theft and loss

**Reprint with the retained PDF:** reuse its keys and history. A box-generated audit snapshot cannot replace a newer current register.

**Reissue after the raw node key was discarded:** require unfinished-setup password ownership over trusted HTTPS, or a completed venue’s manager with `system.manage`. A new named node key changes the verifier for subsequent backups; it performs **zero fiscal activations**. Keep older PDFs while retaining backups that name their keys. The custody key is preserved from the supplied current PDF, never silently replaced.

The existing management export checks `system.manage` and also requires the matching node secret; a new-key reissue action is proposed work, not an existing export capability.
Sources: **M** `apps/server/src/recovery-pack-api.ts:28–58`; **M** `apps/server/src/recovery-pack.ts:59–70`; **M** `apps/server/src/break-glass.ts:24–35`.

**Stolen PDF:** its holder can sign paper statements with its custody key. Its matching node key can authenticate the permitted recovery operations when the remaining local and outside checks are met. With a usable matching backup, this can expose restored business data; an encrypted archive still requires its separate decryption key. The PDF alone creates no management session and resets no password. Future A732 must retain its explicit fresh-request authorisation, not treat an old allocation signature as that authorisation.
Sources: **M** `packages/fiscal-verifactu/src/paper-evidence.ts:547–618`; **M** `apps/server/src/operation-authentication.ts:53–79`; **M** `apps/server/src/restore.ts:153–156`; **P** repair plan `:178–184`.

**PDF lost with the box:** look for an ordinary saved copy and a usable backup with its matching keys. Keeping an additional copy elsewhere is advice, not a setup condition. Lost custody history prevents short paper allocation; lost node/archive keys prevent the corresponding backup recovery. Emergency naming replaces neither key authentication nor A732 authority. No approved path here grants access to retained old data merely by creating a new account.

The PDF states:

> **This document records reserved invoice names and recovery keys. It does not contain your sales or recover sales missing from a backup.**

## Appendix B: allocation and activation boundaries

Every allocation covers the complete configured set of `{base, purpose}` values, including `full`. `FF` is not relabelled standard. Changed bases require a fresh allocation.

Generic setup and recovery code transports opaque module input. The fiscal module owns prefixes, signatures, complete series and refusals. The retained browser protocol and Node verifier must agree; no uploaded success flag substitutes for verification.

The preserved initial-paper candidate implementation currently requires exactly three bases and the three purposes. Supporting every allowed configured set is proposed module work, not an existing capability.
Sources: **M** Cloud plan `:37–43`; **P** `packages/module/src/initial-setup.ts:4–32`; **P** `packages/fiscal-verifactu/src/initial-paper-candidates.ts:20–35,43–80`; **P** `packages/fiscal-verifactu/src/initial-setup.ts:224–316`.

### Every chain or series start path

| Path | Required treatment and source |
|---|---|
| Initial Live wizard or provisioning CLI | Fresh `S`, or authorised consumed `C` once the setup adapter exists. Frozen IDs and complete series; no local counter fallback. **M** `packages/provisioning/src/venue-apply.ts:350–396,506–523`; **M** `packages/fiscal-verifactu/src/allocated-lifecycle.ts:9–29`. |
| New venue of the same taxpayer | Same scope-wide register; another venue never restarts the paper counter. Same setup path above. Approved rule: **M** Oct 4 spec `:364–370`. |
| Archive restore, including staged and command entry | Fresh `P/C`, or authorised `E`; retire restored issuance series. **M** `apps/server/src/restore-request.ts:323–380`; `apps/server/src/restore.ts:290–303,663–745`. |
| Bucket rebuild | Uses the restored database through `writeValidated` and the same restore hooks. Bucket generation or restored disk state supplies no allocation authority. **M** `apps/server/src/restore-stream.ts:339–345`. |
| Managed-Cloud backup restore | Stages the selected archive into that same restore process. Backup-service approval is not fiscal allocation permission. **M** `apps/server/src/cloud-recovery.ts:524–545`. |
| Re-registration/reimaged filing node | Fresh `P/C/E`, recovery-key authority and complete binding. **M** `apps/server/src/provision-till.ts:58–96`; `packages/fiscal-verifactu/src/allocated-lifecycle.ts:24–29`. |
| Standby reservation and establishment | Reserve independently; do not issue. Current implementation uses signed paper reservation authority. Reservation/establishment alone does not start a selling chain. **M** `packages/fiscal-verifactu/src/allocated-standby.ts:65–118`; `standby-allocation.ts:148–192`. |
| Promotion to seller | Consume that independently reserved, never-issued identity for a fresh promotion event. Recheck current outside consumption; no reuse of another node’s identity. Current dormant activation is paper-specific. **M** `apps/server/src/promote.ts:169–230`; `packages/fiscal-verifactu/src/allocation.ts:233–298`. |
| Automatic conflict switch | Remains gated by outside sole-selling authority, previous-seller fencing acknowledgement and durable allocation/switch history. Otherwise administrator recovery. A679 does not enable it. **M** Oct 4 spec `:471–490`. |
| Emergency-to-short change; exhausted counter; changed bases | Explicit fresh allocation and retirement, never renaming issued invoices. No newly completed UI is claimed. **M** Oct 4 spec `:49–54,372–385`. |
| Demo, Preparation and Live readiness | Existing throwaway preproduction allocation only in the actual separate preproduction target. Never promoted into production. **P** original A679 plan `:190–199`; `apps/server/src/fiscal-readiness-runner.ts:120–146`. |
| Exact interrupted committed event | May return the checked original result and finish publication, with fresh outside confirmation. **No new chain or series.** **M** `packages/fiscal-verifactu/src/allocation.ts:313–373`; **P** `apps/server/src/first-fiscal-activation.ts:60–89,231–258`. |
| PDF reprint/reissue, software restart, Cloud report, filing retry | No fiscal activation. An unknown result does not select an old series. Proposed reissue must demonstrate zero activation calls. |

The current activation implementation retires the old SIF and series, resets the chain head, creates the supplied series and stores the result in the transaction. Its replay branch returns the checked prior result. This design preserves that boundary rather than adding another fiscal writer.
Source: **M** `packages/fiscal-verifactu/src/allocation.ts:313–429`.

### Paper ordering and interruption

The proposed sequence is:

1. Claim and freeze the event, node, administrator, scope and complete bases.
2. Obtain the current register and separate owner confirmation.
3. Record local consumption intent.
4. Produce the successor PDF containing permanent outside consumption and exact bindings.
5. Download/print; record the owner’s confirmation that it was kept.
6. Collect fresh owner-bound authority and activate once through existing module preparation.
7. Check the actual committed result before trading publication.

Before possible outside consumption, validation failure allocates nothing. After consumption intent or uncertain delivery, the name is unavailable until the current history is checked. After outside consumption it stays unavailable permanently.

Only matching outside bindings **and** an exact local committed result permit completion of the same event. A restored event ID, saved `true`, host marker or signature alone does not. A missing result requires a different allocation, subject to the existing recovery authority.

Sources: **M** Oct 4 spec `:455–469`; **P** `apps/server/src/first-fiscal-evidence.ts:185–260`; **P** repair plan `:131–147,186–201`.

## Appendix C: Cloud integration and missing work

Use the existing API, not a proposed replacement service:

| Existing endpoint | Design use |
|---|---|
| `POST /api/account/fiscal-allocations/reserve` | Reserve complete scope, bases, venue and frozen binding |
| `…/consume` | Obtain consumed receipt with absence/isolation confirmation |
| `…/abandon` | Permanently abandon; never release |
| `…/status` | Reconcile the original operation and request |
| `…/list` | Read retained authorised receipts |
| `…/import-paper` | Add original signed paper history |
| `POST /api/installations/fiscal-allocations/report` | Report committed evidence; never allocate or activate |

Account routes require a current full Cloud session, CSRF proof and exact portal origin. The setup page opens the Cloud account journey; it does not invent a cross-origin session exemption or collect Cloud cookies. The first integration can transfer the frozen public request and consumed packet through file selection, without typing their fields. A seamless browser handoff is additional integration work.

Sources: **C** `packages/account-http/src/fiscal-allocations.ts:59–123`; **C** `docs/fiscal-allocation-registry.md:208–220,245–279`.

Cloud checks entitlement and verified taxpayer/operator custody, then current outside history and writer exclusion. The outside journal, not restored PostgreSQL, determines the next `C` serial. Its writer fence protects registry writes; it does **not** stop an old restaurant box selling.

Sources: **C** `packages/fiscal-allocation/src/policy.ts:99–153`; `store.ts:210–249,370–408`; **C** `docs/fiscal-allocation-registry.md:42–61,95–99`.

**Proposed backlog, owned by Lane D where Cloud changes are needed:**

- Qualify and supply production continuity, custody, entitlement, signer/trust and timing adapters. None is enabled by this design.
- Qualify namespace discovery after restoration loses local routing hints.
- Supply any missing admission/attribution policy for a first local setup and its planned operator.
- Qualify key/custodian transfer and compromise policy; an old block re-signed by a new key cannot change custody version.
- Add a public-request handoff/import convenience to the Cloud portal if required.

**Proposed Waitron work:** initial-setup Cloud preparation, owner-bound receipt import, trusted issuer configuration, exact local operator matching, uncertainty handling and later reporting. The present Waitron transport exposes only `status` and `report`; the present preparation admits only restore/re-registration.

Sources: **C** `docs/fiscal-allocation-registry.md:74–78,116–121,193–204,372–375`; **M** `apps/server/src/cloud-fiscal-allocation-client.ts:5–8,135–138`; `packages/fiscal-verifactu/src/cloud-preparation.ts:69–136`.

## Appendix D: clash comparison and required probes

**OLD** means the approved allocation model, not a claim that its whole journey shipped. All probes below are proposed and were not run here.

| Case / route | OLD protection and limit | Redesign and integration/probe |
|---|---|---|
| **a. Two fresh boxes, paper** | One scope-wide master reserves different `S` names. Independent books can clash. | Sequential successor PDFs from that same master. Probe two venues: second consumes the next name; a supplied known stale revision refuses; an unseen stale revision remains the disclosed human-currentness limit. **M** Oct 4 spec `:364–370,423–434`; **P** `initial-paper-candidates.ts:121`. |
| **a. Two fresh boxes, Cloud** | Current outside journal allocates distinct `C` names across organisations. | Same built reserve protocol; add initial-setup integration. Probe two real workers and distinct venue receipts. **C** `packages/fiscal-allocation/src/store.ts:210–249`; existing test definition `test/continuity.test.ts:333`. |
| **b. Dead box/stale restore, paper** | Current master supplies fresh `P`; backup absence proves nothing free. | Current PDF supplies `P`, old PDF only its matching key. Probe backup predating a consumed `P`; replacement must take another. **M** `allocated-lifecycle.ts:49–60`; `apps/server/src/restore.ts:290–303`. |
| **b. Dead box/stale restore, Cloud** | Reconcile outside history before another `C`. | Same consume/receipt checks and fresh recovery binding. Probe restored Cloud projection cannot reissue `C000042`. **C** `store.ts:210–249`; existing test definition `test/continuity.test.ts:46`. |
| **c. Old box returns, paper** | Fresh identity separates replacement from old series; isolation is a declaration, not fencing. | Preserve that limit. Old box can still duplicate its own history after an undeclared rollback. Probe declared replacement uses different series; do not call it proof that the old box stopped. **M** Oct 4 spec `:31–35,471–490`; `allocation.ts:386–414`. |
| **c. Old box returns, Cloud** | `C` allocation and registry fencing do not fence the seller. | Same limit and isolation declaration. Probe distinct replacement identity plus existing membership refusals where applicable. **C** registry doc `:95–99`; **M** `apps/server/src/promote.ts:191–230`. |
| **d. Interrupted retry, paper** | Outside consumption remains spent; only exact committed replay. | PDF records consumption first; V2 resolves interruption. Probe power loss around delivery, commit and publication; assert no freed name or second activation. **P** `first-fiscal-activation.ts:198–258`; repair plan `:186–201`. |
| **d. Interrupted retry, Cloud** | Exact operation/request returns retained receipt; unknown cannot allocate optimistically. | Reconcile status, then separately check local commitment. Probe lost reserve/consume replies and absent local result. **C** registry doc `:193–206`; **M** `cloud-preparation.ts:148–170`; existing Cloud test definition `test/continuity.test.ts:466`. |
| **e. Bucket rebuild, paper** | Stream restore still requires fresh outside allocation and node key. | Supply current PDF through the same restore seat. Probe bucket copy older than current paper consumption. **M** `apps/server/src/restore-stream.ts:339–345`; `restore-request.ts:348–380`. |
| **e. Bucket rebuild, Cloud** | Bucket bytes do not authorise a reused `C`. | Current Cloud receipt plus local recovery authority. Probe old bucket/new journal and unavailable journal refusal. Same restore sources; **C** registry doc `:44–61`. |
| **f. PDF reissued, paper** | A snapshot cannot replace the current master; keys do not allocate by themselves. | Reprint preserves history; key reissue never activates. Probe unchanged SIF/series/ledger and zero activation calls; older backup still requires its matching old key. **M** `apps/server/src/recovery-pack.ts:59–88`; `break-glass.ts:24–35`. |
| **f. PDF reissued, Cloud** | Exported receipt retains the original allocation. | No reserve/consume call on reprint or key reissue. Probe unchanged journal event count and fiscal state. **C** registry doc `:310–317`; **M** same key/export sources. |
| **g. Disk clone, paper** | Neither local constraints nor a copied signature detect every undeclared clone. | Declared clone/recovery takes fresh `P` and isolation confirmation. Undeclared copies can issue the same series; explicitly unsupported. **M** Oct 4 spec `:56–58`; `allocation-operation.ts:99–142`. |
| **g. Disk clone, Cloud** | Current registry prevents duplicate **new allocation**; it does not force an already activated clone to ask again. | Same limit. Probe declared clone takes fresh `C`; separately document that ordinary offline selling supplies no global clone lock. **C** registry doc `:95–99`; **M** Oct 4 spec `:56–58`. |

The paper-versus-Cloud concurrent case additionally tests `P000042` beside `C000042`: both remain distinct. Importing an older paper block must leave later consumed facts occupied. Existing test definitions are at **C** `packages/fiscal-allocation/test/paper-import.test.ts:118,167,265`; their results were not rerun.

## Appendix E: length, capacity and legal evidence

For `<base>-<installation>/<counter>`, length is:

`base length + installation length + counter digits + 2 separators`.

| Cost | `S/P/C` | Emergency `E` |
|---|---:|---:|
| Installation length | 7 | 27 |
| `A` base, counter `1` | 11 characters | 31 characters |
| `FF` base, counter `1` | 12 | 32 |
| `A` base, ten-digit counter | 20 | 40 |
| Longest allowed base and counter | 40 | 60 |
| Available short identities | 999,999 per prefix and scope | Random 128-bit draws |

Zero is refused. Exhaustion does not wrap or fill an old gap. The counter ends at `9,999,999,999`; another identity is then required. The installation maximum is 27 and base maximum 21 under the approved contract. Current source checks these formats; this is not an AEAT acceptance result.
Sources: **M** `packages/fiscal-verifactu/src/allocation-identity.ts:1–20,45–73`; Oct 4 spec `:380–410`; **C** `store.ts:229–233`.

For independent emergency draws, approximate collision probability after `n` allocations is `n(n−1)/2^129`; at one million draws it is about `1.47 × 10⁻²⁷`. This calculation is not a measured randomness result or a guarantee. Known collisions are discarded.

A shorter random name would save receipt space by reducing the number of possible names. It would change the settled emergency decision and is not adopted.

### Official source provenance

| Source | Exact words | Bounded reading |
| --- | --- | --- |
| [AEAT developer FAQ v1.3, 4 December 2025, section 4 page 10](https://www3.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf) | “no puede repetirse nunca”; “dentro de la organización del OEF” | Installation identities distinguish past/present/future installations. A taxpayer-organisation sequential number is one recommended option, alongside a timestamp. This passage does not prescribe Waitron Cloud, paper custody, S/P/C/E prefixes or a particular external issuer. No universal absence-of-regulation claim is made. |
| [AEAT current SuministroInformacion.xsd](https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd) | `<maxLength value="60"/>` | Downloaded with Python urllib, SHA256 ee4c1655175644de44c4c25055ffeb8e5f4bb4bc3834ce8254d4222ef18c8aa1,49540bytes. NumSerieFactura uses TextoIDFacturaType at line66; type lines508-513 is string min1/max60. NumeroInstalacion at238 uses TextMax100Type, not Waitron's stricter27. Source saved alongside this receipt. |


These checked passages describe the identity and field bounds. They do not approve Waitron’s recovery algorithm or prescribe its paper/Cloud issuer. No broader claim that no other rule exists is made. The longer random `N` proposal is withdrawn; `E` retains the approved length and its receipt cost.

## Appendix F: keep/change/drop inventory

“Keep” preserves authority and required behavior; it does not claim completion.

| Existing piece | Disposition |
|---|---|
| Marker repair | **Keep:** only eligible marker repair; strict ordinary readers remain strict. |
| Password from any browser; ownership rebind | **Keep:** original password over trusted HTTPS, throttling, rotated proof/capability and invalidated grants. |
| Empty Start again | **Keep:** only positively established unused preactivation empty workspace with no enrolled custodian. |
| Consumed / Not consumed / Unknown | **Keep:** consult actual current history; Not consumed never clears saved intent; retired allocations remain unavailable. |
| Missing database, fresh workspace | **Keep:** preserve remnants; missing is not empty; fresh assignment and existing authority boundary. |
| Exact Finish setup | **Keep:** checked committed result and fresh outside confirmation; publication only. |
| Retirement audit/workspace selection | **Keep:** permanent evidence, fixed discovery, no fallback to retired roots. |
| Three resolution entry paths | **Keep:** direct, supervised and already-recovery; no premature database opening or staged mutation. |
| Fixed EN/ES wording | **Keep:** including interrupted, recover, start again, finish and abandoned outcomes. |
| A731 backup recovery | **Keep, separate:** matching node/archive keys and existing owner authority; before go-live. |
| A732 signed fresh deployment | **Keep, separate:** fresh-request custody authorisation, then fresh assignment; old data isolated. Retain the custody signing key. Exact format remains its own approval gate. |
| A733 TLS recovery | **Keep, separate:** public HTTP guidance only; secrets over trusted HTTPS; before go-live. |
| Module boundary/public protocol | **Keep:** generic host, module-owned fiscal rules and canonical signed objects. |
| Encrypted signing-key file/PBKDF | **Drop from normal flow:** no separate file/passphrase output or reopen gate. Preserve reusable code pending driver disposition. |
| Secret-paper codec | **Change:** checked PDF/scan encoding; no transcription requirement. |
| Offline downloaded tool | **Drop:** integrate appropriate functions into the setup page. |
| Current master | **Keep:** one current history across venues, outside venue backups. |
| Ink marks and routine fingerprint typing | **Drop:** page generates successor history; select/scan the current document and confirm its provenance. Retained independent trust must still match. Lost-trust A732 enrolment requires displaying and comparing the full public fingerprint with the actual current original and recording that comparison; the box cannot prove the comparison occurred. No signature self-enrolment. |
| File-plus-paper gate/hand typing | **Drop:** download, print or both; one document. |
| Frozen IDs/concurrency | **Keep:** stable event/node/admin/source, revisions, generations and shared exclusion. |
| Trust versus current evidence | **Keep distinction:** persisted trust and authentic signatures do not establish currentness; restart requires fresh consultation. |
| Separate readiness | **Keep:** retained preproduction database, throwaway allocation and distinct production activation. |
| Public import | **Keep:** original public signed evidence remains supported; whole secret PDFs use a separate reader. |
| Cloud | **Change integration:** use built protocol and gates; add first-setup support, without pretending production capabilities exist. |
| Wizard/configuration import | **Keep:** real wizard, existing certificate/email/configuration checks and incompatible-operation exclusion. |
| Interruption/replay | **Keep:** exact committed completion or a fresh allocation; no blind activation retry. |
| Handover/loss drills | **Drop:** no exercise or separate-custodian procedure. Actual loss still has the disclosed history/key limits. |
| Native visuals/accessibility | **Keep:** shared controls, EN/ES, both themes, phone/desktop, keyboard and accessible errors. |
| Old reviews | **Historical only:** they do not qualify this candidate. |
| Old 44-step paper gate/FOLLOW-UP | **Drop:** replaced by opening the actual PDF and checking recovery from downloaded or scanned printed output where designed. |
| Fiscal assertions, H2 and ordinary gates | **Keep:** no fiscal writer/hash/numbering/SQL or guard weakening; later implementation must supply fresh evidence. |

Authority: **Q** `questions.md:4374–4381,4386–4416,4475–4491`; **P** repair plan `:91–255`; **M** original A679 plan `:19–38,228–268`.

### Drawings and acceptance status

These are rendered proposal PNGs, **not a built product PDF or working recovery screens**:

- [paper-setup-desktop-en.png](2026-10-15-a679-two-route-redesign/paper-setup-desktop-en.png)
- [paper-setup-phone-en.png](2026-10-15-a679-two-route-redesign/paper-setup-phone-en.png)
- [paper-register-en.png](2026-10-15-a679-two-route-redesign/paper-register-en.png)
- [cloud-setup-desktop-en.png](2026-10-15-a679-two-route-redesign/cloud-setup-desktop-en.png)

The paper delivery screen shows the assigned series and Download/Print; its note describes selecting the current register first. The register board illustrates occupied names and the warning about stale copies. The Cloud delivery screen illustrates one consumed receipt and describes uncertain/unavailable handling. These boards do not depict every state or the final encoding. [Drawing sources and capture matrix](2026-10-15-a679-two-route-redesign/README.md).

Later acceptance must exercise the real wizard and generated PDF, including printed scanning, stale-history controls, interruptions and zero-activation reissue. Shared form behavior follows **M** `docs/developers/design-system.md:1920–1980`. The driver rendered 20 English/Spanish PNGs in real headless Chromium: light/dark, 390/1280 screen widths, and 794×1123 register illustrations. Captures had no horizontal overflow or page errors; both language contact sheets were visually inspected. No axe, physical print/scan, generated-PDF or new recovery behavior is qualified by those observations.

## Appendix G: requirement and source disposition

| Requirement/source | Exact disposition |
|---|---|
| Owner requirement 1, **Q** `questions.md:4480` | Preserve distinct allocations across venues, stale restores, retries, rebuilds and reissues **within the approved outside-history/isolation assumptions**. Clone and stale-copy limits are explicit. |
| Requirement 2, **Q** `:4481` | Paper PDF without Cloud/offline; built Cloud register for authorised online customers. |
| Requirement 3, **Q** `:4482` | Preserve `S/P/C/E`, additive paper imports and disjoint concurrent routes. |
| Requirement 4, **Q** `:4483` | Existing Cloud API, current-history and custody/entitlement gates; missing enablement is backlog, not an invented service. |
| Requirement 5, **Q** `:4484` | Setup-page single combined PDF; download/print; rejected tool and ceremonies removed. Current-history confirmation remains the inherited assumption. |
| Requirement 6, **Q** `:4485` | V2 core and A731–A733 authority retained without substitution. |
| Oct 4 design `:17–25` | Preserve prevention purpose and declared limits; PDF cannot recover missing invoices or establish old-machine isolation. |
| Oct 4 `:38–45` | Keep recovery keys plus paper register without subscription/bucket. Replace manual transfer with PDF/file/scan interaction. Keep advance paper reservations. |
| Oct 4 `:80–83` | Preserve route separation and paper import; no assumption that noncustomers have Cloud reservations. |
| Oct 4 current `:98–106` | These lines concern validation and filing order/outcomes. **Unchanged and outside A679 redesign.** |
| Oct 4 current `:128–138` | Preserve optional witnesses and separation from fencing; historical filing annotations remain historical. No new filing behavior proposed. |
| Oct 4 `:189–194`, especially `:190` | Retain emergency recovery with disclosed uncertainty; settled format comes from later approved constraints. |
| Oct 4 §9.1 `:353–410` | Names, scope-wide monotonic allocation, complete purposes, bounds, exhaustion and 128-bit emergency probability retained. Correct `FF` purpose according to Oct 12. |
| Oct 4 §9.2 `:412–451` | Current outside master, signatures, reservation/consumption and additive import retained. Separate signer/tool, ink and fingerprint typing replaced by setup-page generation and current-PDF selection/confirmation under later owner decisions. |
| Oct 4 §9.3 `:453–490` | Event binding, permanent consumption, uncertain outcomes, exact committed replay and isolation limits retained. Automatic switching remains separately gated. |
| Oct 4 §9.4 `:493–534` | Opaque module boundary/refusals retained. Historical numeric-schema description is not revived; no second ledger conversion proposed. |
| Oct 4 `:536–544` | Recovery-key event attribution retained; no fabricated account, management session or password reset. |
| Oct 12 constraints `:34–39` | Global scope, exact namespaces/checksum, bounds, complete purposes and environment mapping retained. |
| Oct 12 `:40–44` | Outside consumption, no release, local activation checks, no sale-path network, automatic-switch limits and subscription retention retained. Physical custody arrangements are simplified by later owner decisions, not replaced with restored-disk authority. |
| Oct 12 `:45–46` | Public exports/logs remain secret-free. The explicitly secret combined PDF is the later owner-authorised exception; protected code and gates remain unchanged. |

**Source-tree key**

Line citations refer to the exact revisions below, before this publication’s dated Markdown pointers. Use `git show <revision>:<path>` to read those original positions.

- **M:** current checkout `/Users/clintongormley/workspace/worktrees/waitron-docs-a679-two-route-redesign`, HEAD/main/origin-main read as `3b1a1301001964f87646476f124c509b23643fca`.
- **P:** preserved product tree `/Users/clintongormley/workspace/worktrees/waitron-feat-a679-first-live-fiscal-setup`, HEAD `cc553697b898a7e0a8ebf8e3089c57c634212f67`. Never modified.
- **C:** Cloud tree `/Users/clintongormley/workspace/repos/waitron-cloud`, HEAD `2912202e4b8a7ffed86845e430935d101962556e`. Never modified.
- **Q:** `/Users/clintongormley/waitron-campaign-e/questions.md`; queue heading read at `/Users/clintongormley/waitron-campaign-e/queue.md:401–409`.

The withdrawn design was read only to inventory superseded changes: **M** `docs/superpowers/specs/2026-10-15-a679-simple-pdf-design.md:33–84`. Its allocation departure and removal of A732 custody authority are not carried forward.
## Qualification at the design checkpoint

From docs-only worktree base `3b1a1301001964f87646476f124c509b23643fca`, the unchanged existing suites ran:

```sh
pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-identity.test.ts src/allocation-envelope.test.ts src/allocation-paper-source.test.ts src/restore-committed.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts
pnpm --filter @waitron/server exec vitest run src/cloud-fiscal-allocation-client.test.ts src/cloud-fiscal-allocation.test.ts
```

The first run passed 234 tests in six files; the second passed 33 in two. They exercise selected current format, current-confirmation, committed replay, protected fiscal and client behavior. They do not test the proposed PDF reader, current-register procedure, production Cloud enablement, actual paper recovery or undetected clones. The probes in Appendix D remain implementation acceptance work. No test assertion or product file changed.

### Fresh-context requirements review

A fresh reviewer checked the six owner requirements and the cited October 4/12 contract and built Cloud registry. It found two gaps: the lost-trust A732 description omitted the actual-original full-fingerprint comparison; the register drawing made S000003 look like a replacement. The text now preserves that comparison and records the owner’s confirmation, and both language boards explicitly show Olivo Centro as a genuinely new venue. A focused reread accepted both corrections.

Requirements 1–6 and the mandatory-source checks all passed that design review. No unresolved conflict between the requirements was identified within the approved current-history and isolation assumptions. This is a source/design review result, not implementation or recovery acceptance. Product build remains paused at this checkpoint; the old physical procedure remains cancelled.


## Replacement-plan checkpoint, 2026-10-15

The [replacement implementation plan](../plans/2026-10-15-a679-one-pdf-implementation.md) follows this design and the completed six-requirement review. Its new source check identifies the original first-setup paper-recipient mismatch with Cloud’s UUID admission contract. The plan keeps that import unavailable until the separately owned Cloud contract admits the unchanged signed facts; no remapping, re-signing or release of consumed names is authorised. This is an implementation dependency, not a new allocation policy or a claim that the integration ran.


## Historical manual-entry proposal, 2026-10-15 at 19:35

The [published 19:35 proposal](https://github.com/clintongormley/waitron/blob/bd0acb84fb2040c503eca0f91e1a927b580fa404/docs/superpowers/specs/2026-10-15-a679-two-route-redesign.md#manual-entry-revision-owner-2026-10-15-at-1935)
and its drawings remain a receipt of that superseded design. They used a signing seed, custodian
reference and short head tag. The 21:30 revision below replaces that active format; the old 101,
79, 40, 141 and 119 counts do not describe the new flow.

## Authoritative revision: owner decision, 2026-10-15 at 21:30

**Precedence:** this revision replaces the 19:35 manual-entry appendix and overrides conflicting statements in the earlier redesign. Those earlier statements and their qualification receipts remain historical evidence of their dated candidates. In particular, references to recovering a custody signer, signed new paper revisions, fingerprint enrolment for ordinary paper use, scanning, and the 101/79/40/141/119 character counts are superseded.

**Amendment, owner 2026-10-15 at 22:15:** this amendment replaces the 21:30
grouping and paper-to-Cloud import requirement. Authority:
`/Users/clintongormley/waitron-campaign-e/questions.md:4593–4595`.
Group every typed field independently in fours. Importing paper history into Cloud
is not required because S/P and C names are disjoint. Keep the paper PDF when
joining Cloud; later paper allocations, including after leaving Cloud, continue
that same S/P register. No unsigned-import build dependency remains.

Authority: `/Users/clintongormley/waitron-campaign-e/questions.md:4565–4569`. The owner approved removing the paper signing key and accepted that forged or edited paper cannot be detected. The owner also required case-insensitive, easy-to-type codes; the 22:15 amendment groups each field in fours.

This is a design revision, not implementation qualification. Product head inspected: `aa6c1b957508570d60b3652c5c0ac79044556993`. No tests, services, PDF generation, browser journeys or physical typing ran during this revision.

## What you keep and use

You keep **one PDF**, downloaded, printed, or both. The setup page produces it. There is no separate tool, custody-key file, custody password, scanner, ink procedure, handover ceremony or loss drill.

To continue an existing paper register, choose:

- **Upload saved PDF:** your browser reads its embedded attachment locally.
- **Type from printout:** enter the S position, P position and check code.

For recovery, also supply the selected backup’s named node recovery key. An older document can supply that matching key while a newer document supplies the current allocation register.

The paper register has **no custody private key and creates no paper signatures**. No replacement persistent signing key is introduced in the browser, host, database or Cloud adapter.

You still confirm:

> This is the current register for this taxpayer, software and environment. No other paper allocation is underway.

First setup also requires the appropriate initial-machine absence declaration. Recovery requires old-machine isolation and no parallel recovery. A matching check code does not make either declaration true.

## Keep, change and drop

| Earlier requirement | Disposition under the 21:30 decision and 22:15 amendment |
| --- | --- |
| Taxpayer-wide allocation history outside restored backups | **Keep.** One current paper register across all venues and nodes. |
| Paper `S/P`, Cloud `C`, emergency `E128` | **Keep.** No new namespace. |
| Complete configured bases and purposes | **Keep**, including multiple bases of a purpose and `FF/full`. |
| Outside consumption before activation | **Keep**, with exact frozen event/source/target/operator/allocation bindings. |
| Download/print retention confirmation | **Keep.** Neither event proves retention. |
| Separate Ed25519 paper custodian and signed paper claims, Oct 4 §9.2/Oct 12 constraints | **Change by owner decision.** New paper history is explicitly owner-declared and unsigned. |
| Seed, custodian reference and custody fingerprint in ordinary paper flow | **Drop.** No generation, recovery, enrolment, comparison or typing. |
| Printed short history-head reference | **Drop.** Full heads remain in the attachment; no head tag is typed. |
| Signature-based forged/edited-paper detection | **Drop by owner decision.** Unkeyed checks can catch accidental errors; they do not authenticate the record. |
| Full saved-file history | **Keep losslessly.** Preserve every supplied public original and original signed receipt. |
| Typed checkpoint | **Keep with changed representation.** Unsigned, conservative burn floors; missing history remains explicit. |
| Existing signed paper originals | **Keep unchanged as historical evidence.** Never rewrite, re-sign or reinterpret them as new unsigned originals. |
| Signed Cloud receipts, issuer trust and current outside authority | **Keep.** Removing paper signatures removes none of Cloud’s signature checks. |
| Existing Cloud `import-paper` for newly unsigned history | **Unavailable and not required.** No new import implementation is authorised. |
| Additive paper-to-Cloud history preservation | **Drop as a requirement by owner decision, 22:15.** Keep the paper PDF when joining Cloud; later paper allocations, including after leaving Cloud, continue its existing S/P register. No unsigned-import dependency remains. |
| V2 repair, retirement, exact finish and entry ordering | **Keep.** Paper signing removal grants no reset authority. |
| Password-free empty-workspace exception | **Keep.** Absence of a signing key is no longer evidence that no register exists. Any existing or unknown register/authority history excludes this exception. |
| A731 backup recovery from repair page | **Keep separately owned**, before go-live. |
| A732 fresh-deployment authorisation | **Keep the independent authority requirement and separation.** Its former paper-signer mechanism is unavailable after this decision; a separately approved replacement is required. |
| A732 actual-original fingerprint comparison | **Historical mechanism only for its signed-authority design.** Do not substitute a check code or unsigned PDF for that authority. |
| A733 secure-connection recovery | **Keep separately owned**, before go-live. |
| Protected writers, guards and existing protected fiscal assertions | **Keep protected.** The owner’s signer removal requires a distinct unsigned admission branch; it does not authorise changing protected writers or existing fiscal assertions. |
| Task 1 completion at `aa6c1b9` | **Historical milestone.** Revise its active protocol, history and compact-code assumptions in the same eventual A679 product PR. |

## Allocation invariants

Scope remains `(taxpayerNif, softwareId, fiscalEnvironment, prefix)` across every venue, node and organisation of the taxpayer.

- Initial paper: `S000001..S999999`.
- Recovery paper: `P000001..P999999`.
- Cloud: `C000001..C999999`, generated only by Cloud.
- Emergency: `E` plus 26 Crockford symbols containing 128 random bits; first suffix symbol `0..7`.
- The existing emergency CRC-16/CCITT-FALSE checksum remains four hexadecimal digits outside the filed identity. This revision does not change that protected protocol.
- Zero is not an installation allocation. Exhaustion never wraps or fills a historical gap.
- Installation maximum 27; base maximum 21 using `[A-Za-z0-9/_.-]`; invoice maximum 60; counter `1..9,999,999,999`.
- NIF is canonical nine uppercase ASCII letters/digits; software ID is two.
- Every allocation freezes the entire configured `{code,purpose}` set.
- Cloud registration `test` maps to fiscal `preproduction`.
- Demo, Preparation and readiness use their separate preproduction targets and throwaway identities.
- Consumption, retirement, abandonment, uncertainty and subscription end never free names.

Paper integrity now rests on structural checks, digest consistency, retained contradictory evidence, monotonic floors, exact bindings and the owner’s current-register declaration. These checks provide no protection against an editor who recomputes the digests and check code.

No network request is added to a sale transaction. No allocation receipt establishes seller fencing or reconstructs missing invoices.

## Exact typed format

### Alphabet and normalisation

New A679 typed recovery fields use `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.

Print uppercase, grouping each typed field independently in fours from the left, with a shorter final group where necessary. Accept lowercase. Map `O/o` to `0` and `I/i/L/l` to `1`. Ignore ASCII spaces, hyphens, tabs and CR/LF in these typed fields. Reject other characters; do not guess further substitutions.

S/P positions use the **decimal subset** of this alphabet: exactly six digits after normalisation. They are not base32 numbers. Thus `0000 42` means decimal 42. The printed alphabet excludes competing letter forms; aliases tolerate their accidental entry.

Apply these transformations only to human-entered display codes. Never case-fold, strip separators from, or otherwise normalise an actual node secret, original attachment, signed object or Cloud packet.

### Register block R2

| Field | Data characters | Display |
| --- | ---: | --- |
| S position | 6 | `0000 42` |
| P position | 6 | `0000 07` |
| Check | 8 | `xxxx xxxx` |
| **Register total** | **20** | **23 characters including grouping spaces** |

Positions are the highest reserved/excluded values, `000000..999999`, not the next free candidates. Zero means no earlier allocation in that prefix.

The check is the first five SHA-256 bytes, encoded as eight Crockford symbols, over canonical UTF-8 JSON:

`["waitron.paper-position-check",2,scope,sHighWater,pHighWater]`

`scope` contains exactly `environment`, `softwareId`, `taxpayerNif`, with recursively lexical object keys. Arrays retain order. No custodian, secret, head tag or additional reference is required.

### Named node key K2

Keep the existing generated secret: 24 random bytes represented internally as its original 32-character unpadded base64url string.

For print/typing, decode those 24 bytes and encode them as **39 Crockford symbols**, using most-significant-bit-first byte-stream base32 with three zero padding bits at the end. Decode and re-encode to require canonical padding. The last symbol can therefore only be `0`, `8`, `G` or `R`.

After typing, reconstruct the **exact original base64url secret** before checking its existing verifier. Do not replace it with the Crockford display value.

For other supported UTF-8 keys, encode the complete, unchanged UTF-8 bytes with the same byte-stream codec. If their byte length is `n`, the display payload has `ceil(8n/5)` symbols. The printed format selects `raw192` or `utf8`; selection is a click, not another typed reference. Never infer format from length.

The screen and printout label these choices **Standard key** (`raw192`) and **Text key** (`utf8`). The encoding identifiers are internal values, not user-facing labels.

The eight-symbol node check covers:

`["waitron.node-key-check",2,scope,nodeId,keyName,encoding,byteLength,actualSecret]`

The backup preview supplies `nodeId` and `keyName`; the frozen operation supplies scope. All are visible for comparison and are not retyped.

| Case | Data characters | With grouping spaces |
| --- | ---: | ---: |
| First register generated by setup | 0 | 0 |
| Continue printed register | 20 | 23 |
| Generated named key alone | 39 + 8 = **47** | **57** |
| Register plus generated named key | 20 + 47 = **67** | **80** |
| Imported nonempty UTF-8 key alone | `m + 8`, where `m=ceil(8n/5)` | `m + floor((m−1)/4) + 9` |
| Register plus imported UTF-8 key | `m + 28` | `m + floor((m−1)/4) + 32` |

Counts exclude labels, line breaks, clicks, existing passwords and separate authority inputs. Grouping restarts for each of the 6 + 6 + 8 register fields and payload + 8 key fields.

No 40-character generated-key claim survives: 39 payload symbols plus eight check symbols is 47.

### Updated screen and printout

The screen and printout must group every typed field independently in fours.
The [21:30 drawings](2026-10-15-a679-two-route-redesign/README.md#current-2130-typing-proposal)
retain their historical grouping and counts; they do not qualify this amendment.
Their [synthetic values](2026-10-15-a679-two-route-redesign/position-reference.json)
calculate the proposed check domains; they are not product-codec, PDF or recovery qualification.

## Typed continuation and its limits

Typing creates a new **owner-declared checkpoint**. It excludes every S/P identity through the entered positions, including unused reservations. It does not reconstruct old allocations, signatures, recipients, event bindings, Cloud receipts or the previous full head.

Example: S position 42 and P position 7 exclude `S000001..S000042` and `P000001..P000007`. A new initial setup takes `S000043`; recovery needs `P000008`. An unused old `P000006` cannot bypass this floor.

Known lower positions refuse. Uploaded full history also refuses known older or contradictory full heads. **Typed equal-floor history has no head reference and cannot distinguish two sheets with equal positions.** Do not claim otherwise. A replacement box cannot detect an unseen newer sheet.

Keep all available original history when applying a checkpoint. A later old upload may add historical originals but cannot lower floors, erase subsequent facts or restore burned reservations. Checkpoint history never silently becomes complete. Preserve a displaced unsigned revision chain as a separately labelled public-history original, with exact public-only bytes and digest. It is not part of the new checkpoint’s ancestry; its retention never turns the missing interval into complete history. Node secrets remain outside that public carrier.

Unknown currentness offers obtaining the current register, an authorised Cloud route, or the existing authenticated emergency recovery route where applicable. It cannot proceed with a guessed short name.

## PDF and original-file retention

Use one version-2 document with exactly one embedded attachment, `waitron-register-v2.json`. It contains scope, complete supplied public history or the explicit checkpoint gap, subsequent revisions, original Cloud receipts and named node keys. It contains no custody signing material.

The browser reads the attachment locally. The host receives only public evidence and, separately, the node secret needed by an appropriate authenticated HTTPS recovery request. Whole PDFs and raw keys are never persisted on the host.

The reader returns the original attachment bytes alongside its parsed representation. Successor documents retain every supplied public original byte-for-byte and all named keys required by retained backups. Structural acceptance is not authority.

Require a real installed-Chrome download/re-upload test using the exact downloaded file. Also require an actually changed viewer resave whose PDF hash differs but attachment bytes remain identical, a no-change control, and an attachment-stripping Chrome print/export refusal.

Missing attachment wording:

> This copy no longer contains its register data. Choose the original downloaded PDF, or type the recovery block from your printout.

Never recover allocation history from visible PDF text. Arbitrary visible-text edits are not detected; the page shows the attachment-derived summary for confirmation.

The preactivation document says **“Consumed; activation completion not yet confirmed.”** It contains no sales, administrator/archive passwords, provider credentials, Cloud cookies, machine signing credentials or TLS private keys.

## Authority, interruption and reissue

Freeze attempt, module/version, scope, bases, event, source, target, operator and allocation. Record consumption intent before producing the consumed successor. Require explicit kept-document confirmation before activation.

Owner-bound grants remain one-use and bound to boot, revision, ownership generation, time, public-history digest, exact input, document digest and staged node-key verifier. A digest binds bytes; it proves neither retention nor authenticity.

Only an exact checked local committed result plus fresh outside confirmation permits **Finish setup**, with zero activation calls. Typed positions alone cannot recreate a lost committed event.

Reprint uses the same document/key material. Reissue after raw-key loss requires existing unfinished-password or manager authority, changes only the staged or installed named verifier, invalidates delivery grants and performs zero fiscal activations. Old backups retain their old named-key requirement.

A stolen PDF contains a usable node recovery secret for its matching backup/verifier and existing permitted recovery checks. It creates no management session and resets no password. Losing the paper with the box requires a surviving usable backup and its matching keys; no new reset authority is inferred.

## Cloud consequences and delivery boundary

Signed consumed C receipts remain verified against independent configured trust and exact local authority. C-only documents create no paper signer.

Paper-to-Cloud import is not required. Paper S/P and Cloud C names are disjoint, so joining Cloud does not require importing paper allocations to prevent duplicate names. Keep your paper PDF for any later paper allocation. Leaving Cloud continues your existing S/P register; it does not start a new paper register or free old names.

New unsigned paper histories and typed checkpoints remain unavailable to existing `import-paper`. No replacement unsigned-import contract, implementation or joint import qualification is an A679 dependency. Legacy signed originals remain unchanged; they do not turn subsequent unsigned history into signed evidence. The historical recipient-admission mismatch does not block this transition.

Paper machine reporting for unsigned history remains unavailable unless separately decided. This amendment authorises no new paper reporting implementation.

**Implementation boundary:** the inspected activation chain still checks signed paper evidence. The owner’s explicit removal of paper signing authorises replacing that admission requirement with a distinct owner-declared branch. Keep the legacy signed branch strict and carry independent live operator authority through preparation. Source reading indicates the existing activation writer can remain unchanged; Task 4 must test that inference through the real path. H2 does not separately name these admission validators as protected. If implementation requires changing hashes, numbering, fiscal-record/activation writers, SQL, guards or an existing protected fiscal assertion, stop at that exact change and ask with its source lines. This documentation grants no such exception.

Acceptance remains: the owner opens the built PDF, uploads the actual Chrome download, and physically continues or recovers by typing its printed fields. Automated extraction/typing does not complete that owner gate.
