import { and, eq, sql } from "drizzle-orm";
import { floorZones, locations } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { departments, zoneMenus, zoneServicePolicies } from "./schema/service.js";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the default department and counter zone",
    async run(tx, node) {
      // Every write here goes through a table definition rather than raw SQL, because `departments`
      // and `floor_zones` generate `id` and `created_at` with `$defaultFn`, which only the insert
      // BUILDER runs, and both columns are `text PRIMARY KEY NOT NULL` in the generated DDL — so a
      // raw insert that omits the id is refused `NOT NULL constraint failed: departments.id`. The
      // same refusal on `persons` was run directly on node:sqlite; see `packages/provisioning/
      // src/venue-apply.ts`'s seed-admin case for the receipt.
      //
      // The department's `where not exists` became a read-then-insert. The two are equivalent
      // because a seed runs inside `withTransaction`, which holds the file's write lock for its
      // whole body (`packages/store/src/write-queue.ts`, `createWriteQueue`), so nothing can seed
      // a second default department between the read and the write.
      const existingDepartment = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.locationId, node.locationId), eq(departments.isDefault, true)))
        .limit(1);
      const departmentId =
        existingDepartment[0]?.id ??
        (
          await tx
            .insert(departments)
            .values({
              locationId: node.locationId,
              name: "Venue",
              tradingName: "Venue",
              defaultServiceMode: "prepay",
              isDefault: true,
            })
            .returning({ id: departments.id })
        )[0]!.id;

      const existing = await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(
          and(
            eq(zoneServicePolicies.locationId, node.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        // The conflict clause updates the name to the value it already holds: the point is not the
        // update but the `returning`, which a plain `do nothing` would leave empty on a re-run.
        const zone = await tx
          .insert(floorZones)
          .values({ locationId: node.locationId, name: "Counter", displayOrder: 0, active: true })
          .onConflictDoUpdate({
            target: [floorZones.locationId, floorZones.name],
            set: { name: sql`excluded.name` },
          })
          .returning({ id: floorZones.id });
        await tx
          .insert(zoneServicePolicies)
          .values({
            locationId: node.locationId,
            zoneId: zone[0]!.id,
            departmentId,
            serviceMode: null,
            isCounterDefault: true,
          })
          .onConflictDoUpdate({
            target: zoneServicePolicies.zoneId,
            set: { isCounterDefault: true },
          });
      }
      const policy = await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .where(
          and(
            eq(zoneServicePolicies.locationId, node.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
          ),
        )
        .limit(1);
      const menu = await tx
        .select({ catalogueId: locations.catalogueId })
        .from(locations)
        .where(eq(locations.id, node.locationId));
      const zoneId = policy[0]!.zoneId;
      const menuId = menu[0]!.catalogueId;
      if (menuId !== null) {
        await tx
          .insert(zoneMenus)
          .values({ zoneId, menuId, displayOrder: 0 })
          .onConflictDoNothing({ target: [zoneMenus.zoneId, zoneMenus.menuId] });
        await tx
          .update(zoneServicePolicies)
          .set({ defaultMenuId: menuId })
          .where(
            and(
              eq(zoneServicePolicies.zoneId, zoneId),
              sql`${zoneServicePolicies.defaultMenuId} is null`,
            ),
          );
      }
      return "default department and counter zone ready";
    },
  },
};
