/** The series code and number `formatInvoiceNumber` (`@waitron/core`) joined at the last slash; a
 * value with no whole number after its last slash is kept whole as the series, with no number. */
export function invoiceNumberParts(value: string): { series: string; number: number | null } {
  const match = /^(.+)\/(\d+)$/.exec(value);
  if (match === null) return { series: value, number: null };
  return { series: match[1]!, number: Number(match[2]) };
}
