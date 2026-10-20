export function orderLabel(order: { label: string | null; tableLabel?: string }): string | null {
  return [...new Set([order.tableLabel, order.label].filter(Boolean))].join(" · ") || null;
}
