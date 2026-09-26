import "./modifier-picker.js";
import type { ModifierConfirmDetail } from "./modifier-picker.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { optionAnswers } from "./option-snapshot.js";
import { dishGross, extraGross, quantityLabel } from "../state/order-line.js";
import { asServedAllergens, asServedDiet } from "../state/as-served.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "./diet-badges.js";
import { lineExtrasEditorStyles, renderLineExtrasEditor } from "./line-extras-editor.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { LineSelection, OrderLine, WorkingOrderStore } from "../state/working-order.js";
import { lineProductName, productUnit } from "./product-name.js";

/** The same `×` (U+00D7) the printed receipt and the settled-ticket view use. */
const QTY_BADGE = "×";

function pickQuantityBadge(quantity: number): string {
  return quantity > 1 ? ` ${QTY_BADGE}${quantity}` : "";
}

function notOfferedMarker() {
  return html` <span class="not-offered">${t("basket.not_offered")}</span>`;
}

/**
 * The running order. It holds no basket state of its own, so it can never disagree with the store the
 * pay flow reads.
 */
@customElement("till-basket")
export class TillBasket extends LitElement {
  static override styles = [
    baseStyles,
    dietBadgeStyles,
    lineExtrasEditorStyles,
    css`
      :host {
        display: block;
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      .line {
        display: grid;
        grid-template-columns: 1fr auto auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      /* The per-line note editor (order-line customisation) — an inline expander opened by the line's
         Note button, indented under the dish like its option/allergen/diet sub-rows. */
      .line-extras-editor {
        padding: var(--wt-space-2) 0 var(--wt-space-3);
        padding-left: var(--wt-space-4);
      }

      /* The at-a-glance read-out of a line's SET note (order-line customisation) — indented under the
         dish like the allergen/diet rows, a label plus the value. */
      .line-extras {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding: var(--wt-space-1) 0 var(--wt-space-2);
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm, 0.85em);
        color: var(--wt-color-text-muted);
      }

      .line-extras-label {
        font-weight: 600;
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      /* Dish-line quantity stepper: -/N/+ for a whole, non-hardware unit; other units stay static. */
      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .count {
        min-width: 1.5ch;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .line-total {
        font-variant-numeric: tabular-nums;
      }

      /* A pick, and a frozen options answer — indented beneath its dish, name left and any price
         right, with no quantity column and no remove control (a child is not independently
         deletable; removing the dish removes it). */
      .option {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-1) 0;
        padding-left: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }

      .option-total {
        font-variant-numeric: tabular-nums;
      }

      .not-offered {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The line's AS-SERVED allergen profile (modifier↔allergen, Task 7) — indented under the dish
         like its options, a label plus the declared codes as chips, with a "not fully reviewed" note
         when the dish's own allergens are unreviewed (the Cautious policy, visible to the waiter). */
      .line-allergens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding: var(--wt-space-1) 0 var(--wt-space-2);
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm, 0.85em);
        color: var(--wt-color-text-muted);
      }

      .allergen-label {
        font-weight: 600;
      }

      .allergen-chip {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full, 999px);
      }

      /* The pending note earns emphasis — a waiter must not read an unreviewed dish as allergen-free. */
      .allergen-pending {
        color: var(--wt-color-warning-text, var(--wt-color-text));
        font-weight: 600;
      }

      /* The as-served DIET & contains row (dietary-classification, Task 7) — indented under the dish
         like its allergen row, beneath it. The badge/chip look comes from the shared dietBadgeStyles;
         only the indent + spacing is basket-specific. */
      .line-diet {
        padding: 0 0 var(--wt-space-2);
        padding-left: var(--wt-space-4);
      }

      /* A selected extra's OWN allergens/diet (nutrition redesign, pass 1), indented under its option
         row, its own list beside the dish's own rows below — never a fold. The chip/badge look comes from
         the shared .allergen-chip and dietBadgeStyles; only the indent + spacing is basket-specific. */
      .extra-nutrition {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding: 0 0 var(--wt-space-1);
        padding-left: var(--wt-space-4);
        font-size: var(--wt-font-size-sm, 0.85em);
        color: var(--wt-color-text-muted);
      }

      .extra-allergens,
      .extra-diet {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
      }
    `,
  ];

  /** The order this basket shows and mutates. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  /** A POSITIONAL index into `store.lines`, so it must follow any change that shifts positions:
   * {@link #removeLine} adjusts it and a whole-basket swap closes it. Otherwise a note, which can carry
   * allergy information, would reattach to whatever line slid into the edited line's slot. */
  @state() private editingIndex: number | null = null;

  /** Assigned only through {@link #openModifierPicker} / {@link #closeModifierPicker}, which keep
   * {@link #modifierSelection} in step with it. */
  @state() private modifierLine: OrderLine | null = null;

  /**
   * Built once when the picker opens, not per render: Lit's default `hasChanged` is an identity check,
   * so a fresh literal in `render()` would re-render the dialog on every basket render.
   */
  #modifierSelection: LineSelection | null = null;

  /** Detects a whole-basket swap: `clear` mints a fresh id and `loadFrom` adopts the retrieved order's,
   * while an in-basket add / remove / edit keeps it. */
  #lastStoreId?: string;

  #openModifierPicker(line: OrderLine): void {
    this.modifierLine = line;
    this.#modifierSelection = { extras: line.extras ?? [], options: line.options ?? [] };
  }

  #closeModifierPicker(): void {
    this.modifierLine = null;
    this.#modifierSelection = null;
  }

  constructor() {
    super();
    new ContentLanguageController(this);
    new StoreChangeController(
      this,
      () => this.store,
      "changed",
      () => this.#onStoreChanged(),
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Without this the first `"changed"` would read the unchanged id as a swap and close an open editor.
    this.#lastStoreId = this.store.id;
  }

  #onStoreChanged(): void {
    if (this.store.id !== this.#lastStoreId) {
      this.#lastStoreId = this.store.id;
      this.editingIndex = null;
      this.#closeModifierPicker();
    }
    if (this.modifierLine !== null && !this.store.lines.includes(this.modifierLine))
      this.#closeModifierPicker();
    this.requestUpdate();
  }

  #removeLine(index: number): void {
    if (this.editingIndex !== null) {
      if (index === this.editingIndex) {
        this.editingIndex = null;
      } else if (index < this.editingIndex) {
        this.editingIndex -= 1;
      }
    }
    this.store.removeLine(index);
  }

  #lineName(line: OrderLine): string {
    return lineProductName(line.product);
  }

  #answers(line: OrderLine): string[] {
    return optionAnswers(line.optionSnapshots, { reads: "staff" });
  }

  /**
   * A pick's own allergens and diet, read live from the dish's offer rather than frozen onto the line.
   * `undefined` when no offered list names the product, so the row claims no empty declaration.
   */
  #extraOwnNutrition(
    line: OrderLine,
    productId: string,
  ):
    | {
        addAllergens: Record<
          string,
          { presence: "contains" | "may_contain"; source?: string }
        > | null;
        suitableFor: readonly string[];
      }
    | undefined {
    const item = (line.product.offeredModifiers ?? [])
      .flatMap((entry) => (entry.kind === "extras" ? entry.items : []))
      .find((candidate) => candidate.productId === productId);
    return item === undefined
      ? undefined
      : { addAllergens: item.addAllergens, suitableFor: item.suitableFor };
  }

  override render() {
    const lines = this.store.lines;
    if (lines.length === 0) {
      return html`<p class="empty">${t("basket.empty")}</p>`;
    }
    return html`
      ${lines.map(
        (line, index) => html`
          <div class="line">
            <span class="name"
              >${this.#lineName(line)}${line.notOffered ? notOfferedMarker() : nothing}</span
            >
            ${this.#quantityCell(line, index)}
            <span class="line-total">${formatMoney(dishGross(line), currentLocale())}</span>
            <wt-button
              class="note-toggle"
              variant="ghost"
              size="md"
              data-test=${`line-note-button-${index}`}
              aria-expanded=${this.editingIndex === index}
              aria-label=${`${t("line.note.button")} ${this.#lineName(line)}`}
              @click=${() => this.#toggleEditor(index)}
            >
              ${t("line.note.button")}
            </wt-button>
            <wt-button
              class="remove"
              variant="ghost"
              size="md"
              aria-label=${`${t("action.remove")} ${this.#lineName(line)}`}
              @click=${() => this.#removeLine(index)}
            >
              <span aria-hidden="true">×</span>
            </wt-button>
          </div>
          ${
            // Offered lists alone, NOT `needsModifierPicker`: `setLineModifiers` replaces a line's
            // answers and never its product, so a dish whose only question is its variant gets no
            // Edit button rather than a dialog whose save would carry nothing. The MIXED case —
            // variants AND an offered list — still re-asks the variant and discards it; open in
            // `docs/backlog.md`.
            line.product.offeredModifiers?.length
              ? html`<wt-button
                  class="edit-modifiers"
                  size="sm"
                  variant="ghost"
                  @click=${() => this.#openModifierPicker(line)}
                  >${t("modifier.edit")}</wt-button
                >`
              : nothing
          }
          ${this.#extrasRow(line, index)} ${this.#extrasEditor(line, index)}
          ${(line.extras ?? []).map(
            // No remove control: a pick goes only with its dish. Its own allergens and diet sit
            // beside the dish's rows, never folded into them.
            (extra, i) => {
              const own = this.#extraOwnNutrition(line, extra.productId);
              return html`
                <div class="option">
                  <span class="name">${extra.name}${pickQuantityBadge(extra.quantity)}</span>
                  <span class="option-total"
                    >${formatMoney(extraGross(line, extra), currentLocale())}</span
                  >
                </div>
                ${own ? extraNutrition(own, `option-allergens-${index}-${i}`, `option-diet-${index}-${i}`) : nothing}
              `;
            },
          )}
          ${(line.notOfferedExtras ?? []).map(
            (extra) => html`
              <div class="option">
                <span class="name"
                  >${extra.name}${pickQuantityBadge(extra.quantity)}${notOfferedMarker()}</span
                >
                <span class="option-total"
                  >${formatMoney(extraGross(line, extra), currentLocale())}</span
                >
              </div>
            `,
          )}
          ${this.#answers(line).map((answer) => html`<div class="option modifier-answer"><span class="name">${answer}</span></div>`)}
          ${this.#allergenRow(line, index)} ${this.#dietRow(line, index)}
        `,
      )}
      ${
        this.modifierLine && this.#modifierSelection
          ? html`<till-modifier-picker
              .product=${this.modifierLine.product}
              .quantity=${this.modifierLine.quantity}
              .initialSelections=${this.#modifierSelection}
              @wt-modifier-confirm=${(event: CustomEvent<ModifierConfirmDetail>) => {
                event.stopPropagation();
                if (!this.modifierLine) return;
                const index = this.store.lines.indexOf(this.modifierLine);
                this.#closeModifierPicker();
                this.store.setLineModifiers(index, event.detail);
              }}
              @wt-modifier-cancel=${(event: Event) => {
                event.stopPropagation();
                this.#closeModifierPicker();
              }}
            ></till-modifier-picker>`
          : nothing
      }
    `;
  }

  #toggleEditor(index: number): void {
    this.editingIndex = this.editingIndex === index ? null : index;
  }

  #extrasRow(line: OrderLine, index: number) {
    if (line.note === undefined) return nothing;
    return html`
      <div class="line-extras" data-test=${`line-extras-${index}`}>
        <span class="line-extras-note"
          ><span class="line-extras-label">${t("line.note.label")}:</span> ${line.note}</span
        >
      </div>
    `;
  }

  #extrasEditor(line: OrderLine, index: number) {
    if (this.editingIndex !== index) return nothing;
    return html`
      <div class="line-extras-editor">
        ${renderLineExtrasEditor({
          note: line.note ?? "",
          onNoteChange: (note) => this.store.setLineExtras(index, { note }),
        })}
      </div>
    `;
  }

  /** Only with real diet data, so a no-recipe item (a coffee) never shows a "not reviewed" note. */
  #dietRow(line: OrderLine, index: number) {
    const hasDietData = line.product.dietDerivation != null || line.product.dietOverride != null;
    if (!hasDietData) return nothing;
    return dietBadges(asServedDiet(line), `line-diet-${index}`);
  }

  /** `−` is disabled at 1: removing a line is the × control's job, never the stepper's. */
  #quantityCell(line: OrderLine, index: number) {
    const unit = productUnit(line.product);
    if (unit.hardwareUnit !== null || unit.precision > 0) {
      return html`<span class="qty">${quantityLabel(line)}</span>`;
    }
    const count = Number(line.quantity);
    const name = this.#lineName(line);
    return html`
      <span class="qty stepper">
        <wt-button
          class="step step-dec"
          variant="ghost"
          size="sm"
          aria-label=${`${t("basket.decrease")} ${name}`}
          ?disabled=${count <= 1}
          @click=${() => this.store.setLineQuantity(index, String(count - 1))}
        >
          <span aria-hidden="true">−</span>
        </wt-button>
        <span class="count">${line.quantity}</span>
        <wt-button
          class="step step-inc"
          variant="ghost"
          size="sm"
          aria-label=${`${t("basket.increase")} ${name}`}
          @click=${() => this.store.setLineQuantity(index, String(count + 1))}
        >
          <span aria-hidden="true">+</span>
        </wt-button>
      </span>
    `;
  }

  #allergenRow(line: OrderLine, index: number) {
    const hasExtras = (line.extras ?? []).length > 0;
    const hasAllergens = line.product.allergens != null;
    if (!hasExtras && !hasAllergens) return nothing;

    const asServed = asServedAllergens(line);
    const locale = currentLocale();
    const codes = Object.keys(asServed.allergens).sort();
    return html`
      <div class="line-allergens" data-test=${`line-allergens-${index}`}>
        <span class="allergen-label">${t("allergens.as_served")}</span>
        ${
          codes.length > 0
            ? codes.map(
                (code) => html`<span class="allergen-chip">${allergenName(code, locale)}</span>`,
              )
            : asServed.pending
              ? nothing
              : html`<span class="allergen-none">${t("allergens.as_served_none")}</span>`
        }
        ${
          asServed.pending
            ? html`<span class="allergen-pending">${t("allergens.not_reviewed")}</span>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-basket": TillBasket;
  }
}
