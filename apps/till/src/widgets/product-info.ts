import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, ContentLanguageController } from "@waitron/ui";
import type { TillProduct } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { currentLocale, t } from "../i18n/t.js";
import { allergenLabel } from "../i18n/allergen-names.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";
import { descriptionFor } from "./dish-format.js";
import { productName } from "./product-name.js";
import { hasSomethingToSell } from "./product-pick.js";
import { dietLabel, nutritionDietLabels } from "./nutrition-icons.js";

export type ChangeAvailability = (productId: string, available: boolean) => Promise<void>;

@customElement("till-product-info")
export class TillProductInfo extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      h3 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      ul {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--wt-space-4);
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-2);
        overflow-wrap: anywhere;
      }
      wt-icon {
        flex-shrink: 0;
      }
      .pending {
        color: var(--wt-color-text);
      }
    `,
  ];
  @property({ attribute: false }) product!: TillProduct;

  @property({ attribute: false }) changeAvailability?: ChangeAvailability;
  @state() private sending = false;
  @state() private refusal = "";

  async #change(productId: string, available: boolean): Promise<void> {
    if (this.sending || !this.changeAvailability) return;
    this.sending = true;
    this.refusal = "";
    try {
      await this.changeAvailability(productId, available);
      this.#emit("close-info");
    } catch (error) {
      this.refusal = codeMessage((error as { code?: string } | null)?.code ?? "server.internal");
    } finally {
      this.sending = false;
    }
  }

  #availability(id: string, name: string, available: boolean) {
    return html`<li>
      <span>${name}</span
      ><wt-button
        data-availability=${id}
        variant="secondary"
        ?disabled=${this.sending}
        .loading=${this.sending}
        @click=${() => void this.#change(id, !available)}
        >${t(available ? "product_info.sold_out" : "product_info.restore")}</wt-button
      >
    </li>`;
  }

  #emit(name: "close-info" | "add-product"): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail: this.product, bubbles: true, composed: true }),
    );
  }

  override render() {
    const product = this.product;
    const allergens = product.allergens;
    const description = descriptionFor(product.description ?? {}, "").trim();
    const labels = nutritionDietLabels(product.diet, product.dietaryDeclarations);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${productName(product)}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#emit("close-info");
      }}
    >
      ${description ? html`<p data-description>${description}</p>` : nothing}
      <h3>${t("allergens.contains")}</h3>
      ${
        allergens === null
          ? html`<p class="pending">${t("product_info.not_reviewed")}</p>`
          : Object.keys(allergens).length === 0
            ? html`<p>${t("allergens.as_served_none")}</p>`
            : html`<ul>
                ${Object.keys(allergens)
                  .sort()
                  .map(
                    (code) =>
                      html`<li>
                        <wt-icon name=${`allergen-${code}`}></wt-icon
                        >${allergenLabel(code, allergens[code]!, currentLocale())}
                      </li>`,
                  )}
              </ul>`
      }
      ${
        labels.length === 0
          ? nothing
          : html`<h3>${t("product_info.dietary")}</h3>
              <ul>
                ${labels.map((label) => html`<li><wt-icon name=${`diet-${label}`}></wt-icon>${dietLabel(label)}</li>`)}
              </ul>`
      }
      ${
        this.changeAvailability && product.productId
          ? html`
              <p>${t("product_info.all_menus")}</p>
              <ul>
                ${this.#availability(product.productId, productName(product), product.available !== false)}
                ${product.variants?.map((variant) => this.#availability(variant.id, variant.name, variant.available))}
              </ul>
              ${this.refusal ? html`<p role="alert">${this.refusal}</p>` : nothing}
            `
          : nothing
      }
      <wt-button
        slot="footer"
        variant="secondary"
        data-close
        @click=${() => this.#emit("close-info")}
        >${t("equipment.close")}</wt-button
      >
      <wt-button
        slot="footer"
        data-add
        ?disabled=${!hasSomethingToSell(product)}
        variant=${hasSomethingToSell(product) ? "primary" : "secondary"}
        @click=${() => this.#emit("add-product")}
        >${t("product_info.add")}</wt-button
      >
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-product-info": TillProductInfo;
  }
}
