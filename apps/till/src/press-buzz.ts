import { pressBuzzOn } from "./press-buzz-choice.js";

const BUZZ_MS = 15;
const QUIET = ':disabled, [aria-disabled="true"]';

export interface Vibrator {
  vibrate?: (pattern: number) => boolean;
}

export function installPressBuzz(
  root: EventTarget,
  nav: Vibrator = navigator,
  isOn: () => boolean = pressBuzzOn,
): () => void {
  const onPress = (event: Event): void => {
    const button = event.composedPath().find((node) => node instanceof HTMLButtonElement);
    if (!button || button.matches(QUIET) || !isOn()) return;
    if (typeof nav.vibrate === "function") nav.vibrate(BUZZ_MS);
  };
  root.addEventListener("pointerdown", onPress, { capture: true });
  return () => root.removeEventListener("pointerdown", onPress, { capture: true });
}
