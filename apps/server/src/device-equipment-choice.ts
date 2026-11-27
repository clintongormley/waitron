import { requireBodyUuid } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { EquipmentRole, EquipmentSelection, EquipmentPickup } from "./device-equipment.js";
import "./errors.js";

const EQUIPMENT_ROLES: readonly EquipmentRole[] = [
  "receipt",
  "payment_slip",
  "cash_drawer",
  "invoice",
  "card_terminal",
];
/** `PUT /api/device/equipment`'s body, each field checked for shape. */
export function parseEquipmentChoice(
  body: Record<string, unknown>,
): Omit<EquipmentSelection, "deviceId"> | Omit<EquipmentPickup, "deviceId"> {
  if (body.role === undefined) {
    if (body.kind !== "printer" && body.kind !== "reader") {
      throw new AppError("management.request_invalid", { field: "kind" });
    }
    if (body.via !== "scan") throw new AppError("management.request_invalid", { field: "via" });
    if (
      typeof body.selection !== "object" ||
      body.selection === null ||
      !("id" in body.selection)
    ) {
      throw new AppError("management.request_invalid", { field: "selection" });
    }
    return {
      kind: body.kind,
      selection: { id: requireBodyUuid(body.selection.id, "selection") },
      via: "scan",
    };
  }
  const role = EQUIPMENT_ROLES.find((known) => known === body.role);
  if (role === undefined) throw new AppError("management.request_invalid", { field: "role" });
  const selection = body.selection;
  let chosen: "default" | { id: string };
  if (selection === "default") chosen = "default";
  else if (typeof selection === "object" && selection !== null && "id" in selection) {
    chosen = { id: requireBodyUuid(selection.id, "selection") };
  } else throw new AppError("management.request_invalid", { field: "selection" });
  if (body.via !== "scan" && body.via !== "list") {
    throw new AppError("management.request_invalid", { field: "via" });
  }
  if (body.takeOver !== undefined && typeof body.takeOver !== "boolean") {
    throw new AppError("management.request_invalid", { field: "takeOver" });
  }
  return { role, selection: chosen, via: body.via, takeOver: body.takeOver === true };
}
