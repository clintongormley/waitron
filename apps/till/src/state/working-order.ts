/**
 * The till's in-browser "current order" — the basket the walk-up-sale widgets read from and act on.
 * It holds the lines the operator has rung up and previews their total, and it belongs to the TILL,
 * not to a login session: nothing here is cleared on logout (only {@link WorkingOrderStore.clear}
 * empties it), so a shift change never loses a half-built order.
 *
 * Widgets never hold references to one another (spec §3): they coordinate through this store and its
 * event channel. A product button broadcasts its pick with `emit("product-selected", product)`; the
 * basket view subscribes to `"changed"` (via {@link WorkingOrderStore.subscribe}) and re-renders.
 *
 * PRICING. The preview total is computed with the SERVER's authoritative pricer, `priceBasket`
 * (`packages/catalogue/src/pricing.ts`), reached by a DEEP import that bypasses the `@waitron/catalogue`
 * barrel. The barrel re-exports `operations.ts`, which pulls in `@waitron/db` and Node builtins and
 * would break the browser bundle; `pricing.ts` in isolation depends only on `@waitron/shared` (its
 * `@waitron/core`/`@waitron/fiscal` imports are `import type`, erased at build). `@waitron/catalogue`
 * has no `exports` map, so the deep subpath resolves, and Vite bundles only `pricing.ts` +
 * `@waitron/shared`. Using the real pricer — not a reimplementation — is what guarantees the preview
 * equals the total the server re-prices and files at pay time; they cannot drift because they are the
 * same function.
 */
import { priceBasket } from "@waitron/catalogue/src/pricing.js";
import type { Decimal } from "@waitron/shared";
import type { TillProduct } from "../api/client.js";

/** One rung-up basket line: a product and how much of it (a count for `each`, a kg string for `weight`). */
export interface OrderLine {
  product: TillProduct;
  /** A count (e.g. "2") for an `each` product; a measured kg weight (e.g. "0.320") for `weight`. */
  quantity: string;
}

/**
 * The store's event names. `"changed"` fires after every mutation (add/remove/clear) so views
 * re-render; `"product-selected"` is a widget-to-widget broadcast that carries a picked product and
 * does NOT mutate the basket.
 */
export type WorkingOrderEvent = "changed" | "product-selected";

/** An event listener. `payload` is `undefined` for `"changed"` and the picked product for `"product-selected"`. */
export type WorkingOrderListener = (payload?: unknown) => void;

/** The priced shape `priceBasket` returns; used to type the getters without importing fiscal/core here. */
type Priced = ReturnType<typeof priceBasket>;

export class WorkingOrderStore {
  readonly #lines: OrderLine[] = [];
  readonly #listeners = new Map<WorkingOrderEvent, Set<WorkingOrderListener>>();
  /**
   * The memoised `priceBasket(this.#lines)` result, or `null` when a mutation has invalidated it.
   * `total` and `vatBreakdown` both read the same cached object, so a mutation re-prices once rather
   * than once per getter per consumer. Set to `null` in every mutation and recomputed lazily.
   */
  #priced: Priced | null = null;

  /** The current basket lines. A defensive copy — mutate the order only through the methods below. */
  get lines(): readonly OrderLine[] {
    return [...this.#lines];
  }

  /** How many lines are in the basket — a cheap count that avoids materialising the defensive copy. */
  get lineCount(): number {
    return this.#lines.length;
  }

  /** The memoised priced basket, recomputed only after a mutation cleared {@link #priced}. */
  get #pricedOrder(): Priced {
    if (this.#priced === null) {
      this.#priced = priceBasket(this.#lines);
    }
    return this.#priced;
  }

  /** The previewed grand total (VAT-inclusive), priced by the server's `priceBasket`. */
  get total(): Decimal {
    return this.#pricedOrder.total;
  }

  /** The previewed VAT bands (one per rate present in the basket), priced by the server's `priceBasket`. */
  get vatBreakdown(): Priced["vatBreakdown"] {
    return this.#pricedOrder.vatBreakdown;
  }

  /** Append a line and notify. `quantity` is a count for `each` products, a kg string for `weight`. */
  addProduct(product: TillProduct, quantity: string): void {
    this.#lines.push({ product, quantity });
    this.#priced = null;
    this.emit("changed");
  }

  /** Drop the line at `index` (out-of-range indices are a no-op) and notify. */
  removeLine(index: number): void {
    this.#lines.splice(index, 1);
    this.#priced = null;
    this.emit("changed");
  }

  /** Empty the basket and notify. This is the ONLY thing that clears the order — logout does not. */
  clear(): void {
    this.#lines.length = 0;
    this.#priced = null;
    this.emit("changed");
  }

  /** Subscribe to `"changed"` (the common case). Returns a dispose function that unsubscribes. */
  subscribe(listener: WorkingOrderListener): () => void {
    return this.on("changed", listener);
  }

  /** Subscribe to any event. Returns a dispose function that unsubscribes. */
  on(event: WorkingOrderEvent, listener: WorkingOrderListener): () => void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Fire every listener registered for `event`, passing `payload`. Unknown events are a no-op. */
  emit(event: WorkingOrderEvent, payload?: unknown): void {
    const set = this.#listeners.get(event);
    if (set === undefined) {
      return;
    }
    for (const listener of set) {
      listener(payload);
    }
  }
}
