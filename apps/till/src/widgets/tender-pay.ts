import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { type Decimal, compareDecimal, decimal, subtractDecimal } from "@waitron/shared";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import "./numeric-pad.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { OrderFlow, PayOutcome, TillProduct } from "../api/client.js";
import type { WorkingOrderStore } from "../state/working-order.js";
import type { PropertyValues } from "lit";

/**
 * The payload of the `confirm-payment` event — either tender the widget can settle:
 * - `cash`: `amount` is the FULL operator-entered tendered amount (a Decimal string), never the
 *   total — the server records the fiscal tender at the total and returns the change.
 * - `card`: a manual bank-terminal (datáfono) charge. `amount` is the sale total exactly (a card is
 *   charged the total, never over-tendered, so there is no change), and `externalRef` is the
 *   terminal's optional operation number, omitted when the operator did not key one.
 */
export type ConfirmPaymentDetail =
  { method: "cash"; amount: string } | { method: "card"; amount: string; externalRef?: string };

/** The payload of the `park-order` event: the operator's optional free-text name for the parked order. */
export interface ParkOrderDetail {
  /** A free-text order name ("Mesa 4", "Barra"), or `undefined` when parked unnamed. */
  label?: string;
}

/**
 * The payload of the `collect-card` event (integrated card terminal, sub-project 7 Task 8/9) — the
 * till-entered gross tip and any per-transaction staff consent to accept the card offline if the
 * network is down, both optional. Emitted by `#onCardTap`/`#retryCard` below and consumed by
 * `till-app`'s `#onCollectCard`, which posts it to `POST /api/pay` almost verbatim. Owned here, like
 * `ConfirmPaymentDetail`/`ParkOrderDetail` above, because this widget is the one that emits it — it
 * used to live on `till-app.ts` (Task 8, before this widget existed to own it).
 */
export interface CollectCardDetail {
  tip?: string;
  allowOffline?: boolean;
}

/**
 * The till's integrated-card wiring (Task 8/9), mirroring `GET /api/till`'s `cardProvider`
 * (`TillInfo`, `../api/client.js`) as a LOCAL type — same decoupling as every alias in that file.
 * `"none"` keeps the Card button on the #62 manual (datáfono) path; the other two make it emit
 * `collect-card` instead.
 */
export type CardProvider = "none" | "stripe_terminal" | "stripe_on_device";

/**
 * The non-`captured` variants of `POST /api/pay`'s outcome (`PayOutcome`, `../api/client.js`) — the
 * shape `till-app`'s `cardOutcome` carries and this widget reads to drive the `"card_outcome"` view
 * (see `willUpdate`).
 */
export type CardOutcome = Exclude<PayOutcome, { outcome: "captured" }>["outcome"];

/** Zero, precomputed — the floor a kg entry must clear to be a real weight. */
const ZERO = decimal("0");

/**
 * One widget, seven VIEWS: the idle buttons, the cash-tender screen, the kg-weight screen, the hold
 * label prompt, the manual card-tender screen, and (Task 9, integrated card terminal) the
 * `"collecting"` spinner and the `"card_outcome"` decline/timeout/network-unavailable screen. Named
 * `View` (not `Mode`) to keep it distinct from the {@link TillTenderPay.mode} property below, which
 * is the per-VENUE pay-timing mode (7c) — an unrelated axis the widget also renders against.
 */
type View = "idle" | "paying" | "weighing" | "holding" | "card" | "collecting" | "card_outcome";

/**
 * The pay flow and the kg-weight entry — the two moments the walk-up sale needs a numeric keypad.
 * It owns a small view state (idle → paying / weighing / holding / card → idle) and renders exactly
 * one view at a time, sharing the `till-numeric-pad` between the cash and weight screens.
 *
 * It coordinates only through the store (spec §3): it subscribes to `"changed"` so the Pay button's
 * enabled state tracks the basket, and to `"product-selected"` so picking a weight tile opens the
 * weigh screen. It never references a sibling widget.
 *
 * MONEY DISCIPLINE. Every amount is an `@waitron/shared` Decimal, never a float, and both tenders
 * read the store's previewed total, so the number the operator settles against is the same one the
 * server re-prices and files. The two tenders diverge in what the terminal event carries: for cash
 * (`#confirm`), `amount` is the operator-entered tendered amount, never the total — the displayed
 * change is `tendered − total` by decimal subtraction, and the server records the fiscal tender at
 * the total and returns the change. For card (`#confirmCard`), there is no operator entry to tender
 * against; `amount` is `this.store.total` itself, since a card is charged the exact total and there
 * is no change.
 *
 * PER-MODE CONTROL (7c prepare & collect, design §3). {@link mode} names the location's pay-timing
 * config and {@link stage} names where in that order's life this widget instance sits; together they
 * pick which idle control renders:
 *  - `mode === "prepay"` (Mode P, the default): the walk-up flow above, unchanged — Pay/Card/Hold,
 *    `stage` is irrelevant (a prepay sale is always settled at order).
 *  - `mode !== "prepay"` (Modes I/T) at `stage === "order"`: no tender is collected here — placing
 *    freezes composition (and, for Mode I, issues a deferred invoice) but a walk-up basket is not
 *    filed against a tender YET — so only Place and Hold are offered. Place emits `place-order`.
 *  - `mode !== "prepay"` at `stage === "collect"`: the order is already placed (Mode I already
 *    invoiced); this is where the tender is finally collected. The SAME cash/card screens Mode P
 *    uses (keypad, change, the optional card ref field) are reused — only their idle button's label
 *    and their terminal event's name differ: `collect-order` instead of `confirm-payment` (see
 *    `#confirm`/`#confirmCard`). No Hold (a placed order is not something you park again).
 *
 * INTEGRATED CARD (Task 9, sub-project 7). When {@link cardProvider} is not `"none"`, the SAME idle
 * Card button takes a different path: `#onCardTap` reads the idle screen's tip/offline-consent
 * fields and emits `collect-card` (not `confirm-payment`/`collect-order`) instead of opening the
 * manual `#renderCard` screen, and the widget enters `"collecting"` (a spinner + a Cancel that is a
 * CLIENT-SIDE ABORT ONLY — see `#cancel`'s own doc). `willUpdate` reacts to {@link cardOutcome} —
 * data on a prop from `till-app`'s `#onCollectCard` (Task 8), not an event — by entering
 * `"card_outcome"`, which offers Retry / Switch tender / Wait. `cardProvider === "none"` leaves every
 * one of these untouched: `#onCardTap` falls straight through to `#startCard`.
 */
@customElement("till-tender-pay")
export class TillTenderPay extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .summary {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }

      .tender-kind {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .prompt {
        margin: 0 0 var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }

      .row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .label {
        color: var(--wt-color-text-muted);
      }

      .amount {
        font-variant-numeric: tabular-nums;
        font-weight: var(--wt-font-weight-bold);
      }

      .change .amount {
        font-size: var(--wt-font-size-lg);
      }

      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-3);
      }

      .pay,
      .pay-card,
      .hold,
      .park,
      .confirm,
      .add,
      .cancel,
      .retry,
      .switch-tender,
      .wait {
        width: 100%;
      }

      .label-input,
      .ref-input {
        margin-bottom: var(--wt-space-3);
      }

      .card-extras {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-3);
      }
    `,
  ];

  /** The order this widget settles. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;
  /**
   * A sale is in flight — the app is awaiting `recordSale` (see `till-app`'s `submitting`). While set,
   * the idle Pay and Hold buttons AND the Confirm-payment button are all disabled (`#renderIdle` gates
   * both idle actions on `busy`, `#renderPaying` gates Confirm), so mid-submit the operator can neither
   * start a new settlement, park the basket, nor re-fire the settlement. This is the VISIBLE half of
   * the double-file guard; the real safety is the app-level single-flight flag, which blocks a second
   * `confirm-payment` regardless of this state.
   */
  @property({ type: Boolean }) busy = false;
  /**
   * The location's pay-timing mode (7c, design §3) — `"prepay"` (Mode P, pay at order, the default
   * that reproduces 7a/7b's walk-up flow unchanged) or `"invoice_first"` / `"ticket_then_pay"`
   * (Modes I/T, place then collect). See the class doc's PER-MODE CONTROL section for exactly which
   * idle control each combination of `mode`/`stage` renders.
   */
  @property() mode: OrderFlow = "prepay";
  /**
   * Where in a Mode-I/T order's life this widget instance sits: `"order"` (composing/placing, the
   * default) or `"collect"` (the order is already placed; this instance collects its tender).
   * Ignored entirely when {@link mode} is `"prepay"` — a prepay sale has no separate collect stage.
   */
  @property() stage: "order" | "collect" = "order";
  /**
   * The till's integrated-card wiring (Task 9, threaded from `till-app`'s `GET /api/till` via
   * `till-counter-screen`). `"none"` (the default) keeps the Card button on the #62 manual
   * (datáfono) path — every earlier slice's behaviour is unchanged until a real value is threaded.
   */
  @property() cardProvider: CardProvider = "none";
  /** Whether the till prompts for a tip on an integrated-card collection (Task 9, mirrors
   * `GET /api/till`'s `tipsEnabled`). Ignored under the manual path (`cardProvider === "none"`). */
  @property({ type: Boolean }) tipsEnabled = false;
  /**
   * The outcome of the most recent non-captured `collect-card` attempt (Task 8's
   * `till-app.cardOutcome`, threaded through `till-counter-screen`) — `undefined` while none is
   * pending. A fresh (CHANGED) value drives this widget into the `"card_outcome"` view; see
   * `willUpdate`.
   */
  @property() cardOutcome?: CardOutcome;
  /**
   * Cash only — hide the Card button in every idle view. Set for a handheld, which may settle a CASH
   * tender but not a card one: the server `/api/sales` firewall fences a handheld card 403
   * `device.forbidden_action` (Task 1's tender-aware route), so offering Card here would be a dead
   * affordance. The counter/fixed till leaves this `false` and keeps both tenders. UI honesty only —
   * the server guard is the real boundary; this widget hides what the server would reject.
   */
  @property({ type: Boolean }) cashOnly = false;

  @state() private view: View = "idle";
  /** The digits the keypad has entered — a partial number string shared by both keypad screens. */
  @state() private entry = "";
  /** The free-text order name typed into the hold prompt; set only while {@link view} is `"holding"`. */
  @state() private labelEntry = "";
  /** The optional bank-terminal operation number typed on the card screen; set only while `"card"`. */
  @state() private refEntry = "";
  /** The weight product awaiting a kg entry; set only while {@link view} is `"weighing"`. */
  @state() private selected?: TillProduct;
  /** The gross tip typed into the integrated-card idle screen (Task 9); read at `#onCardTap` time,
   * shown only when {@link tipsEnabled}. */
  @state() private tipEntry = "";
  /** Per-transaction staff consent to accept the card offline if the network is down (Task 9); read
   * at `#onCardTap` time, shown only for `cardProvider === "stripe_on_device"`. */
  @state() private allowOffline = false;
  /** The detail of the most recent `collect-card` emission (Task 9) — replayed verbatim by
   * `#retryCard` so a retry doesn't silently drop a tip/offline-consent the operator already entered
   * on the idle screen, which is no longer on screen by the time Retry is tapped. Not `@state`: it
   * never drives a render on its own. */
  #lastCollectDetail: CollectCardDetail = {};

  constructor() {
    super();
    // Two store channels, each its own controller (spec §3 — coordinate only through the store):
    // `"changed"` re-renders so the Pay button tracks the basket; `"product-selected"` opens the
    // weigh screen for a picked weight tile. Both `() => this.store` read lazily on connect.
    new StoreChangeController(this, () => this.store);
    new StoreChangeController(
      this,
      () => this.store,
      "product-selected",
      (product) => this.#onProductSelected(product as TillProduct),
    );
  }

  /** Open the weigh screen for a picked weight product; ignore a non-weight pick (never weighed). */
  #onProductSelected(product: TillProduct): void {
    if (product.pricingUnit !== "weight") return;
    this.selected = product;
    this.entry = "";
    this.view = "weighing";
  }

  /**
   * Enter the `"card_outcome"` view the moment {@link cardOutcome} CHANGES to a defined value (Task
   * 9) — a decline/timeout/network-unavailable is DATA on a prop (Task 8), not an event, so there is
   * no click handler to drive this transition. Lit's default `hasChanged` (`!==`) means
   * re-committing the SAME outcome string is not a change, which is what lets "switch tender"
   * (`#cancel`, → `"idle"`) and "keep waiting" (`#wait`, → `"collecting"`) leave {@link view} where
   * the operator put it instead of snapping straight back to the outcome screen — neither touches
   * `cardOutcome` itself; only a genuinely NEW attempt (`#onCardTap`/`#retryCard`, via `till-app`'s
   * `#onCollectCard` clearing it first) produces a fresh value for this to react to.
   */
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("cardOutcome") && this.cardOutcome !== undefined) {
      this.view = "card_outcome";
    }
  }

  /**
   * The entered pad string as a valid Decimal. A trailing dot (`"0."`, mid-entry) is stripped and an
   * empty pad reads as `"0"` — the two shapes `decimal()` would reject — so this never throws on a
   * partial entry.
   */
  #enteredDecimal(): Decimal {
    const trimmed = this.entry.endsWith(".") ? this.entry.slice(0, -1) : this.entry;
    return decimal(trimmed === "" ? "0" : trimmed);
  }

  #onPadChange(event: Event): void {
    event.stopPropagation();
    this.entry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #startPaying(): void {
    this.entry = "";
    this.view = "paying";
  }

  /** Open the hold label prompt with an empty field — the operator may name the order or leave it blank. */
  #startHolding(): void {
    this.labelEntry = "";
    this.view = "holding";
  }

  /** Open the card-tender screen with an empty operation-number field (the field is optional). */
  #startCard(): void {
    this.refEntry = "";
    this.view = "card";
  }

  /** Card tapped from idle (Task 9): the manual path (`cardProvider === "none"`) is the #62 screen,
   * UNCHANGED; otherwise read the tip/offline-consent fields entered alongside the idle Card button
   * (`#renderCardExtras`) and start an integrated collection. */
  #onCardTap(): void {
    if (this.cardProvider === "none") {
      this.#startCard();
      return;
    }
    const tip = this.tipEntry.trim();
    this.#collectCard({
      ...(this.tipsEnabled && tip !== "" ? { tip } : {}),
      ...(this.cardProvider === "stripe_on_device" && this.allowOffline
        ? { allowOffline: true }
        : {}),
    });
  }

  /** Emit `collect-card` with `detail` and enter the collecting spinner (Task 9) — the ONE place
   * that fires the event, shared by the first attempt (`#onCardTap`) and a replay (`#retryCard`). */
  #collectCard(detail: CollectCardDetail): void {
    this.#lastCollectDetail = detail;
    this.view = "collecting";
    this.dispatchEvent(
      new CustomEvent<CollectCardDetail>("collect-card", { detail, bubbles: true, composed: true }),
    );
  }

  /** Retry (card_outcome screen, Task 9): replay the SAME detail the failed attempt sent, rather
   * than re-reading the idle screen's fields (no longer on screen) — safe against a double-charge
   * via the capture-idempotency guard (spec §4: a replayed attempt settles the same PaymentIntent,
   * never a second one). */
  #retryCard(): void {
    this.#collectCard(this.#lastCollectDetail);
  }

  /**
   * "Keep waiting" (card_outcome screen, Task 9): return to the collecting spinner without retrying
   * or switching tender. The `POST /api/pay` this outcome came from has already resolved — `pay()`
   * (`till-app`'s `#onCollectCard`) never leaves a request in flight past its one `await` — so
   * nothing is actually running to wait ON; this only lets the operator sit on the spinner (e.g.
   * while they check the physical terminal) instead of the decline banner, until they pick Retry or
   * Switch tender.
   */
  #wait(): void {
    this.view = "collecting";
  }

  #onTipChange(event: Event): void {
    event.stopPropagation();
    this.tipEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #onOfflineChange(event: Event): void {
    event.stopPropagation();
    this.allowOffline = (event as CustomEvent<{ checked: boolean }>).detail.checked;
  }

  /**
   * Place the order (Modes I/T at the order stage, 7c): freezes composition (and, for Mode I, issues
   * a deferred invoice) with NO tender collected here — a fire-and-forget trigger, unlike Pay/Collect,
   * so it carries no detail. The app reads `store.id` itself, the same way `#park` leaves the id
   * implicit.
   */
  #place(): void {
    this.dispatchEvent(new CustomEvent("place-order", { bubbles: true, composed: true }));
  }

  #onLabelChange(event: Event): void {
    event.stopPropagation();
    this.labelEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  #onRefChange(event: Event): void {
    event.stopPropagation();
    this.refEntry = (event as CustomEvent<{ value: string }>).detail.value;
  }

  /**
   * Emit `park-order` with the (optional) label and return to idle. The app parks the basket and clears
   * it on success; a blank/whitespace-only field parks the order UNNAMED (`label` undefined), matching
   * the store's optional label. The view and label are reset BEFORE the dispatch (unlike `#confirm`,
   * which resets after), so the view is back to idle regardless of what the handler does next — even a
   * synchronous listener that throws leaves the widget idle.
   */
  #park(): void {
    const label = this.labelEntry.trim();
    this.view = "idle";
    this.labelEntry = "";
    this.dispatchEvent(
      new CustomEvent<ParkOrderDetail>("park-order", {
        detail: { label: label === "" ? undefined : label },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Abandon the cash, weigh, hold-label or card screen and return to idle WITHOUT settling anything —
   * no terminal tender event, no `park-order`, no line added. It is the way back from any of those
   * views for an operator who opened Pay/Collect/Hold/Card (or picked a weight tile) by mistake;
   * without it those views are one-way. The basket is left exactly as it was.
   *
   * Also the handler for TWO integrated-card actions (Task 9), both a plain return to idle with no
   * event of their own:
   *  - Cancel, from the `"collecting"` spinner — a CLIENT-SIDE ABORT ONLY. `PaymentProvider` has no
   *    `cancel` method — its methods are `collect`/`forward`/`void`/`refund`/`partialRefund`
   *    (`packages/payments/src/provider.ts:113-137`) — so there is nothing to tell the reader or the
   *    server; the in-flight `POST /api/pay` (`till-app`'s `#onCollectCard`) keeps running to its own
   *    terminal outcome regardless, and a later retry replays safely (capture idempotency, spec §4).
   *    A server-side reader-cancel endpoint is a DEFERRED `PaymentProvider` extension, not built here.
   *  - Switch tender, from the `"card_outcome"` screen — leaves cash / manual card one tap away
   *    (CLAUDE.md §5: a card decline must never wedge the till). `cardOutcome` itself is left
   *    untouched (only `till-app` clears it); see `willUpdate` for why that does not immediately snap
   *    the view back to `"card_outcome"`.
   */
  #cancel(): void {
    this.selected = undefined;
    this.entry = "";
    this.labelEntry = "";
    this.refEntry = "";
    this.view = "idle";
  }

  /**
   * The terminal tender event's NAME (7c, design §3): Mode P's cash/card screens settle a fresh sale
   * (`confirm-payment`, the app's `recordSale`); Modes I/T's collect-stage screens settle an already
   * PLACED order instead (`collect-order`, the app's `collectOrder`) — same screens, same detail
   * shape, different verb because a different server route answers it.
   */
  #tenderEventName(): "confirm-payment" | "collect-order" {
    return this.mode === "prepay" ? "confirm-payment" : "collect-order";
  }

  /** Emit the cash tender and return to idle. Guarded so a short tender can never be emitted, even
   * if Confirm is force-clicked past its disabled state. */
  #confirm(): void {
    if (compareDecimal(this.#enteredDecimal(), this.store.total) < 0) return;
    this.dispatchEvent(
      new CustomEvent<ConfirmPaymentDetail>(this.#tenderEventName(), {
        detail: { method: "cash", amount: this.#enteredDecimal() },
        bubbles: true,
        composed: true,
      }),
    );
    this.view = "idle";
    this.entry = "";
  }

  /**
   * Emit the card tender at the sale total and return to idle. A card is charged the exact total, so
   * `amount` is `this.store.total` (not an operator entry) and there is no change. `externalRef` — the
   * bank terminal's operation number — rides along only when the operator keyed one; a blank or
   * whitespace-only field is omitted. The view and field are reset BEFORE the dispatch (like `#park`,
   * per the 7b Copilot fix), so a synchronous listener that throws still leaves the widget idle.
   */
  #confirmCard(): void {
    const ref = this.refEntry.trim();
    const detail: ConfirmPaymentDetail = {
      method: "card",
      amount: this.store.total,
      ...(ref === "" ? {} : { externalRef: ref }),
    };
    this.view = "idle";
    this.refEntry = "";
    this.dispatchEvent(
      new CustomEvent<ConfirmPaymentDetail>(this.#tenderEventName(), {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Ring up the weighed line and return to idle. Guarded so a zero/empty weight is a no-op, and
   * single-flight so two rapid clicks before Lit re-renders ring the line ONCE: the view is flipped to
   * `"idle"` BEFORE `addProduct`, so the second synchronous call sees `view !== "weighing"` and
   * returns. (The click handler captures `product` from the render closure, so it would otherwise fire
   * again against a stale button.)
   */
  #addWeight(product: TillProduct): void {
    if (this.view !== "weighing") return;
    const kg = this.#enteredDecimal();
    if (compareDecimal(kg, ZERO) <= 0) return;
    this.selected = undefined;
    this.entry = "";
    this.view = "idle";
    this.store.addProduct(product, kg);
  }

  /** What the keypad has entered so far, shown as `"0"` rather than blank when nothing is typed. */
  #entryDisplay(): string {
    return this.entry === "" ? "0" : this.entry;
  }

  override render() {
    if (this.view === "paying") return this.#renderPaying();
    if (this.view === "weighing") return this.#renderWeighing();
    if (this.view === "holding") return this.#renderHolding();
    if (this.view === "card") return this.#renderCard();
    if (this.view === "collecting") return this.#renderCollecting();
    if (this.view === "card_outcome") return this.#renderCardOutcome();
    return this.#renderIdle();
  }

  #renderIdle() {
    // Every idle control shares the same gate — a non-empty basket and no sale in flight.
    const disabled = this.store.lineCount === 0 || this.busy;
    if (this.mode !== "prepay" && this.stage === "order") return this.#renderIdlePlace(disabled);
    if (this.mode !== "prepay" && this.stage === "collect")
      return this.#renderIdleCollect(disabled);
    return this.#renderIdlePay(disabled);
  }

  /**
   * Modes I/T at the order stage (7c): no tender is collected here (design §3) — Place freezes
   * composition (and, for Mode I, issues a deferred invoice); Hold still parks the basket unplaced.
   */
  #renderIdlePlace(disabled: boolean) {
    return html`
      <div class="actions">
        <wt-button
          class="place"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#place()}
        >
          ${t("action.place")}
        </wt-button>
        <wt-button
          class="hold"
          variant="secondary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startHolding()}
        >
          ${t("action.hold")}
        </wt-button>
      </div>
    `;
  }

  /**
   * The Card (manual datáfono) tender button, shared verbatim by both idle views (pay + collect).
   * Returns `nothing` when {@link cashOnly} — a handheld settles CASH only (card fenced client- AND
   * server-side, `assertHandheldTenderAllowed`), so it must offer no card affordance at all. Extracted so
   * a change to the button lives in one place and the two views cannot drift, matching this file's own
   * `#renderCardExtras` idiom.
   */
  #renderCardButton(disabled: boolean) {
    if (this.cashOnly) return nothing;
    return html`
      <wt-button
        class="pay-card"
        variant="primary"
        size="lg"
        ?disabled=${disabled}
        @click=${() => this.#onCardTap()}
      >
        ${t("tender.card")}
      </wt-button>
    `;
  }

  /**
   * Modes I/T at the collect stage (7c): the order is already placed, so this collects its tender —
   * reusing the SAME cash/card screens Mode P's Pay/Card open (`#startPaying`/`#startCard`); only the
   * cash button's label changes (Collect, not Pay) and the terminal Confirm emits `collect-order`
   * (see `#tenderEventName`). No Hold — a placed order is not parked again.
   */
  #renderIdleCollect(disabled: boolean) {
    return html`
      ${this.#renderCardExtras()}
      <div class="actions">
        <wt-button
          class="pay"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startPaying()}
        >
          ${t("action.collect")}
        </wt-button>
        ${this.#renderCardButton(disabled)}
      </div>
    `;
  }

  /** Mode P (prepay, the default): pay at order, unchanged from 7a/7b. */
  #renderIdlePay(disabled: boolean) {
    // Pay, Card and Hold share the same gate — all need a non-empty basket and no sale in flight. Pay
    // (cash) and Card are the two tender options; Hold is secondary (parking is the lesser action).
    // All size "lg" like Pay so every one clears the 44px POS touch minimum.
    return html`
      ${this.#renderCardExtras()}
      <div class="actions">
        <wt-button
          class="pay"
          variant="primary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startPaying()}
        >
          ${t("action.pay")}
        </wt-button>
        ${this.#renderCardButton(disabled)}
        <wt-button
          class="hold"
          variant="secondary"
          size="lg"
          ?disabled=${disabled}
          @click=${() => this.#startHolding()}
        >
          ${t("action.hold")}
        </wt-button>
      </div>
    `;
  }

  /**
   * The integrated-card affordances shown ALONGSIDE the idle Card button (Task 9) — never for the
   * manual path (`cardProvider === "none"` returns `nothing`, so #62's idle screens are pixel-for-
   * pixel unchanged). The tip field shows only when {@link tipsEnabled}; the offline-consent toggle
   * only for `"stripe_on_device"` — a server-driven `"stripe_terminal"` fixed-counter reader has no
   * device-local offline queue to consent INTO (`StripeTerminalProvider.forward`'s own doc: "no
   * device-local offline queue... the pass is always a no-op",
   * `packages/payments-stripe/src/provider.ts:142-145`). Read at tap time by `#onCardTap`, not bound
   * into the emitted event until then.
   */
  #renderCardExtras() {
    if (this.cardProvider === "none") return nothing;
    return html`
      <div class="card-extras">
        ${
          this.tipsEnabled
            ? html`
                <wt-input
                  class="tip-input"
                  type="number"
                  .value=${this.tipEntry}
                  .label=${t("card.tip")}
                  @wt-change=${(event: Event) => this.#onTipChange(event)}
                ></wt-input>
              `
            : nothing
        }
        ${
          this.cardProvider === "stripe_on_device"
            ? html`
                <wt-switch
                  class="offline-consent"
                  .checked=${this.allowOffline}
                  .label=${t("card.offline_consent")}
                  @wt-change=${(event: Event) => this.#onOfflineChange(event)}
                ></wt-switch>
              `
            : nothing
        }
      </div>
    `;
  }

  /** The `"collecting"` view (Task 9): a spinner-equivalent status line plus a client-side-abort
   * Cancel — see `#cancel`'s own doc for why Cancel fires no event. */
  #renderCollecting() {
    return html`
      <div class="summary collecting">
        <p class="prompt">${t("card.collecting")}</p>
      </div>
      <div class="actions">
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("card.cancel")}
        </wt-button>
      </div>
    `;
  }

  /**
   * The `"card_outcome"` view (Task 9) — a decline/timeout/network-unavailable, ENTERED reactively
   * by `willUpdate` off {@link cardOutcome}, never by a click. One message regardless of WHICH of
   * the three it was (only `card.declined` is specced; `PayOutcome`'s own doc notes `"timeout"`
   * never fires today — a poll-window stall already collapses into `"declined"` server-side), and
   * three actions: Retry (`#retryCard`), Switch tender (`#cancel` — see its doc), Wait (`#wait`).
   */
  #renderCardOutcome() {
    return html`
      <div class="summary card-outcome">
        <p class="prompt">${t("card.declined")}</p>
      </div>
      <div class="actions">
        <wt-button class="retry" variant="primary" size="lg" @click=${() => this.#retryCard()}>
          ${t("card.retry")}
        </wt-button>
        <wt-button class="switch-tender" variant="secondary" @click=${() => this.#cancel()}>
          ${t("card.switch_tender")}
        </wt-button>
        <wt-button class="wait" variant="secondary" @click=${() => this.#wait()}>
          ${t("card.wait")}
        </wt-button>
      </div>
    `;
  }

  #renderHolding() {
    return html`
      <wt-input
        class="label-input"
        .value=${this.labelEntry}
        .label=${t("held.label_prompt")}
        @wt-change=${(event: Event) => this.#onLabelChange(event)}
      ></wt-input>
      <div class="actions">
        <wt-button class="park" variant="primary" size="lg" @click=${() => this.#park()}>
          ${t("action.hold")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }

  #renderCard() {
    // A card is charged the exact total on the standalone terminal — no keypad, no tendered/change
    // rows. The only input is the OPTIONAL operation number; Confirm settles at the store total.
    return html`
      <div class="summary">
        <p class="tender-kind">${t("tender.card")}</p>
        <div class="row">
          <span class="label">${t("label.total")}</span>
          <span class="amount total">${formatMoney(this.store.total)}</span>
        </div>
      </div>
      <wt-input
        class="ref-input"
        .value=${this.refEntry}
        .label=${t("tender.card_ref")}
        @wt-change=${(event: Event) => this.#onRefChange(event)}
      ></wt-input>
      <div class="actions">
        <wt-button
          class="confirm"
          variant="primary"
          size="lg"
          ?disabled=${this.busy}
          @click=${() => this.#confirmCard()}
        >
          ${t("action.confirm_payment")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }

  #renderPaying() {
    const total = this.store.total;
    const entered = this.#enteredDecimal();
    const short = compareDecimal(entered, total) < 0;
    return html`
      <div class="summary">
        <p class="tender-kind">${t("tender.cash")}</p>
        <div class="row">
          <span class="label">${t("label.total")}</span>
          <span class="amount total">${formatMoney(total)}</span>
        </div>
        <div class="row">
          <span class="label">${t("label.tendered")}</span>
          <span class="amount tendered">${this.#entryDisplay()}</span>
        </div>
        ${
          short
            ? nothing
            : html`
                <div class="row change">
                  <span class="label">${t("label.change")}</span>
                  <span class="amount">${formatMoney(subtractDecimal(entered, total))}</span>
                </div>
              `
        }
      </div>
      <till-numeric-pad
        .value=${this.entry}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <div class="actions">
        <wt-button
          class="confirm"
          variant="primary"
          size="lg"
          ?disabled=${short || this.busy}
          @click=${() => this.#confirm()}
        >
          ${t("action.confirm_payment")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }

  #renderWeighing() {
    // `view === "weighing"` is only ever entered with a product set (see #onProductSelected), so
    // `selected` is defined here — asserting it keeps a dead, uncoverable runtime guard out.
    const product = this.selected as TillProduct;
    const invalid = compareDecimal(this.#enteredDecimal(), ZERO) <= 0;
    return html`
      <p class="prompt">${t("weigh.prompt")}</p>
      <div class="summary">
        <div class="row">
          <span class="label">kg</span>
          <span class="amount kg">${this.#entryDisplay()}</span>
        </div>
      </div>
      <till-numeric-pad
        .value=${this.entry}
        @wt-change=${(event: Event) => this.#onPadChange(event)}
      ></till-numeric-pad>
      <div class="actions">
        <wt-button
          class="add"
          variant="primary"
          size="lg"
          ?disabled=${invalid}
          @click=${() => this.#addWeight(product)}
        >
          ${t("action.add")}
        </wt-button>
        <wt-button class="cancel" variant="secondary" @click=${() => this.#cancel()}>
          ${t("action.cancel")}
        </wt-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-tender-pay": TillTenderPay;
  }
}
