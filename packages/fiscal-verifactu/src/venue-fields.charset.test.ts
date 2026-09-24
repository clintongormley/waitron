import { describe, expect, it } from "vitest";
import { buildAltaRecord, validate } from "@waitron/verifactu";
import type { AltaInput } from "@waitron/verifactu";
import { TEST_SISTEMA } from "./testing/seed.js";
import { validateVenueFiscalFields } from "./venue-fields.js";

/**
 * The drift guard for the three `@waitron/verifactu` rules ./venue-fields.ts restates.
 *
 * It deliberately does NOT pin the series code's LENGTH rule, because the two disagree on purpose:
 * the boundary refuses a base over 38 characters so a cold restore's `-<installation number>`
 * suffix still fits, while the record validator accepts NumSerieFactura up to 60.
 */

/** `F2` and no `TipoImpositivo` keep every other rule satisfied, so the only issues this record can
 * produce are the ones under test. */
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

function boundaryRefuses(venue: typeof GOOD): boolean {
  try {
    validateVenueFiscalFields(venue);
    return false;
  } catch {
    return true;
  }
}

function validatorRefuses(record: ReturnType<typeof recordFor>, field: string): boolean {
  return validate(record).some((issue) => issue.field === field && issue.severity === "error");
}

describe("the restated character set matches the record validator's", () => {
  // Every case is far under the 60-character cap, so the only error the validator can raise
  // against this field is the charset one.
  it.each(["Serie A", "Série A", "FAC 1", "FS", "A-2026", "A/B", "a_b.c"])(
    "gives the same CHARACTER-SET verdict as validate() for %j",
    (code) => {
      expect(boundaryRefuses({ ...GOOD, seriesCode: code })).toBe(
        validatorRefuses(recordFor({ numSerie: `${code}/1` }), "NumSerieFactura"),
      );
    },
  );
});

// Each range of the restated pattern, plus the three C0 controls XML DOES permit.
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
  // None of these values carries a control character, which the validator reports under the same
  // field name.
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
