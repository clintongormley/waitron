import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { TEST_SISTEMA } from "./testing/seed.js";
import { validateVenueFiscalFields } from "./venue-fields.js";

/** One alta built around a candidate invoice number, so the record validator's own verdict on the
 * CHARACTER SET can be compared with what the boundary check said about the series code it came
 * from. `F2` and no `TipoImpositivo` keep every other rule satisfied, so the only issue this
 * record can produce is the one under test. */
function recordFor(numSerie: string) {
  const input: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: numSerie,
    FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
    NombreRazonEmisor: "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: "Venta en establecimiento",
    Desglose: [
      {
        CalificacionOperacion: "S1",
        BaseImponibleOimporteNoSujeto: "111.10",
        CuotaRepercutida: "12.35",
      },
    ],
    CuotaTotal: "12.35",
    ImporteTotal: "123.45",
    Encadenamiento: { PrimerRegistro: "S" },
    SistemaInformatico: TEST_SISTEMA,
    generadoEn: new Date("2024-01-01T19:20:30+01:00"),
    offsetMinutes: 60,
  };
  return buildAltaRecord(input);
}

const GOOD = {
  legalName: "Waitron SL",
  seriesCode: "FS",
  rectificativeSeriesCode: "FR",
  operationDescription: "Venta en establecimiento",
};

// The LENGTH rules deliberately DISAGREE and are not compared here: the boundary refuses a base
// over 38 characters so a cold restore's `-<installation number>` suffix still fits, while the
// record validator accepts NumSerieFactura up to 60. A future reader must not "fix" that.
describe("the restated character set matches the record validator's", () => {
  it.each(["Serie A", "Série A", "FAC 1", "FS", "A-2026", "A/B"])(
    "gives the same CHARACTER-SET verdict as validate() for %j",
    (code) => {
      let boundaryRefused = false;
      try {
        validateVenueFiscalFields({ ...GOOD, seriesCode: code });
      } catch {
        boundaryRefused = true;
      }
      // Every case here is far under NumSerieFactura's 60-character cap, so the only error the
      // record validator can raise against this field is the charset one — which is what makes a
      // field-name filter a character-set comparison and not a length one.
      const validatorRefused = validate(recordFor(`${code}/1`)).some(
        (issue) => issue.field === "NumSerieFactura" && issue.severity === "error",
      );
      expect(boundaryRefused).toBe(validatorRefused);
    },
  );
});
