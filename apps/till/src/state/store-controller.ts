import type { ReactiveController, ReactiveControllerHost } from "lit";
import type {
  WorkingOrderEvent,
  WorkingOrderListener,
  WorkingOrderStore,
} from "./working-order.js";

/**
 * The one store-subscription lifecycle every basket-reading widget needs, as a Lit
 * {@link ReactiveController}. It subscribes to a {@link WorkingOrderStore} channel on connect and
 * disposes on disconnect, so no widget hand-rolls `connectedCallback`/`disconnectedCallback` +
 * an `#unsubscribe` field for it (basket, total and tender-pay all did, identically).
 *
 * The store reference is read LAZILY through `getStore` at connect time — not captured in the
 * constructor — because a widget's `store` property is assigned after construction but before the
 * element connects (see the widgets' `@property` docs).
 *
 * The default channel is `"changed"` with a handler that calls `host.requestUpdate()` — the whole
 * behaviour basket and total need. Tender-pay also needs the `"product-selected"` broadcast, so the
 * `event` and `handler` are configurable: a second controller instance carries that channel with its
 * own handler (which sets reactive state, so it triggers its own re-render).
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
