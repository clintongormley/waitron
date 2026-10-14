import { beforeEach, expect, it } from "vitest";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { allocationFixture } from "../test/allocation-fixture.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { ALLOCATED_FISCAL_SEED } from "./allocated-lifecycle.js";
import { FISCAL_PROVISIONING } from "./provisioning.js";
import { FISCAL_RESTORE } from "./restore.js";
import { currentSif, registerSif } from "./registro-sif.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = {
  nodeId: TENANT_A.nodeId,
  locationId: locationId(TENANT_A.locationId),
};
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

function initial() {
  return allocationFixture({ node: primary, bases, identity: "S000001" });
}
async function seeded() {
  await initial().transaction(suite.db, "setup", (tx, operation) =>
    ALLOCATED_FISCAL_SEED.run(tx, primary, operation),
  );
}
async function snapshot() {
  return {
    identities: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
  };
}

it("the default seed refuses an unprepared operation without minting an identity", async () => {
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) => FISCAL_PROVISIONING.seed!.run(tx, primary)),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  expect(await snapshot()).toEqual(before);
});

it("the default seed activates exactly the independently supplied identity and purposes", async () => {
  const report = await initial().transaction(suite.db, "setup", (tx, operation) =>
    FISCAL_PROVISIONING.seed!.run(tx, primary, operation),
  );
  expect(report).toContain("installation S000001");
  expect((await currentSif(suite.db, primary.nodeId)).numeroInstalacion).toBe("S000001");
  expect(
    await suite.db
      .select({ code: invoiceSeries.code, purpose: invoiceSeries.purpose })
      .from(invoiceSeries)
      .orderBy(invoiceSeries.code),
  ).toEqual([
    { code: "A-S000001", purpose: "standard" },
    { code: "FF-S000001", purpose: "full" },
    { code: "R-S000001", purpose: "rectificative" },
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("the default restore refuses an unprepared operation and retains the live state", async () => {
  await seeded();
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) => FISCAL_RESTORE(tx, primary)),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  expect(await snapshot()).toEqual(before);
});

it("the default standby reservation refuses an unprepared operation without spending locally", async () => {
  await seeded();
  const before = await snapshot();
  await expect(
    withTransaction(suite.db, (tx) => FISCAL_PROVISIONING.standby!.reserve(tx, primary, standby)),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  expect(await snapshot()).toEqual(before);
});

it("registration stores the supplied text identity instead of drawing from a counter", async () => {
  const supplied = {
    nodeId: primary.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
    numeroInstalacion: "S000042",
  };
  const registered = await withTransaction(suite.db, (tx) => registerSif(tx, supplied));
  expect(registered.numeroInstalacion).toBe("S000042");
  expect((await currentSif(suite.db, primary.nodeId)).numeroInstalacion).toBe("S000042");
});

it("registration refuses a missing supplied identity before retiring the live identity", async () => {
  await seeded();
  const before = await snapshot();
  const missing = {
    nodeId: primary.nodeId,
    nif: "89890001K",
    idSistemaInformatico: "W1",
  } as Parameters<typeof registerSif>[1];
  await expect(withTransaction(suite.db, (tx) => registerSif(tx, missing))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "installation_invalid" },
  });
  expect(await snapshot()).toEqual(before);
});

it("the final schema holds no local installation-number allocator", async () => {
  expect(
    suite.db.execute(sql`select name from sqlite_master where name = 'contadores_instalacion'`)
      .rows,
  ).toEqual([]);
});
