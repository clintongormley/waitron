# A679 implementation addendum — owner approval at 17:15

This addendum supersedes the original plan’s original-tab recovery requirement and “incident resolution” outcomes. Implement only the approved A679 core. A696 is outside scope. A731, A732 and A733 remain separate requirements before go-live.

**Evidence status:** source reading only. No implementation, tests, browser journey or fault experiment was executed for this addendum. Existing review reports and retained password-test results predate this redesign; they do not qualify its repair, workspace-selection or entry paths.

**Plan review:** fresh read-only check against approved V2, the 17:15 scope decision and committed `6318bd61e6f237491146e758c3f52710165b2ec1` returned “nothing important left”. Implementation qualification remains outstanding.

## Source constraints

- `first-setup-state.ts:404` rejects `claiming` markers and mismatched abandonment pairs; `readResumable()` adds only interrupted-completion tolerance. Preserve these strict contracts.
- `first-setup-owner.ts:223` requires the old browser proof. Marker repair followed by ordinary resume cannot provide recovery from another browser.
- `boot.ts:849` opens the database before first-setup reconciliation. `node-entry.ts:456` runs staged operations before `startServer`; its ahead check also opens the database. Resolution inspection must precede these paths.
- `bin.ts:7` directly calls `startServer`. Already-recovery entry returns through `recoveryApp` before normal boot (`node-entry.ts:416`). Both need explicit integration.
- `provision.ts:73` reconstructs a venue but does not independently establish the exact fiscal commit. Retain `checkedFirstFiscalCommit` and its module-owned committed-result checks.
- No `module-operation-api.ts` exists in this checkout. The corresponding current implementation is `setup-first-fiscal-api.ts`.

Keep fiscal writers, `registerSif`, `restoreFiscal`, hashes, numbering, SQL and existing guards/assertions unchanged. New resolution admission checks must add restrictions around existing paths, never weaken their checks.

## Proposed exports and durable records

Keep the existing version-1 claim/state format. Add separate inspection, repair and resolution services; do not add a tolerant option to ordinary store reads.

| Proposed export | Contract |
|---|---|
| `inspectFirstSetupResolution(roots)` | Read-only inspection returning validated facts, explicit missing/invalid/unknown classifications and a digest of inspected evidence. Never creates a database or grants authority. |
| `recoverFirstSetupOwner(request)` | Verify the original password, repair an eligible marker if needed, then separately rebind ownership. |
| `createFirstSetupResolutionStore(roots)` | Retain immutable evidence and ordered resolution events under exclusion. |
| `startAgainFirstSetup(request)` | Retire an eligible attempt and stage/select an isolated workspace. No fiscal activation. |
| `resolveFirstSetupWorkspace(anchor)` | Validate fixed-path discovery, retirement history and workspace selection; return the effective roots or a resolution-only outcome. |
| `assertFirstSetupBootTarget(target)` | Refuse retired roots, incomplete selections and mismatched workspace bindings before any database open. |
| `finishFirstFiscalSetup(request)` | Complete publication only after ownership, fresh outside confirmation and an exact committed-result check. Cannot enter activation. |
| `startServerOrFirstSetupResolution(env)` | Entry wrapper choosing strict normal boot or the resolution-only listener. |

Browser requests carry an opaque inspection reference, expected revision/generation and the requested action. **Paths, eligibility, database classification and authority are server-derived.**

Use these explicit record shapes:

```ts
type RegisterAnswer =
  | {
      kind: "current-master";
      status: "Consumed" | "Not consumed" | "Unknown";
      custodian: string;
      reference: string;
      consultedAt: string;
    }
  | {
      kind: "no-current-master";
      confirmed: true;
    };

type WorkspaceBinding = {
  workspaceId: string;
  anchorVenueDir: string;
  anchorStateDir: string;
  venueDir: string;
  stateDir: string;
  resolutionId: string;
  selectionGeneration: number;
};

type ResolutionRecord = {
  version: 1;
  resolutionId: string;
  sequence: number;
  previousRecordDigest: string | null;
  attemptId: string | null;
  observedRevision: number | null;
  observedOwnerGeneration: number | null;
  evidenceDigest: string;
  evidenceReferences: string[];
  database: "empty-preactivation" | "missing" | "committed-exact" | "unknown-or-nonempty";
  authority: "original-password" | "local-empty-no-custodian";
  register: RegisterAnswer;
  action: "marker-repair" | "ownership-rebind" | "retire" | "select-workspace" | "finish-publication";
  phase: "prepared" | "applied";
  nextWorkspace: WorkspaceBinding | null;
  recordedAt: string;
};
```

Store records and original file snapshots beneath `<anchorStateDir>/first-setup-resolutions/<resolutionId>/`. Retain exact original bytes, including malformed remnants, without serving them publicly. Digests bind observations; they are not outside custody authority.

Use the existing durable writer discipline: bounded exact schemas, regular files, no symlinks, files `0600`, directories `0700`, file sync, rename and directory sync. Never prune old records to make a write succeed. Passwords, raw browser proofs and bearer capabilities never enter records or logs.

## Ordered TDD tasks

For each task: first run the focused behavioral case and retain its expected failure; implement the smallest change; rerun with actual test counts. Keep existing behavioral assertions.

## Task 1: Separate tolerant inspection from strict admission

**Files:** provisioning `first-setup-resolution.ts` and sibling tests; server `first-setup-resolution-inspection.ts` and sibling tests.

First demonstrate that inspection can describe the two interrupted pairs while ordinary readers and raw `startServer` still refuse them.

Inspection may identify marker-repair candidates only when:

- Both records independently validate, including canonical roots, identities, frozen digest and complete retained history.
- The pair is exactly `claimed + claiming` or `abandoned + active`.
- The current event has no consumption intent, stored inputs, result, activation or uncertain history.
- Existing unused-venue reads succeed and lifecycle evidence establishes preactivation.
- No staged adoption, restore, reset or contradictory trading evidence exists.

Missing, unreadable, corrupt, partly migrated and unclassifiable databases remain distinct outcomes. An exception never becomes “empty”, “not consumed” or “no custodian”. Check existence before using an opener that creates files; inspection must not migrate, checkpoint or repair the old database.

**Qualification limit:** the current claim check reads tenants and locations (`boot.ts:789`); those reads alone are not a general proof that every business table is empty. Require complete preactivation provenance as well. If that cannot establish the approved EMPTY condition using existing readers, report the exact missing proof; H2 does not authorise adding SQL or weakening the definition.

**Owner amendment, 2026-10-16 13:40:** read-only database inspection is authorised solely for this positive empty proof. Require the expected tables/columns and migration journals; any retained application row, missing schema, failed read or unknown result refuses empty-only admission. Keep the taxpayer/location classification separate. Recheck under the existing exclusions and coordinator. No database writes, migrations, fiscal writers, hashes, numbering, old fiscal assertions or root guards change. This permission does not itself enable the unused-enrolled-PDF exception or change allocation authority.


## Task 2: Implement password recovery and ownership rebind

**Files:** `first-setup-owner.ts`, resolution service, `module-operation-host.ts`, owner/evidence tests.

Add failing cases using a new browser with no old nonce or capability:

- Correct original password succeeds against valid retained state.
- Wrong password refuses.
- Missing/corrupt verification state reports that the password cannot be checked.
- Two recoveries race; only the request matching the reread evidence/revision proceeds.

Reuse `verifyPassword` and attempt-turn protections. Derive outside the database transaction, then acquire the venue exclusion and coordinator, reread everything and compare the inspected snapshot before writing.

Perform two separate operations:

1. Snapshot and repair only the eligible marker to `active` or `abandoned`. Assert the state file remains byte-identical.
2. Replace `claimNonceHash` and `capabilityHash` with hashes of fresh browser proof and capability; increment ownership generation and revision and append the ownership event. Preserve frozen identities, password verifier, inputs, results and consumption history. Use a distinct `recover` history event for the approved password-only rebind, retaining the existing stored field set and ordinary `resume` contract. Neither event authorises fiscal activation.

Invalidate both owner reconfirmations and fiscal-evidence grants. Assert old capabilities, proofs, confirmations, delayed requests and generations fail.

Abandoned remains abandoned. Its rebound capability permits resolution actions; ordinary preparation/activation authorisation must continue refusing it. A lost response requires another password recovery, never automatic restoration of an old grant.

## Task 3: Retain register answers and retirement before any switch

**Files:** resolution store/service and sibling tests.

Add failing cases for all three current-register answers, restart, duplicate submission and interruption at each durable write.

Require consultation of the actual current paper master, with custodian and reference. Default uncertain currency to **Unknown**.

- **Consumed:** preserve consumption.
- **Not consumed:** record the answer without clearing saved consumption intent.
- **Unknown:** preserve uncertainty and keep the old allocation unavailable.

Every retired attempt requires a different assignment. Reject reuse by allocation and frozen event/source bindings, including across workspace boundaries. An uploaded snapshot, valid signature or harmless check receipt does not establish current consumption or reset authority.

Password-free **Start again** requires positively established empty preactivation state, no previously enrolled custodian across retained evidence/history, and explicit confirmation that no current master exists. Record the accepted local-reset boundary. Unknown or corrupt custody evidence cannot satisfy it.

Persist retirement before selection. Preserve the old attempt, marker, database, side files, public evidence and prior history. Do not rewrite a consumed or abandoned attempt into a fresh claim.

## Task 4: Stage and durably select an isolated workspace

**Files:** provisioning `first-setup-workspace.ts`; server workspace/entry adapters and sibling tests.

Create server-named sibling workspaces under:

`<anchorStateDir>/first-setup-workspaces/<workspaceId>/{state,venue}`

Never reuse the old database path, rename old data into a disposable cleanup location or copy old trading settings into the new workspace.

Durable selection must include:

- A fixed `<anchorVenueDir>/first-setup-selection.json` discovery record.
- A matching record under the stable anchor state root.
- The applied retirement/resolution record and its evidence digest.
- A target backlink binding the selected workspace to both anchor roots, resolution ID and selection generation.

Stage directories and bindings, record retirement, then publish selection. Any incomplete or disagreeing set serves resolution only. Resume interrupted staging after fresh authorisation and reinspection; do not select orphan directories.

Every entry first discovers the **original fixed marker** and selection record. Selection authorises booting the separately bound workspace; it does not make the old pair acceptable to strict readers. Inspect the target’s own marker through the unchanged strict reader.

The new claim gets fresh attempt/node/admin/module-event IDs, a fresh password and fresh signed assignment through normal setup. Carry retirement references for exclusion/history, not old grants or allocation authority.

Keep the retained connection identity available from the stable host root. Do not regenerate missing TLS material during repair or copy old vault/business credentials into the new account.

**Old-path restoration:** retain the old-root retirement binding permanently. Admission rejects a raw boot targeting retired roots. A database reappearing at a path recorded as missing, changed retired evidence, a restored old marker/state, lost selection witness or target mismatch returns to resolution before opening either database. Never fall back to the old path when the selected target fails.

This detects restoration while host retirement evidence survives. It does not establish rollback detection after loss/replacement of all independent host evidence; do not claim otherwise.

## Task 5: Implement missing-database Start again within the approved boundary

First fail a test showing that normal boot would create a database in the old missing path. Implement pre-open resolution inspection so the old path stays missing.

Guide the owner to check retained backups and the current register. Where the evidence establishes no committed history or backup requiring recovery, record retirement and create schema only in the new isolated workspace. Require a fresh assignment; keep the old allocation unavailable regardless of its recorded answer.

**Authority boundary requiring explicit treatment:** V2’s lost-password example involving an existing custodian and consumed/unknown missing history depends on a *new custodian-signed fresh-deployment authorisation*. That mechanism is A732 and is deferred. A fresh assignment alone cannot substitute for it. Such cases remain on the page with the A732 explanation; do not implement that example through the local-empty exception. Missing database is not proof of an empty preactivation workspace.

## Task 6: Add publication-only Finish setup

**Files:** host publication helper, resolution service, `first-fiscal-activation.ts` integration and interruption tests.

Add a dedicated publication-only entry that cannot reach the activation branch. Reuse the existing publication operations and `checkedFirstFiscalCommit`; do not weaken either.

Require:

- Original-password ownership recovery with fresh proof/capability.
- Exact frozen/imported/module/venue committed-result agreement.
- Fresh outside confirmation for the committed activation.
- Matching retained publication bindings; re-enter required unstored secrets through the existing checks.

Cover commit-before-host-result, publication failure and `complete` state with an unfinished marker. Finish only unfinished host publication and completion writes. Assert zero activation calls and unchanged fiscal records, allocation results, chains and counters. A subsequent failed refresh is a reconnect/load outcome.

A missing or mismatched committed result remains uncertain. Preserve it and show guided choices; never retry activation.

## Task 7: Install one resolution-only surface across entry paths

**Files:** new resolution app/listener; `bin.ts`, `node-entry.ts`, `recovery-surface.ts`, `boot.ts` admission integration and setup browser client.

| Entry | Required ordering |
|---|---|
| Direct `bin.ts` | Resolve anchor/selection before calling strict `startServer`; unresolved setup serves resolution immediately. |
| Supervised `runEntry` | Inspect/select before staged restore/reset, replacement cleanup, ahead-check opens and normal boot. |
| Already-recovery | Inspect and mount the same resolution app before returning the generic recovery surface. |
| Raw `startServer` | Continue refusing invalid/unresolved pairs; additionally refuse retired or mismatched targets before opening them. |

Use one host service and exclusion model across these paths. Hold the anchor venue lock and, when selecting/booting another workspace, the target lock in a fixed order. Recheck after acquiring them. Existing CLI/restore checks remain effective; command entry must also refuse retired targets.

While unresolved, mount only resolution, minimal status and public connection guidance. Do not mount normal provisioning, readiness, adoption, restore or trading routes. A recovery Retry cannot clear first-setup resolution state or bypass selection. Update `recovery.json` only through its existing lock/update mechanism.

Password and private-input POSTs require the actual HTTPS listener and same-origin checks. HTTP serves public connection/bootstrap information only. The page tells the owner to reconnect to the venue network, use the known box address, install/trust the retained public certificate and reopen HTTPS without warnings. The server cannot prove the browser completed that trust step.

Use the approved EN/ES wording:

| English | Spanish |
|---|---|
| First setup was interrupted | La configuración inicial se interrumpió |
| Recover setup | Recuperar configuración |
| Start again | Empezar de nuevo |
| Finish setup | Finalizar configuración |
| Setup remains abandoned | La configuración sigue abandonada |
| Password not accepted | Contraseña no aceptada |
| Forgot password | He olvidado la contraseña |
| We cannot check the saved password | No podemos comprobar la contraseña guardada |

Name the deferred paths plainly, with no enabled mutation endpoint:

- **A731 — Recover from backup / Recuperar desde una copia:** not yet available from this page; explain the named recovery-key and backup prerequisites.
- **A732 — Keep old data and start fresh on this box:** not yet available when business data exists or may exist and the password is lost.
- **A733 — Set up secure connection:** not yet available when the box’s certificate is missing or unusable. HTTP explains this without collecting secrets.

Keep evidence and selections intact while waiting. Give concrete document/custodian guidance; no terminal instructions, generic “incident handling” destination or misleading reset button. Add the three numbered before-go-live backlog entries and update affected current runbooks; retain historical reviews as historical.

## Final entry-path and browser qualification

Run these after the focused red/green tasks:

- **Real processes:** direct `bin.ts`, supervised `runEntry`, already-recovery and raw `startServer`; interrupted claim/abandonment, exact committed publication, missing database and normal unaffected boots. Exercise explicit, omitted and conflicting state-root settings against fixed venue discovery.
- **Durability/races:** interruption before/after every repair, rebind, retirement, staging, selection and completion write; response loss; two browsers/processes; stale requests; occupied venue locks. Assert preserved original bytes, no old-path database creation, no fallback and no duplicate activation.
- **Restoration controls:** restore old state/marker/database to the original path; lose/corrupt either selection witness; substitute a target/backlink; point directly at retired roots. Each refuses before database work. Include a correctly selected workspace and ordinary completed venue as positive controls.
- **Boundaries:** consumed/unknown allocations remain unavailable; password-free reset refuses nonempty/unknown/enrolled-custodian cases; HTTP rejects secrets; unauthorised status exposes no credentials or business records; deferred actions perform no restore, fresh-deployment authorisation or certificate operation.
- Run the original plan’s relevant fiscal checks and protected-path comparison unchanged. Keep actual-paper acceptance separate. Obtain implementation review of this redesigned candidate; earlier reviews do not cover it.

| Browser matrix | Required states |
|---|---|
| EN and ES × light and dark × 390 and 1280 px | Password recovery/refusal/uncheckable verifier; abandoned outcome; eligible and refused Start again; register answers; missing database; Finish setup; interrupted selection; all three deferred explanations; HTTP connection guidance. |

Exercise the real served pages and shared controls, inspect every capture, verify computed theme colours, keyboard/focus behavior, wrapping, inline/bottom errors, quiet unavailable actions and accessibility in both themes. Static drawings and API-only passes are not rendering evidence.