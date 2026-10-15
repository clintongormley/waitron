import type { RecordExportDocument } from "@waitron/shared";
import { jobOrigin, locationId as brandLocationId } from "@waitron/shared";
import { locations, withTransaction, type Database } from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { persons } from "@waitron/identity";
import { WorkforceBackend, closePayPeriod } from "@waitron/workforce";
import { prepareTimeRecordExport } from "@waitron/workforce-es";

export const longReason = `${Array.from({ length: 90 }, (_, i) => `Paragraph ${i}: María Muñoz — José, niñez; an explanation of the recorded change.`).join("\n")}\nREASON-FINAL-MARKER`;
export const longToken = "LONGTOKEN".repeat(100);

export async function seedAttendanceExport(db: Database) {
  await seedTenant(db);
  const [location] = await db
    .insert(locations)
    .values({
      name: "Charcutería",
      invoiceLocales: ["es"],
      operationDescription: "Sale on premises",
    })
    .returning();
  const locationId = location!.id;
  const nodeId = await seedNode(db, brandLocationId(locationId));
  const [worker, manager] = await db
    .insert(persons)
    .values([
      {
        displayName: "María Muñoz",
        email: "CONTACT-CANARY@example.test",
        telephone: "+34999111222",
        firstNames: "PROFILE-CANARY",
        role: "staff",
      },
      {
        displayName: "José",
        email: "MANAGER-CONTACT@example.test",
        passwordHash: "LOGIN-CANARY",
        role: "manager",
      },
    ])
    .returning();
  const backend = new WorkforceBackend();
  const origin = jobOrigin("dashboard");
  const period = { start: "2026-01-01", end: "2026-02-01" };
  const run = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(db, fn);
  const event = (at: string) => ({
    nodeId,
    locationId,
    personId: worker!.id,
    offsetMinutes: 60,
    origin,
    at,
  });
  await run((tx) => backend.clockIn(tx, event("2026-01-05T08:00:00Z")));
  await run((tx) => backend.clockOut(tx, event("2026-01-05T16:00:00Z")));
  const record = await run((tx) => backend.timeRecord(tx, { locationId, period }));
  const target = record.entries.find((e) => e.entry.entryKind === "out")!.entry.entryId;
  const correction = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: target,
      at: "2026-01-05T17:00:00Z",
      offsetMinutes: 60,
      reason: "ID-NUMBER-CANARY reason for change",
      actorPersonId: worker!.id,
      origin,
    }),
  );
  await run((tx) =>
    backend.approveCorrection(tx, {
      nodeId,
      correctionId: correction,
      approverPersonId: manager!.id,
    }),
  );
  const closure = await run((tx) =>
    closePayPeriod(tx, {
      nodeId,
      locationId,
      period,
      clock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      now: "2026-02-01T06:00:00Z",
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      origin,
    }),
  );
  return {
    personId: worker!.id,
    managerId: manager!.id,
    locationId,
    nodeId,
    closure,
    document: async (audience: "standard" | "representatives", locale: "en" | "es" = "en") => {
      const format = await run((tx) =>
        prepareTimeRecordExport(tx, { locationId, period, audience, locale }),
      );
      return format();
    },
  };
}

export function attendanceExportFixture(
  audience: "standard" | "representatives" = "standard",
): RecordExportDocument {
  return {
    title: "Registro de jornada — María Muñoz",
    locale: "es",
    audience,
    period: { start: "2020-01-01", end: "2026-02-01" },
    notes: ["Solo cuentan los turnos completados. NOTE-MARKER", "Antes de no está incluido."],
    sections: [
      {
        key: "sessions",
        title: "Trabajo completado",
        layout: "table",
        columns: [
          { key: "personName", label: "Persona" },
          { key: "workedMinutes", label: "Minutos" },
        ],
        rows: [
          {
            key: "session-one",
            cells: { personName: "María Muñoz SESSION-MARKER", workedMinutes: 480 },
          },
        ],
      },
      {
        key: "history",
        title: "Historial de decisiones",
        layout: "details",
        columns: [
          { key: "authorName", label: "Autor" },
          { key: "offsetMinutes", label: "Desfase UTC" },
          { key: "confirmedByWorker", label: "Confirmado" },
          { key: "correctsEntryId", label: "Corrige" },
          { key: "text", label: "Texto" },
          { key: "token", label: "Referencia larga" },
          ...(audience === "standard" ? [{ key: "reason", label: "Motivo" }] : []),
        ],
        rows: [
          {
            key: "history-one",
            cells: {
              authorName: "José AUTHOR-MARKER",
              offsetMinutes: -60,
              confirmedByWorker: true,
              correctsEntryId: null,
              text: "<script>alert(1)</script> /OpenAction https://example.test/ \u0000 \u0001 😀 TEXT-FINAL",
              token: longToken,
              ...(audience === "standard" ? { reason: longReason } : {}),
            },
          },
        ],
      },
      ...[
        "metadata",
        "totals",
        "closures",
        "entry-closures",
        "frozen-sessions",
        "frozen-history",
        "frozen-summaries",
        "frozen-days",
        "automatic-marks",
        "impacts",
      ].map((key, i) => ({
        key,
        title: `Apartado ${i}`,
        layout: "details" as const,
        columns: [
          { key: "reference", label: "Referencia" },
          { key: "value", label: "Valor" },
        ],
        rows: [
          { key: `row-${i}`, cells: { reference: `MARKER${i}END`, value: i % 2 ? false : "" } },
        ],
      })),
    ],
  };
}
