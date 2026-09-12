import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { TEST_SISTEMA } from "./testing/seed.js";
import { validateVenueFiscalFields } from "./venue-fields.js";

/**
 * ./venue-fields.ts restates three of `@waitron/verifactu`'s rules rather than importing them (that
 * module exports the whole-record validator, not its individual patterns). This file is the drift
 * guard for ALL THREE, and every case below is here because removing a piece of the restatement
 * flips it:
 *
 *   - the `NumSerieFactura` character set (`NUMSERIE_CHARSET` vs `NUMSERIE_PATTERN`);
 *   - the C0 control characters XML forbids (`CONTROL_CHARS` vs `CONTROL_CHAR_PATTERN`), on both
 *     fields the boundary checks — the legal name, which reaches the wire as `NombreRazonEmisor`,
 *     and the operation description;
 *   - `DescripcionOperacion`'s 500-character cap (`DESCRIPTION_MAX`), pinned at the boundary itself.
 *
 * What it deliberately does NOT pin is the series code's LENGTH rule, because the two disagree on
 * purpose: the boundary refuses a base over 38 characters so a cold restore's
 * `-<installation number>` suffix still fits, while the record validator accepts NumSerieFactura up
 * to 60. A future reader must not "fix" that.
 */

/** One alta built around the candidate values, so the record validator's own verdict can be
 * compared with what the boundary check said about the venue field it came from. `F2` and no
 * `TipoImpositivo` keep every other rule satisfied, so the only issues this record can produce are
 * the ones under test. */
function recordFor(fields: { numSerie?: string; nombre?: string; descripcion?: string }) {
  const input: AltaInput = {
    IDEmisorFactura: "89890001K",
    NumSerieFactura: fields.numSerie ?? "FS/1",
    FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
    NombreRazonEmisor: fields.nombre ?? "Waitron SL",
    TipoFactura: "F2",
    DescripcionOperacion: fields.descripcion ?? "Venta en establecimiento",
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

/** Did the boundary check refuse this venue? */
function boundaryRefuses(venue: typeof GOOD): boolean {
  try {
    validateVenueFiscalFields(venue);
    return false;
  } catch {
    return true;
  }
}

/** Did the record validator raise an ERROR against `field` on this record? */
function validatorRefuses(record: ReturnType<typeof recordFor>, field: string): boolean {
  return validate(record).some((issue) => issue.field === field && issue.severity === "error");
}

describe("the restated character set matches the record validator's", () => {
  // Every case is far under NumSerieFactura's 60-character cap, so the only error the validator can
  // raise against this field is the charset one — which is what makes a field-name filter a
  // character-set comparison and not a length one. The table covers each class of the restated
  // pattern: `a_b.c` is the case that makes dropping `a-z`, `_` or `.` visible (without it all
  // three of those drifts stayed green — measured), `A-2026` covers the hyphen, `A/B` the slash,
  // and the digits ride along in both.
  it.each(["Serie A", "Série A", "FAC 1", "FS", "A-2026", "A/B", "a_b.c"])(
    "gives the same CHARACTER-SET verdict as validate() for %j",
    (code) => {
      expect(boundaryRefuses({ ...GOOD, seriesCode: code })).toBe(
        validatorRefuses(recordFor({ numSerie: `${code}/1` }), "NumSerieFactura"),
      );
    },
  );
});

// The control characters XML forbids, on both fields the boundary checks. The table names each
// range of the restated pattern separately, so narrowing any one of them flips a case, and it
// includes the three C0 controls XML DOES permit, so widening the pattern to a blanket
// \x00-\x1F flips one too.
const CONTROL_CASES = [
  "plain text",
  "tab\there",
  "newline\nhere",
  "return\rhere",
  "nul\u0000here",
  "low\u0001here",
  "eight\u0008here",
  "vtab\u000Bhere",
  "formfeed\u000Chere",
  "fourteen\u000Ehere",
  "high\u001Fhere",
];

describe("the restated control characters match the record validator's", () => {
  it.each(CONTROL_CASES)("gives the same verdict for a legal name of %j", (value) => {
    // The legal name reaches the wire as NombreRazonEmisor, so that is the field to read back.
    expect(boundaryRefuses({ ...GOOD, legalName: value })).toBe(
      validatorRefuses(recordFor({ nombre: value }), "NombreRazonEmisor"),
    );
  });

  it.each(CONTROL_CASES)("gives the same verdict for an operation description of %j", (value) => {
    expect(boundaryRefuses({ ...GOOD, operationDescription: value })).toBe(
      validatorRefuses(recordFor({ descripcion: value }), "DescripcionOperacion"),
    );
  });
});

describe("the restated description cap matches the record validator's", () => {
  // Both sides of the boundary, so moving DESCRIPTION_MAX in EITHER direction flips a case: at 500
  // both accept, at 501 both refuse. The validator reports its length and its control-character
  // findings under the same field name, and none of these values carries a control character, so
  // the filter reads the length rule alone.
  it.each([1, 499, 500, 501, 600])(
    "gives the same verdict for a description of %i characters",
    (length) => {
      const value = "x".repeat(length);
      expect(boundaryRefuses({ ...GOOD, operationDescription: value })).toBe(
        validatorRefuses(recordFor({ descripcion: value }), "DescripcionOperacion"),
      );
    },
  );
});
