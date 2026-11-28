export type OrderStart = "table" | "counter";

export function effectiveOrderStart(
  zone: OrderStart | null | undefined,
  department: OrderStart | null | undefined,
): OrderStart {
  return zone ?? department ?? "counter";
}
