import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { productName } from "./product-name.js";
import { descriptionFor } from "./dish-format.js";
import { dishGross, optionGross, quantityLabel } from "../state/order-line.js";
import { asServedAllergens, asServedDiet } from "../state/as-served.js";
import { dietBadgeStyles, dietBadges } from "./diet-badges.js";
import { StoreChangeController } from "../state/store-controller.js";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";

/**
 * The multiplication sign for a per-option-quantity badge (`×2`). The SAME `×` (U+00D7) the printed
 * receipt (`apps/server/src/receipt-ticket.ts`) and the settled-ticket view use, so the badge reads
 * identically on the screen basket, the paper receipt and the filed ticket.
 */
const QTY_BADGE = "×";

/**
 * The `×N` badge for a modifier taken more than once per dish (per-option quantity), or "" for the
 * common one-per-dish case (quantity 1 or absent) so a plain option renders byte-identical to before.
 * `quantity` is the CLIENT per-dish count carried directly on the selected option — no derivation.
 */
function optionQuantityBadge(quantity: number | undefined): string {
  return quantity !== undefined && quantity > 1 ? ` ${QTY_BADGE}${quantity}` : "";
}

/**
 * The running order: one row per rung-up line, each with the product's name, the quantity (a count,
 * or a kg weight for a weight product) and its gross line total, plus a remove control. It reads the
 * store and re-renders on every `"changed"` event — it holds no basket state of its own, so it can
 * never disagree with the store the pay flow reads.
 *
 * The line total is the SAME arithmetic the server prices with — `unitPrice × quantity` at money
 * scale, in `@waitron/shared` Decimals, never a float — so a row can never round differently from
 * the grand total or the filed ticket.
 */
@customElement("till-basket")
export class TillBasket extends LitElement {
  static override styles = [
    baseStyles,
    dietBadgeStyles,
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
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) 0;
        border-bottom: 1px solid var(--wt-color-border);
      }

      .qty {
        color: var(--wt-color-text-muted);
      }

      /* Dish-line quantity stepper (feature B): the -/N/+ control on an each line. The count sits
         between the two step buttons; a weight line renders the static kg label in this same cell. */
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

      /* A selected option (ordering modifiers, Task 8) — indented beneath its dish, name left and
         delta right, with no quantity column and no remove control (a child is not independently
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
    `,
  ];

  /** The order this basket shows and mutates. Set before the widget connects (its lifecycle subscribes). */
  @property({ attribute: false }) store!: WorkingOrderStore;

  constructor() {
    super();
    // Re-render on any basket change (add / remove / clear); the controller owns the subscription
    // lifecycle. `() => this.store` is read lazily on connect, after the property is assigned.
    new StoreChangeController(this, () => this.store);
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
            <span class="name">${productName(line.product)}</span>
            ${this.#quantityCell(line, index)}
            <span class="line-total">${formatMoney(dishGross(line))}</span>
            <wt-button
              class="remove"
              variant="ghost"
              size="md"
              aria-label=${`${t("action.remove")} ${productName(line.product)}`}
              @click=${() => this.store.removeLine(index)}
            >
              <span aria-hidden="true">×</span>
            </wt-button>
          </div>
          ${(line.options ?? []).map(
            // Each selected modifier on its own indented row — the option's name and its delta (0,00 for
            // a free option). No remove control: a child is removed only by removing its dish above,
            // which drops the whole line (options and all). A modifier taken more than once per dish
            // (per-option quantity) shows a "×N" badge on its name — the CLIENT per-dish count carried
            // directly on the option (no derivation); a plain option (quantity 1/absent) is unchanged.
            (option) => html`
              <div class="option">
                <span class="name"
                  >${descriptionFor(option.name, "")}${optionQuantityBadge(option.quantity)}</span
                >
                <span class="option-total">${formatMoney(optionGross(line, option))}</span>
              </div>
            `,
          )}
          ${this.#allergenRow(line, index)} ${this.#dietRow(line, index)}
        `,
      )}
    `;
  }

  /**
   * The line's as-served DIET row (dietary-classification, Task 7), or `nothing`. Rendered ONLY when the
   * product carries genuine diet data — a recipe-derived `dietDerivation` or a staff `dietOverride` — so
   * a plain no-recipe item (a coffee) never sprouts a "not reviewed" note it has no diet to review. When
   * it does render, the badges are the CLIENT-computed {@link asServedDiet} (the same shared fold the KDS
   * and expo use), and a pending derivation shows the NEUTRAL "not reviewed" note, never a positive claim.
   */
  #dietRow(line: OrderLine, index: number) {
    const hasDietData = line.product.dietDerivation != null || line.product.dietOverride != null;
    if (!hasDietData) return nothing;
    return dietBadges(asServedDiet(line), `line-diet-${index}`);
  }

  /**
   * The line's quantity cell. An `each` line gets a −/count/+ stepper (dish-line quantity, feature B):
   * `+` bumps the count via {@link WorkingOrderStore.setLineQuantity} (no line merge — each add stays its
   * own line), `−` lowers it but is DISABLED at 1 because deletion is the × remove control's job, never
   * the stepper's. A `weight` line has no stepper — a measured weight has no +/- — so it keeps the static
   * kg label ({@link quantityLabel}).
   */
  #quantityCell(line: OrderLine, index: number) {
    if (line.product.pricingUnit === "weight") {
      return html`<span class="qty">${quantityLabel(line)}</span>`;
    }
    const count = Number(line.quantity);
    const name = productName(line.product);
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

  /**
   * The line's as-served allergen row, or `nothing` for the noise-free common case: a plain line with
   * no modifiers AND no declared allergens on the dish renders nothing at all. When it DOES render, the
   * chips are the folded `asServedAllergens` set (localised via the till's allergen-name i18n) and the
   * "not fully reviewed" note appears whenever the fold is pending (the dish's own allergens unreviewed
   * — the Cautious policy, since a removed-but-unknown base can't be proven allergen-free). A reviewed
   * fold that leaves an empty set reads as "No declared allergens" rather than a bare label.
   */
  #allergenRow(line: OrderLine, index: number) {
    const hasOptions = (line.options ?? []).length > 0;
    const hasAllergens = line.product.allergens != null;
    if (!hasOptions && !hasAllergens) return nothing;

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
