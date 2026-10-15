import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";

export async function describeShifts(
  tx: Transaction,
  shiftIds: readonly string[],
): Promise<Map<string, string>> {
  if (shiftIds.length === 0) return new Map();
  const ids = sql.join(
    shiftIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const { rows } = await tx.execute<{
    shift_id: string;
    area_name: string;
    staff_role_name: string;
  }>(sql`
    select a.shift_id, coalesce(d.name, s.name) as area_name, r.name as staff_role_name
    from shift_assignments a
    join staff_roles r on r.id=a.staff_role_id
    left join departments d on d.id=a.department_id
    left join kitchen_stations s on s.id=a.station_id
    where a.shift_id in (${ids})`);
  return new Map(rows.map((row) => [row.shift_id, `${row.area_name} · ${row.staff_role_name}`]));
}
