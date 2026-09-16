import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureError, createPgliteDb, runMigrations, withTransaction } from "@waitron/db";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
import { ID_SISTEMA_MAX_LENGTH, currentSif, registerSif } from "./registro-sif.js";

let db: Awaited<ReturnType<typeof createPgliteDb>>;

const NODE: ProvisionedNode = {
  locationId: brandLocationId(TENANT_A.locationId),
  nodeId: TENANT_A.nodeId,
};
const NODE_2: ProvisionedNode = { ...NODE, nodeId: TENANT_A.nodeId2 };

const seed = FISCAL_PROVISIONING.seed!;
const standby = FISCAL_PROVISIONING.standby!;

// A fresh database per test, for the reason registro-sif.test.ts's own beforeEach gives: the
// installation-number counter is monotonic and never resets, so a shared database would make every
// assertion about a specific number depend on execution order.
beforeEach(async () => {
  db = await createPgliteDb();
  for (const migrations of TEST_MIGRATIONS) await runMigrations(db, migrations);
  await seedTenants(db);
});

afterEach(async () => {
  if (db !== undefined) await db.close();
});

describe("WAITRON_ID_SISTEMA", () => {
  it("is a product code within the bound registerSif enforces", () => {
    // The product constant the deleted provisioning-side case pinned. AEAT's `IDSistemaInformatico`
    // is at most `ID_SISTEMA_MAX_LENGTH` characters, and the value is stamped into every SIF row a
    // seed writes — an out-of-bound constant would be refused at provision, not at review.
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
    // The NIF every registro is filed under comes from the one taxpayer row, never from an
    // argument. Nothing in the schema holds that row in place any more — the foreign keys onto
    // `tenants` went with the tenant columns — so an empty table is reachable by a corrupt or
    // half-provisioned database, and minting a SIF under a guessed NIF is unrepairable
    // (CLAUDE.md §5). It must fail, and as a plain `Error`: no operator action fixes it.
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
    await db.execute(sql`
      insert into invoice_series (node_id, code, purpose) values (${TENANT_A.nodeId}, 'FA', 'standard'),
        ( ${TENANT_A.nodeId}, 'RF', 'rectificative')`);
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
    await db.execute(sql`
      insert into invoice_series (node_id, code, purpose, retired_at) values (${TENANT_A.nodeId}, 'FA', 'standard', now()),
        ( ${TENANT_A.nodeId}, ${`FA-${primarySif.numeroInstalacion}`}, 'standard', null),
        ( ${TENANT_A.nodeId}, ${`RE-${primarySif.numeroInstalacion}`}, 'rectificative', null)
    `);
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
    // The column carries no CHECK, so `establish` is the second write path that must apply
    // `registerSif`'s own length bound — a 3-character id would otherwise land in the field the
    // guard exists to protect.
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
