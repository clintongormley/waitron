// Real PostgreSQL: the backup admin routes under the manager-login gate, plus the supervisor's real
// enable/rotate lifecycle (a hermetic fake `pg_dump`, so no host binary is needed). The NON-superuser
// owner probe is proven separately in `backup-supervisor.pg.test.ts`; here the supervisor's read
// connection is the clone's own admin url because these tests exercise the ROUTES, not the probe.
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SingletonRole } from "@waitron/db";
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { mountBackupApi } from "./backup-api.js";
import { loadBackupConfig, type BackupConfig } from "./backup-config.js";
import { writeBackupEnv } from "./backup-env-writer.js";
import { BackupSupervisor, keyFingerprint } from "./backup-supervisor.js";
import { loadBoxEnv } from "./box-env.js";
import { isUnset } from "./env-value.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import type { PgDumpRunner } from "./pg-dump.js";
import { RECOVERY_FILES } from "./state-secrets.js";

const LOCALE = "es-ES";
const PASSWORD = "correct horse"; // the seeded manager's dashboard password
const MANAGER_EMAIL = "manager@x.com";
// Every backup env var provenance keys on — the wizard's `isManagedByEnvironment` mirror.
const BACKUP_KEYS = [
  "WAITRON_BACKUP_DIR",
  "WAITRON_BACKUP_DESTINATIONS",
  "WAITRON_BACKUP_DATABASE_URL",
  "WAITRON_BACKUP_RECOVERY_KEY",
  "WAITRON_BACKUP_SCHEDULE_DAYS",
  "WAITRON_BACKUP_AT",
  "WAITRON_BACKUP_INTERVAL_MS",
  "WAITRON_BACKUP_RETAIN",
  "WAITRON_BACKUP_RETAIN_DAYS",
];
// ≥ MIN_PASSPHRASE_LENGTH (12) and base64url-safe (survives the env-file round-trip).
const KEY_1 = "recovery-key-one-strong";
const KEY_2 = "recovery-key-two-different";

const suite = useTemplateDb({ template: "manifest" });

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(76_000_000 + nifCounter).padStart(8, "0")}K`;
}

// A hermetic pg_dump: writes a placeholder so the archive assembles + encrypts + fans out WITHOUT a
// host `pg_dump` binary (same shape backup-supervisor.pg.test.ts uses).
const fakeDump: PgDumpRunner = async ({ outFile }) => {
  await writeFile(outFile, "PGDMP-fake-dump");
};

const cleanup: (() => Promise<void>)[] = [];

async function makeStateDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "backup-api-state-"));
  await mkdir(join(dir, "tls"), { recursive: true });
  // The sweep's `collectStateSecrets` fails a tick unless every RECOVERY_FILES path exists.
  for (const rel of RECOVERY_FILES) await writeFile(join(dir, rel), `dummy ${rel}`);
  return dir;
}
function makeDestDir(): string {
  return mkdtempSync(join(tmpdir(), "backup-api-dest-"));
}

interface Scenario {
  stateDir: string;
  base: NodeJS.ProcessEnv;
  role: SingletonRole;
}

function makeSupervisor(sc: Scenario): BackupSupervisor {
  const sup = new BackupSupervisor({
    buildConfig: async () => loadBackupConfig(await loadBoxEnv(sc.base, sc.stateDir)),
    isManagedByEnvironment: () => BACKUP_KEYS.some((k) => !isUnset(sc.base[k])),
    readSingletonRole: () => sc.role,
    adminDatabaseUrl: suite.pg.uri,
    modules: ALL_MODULES,
    environment: "production",
    stateDir: sc.stateDir,
    mediaDir: mkdtempSync(join(tmpdir(), "backup-api-media-")),
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
    log: () => {},
    runDump: fakeDump,
  });
  cleanup.push(() => sup.stop());
  return sup;
}

function buildApp(tenantId: string, sup: BackupSupervisor, stateDir: string): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.admin,
      cfg: { tenantId, nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
    },
    () => {},
  );
  mountBackupApi(app, { supervisor: sup, db: suite.admin, cfg: { tenantId }, stateDir }, () => {});
  return app;
}

async function setupTenant(): Promise<string> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  await withTenant(suite.admin, venue.tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.execute(sql`
      insert into persons (tenant_id, display_name, email, pin_hash, password_hash, role)
      values (${venue.tenantId}, 'The Manager', ${MANAGER_EMAIL}, ${hashPin("1234")}, ${hashPassword(PASSWORD)}, 'manager')`);
  });
  return venue.tenantId;
}

async function login(app: Hono): Promise<string> {
  const res = await app.request("/management-api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MANAGER_EMAIL, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

const DAILY_AT_0330 = { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } } as const;
const RETENTION = { count: 7, days: 30 } as const;

async function poll<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() >= end) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop().catch(() => {});
});

describe("backup admin routes (real postgres)", () => {
  let tenantId: string;
  beforeAll(async () => {
    tenantId = await setupTenant();
  }, 180_000);

  it("unauthenticated requests 401", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir);
    for (const path of ["/api/backup/status", "/api/backup/recovery-key"]) {
      const res = await app.request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
    }
    const mint = await app.request("/api/backup/mint-key", { method: "POST" });
    expect(mint.status).toBe(401);
  });

  it("mint-key returns a strong key and stores nothing", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(tenantId, sup, sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/mint-key", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
    const { key } = (await res.json()) as { key: string };
    // randomBytes(32).toString("base64url") → 43 chars, no padding.
    expect(key).toHaveLength(43);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    // Minting stored nothing: backups are still off.
    const status = await app.request("/api/backup/status", { headers: { cookie } });
    expect((await status.json()).enabled).toBe(false);
  });

  it("apply enables backups and hot-reloads (no restart), then reports enabled", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(tenantId, sup, sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: dest,
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.keyFingerprint).toBe(keyFingerprint(KEY_1));
    expect(body.recoveryKey).toBeUndefined(); // the status projection NEVER carries the key
    // The apply RESPONSE is the COMPLETE status the dashboard reads (not the sync snapshot): it
    // carries `backupStatus` and `archiveUnderCurrentKey`, or the screen has no `backupStatus` after a
    // successful save. `configured` is true (a destination is now wired); the freshness of the very
    // first dump is not asserted here (the poll below covers it) — only that the fields are present.
    expect(body.backupStatus.configured).toBe(true);
    expect(typeof body.archiveUnderCurrentKey).toBe("boolean");
    // `apply` wrote backup.env verbatim (no restart needed) and the effective config picked it up.
    expect(sup.current().recoveryKey).toBe(KEY_1);
    // The immediate first tick stores an archive under the current key.
    await poll(async () => {
      const s = await app.request("/api/backup/status", { headers: { cookie } });
      return (await s.json()).archiveUnderCurrentKey === true ? true : undefined;
    });
  }, 60_000);

  it("apply refuses a non-storable key (trailing space) before any write", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: makeDestDir(),
        recoveryKey: "trailing space key ",
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: "backup.recovery_key_unstorable" },
    });
  });

  it("apply refuses when the environment owns the config", async () => {
    const sc: Scenario = {
      stateDir: await makeStateDir(),
      base: { WAITRON_BACKUP_DIR: makeDestDir() }, // an env var set → managed by environment
      role: "primary",
    };
    const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: makeDestDir(),
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
  });

  it("apply refuses on a non-primary node", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "secondary" };
    const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: makeDestDir(),
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "backup.not_primary" } });
  });

  it("recovery-key returns the EFFECTIVE key, not the file, under a partial env override", async () => {
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    // The FILE holds KEY_2 (a prior wizard apply)…
    await writeBackupEnv(stateDir, {
      destinationDir: dest,
      recoveryKey: KEY_2,
      schedule: DAILY_AT_0330,
      retention: RETENTION,
      keyRotatedAt: undefined,
    });
    // …but the ENV injects KEY_1 (and the rest), which wins on merge — so the box encrypts under KEY_1.
    const sc: Scenario = {
      stateDir,
      base: {
        WAITRON_BACKUP_DIR: dest,
        WAITRON_BACKUP_RECOVERY_KEY: KEY_1,
        WAITRON_BACKUP_SCHEDULE_DAYS: "daily",
        WAITRON_BACKUP_AT: "03:30",
        WAITRON_BACKUP_RETAIN: "7",
        WAITRON_BACKUP_RETAIN_DAYS: "30",
      },
      role: "primary",
    };
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(tenantId, sup, stateDir);
    const cookie = await login(app);

    const res = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).key).toBe(KEY_1); // the EFFECTIVE key, not the file's KEY_2

    // And a rotate cannot silently orphan archives: the env owns the config, so it is refused.
    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: "a-third-strong-key" }),
    });
    expect(rot.status).toBe(409);
    expect(await rot.json()).toMatchObject({ error: { code: "backup.managed_by_environment" } });
    // The file still holds KEY_2 — nothing was written by the refused rotate.
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toContain(KEY_2);
  }, 60_000);

  it("rotate takes an immediate dump under the new key and bumps keyRotatedAt", async () => {
    const dest = makeDestDir();
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const sup = makeSupervisor(sc);
    const app = buildApp(tenantId, sup, sc.stateDir);
    const cookie = await login(app);
    // Enable first (KEY_1), then rotate to KEY_2.
    const applied = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: dest,
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(applied.status).toBe(200);
    expect((await applied.json()).keyRotatedAt ?? null).toBeNull(); // apply does not stamp a rotation

    const rot = await app.request("/api/backup/rotate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ recoveryKey: KEY_2 }),
    });
    expect(rot.status).toBe(200);
    const body = await rot.json();
    expect(body.keyFingerprint).toBe(keyFingerprint(KEY_2));
    expect(typeof body.keyRotatedAt).toBe("string"); // rotation stamped
    // Rotate, like apply, returns the COMPLETE status (backupStatus + archiveUnderCurrentKey present).
    expect(body.backupStatus.configured).toBe(true);
    expect(typeof body.archiveUnderCurrentKey).toBe("boolean");
    expect(sup.current().recoveryKey).toBe(KEY_2);
    // GET recovery-key now returns KEY_2, and a fresh archive lands under it.
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBe(KEY_2);
    await poll(async () => {
      const s = await app.request("/api/backup/status", { headers: { cookie } });
      return (await s.json()).archiveUnderCurrentKey === true ? true : undefined;
    });
  }, 60_000);

  it("apply accepts an interval schedule and a weekday-array + auto time", async () => {
    for (const schedule of [
      { kind: "interval", ms: 3_600_000 },
      { kind: "wall-clock", days: [1, 3, 5], at: "auto" },
    ] as const) {
      const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
      const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir);
      const cookie = await login(app);
      const res = await app.request("/api/backup/apply", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationDir: makeDestDir(),
          recoveryKey: KEY_1,
          schedule,
          retention: RETENTION,
        }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).enabled).toBe(true);
    }
  }, 60_000);

  it("apply fails loud when the effective key differs from the requested one", async () => {
    // The orphan-prevention guard: a supervisor whose reloaded config resolves a DIFFERENT recovery
    // key than the operator asked for (here forced via buildConfig) must be refused, not silently
    // encrypt future archives under a key the operator never recorded.
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    const mismatch: BackupConfig = {
      destinations: [{ kind: "local-fs", id: "primary", dir: dest }],
      recoveryKey: "effective-key-differs-from-request",
      databaseUrl: undefined,
      schedule: DAILY_AT_0330,
      retain: 7,
      retainDays: 30,
      staleAfterMs: 2 * 24 * 60 * 60 * 1000,
      keyRotatedAt: undefined,
    };
    const sup = new BackupSupervisor({
      buildConfig: async () => mismatch, // ignores the file the route writes
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      adminDatabaseUrl: suite.pg.uri,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      mediaDir: mkdtempSync(join(tmpdir(), "backup-api-media-")),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: () => {},
      runDump: fakeDump,
    });
    cleanup.push(() => sup.stop());
    const app = buildApp(tenantId, sup, stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: dest,
        recoveryKey: KEY_1,
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.effective_mismatch" } });
  }, 60_000);

  it("rejects malformed apply/rotate bodies and unconfigured rotate without touching disk", async () => {
    const sc: Scenario = { stateDir: await makeStateDir(), base: {}, role: "primary" };
    const app = buildApp(tenantId, makeSupervisor(sc), sc.stateDir); // never reloaded → no config
    const cookie = await login(app);
    const post = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const dest = makeDestDir();
    const good = { destinationDir: dest, recoveryKey: KEY_1, retention: RETENTION };
    // Every malformed apply body → 400 backup.request_invalid, rejected before any write.
    const bad: unknown[] = [
      {}, // destinationDir missing
      { destinationDir: dest, schedule: DAILY_AT_0330, retention: RETENTION }, // recoveryKey missing
      { ...good, schedule: "nope" }, // schedule not an object
      { ...good, schedule: { kind: "bogus" } }, // unknown schedule kind
      { ...good, schedule: { kind: "interval", ms: 0 } }, // interval ms not positive
      { ...good, schedule: { kind: "wall-clock", days: [9], at: "auto" } }, // weekday out of range
      { ...good, schedule: { kind: "wall-clock", days: "daily", at: { hour: "x" } } }, // bad time
      { destinationDir: dest, recoveryKey: KEY_1, schedule: DAILY_AT_0330, retention: "nope" }, // retention not object
      { ...good, schedule: DAILY_AT_0330, retention: { count: 0, days: 30 } }, // count not positive
      { ...good, schedule: DAILY_AT_0330, retention: { count: 7, days: -1 } }, // days not positive
    ];
    for (const body of bad) {
      const res = await post("/api/backup/apply", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "backup.request_invalid" } });
    }
    // rotate with no key → request_invalid; with a bad key → unstorable; with a good key but nothing
    // configured to rotate → request_invalid (field "config"). All before any write.
    expect((await post("/api/backup/rotate", {})).status).toBe(400);
    const badKey = await post("/api/backup/rotate", { recoveryKey: "bad key " });
    expect(await badKey.json()).toMatchObject({
      error: { code: "backup.recovery_key_unstorable" },
    });
    const noConfig = await post("/api/backup/rotate", { recoveryKey: KEY_1 });
    expect(await noConfig.json()).toMatchObject({ error: { code: "backup.request_invalid" } });
    // recovery-key on an unconfigured box → null, not a throw.
    const rk = await app.request("/api/backup/recovery-key", { headers: { cookie } });
    expect((await rk.json()).key).toBeNull();
    await expect(readFile(join(sc.stateDir, "backup.env"), "utf8")).rejects.toThrow();
  }, 60_000);

  it("apply rejects a config the boot loader would reject (too-short key) before writing", async () => {
    const stateDir = await makeStateDir();
    const sc: Scenario = { stateDir, base: {}, role: "primary" };
    const app = buildApp(tenantId, makeSupervisor(sc), stateDir);
    const cookie = await login(app);
    const res = await app.request("/api/backup/apply", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        destinationDir: makeDestDir(),
        recoveryKey: "short", // storable, but under MIN_PASSPHRASE_LENGTH
        schedule: DAILY_AT_0330,
        retention: RETENTION,
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "backup.recovery_key_too_short" } });
    // The dry-validate ran BEFORE any write — no backup.env was created.
    await expect(readFile(join(stateDir, "backup.env"), "utf8")).rejects.toThrow();
  });

  it("a concurrent apply while a reload is in flight → 409 backup.reload_in_progress", async () => {
    // Hono serves requests concurrently, so two apply/rotate calls can race the supervisor's single
    // reload latch. The loser must map to 409 (a conflict to retry), NOT the boundary's default 400.
    // A gated `buildConfig` parks the FIRST reload inside its critical section (latch held), so the
    // second apply hits the latch deterministically — no timing guess.
    const dest = makeDestDir();
    const stateDir = await makeStateDir();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const enteredOnce = new Promise<void>((r) => {
      entered = r;
    });
    let buildCalls = 0;
    const base: NodeJS.ProcessEnv = {};
    const sup = new BackupSupervisor({
      buildConfig: async () => {
        buildCalls += 1;
        if (buildCalls === 1) {
          entered(); // the first reload is now inside its critical section, holding the latch…
          await gate; // …and parked here until we release it
        }
        return loadBackupConfig(await loadBoxEnv(base, stateDir));
      },
      isManagedByEnvironment: () => false,
      readSingletonRole: () => "primary",
      adminDatabaseUrl: suite.pg.uri,
      modules: ALL_MODULES,
      environment: "production",
      stateDir,
      mediaDir: mkdtempSync(join(tmpdir(), "backup-api-media-")),
      jitterSeed: "seed",
      readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00" }),
      log: () => {},
      runDump: fakeDump,
    });
    cleanup.push(() => sup.stop());
    const app = buildApp(tenantId, sup, stateDir);
    const cookie = await login(app);
    const body = JSON.stringify({
      destinationDir: dest,
      recoveryKey: KEY_1,
      schedule: DAILY_AT_0330,
      retention: RETENTION,
    });
    const post = () =>
      app.request("/api/backup/apply", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body,
      });

    const first = post(); // parks inside reload() → holds the latch
    await enteredOnce; // deterministic: the latch is held before the second call fires
    const second = await post(); // hits the latch
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "backup.reload_in_progress" } });
    release();
    expect((await first).status).toBe(200); // the winner completes normally once released
  }, 60_000);
});
