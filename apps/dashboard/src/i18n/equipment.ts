import type { EquipmentHolder } from "../api/client.js";
import { t } from "./t.js";

/** The device holding an item and, when someone is signed in on it, who. */
export function holderText(holder: EquipmentHolder | null): string {
  if (holder === null) return t("equipment.holder_none");
  if (holder.personName === null) return holder.deviceName;
  return t("equipment.holder_with_person")
    .replace("{device}", holder.deviceName)
    .replace("{person}", holder.personName);
}
