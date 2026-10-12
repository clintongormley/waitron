# Cloud fiscal allocation registry Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for future inline implementation, task by task. Read `superpowers:test-driven-development` before writing implementation or tests. Steps use checkboxes. This authorised handoff starts no Cloud code. Proposed adapters remain subject to the owner enablement gates below.

**Goal:** Give subscribers an optional outside register for fresh fiscal identities, with a phone receipt that an offline Waitron node can validate through its recovery flow.
**Architecture:** Cloud owns a new fiscal-allocation domain package, PostgreSQL audit/projection tables and account HTTP/portal adapters. An independently current continuity authority owns permanent name claims and writer fencing; PostgreSQL alone cannot recover permission to allocate. Waitron keeps local authentication, atomic activation and reconciliation behind opaque module interfaces.
**Tech Stack:** Cloud Node 26, TypeScript, pnpm 9.15, `pg`/PostgreSQL 18, Hono, Node test runner, Lit and Playwright; Waitron SQLite, module seats and Vitest.
**Spec:** [Approved design §9](../specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md) and [approved plan, Separate Cloud workstream](2026-10-04-fiscal-prevention-and-offline-recovery.md#separate-cloud-workstream-subscription-allocation-registry).

## Scope and read-only provenance

This is a repository plan, not an implementation or deployment receipt. All sources below were read only; no application, test, migration, provider or fiscal experiment ran here. Paths prefixed `Cloud:` belong to `/Users/clintongormley/workspace/repos/waitron-cloud`; `Parked:` belongs to `/Users/clintongormley/workspace/worktrees/waitron-feat-w41s-atomic-allocation`. Other product paths belong to Waitron.

| Source | Literal revision / file and line | What you may inherit |
| --- | --- | --- |
| W0 | Waitron base `a01580e12830369f2ae346ca32ef29347b21b8e4`; approved W41s-0 `2ba1391148da8319526effad061f926ea6a06bfd`; W41s-3d landed `5e99c6781df6512f6bac4127937f0146e61e2ecc` | Bases supplied by the runner; `git rev-parse HEAD` returned the stated Waitron base. W41s-3d is filing-brake work, not a registry API. |
| W1 | Design `docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md:345`; original plan `docs/superpowers/plans/2026-10-04-fiscal-prevention-and-offline-recovery.md:414` | Approved allocation contract and three separately owned deliverables. The appendix's old “review pending” heading does not supersede the recorded approval. |
| W2 | Parked `db58b74aec534c3a7bc0d5aae18c9a18677a1097`: `packages/fiscal-verifactu/src/allocation-envelope.ts:12`, `:25`, `:52`, `:307`; `paper-evidence.ts:11`, `:23`, `:33`, `:80`, `:450`, `:709` | Unlanded allocation/approval types, envelope validation and signed paper interfaces. Cloud evidence is currently refused by that envelope. |
| W3 | Same parked SHA: `packages/module/src/operation-input.ts:9`; `operation-authority.ts:1`, `:20`; `restore.ts:22`; `packages/fiscal-verifactu/src/allocation.ts:127`, `:137` | Unlanded opaque operation input, transient host-issued authority and activation signatures. No Cloud login replaces local operator authentication. |
| W4 | Same parked SHA: `packages/fiscal-verifactu/src/allocation-identity.ts:1`, `:45`; `allocation-boundaries.test.ts:23`; `docs/superpowers/plans/2026-10-12-w41s4-break-glass-operator-decision.md:1` | Full purpose set and validator fixture shape; recovery-key operator choice remains a dependency. Discovery `rg --files` filtered for `allocation-types`, `operation-input`, `operation-authority` found no `allocation-types.ts`; concrete types are in `allocation-envelope.ts`. |
| W5 | Waitron base: `apps/server/src/cloud-client.ts:28`, `:57`, `:81`; `packages/module/src/provisioning.ts:29` | Existing Cloud connection identifiers/origin and opaque module state; neither is fiscal allocation authority. |
| C0 | Cloud base `65c13f1402041931bdb244007f3cbc267ae61483`, returned by `git rev-parse HEAD` | Cloud baseline for this map. Re-read the eventual build head. |
| C1 | Cloud: `packages/registration/README.md:15`, `:182`, `:238`; `src/transaction.ts:3`; `src/migrate.ts:6`; `migrations/001_registration.sql:1`, `003_signup.sql:5` | Transaction helper, hashed migration manifest, organisation owner membership and existing three service setup states. |
| C2 | Cloud: `packages/identity/src/sessions.ts:80`; `packages/registration/src/installations.ts:62`, `:142`; `src/support-grants.ts:66` | Full session/CSRF validation, account-before-session locks, current ownership and under-lock machine rechecks. |
| C3 | Cloud: `packages/account-http/src/app.ts:65`, `:123`; `request.ts:2`; `rate-limit.ts:6`; `recovery.ts:12`; `usage.ts:10` | Host/origin/security headers, bounded JSON, shared PostgreSQL rate limits and passive preliminary session lookup followed by domain authorization. |
| C4 | Cloud: `apps/portal/src/recovery-{types,controller,screen}.ts:1`; `api.ts:11`, `:44`; `app.ts:59`; `screens.ts:31`; `links.ts:3`; `packages/account-http/src/portal.ts:18` | Exact wire validators, uncertain-result reconciliation, route/account generation fences, CSRF client and separately served document routes. |
| C5 | Cloud: `docs/product-and-platform.md:645`; `packages/registration/README.md:194`; `docs/waitron-integration-contract.md:71`, `:87`; `docs/database-recovery.md:41`, `:63`, `:96` | Subscription state is future work; metering is not billing. Restore grants do not activate trading. Physical recovery can omit later writes and does not supply external keys. |
| C6 | Cloud: `package.json:11`; `scripts/test-postgres.mjs:55`; `packages/registration/test/registration.test.ts:43`; `apps/portal/test/fixtures.ts:25`; `.github/workflows/ci.yml:61`; `migrations/025_usage_metering.sql:36` | Disposable PostgreSQL command wrapper, two-pool/concurrent migration pattern, real HTTP/browser fixture, explicit CI package matrix and immutable-event trigger pattern. |
| D55 | Read-only `cloud-feat-cloud-authenticator-factor` at `7040c80ba1f2504d4bdfde206761f963a4e756ab`: `packages/registration/src/password-login.ts:9`, `:86`; `migrations/035_authenticator_factor.sql:28` | Pending factor challenge is not a full session. Migration 035 and D55's plan paths are reserved; consume its landed authentication boundary later. |
| Queue | `/Users/clintongormley/waitron-campaign-e/RUNNER.md:31`, `:124`; E `queue.md:355`, `:420`; D `/Users/clintongormley/waitron-campaign-d/queue.md:273` | High-effort bounded planning, parked local work and blocked Cloud placeholders. These are scheduling inputs, not files this handoff changes. |

## Global constraints

- Scope uniqueness by `(taxpayerNif, softwareId, fiscalEnvironment, prefix)` across every venue, node, legal business and organisation for that taxpayer. Organisation membership controls visibility, never creates another namespace.
- Preserve `S000001..S999999`, `P000001..P999999`, `C000001..C999999`; zero and exhaustion refuse. Cloud generates only `C`; import custodian-issued `S/P` history without minting it. Preserve emergency `E` plus 26 Crockford characters, 128 unbiased OS-random bits, and first symbol `0–7`, as the owner approved on 2026-10-12 at 10:25. This supersedes §9.1's older `0–3` text; the recorded correction also appears in `docs/backlog.md` under W41s.
- Emergency display checksum remains four uppercase hex digits of CRC-16/CCITT-FALSE over the 27 ASCII identity bytes, outside the filed identity. It catches transcription mistakes, not forgery or collision; this handoff adds no emergency generator.
- Installation identity maximum 27; base maximum 21 using `[A-Za-z0-9/_.-]`; invoice maximum 60 with counter `1..9,999,999,999`. Software ID is two uppercase ASCII letters/digits; NIF is the contract's canonical nine uppercase letters/digits. Format acceptance is not verified taxpayer custody.
- Freeze the complete configured `{code,purpose}` set. Preserve `standard`, `full`, `rectificative`, including multiple bases of a purpose. `FF` remains `full` where configured: §9's old `FF (standard)` example is not permission to relabel production full invoices.
- Cloud registration `test` maps explicitly to fiscal `preproduction`, and `production` to `production`; reject other or inconsistent values. Do not alter existing Cloud registration wire values.
- Consume outside authority before local activation. Bind allocation, exact identity set, source ID, target node, event and operator. Never release reserved names after abandonment, consumption, uncertain activation or subscription end.
- A receipt authorizes use of identities only through local recovery checks. It does not fence the old selling machine, repair missing invoices, establish legality or prove production operation. No network request may be added to a sale transaction.
- This handoff adds no automatic conflict switch. §9.3 still requires an authenticated unexpired outside sole-selling grant, previous-seller fencing acknowledgement and durable independent allocation/switch history, with at most one automatic switch in rolling 24 hours. A backward clock or missing history never clears that gate; otherwise use administrator recovery.
- Paper's current master remains outside venue backups, with one named custodian/writable original. Imports only add facts or advance state; omissions and stale uploads never free names. Transfer is a signed custodian operation before use.
- Retain receipts/history after subscription ends; deny new reservations under the configured entitlement policy. Receipt inspection/export still requires current authorised access. Do not assume a hosted venue or managed backup subscription.
- No recovery keys, login tokens, private signing keys or provider credentials in allocation exports, incident records, browser receipts or logs. Signed public evidence is distinct from the secret-bearing recovery kit.
- No guard, assertion, fiscal golden data, coverage/mutation bar or shipped SQL is weakened. Future commits use `git commit -s` and normal repository gates. No Cloud build starts until the watcher schedules a Cloud-scoped card.

## Review focus

1. Two organisations naming the same taxpayer must receive distinct names while neither can inspect the other's venue history (Task 3).
2. Ownership/session expiry during a lock or continuity wait must prevent receipt disclosure; a durable name already claimed stays burned (Tasks 3–4).
3. An old PostgreSQL backup missing new names must refuse allocation until an independently current, fenced history is reconciled (Task 2).
4. A lost consumption reply must reconcile one bound result; a missing local activation result requires a fresh identity, even with the old receipt (Tasks 4–7).
5. A copied pack, forged transfer, full-purpose substitution or receipt from an ended subscription must not turn into permission to resume trading (Tasks 1, 3, 5–7).

## Inherited interfaces versus proposed adapters

W1 is the approved protocol. W2–W4 are parked implementations, not landed APIs. Their `FiscalAllocation` is version 1 with `allocationId`, `taxpayerNif`, `softwareId`, `environment`, `installationIdentity`, complete `series`, `source`, `reservationEvidence: unknown`, `issuedAt`. `RecoveryApproval` adds version, `eventId`, `operatorId`, `sourceId`, `targetNodeId`, `oldMachineOffline`, `oldMachineAbsent`, `noParallelRecovery`, `confirmedAt`, `incidentEvidence`; `oldMachineAbsent` is the parked setup extension.

`PaperBlock` v1 has `custodianId`, `generationId`, `blockId`, `packVersion:1`, `recipientVenueId`, allocations. `SignedPaperValue<T>` has `{payload,signature}`. `PaperConsumption` binds `blockDigest`, allocation/event/operator/source/target/incident and `consumedAt`; `PaperCustodianTrust` has `{custodianId,publicKey,fingerprint}`. Use their canonical signed bytes as cross-repository fixtures after they land, without importing Waitron into Cloud.

The parked `ModuleOperationInput` is `{input:unknown,binding:OperationBinding,authority:OperationAuthority}`; binding has module/action/event/source/target. `withOperationAuthority(binding, operatorId, run)` issues a transient object to authenticated host code. `RestoreHook(tx,node,operation?)` returns `RestoreOutcome`; `activateAuthenticatedAllocation(tx,node,allocation,approval,context,authority,action)` is a parked fiscal function. Future B3 must consume the eventual landed interfaces through the module seat, never teach the generic server to interpret a Veri*Factu type.

Everything named below is **proposed**, including endpoints, tables, errors and configuration. Define it in B1; it is not an existing subscription or continuity API. Cloud and local operator identities are separate. A qualified custody/attribution adapter must bind the signed `operatorId` to the locally approved operator; do not derive that relationship from email, NIF, a phone text field or a Cloud session alone.

### Proposed B1 types and seams

Define browser-safe wire types in `packages/fiscal-allocation/src/types.ts`; export those separately from Node signing/store code. Use immutable snapshots and strict exact-key validation.

| Type | Fields / signature |
| --- | --- |
| `Scope` | `{taxpayerNif:string,softwareId:string,environment:'preproduction'|'production'}` |
| `SeriesBase` | `{code:string,purpose:'standard'|'full'|'rectificative'}` |
| `ClaimBinding` | `{eventId:string,operatorId:string,sourceId:string,targetNodeId:string,incidentEvidence:string}`; each nonempty bounded text, maximum 256, canonical timestamps separately |
| `ReserveInput` | `{version:1,operationId:string,venueId:string,scope:Scope,bases:readonly SeriesBase[],binding:ClaimBinding,mode:'initial-setup'|'recovery'}`; operation/venue UUIDs, operation ID preserved across lost replies |
| `ConsumeInput` | `{version:1,operationId:string,allocationId:string,binding:ClaimBinding,oldMachineOffline:boolean,oldMachineAbsent:boolean,noParallelRecovery:boolean,confirmedAt:string}`; setup requires absence, recovery requires isolation and no absence claim |
| `FiscalAllocation` | W1/W2 fields above; Cloud local declaration, source `'cloud'` for generated names; `reservationEvidence={kind:'cloud',authorityId:string,reservationId:string,reservationSequence:string}` is a reference covered by the enclosing signed receipt, never that receipt nested inside itself |
| `AllocationReceipt` | `{payload:ReceiptPayload,keyId:string,signature:string}`; `ReceiptPayload={version:1,issuer:string,receiptId:string,state:'reserved'|'consumed'|'abandoned',allocation:FiscalAllocation,binding:ClaimBinding,mode:'initial-setup'|'recovery',approval:RecoveryApproval|null,cloudAccountId:string,venueId:string,custodyVersion:string,entitlementVersion:string,continuity:ContinuityWitness,recordedAt:string}`; consumed approval holds the complete W2 snapshot matching binding, otherwise null |
| `ContinuityWitness` | `{authorityId:string,scope:Scope,sequence:string,cHighWater:number,historyDigest:string,writerFence:string,requestNonce:string,observedAt:string,keyId:string,signature:string}`; decimal sequence/fence strings avoid numeric precision loss; high-water 0–999999 |
| `AllocationPage` | `{version:1,items:readonly AllocationReceipt[],nextCursor:string|null}`; page 1–50, opaque signed cursor bound to actor/venue/filter, no cross-organisation namespace listing |
| `StatusResult` / `PaperImportResult` | `{version:1,state:'unknown'|'recorded'|'uncertain',receipt:AllocationReceipt|null}` / `{version:1,importId:string,acceptedRevision:string,historyDigest:string}` |
| `ListInput` | `{version:1,venueId:string,cursor:string|null,limit:number}`; use the same type for store and wire |
| `PaperHistoryInput` | `{version:1,operationId:string,venueId:string,scope:Scope,custodyVersion:string,registerRevision:string,previousDigest:string,block:SignedPaperValue<PaperBlock>,consumptions:readonly SignedPaperValue<PaperConsumption>[],transfers:readonly SignedPaperTransfer[]}` |
| `SignedPaperTransfer` | signed payload `{version:1,custodianId,blockDigest,allocationIds,fromVenueId,toVenueId,registerRevision,previousDigest,transferredAt}` plus `keyId,signature`; verify continuous ownership history, never edit the original signed block |
| `FiscalAllocationError` | `code` union: `invalid_input`, `permission_denied`, `entitlement_unavailable`, `custody_unavailable`, `continuity_unavailable`, `history_uncertain`, `binding_conflict`, `allocation_unavailable`, `space_exhausted`, `reservation_untrusted` |

`RegistryOptions` contains explicit nullable `entitlement`, `custody`, `continuity`, `signer`, `trust` and `policy`; an omitted/null capability refuses new claims. `createAccountApp`/`startAccountServer` gain `fiscalAllocation?: RegistryOptions`; default unavailable in every environment. No env-derived all-enabled policy, demo key or production provider is supplied here.

Proposed `Entitlement.check(client:PoolClient, accountId:string, venueId:string, action:'reserve'|'consume'|'import'|'read'):Promise<{allowed:boolean,version:string}>` checks current grants, under lock and again after waits. Read retention is distinct from issuance. Proposed `Custody.check(client:PoolClient, accountId:string, venueId:string, scope:Scope, binding?:ClaimBinding):Promise<{custodianId:string,custodyVersion:string,operatorBindingVerified:boolean,requiredBases:readonly SeriesBase[]}>` requires established authority for this taxpayer/software/environment and the exact operator binding. Compare the request's bases to this independently established complete venue snapshot; a caller cannot omit its full series. Self-submitted NIF is only lookup data.

Proposed `ContinuityAuthority.current(scope:Scope,nonce:string):Promise<ContinuityWitness>`, `claim(input:ContinuityClaim):Promise<ContinuityResult>`, `history(scope:Scope,afterSequence:string,nonce:string):Promise<ContinuityHistory>` and `fence(scope:Scope,nonce:string):Promise<WriterGrant>`. Define `ContinuityClaim={scope:Scope,writerGrant:WriterGrant,expectedSequence:string,operationId:string,requestDigest:string,event:RegistryEvent}`, `ContinuityResult={event:RegistryEvent,receipt:AllocationReceipt,witness:ContinuityWitness}`, `ContinuityHistory={events:readonly RegistryEvent[],witness:ContinuityWitness}`, `WriterGrant={writerId:string,fence:string,expiresAt:string,witness:ContinuityWitness}`. `RegistryEvent` is a tagged reserve/consume/abandon/paper-import/report event with full request, assigned allocation/binding, previous digest, sequence and resulting signed receipt. The history digest covers the canonical event core, excluding its derived receipt/witness/signatures to avoid circular signing. Derive a candidate C serial only from a fresh authoritative high-water; validate its complete fiscal values before conditional append. The authority enforces that exact next serial and sequence, retains the exact signed result and deduplicates the original request digest; contention re-reads current history before choosing another candidate. Current previous-writer identity comes from the authority, never restored PostgreSQL. Enforce the fence on every write.

Only synthetic injected continuity fixtures are built now. A qualified production adapter must provide an authoritative monotonic journal, conditional append, current authenticated challenge response, durable deduplication and independently enforced writer exclusion. A backup, signature, local epoch, best-effort dual write or bucket colocated with the lost registry does not supply that guarantee. Missing/unsigned/stale witnesses or uncertain history refuse short claims.

Define `RegistryPolicy={continuityTimeoutMs:number,witnessMaxAgeMs:number,writerLifetimeMs:number}` as required positive bounded values: continuity timeout at most 5,000 ms, freshness/lease checks use independently authenticated authority time. Synthetic tests choose explicit short values; runtime supplies none by default. Historical receipt verification checks its trusted signature and recorded event, while a new claim always requires a fresh challenged witness. A retained signature does not itself establish currentness.

Use separate receipt and paper custodian trust sets. Task 1 covers a rotated signer, verification of retained old receipts, denial of new signing with a retired/missing key, wrong fingerprint and revoked paper key/version. B1 writes no private key to PostgreSQL. Key revocation for historical receipts must follow the selected owner's compromise policy, rather than treating every retained public key as valid forever.

### Proposed persistence and locking

Create the next migration `NNN_fiscal_allocation_registry.sql` at build time after D55/035 lands; never reserve 035 or edit applied SQL. Append it to `packages/registration/src/migrate.ts`. Cloud registration owns migration execution; the new package owns fiscal domain queries. Registration does not depend on fiscal-allocation, avoiding a package loop.

| Table | Keys, fields and invariant |
| --- | --- |
| `fiscal_registry_scopes` | Composite PK scope; `c_high_water` bounded 0–999999, last continuity sequence/digest/fence. Rebuildable projection, not outside authority. No organisation in namespace key. |
| `fiscal_registry_allocations` | PK `allocation_id`; UNIQUE(scope,installation_identity); owner venue FK without cascading deletion; full immutable allocation/binding/actor/custody/entitlement snapshots and initial receipt. Never delete/rewrite an allocated identity. |
| `fiscal_registry_events` | PK event UUID; UNIQUE(scope,sequence), UNIQUE(scope,operation_id); action/request digest, allocation reference, immutable event and signed result. UPDATE/DELETE/TRUNCATE refusal; no cleanup category. |
| `fiscal_registry_paper_events` | Immutable custodian/register revision/block digest/transfer/consumption facts; unique revision and event IDs with exact-digest retries. Preserve old recipient plus transfers; missing imports leave rows untouched. |

Do not cascade historical rows through account, venue or organisation deletion. Refuse those destructive operations while retained evidence is required; record any future retention/anonymisation change as its own owner policy. SQL constraints and runtime privileges complement application checks. Assert UPDATE/DELETE/TRUNCATE refusal as the restricted application role and preserve migration-role capability; no claim that triggers resist a schema owner dropping them.

Use C1's `transaction(pool, action)` with sequential awaited SQL. Account/credentials/session precede membership, venue/custody/entitlement rows, then lexically ordered namespace locks, then allocation/operation projection rows. Reuse `resolveSession(...,{csrfToken,touch:false})` after acquiring domain locks and after bounded continuity calls; check wall-clock expiry then. Do not take session locks after a conflicting account-update lock order. Machine report locks installation first, then namespace, and takes no account-session locks. Rate transactions complete before domain locks.

The continuity journal is authoritative, and PostgreSQL projects it. Under bounded locks, validate authority, append independently, validate the returned signed current witness, recheck authorization, persist the exact event/receipt, then answer. A crash/rollback after external append burns the name; replay current continuity into PostgreSQL before replying. After an uncertain external call, reconcile that operation, never allocate optimistically. Authorization lost after append prevents disclosure; it cannot erase the external event. Recovery first fences the previous registry writer through the independent authority, reconciles the complete current history, and only then grants a new writer.

Allowed state transitions are reserved to consumed or abandoned. Consumed/abandoned never revert or switch to each other. Record activation attempts/results as new report events, retaining source/target/event/operator and exact receipt digest; reports cannot rewrite consumption. An uncertain local activation leaves its name consumed even when the local transaction rolled back. An independently confirmed identical claim may return its receipt again, but only a matching local committed result permits local activation replay.

### Proposed HTTP contract and shared limits

All account endpoints below are POST under `/api/account/fiscal-allocations/`, origin checked, cookie/full session plus CSRF, `Cache-Control:no-store`, exact JSON validation and server-derived Cloud actor. Read endpoints are passive. D55's `PasswordLoginResult.kind:'factor'` and challenge token never authorize them. Re-read D55's landed session interface before wiring.

| Suffix | Body → result |
| --- | --- |
| `reserve` | `ReserveInput` → reserved `AllocationReceipt`; same operation/digest returns exact bytes, different binding returns 409 |
| `consume` | `ConsumeInput` → consumed `AllocationReceipt`; reserved receipt alone cannot activate; recovery isolation/setup absence and no-parallel confirmation must match reserved mode |
| `abandon` | `{version:1,operationId,allocationId,binding}` → abandoned `AllocationReceipt`, terminal for use and permanently occupied |
| `status` | `{version:1,venueId,operationId}` → `{version:1,state:'unknown'|'recorded'|'uncertain',receipt:AllocationReceipt|null}`; unknown is never permission to reuse a name |
| `list` | `{version:1,venueId,cursor:string|null,limit:number}` → `AllocationPage`; includes retained terminal receipts, only authorized venue facts |
| `import-paper` | `PaperHistoryInput` → `{version:1,importId,acceptedRevision,historyDigest}`; no name issuance; old exact import retry succeeds without downgrade |

Add POST `/api/installations/fiscal-allocations/report`: `{payload,signature}` signs a new domain-separated canonical message `[version,origin,action,installationId,operationId,issuedAt,lease,bodyDigest,body]`. Body is `{venueId,scope,receipt:AllocationReceipt|null,paperHistory:PaperHistoryInput|null,activationEvidence:unknown}` with exactly one evidence source. Verify current stored installation key, presented signed active lease/venue/environment, action, ±60-second request time and operation digest under revocation locks. Reuse registration's `verifyLease` semantics, with explicit registration-to-fiscal environment mapping. Define this proof in `machine-proof.ts`; existing `InstallationStore.execute` accepts only its four actions, so do not pass a fabricated fifth action to it. Return `{version:1,state:'matched'|'conflict'|'recorded',receiptId:string|null}`; reporting records evidence, never activates or grants a new name.

Use `readBoundedJsonObject`: 16,384-byte uncompressed request cap and 5-second read deadline. Proposed bounded import accepts at most 20 allocations, 20 consumptions and 20 transfers per request, each transfer at most 20 IDs. Batch independent signed objects in linked register revisions; never truncate a signed block to fit. A whole block with more than 20 allocations or canonical request bytes above 16,384 refuses with `invalid_input`; preserve its signature and every reserved name. Reconcile any replacement export through the current custodian, without minting replacement names or changing the original signed payload. No chunk protocol is authorised here. At most 20 series bases, 50 list items, 256-character references; response cap 256 KiB, verified receipt/manual packet cap 12 KiB. Task 1 tests the largest accepted snapshot and refuses oversize sets before burning a name.

Use the existing `all-ip` 120/minute gate plus PostgreSQL limiter rules shared by every worker: fiscal IP 60/minute, authenticated account 30/minute, namespace mutations 10/minute; machine IP 60/minute and verified installation 30/minute. These are proposed build limits, not purchased allowances. Derive namespace subjects after authorization; never let an unauthenticated NIF exhaust another taxpayer's quota. Return 429/Retry-After consistently. Map malformed input to 400, full-session failure to 401, authority failure to 403, conflicting bound history to 409, unavailable seams/current witness to 503. No failed request dumps provider text or secrets.

## File ownership and task execution

Cloud creates `packages/fiscal-allocation/{package.json,src/{index,types,validation,evidence,policy,continuity,store,paper-import,machine-proof}.ts,test/{contract,schema,continuity,store,paper-import}.test.ts,test/fixtures.ts}`. Modify Cloud `packages/account-http/{package.json,src/{app,server,fiscal-allocations}.ts,test/fiscal-allocations.test.ts}`, registration migration manifest/new SQL, root CI package matrix, lockfile and contract/recovery documentation. Package scripts follow C6: `test` runs `node --test --test-timeout=30000 test/*.test.ts`; typecheck follows sibling packages. Wire exports explicitly; no Waitron runtime dependency. Use the actual `@waitron/verifactu` library for candidate validation, pinning the resolved version when building (`packages/fiscal-verifactu/package.json:24` currently declares `^0.2.1`); do not copy its validator or import Waitron's fixture helper into Cloud.

B2 creates Cloud `apps/portal/src/fiscal-allocation-{types,controller,screen}.ts`, `test/fiscal-allocation-{controller,browser}.test.ts`; modifies `src/{api,app,screens,locale}.ts`, account HTTP `portal.ts` document allowlist and `apps/portal/test/fixtures.ts`. B3 creates Waitron `apps/server/src/cloud-fiscal-allocation{,-client}.ts` and sibling tests plus fiscal module `cloud-evidence.ts`/test; use eventual W41s-6 manual/opaque restore files after their exact paths land. Keep adapters beside `cloud-client.ts` without moving Waitron code into Cloud.

Every task below requires observed RED for the named behavioural assertions, then minimal implementation, the same focused command with actual nonzero test/pass/fail/skip counts, then a signed commit of that task's explicit files. Counts are acceptance minima, not results from this planning session. A missing import may establish initial RED; before completion remove each critical guard in a disposable checkout and confirm its behavioural assertion fails, then restore and rerun. Do not accept setup errors, blanket throws, mocks of PostgreSQL or skipped cases as the intended RED.

### Task 1 (B1): contract, schema and default refusal

**Files/interfaces:** Create package/types/validation/evidence/policy and `contract.test.ts`, `schema.test.ts`; new registration migration/manifest. Produce `validateReserve(value:unknown):ReserveInput`, `encodeReceipt(receipt:AllocationReceipt):string`, `decodeReceipt(text:string,trust:ReceiptTrust):AllocationReceipt`; `ReceiptTrust={issuer:string,keys:ReadonlyMap<string,string>}`. Use canonical versioned fixed-order UTF-8 fields, Ed25519, SPKI SHA-256 key fingerprints, strict base64url, exact keys and schema validation. Manual packet is `WAITRON-FISCAL-ALLOCATION-1:` plus canonical encoded signed receipt; signatures cover every snapshot field and exclude the signature itself.

- [ ] RED: add at least 12 named cases covering S/P/C bounds and zero/exhaustion; all three purposes and wrong/missing `full`; environment mismatch; 21/27/60 limits through actual
  fiscal validator fixtures and a refused 61-character control; oversize receipt/import; mutated binding/signature; null/missing seams; untrusted NIF; rotation and
  retired/missing/revoked keys as above. Assert exact error codes and no row/name consumption on validation refusal.
- [ ] Observe RED: `node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec node --test --test-timeout=30000 test/contract.test.ts test/schema.test.ts` from
  Cloud root; retain the failing names/reasons.
- [ ] Implement strict immutable types, deny-by-default policies, canonical signing/verifying, constraints and immutable triggers. Call `buildAltaRecord`/`validate` on a complete
  synthetic candidate for every generated/imported identity, including each base at counter 9,999,999,999, before issuing evidence. Add package to Cloud CI matrix and manifest
  guards without loosening them. Library acceptance establishes no fiscal legality.
- [ ] GREEN: same focused command, at least 12 passing cases, zero failed/skipped; populated pre-registry upgrade on two independent migration connections preserves old
  rows/digests. Restricted-runtime UPDATE/DELETE/TRUNCATE attempts refuse and unrelated legitimate inserts still work. Run `pnpm typecheck` and `node --test
  scripts/ci-workflow.test.mjs scripts/database-recovery-migrations.test.mjs`.
- [ ] Commit the explicit package/migration/CI files with `git commit -s -m "feat: define fiscal registry contract and immutable storage"`.

### Task 2 (B1): independently current continuity and disaster refusal

**Files/interfaces:** `continuity.ts`, `continuity.test.ts`, fixture; store projection helpers; Cloud `docs/database-recovery.md`. Produce `requireCurrentHistory(authority:ContinuityAuthority|null,scope:Scope,grant:WriterGrant|null):Promise<ContinuityHistory>` and `projectHistory(client:PoolClient,history:ContinuityHistory):Promise<void>`. Fixtures simulate an external durable authority shared by two real Node workers, with a lifecycle independent of either PostgreSQL schema or worker restart.

- [ ] RED: at least 8 cases: take an old database backup, claim C000042 afterward, restore only that backup and refuse reissue; stale/unsigned witness; missing journal interval;
  expired writer; old writer races replacement; external append succeeds but reply/PG commit fails; unavailable authority; valid complete reconciliation permits C000043 while
  C000042 remains occupied.
- [ ] Observe RED: `node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec node --test --test-timeout=30000 test/continuity.test.ts`; assert the restored
  service refuses and old writer's conditional append fails, rather than merely comparing stored counters.
- [ ] Implement challenged current reads, exact journal replay, external fencing and permanent unknown-outcome handling. The replacement cannot infer currentness from its own
  backup. Restrict synthetic authority to injected tests; runtime default remains unavailable.
- [ ] GREEN: same command, at least 8 pass, zero fail/skip. Preserve witnesses, discarded replies, writer failures and projected rows in the fixture receipt; deletion of
  freshness/fence checks must fail the relevant cases. Document why C5's physical drill does not qualify independent continuity.
- [ ] Commit with `git commit -s -m "feat: refuse fiscal allocation without current independent continuity"`.

### Task 3 (B1): authenticated registry, paper history and shared namespace

**Files/interfaces:** `store.ts`, `paper-import.ts`, `store.test.ts`, `paper-import.test.ts`. Produce `FiscalAllocationStore(pool:Pool,options:RegistryOptions)` with `reserve(token:string,csrf:string,input:ReserveInput):Promise<AllocationReceipt>`, `consume(token:string,csrf:string,input:ConsumeInput):Promise<AllocationReceipt>`, `abandon(token:string,csrf:string,input:AbandonInput):Promise<AllocationReceipt>`, `status(token:string,csrf:string,input:StatusInput):Promise<StatusResult>`, `list(token:string,csrf:string,input:ListInput):Promise<AllocationPage>`, `importPaper(token:string,csrf:string,input:PaperHistoryInput):Promise<PaperImportResult>`. `AbandonInput` and `StatusInput` are exactly their endpoint body types below; export these named types in `types.ts`.

- [ ] RED: at least 12 cases: two real workers/venues and two organisations share one NIF and allocate distinct C names without cross-venue history disclosure; same operation
  returns identical receipt; changed event/source/target/operator/base conflicts; omission of independently configured full series refuses; ownership revoked/session expires while
  blocked; unproved custody refuses; ended entitlement denies new reservation but retained read succeeds; consumed/abandoned never reused; monotonically import reserved/consumed
  S/P; stale omissions preserve consumed facts; forged/conflicting transfer refuses; current signed transfer preserves complete ownership chain; paper outage use later imports
  once.
- [ ] Observe RED: `node scripts/test-postgres.mjs exec pnpm --dir packages/fiscal-allocation exec node --test --test-timeout=30000 test/store.test.ts test/paper-import.test.ts`;
  coordinate workers by observing `pg_stat_activity`/explicit authority barriers, not sleeps. Assert receipt identity/state and stored history, not only row counts.
- [ ] Implement the stated lock order, live auth/custody/entitlement rechecks, scope-wide continuity allocation, permanent append-only events and linked paper import. Re-read
  current register revision under lock. Lower revisions can acknowledge exact prior events, never downgrade or introduce conflicting ownership. Transfer/custodian key versions
  remain in historical facts.
- [ ] GREEN: same command, at least 12 pass, zero fail/skip; compare complete purpose and binding snapshots. Deleting namespace uniqueness/auth recheck/import-monotonicity checks
  fails the corresponding controls. Retain independent-worker evidence and no cross-organisation disclosure.
- [ ] Commit with `git commit -s -m "feat: reserve and consume fiscal identities with monotonic paper history"`.

### Task 4 (B1): actual HTTP, machine report and lost reply

**Files/interfaces:** Cloud account HTTP route/app/server/options/package; `machine-proof.ts`; `test/fiscal-allocations.test.ts`; contract docs. Produce `fiscalAllocationResponse(c:Context,options:FiscalHttpOptions):Promise<Response>` dispatched before generic installation routing; `verifyFiscalReport(value:unknown,currentKey:string,origin:string,now:number):FiscalReportClaims` and `reportFiscalAllocation(pool:Pool,options:RegistryOptions,proof:unknown):Promise<ReportResult>` with locked current installation authority. `FiscalReportClaims` carries the exact signed machine fields above, `ReportResult` the report response above. `FiscalHttpOptions={pool:Pool,registry:RegistryOptions|null,origin:string,ip:string,consume:(rules:RateRule[])=>Promise<void>}`; export named machine body/claims/result types.

- [ ] RED: at least 10 real HTTP cases: wrong host/origin/method/content type/oversize; session and CSRF failure; D55 pending challenge denied while full session succeeds; disabled
  options 503; two servers share rate budget; taxpayer quota protected before auth; reserve/consume reply lost after independent append; status returns same receipt after restart;
  changed proof/body/revoked installation refuses; matched/conflicting paper report does not activate.
- [ ] Observe RED: `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=30000 test/fiscal-allocations.test.ts`; start real
  listeners with existing server fixture and discard TCP reply after commit, then call the real client, not only Hono's in-memory request.
- [ ] Implement exact endpoints, public error mapping, shared limits and under-lock installation proof rechecks. Status recovers external committed results after missing PostgreSQL
  projection. Do not put signer/trust keys in responses other than public key identifiers; no paper generation endpoint.
- [ ] GREEN: same command, at least 10 pass, zero fail/skip; `pnpm typecheck`. Run the landed D55 targeted session/login cases alongside this route once available; a pending
  challenge must never create usable fiscal cookies. Update integration docs with proposed-to-implemented endpoint receipts and limitations.
- [ ] Commit with `git commit -s -m "feat: expose authenticated fiscal allocation and reconciliation routes"`; finish B1 through normal Cloud current-head CI before B2 starts.

### Task 5 (B2): phone reservation, consumption and retained paper evidence

**Files/interfaces:** Portal files listed above and `fiscal-allocation-controller.test.ts`. Produce `FiscalAllocationController(changed,request=accountRequest)` with `account(id:string|undefined)`, `open(venueId:string|undefined)`, `reserve(input:ReserveInput)`, `consume(input:ConsumeInput)`, `reconcile()`, `load(cursor:string|null)`, `importPaper(input:PaperHistoryInput)`; state holds current receipt, pending request, uncertainty, generation and retry deadline. `validAllocationReceipt(value:unknown)` and page/status validators cover every exact shape; browser structural acceptance is not cryptographic local authorization.

- [ ] RED: at least 8 cases: lost reserve/consume response preserves operation and event IDs until status; stale route/account completion ignored; changed selection clears
  confirmations; reserved receipt cannot be offered as consumed; corrupted manual packet never silently corrected; ended subscription retains receipt/download/list but cannot
  reserve; unavailable custody/continuity explains refusal; existing paper block imports without allocating C or creating P.
- [ ] Observe RED: `node --test --test-timeout=30000 apps/portal/test/fiscal-allocation-controller.test.ts` from Cloud root; inspect exact requested path/body and state
  transitions.
- [ ] Implement controller/validators/API CSRF wiring and `/fiscal-allocations` in both client route and server document allowlist. The journey shows scope, venue, all purposes,
  event/source/target/operator, state and pack-staleness wording before confirmation; requires old-machine isolation, no parallel recovery and explicit consumption. Download the
  full signed manual packet, never only a fiscal identity.
- [ ] GREEN: same command, at least 8 pass, zero fail/skip; `pnpm --filter @waitron-cloud/portal build` and `pnpm typecheck`. List/download handles long histories by bounded pages;
  no recovery kit/key enters the controller.
- [ ] Commit with `git commit -s -m "feat: guide fiscal reservations and retain signed recovery receipts"`.

### Task 6 (B2): browser acceptance through real server/client

**Files/interfaces:** `fiscal-allocation-screen.ts`, locale copy, browser test and fixture. Reuse portal components/tokens, semantic names and actual inner controls; add localized field errors and one bottom form message above actions. A selection action stays quiet/disabled until it can act; network refusal alone does not permanently disable retry.

- [ ] RED: 8 locale/theme/width combinations (`en/es × light/dark × 390/1280`), each exercising reserve, consume, lost-reply reconciliation, manual packet display/export, retained
  receipt after entitlement end and stale/forged paper refusal. Assert exact standard/full/rectificative labels, disabled confirmations, accessible errors, no horizontal overflow
  and absence of secret fixtures.
- [ ] Observe RED: `pnpm --filter @waitron-cloud/portal build && node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/fiscal-allocation-browser.test.ts`; use C6's actual
  account server and browser, with only the production-gated seams injected synthetically.
- [ ] Implement the screen and EN/ES copy; use generation fences across logout/account changes. Reprinted evidence states that the current master governs paper use. Never imply a
  Cloud receipt acknowledges old-machine fencing or enables trading.
- [ ] GREEN: repeat the build and focused browser command, at least 8 passing matrix cases, zero fail/skip; run axe in ready, uncertainty, error and retained-receipt states. Open and visually inspect captures at
  both widths/themes/languages; record computed theme colours and real viewport sizes, plus real HTTP/client results.
- [ ] Commit with `git commit -s -m "feat: verify phone and paper fiscal recovery journey"`; finish B2 with normal Cloud gates/current-head CI.

### Task 7 (B3): Waitron adapter, local approval and later reconciliation

**Dependencies/interfaces:** B1 deployed contract in disposable integration plus landed W41s-4 and W41s-6. Discover their exact files first; W2–W4 are not consumable landed APIs. Create the Waitron adapter/client and module verifier listed above. Proposed generic `FiscalAllocationTransport={status(input:unknown):Promise<unknown>,report(input:unknown):Promise<unknown>}` carries opaque module packets; proposed fiscal `verifyCloudAllocationEvidence(receipt:unknown,trust:ReceiptTrust,context:AllocationContext):AllocationValidation` checks signatures/consumed state/scope/exact snapshot/binding. Add Cloud authority context only in the fiscal module, after its landed shape is known.

- [ ] RED: at least 10 focused cases: actual B1 HTTP/client successful consumed packet through W41s-6's manual path; fake and real 401/403/409/429/503/malformed/lost reply; offline
  paper consumption then later report once; conflicting imported evidence preserves originals; source/target/event/operator/full-purpose substitution; missing trusted key; receipt
  retained after subscription end; old backup with missing local committed activation refuses replay and burns old name; no automatic return from emergency to short identity; sale
  completes with registry network replaced by a throwing recorder and zero calls.
- [ ] Observe RED: `pnpm --filter @waitron/server exec vitest run src/cloud-fiscal-allocation.test.ts src/cloud-fiscal-allocation-client.test.ts` and separately `pnpm --filter
  @waitron/fiscal-verifactu exec vitest run src/cloud-evidence.test.ts`. B1 provides its reusable HTTP fixture. For the actual joint path, a separately scheduled Cloud integration owner adds `packages/account-http/test/fiscal-waitron-client.test.ts` after W41s-4/6 land; run
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test --test-timeout=120000 test/fiscal-waitron-client.test.ts` in its isolated Cloud checkout
  using the explicitly pinned B3 Waitron candidate path. B3 cannot finish until that joint result is complete. Retain each command's counts, at least 10 behavioural cases in total, no skipped joint test.
- [ ] Implement request/reconciliation outside the issuance transaction and feed `{allocation,approval,receipt}` into the same opaque manual operation. The module verifies the full
  signed consumed receipt and its referenced reservation evidence without recursive receipt nesting. Host reauthenticates the operator using the W41s-4 approved method; derive
  authority internally, not from Cloud actor IDs. Local exact committed result is the only replay path; outside consumed receipt alone cannot recreate lost local result. Preserve
  original hashes and all series atomically through the landed module seat.
- [ ] GREEN: repeat those commands; use `useVenueDb` for Waitron assertions and the real Cloud PostgreSQL/server fixture for the joint test. Run unedited
  `src/write-path.e2e.test.ts` and `src/inmutabilidad.test.ts` via `pnpm --filter @waitron/fiscal-verifactu exec vitest run`, then relevant module/secret-export/root guards and
  scoped types. Inspect any visible manual recovery EN/ES, both themes, 390/1280.
- [ ] Commit with `git commit -s -m "feat: reconcile cloud fiscal receipts through local recovery authority"`. Update Waitron/Cloud integration docs separately within their
  scheduled owners; do not move Waitron activation or database logic to Cloud. Finish through normal hook, review and current-head CI.

## Ready-to-copy queue cards

These bounded cards are handoff text. The watcher chooses eligibility, creates/schedules separate repository worktrees and copies them into the appropriate queue. This plan neither edits Lane D's blocked placeholders nor authorizes a Cloud firing by itself.

| Card | Owner, dependency and boundary | Acceptance / exit |
| --- | --- | --- |
| **B1: Fiscal allocation registry service and reservation API** | Cloud Lane D, `waitron-cloud`; Tasks 1–4. After this handoff is reviewed/landed and watcher schedules it; coordinate shared auth/app/migration files after D55. New domain package, current-auth namespace reservations, monotonic paper import, independent continuity seam and HTTP/report contract. No portal journey or Waitron activation. | Real PostgreSQL two-worker uniqueness, populated upgrade/runtime immutability, lost reply, old-backup missing names, full-session/pending-challenge refusal and all disabled seams. Signed commits, Cloud CI package inclusion, one normal finish/review/CI cycle. Build may land with synthetic fixture and runtime unavailable; enablement stays gated below. |
| **B2: Fiscal allocation phone and paper journey** | Cloud Lane D, `waitron-cloud`; Tasks 5–6, depends on landed B1 contract. Portal/controller/types/API/route serving only; supports on-prem venues with no managed Cloud backup. | Exact consumed receipt/manual packet, uncertain retry, current paper import, retained history after subscription end, real HTTP/browser EN/ES/light/dark/390/1280. Signed commits and normal Cloud finish/review/CI. No production activation by UI. |
| **B3: Waitron allocation adapter and reconciliation** | Waitron fiscal lane selected by watcher; Task 7, depends on B1 and landed local W41s-4/6. Park behind recovery-key operator decision and local interface landing. Cloud joint test changes require separately scheduled Cloud owner; no cross-lane edits. | Same manual opaque recovery path, actual Cloud client/route plus fake refusals, offline consumption/report, uncertain local replay refusal, retained secret-free receipts, no automatic short return and no network on sale. Signed commits, unedited fiscal invariants, normal Waitron finish/review/CI. |

At each part's finish, re-read its actual repository instructions and gates. Cloud's C6 CI uses Node package tests and explicit matrix selection, not Waitron's Vitest/coverage hook; add the new package without dropping existing jobs. Waitron keeps its normal pre-push hook and CI coverage split. Record command/count/head receipts; announce readiness to run `finish-branch`, or continue it if already scheduled. This planner performs none of those operations.

## Self-review and remaining decisions

Coverage: W1 §9.1 is Tasks 1/3/7; §9.2 is Tasks 2/3/5/6; §9.3 is Tasks 2/4/7; §9.4 is Tasks 1/4/7. All three Cloud workstream items have separate cards. Review-focus cases have explicit RED assertions. Types/endpoints/results above are consistent across tasks; commands use the read-only C6 wrapper/Node conventions and Waitron's existing focused Vitest invocation. Minimum counts describe future tests, never a claim they ran. Provenance distinguishes approved contract, main source, parked interfaces and proposed seams.

**Build gates:** watcher scheduling and collision check; B2 waits B1, B3 waits B1 plus W41s-4/6 and operator attribution. Allocate the migration number after D55. The owner resolved the emergency-width question on 2026-10-12 at 10:25: keep 128 unbiased random bits, 26 characters and first symbol `0–7`. Use that approved correction when sharing the eventual landed validator; no new encoding decision is pending. The original spec correction belongs to W41s-4. Cloud C-only reservation and synthetic continuity tests can be built independently.

**Owner enablement gates:** select and qualify independent continuity storage/failure domains, currentness/timeout policy and previous-writer exclusion; choose verified taxpayer custody across organisations, custodian transfers and operator identity bridge; define subscription entitlement, end-of-subscription consumption policy and retained access. No adapter is enabled by a self-asserted NIF or by organisation ownership alone. Choose an external signing-key custodian, fingerprint enrolment, rotation/revocation and recovery procedure: retain old public verification keys for historical receipts, refuse new signing with retired/missing keys, and require custody-versioned signed transfer on paper key changes. Tests cover key rotation, old trusted receipts and revoked/untrusted new claims; private/recovery keys remain outside exports.

These important choices do not prevent synthetic builds, and they do prevent production short allocation until explicitly configured and exercised. No production defaults are selected. Adviser questions and provider/fiscal legality remain outside this repository research; no test plan or signature is described as legal or production verification. Paper recovery does not depend on B1, B2, B3 or this handoff, and returning to fresh short series always remains an explicit administrator operation.
