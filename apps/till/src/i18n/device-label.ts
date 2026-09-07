import { t } from "./t.js";
import type { StringKey } from "./strings.js";

/**
 * Human label for a device KIND (`till` / `handheld` / `kds_station`) — the derived value the dev
 * chooser's `GET /api/dev/devices` list carries (the server maps a profile's form factor through
 * `kindOfFormFactor`). This is the one place that turns that machine token into a localised label so no
 * surface renders `kds_station`/`till` raw. An unknown kind degrades to the token itself rather than
 * throwing — the forward-compatible posture the client's plain-`string` `kind` field already takes.
 */
const KIND_LABEL: Record<string, StringKey> = {
  till: "device.type.till",
  handheld: "device.type.handheld",
  kds_station: "device.type.kds",
};

export function deviceKindLabel(kind: string): string {
  const key = KIND_LABEL[kind];
  return key === undefined ? kind : t(key);
}
