import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import { locationId } from "@waitron/shared";
import { departments, readOpeningHoursModel } from "@waitron/venue-service";

export async function readSetupOpeningHours(
  db: Database,
  venue: { locationId: string },
): Promise<{ departmentId: string } | undefined> {
  const tables = await db.execute(
    sql`select name from sqlite_master where type = 'table' and name = 'menu_periods'`,
  );
  if (tables.rows.length === 0) return undefined;
  const [first] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.locationId, venue.locationId), eq(departments.isDefault, true)));
  if (first === undefined) return undefined;
  const model = await readOpeningHoursModel(
    db,
    { locationId: locationId(venue.locationId) },
    new Date(),
  );
  const department = model.departments.find(({ id }) => id === first.id)!;
  if (!department.active || department.periods.length !== 1) return undefined;
  const period = department.periods[0]!;
  if (period.name !== "Open") return undefined;
  const matches = department.week.every(({ weekday, slots }) =>
    weekday === 0 || weekday === 6
      ? slots.length === 0
      : slots.length === 1 &&
        slots[0]!.periodId === period.id &&
        slots[0]!.startsAt === "09:00" &&
        slots[0]!.endsAt === "17:00",
  );
  return matches ? { departmentId: first.id } : undefined;
}
