import type { StringKey } from "./strings.js";
import { fill, named, t } from "./t.js";

const namedKeys: Partial<Record<StringKey, StringKey>> = {
  "table.change_dish_started": "table.change_dish_started_named",
  "table.change_dish_started_void": "table.change_dish_started_void_named",
  "table.change_dish_fired_void": "table.change_dish_fired_void_named",
  "held.sent_dish_started": "held.sent_dish_started_named",
  "held.sent_dish_fired": "held.sent_dish_fired_named",
  "move_station.refused.ticket.already_started":
    "move_station.refused.ticket.already_started_named",
  "move_station.order_refused.ticket.already_started":
    "move_station.order_refused.ticket.already_started_named",
};

const bannerKeys = new Map<string, StringKey>([
  ["ticket.already_started", "table.change_dish_started_void"],
  ["ticket.already_fired", "table.change_dish_fired_void"],
  ["ticket.already_served", "table.change_dish_served_void"],
]);

export const SENT_DISH_SAVE_REFUSALS = new Map<string, StringKey>([
  ["ticket.already_served", "held.sent_dish_served"],
  ["ticket.already_started", "held.sent_dish_started"],
  ["ticket.already_fired", "held.sent_dish_fired"],
  ["ticket.already_sent", "held.sent_dish_sent"],
]);

export interface SentItemRefusal {
  key: StringKey;
  dish?: string;
  stationName?: string;
}

export function stationNameOf(error: unknown): string {
  const name = (error as { stationName?: unknown } | undefined)?.stationName;
  return typeof name === "string" ? name : "";
}

export function sentDishRefusal(
  code: string | undefined,
  dish: string,
  stationName = "",
): SentItemRefusal | undefined {
  const key = bannerKeys.get(code ?? "");
  return key === undefined ? undefined : { key, dish, stationName };
}

export function sentDishRefusalText({ key, dish, stationName = "" }: SentItemRefusal): string {
  const namedKey = namedKeys[key];
  if (dish === undefined)
    return namedKey === undefined ? t(key) : named(stationName, t(namedKey), t(key));
  return fill(t(stationName === "" ? key : (namedKey ?? key)), { dish, name: stationName });
}
