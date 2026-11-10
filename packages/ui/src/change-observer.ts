import type { ReactiveController, ReactiveControllerHost } from "lit";

type Subscribe = (listener: () => void) => () => void;

export class ChangeObserver implements ReactiveController {
  #dispose?: () => void;

  constructor(
    host: ReactiveControllerHost,
    private readonly subscribe: Subscribe,
    private readonly handler: () => void = () => host.requestUpdate(),
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    this.#dispose = this.subscribe(this.handler);
  }

  hostDisconnected(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }
}
