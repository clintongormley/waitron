# A1308 environment, PR 8 of 8: the two leftovers on the fiscal path — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**OWNER LANDS THIS PULL REQUEST** (rules §6): Task 1 changes where AEAT sending learns which host to
send to, and Task 2 changes what a staged restore, which starts a new fiscal chain, accepts as its
node recovery key.

**Goal:** (1) The AEAT certificate's kind (`sello` or `representante`, which picks AEAT's host) is
read from the certificate's install record instead of being sealed beside the certificate. (2) The
server's start stops taking the node recovery key and the recovery operation file from its
environment when a staged restore's record lacks them; they stay inputs to the `restore` command.
Each task starts with the measurement the design asks for and has a named fallback.

**Architecture:** (1) Every certificate install already writes its kind to the install record in the
same transaction that seals it (`packages/fiscal-verifactu/src/certificate-install.ts:236-250`,
`provisioning-secret.ts:101-125`; table `fiscal_certificate_installs`, renamed
`verifactu_certificates` by [fi1](2026-11-08-a1308-fi1-verifactu-names.md)). The sealed copy is a duplicate. `fiscal.aeat` seals
`pfxBase64` and `passphrase`; readers take the kind from `latestInstall`. (2) `runStagedRestore`
falls back to `deps.recoverySecret` and `deps.recoveryOperationPath`, which `node-entry.ts:632-633`
fills from the process environment (`apps/server/src/restore-request.ts:535-561`). Both fall-backs
go.

**Tech Stack:** TypeScript, Vitest.

**Spec:** (1) [`tables-venuebox.md`](../specs/2026-11-02-rationalisation/tables-venuebox.md) §1.16
("the certificate's `certKind`" is among the settings that are not secret) and
[`tables-fiscal.md`](../specs/2026-11-02-rationalisation/tables-fiscal.md) (`verifactu_certificates`,
"all 14 columns" unchanged; `:297-307`); (2) [`environment.md`](../specs/2026-11-02-rationalisation/environment.md)
§3 rows `WAITRON_NODE_RECOVERY_KEY` and `WAITRON_RECOVERY_OPERATION_FILE`, §5 measure 1. Rules:
[the slice rules](2026-11-08-a1308-slice-rules.md). Part overview: [env1](2026-11-08-a1308-env1-tuning-constants.md).

**A decision this plan makes, for the owner to confirm in review.** tables-venuebox §1.16 says
`certKind` moves to "its owning module's settings document", but tables-fiscal §2 says the fiscal
module keeps no settings document, and the install record already holds the same value. This plan
reads the install record: it removes the duplicate instead of making a third copy. If the owner
prefers a `verifactu` settings document, Task 1 is replaced and nothing else here changes.

**Needs:** env7 (the list declares the two names; Task 2's fallback, if taken, edits their source);
[fi1](2026-11-08-a1308-fi1-verifactu-names.md) landed (`fiscal_certificate_installs` →
`verifactu_certificates`) and any later fi* plan that moves `aeat-transport.ts`. Cites read at
`a086eedfb7`.

**No venue reset.** A box whose sealed `fiscal.aeat` still carries `certKind` is refused by the
narrowed purpose (`credentials.invalid_payload`) until the certificate is installed again; before go-
live that box is re-set up (CLAUDE.md §3). The pull request's first line says so.

## Global Constraints

- The error a sender raises for a missing or bad kind stays `server.credential_unusable` with
  `{ purpose: "fiscal.aeat", field: "certKind" }` (`aeat-transport.ts:44-47`), so the alert and the
  dashboard wording that read it do not change.
- No fiscal record, invoice number, hash input or chain step changes (CLAUDE.md §5). Neither task
  touches `registros_facturacion` / `verifactu_records` or `computeHuella`.
- Tests keep their assertions; a case whose subject is the removed fallback is deleted and named.

## Review Focus

1. After a restore or a promotion the box has a new node id; the install record is `local` and keyed
   by node. If the latest install for the new node is missing, AEAT sending breaks where it works
   today. Task 1 step 1 measures this before anything changes.
2. A certificate sealed in setup whose file did not open gets no install record
   (`provisioning-secret.ts:89-91`). Today sending then fails on the file; after this it fails on the
   kind first. Both are `server.credential_unusable`; the field differs.
3. Backup verification checks the archived certificate's kind (`backup-verification-secrets.ts:54-59`);
   it must read the archived install record for the archive's source node.
4. A staged restore record written by the web form carries the key in a staged file
   (`restore-request.ts:556-561`); removing the environment fallback must not touch that path.
5. Waitron Cloud's authorised-archive fixture sets `WAITRON_NODE_RECOVERY_KEY` on the `restore`
   command (`deploy/test-cloud/test-fixtures/snapshot-authorised-archive.test.ts:95` in its
   repository): a command input, which stays.

---

## What it builds

1. `fiscal.aeat` purpose = `["pfxBase64", "passphrase"]`; `certMaterialFrom` takes the kind from the
   install record; the setup and dashboard installs seal two fields.
2. `runStagedRestore` takes the key and the operation only from the staged record; `node-entry.ts`
   passes neither from the environment; the list (env7) gives both names the single source
   `command`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| The dead `WAITRON_FISCAL_*` set, `WAITRON_RECOVERY_PUBLIC_DIR`, `WAITRON_RECOVERY_INCIDENT_DIR` and measure 4 | [fi11](2026-11-08-a1308-fi11-dead-fiscal-environment.md) (owner lands) |
| Certificate expiry reminders onto `outgoing_mail` | [fi10](2026-11-08-a1308-fi10-certificate-reminders-queue.md) |

## Interfaces

```ts
// packages/fiscal-verifactu/src/aeat-transport.ts
export function certMaterialFrom(
  payload: Record<string, string | undefined>,
  kind: string | null,              // latestInstall(tx, nodeId)?.kind ?? null
  ref: { purpose: string },
): CertMaterial;                     // throws server.credential_unusable { field: "certKind" } when kind is null or not a CertKind
export function readCertMaterial(db: Database, ring: KeyRing, nodeId: string): Promise<CertMaterial>;

// apps/server/src/restore-request.ts — StagedRestoreDeps loses two fields
//   recoverySecret?: unknown;          (deleted, :337)
//   recoveryOperationPath?: string;    (deleted, :338)
```

## Files

- Modify: `packages/credentials/src/purposes.ts:19-27`, `purposes.test.ts`;
  `packages/fiscal-verifactu/src/aeat-transport.ts:23-70` and every caller of `readCertMaterial` /
  `certMaterialFrom` (`git grep -n "readCertMaterial\|certMaterialFrom" -- packages apps ':!*.test.ts'`);
  `packages/fiscal-verifactu/src/certificate-install.ts:236-240`; `provisioning-secret.ts:101-109`;
  `certificate-diagnosis.ts:100-115`; `backup-verification-secrets.ts:30-70`;
  `apps/server/src/fiscal-certificate-api.ts` (only if it reads the sealed kind; its request field
  `certKind`, `:128`, stays: the kind is still chosen by the person installing).
- Modify: `apps/server/src/restore-request.ts:335-340,535-561`; `apps/server/src/node-entry.ts:632-633`;
  `apps/server/src/restore-request.node-key.test.ts:321` (the argument only).
- Tests sealing `certKind`: `git grep -l "certKind" -- '*.test.ts' '*/testing/*.ts' 'packages/fiscal-verifactu/test/*.ts'`
  (for example `apps/server/src/testing/backup-verification-fixture.ts:263`).

## Size

Counted, hand-written: about 70 lines of code and about 150 lines of tests if both tasks are built.
Task 1's measurement will probably give the failing result: `latestInstall` looks up by node id
(`certificate-record.ts:8-13`), and no code was found that moves install rows to a restored or
promoted box's new id (read, not run). Then Task 1 ends at step 1 with its fallback (`certKind` stays
sealed; the throwaway measurement is not committed, only the decision line in the pull request), and
the pull request is Task 2 alone: about 20 lines of code and 30 of tests. About 2½ hours either way,
because both measurements run the restore, promotion and hour-recovery suites.

## Finish line

1. `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/aeat-transport.test.ts src/certificate-install.test.ts src/provisioning-secret.test.ts src/certificate-diagnosis.test.ts src/backup-verification-secrets.test.ts src/write-path.e2e.test.ts src/inmutabilidad.test.ts`
   (the last two unedited, as fiscal guards) prints a `Tests` count with no failure.
2. `pnpm --filter @waitron/server exec vitest run src/restore-request.node-key.test.ts src/recovery-restore-input.test.ts src/recovery-operation-input.test.ts src/hour-recovery-placement-1.test.ts src/hour-recovery-placement-3.test.ts src/boot.restore.test.ts src/restore.test.ts`
   prints a `Tests` count with no failure.
3. `pnpm --filter @waitron/credentials exec vitest run src/purposes.test.ts` passes.

## Expected protection-list difference

EQUAL. Any line is a stop.

## Stop points (beyond rules §5)

1. **Task 1 measure** gives the failing result (below): stop; the fallback is to keep `certKind`
   sealed and close Task 1 with a one-line decision in tables-venuebox §1.16's place in the pull
   request. The owner decides (rules §5.4).
2. **Task 2 measure (environment.md §5 measure 1)** gives the failing result: stop; the design's
   fallback is that the server keeps the environment fallback and the list gives both names the
   source "command or start input". The watcher confirms before you take it.

---

### Task 1: the certificate's kind comes from its install record

- [ ] **Step 0:** record the base protection list (rules §3).
- [ ] **Step 1: Measure.** Say first what failing looks like: after a restore, and after a
  promotion, `latestInstall(db, <the box's new node id>)` is `undefined` while the sealed
  `fiscal.aeat` credential is present. Write a throwaway case (not committed) in the restore suite
  (`apps/server/src/boot.restore.test.ts`, or the base's equivalent) and in the promotion suite
  (`boot.promote.test.ts`) that installs a certificate, restores or promotes, and prints
  `latestInstall` for the new node id. Control in the other direction: the same print before the
  restore shows the row. Paste both outputs into the pull request. If the failing result appears,
  stop (stop point 1).
- [ ] **Step 2: Failing cases.**
  - `aeat-transport.test.ts`: `"takes the kind from the install record"` — sealed payload without
    `certKind`, kind `"sello"` → `certKind: "sello"` and the sello endpoint;
    `"no install record, no kind"` — kind `null` → `server.credential_unusable` `{ field: "certKind" }`;
    `"an unknown kind is unusable"` — `"other"` → the same.
  - `certificate-install.test.ts` and `provisioning-secret.test.ts`: the sealed payload has exactly
    `pfxBase64` and `passphrase`; the install record's kind is what was chosen.
  - `backup-verification-secrets.test.ts`: an archive whose install record for its source node says
    `representante` passes; one with no install record for that node is `"invalid"`.
  - `purposes.test.ts`: `PURPOSES["fiscal.aeat"]` equals `["pfxBase64", "passphrase"]`.
- [ ] **Step 3: Run; fail. Step 4: Implement** per **Interfaces**; each caller passes its own node
  id (the drain and the diagnosis already hold one: `certificate-diagnosis.ts:96` reads
  `latestInstall(deps.db, deps.nodeId)`). Backup verification reads
  `select kind from <install table> where node_id = ? order by installed_at desc limit 1` with the
  archive's `context.source.nodeId` (the query style of `backup-verification-secrets.ts:70`).
- [ ] **Step 5: Run** finish lines 1 and 3; pass. **Step 6: Commit:**
  `git commit -s -m "The AEAT certificate's kind is read from its install record (A1308 env8)"`

### Task 2: the start no longer takes the node recovery key from its environment

- [ ] **Step 1: Measure 1.** Say first what failing looks like: with the fallback removed, a restore
  or hour-recovery suite fails with `invalid staged restore request` or a node-recovery-key refusal
  in a flow that did not set the key on the command. List who writes a staged record and whether it
  sets `nodeRecoveryKey: true` or `recoveryOperation`:
  `git grep -n "nodeRecoveryKey\|recoveryOperation:" -- apps/server/src ':!*.test.ts'`. Then delete
  `node-entry.ts:632-633` and the two `deps.*` branches (`restore-request.ts:537-539`, `:561`) and
  run finish line 2 plus `apps/server/src/testing/stream-loop-scenario.ts`'s callers
  (`pnpm --filter @waitron/server exec vitest run src/stream-loop.e2e.test.ts` after
  `node scripts/setup-litestream.mjs && node scripts/setup-s3-test-server.mjs`). Check what
  `stream-loop-scenario.ts:495-512` hands `WAITRON_NODE_RECOVERY_KEY` to: a `restore` command is a
  command input (fine); a server start is the failing case. Control: the same suites at the base pass.
  The Cloud lane runs `snapshot-authorised-archive.test.ts` against this branch and reports (see
  below). If the failing result appears, stop (stop point 2).
- [ ] **Step 2: The fallback's argument.** `restore-request.node-key.test.ts:311-329` ("refuses a
  %s staged key without restoring or falling back to the environment", three cases: missing, empty,
  oversized) keeps all its assertions: the refusal, nothing restored, no request left. Only the
  `recoverySecret: "environment fallback"` argument (`:321`) goes, because the field no longer exists;
  the title keeps "or falling back to the environment", which is still true. Every other case keeps
  its assertions.
- [ ] **Step 3: Run** finish line 2; pass. Set the two names' source to `command` in
  `packages/shared/src/environment-variables.ts` (env7) and their readers to `["restore"]`.
- [ ] **Step 4: Protection list:** nothing. **Step 5: Commit:**
  `git commit -s -m "The server start stops reading the node recovery key from its environment (A1308 env8)"`,
  then `/finish-branch`.

## Waitron Cloud (Cloud lane)

No Cloud code changes. Before this lands, the Cloud lane runs its
`deploy/test-cloud/test-fixtures/snapshot-authorised-archive.test.ts` against this branch's checkout
(`WAITRON_CHECKOUT=<this worktree>`) and posts the `Tests` count on the pull request; that fixture
sets `WAITRON_NODE_RECOVERY_KEY` on the `restore` command (`:95`), which stays a command input.
