/**
 * Derive a standby's DISJOINT invoice-series codes from the primary's, suffixing each code with the
 * standby's `numeroInstalacion` and preserving its purpose (reserved-standby-identity design §6 R2).
 *
 * The installation number is globally unique and never-reused per NIF, so appending it makes the
 * standby's codes provably disjoint from the primary's on the AEAT identity triple
 * (NIF, NumSerieFactura, Fecha) — two nodes under one obligado can never emit the same
 * NumSerieFactura. The SOLE backstop against an operator manually configuring a colliding code is
 * AEAT error 3000 (duplicate at filing); this derivation is what keeps that path from ever being
 * reached under normal operation.
 */
export function deriveReservedSeriesCodes(
  primarySeries: readonly { code: string; purpose: string }[],
  numeroInstalacion: number,
): { code: string; purpose: string }[] {
  return primarySeries.map((s) => ({ code: `${s.code}-${numeroInstalacion}`, purpose: s.purpose }));
}
