import { buildAltaRecord, buildQrPayload, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { describe, expect, it } from "vitest";
import { qrModules } from "./qr-matrix.js";

/** The dot-size sweep in packages/printing/src/layout.test.ts covers these grid sizes. */
const SWEPT = { min: 37, max: 77 };

function alta(
  overrides: Pick<AltaInput, "IDEmisorFactura" | "NumSerieFactura" | "ImporteTotal">,
): AltaInput {
  return {
    ...overrides,
    FechaExpedicionFactura: new Date("2026-09-14T00:00:00+02:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        TipoImpositivo: "21.00",
        BaseImponibleOimporteNoSujeto: overrides.ImporteTotal,
        CuotaRepercutida: "0.00",
      },
    ],
    CuotaTotal: "0.00",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: {
      NombreRazon: "Waitron",
      NIF: "B12345678",
      NombreSistemaInformatico: "Waitron POS",
      IdSistemaInformatico: "WT",
      Version: "1.0.0",
      NumeroInstalacion: "001",
      TipoUsoPosibleSoloVerifactu: "S",
      TipoUsoPosibleMultiOT: "S",
      IndicadorMultiplesOT: "N",
    },
    generadoEn: new Date("2026-09-14T10:00:00+02:00"),
    offsetMinutes: 120,
  };
}

describe("the grid sizes a real receipt QR can have", () => {
  it.each([
    [
      "shortest: preproduction, 1-character series, 0.00",
      "preproduction",
      "B12345678",
      "A",
      "0.00",
      41,
    ],
    ["production, 1-character series, 0.00", "production", "B12345678", "A", "0.00", 45],
    [
      "longest series: production, 60 characters that all need escaping, -123456789012.34",
      "production",
      "B12345678",
      "/".repeat(60),
      "-123456789012.34",
      65,
    ],
    [
      "longest link: that series and a 9-character NIF of euro signs (validate.ts checks NIF length only)",
      "production",
      "€".repeat(9),
      "/".repeat(60),
      "-123456789012.34",
      69,
    ],
  ] as const)("%s", (_label, environment, nif, series, amount, squares) => {
    const record = buildAltaRecord(
      alta({ IDEmisorFactura: nif, NumSerieFactura: series, ImporteTotal: amount }),
    );
    expect(validate(record).filter((issue) => issue.severity === "error")).toEqual([]);
    const size = qrModules(buildQrPayload(record, environment)).length;
    expect(size).toBe(squares);
    expect(size).toBeGreaterThanOrEqual(SWEPT.min);
    expect(size).toBeLessThanOrEqual(SWEPT.max);
  });
});
