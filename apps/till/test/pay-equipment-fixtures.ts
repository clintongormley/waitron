import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../src/api/client.js";

export function equipmentItem(
  id: string,
  name: string,
  extra: Partial<EquipmentItem> = {},
): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}
export const SECOND_READER = equipmentItem("r2", "Lector 2", { portable: true, provider: "sumup" });
export const THIRD_READER = equipmentItem("r3", "Lector 3", { portable: true, provider: "sumup" });
export const BAR_PRINTER = equipmentItem("p1", "Barra");

export function roleOf(
  name: RoleEquipment["role"],
  chosen: EquipmentItem | null,
  choices: EquipmentItem[],
): RoleEquipment {
  return {
    role: name,
    selection: chosen === null ? "default" : "item",
    chosenId: chosen?.id ?? null,
    resolved:
      chosen === null
        ? null
        : {
            id: chosen.id,
            name: chosen.name,
            available: chosen.available,
            provider: chosen.provider,
          },
    chosen,
    default: null,
    choices,
  };
}

export function twoReaderEquipment(reader: EquipmentItem | null): DeviceEquipment {
  return {
    roles: [
      roleOf("receipt", BAR_PRINTER, [BAR_PRINTER]),
      roleOf("card_terminal", reader, [SECOND_READER, THIRD_READER]),
    ],
  };
}
