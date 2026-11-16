import type { ReactiveController, ReactiveControllerHost } from "lit";

type Subscribe = (listener: () => void) => () => void;

export class ChangeObserver implements ReactiveController {
  #dispose?: () => void;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly subscribe: Subscribe,
    private readonly handler: () => void = () => host.requestUpdate(),
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.#dispose = this.subscribe(this.handler);
    // A host out of the page may not have redrawn since a change it missed.
    this.host.requestUpdate();
  }

  hostDisconnected(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }
}
