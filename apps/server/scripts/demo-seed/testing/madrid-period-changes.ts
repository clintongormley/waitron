import { stable, type CanonicalMadridSemantics } from "./madrid-semantics.js";

export interface MadridPeriodChange {
  /** The department's captured id, e.g. `@departments:["Restaurant and bar"]`. */
  department: string;
  /** The name of the captured period the declared ones replace. */
  replaced: string;
  periods: { name: string; colour: string; menu: string; staffMenus: string[] }[];
  /** The ranges of every weekday in every season, as stored (`HH:MM:SS`). */
  week: { period: string; startsAt: string; endsAt: string }[];
  /** The declared period and start (`HH:MM`) in force at the capture's clock. */
  occurrence: { period: string; startsAt: string };
}

const key = (table: string, ...parts: unknown[]) => `@${table}:${stable(parts)}`;

/** Replace one captured period of a department with the declared periods, and every weekday's
 * ranges of that department with the declared week. Refused: a replaced period the capture does
 * not hold, a declared period it already holds, a weekday range served by another period, a week
 * or occurrence naming an undeclared period, and any other row still referring to the replaced
 * period. A floor zone's today's occurrence of the replaced period moves to the declared one.
 * Special days are left as captured. Returns the change in row count per table. */
export function madridWithPeriodChanges(
  original: CanonicalMadridSemantics,
  change: MadridPeriodChange,
): { semantics: CanonicalMadridSemantics; added: Record<string, number> } {
  const result = structuredClone(original);
  const periods = result.tables.menu_periods!.rows;
  const staffMenus = result.tables.menu_period_staff_menus!.rows;
  const ranges = result.tables.department_day_ranges!.rows;
  const counts = [periods, staffMenus, ranges].map((rows) => Object.keys(rows).length);

  const replaced = key("menu_periods", change.department, change.replaced);
  if (!periods[replaced]) throw new Error(`Madrid replaced period not found: ${replaced}`);
  delete periods[replaced];
  for (const [rowKey, row] of Object.entries(staffMenus))
    if (row.period_id === replaced) delete staffMenus[rowKey];

  const ids = new Map<string, string>();
  for (const period of change.periods) {
    const id = key("menu_periods", change.department, period.name);
    if (periods[id]) throw new Error(`Madrid declared period already present: ${id}`);
    ids.set(period.name, id);
    periods[id] = {
      id,
      department_id: change.department,
      name: period.name,
      colour: period.colour,
      menu_id: period.menu,
      floor_plan_set_id: null,
    };
    period.staffMenus.forEach((menu, display_order) => {
      const row = { period_id: id, department_id: change.department, menu_id: menu, display_order };
      staffMenus[stable(row)] = row;
    });
  }

  const weekdays = Object.values(result.tables.department_days!.rows).filter(
    (row) => row.department_id === change.department && row.weekday !== null,
  );
  const days = new Set(weekdays.map((row) => String(row.id)));
  for (const [rowKey, row] of Object.entries(ranges)) {
    if (!days.has(String(row.day_id))) continue;
    if (row.period_id !== replaced)
      throw new Error(`Madrid range not served by the replaced period: ${rowKey}`);
    delete ranges[rowKey];
  }
  for (const dayId of days)
    for (const slot of change.week) {
      const periodId = ids.get(slot.period);
      if (!periodId) throw new Error(`Madrid week names an undeclared period: ${slot.period}`);
      const id = key("department_day_ranges", dayId, slot.startsAt, slot.endsAt);
      ranges[id] = {
        id,
        day_id: dayId,
        department_id: change.department,
        period_id: periodId,
        starts_at: slot.startsAt,
        ends_at: slot.endsAt,
      };
    }

  const current = ids.get(change.occurrence.period);
  if (!current)
    throw new Error(`Madrid occurrence names an undeclared period: ${change.occurrence.period}`);
  for (const zone of Object.values(result.tables.floor_zones!.rows)) {
    const occurrence = zone.today_occurrence as unknown[] | null;
    if (occurrence?.[2] === replaced)
      zone.today_occurrence = [occurrence[0], occurrence[1], current, change.occurrence.startsAt];
  }

  for (const [name, table] of Object.entries(result.tables))
    for (const [rowKey, row] of Object.entries(table.rows))
      if (stable(row).includes(stable(replaced)))
        throw new Error(`Madrid replaced period still referenced: ${name} ${rowKey}`);

  const [menuPeriods, staff, dayRanges] = [periods, staffMenus, ranges].map(
    (rows, index) => Object.keys(rows).length - counts[index]!,
  );
  return {
    semantics: result,
    added: {
      menu_periods: menuPeriods!,
      menu_period_staff_menus: staff!,
      department_day_ranges: dayRanges!,
    },
  };
}
