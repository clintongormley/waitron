import { fill, t } from "../i18n/t.js";
import type { ComboboxOption } from "@waitron/ui";
import type { EquipmentItem } from "../api/client.js";

export function optionLabel(item: EquipmentItem): string {
  if (item.busy) return fill(t("equipment.option_busy"), { item: item.name });
  if (item.heldBy !== null)
    return fill(t("equipment.option_held"), { item: item.name, device: item.heldBy.deviceName });
  if (!item.available) return fill(t("equipment.switched_off"), { item: item.name });
  return item.kind === "a4" ? fill(t("equipment.option_a4"), { item: item.name }) : item.name;
}

export function inheritEquipmentOption(item: EquipmentItem | null): ComboboxOption {
  const valueLabel = item === null || item.heldBy ? t("equipment.none") : item.name;
  return {
    value: "",
    inherited: true,
    label: fill(t("inherit.value"), { value: valueLabel }),
    valueLabel,
  };
}
