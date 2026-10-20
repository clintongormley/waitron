# A679 One-PDF Implementation Plan — replacement, 2026-10-15 21:30 revision, amended at 22:15

> **Superseded naming and integration plan, 2026-10-16 at 14:50:** the owner approved
> [hour-coded series](../specs/2026-10-16-a679-hour-coded-series-design.md).
> Use the [replacement plan](2026-10-16-a679-hour-code-implementation.md), including its
> requalification of completed components. This file retains the register-based plan and its
> receipts as history; do not execute its Tasks 9–12. The owner now views generated EN/ES PDFs
> through Drive; automated entry of rendered keys belongs to the driver.

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:executing-plans` for INLINE execution, one task at a time. Read `superpowers:test-driven-development` before implementation or tests. Observe the intended RED before implementing. Do not delegate automatically or reopen settled owner requirements.

**Goal:** Complete first Live setup and ordinary recovery with one PDF, unsigned owner-declared paper history, and 20-character register continuation.

**Architecture:** The browser handles PDF bytes and reversible printed node-key encoding transiently. The host retains public history, frozen attempts, retirement evidence and key verifiers. A distinct owner-declared module admission branch feeds explicitly unsigned evidence into existing fiscal activation; Cloud receipts retain their signed protocol.

**Tech Stack:** TypeScript, Lit/shared controls, Hono, Web Crypto, existing durable JSON, Vitest, Playwright/installed Chrome. Proposed PDF dependencies remain PDFKit 0.20.2, PDF.js 6.4.299 and fontkit 2.0.4, subject to package/API qualification in Task 3.

**Spec:** `docs/superpowers/specs/2026-10-15-a679-two-route-redesign.md`, authoritative 21:30 revision as amended at 22:15.

## Authority and state

- Owner decision: `/Users/clintongormley/waitron-campaign-e/questions.md:4565–4569`.
- Owner amendment: `/Users/clintongormley/waitron-campaign-e/questions.md:4593–4595`; fours per typed field, no required paper-to-Cloud import, retained paper PDF and continued existing S/P register.
- V2 scope: the same file, `4374–4381`; exact authority boundary at `4311–4323`.
- Inherited allocation contract: Oct 4 design §9 and Oct 12 Cloud implementation plan.
- Product inspected at `aa6c1b957508570d60b3652c5c0ac79044556993`.
- Task ledger: `.superpowers/sdd/2026-10-15-a679-one-pdf-implementation/progress.md`.
- Cloud inspected at `54ec9f1714f661c3bdcb19020628003dfb94b58e`.
- Previous Task 1 and its receipts remain historical; revised active behavior needs fresh RED/GREEN evidence.
- The author read source only. No test, build, service, browser or physical operation ran.
- Driver applies and fresh-reviews the spec and this complete plan before product implementation.
- The owner’s explicit removal authorises unsigned admission work. Actual protected-writer or existing fiscal-assertion edits still need exact permission.
- One eventual whole A679 product PR revises Task 1 and completes dependent tasks.
- The old tool plan’s Task 9 remains incomplete; no historical acceptance is inherited.

## Global constraints

- Scope: taxpayer/software/fiscal-environment/prefix across venues, nodes and organisations.
- Preserve `S000001..S999999`, `P000001..P999999`, `C000001..C999999`; no zero, wrap or gap reuse.
- Preserve E plus 26 Crockford symbols/128 random bits, first suffix `0..7`, and existing emergency CRC protocol.
- Installation ≤27; base ≤21 using `[A-Za-z0-9/_.-]`; invoice ≤60; counter `1..9,999,999,999`.
- NIF nine canonical uppercase ASCII letters/digits; software ID two.
- Preserve the complete configured `{code,purpose}` set, multiple bases per purpose and `FF/full`.
- Cloud `test` maps to fiscal `preproduction`.
- No new paper signing key, paper signatures, hidden signer, seed/reference/head-tag typing or custody enrolment.
- Signed Cloud receipts, independent issuer trust and exact consumed-context checks remain.
- Outside consumption and explicit kept-document confirmation precede activation.
- Freeze IDs, scope, module versions, bases, operator, allocation and route; retirement precedes replacement.
- Burn floors and terminal states never fall; restored absence supplies no free-name authority.
- Full uploaded history stays lossless; checkpoint gaps remain explicit.
- Typed checks bind frozen context and catch accidental errors only.
- Generated node secrets retain 24 random bytes/192 bits and their exact existing verifier value.
- Raw keys/PDFs stay transient; appropriate authenticated HTTPS recovery delivery remains permitted.
- No PDF/raw-key host persistence, browser storage, logs, telemetry or retained real-secret captures.
- V2 strict readers, password rebind, retirement, workspace selection and publication-only finish remain.
- Any known/unknown existing register excludes the password-free no-master exception.
- A731/A732/A733 remain separate before-go-live work; no repair-page mutations for them here.
- Paper-to-Cloud import is not required and has no open build dependency. Joining Cloud retains the paper PDF; later paper allocations, including after leaving Cloud, continue the existing S/P register.
- Unsigned paper machine reporting remains unavailable unless separately decided; this plan authorises no new reporting implementation.
- No hash, numbering, registros, alta, `registerSif`, `restoreFiscal`, SQL or existing protected assertions change. **Owner amendment, 2026-10-16 13:40:** new read-only queries may establish the separate empty-database proof, with the scope and refusals recorded in the repair plan. No existing SQL or database write changes.
- The owner’s removal covers paper-signature admission semantics, not an exception to H2 or protected assertions.
- No scanner, QR, image decoding, camera, offline tool, PBKDF gate, ink or loss exercise.
- No sale-path network, automatic conflict switching, seller-fencing or missing-sales reconstruction.
- Signed commits, normal hooks, current-head CI, two required installed Claude reviews and owner physical acceptance.

## Review focus

| Input or failure | Expected behavior; owning task |
| --- | --- |
| Lowercase/aliases, separators, noncanonical padding or wrong key format | Normalise display only; reconstruct exact secret or refuse; Task 1. |
| Equal-floor old sheet versus genuinely current sheet | No invented head comparison; require declaration and retain known facts; Task 2. |
| Missing/edited/duplicate attachment or actually changed resave | Exact attachment round trip or explicit refusal; Tasks 3 and 11. |
| Unsigned JSON submitted without live owner/node authority | Cannot activate, reserve or establish; Tasks 0, 4 and 5. |
| Consumption followed by crash, key loss or retired delayed response | No freed identity, blind activation or silent rekey; Tasks 5–11. |

## Files and ownership

`fiscal/` means `packages/fiscal-verifactu/src/`; `server/` means `apps/server/src/`; `setup/` means `apps/setup/src/`.

| Files | Responsibility |
| --- | --- |
| New `fiscal/paper-register-protocol.ts`, `paper-register-compact.ts` | Version-2 public types, canonical bytes and typed display codec |
| New `fiscal/paper-register-history.ts` | Unsigned history replay, monotonic floors and original retention |
| Existing signed `register-protocol.ts`, `register-history.ts`, `custodian/register-compact.ts` | Historical libraries only; no active new-flow imports |
| New `fiscal/register-pdf.ts`, `register-reader.ts` | Browser PDF rendering and exact attachment reading |
| New `fiscal/register-session.ts`, `setup/register-picker.ts` | Memory-only selection, declarations and successor construction |
| New `fiscal/declared-paper-evidence.ts`, `declared-paper-preparation.ts` | Explicit unsigned evidence and callback-scoped admission |
| Existing module/setup/configuration/preparation files | Opaque routing and authority wiring |
| `fiscal/allocation-envelope.ts`, `standby-allocation.ts`, limited `allocation.ts` verifier branch | Explicit owner-declared admission only; no activation-writer edits |
| New `server/first-fiscal-delivery.ts`, `first-setup-node-key.ts` | Kept-document binding and verifier staging |
| Existing owner/evidence/activation/API files | Host ownership, grants, checked commitment and publication |
| New provisioning resolution/workspace files and server adapters | V2 inspection, retirement and entry selection |
| Existing recovery UI plus new `server/recovery-document-api.ts` | Ordinary restore selection and authorised reissue |
| New/affected sibling tests | Focused behavioral qualification without changing protected assertions |

New browser exports are explicit subpaths. Do not expose Node verifier modules to the browser.

## Shared contracts

Use exact-key parsers; all types below are new version-2 contracts unless explicitly retained.

```ts
type RegisterScope = {
  taxpayerNif: string; softwareId: string;
  environment: "preproduction" | "production";
};
type RegisterPosition = { sHighWater: number; pHighWater: number };
type RegisterHead = { registerId: string; revision: string; digest: string };
type NamedNodeKey = { nodeId: string; name: string; secret: string };
type PrintedPositionFields = { sPosition: string; pPosition: string; check: string };
type PrintedNodeFields = {
  encoding: "raw192" | "utf8"; value: string; check: string;
};
type PublicOriginal = {
  kind: "signed-paper" | "cloud-receipt" | "declared-paper-history";
  bytesBase64url: string; digest: string;
};
type CurrentStatement = {
  currentRegisterConfirmed: true; noParallelPaperAllocation: true;
  confirmedAt: string;
};
```

Canonical JSON recursively sorts object keys, preserves arrays and uses UTF-8 without Unicode normalisation.
Reject extra keys, nonfinite numbers, invalid timestamps and malformed/unbounded structures.
Full digests are lowercase SHA-256 hex; revision is a canonical decimal string with at most 20 digits.
Version-2 history is explicitly `integrity:"owner-declared"`; no `signature`, custody identity or custody version.
Historical signed objects remain opaque original bytes, separately labelled and verified only where needed.
A `declared-paper-history` original contains the exact canonical public-only history bytes and
its full digest. When a typed checkpoint replaces an active unsigned lineage, retain that entire
prior lineage as an original, alongside its already retained originals. Never copy the secret
PDF attachment or named node keys into this carrier. Do not splice displaced revisions into the
new checkpoint’s ancestry or treat their retention as complete missing history.
No version-1 secret-document conversion, data migration or automatic signer recovery is required pre-live.

A revision contains `{version:2,registerId,scope,revision,previousDigest,createdAt,sHighWater,pHighWater,events}`.
Complete genesis uses a zero predecessor; later revisions link the digest of canonical preceding revision bytes.
Reserve events contain the original validated `PaperAllocation`, recipient and reservation binding/time.
Consume events contain allocation ID, reservation digest, event/operator/source/target/incident and time.
Retire/abandon/uncertain events contain allocation ID, event ID, reason and time; none frees a name.
Use existing `OperationBinding` and person-or-recovery-key `OperationOperator` types.
A checkpoint contains `{version:2,kind:"declared-burn-checkpoint",checkpointId,scope,sHighWater,pHighWater,current:CurrentStatement,completeHistoryUnavailable:true,burnAllPrior:true,createdAt}`.
It has no source-head tag or fabricated predecessor. Its digest anchors subsequent revisions.
`DeclaredRegisterHistory` contains format/version/integrity/scope/register ID/mode/revisions/originals.
Checkpoint mode additionally contains that checkpoint; complete mode cannot contain a hidden evidence gap.
`KnownRegisterEvidence` contains known high-water marks, burn floors, full heads, public originals and retired bindings.
`RegisterProjection` returns those monotonic facts, occupied allocations, next S/P or null, completeness and `currentnessRequired:true`.
Version-2 `RegisterDocument` contains `{version:2,kind:"waitron-register-document",route,paper,cloudOriginals,nodeKeys}`.
`paper` is `DeclaredRegisterHistory|null`; paper route requires it, Cloud route permits null.
Node-key format is display metadata, never a replacement secret value.

## Task 0: Apply the owner revision and record the implementation boundary

**Files:** current spec/plan, historical dated pointers, backlog detail and campaign decision record.
**Output:** applied/fresh-reviewed documents and a traced boundary inventory; no product code.

- [ ] Apply the authoritative spec, replace this plan and add dated pointers to superseded Oct 4/12/A679 documents.
- [ ] Record the owner decision against every removed signer/reference/head-tag assumption and Task 1’s completed ledger entry.
- [ ] Retain historical source/test/visual receipts with their original qualification limits.
- [ ] Reconfirm the chain from `initial-setup.ts` through preparation, operation, envelope and actual activation.
- [ ] Record that removing signing is already owner-approved. Ask only for a concrete change to an H2-protected writer or existing protected fiscal assertion if one becomes necessary.
- [ ] Add a new `paper-declared` authority branch and tagged v2 evidence in implementation; old signed/Cloud/emergency branches remain strict.
- [ ] Trace admission sites: `allocation-envelope.ts:71–94,335–374`; `standby-allocation.ts:31–67`; `allocation.ts:238–282` for retained dormant evidence only.
- [ ] Preparation changes preserve an opaque live admission token by reference; JSON or a cloned token cannot create authority.
- [ ] Do not modify `allocation.ts:301–429` activation/replay writer, SQL statements, identities, hashes or protected assertions.
- [ ] Source reading suggests admission can change without editing the writer; verify that in Task 4. A discovered protected edit stops that dependent task, not independent codec/history work.
- [ ] Commit documentation through the driver’s authorised docs workflow with `git commit -s`.
- [ ] After publication resume Task 1 inline/TDD; keep all protected constraints in force.

## Task 1: Revise Task 1 with the unsigned typed codec

**Files:** new `fiscal/paper-register-protocol.ts`, `paper-register-compact.ts`, sibling Node/browser tests and new synthetic fixture; fiscal package exports.
**Interfaces:** `normaliseTypedCode(text:string):string`; `encodePosition(scope,position):Promise<PrintedPositionBlock>`; `decodePosition(fields,scope):Promise<RegisterPosition>`; `encodeNodeKey(key,scope,encoding):Promise<PrintedNodeBlock>`; `decodeNodeKey(fields,scope,nodeId,keyName):Promise<string>`.

- [ ] RED: encode floors 42/7; assert `0000 42`, `0000 07`, eight check symbols, data count 20/display count 23.
- [ ] RED: enter lowercase, `O/I/L` aliases, spaces/hyphens/tabs/newlines; expect identical decoded position/key.
- [ ] RED: position `0000 0A`, wrong scope/check, extra symbols and unsupported Unicode separators refuse.
- [ ] RED: generated secret round trips byte-for-byte through 39 payload symbols plus eight check symbols; counts 47/57 and combined 67/80.
- [ ] RED: raw192 final padding violations refuse; raw192 length must be exactly 39.
- [ ] RED: imported UTF-8 keys preserve case, hyphens, underscores, spaces and Unicode; for byte length n and m=ceil(8n/5), assert m+8 entered and m+floor((m−1)/4)+9 displayed; with the register, m+28 entered and m+floor((m−1)/4)+32 displayed.
- [ ] RED: explicit wrong encoding refuses; use equal-length cases so length-based inference would fail.
- [ ] RED: check scope/node/name/encoding/byte-length substitutions refuse before recovery use.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/paper-register-compact.test.ts src/paper-register-compact.browser.test.ts`.
- [ ] Expect the new named behavioral failures; retain the actual failing names/reasons.
- [ ] Implement the spec’s two check domains, both version 2, with identical browser/Node vectors.
- [ ] Implement byte-stream base32: right-pad zero bits; require `ceil(8n/5)===m` and zero unused bits.
- [ ] For general input infer byte length from canonical symbol count; reject impossible length residues and noncanonical re-encodings.
- [ ] For raw192 reconstruct canonical base64url from decoded bytes; never case-fold that secret.
- [ ] For UTF-8 decode fatally and preserve the exact supported text; no trimming or Unicode normalisation.
- [ ] Print per-field groups of four; format labels are clicks, not typed symbols.
- [ ] New active code imports no custody DER/seed/signing helper; leave historical signed codec assertions intact.
- [ ] Repeat the exact command; require counted GREEN with no skipped named cases.
- [ ] Commit: `git commit -s -m "feat: replace paper signer typing with checked positions and reversible keys"`.

## Task 2: Unsigned history, burn floors and complete candidates

**Files:** new `fiscal/paper-register-history.ts`, sibling tests; retain Task 1’s candidate validator and unchanged signed-history libraries.
**Interfaces:** `parseDeclaredHistory(value:unknown):DeclaredRegisterHistory`; `projectDeclaredHistory(history,known):RegisterProjection`; `assertPaperFloorAllows(projection,allocation,purpose):void`.
**Retained:** `validatePaperCandidates(context,prefix,serials):ValidatedInitialCandidates`.

- [ ] RED: two sequential venues consume S1 then S2; preserve complete bases, recipients, event bindings and original public bytes.
- [ ] RED: duplicate IDs/names, predecessor gaps/conflicts, decreasing positions and terminal-to-reserved transitions refuse.
- [ ] RED: typed 42/7 yields S43/P8 and excludes an otherwise valid unused P6.
- [ ] RED: known higher floor refuses typed lower input; equal-floor typed input remains declaration-dependent with no asserted head recognition.
- [ ] RED: full-file known older/forked heads refuse; an unrelated unseen newer sheet remains an explicitly untested human-currentness assumption.
- [ ] RED: later old-file evidence cannot lower checkpoint floors or remove newer originals.
- [ ] RED: full unsigned history → typed checkpoint → successor PDF retains every prior unsigned revision/event as exact public-only original bytes and digest, plus existing originals; burn floors remain permanent.
- [ ] Retain a displaced unsigned lineage as `declared-paper-history`, outside the checkpoint’s active ancestry; assert no node key or secret attachment bytes enter the public carrier.
- [ ] RED: absent historical consumption does not fabricate recipients, a previous head or Cloud receipts.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/paper-register-history.test.ts src/initial-paper-candidates.test.ts`.
- [ ] Observe each new behavioral RED, then implement exact v2 replay and original-byte retention.
- [ ] Store high-water marks separately from burn floors: a known reserved name is not reusable after a typed burn.
- [ ] Checkpoint mode remains checkpoint after later additions; complete input never discards available facts to fit typed minimum.
- [ ] Preserve 999999 exhaustion as null next candidate; reserve serial zero never succeeds.
- [ ] Preserve existing four-base/full-purpose and real-validator behavioral assertions.
- [ ] Repeat the command; require counted GREEN.
- [ ] Rerun unchanged signed history/protocol tests; this is historical support, not qualification of new unsigned authority.
- [ ] Commit: `git commit -s -m "feat: replay owner-declared paper history with permanent burn floors"`.

## Task 3: Actual PDF carrier and printed blocks

**Files:** new `fiscal/register-pdf.ts`, `register-reader.ts`, browser tests, copied Noto font/notices; package/config/lockfile.
**Interfaces:** `renderRegisterPdf(document:RegisterDocument,locale:"en"|"es"):Promise<Uint8Array>`; `readRegisterPdf(bytes):Promise<{document:RegisterDocument,attachmentBytes:Uint8Array}>`.

- [ ] RED: complete, checkpoint, C-only and C-plus-paper documents round trip the exact canonical attachment bytes.
- [ ] RED: a checkpoint successor round trip preserves the displaced unsigned public lineage byte-for-byte, without marking the new active history complete.
- [ ] RED: tables retain all configured bases, original receipts and named keys; no custody seed/reference/head-tag fields appear.
- [ ] RED: printed fields decode through Task 1 and give exactly 20/47/67 data characters.
- [ ] RED: missing, repeated/conflicting, corrupt and oversized attachments refuse without visual-text recovery.
- [ ] RED: annotation/form-changing resave has different PDF SHA-256 and identical attachment bytes; include no-change save control.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/register-pdf.browser.test.ts`.
- [ ] Observe named RED before adding the renderer/reader.
- [ ] Qualify PDFKit attachment bytes and PDF.js extraction/save APIs with installed pinned packages; do not call source reading proof.
- [ ] Use exactly one `waitron-register-v2.json`; cap attachment at 8 MiB and selected PDF at 64 MiB.
- [ ] Refuse limits without truncation; paginate one PDF rather than shortening history.
- [ ] Load worker/fonts locally; disable scripting/evaluation/remote resources; retain third-party notices.
- [ ] Test `Peña Λάδι` and unsupported emoji: supported glyphs render, unsupported glyphs visibly escape, attachment text remains unchanged.
- [ ] Render consumed/completion-unknown wording and the no-sales/backup distinction.
- [ ] Repeat the exact command; require counted GREEN and inspect real raster output.
- [ ] Actual installed-Chrome/wizard download and stripping-resave acceptance belongs to Task 11.
- [ ] Commit: `git commit -s -m "feat: embed unsigned register history and grouped recovery codes in one PDF"`.

## Task 4: Distinct unsigned admission through the module boundary

**Boundary:** Task 0’s traced admission scope; no protected-writer edits. **Files:** new declared-evidence/preparation tests/modules; existing `initial-setup.ts`, `allocation-configuration.ts`, `allocation-operation.ts`, preparation and generic setup seats; the traced envelope admission sites only.
**Interfaces:** `createDeclaredPaperPreparation(source:DeclaredEvidenceSource):ModuleOperationPreparation`; `withDeclaredPaperAdmission<T>(request:DeclaredAdmissionRequest,run:(token:object)=>Promise<T>):Promise<T>`; `validateDeclaredPaperEvidence(input:unknown,context:AllocationContext,replay:boolean):AllocationValidation`.
**Request:** authenticated operation, exact allocation/approval, projected public history, declaration, phase and kept-delivery reference.

- [ ] RED through actual preparation: unsigned tagged S/P succeeds only with a live owner/node-authorised source and exact consumed binding.
- [ ] RED: raw JSON `validated:true`, forged/copied/cloned/expired admission objects, changed binding or token use after callback refuses.
- [ ] RED: stripping signatures from old signed evidence still refuses; no fallback selects unsigned based on failed verification.
- [ ] RED: wrong taxpayer/environment/operator/source/target/full-purpose set refuses before the existing writer.
- [ ] RED: ordinary unbound or retired attempts cannot reach signed-file fallback.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declared-paper-preparation.test.ts src/initial-setup.test.ts src/allocation-operation.test.ts src/allocation-preparation.test.ts`.
- [ ] Observe behavioral RED; implement explicit `authority.kind:"paper-declared"` and `reservationEvidence.kind:"paper-declared-evidence",version:2`.
- [ ] New evidence contains checked reservation/consumption facts and exact digests; no empty, synthetic or locally generated signature field.
- [ ] Mint admission tokens only after independently reading host authority/public evidence; retain them in a private callback-scoped map.
- [ ] Preserve token reference in `snapshotAllocationEvidence`; clone public values, never serialise authority.
- [ ] Existing envelope common checks and all old signed/Cloud/emergency branches remain unchanged.
- [ ] Extend setup inspection/confirmation/committed reading by explicit format dispatch; do not reinterpret unsigned data as custody trust.
- [ ] Keep generic host evidence opaque. Add `bindEvidence(context,value:unknown):unknown` to the generic initial seat if needed; signed enrolment remains its legacy operation.
- [ ] `committed()` still compares exact retained allocation/approval/result and active series.
- [ ] Repeat the command; require counted GREEN, including unchanged protected assertions.
- [ ] Run unchanged `allocation-envelope.test.ts` and boundary suites separately; any required assertion edit stops for exact permission.
- [ ] Commit: `git commit -s -m "feat: admit explicitly declared paper evidence under live module authority"`.

## Task 5: All fresh consumers, delivery and staged verifier

**Files:** declared preparation/source modules; the traced standby and dormant admission verifier branches; new server delivery/node-key files/tests; host evidence/API/publication wiring.
**Interfaces:** `stageInitialNodeKey(owner,reconfirmation):Promise<{stage:StagedNodeKey,key:NamedNodeKey}>`; `registerFirstFiscalDelivery(owner,input,hold):Promise<void>`; `confirmFirstFiscalDocumentKept(owner,input,reconfirmation,hold):Promise<void>`; `installStagedNodeKey(db,state,stage):Promise<void>`.
**Delivery input:** public-history/input/document digests, stage ID and frozen operation identity.

- [ ] RED: activation before intent, consumed successor binding or explicit kept confirmation refuses.
- [ ] RED: stale owner/revision/generation, wrong stage/document/history, expired or duplicate grants refuse.
- [ ] RED through real consumers: initial S, restore/re-registration P, standby reserve/establish and promotion reject below-burn reservations.
- [ ] Include legacy signed P40 with known burn42 plus fresh confirmation: refuse; fresh P43 is the positive.
- [ ] Include omitted-checkpoint input when known floors exist: refusal remains.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/declared-paper-consumers.test.ts src/allocation-paper-source.test.ts src/standby-allocation.test.ts src/dormant-allocation.test.ts`.
- [ ] Separately run: `pnpm --filter @waitron/server exec vitest run src/first-fiscal-delivery.test.ts src/first-setup-node-key.test.ts src/first-fiscal-evidence.test.ts`.
- [ ] Observe each intended RED before wiring consumers or delivery.
- [ ] Trace initial, ordinary file preparation, bound sources, reserve/establish and promotion; floor checks apply before every fresh use.
- [ ] For explicit unsigned dormant evidence only, verify retained reservation digest/binding and fresh current consumption through the new admission.
- [ ] Keep old signed dormant verification strict; leave actual activation writer/SQL unchanged.
- [ ] Stage generated raw secret transiently; persist only verifier/name/stage/frozen binding, using existing durable discipline.
- [ ] Store public history in separately bounded chunks, finalised only after complete validation; do not inflate old grant-file limits.
- [ ] Record intent before successor creation; bind checked consumed public facts, exact PDF digest and explicit kept declaration.
- [ ] Install staged verifier after exact fiscal commit, before trading; absent pair installs once, existing pair must exactly match.
- [ ] Document why verifier installation follows commit; retry uses the same stage and fresh authority, never silent minting.
- [ ] Same-visit Download/Print reuse the same Blob/key/stage; events alone issue no grant.
- [ ] Repeat both commands separately; require counted GREEN and absence of raw keys/PDFs in persisted fixtures.
- [ ] Commit: `git commit -s -m "feat: enforce paper floors and kept-document binding across allocation consumers"`.

## Task 6: Signed Cloud setup and retained paper continuity

**Files:** new `fiscal/initial-cloud-setup.ts`, tests; existing Cloud preparation/configuration and server/client route tests.
**Interfaces:** `prepareInitialCloudSetup(context,input,evidence):InitialSetupImport`; `createInitialCloudRequest(context,venueId,operationId,incidentEvidence):CloudReserveInput`.

- [ ] RED: untrusted/reserved/abandoned/unknown or changed scope/operator/event/source/target/bases receipt refuses.
- [ ] RED: Cloud actor never substitutes for planned local administrator/recovery-key operator.
- [ ] RED: joining Cloud needs no paper-history import and retains the paper PDF; later paper allocations, including after leaving Cloud, continue its existing S/P register.
- [ ] Keep unsigned paper import and paper machine reporting unavailable; assert zero transport calls. No new import or reporting implementation is authorised.
- [ ] Run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/initial-cloud-setup.test.ts`.
- [ ] Separately run: `pnpm --filter @waitron/server exec vitest run src/first-fiscal-cloud.route.test.ts src/cloud-fiscal-allocation-client.test.ts src/cloud-fiscal-allocation.test.ts`.
- [ ] Observe RED; dispatch signed Cloud before paper setup preparation and support setup mode without loosening recovery checks.
- [ ] Keep public receipt verification on Node; browser structural reading grants no authority.
- [ ] Preserve exact operation/request through status/retry, full session, CSRF, origin and independently configured capabilities.
- [ ] Report C commitment afterward, outside activation/sale transaction, with existing machine authentication.
- [ ] Preserve signed receipt bytes and independent issuer trust; no paper key is generated for C-only documents.
- [ ] New unsigned imports/reports stay unavailable; propose no fake legacy packet or automatic Cloud signing upgrade.
- [ ] Signed C setup production adapters, first-operator admission, namespace discovery and genuine joint acceptance remain named dependencies; paper-history import is not one.
- [ ] Repeat both commands; label fixtures synthetic, not live enablement.
- [ ] Commit: `git commit -s -m "feat: verify signed Cloud setup and retain paper register continuity"`.

## Task 7: V2 inspection and ownership recovery

**Files:** new provisioning resolution module/tests; server inspection/resolution modules; owner/host/recovery routes and tests.
**Interfaces:** `inspectFirstSetupResolution(roots:FirstSetupRoots):Promise<FirstSetupInspection>`; `recoverFirstSetupOwner(request):Promise<RecoveredOwner>`.
**Request:** inspection ID, expected revision, fresh client nonce and original password; never client paths/classification.

- [ ] RED: inspect eligible claimed+claiming and abandoned+active pairs while ordinary readers/raw boot still refuse.
- [ ] RED: correct original password from a new browser rebinds; wrong/uncheckable password, stale snapshot and racing requests refuse appropriately.
- [ ] RED: repair preserves exact state bytes; rebind changes only proof/capability hashes, revision/generation and ownership history.
- [ ] Run: `pnpm --filter @waitron/server exec vitest run src/first-setup-resolution-inspection.test.ts src/first-setup-owner.test.ts src/first-setup-recovery.route.test.ts`.
- [ ] Observe RED; reuse password derivation outside transactions, `inTurn`, throttling and under-exclusion rereads.
- [ ] Existence check precedes database opener; inspection creates/migrates/checkpoints nothing.
- [ ] Preserve missing/corrupt/unreadable/partial/unknown classifications; exceptions never mean empty or no register.
- [ ] Eligible marker repair needs complete preactivation provenance and the separate positive database proof; read-only inspection is permitted by the owner amendment of 2026-10-16 13:40.
- [ ] Invalidate all old owner/evidence/delivery grants after rebind; abandoned remains abandoned.
- [ ] Repeat the command; require counted GREEN and strict-reader positives/refusals.
- [ ] Commit: `git commit -s -m "feat: inspect and recover unfinished setup ownership without weakening admission"`.

## Task 8: V2 retirement, workspace selection and publication-only finish

**Files:** provisioning resolution/workspace modules/tests; server resolution/entry/API files; bin/node-entry/boot/recovery and CLI/restore admission.
**Interfaces:** retain V2 `WorkspaceBinding` and both `RegisterAnswer` variants. **Owner, 2026-10-16:** `ResolutionRecord.register` may be null only for password-authorised marker-repair/ownership-rebind, meaning not consulted and granting no reset or fiscal authority; `startAgainFirstSetup(request):Promise<WorkspaceBinding>`; `resolveFirstSetupWorkspace(anchor):Promise<BootTarget>`; `assertFirstSetupBootTarget(target):Promise<void>`; `finishFirstFiscalSetup(request,hold):Promise<VenueResult>`.

- [ ] RED: Consumed stays spent; Not consumed never clears saved intent; Unknown leaves old assignment unavailable.
- [ ] RED: no signing key cannot satisfy no-master. **Owner, 2026-10-16:** add the unused-enrolled-PDF exception from the design inventory: password-free Start again needs positive never-activated and empty-database evidence, preserves the entire old attempt and burns its whole name block. Existing/unknown business data still refuses. This new exception is not yet implemented by the earlier no-master checks.
- [ ] RED: missing DB remains missing at the old path; known exact commit finishes publication with zero activation.
- [ ] RED: restore old roots/marker, lose either selection witness or substitute backlink; refuse before database open.
- [ ] Run: `pnpm --filter @waitron/provisioning exec vitest run src/first-setup-resolution.test.ts src/first-setup-workspace.test.ts`.
- [ ] Separately run: `pnpm --filter @waitron/server exec vitest run src/first-setup-workspace.test.ts src/first-setup-entry.test.ts src/first-setup-resolution.boot.test.ts src/first-fiscal-interruption.test.ts`.
- [ ] Observe RED; preserve original remnants and ordered prepared/applied records with predecessor/evidence digests.
- [ ] `RegisterAnswer.custodian` records the consulted recordkeeper/owner, not invented key trust; derive typed reference from its public checkpoint digest.
- [ ] No extra custody reference is typed; resolution’s answer remains separate from position checking.
- [ ] Stage server-named `<anchorStateDir>/first-setup-workspaces/<id>/{state,venue}`; retire before selecting.
- [ ] Require fixed venue selection, matching anchor-state witness, applied resolution and target backlink binding both roots/generation.
- [ ] Never copy business data/settings/credentials or fall back to retired roots.
- [ ] Preserve 0600/0700, regular-file/no-symlink, sync/rename/directory-sync discipline; fault each durable boundary.
- [ ] Extract `publishCheckedFirstFiscal(host,deps,state,checked,publication,hold)`; finish cannot call activation/provision.
- [ ] Require original-password ownership, fresh outside evidence, exact checked commit and matching stage/publication bindings.
- [ ] Direct entry resolves before strict start; supervised before staged/ahead opens; already-recovery mounts the same service first.
- [ ] Raw boot/CLI/restore reject retired targets before opening; lock anchor then target and reread.
- [ ] Unresolved listener exposes resolution/status/public guidance only; Retry cannot bypass it.
- [ ] HTTP collects no secrets; missing TLS remains A733. Lost-password existing/possible business data remains unavailable A732.
- [ ] Repeat both commands; require counted GREEN and normal unaffected boot positives.
- [ ] Commit: `git commit -s -m "feat: retain setup retirement and finish exact publication before boot"`.

## Task 9: Real wizard, typed forms and resolution interface

**Files:** fiscal screen/picker/session/strings and browser tests; setup client/session/API/shell/initial/resolution screens; browser composition.
**Interfaces:** `RegisterSession.selectFile(bytes)`, `selectTyped(fields)`, `createFirst(scope,noExistingRegister:true)`, `confirmCurrent(statement)`, `successor(events,nodeKeys)`, `dispose()`.

- [ ] RED through real setup app: venue/admin/certificate/email/readiness → file/typed selection → review → consumed PDF → kept confirmation → activation.
- [ ] RED: selecting/editing code, file, route or scope invalidates declarations, review, delivery and grants.
- [ ] RED: first-register creation refuses existing/unknown register evidence; no file selection establishes ownership/reset authority.
- [ ] RED: Cloud unknown/retired delayed response cannot activate; possible local commitment must resolve before route replacement.
- [ ] Run: `pnpm --filter @waitron/setup exec vitest run src/setup-app-first-fiscal.test.ts src/setup-app-first-fiscal.unsaved.test.ts src/screens/first-setup-resolution-screen.test.ts`.
- [ ] Separately run: `pnpm --filter @waitron/fiscal-verifactu exec vitest run --project browser src/setup/register-picker.browser.test.ts src/register-session.browser.test.ts`.
- [ ] Observe RED; implement module-owned fiscal UI with generic opaque host actions.
- [ ] Show frozen taxpayer/software/environment and backup node/key name; no extra identifier typing.
- [ ] Show S/P ranges, 20/47/67 entered and 23/57/80 displayed counts, history gap, typo-only check and equal-floor/unseen-stale limits.
- [ ] Use shared inputs/required markers/semantic names, per-field errors and one bottom message.
- [ ] Preserve caret on normalisation; passive reads, draft scopes and applicable save state follow existing contracts.
- [ ] Typed material/drafts/Blob URLs stay memory-only; disposal clears references without promising physical memory erasure.
- [ ] Download/Print reuse one Blob; attachment failure offers original file or typing.
- [ ] Retain fixed EN/ES V2 wording and disabled A731/A732/A733 explanations, without terminal/reset substitutes.
- [ ] Remove normal tool/download/seed/fingerprint/scan UI wiring; old signed libraries receive no new active path.
- [ ] Inventory replaced non-protected checks in `docs/operations/a679-changed-checks.md`; never loosen existing fiscal matchers.
- [ ] Repeat both commands; run affected a11y/unsaved tests, setup build and unchanged seam/native-field/token/cycle guards.
- [ ] Commit: `git commit -s -m "feat: offer original PDF and grouped paper typing through the real wizard"`.

## Task 10: Ordinary restore, exact backup key and zero-activation reissue

**Files:** setup recovery allocation/copy/API tests; server recovery-document API/tests and existing archive/bucket/managed recovery suites.
**Interfaces:** `selectRecoveryNodeKey(document,preview):NamedNodeKey`; `prepareRegisterRecovery(request,current,confirmation):Promise<{publicOperation:unknown,successor:RegisterDocument}>`; `reissueNodeRecoveryKey(authority,request):Promise<NamedNodeKey>`; `reissueStagedNodeKey(owner,request,hold):Promise<{stage:StagedNodeKey,key:NamedNodeKey}>`.

- [ ] RED: older key document plus newer current register restores the matching backup with fresh P; old consumed P remains unavailable.
- [ ] RED: typed key decodes to the exact verifier value; wrong/missing key, wrong backup node/name or checksum refuses.
- [ ] RED: C-only typed node key cannot invent a consumed C receipt.
- [ ] RED: reprint/reissue makes zero fiscal activation and zero Cloud reserve/consume calls.
- [ ] Run: `pnpm --filter @waitron/setup exec vitest run src/screens/recovery-allocation.test.ts src/screens/recovery-copy.a11y.test.ts`.
- [ ] Separately run: `pnpm --filter @waitron/server exec vitest run src/recovery-document-api.test.ts src/recovery-pack-api.test.ts`.
- [ ] Observe RED; integrate file/typed input into existing archive/bucket/managed restore seats.
- [ ] Send public operation separately from `nodeRecoverySecret`; actual existing backup verifier remains authoritative.
- [ ] Preserve archive password, source, operator and isolation checks; no repair-page A731 action.
- [ ] Reissue needs fresh original-password unfinished authority or manager `system.manage`; recheck immediately before mutation.
- [ ] Precommit reissue changes stage only, invalidates kept/delivery/grants and retains all spent names.
- [ ] Started/uncertain activation first resolves exact commitment; never silently mint another stage.
- [ ] Committed reissue changes only future-backup named verifier; retain old keys for old backups.
- [ ] Recovery-pack/public importer retain permission, matching-key, HTTPS/no-store and secret-rejection checks.
- [ ] Repeat commands and unchanged ordinary restore assertions; stop on any protected dependency outside Task 0’s boundary.
- [ ] Commit: `git commit -s -m "feat: recover exact named backup keys from saved and printed registers"`.

## Task 11: Installed Chrome, fault recovery and clash acceptance

**Files:** new server `first-fiscal-document-download.e2e.test.ts`, `first-fiscal-clashes.e2e.test.ts`; existing setup/launch/interruption/entry e2e suites.
**Interfaces:** real host, real wizard, retained database/public files; installed Chrome owned by the fixture.

- [ ] RED: actual wizard download/re-upload retains exact PDF hash and attachment bytes.
- [ ] Await Chrome `download`, save its exact file, then use real picker `setInputFiles`; do not substitute renderer bytes.
- [ ] RED: actually changed annotation/form resave has different PDF hash, identical attachment; no-change control remains separate.
- [ ] RED: Chrome print/export of rendered pages yields attachment-free file; real upload shows original-file/typing refusal.
- [ ] RED: printed R2 fields typed through real controls produce S43/P8; K2 yields exact backup secret and successful authenticated recovery.
- [ ] Run: `pnpm --filter @waitron/server exec vitest run src/first-fiscal-document-download.e2e.test.ts src/first-fiscal-clashes.e2e.test.ts src/first-fiscal-setup.e2e.test.ts src/first-fiscal-launch.test.ts src/first-fiscal-interruption.test.ts src/first-setup-resolution.boot.test.ts`.
- [ ] Observe named RED; fix only missing integration, then repeat with counted GREEN.
- [ ] Use Playwright `channel:"chrome"`; allocate ports together, retain owned PIDs and guard teardown.
- [ ] Fault intent/document/kept/grant/rollback/commit/verifier/publication; inspect actual records, not only success flags.
- [ ] Qualify fourteen comparisons: paper/Cloud × fresh boxes, stale backup, old box return, interruption, bucket rebuild, reissue and declared clone.
- [ ] Paper assertions cover next names, burned unused reservations, retained originals and no second activation.
- [ ] Cloud fixtures cover exact signed receipts, lost replies and independent local commitment; genuine outside allocator/continuity probes stay Cloud-owned.
- [ ] Include P42/C42 disjointness, retained paper PDF across Cloud subscription changes, continued existing S/P positions, old uploads after checkpoints, missing matching key and zero unsigned paper import/report calls.
- [ ] No ordinary restart/reprint/reissue/report/filing retry/finish activates a chain.
- [ ] Inspect EN/ES × light/dark ×390/1280 actual screens/PDFs; axe, keyboard, focus, inner controls and computed theme colors.
- [ ] Use synthetic secrets only in retained captures; dev stack uses `wa-wt onboarding <registered-worktree-name>`.
- [ ] Prepare owner acceptance: open actual PDF, upload Chrome original, physically type register and matching recovery-key blocks.
- [ ] Record automated extraction/typing separately from owner physical typing; leave owner gate open until actually performed.
- [ ] Commit: `git commit -s -m "test: qualify original PDF and unsigned printed recovery journeys"`.

## Task 12: Controls, complete prose audit and branch gates

**Files:** current operator/developer procedures, backlog/detail, changed-check inventory and dated historical pointers; no protected test edits.

- [ ] In an owned installed throwaway candidate checkout, run serial deletion controls only on permitted new code.
- [ ] Controls: scope/check, canonical padding, floor admission, attachment-required, currentness declaration, kept grant, owner generation, exact commit, staged verifier and retirement admission.
- [ ] Each removal must fail its intended behavioral assertion; restore and run its positive before the next.
- [ ] Re-run unchanged protected suites: `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/write-path.e2e.test.ts src/inmutabilidad.test.ts`.
- [ ] Run unchanged `pnpm --filter @waitron/fiscal test` and affected boundary/operation/lifecycle/Cloud/restore/standby suites.
- [ ] Compare protected paths against base/current main and Task 0’s boundary inventory; every other protected byte/assertion stays unchanged.
- [ ] Audit the whole changed prose set, including READMEs/runbooks: no active seed/signature/head-tag/101/40-count or forged-sheet promises remain.
- [ ] Historical docs receive dated pointers; old review/test receipts never qualify this revision.
- [ ] Record A732’s now-unavailable signer mechanism, the removed paper-to-Cloud import requirement and unavailable paper machine reporting; create no new dependency or queue item.
- [ ] Keep A679 open until build acceptance; preserve A731/A732/A733 before-go-live requirements.
- [ ] Run affected types/builds and focused checks; normal hook once, required current-head CI coverage/merge jobs.
- [ ] Obtain the campaign’s two installed Claude run-it reviews on the complete candidate; inspect completed findings and fix test-first.
- [ ] Reviews cover unsigned authority, every consumer, exact counts, original-byte retention, Cloud limits, V2 and protected boundaries.
- [ ] Commit documentation with `git commit -s`; announce ready for `finish-branch`, or continue it when already authorised.
- [ ] Report exact-head CI and acceptance results separately. Do not claim runtime evidence from reading.
- [ ] End `needs-owner-review` while built-PDF/physical-typing acceptance or an actual protected-change permission remains outstanding.
- [ ] Do not publish/merge automatically from this plan.

## Coverage map and execution status

| Requirement | Tasks |
| --- | --- |
| Owner removal of paper signer and revision of built Task 1 | 0–2, 4, 9, 12 |
| Exact 20/47/67 codes, grouping and reversible secret | 1, 3, 9–11 |
| Lossless full history versus burned checkpoint | 2–6, 10–11 |
| Consumption/retention before unchanged activation writer | 4–5, 8–11 |
| Signed C receipts, retained paper continuity and unavailable paper reporting | 6, 9–12 |
| Every fresh consumer and dormant promotion | 4–5, 11–12 |
| V2 authority, retirement, pre-open entry and exact finish | 7–9, 11 |
| Matching backup key and separate old/new secrets | 1, 5, 10–11 |
| Real Chrome/resave/attachment refusal and owner typing | 3, 11 |
| Protected checks, reviews, hook, CI and honest claims | 0, 12 |

After driver application, fresh review and docs publication, resume revised Task 1 inline/TDD. A732’s replacement authority remains separately owned. Paper-to-Cloud import is not required and is not a build dependency. Paper machine reporting remains unavailable unless separately decided. No new permission gate or task is introduced.
