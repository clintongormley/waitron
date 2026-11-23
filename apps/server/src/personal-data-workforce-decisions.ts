import type { Database } from "@waitron/db";
import { jsonFile, type PersonalDataPart, type WaitronModule } from "@waitron/module";
import { absences, attendanceAnswers, rosterVersions, shiftSwaps } from "@waitron/workforce";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { byTime, readHistory } from "./personal-data-service-actions.js";

const FILE = "workforce-decisions.json";

async function workforceDecisions(db: Database, personId: string) {
  const absenceDecisions = await readHistory(db, absences, (range) =>
    db
      .select({ id: absences.id, outcome: absences.status, at: absences.decidedAt })
      .from(absences)
      .where(and(range, eq(absences.decidedByPersonId, personId), ne(absences.personId, personId)))
      .all(),
  );
  const swaps = await readHistory(db, shiftSwaps, (range) =>
    db
      .select({ id: shiftSwaps.id, outcome: shiftSwaps.status, at: shiftSwaps.decidedAt })
      .from(shiftSwaps)
      .where(
        and(
          range,
          eq(shiftSwaps.decidedByPersonId, personId),
          ne(shiftSwaps.requestedByPersonId, personId),
          ne(shiftSwaps.toPersonId, personId),
        ),
      )
      .all(),
  );
  const rotas = await readHistory(db, rosterVersions, (range) =>
    db
      .select({
        id: rosterVersions.id,
        periodStart: rosterVersions.periodStart,
        periodEnd: rosterVersions.periodEnd,
        at: rosterVersions.publishedAt,
      })
      .from(rosterVersions)
      .where(
        and(
          range,
          eq(rosterVersions.publishedByPersonId, personId),
          isNotNull(rosterVersions.publishedAt),
        ),
      )
      .all(),
  );
  const attendance = await readHistory(db, attendanceAnswers, (range) =>
    db
      .select({
        id: attendanceAnswers.id,
        action: attendanceAnswers.action,
        at: attendanceAnswers.createdAt,
      })
      .from(attendanceAnswers)
      .where(
        and(
          range,
          eq(attendanceAnswers.authorizedByPersonId, personId),
          ne(attendanceAnswers.personId, personId),
        ),
      )
      .all(),
  );

  return {
    absences: absenceDecisions.sort(byTime),
    swaps: swaps.sort(byTime),
    rotas: rotas.sort(byTime),
    attendance: attendance.sort(byTime),
  };
}

export function workforceDecisionsPersonalData(
  modules: readonly WaitronModule[],
  db: Database,
): PersonalDataPart[] {
  if (!modules.some((module) => module.name === "workforce")) return [];
  return [
    {
      owner: "server",
      part: {
        files: [FILE],
        prepare:
          async (_tx, { personId }) =>
          async () => {
            const data = await workforceDecisions(db, personId);
            return Object.values(data).some((rows) => rows.length > 0)
              ? [jsonFile(FILE, data)]
              : [];
          },
      },
    },
  ];
}
