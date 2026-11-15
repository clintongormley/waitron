import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, CORE_MIGRATIONS, withTransaction, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedZone } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { departmentDining, venueChargesTakeawayVat } from "./dining.js";
import { createDepartment, resolveSalePolicy, setDepartmentSalePolicyField } from "./operations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function venueIn(country: string, fiscalTerritory: string): Promise<void> {
  await seedVenue(db, {
    name: "Corner Kitchen",
    invoiceLocales: ["en-GB"],
    operationDescription: "Hospitality",
    fiscalTerritory,
  });
  await db.execute(sql`update taxpayer set country = ${country}`);
}

describe("departmentDining", () => {
  it("reads a new department as eaten in, starting eaten in", async () => {
    await venueIn("ES", "ES-common");
    const department = await withTransaction(db, (tx) => createDepartment(tx, { name: "Bar" }));
    expect(await withTransaction(db, (tx) => departmentDining(tx, department.id))).toEqual({
      dining: "eat_in",
      startsAs: "eat_in",
    });
  });

  it("reads what setDepartmentSalePolicyField saved", async () => {
    await venueIn("ES", "ES-common");
    const department = await withTransaction(db, (tx) => createDepartment(tx, { name: "Deli" }));
    await withTransaction(db, async (tx) => {
      await setDepartmentSalePolicyField(tx, department.id, "dining", "till_choice");
      await setDepartmentSalePolicyField(tx, department.id, "diningStartsAs", "takeaway");
    });
    expect(await withTransaction(db, (tx) => departmentDining(tx, department.id))).toEqual({
      dining: "till_choice",
      startsAs: "takeaway",
    });
  });

  it("travels with the zone's resolved sale policy", async () => {
    await venueIn("ES", "ES-common");
    const department = await withTransaction(db, (tx) => createDepartment(tx, { name: "Shop" }));
    const zone = await seedZone(db, { name: "Counter", departmentId: department.id });
    await withTransaction(db, (tx) =>
      setDepartmentSalePolicyField(tx, department.id, "dining", "takeaway"),
    );
    expect(await withTransaction(db, (tx) => resolveSalePolicy(tx, zone.id))).toMatchObject({
      dining: "takeaway",
      diningStartsAs: "eat_in",
    });
  });

  it("refuses a department that does not exist", async () => {
    await venueIn("ES", "ES-common");
    const departmentId = "00000000-0000-4000-8000-000000000001";
    const error = await captureError(() =>
      withTransaction(db, (tx) => departmentDining(tx, departmentId)),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("department.not_found");
  });
});

describe("venueChargesTakeawayVat", () => {
  it("is true for a venue in mainland Spain", async () => {
    await venueIn("ES", "ES-common");
    expect(await withTransaction(db, (tx) => venueChargesTakeawayVat(tx))).toBe(true);
  });

  it("is false for a venue in a region without the distinction", async () => {
    await venueIn("GB", "GB-vat");
    expect(await withTransaction(db, (tx) => venueChargesTakeawayVat(tx))).toBe(false);
  });

  it("is false before the venue has a taxpayer", async () => {
    await venueIn("ES", "ES-common");
    await db.execute(sql`delete from taxpayer`);
    expect(await withTransaction(db, (tx) => venueChargesTakeawayVat(tx))).toBe(false);
  });
});
