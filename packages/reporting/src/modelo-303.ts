import { addDecimal, decimal, percentOf } from "@waitron/shared";
import type { Decimal, TenantId } from "@waitron/shared";
import type { VatReturn } from "./types.js";

/**
 * Maps a `computeVatReturn` result onto the official modelo 303 casillas (boxes).
 *
 * SOURCES AND VERIFICATION (CLAUDE.md §1). Every box NUMBER below is from the spec's §7 casilla map,
 * whose provenance table (§13) sources it to AEAT Instrucciones 2026 unless flagged. The box numbers
 * used here — the devengado per-rate triples 01–09 and 150–152, the deducible pairs 28/29 (corrientes)
 * and 30/31 (bienes de inversión), the result boxes 46/64/65/66/69/71 and their formulas — are the
 * VERIFIED subset. Two things the spec marks **[UNVERIFIED — confirm against DR303]** are handled
 * conservatively rather than invented:
 *
 *   - **Casillas 27 and 45** (total cuota devengada / total a deducir): the exact official SUMMATION
 *     box-list is unverified. Here they are the sum of the régimen-general boxes this deli actually
 *     files — 27 = `vatReturn.taxTotal` (Σ of the populated devengado cuota boxes), 45 =
 *     `vatReturn.deductible.taxTotal` (28/29 + 30/31). For a deli with only domestic régimen-general
 *     operations that IS the whole sum; whether the official 27/45 also fold in out-of-scope boxes
 *     (importaciones, intracomunitarias, modificaciones…) is a **TODO: confirm against the DR303
 *     diseño de registro** (spec §7/§13). No box-list is hardcoded as the official definition.
 *   - **Casilla 67** (which an earlier draft named for prior-period compensation) **could not be
 *     located on the current form** (spec §7: two sources returned not-found; compensation now flows
 *     through 78). It is therefore **NOT emitted** — a **TODO: confirm 67's status against DR303**
 *     rather than a guessed value.
 *
 * The full DR303 record layout (Slice D) is the machine-readable primary source for the box positions;
 * this map delivers the casilla-mapped aggregate it will consume, and stands alone as something an
 * operator can read box-by-box.
 *
 * DEFERRED / OUT OF SCOPE (spec §11), so deliberately NOT emitted here: importaciones (32–35),
 * intracomunitarias (36–39), rectificación de deducciones (40/41), compensaciones REAGP (42),
 * regularización de bienes de inversión (43), prorrata definitiva (44), and the annual/carry-forward
 * boxes (68/77/78/108/109/70). The result formulas below use those as ZERO inputs, which is exact for a
 * monthly deli return with none of them; a comment marks each such zero.
 */
export interface Modelo303 {
  tenantId: TenantId;
  year: number;
  month: number;
  /**
   * Every populated box, keyed by its official casilla number (as a string, zero-free e.g. "07",
   * "150"), value as a `Decimal` string. The serializer-facing surface: DR303 (Slice D) positions each
   * value by its casilla number. A rate box (tipo) holds the rate itself (e.g. "21.00"); every other
   * box holds a money amount. Absent devengado rates emit no box (blank on the form); the deducible
   * boxes 28–31 are always present (0.00 when the kind has no lines).
   */
  boxes: Record<string, Decimal>;
}

// The devengado per-rate box triple [base, rate(tipo), cuota] per VERIFIED rate (spec §7). 4% → 01/02/03,
// 10% → 04/05/06, 21% → 07/08/09, 0% → 150/151/152. The 5% row (153/154/155) is GONE from the 2026 form
// (the temporary energy rate expired), so it is absent here and a 5% line is refused rather than misfiled.
const DEVENGADO_BOXES: Readonly<
  Record<string, readonly [baseBox: string, rateBox: string, taxBox: string]>
> = {
  "4.00": ["01", "02", "03"],
  "10.00": ["04", "05", "06"],
  "21.00": ["07", "08", "09"],
  "0.00": ["150", "151", "152"],
};

const ZERO = decimal("0.00");
/** % atribuible al Estado for a common-territory-only deli (spec §7, VERIFIED for that case). */
const STATE_SHARE_PERCENT = decimal("100.00");

export function mapModelo303(vatReturn: VatReturn): Modelo303 {
  const boxes: Record<string, Decimal> = {};

  // IVA devengado (output) — one base/rate/cuota triple per rate present, by its VERIFIED box number.
  for (const line of vatReturn.byRate) {
    const triple = DEVENGADO_BOXES[line.rate];
    if (triple === undefined) {
      // A rate with no VERIFIED box (e.g. the retired 5%): refuse rather than invent a box number.
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

  // Totals + result. 27/45 are the in-scope sums (see the [UNVERIFIED] note above); 46 = 27 − 45 is
  // VERIFIED arithmetic and already computed as `vatReturn.result`.
  boxes["27"] = vatReturn.taxTotal; // total cuota devengada (in-scope: Σ populated devengado cuotas)
  boxes["45"] = vatReturn.deductible.taxTotal; // total a deducir (in-scope: 29 + 31)
  boxes["46"] = vatReturn.result; // resultado régimen general = 27 − 45

  // 64 suma de resultados = 46 for a single-regime deli (the general formula sums other-regime results,
  // which are out of scope → 0). 65 = % Estado (100, common-territory). 66 = 64 × 65/100 (VERIFIED
  // formula). 69 = 66 + 77 − 78 + 68 + 108, with 77/78/68/108 out of scope = 0 → 66. 71 = 69 − 70 + 109,
  // with 70/109 out of scope = 0 → 69.
  boxes["64"] = boxes["46"];
  boxes["65"] = STATE_SHARE_PERCENT;
  boxes["66"] = percentOf(boxes["64"], STATE_SHARE_PERCENT);
  boxes["69"] = boxes["66"];
  boxes["71"] = boxes["69"];

  // Casilla 67 deliberately NOT emitted — TODO: confirm its status against the DR303 record design
  // (spec §7: not located on the current form).

  return { tenantId: vatReturn.tenantId, year: vatReturn.year, month: vatReturn.month, boxes };
}
