import { belongsToComposition } from "@waitron/ui";

export type PadInput = { kind: "key"; key: string } | { kind: "enter" } | { kind: "escape" };

const digits = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** What a key press means to a number pad, or `null` when it means nothing there. Shift is not
 * checked: a French keyboard needs it to type a digit. */
export function padInputFor(event: KeyboardEvent, mode: "decimal" | "pin"): PadInput | null {
  if (event.ctrlKey || event.metaKey || event.altKey || belongsToComposition(event)) return null;
  const { key } = event;
  if (key === "Backspace") return { kind: "key", key: "backspace" };
  if (event.repeat) return null;
  if (digits.has(key)) return { kind: "key", key };
  if (key === "Enter") return { kind: "enter" };
  if (key === "Escape") return { kind: "escape" };
  if (mode === "decimal") return key === "." || key === "," ? { kind: "key", key: "." } : null;
  return key === "Delete" ? { kind: "key", key: "clear" } : null;
}
