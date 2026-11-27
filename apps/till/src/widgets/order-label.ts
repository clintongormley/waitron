import { t } from "../i18n/t.js";

export function orderLabel(order: {
  label: string | null;
  tableLabel?: string;
  counter?: true;
}): string | null {
  const place = order.counter ? t("station.counter") : order.tableLabel;
  return [...new Set([place, order.label].filter(Boolean))].join(" · ") || null;
}

export type NamedOrderZone = { id: string; name: string };

export function outsideOrderLocation(
  order: { zoneId: string | null; tableLabel?: string },
  zones: readonly NamedOrderZone[] | undefined,
): string {
  if (zones === undefined || order.tableLabel) return "";
  const zone = zones.find(({ id }) => id === order.zoneId);
  return ` · ${order.zoneId === null ? t("counter.floor_no_zone") : (zone?.name ?? t("counter.floor_unknown_zone"))}`;
}
