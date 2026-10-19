import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, ContentLanguageController, formatDecimalInput, Gestures } from "@waitron/ui";
import type { OrderLine, WorkingOrderStore } from "../state/working-order.js";
import { asServedAllergens, asServedDiet } from "../state/as-served.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { currentLocale, t } from "../i18n/t.js";
import { lineProductName, soldByTheUnit } from "./product-name.js";
import { trimQuantity } from "./dish-format.js";
import { optionAnswers } from "./option-snapshot.js";
import { nutritionIcons, nutritionIconStyles, nutritionDietLabels } from "./nutrition-icons.js";
import "@waitron/ui/src/components/wt-button.js";

@customElement("till-last-added")
export class TillLastAdded extends LitElement {
  static override styles = [
    baseStyles,
    nutritionIconStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .last-added {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .detail {
        flex: 1;
        min-width: 0;
        min-height: var(--wt-tap-min);
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      .detail:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .last-added-name {
        font-weight: var(--wt-font-weight-bold);
      }
      .modifier-answer,
      .line-note {
        display: block;
      }
      .last-added-steps {
        display: flex;
        flex: 0 0 auto;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) store!: WorkingOrderStore;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) readOnly = false;
  #dispose?: () => void;
  #gestures?: Gestures;
  #pressed?: OrderLine;
  #held = false;
  constructor() {
    super();
    new LocaleChangeController(this);
    new ContentLanguageController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#subscribe();
    this.addEventListener("pointerdown", this.#press, true);
    this.#gestures = new Gestures(this, {
      longPress: () => {
        if (this.#pressed !== undefined && this.store.lastAdded === this.#pressed) {
          this.#held = true;
          this.#open(this.#pressed);
        }
      },
    });
  }
  override disconnectedCallback(): void {
    this.removeEventListener("pointerdown", this.#press, true);
    this.#gestures?.disconnect();
    this.#gestures = undefined;
    this.#dispose?.();
    this.#dispose = undefined;
    this.#pressed = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues): void {
    if (changed.has("store")) this.#subscribe();
  }
  #subscribe(): void {
    this.#dispose?.();
    this.#dispose = this.store?.on("changed", () => this.requestUpdate());
  }
  readonly #press = (event: PointerEvent): void => {
    this.#held = false;
    this.#pressed = event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.hasAttribute("data-last-added-detail"))
      ? this.store.lastAdded
      : undefined;
  };
  #blocked(): boolean {
    return this.disabled || this.store.sending || this.store.editsLocked;
  }
  #open(line: OrderLine): void {
    if (this.#blocked() || this.store.lastAdded !== line) return;
    this.dispatchEvent(
      new CustomEvent("open-line-details", { detail: { line }, bubbles: true, composed: true }),
    );
  }
  #step(line: OrderLine, by: -1 | 1): void {
    if (
      this.#blocked() ||
      this.readOnly ||
      this.store.lastAdded !== line ||
      !soldByTheUnit(line.product)
    )
      return;
    const index = this.store.lines.indexOf(line);
    const quantity = Number(line.quantity) + by;
    if (quantity < 1) this.store.removeLine(index);
    else this.store.setLineQuantity(index, String(quantity));
  }
  override render() {
    const line = this.store.lastAdded;
    if (line === undefined) return nothing;
    const name = lineProductName(line.product) || t("basket.not_offered");
    const served = asServedAllergens(line);
    const icons = nutritionIcons(
      served.pending ? null : served.allergens,
      nutritionDietLabels(asServedDiet(line), line.product.dietaryDeclarations),
    );
    const quantity = ` ×${formatDecimalInput(trimQuantity(line.quantity), currentLocale())}`;
    return html`<div
      class="last-added"
      data-last-added
      role="group"
      aria-label=${t("table.last_added")}
      ?inert=${this.#blocked()}
    >
      <button
        type="button"
        class="detail"
        data-last-added-detail
        ?disabled=${this.#blocked()}
        @click=${(event: MouseEvent) => {
          if (!this.#held || event.detail === 0) this.#open(line);
          this.#held = false;
        }}
      >
        <span class="last-added-name">${name}${icons}${quantity}</span>
        ${optionAnswers(line.optionSnapshots, { reads: "staff" }).map((answer) => html`<span class="modifier-answer">${answer}</span>`)}
        ${(line.extras ?? []).map((extra) => html`<span class="modifier-answer">${extra.name || t("basket.not_offered")}${extra.quantity > 1 ? ` ×${extra.quantity}` : ""}</span>`)}
        ${line.note === undefined ? nothing : html`<span class="line-note">${t("line.note.label")}: ${line.note}</span>`}
      </button>
      ${soldByTheUnit(line.product) ? html`<span class="last-added-steps">${([-1, 1] as const).map((by) => html`<wt-button variant="secondary" data-last-added-step=${by} ?disabled=${this.#blocked() || this.readOnly || (by === 1 && this.store.canSelectProduct?.(line.product) === false)} .ariaLabel=${`${t(by === -1 ? "basket.decrease" : "basket.increase")} ${by === -1 ? "−1" : "+1"} · ${name}`} @click=${() => this.#step(line, by)}>${by === -1 ? "−1" : "+1"}</wt-button>`)}</span>` : nothing}
    </div>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-last-added": TillLastAdded;
  }
}
