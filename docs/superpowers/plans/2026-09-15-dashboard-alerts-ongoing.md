# Dashboard alerts, branch 2 (the ongoing checks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four live "ongoing check" alert sources — backups, fiscal submission, printing, and card-reader battery — on top of the alert framework branch 1 landed (#368), with English and Spanish wording for every new code and a guard that keeps that wording complete.

**Architecture:** Branch 1 built the alert model, the source registry, the three routes, and the dashboard bell/panel/screen. An `AlertSource` is `{ area, permission, read(ctx) → OngoingAlert[] }` where `ctx = { tx, tenantId, now }`. Branch 2 fills the registry's `sources` array: the fiscal-submission source rides the module `alerts` seat (generic code must not name fiscal tables — CLAUDE.md §3), and backups, awaiting-certificate, printing and battery are server-owned sources registered at boot, each a closure that captures its out-of-transaction dependencies (backup backends, the in-memory awaiting-cert holder, card providers, TTL caches) and reads the database through `ctx.tx`.

**Tech Stack:** TypeScript, drizzle-orm over PostgreSQL, PGlite for hermetic tests, vitest. The dashboard is Lit; wording lives in a plain object the dashboard registers with `@waitron/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-14-dashboard-alerts-design.md` — read *The checks (branch 2)*, *Sources*, *Permissions*, *Server routes*, *The dashboard* and *Testing*. This plan argues from that spec; executors read both.

## Global Constraints

- **Tenant scoping is per-query, not per-database.** Every source's `tx` query filters `eq(table.tenantId, ctx.tenantId)` — a by-id read as much as a list read (CLAUDE.md §3). `tenant_id` still exists on `main` at plan time (verified: `packages/fiscal-verifactu/src/schema/envios.ts`, `packages/db/src/schema/print-jobs.ts`, `packages/payments/src/schema/card-readers.ts` all carry it). The overlapping `feat/drop-tenant-id` branch has **not** landed; whichever lands second rebases. If `tenant_id` is gone by the time a task runs, drop the predicate and the two-tenant probe for that table — do not invent a new scoping mechanism.
- **Ongoing alerts are worked out on request, never stored** (spec decision 6). No new table, no background writer. A check that finds nothing returns `[]`.
- **One alert per subject**, never one per job or record — per destination, per fiscal-submission condition, per agent, per printer, per reader (spec *The checks*). Thresholds are named constants, not inline literals.
- **Error codes name the domain concept, never the package, and are never renamed once shipped** (CLAUDE.md §3). Each ongoing code gets an `ErrorParams` entry in its domain's `errors.ts`, exactly as `alert.source_unavailable` does (`apps/server/src/errors.ts:1712`), even though an ongoing code is carried as a string and never thrown.
- **Every alert code has English and Spanish wording** in `apps/dashboard/src/i18n/alert-messages.ts`, with `{param}` placeholders the params-aware `alertMessage` lookup fills. An unworded code shows a generic sentence with the raw code — acceptable for an error banner, not for an alert (spec *The dashboard → Wording*).
- **Plain English in commit messages and PR text** (owner rule): translate any domain term the first time it appears; keep exact identifier and error-code names as pointers. Every commit is `git commit -s`.
- **This branch is fiscal-adjacent** (it reads fiscal submission state) and touches tenant-isolated reads, so it takes the FULL review path and owner sign-off at land.

---

## File map

**New files**

- `apps/server/src/ttl-cache.ts` — a small server-memory time-to-live cache shared by every session; used by the backup and battery sources so an outside call is reused (backup listings 1 minute, battery 5 minutes). Test: `apps/server/src/ttl-cache.test.ts`.
- `apps/server/src/alert-sources.ts` — the four server-owned source factories (`backupAlertSource`, `awaitingCertAlertSource`, `printingAlertSource`, `batteryAlertSource`) and their named threshold constants. Test: `apps/server/src/alert-sources.test.ts`.
- `packages/fiscal-verifactu/src/submission-alerts.ts` — the module-owned fiscal-submission source (`fiscalSubmissionSource`) and its thresholds. Test: `packages/fiscal-verifactu/src/submission-alerts.test.ts`.
- `scripts/ongoing-alert-codes.test.ts` — a root guard that reads the source files, lists every ongoing code, and fails if one lacks English or Spanish wording.

**Modified files**

- `apps/server/src/alerts.ts` — relax `createAlertRegistry` so several sources may share one `area`; emit the failed-source synthetic at most once per area (Task 1).
- `apps/server/src/backup-sweep.ts` — record each destination's last outcome in a shared in-memory holder the backup source reads (Task 3).
- `apps/server/src/errors.ts` — register `backup.destination_overdue`, `backup.destination_failed`, `backup.disabled`, `printing.agent_silent`, `printing.jobs_waiting`, `reader.battery_low` (Tasks 3, 6, 7).
- `apps/server/src/boot.ts` — build the four server-owned sources and pass them, concatenated with `enabledAlertSources(setsToMigrate)`, into `createAlertRegistry` (Tasks 3, 5, 6, 7).
- `packages/fiscal-verifactu/src/errors.ts` — register `fiscal.submission_delayed`, `fiscal.submission_stopped`, `fiscal.awaiting_certificate` (Tasks 4, 5).
- `packages/fiscal-verifactu/src/alerts.ts` — add `sources: [fiscalSubmissionSource]` to `FISCAL_ALERTS` (Task 4).
- `apps/dashboard/src/i18n/alert-messages.ts` — English and Spanish wording for all nine ongoing codes (Tasks 3–7).
- `docs/backlog.md`, `docs/developers/design-system.md` (only if a new note is needed), the ledger (Task 10).

---

## Rulings (where this plan narrows or fills in the spec)

1. **Two sources share the area `fiscal`, so the registry must allow it.** The spec puts `fiscal.submission_delayed`/`fiscal.submission_stopped` on the fiscal-verifactu module seat (module-owned, reads `envios`/`registros_facturacion`) and `fiscal.awaiting_certificate` on a server-owned source that captures the in-memory `AwaitingCertStatus` holder — both under area `fiscal`. Branch 1's `createAlertRegistry` rejects two sources with the same area (`apps/server/src/alerts.ts:25`), because a failing source is keyed `alert.source_unavailable:<area>`. **Resolution:** relax the dedup to allow repeated areas, and emit the failed-source synthetic at most once per area (Task 1). Why not fold awaiting-cert into the module source instead: the drain keeps the awaiting-cert signal in memory *because it is not derivable from the rows* — a cert-skipped tenant's `envios` stay plain `pendiente`, indistinguishable from a normal backed-off row (`packages/fiscal-verifactu/src/drain.ts:193-195` and `:537`). The module source, which sees only `ctx.tx`, cannot know it. Why not merge both into one boot-built source: the submission queries name fiscal tables, and generic boot code must not (CLAUDE.md §3 composition), so those queries must ride the module seat.
2. **`app_user` can read the fiscal tables in the alerts transaction.** The alerts route runs each source as `app_user` inside one savepoint. `GRANT SELECT ... ON registros_facturacion TO app_user` and `... ON envios TO app_user` (`packages/fiscal-verifactu/drizzle/0001_fiscal_baseline_sql.sql:6,18`), so the submission source's join is permitted. The immutability guards on `registros_facturacion` block writes only, not `SELECT`.
3. **Awaiting-certificate needs no `tx`.** `AwaitingCertStatus` (`apps/server/src/pass.ts:88-90`) is a one-field live cell (`{ current: boolean }`) already built at `apps/server/src/boot.ts:1552` and fed to the fiscal pass. The awaiting-cert source captures it and returns the alert when `current` is true; it queries nothing.
4. **The backup failed-attempt signal is in-memory, cleared by the next success, empty after a restart.** The sweep records each destination's last outcome in a shared holder shaped like `AwaitingCertStatus`; the source reads it. After a restart the holder is empty, so `backup.destination_failed` is silent until the next failed sweep — the `backup.destination_overdue` check (which reads stored artifacts, not the holder) still covers a destination that has genuinely gone stale. This matches spec *The checks → Backups*.
5. **The ongoing-code guard reads source text.** Like `scripts/alert-codes.test.ts`, `scripts/ongoing-alert-codes.test.ts` hand-lists the source files and regexes the code literals, then checks each has English and Spanish wording. **It therefore cannot see a code assembled at runtime** — every code this branch adds is a plain string literal, and the guard's own comment says so. It checks wording only; an ongoing code's area comes from its source object, not a prefix claim, so there is no "unclaimed" check for ongoing codes.
6. **Printing code names — decided: `agent.silent` and `printer.jobs_waiting`.** The spec's *checks* section writes `printing.agent_silent`/`printing.jobs_waiting`, but the spec's own body also says "codes follow the siblings' singular domain prefixes … the exact names are checked against siblings again when the plan is written" — it deferred the spelling to now. The printing package has no `printing.*` code; its families are `printer.*`, `agent.*`, `print_job.*` (`packages/printing/src/errors.ts:18-43`). So the sibling-consistent, spec-mandated names are **`agent.silent`** (a print agent went silent — joins the `agent.*` family) and **`printer.jobs_waiting`** (jobs waiting at a printer — the alert is per-printer, keyed by printer id, with `params.printer`). Codes are never renamed once shipped (CLAUDE.md §3), so this is fixed here, not left to the implementer. The source's `area` stays `printing` (area is a UI grouping, independent of the code prefix). Flag the deviation from the *checks* section's provisional names for owner sign-off at land.
7. **The 60-second ongoing refresh already exists.** `listAlerts` has no special `refreshMs` case, so it polls on the shared 60 000 ms default and also re-reads on any `incidents` change (`apps/dashboard/src/api/live-queries.ts`). Branch 2 adds no refresh wiring; Task 10 verifies it.

---

### Task 1: Let several alert sources share one area

**Files:**
- Modify: `apps/server/src/alerts.ts` (`createAlertRegistry` near `:25`, the read loop's failed-source branch near `:112-130`)
- Test: `apps/server/src/alerts.test.ts` (the registry and read-loop describe blocks)

**Interfaces:**
- Consumes: `AlertSource` (`packages/module/src/alerts.ts:31`), `createAlertRegistry`, `readOpenAlerts` (`apps/server/src/alerts.ts`).
- Produces: a `createAlertRegistry` that accepts two sources with the same `area`; `readOpenAlerts` still emits at most one `alert.source_unavailable:<area>` per area even if two sources in that area throw.

- [ ] **Step 1: Read the current behaviour.** Read `apps/server/src/alerts.ts:25-133` and the matching tests in `apps/server/src/alerts.test.ts`. Note the exact throw message the area-dedup uses ("two alert sources in the area") and the shape of the failed-source synthetic (`key`, `code`, `params`, `severity`, `since`, `area`).

- [ ] **Step 2: Write the failing tests.**

```ts
// in apps/server/src/alerts.test.ts, registry describe block
it("accepts two sources that share an area", () => {
  const a: AlertSource = { area: "fiscal", permission: "fiscal.view", read: async () => [] };
  const b: AlertSource = { area: "fiscal", permission: "fiscal.view", read: async () => [] };
  expect(() => createAlertRegistry({ claims: [], sources: [a, b] })).not.toThrow();
});

it("merges the alerts of two sources sharing an area", async () => {
  const held = new Set(["fiscal.view"]);
  const a: AlertSource = { area: "fiscal", permission: "fiscal.view",
    read: async () => [{ key: "x:1", code: "fiscal.submission_stopped", params: { count: 1 }, severity: "error", since: null }] };
  const b: AlertSource = { area: "fiscal", permission: "fiscal.view",
    read: async () => [{ key: "fiscal.awaiting_certificate", code: "fiscal.awaiting_certificate", params: {}, severity: "error", since: null }] };
  const registry = createAlertRegistry({ claims: [], sources: [a, b] });
  const alerts = await readOpenAlerts(tx, depsFor(registry), held); // depsFor = existing test helper
  expect(alerts.map((x) => x.code).sort()).toEqual(["fiscal.awaiting_certificate", "fiscal.submission_stopped"]);
});

it("reports one source_unavailable per area when two sources in it throw", async () => {
  const held = new Set(["fiscal.view"]);
  const boom = (): Promise<never> => { throw new Error("nope"); };
  const a: AlertSource = { area: "fiscal", permission: "fiscal.view", read: boom };
  const b: AlertSource = { area: "fiscal", permission: "fiscal.view", read: boom };
  const registry = createAlertRegistry({ claims: [], sources: [a, b] });
  const alerts = await readOpenAlerts(tx, depsFor(registry), held);
  expect(alerts.filter((x) => x.code === "alert.source_unavailable")).toHaveLength(1);
});
```

Keep the existing claim-prefix dedup test — that dedup does **not** relax.

`readOpenAlerts(tx, deps, held)` always runs `listOpenIncidents(tx, tenantId)` and each source in its own `tx.transaction(...)` savepoint, so the merge/throw tests need a real PGlite `tx` (with an `incidents` table and a tenant) and a full `AlertReadDeps` (`{ registry, tenantId, now, log }`). Check whether `alerts.test.ts` already has a `depsFor`/db helper (`grep -n "AlertReadDeps\|usePglite\|readOpenAlerts" apps/server/src/alerts.test.ts`); if not, build the deps and DB the way the branch-1 read tests do — do not assume a helper that isn't there. The pure `not.toThrow` registry test needs no DB.

- [ ] **Step 3: Run the tests to verify they fail.**
Run: `pnpm --filter @waitron/server test -- alerts.test.ts`
Expected: the first three FAIL (throws on duplicate area, or emits two synthetics); the claim-prefix test still PASSES.

- [ ] **Step 4: Relax the dedup.** In `createAlertRegistry`, delete the `area`-uniqueness check (keep the claim-`prefix` check). In `readOpenAlerts`'s failed-source branch, before pushing an `alert.source_unavailable:<area>` synthetic, skip it if one for that area was already pushed this read (track a `Set<string>` of areas that already failed). Leave the per-source savepoint and the `deps.log("error", "alert.source_unavailable", …)` line as they are — logging every failure is correct; only the visible synthetic dedups.

- [ ] **Step 5: Run the tests to verify they pass.**
Run: `pnpm --filter @waitron/server test -- alerts.test.ts`
Expected: PASS (all, including the retained claim-prefix and sort tests).

- [ ] **Step 6: Commit.**
```bash
git add apps/server/src/alerts.ts apps/server/src/alerts.test.ts
git commit -s -m "Let several alert sources share one area

The dashboard needs two sources under the fiscal area: the module-owned
submission check and the server-owned awaiting-certificate check. Allow
repeated areas and show the 'alerts unavailable' notice once per area."
```

---

### Task 2: A shared time-to-live cache for outside calls

**Files:**
- Create: `apps/server/src/ttl-cache.ts`
- Test: `apps/server/src/ttl-cache.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TtlCache<V> { get(key: string, compute: () => Promise<V>): Promise<V>; }
  export function createTtlCache<V>(opts: { ttlMs: number; now: () => Date }): TtlCache<V>;
  ```
  One computed value per key, reused until `ttlMs` has passed since it was computed; concurrent `get`s for the same cold key share one `compute` (store the promise, not just the value). A `compute` that rejects is not cached.

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache.js";

describe("createTtlCache", () => {
  it("computes once inside the window and again after it", async () => {
    let clock = new Date("2026-09-15T00:00:00Z");
    const cache = createTtlCache<number>({ ttlMs: 5 * 60_000, now: () => clock });
    const compute = vi.fn(async () => 42);
    expect(await cache.get("r1", compute)).toBe(42);
    clock = new Date("2026-09-15T00:04:59Z");
    expect(await cache.get("r1", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
    clock = new Date("2026-09-15T00:05:01Z");
    await cache.get("r1", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart", async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, now: () => new Date() });
    expect(await cache.get("a", async () => "A")).toBe("A");
    expect(await cache.get("b", async () => "B")).toBe("B");
  });

  it("does not cache a rejected compute", async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, now: () => new Date() });
    await expect(cache.get("r", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await cache.get("r", async () => 7)).toBe(7);
  });

  it("shares one compute for concurrent cold gets", async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, now: () => new Date() });
    const compute = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); return 1; });
    await Promise.all([cache.get("r", compute), cache.get("r", compute)]);
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail.**
Run: `pnpm --filter @waitron/server test -- ttl-cache.test.ts`
Expected: FAIL ("createTtlCache is not a function").

- [ ] **Step 3: Implement the cache.**

```ts
interface Entry<V> { at: number; value: Promise<V>; }

export interface TtlCache<V> {
  get(key: string, compute: () => Promise<V>): Promise<V>;
}

export function createTtlCache<V>(opts: { ttlMs: number; now: () => Date }): TtlCache<V> {
  const entries = new Map<string, Entry<V>>();
  return {
    async get(key, compute) {
      const nowMs = opts.now().getTime();
      const hit = entries.get(key);
      if (hit && nowMs - hit.at < opts.ttlMs) return hit.value;
      const value = compute();
      entries.set(key, { at: nowMs, value });
      // A rejected compute must not stick: drop it so the next call retries.
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass.**
Run: `pnpm --filter @waitron/server test -- ttl-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add apps/server/src/ttl-cache.ts apps/server/src/ttl-cache.test.ts
git commit -s -m "Add a shared time-to-live cache for alert source outside calls

Backup listings and reader battery are read once and reused for a short
window, shared by every dashboard session and filled only on demand."
```

---

### Task 3: The backups alert source

**Files:**
- Modify: `apps/server/src/backup-sweep.ts` (record each destination's last outcome)
- Create: `apps/server/src/alert-sources.ts` (add `backupAlertSource` + backup constants)
- Modify: `apps/server/src/errors.ts` (register the three `backup.*` codes)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (English + Spanish for the three codes)
- Modify: `apps/server/src/boot.ts` (build the source, add it to the registry's `sources`)
- Test: `apps/server/src/alert-sources.test.ts` (backup describe block), `apps/server/src/backup-sweep.test.ts` (the outcome holder)

**Interfaces:**
- Consumes: `readBackupStatus(backends, staleAfterMs, now)` and `BackupStatus`/`DestinationStatus` (`apps/server/src/backup-status.ts:9-50`); `WAITRON_BACKUP_STALE_AFTER_MS` → `staleAfterMs` (`apps/server/src/backup-config.ts`); `createTtlCache` (Task 2); `AlertSource`/`OngoingAlert` (`@waitron/module`).
- Produces:
  ```ts
  // in alert-sources.ts
  export interface BackupOutcomeHolder { failed: Map<string, { at: string }>; }
  export function backupAlertSource(deps: {
    listStatus: () => Promise<BackupStatus>;   // wraps readBackupStatus + the 1-minute cache
    outcomes: BackupOutcomeHolder;
    now: () => Date;
  }): AlertSource; // area "backup", permission "system.manage", screen "backup"
  export const BACKUP_STALE_SCREEN = "backup";
  ```
  `recordBackupOutcome(holder, destinationId, ok, at)` — sets `failed[dest] = { at }` on failure, deletes it on success — exported from `backup-sweep.ts` or `alert-sources.ts` (put it beside the holder type in `alert-sources.ts` so both files import it).

- [ ] **Step 1: Confirm the backup surface.** Read `apps/server/src/backup-status.ts:9-72`, `apps/server/src/backup-config.ts` (find `staleAfterMs` and how boot loads it), and `apps/server/src/backup-sweep.ts:200-227` (the per-destination `Promise.allSettled` where success/failure is currently only logged). Confirm `DestinationStatus` fields: `id`, `lastBackupAt`, `ageSeconds`, `stale`; and `BackupStatus` is `{ configured: false } | { configured: true; destinations: DestinationStatus[] }`.

- [ ] **Step 2: Write the failing source tests.**

```ts
// apps/server/src/alert-sources.test.ts
import { describe, expect, it } from "vitest";
import { backupAlertSource, type BackupOutcomeHolder, recordBackupOutcome } from "./alert-sources.js";
import type { BackupStatus } from "./backup-status.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const ctx = { tx: {} as never, tenantId: "t1" as never, now: NOW };

function src(status: BackupStatus, outcomes: BackupOutcomeHolder) {
  return backupAlertSource({ listStatus: async () => status, outcomes, now: () => NOW });
}

describe("backupAlertSource", () => {
  it("raises backup.disabled when not configured", async () => {
    const alerts = await src({ configured: false }, { failed: new Map() }).read(ctx);
    expect(alerts.map((a) => a.code)).toEqual(["backup.disabled"]);
    expect(alerts[0].severity).toBe("warning");
  });

  it("raises destination_overdue for a stale destination, with the last good backup as since", async () => {
    const status: BackupStatus = { configured: true, destinations: [
      { id: "local", lastBackupAt: "2026-09-10T00:00:00Z", ageSeconds: 999999, stale: true }] };
    const alerts = await src(status, { failed: new Map() }).read(ctx);
    const overdue = alerts.find((a) => a.code === "backup.destination_overdue");
    expect(overdue).toMatchObject({ key: "backup.destination_overdue:local", severity: "error",
      since: "2026-09-10T00:00:00Z", screen: "backup", params: { destination: "local" } });
  });

  it("raises nothing for a fresh, non-failed destination", async () => {
    const status: BackupStatus = { configured: true, destinations: [
      { id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }] };
    expect(await src(status, { failed: new Map() }).read(ctx)).toEqual([]);
  });

  it("raises destination_failed from the outcome holder, cleared by a success", async () => {
    const outcomes: BackupOutcomeHolder = { failed: new Map() };
    recordBackupOutcome(outcomes, "local", false, "2026-09-15T11:59:00Z");
    const status: BackupStatus = { configured: true, destinations: [
      { id: "local", lastBackupAt: NOW.toISOString(), ageSeconds: 5, stale: false }] };
    let alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toMatchObject([{ code: "backup.destination_failed", severity: "warning",
      since: "2026-09-15T11:59:00Z", params: { destination: "local" } }]);
    recordBackupOutcome(outcomes, "local", true, NOW.toISOString());
    alerts = await src(status, outcomes).read(ctx);
    expect(alerts).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify they fail.**
Run: `pnpm --filter @waitron/server test -- alert-sources.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `alert-sources.ts` (backup part) and `recordBackupOutcome`.**

```ts
import type { AlertSource, OngoingAlert } from "@waitron/module";
import type { BackupStatus } from "./backup-status.js";

export interface BackupOutcomeHolder { failed: Map<string, { at: string }>; }
export function recordBackupOutcome(h: BackupOutcomeHolder, dest: string, ok: boolean, at: string): void {
  if (ok) h.failed.delete(dest);
  else h.failed.set(dest, { at });
}

export function backupAlertSource(deps: {
  listStatus: () => Promise<BackupStatus>;
  outcomes: BackupOutcomeHolder;
  now: () => Date;
}): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      const status = await deps.listStatus();
      if (!status.configured) {
        return [{ key: "backup.disabled", code: "backup.disabled", params: {}, severity: "warning", since: null }];
      }
      const alerts: OngoingAlert[] = [];
      for (const d of status.destinations) {
        if (d.stale) {
          alerts.push({ key: `backup.destination_overdue:${d.id}`, code: "backup.destination_overdue",
            params: { destination: d.id }, severity: "error", since: d.lastBackupAt, screen: "backup" });
        }
        const failed = deps.outcomes.failed.get(d.id);
        if (failed) {
          alerts.push({ key: `backup.destination_failed:${d.id}`, code: "backup.destination_failed",
            params: { destination: d.id }, severity: "warning", since: failed.at, screen: "backup" });
        }
      }
      return alerts;
    },
  };
}
```

- [ ] **Step 5: Register the codes** in `apps/server/src/errors.ts` (in the same `declare module "@waitron/shared"` block that holds `alert.source_unavailable`):
```ts
"backup.destination_overdue": { destination: string };
"backup.destination_failed": { destination: string };
"backup.disabled": Record<string, never>;
```

- [ ] **Step 6: Add wording** in `apps/dashboard/src/i18n/alert-messages.ts` (keep the file import-free):
```ts
"backup.destination_overdue": {
  en: "Backups to “{destination}” are overdue — the last good backup is older than expected. Check the destination on the Backups page.",
  es: "Las copias de seguridad en «{destination}» están atrasadas: la última correcta es más antigua de lo esperado. Revisa el destino en la página de Copias.",
},
"backup.destination_failed": {
  en: "The last backup to “{destination}” failed. Open the Backups page to retry.",
  es: "La última copia de seguridad en «{destination}» falló. Abre la página de Copias para reintentar.",
},
"backup.disabled": {
  en: "Backups are not set up. Configure a destination on the Backups page so your data is protected.",
  es: "Las copias de seguridad no están configuradas. Configura un destino en la página de Copias para proteger tus datos.",
},
```

- [ ] **Step 7: Record the sweep outcome.** In `apps/server/src/backup-sweep.ts`, add a `deps.outcomes?: BackupOutcomeHolder` (import the type from `alert-sources.ts`) and, in the `Promise.allSettled` per-destination handler, call `recordBackupOutcome(deps.outcomes, destinationId, ok, now.toISOString())` on both the success and failure legs. Write a focused test in `backup-sweep.test.ts` asserting a failed destination lands in `outcomes.failed` and a subsequent success clears it. (Follow the file's existing `runOnce` test setup; if the sweep test owns no holder yet, pass a fresh `{ failed: new Map() }`.)

- [ ] **Step 8: Wire boot (backup outcomes + sweep only).** In `apps/server/src/boot.ts`: create `const backupOutcomes: BackupOutcomeHolder = { failed: new Map() };` early, and thread it into the backup sweep wiring (find it: `grep -n "backup-sweep\|runOnce\|onStored\|sweep" apps/server/src/boot.ts`, ~`:2660`) so the sweep records each outcome. Do **not** read backup status via `readBackupStatus` here — boot already owns a `backupSupervisor` (`:2162`) whose `.status()` returns `{ backupStatus }`, and boot already reuses it (`:2238`, `readBackup: () => backupSupervisor.status().then((s) => s.backupStatus)`). The backup source object is assembled in Task 7's final `sources` block (see its **Ordering** note), because it must be built after `backupSupervisor` exists — the branch-1 `createAlertRegistry` call at `:2044-2055` runs ~110 lines before the supervisor. This step only creates and threads `backupOutcomes`.

- [ ] **Step 9: Run the source tests, the sweep test, and typecheck.**
Run: `pnpm --filter @waitron/server test -- alert-sources.test.ts backup-sweep.test.ts && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 10: Commit.**
```bash
git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts apps/server/src/backup-sweep.ts apps/server/src/backup-sweep.test.ts apps/server/src/errors.ts apps/dashboard/src/i18n/alert-messages.ts apps/server/src/boot.ts
git commit -s -m "Add the backups alert source

Surface an overdue or failed backup destination, and backups not being
set up at all, on the dashboard. Destination outcomes are recorded in a
shared in-memory holder the sweep fills; the destination listing is
reused for a minute."
```

---

### Task 4: The fiscal-submission alert source (module-owned)

**Files:**
- Create: `packages/fiscal-verifactu/src/submission-alerts.ts`
- Modify: `packages/fiscal-verifactu/src/errors.ts` (register `fiscal.submission_delayed`, `fiscal.submission_stopped`)
- Modify: `packages/fiscal-verifactu/src/alerts.ts` (add `sources` to `FISCAL_ALERTS`)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (wording)
- Test: `packages/fiscal-verifactu/src/submission-alerts.test.ts` (PGlite)

**Interfaces:**
- Consumes: `registrosFacturacion` (`packages/fiscal-verifactu/src/schema/registros.ts`, column `fechaHoraHusoGenRegistro`), `envios` (`packages/fiscal-verifactu/src/schema/envios.ts`, `registroId` PK/FK, `estado`, `tenantId`); `AlertSource`/`OngoingAlert`/`AlertReadContext` (`@waitron/module`).
- Produces: `export const fiscalSubmissionSource: AlertSource;` (area `fiscal`, permission `fiscal.view`, no `screen`). Constants `SUBMISSION_DELAYED_WARN_MS = 4*60*60*1000`, `SUBMISSION_DELAYED_ERROR_MS = 24*60*60*1000`.

- [ ] **Step 1: Confirm the schema.** Read `registros.ts:107-109` (`fechaHoraHusoGenRegistro`) and `envios.ts:35-75` (the `registroId` PK is the FK to `registros_facturacion.id`; `estado` values `pendiente|enviando|aceptado|aceptado_con_errores|rechazado|detenido`). Confirm both tables carry `tenantId`. Confirm `app_user` may `SELECT` both (Ruling 2).

- [ ] **Step 2: Write the failing tests (PGlite, `asAppUser`).**

> **2026-09-20 — `packages/fiscal-verifactu/src/submission-alerts.test.ts` exists and asks for its
> database through `useVenueDb` (`@waitron/db/testing/venue-db.js`), not the `usePgliteDb` the
> sketch below names.** Same PGlite database, same migration sets, same per-test reset — the new
> helper forwards to the old one (plan task P2 step 5,
> `docs/superpowers/plans/2026-09-16-sqlite-slice1-storage-swap.md`). The sketch's own advice to
> grep a sibling for the real helper name is still the right move, and now it answers `useVenueDb`.
>
> **Only the helper name was re-checked.** The sketch's other stale half is the one this plan's own
> §"Tenant scoping" bullet told you to expect: it passes `tenantId` into every `read({ tx, tenantId,
> now })` and adds an `it("scopes to the tenant")` case. The tenant column went on 2026-09-14, and
> the shipped file passes no `tenantId` anywhere — `grep -c tenantId
> packages/fiscal-verifactu/src/submission-alerts.test.ts` returns 0.

```ts
// packages/fiscal-verifactu/src/submission-alerts.test.ts
import { describe, expect, it } from "vitest";
import { usePgliteDb } from "@waitron/db/testing"; // use the repo's real helper name; grep a sibling test
import { asAppUser } from "@waitron/db";
import { fiscalSubmissionSource } from "./submission-alerts.js";
// insert helpers: a registro at a chosen fechaHoraHusoGenRegistro + a linked envio in a chosen estado.

const T = "t1";
const NOW = new Date("2026-09-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("fiscalSubmissionSource", () => {
  const db = usePgliteDb();

  it("is silent when the oldest waiting record is 3 hours old", async () => {
    await seedWaiting(db, T, hoursAgo(3), "pendiente");
    await asAppUser(db, async (tx) => {
      expect(await fiscalSubmissionSource.read({ tx, tenantId: T, now: NOW })).toEqual([]);
    });
  });

  it("warns at 5 hours and errors at 25 hours, with count and hours", async () => {
    await seedWaiting(db, T, hoursAgo(5), "enviando");
    await asAppUser(db, async (tx) => {
      const [a] = await fiscalSubmissionSource.read({ tx, tenantId: T, now: NOW });
      expect(a).toMatchObject({ code: "fiscal.submission_delayed", severity: "warning",
        params: { count: 1, hours: 5 }, since: hoursAgo(5).toISOString() });
    });
    await seedWaiting(db, T, hoursAgo(25), "pendiente");
    await asAppUser(db, async (tx) => {
      const [a] = await fiscalSubmissionSource.read({ tx, tenantId: T, now: NOW });
      expect(a).toMatchObject({ code: "fiscal.submission_delayed", severity: "error", params: { count: 2, hours: 25 } });
    });
  });

  it("errors on a detenido record", async () => {
    await seedWaiting(db, T, hoursAgo(1), "detenido");
    await asAppUser(db, async (tx) => {
      const codes = (await fiscalSubmissionSource.read({ tx, tenantId: T, now: NOW })).map((a) => a.code);
      expect(codes).toContain("fiscal.submission_stopped");
    });
  });

  it("scopes to the tenant", async () => {
    await seedWaiting(db, "other", hoursAgo(25), "pendiente");
    await asAppUser(db, async (tx) => {
      expect(await fiscalSubmissionSource.read({ tx, tenantId: T, now: NOW })).toEqual([]);
    });
  });
});
```
(Write `seedWaiting(db, tenant, genTime, estado)` inserting one `registros_facturacion` row with `fechaHoraHusoGenRegistro = genTime` and one `envios` row `registroId = that id, estado`. Grep an existing fiscal-verifactu test for the minimal required non-null columns on both tables — hash, sif, secuencia — and reuse its insert helper if one exists.)

- [ ] **Step 3: Run to verify they fail.**
Run: `pnpm --filter @waitron/fiscal-verifactu test -- submission-alerts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `submission-alerts.ts`.**

```ts
import { and, count, eq, inArray, min } from "drizzle-orm";
import type { AlertSource, OngoingAlert } from "@waitron/module";
import { envios } from "./schema/envios.js";
import { registrosFacturacion } from "./schema/registros.js";

export const SUBMISSION_DELAYED_WARN_MS = 4 * 60 * 60 * 1000;
export const SUBMISSION_DELAYED_ERROR_MS = 24 * 60 * 60 * 1000;

export const fiscalSubmissionSource: AlertSource = {
  area: "fiscal",
  permission: "fiscal.view",
  async read({ tx, tenantId, now }): Promise<readonly OngoingAlert[]> {
    const alerts: OngoingAlert[] = [];

    const [waiting] = await tx
      .select({ oldest: min(registrosFacturacion.fechaHoraHusoGenRegistro), n: count() })
      .from(envios)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
      .where(and(eq(envios.tenantId, tenantId), inArray(envios.estado, ["pendiente", "enviando"])));
    if (waiting?.oldest) {
      const ageMs = now.getTime() - new Date(waiting.oldest).getTime();
      if (ageMs >= SUBMISSION_DELAYED_WARN_MS) {
        alerts.push({
          key: "fiscal.submission_delayed",
          code: "fiscal.submission_delayed",
          params: { count: Number(waiting.n), hours: Math.floor(ageMs / 3_600_000) },
          severity: ageMs >= SUBMISSION_DELAYED_ERROR_MS ? "error" : "warning",
          since: new Date(waiting.oldest).toISOString(),
        });
      }
    }

    const [stopped] = await tx
      .select({ n: count(), oldest: min(registrosFacturacion.fechaHoraHusoGenRegistro) })
      .from(envios)
      .innerJoin(registrosFacturacion, eq(registrosFacturacion.id, envios.registroId))
      .where(and(eq(envios.tenantId, tenantId), eq(envios.estado, "detenido")));
    if (stopped && Number(stopped.n) > 0) {
      // count > 0 means the innerJoin matched a registro, and fechaHoraHusoGenRegistro is notNull,
      // so `oldest` is always present here — no `: null` arm (it would be an uncovered branch, and
      // fiscal-verifactu holds the 98% branch bar).
      alerts.push({
        key: "fiscal.submission_stopped",
        code: "fiscal.submission_stopped",
        params: { count: Number(stopped.n) },
        severity: "error",
        since: new Date(stopped.oldest as string).toISOString(),
      });
    }
    return alerts;
  },
};
```
Read the emitted SQL with `.toSQL()` once while implementing to confirm the join is on the base table and the tenant predicate is present (CLAUDE.md §3, the correlated-subquery trap).

- [ ] **Step 5: Register the codes** in `packages/fiscal-verifactu/src/errors.ts`:
```ts
"fiscal.submission_delayed": { count: number; hours: number };
"fiscal.submission_stopped": { count: number };
```

- [ ] **Step 6: Fill the seat.** In `packages/fiscal-verifactu/src/alerts.ts`:
```ts
import { fiscalSubmissionSource } from "./submission-alerts.js";
export const FISCAL_ALERTS: ModuleAlerts = {
  events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
  sources: [fiscalSubmissionSource],
};
```

- [ ] **Step 7: Wording** in `apps/dashboard/src/i18n/alert-messages.ts`:
```ts
"fiscal.submission_delayed": {
  en: "{count} fiscal record(s) have been waiting {hours}h to reach the tax agency. If this persists, check that the fiscal certificate is valid.",
  es: "{count} registro(s) fiscal(es) llevan {hours} h esperando para llegar a la Agencia Tributaria. Si continúa, comprueba que el certificado fiscal sea válido.",
},
"fiscal.submission_stopped": {
  en: "{count} fiscal record(s) have stopped submitting and need attention.",
  es: "{count} registro(s) fiscal(es) han detenido su envío y requieren atención.",
},
```

- [ ] **Step 8: Run the tests and typecheck.**
Run: `pnpm --filter @waitron/fiscal-verifactu test -- submission-alerts.test.ts && pnpm --filter @waitron/fiscal-verifactu typecheck`
Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/fiscal-verifactu/src/submission-alerts.ts packages/fiscal-verifactu/src/submission-alerts.test.ts packages/fiscal-verifactu/src/errors.ts packages/fiscal-verifactu/src/alerts.ts apps/dashboard/src/i18n/alert-messages.ts
git commit -s -m "Add the fiscal-submission alert source

Warn when records have waited too long to reach the tax agency (four
hours, then a stronger alert at twenty-four) and when submission has
stopped. The module contributes the source through its alerts seat so
generic code never names the fiscal tables."
```

---

### Task 5: The awaiting-certificate alert source (server-owned, shares the fiscal area)

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (add `awaitingCertAlertSource`)
- Modify: `packages/fiscal-verifactu/src/errors.ts` (register `fiscal.awaiting_certificate`)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (wording)
- Modify: `apps/server/src/boot.ts` (build the source from the existing holder, add to `sources`)
- Test: `apps/server/src/alert-sources.test.ts` (awaiting-cert describe block)

**Interfaces:**
- Consumes: `AwaitingCertStatus` (`apps/server/src/pass.ts:88`), the boot binding `awaitingFiscalCert` (`boot.ts:1552`), Task 1's relaxed registry.
- Produces: `export function awaitingCertAlertSource(holder: AwaitingCertStatus): AlertSource;` (area `fiscal`, permission `fiscal.view`, no screen).

- [ ] **Step 1: Write the failing tests.**
```ts
import { awaitingCertAlertSource } from "./alert-sources.js";
const ctx = { tx: {} as never, tenantId: "t1" as never, now: new Date() };

it("is silent while the certificate is present", async () => {
  expect(await awaitingCertAlertSource({ current: false }).read(ctx)).toEqual([]);
});
it("raises fiscal.awaiting_certificate while waiting", async () => {
  const [a] = await awaitingCertAlertSource({ current: true }).read(ctx);
  expect(a).toMatchObject({ key: "fiscal.awaiting_certificate", code: "fiscal.awaiting_certificate", severity: "error" });
});
```

- [ ] **Step 2: Run to verify they fail.**
Run: `pnpm --filter @waitron/server test -- alert-sources.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**
```ts
import type { AwaitingCertStatus } from "./pass.js";
export function awaitingCertAlertSource(holder: AwaitingCertStatus): AlertSource {
  return {
    area: "fiscal",
    permission: "fiscal.view",
    async read(): Promise<readonly OngoingAlert[]> {
      if (!holder.current) return [];
      return [{ key: "fiscal.awaiting_certificate", code: "fiscal.awaiting_certificate",
        params: {}, severity: "error", since: null }];
    },
  };
}
```

- [ ] **Step 4: Register the code** in `packages/fiscal-verifactu/src/errors.ts`:
```ts
"fiscal.awaiting_certificate": Record<string, never>;
```
(`fiscal.*` is fiscal-verifactu's namespace even though this source lives in `apps/server`; the code names the domain, not the package.)

- [ ] **Step 5: Wording** in `apps/dashboard/src/i18n/alert-messages.ts`:
```ts
"fiscal.awaiting_certificate": {
  en: "Fiscal records are waiting because no valid tax certificate is installed. Upload the certificate to resume submitting.",
  es: "Hay registros fiscales en espera porque no hay un certificado tributario válido instalado. Sube el certificado para reanudar los envíos.",
},
```

- [ ] **Step 6: Wire boot.** Add `awaitingCertAlertSource(awaitingFiscalCert)` to the server-owned `sources` list (final shape in Task 7). This is where two `fiscal` sources coexist — Task 1's relax must already be merged.

- [ ] **Step 7: Run the tests and typecheck.**
Run: `pnpm --filter @waitron/server test -- alert-sources.test.ts && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts packages/fiscal-verifactu/src/errors.ts apps/dashboard/src/i18n/alert-messages.ts apps/server/src/boot.ts
git commit -s -m "Add the awaiting-certificate alert source

Show that fiscal submission is paused for a missing certificate, reading
the in-memory flag the fiscal pass already keeps. It shares the fiscal
area with the module submission source."
```

---

### Task 6: The printing alert source

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (add `printingAlertSource` + printing constants)
- Modify: `packages/printing/src/errors.ts` (register the printing codes — see Ruling 6)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (wording)
- Modify: `apps/server/src/boot.ts` (add to `sources`)
- Test: `apps/server/src/alert-sources.test.ts` (printing describe block, PGlite)

**Interfaces:**
- Consumes: `printAgents` (`packages/db/src/schema/print-agents.ts`: `active`, `lastSeenAt`, `name`, `tenantId`), `printJobs` (`packages/db/src/schema/print-jobs.ts`: `printerId`, `kind` `'document'|'drawer'`, `status` `queued|printing|done|failed`, `attempts`, `createdAt`, `tenantId`), the `printers` table (`active`, `name`), `MAX_DELIVERY_ATTEMPTS` (`packages/printing/src/runtime.ts:33`).
- Produces: `export function printingAlertSource(): AlertSource;` (area `printing`, permission `printer.manage`, screen `printers`). Constants `AGENT_SILENT_MS = 5*60*1000`, `JOBS_WAITING_MS = 2*60*1000`.

- [ ] **Step 1: Confirm schema.** Read the two schema files and `runtime.ts:33/168-177`. The code names are already decided (Ruling 6: `agent.silent`, `printer.jobs_waiting`) — `grep -n '"agent\.\|"printer\.' packages/printing/src/errors.ts` only to confirm both families exist and find the insertion point. Confirm `printAgents`/`printJobs`/`printers` are exported from `@waitron/db` (`grep -n "printAgents\|printJobs\|printers" packages/db/src/index.ts`) and whether `MAX_DELIVERY_ATTEMPTS` is exported from `@waitron/printing`.

- [ ] **Step 2: Write the failing tests (PGlite).**
```ts
// agent_silent: an active agent last seen 4 min ago raises nothing, 6 min ago raises the alert, a fresh pull clears it.
// jobs_waiting: a document job queued 3 min ago on an active printer raises the alert with the printer name and count;
//   a job 1 min old raises nothing; a drawer job never counts; a failed job at MAX_DELIVERY_ATTEMPTS raises it.
// tenant scoping: another tenant's silent agent and waiting job raise nothing for tenant T.
```
Write these as concrete cases mirroring Task 4's structure: seed rows via the print schema, run `printingAlertSource().read({ tx, tenantId, now })` under `asAppUser`, assert codes/params/`since`. Grep an existing printing test (`packages/printing/src/*.test.ts`) for the minimal insert helpers for `printers`/`print_agents`/`print_jobs`.

- [ ] **Step 3: Run to verify they fail.** `pnpm --filter @waitron/server test -- alert-sources.test.ts` → FAIL.

- [ ] **Step 4: Implement.** Import `printAgents`, `printJobs`, `printers` from `@waitron/db` (not the printing package), `MAX_DELIVERY_ATTEMPTS` from `@waitron/printing` (or inline it with a pointer to `runtime.ts:33` if it is not exported), and the drizzle operators.
```ts
export const AGENT_SILENT_MS = 5 * 60 * 1000;
export const JOBS_WAITING_MS = 2 * 60 * 1000;

export function printingAlertSource(): AlertSource {
  return {
    area: "printing",
    permission: "printer.manage",
    async read({ tx, tenantId, now }): Promise<readonly OngoingAlert[]> {
      const alerts: OngoingAlert[] = [];
      // lastSeenAt and createdAt are drizzle mode:"string" columns, so compare against ISO strings,
      // never a Date object (that would not typecheck).
      const silentBefore = new Date(now.getTime() - AGENT_SILENT_MS).toISOString();
      const agents = await tx.select({ name: printAgents.name, seen: printAgents.lastSeenAt })
        .from(printAgents)
        .where(and(eq(printAgents.tenantId, tenantId), eq(printAgents.active, true),
                   lt(printAgents.lastSeenAt, silentBefore)));
      for (const a of agents) {
        // the lt filter excludes a null last_seen_at, so a.seen is a real timestamp here.
        alerts.push({ key: `agent.silent:${a.name}`, code: "agent.silent",
          params: { agent: a.name }, severity: "warning",
          since: new Date(a.seen as string).toISOString(), screen: "printers" });
      }
      // per active printer: document jobs stuck > 2 min, or failed at the delivery-attempt ceiling.
      const stuckBefore = new Date(now.getTime() - JOBS_WAITING_MS).toISOString();
      const rows = await tx.select({
          printer: printers.name, id: printers.id,
          n: count(), oldest: min(printJobs.createdAt) })
        .from(printers)
        .innerJoin(printJobs, eq(printJobs.printerId, printers.id))
        .where(and(
          eq(printers.tenantId, tenantId), eq(printers.active, true),
          eq(printJobs.tenantId, tenantId), eq(printJobs.kind, "document"),
          or(
            and(inArray(printJobs.status, ["queued", "printing", "failed"]), lt(printJobs.createdAt, stuckBefore)),
            and(eq(printJobs.status, "failed"), gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
          )))
        .groupBy(printers.id, printers.name);
      for (const r of rows) {
        // a group only forms when at least one job matched, so oldest is non-null.
        alerts.push({ key: `printer.jobs_waiting:${r.id}`, code: "printer.jobs_waiting",
          params: { printer: r.printer, count: Number(r.n) }, severity: "error",
          since: new Date(r.oldest as string).toISOString(), screen: "printers" });
      }
      return alerts;
    },
  };
}
```
Read `.toSQL()` once to confirm the tenant predicate is present and the join is on the base table (CLAUDE.md §3, the base-vs-join and correlated-subquery traps). Confirm the `printerId` join column against `runtime.ts:168-171`.

- [ ] **Step 5: Register the codes** in `packages/printing/src/errors.ts` (into the existing `agent.*` and `printer.*` families — Ruling 6):
```ts
"agent.silent": { agent: string };
"printer.jobs_waiting": { printer: string; count: number };
```

- [ ] **Step 6: Wording** in `apps/dashboard/src/i18n/alert-messages.ts`:
```ts
"agent.silent": {
  en: "Print agent “{agent}” has gone quiet — it has not checked in for several minutes. Printing may be affected.",
  es: "El agente de impresión «{agent}» está en silencio: lleva varios minutos sin dar señales. La impresión puede verse afectada.",
},
"printer.jobs_waiting": {
  en: "{count} print job(s) are stuck at “{printer}”. Check the printer on the Printers page.",
  es: "{count} trabajo(s) de impresión atascado(s) en «{printer}». Revisa la impresora en la página de Impresoras.",
},
```

- [ ] **Step 7: Wire boot** (add `printingAlertSource()` to `sources`; final shape in Task 7).

- [ ] **Step 8: Run tests + typecheck.** `pnpm --filter @waitron/server test -- alert-sources.test.ts && pnpm --filter @waitron/server typecheck` → PASS.

- [ ] **Step 9: Commit.**
```bash
git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts packages/printing/src/errors.ts apps/dashboard/src/i18n/alert-messages.ts apps/server/src/boot.ts
git commit -s -m "Add the printing alert source

Surface a print agent that has gone quiet and print jobs stuck at a
printer, one alert per agent and per printer."
```

---

### Task 7: The card-reader battery alert source, and the final boot wiring

**Files:**
- Modify: `apps/server/src/alert-sources.ts` (add `batteryAlertSource` + battery constants)
- Modify: `apps/server/src/errors.ts` (register `reader.battery_low`)
- Modify: `apps/dashboard/src/i18n/alert-messages.ts` (wording)
- Modify: `apps/server/src/boot.ts` (build the battery source and assemble the final `sources` array)
- Test: `apps/server/src/alert-sources.test.ts` (battery describe block); the cache-reuse case against a stub provider

**Interfaces:**
- Consumes: `cardReaders` (`packages/payments/src/schema/card-readers.ts`: `id`, `provider`, `providerRef`, `name`, `active`, `tenantId`); the card-provider seat `cardProviderById(providers, id)` and `seat.readers.status(runtimeDeps, providerRef) → ReaderStatus` with optional `batteryPercent` (`packages/payments/src/card-provider.ts:76,89-107`); `createTtlCache` (Task 2).
- Produces: `export function batteryAlertSource(deps: { providers; runtimeDeps(tenantId): CardProviderRuntimeDeps; cache: TtlCache<number | null>; }): AlertSource;` (area `card_reader`, permission `payments.manage`, screen `payments`). Constants `BATTERY_WARN = 20`, `BATTERY_ERROR = 10`.

- [ ] **Step 1: Confirm the reader surface.** Read `card-provider.ts:67-122`, `payments-api.ts:478-496` (how a reader's status is fetched: `cardProviderById` then `seat.readers.status(runtimeDeps(), providerRef)`), and `card-readers.ts:11-40`. Note that only SumUp returns `batteryPercent`; a reader without it raises nothing.

- [ ] **Step 2: Write the failing tests.**
```ts
// Active readers come from ctx.tx; a stub provider returns batteryPercent per providerRef.
// - percent 25 -> nothing; 20 -> warning; 10 -> error; undefined -> nothing.
// - reader name + percent in params, key reader.battery_low:<id>.
// - two reads within 5 min make one provider status call (cache); a read after 5 min makes another.
// - tenant scoping: another tenant's low reader raises nothing.
```
Seed `card_readers` rows (active, provider "stub", providerRef "p1", name "Reader 1") under PGlite; build the source with a stub `providers` seat whose `readers.status` counts calls and returns a configured `batteryPercent`, and a real `createTtlCache` driven by a mutable clock. Assert codes/params and the call count.

- [ ] **Step 3: Run to verify they fail.** → FAIL.

- [ ] **Step 4: Implement.**
```ts
export const BATTERY_WARN = 20;
export const BATTERY_ERROR = 10;

export function batteryAlertSource(deps: {
  providers: CardProviderContribution[];
  runtimeDeps: (tenantId: TenantId) => CardProviderRuntimeDeps;
  cache: TtlCache<number | null>;
}): AlertSource {
  return {
    area: "card_reader",
    permission: "payments.manage",
    async read({ tx, tenantId }): Promise<readonly OngoingAlert[]> {
      const readers = await tx.select({ id: cardReaders.id, provider: cardReaders.provider,
          ref: cardReaders.providerRef, name: cardReaders.name })
        .from(cardReaders)
        .where(and(eq(cardReaders.tenantId, tenantId), eq(cardReaders.active, true)));
      const alerts: OngoingAlert[] = [];
      for (const r of readers) {
        const percent = await deps.cache.get(r.id, async () => {
          // cardProviderById THROWS on an unknown provider id (it never returns undefined), so a
          // misconfigured reader collapses this whole source to alert.source_unavailable:card_reader
          // — the spec's source-level failure model. That is acceptable; do not add a dead null-check.
          const seat = cardProviderById(deps.providers, r.provider);
          const status = await seat.readers.status(deps.runtimeDeps(tenantId), r.ref);
          return status.batteryPercent ?? null;
        });
        if (percent === null || percent > BATTERY_WARN) continue;
        alerts.push({ key: `reader.battery_low:${r.id}`, code: "reader.battery_low",
          params: { reader: r.name, percent }, severity: percent <= BATTERY_ERROR ? "error" : "warning",
          since: null, screen: "payments" });
      }
      return alerts;
    },
  };
}
```
(A provider whose `status` throws propagates out of `read`, so the whole battery source becomes one `alert.source_unavailable:card_reader` — the spec's source-level failure model. Note this in a comment.)

- [ ] **Step 5: Register the code** in `apps/server/src/errors.ts` (the `reader.*` namespace already lives there):
```ts
"reader.battery_low": { reader: string; percent: number };
```

- [ ] **Step 6: Wording** in `apps/dashboard/src/i18n/alert-messages.ts`:
```ts
"reader.battery_low": {
  en: "Card reader “{reader}” battery is low ({percent}%). Charge it to avoid interruptions at the till.",
  es: "La batería del lector de tarjetas «{reader}» está baja ({percent} %). Cárgalo para evitar interrupciones en la caja.",
},
```

- [ ] **Step 7: Assemble the final boot `sources` array.** In `apps/server/src/boot.ts`, replace the single `sources: enabledAlertSources(setsToMigrate)` argument with:
```ts
const batteryCache = createTtlCache<number | null>({ ttlMs: 5 * 60_000, now });
const serverAlertSources: AlertSource[] = [
  backupSource,                                   // Task 3
  awaitingCertAlertSource(awaitingFiscalCert),    // Task 5
  printingAlertSource(),                          // Task 6
  batteryAlertSource({ providers: cardProviders, runtimeDeps: cardRuntimeDeps, cache: batteryCache }), // Task 7
];
// ...
registry: createAlertRegistry({
  claims: ALL_ALERT_CLAIMS,
  sources: [...enabledAlertSources(setsToMigrate), ...serverAlertSources],
}),
```
**Ordering (important).** The branch-1 `createAlertRegistry` + `mountAlertsApi` block currently sits at ~`boot.ts:2044-2055`, ~110 lines **before** `backupSupervisor` is built (`:2162`) and reloaded (`:2181`). The backup source's `listStatus` closes over `backupSupervisor`, so move the whole `createAlertRegistry`/`mountAlertsApi` block to just after the supervisor is built and reloaded (~`:2181-2238`), beside the other management-api route mounts — route mounts are order-independent among themselves, but keep it before any catch-all/404 handler. Create `const backupOutcomes` early (Task 3, Step 8) so the sweep wiring (~`:2660`) can fill it. Build the backup source inside the moved block:
```ts
const backupCache = createTtlCache<BackupStatus>({ ttlMs: 60_000, now });
const backupSource = backupAlertSource({
  listStatus: () => backupCache.get("status", () => backupSupervisor.status().then((s) => s.backupStatus)),
  outcomes: backupOutcomes,
  now,
});
```
Locate the card-provider bindings (`grep -n "cardProvider\|providers\|ring\b" apps/server/src/boot.ts`) and build `cardRuntimeDeps(tenantId)` exactly as `apps/server/src/payments-api.ts` builds its `runtimeDeps` (db, ring, tenantId, fetch). Reuse `awaitingFiscalCert` (`:1552`); do not construct a second copy of any binding.

- [ ] **Step 8: Run tests + typecheck + the server package suite (this is the integration point).**
Run: `pnpm --filter @waitron/server test -- alert-sources.test.ts && pnpm --filter @waitron/server typecheck`
Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add apps/server/src/alert-sources.ts apps/server/src/alert-sources.test.ts apps/server/src/errors.ts apps/dashboard/src/i18n/alert-messages.ts apps/server/src/boot.ts
git commit -s -m "Add the card-reader battery alert source and wire every server source

Warn on a low reader battery and error when it is very low, reusing the
provider's battery reading for five minutes. Assemble the four
server-owned sources beside the module sources at boot."
```

---

### Task 8: A guard that keeps every ongoing code worded

**Files:**
- Create: `scripts/ongoing-alert-codes.test.ts`

**Interfaces:**
- Consumes: `ALERT_MESSAGES` (`apps/dashboard/src/i18n/alert-messages.ts`), the source files as text.

- [ ] **Step 1: Write the guard (and prove it by deletion).**
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALERT_MESSAGES } from "../apps/dashboard/src/i18n/alert-messages.js";

// Hand-listed files that name an ongoing alert code as a string literal.
// It reads TEXT, so a code assembled at runtime would escape it — every code here is a plain literal.
const ONGOING_CODE_SOURCES = [
  "apps/server/src/alert-sources.ts",
  "packages/fiscal-verifactu/src/submission-alerts.ts",
];
const CODE_RE = /code: "([a-z_]+\.[a-z_]+)"/g;

function ongoingCodes(): string[] {
  const codes = new Set<string>();
  for (const f of ONGOING_CODE_SOURCES) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const m of text.matchAll(CODE_RE)) codes.add(m[1]);
  }
  return [...codes];
}

describe("ongoing alert codes reach the dashboard", () => {
  it("finds the ongoing codes it is meant to guard", () => {
    // A control: the list is non-empty, so a broken regex fails loudly rather than passing vacuously.
    expect(ongoingCodes().length).toBeGreaterThanOrEqual(9);
  });
  it("every ongoing code has English and Spanish wording", () => {
    const missing = ongoingCodes().filter((c) => !(ALERT_MESSAGES[c]?.en && ALERT_MESSAGES[c]?.es));
    expect(missing).toEqual([]);
  });
});
```
Adjust the `../` depth and the URL base to match how `scripts/alert-codes.test.ts` resolves repo paths (copy its exact resolution helper). Confirm the regex matches the literal spelling the sources use (`code: "backup.disabled"` etc.).

- [ ] **Step 2: Run it.**
Run: `pnpm vitest run scripts/ongoing-alert-codes.test.ts` (or the repo's root-guard command — check how `scripts/alert-codes.test.ts` is run in CI/hook).
Expected: PASS (all nine codes worded from Tasks 3–7).

- [ ] **Step 3: Prove the guard bites.** Temporarily delete one `backup.*` wording entry, rerun, confirm the second test FAILS naming that code; restore it.

- [ ] **Step 4: Commit.**
```bash
git add scripts/ongoing-alert-codes.test.ts
git commit -s -m "Guard that every ongoing alert code is worded in both languages

It reads the source files as text, so a code built at runtime would
escape it — every ongoing code today is a plain literal."
```

---

### Task 9: Route and permission integration tests

**Files:**
- Modify: `apps/server/src/alerts-api.test.ts` (or the branch-1 route test file — grep for the existing alerts route tests)

**Interfaces:**
- Consumes: the mounted routes and the assembled registry (real sources or representative stubs).

- [ ] **Step 1: Confirm what branch 1 already asserts.** Read the existing alerts route tests. Add only the ongoing-specific cases the spec's *Testing → Routes* names that are not already covered.

- [ ] **Step 2: Write the failing/added tests.**
  - A session holding only `payments.manage` receives only `card_reader` (battery) alerts, none of the fiscal/backup/printing ongoing alerts.
  - A throwing ongoing source leaves the other sources' alerts intact plus exactly one `alert.source_unavailable` for its area (assert the code, not just "an error").
  - The `GET /management-api/alerts` poll carries the passive header path (assert it does not extend the session — follow the branch-1 passive-read assertion).
  - While `tenant_id` exists: a two-tenant setup where tenant B has a low reader / stuck job / stopped fiscal record — tenant A's session sees none of B's ongoing alerts (each source's tenant predicate). If `tenant_id` is already gone, skip this case with a comment pointing at the drop-tenant-id landing.

- [ ] **Step 3: Run to verify they fail, then pass after any wiring fix.**
Run: `pnpm --filter @waitron/server test -- alerts-api.test.ts`

- [ ] **Step 4: Run the server coverage suite** to confirm nothing regressed and the new source files are covered:
Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at the package's thresholds. If a source file is under-covered, add the missing firing/control case in `alert-sources.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add apps/server/src/alerts-api.test.ts
git commit -s -m "Test ongoing alerts through the routes: permission filtering, a failing source, tenant scoping"
```

---

### Task 10: Look at it, and update the docs

**Files:**
- Modify: `docs/backlog.md` (mark A5 branch 2), the ledger `docs/handoffs/2026-09-15-dashboard-alerts-ongoing.md`, and `docs/developers/design-system.md` only if a new note is genuinely needed (badges/toasts already landed in branch 1).

- [ ] **Step 1: Verify the 60-second refresh, and pin the ongoing "Go to" behaviour with a browser test (unconditionally).** Read `apps/dashboard/src/api/live-queries.ts` and confirm `listAlerts` polls on the 60 000 ms default (Ruling 7). Then — because branch 2 produces the **first** real `ongoing` alerts (branch 1 shipped only `event` alerts) — add a browser-mode test (not gated on "if branch 1 didn't build it") in the panel/screen suite that feeds a stub `ongoing` alert and asserts: (a) with the alert's `screen` permission held, the panel/screen renders a "Go to …" control targeting that screen; (b) without that permission, no "Go to" is shown. If the branch-1 panel/screen already renders this, the test still belongs here as the first end-to-end proof; if it does not, implement the rendering here too.

- [ ] **Step 2: Look at it (CLAUDE.md §4).** Start the dev stack from this worktree (`wa-wt demo waitron-feat-dashboard-alerts-ongoing`), seed at least one condition per source (a disabled backup is free; a `detenido` envío; a silent agent; a low reader via the fake provider), and open the bell, panel and Alerts screen **in both themes and at phone width**. Confirm each ongoing alert shows real wording (not the generic sentence with a raw code) and the correct "Go to" target or none. Capture a screenshot of the panel with a mix of ongoing alerts.

- [ ] **Step 3: Run the dashboard browser suite** for the alerts screen/bell:
Run: `pnpm --filter @waitron/dashboard test -- alerts` (confirm the real filter with `grep -rl alerts apps/dashboard/src/**/*.test.ts`)
Expected: PASS, axe included in both themes.

- [ ] **Step 4: Update `docs/backlog.md`.** Change A5 item (2) from "NEXT" to "BUILT on branch, awaiting merge" with the branch name; leave the "LANDED" edit for the post-merge docs commit. Remove the branch-2 caveat in the backlog that says `alert-messages.ts` has no ongoing wording (Task 3–7 fixed it) — or rewrite it to point at the new guard.

- [ ] **Step 5: Update the ledger** `docs/handoffs/2026-09-15-dashboard-alerts-ongoing.md`: `Status: in progress` → the exact next step (finish-branch), decisions (Ruling 1, the registry relax), and the worktree/branch. It is git-ignored — never open a PR for it.

- [ ] **Step 6: Commit.**
```bash
git add docs/backlog.md docs/developers/design-system.md apps/dashboard
git commit -s -m "Look at the ongoing alerts and update the backlog

Verified the bell, panel and Alerts screen show real wording for every
ongoing check in both themes and at phone width."
```

---

## Self-review notes (for the plan reviewer)

- **Spec coverage.** Backups (Task 3), fiscal submission (Task 4), awaiting-cert (Task 5), printing (Task 6), battery (Task 7) — the five ongoing checks. Wording for every code (Tasks 3–7) and a guard (Task 8). Permission filtering, a failing source, passive poll, two-tenant probe (Task 9). Caching 5 min / 1 min (Tasks 2, 3, 7). Look-at-it in both themes (Task 10). The 60 s refresh is pre-existing (Ruling 7, verified Task 10).
- **Open question for the reviewer (Ruling 1).** Relaxing `createAlertRegistry`'s area-dedup is a branch-1 change. The alternative — giving awaiting-cert a distinct area — deviates from the spec's area grouping. Confirm the relax is preferred, and that deduping the failure synthetic per area is the right visible behaviour.
- **Prefix decision (Ruling 6) — resolved to `agent.silent` / `printer.jobs_waiting`** (sibling-consistent, per the spec's own "follow the siblings' singular domain prefixes"). Deviates from the *checks* section's provisional `printing.*` spelling; confirm at owner sign-off, since codes are never renamed once shipped.
- **Grant reliance (Ruling 2).** The fiscal submission source reads `registros_facturacion`/`envios` as `app_user`. If a future migration narrows those grants, Task 4's source turns into `alert.source_unavailable` — the two-tenant/route tests would catch a total failure but not a silent narrowing; the PGlite grant test (`asAppUser`) is the guard.
- **`since` choices.** `submission_stopped` uses the oldest `detenido` record's generated time; `awaiting_certificate` and `backup.disabled` carry no `since` (nothing meaningful); `battery_low` carries none (percent is the signal). Flag if the panel needs a `since` on any of these.
- **Coverage placement.** `alert-sources.ts` lives in `apps/server`, tested from `apps/server`; `submission-alerts.ts` in `packages/fiscal-verifactu`, tested there. Neither needs a root-project home. The new root guard (Task 8) reads text only.
