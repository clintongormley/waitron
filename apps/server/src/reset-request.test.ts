import { dirname, join } from "node:path";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  locations,
  openVenueDatabase,
  readDeploymentEnvironment,
  stampDeployment,
  tenants,
} from "@waitron/db";
import { readMirrorLink, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { loadKeyRing } from "@waitron/credentials";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { adoptFromPrimary, type AdoptHooks, type AdoptRequest } from "./adopt.js";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { ensureBoxSecrets, writeCredentialsRing } from "./box-secrets.js";
import { markJoined } from "./box-tls-install.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { parseEnvFile } from "./env-file.js";
import { PENDING_ADOPTION_FILE, type PendingAdoption } from "./finish-adoption.js";
import type { Logger } from "./logger.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { writeModuleConfig } from "./module-config.js";
import { runStagedReset, stageResetRequest } from "./reset-request.js";
import { mountSetup } from "./setup-api.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { writeTradingEnv } from "./trading-config.js";
import { MAIN_AUTHORITY } from "./testing/main-authority.js";
import { runEntry } from "./node-entry.js";
import { FRESH } from "./recovery-state.js";
import { PAIR_BUNDLE_FIELDS } from "./testing/pair-bundle.js";

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: undefined } : module,
    ),
  };
});

const { rmMock, actualRm } = vi.hoisted(() => ({
  rmMock: vi.fn(),
  actualRm: { current: undefined as undefined | typeof import("node:fs/promises").rm },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  actualRm.current = actual.rm;
  rmMock.mockImplementation(actual.rm);
  return { ...actual, rm: rmMock };
});

/** Records every removal, and fails the first removal of `failing`, if named. */
function watchRemovals(failing?: string): string[] {
  const removed: string[] = [];
  let failOnce = failing;
  rmMock.mockImplementation(async (path: string, options?: object) => {
    removed.push(path);
    if (path === failOnce) {
      failOnce = undefined;
      throw Object.assign(new Error("power lost"), { code: "EIO" });
    }
    return actualRm.current!(path, options);
  });
  return removed;
}

const NODE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_NODE_ID = "22222222-2222-4222-8222-222222222222";
const ADOPT_BODY = JSON.stringify({
  primaryUrl: "https://primary.example",
  credential: { email: "owner@example.test", password: "a-password" },
});

const PRIMARY_KEYS = generateNodeKeyPair();
const BUNDLE: MirrorBundle = {
  designated: {
    nodeId: PRIMARY_NODE_ID,
  },
  tenant: { country: "ES", taxId: "80000001K" },
  primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: MAIN_AUTHORITY.caCertPem,
  ...PAIR_BUNDLE_FIELDS,
  accountKey: Buffer.alloc(32, 9).toString("base64"),
  reservedIdentity: {
    modules: {
      "fiscal-verifactu": { nif: "90000001K", idSistemaInformatico: "WS", numeroInstalacion: 7 },
    },
    series: [{ code: "SA-7", purpose: "standard" }],
    endorsement: endorseKey(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "STANDBY_PUB",
      PRIMARY_NODE_ID,
      PRIMARY_KEYS.privateKey,
    ),
  },
  moduleOverrides: {},
  primaryPublicKey: PRIMARY_KEYS.publicKey,
  credentialsRing: { key: Buffer.alloc(32, 6).toString("base64"), version: 1 },
  backupSettings: null,
  boxCaKeyPem: MAIN_AUTHORITY.caKeyPem,
};

const dirs: string[] = [];
afterEach(async () => {
  rmMock.mockImplementation(actualRm.current!);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const migrate = (venueDir: string) =>
  applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));

/**
 * A box whose adopt wrote its rows and files and then stopped, as `adoptFromPrimary` leaves it.
 * `joined`: the adopt got as far as its marker, so the main box's ring and authority may be here.
 */
async function halfAdoptedBox(joined = false): Promise<{
  stateDir: string;
  venueDir: string;
  operationId: string;
}> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-reset-request-"));
  dirs.push(stateDir);
  const venueDir = join(stateDir, "venue");
  await mkdir(venueDir);
  await migrate(venueDir);
  const store = await openVenueDatabase(venueDir);
  try {
    await stampDeployment(store.venue, "preproduction");
    await setNodeMode({ venue: store.venue, node: store.node }, NODE_ID, "mirror");
    await writeMirrorLink(store.node, NODE_ID, {
      originUrl: "https://relay.example",
      boxHostname: "waitron.local",
      boxCaPem: "pem",
      originNodeId: PRIMARY_NODE_ID,
    });
    await mintBreakGlassSecret({ venue: store.venue, node: store.node }, NODE_ID);
  } finally {
    await store.close();
  }
  await mkdir(join(venueDir, ".venue.db-litestream"));
  await writeFile(join(venueDir, ".venue.db-litestream", "generation"), "g");
  await writeFile(join(stateDir, PENDING_ADOPTION_FILE), "{}");
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "ca");
  if (joined) await markJoined(stateDir, PRIMARY_NODE_ID);
  await writeFile(join(stateDir, "secrets.env"), "S=1\n");
  await writeFile(join(stateDir, "backup.env"), "B=1\n");

  const operations = createSetupOperationStore(stateDir);
  await operations
    .run("adopt", "a-request", async (operation) => {
      await operation.advance("venue_committed", { resetProof: {} });
      throw new Error("stopped partway");
    })
    .catch(() => {});
  const record = await operations.read();
  expect(record?.phase).toBe("venue_committed");
  return { stateDir, venueDir, operationId: record!.id };
}

function capturingLog(): { log: Logger; events: Array<[string, string, unknown]> } {
  const events: Array<[string, string, unknown]> = [];
  return { log: (level, event, fields) => void events.push([level, event, fields]), events };
}

/** Every file and folder a refused reset must leave where it was. */
async function snapshot(stateDir: string): Promise<string[]> {
  const paths = [
    "venue/venue.db",
    "venue/.venue.db-litestream/generation",
    PENDING_ADOPTION_FILE,
    "flows/setup/operation.json",
    "trading.env",
    "tls/ca.crt",
    "secrets.env",
  ];
  return Promise.all(
    paths.map(async (path) => {
      const full = join(stateDir, path);
      return existsSync(full) ? `${path}:${(await stat(full)).size}` : `${path}:absent`;
    }),
  );
}

type Adopt = (req: AdoptRequest, hooks: AdoptHooks) => Promise<{ breakGlassSecret: string }>;

async function postAdopt(
  stateDir: string,
  adopt: Adopt = vi.fn(async () => ({ breakGlassSecret: "secret" })),
): Promise<number> {
  const app = new Hono();
  mountSetup(
    app,
    {
      environment: "preproduction",
      operations: createSetupOperationStore(stateDir),
      adopt,
      requestRestart: vi.fn(),
    },
    () => {},
  );
  const response = await app.request("/setup-api/adopt", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: ADOPT_BODY,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return response.status;
}

describe("stageResetRequest", () => {
  it("writes the marker owner-only, naming the operation", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "waitron-reset-stage-"));
    dirs.push(stateDir);
    await stageResetRequest(stateDir, "op-1");
    const path = join(stateDir, "reset-request.json");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 1, operationId: "op-1" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe("runStagedReset", () => {
  it("does nothing, and takes no lock, when no reset is staged", async () => {
    const { stateDir, venueDir } = await halfAdoptedBox();
    const lock = vi.fn();
    const before = await snapshot(stateDir);
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} }, lock)).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    expect(await snapshot(stateDir)).toEqual(before);
  });

  it("removes what the adopt wrote and keeps the box's certificate and secrets", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox();
    await stageResetRequest(stateDir, operationId);
    const { log, events } = capturingLog();

    expect(await runStagedReset({ stateDir, venueDir, log })).toBe(true);

    for (const gone of [
      "venue/venue.db",
      "venue/venue.db-wal",
      "venue/venue.db-shm",
      "venue/node.db",
      "venue/.venue.db-litestream",
      PENDING_ADOPTION_FILE,
      "flows/setup/operation.json",
      "reset-request.json",
    ]) {
      expect(existsSync(join(stateDir, gone)), gone).toBe(false);
    }
    expect(await readFile(join(stateDir, "tls", "ca.crt"), "utf8")).toBe("ca");
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe("S=1\n");
    expect(await readFile(join(stateDir, "backup.env"), "utf8")).toBe("B=1\n");
    expect(events).toContainEqual(["info", "setup.reset_done", {}]);

    await migrate(venueDir);
    const store = await openVenueDatabase(venueDir);
    try {
      expect(await readDeploymentEnvironment(store.venue)).toBeNull();
      expect(await readMirrorLink(store.node, NODE_ID)).toBeNull();
      const roles = await store.node.execute<{ n: number }>(
        sql`select count(*) as n from node_mode`,
      );
      expect(roles.rows[0]?.n).toBe(0);
    } finally {
      await store.close();
    }
  });

  it.each([false, true])(
    "a staged reset of a box that joined leaves no authority, leaf, client certificate or key ring (repair complete=%s)",
    async (complete) => {
      const { stateDir, venueDir, operationId } = await halfAdoptedBox(true);
      const tls = join(stateDir, "tls");
      for (const name of ["ca.key", "server.pem", "client.crt", "server.pem.tmp"]) {
        await writeFile(join(tls, name), name);
      }
      await mkdir(join(stateDir, "flows/tls-repair"), { recursive: true });
      await writeFile(
        join(stateDir, "flows/tls-repair/record.json"),
        JSON.stringify({
          operation: "11111111-1111-4111-8111-111111111111",
          complete,
          trust: "retained",
        }),
      );
      await writeFile(
        join(stateDir, "flows/tls-repair/candidate.json"),
        JSON.stringify({ caKeyPem: "other venue's private key" }),
      );
      await stageResetRequest(stateDir, operationId);

      expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);

      expect(existsSync(join(stateDir, "flows/tls-repair"))).toBe(false);
      expect(await readdir(tls)).toEqual([]);
      expect(existsSync(join(stateDir, "secrets.env"))).toBe(false);
      expect(existsSync(join(stateDir, "backup.env"))).toBe(false);
      // A setup start can mint a fresh set: nothing of the old one is left to refuse it.
      await ensureBoxSecrets({
        stateDir,
        hostnames: ["waitron.local"],
        now: () => new Date(),
        listIpv4: () => [],
      });
      expect((await readdir(tls)).sort()).toEqual(["ca.crt", "ca.key", "server.pem"]);
      expect(await readFile(join(tls, "ca.crt"), "utf8")).not.toBe("ca");
    },
  );

  it.each([
    [true, false],
    [false, true],
  ])(
    "a staged reset of a box that joined removes the other venue's backup settings (joined: %s, kept: %s)",
    async (joined, kept) => {
      const { stateDir, venueDir, operationId } = await halfAdoptedBox(joined);
      await stageResetRequest(stateDir, operationId);

      expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);

      expect(existsSync(join(stateDir, "backup.env"))).toBe(kept);
    },
  );

  it("a staged reset of a box that joined, cut short before the key ring went, leaves nothing of the other venue when it runs again", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox(true);
    const tls = join(stateDir, "tls");
    await writeFile(join(tls, "ca.key"), "ca.key");
    await stageResetRequest(stateDir, operationId);
    watchRemovals(join(stateDir, "secrets.env"));
    const { log, events } = capturingLog();

    await expect(runStagedReset({ stateDir, venueDir, log })).rejects.toThrow("power lost");
    expect(await runStagedReset({ stateDir, venueDir, log })).toBe(true);

    expect(events.map(([, event]) => event)).toEqual(["setup.reset_done"]);
    expect(existsSync(join(stateDir, "secrets.env"))).toBe(false);
    expect(await readdir(tls)).toEqual([]);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(false);
  });

  it("a staged reset of a box that joined removes its joined record after everything else in tls, and its request last", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox(true);
    const tls = join(stateDir, "tls");
    for (const name of ["ca.key", "server.pem"]) {
      await writeFile(join(tls, name), name);
    }
    await stageResetRequest(stateDir, operationId);
    const removed = watchRemovals();

    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);

    const joinedAt = removed.indexOf(join(tls, "joined.json"));
    const others = ["ca.crt", "ca.key", "server.pem"].map((name) =>
      removed.indexOf(join(tls, name)),
    );
    others.push(removed.indexOf(join(stateDir, "flows/tls-repair")));
    for (const at of [...others, removed.indexOf(join(stateDir, "secrets.env"))]) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(joinedAt);
    }
    expect(removed.at(-1)).toBe(join(stateDir, "reset-request.json"));
  });

  it("lets the real adopt run to completion where before the reset it was refused", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox();
    expect(await postAdopt(stateDir)).toBe(409);

    await stageResetRequest(stateDir, operationId);
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);

    // As the next start does before it serves setup.
    await migrate(venueDir);
    const store = await openVenueDatabase(venueDir);
    try {
      let standbyNodeId: string | undefined;
      const adopt = vi.fn<Adopt>((req, hooks) =>
        adoptFromPrimary(
          {
            ownerDb: store.venue,
            ownerNode: store.node,
            ring: loadKeyRing({
              WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
              WAITRON_CREDENTIALS_KEY_VERSION: "1",
            }),
            fetchBundle: async (_url, _credential, standby) => {
              standbyNodeId = standby.nodeId;
              return {
                ...BUNDLE,
                reservedIdentity: {
                  ...BUNDLE.reservedIdentity,
                  endorsement: endorseKey(
                    standby.nodeId,
                    standby.publicKey,
                    PRIMARY_NODE_ID,
                    PRIMARY_KEYS.privateKey,
                  ),
                },
              };
            },
            advertisedOrigin: "https://standby.example",
            spareStorePort: 7443,
            environment: "preproduction",
            persistTrading: async (cfg) => {
              await writeTradingEnv(stateDir, cfg);
            },
            persistModuleConfig: async (config) => {
              await writeModuleConfig(store.venue, config, null);
            },
            persistCredentialsRing: (ring) => writeCredentialsRing(stateDir, ring),
            persistBackupSettings: (settings) => replaceBackupSettings(stateDir, settings),
            stateDir,
            database: venueDir,
            listIpv4: () => [],
            now: () => new Date(),
          },
          req,
          hooks,
        ),
      );

      expect(await postAdopt(stateDir, adopt)).toBe(200);
      expect(await adopt.mock.results[0]?.value).toEqual({
        breakGlassSecret: expect.any(String),
        breakGlassKeyName: expect.stringMatching(/\S/),
      });
      expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
      const trading = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
      expect(trading.WAITRON_NODE_ID).toBe(standbyNodeId);
      expect(trading).not.toHaveProperty(["WAITRON", "LOCATION", "ID"].join("_"));
      const pending = JSON.parse(
        await readFile(join(stateDir, PENDING_ADOPTION_FILE), "utf8"),
      ) as PendingAdoption;
      expect(pending).not.toHaveProperty("locationId");
      expect(pending.standby.nodeId).toBe(standbyNodeId);
      expect(pending.originNodeId).toBe(PRIMARY_NODE_ID);
      expect(await readMirrorLink(store.node, standbyNodeId!)).toMatchObject({
        originNodeId: PRIMARY_NODE_ID,
      });
    } finally {
      await store.close();
    }
  });

  it.each([
    [
      "the marker is malformed",
      "marker_invalid",
      async (box: { stateDir: string }) => {
        await writeFile(join(box.stateDir, "reset-request.json"), "{");
      },
    ],
    [
      "the marker names no operation",
      "marker_invalid",
      async (box: { stateDir: string }) => {
        await writeFile(join(box.stateDir, "reset-request.json"), JSON.stringify({ version: 1 }));
      },
    ],
    [
      "the marker is of another version",
      "marker_invalid",
      async (box: { stateDir: string; operationId: string }) => {
        await writeFile(
          join(box.stateDir, "reset-request.json"),
          JSON.stringify({ version: 2, operationId: box.operationId }),
        );
      },
    ],
    [
      "the box has a trading configuration",
      "trading_configured",
      async (box: { stateDir: string; operationId: string }) => {
        await stageResetRequest(box.stateDir, box.operationId);
        await writeFile(join(box.stateDir, "trading.env"), "WAITRON_NODE_ID=x\n");
      },
    ],
    [
      "the marker names another operation",
      "operation_mismatch",
      async (box: { stateDir: string }) => {
        await stageResetRequest(box.stateDir, "00000000-0000-4000-8000-000000000000");
      },
    ],
    [
      "the adopt has since completed",
      "operation_mismatch",
      async (box: { stateDir: string; operationId: string }) => {
        const path = join(box.stateDir, "flows/setup/operation.json");
        const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ ...record, phase: "complete" }));
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the record is another kind of operation",
      "operation_mismatch",
      async (box: { stateDir: string; operationId: string }) => {
        const path = join(box.stateDir, "flows/setup/operation.json");
        const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ ...record, kind: "provision" }));
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the record cannot be read",
      "operation_mismatch",
      async (box: { stateDir: string; operationId: string }) => {
        await mkdir(dirname(join(box.stateDir, "flows/setup/operation.json")), { recursive: true });
        await writeFile(join(box.stateDir, "flows/setup/operation.json"), "{");
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the database holds a tenant",
      "venue_present",
      async (box: { stateDir: string; venueDir: string; operationId: string }) => {
        const store = await openVenueDatabase(box.venueDir);
        try {
          await store.venue
            .insert(tenants)
            .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Waitron SL" });
        } finally {
          await store.close();
        }
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the database holds an operational venue",
      "venue_present",
      async (box: { stateDir: string; venueDir: string; operationId: string }) => {
        const store = await openVenueDatabase(box.venueDir);
        try {
          await store.venue.insert(locations).values({});
          await seedVenueSettings(store.venue, {
            name: "Sala principal",
            invoiceLocales: ["es-ES"],
            operationDescription: "Venta en establecimiento",
          });
          await seedBusinessDay(store.venue, {});
        } finally {
          await store.close();
        }
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
  ])("discards the marker and deletes nothing when %s", async (_label, reason, arrange) => {
    const box = await halfAdoptedBox();
    await arrange(box);
    const before = await snapshot(box.stateDir);
    const { log, events } = capturingLog();

    expect(await runStagedReset({ stateDir: box.stateDir, venueDir: box.venueDir, log })).toBe(
      false,
    );

    expect(await snapshot(box.stateDir)).toEqual(before);
    expect(existsSync(join(box.stateDir, "reset-request.json"))).toBe(false);
    expect(events).toContainEqual(["warn", "setup.reset_discarded", { reason }]);
  });

  it("counts a database it cannot read as holding a venue", async () => {
    const box = await halfAdoptedBox();
    await rm(join(box.venueDir, "venue.db"));
    await writeFile(join(box.venueDir, "venue.db"), "not a database");
    await stageResetRequest(box.stateDir, box.operationId);
    const before = await snapshot(box.stateDir);
    const { log, events } = capturingLog();

    expect(await runStagedReset({ stateDir: box.stateDir, venueDir: box.venueDir, log })).toBe(
      false,
    );

    expect(await snapshot(box.stateDir)).toEqual(before);
    expect(events).toContainEqual(["warn", "setup.reset_discarded", { reason: "venue_present" }]);
  });

  it("rethrows a marker it cannot read, having taken no lock", async () => {
    const { stateDir, venueDir } = await halfAdoptedBox();
    await mkdir(join(stateDir, "reset-request.json"));
    const lock = vi.fn();
    await expect(runStagedReset({ stateDir, venueDir, log: () => {} }, lock)).rejects.toMatchObject(
      { code: "EISDIR" },
    );
    expect(lock).not.toHaveBeenCalled();
  });

  it("keeps the marker and rethrows when another process holds the venue folder", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox();
    await stageResetRequest(stateDir, operationId);
    const before = await snapshot(stateDir);
    const inUse = vi.fn(() =>
      Promise.reject(new AppError("provisioning.database_in_use", { database: venueDir })),
    );

    await expect(
      runStagedReset({ stateDir, venueDir, log: () => {} }, inUse),
    ).rejects.toMatchObject({ code: "provisioning.database_in_use" });

    expect(await snapshot(stateDir)).toEqual(before);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(true);
  });

  it("releases the venue folder however the reset ends", async () => {
    const { stateDir, venueDir } = await halfAdoptedBox();
    await stageResetRequest(stateDir, "00000000-0000-4000-8000-000000000000");
    const release = vi.fn();
    await runStagedReset({ stateDir, venueDir, log: () => {} }, () => Promise.resolve({ release }));
    expect(release).toHaveBeenCalledOnce();
  });

  it("removes the marker last, so a start cut short part-way runs the reset again", async () => {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox();
    await stageResetRequest(stateDir, operationId);
    await rm(join(stateDir, PENDING_ADOPTION_FILE));
    await mkdir(join(stateDir, PENDING_ADOPTION_FILE));

    await expect(runStagedReset({ stateDir, venueDir, log: () => {} })).rejects.toThrow();
    expect(existsSync(join(venueDir, "venue.db"))).toBe(false);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(true);
    expect(existsSync(join(stateDir, "flows/setup/operation.json"))).toBe(true);

    await rm(join(stateDir, PENDING_ADOPTION_FILE), { recursive: true });
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);
    expect(existsSync(join(stateDir, "flows/setup/operation.json"))).toBe(false);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(false);
  });
});

describe("a start after a reset of a box that joined was cut short in tls/", () => {
  /** A joined box with a healthy set, whose staged reset stopped while it emptied `tls/`. */
  async function cutShortInTls(): Promise<{ stateDir: string; venueDir: string }> {
    const { stateDir, venueDir, operationId } = await halfAdoptedBox(true);
    await rm(join(stateDir, "tls"), { recursive: true, force: true });
    await rm(join(stateDir, "secrets.env"));
    await ensureBoxSecrets({
      stateDir,
      hostnames: ["waitron.local", "localhost"],
      now: () => new Date(),
      listIpv4: () => [],
    });
    await markJoined(stateDir, PRIMARY_NODE_ID);
    await stageResetRequest(stateDir, operationId);
    watchRemovals(join(stateDir, "tls", "server.pem"));
    await expect(runStagedReset({ stateDir, venueDir, log: () => {} })).rejects.toThrow(
      "power lost",
    );
    rmMock.mockImplementation(actualRm.current!);
    expect(existsSync(join(stateDir, "tls", "joined.json"))).toBe(true);
    return { stateDir, venueDir };
  }

  async function start(box: { stateDir: string; venueDir: string }) {
    const served: Array<{ bootstrapOnly?: boolean }> = [];
    const reset = vi.fn(runStagedReset);
    await runEntry({
      ...box,
      args: [],
      baseEnv: {
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: "7443",
        WAITRON_HTTP_LANDING_PORT: "0",
      },
      spareBytes: 0,
      freeSpaceFloor: 0,
      readRecoveryState: async () => ({ ...FRESH, level: "normal" }),
      writeRecoveryState: async () => {},
      loadBoxEnv: async (base) => base,
      runStagedRestore: async () => false,
      runStagedReset: reset,
      assertNotAhead: async () => {},
      clearReplacedDatabases: async () => {},
      startServer: async () => {
        throw new Error("past the reset");
      },
      serveRecovery: async (_app, options) => {
        served.push(options);
      },
      installShutdownHandlers: () => {},
      scheduleStayedUp: () => {},
      log: () => {},
      exit: () => {},
    }).catch((error: Error) => {
      if (error.message !== "past the reset") throw error;
    });
    return { served, reset };
  }

  it("finishes the reset instead of asking for connection repair", async () => {
    const box = await cutShortInTls();

    const { served, reset } = await start(box);

    expect(served).toEqual([]);
    expect(await reset.mock.results[0]?.value).toBe(true);
    expect(await readdir(join(box.stateDir, "tls"))).toEqual([]);
    expect(existsSync(join(box.stateDir, "secrets.env"))).toBe(false);
    expect(existsSync(join(box.stateDir, "reset-request.json"))).toBe(false);
  });

  it("still asks for connection repair when no reset is staged", async () => {
    const box = await cutShortInTls();
    await rm(join(box.stateDir, "reset-request.json"));

    const { served, reset } = await start(box);

    expect(served.map((options) => options.bootstrapOnly)).toEqual([true]);
    expect(reset).not.toHaveBeenCalled();
  });

  it("still asks for connection repair on a box that never joined, whose reset keeps tls/", async () => {
    const box = await cutShortInTls();
    await rm(join(box.stateDir, "tls", "joined.json"));

    const { served, reset } = await start(box);

    expect(served.map((options) => options.bootstrapOnly)).toEqual([true]);
    expect(reset).not.toHaveBeenCalled();
  });

  it("still asks for connection repair when the box holds trading settings", async () => {
    const box = await cutShortInTls();
    await writeFile(join(box.stateDir, "trading.env"), "T=1\n");

    const { served } = await start(box);

    expect(served.map((options) => options.bootstrapOnly)).toEqual([true]);
  });

  it("still asks for connection repair when the staged reset names another operation", async () => {
    const box = await cutShortInTls();
    await stageResetRequest(box.stateDir, "00000000-0000-4000-8000-000000000000");

    const { served, reset } = await start(box);

    expect(served.map((options) => options.bootstrapOnly)).toEqual([true]);
    expect(reset).not.toHaveBeenCalled();
  });
});
