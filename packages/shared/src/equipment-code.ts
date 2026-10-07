import { isUuid } from "./ids.js";

/** What an equipment label names: a portable printer or a card reader. */
export type EquipmentKind = "printer" | "reader";

const PREFIX = "waitron-equipment:";
const KINDS: readonly EquipmentKind[] = ["printer", "reader"];

/** The text an equipment label's QR code carries, which the till's scanner reads back. */
export function formatEquipmentCode(kind: EquipmentKind, id: string): string {
  return `${PREFIX}${kind}:${id}`;
}

/** Reads a scanned label, or null for anything that is not exactly a Waitron equipment code. */
export function parseEquipmentCode(text: string): { kind: EquipmentKind; id: string } | null {
  if (!text.startsWith(PREFIX)) return null;
  const parts = text.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  const [kind, id] = parts as [string, string];
  if (!KINDS.includes(kind as EquipmentKind) || !isUuid(id)) return null;
  return { kind: kind as EquipmentKind, id: id.toLowerCase() };
}
