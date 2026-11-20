import type { ReactiveControllerHost } from "lit";
import { ChangeObserver } from "@waitron/ui";

export const PRESS_BUZZ_STORAGE_KEY = "waitron-press-buzz";

// Set only when the browser refused to save, so the open page still honours the choice.
let unsaved: boolean | undefined;
let followingOtherTabs = false;
const listeners = new Set<() => void>();

export function pressBuzzOn(): boolean {
  if (unsaved !== undefined) return unsaved;
  try {
    return window.localStorage.getItem(PRESS_BUZZ_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPressBuzz(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(PRESS_BUZZ_STORAGE_KEY);
    else window.localStorage.setItem(PRESS_BUZZ_STORAGE_KEY, "off");
    unsaved = undefined;
  } catch {
    unsaved = on;
  }
}

function isLocalStorage(area: Storage | null): boolean {
  try {
    return area === window.localStorage;
  } catch {
    return false;
  }
}

// Another tab saved, so what is stored now replaces a choice this page could not save.
function followOtherTab(event: StorageEvent): void {
  if (event.key !== null && event.key !== PRESS_BUZZ_STORAGE_KEY) return;
  if (!isLocalStorage(event.storageArea)) return;
  unsaved = undefined;
  for (const listener of listeners) listener();
}

export function subscribePressBuzz(listener: () => void): () => void {
  if (!followingOtherTabs) {
    followingOtherTabs = true;
    window.addEventListener("storage", followOtherTab);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export class PressBuzzController extends ChangeObserver {
  constructor(host: ReactiveControllerHost) {
    super(host, subscribePressBuzz);
  }
}
