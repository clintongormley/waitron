# A679 One-PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` for **INLINE execution**, one task at a time. Read `superpowers:test-driven-development` before writing implementation or tests. Observe each expected failure before implementing. Inline implementation is authorised after review/publication; do not reopen the six settled requirements.

**Goal:** Complete first Live setup and ordinary recovery using outside allocation history, with one PDF supporting original-file upload and short typed continuation from its printout.

**Architecture:** The browser transiently creates or recovers custody material and produces the secret PDF. The host receives public evidence only and retains frozen attempts, public history, retirement records and node-key verifiers. Complete-file history and conservative typed checkpoints are distinct. Existing module preparation and activation remain the fiscal boundary.

**Tech stack:** TypeScript, Lit/shared controls, Hono, Web Crypto, existing durable JSON, PDFKit 0.20.2, PDF.js 6.4.299, fontkit 2.0.4, existing Noto Sans, Vitest, Playwright and installed Chrome. No QR/image/camera dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-a679-two-route-redesign.md`, including the dated 19:35 note and manual-entry appendix.

**Target:** `docs/superpowers/plans/2026-10-15-a679-one-pdf-implementation.md`.

## Authority and starting state

| Source | Revision/authority |
| --- | --- |
| Published redesign/current docs base | `4539d3903702571d3a9d2020a14b7f4a52a2d165` |
| Preserved product | `cc553697b898a7e0a8ebf8e3089c57c634212f67` |
| Remote product/draft #1752 | `6318bd61e6f237491146e758c3f52710165b2ec1`, campaign receipt |
| Product/docs common ancestor | `0802457c531130181590503b4177e91a9040b0ed` |
| Read-only Cloud | `2912202e4b8a7ffed86845e430935d101962556e` |
| Owner authority | `questions.md`: 17:15 V2, 18:35–19:15 requirements/result, final 19:35 entry |
| Inherited constraints | October 4 §9; October 12 Cloud plan; A679 queue |

The revised draft’s accepted source-review corrections are retained below. That review predates typed recovery and does not qualify it.

This author performed source reading only. No implementation, tests, Chrome probe, PDF generation, credential operation or physical recovery ran. Earlier recorded 234 fiscal/33 server passes and proposal images do not qualify this candidate.

Continue the preserved whole product branch after plan review/publication. Reconcile main while retaining reusable commits. One whole A679 production branch/PR; one coherent plan task per campaign firing. No invented queue items.

The historical tool plan remains paused; its Task 9 stays incomplete. Earlier reviews remain historical.

## Global constraints

- Scope is `(taxpayerNif,softwareId,fiscalEnvironment,prefix)` across every venue/node/organisation of that taxpayer.
- Preserve paper `S000001..S999999`, paper recovery `P000001..P999999`, Cloud `C000001..C999999`; refuse zero/exhaustion without wrap or gap reuse.
- Preserve emergency E plus 26 Crockford characters, 128 random bits, first suffix character `0..7`; no N namespace.
- Emergency checksum stays four uppercase CRC-16/CCITT-FALSE hexadecimal digits over the 27 ASCII identity bytes, outside the filed identity.
- Installation ≤27; base ≤21 with `[A-Za-z0-9/_.-]`; invoice ≤60; counter `1..9,999,999,999`.
- Software ID: two uppercase ASCII letters/digits; NIF: canonical nine uppercase letters/digits.
- Preserve every configured `{code,purpose}`, including multiple bases per purpose and `FF/full`; changed bases require fresh allocation.
- Cloud registration `test` maps to fiscal `preproduction`; production maps to production.
- Outside consumption precedes activation; explicit kept-document confirmation precedes activation. Download/print events do not prove retention.
- Freeze attempt/event/source/target/admin/module versions/environment/bases/allocation. Route or scope changes require retirement and fresh bindings.
- Consumption, abandonment, retirement and uncertainty never free names. “Not consumed” never clears saved intent.
- Full uploaded history remains lossless. Typed checkpoint continuation burns all prior S/P names and visibly declares missing original history.
- Never use restored-disk absence as free-name evidence. Signatures/checksums/trust do not prove unseen currentness.
- Paper documents contain matching custody material and named node keys. C-only documents need no paper signer; optional supplied paper material stays an indivisible pair.
- Exclude admin/archive passwords, provider credentials, Cloud cookies, machine signing credentials and TLS private keys from the PDF.
- Raw custody material and whole PDFs stay browser-transient. Only intended PDF/print output and appropriate authenticated recovery delivery may carry node secrets.
- Public-only host verification receives no seed, private key, node secret or PDF. Structural browser reading grants no authority.
- No signature/seed/PDF self-enrolment. Preserve independent trust and A732’s separately approved actual-original comparison.
- No code changes to hash/`computeHuella`, numbering, `registros`, alta builders, `registerSif`, `restoreFiscal`, SQL/migrations or guards.
- Existing fiscal assertions and golden huella/inmutabilidad files stay unedited. Required assertion changes return with exact lines before editing.
- No network on the sale transaction, automatic conflict switching, seller-fencing promise or reconstruction of missing sales.
- Readiness/Demo/Preparation retain separate preproduction targets and throwaway identities.
- A731/A732/A733 remain separate before-go-live requirements; implement none of their repair-page mutations here.
- No QR generation, scanner, image decoding or camera recovery work.
- Every commit uses `git commit -s`; normal hook/current-head CI; no automatic landing.

## Review focus

| Failure class | Required outcome and owning tests |
| --- | --- |
| Original PDF resaved without its attachment or with conflicting public contents | Explicit original-file/typing error; no empty-register fallback. Task 2 download/resave tests. |
| Mistyped seed/position/key, wrong frozen scope or known stale paper | Refuse before signing/use; actual recovery verifier still required. Tasks 1–3 compact/session tests. |
| Typed checkpoint mistaken for complete history or used to overwrite newer facts | Burn all earlier names; preserve original evidence; no fabricated predecessor or Cloud import. Tasks 1, 3, 5, 10. |
| Consumption followed by lost response/rebind/publication failure | No freed allocation/rekey/blind activation; exact committed finish only. Tasks 4, 8–9. |
| Missing DB, restored retired roots or delayed Cloud response after route retirement | Inspect before opening; no fallback, retained-data unlock or delayed activation. Tasks 5–9. |

## Keep/change/drop inventory

| Existing piece | Disposition |
| --- | --- |
| Generic initial-setup/browser seats and module registry | Keep; extend opaque interfaces. |
| Canonical paper block/consumption bytes and Node verification | Keep unchanged. |
| Candidate validator | Keep real validator; add complete configured-set cases and P wrapper. |
| Durable claim/marker/coordinator/exclusion/frozen IDs | Keep and extend. |
| Any-browser password recovery and eligible marker repair | Keep preserved primitives; finish eligibility/invalidation/entry integration. |
| One-use public evidence grants | Keep boot/revision/generation/time binding; add history/delivery/stage binding. |
| Exact committed-result checks/readiness isolation | Keep. |
| Native custody seed/DER/public derivation | Reuse transiently; no rotation. |
| Full-history PDF reader | Keep, with real Chrome download/upload and resave handling. |
| Printed recovery | Change to compact seed/position/checkpoint plus named key; no complete-history claim. |
| QR/scanner/image/camera work | Drop, including planned dependencies/tests. |
| Offline downloaded tool/PBKDF gate/ink/challenge drills | Remove from normal flow; preserve unrelated CLI/reusable code until reviewed disposition. |
| Superseded non-fiscal tool/UI checks | Replace with equally strict file/typed checks; inventory every change. |
| Resolution retirement/workspace/entry/finish | Remaining implementation. |
| Old reviews, 44-step/FOLLOW-UP and scan proposals | Historical/cancelled; no acceptance credit. |

## Files and contracts

Paths under `fiscal/` below mean `packages/fiscal-verifactu/src/`; `server/` means `apps/server/src/`; `setup/` means `apps/setup/src/`. Other paths are written fully.

| Owner/files | Responsibility |
| --- | --- |
| `fiscal/register-protocol.ts`, `register-history.ts` | Canonical public history/checkpoint shapes and verification |
| `fiscal/custodian/register-compact.ts`, `register-key.ts`, `register-session.ts` | Browser-only typed decoding, key recovery and session |
| `fiscal/custodian/register-pdf.ts`, `register-reader.ts`, `custodian/assets/register-noto-sans.ttf` | PDF generation/attachment reading/printed blocks |
| `fiscal/initial-paper-candidates.ts`, `initial-setup.ts`, `initial-cloud-setup.ts`, `register-cloud-export.ts` | Module-owned candidates/preparation/import |
| `fiscal/setup/first-fiscal-screen.ts`, `register-picker.ts`, `strings.ts` | Fiscal browser interaction/copy |
| `packages/module/src/initial-setup.ts`, `setup-contract.ts`, `operation-preparation.ts` | Generic opaque seats |
| `packages/dashboard-modules/src/setup.ts` | Browser composition |
| `server/first-fiscal-delivery.ts`, `first-setup-node-key.ts` | Public delivery binding and verifier stage |
| Existing host owner/evidence/activation/API files | Retained authority/preparation/publication |
| `packages/provisioning/src/first-setup-resolution.ts`, `first-setup-workspace.ts` | Durable resolution/workspace records |
| `server/first-setup-resolution-inspection.ts`, `first-setup-resolution.ts`, `first-setup-entry.ts`, `first-setup-resolution-api.ts` | Inspection, authority and boot admission |
| `setup/screens/first-setup-resolution-screen.ts`, sibling strings | Resolution UI |
| Existing `setup/screens/recovery-allocation.ts`, `recovery-copy.ts` | Ordinary backup recovery integration |
| `server/recovery-document-api.ts` | Authorised staged/committed key reissue |
| Named sibling tests below | Behavioral qualification |
| Current developer/operator/backlog docs | Procedure, limits and changed-check inventory |

All proposed signatures below are **new**, except retained named interfaces/functions. Browser exports use explicit browser-safe subpaths.

```ts
type RegisterScope = {
  readonly taxpayerNif: string; readonly softwareId: string;
  readonly environment: "preproduction" | "production";
};
type RegisterHead = {
  readonly registerId: string; readonly revision: string; readonly digest: string;
};
type NamedNodeKey = {
  readonly nodeId: string; readonly name: string; readonly secret: string;
};
type RegisterPosition = {
  readonly sHighWater: number; readonly pHighWater: number;
};
type CompactRegisterFields = {
  readonly referenceKind: "uuid" | "text"; readonly custodianReference: string | null;
  readonly custodySeed: string;
  readonly sPosition: string; readonly pPosition: string;
  readonly sourceHeadTag: string; readonly check: string;
};
type RegisterCurrentStatement = {
  readonly head: RegisterHead; readonly currentRegisterConfirmed: true;
  readonly noParallelPaperAllocation: true; readonly confirmedAt: string;
};
```

`InitialSetupContext`, `FirstSetupOwnerAttempt`, `FirstSetupHold`, `OperationBinding`, `CustodyKey`, `CustodyPublic`, `SignedPaperValue`, `PaperBlock`, `PaperConsumption` and `ReceiptTrust` retain their existing owners.

### Full history and checkpoint history

- `RegisterHistory` is a strict tagged union with `mode:"complete"|"checkpoint"`.
- Complete mode retains scope/register/custodian/custody-version identity and **every** signed revision/original object.
- Revision payload: `{version:1,registerId,scope,revision,previousDigest,createdAt,sHighWater,pHighWater,events}`.
- Revision is a canonical positive decimal string. Predecessor is full lowercase SHA-256; genesis uses 64 zeroes.
- Sign `["waitron.paper-register-revision",1,payload]`, using recursive lexical object-key order and preserved array order. Digest the canonical signed revision.
- Preserve existing `paperBlockBytes` and `paperConsumptionBytes` exactly.
- Checkpoint mode has a newly signed `PaperBurnCheckpoint`, retained original evidence if available, and complete subsequent signed revisions.
- `PaperBurnCheckpoint` exact payload: `{version:1,kind:"paper-burn-checkpoint",checkpointId,scope,custodianId,fingerprint,sHighWater,pHighWater,sourceHeadTag,currentOriginalConfirmed:true,noParallelPaperAllocation:true,completeHistoryUnavailable:true,burnAllPrior:true,createdAt}`.
- Sign `["waitron.paper-burn-checkpoint",1,payload]`. Its full signed digest anchors the new continuation’s first revision.
- `sourceHeadTag` is only a truncated source reference. Never put it in `previousDigest` or claim it reconstructs the original register ID/revision.
- Retain known custody version when independently established; unknown checkpoint custody version remains explicit and supplies no Cloud import authority.
- Replay marks all S/P values ≤checkpoint floors permanently unavailable; it need not invent one historical allocation object per excluded number.
- Subsequent PDF attachments retain the checkpoint, all available originals and every subsequent fact. No silent upgrade to “complete”.

### Secret document variants

```ts
type PaperRegisterMaterial = {
  readonly publicHistory: RegisterHistory;
  readonly custody: {
    readonly scope: RegisterScope; readonly fingerprint: string; readonly pkcs8: string;
  };
};
type SecretRegisterDocument =
  | { readonly version: 1; readonly kind: "waitron-secret-register-document";
      readonly route: "paper"; readonly paper: PaperRegisterMaterial;
      readonly cloudReceipts: readonly unknown[]; readonly nodeKeys: readonly NamedNodeKey[] }
  | { readonly version: 1; readonly kind: "waitron-secret-register-document";
      readonly route: "cloud"; readonly paper: PaperRegisterMaterial | null;
      readonly cloudReceipts: readonly unknown[]; readonly nodeKeys: readonly NamedNodeKey[] };
```

A paper pair is indivisible and key-matched. C-only documents require public consumed-receipt evidence and named keys, without generating S/P or enrolling a paper signer.

Browser reading checks structure. Node verifies public signatures/trust/active context before use. Neither scope nor trust is taken from an uploaded success flag.

### Dependencies, carrier and compact encoding

- Use browser PDFKit **0.20.2**, `pdfkit/output` `toBytes`, `file(Uint8Array,options)` for the embedded attachment.
- Use PDF.js **6.4.299**, local worker, `getAttachments()` and `render()`; disable scripting/evaluation/remote resources.
- Copy `apps/server/src/assets/invoice-noto-sans.ttf` byte-for-byte to the fiscal asset above. Use fontkit **2.0.4** for coverage; unsupported glyphs visibly escape as `[U+1F600]`, while attachment Unicode remains exact.
- Retain Noto OFL notices and add the identical browser asset to their README; existing npm notice/Vite/Docker machinery carries dependency and worker notices.
- Remove planned qrcode-generator/jsQR dependencies from this feature. No new executable/system package.
- Attachment: exact canonical UTF-8 `waitron-register-v1.json`; ≤8 MiB. Selected PDF ≤64 MiB. Refuse over-limit input without truncation.
- Require exactly one expected attachment. Missing/multiple/conflicting attachments refuse; never OCR visible text or infer an empty register.
- Preserve original canonical data through original Chrome download/upload and supported attachment-preserving resave. Attachment-stripping copies produce the explicit error.
- New custodian IDs use UUIDs; compact U reference is canonical base64url of their 16 bytes, 22 characters. Existing non-UUID IDs use T reference, canonical UTF-8 base64url, unchanged identity.
- Seed: canonical case-sensitive base64url of 32 bytes, 43 characters. Reconstruct fixed DER prefix `302e020100300506032b657004220420`; derive SPKI/fingerprint with existing browser key code.
- S/P fields: six decimal digits each, `000000..999999`; they mean highest excluded/reserved, not next candidate.
- Source head tag: first 80 SHA-256 bits of `["waitron.paper-head-reference",1,head]`, sixteen Crockford characters.
- Register check: first 40 SHA-256 bits of `["waitron.paper-compact-check",1,scope,custodianId,publicSpkiBase64url,sHighWater,pHighWater,sourceHeadTag]`, eight Crockford characters.
- Named-node check: first 40 SHA-256 bits of `["waitron.node-paper-check",1,scope,nodeId,keyName,secret]`, eight Crockford characters.
- In every compact/head/node-check formula, `scope` means exactly the three-field `RegisterScope` (`environment`, `softwareId`, `taxpayerNif` in lexical key order), never four-field `CustodyScope`. Custodian ID is the separate listed argument. Pin identical complete hash vectors in browser and Node.
- Print reference kind U (UUID) or T (text) beside the reference. The form has an explicit `referenceKind` selector; choosing it adds no typed data character. Never infer it from length: a text reference can also be 22 characters. Test both equal-length encodings and wrong-kind refusal.
- Canonical arrays use UTF-8 JSON; embedded objects use recursive lexical keys. Checks exclude grouping spaces. Accept ASCII grouping whitespace only; preserve base64url case, `-` and `_`. Reject invalid alphabet, noncanonical padding/bits and extra data.
- UUID reference/seed/positions/tag/check total **101** characters, or **79** with independently bound custodian ID. A newly generated 32-character node secret/check totals **40**; combined **141/119**. Imported nongenerator keys retain their full actual value: encode UTF-8 bytes as canonical base64url, print/select `nodeKeyFormat:"utf8"`, show actual encoded character count `n+8`, and decode exactly before the existing verifier. Generated mode prints/selects `nodeKeyFormat:"generated"` and preserves its raw 32 characters. Never reject/truncate a valid imported key merely to fit the common count; test both formats, whitespace/Unicode in imported text and checksum scope parity.
- Custom reference length `n` gives **79+n** register characters; show the actual count on that document/screen. NIF/software/environment and backup node/name are frozen context, not extra secret fields.
- These checks detect many accidental errors; random unrelated matches are `2^-40`, head-tag collisions `2^-80`. No forgery/freshness guarantee.

## Task 1: History, conservative checkpoint and exact candidates

**Spec:** Appendices A/B/E plus 19:35 manual appendix.

**Files:** create `fiscal/register-protocol.ts`, `register-history.ts`, `custodian/register-compact.ts` and sibling tests; modify candidate/protocol exports and module initial setup.

**Interfaces:**

- `parseRegisterHistory(value:unknown):RegisterHistory`.
- `verifyRegisterHistory(history:RegisterHistory,trust:CustodyPublic,known:KnownRegisterEvidence):Promise<RegisterProjection>`.
- `KnownRegisterEvidence` contains independently trusted identity, maximum known S/P floors, current/retained full heads and retained originals.
- `RegisterProjection` contains mode, full head, floors, occupied facts, recipients, next S/P candidates and completeness limits.
- Browser `recoverCompactRegister(fields:CompactRegisterFields,context:CompactContext):Promise<RecoveredCompactRegister>`.
- `CompactContext` contains frozen scope, independently bound custodian ID if any, expected public trust and known public evidence.
- `RecoveredCompactRegister` contains transient key handle and checked public position/reference, never a reconstructed old history.
- `validatePaperCandidates(context:InitialSetupContext,prefix:"S"|"P",serials:readonly number[]):ValidatedInitialCandidates`; retain initial S wrapper.

- [ ] Add tests for two venues consuming S1/S2, original-object preservation, predecessor gaps/forks, duplicate IDs/names, lowered floors, scope/key mismatch and terminal-to-free refusal.
- [ ] Add browser/Node exact-vector tests for canonical three-field scope, both reference kinds (including text whose encoded length is 22), both node-key formats, and group counts.
- [ ] Add compact tests asserting the recovered public key equals the original; lengths are 22/43/6/6/16/8; omitted bound reference gives 79; custom IDs preserve exact text.
- [ ] Wrong scope/seed/check/alphabet/padding refuses before signing. Known lower floors or a recognised older head refuse, including equal floors with a known older head.
- [ ] Assert `nextS===43`, `nextP===8` for floors 42/7; all prior reserved entries are unusable. Checkpoint contains no fabricated original blocks/revisions/signatures.
- [ ] Unknown head with adequate floors still needs explicit human currentness; a matching tag is not proof. A later older full file cannot lower floors.
- [ ] Add four-base success and omitted/relabelled/duplicate-code refusals without editing existing fiscal assertions.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/register-history.test.ts src/custodian/register-compact.test.ts src/custodian/register-compact.browser.test.ts src/initial-paper-candidates.test.ts`; first observe missing/new behavioral failures.
- [ ] Implement pure canonical shapes, browser seed recovery/checks and Node public verification. Never send seed to Node. Refuse overflows/exhaustion; no inferred free names.
- [ ] Keep real validator checks at counters 1/9999999999, base 21/22 and invoice 60/61; rerun protocol/evidence/allocation-boundary suites unchanged.
- [ ] Commit with `git commit -s -m "feat: retain register history and conservative typed checkpoints"`.

## Task 2: Real PDF, printed blocks and Chrome file round trip

**Files:** create `fiscal/custodian/register-pdf.ts`, `register-reader.ts`, font asset, `register-pdf.browser.test.ts`; modify fiscal package/config/lockfile and notices.

**Interfaces:**

- `renderRegisterPdf(document:SecretRegisterDocument,locale:"en"|"es"):Promise<Uint8Array>`.
- `readRegisterPdf(bytes:Uint8Array):Promise<SecretRegisterDocument>`.
- `formatCompactRegister(document:SecretRegisterDocument):PrintedRegisterBlock|null`.
- `formatNodeRecoveryKey(key:NamedNodeKey,scope:RegisterScope):PrintedNodeKeyBlock`.
- Printed blocks expose checked fields, groupings and exact entered/displayed character counts.

- [ ] Add full, checkpoint, C-only and C-plus-paper attachment round trips; assert exact canonical bytes and every supplied original object.
- [ ] Verify paper tables, complete configured purposes, consumed/completion-unknown wording and C-only absence of invented paper keys.
- [ ] Render `Peña Λάδι` and unsupported emoji; inspect extracted text/raster: supported glyphs render, unsupported glyphs escape, attachment text remains exact.
- [ ] Keep actual installed-Chrome/wizard download/upload acceptance in Task 11 after Tasks 3/9 supply the picker and real wizard. This task’s independently passing deliverable is the real PDF/attachment/printed-block library; do not mark the later Chrome journey done here.
- [ ] Add a real harmless annotation/form change before PDF.js `saveDocument()`. Assert the resaved PDF SHA-256 differs and exact canonical attachment content survives. Test no-change save separately: it may return original bytes and is not changed-resave evidence.
- [ ] Library-reader controls reject corrupt/missing/repeated/conflicting attachments. Task 11 supplies the actual Chrome print/export-derived missing-attachment upload case after the wizard exists.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/custodian/register-pdf.browser.test.ts`; observe the named PDF/attachment/changed-resave/printed-code failures before implementation. Repeat this exact command after the minimal implementation; require counted passes.
- [ ] Implement PDFKit attachment/collection and local PDF.js worker. Do not parse visual text as history or upload PDF bytes to the host.
- [ ] Test extracted printed blocks through the real compact codec, including all 101/79/40/141/119 counts. This is automated data recovery, not physical typing acceptance.
- [ ] Rerun counted suites and setup build; inspect worker, notices, font hash and no remote fetches. Commit with `git commit -s -m "feat: round trip fiscal PDFs and print compact recovery blocks"`.

## Task 3: File/typed session, independent trust and currentness

**Files:** create `fiscal/custodian/register-key.ts`, `register-session.ts`, session browser tests; create `fiscal/setup/register-picker.ts` and browser/a11y tests; modify custodian exports/internal helpers.

**Interfaces:**

- `RegisterSession.select(document:SecretRegisterDocument):Promise<RegisterSummary>`.
- `RegisterSession.selectTyped(fields:CompactRegisterFields):Promise<RegisterSummary>`.
- `RegisterSession.create(scope:CustodyScope,recordkeeper:string,noExistingRegister:true):Promise<RegisterSummary>`.
- `RegisterSession.confirmCurrent(statement:RegisterCurrentStatement):void`.
- `RegisterSession.successor(events:readonly RegisterEvent[],nodeKeys:readonly NamedNodeKey[]):Promise<SecretRegisterDocument>`.
- `RegisterSession.dispose():void`.

- [ ] Add failures: file/seed selection cannot enrol trust, confirm currency, sign or activate. Wrong valid signer refuses before signing.
- [ ] Typed mode shows floors/burn consequence/history limits and derives full fingerprint for independent comparison; it does not create a replacement signer.
- [ ] Existing/enrolled/unknown custody cannot use first-register creation. Lost trust cannot bypass A732 or unlock retained data.
- [ ] Selection/edit/route change invalidates currentness, candidate review, receipt summary and delivery; known stale input refuses.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/custodian/register-session.browser.test.ts src/setup/register-picker.browser.test.ts`; observe named state/authority failures, then repeat after implementation and require counted passes.
- [ ] Implement memory-only handles and explicit original-file/typed choices. When complete evidence is available, keep every original byte/object; typed fields cannot downgrade it.
- [ ] A typed-only successor retains its signed checkpoint and complete future facts; printing it makes another usable compact block without pretending the gap disappeared.
- [ ] Test storage/network/log bodies for absence of seed, PKCS8 and PDF. Clear handles/references/URLs on Continue/close; no guaranteed erasure claim.
- [ ] Rerun browser/a11y suites, both themes. Commit with `git commit -s -m "feat: continue paper custody from a saved PDF or typed block"`.

## Task 4: Public evidence, consumed delivery and staged verifier

**Files:** create `server/first-fiscal-delivery.ts`, `first-setup-node-key.ts` and tests; modify evidence/host/API/activation and generic browser actions. Modify fiscal `allocation-paper-source.ts`, `allocation-preparation.ts`, `allocated-standby.ts`, `standby-allocation.ts`, `paper-evidence.ts` and checkpoint helpers/tests for fresh current-evidence admission; leave activation/numbering writers unchanged.

**Interfaces:**

- `stageInitialNodeKey(owner:FirstSetupOwnerAttempt,reconfirmation:string):Promise<{stage:StagedNodeKey,key:NamedNodeKey}>`.
- `registerFirstFiscalDelivery(owner:FirstSetupOwnerAttempt,input:DeliveryInput,hold:FirstSetupHold):Promise<void>`.
- `DeliveryInput` contains public history reference, exact input digest, document digest, register head or verified C receipt identity, and stage ID.
- `confirmFirstFiscalDocumentKept(owner:FirstSetupOwnerAttempt,input:{documentDigest:string,kept:true},reconfirmation:string,hold:FirstSetupHold):Promise<void>`.
- `installStagedNodeKey(db:Database,state:FirstSetupState,stage:StagedNodeKey):Promise<void>`.

- [ ] Fail activation before intent, checked public consumption, delivery binding or explicit kept confirmation. Print/download/resave success flags confer nothing.
- [ ] Fail wrong document/history/input/stage, stale owner/revision/generation, expired grant and concurrent/delayed submissions.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-delivery.test.ts src/first-setup-node-key.test.ts src/first-fiscal-evidence.test.ts`; observe the new grant/stage failures, then repeat after implementation and require counted passes.
- [ ] Stage named raw secret transiently over actual same-origin HTTPS/no-store. Durable stage holds verifier/name/frozen binding only.
- [ ] Retain bounded public history separately from existing 64-KiB grant/trust records. Transfer public revisions/objects in bounded chunks; validate/finalise the complete signed set before issuing a reference. Partial uploads grant nothing; never raise old parser/guard limits to admit secret PDFs.
- [ ] Complete and checkpoint evidence are independently verified by the module, with known floors/originals retained. A checkpoint never deletes stored evidence or grants replay of an old allocation.
- [ ] Add module-owned `assertPaperCheckpointAllows(checkpoint:VerifiedBurnCheckpoint,allocation:PaperAllocation,purpose:"new-activation"|"reserve"|"establish"|"promotion"):void`. `VerifiedBurnCheckpoint` is produced only after signature, independent trust, frozen scope and monotonic known-evidence verification; caller JSON cannot construct it. Check S/P identity against signed burn floors, not a claimed next-candidate number.
- [ ] Trace and wire every fresh paper-current-evidence consumer before changing admission: initial module preparation; `createPaperAllocationSource` for ordinary restore/re-registration and promotion; `createPaperStandbySource`, `createStandbyAllocationPreparation` and `verifyPaperReservation` for reserve/establish; the promotion preparation before unchanged `allocation.ts`. Retained signature-only historical verification remains historical and cannot itself grant new activation. Missing checkpoint data when a checkpoint/floor is known refuses; omitting it cannot bypass the floor.
- [ ] Observe direct RED cases through those real sources/preparations: signed checkpoint P42 plus a valid otherwise-current unused P40 reservation refuses `sif.allocation_invalid` (reservation no longer current), despite fresh owner confirmation; a newly reserved P43 succeeds. Repeat for initial S, restore/re-registration, standby reserve/establish and promotion. Include direct verifier and integration assertions, not only `nextP===43`. Publication-only finish of a genuinely checked committed event stays a separate zero-activation path, never a flag-based floor bypass.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/allocation-paper-source.test.ts src/allocation-preparation.test.ts src/standby-allocation.test.ts src/dormant-allocation.test.ts`; see expected floor-admission failures before adding that wiring, then counted passes. Keep all existing assertions and writers unchanged.
- [ ] Write intent before browser signing of outside consumption; bind resulting public evidence and PDF digest. Require owner confirmation that the successor was kept, then issue one-use boot/revision/generation/time-bound evidence.
- [ ] After exact fiscal commit, `installStagedNodeKey` owns one publication `withTransaction`: install only when verifier/name both absent; otherwise require exact equality; refuse partial/mismatch.
- [ ] State at the call site why installation follows the fiscal commit: the node does not exist before it. Crash recovery uses the same saved stage and fresh authority, never minting on retry.
- [ ] Same-visit Download/Print reuse exact Blob/key/stage. Assert no raw secret in DB/files/backups/logs/public evidence.
- [ ] Rerun interruption cases. Commit with `git commit -s -m "feat: bind kept recovery documents before fiscal publication"`.

## Task 5: Cloud preparation, original imports and capability limits

**Files:** create `fiscal/initial-cloud-setup.ts`, `register-cloud-export.ts` and tests; modify initial setup/cloud preparation/configuration; add server Cloud route tests and module/browser wiring.

**Interfaces:**

- `prepareInitialCloudSetup(context:InitialSetupContext,input:unknown,evidence:{trust:ReceiptTrust,current:unknown}):InitialSetupImport`.
- `createInitialCloudRequest(context:InitialSetupContext,venueId:string,operationId:string,incidentEvidence:string):CloudReserveInput`.
- `readInitialCloudPacket(packet:string,trust:ReceiptTrust,context:InitialSetupContext):InitialSetupImport`.
- Node `validateCloudDocumentEvidence(receipts:readonly unknown[],trust:ReceiptTrust,active:AllocationContext):CloudDocumentVerification`.
- `CloudDocumentVerification={activeReceiptId:string,receiptDigests:readonly string[]}`.
- `exportCloudPaperImports(history:RegisterHistory,cursor:CloudPaperImportCursor,venueBindings:ReadonlyMap<string,string>):readonly CloudPaperImportRequest[]`.

- [ ] Fail untrusted/reserved/abandoned/unknown/changed scope/operator/event/source/target/bases receipts; assert planned local admin is not inferred from Cloud actor.
- [ ] Public-only host action verifies all retained receipt signatures and active consumed context using independent trust. Browser binds summary to submitted receipt digests and invalidates it on edits.
- [ ] Browser never imports Node `cloud-evidence.ts`; no PDF/private key/seed/node secret in this action. Activation independently re-verifies through existing preparation.
- [ ] Run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-cloud-setup.test.ts src/register-cloud-export.test.ts`, then separately `pnpm --filter @waitron/server exec vitest run src/first-fiscal-cloud.route.test.ts src/cloud-fiscal-allocation-client.test.ts src/cloud-fiscal-allocation.test.ts`; observe named setup/evidence/export failures, repeat after implementation, require counted passes. No live service is implied.
- [ ] Add module-owned setup preparation, dispatching Cloud before the paper-only setup branch; preserve recovery/re-registration and callback-scoped authority.
- [ ] Export frozen public request file; open existing authenticated Cloud journey; import existing consumed manual packet. No cookies bypass/collection/forwarding.
- [ ] Preserve exact operation IDs/bodies; full session/CSRF/exact portal origin; reserve/consume lost replies reconcile via status. Unknown never activates.
- [ ] Add retired/different-binding verifier cases now. Full route retirement waits for Tasks 7–8 and is exercised in Task 9.
- [ ] Report checked commitment afterward through existing machine report signing/reconciliation, outside the transaction; no reserve/activate from report.
- [ ] Partition new max-100 candidate lists into original blocks **before signing**, ≤20 entries and ≤16,384 request bytes including signatures/facts/schema-maximum unknown bindings. Refuse indivisible oversized entries before reservation/signing.
- [ ] Export existing objects only at original block boundaries; never truncate/re-sign/rewrite signed recipients. Cloud import sequence/predecessor is distinct from PDF revision and uses prior exact import-request digest.
- [ ] Checkpoint-only history cannot synthesize earlier blocks or claim a complete import. Keep that transition unavailable until original evidence is supplied; preserve any authentic subsequent blocks without representing them as complete history.
- [ ] Preserve exact original-recipient gate: `first-setup:<attempt>` is not Cloud’s UUID venue. No `venueBindings` remap or transfer of consumed identity can repair it.
- [ ] Test compatible UUID originals and explicit unavailable state for first-setup originals; actual joint acceptance remains outstanding.
- [ ] Loopback tests retain exact protocol auth/refusal/lost-reply/report behavior; label **synthetic, unverified live**.
- [ ] Commit with `git commit -s -m "feat: prepare initial setup from verified consumed Cloud evidence"`.

Cloud stays unavailable by default without production custody/entitlement/continuity/signer/timing and first-operator admission. The portal lacks public-request file import; do not simulate it as shipped.

Lane D proposed work, no Cloud edits/new queue items: original-recipient admission without signature rewriting/freeing names; portal file import; production adapters; initial operator admission; restored namespace discovery; transfer/compromise policy.

Source receipts: product `initial-setup.ts:91–92`; Cloud `validation.ts:581`, `paper-import.ts:149–169`, registration `index.ts:199–204`. These are source reads, not joint runtime qualification.

## Task 6: Read-only inspection and password recovery

**Files:** provisioning resolution module/tests; server resolution-inspection module/tests; existing owner/host/recovery routes.

**Interfaces:**

- `FirstSetupRoots={anchorVenueDir:string,anchorStateDir:string}`.
- `inspectFirstSetupResolution(roots:FirstSetupRoots):Promise<FirstSetupInspection>`.
- `recoverFirstSetupOwner(request:{inspectionId:string,expectedRevision:number,clientClaimNonce:string,password:string}):Promise<RecoveredOwner>`.
- Inspection contains server-derived evidence digest, DB classification and allowed actions; abandoned recovery grants resolution authority only.

- [ ] Fail interrupted-pair inspection while ordinary readers/raw boot remain strict. Marker repair must leave state bytes identical before separate rebind.
- [ ] Fail wrong password, uncheckable verifier, racing/new-browser/lost-response/stale-proof cases; preserve frozen facts and invalidate old grants.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution-inspection.test.ts src/first-setup-owner.test.ts src/first-setup-recovery.route.test.ts`; observe named inspection/rebind failures, then repeat after implementation and require counted passes.
- [ ] Reuse preserved repair/recover primitives, derive outside DB transaction, use `inTurn` plus actual throttling, then reread under exclusion.
- [ ] Distinguish missing/corrupt/unreadable/partly migrated/unknown DB. Existence check precedes opener; inspection never creates/migrates/checkpoints.
- [ ] EMPTY requires complete preactivation provenance and existing successful unused reads; tenant/location absence alone is insufficient. Missing proof returns unknown, not new SQL.
- [ ] Rerun strict-reader positives/refusals. Commit with `git commit -s -m "feat: inspect and recover interrupted setup ownership"`.

## Task 7: Register answers, retirement and isolated workspace

**Files:** provisioning resolution/workspace modules/tests/exports; server resolution/workspace tests.

**Interfaces:**

- `RegisterAnswer={kind:"current-master",status:"Consumed"|"Not consumed"|"Unknown",custodian:string,reference:string,consultedAt:string}|{kind:"no-current-master",confirmed:true}`.
- `startAgainFirstSetup(request:{inspectionId:string,expectedRevision:number,register:RegisterAnswer,authority:ResolutionAuthority}):Promise<WorkspaceBinding>`.
- `resolveFirstSetupWorkspace(anchor:FirstSetupRoots):Promise<BootTarget>`.
- `assertFirstSetupBootTarget(target:BootTarget):Promise<void>`.


Carry forward the exact V2 records below. Source: preserved `cc553697b`, `docs/superpowers/plans/2026-10-15-a679-first-setup-repair.md`, “Proposed exports and durable records” and Tasks 3–4. Do not invent different anchor/backlink shapes in each entry path.

```ts
type WorkspaceBinding = {
  workspaceId: string; anchorVenueDir: string; anchorStateDir: string;
  venueDir: string; stateDir: string; resolutionId: string; selectionGeneration: number;
};
type ResolutionRecord = {
  version: 1; resolutionId: string; sequence: number; previousRecordDigest: string | null;
  attemptId: string | null; observedRevision: number | null; observedOwnerGeneration: number | null;
  evidenceDigest: string; evidenceReferences: string[];
  database: "empty-preactivation" | "missing" | "committed-exact" | "unknown-or-nonempty";
  authority: "original-password" | "local-empty-no-custodian";
  register: RegisterAnswer;
  action: "marker-repair" | "ownership-rebind" | "retire" | "select-workspace" | "finish-publication";
  phase: "prepared" | "applied"; nextWorkspace: WorkspaceBinding | null; recordedAt: string;
};
```

- [ ] Fail all three answers: consumed preserved; Not consumed never clears intent; Unknown leaves old identity unavailable. Typed position/check does not substitute for this answer.
- [ ] Fail password-free reset with enrolled/unknown custody, nonempty/unknown DB or incomplete provenance; retain eligible empty/no-master positive.
- [ ] Run `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-resolution.test.ts src/first-setup-workspace.test.ts`, then separately `pnpm --filter @waitron/server exec vitest run src/first-setup-workspace.test.ts`; observe named retirement/selection failures, repeat after implementation, require counted passes.
- [ ] Retain exact original files and ordered prepared/applied resolution records with sequence/predecessor/evidence/authority/register/selection bindings.
- [ ] Existing durable discipline: regular files/no symlinks, 0600/0700, fsync/rename/directory sync, bounded exact schemas, no secrets.
- [ ] Stage server-named `<anchorStateDir>/first-setup-workspaces/<id>/{state,venue}`. Retire before selection; no copied business data/settings/credentials.
- [ ] Require fixed `<anchorVenueDir>/first-setup-selection.json`, matching anchor-state witness, applied resolution record and target backlink binding both anchor roots, both target roots, resolution ID and selection generation. Disagreement/incomplete selection serves resolution only; no orphan selection/fallback.
- [ ] Old missing DB path stays missing. Eligible password-authorised new workspace gets fresh schema/IDs/password/assignment; lost-password existing-custody/business cases remain A732.
- [ ] Fault every write; restore old roots/state/DB, lose witnesses, substitute backlink/direct retired roots. Refuse before opening; include valid selected/ordinary venue positives.
- [ ] Rerun counted suites. Commit with `git commit -s -m "feat: retire setup attempts into isolated workspaces"`.

## Task 8: Exact finish and pre-open entry admission

**Files:** server entry/resolution API and boot tests; modify bin/node-entry/boot/recovery-surface/activation/mode; CLI and restore-command admission.

**Interfaces:**

- `finishFirstFiscalSetup(request:{owner:FirstSetupOwnerAttempt,inspectionId:string,publication:unknown},hold:FirstSetupHold):Promise<VenueResult>`.
- `publishCheckedFirstFiscal(host:FirstFiscalHost,deps:SetupDeps,state:FirstSetupState,checked:CheckedFirstFiscalCommit,publication:unknown,hold:FirstSetupHold):Promise<VenueResult>`.
- `CheckedFirstFiscalCommit=NonNullable<Awaited<ReturnType<typeof checkedFirstFiscalCommit>>>`.
- `startServerOrFirstSetupResolution(env:Record<string,string|undefined>):Promise<StartedServer>`.

- [ ] Fail commit-before-host-result/publication/unfinished-marker cases. Finish needs exact commit, fresh owner/outside evidence and matching stage; assert zero activation calls.
- [ ] Missing verifier installs only from saved bound stage after exact commit; existing verifier/name must match. Test crashes on both sides.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-interruption.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts`; observe named finish/pre-open failures, then repeat after implementation and require counted passes.
- [ ] Extract publication helper; finish cannot reach provision/activation. Typed checkpoints cannot recreate lost old consumption/commit binding and therefore cannot authorise guessed replay.
- [ ] Direct entry resolves before strict start; supervised before staged operations/ahead DB checks; already-recovery mounts same resolution service first.
- [ ] Raw boot/CLI/restore retain strict refusals and reject retired/mismatched targets pre-open; lock anchor then target and reread.
- [ ] Resolution listener exposes only resolution/status/public guidance; no provision/readiness/restore/adoption/trading or Retry bypass.
- [ ] Actual TLS socket/same-origin required for passwords/keys. HTTP public guidance only; missing/unusable TLS remains A733.
- [ ] Real processes cover every entry, omitted/conflicting roots, missing DB and interrupted selection; no premature mutations/trading.
- [ ] Rerun unaffected boot positives. Commit with `git commit -s -m "feat: finish exact setup publication behind pre-open admission"`.

## Task 9: Real file/typed wizard and resolution UI

**Files:** fiscal screen/picker/strings; setup client/session/API types/initial screen/shell; new resolution screen/strings/browser/a11y/unsaved tests; browser composition.

Remove normal offline-tool asset/build/download wiring and superseded non-fiscal tests. Add no scanner files/dependencies/routes.

- [ ] Fail real-app flows through venue/admin/certificate/email/readiness, original PDF or typed current paper, complete candidate review, consumption, Download/Print, kept confirmation and activation.
- [ ] Typed forms show exact count, frozen scope, derived full fingerprint, S/P burn ranges and incomplete-history limit. Seed/check/position changes invalidate prior checks.
- [ ] Add C unavailable/import/unknown states; after Tasks 7–8 test explicit retirement/fresh workspace/bindings before switching to paper. Delayed C refuses; possible local commitment must resolve first.
- [ ] Run `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts src/setup-app-first-fiscal.unsaved.test.ts src/screens/first-setup-resolution-screen.test.ts`; observe the new real-app flow failures, then repeat after implementation and require counted passes.
- [ ] Generic setup mounts module contributions; host interprets no prefixes/purposes/secret codec. Fiscal-none skips; readiness remains isolated.
- [ ] Same visit uses one cached PDF Blob/digest; Print/Download never auto-confirm kept. Resave/upload failure offers original file or typed route, never new signer.
- [ ] EN/ES fixed V2 wording: interrupted/recover/start again/finish/abandoned/password refusal/uncheckable. Unknown currentness remains Unknown.
- [ ] Show A731/A732/A733 unavailable explanations/prerequisites without enabled mutations, shell instructions or “incident handling” destination.
- [ ] Shared primitives/semantic names/required markers/field errors/bottom message; request refusal alone does not disable. `draftScopeFor`, applicable `saveActionState`, declared tokens.
- [ ] Test typed whitespace/case, wrong key/scope/check, stale selection, delayed replies, duplicate tabs/Web Locks, keyboard/focus and successful-write/failed-refresh.
- [ ] Keep raw typed material out of persisted drafts/session storage/logs; draft controller snapshots remain memory-only and clear on teardown.
- [ ] Inventory replaced non-fiscal tool/ceremony checks in `docs/operations/a679-changed-checks.md`; existing fiscal assertions stay unchanged.
- [ ] Run setup/fiscal browser/a11y, browser-registry tests, setup build and unchanged root seam/purity/native-field/token/cycle guards.
- [ ] Commit with `git commit -s -m "feat: offer saved-file and typed paper setup in the wizard"`.

## Task 10: Ordinary restore, matching printed key and reissue

**Files:** setup recovery allocation/copy/API; server recovery-document API/tests; ordinary archive/stream/managed/recovery-pack suites.

**Interfaces:**

- `selectRecoveryNodeKey(document:SecretRegisterDocument,preview:RecoveryBackupPreview):NamedNodeKey`.
- `readTypedNodeKey(fields:{nodeKeyFormat:"generated"|"utf8",secret:string,check:string},scope:RegisterScope,preview:RecoveryBackupPreview):NamedNodeKey`; the checksum always hashes the actual decoded secret, not its display encoding.
- `prepareRegisterRecovery(request:unknown,current:SecretRegisterDocument,confirmation:RegisterCurrentStatement):Promise<{publicOperation:unknown,successor:SecretRegisterDocument}>`.
- `reissueNodeRecoveryKey(authority:ReissueAuthority,request:{nodeId:string,currentPublicHistory:unknown,expectedKeyName:string|null}):Promise<NamedNodeKey>`.
- `reissueStagedNodeKey(owner:FirstSetupOwnerAttempt,request:{expectedStageId:string,expectedRevision:number,reconfirmation:string},hold:FirstSetupHold):Promise<{stage:StagedNodeKey,key:NamedNodeKey}>`.

- [ ] Fail archive recovery using older matching key PDF/printout plus current newer history/typed checkpoint; prior P remains unavailable, fresh P is required.
- [ ] Typed key check binds actual backup node/name/scope; wrong/missing secret cannot proceed with position alone. Actual recovery verifier remains authoritative.
- [ ] Add bucket/managed variants through existing real restore seats; preserve archive password/source/isolation/operator checks.
- [ ] Run `pnpm --filter @waitron/setup exec vitest run src/screens/recovery-allocation.test.ts src/screens/recovery-copy.a11y.test.ts`, then separately `pnpm --filter @waitron/server exec vitest run src/recovery-document-api.test.ts src/recovery-pack-api.test.ts`; observe named typed/key-reissue failures, repeat after implementation, require counted passes.
- [ ] Integrate original-file and typed blocks, yielding opaque public operation plus separate `nodeRecoverySecret`. Node secret goes only to appropriate authenticated HTTPS recovery request.
- [ ] C-only printed key does not reconstruct a C receipt; obtain original public packet/current authorised Cloud result. No invented S/P or synthetic C evidence.
- [ ] Reprint preserves supplied history/keys without allocation; never replace newer outside history with local snapshot or typed minimum.
- [ ] Reissue requires current route evidence and original-password unfinished authority or manager `system.manage`, rechecked before mutation.
- [ ] Positively preactivation reissue changes only saved stage, never DB writer; invalidates old delivery/kept/grants and requires new document confirmation. Existing spent name remains spent.
- [ ] Started/unknown activation must resolve commitment first. Exact committed node uses existing verifier writer; unresolved refuses.
- [ ] Committed reissue changes future-backup named verifier only; old backups still need retained old keys. Preserve custody signer; zero fiscal activation/Cloud reserve/consume.
- [ ] `/api/box/recovery-pack` retains manager permission, matching key, HTTPS/no-store; module payload public. Whole secret PDF/seed never enters it.
- [ ] Public operation import rejects PDF bytes/private envelopes/keys; dedicated reader/typed codec handles them locally.
- [ ] Rerun unchanged ordinary restore assertions. No A731/A732/A733 action is added.
- [ ] Commit with `git commit -s -m "feat: recover named backup keys from saved or printed documents"`.

## Task 11: Integrated acceptance and fourteen clash cases

**Files:** existing server first-fiscal e2e/launch/interruption/entry suites; new clashes e2e/download e2e; fiscal PDF/compact/session and setup real-app tests.

- [ ] First observe each new behavioral failure, then fix remaining integration. Real retained DB/public files, not an all-mocked mount, supply evidence.
- [ ] Real wizard publishes/restarts with distinct readiness/production identities and installed named verifier.
- [ ] Fault intent/signing/document retention/kept/grant/rollback/commit/verifier/publication boundaries; no duplicate activation or freed name.
- [ ] Run `pnpm --filter @waitron/server exec vitest run src/first-fiscal-setup.e2e.test.ts src/first-fiscal-clashes.e2e.test.ts src/first-fiscal-launch.test.ts src/first-fiscal-interruption.test.ts src/first-setup-resolution.boot.test.ts src/first-fiscal-document-download.e2e.test.ts`; observe each new integration failure before its fix, then repeat with counted passes and inspected DB/public-file facts. The download suite launches an isolated installed Chrome via Playwright `channel:"chrome"`, and closes only its own browser/context/server in guarded teardown.
- [ ] In that real wizard, await `page.waitForEvent("download")`, click its PDF action, call `download.saveAs(path)`, then select that exact file with the real picker’s `setInputFiles(path)`. Assert original PDF SHA-256 and canonical attachment equality, not a DOM success flag. Re-upload an actually changed annotation/form resave with a different PDF hash and unchanged attachment; include a no-change control. Finally print/export rendered pages through Chrome into a genuinely attachment-free PDF; its real upload must show the explicit original-file/typing refusal.
- [ ] Exercise print-only continuation using real PDF-extracted compact fields, independently typed through controls. Assert matching custody key, conservative burn and correct new allocation.
- [ ] Exercise print-only archive recovery with both register block and matching 40-character named-key block. Missing backup key refuses.
- [ ] EN/ES × light/dark ×390/1280: inspect real wizard/manual/reader/Cloud-unavailable/resolution captures, computed colors, keyboard and axe. Synthetic secrets only; no secret captures in retained receipts.
- [ ] Start dev via `wa-wt onboarding <registered-worktree-name>` only; distinguish dev/preproduction from production-shaped synthetic host.
- [ ] Prepare owner check: open actual PDF; upload original Chrome download; continue/recover from printed typed fields. No scan, ink, separate tool or old 44-step exercise.
- [ ] Commit with `git commit -s -m "test: qualify PDF file and typed fiscal recovery journeys"`.

| Appendix D row | Paper Waitron assertion | Cloud assertion / separate Cloud-owned probe |
| --- | --- | --- |
| a. Two fresh boxes | Full history gives S1/S2; typed floor burns prior range and gives next S. | Distinct signed C fixtures; real two-worker allocator remains Cloud continuity probe. |
| b. Stale backup/dead box | Current full/checkpoint evidence never reuses earlier P; matching old key is authentication only. | Fresh consumed C required; restored PostgreSQL continuity probe is Cloud-owned. |
| c. Old box returns | Replacement series distinct; isolation declaration required, not fencing. | Distinct replacement C plus existing membership refusals; no seller-fencing claim. |
| d. Interrupted retry | Spent remains spent; exact finish zero activation; checkpoint cannot fabricate missing replay facts. | Lost reserve/consume status retains binding; local commit checked separately. |
| e. Bucket rebuild | Real restore uses current P evidence and matching backup key. | Fresh verified C; unavailable authority refuses; actual journal rebuild is Cloud-owned. |
| f. Reissue | Key-stage/installed-key paths preserve fiscal state and all burn floors; zero activation. | Zero reserve/consume; actual journal event count needs Cloud probe. |
| g. Disk clone | Declared recovery gets fresh P; undeclared activated clone remains disclosed limit. | Declared fresh C; no global lock on already activated clone. |

Also test P42/C42 disjointness, older full uploads never lowering checkpoint/newer facts, and compatible Cloud imports never freeing omissions. First-setup recipient mismatch remains unavailable until Lane D’s joint original-object acceptance passes.

Other chain starts retain existing CLI/re-registration/standby/promotion/emergency/changed-base/exhausted-counter/emergency-to-short assertions, with Task 4’s additive floor-admission cases wherever fresh paper evidence is consulted. No new UI or automatic switch. Restart/reprint/reissue/report/filing retry/finish activate zero times.

## Task 12: Controls, protected checks, docs and branch gates

**Files:** current developer paper-custodian/offline-restore/workflow docs; operator first-live guide; changed-check inventory; backlog/detail. Historical docs get dated pointers.

- [ ] In an owned installed throwaway candidate checkout, run deletion controls serially; never swap feature-checkout files.
- [ ] Remove independently: predecessor/floor check; compact checksum/scope check; known-stale refusal; burn-range exclusion; attachment-required check; kept grant; owner generation; exact commit lookup; staged verifier; retirement admission; readiness isolation.
- [ ] Each must fail its intended behavioral assertion. Restore immediately and rerun positive before next control; retain command/candidate/diff/counts. Never mutate protected fiscal code/guards/assertions.
- [ ] Run unchanged allocation/boundary/operation/lifecycle/paper/Cloud/restore-committed/standby/dormant/recovery-key and golden amount/chain/verify/registro-sif/restore suites.
- [ ] Explicitly run `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts` and `pnpm --filter @waitron/fiscal test`; record counts.
- [ ] Compare protected paths/assertions/shipped SQL against base and current main: no edits. Run affected unchanged root/schema/module guards, package types/builds and normal focused-local/CI coverage split.
- [ ] Audit complete changed prose. Replace scanning/no-typing/tool procedures with original-PDF and typed-checkpoint behavior; retain theft/co-loss/currentness/backup/Cloud-import limits.
- [ ] Keep A679 backlog until actual build complete. Retain A731–A733 and Lane D dependencies without invented queue items.
- [ ] Finalise every changed non-fiscal check’s old/new assertion and decision receipt; no loose matcher/deletion.
- [ ] Obtain two installed Claude run-it whole-branch reviews through `~/workspace/tools/claude-seat.sh review-run <candidate-checkout> <brief-file> <report-file>`.
- [ ] Both inspect/run full candidate with new typing, lossless-vs-checkpoint, exact character counts, original-recipient Cloud gate, stage crash/reissue, V2 authority and protected checks. Read completed findings; triage/fix test-first.
- [ ] Old source/implementation reviews do not qualify new typing. Rebase alone does not require repeating completed whole-branch reviews; qualify substantive new changes.
- [ ] Commit docs with `git commit -s -m "docs: record saved-PDF and typed recovery qualification"`.
- [ ] Announce ready for `finish-branch`; run installed workflow, normal push hook, exact-head required CI and selected package coverage/merge jobs.
- [ ] End `needs-owner-review` until owner’s built-PDF/manual journey gate is met. Report original-file, resave, automated typing and actual owner print/typing results separately.
- [ ] No automatic land. Driver retains PR/branch for the owner gate; later landing follows its authorised H11/H12 workflow.

## Coverage and remaining gates

| Requirement | Tasks |
| --- | --- |
| S/P/C/E scope, bounds, complete purposes and no reused names | 1, 4–5, 10–11 |
| Lossless original PDF, explicit resave handling, local secrets | 2–4, 9–11 |
| Short printed seed/position/key and conservative checkpoint | 1–3, 9–11 |
| Independent trust/currentness and no invented original signatures | 1, 3–5, 8, 10 |
| Consume/keep before activation; exact interrupted finish | 4, 8–9, 11 |
| Existing Cloud protocol/capabilities/original-recipient limits | 5, 9–11 |
| V2 password/retirement/workspace/pre-open boot | 6–9 |
| Ordinary archive/bucket/managed restore and zero-activation reissue | 10–11 |
| Forms/ENES/themes/widths/keyboard/axe | 2–3, 9–11 |
| Protected assertions, two reviews, hook/current-head CI, owner gate | All; Task 12 |

The typing revision permits conservative continuation under the existing current-original/isolation assumptions. It does not promise lossless recovery of absent signatures or Cloud admission of a checkpoint. Fresh review and implementation evidence remain required before acceptance.
