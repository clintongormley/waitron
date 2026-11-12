import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { getCountryPack, starterName } from "@waitron/country-packs";
import {
  departments,
  departmentSalePolicies,
  deviceProfiles,
  deviceProfileServiceAccess,
  floorZones,
  kitchenCourses,
  readTenant,
  readVenue,
} from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { setProfileServiceScope } from "./profile-access.js";
import { placeOpenPeriod } from "./menu-timetable.js";
import { ensureDefaultSeasons } from "./seasons.js";
import { addStarterServiceSteps } from "./service-steps.js";
import { STARTER_COURSE_NAMES, STARTER_ZONE_NAMES } from "./starter-content.js";
import { readStarterStaffLanguage } from "./starter-language.js";
import { readDefaultCatalogueId } from "@waitron/catalogue";

export const COUNTER_ZONE_NAME = "Counter";

export const VENUE_SERVICE_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary:
      "Create the default department with its starter service steps, country courses, counter zone and four seasons, and give each profile that takes orders that department",
    async run(tx, _node, _operation, options) {
      const staffLanguage = options?.staffLanguage ?? (await readStarterStaffLanguage(tx));
      const venue = await readVenue(tx);
      // Through the insert builder: `id` and `created_at` are `$defaultFn` generators, which only
      // the builder runs. Read-then-insert is safe because a seed runs inside `withTransaction`,
      // which holds the file's write lock for its whole body.
      const existingDepartment = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.isDefault, true), eq(departments.active, true)))
        .limit(1);
      let departmentId = existingDepartment[0]?.id;
      if (departmentId === undefined) {
        await tx
          .update(departments)
          .set({ isDefault: false })
          .where(eq(departments.isDefault, true));
        const [replacement] = await tx
          .select({ id: departments.id })
          .from(departments)
          .where(eq(departments.active, true))
          .orderBy(asc(departments.name), asc(departments.id))
          .limit(1);
        if (replacement !== undefined) departmentId = replacement.id;
        else {
          const [inserted] = await tx
            .insert(departments)
            .values({
              name: venue.name,
              tradingName: venue.name,
              isDefault: true,
            })
            .returning({ id: departments.id });
          departmentId = inserted!.id;
          await addStarterServiceSteps(tx, departmentId, staffLanguage);
          const tenant = await readTenant(tx);
          const courses =
            tenant === null ? [] : (getCountryPack(tenant.country)?.starterCourses ?? []);
          if (courses.length > 0) {
            await tx.insert(kitchenCourses).values(
              courses.map(({ name, heldUntilFired }, displayOrder) => ({
                name: starterName(STARTER_COURSE_NAMES, name, staffLanguage),
                displayOrder,
                heldUntilFired,
              })),
            );
          }
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
        .select({ zoneId: floorZones.id })
        .from(floorZones)
        .innerJoin(departments, eq(departments.id, floorZones.departmentId))
        .where(
          and(
            eq(floorZones.isCounterDefault, true),
            eq(floorZones.active, true),
            eq(departments.active, true),
          ),
        )
        .limit(1);
      if (existing.length === 0) {
        await tx
          .update(floorZones)
          .set({ isCounterDefault: false })
          .where(eq(floorZones.isCounterDefault, true));
        await tx
          .insert(floorZones)
          .values({
            name: starterName(STARTER_ZONE_NAMES, COUNTER_ZONE_NAME, staffLanguage),
            displayOrder: 0,
            active: true,
            departmentId,
            isCounterDefault: true,
          })
          .onConflictDoUpdate({
            target: [floorZones.name],
            targetWhere: sql`${floorZones.active} = 1`,
            set: { departmentId, isCounterDefault: true },
          });
      }
      const policy = await tx
        .select({
          zoneId: floorZones.id,
          departmentId: floorZones.departmentId,
        })
        .from(floorZones)
        .innerJoin(departments, eq(departments.id, floorZones.departmentId))
        .where(
          and(
            eq(floorZones.isCounterDefault, true),
            eq(floorZones.active, true),
            eq(departments.active, true),
          ),
        )
        .limit(1);
      const zoneId = policy[0]!.zoneId;
      await ensureDefaultSeasons(tx, staffLanguage);
      const menuId = await readDefaultCatalogueId(tx);
      if (menuId !== null) {
        const counterDepartmentId = policy[0]!.departmentId;
        await placeOpenPeriod(tx, counterDepartmentId, menuId, staffLanguage);
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
        await setProfileServiceScope(tx, id, {
          departmentId: policy[0]!.departmentId,
          allowedZoneIds: null,
          startingZoneId: zoneId,
        });
      }
      return "default department and counter zone ready";
    },
  },
};
