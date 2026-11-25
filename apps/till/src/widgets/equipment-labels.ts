import { fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { ComboboxOption } from "@waitron/ui";
import type {
  DeviceEquipment,
  EquipmentChange,
  EquipmentItem,
  RoleEquipment,
} from "../api/client.js";

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

export function pickedUpMessage(
  change: EquipmentChange,
  stored: DeviceEquipment,
  item: string,
  noRole: StringKey = "equipment.no_printer_role",
): string {
  const selection = change.selection;
  const printer = "kind" in change && change.kind === "printer" && typeof selection === "object";
  const printerFor = (name: "receipt" | "payment_slip") =>
    printer &&
    stored.roles.some(
      (role) =>
        role.role === name &&
        (role.chosenId === selection.id || role.resolved?.id === selection.id),
    );
  const receipt = printerFor("receipt");
  const slip = printerFor("payment_slip");
  if (printer && !receipt && !slip) return t(noRole);
  const picked =
    receipt === slip
      ? "equipment.picked_up"
      : receipt
        ? "equipment.picked_up_receipt_only"
        : "equipment.picked_up_slip_only";
  return fill(t(picked), { item });
}
