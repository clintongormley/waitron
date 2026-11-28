export type OrderStart = "table" | "counter";

export function effectiveOrderStart(zone: unknown, department: unknown): OrderStart {
  return (zone ?? department) === "table" ? "table" : "counter";
}
