import { XMLParser } from "fast-xml-parser";

/**
 * Shared parser configuration for both response parsers (parse-suministro.ts
 * and parse-consulta.ts). Leaf values stay strings — parseTagValue is off —
 * so each parser converts specific numeric fields explicitly via asNumber
 * below.
 *
 * parseTagValue is deliberately off: flipping it to true would turn a literal
 * like "123.40" into the number 123.4 and "0012345678" into 12345678,
 * destroying literals on the reconciliation path (DatosRegistroFacturacion
 * holds AEAT's stored literals, compared field-for-field against ours).
 *
 * trimValues is deliberately off too, for the identical reason: it is a
 * second, independent transformation of the same literals, applied whether or
 * not parseTagValue would also have mangled them. fast-xml-parser defaults
 * this to `true`, which would silently strip leading/trailing whitespace from
 * every leaf — including DatosRegistroFacturacion's stored literals — before
 * this library ever sees them. AEAT's SOAP responses are not pretty-printed
 * inside leaf content (any indentation whitespace lives between sibling
 * elements, which have no text of their own to trim), so there is no real
 * wire-format upside to trimming; there is only the downside of quietly
 * reformatting a value this path exists specifically not to reformat.
 *
 * removeNSPrefix strips namespace prefixes so `sfR:EstadoEnvio` and
 * `EstadoEnvio` both land on the same key — AEAT's prefixes are not
 * guaranteed stable across environments, and binding to them would make the
 * parser brittle.
 */
export const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

/** Normalises fast-xml-parser's single-element-collapses-to-object behaviour. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Converts a raw string leaf (parseTagValue is off) to a number, preserving
 * undefined for a genuinely absent optional field.
 *
 * Throws rather than returning NaN when the field IS present but its content
 * does not convert to a finite number (e.g. a non-numeric string). Silently
 * propagating NaN would let a malformed response masquerade as a well-typed
 * `number` all the way to the caller — a poisoned value some callers use to
 * schedule follow-up work, where it should instead fail loudly right here at
 * the parse boundary.
 */
export function asNumber(value: string | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid number, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * Like asNumber, but for a field the schema requires to be present. Reuses
 * asNumber's "present but malformed" check, then additionally rejects the
 * absent case: fast-xml-parser simply omits the key for a missing element at
 * runtime regardless of what the raw interface's `string` annotation claims,
 * so an absent required field must be caught here rather than silently
 * converting `undefined` to `NaN` via `Number(undefined)`.
 */
export function asRequiredNumber(value: string | undefined, field: string): number {
  const parsed = asNumber(value, field);
  if (parsed === undefined) {
    throw new Error(`${field} must be a valid number, received ${JSON.stringify(value)}`);
  }
  return parsed;
}
