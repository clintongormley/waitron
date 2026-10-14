import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing, putCredential, tenantCredentials } from "@waitron/credentials";
import {
  captureError,
  deployment,
  invoiceSeries,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import type { ProvisionedNode } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { FISCAL_PROVISIONING, WAITRON_ID_SISTEMA } from "./provisioning.js";
import { ALLOCATED_FISCAL_STANDBY } from "./allocated-standby.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import { fiscalReservations } from "./schema/reservations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { ID_SISTEMA_MAX_LENGTH, currentSif } from "./registro-sif.js";

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
const standby = ALLOCATED_FISCAL_STANDBY;

beforeAll(() => {
  db = suite.db;
});

beforeEach(async () => {
  await seedTenants(db);
  await db.insert(deployment).values({ id: 1, environment: "preproduction" });
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
    const fixture = allocationFixture({
      node: NODE,
      bases: [
        { code: "FA", purpose: "standard" },
        { code: "RF", purpose: "rectificative" },
      ],
      identity: "S000001",
    });
    const report = await fixture.transaction(db, "setup", (tx, operation) =>
      seed.run(tx, NODE, operation),
    );
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(sif.nif).toBe("89890001K"); // seedTenants' tax_id for TENANT_A, never an argument
    expect(sif.idSistemaInformatico).toBe(WAITRON_ID_SISTEMA);
    expect(sif.numeroInstalacion).toBe("S000001");
    expect(report).toContain(sif.id);
    expect(report).toContain("installation S000001");
  });

  it("refuses to seed a database with no taxpayer row, loudly and without a domain code", async () => {
    // Minting a SIF under a guessed NIF is unrepairable; no operator action fixes an empty table.
    await db.execute(sql`delete from tenants`);
    const error = await captureError(() => withTransaction(db, (tx) => seed.run(tx, NODE)));
    expect(isAppError(error)).toBe(false);
    expect((error as Error).message).toContain("tenants is empty");
  });

  it("re-seeding an existing node mints a fresh installation number and a new chain", async () => {
    const bases = [
      { code: "FA", purpose: "standard" },
      { code: "RF", purpose: "rectificative" },
    ];
    const initial = allocationFixture({ node: NODE, bases, identity: "S000001" });
    const recovery = allocationFixture({ node: NODE, bases, identity: "P000042" });
    await initial.transaction(db, "setup", (tx, operation) => seed.run(tx, NODE, operation));
    await recovery.transaction(db, "re-register", (tx, operation) => seed.run(tx, NODE, operation));
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId));
    expect(sif.numeroInstalacion).toBe("P000042");
    const head = await db.execute<{ h: string | null }>(
      sql`select ultima_huella as h from cadenas where node_id = ${TENANT_A.nodeId}`,
    );
    expect(head.rows[0]?.h).toBeNull();
  });
});

describe("allocated fiscal standby contract", () => {
  beforeEach(async () => {
    await withTransaction(db, (tx) =>
      registerSif(tx, {
        nodeId: NODE.nodeId,
        nif: "89890001K",
        idSistemaInformatico: WAITRON_ID_SISTEMA,
      }),
    );
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
    const fixture = spareFixture([
      { code: "FA", purpose: "standard" },
      { code: "RE", purpose: "rectificative" },
    ]);
    const reservation = await reserve(fixture);
    expect(reservation.series).toBeUndefined();
    expect(fixture.allocation.series).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RE-P000042", purpose: "rectificative" },
    ]);
    expect(reservation.state).toEqual(fixture.state);
    await takeover(fixture, reservation.state);
    expect(await activeSeries()).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RE-P000042", purpose: "rectificative" },
    ]);
  });

  it("reserves a signed identity and opens its complete purpose set only at takeover", async () => {
    const fixture = spareFixture();
    const r = await reserve(fixture);
    expect(r.state).toEqual(fixture.state);
    expect(r.series).toBeUndefined();
    expect(fixture.allocation.installationIdentity).toBe("P000042");
    expect(fixture.allocation.series).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RF-P000042", purpose: "rectificative" },
    ]);
    expect(fixture.allocation.series.find((s) => s.code === "RF-P000042")?.purpose).toBe(
      "rectificative",
    );
    expect(await activeSeries()).toEqual([]);
    expect(await activeSifs()).toEqual([]);
    await takeover(fixture, r.state);
    expect(await activeSeries()).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RF-P000042", purpose: "rectificative" },
    ]);
  });

  it("establishes a dormant reservation on the standby and activates the supplied identity at takeover", async () => {
    const fixture = spareFixture();
    const r = await reserve(fixture);
    await fixture.transaction(db, "establish", (tx, operation) =>
      standby.establish(tx, NODE_2, r.state, operation),
    );
    expect(await activeSifs()).toEqual([]);
    expect(await activeSeries()).toEqual([]);
    const retained = await db.select().from(fiscalReservations);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.installationIdentity).toBe("P000042");
    await fixture.transaction(db, "promote", (tx, operation) =>
      standby.activate!(tx, NODE_2, operation),
    );
    const sif = await withTransaction(db, (tx) => currentSif(tx, TENANT_A.nodeId2));
    expect(sif.numeroInstalacion).toBe("P000042");
    expect(sif.nif).toBe("89890001K");
    expect(await activeSeries()).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "RF-P000042", purpose: "rectificative" },
    ]);
  });

  it.each([
    ["absent", () => undefined],
    ["not an object", () => "W1/P000042"],
    [
      "missing the nif",
      (state: ReturnType<typeof spareFixture>["state"]) =>
        malformedState(state, "taxpayerNif", undefined),
    ],
    [
      "an empty software id",
      (state: ReturnType<typeof spareFixture>["state"]) => malformedState(state, "softwareId", ""),
    ],
    [
      "a software id over two characters",
      (state: ReturnType<typeof spareFixture>["state"]) =>
        malformedState(state, "softwareId", "WTX"),
    ],
    [
      "missing the identity",
      (state: ReturnType<typeof spareFixture>["state"]) =>
        malformedState(state, "installationIdentity", undefined),
    ],
    [
      "a non-positive identity",
      (state: ReturnType<typeof spareFixture>["state"]) =>
        malformedState(state, "installationIdentity", 0),
    ],
    [
      "a fractional identity",
      (state: ReturnType<typeof spareFixture>["state"]) =>
        malformedState(state, "installationIdentity", 1.5),
    ],
  ])("refuses a reservation state that is %s, writing nothing", async (_label, change) => {
    const fixture = spareFixture();
    const ring = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x2d).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    await withTransaction(db, (tx) =>
      putCredential(tx, ring, {
        purpose: "membership.node_key",
        value: { privateKey: "held-primary-test-key" },
      }),
    );
    const keysBefore = await db.select().from(tenantCredentials);
    expect(keysBefore).toHaveLength(1);
    const reservationsBefore = await db.select().from(fiscalReservations);
    const allocationsBefore = await db.select().from(fiscalAllocations);
    const err = await captureError(() =>
      fixture.transaction(db, "establish", (tx, operation) =>
        standby.establish(tx, NODE_2, change(fixture.state), operation),
      ),
    );
    expect(isAppError(err) && err.code).toBe("sif.allocation_invalid");
    expect(isAppError(err) && err.params).toEqual({ reason: "reservation_mismatch" });
    expect(await db.select().from(tenantCredentials)).toEqual(keysBefore);
    expect(await db.select().from(fiscalReservations)).toEqual(reservationsBefore);
    expect(await db.select().from(fiscalAllocations)).toEqual(allocationsBefore);
    expect(await activeSeries()).toEqual([]);
    const rows = await db.execute(
      sql`select 1 from registro_sif where node_id = ${TENANT_A.nodeId2}`,
    );
    expect(rows.rows).toEqual([]);
  });
});

function spareFixture(
  bases = [
    { code: "FA", purpose: "standard" },
    { code: "RF", purpose: "rectificative" },
  ],
) {
  return allocationFixture({ node: NODE_2, primary: NODE, bases, identity: "P000042" });
}
function reserve(fixture: ReturnType<typeof spareFixture>) {
  return fixture.transaction(db, "reserve", (tx, operation) =>
    standby.reserve(tx, NODE, NODE_2, operation),
  );
}
async function takeover(fixture: ReturnType<typeof spareFixture>, state: unknown) {
  await fixture.transaction(db, "establish", (tx, operation) =>
    standby.establish(tx, NODE_2, state, operation),
  );
  await fixture.transaction(db, "promote", (tx, operation) =>
    standby.activate!(tx, NODE_2, operation),
  );
}
function activeSeries() {
  return db
    .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
    .from(invoiceSeries)
    .where(and(eq(invoiceSeries.nodeId, NODE_2.nodeId), isNull(invoiceSeries.retiredAt)))
    .orderBy(invoiceSeries.code);
}
function activeSifs() {
  return db
    .select()
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, NODE_2.nodeId), isNull(registroSif.revocadoEn)));
}
function malformedState(
  state: ReturnType<typeof spareFixture>["state"],
  field: string,
  value: unknown,
) {
  const changed = structuredClone(state);
  const allocation = changed.evidence.block.payload.allocations[0]! as unknown as Record<
    string,
    unknown
  >;
  if (value === undefined) delete allocation[field];
  else allocation[field] = value;
  return changed;
}
