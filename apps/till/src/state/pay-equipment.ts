import { tillProviderForReader, type TillReaderProvider } from "@waitron/shared";
import type {
  DeviceEquipment,
  EquipmentItem,
  EquipmentRole,
  RoleEquipment,
} from "../api/client.js";

/** The reader a payment from this device would be charged on. */
export type PayReader =
  | { kind: "ready"; id: string; name: string; provider: TillReaderProvider; fromDefault: boolean }
  | { kind: "switched_off"; id: string; name: string }
  | { kind: "none" };

/** The printer a payment's receipt would print on. */
export type PayPrinter =
  | { kind: "ready"; id: string; name: string; fromDefault: boolean }
  /** The printer the receipt role points at, switched off: the receipt prints nothing. */
  | { kind: "switched_off"; id: string; name: string }
  | { kind: "unset" }
  | { kind: "none_listed" };

function roleOf(equipment: DeviceEquipment | null, role: EquipmentRole): RoleEquipment | undefined {
  return equipment?.roles.find((each) => each.role === role);
}

export function payReaderOf(equipment: DeviceEquipment | null): PayReader {
  const role = roleOf(equipment, "card_terminal");
  const resolved = role?.resolved ?? null;
  if (resolved === null) {
    const chosen = role?.chosen ?? null;
    return chosen !== null && !chosen.available
      ? { kind: "switched_off", id: chosen.id, name: chosen.name }
      : { kind: "none" };
  }
  if (!resolved.available) return { kind: "switched_off", id: resolved.id, name: resolved.name };
  const provider = tillProviderForReader(resolved.provider);
  return provider === undefined
    ? { kind: "none" }
    : {
        kind: "ready",
        id: resolved.id,
        name: resolved.name,
        provider,
        fromDefault: role!.selection === "default",
      };
}

export function payPrinterOf(equipment: DeviceEquipment | null): PayPrinter {
  const role = roleOf(equipment, "receipt");
  const resolved = role?.resolved ?? null;
  // A chosen printer that is switched off does not fall back to the default: the role still
  // resolves to it, and a receipt sent there prints nothing.
  if (resolved !== null) {
    return resolved.available
      ? {
          kind: "ready",
          id: resolved.id,
          name: resolved.name,
          fromDefault: role!.selection === "default",
        }
      : { kind: "switched_off", id: resolved.id, name: resolved.name };
  }
  // "Sin ticket" only when the profile names no receipt printer at all (design default 19).
  const named =
    role !== undefined &&
    (role.choices.length > 0 || role.default !== null || role.chosen !== null);
  return named ? { kind: "unset" } : { kind: "none_listed" };
}

/** Whether the folded row opens by itself: the payment has no reader, or its receipt would not print. */
export function rowStartsOpen(reader: PayReader, printer: PayPrinter): boolean {
  return reader.kind !== "ready" || printer.kind === "switched_off" || printer.kind === "unset";
}

/** The readers the device may pick, in list order; one another device is paying on stays, `busy`. */
export function readerChoices(equipment: DeviceEquipment | null): EquipmentItem[] {
  return roleOf(equipment, "card_terminal")?.choices ?? [];
}

export function printerChoices(equipment: DeviceEquipment | null): EquipmentItem[] {
  return roleOf(equipment, "receipt")?.choices ?? [];
}
