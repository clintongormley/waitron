/**
 * The record type a correction by differences of `original` files, or `undefined` when none may.
 *
 * A full invoice (F1), or an R4 replacing one, takes an R1 and must name a customer; a simplified
 * invoice (F2), or an R5 replacing one, takes an R5 and must name none. Every other original is
 * refused: an F3 (D1 of the correct-full-invoice plan) and an earlier correction by differences.
 */
export function correctionRecordType(
  original: { tipo_factura: unknown; tipo_rectificativa: unknown },
  namesCustomer: boolean,
): "R1" | "R5" | undefined {
  const replaced = original.tipo_rectificativa === "S";
  if (
    namesCustomer &&
    (original.tipo_factura === "F1" || (original.tipo_factura === "R4" && replaced))
  ) {
    return "R1";
  }
  if (
    !namesCustomer &&
    (original.tipo_factura === "F2" || (original.tipo_factura === "R5" && replaced))
  ) {
    return "R5";
  }
  return undefined;
}
