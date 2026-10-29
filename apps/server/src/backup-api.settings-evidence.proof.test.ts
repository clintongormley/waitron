// What `GET /api/backup/settings-evidence` must never do: change anything, wait for a Save, turn
// backups on, carry a secret, or answer without `system.manage`. Real venue database, real key rings,
// a real supervisor loading the record as boot does.
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import {
  deleteCredential,
  loadKeyRing,
  putCredential,
  tenantCredentials,
  type KeyRing,
} from "@waitron/credentials";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue } from "@waitron/provisioning";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import {
  ARCHIVE_PURPOSE,
  readArchiveSettingsWithMeta,
  writeArchiveSettings,
  type ArchiveSettings,
} from "./archive-settings.js";
import { mountBackupApi, type BackupApiDeps } from "./backup-api.js";
import {
  isBackupManagedByEnvironment,
  loadBackupSettings,
  loadRecoveryKey,
} from "./backup-config.js";
import { writeRecoveryKey } from "./backup-env-writer.js";
import { BackupSupervisor } from "./backup-supervisor.js";
import { createTurns, type Turns } from "./backup-turns.js";
import { loadBoxEnv } from "./box-env.js";
import { mountManagementApi } from "./management-api.js";
import { ALL_MODULES } from "./modules.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { mountStreamApi } from "./stream-api.js";
import { STREAM_PURPOSE, streamSettingsPayload } from "./stream-host.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";

// Lets one case make the record's decryption fail in a way no stored record produces; every other
// call is the real one.
const recordRead = vi.hoisted(() => ({ fail: undefined as (() => never) | undefined }));
vi.mock("@waitron/credentials", async (importOriginal) => {
  const real = await importOriginal<typeof import("@waitron/credentials")>();
  return {
    ...real,
    getCredential: (...args: Parameters<typeof real.getCredential>) =>
      recordRead.fail === undefined
        ? real.getCredential(...args)
        : Promise.resolve().then(recordRead.fail),
  };
});

const KEY_1 = "recovery-key-one-strong";
const KEY_2 = "recovery-key-two-different";
const VENUE = "c0000000-0000-4000-8000-000000000002";
const ringOf = (byte: number, version: string) =>
  loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, byte).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: version,
  });
const RING = ringOf(7, "1");

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

// Unmigrated: enough for a supervisor to open and sweep, as in `backup-api.route.test.ts`.
const venueDir = mkdtempSync(join(tmpdir(), "settings-evidence-proof-venue-"));
const cleanup: (() => Promise<void>)[] = [];
let cookies: { manager: string; staff: string };

const DAILY = { kind: "wall-clock", days: "daily", at: { hour: 3, minute: 30 } } as const;
const RETENTION = { count: 7, days: 30 } as const;
const ARCHIVE_SECRET = "archive-bucket-secret-0123456789";
const BUCKET = {
  endpoint: "https://s3.example.test",
  region: "eu-west-1",
  bucket: "venue-archives",
  prefix: "waitron",
  accessKeyId: "AKIAARCHIVEEXAMPLE",
  secretAccessKey: ARCHIVE_SECRET,
};
const COPY_ACCESS_KEY = "AKIABUCKETCOPYEXAMPLE";
const COPY_SECRET = "bucket-copy-secret-0123456789";

const destDir = () => mkdtempSync(join(tmpdir(), "settings-evidence-proof-dest-"));

function folderSettings(dir: string): Omit<ArchiveSettings, "revision"> {
  return {
    enabled: true,
    destinations: [{ kind: "local-fs", id: "primary", dir }],
    schedule: DAILY,
    retention: RETENTION,
    destinationTimeoutMs: 60_000,
  };
}

interface Scenario {
  stateDir: string;
  base: NodeJS.ProcessEnv;
  ring: KeyRing;
  role: "primary" | "secondary";
  statusReadTimeoutMs?: number;
  readRecord?: () => ReturnType<typeof readArchiveSettingsWithMeta>;
  lines: string[];
}

async function scenario(over: Partial<Scenario> = {}): Promise<Scenario> {
  const stateDir = mkdtempSync(join(tmpdir(), "settings-evidence-proof-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  // A primary's sweep fails a tick unless every RECOVERY_FILES path exists.
  for (const rel of RECOVERY_FILES) await writeFile(join(stateDir, rel), `dummy ${rel}`);
  return { stateDir, base: {}, ring: RING, role: "secondary", lines: [], ...over };
}

const capture =
  (sc: Scenario): Logger =>
  (level, event, fields) => {
    sc.lines.push(JSON.stringify([level, event, fields ?? {}]));
  };

function makeSupervisor(sc: Scenario): BackupSupervisor {
  const sup = new BackupSupervisor({
    buildConfig: async () =>
      loadBackupSettings({
        managedByEnvironment: isBackupManagedByEnvironment(sc.base),
        env: await loadBoxEnv(sc.base, sc.stateDir),
        readSealedWithMeta: () =>
          (sc.readRecord ?? (() => readArchiveSettingsWithMeta(suite.db, sc.ring)))(),
        venueId: VENUE,
      }),
    isManagedByEnvironment: () => isBackupManagedByEnvironment(sc.base),
    readSingletonRole: () => sc.role,
    venueDir,
    modules: ALL_MODULES,
    environment: "production",
    stateDir: sc.stateDir,
    jitterSeed: "seed",
    readClock: async () => ({ timeZone: "UTC", dayCutover: "00:00", cutoverChanges: [] }),
    ...(sc.statusReadTimeoutMs === undefined
      ? {}
      : { statusReadTimeoutMs: sc.statusReadTimeoutMs }),
    log: capture(sc),
  });
  cleanup.push(() => sup.stop());
  return sup;
}

const readKey = (sc: Scenario) => async () =>
  loadRecoveryKey(await loadBoxEnv(sc.base, sc.stateDir));

function buildApp(
  sup: BackupSupervisor,
  sc: Scenario,
  extra: Partial<BackupApiDeps> & { turns?: Turns } = {},
): Hono {
  const app = new Hono();
  mountManagementApi(
    app,
    {
      db: suite.db,
      cfg: { nodeId: "00000000-0000-0000-0000-000000000000" },
      secureCookies: false,
      rpId: "localhost",
      origin: "http://localhost",
      credentialKeyRing: TOTP_KEY_RING,
    },
    capture(sc),
  );
  mountBackupApi(
    app,
    {
      supervisor: sup,
      db: suite.db,
      ring: sc.ring,
      venueId: VENUE,
      stateDir: sc.stateDir,
      readRecoveryKey: readKey(sc),
      readBoxEnv: () => loadBoxEnv(sc.base, sc.stateDir),
      sealedState: { refresh: async () => "sealed" },
      readStream: () => ({ state: "off" }),
      turns: createTurns(),
      ...extra,
    },
    capture(sc),
  );
  return app;
}

const get = (app: Hono, cookie?: string) =>
  app.request("/api/backup/settings-evidence", cookie === undefined ? {} : { headers: { cookie } });

async function evidence(app: Hono): Promise<Record<string, unknown>> {
  const res = await get(app, cookies.manager);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const post = (app: Hono, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { cookie: cookies.manager, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const write = (settings: Omit<ArchiveSettings, "revision">) =>
  withTransaction(suite.db, (tx) => writeArchiveSettings(tx, RING, settings));

const hex = (_key: string, value: unknown) =>
  value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value;

async function tree(dir: string): Promise<Record<string, string>> {
  // The root's own mtime catches a file written and then deleted.
  const out: Record<string, string> = { ".": `dir ${(await stat(dir)).mtimeMs}` };
  for (const rel of (await readdir(dir, { recursive: true })).sort()) {
    const path = join(dir, rel);
    const s = await stat(path);
    out[rel] = s.isDirectory()
      ? `dir ${s.mtimeMs}`
      : `${s.mtimeMs} ${(await readFile(path)).toString("hex")}`;
  }
  return out;
}

/** Everything a read must leave as it found it, as text compared whole. */
async function snapshot(sc: Scenario, sup: BackupSupervisor, folders: string[]): Promise<string> {
  const rows = await withTransaction(suite.db, (tx) => tx.select().from(tenantCredentials));
  rows.sort((a, b) => a.purpose.localeCompare(b.purpose));
  return JSON.stringify(
    {
      rows,
      state: await tree(sc.stateDir),
      current: sup.current(),
      history: sup.loadHistory(),
      folders: await Promise.all(folders.map(tree)),
    },
    hex,
  );
}

async function setupTenant(): Promise<void> {
  await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "76000002K",
        legalName: "Deli Test SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: ["es-ES"],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "admin@x.com",
        },
      },
      ALL_MODULES,
    ),
    { db: suite.db, modules: ALL_MODULES },
  );
  cookies = await withTransaction(suite.db, async (tx) => {
    const start = async (role: "manager" | "staff") => {
      const [inserted] = await tx
        .insert(persons)
        .values({ displayName: role, pinHash: hashPin("1234"), role, email: `${role}@x.com` })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: inserted!.id });
      return `${MANAGEMENT_COOKIE}=${session.token}`;
    };
    return { manager: await start("manager"), staff: await start("staff") };
  });
}

afterEach(async () => {
  recordRead.fail = undefined;
  for (const stop of cleanup.splice(0)) await stop().catch(() => {});
  await withTransaction(suite.db, async (tx) => {
    await deleteCredential(tx, { purpose: ARCHIVE_PURPOSE });
    await deleteCredential(tx, { purpose: STREAM_PURPOSE });
  });
});

describe("GET /api/backup/settings-evidence proofs", () => {
  beforeAll(async () => {
    await setupTenant();
  }, 180_000);

  describe("changes nothing", () => {
    const states: [string, (sc: Scenario, folder: string) => Promise<Partial<Scenario>>][] = [
      [
        "a clean load",
        async (sc, folder) => {
          await write(folderSettings(folder));
          await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
          return {};
        },
      ],
      [
        "no recovery key",
        async (_sc, folder) => {
          const settings = folderSettings(folder);
          await write({
            ...settings,
            destinations: [
              ...settings.destinations,
              { kind: "s3", id: "bucket", bucket: BUCKET, venueId: VENUE },
            ],
          });
          return {};
        },
      ],
      [
        "a record this box's key number cannot open",
        async (sc, folder) => {
          await write(folderSettings(folder));
          await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
          return { ring: ringOf(9, "3") };
        },
      ],
    ];
    for (const [name, arrange] of states) {
      it(`${name}: rows, files, the supervisor and the folder are the same after each read`, async () => {
        const folder = destDir();
        await writeFile(join(folder, "kept"), "a file already there");
        const sc = await scenario();
        Object.assign(sc, await arrange(sc, folder));
        const sup = makeSupervisor(sc);
        await sup.reload();
        const app = buildApp(sup, sc);

        const baseline = await snapshot(sc, sup, [folder]);
        for (let read = 0; read < 2; read++) {
          await evidence(app);
          expect(await snapshot(sc, sup, [folder])).toBe(baseline);
        }
        expect(await snapshot(sc, sup, [folder])).toBe(baseline);
      }, 60_000);
    }

    it("a Save sent while a folder look is held completes before the read answers", async () => {
      const folder = destDir();
      await write(folderSettings(folder));
      const sc = await scenario({ role: "primary", statusReadTimeoutMs: 600_000 });
      await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
      const sup = makeSupervisor(sc);
      await sup.reload();
      let looking!: () => void;
      const lookStarted = new Promise<void>((resolve) => (looking = resolve));
      let release!: () => void;
      const held = new Promise<never>((_resolve, reject) => {
        release = () => reject(Object.assign(new Error("released"), { code: "EIO" }));
      });
      held.catch(() => {});
      const app = buildApp(sup, sc, {
        statFolder: () => {
          looking();
          return held;
        },
      });
      let settled = false;
      try {
        const read = evidence(app).finally(() => {
          settled = true;
        });
        await lookStarted;
        const saved = await post(app, "/api/backup/apply", {
          destinations: [{ kind: "local-fs", dir: destDir() }],
          schedule: DAILY,
          retention: RETENTION,
        });
        expect(saved.status).toBe(200);
        expect(settled).toBe(false);
        release();
        expect((await read).now).toEqual({
          state: "readable",
          destinations: [{ kind: "folder", dir: folder, look: "unknown" }],
        });
      } finally {
        release();
      }
    }, 60_000);
  });

  describe("after the bucket copy's key write, which paths turn backups on", () => {
    /** An enabled record, no recovery key, then the bucket copy's Save through its real route. */
    async function keyWrittenByBucketCopy() {
      const folder = destDir();
      await write(folderSettings(folder));
      const sc = await scenario({ role: "primary" });
      const sup = makeSupervisor(sc);
      await sup.reload();
      expect(sup.current()).toMatchObject({
        enabled: false,
        loadErrorCode: "backup.recovery_key_missing",
      });
      const turns = createTurns();
      const app = buildApp(sup, sc, { turns });
      // Wired as boot wires it.
      mountStreamApi(
        app,
        {
          db: suite.db,
          ring: RING,
          stream: { reload: async () => {}, status: () => ({ state: "off" }) },
          nodeId: "00000000-0000-0000-0000-000000000000",
          venueId: VENUE,
          isPrimary: () => true,
          isManagedByEnvironment: () => false,
          loadedArchives: () => sup.current().destinations,
          readRecoveryKey: readKey(sc),
          writeRecoveryKey: (recoveryKey) =>
            writeRecoveryKey(sc.stateDir, { recoveryKey, keyRotatedAt: undefined }),
          sealedState: { refresh: async () => "sealed" },
          probe: async () => ({ ok: true }),
          turns,
        },
        capture(sc),
      );
      const copy = await app.request("/api/backup/stream", {
        method: "PUT",
        headers: { cookie: cookies.manager, "content-type": "application/json" },
        body: JSON.stringify({
          region: "eu-west-1",
          bucket: "venue-copy",
          accessKeyId: COPY_ACCESS_KEY,
          secretAccessKey: COPY_SECRET,
        }),
      });
      expect(copy.status).toBe(200);
      expect(await readKey(sc)()).toEqual(expect.any(String));
      expect(sup.current().enabled).toBe(false);
      // Read again finds the record readable and the key usable, and still turns nothing on.
      expect(await evidence(app)).toMatchObject({
        now: { state: "readable" },
        recoveryKey: { held: true, tooShort: false },
      });
      expect(sup.current().enabled).toBe(false);
      return { sc, sup, app };
    }

    it("a recovery-key replacement (rotate) turns them on", async () => {
      const { sup, app } = await keyWrittenByBucketCopy();
      const res = await post(app, "/api/backup/rotate", { recoveryKey: KEY_2 });
      expect(res.status).toBe(200);
      expect(sup.current()).toMatchObject({ enabled: true, loadErrorCode: null });
    }, 60_000);

    it("a Save (apply) turns them on", async () => {
      const { sup, app } = await keyWrittenByBucketCopy();
      const res = await post(app, "/api/backup/apply", {
        destinations: [{ kind: "local-fs", dir: destDir() }],
        schedule: DAILY,
        retention: RETENTION,
      });
      expect(res.status).toBe(200);
      expect(sup.current()).toMatchObject({ enabled: true, loadErrorCode: null });
    }, 60_000);

    it("a restart (a fresh supervisor's reload) turns them on", async () => {
      const { sc, sup } = await keyWrittenByBucketCopy();
      await sup.stop();
      const fresh = makeSupervisor(sc);
      await fresh.reload();
      expect(fresh.current()).toMatchObject({ enabled: true, loadErrorCode: null });
    }, 60_000);
  });

  it("leaks nothing: no secret, recovery key, bucket copy key or error message in the answer or the read's log lines", async () => {
    const folder = destDir();
    const settings = folderSettings(folder);
    await write({
      ...settings,
      destinations: [
        ...settings.destinations,
        { kind: "s3", id: "bucket", bucket: BUCKET, venueId: VENUE },
      ],
    });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: STREAM_PURPOSE,
        value: streamSettingsPayload({
          venueId: VENUE,
          bucket: {
            region: "eu-west-1",
            bucket: "venue-copy",
            prefix: "",
            accessKeyId: COPY_ACCESS_KEY,
            secretAccessKey: COPY_SECRET,
          },
        }),
      }),
    );
    const messageSecret = "error-message-secret-0123456789";
    const paramSecret = "error-param-secret-0123456789";
    const failures = [
      new Error(`could not read: ${messageSecret}`),
      new AppError("server.config_invalid", { variable: paramSecret, reason: messageSecret }),
    ];
    const sc = await scenario({
      readRecord: () => Promise.reject(failures.shift() ?? new Error("no more failures")),
    });
    await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sup = makeSupervisor(sc);
    await sup.reload();
    await sup.reload();
    const app = buildApp(sup, sc);
    sc.lines.length = 0;

    const body = await evidence(app);
    const said = JSON.stringify(body) + "\n" + sc.lines.join("\n");
    // The answer names what the design shows: the failures and the archive bucket's access key id.
    expect((body.failures as { code: string }[]).map((f) => f.code)).toEqual([
      "server.config_invalid",
      "unknown",
    ]);
    expect(said).toContain(BUCKET.accessKeyId);
    for (const secret of [
      ARCHIVE_SECRET,
      COPY_SECRET,
      COPY_ACCESS_KEY,
      KEY_1,
      Buffer.alloc(32, 7).toString("base64"),
      messageSecret,
      paramSecret,
    ]) {
      expect(said).not.toContain(secret);
    }
  }, 60_000);

  it("leaks nothing when the record does not read now: no param of the read's error in the answer or the read's log lines", async () => {
    await write(folderSettings(destDir()));
    const sc = await scenario();
    await writeRecoveryKey(sc.stateDir, { recoveryKey: KEY_1, keyRotatedAt: undefined });
    const sup = makeSupervisor(sc);
    await sup.reload();
    const app = buildApp(sup, sc);
    sc.lines.length = 0;
    const reasonSecret = "reason-param-secret-0123456789";
    const extraSecret = "extra-param-secret-0123456789";
    recordRead.fail = () => {
      throw new AppError("backup.archive_settings_invalid", {
        reason: reasonSecret,
        extra: extraSecret,
      } as { reason: string });
    };

    const body = await evidence(app);
    expect(body.now).toMatchObject({
      state: "unreadable",
      code: "backup.archive_settings_invalid",
    });
    const said = JSON.stringify(body) + "\n" + sc.lines.join("\n");
    expect(said).not.toContain(reasonSecret);
    expect(said).not.toContain(extraSecret);
  }, 60_000);

  describe("refusals", () => {
    for (const [who, cookie, status, code] of [
      ["no session", () => undefined, 401, "management_session.required"],
      ["a session without system.manage", () => cookies.staff, 403, "authorization.not_permitted"],
    ] as const) {
      it(`${who}: ${code}, and nothing written`, async () => {
        const folder = destDir();
        await write(folderSettings(folder));
        const sc = await scenario();
        const sup = makeSupervisor(sc);
        await sup.reload();
        const app = buildApp(sup, sc);
        const before = await snapshot(sc, sup, [folder]);

        const res = await get(app, cookie());
        expect(res.status).toBe(status);
        expect(await res.json()).toMatchObject({ error: { code } });
        expect(await snapshot(sc, sup, [folder])).toBe(before);
      }, 60_000);
    }
  });
});
