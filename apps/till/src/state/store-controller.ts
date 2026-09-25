import type { ReactiveController, ReactiveControllerHost } from "lit";
import type {
  WorkingOrderEvent,
  WorkingOrderListener,
  WorkingOrderStore,
} from "./working-order.js";

/**
 * The store is read LAZILY through `getStore` at connect time, because a widget's `store` property is
 * assigned after construction but before the element connects.
 */
export class StoreChangeController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  readonly #getStore: () => WorkingOrderStore;
  readonly #event: WorkingOrderEvent;
  readonly #handler: WorkingOrderListener;
  #dispose?: () => void;

  constructor(
    host: ReactiveControllerHost,
    getStore: () => WorkingOrderStore,
    event: WorkingOrderEvent = "changed",
    handler?: WorkingOrderListener,
  ) {
    this.#host = host;
    this.#getStore = getStore;
    this.#event = event;
    this.#handler = handler ?? (() => this.#host.requestUpdate());
    host.addController(this);
  }

  hostConnected(): void {
    this.#dispose = this.#getStore().on(this.#event, this.#handler);
  }

  hostDisconnected(): void {
    this.#dispose?.();
    this.#dispose = undefined;
  }
}
