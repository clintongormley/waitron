import { DatabaseSync } from "node:sqlite";
import { Socket } from "node:net";
import * as childProcess from "node:child_process";
import { get as httpsGet } from "node:https";
import { mkdtemp, mkdir, writeFile, rm, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { provisionOrderVenue, billlessSale, type OrderVenue } from "./testing/order-venue.js";
import * as history from "./orders-list.js";
import * as firstSetupMode from "./first-fiscal-mode.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { TEST_PRODUCER } from "./testing/test-producer.js";
import { loadConfig } from "./config.js";
import { freePort } from "./testing/free-ports.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";

vi.mock("node:child_process", { spy: true });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "waitron-upgrade-check-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

it("binds the configured TLS address and refuses health, sign-in and payment requests", async () => {
  const { openUpgradeListener } = await import("./upgrade-checks.js");
  const material = mintMtlsMaterial();
  await mkdir(join(root, "tls"));
  await writeFile(join(root, "tls/server.pem"), material.serverCertPem + material.serverKeyPem);
  const port = await freePort();
  const config = loadConfig(
    { WAITRON_STATE_DIR: root, WAITRON_HTTP_PORT: String(port) },
    root,
    root,
  );
  const checked = await openUpgradeListener(config, () => {});
  try {
    expect(checked.server.address()).toMatchObject({ address: "127.0.0.1", port });
    for (const path of ["/health", "/api/login", "/api/till/payments"]) {
      const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = httpsGet(
          { hostname: "127.0.0.1", port, path, ca: material.caPem },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode!, body }));
          },
        );
        request.on("error", reject);
      });
      expect(answer).toEqual({ status: 503, body: "Upgrade checks in progress" });
    }
  } finally {
    await checked.close();
  }
  const reclaimed = await openUpgradeListener(config, () => {});
  await reclaimed.close();
});

describe("contained upgrade data checks", () => {
  let venue: OrderVenue;
  let migrations: string;
  const source = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    resetPerTest: false,
    setup: async (db) => {
      venue = await provisionOrderVenue(db);
      await billlessSale(venue);
    },
  });
  beforeAll(async () => {
    migrations = await mkdtemp(join(tmpdir(), "waitron-upgrade-migrations-"));
    await copyMigrationsRoot(migrations);
  });
  afterAll(async () => {
    if (migrations) await rm(migrations, { recursive: true, force: true });
  });

  async function copiedConfig() {
    const venueDir = join(root, "venue");
    await mkdir(venueDir);
    await source.db.archiveTo(join(venueDir, "venue.db"));
    await source.node.archiveTo(join(venueDir, "node.db"));
    await writeFile(
      join(root, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    const env = {
      ...TEST_PRODUCER,
      WAITRON_STATE_DIR: root,
      WAITRON_NODE_ID: venue.cfg.nodeId,
      WAITRON_MANAGEMENT_RP_ID: "dashboard.example.test",
      WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.test",
    };
    return { config: loadConfig(env, migrations, root), env };
  }

  it("runs the configured backend and real menu/history readers on migrated data", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    const report = await checkUpgradeData(config, env);
    expect(report).toEqual({ mode: "trading", menus: 3, orders: 1, fiscalRecords: 1 });
    // These checks inspect the copy; the mandatory test sale has a separate disposable copy.
    expect(await checkUpgradeData(config, env)).toEqual(report);
  });

  it("loads the saved box configuration, finishes its contained entry and releases its listener", async () => {
    const { runUpgradeChecks } = await import("./upgrade-check-entry.js");
    const { env } = await copiedConfig();
    await writeFile(join(root, "trading.env"), `WAITRON_NODE_ID=${venue.cfg.nodeId}\n`);
    const port = await freePort();
    const connect = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
      throw new Error("external socket refused");
    });
    const processes = (
      ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const
    ).map((name) =>
      vi.spyOn(childProcess, name).mockImplementation(() => {
        throw new Error("external process refused");
      }),
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("external fetch refused"));
    const base: NodeJS.ProcessEnv = { ...env };
    delete base.WAITRON_NODE_ID;
    const report = await runUpgradeChecks(
      { ...base, WAITRON_MIGRATIONS_DIR: migrations, WAITRON_HTTP_PORT: String(port) },
      () => {},
    );
    expect(report).toEqual({ mode: "trading", menus: 3, orders: 1, fiscalRecords: 1 });
    expect(connect).not.toHaveBeenCalled();
    for (const process of processes) expect(process).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const { openUpgradeListener } = await import("./upgrade-checks.js");
    const rebound = await openUpgradeListener(
      loadConfig({ ...env, WAITRON_HTTP_PORT: String(port) }, migrations, root),
      () => {},
    );
    await rebound.close();
  });

  it.each([
    {
      name: "a newer recorded migration",
      sql: "insert into __drizzle_migrations_db (hash,created_at) values ('unknown-release',9999999999999)",
      code: "provisioning.database_ahead",
    },
    {
      name: "changed append-only protection",
      sql: "drop trigger sales_append_only_update; create trigger sales_append_only_update before update on sales begin select 1; end",
      code: "append_only.triggers_changed",
    },
    {
      name: "a menu with missing structure",
      sql: "delete from menu_details",
      code: "catalogue.not_found",
    },
  ])("refuses $name and releases the venue folder", async ({ sql, code }) => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    const file = new DatabaseSync(join(config.venueDir, "venue.db"));
    try {
      file.exec(sql);
    } finally {
      file.close();
    }
    await expect(checkUpgradeData(config, env)).rejects.toMatchObject({ code });
    const lock = new DatabaseSync(join(config.venueDir, "venue.lock"));
    try {
      expect(() => lock.exec("pragma busy_timeout=0; begin immediate")).not.toThrow();
    } finally {
      lock.close();
    }
  });

  it.each(["venue.db", "node.db"])("refuses a broken foreign key in %s", async (name) => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    const file = new DatabaseSync(join(config.venueDir, name));
    try {
      file.exec(`pragma foreign_keys=off;
      create table upgrade_parent(id text primary key);
      create table upgrade_child(parent_id text references upgrade_parent(id));
      insert into upgrade_child values ('absent')`);
    } finally {
      file.close();
    }
    await expect(checkUpgradeData(config, env)).rejects.toThrow(
      `Upgrade integrity check failed: ${name}`,
    );
  });

  it("refuses a mismatched deployment before it applies migrations", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    const file = new DatabaseSync(join(config.venueDir, "venue.db"));
    try {
      file.exec("update __drizzle_migrations_db set created_at=0");
    } finally {
      file.close();
    }
    await expect(
      checkUpgradeData(
        { ...config, environment: "production" },
        { ...env, WAITRON_ENV: "production" },
      ),
    ).rejects.toMatchObject({ code: "deployment.environment_mismatch" });
  });

  it("fails when the configured backend reports damaged fiscal history", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    vi.spyOn(VerifactuBackend.prototype, "checkIntegrity").mockResolvedValue({
      ok: false,
      checked: 1,
      issues: [{ code: "integrity.hash_mismatch", params: {} }],
    });
    await expect(checkUpgradeData(config, env)).rejects.toThrow(
      "Upgrade fiscal history check failed",
    );
  });

  it("propagates a failed history detail read instead of counting the list as sufficient", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    vi.spyOn(history, "readOrderDetail").mockRejectedValue(new Error("history detail unavailable"));
    await expect(checkUpgradeData(config, env)).rejects.toThrow("history detail unavailable");
  });

  it("closes the configured listener when a data check fails", async () => {
    const { runUpgradeChecks } = await import("./upgrade-check-entry.js");
    const { config, env } = await copiedConfig();
    const port = await freePort();
    await expect(
      runUpgradeChecks(
        {
          ...env,
          WAITRON_ENV: "production",
          WAITRON_MIGRATIONS_DIR: migrations,
          WAITRON_HTTP_PORT: String(port),
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: "deployment.environment_mismatch" });
    const { openUpgradeListener } = await import("./upgrade-checks.js");
    const rebound = await openUpgradeListener({ ...config, httpPort: port }, () => {});
    await rebound.close();
  });

  it("ships an executable entry that checks data and reports invalid configuration or a refused bind", async () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_CHILD_SESSION", "1");
    vi.stubEnv("WAITRON_TLS_CERT_FILE", "/ambient/never-use.pem");
    const { env } = await copiedConfig();
    const artifact = join(root, "artifact");
    const entry = join(artifact, "upgrade-checks.js");
    const coldState = join(root, "unused-state");
    await mkdir(coldState);
    const execute = promisify(childProcess.execFile);
    await execute(
      "pnpm",
      ["exec", "node", "../../scripts/bundle-node.mjs", `src/upgrade-check-entry.ts=${entry}`],
      { timeout: 120_000 },
    );
    await execute(process.execPath, ["scripts/copy-migrations.mjs", artifact], { timeout: 30_000 });
    await symlink(resolve("node_modules/sharp"), join(artifact, "node_modules/sharp"));
    const cold = await execute(process.execPath, [entry], {
      env: {
        PATH: process.env.PATH,
        WAITRON_ENV: "invalid-for-startup",
        WAITRON_STATE_DIR: coldState,
      },
      timeout: 10_000,
    }).catch((error: childProcess.ExecFileException & { stdout: string; stderr: string }) => error);
    expect(cold).toMatchObject({ code: 1, stdout: "" });
    expect(cold.stderr).toBe("server.config_invalid\n");
    expect(await readdir(coldState)).toEqual([]);
    const port = await freePort();
    const script = `const {runUpgradeChecks}=await import(${JSON.stringify(pathToFileURL(entry).href)});
      console.log(JSON.stringify(await runUpgradeChecks(process.env,()=>{})));`;
    const checked = await execute(process.execPath, ["--input-type=module", "--eval", script], {
      env: {
        PATH: process.env.PATH,
        ...env,
        WAITRON_MIGRATIONS_DIR: join(artifact, "drizzle"),
        WAITRON_HTTP_PORT: String(port),
      },
      timeout: 30_000,
    });
    expect(JSON.parse(checked.stdout)).toEqual({
      mode: "trading",
      menus: 3,
      orders: 1,
      fiscalRecords: 1,
    });
    expect(checked.stderr).toBe("");
    const invoked = await execute(process.execPath, [entry, "readiness"], {
      env: {
        PATH: process.env.PATH,
        ...env,
        WAITRON_MIGRATIONS_DIR: join(artifact, "drizzle"),
        WAITRON_HTTP_PORT: String(port),
      },
      timeout: 30_000,
    });
    expect(JSON.parse(invoked.stdout)).toEqual([
      {
        name: "readiness",
        ok: true,
        details: { mode: "trading", menus: 3, orders: 1, fiscalRecords: 1 },
      },
    ]);
    const held = await retainHttpListener();
    try {
      const busyScript = `const {runUpgradeChecks}=await import(${JSON.stringify(pathToFileURL(entry).href)});
        await runUpgradeChecks(process.env,(level,event,fields)=>console.log(JSON.stringify({level,event,...fields})));`;
      const refused = await execute(
        process.execPath,
        ["--input-type=module", "--eval", busyScript],
        {
          env: {
            PATH: process.env.PATH,
            WAITRON_STATE_DIR: coldState,
            WAITRON_HTTP_PORT: String(held.port),
          },
          timeout: 10_000,
        },
      ).catch(
        (error: childProcess.ExecFileException & { stdout: string; stderr: string }) => error,
      );
      expect(refused).toMatchObject({ code: 1, stderr: "" });
      expect(JSON.parse(refused.stdout)).toMatchObject({
        event: "server.listen_failed",
        code: "EADDRINUSE",
        port: held.port,
      });
      expect(await readdir(coldState)).toEqual([]);
    } finally {
      await held.close();
    }
  }, 220_000);

  it("refuses a setup-only box before creating database state", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const env = { WAITRON_STATE_DIR: root };
    await expect(checkUpgradeData(loadConfig(env, migrations, root), env)).rejects.toThrow(
      "Upgrade checks require completed first setup and a configured node",
    );
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    { name: "first-setup-deleting.json", code: "setup.start_again_incomplete" },
    { name: "first-setup-claim.json", code: "setup.attempt_invalid" },
  ])(
    "keeps an unfinished setup in $name refused without changing the copy",
    async ({ name, code }) => {
      const { checkUpgradeData } = await import("./upgrade-checks.js");
      const { config, env } = await copiedConfig();
      const marker = join(config.venueDir, name);
      await writeFile(marker, "{}");
      const before = await readdir(config.venueDir);
      await expect(checkUpgradeData(config, env)).rejects.toMatchObject({ code });
      expect(await readdir(config.venueDir)).toEqual(before);
    },
  );

  it("uses first setup's mode decision before choosing the node for data checks", async () => {
    const { checkUpgradeData } = await import("./upgrade-checks.js");
    const { config, env } = await copiedConfig();
    vi.spyOn(firstSetupMode, "reconcileFirstSetupBeforeMode").mockImplementation(
      async (resolved) => {
        resolved.node = undefined;
      },
    );
    await expect(checkUpgradeData(config, env)).rejects.toThrow(
      "Upgrade checks require completed first setup and a configured node",
    );
  });
});
