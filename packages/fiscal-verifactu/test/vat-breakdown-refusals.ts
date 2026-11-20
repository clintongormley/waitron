import { buildAltaRecord, validate } from "@waitron/verifactu";
import { sumDecimals } from "@waitron/shared";
import type { VatBreakdownLine } from "@waitron/fiscal";
import { toDetalleDesglose } from "../src/backend.js";

/** The code `@waitron/verifactu`'s `validate` gives a VAT line whose VAT has the wrong sign. */
export const VAT_SIGN_REFUSAL = "S1_CUOTA_REPERCUTIDA_SIGN";

/**
 * The error codes `@waitron/verifactu`'s `validate` gives an ordinary invoice (F2) filing this
 * VAT breakdown, each line shaped as the backend files it. The total is the breakdown's own.
 */
export function refusalsForVatBreakdown(
  breakdown: readonly VatBreakdownLine[],
  options: { now: Date },
): string[] {
  const { now } = options;
  const record = buildAltaRecord({
    IDEmisorFactura: "B12345674",
    NumSerieFactura: "T/1",
    FechaExpedicionFactura: now,
    NombreRazonEmisor: "Prueba",
    TipoFactura: "F2",
    DescripcionOperacion: "Prueba",
    Desglose: breakdown.map(toDetalleDesglose),
    CuotaTotal: sumDecimals(breakdown.map((line) => line.tax)),
    ImporteTotal: sumDecimals(breakdown.flatMap((line) => [line.base, line.tax])),
    SistemaInformatico: {
      NombreRazon: "Prueba",
      NIF: "B12345674",
      NombreSistemaInformatico: "Prueba",
      IdSistemaInformatico: "01",
      Version: "1",
      NumeroInstalacion: "1",
      TipoUsoPosibleSoloVerifactu: "S",
      TipoUsoPosibleMultiOT: "N",
      IndicadorMultiplesOT: "N",
    },
    Encadenamiento: { PrimerRegistro: "S" },
    generadoEn: now,
    offsetMinutes: 0,
  });
  return validate(record, { now })
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
}
