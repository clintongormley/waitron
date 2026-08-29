# Onboarding Slice 4a — Box-status surface + time-health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a trading-mode `GET /api/box/status` JSON surface that aggregates the operator-facing box facts the onboarding spec §12/§13 want (mode, environment, time-health, TLS cert expiry, fiscal-chain height, replication lag, duty staleness), plus the greenfield time-health probe that feeds it.

**Architecture:** A pure aggregator `collectBoxStatus(...)` composes small, independently-tested sub-readers (time-health, cert-expiry, chain-height) with three existing primitives reused verbatim — `readDeploymentMode` (`@waitron/db`), `healthSnapshot` (`apps/server/src/health.ts`), and `lagFor` (`@waitron/sync`). A thin `mountBoxStatusApi` registers one authenticated GET route on the shared trading Hono app, gated exactly like the FP-1 status routes (`requireManagementSession` → 401, then `withTenant` + `asAppUser` + `authorizeManager` with the existing `till.configure` permission). Backup fields are a deliberate `{ configured: false }` placeholder here; slice 4b fills them.

**Tech Stack:** TypeScript, Hono, Drizzle, Node's built-in `node:crypto` `X509Certificate` (no new dependency), Vitest with `@waitron/db/testing/lifecycle` (`usePgliteDb` / `useRealPostgres` / `useTemplateDb`).

**Spec:** `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` (slice 4, §12/§13/§16), constrained by `docs/superpowers/specs/2026-08-29-promotion-failover-and-node-lifecycle-design.md` (§5.1 durability surface — the replication field is the seam that surface later grows from).

## Global Constraints

- **No new error code and no new permission.** Reuse the existing `till.configure` permission (`apps/server/src/management-api.ts:351`). Any thrown `AppError` code must name the DOMAIN CONCEPT and its file must `import "./errors.js"` (CLAUDE.md §3). This slice should need no new code — it reads, it does not fail-with-a-domain-error.
- **English-only chrome for the MVP** (spec 2c ruling); this slice ships JSON only, no UI copy.
- **The app pool cannot read `sync_log`.** `lagFor` reads `sync_log` + `sync_cursor`; only the `sync_tailer` pool (`syncDb`, created inside the `if (syncConfig !== undefined)` block, `boot.ts:899`) may read it. The replication field is therefore threaded from that pool, and is `{ configured: false }` whenever `WAITRON_SYNC_PEERS` is unset (the free-tier single box).
- **The gate:** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`, and before claiming green run `pnpm --filter @waitron/server test:coverage` (CI shards run coverage; CLAUDE.md §2). `apps/server` coverage floor is the default `98/98/98/95`.
- **Every commit `git commit -s`** (DCO). Branch, worktree via `worktree.py new waitron feat/onboarding-slice4a-box-status`; never commit on `main`.
- **Node's `X509Certificate`** (Node ≥15.6, the repo is well above) parses the served leaf — do not add a cert-parsing dependency.

---

### Task 1: Time-health probe

Greenfield. A probe that reports whether the system clock is NTP-synchronised, degrading honestly to "unavailable" on a host without `timedatectl` (dev/macOS) so it never warns falsely (spec §13: "surface a warning before it trades" — but only when we actually know).

**Files:**
- Create: `apps/server/src/time-health.ts`
- Test: `apps/server/src/time-health.test.ts`

**Interfaces:**
- Produces:
  - `type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean }`
  - `type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>`
  - `checkTimeHealth(deps?: { run?: CommandRunner }): Promise<TimeHealth>` — default `run` shells out to `timedatectl show -p NTPSynchronized --value` via `node:child_process` `execFile`; a spawn error (ENOENT — command absent) resolves to the unavailable shape, never rejects.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { checkTimeHealth, type CommandRunner } from "./time-health.js";

const runnerReturning = (stdout: string, code = 0): CommandRunner => async () => ({ stdout, code });
const runnerThrowing = (): CommandRunner => async () => {
  const err = new Error("spawn timedatectl ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  throw err;
};

describe("checkTimeHealth", () => {
  it("reports synced when timedatectl says NTPSynchronized=yes", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("yes\n") });
    expect(health).toEqual({ synced: true, source: "timedatectl", warn: false });
  });

  it("warns when timedatectl says NTPSynchronized=no", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("no\n") });
    expect(health).toEqual({ synced: false, source: "timedatectl", warn: true });
  });

  it("degrades to unavailable without warning when timedatectl is absent", async () => {
    const health = await checkTimeHealth({ run: runnerThrowing() });
    expect(health).toEqual({ synced: false, source: "unavailable", warn: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test time-health -- --run`
Expected: FAIL — `checkTimeHealth` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { execFile } from "node:child_process";

/** Whether the system clock is NTP-synchronised. `source: "unavailable"` (never `warn: true`) on a host
 * without systemd's `timedatectl` — dev machines and macOS — so the probe never cries wolf where it
 * cannot know. The real appliance (systemd) gets the real answer. */
export type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };

export type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string; code: number }>;

const defaultRun: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000 }, (error, stdout) => {
      // A non-zero EXIT (e.g. an unsynced state some builds signal by rc) still resolves with its
      // stdout; only a SPAWN failure (ENOENT — the binary is absent) rejects, and we map that to
      // "unavailable" below. `error.code` is a string on spawn failure, a number on non-zero exit.
      if (error && typeof (error as NodeJS.ErrnoException).code === "string") {
        reject(error);
        return;
      }
      resolve({ stdout, code: error ? ((error as { code?: number }).code ?? 1) : 0 });
    });
  });

export async function checkTimeHealth(deps: { run?: CommandRunner } = {}): Promise<TimeHealth> {
  const run = deps.run ?? defaultRun;
  try {
    const { stdout } = await run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
    const synced = stdout.trim() === "yes";
    return { synced, source: "timedatectl", warn: !synced };
  } catch {
    return { synced: false, source: "unavailable", warn: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test time-health -- --run`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/time-health.ts apps/server/src/time-health.test.ts
git commit -s -m "feat(onboarding): time-health probe (slice 4a)"
```

---

### Task 2: TLS cert-expiry reader

Reads the served leaf and reports when it expires, so the status surface can warn before a cert lapses. Uses Node's built-in `X509Certificate` — no dependency.

**Files:**
- Create: `apps/server/src/cert-expiry.ts`
- Test: `apps/server/src/cert-expiry.test.ts`

**Interfaces:**
- Produces:
  - `type CertExpiry = { notAfter: string; daysRemaining: number }` (`notAfter` is ISO-8601)
  - `readCertExpiry(pemPath: string, now: Date): Promise<CertExpiry>` — reads the PEM at `pemPath`, parses `validTo`, computes whole days remaining (floored, may be negative for an expired cert). Throws (ENOENT / parse error) if the path is unreadable or not a cert; the aggregator (Task 4) try/catches into a `{ available: false }` shape.

- [ ] **Step 1: Write the failing test**

Generate a fixture cert once and embed it (deterministic `notAfter`, so `daysRemaining` is exact against a fixed `now`):

```bash
# Run once to produce the fixture PEM pasted into the test below:
openssl req -x509 -newkey rsa:2048 -keyout /dev/null -nodes -subj "/CN=waitron.local" \
  -not_before 20200101000000Z -not_after 20300101000000Z -out /tmp/fixture.pem
```

```typescript
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCertExpiry } from "./cert-expiry.js";

// Fixture leaf: notAfter = 2030-01-01T00:00:00Z (paste the PEM from the openssl command above).
const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
...paste the generated cert here...
-----END CERTIFICATE-----
`;

describe("readCertExpiry", () => {
  it("reports notAfter and whole days remaining against a fixed now", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cert-expiry-"));
    const path = join(dir, "server.crt");
    writeFileSync(path, FIXTURE_PEM);
    const now = new Date("2029-12-02T00:00:00Z"); // exactly 30 days before notAfter
    const result = await readCertExpiry(path, now);
    expect(result.notAfter).toBe("2030-01-01T00:00:00.000Z");
    expect(result.daysRemaining).toBe(30);
  });

  it("throws for a missing file", async () => {
    await expect(readCertExpiry(join(tmpdir(), "nope-does-not-exist.crt"), new Date())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test cert-expiry -- --run`
Expected: FAIL — `readCertExpiry` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { readFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";

/** When the served TLS leaf expires. `daysRemaining` is floored whole days and may be negative for an
 * already-expired cert — the caller decides the warn threshold. */
export type CertExpiry = { notAfter: string; daysRemaining: number };

const MS_PER_DAY = 86_400_000;

export async function readCertExpiry(pemPath: string, now: Date): Promise<CertExpiry> {
  const pem = await readFile(pemPath, "utf8");
  const cert = new X509Certificate(pem);
  const notAfter = new Date(cert.validTo); // X509 `validTo` is a parseable date string
  return {
    notAfter: notAfter.toISOString(),
    daysRemaining: Math.floor((notAfter.getTime() - now.getTime()) / MS_PER_DAY),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test cert-expiry -- --run`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/cert-expiry.ts apps/server/src/cert-expiry.test.ts
git commit -s -m "feat(onboarding): TLS cert-expiry reader (slice 4a)"
```

---

### Task 3: Fiscal-chain-height reader

Reads this node's chain head so the status surface can reassure the operator that records are being written and how many. Reads the MUTABLE `cadenas` head row (`secuencia` is the monotonic chain height, never reset — `packages/fiscal-verifactu/src/schema/cadenas.ts`), which `app_user` holds `SELECT` on (`0001_registros_inmutables.sql:58`), under RLS.

**Files:**
- Create: `apps/server/src/chain-height.ts`
- Test: `apps/server/src/chain-height.test.ts` (real Postgres — `cadenas` is RLS + FORCE-RLS; PGlite runs as superuser and would give a false pass on the tenant scope, CLAUDE.md §4)

**Interfaces:**
- Consumes: a `Transaction` already inside `withTenant(db, tenantId)` + `asAppUser` (the caller in Task 5 supplies it, mirroring `withVenueAuth`).
- Produces:
  - `type ChainHeight = { height: number; lastAt: string | null }`
  - `readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight>` — reads `secuencia` + `actualizado_en` from `cadenas` for this node under the ambient tenant; returns `{ height: 0, lastAt: null }` when no chain row exists yet (a freshly provisioned node before its first sale).

- [ ] **Step 1: Write the failing test**

```typescript
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { readChainHeight } from "./chain-height.js";

describe("readChainHeight (real postgres)", () => {
  const ctx = useTemplateDb({ template: "manifest" });
  let tenantId: string;
  let nodeId: string;

  beforeAll(async () => {
    // Provision one venue; capture its tenant + node ids (follow management-api.status.test.ts's
    // applyVenue/planVenue fixture, with a per-suite-unique NIF).
    const plan = planVenue({ /* … unique nif, node, till … */ });
    const ids = await applyVenue(ctx.db(), plan);
    tenantId = ids.tenantId;
    nodeId = ids.nodeId;
  });
  afterAll(() => {});

  it("returns 0 / null before any sale", async () => {
    const result = await withTenant(ctx.db(), tenantId, async (tx) => {
      await asAppUser(tx);
      return readChainHeight(tx, nodeId);
    });
    expect(result).toEqual({ height: 0, lastAt: null });
  });

  it("returns the cadenas secuencia after a chain row exists", async () => {
    // Seed a chain head as OWNER (the app role holds SELECT, not the arbitrary UPDATE this seeding does):
    await ctx.db().execute(sql`
      insert into cadenas (tenant_id, node_id, secuencia, actualizado_en)
      values (${tenantId}, ${nodeId}, 7, '2026-08-29T10:00:00Z')
      on conflict (tenant_id, node_id) do update set secuencia = 7`);
    const result = await withTenant(ctx.db(), tenantId, async (tx) => {
      await asAppUser(tx);
      return readChainHeight(tx, nodeId);
    });
    expect(result.height).toBe(7);
    expect(result.lastAt).toBe("2026-08-29T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test chain-height -- --run`
Expected: FAIL — `readChainHeight` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

/** This node's fiscal-chain head: `secuencia` is the monotonic, never-reset chain height and
 * `actualizado_en` is when it last advanced. `{ height: 0, lastAt: null }` before the first sale. */
export type ChainHeight = { height: number; lastAt: string | null };

export async function readChainHeight(tx: Transaction, nodeId: string): Promise<ChainHeight> {
  // `cadenas` is RLS/FORCE-RLS; the caller has already set the tenant context + app role, so this
  // reads only this tenant's head, and the node_id predicate narrows to this SIF's chain.
  const rows = await tx.execute<{ secuencia: number; actualizado_en: string }>(
    sql`select secuencia, actualizado_en from cadenas where node_id = ${nodeId}`,
  );
  const row = rows.rows[0];
  if (row === undefined) return { height: 0, lastAt: null };
  return { height: row.secuencia, lastAt: new Date(row.actualizado_en).toISOString() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test chain-height -- --run`
Expected: PASS (2 tests). If `Transaction`/`asAppUser`/`withTenant` import paths differ, copy them verbatim from `apps/server/src/management-api.ts`'s imports.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/chain-height.ts apps/server/src/chain-height.test.ts
git commit -s -m "feat(onboarding): fiscal-chain-height reader (slice 4a)"
```

---

### Task 4: `collectBoxStatus` aggregator + `BoxStatus` type

Pure composition over the sub-readers (Tasks 1–3) plus the three reused primitives. No I/O of its own beyond calling the injected readers, so it unit-tests with stubs. Establishes the wire shape, including the deliberate `{ configured: false }` placeholders that 4b (backup) and Task 6 (replication) fill.

**Files:**
- Create: `apps/server/src/box-status.ts` (the type + `collectBoxStatus`; the route mount lands here in Task 5)
- Test: `apps/server/src/box-status.test.ts`

**Interfaces:**
- Consumes: `TimeHealth` (Task 1), `CertExpiry` (Task 2), `ChainHeight` (Task 3), `DeploymentMode` (`@waitron/db`), `SubscriberLag` (`@waitron/sync`), `healthSnapshot`'s `body` (`./health.js`).
- Produces:
  - The wire type:
    ```typescript
    export type BoxStatus = {
      mode: DeploymentMode;
      environment: DeploymentEnvironment;
      time: TimeHealth;
      cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
      chain: ChainHeight;
      replication: { configured: false } | { configured: true; worstLagSeq: string; subscribers: number };
      backup: { configured: false }; // 4b fills this in
      duties: Record<string, unknown>; // reused from healthSnapshot.body.duties
    };
    ```
  - `type BoxStatusReaders = {`
    `  mode: () => Promise<DeploymentMode>;`
    `  environment: DeploymentEnvironment;`
    `  time: () => Promise<TimeHealth>;`
    `  cert: () => Promise<CertExpiry> | undefined;` (undefined when no TLS path configured)
    `  chain: () => Promise<ChainHeight>;`
    `  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;` (undefined when sync off — Task 6 supplies it)
    `  duties: () => Record<string, unknown>;`
    `}`
  - `collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus>`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { collectBoxStatus, type BoxStatusReaders } from "./box-status.js";

const base: BoxStatusReaders = {
  mode: async () => "primary",
  environment: "preproduction",
  time: async () => ({ synced: true, source: "timedatectl", warn: false }),
  cert: () => Promise.resolve({ notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 }),
  chain: async () => ({ height: 7, lastAt: "2026-08-29T10:00:00.000Z" }),
  replicationLag: undefined,
  duties: () => ({ "fiscal.drain": { stale: false } }),
};

describe("collectBoxStatus", () => {
  it("composes every field with cert available and replication/backup N-A", async () => {
    const status = await collectBoxStatus(base);
    expect(status).toEqual({
      mode: "primary",
      environment: "preproduction",
      time: { synced: true, source: "timedatectl", warn: false },
      cert: { available: true, notAfter: "2030-01-01T00:00:00.000Z", daysRemaining: 30 },
      chain: { height: 7, lastAt: "2026-08-29T10:00:00.000Z" },
      replication: { configured: false },
      backup: { configured: false },
      duties: { "fiscal.drain": { stale: false } },
    });
  });

  it("reports cert unavailable when no cert reader is configured", async () => {
    const status = await collectBoxStatus({ ...base, cert: undefined });
    expect(status.cert).toEqual({ available: false });
  });

  it("reports cert unavailable when the cert read throws (e.g. missing file)", async () => {
    const status = await collectBoxStatus({ ...base, cert: () => Promise.reject(new Error("ENOENT")) });
    expect(status.cert).toEqual({ available: false });
  });

  it("summarises replication lag worst-first when a lag reader is present", async () => {
    const status = await collectBoxStatus({
      ...base,
      replicationLag: async () => [
        { subscriberId: "s1", originId: "o1", lag: 42n, alive: true },
        { subscriberId: "s2", originId: "o1", lag: 3n, alive: true },
      ],
    });
    expect(status.replication).toEqual({ configured: true, worstLagSeq: "42", subscribers: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @waitron/server test box-status -- --run`
Expected: FAIL — `collectBoxStatus` not exported.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { DeploymentEnvironment, DeploymentMode } from "@waitron/db";
import type { SubscriberLag } from "@waitron/sync";
import type { CertExpiry } from "./cert-expiry.js";
import type { ChainHeight } from "./chain-height.js";
import type { TimeHealth } from "./time-health.js";

export type BoxStatus = {
  mode: DeploymentMode;
  environment: DeploymentEnvironment;
  time: TimeHealth;
  cert: { available: true; notAfter: string; daysRemaining: number } | { available: false };
  chain: ChainHeight;
  replication:
    | { configured: false }
    | { configured: true; worstLagSeq: string; subscribers: number };
  backup: { configured: false };
  duties: Record<string, unknown>;
};

export type BoxStatusReaders = {
  mode: () => Promise<DeploymentMode>;
  environment: DeploymentEnvironment;
  time: () => Promise<TimeHealth>;
  cert: (() => Promise<CertExpiry>) | undefined;
  chain: () => Promise<ChainHeight>;
  replicationLag: (() => Promise<SubscriberLag[]>) | undefined;
  duties: () => Record<string, unknown>;
};

export async function collectBoxStatus(readers: BoxStatusReaders): Promise<BoxStatus> {
  const [mode, time, chain] = await Promise.all([readers.mode(), readers.time(), readers.chain()]);

  let cert: BoxStatus["cert"] = { available: false };
  if (readers.cert !== undefined) {
    try {
      const c = await readers.cert();
      cert = { available: true, notAfter: c.notAfter, daysRemaining: c.daysRemaining };
    } catch {
      cert = { available: false }; // a missing/unreadable leaf must never fail the whole status read
    }
  }

  let replication: BoxStatus["replication"] = { configured: false };
  if (readers.replicationLag !== undefined) {
    const lags = await readers.replicationLag();
    // lagFor returns worst-first; the head is the worst lag. bigint → string on the wire (never Number()).
    replication = {
      configured: true,
      worstLagSeq: (lags[0]?.lag ?? 0n).toString(),
      subscribers: lags.length,
    };
  }

  return {
    mode,
    environment: readers.environment,
    time,
    cert,
    chain,
    replication,
    backup: { configured: false },
    duties: readers.duties(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @waitron/server test box-status -- --run`
Expected: PASS (4 tests). Confirm `DeploymentEnvironment`/`DeploymentMode`/`SubscriberLag` are exported from `@waitron/db` / `@waitron/sync` barrels; if not, import from the deep module the boot file already uses.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/box-status.ts apps/server/src/box-status.test.ts
git commit -s -m "feat(onboarding): collectBoxStatus aggregator + BoxStatus wire type (slice 4a)"
```

---

### Task 5: `mountBoxStatusApi` route + wire into the trading boot branch

Registers `GET /api/box/status` on the shared trading Hono app, authenticated exactly like the FP-1 status routes, and wires the real readers. Mounted AFTER the sync block (`boot.ts` ~line 977) so Task 6 can hand it the `syncDb`-backed lag reader without moving anything.

**Files:**
- Modify: `apps/server/src/box-status.ts` (add `mountBoxStatusApi`)
- Modify: `apps/server/src/boot.ts` (register the mount in the trading branch, after the sync block)
- Test: `apps/server/src/box-status.route.test.ts` (real Postgres — exercises the `authorizeManager` RLS gate; PGlite would false-pass)

**Interfaces:**
- Consumes: `collectBoxStatus` (Task 4); `requireManagementSession`, `authorizeManager`, `withTenant`, `asAppUser` (copy the import lines from `management-api.ts`); `readDeploymentMode` (`@waitron/db`); `checkTimeHealth`, `readCertExpiry`, `readChainHeight`; `healthSnapshot` (`./health.js`) and the trading `HealthState`.
- Produces:
  - `type BoxStatusDeps = {`
    `  db: Database;`
    `  cfg: { tenantId: string; nodeId: string };`
    `  environment: DeploymentEnvironment;`
    `  health: HealthState;`
    `  now: () => Date;`
    `  tlsCertPath: string | undefined;`
    `  readReplicationLag: (() => Promise<SubscriberLag[]>) | undefined;`
    `}`
  - `mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void`

- [ ] **Step 1: Write the failing route test**

```typescript
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createHealthState } from "./health.js";
import { mountBoxStatusApi } from "./box-status.js";

describe("GET /api/box/status (real postgres)", () => {
  const ctx = useTemplateDb({ template: "manifest" });
  let app: Hono;
  let tenantId: string;
  let managerCookie: string; // minted like management-api.status.test.ts does

  beforeAll(async () => {
    const ids = await applyVenue(ctx.db(), planVenue({ /* … unique nif … */ }));
    tenantId = ids.tenantId;
    app = new Hono();
    mountBoxStatusApi(
      app,
      {
        db: ctx.db(),
        cfg: { tenantId, nodeId: ids.nodeId },
        environment: "preproduction",
        health: createHealthState(new Date("2026-08-29T10:00:00Z")),
        now: () => new Date("2026-08-29T10:00:00Z"),
        tlsCertPath: undefined,
        readReplicationLag: undefined,
      },
      () => {},
    );
    // … create a manager person + management session, capture the cookie (mirror the existing
    // management-api.status.test.ts login helper) …
  });
  afterAll(() => {});

  it("401s without a management session", async () => {
    const res = await app.request("/api/box/status");
    expect(res.status).toBe(401);
  });

  it("200s with the composed status for an authenticated manager", async () => {
    const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("primary");
    expect(body.environment).toBe("preproduction");
    expect(body.cert).toEqual({ available: false }); // tlsCertPath undefined
    expect(body.replication).toEqual({ configured: false }); // no lag reader
    expect(body.backup).toEqual({ configured: false });
    expect(body.time.source).toMatch(/timedatectl|unavailable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status.route -- --run`
Expected: FAIL — `mountBoxStatusApi` not exported.

- [ ] **Step 3: Write `mountBoxStatusApi`**

Append to `box-status.ts` (imports copied verbatim from `management-api.ts` for the session/auth helpers and error boundary):

```typescript
export function mountBoxStatusApi(app: Hono, deps: BoxStatusDeps, log: Logger): void {
  // Gated exactly like the FP-1 status routes: requireManagementSession → 401 before any DB work,
  // then withTenant + asAppUser + authorizeManager("till.configure") for the tenant-scoped chain read.
  // The reused `errorBoundary`/`run` wrapper the sibling mounts use turns a thrown AppError into the
  // shared `{ error: { code, params } }` shape — follow management-api.ts's exact wrapper.
  app.get("/api/box/status", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c); // 401 if absent
      const chain = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        await authorizeManager(tx, { managementSessionId: sessionId, permission: "till.configure" });
        return readChainHeight(tx, deps.cfg.nodeId);
      });
      const status = await collectBoxStatus({
        mode: () => readDeploymentMode(deps.db),
        environment: deps.environment,
        time: () => checkTimeHealth(),
        cert:
          deps.tlsCertPath === undefined
            ? undefined
            : () => readCertExpiry(deps.tlsCertPath as string, deps.now()),
        chain: async () => chain,
        replicationLag: deps.readReplicationLag,
        duties: () => healthSnapshot(deps.health, deps.now()).body.duties as Record<string, unknown>,
      });
      return c.json(status, 200);
    }),
  );
}
```

- [ ] **Step 4: Wire into `boot.ts` (trading branch, after the sync block)**

After the sync/retention block (around `boot.ts:977`, before `makeStartedServer`), add:

```typescript
  // The operator box-status surface (onboarding slice 4a). Mounted AFTER the sync block so it can be
  // handed the sync_tailer-pool lag reader (§5.1 durability) when sync is on; `{ configured: false }`
  // otherwise (the free-tier single box). GET-only, so the mirror read-only gate passes it; the
  // ambient mirror viewer session makes requireManagementSession pass read-only on a mirror.
  mountBoxStatusApi(
    app,
    {
      db,
      cfg: { tenantId: till.tenantId, nodeId: till.nodeId },
      environment: config.environment,
      health,
      now,
      tlsCertPath: config.tls?.certPath,
      readReplicationLag: undefined, // Task 6 fills this from syncDb
    },
    log,
  );
```

Confirm `config.tls?.certPath` is the served-leaf path field on the TLS config (check `config.ts`'s `tls` shape; use the exact property name). `health` and `now` are the same bindings `healthApp(health, now)` used at `boot.ts:449`.

- [ ] **Step 5: Run tests**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status.route boot -- --run`
Expected: PASS. `boot.test.ts` still green (the new mount is additive; a GET route on the shared app). If `boot.test.ts` asserts an exhaustive route list, add `/api/box/status` to that expectation.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/box-status.ts apps/server/src/boot.ts apps/server/src/box-status.route.test.ts
git commit -s -m "feat(onboarding): mount GET /api/box/status in trading boot (slice 4a)"
```

---

### Task 6: Replication field via `lagFor` when the sync pool exists

Fills the `replication` field with a real lag summary when `WAITRON_SYNC_PEERS` is configured, reusing `lagFor` on the `sync_tailer` pool. This is the seam the promotion/failover §5.1 durability surface grows from; on a free-tier single box (`syncDb === undefined`) it stays `{ configured: false }`.

**Files:**
- Modify: `apps/server/src/boot.ts` (pass the lag reader when `syncDb` exists)
- Test: `apps/server/src/box-status.replication.test.ts` (real Postgres — seeds `sync_cursor` + `sync_log`; both need the privileged roles)

**Interfaces:**
- Consumes: `lagFor(db)` (`@waitron/sync`) reading `syncDb` (the `sync_tailer`+`app_user` member pool).
- Produces: no new export; `readReplicationLag` in the `boot.ts` mount becomes `syncDb ? () => lagFor(syncDb) : undefined`.

- [ ] **Step 1: Write the failing test**

Drive `mountBoxStatusApi` with a real `readReplicationLag` closure over a DB holding `sync_cursor` rows and `sync_log` rows, and assert the summary:

```typescript
// Seed (as the appropriate roles): a sync_log with max(seq)=10 for origin O, and two sync_cursor rows
// for subscribers s1 (last_applied_seq=3 → lag 7) and s2 (last_applied_seq=10 → lag 0).
// Then mount with readReplicationLag: () => lagFor(db) and GET /api/box/status.
it("summarises replication worst-first when sync is configured", async () => {
  // … seed sync_log + sync_cursor per packages/sync fixtures (recordSubscriberCursor / direct inserts) …
  const res = await app.request("/api/box/status", { headers: { cookie: managerCookie } });
  const body = await res.json();
  expect(body.replication).toEqual({ configured: true, worstLagSeq: "7", subscribers: 2 });
});
```

(Reuse the seeding approach from `packages/sync`'s retention/cursor tests — `recordSubscriberCursor` for the cursor rows and the `sync_capture` path or direct owner inserts for `sync_log`. Use `useTemplateDb({ template: "manifest" })`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status.replication -- --run`
Expected: FAIL — `replication` reads `{ configured: false }` because the mount still passes `readReplicationLag: undefined`.

- [ ] **Step 3: Wire the lag reader in `boot.ts`**

Change the mount added in Task 5 so `readReplicationLag` is supplied from the sync pool. Because `syncDb` is a `let` that may be `undefined`, capture it into a `const` the same way the sync block does for `localSyncDb`, and read it in the closure:

```typescript
  // `syncDb` (the sync_tailer pool) is the only pool that may read sync_log; hand box-status a lag
  // reader over it when sync is on, else leave replication N-A. Captured as a const so TS keeps the
  // non-undefined narrowing inside the closure (same reason the sync block hoists `localSyncDb`).
  const lagPool = syncDb;
  // … in the mountBoxStatusApi deps:
  readReplicationLag: lagPool === undefined ? undefined : () => lagFor(lagPool),
```

Import `lagFor` from `@waitron/sync` at the top of `boot.ts` (it already imports other sync pieces).

- [ ] **Step 4: Run tests**

Run: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test box-status -- --run`
Expected: PASS (the replication suite + the earlier route suite, which still sees `{ configured: false }` because its fixture sets no sync peers).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/boot.ts apps/server/src/box-status.replication.test.ts
git commit -s -m "feat(onboarding): box-status replication lag via lagFor when sync configured (slice 4a)"
```

---

## Final verification (before PR)

- [ ] `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` — green at the 98/98/98/95 floor (CI shards run coverage, not plain `test`).
- [ ] `pnpm lint && pnpm typecheck && pnpm format:check` — all green.
- [ ] `pnpm --filter @waitron/fiscal-verifactu test inmutabilidad` — unchanged (this slice adds no tenant-scoped table, but the reader touches `cadenas`; confirm nothing regressed).
- [ ] Run the whole `apps/server` package unfiltered once (a name-filtered run skips cross-cutting guard suites, CLAUDE.md §2): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage`.
- [ ] Then `pnpm reap` if any containers leaked, and follow `finish-branch`.

## Notes carried to 4b / 4c

- 4b replaces `backup: { configured: false }` with the real last-backup marker read (`{ configured: true; lastAt; ageSeconds; stale }`) — extend `BoxStatus["backup"]` and thread a backup-marker reader through `BoxStatusDeps`, no route change.
- At 4c/PR-land, add a dated pointer to spec §17 marking the break-glass mechanism resolved (loopback CLI), and record 4a's box-status rulings as a spec implementation-note (as slice 2c did).
