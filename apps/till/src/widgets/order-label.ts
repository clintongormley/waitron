import { t } from "../i18n/t.js";

export function orderLabel(order: {
  label: string | null;
  tableLabel?: string;
  counter?: true;
}): string | null {
  const place = order.counter ? t("station.counter") : order.tableLabel;
  return [...new Set([place, order.label].filter(Boolean))].join(" · ") || null;
}
