import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles, ContentLanguageController } from "@waitron/ui";
import type { TillProduct } from "../api/menu-api.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";
import { dishFacts } from "./dish-facts.js";
import { productName } from "./product-name.js";
import { hasSomethingToSell } from "./product-pick.js";
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

  #emit(name: "close-info" | "add-product"): void {
    this.dispatchEvent(
      new CustomEvent(name, { detail: this.product, bubbles: true, composed: true }),
    );
  }

  override render() {
    const product = this.product;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${productName(product)}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#emit("close-info");
      }}
    >
      ${dishFacts(product)}
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
