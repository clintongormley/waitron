import { seedPersons } from "@waitron/identity/test/person-rows.js";
import * as filesystem from "node:fs/promises";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { TLSSocket } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "undici";
import { startServer as bootServer, type StartedServer } from "./boot.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  stampDeployment,
  lockVenueDatabase,
  tenants,
  locations,
  nodes,
  type Database,
  type DeploymentEnvironment,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { seedNonproductionHistory } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { beginEnvironmentMove } from "@waitron/provisioning";
import { NODE_MIGRATIONS } from "@waitron/node-db";
import { seedBusinessDay, seedVenueSettings } from "@waitron/db/testing/seed.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { packArchive } from "./backup-archive.js";
import { nodeDumpEntry } from "./testing/node-copy.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { BOX_LEAF_HOSTNAMES } from "./box-name.js";
import { hashPassword } from "@waitron/identity";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { withRecoveryLock } from "./recovery-lock.js";
import { escapeHtml } from "./html-page.js";
import { mountEnvironmentChoice, type EnvironmentView } from "./recovery-environment.js";
import { START_AGAIN_PAGE_TEXT } from "./recovery-start-again.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it.each([
  { database: "preproduction" as const, host: "production" },
  { database: "production" as const, host: "preproduction" },
])("offers recovery before trading for $database on $host", async ({ database, host }) => {
  const f = await recoveryFixture("admin", "active", suite.db, true, database);
  f.baseEnv.WAITRON_ENV = host;
  const surface = await f.boot();
  expect(f.startServer).not.toHaveBeenCalled();
  const html = await (await surface.request("/")).text();
  expect(html).toContain("deployment.environment_mismatch");
  expect(html).toContain("Start again");
  expect(html).toContain("secure connection");
  expect((await readRecoveryState(f.stateDir)).failures).toBe(3);
});

const PASSWORD = "the administrator password";
async function recoveryFixture(
  role: "admin" | "manager" = "admin",
  status: "active" | "suspended" | "pending" = "active",
  database: Database = suite.db,
  stamp = true,
  stamped: DeploymentEnvironment = "preproduction",
) {
  if (stamp) await stampDeployment(database, stamped);
  await seedPersons(database, {
    displayName: "Robin",
    role,
    status,
    passwordHash: hashPassword(PASSWORD),
  });
  const root = await mkdtemp(join(tmpdir(), "environment-choice-"));
  dirs.push(root);
  const stateDir = join(root, "state");
  const venueDir = join(stateDir, "venue");
  await mkdir(venueDir, { recursive: true });
  await database.archiveTo(join(venueDir, "venue.db"));
  let original = await readFile(join(venueDir, "venue.db"));
  const exit = vi.fn();
  const log = vi.fn();
  const startServer = vi.fn(async () => ({ close: async () => {} }));
  const baseEnv: NodeJS.ProcessEnv = {
    WAITRON_ENV: "production",
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
  };
  const boot = async () => {
    let surface: Hono | undefined;
    const options: Parameters<typeof runEntry>[0] = {
      stateDir,
      venueDir,
      args: [],
      baseEnv,
      spareBytes: 0,
      statfs: async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      withRecoveryLock,
      assertNotAhead: async () => {},
      startServer,
      exit,
      serveRecovery: async (app) => {
        surface = app;
      },
      scheduleStayedUp: () => {},
      installShutdownHandlers: () => {},
      log,
    };
    if (
      !(await stat(join(stateDir, "recovery.json")).then(
        () => true,
        () => false,
      ))
    ) {
      for (let n = 0; n < 3; n++)
        await expect(runEntry({ ...options, startServer: bootServer })).rejects.toMatchObject({
          code: "deployment.environment_mismatch",
        });
      original = await readFile(join(venueDir, "venue.db"));
    }
    await runEntry(options);
    return surface!;
  };
  return {
    stateDir,
    venueDir,
    get original() {
      return original;
    },
    boot,
    exit,
    startServer,
    log,
    baseEnv,
  };
}
async function post(
  app: Hono,
  fields: Record<string, string>,
  options: { secure?: boolean; origin?: string; locale?: string } = {},
) {
  const socket = options.secure === false ? new Socket() : new TLSSocket(new Socket());
  try {
    return await app.request(
      "https://box.test/recovery-api/environment/start-again",
      {
        method: "POST",
        body: new URLSearchParams(fields),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: options.origin ?? "https://box.test",
          "Accept-Language": options.locale ?? "en-GB",
        },
      },
      { incoming: { socket } },
    );
  } finally {
    socket.destroy();
  }
}

it("moves the installed database unchanged and requests a restart", async () => {
  const f = await recoveryFixture();
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: BOX_LEAF_HOSTNAMES,
    listIpv4: () => [],
    now: () => new Date(),
  });
  const oldSecrets = await readFile(join(f.stateDir, "secrets.env"), "utf8");
  const app = await f.boot();
  const response = await post(app, { choice: "move", password: PASSWORD });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Start again has finished");
  expect(f.exit).toHaveBeenCalledWith(0);
  expect(f.log).toHaveBeenCalledWith("info", "recovery.environment_moved", {
    folder: expect.stringContaining("state/records/set-aside/"),
  });
  expect(f.startServer).not.toHaveBeenCalled();
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  const [stem] = await readdir(join(f.stateDir, "records/set-aside"));
  expect(await readFile(join(f.stateDir, "records/set-aside", stem!, "venue/venue.db"))).toEqual(
    f.original,
  );
  expect(
    await readFile(join(f.stateDir, "records/set-aside", stem!, "state/secrets.env"), "utf8"),
  ).toBe(oldSecrets);
  const environment = await loadBoxEnv(f.baseEnv, f.stateDir);
  expect(environment.WAITRON_ENV).toBe("production");
  expect(environment.WAITRON_CREDENTIALS_KEY).toBeUndefined();
  expect((await readRecoveryState(f.stateDir)).level).toBe("normal");
  expect((await post(app, { choice: "move", password: PASSWORD })).status).toBe(409);
});

it("logs a Move whose restart fails, leaves nothing unhandled, and keeps serving the page", async () => {
  const f = await recoveryFixture();
  const app = await f.boot();
  f.exit.mockImplementation(() => {
    throw new Error("exit failed");
  });
  expect((await post(app, { choice: "move", password: PASSWORD })).status).toBe(200);
  await vi.waitFor(() =>
    expect(f.log).toHaveBeenCalledWith("error", "server.restart_failed", {
      errorCode: null,
      errno: null,
      reason: null,
    }),
  );
  expect((await app.request("/")).status).toBe(200);
});

it("a Move whose answer fails to draw answers the moved page in the person's language and restarts once", async () => {
  const f = await recoveryFixture();
  await f.boot();
  const onFinished = vi.fn(() => Promise.resolve());
  const log = vi.fn();
  const render = vi.fn(async (view: EnvironmentView) => {
    if (view.message?.kind === "moved") throw new Error("render failed");
    return "<main></main>";
  });
  const app = new Hono();
  mountEnvironmentChoice(
    app,
    { roots: { stateDir: f.stateDir, venueDir: f.venueDir }, baseEnv: f.baseEnv, onFinished },
    render,
    log,
  );
  const response = await post(app, { choice: "move", password: PASSWORD }, { locale: "es-ES" });
  expect(response.status).toBe(200);
  const body = await response.text();
  const [stem] = await readdir(join(f.stateDir, "records/set-aside"));
  expect(body).toContain('<html lang="es-ES">');
  expect(body).toContain(
    escapeHtml(START_AGAIN_PAGE_TEXT["es-ES"].moved(`state/records/set-aside/${stem!}`)),
  );
  expect(render).toHaveBeenCalledOnce();
  expect(onFinished).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith("warn", "recovery.environment_draw_failed", {});
  expect(log).toHaveBeenCalledWith("info", "recovery.environment_moved", {
    folder: `state/records/set-aside/${stem!}`,
  });
});

it("Stop writes no choice or password counter and a corrected host can retry", async () => {
  const f = await recoveryFixture();
  const app = await f.boot();
  const before = (await readdir(f.stateDir)).sort();
  const response = await post(app, { choice: "keep" });
  expect(response.status).toBe(200);
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(f.original);
  expect((await readdir(f.stateDir)).sort()).toEqual(before);
  expect(f.exit).not.toHaveBeenCalled();
  f.baseEnv.WAITRON_ENV = "preproduction";
  const retry = await app.request("/recovery-api/retry", { method: "POST" });
  expect(retry.status).toBe(200);
  await vi.waitFor(async () => expect((await readRecoveryState(f.stateDir)).level).toBe("normal"));
  await f.boot();
  expect(f.startServer).toHaveBeenCalledOnce();
});

it.each([
  { role: "manager" as const, status: "active" as const },
  { role: "admin" as const, status: "suspended" as const },
  { role: "admin" as const, status: "pending" as const },
])("refuses $status $role without changing the database", async ({ role, status }) => {
  const f = await recoveryFixture(role, status);
  const app = await f.boot();
  const response = await post(app, { choice: "move", password: PASSWORD });
  expect(response.status).toBe(403);
  expect(await response.text()).toContain("administrator password");
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(f.original);
  expect(f.exit).not.toHaveBeenCalled();
});

it("offers the password and safe Stop in English and Spanish only over HTTPS", async () => {
  const f = await recoveryFixture();
  const app = await f.boot();
  for (const [locale, move, stop] of [
    ["en-GB", "Start again", "Stop"],
    ["es-ES", "Empezar de nuevo", "Parar"],
  ]) {
    const socket = new TLSSocket(new Socket());
    try {
      const html = await (
        await app.request(
          "https://box.test/",
          { headers: { "Accept-Language": locale! } },
          { incoming: { socket } },
        )
      ).text();
      expect(html).toContain('action="/recovery-api/environment/start-again"');
      expect(html).toContain('name="password"');
      expect(html).toContain(`>${move}</button>`);
      expect(html).toContain(`formnovalidate>${stop}</button>`);
      const insecure = await (
        await app.request("/", { headers: { "Accept-Language": locale! } })
      ).text();
      expect(insecure).not.toContain('name="password"');
    } finally {
      socket.destroy();
    }
  }
  const empty = await post(app, { choice: "move", password: "" });
  expect(empty.status).toBe(400);
  expect(await empty.text()).toContain('aria-invalid="true"');
  const duplicate = await app.request(
    "https://box.test/recovery-api/environment/start-again",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "password=x&password=y&choice=move",
    },
    { incoming: { socket: new TLSSocket(new Socket()).destroy() } },
  );
  expect(duplicate.status).toBe(400);
});

describe("unstamped non-production history", () => {
  const history = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  it("uses the fiscal contribution before offering the installed venue Move", async () => {
    await seedNonproductionHistory(history.db);
    const f = await recoveryFixture("admin", "active", history.db, false);
    const app = await f.boot();
    expect(await (await app.request("/")).text()).toContain("deployment.environment_mismatch");
    expect((await post(app, { choice: "move", password: PASSWORD })).status).toBe(200);
    const [stem] = await readdir(join(f.stateDir, "records/set-aside"));
    expect(await readFile(join(f.stateDir, "records/set-aside", stem!, "venue/venue.db"))).toEqual(
      f.original,
    );
  });
});

it("boots real HTTPS first setup after Move and previews another backup", async () => {
  const f = await recoveryFixture();
  // Here the saved file selects production; after Move the real process has no environment override.
  delete f.baseEnv.WAITRON_ENV;
  await ensureBoxSecrets({
    stateDir: f.stateDir,
    hostnames: BOX_LEAF_HOSTNAMES,
    listIpv4: () => [],
    now: () => new Date(),
  });
  const ca = await readFile(join(f.stateDir, "tls/ca.crt"));
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_ENV=production\n");
  const app = await f.boot();
  expect((await post(app, { choice: "move", password: PASSWORD })).status).toBe(200);
  const sourceNode = "ca278f55-6259-4658-a90c-faf628c0441b";
  const sourceLocation = "5a1f0110-2d83-4db4-86d5-89a166d60799";
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Selected business" });
  await suite.db.insert(locations).values({ id: sourceLocation });
  await seedBusinessDay(suite.db, {});
  await seedVenueSettings(suite.db, { name: "Selected venue", invoiceLocales: ["en-GB"] });
  await suite.db.insert(nodes).values({ id: sourceNode, name: "Selected box" });
  const sourceCopy = join(f.stateDir, "selected.db");
  await suite.db.archiveTo(sourceCopy);
  const archiveKey = "synthetic-archive-key";
  const artifact = encryptArtifact(
    packArchive([
      {
        name: "manifest.json",
        bytes: Buffer.from(
          JSON.stringify({
            manifestVersion: 1,
            createdAt: new Date().toISOString(),
            environment: "preproduction",
            modules: { core: 0, node: 0 },
          }),
        ),
      },
      { name: "db.dump", bytes: await readFile(sourceCopy) },
      await nodeDumpEntry(suite.node, f.stateDir),
      { name: "secrets/trading.env", bytes: Buffer.from(`WAITRON_NODE_ID=${sourceNode}\n`) },
      { name: "secrets/node-key.enc", bytes: Buffer.from("sealed") },
      { name: "secrets/cluster-id", bytes: Buffer.from("cluster") },
      {
        name: "secrets/credentials.key",
        bytes: Buffer.from(Buffer.alloc(32, 7).toString("base64")),
      },
    ]),
    archiveKey,
  );
  const migrations = join(f.stateDir, "test-migrations");
  await copyMigrationsRoot(migrations);
  const held = await retainHttpListener();
  const adoption = adoptRetainedListeners([held]);
  let server: StartedServer | undefined;
  const agent = new Agent({ connect: { ca } });
  try {
    await runEntry({
      stateDir: f.stateDir,
      venueDir: f.venueDir,
      args: [],
      spareBytes: 0,
      migrationsRoot: migrations,
      baseEnv: {
        WAITRON_STATE_DIR: f.stateDir,
        WAITRON_VENUE_DIR: f.venueDir,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(held.port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_MIGRATIONS_DIR: migrations,
        WAITRON_MANAGEMENT_RP_ID: "localhost",
        WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
      },
      statfs: async () => ({ bavail: Number.MAX_SAFE_INTEGER, frsize: 1 }),
      loadBoxEnv,
      readRecoveryState,
      writeRecoveryState,
      withRecoveryLock,
      startServer: async (env, base) => {
        server = await bootServer(env, base);
        return server;
      },
      serveRecovery: async () => {
        throw new Error("first setup was replaced by recovery");
      },
      scheduleStayedUp: () => {},
      installShutdownHandlers: () => {},
      log: () => {},
    });
    await adoption.bound;
    const request = async (path: string, init?: RequestInit) =>
      fetch(`https://127.0.0.1:${held.port}${path}`, { ...init, dispatcher: agent } as RequestInit);
    const status = await request("/setup-api/status");
    expect(await status.json()).toMatchObject({
      provisioned: false,
      environment: "preproduction",
      needs: ["venue"],
    });
    const claim = await request("/setup-api/first-setup/status");
    expect(await claim.json()).toMatchObject({ claimed: false });
    const preview = (environment: string) =>
      request("/setup-api/restore/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-waitron-recovery-key": archiveKey,
          "x-waitron-restore-environment": environment,
        },
        body: new Uint8Array(artifact),
      });
    const wrong = await preview("production");
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ error: { code: "restore.environment_mismatch" } });
    const selected = await preview("preproduction");
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({
      nodeId: sourceNode,
      environment: "preproduction",
      taxpayer: { legalName: "Selected business", taxId: "89890001K" },
      venueName: "Selected venue",
    });
    expect(await readFile(join(f.stateDir, "tls/ca.crt"))).toEqual(ca);
  } finally {
    adoption.restore();
    await agent.close();
    await server?.close();
    if (held.server.listening) await held.close();
  }
});

it("resumes a recorded Move before inspecting the old setup claim", async () => {
  const f = await recoveryFixture();
  await f.boot();
  await writeFile(join(f.venueDir, "first-setup-claim.json"), "old claim");
  const hold = await lockVenueDatabase(f.venueDir);
  try {
    let moves = 0;
    await expect(
      beginEnvironmentMove(f, {
        ...filesystem,
        rename: async (from, to) => {
          if (!from.includes(".first-setup-set-aside-probe-") && ++moves === 2)
            throw new Error("power cut");
          await filesystem.rename(from, to);
        },
      }),
    ).rejects.toMatchObject({ code: "setup.environment_move_unfinished" });
  } finally {
    hold.release();
  }
  await f.boot();
  expect(f.startServer).toHaveBeenCalledOnce();
  await expect(stat(join(f.venueDir, "first-setup-claim.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  const [stem] = await readdir(join(f.stateDir, "records/set-aside"));
  expect(
    await readFile(
      join(f.stateDir, "records/set-aside", stem!, "venue/first-setup-claim.json"),
      "utf8",
    ),
  ).toBe("old claim");
});

it("explains and logs an unavailable Move without moving the database", async () => {
  const f = await recoveryFixture();
  const app = await f.boot();
  await writeFile(join(f.stateDir, "records"), "retained non-folder");
  const response = await post(app, { choice: "move", password: PASSWORD });
  expect(response.status).toBe(409);
  const html = await response.text();
  expect(html).toContain("cannot be moved aside");
  expect(html).not.toContain("separate disks");
  expect(html).toContain('value="keep" formnovalidate>Stop</button>');
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(f.original);
  expect(f.log).toHaveBeenCalledWith(
    "warn",
    "recovery.environment_move_failed",
    expect.objectContaining({ errorCode: "setup.start_again_set_aside_unavailable" }),
  );
  expect(JSON.stringify(f.log.mock.calls)).not.toContain(PASSWORD);
});

it("rechecks a corrected saved environment before moving the installed database", async () => {
  const f = await recoveryFixture();
  delete f.baseEnv.WAITRON_ENV;
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_ENV=production\n");
  const app = await f.boot();
  await writeFile(join(f.stateDir, "trading.env"), "WAITRON_ENV=preproduction\n");
  const response = await post(app, { choice: "move", password: PASSWORD });
  expect(response.status).toBe(409);
  expect(await response.text()).toContain("no longer offered");
  expect(await readFile(join(f.venueDir, "venue.db"))).toEqual(f.original);
  expect(f.exit).not.toHaveBeenCalled();
  await expect(
    stat(join(f.stateDir, "first-setup-start-again-guesses.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("authorizes Move using an administrator password committed only in a retained WAL", async () => {
  const f = await recoveryFixture();
  const path = join(f.venueDir, "venue.db");
  const before = await readFile(path);
  const password = "the password committed in WAL";
  const hash = hashPassword(password);
  const writer = new DatabaseSync(path);
  let wal: Buffer;
  let shm: Buffer;
  try {
    writer.exec("pragma journal_mode = wal; pragma wal_autocheckpoint = 0");
    writer.prepare("update persons set password_hash = ? where role = 'admin'").run(hash);
    wal = await readFile(`${path}-wal`);
    shm = await readFile(`${path}-shm`);
  } finally {
    writer.close();
  }
  expect(before.includes(Buffer.from(hash))).toBe(false);
  expect(wal.includes(Buffer.from(hash))).toBe(true);
  await writeFile(path, before);
  await writeFile(`${path}-wal`, wal);
  await writeFile(`${path}-shm`, shm);
  const app = new Hono();
  mountEnvironmentChoice(
    app,
    { roots: f, baseEnv: f.baseEnv, onFinished: async () => {} },
    async () => "<main></main>",
  );
  expect((await post(app, { choice: "move", password: PASSWORD })).status).toBe(403);
  expect((await post(app, { choice: "move", password })).status).toBe(200);
});
