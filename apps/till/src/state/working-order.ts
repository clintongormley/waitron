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
 * `@waitron/shared`. Using the real pricer — not a reimplementation — is what keeps the preview equal
 * to the total the server re-prices at pay time ON THE WALK-UP PATH: there both sides run the same
 * `priceBasket` over the same live catalogue, so they cannot drift. It is NOT a guarantee for a
 * PLACED or RETRIEVED order (7c): the server files those from `priceLockedLines` over the ADD-TIME
 * lock (`working_order_lines.unit_price_gross`) while this preview reprices the CURRENT catalogue, so
 * the two DIVERGE if the catalogue price changed between add and pay — the deliberate line-add
 * snapshot, not a bug.
 */
import { priceBasket } from "@waitron/catalogue/src/pricing.js";
import { sumDecimals } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { lineGross } from "./order-line.js";
import type { Doneness, TillProduct } from "../api/client.js";

/**
 * One modifier the operator selected on a basket line (ordering modifiers, Task 9) — the client half
 * of the server's `options: [{ optionGroupItemId }]` wire contract. The WIRE sends only
 * `optionGroupItemId`; the server re-resolves the option's price, VAT and name AUTHORITATIVELY (a
 * `weight` line carrying options is refused server-side). The extra `name`/`priceDelta` are carried for
 * the CLIENT alone: `name` so the basket can render the modifier under its dish (Task 8) without a
 * re-lookup, `priceDelta` so {@link lineGross} can add it to the DISPLAY-ONLY running line price. They
 * are snapshotted at pick time and never reach a fiscal figure — the server prices from the id.
 */
export interface SelectedLineOption {
  /** The chosen `option_group_items.id` — the ONLY field the wire (`SaleLine.options`) sends. */
  optionGroupItemId: string;
  /** locale -> text, snapshotted at pick time; the child modifier row the basket renders (Task 8). */
  name: Record<string, string>;
  /** GROSS (VAT-inclusive) price change this option adds, a `numeric(12,2)` literal ("0.50", "0.00" for
   * a free option). DISPLAY-ONLY: {@link lineGross} adds `priceDelta × quantity`; the server re-prices. */
  priceDelta: string;
  /**
   * How many times THIS option is taken per dish (per-option quantity), or ABSENT for the common case
   * of once — kept absent (never `1`) so a plain modifier stays byte-identical to before. DISPLAY-ONLY:
   * {@link lineGross}/{@link optionGross} multiply the option's `priceDelta` by `dishQuantity ×
   * (quantity ?? 1)`; the server re-prices and re-validates the count against the option's authored
   * `max_quantity`. A small positive integer when present.
   */
  quantity?: number;
}

/** One rung-up basket line: a product and how much of it (a count for `each`, a kg string for `weight`). */
export interface OrderLine {
  product: TillProduct;
  /** A count (e.g. "2") for an `each` product; a measured kg weight (e.g. "0.320") for `weight`. */
  quantity: string;
  /**
   * The modifiers selected on this line (ordering modifiers, Task 9), or ABSENT for a plain line — the
   * common case, kept absent (never `[]`) so a no-modifier add stays byte-identical to before. Each
   * carries the `optionGroupItemId` the wire sends plus the display fields {@link lineGross} and the
   * basket read. The DISH `quantity` above applies to every option too (a modifier is priced per dish,
   * never counted independently), matching the server's `priceBasketWithOptions`.
   */
  options?: SelectedLineOption[];
  /**
   * A free-text kitchen instruction the operator typed on the line (order-line customisation), or
   * ABSENT when none — the common case, kept absent (never `""`) so a plain add stays byte-identical to
   * before. The picker trims it and omits an empty result, so a whitespace-only note never lands here.
   * NON-FISCAL: it rides the wire (`SaleLine.note`) to the working-order line and the server caps it at
   * 200 chars; it never reaches a sale or a huella.
   */
  note?: string;
  /**
   * The chosen meat doneness (order-line customisation), or ABSENT when not chosen — optional even on a
   * meat dish. Attached only when the meat-gated picker selects one, so a plain line carries no key.
   * NON-FISCAL: it rides the wire (`SaleLine.doneness`) to the working-order line; the server
   * re-validates it against the `DONENESS` enum and it never reaches a sale or a huella.
   */
  doneness?: Doneness;
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
   * The memoised options-aware grand total, or `null` when a mutation invalidated it. Held SEPARATELY
   * from {@link #priced} because `priceBasket` ignores selected modifier options (ordering modifiers) —
   * so the grand total (and the cash-tender sufficiency gate + the readout that both read {@link total})
   * is summed from the per-line {@link lineGross}, which DOES add each option's delta. Cleared in every
   * mutation beside {@link #priced} and recomputed lazily.
   */
  #total: Decimal | null = null;
  /**
   * Whether {@link id} already names an OPEN row server-side (7c place/collect). A fresh store starts
   * `false` — nothing has synced it yet; {@link loadFrom} sets it `true` (a RETRIEVED order already
   * exists); {@link clear} resets it `false` (a fresh id is a fresh, unsynced basket); the app calls
   * {@link markPersisted} after a successful `parkOrder`. Both the place path (`#onPlaceOrder`) and the
   * Hold path (`#onParkOrder`) read this to decide whether they must park/create FIRST or can sync an
   * already-parked one — a retrieved order re-parked with the same id would SILENTLY REPLAY the existing
   * open order server-side (park is idempotent: it inserts nothing and discards the re-sent basket),
   * discarding any edit, so a persisted order is synced with `updateWorkingOrder`, never re-parked.
   */
  #persisted = false;
  /**
   * Whether the basket's LINES have changed since it last MATCHED the server's stored composition —
   * i.e. since the last {@link loadFrom} (retrieve), {@link markPersisted} (park) or {@link clear}. A
   * fresh or just-loaded/just-parked basket is clean (`false`); {@link addProduct} and
   * {@link removeLine} set it `true`. The PAY flow (`till-app`'s `#onConfirmPayment`) reads this so it
   * re-syncs a RETRIEVED order to the server ONLY when it was actually edited: an UNEDITED retrieved
   * order pays straight from its stored ADD-TIME lock with no pay-time re-price, so a catalogue change
   * between park and pay never moves the filed total. A LABEL change is deliberately NOT a line edit
   * and does not set this — the label is held-list metadata that never reaches the filed sale, so it
   * needs no re-lock.
   */
  #dirty = false;

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

  /** Whether the basket's lines have changed since it last matched the server (see {@link #dirty}). The
   * pay flow re-syncs a retrieved order only when this is `true`. */
  get dirty(): boolean {
    return this.#dirty;
  }

  /** Record that {@link id} now names a persisted (parked) row. Not a rendering concern — no `"changed"`
   * notification, unlike every basket mutation below. */
  markPersisted(): void {
    this.#persisted = true;
    // A just-parked basket now MATCHES the server's stored composition, so it is clean — a later pay
    // needs no re-sync until it is edited again.
    this.#dirty = false;
  }

  /** The memoised priced basket, recomputed only after a mutation cleared {@link #priced}. */
  get #pricedOrder(): Priced {
    if (this.#priced === null) {
      this.#priced = priceBasket(this.#lines);
    }
    return this.#priced;
  }

  /**
   * The previewed grand total (VAT-inclusive), OPTIONS-AWARE: the sum of every line's `lineGross`,
   * which adds each selected modifier option's `priceDelta × quantity` on top of the dish. This is what
   * the tender-pay sufficiency gate and the on-screen readout consume, so it must include the option
   * deltas — `priceBasket` (which prices `vatBreakdown` below) ignores options and would under-report
   * the total the customer owes once modifiers are picked. Summing the same rounded per-line grosses the
   * receipt lists keeps this equal to the server's `priceBasketWithOptions` total to the céntimo (the
   * server re-prices authoritatively from the option ids at pay time). Memoised in {@link #total}.
   */
  get total(): Decimal {
    if (this.#total === null) {
      this.#total = sumDecimals(this.#lines.map((line) => lineGross(line)));
    }
    return this.#total;
  }

  /**
   * The previewed VAT bands (one per rate present in the basket), priced by the server's `priceBasket`.
   * DISH-ONLY: `priceBasket` does not see selected options, so these bands cover the dishes' bases/cuotas
   * and NOT the option deltas. That is deliberate and currently invisible — no basket surface renders
   * this preview (the only VAT breakdown shown to the customer is the FILED desglose on `till-ticket-view`,
   * read back from the fiscal record). If a client-side VAT preview is ever added over a basket that can
   * carry modifiers, this must move to `priceBasketWithOptions` (which needs each option's `vatClass`,
   * not carried on `SelectedLineOption` today) so the bands reconcile with {@link total}.
   */
  get vatBreakdown(): Priced["vatBreakdown"] {
    return this.#pricedOrder.vatBreakdown;
  }

  /** Drop the memoised {@link #priced}/{@link #total} so the next read recomputes them. Every mutation
   * below (add/remove/clear/load) changes `#lines`, so every one of them invalidates both. */
  #invalidatePricing(): void {
    this.#priced = null;
    this.#total = null;
  }

  /**
   * Append a line and notify. `quantity` is a count for `each` products, a kg string for `weight`.
   * `options` (ordering modifiers, Task 9) are the modifiers selected on the line; OMITTED — the common
   * tap, and the vast majority — the line carries no `options` key at all, so a no-modifier add is
   * byte-identical to before (the picker, Task 10, is the only caller that passes them).
   *
   * `extras` (order-line customisation) carry the per-line `note`/`doneness` the picker collected. Each
   * key attaches ONLY when present — the same omission pattern as `options` above — so a plain add
   * (`extras` absent, or an empty `{}`) leaves the line byte-identical to before. The picker already
   * trims a whitespace-only note to nothing and omits an unchosen doneness before calling.
   */
  addProduct(
    product: TillProduct,
    quantity: string,
    options?: SelectedLineOption[],
    extras?: { note?: string; doneness?: Doneness },
  ): void {
    const line: OrderLine = { product, quantity };
    if (options !== undefined) {
      line.options = options;
    }
    if (extras?.note !== undefined) {
      line.note = extras.note;
    }
    if (extras?.doneness !== undefined) {
      line.doneness = extras.doneness;
    }
    this.#lines.push(line);
    this.#invalidatePricing();
    this.#dirty = true;
    this.emit("changed");
  }

  /**
   * Set how many of the line at `index` the basket holds (dish-line quantity) and notify. `quantity` is
   * a count for an `each` line (the basket's +/- stepper is the only caller and never touches a `weight`
   * line). Out-of-range indices are a no-op, exactly like {@link removeLine}. This does NOT merge lines:
   * each add stays its own line, so stepping one line's count never folds it into an identical sibling.
   * Re-prices ({@link #invalidatePricing}) and marks the basket {@link #dirty} — a quantity change is a
   * line edit, so a retrieved order re-syncs before pay, the same as add/remove.
   */
  setLineQuantity(index: number, quantity: string): void {
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    this.#lines[index]!.quantity = quantity;
    this.#invalidatePricing();
    this.#dirty = true;
    this.emit("changed");
  }

  /** Drop the line at `index` (out-of-range indices are a no-op) and notify. */
  removeLine(index: number): void {
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    this.#lines.splice(index, 1);
    this.#invalidatePricing();
    this.#dirty = true;
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
    this.#invalidatePricing();
    this.#persisted = false;
    this.#dirty = false;
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
    this.#invalidatePricing();
    this.#persisted = true;
    // A just-retrieved basket MATCHES the server's stored composition, so it starts clean — the pay
    // flow re-syncs it only once the operator edits it (see {@link #dirty}).
    this.#dirty = false;
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
