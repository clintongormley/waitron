import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  diningTables,
  floorPlanSets,
  departmentFloorPlanSets,
  floorZones,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import type { FloorDeletion } from "@waitron/module";
import {
  createDepartment,
  createServiceZone,
  listServiceZones,
  listSalePolicies,
  resolveZoneContext,
} from "./operations.js";
import { deleteZone } from "./service-delete.js";
import { dueFloorLayouts } from "./floor-layout-due.js";
import { readReleaseReminderMinutesByZone } from "./release-reminders.js";
import { readTablesNeedingClearing } from "./table-clearing.js";
import { routingModel } from "./routing-store.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const noFloor: FloorDeletion = {
  removeSets: async () => {},
  readImpact: async () => ({ refusals: [], removes: [] }),
  clear: async () => {},
};
it("deleted zones leave active zone reads while their department is retained", async () => {
  await withTransaction(suite.db, async (tx) => {
    await seedVenue(tx);
    const department = await createDepartment(tx, { name: "Dining" });
    await tx
      .update(departments)
      .set({ needsClearing: true, releaseReminderMinutes: 12 })
      .where(eq(departments.id, department.id));
    const gone = await createServiceZone(tx, {
      name: "Closed terrace",
      departmentId: department.id,
    });
    const kept = await createServiceZone(tx, { name: "Dining room", departmentId: department.id });
    const [set] = await tx.insert(floorPlanSets).values({}).returning();
    await tx
      .insert(departmentFloorPlanSets)
      .values({ setId: set!.id, departmentId: department.id, name: "Dinner", isDefault: true });
    const tables = await tx
      .insert(diningTables)
      .values([
        { zoneId: gone.id, label: "G" },
        { zoneId: kept.id, label: "K" },
      ])
      .returning();
    const at = new Date("2026-10-11T12:00:00Z");
    await deleteZone(tx, noFloor, gone.id, at);
    expect((await listServiceZones(tx)).map((row) => row.id)).toEqual([kept.id]);
    expect((await listSalePolicies(tx)).zones.map((row) => row.zoneId)).toEqual([kept.id]);
    await expect(resolveZoneContext(tx, gone.id)).rejects.toMatchObject({
      code: "service_zone.not_found",
    });
    expect(await resolveZoneContext(tx, kept.id)).toMatchObject({ departmentId: department.id });
    const due = await dueFloorLayouts(
      tx,
      [gone, kept].map(({ id: zoneId }) => ({ zoneId, recordedOccurrence: null })),
      at,
    );
    expect(due.get(gone.id)?.planned).toBe(false);
    expect(due.get(kept.id)?.due.setId).toBe(set!.id);
    expect(await readReleaseReminderMinutesByZone(tx, [gone.id, kept.id])).toEqual(
      new Map([[kept.id, 12]]),
    );
    expect(
      await readTablesNeedingClearing(
        tx,
        tables.map((row) => row.id),
      ),
    ).toEqual(new Set([tables[1]!.id]));
    expect((await routingModel(tx, at)).zones).toEqual([
      { id: kept.id, name: "Dining room", departmentId: department.id },
    ]);
    expect(
      await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, gone.id)),
    ).toEqual([{ departmentId: department.id }]);
  });
});
