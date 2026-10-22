import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { staticResolver, fakeClient, steadyClock } from "../test/write-path-fixtures.js";
import { TEST_SISTEMA } from "./testing/seed.js";
import { VerifactuBackend } from "./backend.js";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";

/** Each reading with whether its date, in its own offset, falls before 28-10-2024. */
const BOUNDARY: { iso: string; offsetMinutes: number; refused: boolean }[] = [
  { iso: "2024-10-27T22:59:59.999Z", offsetMinutes: 60, refused: true },
  { iso: "2024-10-27T23:00:00.000Z", offsetMinutes: 60, refused: false },
  { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 0, refused: true },
  { iso: "2024-10-27T23:30:00.000Z", offsetMinutes: 60, refused: false },
  { iso: "2024-10-28T00:00:00.000Z", offsetMinutes: -60, refused: true },
  { iso: "2026-10-21T11:00:00.000Z", offsetMinutes: 120, refused: false },
];

const refuses = (reading: { instant: Date; offsetMinutes: number }): boolean => {
  try {
    refuseBeforeFirstIssueDate(reading);
    return false;
  } catch {
    return true;
  }
};

/** A record free of every blocking issue but its date, which the control case below checks. */
function recordDatedBy(instant: Date, offsetMinutes: number) {
  const input: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: "FS/1",
    FechaExpedicionFactura: instant,
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [
      {
        ClaveRegimen: "01",
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "100.00",
        TipoImpositivo: "21.00",
        CuotaRepercutida: "21.00",
      },
    ],
    CuotaTotal: "21.00",
    ImporteTotal: "121.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: instant,
    offsetMinutes,
  };
  return buildAltaRecord(input);
}

describe("refuseBeforeFirstIssueDate", () => {
  it("refuses a reading in 2001 with the reading's instant", () => {
    expect(() =>
      refuseBeforeFirstIssueDate({
        instant: new Date("2001-01-01T11:00:00.000Z"),
        offsetMinutes: 60,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "clock.unusable",
        params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
      }),
    );
  });

  it.each(BOUNDARY)(
    "judges $iso at offset $offsetMinutes by its own date (refused: $refused)",
    ({ iso, offsetMinutes, refused }) => {
      const reading = { instant: new Date(iso), offsetMinutes };
      if (refused) {
        expect(() => refuseBeforeFirstIssueDate(reading)).toThrow(
          expect.objectContaining({
            code: "clock.unusable",
            params: { clockAt: iso, offsetMinutes },
          }),
        );
      } else {
        expect(refuseBeforeFirstIssueDate(reading)).toBeUndefined();
      }
    },
  );

  it("agrees with the library on every boundary reading", () => {
    const control = recordDatedBy(new Date("2026-10-21T11:00:00.000Z"), 120);
    expect(validate(control).filter((issue) => issue.severity === "error")).toEqual([]);

    for (const { iso, offsetMinutes } of BOUNDARY) {
      const instant = new Date(iso);
      const record = recordDatedBy(instant, offsetMinutes);
      const libraryRefuses = validate(record, { now: instant }).some(
        (issue) => issue.code === "FECHA_EXPEDICION_BEFORE_MINIMUM",
      );
      expect({ iso, offsetMinutes, refused: libraryRefuses }).toEqual({
        iso,
        offsetMinutes,
        refused: refuses({ instant, offsetMinutes }),
      });
    }
  });
});

describe("VerifactuBackend refuses the same readings", () => {
  const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

  it("refuses a 2001 reading and accepts the first accepted day's first instant", () => {
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
    const reading = { instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 };
    expect(() => backend.assertRecordableAt(reading)).toThrow(
      expect.objectContaining({
        code: "clock.unusable",
        params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
      }),
    );
    expect(() =>
      backend.assertRecordableAt({
        instant: new Date("2024-10-27T23:00:00.000Z"),
        offsetMinutes: 60,
      }),
    ).not.toThrow();
  });
});
