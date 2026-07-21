import { describe, expect, it } from "vitest";
import { validate } from "./validate.js";
import type { ValidationCode, ValidationSeverity } from "./validate.js";
import { buildAltaRecord, buildAnulacionRecord } from "./records.js";
import { SISTEMA } from "../test/fixtures.js";
import type {
  AltaInput,
  AnulacionInput,
  DetalleDesglose,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

// Deliberately NOT test/fixtures.ts's ALTA_INPUT. Both fixtures' Desglose
// lines already carry CalificacionOperacion (so that alone isn't why this
// file needs its own copy) — the actual difference is that this line omits
// TipoImpositivo, which ALTA_INPUT's carries (see test/fixtures.ts).
const INPUT: AltaInput = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "12345678/G33",
  FechaExpedicionFactura: new Date("2024-01-01T00:00:00+01:00"),
  NombreRazonEmisor: "Waitron SL",
  TipoFactura: "F1",
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
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

const ANULACION_INPUT: AnulacionInput = {
  IDEmisorFacturaAnulada: "89890001K",
  NumSerieFacturaAnulada: "12345678/G33",
  FechaExpedicionFacturaAnulada: new Date("2024-01-01T00:00:00+01:00"),
  Encadenamiento: { PrimerRegistro: "S" },
  SistemaInformatico: SISTEMA,
  generadoEn: new Date("2024-01-01T19:20:30+01:00"),
  offsetMinutes: 60,
};

const valid = () => buildAltaRecord(INPUT);
const validAnulacion = () => buildAnulacionRecord(ANULACION_INPUT);
const codes = (record: RegistroAlta) => validate(record).map((issue) => issue.code);
const anulacionCodes = (record: RegistroAnulacion) => validate(record).map((issue) => issue.code);

describe("validate", () => {
  it("returns no issues for a well-formed record", () => {
    expect(validate(valid())).toEqual([]);
  });

  it("rejects a NIF that is not exactly nine characters", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "8989001K";
    expect(codes(record)).toContain("NIF_LENGTH");
  });

  it("rejects an empty NumSerieFactura", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "";
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura longer than 60 characters", () => {
    const record = valid();
    record.IDFactura.NumSerieFactura = "A".repeat(61);
    expect(codes(record)).toContain("NUMSERIE_LENGTH");
  });

  it("accepts a NumSerieFactura of exactly 60 characters — the boundary itself", () => {
    // The existing 61-character test above would not notice a `> 60` -> `>=
    // 60` mutation, which would reject the boundary value itself.
    const record = valid();
    record.IDFactura.NumSerieFactura = "A".repeat(60);
    expect(codes(record)).not.toContain("NUMSERIE_LENGTH");
  });

  it("accepts a NumSerieFactura of exactly 1 character — the other boundary", () => {
    // The existing empty-string test above would not notice a `< 1` -> `<= 1`
    // mutation, which would reject a single-character serial.
    const record = valid();
    record.IDFactura.NumSerieFactura = "A";
    expect(codes(record)).not.toContain("NUMSERIE_LENGTH");
  });

  it("rejects a NumSerieFactura outside the safe charset", () => {
    // Policy: restrict the charset so form-urlencoding and RFC 3986 percent
    // encoding coincide in the QR, which removes an unresolved spec ambiguity.
    const record = valid();
    record.IDFactura.NumSerieFactura = "12345 678";
    expect(codes(record)).toContain("NUMSERIE_CHARSET");
  });

  it("rejects a Desglose with no lines", () => {
    const record = valid();
    record.Desglose = [];
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("rejects a Desglose with more than twelve lines", () => {
    const record = valid();
    record.Desglose = Array.from({ length: 13 }, () => ({
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "1.00",
    }));
    expect(codes(record)).toContain("DESGLOSE_COUNT");
  });

  it("accepts a Desglose with exactly twelve lines — the boundary itself, not just one past it", () => {
    // The existing 13-line test above would not notice a `> 12` -> `>= 12`
    // mutation, which would reject the boundary value itself. The
    // serialiser's SEPARATE 1000-record envio cap already has this style of
    // boundary test; this one was missing for the 12-line desglose cap.
    const record = valid();
    record.Desglose = Array.from({ length: 12 }, () => ({
      CalificacionOperacion: "S1",
      BaseImponibleOimporteNoSujeto: "1.00",
    }));
    expect(codes(record)).not.toContain("DESGLOSE_COUNT");
  });

  it("rejects a desglose line carrying neither CalificacionOperacion nor OperacionExenta", () => {
    // DetalleType models these as an xsd:choice: exactly one is required.
    // DetalleDesglose's type now makes "neither" unconstructable in normal
    // TypeScript, so this simulates a record that crossed a runtime boundary
    // (parsed JSON, a JS caller with no type checking) without either branch
    // set — exactly what DESGLOSE_CHOICE exists to catch at runtime.
    const record = valid();
    record.Desglose[0] = {
      BaseImponibleOimporteNoSujeto: record.Desglose[0]!.BaseImponibleOimporteNoSujeto,
    } as DetalleDesglose;
    expect(codes(record)).toContain("DESGLOSE_CHOICE");
  });

  it("rejects a desglose line carrying both CalificacionOperacion and OperacionExenta", () => {
    // Same rationale as above: DetalleDesglose's type makes "both" a type
    // error too, so a cast is needed to build the invalid shape the runtime
    // check must still catch.
    const record = valid();
    record.Desglose[0] = { ...record.Desglose[0]!, OperacionExenta: "E1" } as DetalleDesglose;
    expect(codes(record)).toContain("DESGLOSE_CHOICE");
  });

  it("accepts a desglose line carrying exactly one of the two", () => {
    const record = valid();
    expect(codes(record)).not.toContain("DESGLOSE_CHOICE");
  });

  it("flags CuotaTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.CuotaTotal = "999.00";
    expect(codes(record)).toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("accepts a CuotaTotal discrepancy within the 10 euro tolerance", () => {
    // AEAT applies a +/- 10.00 tolerance and treats a breach as a warning
    // rather than a rejection.
    const record = valid();
    record.CuotaTotal = "20.00";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("flags ImporteTotal disagreeing with the desglose beyond tolerance", () => {
    const record = valid();
    record.ImporteTotal = "999.00";
    expect(codes(record)).toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("marks total mismatches as warnings, not errors", () => {
    // AEAT accepts these with errors rather than rejecting, so treating them
    // as fatal locally would block records AEAT would have taken.
    const record = valid();
    record.ImporteTotal = "999.00";
    const issue = validate(record).find((i) => i.code === "IMPORTE_TOTAL_MISMATCH");
    expect(issue?.severity).toBe("warning");
  });

  it("rejects a huella that is not 64 uppercase hex characters", () => {
    const record = valid();
    record.Huella = record.Huella.toLowerCase();
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects a predecessor huella that is not 64 uppercase hex characters", () => {
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "TOO-SHORT",
      },
    };
    expect(codes(record)).toContain("HUELLA_ANTERIOR_FORMAT");
  });

  it("rejects a predecessor huella equal to the record's own", () => {
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: record.Huella,
      },
    };
    expect(codes(record)).toContain("HUELLA_ANTERIOR_EQUALS_CURRENT");
  });

  it("accepts a well-formed predecessor huella that genuinely differs from the record's own", () => {
    // Every other RegistroAnterior test in this file supplies an invalid
    // format ("TOO-SHORT") or one deliberately equal to the record's own
    // Huella — none of them takes the "chained onto a normal, different
    // predecessor" path, which is the common case in a real chain and the
    // only input that can tell `if (!HUELLA_PATTERN.test(anterior))` and
    // `if (anterior === record.Huella)` apart from `if (true)`.
    const record = valid();
    record.Encadenamiento = {
      RegistroAnterior: {
        IDEmisorFactura: "89890001K",
        NumSerieFactura: "12345677/G32",
        FechaExpedicionFactura: "01-01-2024",
        Huella: "0".repeat(64),
      },
    };
    const issues = codes(record);
    expect(issues).not.toContain("HUELLA_ANTERIOR_FORMAT");
    expect(issues).not.toContain("HUELLA_ANTERIOR_EQUALS_CURRENT");
  });

  it("rejects an IdSistemaInformatico longer than two characters", () => {
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "WTX" };
    expect(codes(record)).toContain("ID_SISTEMA_LENGTH");
  });

  it("rejects a SistemaInformatico.NIF that is not exactly nine characters", () => {
    // Both IDEmisorFactura and SistemaInformatico.NIF are sf:NIFType (length
    // exactly 9), but only the former was length-checked.
    const record = valid();
    record.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("SistemaInformatico.NIF");
  });

  it("accepts a SistemaInformatico.NIF that is exactly nine characters", () => {
    expect(codes(valid())).not.toContain("NIF_LENGTH");
  });

  it("rejects a FechaHoraHusoGenRegistro missing its offset", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro carrying a fractional-minute offset", () => {
    // "+01:30.5" — a fraction of a minute has no representation in +hh:mm.
    // formatDateTime itself now refuses to produce this, but a record parsed
    // from JSON or a database row can still carry it, which is exactly what
    // this rule exists to catch.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T01:30:30+01:30.5";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose offset is beyond +/-14:00", () => {
    // The motivating case: offsetMinutes 9999 used to silently serialise as
    // "+166:39", which is syntactically offset-shaped but out of range.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-08T16:59:30+166:39";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro at exactly the +14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+14:00";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro one minute beyond the +14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+14:01";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro at exactly the -14:00 boundary", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30-14:00";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose minute component is 60", () => {
    // The total (60) is well within +/-14:00 on its own, so only a dedicated
    // minute-component check catches this — a minute must be 00-59 regardless
    // of the total-minutes bound.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+00:60";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro whose minute component is out of range", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+00:99";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("accepts a FechaHoraHusoGenRegistro whose minute component is 59", () => {
    // The boundary immediately below the invalid "60" above — must stay valid.
    const record = valid();
    record.FechaHoraHusoGenRegistro = "2024-01-01T10:00:00+13:59";
    expect(codes(record)).not.toContain("FECHA_HORA_FORMAT");
  });

  it("rejects a DescripcionOperacion longer than 500 characters", () => {
    const record = valid();
    record.DescripcionOperacion = "x".repeat(501);
    expect(codes(record)).toContain("DESCRIPCION_LENGTH");
  });

  it("accepts a DescripcionOperacion of exactly 500 characters — the boundary itself", () => {
    // The existing 501-character test above would not notice a `> 500` -> `>=
    // 500` mutation, which would reject the boundary value itself.
    const record = valid();
    record.DescripcionOperacion = "x".repeat(500);
    expect(codes(record)).not.toContain("DESCRIPCION_LENGTH");
  });

  it("rejects a malformed expedition date", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "2024-01-01";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("reports every distinct problem rather than stopping at the first", () => {
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    record.Desglose = [];
    expect(codes(record)).toEqual(expect.arrayContaining(["NIF_LENGTH", "DESGLOSE_COUNT"]));
  });

  it("rejects a CuotaTotal that is not a well-formed amount", () => {
    // Number("not-a-number") is NaN, and every comparison with NaN is false,
    // so without this check a malformed CuotaTotal would silently pass the
    // very cross-check meant to catch a corrupted total.
    const record = valid();
    record.CuotaTotal = "not-a-number";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("does not also raise a spurious CUOTA_TOTAL_MISMATCH for a malformed CuotaTotal", () => {
    const record = valid();
    record.CuotaTotal = "not-a-number";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("rejects an ImporteTotal that is not a well-formed amount", () => {
    const record = valid();
    record.ImporteTotal = "not-a-number";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("does not also raise a spurious IMPORTE_TOTAL_MISMATCH for a malformed ImporteTotal", () => {
    const record = valid();
    record.ImporteTotal = "not-a-number";
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("rejects a desglose amount with the wrong number of decimal places", () => {
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "111.1";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("rejects a desglose amount carrying a leading +", () => {
    // The AEAT schema permits a leading +, but this project's own
    // serialisation policy never produces one, so validate() treats it as
    // malformed too.
    const record = valid();
    record.CuotaTotal = "+12.35";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("accepts a well-formed negative amount", () => {
    const record = valid();
    record.CuotaTotal = "-12.35";
    expect(codes(record)).not.toContain("AMOUNT_FORMAT");
  });

  it("accepts a CuotaTotal discrepancy of exactly the 10.00 boundary", () => {
    // AEAT's tolerance is +/- 10.00 inclusive: a discrepancy of exactly
    // 10.00 must NOT warn. Round euro amounts (10.00 vs 20.00) are used
    // rather than the shared fixture's 12.35, so the difference is exact in
    // IEEE 754 and the assertion isolates the tolerance constant itself
    // rather than incidental floating-point noise from unrelated decimals.
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "20.00";
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("flags a CuotaTotal discrepancy one cent beyond the 10.00 boundary", () => {
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "20.01";
    expect(codes(record)).toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("accepts an ImporteTotal discrepancy of exactly the 10.00 boundary", () => {
    // Mirrors the CuotaTotal boundary test above; IMPORTE_TOTAL_MISMATCH has
    // the identical `> TOTAL_TOLERANCE` comparison but its own test file
    // coverage, so a `>` -> `>=` mutation there needs its own boundary pin.
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "10.00";
    record.ImporteTotal = "120.00";
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("flags an ImporteTotal discrepancy one cent beyond the 10.00 boundary", () => {
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "10.00";
    record.CuotaTotal = "10.00";
    record.ImporteTotal = "120.01";
    expect(codes(record)).toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("severs CuotaTotal's format check from desglose validity, not just from its own format", () => {
    // The mismatch guard is `cuotaTotalValid && desgloseAmountsValid && ...`.
    // Both existing "does not raise a spurious mismatch" tests set CuotaTotal
    // itself to "not-a-number", which makes Number(CuotaTotal) NaN — every
    // NaN comparison is false, so the mismatch condition's own arithmetic
    // masks a `&&` -> `||` mutation regardless of which operand let it
    // through. This uses a CuotaTotal that is malformed (one decimal place,
    // so still schema-invalid) but numerically real and grossly mismatched,
    // with an otherwise-valid desglose — isolating cuotaTotalValid=false as
    // the ONLY reason the check must be skipped.
    const record = valid();
    record.CuotaTotal = "999.5";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
    expect(codes(record)).not.toContain("CUOTA_TOTAL_MISMATCH");
  });

  it("severs ImporteTotal's format check from desglose validity the same way", () => {
    const record = valid();
    record.ImporteTotal = "999.5";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
    expect(codes(record)).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("skips both mismatch checks when a desglose amount is malformed, even though the totals themselves are well-formed and genuinely disagree", () => {
    // The mirror image of the two tests above: CuotaTotal/ImporteTotal are
    // both well-formed (so cuotaTotalValid/importeTotalValid are true) and
    // grossly disagree with the desglose sum if that sum were trusted — but
    // CuotaRepercutida is malformed (one decimal place), which must both (a)
    // report its own AMOUNT_FORMAT via the field-specific ["CuotaRepercutida",
    // ...] tuple, not silently drop it, and (b) set desgloseAmountsValid to
    // false (not leave it at its default true) so the totals cross-checks are
    // skipped rather than comparing against a sum built from a malformed
    // literal.
    const record = valid();
    record.Desglose[0]!.CuotaRepercutida = "12.5";
    record.CuotaTotal = "999.00";
    record.ImporteTotal = "999.00";
    const issues = validate(record);
    expect(issues.map((i) => i.code)).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(issues.map((i) => i.code)).not.toContain("IMPORTE_TOTAL_MISMATCH");
    const amountIssue = issues.find(
      (i) => i.code === "AMOUNT_FORMAT" && i.field === "Desglose[0].CuotaRepercutida",
    );
    expect(amountIssue).toBeDefined();
  });

  it("sums CuotaRecargoEquivalencia (recargo) into both mismatch checks with the correct sign", () => {
    // Every other total test in this file uses a line with no recargo, so
    // `cuotas + recargos` and `cuotas - recargos` (and the `sum(...)` call
    // returning 0 for every line regardless of its actual value) are all
    // indistinguishable when recargos is always 0. This line carries a
    // deliberately large recargo (50.00) against a small cuota (21.00), and
    // sets both totals to their correct `+` sums exactly — a `+` -> `-` typo,
    // or `recargos` collapsing to 0, would each produce a discrepancy far
    // beyond the 10.00 tolerance where the true sum has none.
    const record = valid();
    record.Desglose[0]!.BaseImponibleOimporteNoSujeto = "100.00";
    record.Desglose[0]!.CuotaRepercutida = "21.00";
    record.Desglose[0]!.CuotaRecargoEquivalencia = "50.00";
    record.CuotaTotal = "71.00"; // cuota (21) + recargo (50)
    record.ImporteTotal = "171.00"; // base (100) + cuota (21) + recargo (50)
    const codesList = codes(record);
    expect(codesList).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(codesList).not.toContain("IMPORTE_TOTAL_MISMATCH");
  });

  it("rejects a TipoImpositivo exceeding the schema's 3 integer digits", () => {
    // Tipo2.2Type is unsigned with at most 3 integer digits; formatAmountExact
    // (signed, up to 12 integer digits) does not enforce that.
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "1234.50";
    expect(codes(record)).toContain("TIPO_RANGE");
  });

  it("rejects a TipoRecargoEquivalencia exceeding the schema's 3 integer digits", () => {
    const record = valid();
    record.Desglose[0]!.TipoRecargoEquivalencia = "1234.50";
    expect(codes(record)).toContain("TIPO_RANGE");
  });

  it("accepts a well-formed TipoImpositivo", () => {
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "21.00";
    expect(codes(record)).not.toContain("TIPO_RANGE");
  });

  it("rejects a control character in DescripcionOperacion", () => {
    // U+0001 is not a legal XML 1.0 character at all — the serialised
    // document would not even be well-formed.
    const record = valid();
    record.DescripcionOperacion = "Venta\x01en establecimiento";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("rejects a control character in NombreRazonEmisor", () => {
    const record = valid();
    record.NombreRazonEmisor = "Waitron\x07SL";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("rejects a control character in RefExterna", () => {
    const record = valid();
    record.RefExterna = "REF\x0b1";
    expect(codes(record)).toContain("CONTROL_CHAR");
  });

  it("accepts tab, newline and carriage return in text fields", () => {
    // XML 1.0's Char production permits these three C0 controls.
    const record = valid();
    record.DescripcionOperacion = "Venta\ten\nestablecimiento\r";
    expect(codes(record)).not.toContain("CONTROL_CHAR");
  });

  it("accepts ordinary text with no control characters", () => {
    expect(codes(valid())).not.toContain("CONTROL_CHAR");
  });
});

describe("validate — regex patterns are anchored at both ends, not just one", () => {
  // Every pattern in validate.ts is `^...$`. A junk prefix or suffix around
  // an otherwise-valid literal must still fail: losing either anchor would
  // let the pattern match a SUBSTRING of an invalid value instead of
  // requiring the whole value to conform.

  it("rejects a Huella with a junk prefix before an otherwise-valid 64-hex tail", () => {
    const record = valid();
    record.Huella = `X${"A".repeat(64)}`;
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects a Huella with a junk suffix after an otherwise-valid 64-hex head", () => {
    const record = valid();
    record.Huella = `${"A".repeat(64)}X`;
    expect(codes(record)).toContain("HUELLA_FORMAT");
  });

  it("rejects an expedition date with a junk prefix before an otherwise-valid DD-MM-YYYY tail", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "X01-01-2024";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("rejects an expedition date with a junk suffix after an otherwise-valid DD-MM-YYYY head", () => {
    const record = valid();
    record.IDFactura.FechaExpedicionFactura = "01-01-2024X";
    expect(codes(record)).toContain("FECHA_FORMAT");
  });

  it("rejects a FechaHoraHusoGenRegistro with a junk prefix before an otherwise-valid tail", () => {
    const record = valid();
    record.FechaHoraHusoGenRegistro = "X2024-01-01T19:20:30+01:00";
    expect(codes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("does not treat TipoFactura 'R10' as a rectificativa — the pattern must anchor its end", () => {
    // /^R[1-5]$/ losing its `$` would match the "R1" prefix of "R10" and
    // wrongly classify it as a rectificativa, spuriously demanding
    // TipoRectificativa. TipoFactura is a closed union at the type level, so
    // this simulates a value that crossed a runtime boundary (parsed JSON, an
    // untyped caller) — the same rationale the existing DESGLOSE_CHOICE casts
    // in this file use.
    const record = valid();
    record.TipoFactura = "R10" as RegistroAlta["TipoFactura"];
    expect(codes(record)).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("does not treat TipoFactura 'XR1' as a rectificativa — the pattern must anchor its start", () => {
    const record = valid();
    record.TipoFactura = "XR1" as RegistroAlta["TipoFactura"];
    expect(codes(record)).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("rejects a CuotaTotal with a junk suffix after an otherwise-valid amount", () => {
    const record = valid();
    record.CuotaTotal = "12.35X";
    expect(codes(record)).toContain("AMOUNT_FORMAT");
  });

  it("rejects a TipoImpositivo with a junk suffix after an otherwise-valid rate", () => {
    const record = valid();
    record.Desglose[0]!.TipoImpositivo = "21.00X";
    expect(codes(record)).toContain("TIPO_RANGE");
  });
});

describe("validate — default severity", () => {
  it("defaults every ordinary rejection to severity 'error', not an unset/empty value", () => {
    // Only the two total-mismatch codes pass an explicit "warning"; every
    // other add() call relies on the default parameter. Nothing elsewhere in
    // this file asserts the DEFAULT actually resolves to the literal
    // "error" rather than e.g. an empty string.
    const record = valid();
    record.IDFactura.IDEmisorFactura = "SHORT";
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.severity).toBe("error");
  });
});

describe("validate — rectificativa rules (AEAT 1114/1115/1118)", () => {
  // A genuinely valid rectificativa: TipoFactura is R1-R5, TipoRectificativa
  // is set, and — because it's "S" (sustitución) — ImporteRectificacion is
  // also present, satisfying rule 1118 as well as 1114.
  const rectificativa = () =>
    buildAltaRecord({
      ...INPUT,
      TipoFactura: "R1",
      TipoRectificativa: "S",
      ImporteRectificacion: { BaseRectificada: "100", CuotaRectificada: "21" },
    });

  it("returns no issues for a well-formed rectificativa por sustitución", () => {
    expect(validate(rectificativa())).toEqual([]);
  });

  it("returns no issues for a well-formed rectificativa por diferencia (I), without ImporteRectificacion", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "I" });
    expect(validate(record)).toEqual([]);
  });

  it("1114: rejects a rectificativa TipoFactura (R1-R5) with no TipoRectificativa", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1" });
    expect(codes(record)).toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("1114: does not require TipoRectificativa for a non-rectificativa TipoFactura", () => {
    expect(codes(valid())).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
  });

  it("1115: rejects TipoRectificativa set on a non-rectificativa TipoFactura", () => {
    // Exactly the shape records.test.ts's EXTRAS fixture used to build by
    // accident: TipoRectificativa on an F1 (INPUT.TipoFactura) record.
    const record = buildAltaRecord({ ...INPUT, TipoRectificativa: "S" });
    expect(codes(record)).toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
  });

  it("1115: does not forbid TipoRectificativa on a rectificativa TipoFactura", () => {
    expect(codes(rectificativa())).not.toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
  });

  it("1118: rejects TipoRectificativa S with no ImporteRectificacion", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "S" });
    expect(codes(record)).toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("1118: does not require ImporteRectificacion for TipoRectificativa I", () => {
    const record = buildAltaRecord({ ...INPUT, TipoFactura: "R1", TipoRectificativa: "I" });
    expect(codes(record)).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("1118: does not require ImporteRectificacion when TipoRectificativa is absent", () => {
    expect(codes(valid())).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });
});

describe("validate — RegistroAnulacion", () => {
  it("returns no issues for a well-formed annulment record", () => {
    expect(validate(validAnulacion())).toEqual([]);
  });

  it("does not fire the alta-only rules against an annulment record", () => {
    const record = validAnulacion();
    const issueCodes = anulacionCodes(record);
    expect(issueCodes).not.toContain("DESGLOSE_COUNT");
    expect(issueCodes).not.toContain("DESCRIPCION_LENGTH");
    expect(issueCodes).not.toContain("AMOUNT_FORMAT");
    expect(issueCodes).not.toContain("CUOTA_TOTAL_MISMATCH");
    expect(issueCodes).not.toContain("IMPORTE_TOTAL_MISMATCH");
    // RegistroAnulacion has no TipoFactura at all, so these three — which key
    // off TipoFactura/TipoRectificativa/ImporteRectificacion, none of which
    // exist on this record type — can never fire either.
    expect(issueCodes).not.toContain("TIPO_RECTIFICATIVA_REQUIRED");
    expect(issueCodes).not.toContain("TIPO_RECTIFICATIVA_FORBIDDEN");
    expect(issueCodes).not.toContain("IMPORTE_RECTIFICACION_REQUIRED");
  });

  it("still checks FechaHoraHusoGenRegistro's format — not an alta-only rule", () => {
    const record = validAnulacion();
    record.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30+166:39";
    expect(anulacionCodes(record)).toContain("FECHA_HORA_FORMAT");
  });

  it("still checks SistemaInformatico.NIF's length — not an alta-only rule", () => {
    const record = validAnulacion();
    record.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("SistemaInformatico.NIF");
  });

  it("reports IDEmisorFacturaAnulada, not IDEmisorFactura, for a malformed NIF", () => {
    const record = validAnulacion();
    record.IDFactura.IDEmisorFacturaAnulada = "SHORT";
    const issue = validate(record).find((i) => i.code === "NIF_LENGTH");
    expect(issue?.field).toBe("IDEmisorFacturaAnulada");
  });

  it("reports NumSerieFacturaAnulada, not NumSerieFactura, for an empty serial", () => {
    const record = validAnulacion();
    record.IDFactura.NumSerieFacturaAnulada = "";
    const issue = validate(record).find((i) => i.code === "NUMSERIE_LENGTH");
    expect(issue?.field).toBe("NumSerieFacturaAnulada");
  });

  it("reports NumSerieFacturaAnulada, not NumSerieFactura, for a bad charset", () => {
    const record = validAnulacion();
    record.IDFactura.NumSerieFacturaAnulada = "12345 678";
    const issue = validate(record).find((i) => i.code === "NUMSERIE_CHARSET");
    expect(issue?.field).toBe("NumSerieFacturaAnulada");
  });

  it("reports FechaExpedicionFacturaAnulada, not FechaExpedicionFactura, for a malformed date", () => {
    const record = validAnulacion();
    record.IDFactura.FechaExpedicionFacturaAnulada = "2024-01-01";
    const issue = validate(record).find((i) => i.code === "FECHA_FORMAT");
    expect(issue?.field).toBe("FechaExpedicionFacturaAnulada");
  });
});

// Decision on message text (see task/PR description for the full reasoning):
// this project treats ValidationIssue.message as part of the library's
// consumer-visible surface (it's built for publication), not disposable
// internal prose — so it is pinned, deliberately, in exactly one place below
// rather than left untested. Field name gets the same treatment in the same
// table: the identical string-literal mutants that blank a message just as
// often blank a field name (or the alta/anulación field-name ternaries a few
// lines up in validate()), and field misattribution is genuinely behavioural
// — a caller uses `field` to point a user at the actual bad input. A table is
// used instead of scattering `.message`/`.field` assertions across the tests
// above so a wording tweak touches this one place, not dozens of tests.
describe("validate — pins the exact field, message and severity for every ValidationCode", () => {
  interface Case {
    description: string;
    code: ValidationCode;
    field: string;
    message: string;
    severity?: ValidationSeverity;
    mutate: (record: RegistroAlta) => void;
  }

  const cases: Case[] = [
    {
      description: "NIF_LENGTH on the emisor NIF",
      code: "NIF_LENGTH",
      field: "IDEmisorFactura",
      message: "NIF must be exactly 9 characters",
      mutate: (r) => {
        r.IDFactura.IDEmisorFactura = "SHORT";
      },
    },
    {
      description: "NIF_LENGTH on SistemaInformatico.NIF",
      code: "NIF_LENGTH",
      field: "SistemaInformatico.NIF",
      message: "NIF must be exactly 9 characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NIF: "SHORT" };
      },
    },
    {
      description: "NUMSERIE_LENGTH",
      code: "NUMSERIE_LENGTH",
      field: "NumSerieFactura",
      message: "NumSerieFactura must be 1 to 60 characters",
      mutate: (r) => {
        r.IDFactura.NumSerieFactura = "";
      },
    },
    {
      description: "NUMSERIE_CHARSET",
      code: "NUMSERIE_CHARSET",
      field: "NumSerieFactura",
      message: "NumSerieFactura must use only A-Z a-z 0-9 / _ . -",
      mutate: (r) => {
        r.IDFactura.NumSerieFactura = "12345 678";
      },
    },
    {
      description: "FECHA_FORMAT",
      code: "FECHA_FORMAT",
      field: "FechaExpedicionFactura",
      message: "Date must be DD-MM-YYYY",
      mutate: (r) => {
        r.IDFactura.FechaExpedicionFactura = "2024-01-01";
      },
    },
    {
      description: "HUELLA_FORMAT",
      code: "HUELLA_FORMAT",
      field: "Huella",
      message: "Huella must be 64 uppercase hexadecimal characters",
      mutate: (r) => {
        r.Huella = r.Huella.toLowerCase();
      },
    },
    {
      description: "FECHA_HORA_FORMAT",
      code: "FECHA_HORA_FORMAT",
      field: "FechaHoraHusoGenRegistro",
      message:
        "FechaHoraHusoGenRegistro must be YYYY-MM-DDThh:mm:ss with a numeric offset in -14:00..+14:00",
      mutate: (r) => {
        r.FechaHoraHusoGenRegistro = "2024-01-01T19:20:30";
      },
    },
    {
      description: "ID_SISTEMA_LENGTH",
      code: "ID_SISTEMA_LENGTH",
      field: "IdSistemaInformatico",
      message: "IdSistemaInformatico is at most 2 characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, IdSistemaInformatico: "WTX" };
      },
    },
    {
      description: "CONTROL_CHAR on RefExterna",
      code: "CONTROL_CHAR",
      field: "RefExterna",
      message: "RefExterna must not contain XML control characters",
      mutate: (r) => {
        r.RefExterna = "REF\x0b1";
      },
    },
    {
      description: "CONTROL_CHAR on SistemaInformatico.NombreRazon",
      code: "CONTROL_CHAR",
      field: "SistemaInformatico.NombreRazon",
      message: "SistemaInformatico.NombreRazon must not contain XML control characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NombreRazon: "Wai\x01tron" };
      },
    },
    {
      description: "CONTROL_CHAR on SistemaInformatico.NombreSistemaInformatico",
      code: "CONTROL_CHAR",
      field: "SistemaInformatico.NombreSistemaInformatico",
      message:
        "SistemaInformatico.NombreSistemaInformatico must not contain XML control characters",
      mutate: (r) => {
        r.SistemaInformatico = { ...SISTEMA, NombreSistemaInformatico: "POS\x02" };
      },
    },
    {
      description: "CONTROL_CHAR on DescripcionOperacion",
      code: "CONTROL_CHAR",
      field: "DescripcionOperacion",
      message: "DescripcionOperacion must not contain XML control characters",
      mutate: (r) => {
        r.DescripcionOperacion = "Venta\x01en establecimiento";
      },
    },
    {
      description: "CONTROL_CHAR on NombreRazonEmisor",
      code: "CONTROL_CHAR",
      field: "NombreRazonEmisor",
      message: "NombreRazonEmisor must not contain XML control characters",
      mutate: (r) => {
        r.NombreRazonEmisor = "Waitron\x07SL";
      },
    },
    {
      description: "HUELLA_ANTERIOR_FORMAT",
      code: "HUELLA_ANTERIOR_FORMAT",
      field: "Encadenamiento.RegistroAnterior.Huella",
      message: "Predecessor huella must be 64 uppercase hexadecimal characters",
      mutate: (r) => {
        r.Encadenamiento = {
          RegistroAnterior: {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "12345677/G32",
            FechaExpedicionFactura: "01-01-2024",
            Huella: "TOO-SHORT",
          },
        };
      },
    },
    {
      description: "HUELLA_ANTERIOR_EQUALS_CURRENT",
      code: "HUELLA_ANTERIOR_EQUALS_CURRENT",
      field: "Encadenamiento.RegistroAnterior.Huella",
      message: "Predecessor huella must differ from this record's huella",
      mutate: (r) => {
        r.Encadenamiento = {
          RegistroAnterior: {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "12345677/G32",
            FechaExpedicionFactura: "01-01-2024",
            Huella: r.Huella,
          },
        };
      },
    },
    {
      description: "TIPO_RECTIFICATIVA_REQUIRED",
      code: "TIPO_RECTIFICATIVA_REQUIRED",
      field: "TipoRectificativa",
      message: "TipoRectificativa is mandatory when TipoFactura is R1-R5",
      mutate: (r) => {
        r.TipoFactura = "R1";
      },
    },
    {
      description: "TIPO_RECTIFICATIVA_FORBIDDEN",
      code: "TIPO_RECTIFICATIVA_FORBIDDEN",
      field: "TipoRectificativa",
      message: "TipoRectificativa must not be set when TipoFactura is not R1-R5",
      mutate: (r) => {
        r.TipoRectificativa = "S";
      },
    },
    {
      description: "IMPORTE_RECTIFICACION_REQUIRED",
      code: "IMPORTE_RECTIFICACION_REQUIRED",
      field: "ImporteRectificacion",
      message: "ImporteRectificacion is mandatory when TipoRectificativa is S (sustitución)",
      mutate: (r) => {
        r.TipoFactura = "R1";
        r.TipoRectificativa = "S";
      },
    },
    {
      description: "DESCRIPCION_LENGTH",
      code: "DESCRIPCION_LENGTH",
      field: "DescripcionOperacion",
      message: "DescripcionOperacion is at most 500 characters",
      mutate: (r) => {
        r.DescripcionOperacion = "x".repeat(501);
      },
    },
    {
      description: "DESGLOSE_COUNT",
      code: "DESGLOSE_COUNT",
      field: "Desglose",
      message: "Desglose must carry 1 to 12 detail lines",
      mutate: (r) => {
        r.Desglose = [];
      },
    },
    {
      description: "AMOUNT_FORMAT on CuotaTotal",
      code: "AMOUNT_FORMAT",
      field: "CuotaTotal",
      message: "CuotaTotal must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.CuotaTotal = "not-a-number";
      },
    },
    {
      description: "AMOUNT_FORMAT on ImporteTotal",
      code: "AMOUNT_FORMAT",
      field: "ImporteTotal",
      message: "ImporteTotal must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.ImporteTotal = "not-a-number";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].BaseImponibleOimporteNoSujeto",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].BaseImponibleOimporteNoSujeto",
      message:
        "BaseImponibleOimporteNoSujeto must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.BaseImponibleOimporteNoSujeto = "111.1";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].CuotaRepercutida",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].CuotaRepercutida",
      message:
        "CuotaRepercutida must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.CuotaRepercutida = "12.5";
      },
    },
    {
      description: "AMOUNT_FORMAT on Desglose[0].CuotaRecargoEquivalencia",
      code: "AMOUNT_FORMAT",
      field: "Desglose[0].CuotaRecargoEquivalencia",
      message:
        "CuotaRecargoEquivalencia must be a decimal with exactly two decimal places and no leading +",
      mutate: (r) => {
        r.Desglose[0]!.CuotaRecargoEquivalencia = "5.5";
      },
    },
    {
      description: "DESGLOSE_CHOICE",
      code: "DESGLOSE_CHOICE",
      field: "Desglose[0]",
      message:
        "Each desglose line must carry exactly one of CalificacionOperacion or OperacionExenta",
      mutate: (r) => {
        r.Desglose[0] = {
          BaseImponibleOimporteNoSujeto: r.Desglose[0]!.BaseImponibleOimporteNoSujeto,
        } as DetalleDesglose;
      },
    },
    {
      description: "TIPO_RANGE on Desglose[0].TipoImpositivo",
      code: "TIPO_RANGE",
      field: "Desglose[0].TipoImpositivo",
      message:
        "TipoImpositivo must be unsigned with at most 3 integer digits and exactly 2 decimal digits",
      mutate: (r) => {
        r.Desglose[0]!.TipoImpositivo = "1234.50";
      },
    },
    {
      description: "TIPO_RANGE on Desglose[0].TipoRecargoEquivalencia",
      code: "TIPO_RANGE",
      field: "Desglose[0].TipoRecargoEquivalencia",
      message:
        "TipoRecargoEquivalencia must be unsigned with at most 3 integer digits and exactly 2 decimal digits",
      mutate: (r) => {
        r.Desglose[0]!.TipoRecargoEquivalencia = "1234.50";
      },
    },
    {
      description: "CUOTA_TOTAL_MISMATCH",
      code: "CUOTA_TOTAL_MISMATCH",
      field: "CuotaTotal",
      message: "CuotaTotal disagrees with the desglose beyond the 10.00 tolerance",
      severity: "warning",
      mutate: (r) => {
        r.CuotaTotal = "999.00";
      },
    },
    {
      description: "IMPORTE_TOTAL_MISMATCH",
      code: "IMPORTE_TOTAL_MISMATCH",
      field: "ImporteTotal",
      message: "ImporteTotal disagrees with the desglose beyond the 10.00 tolerance",
      severity: "warning",
      mutate: (r) => {
        r.ImporteTotal = "999.00";
      },
    },
  ];

  it.each(cases)("$description", ({ code, field, message, severity, mutate }) => {
    const record = valid();
    mutate(record);
    const issue = validate(record).find((i) => i.code === code && i.field === field);
    expect(issue).toBeDefined();
    expect(issue?.message).toBe(message);
    expect(issue?.severity).toBe(severity ?? "error");
  });
});
