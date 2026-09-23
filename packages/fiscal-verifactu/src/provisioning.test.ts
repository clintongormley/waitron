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

// ONE database for the suite, emptied by the helper after every test.
//
// The requirement this replaces is unchanged and still stated where it was: the installation-number
// counter is monotonic and never resets, so every case below must start from an empty one or its
// assertion about a specific number depends on execution order. What meets it now is the helper's
// per-test reset rather than a brand-new database — the counter is an ordinary data table
// (`contadores_instalacion`, ./schema/sif.ts) and the reset deletes every data table
// (packages/db/src/testing/venue-db.ts's `buildResetPlan`).
//
// Control run, because "the reset is what makes this pass" is otherwise unchecked. Command:
// `pnpm --filter @waitron/fiscal-verifactu exec vitest run src/provisioning.test.ts`. With the
// reset on: 16 passed. With `resetPerTest: false` added to the options below: 15 failed | 1 passed,
// the first error `UNIQUE constraint failed: locations.id` — the per-test `seedTenants` refuses
// before any case reaches the counter, so what that control shows is the reset, not the counter
// specifically. The counter's own evidence is that this file asserts `numeroInstalacion` 1 in one
// case and 2 in three others, all against one database, and all four pass.
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
    // Through the table definition rather than as raw SQL, for the reason ../test/fixtures.ts
    // records for the same table: `invoice_series.id` is a `$defaultFn` on this engine
    // (packages/db/src/schema/series.ts), which a raw statement never reaches. Measured by running
    // the raw insert this replaces: `NOT NULL constraint failed: invoice_series.id`. The two rows
    // and their values are unchanged.
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
    //
    // Through the table definition for the `id` default the beforeEach above records, and the
    // retired stamp is a `Date` rather than `now()`: measured by running the raw statement this
    // replaces, with an `id` supplied so the previous error could not mask this one —
    // `no such function: now`. Only whether `retired_at` is null is read here; the assertion below
    // is on the series CODES, so the stamp's value reaches nothing.
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
