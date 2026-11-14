import { seedModuleSettings } from "../test/module-settings.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import { writeContentLanguages } from "@waitron/catalogue";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { provisionOrderVenue, billlessSale, type OrderVenue } from "./testing/order-venue.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePort } from "./testing/free-ports.js";
import { TEST_PRODUCER } from "./testing/test-producer.js";
import { loadConfig } from "./config.js";
import { checkUpgradeSale } from "./upgrade-sale.js";
import * as upgradeChecks from "./upgrade-checks.js";

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

async function fixture(synchronised = true) {
  const state = await mkdtemp(join(root, "copy-"));
  await mkdir(join(state, "venue"));
  await source.db.archiveTo(join(state, "venue", "venue.db"));
  await source.node.archiveTo(join(state, "venue", "node.db"));
  await copyMigrationsRoot(join(state, "migrations"));
  await seedModuleSettings(join(state, "venue"), { "fiscal-none": false });
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
  const env = {
    ...TEST_PRODUCER,
    WAITRON_ENV: "preproduction",
    WAITRON_STATE_DIR: state,
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: join(state, "migrations"),
    WAITRON_HTTP_PORT: String(await freePort()),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_TLS_CERT_FILE: join(state, "cert.pem"),
    WAITRON_TLS_KEY_FILE: join(state, "key.pem"),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  };
  return {
    env,
    socketPath,
    config: loadConfig(env, env.WAITRON_MIGRATIONS_DIR, state),
    close: () => new Promise<void>((done) => clock.close(() => done())),
  };
}

it("enrols a real till and records a primary cash sale on the copy, continuing its fiscal chain", async () => {
  const f = await fixture();
  try {
    const result = await checkUpgradeSale(f.config, f.env, { socketPath: f.socketPath });
    expect(result).toMatchObject({ total: "1.00", fiscalBackend: "verifactu", fiscalRecords: 2 });
    expect(result.saleId).toMatch(/^[0-9a-f-]{36}$/);
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

it("refuses a sale when the integrity reader reports no additional fiscal record", async () => {
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
