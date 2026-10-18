# A679: hour-coded invoice series

**Approved by the owner, 2026-10-16 at 14:50.**

The owner accepted this design as written, including the epoch, clock threshold and disclosed limits.
References below to proposals and recommendations record the design presented for that decision.
Follow the [replacement implementation plan](../plans/2026-10-16-a679-hour-code-implementation.md)
before building. Approval does not waive protected-code or fiscal-assertion restrictions; the later
generated-PDF viewing check remains separate.

This replaces the register’s job of handing out names with the owner’s seven requirements of **2026-10-16 ~12:50**. It incorporates the **12:20** Start again exception, **13:00** PDF acceptance and **13:40** read-only empty-database proof permission.

Source references describe Waitron `92a76fb6891e4eb7fb83d5db2f942f67d1656294` and Cloud `26c52379198253ab85a79385115276d8661fc0a7`; they are source observations, not runtime qualification. Cloud’s cited source paths are unchanged through `75c620abcc215d62f142bbe44c01c7bf658653a2` (`git diff 26c5237..75c620a -- packages/fiscal-allocation packages/account-http apps/portal packages/registration/migrations/038_fiscal_allocation_registry.sql` returned no changes).

## What you see and keep

You enter the venue and administrator details and complete the applicable certificate, email and readiness steps. The review page brings country, place, time zone and current time together:

> **Spain · Valencia · Madrid time**
> It is now **13:40, Friday 16 October 2026**.
> Your invoice series will be **A-06RB**, **FF-06RB** and **R-06RB**.

You confirm those details. The box compares clocks automatically; a separate clock question appears only when clocks disagree or no comparison is available.

Before choosing a fresh name, it asks:

> **Has anyone set up a Waitron box for this business in the last hour?**

The explanation explicitly includes **every venue using this taxpayer’s NIF**, including interrupted setups, replacements and recoveries. It asks you to arrange these operations one at a time.

**No** allows the current eligible hour. **Yes** waits until the next UTC hour, with a countdown. **I don’t know** takes the same conservative waiting path. There is no longer-code alternative. Remembered same-box attempts trigger the necessary wait automatically, without asking you to report those attempts again.

You then download, print, or both from **one recovery PDF** and confirm that you kept it. Download and Print reuse the same document during that delivery session. There is no register, allocation signing key, downloaded tool, separate custodian, offline requirement or physical typing ceremony.

## Exact naming and worked example

**Designer recommendation, awaiting approval:** use epoch **2026-01-01 00:00:00 UTC**.

The suffix is the integer number of elapsed UTC hours, encoded most-significant digit first in exactly four Crockford base32 symbols:

`0123456789ABCDEFGHJKMNPQRSTVWXYZ`

Leading zeroes remain. Generated names use uppercase; human-entered display codes accept lowercase and the existing look-alike handling. Configured kind labels retain their exact spelling and purpose. No `S`, `P`, `C` or `E` namespace prefix is added.

| Item | Exact example |
| --- | --- |
| Setup instant | `2026-10-16T11:40:00Z`, displayed as 13:40 in Madrid |
| Elapsed hours | `6923` |
| Base32 value | `06RB` |
| Configured series | `A-06RB`, `FF-06RB`, `R-06RB` |
| First invoice in each | `A-06RB/1`, `FF-06RB/1`, `R-06RB/1` |
| Next UTC hour | `2026-10-16T12:00:00Z`, suffix `06RC` |

Elena sets up Olivo at that instant and answers No. A second venue of the same taxpayer starts at 13:50 Madrid time and answers Yes. It waits until 14:00 Madrid time, then uses `06RC`, subject to the final clock and local-history checks.

Months later Olivo’s box dies. Elena supplies a usable backup, its matching recovery key from the PDF and any separate archive password. Recovery preserves the recorded invoices and recovered counters, retires the recovered series from further issuance and selects a fresh hour for future invoices. It does not restart `A-06RB/1`.

The read-only Python calculation returned:

- `32^4 = 1,048,576` hours, approximately **119.621 years**.
- Last representable hour: **2145-08-15 15:00 UTC**, `ZZZZ`.
- Exclusive end: **2145-08-15 16:00 UTC**.

Refuse before the epoch or at exhaustion. Never wrap, truncate, lengthen the code or silently change the epoch.

**Designer recommendation:** use this same four-symbol value for the activation’s `NumeroInstalacion`. Keep node UUIDs and unpredictable operation IDs separate. This continues the existing relationship between installation identity and series suffix, while changing its naming policy; the current activation writes both supplied values in `packages/fiscal-verifactu/src/allocation.ts:398–420`.

Keep the existing conservative base limit of 21 characters and counter limit of `1..9,999,999,999`. The longest resulting combined invoice number is then **37 characters**, below AEAT’s 60-character limit. Do not expand the base limit in this change. Existing base validation and suffix construction are at `packages/fiscal-verifactu/src/allocation-identity.ts:45–73`.

## What the scheme assures

This is **clock and operator assurance**, not a global reservation service.

Different eligible UTC hours produce different suffixes. Within one hour, independent boxes calculate the same suffix. Prevention therefore depends on correct clocks, truthful coordination across the taxpayer’s venues and surviving local evidence.

| Situation | Required behavior and remaining limit |
| --- | --- |
| Two independent venues | Ask across the whole taxpayer, not merely this venue or Cloud organisation. Different kind labels are not permission to reuse an installation hour. |
| Wrong No answer | Another box can receive the same installation identity and, with matching bases, the same series. Overlapping counters can produce duplicate invoice identities. |
| Simultaneous setups | Both can answer No before either finishes. Both can also answer Yes and reach the next boundary together. The countdown does not allocate separate slots; operations must be coordinated in turn. |
| Same-box retry | Retained intent, attempts and retirement records exclude spent hours. Exact committed completion returns the existing result; an uncertain or abandoned activation needs a later eligible hour. |
| Old backup restored | Known backup and surviving host evidence establish floors. They cannot reveal later activity absent from both. A correct current clock usually moves naming forward, but does not reconstruct lost invoices. |
| Future clock accepted | It can select a future hour and misdate subsequent work. Correcting the clock does not rename issued invoices or erase the recorded floor. Further fresh activation must wait or undergo separately authorised resolution. |
| All local history lost | The release floor, current comparisons and operator answer remain. Nothing proves that another installation never used that hour. |
| Old box returns or disk is cloned | Choosing a new name does not stop the old seller. An undeclared clone can continue copied series and counters without entering setup. |
| Another invoicing product | The hour code does not search or reserve that product’s names. Known matching names must refuse; unseen use remains outside this mechanism. |

Keep the existing old-machine isolation, sole-recovery and selling-authority requirements. Do not introduce automatic conflict switching through this design. Optional device, backup and external witnesses remain useful lower bounds, never proof that unseen history does not exist.

These limits preserve the distinction in the approved W41s design §2 and §9.3 between fresh naming, missing-invoice recovery and stopping another seller.

## Clock checks and durable hour selection

**Designer recommendation, awaiting approval:** flag disagreement above **120 seconds**, including measured request uncertainty. This is a setup naming threshold, separate from the existing one-minute filing-clock warning at `apps/server/src/time-health.ts:88–96`.

### Compare actual observations

The box collects:

1. Its wall-clock instant, with a monotonic reading that measures elapsed time independently of wall-clock corrections.
2. A fresh browser-clock sample through the owned setup session, with request timing.
3. When online, a recent authenticated HTTPS `Date` or current-time response from a module-selected AEAT origin or an already configured Waitron origin.

Use a bounded server-side request, retaining source, result, request interval and uncertainty. Proposed deadline: **five seconds**. Reject malformed, stale, cached or excessively uncertain observations as unavailable. A browser cannot simply nominate an arbitrary time-source URL. The box’s own HTTP `Date` is not an independent comparison.

Compare all usable observations. Do not declare agreement because only the most convenient pair agrees. HTTPS authenticates the responding connection; it does not make its clock infallible or create an allocation witness.

A wrong clock can also make a certificate appear expired or not yet valid. Report that comparison as unavailable; never disable certificate validation to obtain time. Likewise, successful TLS validation establishes a validity interval, not precise clock correctness. See the primary-source table below.

### Show disagreement honestly

When comparisons agree, show their status quietly beside the combined review.

When they disagree, show the box, browser and available internet readings with full date and zone. Offer **Check again** and an explicit **The box’s displayed time is correct** confirmation. Explain that accepting a wrong time can reuse names or date invoices incorrectly.

When no comparison is usable, say:

> **We could not compare the box’s clock. Check the displayed date and time before continuing.**

Manual confirmation records the operator’s judgement. It cannot override release, history or exhaustion floors and does not change the operating system’s clock. Repair-page TLS recovery remains A733.

Even below 120 seconds, observations on opposite sides of a UTC-hour boundary cannot quietly choose different codes. Wait and compare again until the accepted uncertainty interval falls wholly inside one hour.

### Floors, races and restart

Before reserving an hour:

- Refuse a time before an **immutable release timestamp embedded in the software**. Do not derive that floor from installation time, file modification time, mutable environment settings or the current clock.
- Inspect every known series and activation attempt for the taxpayer and target fiscal environment, across all bases, purposes and nodes, including retired and abandoned attempts, surviving workspaces and supplied backups.
- Preserve the greatest known hour and relevant recorded time floor. Supplied backup evidence can raise a floor, never lower surviving evidence.
- Require a **strictly later hour** for a new activation. Do not pretend a future known hour is today by calculating `maximum + 1`.
- Keep production and preproduction separate. A preproduction identity cannot authorise production.

Under the existing shared exclusion and venue locks, re-read ownership, scope, clock observations and floors immediately before durably recording the selected hour. Record the hour as spent **before** exposing usable activation material. Bind it to the exact event, source, target, taxpayer, environment and complete `{code,purpose}` set.

A preview crossing an hour boundary before that durable record is recalculated. After recording it, the event keeps its selected hour across an ordinary boundary; it does not acquire a new name merely because time passes. Clock corrections invalidate outstanding clock confirmations and require rechecking, while spent hours remain spent.

The countdown uses server-authoritative elapsed time and a monotonic timer; the browser only displays it. A forward wall-clock jump cannot complete it early. Refresh reconnects to the same wait. Restart retains its UTC target and spent-hour floor, then obtains fresh comparisons; a restarted process cannot trust an old monotonic reading or assume downtime completed the wait.

These checks can detect contradictions with **surviving evidence**. They do not detect every full-disk rollback.

## Restore, restart and first Live

| Path | Hour-code policy |
| --- | --- |
| First Live setup or new independent venue | Select one eligible hour for the complete configured series set. Take no names from paper or Cloud. |
| Archive, bucket or managed-Cloud restore | Preserve recovered records and counter values. Before renewed filing/issuance, use a fresh installation hour and retire recovered active series. |
| Re-registration | Fresh hour, existing authentication and old-machine checks. |
| Standby admission | Keep it dormant without reserving a future hour. Promotion selects its hour when activation occurs; staging no longer hands out a name in advance. |
| Ordinary reboot, update or exact publication Finish | Keep the existing activation, series and counters. Allocate nothing. |
| PDF download, print or key reissue | Allocate nothing and perform zero fiscal activations. |

The current restore chain is `apps/server/src/restore.ts:696–727` → `packages/fiscal-verifactu/src/allocated-lifecycle.ts:49–60` → `allocation-preparation.ts:66–81` → `allocation.ts:392–435`. It retires active series and inserts new ones. The replacement must preserve historical rows and counters rather than resume potentially stale numbers. Standby currently retains supplied reservation evidence at `allocated-standby.ts:191–222`; that contract must change.

On interruption, show **Continue with your setup password** first and **Start again** second.

The **2026-10-16 12:20 exception** allows password-free Start again even when a recovery PDF exists, only with positive proof that the box never activated and its database contains no business data. Preserve the original attempt and artifacts; burn its **whole former block**, represented here by its entire selected hour, not just one configured base. The new isolated workspace uses a later eligible hour.

The approved **13:40** inspection permission remains limited to read-only empty proof. Missing, partial, corrupt, unreadable or unknown state does not count as empty. Current inspection separates taxpayer/location classification from that proof at `apps/server/src/first-setup-resolution-inspection.ts:106–125`; schema, migration and application-row checks are at `first-setup-empty-database.ts:18–105`.

Missing-database fresh setup retains its separate authority boundary and preserves remnants. It does not recover business data. Recovering data still requires a usable matching backup and its keys.

**A732 remains separate, design only:** starting fresh after a live box loses its password/PDF needs its own approved entitlement routes. Neither clock confirmation nor a recovery PDF supplies that broader authority.

### Preproduction and development

Retain separate production and preproduction databases, readiness evidence and credentials. Never promote test records, counters or identities.

Real preproduction and development Live setups use the same hour syntax and target-environment floors. Demo, Preparation and Live’s isolated readiness retain automatic disposable preparation without a recovery-PDF or taxpayer-coordination ceremony; they confer no production hour or uniqueness claim. Replace their existing `S000001` naming rather than preserve a hidden S namespace.

Current disposable preparation generates a temporary signer and `S000001` at `packages/fiscal-verifactu/src/throwaway-allocation.ts:38–66`. Readiness opens its separate retained database at `apps/server/src/fiscal-readiness-runner.ts:120–146`. Their replacement must use the new local admission path without introducing a signing key.

Existing signed Cloud allocations cease to be an active naming route. Nothing is live: reset synthetic installations as required, retain development receipts as historical evidence and build no compatibility or data-conversion path.

## Country, time zone and A696

Fresh setup knows the country before the fiscal step: `apps/setup/src/screens/venue-screen.ts:630–651` supplies country, territory, derived zone and configured bases. The server independently derives and checks them at `apps/server/src/setup-api.ts:398–469`, then selects the fiscal contribution at `:530–537`. The owned attempt freezes the module selection at `apps/server/src/module-operation-host.ts:128–155`.

That does **not** establish a known country/module on every damaged box:

| Entry | Evidence and required treatment |
| --- | --- |
| Valid interrupted attempt | Use its frozen country, territory and module/version set; check selection again through `module-operation-host.ts:270–285`. |
| Exact committed Finish | Check the recovered provision and stored result, not a fresh country guess (`first-fiscal-activation.ts:86–90`). |
| Trading box | Resolve the enabled fiscal slot against its recorded filing module (`boot.ts:1538–1542`). |
| Damaged or missing setup/configuration | Resolution can start without readable module configuration (`first-setup-entry.ts:119–139`). Use trustworthy retained evidence or require fresh selection for an authorised empty workspace. Unknown selection grants no fiscal or A732 authority. |
| Selected backup | Existing preview supplies taxpayer, environment, node and key name, but not country/territory (`recovery-backup-preview.ts:20–29,53–60`). Extend the module-owned inspection before proposing country-specific actions. |

The UTC hour is a **name**, not an invoice date or the venue’s business-day boundary. Confirm the venue’s named zone and show its local time on review, including Canary Islands distinctions.

A696 still needs its own implementation. Current boot constructs `systemClock()` at `apps/server/src/boot.ts:1573`; that clock uses the process offset at `till-backend.ts:14–24`. The actual invoice path passes that reading through `issue-moment.ts:17–24`, `packages/core/src/record-sale.ts:275,368–376`, and `packages/fiscal-verifactu/src/backend.ts:220–236`.

Therefore the review confirmation alone does not make invoice dates follow the saved venue zone. Preserve A696’s approved venue-zone behavior and its later startup/every-writer validation direction. Do not revive the superseded mid-payment repair design. Existing invoice dates, offsets and hashes remain unchanged.

## The recovery PDF

“Only the recovery key” means **one secret purpose**, with enough public context to choose the right sheet.

Proposed contents:

- Heading **Waitron recovery key**; legal taxpayer name and NIF, venue name, environment, node ID, key name and document creation date.
- The named node recovery key, grouped in fours, with its existing typo check and format label.
- Brief instructions: keep this sheet; recovery also needs a matching backup and any separate backup password; retain older sheets for older backups.

No invoice allocation list, register positions, current-master declaration, signing key, Cloud receipt, administrator password, archive password, provider credential or TLS private key appears. The PDF is not an outside allocation record.

Keep the existing generated key’s 192-bit secret and reversible display representation: 39 payload symbols plus eight check symbols, **47 entered / 57 displayed characters**. The secret generator is `packages/provisioning/src/identifiers.ts:16–17`; grouping and display normalisation are at `packages/fiscal-verifactu/src/paper-register-compact.ts:49–57,95–100`. Never normalise the actual secret or issued invoice names.

Use a key-only attachment for exact saved-PDF import. Visible printed fields remain sufficient for manual recovery entry; an attachment-stripped copy offers key entry, never an allocation-history reconstruction.

Retain only verifiers and public delivery bindings on the host. Raw keys and secret PDF bytes remain transient for delivery, outside logs, browser persistence and venue backups. No guaranteed memory-erasure claim is made.

Reprint the retained PDF unchanged. After raw-key loss, reissue requires the original setup password over trusted HTTPS while unfinished, or an authenticated manager with `system.manage` after completion. It changes only the staged/current named verifier, invalidates affected delivery grants and performs zero fiscal activations. Old backups still need their old matching key.

A stolen PDF plus a usable matching backup can authorise the existing node recovery operations. It does not itself create a management session or reset a password: `apps/server/src/operation-authentication.ts:53–79` checks the matching verifier and event-bound restore/re-register/promote action. Existing recovery-pack access checks `system.manage` at `recovery-pack-api.ts:30–48`.

If the PDF and box are lost together, use a surviving backup and matching retained key through the existing recovery routes. The PDF contains no business backup. If required data or keys are missing, this design cannot recreate them; broader fresh-start authority remains A732.

## Official evidence and its limits

Live research checked these primary sources on **2026-10-16**. Quotes are deliberately short.

| Source and direct URL | Exact source words | Precise meaning and limit |
| --- | --- | --- |
| [AEAT production XSD, `TextoIDFacturaType`](https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd) | `<minLength value="1"/>` · `<maxLength value="60"/>` | `NumSerieFactura` contains series **plus invoice number**, 1–60 characters. This type has no character pattern; that alone does not establish all business validation rules. |
| [AEAT Validaciones y errores v1.2.2, §3.1.3.1, p.8](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf) | “NumSerieFactura solo puede contener caracteres ASCII del 32 a 126” | Printable ASCII is allowed except codes **34, 39, 60, 62, 61**: double quote, apostrophe, `<`, `>`, `=`. Letters, digits, hyphen and slash used here fall inside the published set. |
| [AEAT web-service description v1.0.3, pp.10,32,46](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_Descripcion_SWeb.pdf) | “Alfanumérico (60)” · “`<NIF> + <NumSerieFactura> + <FechaExpedicionFactura>`” · “12345678 / G33” | The service identifies records by issuer NIF, combined number and issue date. It trims outer whitespace; its example retains internal spaces/slash. A numeric example is not an allowed-character restriction. This record key is not permission to reuse an issued number. |
| [BOE RD 1619/2012, arts.6.1(a),7.1(a)](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696) | “La numeración de las facturas dentro de cada serie será correlativa.” | Numbering must be consecutive **within each series**. Separate series are justified for multiple establishments; rectificative invoices and simplified versus full invoices have separation requirements. These articles do not prescribe a base32 series name or a worldwide register. |
| [AEAT developer FAQ v1.3, §4, pp.9–10](https://sede.agenciatributaria.gob.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/FAQs-Desarrolladores.pdf) | “no puede repetirse nunca” · “«Timestamp» (al menos fecha+hora+minuto+segundo)” | **Installation number**, distinct from invoice series, must distinguish the taxpayer’s installations across time, including reinstallation and independent centres. AEAT recommends a timestamp with at least seconds or a nonrepeating sequence. It does not endorse this four-symbol/hour procedure. |
| [RFC 9110 §6.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1) | “represents the date and time at which the message was originated” | HTTP `Date` describes message origination, not a signed time attestation. Freshness and request uncertainty still matter. |
| [RFC 5280 §6.1.3](https://www.rfc-editor.org/rfc/rfc5280#section-6.1.3) | “The certificate validity period includes the current time.” | Certificate validation depends on time. A bad local clock can prevent comparison; valid TLS does not establish second-level accuracy. |

No reviewed source requires a series name to be globally unique across **different taxpayer NIFs**. Conversely, no source permits a taxpayer to treat each venue or software product as an independent invoice-numbering namespace merely because the software differs.

Waitron’s `[A-Za-z0-9/_.-]` restriction is deliberately narrower than AEAT’s published printable-ASCII rule; its implementation is `/Users/clintongormley/workspace/repos/verifactu/src/validate.ts:585–590`. The 21-character base, ten-digit counter, permanent burned-hour policy and four-symbol alphabet are internal constraints.

The installation nonrepetition requirement remains real. The proposed checks reduce accidental reuse under their stated assumptions; neither the evidence nor this design establishes unconditional uniqueness or AEAT approval.

## Keep/change/drop inventory

References: **W41** = `2026-10-04-fiscal-prevention-and-offline-recovery-design.md`; **A14** = `2026-10-14-a679-first-fiscal-setup-design.md`; **A15** = `2026-10-15-a679-two-route-redesign.md`; **C12** = `2026-10-12-cloud-fiscal-allocation-registry.md` plan; **R** = `2026-10-15-a679-first-setup-repair.md` plan.

Every changed owner decision below is dated **2026-10-16**. Designer recommendations remain proposals.

| Approved requirement/source | Disposition |
| --- | --- |
| W41 §§1–2: prevent recovery reuse; new hardware/offline recovery; preserve missing-history limits | **Keep**, with the explicit clock/operator assumptions above. |
| W41 §§2–3,9.1–9.2; A14 settled constraints; A15 allocation invariants: current paper/Cloud history allocates names | **Change, owner 12:50:** hour selection replaces outside allocation authority. |
| W41 §9.1; C12 Global constraints; A15 namespaces | **Drop, owner 12:50:** S/P/C/E generation, emergency randomness/checksum, advance name blocks and route separation. Four-symbol hours replace them. |
| A15 exact typed format: S/P positions, register checks, full-head/checkpoint continuation | **Drop, owner 12:50.** No register typing, freshness declaration or register upload. |
| A15 unsigned-paper decision; former custodian, seed, signing file, fingerprint and offline tool | **Keep dropped.** No replacement signer or ceremony. |
| W41 §9.1; C12 constraints: complete configured bases/purposes, including `FF/full` | **Keep.** Exact labels stay before the suffix; no relabelling or omitted purpose. |
| W41/C12 format bounds and exhaustion | **Change, owner 12:50:** four-symbol installation/hour range. **Keep** existing base/counter limits, validation and refusal without wrapping. |
| W41 §9.2; A15 authority: consume outside before activation | **Change, owner 12:50:** durable local hour intent before exposure/activation. No global-consumption claim. |
| W41 §9.3; A14 ownership/interruption | **Keep:** unpredictable IDs, frozen context, ownership, exclusion, exact committed replay, permanent abandonment. Replace register-specific evidence with clock/hour evidence. |
| W41 §9.3; A15 exact Finish | **Change, owner 12:50:** exact checked commit and fresh ownership permit publication-only Finish; no current-register consultation. |
| A15 repair inventory; R Tasks1–2 | **Keep:** strict ordinary readers, eligible marker repair, password recovery/rebind over trusted HTTPS, throttling and invalidated grants. |
| Owner 12:05 audit exception | **Keep its meaning:** no invented consultation. **Change, owner 12:50:** retire register fields from the new active audit contract rather than fabricate register answers. |
| A15 repair inventory; R Tasks3–4 | **Keep:** original-byte retention, prepared/applied retirement, isolated workspace selection and no fallback to retired roots. Burn hours instead of name blocks. |
| A15 empty Start again; R Tasks1,4 | **Change, owner 12:20:** existing PDF does not bar a positively empty, never-activated restart. Retain originals and burn the whole former hour. |
| R empty-proof boundary | **Change, owner 13:40:** narrowly authorised read-only schema/application-row proof, under existing locks; no database writes or weakened emptiness. |
| A15 Consumed / Not consumed / Unknown register question | **Drop, owner 12:50.** Keep locally established committed/uncertain/abandoned outcomes. |
| R Task5: missing database | **Keep** preservation and separate authority; missing remains different from empty. Fresh naming uses an eligible hour. |
| R Task7: direct, supervised and already-recovery entry | **Keep:** resolution before ordinary database/staged mutation. |
| A15 fixed EN/ES wording | **Change, owner 12:20/12:50:** password-first order and hour/clock messages; retain truthful interrupted, abandoned and Finish outcomes. |
| A14/A15 readiness and wizard/configuration import | **Keep:** separate preproduction target, certificate/email/configuration checks, module boundaries and incompatible-operation exclusion. Replace disposable S naming. |
| W41 §2 and A15 ordinary recovery | **Keep:** matching backup/key, separate archive password, operator attribution, old-machine isolation and fresh future-issuance series. |
| A15 PDF contents and retention | **Change, owner 12:50:** key-only recovery document with public identification labels; no allocation history. Keep one-document Download/Print and retention confirmation. |
| A15 node-key display/reissue | **Keep:** grouping in fours, exact secret reconstruction, matching named verifier, authorised reissue, old-backup keys and zero fiscal activation. |
| A15 signed C receipts, issuer trust, reporting and subscription transitions; C12 | **Drop as active allocation machinery, owner 12:50.** No paper import or joining/leaving name conversion. Retain existing development artifacts as history. |
| W41 D3/D7 | **Keep:** active-series resolution and useful optional witnesses; no witness becomes a global allocation guarantee. |
| W41 D8 | **Keep:** existing filing-clock warning. New setup threshold is a separate designer recommendation. |
| W41 D1/§9.3 automatic switching and fencing | **Keep separate gates**, including authority, fencing and durable switch-history conditions. Hour naming grants none. |
| W41 §4, D2/D4/D5/D6 and corrective/legal questions | **Keep outside this redesign:** filing order, duplicate handling, corrections, reporting and missing-invoice investigation. |
| A731/A732/A733 | **Keep separate before-go-live work.** A732 remains design only and does not block A679; no replacement entitlement is authorised here. |
| A15 visuals/accessibility and ordinary gates | **Keep:** shared forms, EN/ES, themes, phone/desktop, keyboard, errors, reviews and current-head CI. |
| A15 physical PDF/typing owner acceptance | **Change, owner 13:00:** owner views realistic generated EN/ES PDFs through Drive; automated rendered-field entry belongs to the driver. |
| H2/protected writers, hashes, number allocation, fiscal assertions, SQL and guards | **Keep protection**, including only the exact 13:40 read-only exception. This spec grants no blanket edit permission. |

## Implementation consequences after approval

Replace **`docs/superpowers/plans/2026-10-15-a679-one-pdf-implementation.md` before building**. Its Tasks9–12 remain waiting; completed register-based tasks are reusable evidence and components, not qualification of this replacement. Reconcile the repair plan, original A679 plan, W41s allocation contracts, backlog and operator procedures with dated historical pointers.

The replacement plan must trace and revise:

- **Identity and admission:** four-symbol identity parsing, hour-policy evidence, complete series validation, prepared operations and setup/restore/re-register/promotion consumers. Current prefix-only parsing is `allocation-identity.ts:1–6`; current admission couples identity to source prefixes and outside confirmation at `allocation-envelope.ts:278–320`.
- **State and witnesses:** durable hour intent/floors, comparisons, declarations, restart waits and contradictory evidence. Eliminate register freshness and Cloud continuity as naming authority.
- **Retirement and Finish:** preserve originals, positive emptiness and exact commit checks; replace register-specific audit carriers, including `apps/server/src/first-setup-finish-audit.ts:14–38`.
- **Backup and reissue:** preserve recovered data, counters and matching-key authentication; export useful hour floors as backup evidence; produce/read the key-only PDF without allocating names.
- **Protected boundaries:** keep actual invoice-number allocation, fiscal-record writers, hashes and immutable records unchanged. The activation writer already stores validated supplied identities and series (`allocation.ts:398–435`), but that reading is not proof it can remain unchanged. Any required protected-writer edit or replacement of an existing protected fiscal assertion still needs an exact, separately recorded exception.

### Lane D: Cloud removal inventory

Lane D owns the Cloud changes. This design changes no Cloud files.

| Remove from active allocation service | Source |
| --- | --- |
| `@waitron-cloud/fiscal-allocation`: reservation store, paper import, receipts/signers, custody/entitlement and allocation continuity/writer-witness machinery | Cloud `packages/fiscal-allocation/src/policy.ts:18–111`, `evidence.ts:83–88`, `store.ts` |
| Account POST `reserve`, `consume`, `abandon`, `status`, `list`, `import-paper`; installation allocation-report POST | Cloud `packages/account-http/src/fiscal-allocations.ts:30–82`; dispatch at `app.ts:125` |
| Portal allocation screen/controller/types, route, links and allocation-specific API validation | Cloud `apps/portal/src/screens.ts:33–41`, `fiscal-allocation-controller.ts:59–80`, `api.ts:14–17` |
| Allocation-specific schema ownership and guards | Cloud `packages/registration/migrations/038_fiscal_allocation_registry.sql:2–90`: scopes, allocations, events, paper events and operation routes |
| Waitron allocation status/report client, signed-C preparation and associated wire protocols | Waitron `apps/server/src/cloud-fiscal-allocation-client.ts:72–89`; `packages/fiscal-verifactu/src/cloud-preparation.ts:70–87` |

Remove corresponding allocation-only tests, configuration, documentation and dependency wiring through Lane D’s reviewed change. Do not remove shared Cloud accounts, machine registration, recovery grants, backup services or authentication. Do not hand-edit shipped migrations or build compatibility for synthetic data.

## Acceptance and handoff

After approval, the driver writes a replacement plan with failing behavioral checks before implementation. It must qualify clock disagreement/unavailability and TLS failures, release and all known-history floors, boundary races, restart/countdown behavior, simultaneous-setup limits, whole-hour retirement, exact Finish, every fresh-identity consumer, retained restore counters and zero-activation PDF reissue.

Generate realistic recovery PDFs from the **real box code**, in **English and Spanish**, at every supported paper size. Retain them as receipts and copy them to:

`~/My Drive/Waitron mockups/<yyyy-mm-dd> A679 recovery PDF/`

Include a plain-English `question.txt` explaining the document, its labels, what to inspect and “approve, or say what to change”. The owner’s acceptance is viewing those PDFs on their phone. The driver separately proves that values **as rendered** can enter the real recovery field with grouping spaces, lowercase and look-alikes. No physical owner typing exercise remains.

**Do you approve this concrete design, including epoch 1 January 2026, the proposed two-minute clock threshold and the disclosed limits when clocks, coordination or history are wrong?**

1. **Approve this design — recommended:** permits the driver to replace the implementation plan and build within existing permissions; exact protected-code/assertion exceptions and the later generated-PDF viewing check remain separate.
2. **Revise before building:** identify what should change; Tasks9–12 remain waiting while the proposal is revised.

## Owner addition, 2026-10-18 at 10:15: keep the prior installation codes

Your recovery sheet also identifies the installation codes the box used. This public context
helps when your backup predates a later setup. First setup prints its selected code beside the
node and key name, as **Installation codes** / **Códigos de instalación**. It is also part of the
PDF attachment and the public document confirmation. Key reissue keeps the selected code; it
does not allocate another one. A later completed-box export must include that box's known codes.

When you recover or promote a box, enter the codes from the sheet under **Installation codes** /
**Códigos de instalación**. Separate multiple codes with commas. The operation retains these
codes alongside its selected hour or pending wait and carries them into its backup evidence.
They can raise the known-hour floor; they never replace the existing backup and surviving-history
checks. The box requires a UTC hour strictly later than every reported code.

For example, your backup predates a setup that used `06RC`. Entering `06RC` at 12:40 UTC on
16 October refuses `sif.allocation_invalid` with reason `hour_not_later`, before any new identity
is saved or fiscal activation starts. At 13:00, a fresh comparison allows `06RD`. An omitted or
malformed list does not provide recovery selection authority. This does not discover an unreported
code or stop an old seller; the existing isolation and taxpayer-wide coordination requirements stay.

The source and focused checks for the first-setup PDF and recovery entry are on the A679 branch.
Dormant promotion's host preparation and completed-manager reissue remain implementation tasks.


## Owner clarification, 2026-10-18 at 12:10: one prefix per purpose

Your box has one configured prefix for receipts (`standard`), one for full invoices (`full`)
and one for corrections (`rectificative`). Setup, recovery and dormant admission refuse a
configuration with a missing purpose or more than one prefix for a purpose. The refusal is
`sif.allocation_invalid` with reason `series_configuration_unsupported`. There is no trading-series
chooser and no silent choice among prefixes.

A promoted or recovered box combines each configured prefix with its newly selected code.
For example, `A`, `FF` and `R` with `06RC` become `A-06RC`, `FF-06RC` and `R-06RC`, each starting
at one. They are the new node's series. Recorded series and counters remain historical evidence;
reading that evidence checks the spent-hour floor and whether the saved configuration was changed.
It does not choose an old series for new trading.

This answer supersedes the earlier requirement to support several bases for one purpose,
including the replacement plan's global constraint and Task 1 example. The lower-level history
readers still inspect every recorded series, including unsupported historical configurations.
The new configuration check does not make an altered recorded allocation valid: recovery first
checks the stored configuration against its allocation and retains its `series_mismatch` refusal.


## Owner PDF review, 2026-10-18; presentation checkpoint 2026-10-19

This dated addition supersedes the earlier raw-format label and character-count explanation.
You see labels and values in two columns, a creation date in the venue's time zone and the
sheet's language, and the first eight node-ID characters grouped in fours. The backup preview
shows that same short form; recovery continues to use the full identifier. Generated key names
retain their existing four-character suffix. The raw192 format marker stays in machine data
where needed and is omitted from the printed page.

The instructions distinguish what accompanies the recovery key: your Cloud login for a backup
in Waitron Cloud, or the downloaded archive's own password. Keep those credentials separately
from this sheet. The sheet carries neither credential.

The owner also requested one short combined key/check field and only the current installation
code. The requested dependency inspection found that the existing eight-symbol check binds
the key to taxpayer/node/name, and that recovery reads the sheet's reported-code list to raise
its hour floor. Those findings and recommended replacements are recorded in Lane E's
questions under “two PDF revision dependencies”. The check and reported list remain unchanged
at this presentation checkpoint, pending those answers. The sheet still awaits viewing acceptance.
See the [changed-check inventory](../../operations/a679-changed-checks.md#recovery-pdf-presentation-revision-2026-10-19)
for the observed checks and their limits.
