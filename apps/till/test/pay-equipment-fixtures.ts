import type { DeviceEquipment, EquipmentItem, RoleEquipment } from "../src/api/client.js";

export function equipmentItem(
  id: string,
  name: string,
  extra: Partial<EquipmentItem> = {},
): EquipmentItem {
  return { id, name, portable: false, available: true, busy: false, heldBy: null, ...extra };
}
export const LECTOR_2 = equipmentItem("r2", "Lector 2", { portable: true, provider: "sumup" });
export const LECTOR_3 = equipmentItem("r3", "Lector 3", { portable: true, provider: "sumup" });
export const BARRA = equipmentItem("p1", "Barra");

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

/** The phone's equipment with `reader` (none when null) and the Barra receipt printer chosen,
 * offering Lector 2 and Lector 3. */
export function twoReaderEquipment(reader: EquipmentItem | null): DeviceEquipment {
  return {
    roles: [
      roleOf("receipt", BARRA, [BARRA]),
      roleOf("card_terminal", reader, [LECTOR_2, LECTOR_3]),
    ],
  };
}
