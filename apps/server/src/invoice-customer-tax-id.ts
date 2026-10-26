import { AppError } from "@waitron/shared";
import "./errors.js";

const IGNORED = /[\s.\-\u2010-\u2015\u200b-\u200d\ufeff]/gu;
const MAX_TYPED_LENGTH = 64;

/** One spelling for a tax number: no whitespace, full stops, hyphens, hyphen look-alikes or
 * zero-width characters, upper-case, one leading "ES" removed. Used on the typed and the stored
 * side alike. */
export function normaliseInvoiceTaxId(value: string): string {
  const compact = value.replace(IGNORED, "").toUpperCase().replace(/^ES/, "");
  // Spain's checker stores a DNI as eight digits and a letter, and no form it accepts is seven.
  return /^\d{7}[A-Z]$/.test(compact) ? `0${compact}` : compact;
}

/** The query's `taxId`, normalised; refuses `management.request_invalid` `{ field: "taxId" }`. */
export function requiredInvoiceTaxId(raw: string | undefined): string {
  // The value never goes into the params: the error boundary writes params into the log.
  const refused = new AppError("management.request_invalid", { field: "taxId" });
  if (raw === undefined || raw.length > MAX_TYPED_LENGTH) throw refused;
  // Checked before upper-casing: a long s and a dotless i upper-case to ASCII letters.
  if (!/^[A-Za-z0-9]*$/.test(raw.replace(IGNORED, ""))) throw refused;
  const normalised = normaliseInvoiceTaxId(raw);
  if (!/^[A-Z0-9]{1,20}$/.test(normalised)) throw refused;
  return normalised;
}
