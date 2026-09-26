/**
 * The till's in-browser basket. It belongs to the TILL, not to a login session: only
 * {@link WorkingOrderStore.clear} empties it, so a shift change never loses a half-built order.
 * Widgets never hold references to one another; they coordinate through this store's events.
 *
 * The `@waitron/catalogue` imports are DEEP, bypassing the barrel, which re-exports `operations.ts`
 * and with it `@waitron/db` and Node builtins. A deep import is safe only while the module it reaches
 * pulls in nothing at runtime beyond `@waitron/shared` and its own siblings.
 */
import { type BasketItem, priceBasket } from "@waitron/catalogue/src/pricing.js";
import { customerPresentationText } from "@waitron/catalogue/src/product-presentation.js";
import { currentContentLanguages } from "@waitron/ui";
import { assertQuantityPrecision } from "@waitron/catalogue/src/unit-validation.js";
import { sumDecimals } from "@waitron/shared";
import type { Decimal, OptionSelection, OptionSnapshot } from "@waitron/shared";
import { lineGross } from "./order-line.js";
import type { HeldExtra, TillProduct } from "../api/client.js";
import { productUnit, toPresentation } from "../widgets/product-name.js";

/**
 * One extras pick on a basket line. `name` and `price` are the client's copy of what the offer
 * resolved, for display only: the server re-resolves the price from the offer.
 */
export interface SelectedExtra {
  listId: string;
  /** An extra IS a product: a pick never names an `extra_list_items` row. */
  productId: string;
  /** The STAFF name. */
  name: string;
  /** GROSS (VAT-inclusive) unit price as a two-place decimal string ("0.50"). */
  price: string;
  /** Per dish, at least 1. */
  quantity: number;
}

/**
 * A retrieved pick that no list the dish offers today carries, so no wire entry can name it. An
 * unedited order is paid from its stored lines, which still bill it, so the basket shows and counts it
 * until the order is edited.
 */
export type NotOfferedExtra = Pick<HeldExtra, "productId" | "name" | "price" | "quantity">;

/**
 * What a picker confirm puts on a line. `optionSnapshots` is built locally in the same shape a held
 * order carries back, so one renderer serves both.
 */
export interface LineSelection {
  extras?: SelectedExtra[];
  options?: OptionSelection[];
  optionSnapshots?: OptionSnapshot[];
  /** Read by {@link WorkingOrderStore.addProduct} alone; {@link WorkingOrderStore.setLineExtras} owns
   * a line's note after that. */
  note?: string;
}

export interface OrderLine {
  workingOrderLineId?: string;
  product: TillProduct;
  /** A decimal string accepted by the product unit's precision. */
  quantity: string;
  /** ABSENT (never `[]`) for a dish that took none. The dish `quantity` applies to every pick. */
  extras?: SelectedExtra[];
  /** Never sent on the wire; ABSENT (never `[]`) when there are none. */
  notOfferedExtras?: NotOfferedExtra[];
  /** A retrieved line whose offer is not in the till's live list. Display only. */
  notOffered?: true;
  /**
   * One entry per answered list; ABSENT when none. On a RETRIEVED line the ids are re-derived from the
   * frozen wording (`deriveOptionSelections`), so a list whose wording nothing matches is missing here.
   */
  options?: OptionSelection[];
  /** Never sent on the wire. */
  optionSnapshots?: OptionSnapshot[];
  /** A kitchen instruction; ABSENT (never `""`) when none. */
  note?: string;
}

/** `"product-selected"` is a widget-to-widget broadcast that does NOT mutate the basket. */
export type WorkingOrderEvent = "changed" | "product-selected";

export type WorkingOrderListener = (payload?: unknown) => void;

type Priced = ReturnType<typeof priceBasket>;

/** A priced line wants the CUSTOMER text already resolved. */
function toPriceable(line: OrderLine): BasketItem {
  const p = line.product;
  const text = customerPresentationText(
    toPresentation(p),
    currentContentLanguages().defaultLanguage,
  );
  return {
    ...line,
    product: {
      ...p,
      descriptions: text.product,
      variantDescriptions: text.variant,
      unit: productUnit(p),
    },
  };
}

/** An empty list is not an answer, so it leaves no key. */
function applySelection(line: OrderLine, selection: LineSelection | undefined): void {
  if (selection?.extras?.length) line.extras = selection.extras;
  if (selection?.options?.length) line.options = selection.options;
  if (selection?.optionSnapshots?.length) line.optionSnapshots = selection.optionSnapshots;
}

export class WorkingOrderStore {
  readonly #lines: OrderLine[] = [];
  readonly #listeners = new Map<WorkingOrderEvent, Set<WorkingOrderListener>>();
  /** The idempotency key park and pay send, so a retried request settles the order once. */
  #id: string = crypto.randomUUID();
  #label?: string;
  #priced: Priced | null = null;
  #total: Decimal | null = null;
  /**
   * Whether {@link id} already names an OPEN row server-side. A persisted order must be synced with
   * `updateWorkingOrder`, never re-parked: park is idempotent, so a re-park with the same id discards
   * the re-sent basket and any edit in it.
   */
  #persisted = false;
  /**
   * Whether the LINES have changed since they last matched the server's stored composition. A
   * retrieved order is re-synced only when this is set, so an unedited one pays from its stored
   * add-time prices. A LABEL change is deliberately NOT a line edit and does not set this: the label
   * never reaches the filed sale.
   */
  #dirty = false;
  /** The server revision the persisted order's copy is at; meaningless until {@link persisted}. */
  #revision = 0;

  /** Changes only on {@link clear} and {@link loadFrom}. */
  get id(): string {
    return this.#id;
  }

  get label(): string | undefined {
    return this.#label;
  }

  set label(value: string | undefined) {
    this.#label = value;
    this.emit("changed");
  }

  /** A defensive copy: mutate the order only through the methods below. */
  get lines(): readonly OrderLine[] {
    return [...this.#lines];
  }

  get lineCount(): number {
    return this.#lines.length;
  }

  get persisted(): boolean {
    return this.#persisted;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  get revision(): number {
    return this.#revision;
  }

  /** No `"changed"` notification: not a rendering concern. */
  markPersisted(): void {
    this.#persisted = true;
    this.#dirty = false;
  }

  /** After a save of this copy landed: the save counted one write on the order. */
  markSaved(): void {
    this.#revision += 1;
  }

  get #pricedOrder(): Priced {
    if (this.#priced === null) {
      this.#priced = priceBasket(this.#lines.map((line) => toPriceable(line)));
    }
    return this.#priced;
  }

  /**
   * The previewed VAT-inclusive total, summed from each line's {@link lineGross} because that adds the
   * extras picks, which `priceBasket` does not see.
   */
  get total(): Decimal {
    if (this.#total === null) {
      this.#total = sumDecimals(this.#lines.map((line) => lineGross(line)));
    }
    return this.#total;
  }

  /**
   * DISH-ONLY: `priceBasket` does not see the extras picks, so these bands do not reconcile with
   * {@link total}. A VAT preview over a basket with extras would need `priceBasketWithOptions`, and
   * each pick's `vatClass`, which {@link SelectedExtra} does not carry.
   */
  get vatBreakdown(): Priced["vatBreakdown"] {
    return this.#pricedOrder.vatBreakdown;
  }

  #invalidatePricing(): void {
    this.#priced = null;
    this.#total = null;
  }

  /**
   * An edit sends each line without its not-offered picks, so the server re-prices the order without
   * them; they leave the basket now to match. No prompt: the retrieve banner
   * (`held.extra_not_offered`) already said that changing the order removes them.
   */
  #markDirty(): void {
    this.#dirty = true;
    for (const line of this.#lines) delete line.notOfferedExtras;
  }

  addProduct(product: TillProduct, quantity: string, selection?: LineSelection): void {
    assertQuantityPrecision(quantity, productUnit(product).precision, { positive: true });
    const line: OrderLine = { product, quantity };
    applySelection(line, selection);
    if (selection?.note !== undefined) {
      line.note = selection.note;
    }
    this.#lines.push(line);
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Replaces the line's answers but not its note, which {@link setLineExtras} owns. */
  setLineModifiers(index: number, selection: LineSelection): void {
    const line = this.#lines[index];
    if (!line) return;
    delete line.extras;
    delete line.options;
    delete line.optionSnapshots;
    applySelection(line, selection);
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Never merges lines: stepping one line's count never folds it into an identical sibling. */
  setLineQuantity(index: number, quantity: string): void {
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    assertQuantityPrecision(quantity, productUnit(this.#lines[index]!.product).precision, {
      positive: true,
    });
    this.#lines[index]!.quantity = quantity;
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /**
   * A PARTIAL update: only keys PRESENT in `extras` are touched. A note that trims to empty CLEARS the
   * key. It marks the basket dirty because the note is sent with the line.
   */
  setLineExtras(index: number, extras: { note?: string }): void {
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    const line = this.#lines[index]!;
    if ("note" in extras) {
      const note = (extras.note ?? "").trim();
      if (note === "") {
        delete line.note;
      } else {
        line.note = note;
      }
    }
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  removeLine(index: number): void {
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    this.#lines.splice(index, 1);
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Mints a FRESH {@link id}: a cleared basket is a new working order, so its next park or pay does
   * not collide with the settled one. */
  clear(): void {
    this.#lines.length = 0;
    this.#id = crypto.randomUUID();
    this.#label = undefined;
    this.#invalidatePricing();
    this.#persisted = false;
    this.#dirty = false;
    this.#revision = 0;
    this.emit("changed");
  }

  /** Adopts a RETRIEVED order's `id` verbatim, so paying it keys the same idempotency slot the server
   * stored it under, and the `revision` its copy was read at. */
  loadFrom(id: string, lines: OrderLine[], label?: string, revision = 0): void {
    this.#id = id;
    this.#revision = revision;
    this.#lines.length = 0;
    this.#lines.push(...lines);
    this.#label = label;
    this.#invalidatePricing();
    this.#persisted = true;
    this.#dirty = false;
    this.emit("changed");
  }

  subscribe(listener: WorkingOrderListener): () => void {
    return this.on("changed", listener);
  }

  /** Returns a disposer. */
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
