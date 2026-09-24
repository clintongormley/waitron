import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { captureError, invoiceSeries, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
import { ID_SISTEMA_MAX_LENGTH, currentSif, registerSif } from "./registro-sif.js";

// The installation-number counter never resets, so each case relies on the helper's per-test reset
// to start from an empty `contadores_instalacion`.
const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 60_000 });

let db: Database;

const NODE: ProvisionedNode = {
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const NODE_2: ProvisionedNode = { ...NODE, nodeId: TENANT_A.nodeId2 };

const seed = FISCAL_PROVISIONING.seed!;
const standby = FISCAL_PROVISIONING.standby!;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTenants(db);
});

describe("WAITRON_ID_SISTEMA", () => {
  it("is a product code within the bound registerSif enforces", () => {
    expect(WAITRON_ID_SISTEMA.length).toBeGreaterThan(0);
    expect(WAITRON_ID_SISTEMA.length).toBeLessThanOrEqual(ID_SISTEMA_MAX_LENGTH);
  });
});

describe("FISCAL_PROVISIONING.seed", () => {
  it("names its effect for the operator's plan", () => {
    expect(seed.summary).toMatch(/SIF/);
  });

  it("registers the node as a SIF under the taxpayer's own tax id and the product's software id", async () => {
    const report = await withTransaction(db, (tx) => seed.run(tx, NODE));
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(sif.nif).toBe("89890001K"); // seedTenants' tax_id for TENANT_A, never an argument
    expect(sif.idSistemaInformatico).toBe(WAITRON_ID_SISTEMA);
    expect(sif.numeroInstalacion).toBe(1);
    expect(report).toContain(sif.id);
    expect(report).toContain("installation 1");
  });

  it("refuses to seed a database with no taxpayer row, loudly and without a domain code", async () => {
    // Minting a SIF under a guessed NIF is unrepairable; no operator action fixes an empty table.
    await db.execute(sql`delete from tenants`);
    const error = await captureError(() => withTransaction(db, (tx) => seed.run(tx, NODE)));
    expect(isAppError(error)).toBe(false);
    expect((error as Error).message).toContain("tenants is empty");
  });

  it("re-seeding an existing node mints a fresh installation number and a new chain", async () => {
    await withTransaction(db, (tx) => seed.run(tx, NODE));
    await withTransaction(db, (tx) => seed.run(tx, NODE));
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(sif.numeroInstalacion).toBe(2);
    const head = await db.execute<{ h: string | null }>(
      sql`select ultima_huella as h from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head.rows[0]?.h).toBeNull();
  });
});

describe("FISCAL_PROVISIONING.standby", () => {
  beforeEach(async () => {
    // The primary must hold a live SIF and its series before it can reserve for a standby.
    await withTransaction(db, (tx) => seed.run(tx, NODE));
    await db.insert(invoiceSeries).values([
      { nodeId: TENANT_A.nodeId, code: "FA", purpose: "standard" },
      { nodeId: TENANT_A.nodeId, code: "RF", purpose: "rectificative" },
    ]);
  });

  it("reserve derives from the primary's LIVE series bases: a restored primary's `FA-<n>` gives the standby `FA-<m>`, not `FA-<n>-<m>`", async () => {
    await db.execute(sql`delete from invoice_series where node_id = ${TENANT_A.nodeId}`);
    const primarySif = await withTransaction(db, (tx) =>
      registerSif(tx, {
        nodeId: TENANT_A.nodeId,
        nif: "89890001K",
        idSistemaInformatico: WAITRON_ID_SISTEMA,
      }),
    );
    // What a restored primary holds: `FA` retired, `FA-<its installation number>` and `RE-<n>` live.
    await db.insert(invoiceSeries).values([
      { nodeId: TENANT_A.nodeId, code: "FA", purpose: "standard", retiredAt: new Date() },
      {
        nodeId: TENANT_A.nodeId,
        code: `FA-${primarySif.numeroInstalacion}`,
        purpose: "standard",
        retiredAt: null,
      },
      {
        nodeId: TENANT_A.nodeId,
        code: `RE-${primarySif.numeroInstalacion}`,
        purpose: "rectificative",
        retiredAt: null,
      },
    ]);
    const reservation = await withTransaction(db, (tx) => standby.reserve(tx, NODE));
    const m = (reservation.state as { numeroInstalacion: number }).numeroInstalacion;
    expect(reservation.series).toEqual([
      { code: `FA-${m}`, purpose: "standard" },
      { code: `RE-${m}`, purpose: "rectificative" },
    ]);
  });

  it("reserves a fresh number and derives disjoint series codes from the primary's", async () => {
    const r = await withTransaction(db, (tx) => standby.reserve(tx, NODE));
    expect(r.state).toEqual({ nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 2 });
    expect(r.series?.map((s) => s.code).sort()).toEqual(["FA-2", "RF-2"]);
    expect(r.series?.find((s) => s.code === "RF-2")?.purpose).toBe("rectificative");
  });

  it("establishes the reserved SIF on the standby's own node with the reserved number", async () => {
    const r = await withTransaction(db, (tx) => standby.reserve(tx, NODE));
    await withTransaction(db, (tx) => standby.establish(tx, NODE_2, r.state));
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId2));
    expect(sif.numeroInstalacion).toBe(2);
    expect(sif.nif).toBe("89890001K");
  });

  it.each([
    ["absent", undefined],
    ["not an object", "W1/2"],
    ["missing the nif", { idSistemaInformatico: "W1", numeroInstalacion: 2 }],
    ["an empty software id", { nif: "89890001K", idSistemaInformatico: "", numeroInstalacion: 2 }],
    // The column carries no CHECK, so `establish` must apply `registerSif`'s length bound itself.
    [
      "a software id over two characters",
      { nif: "89890001K", idSistemaInformatico: "WTX", numeroInstalacion: 2 },
    ],
    ["missing the number", { nif: "89890001K", idSistemaInformatico: "W1" }],
    [
      "a non-positive number",
      { nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 0 },
    ],
    [
      "a fractional number",
      { nif: "89890001K", idSistemaInformatico: "W1", numeroInstalacion: 1.5 },
    ],
  ])("refuses a reservation state that is %s, writing nothing", async (_label, state) => {
    const err = await withTransaction(db, (tx) => standby.establish(tx, NODE_2, state)).catch(
      (e: unknown) => e,
    );
    expect(isAppError(err) && err.code).toBe("sif.reservation_invalid");
    const rows = await db.execute(
      sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId2}`,
    );
    expect(rows.rows).toEqual([]);
  });
});
