# Onboarding Slice 4b-ii — Scheduled DB Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A scheduled `pg_dump` of the box's database to a configured directory, with a boot-time guard that the backup connection can actually read the FORCE-RLS fiscal tables (so a misconfigured role can never silently ship an empty fiscal dump), a bounded retention of old dumps, and a "last backup age / stale" surface through box-status's `backup` field.

**Architecture:** An opt-in backup config (`loadBackupConfig`, gated on `WAITRON_BACKUP_DIR`, requiring a privileged `WAITRON_BACKUP_DATABASE_URL`) mirrors `loadSyncConfig`/`loadTunnelConfig`. A boot-time **RLS-completeness probe** refuses to enable backup if the backup connection reads zero rows of a FORCE-RLS fiscal table (the correctness crux). A background **backup worker** (`runBackupSweep`, mirroring `runRetentionSweep`) shells out to `pg_dump` via an injected runner on an interval, writes `waitron-<ISO>.dump` (custom format) into the backup dir, and prunes to the last N. box-status's `backup` field reads the newest dump file's mtime for `lastBackupAt`/`ageSeconds`/`stale`.

**Tech Stack:** TypeScript ESM (`.js` specifiers), Node `child_process` `execFile` (the `time-health.ts` precedent), Drizzle, Vitest, `@waitron/db` testcontainers.

**Spec:** `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` §12; backlog "4b-ii". This is the second sub-slice of 4b (4b-i landed #161).

## Global Constraints

- **No backwards-compatibility / data-migration code** (nothing deployed).
- **Error codes name the DOMAIN CONCEPT.** New codes are `backup.*`, declared in `apps/server/src/errors.ts`; the throwing file does `import "./errors.js"`. `server.config_invalid` (with a `reason`) is reused for env-var faults, matching `loadSyncConfig`/`loadTunnelConfig`.
- **`AppError.message === code`** — `.toThrow(new AppError(code, params))` matches on the code.
- **Real Postgres, not PGlite**, for the RLS probe and the pg_dump smoke (PGlite is superuser + single-backend — a false pass). `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **The RLS-completeness guard is the fiscal-safety crux** — a `pg_dump` as a non-BYPASSRLS role silently truncates every FORCE-RLS table to zero rows. Prove it by deletion.
- **Gate:** `pnpm lint && typecheck && format:check` + `pnpm --filter @waitron/server test:coverage` (95/95/90/88 floor). `git commit -s`.
- **Opt-in, fail-closed:** absent `WAITRON_BACKUP_DIR` → backup off (`undefined`), every existing boot unaffected. A blank/empty required value fails closed (`server.config_invalid`), never a degenerate default (CLAUDE.md "empty string is a valid value" trap).

## Deferred (recorded, NOT built here) — ruling by the controller

- **Provisioning the privileged backup role is out of scope.** `WAITRON_BACKUP_DATABASE_URL` is operator-supplied and must be a superuser or BYPASSRLS connection. No role in the production model holds BYPASSRLS today, and the real runtime admin connection is already deferred with instance-provisioning (`boot.ts`). Creating that role belongs to the parked appliance-provisioning / OS-image layer. 4b-ii **consumes** such a connection and **guards** its correctness at boot; it does not mint it. In dev/CI the connection is the container superuser.
- **Off-box backup** (paid tier) stays deferred.

## File Structure

**New (`apps/server/src/`):** `backup-config.ts` (`loadBackupConfig`), `backup-probe.ts` (`assertBackupCanReadFiscal`), `pg-dump.ts` (`runPgDump` + `pruneOldDumps` + the injectable runner type), `backup-sweep.ts` (`runBackupSweep`), `backup-status.ts` (`readBackupStatus` — newest-dump mtime → status). Their `.test.ts` siblings.
**Modified:** `config.ts` (thread `BackupConfig` into nothing — `loadBackupConfig` is called from boot, like `loadSyncConfig`), `errors.ts` (`backup.*` codes), `box-status.ts` (backup field + reader + deps), `boot.ts` (probe + worker + box-status wiring), the three box-status test files, `docs/backlog.md`.

---

## Task 1: Backup config (`backup-config.ts`)

**Files:** Create `apps/server/src/backup-config.ts` + `.test.ts`; modify `errors.ts` if a new reason is needed (reuse `server.config_invalid`).

**Interfaces:**
- Produces: `interface BackupConfig { databaseUrl: string; dir: string; intervalMs: number; retain: number; staleAfterMs: number }`; `loadBackupConfig(env: Record<string,string|undefined>): BackupConfig | undefined`.
- Consumes: `isUnset` (`./env-value.js`), `AppError`, `resolve` (`node:path`), and the `required`/`positiveInt` helpers — since those are module-private in `config.ts`, EITHER export them from `config.ts` for reuse OR replicate the tiny `isUnset`-based checks locally in `backup-config.ts` (prefer exporting `required`/`positiveInt`/`optionalPositiveInt` from `config.ts` to avoid a second copy — check whether they're already exported; if not, export them).

- [ ] **Step 1: Failing test.** Create `backup-config.test.ts`. Cover: absent `WAITRON_BACKUP_DIR` → `undefined`; dir set but `WAITRON_BACKUP_DATABASE_URL` blank → throws `server.config_invalid` (`reason: "backup_db_url_required"`); dir set + db url set → a full config with defaults for interval/retain/staleAfter; a non-positive `WAITRON_BACKUP_RETAIN` → throws; the dir is `resolve`d (absolute) and never `resolve("")`.

```typescript
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { loadBackupConfig } from "./backup-config.js";

describe("loadBackupConfig", () => {
  it("returns undefined when WAITRON_BACKUP_DIR is unset (backup off)", () => {
    expect(loadBackupConfig({})).toBeUndefined();
    expect(loadBackupConfig({ WAITRON_BACKUP_DIR: "" })).toBeUndefined();
  });
  it("requires a backup database url when the dir is set", () => {
    expect(() => loadBackupConfig({ WAITRON_BACKUP_DIR: "/b" })).toThrow(
      new AppError("server.config_invalid", { variable: "WAITRON_BACKUP_DATABASE_URL", reason: "required_with_backup_dir" }),
    );
  });
  it("builds a config with defaults", () => {
    const c = loadBackupConfig({ WAITRON_BACKUP_DIR: "/b", WAITRON_BACKUP_DATABASE_URL: "postgres://x" });
    expect(c).toMatchObject({ databaseUrl: "postgres://x", retain: expect.any(Number), intervalMs: expect.any(Number), staleAfterMs: expect.any(Number) });
    expect(c!.dir).toMatch(/^\//); // resolved absolute
  });
  it("rejects a non-positive retain count", () => {
    expect(() => loadBackupConfig({ WAITRON_BACKUP_DIR: "/b", WAITRON_BACKUP_DATABASE_URL: "postgres://x", WAITRON_BACKUP_RETAIN: "0" })).toThrow(
      new AppError("server.config_invalid", { variable: "WAITRON_BACKUP_RETAIN", reason: "not_a_positive_integer" }),
    );
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @waitron/server test backup-config`).
- [ ] **Step 3: Implement `backup-config.ts`.** Mirror `loadTunnelConfig`'s shape exactly (read the file). `dir` from `WAITRON_BACKUP_DIR` gates the whole thing (unset → `undefined`); `databaseUrl` from `WAITRON_BACKUP_DATABASE_URL` (required-when-on, `isUnset` → throw `server.config_invalid` reason `required_with_backup_dir`); `intervalMs` from `WAITRON_BACKUP_INTERVAL_MS` default e.g. `24*60*60*1000`; `retain` from `WAITRON_BACKUP_RETAIN` default e.g. `7` (positiveInt); `staleAfterMs` from `WAITRON_BACKUP_STALE_AFTER_MS` default e.g. `2*24*60*60*1000`. `dir: resolve(rawDir)` (never `resolve("")`). Declare defaults as named constants with a one-line reason each.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(onboarding): backup config (opt-in, fail-closed) (4b-ii)`.

---

## Task 2: RLS-completeness probe (`backup-probe.ts`) — the fiscal-safety crux

**Files:** Create `apps/server/src/backup-probe.ts` + `.test.ts`; add a `backup.*` code to `errors.ts`.

**Interfaces:**
- Produces: `assertBackupCanReadFiscal(db: Database): Promise<void>` — throws `backup.role_rls_fenced` (`Record<string, never>`) if the connection reads **zero** rows of a FORCE-RLS fiscal table when rows exist... but at boot the DB may legitimately be empty. So the probe must distinguish "fenced" from "genuinely empty". **Approach:** compare a count under the backup connection against a count the probe KNOWS should be visible. The cleanest RLS-fence detector that needs no seeded fiscal data: read `pg_catalog` for whether the current role is superuser or has BYPASSRLS — `select rolsuper or rolbypassrls as can_bypass from pg_roles where rolname = current_user`. If `can_bypass` is false, the dump WILL be RLS-truncated → throw `backup.role_rls_fenced`. This is exact (RLS is inert only for superuser/BYPASSRLS — verified in `0001_tenancy_rls.sql`), needs no fiscal rows, and is cheap.
- Consumes: `Database`, `sql` (drizzle), `AppError`.

- [ ] **Step 1: Add the error code** to `errors.ts`:
```typescript
    /** The configured backup connection is neither superuser nor BYPASSRLS, so `pg_dump` would emit
     * an RLS-truncated (silently empty) dump of every FORCE-RLS fiscal table. Backup is refused at
     * boot rather than shipping a worthless fiscal backup. No params. */
    "backup.role_rls_fenced": Record<string, never>;
```

- [ ] **Step 2: Failing test.** Create `backup-probe.test.ts` (real Postgres, `useTemplateDb`). Assert: the container superuser passes (`assertBackupCanReadFiscal(suite.admin)` resolves); a non-bypassing member (`suite.pg.connectAs("app_login","app_pw")` — an app_user member, NOBYPASSRLS) throws `backup.role_rls_fenced`. (Guard the connectAs pool teardown.) This is the prove-by-contrast: the two roles DISAGREE.

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `backup-probe.ts`.**
```typescript
import { sql } from "drizzle-orm";
import { AppError, } from "@waitron/shared";
import type { Database } from "@waitron/db";
import "./errors.js";

/**
 * Refuse to enable scheduled backup unless the backup connection can actually read the FORCE-RLS
 * fiscal tables. FORCE ROW LEVEL SECURITY applies to the table owner too, so a `pg_dump` as anything
 * but a SUPERUSER or a BYPASSRLS role silently emits an empty/per-tenant-truncated dump of
 * `registros_facturacion`/`cadenas`/`sync_log`/every tenant table — a worthless fiscal backup with no
 * error. `rolsuper OR rolbypassrls` is the exact predicate for "RLS is inert for this role"
 * (`0001_tenancy_rls.sql`), and needs no seeded fiscal rows to check.
 */
export async function assertBackupCanReadFiscal(db: Database): Promise<void> {
  const rows = await db.execute<{ can_bypass: boolean }>(
    sql`select (rolsuper or rolbypassrls) as can_bypass from pg_roles where rolname = current_user`,
  );
  if (rows.rows[0]?.can_bypass !== true) {
    throw new AppError("backup.role_rls_fenced", {});
  }
}
```
(Verify the drizzle `.execute` row-access shape against a sibling — `chain-height.ts` uses `.rows`.)

- [ ] **Step 5: Run → PASS. Prove by deletion:** change the predicate to `true as can_bypass` — the app_user case must stop throwing (test fails); restore.
- [ ] **Step 6: Commit** `feat(onboarding): backup RLS-completeness boot probe (4b-ii)`.

---

## Task 3: pg_dump runner + retention (`pg-dump.ts`)

**Files:** Create `apps/server/src/pg-dump.ts` + `.test.ts`.

**Interfaces:**
- Produces: `type PgDumpRunner = (args: { databaseUrl: string; outFile: string; signal?: AbortSignal }) => Promise<void>`; `realPgDump: PgDumpRunner` (execFile `pg_dump`); `dumpFileName(now: Date): string` (`waitron-<ISO-basic>.dump`); `pruneOldDumps(dir: string, retain: number): Promise<void>` (keep the newest `retain` `waitron-*.dump` files, unlink the rest).
- Consumes: `execFile` (`node:child_process`, promisified), `readdir`/`stat`/`unlink` (`node:fs/promises`), `join` (`node:path`).

- [ ] **Step 1: Failing tests.** `pg-dump.test.ts`: (a) `dumpFileName` produces a sortable, `.dump`-suffixed, filesystem-safe name (no colons — use a basic-ISO like `2026-08-29T175501Z`); (b) `pruneOldDumps` on a temp dir seeded with 5 `waitron-*.dump` files + `retain=2` unlinks the 3 oldest (by filename sort, which the sortable name makes equal to age) and keeps the 2 newest, and ignores non-matching files. Do NOT unit-test `realPgDump` spawning here (that's the smoke in Task 4).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `realPgDump` = `execFile("pg_dump", ["--format=custom", "--file", outFile, databaseUrl], { signal })` promisified — custom format so `pg_restore` can read it; the URL as the final arg (libpq connstring). `dumpFileName` = `waitron-${now.toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z")}.dump`. `pruneOldDumps` = list `waitron-*.dump`, sort descending by name, `unlink` all past index `retain`.
- [ ] **Step 4: Run → PASS. Commit** `feat(onboarding): pg_dump runner + dump retention (4b-ii)`.

---

## Task 4: Backup worker (`backup-sweep.ts`)

**Files:** Create `apps/server/src/backup-sweep.ts` + `.test.ts`.

**Interfaces:**
- Consumes: `PgDumpRunner`, `dumpFileName`, `pruneOldDumps` (`./pg-dump.js`); `realSleep`/a sleep seam (`./loop.js`); `Logger`.
- Produces: `runBackupSweep(deps: { dir: string; databaseUrl: string; intervalMs: number; retain: number; signal: AbortSignal; sleep: (ms:number, signal:AbortSignal)=>Promise<void>; log: Logger; runDump?: PgDumpRunner; now?: ()=>Date }): Promise<void>` — mirrors `runRetentionSweep`: `while (!signal.aborted) { try { mkdir dir; runDump → dir/dumpFileName(now); pruneOldDumps(dir, retain); log("info","backup.completed",{file}); } catch { log("warn","backup.failed",{errorCode}); } if (signal.aborted) break; await sleep(intervalMs, signal); }`.

- [ ] **Step 1: Failing test** with an INJECTED fake `runDump` (records calls, writes a stub file) and a fake `sleep` that aborts after the first iteration (`signal.aborted` flips) — assert the runner was called once with an outFile under `dir`, prune ran, and `backup.completed` was logged; a throwing `runDump` logs `backup.failed` and does NOT kill the loop. No real pg_dump, no container. Read `packages/sync/src/retention.test.ts` for the loop-test shape (fake sleep + AbortController).
- [ ] **Step 2: Run → FAIL. Step 3: Implement (mirror `runRetentionSweep`). Step 4: PASS.**
- [ ] **Step 5: Real pg_dump smoke (verify-not-assume).** Add ONE real-container test that runs `realPgDump` against `suite.pg.uri` (the container superuser) into a temp dir and asserts a non-empty `.dump` file is produced. **`pg_dump` must be reachable:** prefer running it against the container's published host `uri` IF `pg_dump` is on the host PATH; if the host has no `pg_dump`, run it inside the container via `docker exec <container> pg_dump ...` and copy the file out, OR skip with a LOUD `console.warn` naming why (a skipped smoke proves nothing — CLAUDE.md §2 — so prefer docker-exec over skip). The implementer decides the cleanest mechanism against the actual harness (`packages/db/src/testing/postgres.ts` — see if the container id/name is reachable); if neither works cleanly in one task, report DONE_WITH_CONCERNS with the RLS probe (Task 2) as the real correctness guard and the fake-runner worker test as the logic guard, and defer the real-pg_dump smoke with a note.
- [ ] **Step 6: Commit** `feat(onboarding): scheduled backup worker (4b-ii)`.

---

## Task 5: box-status backup field (`backup-status.ts` + box-status wiring)

**Files:** Create `apps/server/src/backup-status.ts` + `.test.ts`; modify `box-status.ts` + the three box-status test files.

**Interfaces:**
- Produces: `type BackupStatus = { configured: false } | { configured: true; lastBackupAt: string | null; ageSeconds: number | null; stale: boolean }`; `readBackupStatus(dir: string, staleAfterMs: number, now: Date): Promise<BackupStatus & { configured: true }>` — scans `dir` for the newest `waitron-*.dump`, returns its mtime as `lastBackupAt`, `ageSeconds`, and `stale = age > staleAfterMs`; `lastBackupAt: null` (and `stale: true`) when no dump exists yet.
- box-status: replace `backup: { configured: false }` with a `BackupStatus`, add optional `backup?: () => Promise<BackupStatus>` reader to `BoxStatusReaders` (mirror the optional `cert`/`replicationLag` shape — absent reader → `{configured:false}`), compute it in `collectBoxStatus`, add `readBackup: (() => Promise<BackupStatus>) | undefined` to `BoxStatusDeps`, wire it in `mountBoxStatusApi`.

- [ ] **Step 1: Failing tests** for `backup-status.ts` (temp dir; no dumps → `{configured:true, lastBackupAt:null, ageSeconds:null, stale:true}`; a dump file with a known mtime → correct age + `stale` both sides of the threshold) and extend `box-status.test.ts` (spread `base`, add a `backup` reader → asserts the field; no reader → `{configured:false}`).
- [ ] **Step 2-4: Implement + wire; update the two real-PG box-status route suites** (`readBackup: undefined` in their `buildApp` unless testing the branch) and the composition assertion. Prove-by-deletion the field passes through.
- [ ] **Step 5: Commit** `feat(onboarding): box-status backup field from newest dump age (4b-ii)`.

---

## Task 6: boot wiring (`boot.ts`)

**Files:** Modify `apps/server/src/boot.ts`; extend `boot.test.ts`.

- [ ] **Step 1:** In the trading branch, after the sync/tunnel blocks and before `mountBoxStatusApi`: `const backupConfig = loadBackupConfig(env);` Then, opt-in like the retention worker:
  - open a short-lived probe connection to `backupConfig.databaseUrl`, `await assertBackupCanReadFiscal(probeDb)`, `probeDb.close()` — a throw here (`backup.role_rls_fenced`) **fails boot loud** (a configured-but-fenced backup is a misconfiguration the operator must fix, not silently ignore); OR, if a hard boot-fail is too aggressive for a non-fiscal-blocking feature, catch it and `log("error","backup.disabled_rls_fenced",{})` + leave backup OFF. **Ruling: leave backup OFF + log error** (nothing may block a sale; a bad backup role must not brick the till — CLAUDE.md §5). Record this ruling in the commit.
  - a dedicated `backupController = new AbortController()` + `backupWorker = runBackupSweep({...})`, `.catch(err => log("error","backup.worker_rejected",{errorCode: codeOf(err)}))`; teardown in `stopWork` (`backupController.abort()` + `await backupWorker?.catch(()=>{})`). The dump connection is the operator's `databaseUrl` — `runPgDump` opens no long-lived pool (it shells out), so no pool to close.
  - `else log("info","backup.disabled",{})` when `backupConfig === undefined`.
  - Pass `readBackup: backupEnabled ? () => readBackupStatus(backupConfig.dir, backupConfig.staleAfterMs, now()) : undefined` into `mountBoxStatusApi`.
- [ ] **Step 2:** `boot.test.ts` — a boot with no backup env still boots (unaffected); optionally assert box-status `backup.configured:false`.
- [ ] **Step 3: Commit** `feat(onboarding): wire backup probe + worker + box-status into boot (4b-ii)`.

---

## Task 7: Gate + docs

- [ ] **Step 1:** Full gate (`pnpm lint && typecheck && format:check` + `pnpm --filter @waitron/server test:coverage`). Fix reds.
- [ ] **Step 2:** Backlog — flip 4b-ii to "implemented on `feat/onboarding-4b-ii-scheduled-backup`" (no PR number — a post-merge docs commit flips to LANDED), summarise the design + record the **deferred backup-role provisioning** dependency prominently.
- [ ] **Step 3: Commit** `docs(backlog): scheduled backup (4b-ii) implemented on branch`.

## Self-Review notes
- The **RLS probe (Task 2) is the correctness guard**, tested prove-by-deletion with real roles — the pg_dump smoke (Task 4) is secondary. Do not let a fiddly smoke block the slice; the probe + fake-runner worker test carry the correctness.
- **Nothing may block a sale:** a misconfigured backup role leaves backup OFF with a logged error, never a boot failure (Task 6 ruling).
- Type names consistent: `BackupConfig`, `BackupStatus`, `PgDumpRunner`, `runBackupSweep`, `assertBackupCanReadFiscal`, `readBackupStatus`, `runPgDump`/`realPgDump` across tasks.
- Verify-not-assume: drizzle `.execute().rows` shape; whether `config.ts` already exports `required`/`positiveInt`; the pg_dump test mechanism (host vs docker-exec); `box-status.test.ts`'s `base` object.
