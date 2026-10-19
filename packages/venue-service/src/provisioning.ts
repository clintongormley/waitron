import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { deviceProfiles, floorZones, locations } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { setProfileServiceScope } from "./profile-access.js";
import {
  departmentSalePolicies,
  departments,
  deviceProfileServiceAccess,
  zoneSalePolicies,
  zoneServicePolicies,
} from "./schema/service.js";
import { serviceSettings } from "./schema/settings.js";
import { placeOpenPeriod } from "./menu-timetable.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { addStarterServiceSteps } from "./service-steps.js";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary:
      "Create the default department with its starter service steps, counter zone, service settings and four seasons, and give each profile that takes orders that department",
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
        .where(
          and(
            eq(departments.locationId, node.locationId),
            eq(departments.isDefault, true),
            eq(departments.active, true),
          ),
        )
        .limit(1);
      let departmentId = existingDepartment[0]?.id;
      if (departmentId === undefined) {
        await tx
          .update(departments)
          .set({ isDefault: false })
          .where(and(eq(departments.locationId, node.locationId), eq(departments.isDefault, true)));
        const [replacement] = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.locationId, node.locationId), eq(departments.active, true)))
          .orderBy(asc(departments.name), asc(departments.id))
          .limit(1);
        if (replacement !== undefined) departmentId = replacement.id;
        else {
          const [inserted] = await tx
            .insert(departments)
            .values({
              locationId: node.locationId,
              name: location[0]!.name,
              tradingName: location[0]!.name,
              isDefault: true,
            })
            .returning({ id: departments.id });
          departmentId = inserted!.id;
          await addStarterServiceSteps(tx, node, departmentId);
        }
        await tx
          .update(departments)
          .set({ isDefault: true })
          .where(eq(departments.id, departmentId));
      }
      await tx
        .insert(departmentSalePolicies)
        .values({ departmentId, orderStart: "counter" })
        .onConflictDoNothing({ target: departmentSalePolicies.departmentId });

      const existing = await tx
        .select({ zoneId: zoneServicePolicies.zoneId })
        .from(zoneServicePolicies)
        .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
        .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
        .where(
          and(
            eq(zoneServicePolicies.locationId, node.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
            eq(floorZones.active, true),
            eq(departments.active, true),
            eq(floorZones.locationId, node.locationId),
            eq(departments.locationId, node.locationId),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await tx
          .update(zoneServicePolicies)
          .set({ isCounterDefault: false })
          .where(
            and(
              eq(zoneServicePolicies.locationId, node.locationId),
              eq(zoneServicePolicies.isCounterDefault, true),
            ),
          );
        // The conflict clause updates the name to the value it already holds: the point is not the
        // update but the `returning`, which a plain `do nothing` would leave empty on a re-run.
        const zone = await tx
          .insert(floorZones)
          .values({ locationId: node.locationId, name: "Counter", displayOrder: 0, active: true })
          .onConflictDoUpdate({
            target: [floorZones.locationId, floorZones.name],
            targetWhere: sql`${floorZones.active} = 1`,
            set: { name: sql`excluded.name` },
          })
          .returning({ id: floorZones.id });
        await tx
          .insert(zoneServicePolicies)
          .values({
            locationId: node.locationId,
            zoneId: zone[0]!.id,
            departmentId,
            isCounterDefault: true,
          })
          .onConflictDoUpdate({
            target: zoneServicePolicies.zoneId,
            set: { isCounterDefault: true, departmentId },
          });
      }
      const policy = await tx
        .select({
          zoneId: zoneServicePolicies.zoneId,
          departmentId: zoneServicePolicies.departmentId,
        })
        .from(zoneServicePolicies)
        .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
        .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
        .where(
          and(
            eq(zoneServicePolicies.locationId, node.locationId),
            eq(zoneServicePolicies.isCounterDefault, true),
            eq(floorZones.active, true),
            eq(departments.active, true),
            eq(floorZones.locationId, node.locationId),
            eq(departments.locationId, node.locationId),
          ),
        )
        .limit(1);
      const zoneId = policy[0]!.zoneId;
      await tx
        .insert(zoneSalePolicies)
        .values({ zoneId })
        .onConflictDoNothing({ target: zoneSalePolicies.zoneId });
      await ensureDefaultSeasons(tx, node);
      const menuId = location[0]!.catalogueId;
      if (menuId !== null) {
        const counterDepartmentId = policy[0]!.departmentId;
        await placeOpenPeriod(tx, node, counterDepartmentId, menuId);
      }
      // A profile that takes orders and has no scope yet orders in the counter's department,
      // starting there. A kitchen display takes no orders, so it gets none. A scope already saved
      // is left alone.
      const unscoped = (
        await tx
          .select({ id: deviceProfiles.id, capabilities: deviceProfiles.capabilities })
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
          )
      ).filter(({ capabilities }) => (capabilities as string[]).includes("take-orders"));
      for (const { id } of unscoped) {
        await setProfileServiceScope(tx, node, id, {
          departmentId: policy[0]!.departmentId,
          allowedZoneIds: null,
          startingZoneId: zoneId,
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
