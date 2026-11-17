import { and, asc, gte, inArray, lte } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rosterVersions, shifts } from "@waitron/workforce";
import { addDays } from "@waitron/venue-service";
import type { RotaShift } from "./slots.js";

export const mondayOf = (date: string): string =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

export async function readRotaRows(tx: Transaction, first: string, last: string) {
  const versions = await tx
    .select()
    .from(rosterVersions)
    .where(
      and(
        gte(rosterVersions.periodStart, first),
        lte(rosterVersions.periodStart, last),
        inArray(rosterVersions.status, ["draft", "published"]),
      ),
    );
  const selected = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!selected.has(version.periodStart) || version.status === "draft")
      selected.set(version.periodStart, version);
  }
  const ids = [...selected.values()].map((v) => v.id);
  const rows = await tx
    .select({
      shiftId: shifts.id,
      personId: shifts.personId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      startsOffsetMinutes: shifts.startsOffsetMinutes,
      endsOffsetMinutes: shifts.endsOffsetMinutes,
      versionId: shifts.rosterVersionId,
      departmentId: shifts.departmentId,
      stationId: shifts.stationId,
      staffRoleId: shifts.staffRoleId,
    })
    .from(shifts)
    .where(inArray(shifts.rosterVersionId, ids))
    .orderBy(asc(shifts.startsAt), asc(shifts.id));
  const byWeek = new Map<string, RotaShift[]>();
  for (const row of rows) {
    const week = versions.find((v) => v.id === row.versionId)!.periodStart;
    const list = byWeek.get(week) ?? [];
    const area =
      row.departmentId !== null
        ? { kind: "department" as const, id: row.departmentId }
        : row.stationId !== null
          ? { kind: "station" as const, id: row.stationId }
          : null;
    list.push({
      shiftId: row.shiftId,
      personId: row.personId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      startsOffsetMinutes: row.startsOffsetMinutes,
      endsOffsetMinutes: row.endsOffsetMinutes,
      area,
      staffRoleId: row.staffRoleId,
    });
    byWeek.set(week, list);
  }
  return { versions, selected, byWeek };
}
