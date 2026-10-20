import { tillProviderForReader, type TillReaderProvider } from "@waitron/shared";
import { carriedText, t } from "../i18n/t.js";
import type {
  DeviceEquipment,
  EquipmentHolder,
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

/** Whether the receipt would not print, which opens the folded row by itself. */
export function printerWantsRowOpen(printer: PayPrinter): boolean {
  return printer.kind === "switched_off" || printer.kind === "unset";
}

/** Whether the folded row opens by itself: the payment has no reader, or its receipt would not print. */
export function rowStartsOpen(reader: PayReader, printer: PayPrinter): boolean {
  return reader.kind !== "ready" || printerWantsRowOpen(printer);
}

/** The readers the device may pick, in list order; one another device is paying on stays, `busy`. */
export function readerChoices(equipment: DeviceEquipment | null): EquipmentItem[] {
  return roleOf(equipment, "card_terminal")?.choices ?? [];
}

export function printerChoices(equipment: DeviceEquipment | null): EquipmentItem[] {
  return roleOf(equipment, "receipt")?.choices ?? [];
}

/** A practice venue's demo reader: charged whatever the equipment says. */
export interface FixedReader {
  id: string;
  name: string;
}

/** The reader a card would be charged on now: the demo reader, else the equipment's ready one;
 * null before the equipment has been read. */
export function readyPayReader(
  equipment: DeviceEquipment | null,
  fixedReader: FixedReader | null,
): FixedReader | null {
  if (fixedReader !== null) return fixedReader;
  if (equipment === null) return null;
  const reader = payReaderOf(equipment);
  return reader.kind === "ready" ? reader : null;
}

/** Whether a handheld holds a payment for its equipment: a change is out, or a card on the reader
 * has no ready reader. */
export function heldForEquipment(
  card: boolean,
  state: {
    equipment: DeviceEquipment | null;
    equipmentBusy: boolean;
    fixedReader: FixedReader | null;
  },
): boolean {
  if (state.equipmentBusy) return true;
  return card && readyPayReader(state.equipment, state.fixedReader) === null;
}

/** Whether the row opens by itself; an unread equipment does not open it, and the demo reader
 * counts as ready. */
export function payRowWantsOpen(
  equipment: DeviceEquipment | null,
  fixedReader: FixedReader | null,
): boolean {
  if (equipment === null) return false;
  const printer = payPrinterOf(equipment);
  if (fixedReader !== null) return printerWantsRowOpen(printer);
  return rowStartsOpen(payReaderOf(equipment), printer);
}

/** The reader a phone's first payment picks up by itself (design default 18): the one reader its
 * equipment offers, free, to a phone that has had no reader in this page and has none now; else
 * null. */
export function autoPickReader(
  equipment: DeviceEquipment | null,
  hadReader: boolean,
): string | null {
  const role = roleOf(equipment, "card_terminal");
  if (hadReader || role === undefined || role.resolved !== null || role.chosenId !== null)
    return null;
  const [only, ...more] = role.choices;
  if (only === undefined || more.length > 0) return null;
  return only.available && !only.busy && only.heldBy === null ? only.id : null;
}

/** What another device took between two reads: an item a role resolved to before, which it no
 * longer does, and which the newer read says another device carries. */
export function takenFrom(before: DeviceEquipment | null, after: DeviceEquipment): string | null {
  for (const role of after.roles) {
    const was = before?.roles.find((each) => each.role === role.role)?.resolved;
    if (was == null || role.resolved?.id === was.id) continue;
    const holder: EquipmentHolder | null | undefined = [
      role.chosen,
      role.default,
      ...role.choices,
    ].find((item) => item?.id === was.id)?.heldBy;
    if (holder == null) continue;
    return carriedText(was.name, holder, "equipment.taken", "equipment.taken_person");
  }
  return null;
}

/** Why the phone no longer has the reader its previous read resolved to: another device carries
 * it, or it is offered no longer at all. */
export type ReaderLoss = { kind: "taken"; text: string } | { kind: "gone"; name: string };

export function readerLoss(
  before: DeviceEquipment | null,
  after: DeviceEquipment,
): ReaderLoss | null {
  const readerOnly = (equipment: DeviceEquipment): DeviceEquipment => ({
    roles: equipment.roles.filter((each) => each.role === "card_terminal"),
  });
  const was = roleOf(before, "card_terminal")?.resolved;
  if (before === null || was == null) return null;
  const text = takenFrom(readerOnly(before), readerOnly(after));
  if (text !== null) return { kind: "taken", text };
  const role = roleOf(after, "card_terminal");
  const offered = [role?.resolved, role?.chosen, role?.default, ...(role?.choices ?? [])];
  return offered.some((each) => each?.id === was.id) ? null : { kind: "gone", name: was.name };
}

/** The line above the open row saying why it has no reader: a switched-off reader from the read
 * itself, else what this page saw happen to the reader. */
export function readerReasonOf(
  reader: PayReader,
  loss: ReaderLoss | null,
): { line: string; hint: string | null } | null {
  if (reader.kind === "switched_off")
    return { line: t("equipment.switched_off").replace("{item}", () => reader.name), hint: null };
  if (reader.kind === "ready" || loss === null) return null;
  return loss.kind === "taken"
    ? { line: loss.text, hint: t("pay_equipment.choose_in_hand") }
    : { line: t("pay_equipment.reader_gone").replace("{item}", () => loss.name), hint: null };
}
