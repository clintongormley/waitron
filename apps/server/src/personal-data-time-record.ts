import { and, eq, sql } from "drizzle-orm";
import {
  selectTimeRecordExport,
  type ModulePersonalData,
  type PersonalDataPart,
  type WaitronModule,
} from "@waitron/module";
import { civilDateOf } from "@waitron/reporting";
import { addDays } from "@waitron/venue-service";
import { timeEntries } from "@waitron/workforce";
import { renderAttendanceCsv } from "./attendance-export-csv.js";
import { renderAttendancePdf } from "./attendance-export-pdf.js";

export const TIME_RECORD_FILES = ["time-record.pdf", "time-record.csv"] as const;

/** The person's working-time record at this node's location, through the same export seat and the
 * same call the own-export route makes. Empty unless `workforce` (whose tables the exporter reads)
 * and an exporter are both enabled. */
export function timeRecordPersonalData(modules: readonly WaitronModule[]): PersonalDataPart[] {
  const exporter = selectTimeRecordExport(modules);
  if (exporter === undefined || !modules.some((m) => m.name === "workforce")) return [];
  const localDay = sql<string>`date(${timeEntries.eventAt}, ${timeEntries.eventOffsetMinutes} || ' minutes')`;
  const part: ModulePersonalData = {
    files: TIME_RECORD_FILES,
    async prepare(tx, subject) {
      const { locationId } = subject;
      if (locationId === null) return async () => [];
      const [days] = await tx
        .select({
          first: sql<string | null>`min(${localDay})`,
          last: sql<string | null>`max(${localDay})`,
        })
        .from(timeEntries)
        .where(
          and(eq(timeEntries.personId, subject.personId), eq(timeEntries.locationId, locationId)),
        );
      if (days?.first == null || days.last == null) return async () => [];
      const today = civilDateOf(subject.at, subject.timeZone);
      const format = await exporter.prepare(tx, {
        locationId,
        personId: subject.personId,
        period: { start: days.first, end: addDays(days.last > today ? days.last : today, 1) },
        audience: "standard",
        locale: subject.language,
      });
      return async () => {
        const document = await format();
        return [
          { name: "time-record.pdf", content: await renderAttendancePdf(document) },
          { name: "time-record.csv", content: renderAttendanceCsv(document) },
        ];
      };
    },
  };
  return [{ owner: "server", part }];
}
