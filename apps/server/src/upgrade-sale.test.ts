import { FISCAL_SLOT, VerifactuBackend } from "@waitron/fiscal-verifactu";
import * as hourRelease from "@waitron/fiscal-verifactu/src/hour-release.js";
import {
  runningIdentity,
  softwareVersion,
} from "@waitron/fiscal-verifactu/src/software-identity.js";
import { seedNamedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { seedModuleSettings } from "../test/module-settings.js";
import { access, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, ne, sql } from "drizzle-orm";
import {
  nodes,
  openVenueDatabase,
  readTaxpayer,
  sales,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  type Transaction,
} from "@waitron/db";
import { nodeId, saleId } from "@waitron/shared";
import { writeContentLanguages } from "@waitron/menu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { provisionOrderVenue, billlessSale, type OrderVenue } from "./testing/order-venue.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { retainHttpListener } from "./testing/retained-http-listener.js";
import { adoptRetainedListeners } from "./testing/retained-http-adoption.mjs";
import { TEST_PRODUCER, useTestProducer } from "./testing/test-producer.js";
import { applyVenueUnderInstallation } from "./testing/bill-venue.js";
import {
  acceptFiledRecords,
  filedRecordOf,
  renameFixtureInstallation,
} from "./testing/fiscal-fixtures.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { loadConfig } from "./config.js";
import { systemClock } from "./till-backend.js";
import { checkUpgradeSale } from "./upgrade-sale.js";
import * as upgradeChecks from "./upgrade-checks.js";

type RecordSale = VerifactuBackend["recordSale"];

let venue: OrderVenue;
const source = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    venue = await provisionOrderVenue(db);
    await billlessSale(venue);
    await withTransaction(db, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["fr", "en", "es"] }),
    );
  },
});
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "waitron-upgrade-sale-"));
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture(
  synchronised = true,
  earlierSales = 1,
  regime = "verifactu",
  from: { db: typeof source; nodeId: string; env?: Record<string, string> } = {
    db: source,
    nodeId: venue.cfg.nodeId,
  },
) {
  const state = await mkdtemp(join(root, "copy-"));
  await mkdir(join(state, "venue"));
  await from.db.db.archiveTo(join(state, "venue", "venue.db"));
  await from.db.node.archiveTo(join(state, "venue", "node.db"));
  const copy = await openVenueDatabase(join(state, "venue"));
  try {
    for (let made = 1; made < earlierSales; made += 1)
      await billlessSale({ ...venue, db: copy.venue });
    if (regime === "none")
      await copy.venue
        .update(nodes)
        .set({ filingModule: regime })
        .where(eq(nodes.id, venue.cfg.nodeId));
  } finally {
    await copy.close();
  }
  await copyMigrationsRoot(join(state, "migrations"));
  await seedModuleSettings(join(state, "venue"), {
    [regime === "none" ? "fiscal-verifactu" : "fiscal-none"]: false,
  });
  const tls = mintMtlsMaterial();
  await writeFile(join(state, "cert.pem"), tls.serverCertPem);
  await writeFile(join(state, "key.pem"), tls.serverKeyPem);
  const socketPath = join(state, "clock.sock");
  const clock = createServer((socket) =>
    socket.on("data", () =>
      socket.end(
        JSON.stringify({
          ok: true,
          service: "on",
          unit: "chrony.service",
          synchronised,
          lastSyncAt: null,
        }) + "\n",
      ),
    ),
  );
  await new Promise<void>((done) => clock.listen(socketPath, done));
  const held = await retainHttpListener();
  const adoption = adoptRetainedListeners([held]);
  const env = {
    ...TEST_PRODUCER,
    WAITRON_ENV: "preproduction",
    WAITRON_STATE_DIR: state,
    WAITRON_NODE_ID: from.nodeId,
    WAITRON_MIGRATIONS_DIR: join(state, "migrations"),
    WAITRON_HTTP_PORT: String(held.port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_TLS_CERT_FILE: join(state, "cert.pem"),
    WAITRON_TLS_KEY_FILE: join(state, "key.pem"),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    ...from.env,
  };
  return {
    env,
    socketPath,
    config: loadConfig(env, env.WAITRON_MIGRATIONS_DIR, state),
    close: async () => {
      adoption.restore();
      await new Promise<void>((done) => clock.close(() => done()));
      if (held.server.listening) await held.close();
    },
  };
}

it("enrols a real till and records a primary cash sale on the copy, continuing its fiscal chain", async () => {
  const f = await fixture();
  try {
    const result = await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath });
    expect(result).toMatchObject({ total: "1.00", fiscalBackend: "verifactu", fiscalRecords: 2 });
    expect(result.saleId).toMatch(/^[0-9a-f-]{36}$/);
    const copy = await openVenueDatabase(f.config.venueDir);
    try {
      expect(
        copy.venue.all(
          sql`select operation_description from departments where name like 'Upgrade check %'`,
        ),
      ).toEqual([
        { operation_description: FISCAL_SLOT.venueFields!.defaults!.operationDescription! },
      ]);
      expect(
        copy.venue.all(
          sql`select descripcion_operacion as description from verifactu_records order by secuencia desc limit 1`,
        ),
      ).toEqual([{ description: FISCAL_SLOT.venueFields!.defaults!.operationDescription! }]);
    } finally {
      await copy.close();
    }
    expect(source.db.all(sql`select count(*) as total from sales`)).toEqual([{ total: 1 }]);
    expect(
      await withTransaction(source.db, (tx) => venue.backend.checkIntegrity(tx, venue.cfg.nodeId)),
    ).toMatchObject({ ok: true, checked: 1 });
  } finally {
    await f.close();
  }
});

it("fails the upgrade when the host has not confirmed this start's clock", async () => {
  const f = await fixture(false);
  try {
    await expect(checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath })).rejects.toThrow(
      "clock.unconfirmed",
    );
  } finally {
    await f.close();
  }
});

it("refuses a sale when the data check reports no additional fiscal record", async () => {
  const f = await fixture();
  const original = upgradeChecks.checkUpgradeData;
  const reader = vi.spyOn(upgradeChecks, "checkUpgradeData").mockImplementation(async (...args) => {
    const report = await original(...args);
    return report.mode === "trading" ? { ...report, fiscalRecords: 1 } : report;
  });
  try {
    await expect(checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath })).rejects.toThrow(
      "Upgrade sale was not persisted with its fiscal history",
    );
  } finally {
    reader.mockRestore();
    await f.close();
  }
});

it.each([2, 3])("upgrades a box whose chain already holds %i records", async (earlier) => {
  const f = await fixture(true, earlier);
  try {
    const result = await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath });
    expect(result).toEqual({
      saleId: expect.any(String),
      total: "1.00",
      fiscalBackend: "verifactu",
      fiscalRecords: earlier + 1,
    });
    const copy = await openVenueDatabase(f.config.venueDir);
    try {
      expect(
        copy.venue.all(
          sql`select sale_id, count(*) over () as total from verifactu_records
            order by rowid desc limit 1`,
        ),
      ).toEqual([{ sale_id: result.saleId, total: earlier + 1 }]);
    } finally {
      await copy.close();
    }
  } finally {
    await f.close();
  }
});

it("upgrades a venue with no fiscal regime, whose sale leaves no record", async () => {
  const f = await fixture(true, 1, "none");
  try {
    const result = await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath });
    expect(result).toEqual({
      saleId: expect.any(String),
      total: "1.00",
      fiscalBackend: "none",
      fiscalRecords: 0,
    });
    const copy = await openVenueDatabase(f.config.venueDir);
    try {
      expect(
        copy.venue.all(
          sql`select total, fiscal_backend as backend,
              (select count(*) from verifactu_records) as records
            from sales where id = ${result.saleId}`,
        ),
      ).toEqual([{ total: 100, backend: "none", records: 1 }]);
    } finally {
      await copy.close();
    }
  } finally {
    await f.close();
  }
});

async function asEarlierSale(tx: Transaction, sale: Parameters<RecordSale>[1]) {
  const [earlier] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(ne(sales.id, sale.saleId))
    .limit(1);
  return { ...sale, saleId: saleId(earlier!.id) };
}

const faults: [string, (original: RecordSale) => RecordSale][] = [
  [
    "leaves no record",
    () => async (_tx, sale) => ({
      backend: "verifactu",
      recordId: sale.saleId,
      state: "recorded",
      issuedAt: sale.issuedAt,
      offsetMinutes: sale.offsetMinutes,
      verificationUrl: undefined,
    }),
  ],
  [
    "is recorded against an earlier sale",
    (original) =>
      async function (this: VerifactuBackend, tx, sale, filing) {
        return original.call(this, tx, await asEarlierSale(tx, sale), filing);
      },
  ],
  [
    "is recorded on another box while an earlier sale is recorded here",
    (original) =>
      async function (this: VerifactuBackend, tx, sale, filing) {
        const [row] = await tx.insert(nodes).values({ name: "Other box" }).returning();
        const otherNode = nodeId(row!.id);
        await seedNamedFixtureSif(tx, {
          nodeId: otherNode,
          taxpayerNif: (await readTaxpayer(tx))!.taxId,
          softwareId: "WT",
          installationIdentity: "1",
        });
        await original.call(this, tx, await asEarlierSale(tx, sale), filing);
        const elsewhere = { ...sale, nodeId: otherNode, seriesCode: "OTHER" };
        return original.call(this, tx, elsewhere, filing);
      },
  ],
  [
    "is recorded but its row says it was not",
    (original) =>
      async function (this: VerifactuBackend, tx, sale, filing) {
        const guards = tx.all<{ name: string; sql: string }>(
          sql`select name, sql from sqlite_master
            where type = 'trigger' and tbl_name = 'sales' and sql like '%BEFORE UPDATE%'`,
        );
        for (const guard of guards) tx.run(sql`drop trigger ${sql.identifier(guard.name)}`);
        await tx
          .update(sales)
          .set({ fiscalState: "not_applicable" })
          .where(eq(sales.id, sale.saleId));
        for (const guard of guards) tx.run(sql.raw(guard.sql));
        return original.call(this, tx, sale, filing);
      },
  ],
];

function recordSalesWith(replace: (original: RecordSale) => RecordSale) {
  const original = VerifactuBackend.prototype.recordSale;
  return vi.spyOn(VerifactuBackend.prototype, "recordSale").mockImplementation(replace(original));
}

it.each(faults)("refuses a sale that %s on a chain of two records", async (_fault, withFault) => {
  const f = await fixture(true, 2);
  const recorder = recordSalesWith(withFault);
  try {
    await expect(checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath })).rejects.toThrow(
      "Upgrade sale was not persisted with its fiscal history",
    );
    expect(recorder).toHaveBeenCalledOnce();
  } finally {
    recorder.mockRestore();
    await f.close();
  }
});

it("accepts a sale recorded just after another record joined the chain", async () => {
  const f = await fixture(true, 2);
  const recorder = recordSalesWith(
    (original) =>
      async function (this: VerifactuBackend, tx, sale, filing) {
        const waiting = { ...(await asEarlierSale(tx, sale)), seriesCode: "OTHER" };
        await original.call(this, tx, waiting, filing);
        return original.call(this, tx, sale, filing);
      },
  );
  try {
    expect(await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath })).toEqual({
      saleId: expect.any(String),
      total: "1.00",
      fiscalBackend: "verifactu",
      fiscalRecords: 4,
    });
    expect(recorder).toHaveBeenCalledOnce();
  } finally {
    recorder.mockRestore();
    await f.close();
  }
});

describe("a production copy whose record another producer filed", () => {
  useTestProducer();
  const PRODUCER = "11111111H";
  const INSTALLATION = "0CNN8";
  let changing: OrderVenue;
  const earlier = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    resetPerTest: false,
    setup: async (db) => {
      changing = await provisionOrderVenue(db, {
        apply: applyVenueUnderInstallation(INSTALLATION),
      });
      const { nodeId } = changing.cfg;
      renameFixtureInstallation(db, INSTALLATION);
      await writeNodeMembership(db, signedMembershipDoc(0, { signerNodeId: nodeId }));
      await stampDeployment(db, "production");
      const backend = new VerifactuBackend({
        identity: runningIdentity("production"),
        clock: systemClock(),
        db,
        environment: "production",
        deploymentEnvironment: "production",
      });
      for (let sale = 0; sale < 2; sale++) await billlessSale({ ...changing, backend });
      // A production start with a record to file and no certificate answers /health 503.
      acceptFiledRecords(db);
    },
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("opens the installation the copy's note names, and its sale starts the new chain", async () => {
    // A run from source carries no release date, and opens nothing.
    vi.spyOn(hourRelease, "readHourRelease").mockReturnValue({
      sourceCommit: "0000000000000000000000000000000000000000",
      committedAt: "2026-10-15T00:00:00Z",
      generator: "minute",
      generatorSha256: "",
      instantMs: Date.parse("2026-10-15T00:00:00Z"),
    });
    // The backend reads its producer from the process's environment.
    vi.stubEnv("WAITRON_PRODUCER_TAX_ID", PRODUCER);
    const f = await fixture(true, 1, "verifactu", {
      db: earlier,
      nodeId: changing.cfg.nodeId,
      env: {
        WAITRON_ENV: "production",
        WAITRON_PRODUCER_TAX_ID: PRODUCER,
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
      },
    });
    const note = join(f.env.WAITRON_STATE_DIR, "identity-change.json");
    try {
      await writeFile(
        note,
        JSON.stringify({
          version: 1,
          release: softwareVersion(),
          producerTaxId: PRODUCER,
          fromProducerTaxId: TEST_PRODUCER.WAITRON_PRODUCER_TAX_ID,
        }),
      );
      const result = await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath });
      expect(result).toMatchObject({ total: "1.00", fiscalBackend: "verifactu", fiscalRecords: 3 });
      const copy = await openVenueDatabase(f.config.venueDir);
      try {
        const [sale] = copy.venue.all<{ order: string }>(
          sql`select working_order_id as "order" from sales where id = ${result.saleId}`,
        );
        const record = filedRecordOf(copy.venue, sale!.order);
        expect(record).toEqual({
          first: 1,
          producer: PRODUCER,
          installation: expect.stringMatching(/^[0-9A-Z]{5}$/),
        });
        expect(record.installation).not.toBe(INSTALLATION);
      } finally {
        await copy.close();
      }
      await expect(access(note)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await f.close();
    }
  });
});
