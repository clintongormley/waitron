import type { ReactiveController, ReactiveControllerHost } from "lit";

export type ThemeChoice = "light" | "dark" | "device";

export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "device"];
export const THEME_STORAGE_KEY = "waitron-theme";
export const THEME_SELECTED_EVENT = "wt-theme-selected";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (THEME_CHOICES as readonly unknown[]).includes(value);
}

let choice: ThemeChoice = "device";
let themeRoot: HTMLElement | undefined;
let followingOtherTabs = false;
const listeners = new Set<() => void>();

function readSaved(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(saved) ? saved : "device";
  } catch {
    return "device";
  }
}

function apply(root: HTMLElement, next: ThemeChoice): void {
  if (next === "device") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
}

function settle(next: ThemeChoice): void {
  apply(themeRoot ?? document.documentElement, next);
  if (next === choice) return;
  choice = next;
  for (const listener of listeners) listener();
}

function isLocalStorage(area: Storage | null): boolean {
  try {
    return area === window.localStorage;
  } catch {
    return false;
  }
}

// Reads the saved value rather than event.newValue: an event queued before this tab's own later
// save would otherwise put back the older choice.
function followOtherTab(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
  if (isLocalStorage(event.storageArea)) settle(readSaved());
}

export function startThemeChoice(root: HTMLElement): void {
  themeRoot = root;
  settle(readSaved());
  if (followingOtherTabs) return;
  followingOtherTabs = true;
  window.addEventListener("storage", followOtherTab);
}

export function currentThemeChoice(): ThemeChoice {
  return choice;
}

export function chooseTheme(next: ThemeChoice): void {
  try {
    if (next === "device") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // A browser that refuses the save still shows the choice on the open page.
  }
  settle(next);
}

export function subscribeThemeChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export class ThemeChoiceController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #applies: boolean;
  #unsubscribe?: () => void;

  constructor(host: ReactiveControllerHost & HTMLElement, options: { applies?: boolean } = {}) {
    this.#host = host;
    this.#applies = options.applies ?? false;
    host.addController(this);
  }

  get choice(): ThemeChoice {
    return choice;
  }

  hostConnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = subscribeThemeChoice(() => this.#host.requestUpdate());
    if (this.#applies) this.#host.addEventListener(THEME_SELECTED_EVENT, this.#onSelected);
  }

  hostDisconnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#host.removeEventListener(THEME_SELECTED_EVENT, this.#onSelected);
  }

  readonly #onSelected = (event: Event): void => {
    const picked = (event as CustomEvent<{ choice?: unknown } | null>).detail?.choice;
    if (isThemeChoice(picked)) chooseTheme(picked);
  };
}
