import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  diningTables,
  deviceProfiles,
  devices,
  floorZones,
  locations,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FloorDeletion } from "@waitron/module";
import { AppError, locationId, type DeleteImpactRefusal } from "@waitron/shared";
import * as serviceDelete from "./index.js";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  departments,
  deviceProfileServiceAccess,
  deviceProfileZones,
  orderServiceContexts,
  zoneServicePolicies,
} from "./schema/service.js";
import { departmentTransferRequests } from "./schema/department-transfers.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
});
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
const NOW = new Date("2026-10-11T12:00:00Z");
const noFloor: FloorDeletion = {
  readImpact: async () => ({ refusals: [], removes: [] }),
  clear: async () => {},
};

async function fixture() {
  return run(async (tx) => {
    const [venue] = await tx
      .insert(locations)
      .values({
        name: randomUUID(),
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const cfg = { locationId: locationId(venue!.id) };
    const ds = await tx
      .insert(departments)
      .values([
        { ...cfg, name: "Dining", tradingName: "Dining", isDefault: true },
        { ...cfg, name: "Bar", tradingName: "Bar" },
        { ...cfg, name: "Garden", tradingName: "Garden" },
      ])
      .returning();
    const zs = await tx
      .insert(floorZones)
      .values([
        { ...cfg, name: "Alpha", displayOrder: 2 },
        { ...cfg, name: "Beta", displayOrder: 1 },
        { ...cfg, name: "Gamma", displayOrder: 0 },
      ])
      .returning();
    await tx.insert(zoneServicePolicies).values([
      { ...cfg, zoneId: zs[0]!.id, departmentId: ds[0]!.id },
      { ...cfg, zoneId: zs[1]!.id, departmentId: ds[0]!.id },
      { ...cfg, zoneId: zs[2]!.id, departmentId: ds[1]!.id },
    ]);
    return {
      cfg,
      dining: ds[0]!.id,
      bar: ds[1]!.id,
      garden: ds[2]!.id,
      alpha: zs[0]!.id,
      beta: zs[1]!.id,
      gamma: zs[2]!.id,
    };
  });
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

describe("service deletion", () => {
  it("lists every descendant refusal once and refuses before changing rows", async () => {
    const f = await fixture();
    const first: DeleteImpactRefusal = {
      code: "zone.table_in_use",
      params: { zoneId: f.beta, tableId: "table-b", tableName: "B" },
      targets: [],
    };
    const second: DeleteImpactRefusal = {
      code: "zone.table_in_use",
      params: { zoneId: f.alpha, tableId: "table-a", tableName: "A" },
      targets: [],
    };
    const floor: FloorDeletion = {
      readImpact: async () => ({ refusals: [first, second, first], removes: [] }),
      clear: async () => {
        throw Error("must not clear");
      },
    };
    const impact = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, floor, f.dining, NOW),
    );
    expect(impact.refusals).toEqual([second, first]);
    expect(impact.removes).toContainEqual({
      key: "zones",
      count: 2,
      targets: [
        { id: f.alpha, name: "Alpha" },
        { id: f.beta, name: "Beta" },
      ],
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteDepartment(tx, f.cfg, floor, f.dining, NOW))),
    ).toBe("zone.table_in_use");
    expect(
      await run((tx) =>
        tx
          .select({ active: departments.active })
          .from(departments)
          .where(eq(departments.id, f.dining)),
      ),
    ).toEqual([{ active: true }]);
  });

  it("keeps every named holder when floor reports one table refusal twice", async () => {
    const f = await fixture();
    const params = { zoneId: f.alpha, tableId: "shared-table", tableName: "Shared" };
    const floor: FloorDeletion = {
      readImpact: async () => ({
        refusals: [
          { code: "zone.table_in_use", params, targets: [{ id: "party-2", name: "B" }] },
          { code: "zone.table_in_use", params, targets: [{ id: "party-1", name: "A" }] },
        ],
        removes: [],
      }),
      clear: async () => {},
    };
    const impact = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, floor, f.alpha, NOW),
    );
    expect(impact.refusals).toEqual([
      {
        code: "zone.table_in_use",
        params,
        targets: [
          { id: "party-1", name: "A" },
          { id: "party-2", name: "B" },
        ],
      },
    ]);
  });

  it("only the remaining active department refuses deletion", async () => {
    const f = await fixture();
    await run((tx) =>
      tx.update(departments).set({ active: false }).where(eq(departments.id, f.garden)),
    );
    const first = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(first.refusals).toEqual([]);
    await run((tx) =>
      tx.update(departments).set({ active: false }).where(eq(departments.id, f.bar)),
    );
    const last = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(last.refusals).toContainEqual({
      code: "department.last_active",
      params: { departmentId: f.dining },
      targets: [],
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteDepartment(tx, f.cfg, noFloor, f.dining, NOW))),
    ).toBe("department.last_active");
  });

  it("pending transfers in both directions refuse departments and a destination zone", async () => {
    const f = await fixture();
    const ids = await run(async (tx) => {
      const orders = await tx
        .insert(workingOrders)
        .values([
          { source: "operator_script", locationId: f.cfg.locationId, orderNumber: 1 },
          { source: "operator_script", locationId: f.cfg.locationId, orderNumber: 2 },
        ])
        .returning({ id: workingOrders.id });
      const requests = await tx
        .insert(departmentTransferRequests)
        .values([
          {
            tabId: orders[0]!.id,
            sourceDepartmentId: f.dining,
            destinationDepartmentId: f.bar,
            senderId: randomUUID(),
            destinationZoneId: f.gamma,
          },
          {
            tabId: orders[1]!.id,
            sourceDepartmentId: f.bar,
            destinationDepartmentId: f.dining,
            senderId: randomUUID(),
            destinationZoneId: f.alpha,
          },
        ])
        .returning({ id: departmentTransferRequests.id });
      return requests.map((row) => row.id);
    });
    const department = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(
      department.refusals
        .filter((r) => r.code === "department.transfer_pending")
        .map((r) => r.params.requestId)
        .sort(),
    ).toEqual([...ids].sort());
    const zone = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW),
    );
    expect(zone.refusals).toContainEqual({
      code: "zone.transfer_pending",
      params: { zoneId: f.alpha, requestId: ids[1] },
      targets: [],
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.transfer_pending");
  });

  it("open and placed counter orders refuse a zone and its department without tables", async () => {
    const f = await fixture();
    const orderIds = await run(async (tx) => {
      const orders = await tx
        .insert(workingOrders)
        .values([
          { source: "operator_script", locationId: f.cfg.locationId, orderNumber: 3 },
          {
            source: "operator_script",
            locationId: f.cfg.locationId,
            orderNumber: 4,
            status: "placed",
          },
        ])
        .returning({ id: workingOrders.id });
      await tx.insert(orderServiceContexts).values(
        orders.map((order) => ({
          workingOrderId: order.id,
          locationId: f.cfg.locationId,
          zoneId: f.alpha,
          departmentId: f.dining,
          serviceMode: "prepay",
        })),
      );
      return orders.map((order) => order.id);
    });
    const zone = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW),
    );
    for (const orderId of orderIds)
      expect(zone.refusals).toContainEqual({
        code: "zone.order_in_progress",
        params: { zoneId: f.alpha, workingOrderId: orderId },
        targets: [],
      });
    const department = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    for (const orderId of orderIds)
      expect(department.refusals).toContainEqual({
        code: "department.order_in_progress",
        params: { departmentId: f.dining, workingOrderId: orderId },
        targets: [],
      });
  });

  it("Every and explicit profiles refuse removal of their last permitted zone", async () => {
    const f = await fixture();
    const profiles = await run(async (tx) => {
      const rows = await tx
        .insert(deviceProfiles)
        .values([
          { name: randomUUID(), formFactor: "till" },
          { name: randomUUID(), formFactor: "phone-portrait" },
          { name: randomUUID(), formFactor: "kds" },
          { name: randomUUID(), formFactor: "till", retiredAt: NOW.toISOString() },
        ])
        .returning();
      await tx.insert(deviceProfileServiceAccess).values(
        rows.map((row, index) => ({
          deviceProfileId: row.id,
          departmentId: f.dining,
          everyZone: index === 0,
          startingZoneId: f.alpha,
        })),
      );
      await tx.insert(deviceProfileZones).values([
        { deviceProfileId: rows[1]!.id, zoneId: f.alpha },
        { deviceProfileId: rows[2]!.id, zoneId: f.alpha },
        { deviceProfileId: rows[3]!.id, zoneId: f.alpha },
      ]);
      await tx.insert(devices).values({
        locationId: f.cfg.locationId,
        deviceProfileId: rows[1]!.id,
        label: "Off till",
        tokenHash: "hash",
        active: false,
      });
      return rows;
    });
    const one = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW),
    );
    expect(one.refusals.filter((r) => r.code === "zone.profile_in_use")).toEqual([
      {
        code: "zone.profile_in_use",
        params: { zoneId: f.alpha, profileId: profiles[1]!.id },
        targets: [{ id: profiles[1]!.id, name: profiles[1]!.name }],
      },
    ]);
    const all = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(
      all.refusals
        .filter((r) => r.code === "department.profile_in_use")
        .map((r) => r.params.profileId)
        .sort(),
    ).toEqual([profiles[0]!.id, profiles[1]!.id].sort());
  });

  it("an Every profile refuses deletion of its last live zone", async () => {
    const f = await fixture();
    const profileId = await run(async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till" })
        .returning();
      await tx.insert(deviceProfileServiceAccess).values({
        deviceProfileId: profile!.id,
        departmentId: f.dining,
        everyZone: true,
        startingZoneId: f.alpha,
      });
      await tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.beta));
      return profile!.id;
    });
    const impact = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW),
    );
    expect(impact.refusals).toContainEqual({
      code: "zone.profile_in_use",
      params: { zoneId: f.alpha, profileId },
      targets: [{ id: profileId, name: expect.any(String) }],
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.profile_in_use");
  });

  it("an already-empty explicit bound refuses its department deletion", async () => {
    const f = await fixture();
    const profileId = await run(async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till" })
        .returning();
      await tx.insert(deviceProfileServiceAccess).values({
        deviceProfileId: profile!.id,
        departmentId: f.dining,
        everyZone: false,
        startingZoneId: f.alpha,
      });
      return profile!.id;
    });
    const impact = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(impact.refusals.filter((row) => row.code === "department.profile_in_use")).toEqual([
      {
        code: "department.profile_in_use",
        params: { departmentId: f.dining, profileId },
        targets: [{ id: profileId, name: expect.any(String) }],
      },
    ]);
    expect(
      await refusal(run((tx) => serviceDelete.deleteDepartment(tx, f.cfg, noFloor, f.dining, NOW))),
    ).toBe("department.profile_in_use");
    expect(
      await run((tx) =>
        tx
          .select({ active: departments.active })
          .from(departments)
          .where(eq(departments.id, f.dining)),
      ),
    ).toEqual([{ active: true }]);
    expect(
      await run((tx) =>
        tx
          .select({ deviceProfileId: deviceProfileServiceAccess.deviceProfileId })
          .from(deviceProfileServiceAccess)
          .where(eq(deviceProfileServiceAccess.deviceProfileId, profileId)),
      ),
    ).toEqual([{ deviceProfileId: profileId }]);
  });

  it("an already-empty explicit bound refuses deletion of its starting zone", async () => {
    const f = await fixture();
    const profileId = await run(async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till" })
        .returning();
      await tx.insert(deviceProfileServiceAccess).values({
        deviceProfileId: profile!.id,
        departmentId: f.dining,
        everyZone: false,
        startingZoneId: f.alpha,
      });
      return profile!.id;
    });
    const impact = await run((tx) =>
      serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW),
    );
    expect(impact.refusals).toContainEqual({
      code: "zone.profile_in_use",
      params: { zoneId: f.alpha, profileId },
      targets: [{ id: profileId, name: expect.any(String) }],
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.profile_in_use");
    expect(
      await run((tx) =>
        tx.select({ active: floorZones.active }).from(floorZones).where(eq(floorZones.id, f.alpha)),
      ),
    ).toEqual([{ active: true }]);
  });

  it("rolls back floor and service cleanup when a later step throws", async () => {
    const f = await fixture();
    const floor: FloorDeletion = {
      readImpact: async () => ({ refusals: [], removes: [] }),
      clear: async (tx) => {
        await tx
          .update(floorZones)
          .set({ name: "Floor changed" })
          .where(eq(floorZones.id, f.alpha));
      },
    };
    await expect(
      run(async (tx) => {
        await serviceDelete.deleteZone(tx, f.cfg, floor, f.alpha, NOW);
        throw Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(
      await run((tx) =>
        tx
          .select({ name: floorZones.name, active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, f.alpha)),
      ),
    ).toEqual([{ name: "Alpha", active: true }]);
  });

  it("calls floor cleanup before marking a zone inactive", async () => {
    const f = await fixture();
    const tableId = await run(async (tx) => {
      const [table] = await tx
        .insert(diningTables)
        .values({ locationId: f.cfg.locationId, zoneId: f.alpha, label: randomUUID() })
        .returning({ id: diningTables.id });
      return table!.id;
    });
    const floor: FloorDeletion = {
      readImpact: async () => ({ refusals: [], removes: [] }),
      clear: async (tx) => {
        const [zone] = await tx
          .select({ active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, f.alpha));
        expect(zone!.active).toBe(true);
        await tx.delete(diningTables).where(eq(diningTables.id, tableId));
      },
    };
    await run((tx) => serviceDelete.deleteZone(tx, f.cfg, floor, f.alpha, NOW));
    expect(
      await run((tx) => tx.select().from(diningTables).where(eq(diningTables.id, tableId))),
    ).toEqual([]);
  });

  it("rolls back a floor write when floor cleanup throws", async () => {
    const f = await fixture();
    const floor: FloorDeletion = {
      readImpact: async () => ({ refusals: [], removes: [] }),
      clear: async (tx) => {
        await tx.update(floorZones).set({ name: "Temporary" }).where(eq(floorZones.id, f.alpha));
        throw Error("floor failed");
      },
    };
    await expect(
      run((tx) => serviceDelete.deleteZone(tx, f.cfg, floor, f.alpha, NOW)),
    ).rejects.toThrow("floor failed");
    expect(
      await run((tx) =>
        tx
          .select({ name: floorZones.name, active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, f.alpha)),
      ),
    ).toEqual([{ name: "Alpha", active: true }]);
  });

  it("rechecks a new order, transfer and profile after the preview", async () => {
    const f = await fixture();
    expect(
      (await run((tx) => serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW)))
        .refusals,
    ).toEqual([]);
    const orderId = await run(async (tx) => {
      const [order] = await tx
        .insert(workingOrders)
        .values({ source: "operator_script", locationId: f.cfg.locationId, orderNumber: 4 })
        .returning({ id: workingOrders.id });
      await tx.insert(orderServiceContexts).values({
        workingOrderId: order!.id,
        locationId: f.cfg.locationId,
        zoneId: f.alpha,
        departmentId: f.dining,
        serviceMode: "prepay",
      });
      return order!.id;
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.order_in_progress");
    await run((tx) =>
      tx.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, orderId)),
    );
    const transferId = await run(async (tx) => {
      const [order] = await tx
        .insert(workingOrders)
        .values({ source: "operator_script", locationId: f.cfg.locationId, orderNumber: 5 })
        .returning({ id: workingOrders.id });
      const [request] = await tx
        .insert(departmentTransferRequests)
        .values({
          tabId: order!.id,
          sourceDepartmentId: f.bar,
          destinationDepartmentId: f.dining,
          destinationZoneId: f.alpha,
          senderId: randomUUID(),
        })
        .returning({ id: departmentTransferRequests.id });
      return request!.id;
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.transfer_pending");
    await run((tx) =>
      tx
        .update(departmentTransferRequests)
        .set({ status: "accepted", resolvedAt: NOW.toISOString() })
        .where(eq(departmentTransferRequests.id, transferId)),
    );
    expect(
      (await run((tx) => serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW)))
        .refusals,
    ).toEqual([]);
    const profileId = await run(async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: randomUUID(), formFactor: "till" })
        .returning();
      await tx.insert(deviceProfileServiceAccess).values({
        deviceProfileId: profile!.id,
        departmentId: f.dining,
        everyZone: false,
        startingZoneId: f.alpha,
      });
      await tx.insert(deviceProfileZones).values({ deviceProfileId: profile!.id, zoneId: f.alpha });
      return profile!.id;
    });
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("zone.profile_in_use");
    expect(
      (
        await run((tx) =>
          tx
            .select({ active: floorZones.active })
            .from(floorZones)
            .where(eq(floorZones.id, f.alpha)),
        )
      )[0]!.active,
    ).toBe(true);
    expect(
      (
        await run((tx) =>
          tx
            .select({ deviceProfileId: deviceProfileServiceAccess.deviceProfileId })
            .from(deviceProfileServiceAccess)
            .where(eq(deviceProfileServiceAccess.deviceProfileId, profileId)),
        )
      ).length,
    ).toBe(1);
  });

  it("deletes an unused zone, frees its name, and rejects repeated reads and writes", async () => {
    const f = await fixture();
    const impact = await run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW));
    expect(impact.target).toEqual({ id: f.alpha, name: "Alpha" });
    expect(impact.refusals).toEqual([]);
    expect(impact.ends).toEqual([]);
    expect(
      await run((tx) =>
        tx
          .select({ name: floorZones.name, active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, f.alpha)),
      ),
    ).toEqual([{ name: "Alpha", active: false }]);
    await run((tx) =>
      tx.insert(floorZones).values({ locationId: f.cfg.locationId, name: "Alpha" }),
    );
    expect(
      await refusal(
        run((tx) => serviceDelete.readZoneDeleteImpact(tx, f.cfg, noFloor, f.alpha, NOW)),
      ),
    ).toBe("service_zone.not_found");
    expect(
      await refusal(run((tx) => serviceDelete.deleteZone(tx, f.cfg, noFloor, f.alpha, NOW))),
    ).toBe("service_zone.not_found");
  });

  it("deletes a department and linked inactive zone while preserving their names", async () => {
    const f = await fixture();
    await run((tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, f.beta)),
    );
    const before = await run((tx) =>
      serviceDelete.readDepartmentDeleteImpact(tx, f.cfg, noFloor, f.dining, NOW),
    );
    const done = await run((tx) =>
      serviceDelete.deleteDepartment(tx, f.cfg, noFloor, f.dining, NOW),
    );
    expect(done).toEqual(before);
    expect(
      await run((tx) =>
        tx
          .select({ name: floorZones.name, active: floorZones.active })
          .from(floorZones)
          .where(eq(floorZones.id, f.beta)),
      ),
    ).toEqual([{ name: "Beta", active: false }]);
    expect(
      await run((tx) =>
        tx
          .select({ name: departments.name, active: departments.active })
          .from(departments)
          .where(eq(departments.id, f.dining)),
      ),
    ).toEqual([{ name: "Dining", active: false }]);
    await run((tx) =>
      tx
        .insert(departments)
        .values({ locationId: f.cfg.locationId, name: "Dining", tradingName: "Dining" }),
    );
    expect(
      await refusal(run((tx) => serviceDelete.deleteDepartment(tx, f.cfg, noFloor, f.dining, NOW))),
    ).toBe("department.not_found");
  });

  it("does not read a target from another location", async () => {
    const f = await fixture();
    const other = await fixture();
    expect(
      await refusal(
        run((tx) => serviceDelete.readZoneDeleteImpact(tx, other.cfg, noFloor, f.alpha, NOW)),
      ),
    ).toBe("service_zone.not_found");
    expect(
      await refusal(
        run((tx) =>
          serviceDelete.readDepartmentDeleteImpact(tx, other.cfg, noFloor, f.dining, NOW),
        ),
      ),
    ).toBe("department.not_found");
  });
});

it("exposes only permanent hierarchy removal operations", () => {
  for (const name of [
    "activateDepartment",
    "deactivateDepartment",
    "deactivateServiceZone",
    "departmentRemovalImpact",
    "zoneRemovalImpact",
  ])
    expect(serviceDelete).not.toHaveProperty(name);
});
