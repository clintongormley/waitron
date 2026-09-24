import { addDecimal, decimal, percentOf } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import type { LiquidationPeriod } from "./period.js";
import type { VatReturn } from "./types.js";

/**
 * Maps a `computeVatReturn` result onto the official modelo 303 casillas (boxes).
 *
 * Every box NUMBER and every SUMMATION below is transcribed from the AEAT-published record design
 * DR303e26.xlsx (modelo 303 diseño de registro, ejercicio 2026, version 1.01; md5
 * `e42cbe6baf7f21dd95c274b4c6f11bbe`), committed at `packages/reporting/reference/DR303e26.xlsx` and
 * machine-extracted into `dr303-layout.ts`, which places each box this map fills.
 *
 * Out of scope, so NOT emitted: importaciones (32–35), intracomunitarias (36–39), rectificación de
 * deducciones (40/41), compensaciones REAGP (42), regularización de bienes de inversión (43),
 * prorrata definitiva (44), and the annual/carry-forward boxes (68/77/78/108/109/70). The result
 * formulas below take those as ZERO, which is exact for a monthly deli return with none of them.
 */
export interface Modelo303 {
  year: number;
  /** The liquidation period the boxes are FOR (month/quarter/year). */
  period: LiquidationPeriod;
  /**
   * Every populated box, keyed by its official casilla number as a string, at least two digits
   * ("07", "150"), value as a `Decimal` string. The DR303 writer places each value by its casilla
   * number. A rate box (tipo) holds the rate itself (e.g. "21.00"); every other
   * box holds a money amount. Absent devengado rates emit no box (blank on the form); the deducible
   * boxes 28–31 are always present (0.00 when the kind has no lines).
   */
  boxes: Record<string, Decimal>;
}

// The devengado per-rate box triple [base, rate(tipo), cuota]. The 5% row (153/154/155) is gone from
// the 2026 form, so a 5% line is refused rather than misfiled.
const DEVENGADO_BOXES: Readonly<
  Record<string, readonly [baseBox: string, rateBox: string, taxBox: string]>
> = {
  "4.00": ["01", "02", "03"],
  "10.00": ["04", "05", "06"],
  "21.00": ["07", "08", "09"],
  "0.00": ["150", "151", "152"],
};

const ZERO = decimal("0.00");
/** % atribuible al Estado for a common-territory-only deli. */
const STATE_SHARE_PERCENT = decimal("100.00");

export function mapModelo303(vatReturn: VatReturn): Modelo303 {
  const boxes: Record<string, Decimal> = {};

  // IVA devengado (output) — one base/rate/cuota triple per rate present.
  for (const line of vatReturn.byRate) {
    const triple = DEVENGADO_BOXES[line.rate];
    if (triple === undefined) {
      // A rate with no box (e.g. the retired 5%): refuse rather than invent a box number.
      throw new Error(
        `reporting: modelo 303 has no devengado box for rate ${line.rate} (verified rates: 0.00, 4.00, 10.00, 21.00)`,
      );
    }
    const [baseBox, rateBox, taxBox] = triple;
    boxes[baseBox] = line.base;
    boxes[rateBox] = line.rate; // the tipo box holds the rate itself
    boxes[taxBox] = line.tax;
  }

  // IVA deducible (input) — corrientes (kind ordinary) → 28/29, bienes de inversión (kind capital) →
  // 30/31. Aggregated across rates (the form's deducible boxes carry no per-rate split). Always emitted.
  let ordinaryBase = ZERO;
  let ordinaryTax = ZERO;
  let capitalBase = ZERO;
  let capitalTax = ZERO;
  for (const line of vatReturn.deductible.byRate) {
    if (line.kind === "capital") {
      capitalBase = addDecimal(capitalBase, line.base);
      capitalTax = addDecimal(capitalTax, line.tax);
    } else {
      ordinaryBase = addDecimal(ordinaryBase, line.base);
      ordinaryTax = addDecimal(ordinaryTax, line.tax);
    }
  }
  boxes["28"] = ordinaryBase;
  boxes["29"] = ordinaryTax;
  boxes["30"] = capitalBase;
  boxes["31"] = capitalTax;

  // Totals + result. Box-lists confirmed against DR303e26.xlsx (sheet DP30301).
  //
  // Casilla 27 (field 67, "Total cuota devengada"): the official 2026 summation is
  //   [152] + [167] + [03] + [155] + [06] + [09] + [11] + [13] + [15] + [158] + [170] + [18] + [21] +
  //   [24] + [26].
  // For a régimen-general deli the in-scope cuota boxes are exactly the ones this map populates — 152
  // (0 %), 03 (4 %), 06 (10 %), 09 (21 %) — and every other operand is out of scope and therefore ZERO:
  // 167/155 (other 0 %-rate rows), 158/170 (recargo cuotas), 11/13 (intracom / ISP), 15 (modificación),
  // 18/21/24/26 (recargo / recargo modificación). So 27 == `vatReturn.taxTotal`.
  boxes["27"] = vatReturn.taxTotal;
  //
  // Casilla 45 (field 85, "Total a deducir"): official 2026 summation is
  //   [29] + [31] + [33] + [35] + [37] + [39] + [41] + [42] + [43] + [44].
  // In scope: 29 (corrientes cuota) + 31 (inversión cuota); out of scope → ZERO: 33/35 (importaciones),
  // 37/39 (intracomunitarias), 41 (rectificación), 42 (REAGP), 43/44 (regularización / prorrata). So
  // 45 == 29 + 31 == `vatReturn.deductible.taxTotal`, exactly.
  boxes["45"] = vatReturn.deductible.taxTotal;
  //
  // Casilla 46 (field 86): "Resultado régimen general ( [27] - [45] )", which is `vatReturn.result`.
  // Type N (signed): a net-credit month renders with the `N` prefix.
  boxes["46"] = vatReturn.result;

  // Result cascade on página 3 (DR303e26.xlsx sheet DP30303), out-of-scope operands ZERO:
  //   64 (field 16) "Suma de resultados ( [46] + [58] + [76] )": 58 (resultado régimen simplificado,
  //      página 2) and 76 (regularización art. 80.cinco) are out of scope → 64 == 46.
  //   65 (field 17) "% Atribuible a la Administración del Estado" = 100 for a common-territory deli.
  //   66 (field 18) "Atribuible al Estado" = 64 × 65 / 100.
  //   69 (field 25) "Resultado de la autoliquidación ( [66] + [77] - [78] + [68] + [108] )": 77 (IVA
  //      importación Aduana), 78 (compensación periodos anteriores), 68 (regularización anual), 108
  //      (ajuste rectificativa) out of scope → 69 == 66.
  //   71 (field 29) "Resultado ( [69] - [70] + [109] - [112] )": 70 (ingresos previos), 109
  //      (devoluciones acordadas), 112 (pago a cuenta gasolinas mod. 319) out of scope → 71 == 69.
  boxes["64"] = boxes["46"];
  boxes["65"] = STATE_SHARE_PERCENT;
  boxes["66"] = percentOf(boxes["64"], STATE_SHARE_PERCENT);
  boxes["69"] = boxes["66"];
  boxes["71"] = boxes["69"];

  // No casilla 67: the común, DP30301 and DP30303 sheets extracted from DR303e26.xlsx carry none
  // (compensation of prior-period credits flows through 110/78/87 on página 3). Página 2 and the
  // DID/domiciliación sheet were not extracted, so this says nothing about them.

  // The box arithmetic never looks at the period; the period is passed through, so a quarterly
  // VatReturn maps to the same boxes a monthly one with identical figures would.
  return { year: vatReturn.year, period: vatReturn.period, boxes };
}
