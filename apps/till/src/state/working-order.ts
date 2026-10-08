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
import { localToday } from "@waitron/catalogue/src/vat-rates.js";
import { customerPresentationText } from "@waitron/catalogue/src/product-presentation.js";
import { currentContentLanguages } from "@waitron/ui";
import { assertQuantityPrecision } from "@waitron/catalogue/src/unit-validation.js";
import { addDecimal, compareDecimal, decimal, subtractDecimal, sumDecimals } from "@waitron/shared";
import type { Decimal, OptionSelection, OptionSnapshot } from "@waitron/shared";
import { lineGross } from "./order-line.js";
import { orderLineMergeKey } from "./draft-lines.js";
import type { BlockReason } from "./menu-refresh.js";
import type { HeldExtra, TillProduct } from "../api/client.js";
import { productUnit, soldByTheUnit, toPresentation } from "../widgets/product-name.js";

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
  /** Read when a line is created ({@link WorkingOrderStore.addProduct},
   * {@link WorkingOrderStore.addMerging}); {@link WorkingOrderStore.setLineExtras} owns a line's note
   * after that. */
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
  /** What stops this unsaved line being paid as it stands; never sent. */
  blocked?: BlockReason;
  /**
   * One entry per answered list; ABSENT when none. On a RETRIEVED line the ids are re-derived from the
   * frozen wording (`deriveOptionSelections`), so a list whose wording nothing matches is missing here.
   */
  options?: OptionSelection[];
  /** Never sent on the wire. */
  optionSnapshots?: OptionSnapshot[];
  /** A kitchen instruction; ABSENT (never `""`) when none. */
  note?: string;
  /** The waiter's course override on a table draft; ABSENT means the product's default course. */
  courseId?: string;
  /** The chosen making station on a table draft line. */
  makeAt?: string;
  /** Never merged with another line, either way; Split quantity's rows carry it. */
  noMerge?: true;
  /** A table draft line the server said, at its last answer, cannot be sold now. Not part of the
   * saved line. */
  unavailableOnServer?: true;
  /** A draft line rebuilt from the server under a menu version that is not the live one: the price
   * shown is the live one, and what it cost under its own version is unknown. Not part of the saved
   * line. */
  earlierPriceUnknown?: true;
}

/** `"product-selected"` is a widget-to-widget broadcast that does NOT mutate the basket.
 * `"refused"` reports an edit the basket refused, carrying {@link BasketRefusal}. */
export type WorkingOrderEvent = "changed" | "product-selected" | "refused";

export type BasketRefusal =
  | { code: "sale.total_exceeds_simplified_limit"; limit: string }
  | { code: "menu_period.not_running" };

export type WorkingOrderListener = (payload?: unknown) => void;

type Priced = ReturnType<typeof priceBasket>;

const ZERO = decimal("0.00");

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

/** Refuses a quantity the product's unit cannot take. */
function newLine(product: TillProduct, quantity: string, selection?: LineSelection): OrderLine {
  assertQuantityPrecision(quantity, productUnit(product).precision, { positive: true });
  const line: OrderLine = { product, quantity };
  applySelection(line, selection);
  if (selection?.note !== undefined) {
    line.note = selection.note;
  }
  return line;
}

/** A line of its own: its answers and picks are copied, never shared with `line`. */
function copyLine(line: OrderLine): OrderLine {
  const copy: OrderLine = { ...line };
  if (line.extras !== undefined) copy.extras = line.extras.map((extra) => ({ ...extra }));
  if (line.options !== undefined) copy.options = line.options.map((answer) => ({ ...answer }));
  if (line.optionSnapshots !== undefined)
    copy.optionSnapshots = line.optionSnapshots.map((snapshot) => ({ ...snapshot }));
  return copy;
}

/** For {@link WorkingOrderStore.addMerging}. `added`'s key is taken once, and only once a kept line
 * has a key to compare it with. */
function mergeTarget(lines: readonly OrderLine[], added: OrderLine): OrderLine | undefined {
  if (added.product.menuItemId === undefined) return undefined;
  let addedKey: string | null | undefined;
  return lines.find((kept) => {
    if (kept.notOffered !== undefined || kept.blocked !== undefined) return false;
    const keptKey = orderLineMergeKey(kept);
    if (keptKey === null) return false;
    if (addedKey === undefined) addedKey = orderLineMergeKey(added);
    return keptKey === addedKey;
  });
}

/** The first line of `lines` that would have added to `kept` by the draft merge rule (D10). */
function mergingWith(lines: readonly OrderLine[], kept: OrderLine): OrderLine | undefined {
  if (kept.product.menuItemId === undefined) return undefined;
  let keptKey: string | null | undefined;
  return lines.find((line) => {
    if (line.product.menuItemId === undefined) return false;
    if (keptKey === undefined) keptKey = orderLineMergeKey(kept);
    return keptKey !== null && orderLineMergeKey(line) === keptKey;
  });
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
  #sending = false;
  #editLock: object | null = null;
  #loadGeneration = 0;
  #lastAdded?: OrderLine;
  #limit: Decimal | null = null;
  #fullInvoiceOrderId?: string;
  canSelectProduct: ((product: TillProduct) => boolean) | undefined;

  #refusesSelection(product: TillProduct): boolean {
    if (this.canSelectProduct?.(product) !== false) return false;
    this.emit("refused", { code: "menu_period.not_running" } satisfies BasketRefusal);
    return true;
  }

  /**
   * The largest total this regime records for a sale with no named customer (the server's
   * `simplifiedInvoiceLimit`), or null for none. An add or a change that would take the total past
   * it is refused with a `"refused"` event and leaves the basket as it was; one that keeps it, or
   * makes it smaller, is not.
   */
  set simplifiedInvoiceLimit(limit: string | null) {
    this.#limit = limit === null ? null : decimal(limit);
  }

  allowFullInvoiceFor(orderId: string): void {
    if (orderId === this.#id) this.#fullInvoiceOrderId = orderId;
  }

  /** Whether replacing `before`'s gross with `after`'s would take the total past the limit, said
   * with a `"refused"` event when it would. */
  #passesLimit(before: Decimal, after: Decimal): boolean {
    if (
      this.#limit === null ||
      this.#fullInvoiceOrderId === this.#id ||
      compareDecimal(after, before) <= 0
    )
      return false;
    const next = addDecimal(subtractDecimal(this.total, before), after);
    if (compareDecimal(next, this.#limit) <= 0) return false;
    const refusal: BasketRefusal = {
      code: "sale.total_exceeds_simplified_limit",
      limit: this.#limit,
    };
    this.emit("refused", refusal);
    return true;
  }

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

  /** The line the latest add made or grew, while that line is still in the order. */
  get lastAdded(): OrderLine | undefined {
    const line = this.#lastAdded;
    return line !== undefined && this.#lines.includes(line) ? line : undefined;
  }

  get persisted(): boolean {
    return this.#persisted;
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  /** Set by the app while this basket is being sent: every staff edit is refused until the answer,
   * so what the server was sent is what the screen still shows. */
  get sending(): boolean {
    return this.#sending;
  }

  set sending(value: boolean) {
    this.#sending = value;
    this.emit("changed");
  }

  get revision(): number {
    return this.#revision;
  }

  /** Staff edits are refused while the order in the basket is being read again, so the read never
   * replaces an edit made meanwhile. The lock ends when the returned function is called (a later
   * lock stays), or when the basket is cleared or another copy is loaded into it. */
  lockEdits(): () => void {
    const lock = {};
    this.#editLock = lock;
    this.emit("changed");
    return () => {
      if (this.#editLock !== lock) return;
      this.#editLock = null;
      this.emit("changed");
    };
  }

  /** Counts {@link clear} and {@link loadFrom} calls, so a copy of the same order loaded again
   * reads as a different basket where {@link id} does not. */
  get loadGeneration(): number {
    return this.#loadGeneration;
  }

  get editsLocked(): boolean {
    return this.#editLock !== null;
  }

  get #refusesEdits(): boolean {
    return this.#sending || this.#editLock !== null;
  }

  /** No `"changed"` notification: not a rendering concern. */
  markPersisted(): void {
    this.#persisted = true;
    this.#dirty = false;
  }

  /** After a save of this copy landed, at the revision the server answered. */
  markSaved(revision: number): void {
    this.#revision = revision;
  }

  get #pricedOrder(): Priced {
    if (this.#priced === null) {
      this.#priced = priceBasket(
        this.#lines.map((line) => toPriceable(line)),
        localToday(),
      );
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
   * {@link total}. A VAT preview over a basket with extras would need `rateLines` over
   * `grossBasketWithOptions`' result, and each pick's VAT class, which {@link SelectedExtra} does not carry.
   */
  get vatBreakdown(): Priced["vatBreakdown"] {
    return this.#pricedOrder.vatBreakdown;
  }

  #invalidatePricing(): void {
    this.#priced = null;
    this.#total = null;
  }

  /**
   * An edit sends each line without its not-offered picks, so the server takes them off the order;
   * they leave the basket now to match. No prompt: the retrieve banner
   * (`held.extra_not_offered`) already said that changing the order removes them.
   */
  #markDirty(): void {
    this.#dirty = true;
    for (const line of this.#lines) delete line.notOfferedExtras;
  }

  addProduct(product: TillProduct, quantity: string, selection?: LineSelection): void {
    if (this.#refusesEdits) return;
    if (this.#refusesSelection(product)) return;
    const line = newLine(product, quantity, selection);
    if (this.#passesLimit(ZERO, lineGross(line))) return;
    this.#lines.push(line);
    this.#lastAdded = line;
    this.#changedLines();
  }

  /**
   * As {@link addProduct}, except that a line ordering the same thing as an earlier one (the draft
   * merge rule, D10) adds its quantity to the first such line, which keeps its place. A line marked
   * not offered or blocked takes nothing: a fresh tap starts a line of its own beside it.
   */
  addMerging(product: TillProduct, quantity: string, selection?: LineSelection): void {
    if (this.#refusesEdits) return;
    if (this.#refusesSelection(product)) return;
    const line = newLine(product, quantity, selection);
    const into = mergeTarget(this.#lines, line);
    const merged =
      into === undefined
        ? undefined
        : { ...into, quantity: addDecimal(decimal(into.quantity), decimal(quantity)) };
    if (this.#passesLimit(into === undefined ? ZERO : lineGross(into), lineGross(merged ?? line)))
      return;
    if (into === undefined) this.#lines.push(line);
    else into.quantity = merged!.quantity;
    this.#lastAdded = into ?? line;
    this.#changedLines();
  }

  #changedLines(): void {
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Replaces the line's answers but not its note, which {@link setLineExtras} owns. */
  setLineModifiers(index: number, selection: LineSelection): void {
    if (this.#refusesEdits) return;
    const line = this.#lines[index];
    if (!line) return;
    const candidate: OrderLine = { ...line };
    delete candidate.extras;
    delete candidate.options;
    delete candidate.optionSnapshots;
    applySelection(candidate, selection);
    if (this.#passesLimit(lineGross(line), lineGross(candidate))) return;
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
    if (this.#refusesEdits) return;
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    const line = this.#lines[index]!;
    if (
      compareDecimal(decimal(quantity), decimal(line.quantity)) > 0 &&
      this.#refusesSelection(line.product)
    )
      return;
    assertQuantityPrecision(quantity, productUnit(line.product).precision, {
      positive: true,
    });
    if (this.#passesLimit(lineGross(line), lineGross({ ...line, quantity }))) return;
    line.quantity = quantity;
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Split quantity: a whole-unit line of N becomes N lines of one in its place, the first being the
   * same line object. Each is marked `noMerge`, so no later add folds them back together. */
  splitLine(index: number): void {
    if (this.#refusesEdits) return;
    const line = this.#lines[index];
    if (line === undefined || !soldByTheUnit(line.product)) return;
    const count = Number(line.quantity);
    if (!Number.isInteger(count) || count < 2) return;
    line.quantity = "1";
    line.noMerge = true;
    if (this.#lastAdded === line) this.#lastAdded = undefined;
    const rest = Array.from({ length: count - 1 }, () => copyLine(line));
    this.#lines.splice(index + 1, 0, ...rest);
    this.#changedLines();
  }

  /** The waiter's course override on a table draft line; `undefined` goes back to the dish's own. */
  setLineCourse(index: number, courseId: string | undefined): void {
    if (this.#refusesEdits) return;
    const line = this.#lines[index];
    if (line === undefined) return;
    if (courseId === undefined) delete line.courseId;
    else line.courseId = courseId;
    this.#markDirty();
    this.emit("changed");
  }

  setLineMakeAt(index: number, stationId: string | undefined): void {
    if (this.#refusesEdits) return;
    const line = this.#lines[index];
    if (line === undefined) return;
    if (stationId === undefined) delete line.makeAt;
    else line.makeAt = stationId;
    this.#markDirty();
    this.emit("changed");
  }

  /**
   * A PARTIAL update: only keys PRESENT in `extras` are touched. A note that trims to empty CLEARS the
   * key. It marks the basket dirty because the note is sent with the line.
   */
  setLineExtras(index: number, extras: { note?: string }): void {
    if (this.#refusesEdits) return;
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

  /** Takes out these line objects, wherever they now are; lines added since stay. */
  removeLines(lines: readonly OrderLine[]): void {
    const gone = new Set(lines);
    const kept = this.#lines.filter((line) => !gone.has(line));
    this.#lines.length = 0;
    this.#lines.push(...kept);
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  removeLine(index: number): void {
    if (this.#refusesEdits) return;
    if (index < 0 || index >= this.#lines.length) {
      return;
    }
    this.#lines.splice(index, 1);
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** Rewrites each line named by its index, as a basket refresh re-priced it. The line object stays
   * the same one, so whatever a screen keys on it (a draft line's course or selection) is kept. */
  adoptLines(adopted: ReadonlyMap<number, OrderLine>): void {
    for (const [index, line] of adopted) {
      const own = this.#lines[index];
      if (own === undefined) continue;
      for (const key of Object.keys(own)) delete own[key as keyof OrderLine];
      Object.assign(own, line);
    }
    this.#invalidatePricing();
    this.#markDirty();
    this.emit("changed");
  }

  /** One entry per line. Display only, so the lines stay as clean as they were. Without `notify`, a
   * change is left for the notification already under way to carry. */
  setBlocked(reasons: readonly (BlockReason | undefined)[], notify = true): void {
    let changed = false;
    this.#lines.forEach((line, index) => {
      const reason = reasons[index];
      if (line.blocked === reason) return;
      changed = true;
      if (reason === undefined) delete line.blocked;
      else line.blocked = reason;
    });
    if (changed && notify) this.emit("changed");
  }

  /** Mints a FRESH {@link id}: a cleared basket is a new working order, so its next park or pay does
   * not collide with the settled one. */
  clear(): void {
    this.#loadGeneration++;
    this.#editLock = null;
    this.#lines.length = 0;
    this.#id = crypto.randomUUID();
    this.#fullInvoiceOrderId = undefined;
    this.#label = undefined;
    this.#invalidatePricing();
    this.#persisted = false;
    this.#dirty = false;
    this.#revision = 0;
    this.emit("changed");
  }

  /** Adopts a RETRIEVED order's `id` verbatim, so paying it keys the same idempotency slot the server
   * stored it under, and the `revision` its copy was read at. The same order read again (a saved
   * draft's answer rebuilds every line) keeps {@link lastAdded} on the line ordering the same thing,
   * by the draft merge rule. */
  loadFrom(id: string, lines: OrderLine[], label?: string, revision = 0): void {
    const last = id === this.#id ? this.lastAdded : undefined;
    this.#lastAdded = last === undefined ? undefined : mergingWith(lines, last);
    this.#id = id;
    this.#fullInvoiceOrderId = undefined;
    this.#revision = revision;
    this.#lines.length = 0;
    this.#lines.push(...lines);
    this.#label = label;
    this.#invalidatePricing();
    this.#persisted = true;
    this.#dirty = false;
    this.#editLock = null;
    this.#loadGeneration++;
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
