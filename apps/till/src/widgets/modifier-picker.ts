import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, draftScopeFor, saveActionState } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import type { OptionSelection, OptionSnapshot } from "@waitron/shared";
import { decimal, formatMoney, toScale } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { lineGross, productAsVariant, quantityPlaces } from "../state/order-line.js";
import { optionSnapshotOf } from "../state/held-options.js";
import { productName } from "./product-name.js";
import { descriptionFor } from "./dish-format.js";
import { lineExtrasEditorStyles, renderLineExtrasEditor } from "./line-extras-editor.js";
import type { LineSelection, OrderLine, SelectedExtra } from "../state/working-order.js";
import type {
  OfferedExtraItem,
  OfferedExtrasList,
  OfferedOptionsList,
  TillProduct,
} from "../api/client.js";

interface ModifierDraft {
  variantId: string;
  picks: Record<string, number>;
  answers: Record<string, string>;
  note: string;
}

export interface ModifierConfirmDetail extends LineSelection {
  product: TillProduct;
}

/**
 * One pick's identity while the dialog is open. A product can be offered by two of a dish's lists at
 * two prices, so the list has to be part of the key: counting by product alone would make one
 * stepper move both rows.
 */
function pickKey(listId: string, productId: string): string {
  return `${listId}\u0000${productId}`;
}

/** "+€1.50" for a variant dearer than its parent, "−€0.50" (a minus sign) for a cheaper one. */
function priceDifference(difference: string): string {
  return difference.startsWith("-")
    ? `\u2212${formatMoney(difference.slice(1), currentLocale())}`
    : `+${formatMoney(difference, currentLocale())}`;
}

/**
 * Walks the dish's offered lists in the order the offer gives them, which nothing here re-sorts.
 *
 * It reads the STAFF name of every list, label and offered product. The till is a staff surface; the
 * diner's and the cook's wordings belong to the receipt and the kitchen ticket.
 */
@customElement("till-modifier-picker")
export class TillModifierPicker extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    lineExtrasEditorStyles,
    css`
      .group {
        margin: 0 0 var(--wt-space-4);
      }

      .group-name {
        margin: 0 0 var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The per-list counter reads OUT the list's state; it is not another choice in it. A size down
         and muted keeps the eye walking the item names from stopping on it. Without a rule of its own
         a <p> also keeps the user agent's 1em margins, which is em-derived spacing no token governs. */
      .selected-total {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* A refusal is the reason Add is shut, so it has to be what the operator's eye lands on: the
         emphasis the basket gives .allergen-pending, in the danger colour because this one stops the
         dish being added rather than cautioning about it. */
      .refusal {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) 0;
        cursor: pointer;
      }

      .option input:disabled {
        cursor: not-allowed;
      }

      /* An unavailable variant stays listed so the operator sees it is sold out, not missing. */
      .option:has(input[name="product-variant"]:disabled) .option-name {
        color: var(--wt-color-text-muted);
      }

      /* A stepper row is a plain container, not a single-control label, so it is not pointer-cued. */
      .stepper-option {
        cursor: default;
      }

      .option-name {
        flex: 1;
      }

      .option-delta,
      .price-difference {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .stepper-count {
        min-width: var(--wt-space-5);
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-weight: var(--wt-font-weight-bold);
      }

      .running {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .running-label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .running-amount {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) product!: TillProduct;

  /** How many of the dish the line holds — the count the running price multiplies every pick by. */
  @property() quantity = "1";

  /** The answers a line already carries, when the dialog was opened to EDIT one. Present also when
   * it is empty, which is how "the operator deliberately picked nothing" is told from a fresh open:
   * a fresh open seeds the offer's defaults, a reopen never does. */
  @property({ attribute: false }) initialSelections?: LineSelection;

  /** Shows the note field on a reopen too, seeded from `initialSelections.note`. A fresh open always
   * shows it; a basket reopen leaves the note to the basket's own editor. */
  @property({ type: Boolean }) withNote = false;

  /** How many of each offered product is taken, keyed by {@link pickKey}. */
  @state() private picks: Record<string, number> = {};

  /** The label chosen per options list, keyed by list id. */
  @state() private answers: Record<string, string> = {};

  @state() private note = "";

  @state() private variantId = "";

  #seeded = false;

  @state() private active = true;
  #scope?: DraftScope<ModifierDraft>;
  #leave?: LeaveCoordinator;
  #baseline?: ModifierDraft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #draft(): ModifierDraft {
    return {
      variantId: this.variantId,
      picks: { ...this.picks },
      answers: { ...this.answers },
      note: this.note.trim(),
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.product || !this.active) return;
    if (!this.#seeded) this.#seedSelections();
    if (!this.isConnected || this.#scope) return;
    this.#baseline ??= this.#draft();
    const { coordinator, scope } = draftScopeFor<ModifierDraft>(this, {
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value, picks: { ...value.picks }, answers: { ...value.answers } }),
      equal: (a, b) =>
        a.variantId === b.variantId &&
        a.note === b.note &&
        Object.keys(a.picks).length === Object.keys(b.picks).length &&
        Object.entries(a.picks).every(([key, count]) => b.picks[key] === count) &&
        Object.keys(a.answers).length === Object.keys(b.answers).length &&
        Object.entries(a.answers).every(([key, label]) => b.answers[key] === label),
      restore: (value) => {
        this.variantId = value.variantId;
        this.picks = { ...value.picks };
        this.answers = { ...value.answers };
        this.note = value.note;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #seedSelections(): void {
    this.#seeded = true;
    if (this.initialSelections !== undefined) {
      if (this.withNote) this.note = this.initialSelections.note ?? "";
      for (const extra of this.initialSelections.extras ?? [])
        this.picks[pickKey(extra.listId, extra.productId)] = extra.quantity;
      for (const answer of this.initialSelections.options ?? [])
        this.answers[answer.listId] = answer.labelId;
      return;
    }
    this.variantId = this.#variants.find((variant) => variant.available)?.id ?? "";
    for (const entry of this.#offered) {
      if (entry.kind === "options") {
        if (entry.defaultLabelId !== null) this.answers[entry.id] = entry.defaultLabelId;
        continue;
      }
      for (const item of entry.items) {
        if (item.preselected) this.picks[pickKey(entry.id, item.productId)] = 1;
      }
    }
  }

  /** The lists this dish offers, in offer order. A product the till synthesised (a retrieved line
   * with no live offer) carries none, and then the dialog has only its variants to ask about. */
  get #offered() {
    return this.product.offeredModifiers ?? [];
  }

  /** Every variant the offer lists, in variant order; an unavailable one is drawn disabled. The
   * parent itself is never offered: a product with variants is sold as one of them. */
  get #variants() {
    return this.product.variants ?? [];
  }

  get #chosenVariant() {
    return this.#variants.find((variant) => variant.id === this.variantId && variant.available);
  }

  /** The product as chosen: the dish itself, or the chosen variant of it. */
  get #selectedProduct(): TillProduct {
    const variant = this.#chosenVariant;
    return variant === undefined ? this.product : productAsVariant(this.product, variant);
  }

  #countOf(listId: string, productId: string): number {
    return this.picks[pickKey(listId, productId)] ?? 0;
  }

  #listTotal(list: OfferedExtrasList): number {
    return list.items.reduce((sum, item) => sum + this.#countOf(list.id, item.productId), 0);
  }

  /**
   * Seeded picks the dish no longer offers — the list was withdrawn, or it dropped the product. They
   * are not silently discarded: the dialog says so and Add stays shut, because dropping one would
   * un-order something the kitchen may already have been told about.
   */
  #stalePicks(): SelectedExtra[] {
    return (this.initialSelections?.extras ?? []).filter(
      (extra) =>
        !this.#offered.some(
          (entry) =>
            entry.kind === "extras" &&
            entry.id === extra.listId &&
            entry.items.some((item) => item.productId === extra.productId),
        ),
    );
  }

  #listTotals(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const entry of this.#offered) {
      if (entry.kind === "extras") totals.set(entry.id, this.#listTotal(entry));
    }
    return totals;
  }

  /**
   * Whether Add may be enabled. Takes the stale picks and the per-list counts rather than deriving
   * them, so one render computes each once and shares it with {@link #renderExtras}.
   */
  #satisfied(stale: readonly SelectedExtra[], totals: ReadonlyMap<string, number>): boolean {
    if (this.#variants.length > 0 && this.#chosenVariant === undefined) return false;
    if (stale.length > 0) return false;
    return this.#offered.every((entry) => {
      if (entry.kind === "options")
        return entry.labels.some((label) => label.id === this.answers[entry.id]);
      const total = totals.get(entry.id) ?? 0;
      return (
        total >= entry.minPicks &&
        (entry.maxPicks === null || total <= entry.maxPicks) &&
        entry.items.every(
          (item) =>
            item.maxQuantity === null ||
            this.#countOf(entry.id, item.productId) <= item.maxQuantity,
        )
      );
    });
  }

  #selectedExtras(): SelectedExtra[] {
    return this.#offered.flatMap((entry) =>
      entry.kind === "extras"
        ? entry.items.flatMap((item): SelectedExtra[] => {
            const quantity = this.#countOf(entry.id, item.productId);
            return quantity < 1
              ? []
              : [
                  {
                    listId: entry.id,
                    productId: item.productId,
                    name: item.name,
                    price: item.price,
                    quantity,
                  },
                ];
          })
        : [],
    );
  }

  #selectedOptions(): OptionSelection[] {
    return this.#answeredLists().map(({ list, labelId }) => ({ listId: list.id, labelId }));
  }

  /** Built here so the basket renders a line the operator has just answered through the same reader
   * as a line read back from a held order. */
  #selectedSnapshots(): OptionSnapshot[] {
    return this.#answeredLists().map(({ list, labelId }) =>
      optionSnapshotOf(
        list,
        list.labels.find((candidate) => candidate.id === labelId)!,
      ),
    );
  }

  /** Each offered options list that holds an answer naming one of its own labels, in offer order. */
  #answeredLists(): { list: OfferedOptionsList; labelId: string }[] {
    return this.#offered.flatMap((entry) => {
      if (entry.kind !== "options") return [];
      const labelId = this.answers[entry.id];
      return entry.labels.some((label) => label.id === labelId)
        ? [{ list: entry, labelId: labelId! }]
        : [];
    });
  }

  get #runningPrice(): string {
    const previewLine: OrderLine = {
      product: this.#selectedProduct,
      quantity: this.quantity,
      extras: this.#selectedExtras(),
    };
    return formatMoney(lineGross(previewLine), currentLocale());
  }

  #setCount(listId: string, productId: string, quantity: number): void {
    if (!this.isConnected || !this.active) return;
    const next = { ...this.picks };
    if (quantity >= 1) {
      next[pickKey(listId, productId)] = quantity;
    } else {
      delete next[pickKey(listId, productId)];
    }
    this.picks = next;
    this.#scope?.changed();
  }

  /**
   * Step one item's count, held inside BOTH bounds: the item's own `maxQuantity` and what is left of
   * the list's `maxPicks`. Clamping here and not only in {@link #satisfied} matters because a
   * click on a disabled `wt-button` still reaches this handler — the host takes the click, the
   * disabled inner `<button>` never sees it — so without the clamp a forced tap would show a count
   * the list does not allow.
   */
  #step(list: OfferedExtrasList, item: OfferedExtraItem, delta: number): void {
    const current = this.#countOf(list.id, item.productId);
    const listRoom =
      list.maxPicks === null ? null : current + list.maxPicks - this.#listTotal(list);
    const room =
      item.maxQuantity === null
        ? listRoom
        : listRoom === null
          ? item.maxQuantity
          : Math.min(item.maxQuantity, listRoom);
    this.#setCount(
      list.id,
      item.productId,
      Math.max(0, room === null ? current + delta : Math.min(room, current + delta)),
    );
  }

  #confirm(e?: Event): void {
    e?.stopPropagation();
    if (!this.isConnected || !this.active) return;
    if (this.#saveAction().unchanged) return;
    if (!this.#satisfied(this.#stalePicks(), this.#listTotals())) return;
    const submitted = this.#draft();
    this.#baseline = submitted;
    this.#scope?.commit(submitted);
    const extras = this.#selectedExtras();
    const options = this.#selectedOptions();
    const detail: ModifierConfirmDetail = {
      product: this.#selectedProduct,
      ...(extras.length === 0 ? {} : { extras }),
      ...(options.length === 0 ? {} : { options, optionSnapshots: this.#selectedSnapshots() }),
    };
    const note = this.note.trim();
    if (note !== "") {
      detail.note = note;
    }
    this.dispatchEvent(
      new CustomEvent<ModifierConfirmDetail>("wt-modifier-confirm", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    if (this.#leave) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-modal")!.requestClose("cancel");
      return;
    }
    this.#reportCancel();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportCancel();
  }

  /** A fresh open is adding a dish, and its defaults are valid to send; only an edit waits for a change. */
  #saveAction() {
    return saveActionState(this.#scope, { savableAtOpen: this.initialSelections === undefined });
  }

  #reportCancel(): void {
    this.dispatchEvent(
      new CustomEvent("wt-modifier-cancel", { detail: {}, bubbles: true, composed: true }),
    );
  }

  override render() {
    const stale = this.#stalePicks();
    const totals = this.#listTotals();
    const saveAction = this.#saveAction();
    return html`<wt-modal
      ${trackDialog()}
      size="standard"
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${productName(this.product)}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      ${
        this.#variants.length === 0
          ? nothing
          : html`<fieldset class="group">
              <legend class="group-name">${t("modifier.variant")} *</legend>
              ${this.#variants.map(
                (variant) =>
                  html`<label class="option">
                    <input
                      type="radio"
                      name="product-variant"
                      value=${variant.id}
                      .checked=${this.variantId === variant.id}
                      ?disabled=${!variant.available}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        if (!this.isConnected || !this.active) return;
                        this.variantId = variant.id;
                        this.#scope?.changed();
                      }}
                    />
                    <span class="option-name">${variant.name}</span>
                    ${
                      variant.unitPriceDifference === null
                        ? nothing
                        : html`<span class="price-difference"
                            >${priceDifference(variant.unitPriceDifference)}</span
                          >`
                    }
                    <span class="option-delta"
                      >${formatMoney(variant.unitPrice, currentLocale())}</span
                    >
                  </label>`,
              )}
            </fieldset>`
      }
      ${this.#offered.map((entry) =>
        entry.kind === "extras"
          ? this.#renderExtras(entry, totals.get(entry.id) ?? 0)
          : this.#renderOptions(entry),
      )}
      ${stale.map(
        (extra) =>
          html`<p class="refusal" role="alert">
            ${extra.name}: ${t("modifier.selection_changed")}
          </p>`,
      )}
      ${
        this.initialSelections !== undefined && !this.withNote
          ? nothing
          : renderLineExtrasEditor({
              note: this.note,
              onNoteChange: (note) => {
                if (!this.isConnected || !this.active) return;
                this.note = note;
                this.#scope?.changed();
              },
            })
      }
      <div class="running">
        <span class="running-label">${t("label.total")}</span>
        <span class="running-amount">${this.#runningPrice}</span>
      </div>
      <wt-button
        slot="footer"
        class="cancel"
        variant="secondary"
        @click=${(event: Event) => this.#cancel(event)}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        class="confirm"
        variant=${saveAction.variant}
        ?disabled=${saveAction.unchanged || !this.#satisfied(stale, totals)}
        @click=${(e: Event) => this.#confirm(e)}
      >
        ${t(this.initialSelections === undefined ? "action.add" : "modifier.save")}
      </wt-button>
    </wt-modal>`;
  }

  #renderExtras(list: OfferedExtrasList, total: number) {
    const atListMax = list.maxPicks !== null && total >= list.maxPicks;
    return html`
      <fieldset class="group">
        <legend class="group-name">${list.name}${list.minPicks >= 1 ? " *" : ""}</legend>
        <p class="selected-total">
          ${t("modifier.selected_total")}:
          ${total}${list.maxPicks === null ? "" : ` / ${list.maxPicks}`}
        </p>
        ${list.items.map((item) =>
          item.maxQuantity === null || item.maxQuantity > 1
            ? this.#renderStepper(list, item, atListMax)
            : this.#renderPick(list, item, atListMax),
        )}
      </fieldset>
    `;
  }

  /** A free pick shows no price at all — "0,00" beside a bread roll reads as a charge. */
  #priceOf(item: OfferedExtraItem) {
    return Number(item.price) !== 0 ? formatMoney(item.price, currentLocale()) : nothing;
  }

  #extraName(item: OfferedExtraItem): string {
    if (item.portion === undefined || item.unit === undefined) return item.name;
    const places = Math.max(item.unit.precision, quantityPlaces(item.portion));
    const amount = toScale(decimal(item.portion), places);
    const unit = descriptionFor(item.unit.abbreviation, "");
    return `${item.name} · ${amount}${unit ? ` ${unit}` : ""}`;
  }

  #renderPick(list: OfferedExtrasList, item: OfferedExtraItem, atListMax: boolean) {
    const checked = this.#countOf(list.id, item.productId) >= 1;
    return html`
      <label class="option">
        <input
          id="pick-${list.id}-${item.productId}"
          type="checkbox"
          name=${`extras-${list.id}`}
          .checked=${checked}
          ?disabled=${!checked && atListMax}
          @change=${(e: Event) => {
            e.stopPropagation();
            this.#setCount(list.id, item.productId, (e.target as HTMLInputElement).checked ? 1 : 0);
          }}
        />
        <span class="option-name">${this.#extraName(item)}</span>
        <span class="option-delta">${this.#priceOf(item)}</span>
      </label>
    `;
  }

  #renderStepper(list: OfferedExtrasList, item: OfferedExtraItem, atListMax: boolean) {
    const count = this.#countOf(list.id, item.productId);
    const test = `pick-${list.id}-${item.productId}`;
    return html`
      <div class="option stepper-option">
        <span class="option-name">${this.#extraName(item)}</span>
        <span class="option-delta">${this.#priceOf(item)}</span>
        <span class="stepper">
          <wt-button
            class="step"
            size="sm"
            data-test="${test}-dec"
            aria-label=${`${t("modifier.decrease")} ${item.name}`}
            ?disabled=${count <= 0}
            @click=${() => this.#step(list, item, -1)}
          >
            −
          </wt-button>
          <span class="stepper-count" data-test="${test}-count">${count}</span>
          <wt-button
            class="step"
            size="sm"
            data-test="${test}-inc"
            aria-label=${`${t("modifier.increase")} ${item.name}`}
            ?disabled=${(item.maxQuantity !== null && count >= item.maxQuantity) || atListMax}
            @click=${() => this.#step(list, item, 1)}
          >
            +
          </wt-button>
        </span>
      </div>
    `;
  }

  #renderOptions(list: OfferedOptionsList) {
    return html`
      <fieldset class="group">
        <legend class="group-name">${list.name} *</legend>
        ${list.labels.map(
          (label) => html`
            <label class="option">
              <input
                id="label-${list.id}-${label.id}"
                type="radio"
                name=${`options-${list.id}`}
                .checked=${this.answers[list.id] === label.id}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  if (!this.isConnected || !this.active) return;
                  this.answers = { ...this.answers, [list.id]: label.id };
                  this.#scope?.changed();
                }}
              />
              <span class="option-name">${label.name}</span>
            </label>
          `,
        )}
        ${
          list.labels.length === 0
            ? html`<p class="refusal" role="alert">
                ${list.name}: ${t("modifier.unavailable_choices")}
              </p>`
            : nothing
        }
      </fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-modifier-picker": TillModifierPicker;
  }
}
