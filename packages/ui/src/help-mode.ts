import type { ReactiveController, ReactiveControllerHost } from "lit";

let on = false;
const listeners = new Set<() => void>();

export function helpModeOn(): boolean {
  return on;
}

export function setHelpMode(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const listener of listeners) listener();
}

export function subscribeHelpMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export class HelpModeController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  #unsubscribe?: () => void;

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
    host.addController(this);
  }

  get on(): boolean {
    return on;
  }

  hostConnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = subscribeHelpMode(() => this.#host.requestUpdate());
    // A host out of the page while help changed has not redrawn since.
    this.#host.requestUpdate();
  }

  hostDisconnected(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}
