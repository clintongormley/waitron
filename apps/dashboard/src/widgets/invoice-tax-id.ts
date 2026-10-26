// A second copy of apps/server/src/invoice-customer-tax-id.ts: an app cannot import another app's
// code. invoice-tax-id.test.ts holds a copy of the server's tables.
const IGNORED = /[\s.\-\u2010-\u2015\u200b-\u200d\ufeff]/gu;
const MAX_TYPED_LENGTH = 64;

export function normaliseInvoiceTaxId(value: string): string {
  const compact = value.replace(IGNORED, "").toUpperCase().replace(/^ES/, "");
  return /^\d{7}[A-Z]$/.test(compact) ? `0${compact}` : compact;
}

/** Null when the server would accept the typed value. */
export function invoiceTaxIdProblem(value: string): "invoice_customer.tax_id_invalid" | null {
  const invalid = "invoice_customer.tax_id_invalid";
  if (value.length > MAX_TYPED_LENGTH) return invalid;
  // Checked before upper-casing: a long s and a dotless i upper-case to ASCII letters.
  if (!/^[A-Za-z0-9]*$/.test(value.replace(IGNORED, ""))) return invalid;
  return /^[A-Z0-9]{1,20}$/.test(normaliseInvoiceTaxId(value)) ? null : invalid;
}
