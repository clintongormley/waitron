import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  departments,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue, seedWorkingOrder, seedZone } from "@waitron/db/testing/seed.js";
import { AppError, type Dining, type DiningPolicy } from "@waitron/shared";
import {
  departmentDining,
  diningStartOf,
  findOrdersWithDiningChoice,
  resolveOrderDining,
  venueChargesTakeawayVat,
} from "./dining.js";
import {
  createDepartment,
  recordOrderServiceContext,
  resolveSalePolicy,
  setDepartmentSalePolicyField,
} from "./operations.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function venueIn(country: string, fiscalTerritory: string): Promise<void> {
  await seedVenue(db, {
    name: "Corner Kitchen",
    invoiceLocales: ["en-GB"],
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

describe("resolveOrderDining", () => {
  async function zoneSelling(
    dining: DiningPolicy,
    options: { startsAs?: Dining; orderStart?: "table" | "counter" } = {},
  ): Promise<string> {
    const department = await withTransaction(db, (tx) => createDepartment(tx, { name: "Deli" }));
    await withTransaction(db, async (tx) => {
      await setDepartmentSalePolicyField(tx, department.id, "dining", dining);
      if (options.startsAs !== undefined) {
        await setDepartmentSalePolicyField(tx, department.id, "diningStartsAs", options.startsAs);
      }
      await setDepartmentSalePolicyField(
        tx,
        department.id,
        "orderStart",
        options.orderStart ?? "counter",
      );
    });
    return (await seedZone(db, { name: "Counter", departmentId: department.id })).id;
  }

  function resolve(zoneId: string, requested: Dining | undefined): Promise<Dining> {
    return withTransaction(db, (tx) => resolveOrderDining(tx, zoneId, requested));
  }

  async function refusal(zoneId: string, requested: Dining | undefined): Promise<unknown> {
    const error = await captureError(() => resolve(zoneId, requested));
    expect(error).toBeInstanceOf(AppError);
    return { code: (error as AppError).code, params: (error as AppError).params };
  }

  it.each([
    ["eat_in", undefined, "eat_in"],
    ["eat_in", "eat_in", "eat_in"],
    ["takeaway", undefined, "takeaway"],
    ["takeaway", "takeaway", "takeaway"],
  ] as const)("a department fixed %s, asked %s, gives %s", async (dining, requested, expected) => {
    await venueIn("ES", "ES-common");
    expect(await resolve(await zoneSelling(dining), requested)).toBe(expected);
  });

  it.each([
    ["eat_in", "takeaway"],
    ["takeaway", "eat_in"],
  ] as const)("a department fixed %s refuses a request for %s", async (dining, requested) => {
    await venueIn("ES", "ES-common");
    expect(await refusal(await zoneSelling(dining), requested)).toEqual({
      code: "order.dining_fixed",
      params: { dining },
    });
  });

  it.each([
    ["eat_in", "takeaway", "takeaway"],
    ["takeaway", "eat_in", "eat_in"],
    ["takeaway", undefined, "takeaway"],
    ["eat_in", undefined, "eat_in"],
  ] as const)(
    "a till-choice counter starting %s, asked %s, gives %s",
    async (startsAs, requested, expected) => {
      await venueIn("ES", "ES-common");
      expect(await resolve(await zoneSelling("till_choice", { startsAs }), requested)).toBe(
        expected,
      );
    },
  );

  it("starts a till-choice table order eaten here, whatever the department starts as", async () => {
    await venueIn("ES", "ES-common");
    const zoneId = await zoneSelling("till_choice", { startsAs: "takeaway", orderStart: "table" });
    expect(await resolve(zoneId, undefined)).toBe("eat_in");
    expect(await resolve(zoneId, "takeaway")).toBe("takeaway");
  });

  describe("diningStartOf, from the zone's resolved sale policy", () => {
    async function startOfZone(zoneId: string) {
      return withTransaction(db, async (tx) =>
        diningStartOf(await resolveSalePolicy(tx, zoneId), await venueChargesTakeawayVat(tx)),
      );
    }

    it.each([
      ["eat_in", "eat_in"],
      ["takeaway", "takeaway"],
    ] as const)("a department fixed %s starts %s", async (dining, startsAs) => {
      await venueIn("ES", "ES-common");
      expect(await startOfZone(await zoneSelling(dining, { startsAs: "takeaway" }))).toEqual({
        policy: dining,
        startsAs,
      });
    });

    it("a till-choice counter starts as the department says", async () => {
      await venueIn("ES", "ES-common");
      expect(await startOfZone(await zoneSelling("till_choice", { startsAs: "takeaway" }))).toEqual(
        {
          policy: "till_choice",
          startsAs: "takeaway",
        },
      );
    });

    it("a till-choice table zone starts eaten here, whatever the department starts as", async () => {
      await venueIn("ES", "ES-common");
      const zoneId = await zoneSelling("till_choice", {
        startsAs: "takeaway",
        orderStart: "table",
      });
      expect(await startOfZone(zoneId)).toEqual({ policy: "till_choice", startsAs: "eat_in" });
    });

    it("is null in a region without takeaway VAT", async () => {
      await venueIn("GB", "GB-vat");
      expect(await startOfZone(await zoneSelling("takeaway"))).toBeNull();
    });
  });

  it("sells eaten here in a department stored with its column defaults", async () => {
    await venueIn("ES", "ES-common");
    const [department] = await db
      .insert(departments)
      .values({ name: "Bare", tradingName: "Bare" })
      .returning({ id: departments.id });
    const zone = await seedZone(db, { name: "Bare counter", departmentId: department!.id });
    expect(await resolve(zone.id, undefined)).toBe("eat_in");
    expect(await refusal(zone.id, "takeaway")).toEqual({
      code: "order.dining_fixed",
      params: { dining: "eat_in" },
    });
  });

  it("refuses a zone that does not exist", async () => {
    await venueIn("ES", "ES-common");
    const zoneId = "00000000-0000-4000-8000-000000000002";
    expect(await refusal(zoneId, undefined)).toEqual({
      code: "service_zone.not_found",
      params: { zoneId },
    });
  });

  // A region without the distinction whose department row says takeaway.
  it.each(["takeaway", "till_choice"] as const)(
    "in a region without takeaway VAT, a %s department sells eaten here",
    async (dining) => {
      await venueIn("GB", "GB-vat");
      const zoneId = await zoneSelling(dining, { startsAs: "takeaway" });
      expect(await resolve(zoneId, undefined)).toBe("eat_in");
      expect(await resolve(zoneId, "eat_in")).toBe("eat_in");
      expect(await refusal(zoneId, "takeaway")).toEqual({
        code: "order.dining_fixed",
        params: { dining: "eat_in" },
      });
    },
  );
});

describe("findOrdersWithDiningChoice", () => {
  /** An order opened in a fresh department's counter zone, the department selling `dining`. */
  async function orderSelling(dining: DiningPolicy): Promise<string> {
    return withTransaction(db, async (tx) => {
      const department = await createDepartment(tx, { name: `Deli ${dining}` });
      await setDepartmentSalePolicyField(tx, department.id, "dining", dining);
      const zone = await seedZone(tx, { name: `Counter ${dining}`, departmentId: department.id });
      const order = await seedWorkingOrder(tx, { orderNumber: nextOrderNumber++ });
      await recordOrderServiceContext(tx, order.id, zone.id);
      return order.id;
    });
  }
  let nextOrderNumber = 1;

  function find(ids: readonly string[]): Promise<ReadonlySet<string>> {
    return withTransaction(db, (tx) => findOrdersWithDiningChoice(tx, ids));
  }

  it("names only the orders whose department leaves the way to the till", async () => {
    await venueIn("ES", "ES-common");
    const choice = await orderSelling("till_choice");
    const eatIn = await orderSelling("eat_in");
    const takeaway = await orderSelling("takeaway");
    const noContext = (await seedWorkingOrder(db, { orderNumber: nextOrderNumber++ })).id;
    expect(await find([choice, eatIn, takeaway, noContext])).toEqual(new Set([choice]));
    expect(await find([])).toEqual(new Set());
  });

  it("names none in a region without takeaway VAT", async () => {
    await venueIn("GB", "GB-vat");
    expect(await find([await orderSelling("till_choice")])).toEqual(new Set());
  });
});
