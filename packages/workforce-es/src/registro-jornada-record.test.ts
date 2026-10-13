import { beforeEach, expect, it, vi, afterEach } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons } from "@waitron/identity";
import { jobOrigin, locationId as brandedLocationId } from "@waitron/shared";
import {
  WORKFORCE_MIGRATIONS,
  WorkforceBackend,
  closePayPeriod,
  type TimeRecord,
} from "@waitron/workforce";
import { exportTimeRecord } from "./registro-jornada.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
});
const backend = new WorkforceBackend(),
  origin = jobOrigin("dashboard"),
  period = { start: "2026-01-01", end: "2026-02-01" };
const run = <T>(body: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, body);
let worker: string, manager: string, nodeId: string, locationId: string;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Deli", invoiceLocales: ["en"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  locationId = location!.id;
  nodeId = await seedNode(suite.db, brandedLocationId(locationId));
  const people = await suite.db
    .insert(persons)
    .values([
      { displayName: "Worker", pinHash: "scrypt$00$00", role: "staff" },
      { displayName: "Manager", pinHash: "scrypt$00$00", role: "manager" },
    ])
    .returning({ id: persons.id });
  [worker, manager] = people.map((p) => p.id) as [string, string];
});
afterEach(() => vi.useRealTimers());
const event = (at: string) => ({
  nodeId,
  locationId,
  personId: worker,
  at,
  offsetMinutes: 0,
  origin,
});
const record = () => run((tx) => backend.timeRecord(tx, { period, personId: worker }));
async function day(automatic = false) {
  await run((tx) => backend.clockIn(tx, event("2026-01-05T09:00:00Z")));
  const openEntryId = (await record()).entries[0]!.entry.entryId;
  if (automatic)
    return run((tx) =>
      backend.recordAutomaticClose(tx, { ...event("2026-01-05T17:00:00Z"), openEntryId }),
    );
  await run((tx) => backend.clockOut(tx, event("2026-01-05T17:00:00Z")));
  return (await record()).entries[1]!.entry.entryId;
}
const close = () =>
  run((tx) =>
    closePayPeriod(tx, {
      nodeId,
      locationId,
      period,
      clock: { timeZone: "UTC", dayCutover: "06:00", cutoverChanges: [] },
      now: "2026-02-01T06:00:00Z",
      ruleset: { workingDaysPerWeek: 5, overtimeModel: "daily-accrual", dailyTargetMinutes: null },
      origin,
    }),
  );
async function proposal(target: string, byManager: boolean) {
  return run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: target,
      at: "2026-01-05T18:00:00Z",
      offsetMinutes: 0,
      reason: "Later departure",
      actorPersonId: byManager ? manager : worker,
      origin,
    }),
  );
}
it("exports a worker request and manager approval with their separate authors and links", async () => {
  const target = await day();
  const request = await proposal(target, false);
  const answer = await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  const result = exportTimeRecord(await record(), period);
  expect(result.lineas[0]!.minutosTrabajados).toBe(540);
  expect(result.entradas!.find((e) => e.entryId === request)).toMatchObject({
    autor: { kind: "worker", personId: worker },
    direccionCorreccion: "worker_request",
    estadoCorreccion: "requested",
    corrigeEntradaId: target,
    motivo: "Later departure",
    efectiva: false,
  });
  expect(result.entradas!.find((e) => e.entryId === answer)).toEqual({
    entryId: answer,
    personId: worker,
    locationId,
    tipo: "correction",
    tipoEntradaFaltante: null,
    direccionCorreccion: "worker_request",
    estadoCorreccion: "approved",
    instante: "2026-01-05T18:00:00+00:00",
    offsetMinutes: 0,
    autor: { kind: "manager", personId: manager },
    motivo: "Later departure",
    corrigeEntradaId: target,
    respondeEntradaId: request,
    efectiva: true,
    automatica: false,
    sinConfirmar: false,
    corregida: true,
    disputada: false,
    periodosCerrados: [],
  });
});
it("exports a manager proposal and worker acceptance without erasing the original", async () => {
  const target = await day();
  const request = await proposal(target, true);
  const answer = await run((tx) =>
    backend.acceptCorrection(tx, { nodeId, correctionId: request, actorPersonId: worker, origin }),
  );
  const result = exportTimeRecord(await record(), period);
  expect(result.entradas!.find((e) => e.entryId === request)).toMatchObject({
    autor: { kind: "manager", personId: manager },
    direccionCorreccion: "manager_proposal",
    efectiva: false,
  });
  expect(result.entradas!.find((e) => e.entryId === answer)).toMatchObject({
    autor: { kind: "worker", personId: worker },
    estadoCorreccion: "approved",
    respondeEntradaId: request,
    efectiva: true,
  });
  expect(result.entradas!.find((e) => e.entryId === target)).toMatchObject({
    instante: "2026-01-05T17:00:00+00:00",
    efectiva: false,
    corregida: true,
  });
});
it("keeps both disputed departure times and the worker's reason", async () => {
  const target = await day();
  const request = await proposal(target, true);
  const answer = await run((tx) =>
    backend.disagreeCorrection(tx, {
      nodeId,
      correctionId: request,
      actorPersonId: worker,
      origin,
      reason: "I left at five",
    }),
  );
  const result = exportTimeRecord(await record(), period);
  expect(result.lineas[0]!.minutosTrabajados).toBe(480);
  expect(result.entradas!.find((e) => e.entryId === target)).toMatchObject({
    instante: "2026-01-05T17:00:00+00:00",
    disputada: true,
  });
  expect(result.entradas!.find((e) => e.entryId === request)).toMatchObject({
    instante: "2026-01-05T18:00:00+00:00",
    disputada: true,
    efectiva: false,
  });
  expect(result.entradas!.find((e) => e.entryId === answer)).toMatchObject({
    estadoCorreccion: "disputed",
    motivo: "I left at five",
    respondeEntradaId: request,
    disputada: true,
  });
});
it("exports an automatic unconfirmed end at closure and its later 60-minute amendment", async () => {
  const target = await day(true);
  const frozen = await close();
  const result = exportTimeRecord(await record(), period);
  expect(result.entradas!.find((e) => e.entryId === target)).toMatchObject({
    autor: { kind: "automatic", personId: null },
    automatica: true,
    sinConfirmar: true,
    efectiva: true,
    periodosCerrados: [frozen.id],
  });
  expect(result.cierres![0]!.snapshot.sessions[0]!.workedMinutes).toBe(480);
  const request = await proposal(target, true);
  const answer = await run((tx) =>
    backend.acceptCorrection(tx, { nodeId, correctionId: request, actorPersonId: worker, origin }),
  );
  const amended = exportTimeRecord(await record(), period);
  expect(amended.lineas[0]!.minutosTrabajados).toBe(540);
  expect(amended.cambiosPeriodosCerrados).toEqual([
    {
      closureId: frozen.id,
      personId: worker,
      beforeWorkedMinutes: 480,
      afterWorkedMinutes: 540,
      deltaWorkedMinutes: 60,
    },
  ]);
  expect(amended.entradas!.find((e) => e.entryId === target)).toMatchObject({
    autor: { kind: "automatic", personId: null },
    corregida: true,
  });
  expect(amended.entradas!.find((e) => e.entryId === answer)).toMatchObject({
    autor: { kind: "worker", personId: worker },
    automatica: false,
    estadoCorreccion: "approved",
    periodosCerrados: [frozen.id],
  });
});
it("exports missing in/out requests and a decline even when no session exists", async () => {
  const ids: string[] = [];
  for (const [missingEntryKind, at] of [
    ["in", "2026-01-05T09:00:00Z"],
    ["out", "2026-01-05T17:00:00Z"],
  ] as const)
    ids.push(
      await run((tx) =>
        backend.requestCorrection(tx, {
          nodeId,
          personId: worker,
          locationId,
          missingEntryKind,
          at,
          offsetMinutes: 0,
          reason: "Forgot",
          actorPersonId: worker,
          origin,
        }),
      ),
    );
  const declined = await run((tx) =>
    backend.declineCorrection(tx, {
      nodeId,
      correctionId: ids[0]!,
      actorPersonId: manager,
      origin,
    }),
  );
  const result = exportTimeRecord(await record(), period);
  expect(result.lineas).toEqual([]);
  expect(
    result.entradas!.map((e) => [
      e.entryId,
      e.tipoEntradaFaltante,
      e.estadoCorreccion,
      e.direccionCorreccion,
    ]),
  ).toEqual([
    [ids[0], "in", "requested", "worker_request"],
    [ids[1], "out", "requested", "worker_request"],
    [declined, "in", "declined", "worker_request"],
  ]);
});
it("follows a January target when its March-recorded decision proposes a February value", async () => {
  const target = await day();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-05T12:00:00Z"));
  const request = await run((tx) =>
    backend.requestCorrection(tx, {
      nodeId,
      correctsEntryId: target,
      at: "2026-02-01T18:00:00Z",
      offsetMinutes: 0,
      reason: "Later departure",
      actorPersonId: worker,
      origin,
    }),
  );
  const answer = await run((tx) =>
    backend.approveCorrection(tx, { nodeId, correctionId: request, approverPersonId: manager }),
  );
  const result = exportTimeRecord(await record(), period);
  expect(result.entradas!.map((e) => e.entryId)).toContain(answer);
  expect(result.entradas!.find((e) => e.entryId === answer)!.instante).toBe(
    "2026-02-01T18:00:00+00:00",
  );
});
it("filters rich input to the export period and preserves the session-only shape", async () => {
  await day();
  const january = await record();
  const unrelated = {
    ...january.entries[0]!,
    entry: { ...january.entries[0]!.entry, entryId: "march", eventAt: "2026-03-05T09:00:00.000Z" },
  };
  const rich: TimeRecord = { ...january, entries: [...january.entries, unrelated] };
  const result = exportTimeRecord(rich, period);
  expect(result.entradas!.map((e) => e.entryId)).not.toContain("march");
  const basic = exportTimeRecord(january.sessions, period);
  expect(result.lineas).toEqual(basic.lineas);
  expect(Object.keys(basic).sort()).toEqual(
    ["periodo", "conservarHasta", "titularesAcceso", "lineas"].sort(),
  );
  expect(result.conservarHasta).toBe("2030-02-01");
});
