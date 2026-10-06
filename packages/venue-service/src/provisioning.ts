import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { deviceProfiles, floorZones, locations } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { readProfileServiceAccess, setProfileServiceAccess } from "./profile-access.js";
import {
  departmentSalePolicies,
  departments,
  deviceProfileServiceAccess,
  zoneMenus,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./schema/service.js";
import { serviceSettings } from "./schema/settings.js";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary:
      "Create the default department, counter zone and service settings, and give each ordering profile that department",
    async run(tx, node) {
      const location = await tx
        .select({ name: locations.name, catalogueId: locations.catalogueId })
        .from(locations)
        .where(eq(locations.id, node.locationId));
      // Through the insert builder: `id` and `created_at` are `$defaultFn` generators, which only
      // the builder runs. Read-then-insert is safe because a seed runs inside `withTransaction`,
      // which holds the file's write lock for its whole body.
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
              name: location[0]!.name,
              tradingName: location[0]!.name,
              defaultServiceMode: "prepay",
              isDefault: true,
            })
            .returning({ id: departments.id })
        )[0]!.id;
      await tx
        .insert(departmentSalePolicies)
        .values({ departmentId })
        .onConflictDoNothing({ target: departmentSalePolicies.departmentId });

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
        .select({
          zoneId: zoneServicePolicies.zoneId,
          departmentId: zoneServicePolicies.departmentId,
        })
        .from(zoneServicePolicies)
        .where(
          and(
            eq(zoneServicePolicies.locationId, node.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
          ),
        )
        .limit(1);
      const zoneId = policy[0]!.zoneId;
      await tx
        .insert(zoneSalePolicies)
        .values({ zoneId })
        .onConflictDoNothing({ target: zoneSalePolicies.zoneId });
      const menuId = location[0]!.catalogueId;
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
      // An ordering profile with no scope yet orders in the counter's department, starting there. A
      // kitchen display takes no orders, so it gets none. A scope already saved is left alone.
      const unscoped = await tx
        .select({ id: deviceProfiles.id })
        .from(deviceProfiles)
        .leftJoin(
          deviceProfileServiceAccess,
          eq(deviceProfileServiceAccess.deviceProfileId, deviceProfiles.id),
        )
        .where(
          and(
            isNull(deviceProfiles.retiredAt),
            ne(deviceProfiles.formFactor, "kds"),
            isNull(deviceProfileServiceAccess.deviceProfileId),
          ),
        );
      for (const { id } of unscoped) {
        const kept = await readProfileServiceAccess(tx, node, id);
        await setProfileServiceAccess(tx, node, id, {
          departmentId: policy[0]!.departmentId,
          allowedZoneIds: null,
          startingZoneId: zoneId,
          stationIds: kept.stationIds,
          watcherIds: kept.watcherIds,
        });
      }
      await tx
        .insert(serviceSettings)
        .values({ id: 1 })
        .onConflictDoNothing({ target: serviceSettings.id });
      return "default department, counter zone and service settings ready";
    },
  },
};
