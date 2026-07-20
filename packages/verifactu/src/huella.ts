import { createHash } from "node:crypto";
import { trimValue } from "./format.js";
import { isAlta } from "./types.js";
import type {
  CadenaAltaInput,
  CadenaAnulacionInput,
  Encadenamiento,
  RegistroAlta,
  RegistroAnulacion,
} from "./types.js";

/**
 * Joins ordered name/value pairs into AEAT's canonical hash input.
 *
 * Deliberately an ordered array of tuples rather than an object: the evento
 * record (not implemented here) repeats the key `NIF` twice, which an object
 * would silently collapse. Keeping the shape correct from the start costs
 * nothing and removes a trap later.
 *
 * The key is never omitted. An absent value contributes `Nombre=` and still
 * consumes its separator, so the separator count is fixed: 7 for alta, 4 for
 * anulación. There is no trailing separator.
 */
function joinCampos(campos: ReadonlyArray<readonly [string, string]>): string {
  return campos.map(([nombre, valor]) => `${nombre}=${trimValue(valor)}`).join("&");
}

/**
 * Extracts the predecessor huella — empty for the first record of a chain.
 *
 * `!== undefined`, not `"RegistroAnterior" in encadenamiento`: since
 * Encadenamiento's branches each pin the other's field to `?: never` (rather
 * than omitting it), the property exists — merely optional — on both union
 * members, so `in` narrowing (which only excludes a member when the property
 * is entirely absent from its type) leaves the full union in scope and
 * `encadenamiento.RegistroAnterior` typed `RegistroAnterior | undefined`.
 * The dotted-name `!== undefined` check narrows correctly instead.
 */
export function huellaAnteriorOf(encadenamiento: Encadenamiento): string {
  return encadenamiento.RegistroAnterior !== undefined
    ? encadenamiento.RegistroAnterior.Huella
    : "";
}

export function buildCadenaAlta(input: CadenaAltaInput): string {
  return joinCampos([
    ["IDEmisorFactura", input.IDEmisorFactura],
    ["NumSerieFactura", input.NumSerieFactura],
    ["FechaExpedicionFactura", input.FechaExpedicionFactura],
    ["TipoFactura", input.TipoFactura],
    ["CuotaTotal", input.CuotaTotal],
    ["ImporteTotal", input.ImporteTotal],
    // The PREVIOUS record's huella, from Encadenamiento/RegistroAnterior/Huella
    // — never this record's own Huella, which is the output.
    ["Huella", input.huellaAnterior],
    ["FechaHoraHusoGenRegistro", input.FechaHoraHusoGenRegistro],
  ]);
}

export function buildCadenaAnulacion(input: CadenaAnulacionInput): string {
  return joinCampos([
    ["IDEmisorFacturaAnulada", input.IDEmisorFacturaAnulada],
    ["NumSerieFacturaAnulada", input.NumSerieFacturaAnulada],
    ["FechaExpedicionFacturaAnulada", input.FechaExpedicionFacturaAnulada],
    // Named plainly `Huella`, not `HuellaAnulada`.
    ["Huella", input.huellaAnterior],
    ["FechaHoraHusoGenRegistro", input.FechaHoraHusoGenRegistro],
  ]);
}

/** Builds the canonical string for either record type. */
export function buildCadena(record: RegistroAlta | RegistroAnulacion): string {
  const huellaAnterior = huellaAnteriorOf(record.Encadenamiento);
  if (isAlta(record)) {
    return buildCadenaAlta({
      IDEmisorFactura: record.IDFactura.IDEmisorFactura,
      NumSerieFactura: record.IDFactura.NumSerieFactura,
      FechaExpedicionFactura: record.IDFactura.FechaExpedicionFactura,
      TipoFactura: record.TipoFactura,
      CuotaTotal: record.CuotaTotal,
      ImporteTotal: record.ImporteTotal,
      huellaAnterior,
      FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
    });
  }
  return buildCadenaAnulacion({
    IDEmisorFacturaAnulada: record.IDFactura.IDEmisorFacturaAnulada,
    NumSerieFacturaAnulada: record.IDFactura.NumSerieFacturaAnulada,
    FechaExpedicionFacturaAnulada: record.IDFactura.FechaExpedicionFacturaAnulada,
    huellaAnterior,
    FechaHoraHusoGenRegistro: record.FechaHoraHusoGenRegistro,
  });
}

/**
 * SHA-256 over the UTF-8 bytes of the canonical string, uppercase hex.
 * `TipoHuella` "01" denotes SHA-256 and is currently the only permitted value.
 */
export function computeHuella(record: RegistroAlta | RegistroAnulacion): string {
  // The "utf8" encoding argument is mutation-tested as equivalent: Node's
  // Hash.update() treats an empty-string encoding identically to "utf8" (it
  // does not throw or fall back to a different codec), confirmed against
  // ASCII, accented, CJK and emoji inputs. No test can kill an equivalent
  // mutant — this is left explicit anyway because "utf8" is what makes the
  // digest match AEAT's own byte-for-byte recomputation.
  return createHash("sha256").update(buildCadena(record), "utf8").digest("hex").toUpperCase();
}

/**
 * Art. 7.i support: does this record's stored huella match its own content?
 *
 * Detects tampering with a record after it was hashed. Note this is only half
 * of the art. 7.i duty — the caller must also check that the record's
 * predecessor pointer matches the actual predecessor's huella.
 */
export function verifyHuella(record: RegistroAlta | RegistroAnulacion): boolean {
  return record.Huella === computeHuella(record);
}
