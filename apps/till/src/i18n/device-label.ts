import { t } from "./t.js";
import type { StringKey } from "./strings.js";

const KIND_LABEL = new Map<string, StringKey>([
  ["till", "device.type.till"],
  ["handheld", "device.type.handheld"],
  ["kds_station", "device.type.kds"],
]);

export function deviceKindLabel(kind: string): string {
  const key = KIND_LABEL.get(kind);
  return key === undefined ? kind : t(key);
}
