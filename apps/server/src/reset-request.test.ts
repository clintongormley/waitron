import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  locations,
  openVenueDatabase,
  readDeploymentEnvironment,
  readMirrorConfig,
  setDeploymentMode,
  stampDeployment,
  tenants,
  writeMirrorConfig,
} from "@waitron/db";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { adoptFromPrimary, type AdoptHooks, type AdoptRequest } from "./adopt.js";
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

const NODE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_NODE_ID = "22222222-2222-4222-8222-222222222222";
const ADOPT_BODY = JSON.stringify({
  primaryUrl: "https://primary.example",
  credential: { personId: "88888888-8888-8888-8888-888888888888", password: "a-password" },
});

const BUNDLE: MirrorBundle = {
  designated: {
    locationId: "33333333-3333-4333-8333-333333333333",
    tillId: "44444444-4444-4444-8444-444444444444",
    nodeId: PRIMARY_NODE_ID,
    seriesId: "55555555-5555-4555-8555-555555555555",
  },
  tenant: { country: "ES", taxId: "80000001K" },
  primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
  environment: "preproduction",
  boxHostname: "waitron.local",
  boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
  relayUrl: "https://relay.example/",
  accountKey: Buffer.alloc(32, 9).toString("base64"),
  reservedIdentity: {
    modules: {
      "fiscal-verifactu": { nif: "90000001K", idSistemaInformatico: "WS", numeroInstalacion: 7 },
    },
    series: [{ code: "SA-7", purpose: "standard" }],
    endorsement: {
      nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      publicKey: "STANDBY_PUB",
      endorsedBy: PRIMARY_NODE_ID,
      signature: "SIG",
    },
  },
  moduleOverrides: {},
};

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const migrate = (venueDir: string) =>
  applyMigrations(venueDir, migrationOptionsFor(manifestSets(), null));

/** A box whose adopt wrote its rows and files and then stopped, as `adoptFromPrimary` leaves it. */
async function halfAdoptedBox(): Promise<{
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
    await setDeploymentMode(store.venue, NODE_ID, "mirror");
    await writeMirrorConfig(store.venue, NODE_ID, {
      relayUrl: "https://relay.example",
      boxHostname: "waitron.local",
      boxCaPem: "pem",
      originNodeId: PRIMARY_NODE_ID,
    });
    await mintBreakGlassSecret(store.venue, NODE_ID);
  } finally {
    await store.close();
  }
  await mkdir(join(venueDir, ".venue.db-litestream"));
  await writeFile(join(venueDir, ".venue.db-litestream", "generation"), "g");
  await writeFile(join(stateDir, "modules.json"), "{}");
  await writeFile(join(stateDir, PENDING_ADOPTION_FILE), "{}");
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "ca");
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
    "modules.json",
    PENDING_ADOPTION_FILE,
    "setup-operation.json",
    "trading.env",
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
      "modules.json",
      PENDING_ADOPTION_FILE,
      "setup-operation.json",
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
      expect(await readMirrorConfig(store.venue, NODE_ID)).toBeNull();
      const roles = await store.venue.execute<{ n: number }>(
        sql`select count(*) as n from node_roles`,
      );
      expect(roles.rows[0]?.n).toBe(0);
    } finally {
      await store.close();
    }
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
            fetchBundle: async (_url, _credential, standby) => {
              standbyNodeId = standby.nodeId;
              return BUNDLE;
            },
            advertisedOrigin: "https://standby.example",
            environment: "preproduction",
            persistTrading: async (cfg) => {
              await writeTradingEnv(stateDir, cfg);
            },
            persistModuleConfig: async (config) => {
              await writeModuleConfig(stateDir, config);
            },
            stateDir,
            database: venueDir,
          },
          req,
          hooks,
        ),
      );

      expect(await postAdopt(stateDir, adopt)).toBe(200);
      expect(await adopt.mock.results[0]?.value).toEqual({ breakGlassSecret: expect.any(String) });
      expect((await createSetupOperationStore(stateDir).read())?.phase).toBe("complete");
      const trading = parseEnvFile(await readFile(join(stateDir, "trading.env"), "utf8"));
      expect(trading.WAITRON_TILL_NODE_ID).toBe(standbyNodeId);
      expect(trading.WAITRON_TILL_LOCATION_ID).toBe(BUNDLE.designated.locationId);
      const pending = JSON.parse(
        await readFile(join(stateDir, PENDING_ADOPTION_FILE), "utf8"),
      ) as PendingAdoption;
      expect(pending.standby.nodeId).toBe(standbyNodeId);
      expect(pending.originNodeId).toBe(PRIMARY_NODE_ID);
      expect(await readMirrorConfig(store.venue, standbyNodeId!)).toMatchObject({
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
        await writeFile(join(box.stateDir, "trading.env"), "WAITRON_TILL_NODE_ID=x\n");
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
        const path = join(box.stateDir, "setup-operation.json");
        const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        await writeFile(path, JSON.stringify({ ...record, phase: "complete" }));
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the record is another kind of operation",
      "operation_mismatch",
      async (box: { stateDir: string; operationId: string }) => {
        const path = join(box.stateDir, "setup-operation.json");
        const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        await writeFile(path, JSON.stringify({ ...record, kind: "provision" }));
        await stageResetRequest(box.stateDir, box.operationId);
      },
    ],
    [
      "the record cannot be read",
      "operation_mismatch",
      async (box: { stateDir: string; operationId: string }) => {
        await writeFile(join(box.stateDir, "setup-operation.json"), "{");
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
          await store.venue.insert(locations).values({
            name: "Sala principal",
            invoiceLocales: ["es-ES"],
            operationDescription: "Venta en establecimiento",
          });
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
    // A folder where `modules.json` should be makes its removal fail after the databases went.
    await rm(join(stateDir, "modules.json"));
    await mkdir(join(stateDir, "modules.json"));

    await expect(runStagedReset({ stateDir, venueDir, log: () => {} })).rejects.toThrow();
    expect(existsSync(join(venueDir, "venue.db"))).toBe(false);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(true);
    expect(existsSync(join(stateDir, "setup-operation.json"))).toBe(true);

    await rm(join(stateDir, "modules.json"), { recursive: true });
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);
    expect(existsSync(join(stateDir, "setup-operation.json"))).toBe(false);
    expect(existsSync(join(stateDir, "reset-request.json"))).toBe(false);
  });
});
