import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import type { ModulePersonalData, PersonalDataFile } from "@waitron/module";
import { centsToDecimal } from "@waitron/shared";
import { asc, eq } from "drizzle-orm";
import { absences } from "./schema/absences.js";
import { employments } from "./schema/employments.js";

const jsonFile = (name: string, value: unknown): PersonalDataFile => ({
  name,
  content: `${JSON.stringify(value, null, 2)}\n`,
});

/** A file is built only when the person has a row for it. */
export const WORKFORCE_PERSONAL_DATA: ModulePersonalData = {
  files: ["employment.json", "rota.json", "absences.json", "attendance.json"],

  async prepare(tx: Transaction, { personId }) {
    const employmentRows = await tx
      .select({
        contractType: employments.contractType,
        contractedMinutesPerWeek: employments.contractedMinutesPerWeek,
        startDate: employments.startDate,
        endDate: employments.endDate,
        payRate: employments.payRate,
        createdAt: employments.createdAt,
      })
      .from(employments)
      .where(eq(employments.personId, personId))
      .orderBy(asc(employments.startDate), asc(employments.createdAt), asc(employments.id));

    const absenceRows = await tx
      .select({
        kind: absences.kind,
        startsOn: absences.startsOn,
        endsOn: absences.endsOn,
        status: absences.status,
        note: absences.note,
        decidedBy: persons.displayName,
        decidedAt: absences.decidedAt,
        createdAt: absences.createdAt,
      })
      .from(absences)
      .leftJoin(persons, eq(persons.id, absences.decidedByPersonId))
      .where(eq(absences.personId, personId))
      .orderBy(asc(absences.startsOn), asc(absences.createdAt), asc(absences.id));

    return async () => [
      ...(employmentRows.length === 0
        ? []
        : [
            jsonFile("employment.json", {
              employments: employmentRows.map((row) => ({
                ...row,
                payRate: centsToDecimal(row.payRate),
              })),
            }),
          ]),
      ...(absenceRows.length === 0 ? [] : [jsonFile("absences.json", { absences: absenceRows })]),
    ];
  },
};
