# A1308 file layout fl6: the TLS repair's record in `flows/tls-repair/`, one old copy kept, and the leaf as one file

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementers are dispatched as `subagent_type: "implementer"`.

**Goal:** A certificate repair keeps its progress in `<state>/flows/tls-repair/record.json`, keeps
only the newest set of old certificate files in `tls/repair/`, and deletes both after the next
start that stays up; the box's web certificate and its private key live in one file,
`tls/server.pem` (certificate first, then key), so no crash can leave a key beside the wrong
certificate.

**Architecture:** `box-tls-repair.ts` (`:283-379`) moves its pending record and its candidate (which
holds private keys, `:338-363`) out of `tls/` into the flow folder, and writes the archive into one
folder `tls/repair/`, deleting a finished earlier one first. The node entry's "stayed up" callback
(`node-entry.ts:689`, 120 s after a full start, `:69`) ends a finished repair. The leaf certificate
and key are written together as one PEM file with `writeFileDurable`, **the certificate block
first**; `certFile` and `keyFile` both name it, so the listeners (`tls.ts:24-70`) do not change.
The order matters because the box's own TLS health check, `healthy()` in `box-tls-repair.ts:150-181`,
reads the certificate's extended key usage with node-forge's `certificateFromPem` (`:173-176`),
which reads only the first PEM block; that check runs at every start (`inspectBoxTls`, `:205`,
called from `needsConnectionBootstrap`, `recovery-listener.ts:81-103`, at `node-entry.ts:387`) and
again right after a repair installs its files (`box-tls-repair.ts:374`).

**Tech Stack:** TypeScript 7, `node:tls`, Vitest 4.1.12.

**Spec:** [`files.md`](../specs/2026-11-02-rationalisation/files.md) §1 (the TLS repair archive
paragraph; "A private key held by a flow is an attachment"), §2 rows `tls/repair/` and
`flows/tls-repair/`, §3 rows 3 and 5, §5 T6; README §10 "A certificate repair's older copy is
deleted after the next healthy start". Slice rules: [`2026-11-08-a1308-slice-rules.md`](2026-11-08-a1308-slice-rules.md).
Lines at `649b7576e0`.

**Who lands:** the lane (no fiscal file or value).

**Depends on A1379 part 2?** Through fl1–fl3: this slice touches no first-setup file, but fl1–fl5
all wait for A1379 part 2 (the owner's three questions, `docs/backlog/setup.md:575`), so fl6 does too.

**First line of the pull request:** "On its first start after this change a box opens the
connection repair page, because its certificate file has a new name and a fresh certificate is
refused while the old certificate authority is kept (`box-secrets.ts:202-210`); someone must press
Repair there. The repair issues a new certificate from the kept certificate authority, so phones
that trust the box keep trusting it, and deletes the old certificate files and every older repair
copy. Backups made before this change cannot be restored (their archive carries the old
certificate file names; pre-live, CLAUDE.md §3 last data rule)."

## T6 — run twice on 2026-11-08

**The plan writer's run.** A throwaway script outside the repository (Node v26.13.0, macOS): a
P-256 certificate and its key concatenated into one PEM file, in either order, passed as both
`key` and `cert` to `tls.createSecureContext` printed `ok`; an HTTPS server built from that one
file served the certificate (`served CN: localhost status 200`). Control: one file holding a
different key beside the certificate printed `refused ERR_OSSL_X509_KEY_VALUES_MISMATCH`. That run
never called node-forge, which the box's health check also uses, and used a P-256 key where the box
mints RSA-2048 (`self-signed-cert.ts:156`).

**The reviewer's run, repeated by the plan fixer from `apps/server` (Node v26.13.0, node-forge as the
package resolves it):** an RSA-2048 certificate with `extendedKeyUsage=serverAuth` and its key,
written key-first, cert-first, and cert alone, each read by `new X509Certificate`,
`createPrivateKey`, `forge.pki.certificateFromPem` and `createSecureContext({ key, cert })`.
Key-first: every reader `ok` except forge, which threw `Could not convert certificate from PEM; PEM
header type is not "CERTIFICATE"`. Cert-first: all four `ok`. Cert alone (control):
`createPrivateKey` and `createSecureContext` threw `ERR_OSSL_UNSUPPORTED`, so the probe does see a
missing key. So one file works **only certificate first**: written key-first, `healthy()` would
return false on every box, every start would open the repair page, and the repair itself would be
refused at `box-tls-repair.ts:374`. The design's folder-swap fallback is still not needed. Task 3
Step 1 runs the box's own health check over the file the code writes, under CI's Node.

## Global Constraints

- Rules §1, §4, §5, §8, §9. `git commit -s`; never `--no-verify`.
- The whole repair still runs under `withRecoveryLock` (`box-tls-repair.ts:285`); the stayed-up
  ending takes the same lock.
- `tls/` survives a plain reset (fl1); `flows/` does not. A reset in the middle of a repair loses
  the record and keeps `tls/repair/`; the next repair starts a new operation (Review Focus 3), and
  if the certificate is healthy the next start that stays up removes `tls/repair/` (What it builds
  4).
- Files keep mode 0600; folders 0700.

## What it builds

1. Layout: `TLS_REPAIR_FLOW_DIR = "flows/tls-repair"`, `TLS_REPAIR_DIR = "tls/repair"`,
   `SERVER_PEM_FILE = "tls/server.pem"`.
2. Repair: `pendingPath` (`box-tls-repair.ts:43`) → `flows/tls-repair/record.json`; `candidate.json`
   → `flows/tls-repair/candidate.json`; the archive (`:292-310`) → `tls/repair/` (members and
   `manifest.json`), and Phase 1 first removes a `tls/repair/` left by a repair whose record is
   gone or `complete: true`. Members: `ca.crt`, `ca.key`, `server.pem` (today's `names`, `:31`,
   lose `server.crt`, `server.key` and `server.crt.previous`). The install loop (`:365-371`)
   installs `ca.crt`, `ca.key` (unless `trust: "retained"`) and `server.pem`. After the install
   passes `healthy()` (`:374`) and before the record is marked complete, the repair deletes the
   names this slice retires, each with `removeAndSync` and each only if present: `tls/server.crt`,
   `tls/server.key`, `tls/server.crt.previous`, `tls/repair-pending.json` and the folder
   `tls/repair-archive/` (which holds a copy of every certificate authority key any earlier repair
   replaced). They are one constant, `RETIRED_TLS_NAMES`, in `box-tls-repair.ts`. This is not
   compatibility code: nothing reads them; it removes private keys a box would otherwise keep
   forever, and every box passes through this repair once (the PR's first line).
3. `assertNoPendingTlsRepair` (`box-secrets.ts:307-319`) reads the flow record; the fresh-mint
   refusal (`:207-210`) checks `tls/repair/`.
4. `endFinishedTlsRepair(stateDir): Promise<void>` in `box-tls-repair.ts`: under
   `withRecoveryLock`, when inspection says `healthy` and either the record says `complete: true`
   or there is no record (a plain reset removed `flows/`, fl1, but kept `tls/repair/`): remove
   `tls/repair/` (`removeAndSync`, recursive), then, if the flow folder exists, rename
   `flows/tls-repair` into `scratch/` and remove it. A record with `complete: false`, or an
   inspection that is not `healthy`, leaves both. Called from the stayed-up callback at
   `node-entry.ts:689` beside `persistState`, its failure logged as `tls.repair_cleanup_failed` and
   never thrown.
5. The leaf: `box-secrets.ts:55-62` returns `certFile` and `keyFile` both
   `<state>/tls/server.pem`; first mint (`:217-220`) and `reissueBoxLeafLocked` (`:256-305`) write
   `certPem + keyPem` — **certificate first** (T6) — with one `writeFileDurable`; the `.previous`
   copy and the second rename go.
   `mintedBoxLeaf` (`:117-121`) checks one file. Every other reader re-pointed: `boot.ts` (its
   `server.crt` mention), `state-secrets.ts:16-23` (`RECOVERY_FILES` lists `tls/server.pem`),
   `backup-verification-secrets.ts:116-119`, `restore-secrets.ts:15,46`, `restore.ts`,
   `packages/handover/src/manifest.ts:131-136` (one row `tls/server.pem`, destination-owned),
   `scripts/dev-server-proxy.ts:30-31`, `apps/print-agent/src/dev.ts:49`.
6. `scripts/durable-writes.test.ts` drops `box-secrets.ts` from its allowed map (no rename left
   there).

## What it leaves out

| Left out | Why | Who |
| --- | --- | --- |
| The certificate authority's own two files (`ca.crt`, `ca.key`) written separately at first mint | files.md names only the leaf (row 3); the CA is written once and checked on every start | — |
| An "undo the repair" action | None exists (`box-tls-repair.ts` reads the archive only to resume); files.md's "lets a repair be undone" describes manual recovery | — |
| `tls/venue-ca.*` | Adoption (U5); unchanged | — |
| Operator TLS (`config.ts:472-480`) | Operator-supplied paths; unchanged | — |

## Files

- Modify: `packages/store/src/state-layout.ts`, `apps/server/src/box-tls-repair.ts`,
  `apps/server/src/box-secrets.ts`, `apps/server/src/node-entry.ts:689`, the readers in What it
  builds 5, `scripts/handover-manifest-complete.test.ts` if it pins the two names,
  `scripts/durable-writes.test.ts`, `apps/server/README.md:92`, `deploy/README.md:415-420` (the
  `tls/` paragraph), `apps/server/src/testing/box-authority.ts`,
  `apps/server/src/testing/backup-verification-fixture.ts:292-293`,
  `apps/server/src/testing/stream-loop-scenario.ts:451,557,582`.
- Test: `box-tls-repair.test.ts`, `box-tls-repair.process.test.ts`, `connection-bootstrap.test.ts`,
  `connection-bootstrap.entry.test.ts`, `box-secrets.test.ts`, `node-entry.test.ts`, and the 33 test
  files naming `server.crt`/`server.key` (paths only). `restore-secrets.ts:15-20`'s comment names
  `tls/server.crt.previous`, which this slice removes: cut that clause.

## Size

Estimated: code ~225 (repair ~90, retired names ~10, leaf ~50 net of ~45 deleted, ending and hook
~45, readers ~30); tests ~400 (new cases ~210, 33 files of path edits ~190; 33 re-counted at
`5338b917a2` with `git grep -l -P 'server\.(crt|key)\b' -- '*.test.ts' '*.test.mjs'`); docs ~15.
**Total counted ~640.**

## Finish line

- `git grep -n -P 'repair-pending\.json|repair-archive|server\.(crt|key)\b' -- apps packages scripts`
  prints only the `RETIRED_TLS_NAMES` lines in `apps/server/src/box-tls-repair.ts` and the test
  that seeds those files. `-P`, not `-E`: on git 2.56 `-E` treats `\b` as matching nothing, so the
  `-E` form printed 21 lines (only the first two names) where `-P` printed 286 at `fe2661badd` — a
  check that would pass with the old names still present.
- `pnpm --filter @waitron/server exec vitest run src/box-tls-repair src/box-secrets src/connection-bootstrap src/node-entry.test.ts src/recovery-listener src/tls.test.ts src/rebuild-first-start src/state-secrets src/backup-verification-secrets src/restore-secrets`.
- `pnpm --filter @waitron/handover exec vitest run src/manifest.test.ts`;
  `pnpm exec vitest run scripts/state-layout.test.ts scripts/durable-writes.test.ts scripts/handover-manifest-complete.test.ts`.
- Typecheck server, handover, store, print-agent; `pnpm format:check`.
- Open the connection repair page in a browser after a repair on the dev stack (`wa-wt onboarding
  <worktree>`, delete `tls/server.pem`, restart) and see the box served over HTTPS again.

## Expected protection-list difference

**EQUAL.**

## Stop points

Rules §5, plus: the in-repository T6 case or either "inspects as healthy" case (Task 3 Step 1)
fails under CI's Node with the certificate written first: stop; the fallback is a folder swap (or
reading the key usage through Node's `X509Certificate` in place of forge) and the watcher confirms
it.

## Needs

fl1, fl2 (scratch, for the ending) and fl3 landed, and so A1379 part 2 (see "Depends on A1379 part
2?" above).

## Review Focus

1. A repair cut after archiving resumes from `flows/tls-repair/record.json` and verifies
   `tls/repair/` against its manifest (existing resume cases, paths only).
2. A second repair after a finished first one leaves exactly one `tls/repair/` holding the second's
   old files (Task 1).
3. A plain reset during a cut repair, then a start: the box offers the repair page; a new repair
   replaces `tls/repair/` and succeeds (Task 1).
4. The stayed-up callback ends a finished repair; a start that fails before 120 s leaves it
   (Task 2).
5. A box whose `server.pem` holds a key that does not match its certificate is reported
   `repair-required`, not served (Task 3).
6. A freshly minted box, and a box after a reissue, inspect as `healthy` through the real
   `healthy()` — the check a key-first file fails (Task 3).
7. The first repair after this lands leaves no `server.crt`, `server.key`, `server.crt.previous`,
   `repair-pending.json` or `repair-archive/` in `tls/` (Task 1).

---

### Task 1: The repair's record and one archive

- [ ] **Step 1:** Failing cases in `box-tls-repair.test.ts`: `"the pending record and candidate live
  in flows/tls-repair"`; `"a second repair keeps only its own old files in tls/repair"`;
  `"a repair after a reset that lost the record replaces tls/repair and succeeds"`; `"a repair
  deletes the retired certificate names"` (seed `tls/server.crt`, `tls/server.key`,
  `tls/server.crt.previous`, `tls/repair-pending.json` and a `tls/repair-archive/<uuid>/ca.key`
  beside a kept `ca.crt`/`ca.key` and no `server.pem`; repair; expect none of the five present and
  `inspectBoxTls` `healthy`).
- [ ] **Step 2:** Run; fail. Change `box-tls-repair.ts` and `box-secrets.ts:207-210,307-319` per What
  it builds 2-3. Keep `writeDurableHostJson` for the record, candidate and manifest.
- [ ] **Step 3:** Re-point the existing repair and connection-bootstrap tests (paths only). Run.
  Commit.

### Task 2: A finished repair ends after a start that stays up

- [ ] **Step 1:** Failing cases: in `box-tls-repair.test.ts`, `"endFinishedTlsRepair removes a
  finished repair and keeps an unfinished one"`; `"endFinishedTlsRepair removes tls/repair when no
  record is left and the certificate is healthy"`; in `node-entry.test.ts`, `"the stayed-up callback
  ends a finished TLS repair"` using its existing `scheduleStayedUp` stub, and `"a start that fails
  before it stays up leaves the repair"`.
- [ ] **Step 2:** Run; fail. Implement `endFinishedTlsRepair` and call it in the stayed-up
  callback. Run; pass. Commit.

### Task 3: The leaf as one file

- [ ] **Step 1:** Failing cases in `box-secrets.test.ts`: `"the leaf is one PEM file that a TLS
  server accepts"` (mint, then `tls.createSecureContext({ key: pem, cert: pem })` does not throw —
  T6 inside the repository); `"a freshly minted box inspects as healthy"` and `"a box after a
  reissue inspects as healthy"` (mint with `ensureBoxSecrets`, `box-secrets.ts:186`, or reissue
  with `reissueBoxLeaf`, `:247`, into a temporary state folder, then call `inspectBoxTls`,
  `box-tls-repair.ts:205`, which runs `healthy()`, `:150-181`, including the forge read at
  `:173-176`; expect `state: "healthy"`). Control in the same file: write the same certificate and
  key key-first into `server.pem` by hand and expect `repair-required`. What the failing case
  prints if the code writes key-first: `expected 'repair-required' to be 'healthy'` — forge's
  throw is swallowed by `healthy()`'s `catch`, so no forge message reaches the test output. Use the
  mint's existing key-pair seam (`self-signed-cert.ts:153-156`) if a 2048-bit generation is too
  slow for the file. `"a reissue writes the leaf with one flushed rename"` (order spy: sync,
  rename, folder sync, and exactly one rename); in `box-tls-repair.test.ts`, `"a server.pem whose
  key does not match is repair-required"`.
- [ ] **Step 2:** Run; fail. Implement What it builds 5. Re-point every reader and the test fixtures.
- [ ] **Step 3:** Run the Finish line. Update `scripts/durable-writes.test.ts`, the two READMEs.
  `pnpm format:check`. Commit.

## After the tasks

`/finish-branch` with this plan as its note.
