# Backup/Restore BR-3 — the restore consumer — Implementation Plan

> **2026-09-06 (SP-3d):** The empty-hook contract and no-fresh-chain statements below record BR-3 as
> shipped. `RestoreHookContext` and `invokeRestoreHooks` are removed; `runRestoreHooks` runs typed
> hooks in one tenant transaction. Cold restore validates identity completeness before setting any
> identity aside, restores and migrates, runs hooks and settles series, then writes secrets last.
> Rejoin composes `validateArtifact` and `writeValidated`, migrates, and skips hooks and identity
> replacement. See the [SP-3d design](../specs/2026-09-06-module-sp3d-fiscal-restore-hook-design.md)
> §4–§5.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Restore a Waitron node from a BR-2 backup archive — decrypt, verify a compatibility gate, `pg_restore` the DB into a fresh target, restore the media blobs and on-box secrets (path-traversal-guarded), and invoke each module's restore hook (empty in v1). The `pg_restore` consumer that clears the R3-rejoin + promote-Slice-4 gate.

**Architecture:** The inverse of BR-2. `get(artifact)` → `decryptArtifact(recoveryKey)` → `unpackArchive` → **compatibility gate** (read `manifest.json`) → **entry-name traversal guard** (all entries) → `pg_restore` `db.dump` into a fresh DB over a privileged admin connection → restore `media/*` into `mediaDir` and `secrets/*` into `stateDir` → invoke module restore hooks. Exposed as composable steps + a full `restoreFromArtifact` + a `restore` CLI verb. **No fresh-chain minting** (BR-4) and **no rejoin identity reconciliation** (R3 composes BR-3's steps).

**Tech Stack:** TypeScript (ESM, `.js` specifiers), `pg_restore` shell-out (mirroring `pg-dump.ts`), `@waitron/migrations` (`expectedSchemaVersion`), `@waitron/db` (`createPostgresDb`), Node `node:crypto`/`node:fs`, Vitest (DI for unpack/gate/guard; `useTemplateDb` + in-container `docker exec` for the real `pg_restore` receipt).

**Spec:** `docs/superpowers/specs/2026-09-04-backup-restore-regime-design.md` (§4/§5/§7 — BR-3 is the restore consumer; the fresh-chain reintegration is BR-4).

---

## Design decisions (resolved from the BR-3 terrain survey; FLAGGED for owner review at land — this touches the immutable fiscal ledger)

1. **Restore into a FRESH EMPTY DB.** `pg_dump --format=custom` (BR-2) captures schema **and** data, so `pg_restore` reconstructs both. BR-3 targets a fresh/empty database (the operator or a caller provides an empty target DB; BR-3 does not `DROP DATABASE` — no such primitive exists and it is destructive). `pg_restore --no-owner --dbname=<admin conn> <file>` mirrors the runbook.
2. **Compatibility gate compares against the RESTORING BINARY's `expectedSchemaVersion`.** The fresh DB is empty (applied=0) until the restore reconstructs the backup's schema. So the gate asks "can THIS binary run against the backup's schema?": refuse if `manifest.modules[m] > expectedSchemaVersion(<this code>, m)` for a module this node runs (the backup is newer than the binary handles), or if `manifest.environment !== config.environment` (one-DB-per-environment). A module in the manifest this node does not run → its tables restore but sit inert (note, do not refuse).
3. **FISCAL-SAFETY BOUNDARY (conservative).** BR-3 restores `registros_facturacion`/`cadenas`/`registro_sif` **verbatim** (reconstruction). It **NEVER mints a fresh chain and NEVER makes the box trade-ready on the restored chain.** Trading-readiness is enforced OUTSIDE BR-3: R3-rejoin returns a **fenced-secondary** (R1 #214 — does not file), and cold-DR-to-primary-trading requires **BR-4's fiscal `restore` hook** (fresh chain / disjoint series), which BR-3 invokes as an **empty hook in v1**. So BR-3 v1 fully delivers the restore *mechanism* + unblocks R3-rejoin; cold-DR *trading* is completed by BR-4. This preserves CLAUDE.md §5 (a restored box must not trade on the old chain → unrecoverable huella fork).
4. **Secrets scoping via composable steps.** BR-3 v1's full `restoreFromArtifact` restores DB + media + secrets (the cold-DR "restore my own box" path). The steps (`restoreDatabase`, `restoreMedia`, `restoreSecrets`, `invokeRestoreHooks`) are exposed so R3-rejoin can compose the subset (restore DB+media, SKIP secrets to keep its own identity, then re-fence). R3's identity reconciliation is R3's wiring, not BR-3's.
5. **Codes + guard.** New `restore.*` prefix for gate rejections; reuse `backup.artifact_invalid`/`backup.archive_invalid` (decrypt/unpack) + `recovery.passphrase_invalid`. One up-front **entry-name traversal guard** over ALL entries (lexical + realpath, mirroring `unpackBundleToDir` `state-secrets.ts:63-74`), throwing `restore.unsafe_entry_path`.
6. **Manifest is IN the archive** (BR-2 shipped it as an encrypted entry, not a plaintext sidecar). The gate runs post-decrypt/unpack — fine, since a restore needs the recovery key anyway.

## Global Constraints

- **Never make a restored box trade-ready on the old chain** (§5; decision 3). BR-3 restores verbatim + invokes an empty restore hook; fencing/BR-4 own trading-readiness.
- **The restore connection is a privileged admin/owner role** (superuser/BYPASSRLS class — the same class the backup was taken with), NOT `app_user` (which cannot recreate FORCE-RLS objects). Sourced from env (a `WAITRON_RESTORE_DATABASE_URL` / admin var), never argv. Refuse an empty connection string (§3, "empty is a valid value").
- **Error codes name the DOMAIN CONCEPT** (`restore.*`), declaration-merge, `import "./errors.js"`, never renamed; grep siblings.
- **`pg_restore` restoring the immutable fiscal tables is a claim to VERIFY by container** (§1), not assert. The append-only trigger is `BEFORE UPDATE OR DELETE` (not INSERT), so a COPY-load should not fire it — receipt required (Task 3).
- **Path-traversal guard is MANDATORY** on every entry name before any write (decision 5).
- **No bwc** (pre-production). ESM `.js`; commits `-s`; coverage 98/98/98/95 (`apps/server`); container tests need `TESTCONTAINERS_RYUK_DISABLED=true`; run `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` after touching any fiscal-table path.

---

## File structure

**Create:**
- `apps/server/src/restore-gate.ts` — `checkRestoreCompatibility(manifest, { environment, expectedVersions })` → throws `restore.*` or returns ok. `restore-gate.test.ts`.
- `apps/server/src/restore-entry-guard.ts` — `assertSafeEntryNames(entries, allowedPrefixes)` (lexical + realpath). `restore-entry-guard.test.ts`.
- `apps/server/src/pg-restore.ts` — `PgRestoreRunner` type + `realPgRestore` (shell-out). `pg-restore.test.ts` (DI unit + real-container fiscal receipt).
- `apps/server/src/restore.ts` — `restoreFromArtifact(deps)` + the composable steps (`restoreDatabase`/`restoreMedia`/`restoreSecrets`/`invokeRestoreHooks`) + `RestoreDeps`. `restore.test.ts`.
- `apps/server/src/restore-command.ts` — `runRestore({ argv, env, out })` → exit code. `restore-command.test.ts`.
- `apps/server/src/bin-restore.ts` — the `#!/usr/bin/env node` shim (coverage-excluded).

**Reuse:** `unpackArchive`/`ArchiveEntry` (`backup-archive.ts`), `decryptArtifact` (`artifact-cipher.ts`), `BackupManifest` (`backup-manifest.ts`), `expectedSchemaVersion`/`ALL_MODULES`, `unpackBundleToDir` (`state-secrets.ts`) for the `secrets/*` subset, `StorageBackend.get`, `createPostgresDb`, `dumpAtomic`/`realPgDump` idiom for `realPgRestore`.

---

## Task 1: Compatibility gate (`restore-gate.ts`)

**Files:** Create `apps/server/src/restore-gate.ts`, `apps/server/src/restore-gate.test.ts`; add `restore.*` codes to `errors.ts`.

**Interfaces:**
- Produces:
  ```typescript
  type RestoreCompat = { environment: "production" | "preproduction"; expectedVersions: Record<string, number> };
  function checkRestoreCompatibility(manifest: BackupManifest, target: RestoreCompat): void; // throws or returns
  ```
- Codes: `restore.environment_mismatch: { backup: string; target: string }`, `restore.schema_too_new: { module: string; backup: number; target: number }`.

- [ ] **Step 1: failing test** — an environment mismatch throws `restore.environment_mismatch`; a manifest module version > target expected throws `restore.schema_too_new`; equal/older passes; a manifest module the target doesn't list (absent from `expectedVersions`) is ignored (passes).

```typescript
import { checkRestoreCompatibility } from "./restore-gate.js";
const target = { environment: "preproduction" as const, expectedVersions: { core: 40, fiscal: 12 } };
it("refuses a newer backup schema", () => {
  expect(() => checkRestoreCompatibility({ manifestVersion:1, createdAt:"x", environment:"preproduction", modules:{ core: 41 } }, target))
    .toThrowError(expect.objectContaining({ code: "restore.schema_too_new" }));
});
it("refuses an environment mismatch", () => {
  expect(() => checkRestoreCompatibility({ manifestVersion:1, createdAt:"x", environment:"production", modules:{ core: 40 } }, target))
    .toThrowError(expect.objectContaining({ code: "restore.environment_mismatch" }));
});
it("accepts equal/older and ignores unknown modules", () => {
  expect(() => checkRestoreCompatibility({ manifestVersion:1, createdAt:"x", environment:"preproduction", modules:{ core: 40, ghost: 99 } }, target)).not.toThrow();
});
```

- [ ] **Step 2: run → FAIL.** Add the two codes to `errors.ts`.
- [ ] **Step 3: implement** — env check first; then for each `[m, v]` in `manifest.modules`, if `target.expectedVersions[m] !== undefined && v > target.expectedVersions[m]` → throw `restore.schema_too_new`.
- [ ] **Step 4: run → PASS.**
- [ ] **Step 5: commit** — `feat(server): restore compatibility gate (environment + schema-version)`

---

## Task 2: Entry-name traversal guard (`restore-entry-guard.ts`)

Mirror `unpackBundleToDir`'s two-layer guard, applied to ALL archive entry names before any write. This is the security core.

**Files:** Create `apps/server/src/restore-entry-guard.ts`, `apps/server/src/restore-entry-guard.test.ts`; add `restore.unsafe_entry_path` to `errors.ts`.

**Interfaces:**
- Produces: `assertSafeEntryName(name: string, destRoot: string): string` (returns the resolved safe absolute path, or throws `restore.unsafe_entry_path: { name }`). A batch `assertSafeEntryNames(names, destRoot)`.
- The guard: reject `isAbsolute(name)`; reject when `resolve(join(destRoot, name))` does not start with `destRoot + sep`; and (symlink-aware, after ensuring the parent dir) reject when `realpath(dirname(target))` escapes `realpath(destRoot)`. Reuse the exact shape from `state-secrets.ts:63-74`.

- [ ] **Step 1: failing test** — `secrets/../../etc/x`, an absolute name, and a name whose parent is a pre-created symlink escaping the root each throw `restore.unsafe_entry_path`; a normal `media/<sha>.jpg` / `secrets/tls/ca.crt` passes and returns a path under the root. **Prove the symlink guard by deletion** (remove the realpath check → the symlink-escape test passes wrongly).

- [ ] **Step 2: run → FAIL.** Add `restore.unsafe_entry_path: { name: string }` to `errors.ts`.
- [ ] **Step 3: implement** — the two-layer guard (lexical + realpath), reusing `writeFileAtomic`/`mkdir` idioms only where a write is needed (the guard itself just validates + returns the path).
- [ ] **Step 4: run → PASS** (incl. the deletion proof).
- [ ] **Step 5: commit** — `feat(server): restore entry-name path-traversal guard (lexical + realpath)`

---

## Task 3: pg_restore runner + fiscal-restore container receipt (`pg-restore.ts`)

Mirror `pg-dump.ts`'s `PgDumpRunner`/`realPgDump` DI seam. The real shell-out is `/* v8 ignore */`-ed; a real-container test is the fiscal receipt (§1).

**Files:** Create `apps/server/src/pg-restore.ts`, `apps/server/src/pg-restore.test.ts`.

**Interfaces:**
- Produces: `type PgRestoreRunner = (args: { databaseUrl: string; inFile: string; signal?: AbortSignal }) => Promise<void>`; `realPgRestore: PgRestoreRunner` (`execFile("pg_restore", ["--no-owner", "--dbname", databaseUrl, inFile], { signal })`).

- [ ] **Step 1: failing test (DI unit)** — a fake runner records the argv it would run (`--no-owner`, `--dbname`, the file); assert the shape. (The real shell-out is v8-ignored.)
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** `realPgRestore` mirroring `pgDumpShellOut` (`pg-dump.ts:59`), v8-ignored.
- [ ] **Step 4: THE FISCAL RECEIPT (real container).** Add a real-PG test mirroring `backup-sweep.test.ts`'s in-container `docker exec` pg_dump smoke: (a) `useTemplateDb` gives a DB with the fiscal schema; insert a fiscal row (`registros_facturacion` / a `cadenas` head) as the owner; `pg_dump --format=custom` it (in-container `docker exec`); create a FRESH empty DB in the container; `pg_restore --no-owner` into it as the admin role; **assert the fiscal rows landed and NO `WT001` (`reject_mutation` SQLSTATE) was raised** and the append-only/TRUNCATE triggers exist on the restored table. Degrade to a **loud skip** (never silent) if docker/container can't be resolved — the established pattern. This is the receipt that `pg_restore` restores the immutable fiscal tables cleanly (the trigger is UPDATE/DELETE-only, so COPY-insert is clean — proven, not asserted).
- [ ] **Step 5: run → PASS** (`TESTCONTAINERS_RYUK_DISABLED=true`). Then `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- [ ] **Step 6: commit** — `feat(server): pg_restore runner + real-container fiscal-restore receipt`

---

## Task 4: The restore orchestrator (`restore.ts`)

Compose the steps; expose them individually for R3.

**Files:** Create `apps/server/src/restore.ts`, `apps/server/src/restore.test.ts`.

**Interfaces:**
- Consumes: everything above + `decryptArtifact`, `unpackArchive`, `unpackBundleToDir`, `PgRestoreRunner`, `ALL_MODULES` (for `expectedVersions` + restore hooks).
- Produces:
  ```typescript
  interface RestoreDeps {
    artifact: Uint8Array;             // the .backup.enc bytes (from StorageBackend.get or a file)
    recoveryKey: string;
    databaseUrl: string;              // privileged admin/owner connection to the fresh target DB
    mediaDir: string; stateDir: string; stagingDir: string;
    modules: readonly WaitronModule[]; environment: "production" | "preproduction";
    runRestore?: PgRestoreRunner; log: Logger;
  }
  function restoreFromArtifact(deps: RestoreDeps): Promise<void>;
  // exposed steps (for R3 composition): restoreDatabase, restoreMedia, restoreSecrets, invokeRestoreHooks
  ```
- Flow: `decryptArtifact(artifact, recoveryKey)` → `unpackArchive` → find `manifest.json` (throw `restore.archive_incomplete` if absent) → `checkRestoreCompatibility(manifest, { environment, expectedVersions: schemaVersionsFromCode(modules) })` → `assertSafeEntryNames` on every entry → **restoreDatabase** (write `db.dump` to staging, `runRestore({ databaseUrl, inFile })`) → **restoreMedia** (`media/*` → `mediaDir`, path-guarded) → **restoreSecrets** (`secrets/*` → `stateDir`, via `unpackBundleToDir` which re-guards) → **invokeRestoreHooks** (for each enabled module with a `backup.restore` hook, call it — none in v1) → cleanup staging in `finally`. `expectedVersions` come from `expectedSchemaVersion(m.migrations, migrationsRoot)` per module.

- [ ] **Step 1: failing test** — build an in-memory archive (reuse `packArchive` + `encryptArtifact`) containing a manifest + a `db.dump` + a `media/x.jpg` + a `secrets/secrets.env`; a fake `PgRestoreRunner` records the restored file; assert: the DB dump reaches the runner, media lands in a temp mediaDir, secrets land in a temp stateDir, an incompatible manifest throws before any restore, a malicious entry name throws before any write, staging cleaned in finally. Add a `restore.archive_incomplete` test (no `db.dump`).
- [ ] **Step 2: run → FAIL.** Add `restore.archive_incomplete: { missing: string }` to `errors.ts`.
- [ ] **Step 3: implement** the orchestrator + the four exposed steps.
- [ ] **Step 4: run → PASS.**
- [ ] **Step 5: commit** — `feat(server): restore orchestrator (decrypt→gate→guard→pg_restore→media→secrets→hooks)`

---

## Task 5: `restore` CLI verb + bin shim

Mirror `recovery-unpack-command.ts`/`bin-recovery.ts`. Env-sourced (recovery key, admin connection, artifact path), never argv.

**Files:** Create `apps/server/src/restore-command.ts`, `apps/server/src/bin-restore.ts` (coverage-excluded); wire `package.json` bin if the siblings do.

**Interfaces:**
- Produces: `runRestore(deps: { argv: string[]; env: NodeJS.ProcessEnv; out: (s: string) => void }): Promise<number>` (0 success / 1 expected failure / 2 usage). Verb `restore <artifact-path>`; recovery key from `WAITRON_BACKUP_RECOVERY_KEY`, admin connection from `WAITRON_RESTORE_DATABASE_URL` (fail-closed on empty), reads the artifact file, resolves `mediaDir`/`stateDir` from env like boot.

- [ ] **Step 1: failing test** — a usage error (wrong verb / missing artifact) returns 2; a missing recovery key / empty connection returns 1 with a message; a happy path (injected `restoreFromArtifact`) returns 0. Do NOT shell out in the unit test (inject the orchestrator or its `PgRestoreRunner`).
- [ ] **Step 2: run → FAIL.**
- [ ] **Step 3: implement** the command (fail-closed env reads, `import "./errors.js"`) + the thin `bin-restore.ts` shim (`/* v8 ignore */`).
- [ ] **Step 4: run → PASS.** Full gate: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`, typecheck, lint, format:check, and `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad`.
- [ ] **Step 5: commit** — `feat(server): restore CLI verb + bin shim`

---

## Self-review notes

- **Spec §7 BR-3 covered:** manifest gate (T1), decrypt+unpack (reused), pg_restore (T3), media+secrets restore + traversal guards (T2/T4), the empty module restore-hook invocation (T4). The fiscal fresh-chain is BR-4 (empty hook), and rejoin identity reconciliation is R3 (BR-3 exposes the composable steps).
- **Fiscal safety:** BR-3 restores verbatim, mints no chain, makes the box no trade-readier — Task 3's container receipt proves `pg_restore` doesn't trip the immutability triggers, and the empty restore hook is the BR-4 seam. Flag the fiscal-adjacency prominently in the PR for owner review at land.
- **Deferred:** BR-4's fiscal `restore` hook body; R3's rejoin composition (skip-secrets + re-fence); a `DROP DATABASE`/wipe primitive (the target is a pre-created fresh DB in v1); incremental/streaming restore.
- **No placeholders; types flow** `RestoreCompat`/`BackupManifest` (T1) → T4; the guard (T2) → T4; `PgRestoreRunner` (T3) → T4 → T5.
