import type { ReactiveController, ReactiveControllerHost } from "lit";
import { currentHelpMode, setHelpMode, subscribeHelpMode } from "@waitron/ui";

export const KITCHEN_HELP_IDLE_MS = 120_000;

export interface HelpIdleOptions {
  applies: () => boolean;
  onIdle?: () => void;
  idleMs?: number;
}

/**
 * Turns help off after `idleMs` without a `pointerdown` or `keydown` inside the host, while
 * the host is in the page and `applies()` holds. Listens in the capture phase so a child that stops an event still counts.
 * A host update is not a touch: it starts a clock that is not running, never restarts one.
 */
export class HelpIdleController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #options: HelpIdleOptions;
  #timer?: ReturnType<typeof setTimeout>;
  #unsubscribe?: () => void;
  readonly #onTouch = (): void => {
    if (this.#timer === undefined) return;
    this.#stop();
    this.#start();
  };

  constructor(host: ReactiveControllerHost & HTMLElement, options: HelpIdleOptions) {
    this.#host = host;
    this.#options = options;
    host.addController(this);
  }

  hostConnected(): void {
    this.#host.addEventListener("pointerdown", this.#onTouch, { capture: true });
    this.#host.addEventListener("keydown", this.#onTouch, { capture: true });
    this.#unsubscribe = subscribeHelpMode(() => this.#check());
    this.#check();
  }

  hostDisconnected(): void {
    this.#host.removeEventListener("pointerdown", this.#onTouch, { capture: true });
    this.#host.removeEventListener("keydown", this.#onTouch, { capture: true });
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#stop();
  }

  hostUpdated(): void {
    this.#check();
  }

  #check(): void {
    // An update queued before the host left the page still runs `hostUpdated` after it left.
    if (!this.#host.isConnected || !currentHelpMode() || !this.#options.applies()) this.#stop();
    else if (this.#timer === undefined) this.#start();
  }

  #start(): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      setHelpMode(false);
      this.#options.onIdle?.();
    }, this.#options.idleMs ?? KITCHEN_HELP_IDLE_MS);
  }

  #stop(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
