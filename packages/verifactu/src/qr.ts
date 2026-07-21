import { QR_ENDPOINTS, type Environment } from "./endpoints.js";
import type { RegistroAlta } from "./types.js";

/**
 * Percent-encodes a parameter value.
 *
 * AEAT's reference uses Java's URLEncoder (form-urlencoding, space -> "+"),
 * while encodeURIComponent follows RFC 3986 (space -> "%20"). The spec does
 * not settle which applies. This function is shared by all four QR
 * parameters, and the four differ in how (or whether) that ambiguity is
 * actually foreclosed:
 *  - numserie: unreachable by construction — validate() restricts
 *    NumSerieFactura to a charset with no character where the two encodings
 *    differ.
 *  - fecha, importe: unreachable by construction — formatDate/formatAmountExact
 *    are the only producers of these literals and never emit a space or any
 *    other character where the two encodings differ, independent of
 *    whether validate() runs.
 *  - nif (IDEmisorFactura): validate() only length-checks it (=== 9), with
 *    no charset restriction, so this one is not provably safe the way the
 *    other three are — it merely relies on NIF/NIE values not containing
 *    such characters in practice.
 */
function encodeParam(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Builds the QR payload URL: exactly four mandatory parameters, in order.
 *
 * Values are taken from the record's own literals, never recomputed — the QR
 * must show what was hashed and sent.
 */
export function buildQrPayload(record: RegistroAlta, environment: Environment): string {
  const params = [
    ["nif", record.IDFactura.IDEmisorFactura],
    ["numserie", record.IDFactura.NumSerieFactura],
    ["fecha", record.IDFactura.FechaExpedicionFactura],
    ["importe", record.ImporteTotal],
  ] as const;
  const query = params.map(([name, value]) => `${name}=${encodeParam(value)}`).join("&");
  return `${QR_ENDPOINTS[environment]}?${query}`;
}
