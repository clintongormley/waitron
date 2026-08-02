import { projectWorkSessions, type TimeEntryRecord, type WorkSession } from "@waitron/workforce";
import { describe, expect, it } from "vitest";
import { ANOS_CONSERVACION, TITULARES_ACCESO, exportTimeRecord } from "./registro-jornada.js";

/** A projected workday, with the fields the export renders and defaults for the rest. */
function session(personId: string, workDate: string, over: Partial<WorkSession> = {}): WorkSession {
  return {
    personId,
    locationId: "loc-1",
    workDate,
    startedAt: `${workDate}T09:00:00Z`,
    endedAt: `${workDate}T17:00:00Z`,
    breakMinutes: 0,
    workedMinutes: 480,
    ...over,
  };
}

describe("exportTimeRecord", () => {
  it("renders one línea per session — inicio/fin per persona trabajadora por día (art. 34.9)", () => {
    const registro = exportTimeRecord([session("p1", "2026-01-05")], {
      start: "2026-01-05",
      end: "2026-01-12",
    });
    expect(registro.lineas).toEqual([
      {
        personId: "p1",
        fecha: "2026-01-05",
        horaInicio: "2026-01-05T09:00:00Z",
        horaFin: "2026-01-05T17:00:00Z",
        minutosTrabajados: 480,
        minutosDescanso: 0,
      },
    ]);
  });

  it("names the three titulares de acceso (art. 34.9)", () => {
    const registro = exportTimeRecord([], { start: "2026-01-05", end: "2026-01-12" });
    expect(registro.titularesAcceso).toEqual([
      "trabajador",
      "representantes_legales",
      "inspeccion_trabajo",
    ]);
    expect(TITULARES_ACCESO).toEqual(registro.titularesAcceso);
  });

  it("sets conservarHasta to period end + four years (art. 34.9 retention)", () => {
    const registro = exportTimeRecord([], { start: "2026-01-05", end: "2026-01-12" });
    expect(ANOS_CONSERVACION).toBe(4);
    expect(registro.conservarHasta).toBe("2030-01-12");
  });

  it("counts only sessions inside the half-open period", () => {
    const registro = exportTimeRecord(
      [
        session("p1", "2026-01-04"), // day before start — excluded
        session("p1", "2026-01-05"), // first day — included
        session("p1", "2026-01-12"), // end is exclusive — excluded
      ],
      { start: "2026-01-05", end: "2026-01-12" },
    );
    expect(registro.lineas.map((l) => l.fecha)).toEqual(["2026-01-05"]);
  });

  it("orders líneas by person then date for a stable registro", () => {
    const registro = exportTimeRecord(
      [session("p2", "2026-01-06"), session("p1", "2026-01-06"), session("p1", "2026-01-05")],
      { start: "2026-01-05", end: "2026-01-12" },
    );
    expect(registro.lineas.map((l) => [l.personId, l.fecha])).toEqual([
      ["p1", "2026-01-05"],
      ["p1", "2026-01-06"],
      ["p2", "2026-01-06"],
    ]);
  });

  it("reflects an approved correction through the projection (reprojection → export)", () => {
    // The whole seam end to end: a correction reprojects the work session, and the corrected end time
    // is what the registro renders — while the original clock event stays in the source stream.
    const entries: TimeEntryRecord[] = [
      {
        entryId: "in-1",
        personId: "p1",
        locationId: "loc-1",
        entryKind: "in",
        eventAt: "2026-01-05T09:00:00Z",
        offsetMinutes: 0,
        ingestSeq: 1,
      },
      {
        entryId: "out-1",
        personId: "p1",
        locationId: "loc-1",
        entryKind: "out",
        eventAt: "2026-01-05T17:00:00Z",
        offsetMinutes: 0,
        ingestSeq: 2,
      },
      {
        entryId: "corr-1",
        personId: "p1",
        locationId: "loc-1",
        entryKind: "correction",
        eventAt: "2026-01-05T18:00:00Z",
        offsetMinutes: 0,
        ingestSeq: 3,
        correctsEntryId: "out-1",
        correctionStatus: "approved",
      },
    ];
    const registro = exportTimeRecord(projectWorkSessions(entries), {
      start: "2026-01-05",
      end: "2026-01-12",
    });
    expect(registro.lineas[0]?.horaFin).toBe("2026-01-05T18:00:00Z");
    expect(registro.lineas[0]?.minutosTrabajados).toBe(540);
  });
});
