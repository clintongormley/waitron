import {
  belongsToComposition,
  inInertTree,
  modalOpen,
  surfaceOutside,
  underModal,
} from "@waitron/ui";

export type PadInput = { kind: "key"; key: string } | { kind: "enter" } | { kind: "escape" };

const digits = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** What a key press means to a number pad, or `null` when it means nothing there. Shift is not
 * checked: a French keyboard needs it to type a digit. A held key means the same as its first
 * press; `routeKey` decides what its repeats do. */
export function padInputFor(event: KeyboardEvent, mode: "decimal" | "pin"): PadInput | null {
  if (event.ctrlKey || event.metaKey || event.altKey || belongsToComposition(event)) return null;
  const { key } = event;
  if (key === "Backspace") return { kind: "key", key: "backspace" };
  if (digits.has(key)) return { kind: "key", key };
  if (key === "Enter") return { kind: "enter" };
  if (key === "Escape") return { kind: "escape" };
  if (mode === "decimal") return key === "." || key === "," ? { kind: "key", key: "." } : null;
  return key === "Delete" ? { kind: "key", key: "clear" } : null;
}

export interface PadKeyTarget extends HTMLElement {
  mode: "decimal" | "pin";
  receiveKey(input: PadInput, event: KeyboardEvent): void;
}

/** Registered pads, the one in front last. */
const pads: PadKeyTarget[] = [];

/** Every key a pad takes passes through this one listener. */
export function registerPad(pad: PadKeyTarget): () => void {
  pads.push(pad);
  if (pads.length === 1) document.addEventListener("keydown", routeKey);
  return () => {
    const at = pads.indexOf(pad);
    if (at < 0) return;
    pads.splice(at, 1);
    if (pads.length === 0) document.removeEventListener("keydown", routeKey);
  };
}

export function bringPadToFront(pad: PadKeyTarget): void {
  const at = pads.indexOf(pad);
  if (at < 0) return;
  pads.splice(at, 1);
  pads.push(pad);
}

/** Clicks `button` unless it is missing, disabled or busy. */
export function pressIfEnabled(button: HTMLElement | null): void {
  if (!button) return;
  const state = button as HTMLElement & { disabled?: boolean; loading?: boolean };
  if (state.disabled === true || state.loading === true) return;
  button.click();
}

function editsText(path: EventTarget[]): boolean {
  return path.some(
    (each) =>
      each instanceof HTMLInputElement ||
      each instanceof HTMLTextAreaElement ||
      each instanceof HTMLSelectElement ||
      (each instanceof HTMLElement && each.isContentEditable),
  );
}

function visible(pad: PadKeyTarget): boolean {
  // Older browsers lack checkVisibility.
  return pad.checkVisibility ? pad.checkVisibility() : pad.getClientRects().length > 0;
}

function padInFront(): PadKeyTarget | undefined {
  for (let at = pads.length - 1; at >= 0; at--) {
    const pad = pads[at]!;
    if (pad.isConnected && visible(pad) && !inInertTree(pad) && !underModal(pad)) return pad;
  }
  return undefined;
}

/** A focused control in the pad's own screen, outside the pad, keeps its own Enter. */
function enterBelongsToFocus(pad: PadKeyTarget, path: EventTarget[]): boolean {
  const first = path[0];
  if (!(first instanceof Element)) return false;
  if (!first.matches('button, a[href], [role="button"]')) return false;
  return path.includes(pad.getRootNode()) && !path.includes(pad);
}

function routeKey(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  const path = event.composedPath();
  if (editsText(path)) return;
  const pad = padInFront();
  if (!pad) return;
  const input = padInputFor(event, pad.mode);
  if (!input) return;
  // Walks the page, so it waits until the key means something to the pad.
  if (surfaceOutside(pad)) return;
  if (input.kind === "enter" && enterBelongsToFocus(pad, path)) return;
  // A pad under a window was passed over above, so this pad is inside it: the window closes itself.
  if (input.kind === "escape" && modalOpen()) return;
  // A held key's repeats are still the pad's, so a held Enter does not press the focused pad key.
  event.preventDefault();
  if (event.repeat && !(input.kind === "key" && input.key === "backspace")) return;
  pad.receiveKey(input, event);
}
