import { MAX_OFFSET_MINUTES } from "./format.js";
import { isAlta } from "./types.js";
import type { RegistroAlta, RegistroAnulacion } from "./types.js";

export type ValidationSeverity = "error" | "warning";

/** The closed set of issue codes this module produces. */
export type ValidationCode =
  | "NIF_LENGTH"
  | "NUMSERIE_LENGTH"
  | "NUMSERIE_CHARSET"
  | "FECHA_FORMAT"
  | "FECHA_HORA_FORMAT"
  | "HUELLA_FORMAT"
  | "ID_SISTEMA_LENGTH"
  | "CONTROL_CHAR"
  | "HUELLA_ANTERIOR_FORMAT"
  | "HUELLA_ANTERIOR_EQUALS_CURRENT"
  | "DESCRIPCION_LENGTH"
  | "DESGLOSE_COUNT"
  | "AMOUNT_FORMAT"
  | "DESGLOSE_CHOICE"
  | "TIPO_RANGE"
  | "CUOTA_TOTAL_MISMATCH"
  | "IMPORTE_TOTAL_MISMATCH"
  // AEAT error 1114: TipoRectificativa is mandatory when TipoFactura is R1-R5.
  | "TIPO_RECTIFICATIVA_REQUIRED"
  // AEAT error 1115: TipoRectificativa is forbidden when TipoFactura is not R1-R5.
  | "TIPO_RECTIFICATIVA_FORBIDDEN"
  // AEAT error 1118: ImporteRectificacion is mandatory when TipoRectificativa is "S".
  | "IMPORTE_RECTIFICACION_REQUIRED"
  // A full invoice (F1/F3) must identify its recipient. For F3 (canje) AEAT is
  // explicit: «Siempre debe llevar el destinatario»
  // (docs/compliance/verifactu-findings.md:621).
  | "DESTINATARIOS_REQUIRED"
  // A simplified ticket (F2) must NOT carry a recipient — it records the absence
  // via FacturaSinIdentifDestinatarioArt61d instead.
  | "DESTINATARIOS_FORBIDDEN"
  // sf:Destinatarios is minOccurs=0, but its inner IDDestinatario is
  // minOccurs=1 maxOccurs=1000 (SuministroInformacion.xsd:159) — so a present
  // Destinatarios with an empty IDDestinatario array is not schema-valid.
  | "DESTINATARIOS_EMPTY";

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  field: string;
  message: string;
}

const HUELLA_PATTERN = /^[0-9A-F]{64}$/;
const FECHA_PATTERN = /^\d{2}-\d{2}-\d{4}$/;
/**
 * Pins FechaHoraHusoGenRegistro's full literal shape: `YYYY-MM-DDThh:mm:ss`
 * plus a numeric `+hh:mm`/`-hh:mm` offset (formatDateTime never emits `Z`).
 * The offset's hh:mm is captured separately so its magnitude can be bounded
 * below — a record built from a stale formatter, or one that crossed a
 * runtime boundary (parsed JSON, a database row), might carry an offset like
 * "+166:39" or otherwise outside xs:dateTime's -14:00..+14:00 range even
 * though it matches this shape syntactically. The sign is matched but not
 * captured — hh:mm is always written as non-negative digits regardless of
 * sign, so the same magnitude bound applies to + and - alike.
 */
const FECHA_HORA_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-])(\d{2}):(\d{2})$/;
/** AEAT error 1114/1115: TipoRectificativa is mandatory iff TipoFactura is a rectificativa. */
const TIPO_FACTURA_RECTIFICATIVA_PATTERN = /^R[1-5]$/;
/**
 * Conservative charset for NumSerieFactura. AEAT permits printable ASCII, but
 * form-urlencoding and RFC 3986 disagree on characters like space, and the QR
 * spec does not settle which applies. Restricting the charset here makes the
 * two encodings identical, so the ambiguity cannot affect us.
 */
const NUMSERIE_PATTERN = /^[A-Za-z0-9/_.-]+$/;
/** AEAT applies a +/- 10.00 euro tolerance on the total cross-checks. */
const TOTAL_TOLERANCE = 10;
/**
 * AEAT's schema type for these fields is `(\+|-)?\d{1,12}(\.\d{0,2})?`, but
 * this project's own serialisation policy (see formatAmountExact) is
 * stricter: always exactly two decimal places, never a leading `+`. Records
 * reaching validate() should already conform to that policy, so anything
 * looser is treated as malformed rather than merely off-spec.
 */
const AMOUNT_PATTERN = /^-?\d{1,12}\.\d{2}$/;
/**
 * AEAT's schema type for TipoImpositivo/TipoRecargoEquivalencia is
 * `Tipo2.2Type`: `\d{1,3}(\.\d{0,2})?` — unsigned, at most 3 integer digits.
 * formatAmountExact always emits exactly two decimal places and never a
 * leading `+`, so the tighter (but still schema-conformant) shape reaching
 * validate() should always match this.
 */
const TIPO_PATTERN = /^\d{1,3}\.\d{2}$/;
/**
 * XML 1.0's Char production excludes these code points entirely — not just
 * "unusual", but not legal XML content at all. Tab (U+0009), LF (U+000A) and
 * CR (U+000D) are the three C0 controls XML does permit, so they are the
 * three excluded from this pattern.
 */
// eslint-disable-next-line no-control-regex -- deliberately matching control characters
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

function isValidAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value);
}

function isValidFechaHoraHusoGenRegistro(value: string): boolean {
  const match = FECHA_HORA_PATTERN.exec(value);
  if (!match) return false;
  const [, hh, mm] = match;
  // The pattern only constrains each half to two digits, so "60".."99" match
  // it syntactically — an xs:dateTime offset's minute component must itself
  // be 00-59, independent of the total-minutes bound below. "+00:60" is
  // malformed even though its total (60) is well within +/-14:00, so this
  // check cannot be folded into the total-minutes comparison.
  if (Number(mm) >= 60) return false;
  const offsetMinutes = Number(hh) * 60 + Number(mm);
  return offsetMinutes <= MAX_OFFSET_MINUTES;
}

function sum(values: Array<string | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ? Number(value) : 0), 0);
}

export function validate(record: RegistroAlta | RegistroAnulacion): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationCode,
    field: string,
    message: string,
    severity: ValidationSeverity = "error",
  ) => issues.push({ code, severity, field, message });

  const emisor = isAlta(record)
    ? record.IDFactura.IDEmisorFactura
    : record.IDFactura.IDEmisorFacturaAnulada;
  const numSerie = isAlta(record)
    ? record.IDFactura.NumSerieFactura
    : record.IDFactura.NumSerieFacturaAnulada;
  const fecha = isAlta(record)
    ? record.IDFactura.FechaExpedicionFactura
    : record.IDFactura.FechaExpedicionFacturaAnulada;
  // A RegistroAnulacion carries the same three identity values under
  // ...Anulada-suffixed property names — report the name that actually
  // exists on the record in hand, not the alta-style one unconditionally.
  const emisorField = isAlta(record) ? "IDEmisorFactura" : "IDEmisorFacturaAnulada";
  const numSerieField = isAlta(record) ? "NumSerieFactura" : "NumSerieFacturaAnulada";
  const fechaField = isAlta(record) ? "FechaExpedicionFactura" : "FechaExpedicionFacturaAnulada";

  if (emisor.length !== 9) {
    add("NIF_LENGTH", emisorField, "NIF must be exactly 9 characters");
  }
  if (numSerie.length < 1 || numSerie.length > 60) {
    add("NUMSERIE_LENGTH", numSerieField, "NumSerieFactura must be 1 to 60 characters");
  } else if (!NUMSERIE_PATTERN.test(numSerie)) {
    add("NUMSERIE_CHARSET", numSerieField, "NumSerieFactura must use only A-Z a-z 0-9 / _ . -");
  }
  if (!FECHA_PATTERN.test(fecha)) {
    add("FECHA_FORMAT", fechaField, "Date must be DD-MM-YYYY");
  }

  if (!HUELLA_PATTERN.test(record.Huella)) {
    add("HUELLA_FORMAT", "Huella", "Huella must be 64 uppercase hexadecimal characters");
  }
  if (!isValidFechaHoraHusoGenRegistro(record.FechaHoraHusoGenRegistro)) {
    add(
      "FECHA_HORA_FORMAT",
      "FechaHoraHusoGenRegistro",
      "FechaHoraHusoGenRegistro must be YYYY-MM-DDThh:mm:ss with a numeric offset in -14:00..+14:00",
    );
  }
  if (record.SistemaInformatico.IdSistemaInformatico.length > 2) {
    add(
      "ID_SISTEMA_LENGTH",
      "IdSistemaInformatico",
      "IdSistemaInformatico is at most 2 characters",
    );
  }
  if (record.SistemaInformatico.NIF.length !== 9) {
    add("NIF_LENGTH", "SistemaInformatico.NIF", "NIF must be exactly 9 characters");
  }

  // A control character makes the serialised document not well-formed XML —
  // not merely schema-invalid, but unparseable — so it is rejected rather
  // than silently stripped, which would alter a fiscal record's text.
  // `value !== undefined &&` is mutation-tested as equivalent: RefExterna is
  // the only optional caller below, and RegExp.prototype.test() coerces an
  // undefined argument to the literal string "undefined" (verified in
  // Node), which CONTROL_CHAR_PATTERN never matches — so a `true &&` mutant
  // still evaluates to false on the one call site where the guard could
  // matter. No test can kill an equivalent mutant.
  const checkNoControlChars = (field: string, value: string | undefined) => {
    if (value !== undefined && CONTROL_CHAR_PATTERN.test(value)) {
      add("CONTROL_CHAR", field, `${field} must not contain XML control characters`);
    }
  };
  checkNoControlChars("RefExterna", record.RefExterna);
  checkNoControlChars("SistemaInformatico.NombreRazon", record.SistemaInformatico.NombreRazon);
  checkNoControlChars(
    "SistemaInformatico.NombreSistemaInformatico",
    record.SistemaInformatico.NombreSistemaInformatico,
  );

  // `!== undefined`, not `"RegistroAnterior" in record.Encadenamiento` — see
  // huellaAnteriorOf in huella.ts for why the `in` operator does not narrow
  // this union now that both Encadenamiento branches pin the other's field
  // to `?: never` rather than omitting it.
  if (record.Encadenamiento.RegistroAnterior !== undefined) {
    const anterior = record.Encadenamiento.RegistroAnterior.Huella;
    if (!HUELLA_PATTERN.test(anterior)) {
      add(
        "HUELLA_ANTERIOR_FORMAT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must be 64 uppercase hexadecimal characters",
      );
    }
    if (anterior === record.Huella) {
      add(
        "HUELLA_ANTERIOR_EQUALS_CURRENT",
        "Encadenamiento.RegistroAnterior.Huella",
        "Predecessor huella must differ from this record's huella",
      );
    }
  }

  if (!isAlta(record)) return issues;

  // AEAT 1114/1115: TipoRectificativa is mandatory when TipoFactura is a
  // rectificativa (R1-R5) and forbidden otherwise — never optional either way.
  const esRectificativa = TIPO_FACTURA_RECTIFICATIVA_PATTERN.test(record.TipoFactura);
  if (esRectificativa && record.TipoRectificativa === undefined) {
    add(
      "TIPO_RECTIFICATIVA_REQUIRED",
      "TipoRectificativa",
      "TipoRectificativa is mandatory when TipoFactura is R1-R5",
    );
  }
  if (!esRectificativa && record.TipoRectificativa !== undefined) {
    add(
      "TIPO_RECTIFICATIVA_FORBIDDEN",
      "TipoRectificativa",
      "TipoRectificativa must not be set when TipoFactura is not R1-R5",
    );
  }
  // AEAT 1118: a rectificativa por sustitución must carry the replaced
  // base/cuota — ImporteRectificacion is how the substituted amounts reach
  // AEAT at all, so it is mandatory rather than merely encouraged.
  if (record.TipoRectificativa === "S" && record.ImporteRectificacion === undefined) {
    add(
      "IMPORTE_RECTIFICACION_REQUIRED",
      "ImporteRectificacion",
      "ImporteRectificacion is mandatory when TipoRectificativa is S (sustitución)",
    );
  }

  // A full invoice (F1/F3) must identify its recipient; for F3 canje AEAT is
  // explicit — «Siempre debe llevar el destinatario» (verifactu-findings.md:621).
  // A simplified ticket (F2) must NOT carry one; it records the absence via
  // FacturaSinIdentifDestinatarioArt61d instead. The XSD makes Destinatarios
  // minOccurs=0 for every TipoFactura, so this business rule is enforced here
  // rather than by the schema — an F3 filed without it is rejected by AEAT, the
  // same failure mode as an R5 missing its TipoRectificativa.
  const requiereDestinatario = record.TipoFactura === "F1" || record.TipoFactura === "F3";
  if (requiereDestinatario && record.Destinatarios === undefined) {
    add(
      "DESTINATARIOS_REQUIRED",
      "Destinatarios",
      "Destinatarios is mandatory when TipoFactura is F1 or F3",
    );
  }
  if (record.TipoFactura === "F2" && record.Destinatarios !== undefined) {
    add(
      "DESTINATARIOS_FORBIDDEN",
      "Destinatarios",
      "Destinatarios must not be set when TipoFactura is F2 (simplified ticket)",
    );
  }
  // sf:Destinatarios is minOccurs=0, but once present its inner IDDestinatario
  // is minOccurs=1 maxOccurs=1000 (SuministroInformacion.xsd:159). An empty
  // array is type-valid and passes the `!== undefined` checks above, yet would
  // serialize to a schema-invalid empty <sf:Destinatarios/> that AEAT rejects —
  // so fail locally with a structured issue instead of emitting invalid XML.
  if (record.Destinatarios !== undefined && record.Destinatarios.IDDestinatario.length < 1) {
    add(
      "DESTINATARIOS_EMPTY",
      "Destinatarios",
      "Destinatarios, when present, must carry at least one IDDestinatario",
    );
  }

  if (record.DescripcionOperacion.length > 500) {
    add(
      "DESCRIPCION_LENGTH",
      "DescripcionOperacion",
      "DescripcionOperacion is at most 500 characters",
    );
  }
  checkNoControlChars("DescripcionOperacion", record.DescripcionOperacion);
  checkNoControlChars("NombreRazonEmisor", record.NombreRazonEmisor);
  if (record.Desglose.length < 1 || record.Desglose.length > 12) {
    add("DESGLOSE_COUNT", "Desglose", "Desglose must carry 1 to 12 detail lines");
  }

  // Number("not-a-number") is NaN, and every comparison with NaN is false —
  // so a malformed CuotaTotal/ImporteTotal/desglose amount would silently
  // defeat the tolerance checks below instead of failing them. Validate the
  // literals are well-formed first, and skip the numeric cross-check for any
  // total whose inputs are malformed rather than compare against NaN (or a
  // corrupted sum) and risk a confusing spurious mismatch warning on top of
  // the AMOUNT_FORMAT error already reported.
  const checkTotalAmountFormat = (field: string, value: string): boolean => {
    const valid = isValidAmount(value);
    if (!valid) {
      add(
        "AMOUNT_FORMAT",
        field,
        `${field} must be a decimal with exactly two decimal places and no leading +`,
      );
    }
    return valid;
  };
  const cuotaTotalValid = checkTotalAmountFormat("CuotaTotal", record.CuotaTotal);
  const importeTotalValid = checkTotalAmountFormat("ImporteTotal", record.ImporteTotal);

  let desgloseAmountsValid = true;
  record.Desglose.forEach((detalle, index) => {
    // The schema's DetalleType models these two as an xsd:choice: exactly
    // one of the two must be present. Both present or both absent are
    // equally invalid — neither is "more correct" than the other, so both
    // fail the same way.
    const hasCalificacion = detalle.CalificacionOperacion !== undefined;
    const hasExenta = detalle.OperacionExenta !== undefined;
    if (hasCalificacion === hasExenta) {
      add(
        "DESGLOSE_CHOICE",
        `Desglose[${index}]`,
        "Each desglose line must carry exactly one of CalificacionOperacion or OperacionExenta",
      );
    }

    const fields: Array<[string, string | undefined]> = [
      ["BaseImponibleOimporteNoSujeto", detalle.BaseImponibleOimporteNoSujeto],
      ["CuotaRepercutida", detalle.CuotaRepercutida],
      ["CuotaRecargoEquivalencia", detalle.CuotaRecargoEquivalencia],
    ];
    for (const [name, value] of fields) {
      if (value !== undefined && !isValidAmount(value)) {
        desgloseAmountsValid = false;
        add(
          "AMOUNT_FORMAT",
          `Desglose[${index}].${name}`,
          `${name} must be a decimal with exactly two decimal places and no leading +`,
        );
      }
    }

    // TipoImpositivo/TipoRecargoEquivalencia are Tipo2.2Type: unsigned, at
    // most 3 integer digits. formatAmountExact is signed with up to 12 integer
    // digits, so it happily produces literals this narrower type rejects
    // (e.g. TipoImpositivo: 1234.5 -> "1234.50").
    const tipoFields: Array<[string, string | undefined]> = [
      ["TipoImpositivo", detalle.TipoImpositivo],
      ["TipoRecargoEquivalencia", detalle.TipoRecargoEquivalencia],
    ];
    for (const [name, value] of tipoFields) {
      if (value !== undefined && !TIPO_PATTERN.test(value)) {
        add(
          "TIPO_RANGE",
          `Desglose[${index}].${name}`,
          `${name} must be unsigned with at most 3 integer digits and exactly 2 decimal digits`,
        );
      }
    }
  });

  // AEAT cross-checks totals against the desglose with a +/- 10.00 tolerance
  // and treats a breach as an admissible error, so these are warnings: failing
  // locally would block records AEAT would have accepted.
  const cuotas = sum(record.Desglose.map((d) => d.CuotaRepercutida));
  const recargos = sum(record.Desglose.map((d) => d.CuotaRecargoEquivalencia));
  const bases = sum(record.Desglose.map((d) => d.BaseImponibleOimporteNoSujeto));

  if (
    cuotaTotalValid &&
    desgloseAmountsValid &&
    Math.abs(Number(record.CuotaTotal) - (cuotas + recargos)) > TOTAL_TOLERANCE
  ) {
    add(
      "CUOTA_TOTAL_MISMATCH",
      "CuotaTotal",
      "CuotaTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }
  if (
    importeTotalValid &&
    desgloseAmountsValid &&
    Math.abs(Number(record.ImporteTotal) - (bases + cuotas + recargos)) > TOTAL_TOLERANCE
  ) {
    add(
      "IMPORTE_TOTAL_MISMATCH",
      "ImporteTotal",
      "ImporteTotal disagrees with the desglose beyond the 10.00 tolerance",
      "warning",
    );
  }

  return issues;
}
