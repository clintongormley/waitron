import { asc, eq, sql } from "drizzle-orm";
import { kitchenStations } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { ModulePersonalData } from "@waitron/module";
import { departments } from "@waitron/venue-service";
import { localWallClock, shifts } from "@waitron/workforce";
import { personStaffRoles, shiftAssignments, staffRoles } from "./schema/staffing.js";

export const STAFFING_PERSONAL_DATA: ModulePersonalData = {
  files: ["staff-roles.json"],

  async prepare(tx: Transaction, { personId }) {
    const roleRows = await tx
      .select({ name: staffRoles.name })
      .from(personStaffRoles)
      .innerJoin(staffRoles, eq(staffRoles.id, personStaffRoles.staffRoleId))
      .where(eq(personStaffRoles.personId, personId))
      .orderBy(asc(staffRoles.name), asc(staffRoles.id));

    const shiftRows = await tx
      .select({
        startsAt: shifts.startsAt,
        startsOffsetMinutes: shifts.startsOffsetMinutes,
        endsAt: shifts.endsAt,
        endsOffsetMinutes: shifts.endsOffsetMinutes,
        area: sql<string>`coalesce(${departments.name}, ${kitchenStations.name})`,
        staffRole: staffRoles.name,
      })
      .from(shiftAssignments)
      .innerJoin(shifts, eq(shifts.id, shiftAssignments.shiftId))
      .innerJoin(staffRoles, eq(staffRoles.id, shiftAssignments.staffRoleId))
      .leftJoin(departments, eq(departments.id, shiftAssignments.departmentId))
      .leftJoin(kitchenStations, eq(kitchenStations.id, shiftAssignments.stationId))
      .where(eq(shifts.personId, personId))
      .orderBy(asc(shifts.startsAt), asc(shifts.id));

    return async () =>
      roleRows.length + shiftRows.length === 0
        ? []
        : [
            {
              name: "staff-roles.json",
              content: `${JSON.stringify(
                {
                  staffRoles: roleRows,
                  shiftRoles: shiftRows.map((row) => ({
                    startsAt: localWallClock(row.startsAt, row.startsOffsetMinutes),
                    endsAt: localWallClock(row.endsAt, row.endsOffsetMinutes),
                    area: row.area,
                    staffRole: row.staffRole,
                  })),
                },
                null,
                2,
              )}\n`,
            },
          ];
  },
};
