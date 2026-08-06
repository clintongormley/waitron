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
   * The STABLE client-minted id for this working order — one uuid per basket, minted here at
   * construction and kept across every add/remove. Park and pay send it as the idempotency key, so a
   * retried request re-sends the SAME id and settles the order once rather than twice. It changes in
   * exactly one place, {@link clear}, because a fresh basket is a new working order; adding a line
   * never re-mints it, and {@link loadFrom} adopts a retrieved order's id verbatim.
   */
  #id: string = crypto.randomUUID();
  /**
   * The operator's optional name for the order ("Mesa 4", "Barra"), shown in the held-orders list.
   * Metadata, not a line — but {@link label}'s setter and {@link loadFrom} both emit `"changed"` so a
   * basket header re-renders when it is set or a retrieved order carries one.
   */
  #label?: string;
  /**
   * The memoised `priceBasket(this.#lines)` result, or `null` when a mutation has invalidated it.
   * `total` and `vatBreakdown` both read the same cached object, so a mutation re-prices once rather
   * than once per getter per consumer. Set to `null` in every mutation and recomputed lazily.
   */
  #priced: Priced | null = null;
  /**
   * Whether {@link id} already names an OPEN row server-side (7c place/collect). A fresh store starts
   * `false` — nothing has synced it yet; {@link loadFrom} sets it `true` (a RETRIEVED order already
   * exists); {@link clear} resets it `false` (a fresh id is a fresh, unsynced basket); the app calls
   * {@link markPersisted} after a successful `parkOrder`. Placing a basket (Task 11's `#onPlaceOrder`)
   * reads this to decide whether it must park FIRST or can sync-then-place an already-parked one — a
   * retrieved order re-parked with the same id would 23505 on the server's plain INSERT.
   */
  #persisted = false;

  /** The stable client-minted working-order id for this basket. Changes only on {@link clear}. */
  get id(): string {
    return this.#id;
  }

  /** The operator's optional name for the order, or `undefined` when unnamed. */
  get label(): string | undefined {
    return this.#label;
  }

  /** Name (or rename) the order. Emits `"changed"` so a basket header showing the label re-renders. */
  set label(value: string | undefined) {
    this.#label = value;
    this.emit("changed");
  }

  /** The current basket lines. A defensive copy — mutate the order only through the methods below. */
  get lines(): readonly OrderLine[] {
    return [...this.#lines];
  }

  /** How many lines are in the basket — a cheap count that avoids materialising the defensive copy. */
  get lineCount(): number {
    return this.#lines.length;
  }

  /** Whether {@link id} already names an OPEN row server-side. See the field's own doc for why this
   * exists. */
  get persisted(): boolean {
    return this.#persisted;
  }

  /** Record that {@link id} now names a persisted (parked) row. Not a rendering concern — no `"changed"`
   * notification, unlike every basket mutation below. */
  markPersisted(): void {
    this.#persisted = true;
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
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    this.#lines.splice(index, 1);
    this.#priced = null;
    this.emit("changed");
  }

  /**
   * Empty the basket and notify. This is the ONLY thing that clears the order — logout does not — and
   * it mints a FRESH {@link id}: a cleared basket is a new working order, so its next park/pay keys a
   * new idempotency slot rather than colliding with the settled one. The label is dropped with it.
   */
  clear(): void {
    this.#lines.length = 0;
    this.#id = crypto.randomUUID();
    this.#label = undefined;
    this.#priced = null;
    this.#persisted = false;
    this.emit("changed");
  }

  /**
   * Replace the basket with a RETRIEVED working order: adopt its `id` verbatim (so paying it later
   * keys the same idempotency slot the server persisted it under), swap in the given lines, and set
   * the label. Callers pass ready {@link OrderLine}s — the app resolves a retrieved order's
   * `{ productId, quantity }` against its loaded products and builds the `OrderLine[]` before calling
   * here. A missing `label` clears any prior one. Notifies once.
   */
  loadFrom(id: string, lines: OrderLine[], label?: string): void {
    this.#id = id;
    this.#lines.length = 0;
    this.#lines.push(...lines);
    this.#label = label;
    this.#priced = null;
    this.#persisted = true;
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
