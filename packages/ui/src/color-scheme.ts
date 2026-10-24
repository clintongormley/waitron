import type { ReactiveController, ReactiveControllerHost } from "lit";
import { subscribeThemeChoice } from "./theme-choice.js";

/**
 * Tells its host whether the host is drawn light or dark, from the host's own computed
 * `color-scheme`, so it follows the nearest theme root rather than the page's.
 */
export class ColorSchemeController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #onChange: (() => void) | undefined;
  #dark = false;
  #stop!: () => void;

  constructor(host: ReactiveControllerHost & HTMLElement, onChange?: () => void) {
    this.#host = host;
    this.#onChange = onChange;
    host.addController(this);
  }

  get dark(): boolean {
    return this.#dark;
  }

  hostConnected(): void {
    this.#dark = this.#read();
    const unsubscribe = subscribeThemeChoice(this.#recheck);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", this.#recheck);
    this.#stop = () => {
      unsubscribe();
      media.removeEventListener("change", this.#recheck);
    };
  }

  // A host rendered inside a parent's first render connects before that parent can make its
  // wrapper a theme root, so connecting alone reads the wrong scheme.
  hostUpdate(): void {
    this.#dark = this.#read();
  }

  hostDisconnected(): void {
    this.#stop();
  }

  #read(): boolean {
    return getComputedStyle(this.#host).colorScheme === "dark";
  }

  readonly #recheck = (): void => {
    const next = this.#read();
    if (next === this.#dark) return;
    this.#dark = next;
    this.#host.requestUpdate();
    this.#onChange?.();
  };
}
