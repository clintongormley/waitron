import { fill, t } from "../i18n/t.js";
import type { ComboboxOption } from "@waitron/ui";
import type { EquipmentItem, RoleEquipment } from "../api/client.js";

export function optionLabel(item: EquipmentItem): string {
  if (item.busy) return fill(t("equipment.option_busy"), { item: item.name });
  if (item.heldBy !== null)
    return fill(t("equipment.option_held"), { item: item.name, device: item.heldBy.deviceName });
  if (!item.available) return fill(t("equipment.switched_off"), { item: item.name });
  return item.kind === "a4" ? fill(t("equipment.option_a4"), { item: item.name }) : item.name;
}

export function inheritEquipmentOption(equipment: RoleEquipment): ComboboxOption {
  const item = equipment.default;
  // An unclaimed reader still names the reader staff can claim through Inherit.
  const name =
    equipment.selection === "default" && equipment.role !== "card_terminal"
      ? equipment.resolved?.name
      : item?.heldBy
        ? undefined
        : item?.name;
  const valueLabel = name ?? t("equipment.none");
  return {
    value: "",
    inherited: true,
    label: fill(t("inherit.value"), { value: valueLabel }),
    valueLabel,
  };
}
