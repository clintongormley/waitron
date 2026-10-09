import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { resolveContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-lozenge.js";
import type { CategorySummary, ProductEditorValue } from "../api/client.js";
import type { ModifierListChoice, UnitChoice } from "./product-editor-model.js";
import { modifierListName, modifierListNames } from "./product-editor-model.js";
import { priceText } from "./form-fields.js";
import { allergenName, vatClassName } from "../i18n/domain.js";
import { currentLocale, t } from "../i18n/t.js";

@customElement("dashboard-product-details")
export class ProductDetails extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .dismiss {
        display: flex;
        justify-content: end;
      }
      .notice {
        color: var(--wt-color-text-muted);
        margin-block: var(--wt-space-3);
      }
      dl {
        margin: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      dt {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      li + li {
        margin-block-start: var(--wt-space-2);
      }
      .variant {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .footer {
        display: flex;
        justify-content: end;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) value: ProductEditorValue | null = null;
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ModifierListChoice[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  @property({ attribute: false }) units: UnitChoice[] = [];

  #close(): void {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new CustomEvent("wt-close", { detail: {}, bubbles: true, composed: true }));
  }

  #field(label: string, value: string | TemplateResult | null) {
    return value === null || value === ""
      ? nothing
      : html`<div>
          <dt>${label}</dt>
          <dd>${value}</dd>
        </div>`;
  }

  #price(price: string | null, unitId: string | null): string | null {
    if (price === null) return null;
    const unit = this.units.find(({ id }) => id === unitId);
    const name =
      unitId === null
        ? null
        : unit
          ? resolveContentText(unit.name, currentLocale(), currentLocale())
          : t("editor.missing_choice");
    return `${priceText(price)} ${name === null ? t("product.price_each") : t("product.price_per").replace("{unit}", name)}`;
  }

  #details(value: ProductEditorValue) {
    const parent = value.inherited;
    const price = value.unitPrice ?? parent?.unitPrice ?? null;
    const unitId = parent ? parent.unitId : value.unitId;
    const tax = value.vatClass ?? parent?.vatClass ?? null;
    const categoryId = parent ? parent.primaryCategoryId : value.primaryCategoryId;
    const category = this.categories.find(({ id }) => id === categoryId);
    const allergens = value.allergens ?? parent?.allergens ?? null;
    const names = modifierListNames(this.extraLists, this.optionLists);
    const attached = (kind: "extras" | "options") => {
      const refs = value.modifiers.filter((ref) => ref.kind === kind);
      return refs.length
        ? html`<ul>
            ${refs.map((ref) => html`<li>${modifierListName(ref, names)}</li>`)}
          </ul>`
        : null;
    };
    return html`<dl>
      ${Object.entries(value.customerName ?? {})
        .filter(([, text]) => text.trim())
        .map(([language, text]) => this.#field(`${t("editor.customer_name")} (${language})`, text))}
      ${this.#field(t("editor.kitchen_name"), value.kitchenName)}
      ${this.#field(t("product.price"), this.#price(price, unitId))}
      ${this.#field(t("product.vat"), tax === null ? null : vatClassName(tax))}
      ${this.#field(t("editor.classification"), categoryId === null ? null : (category?.name ?? t("editor.missing_choice")))}
      ${this.#field(
        t("editor.variants"),
        value.variants.length
          ? html`<ul>
              ${value.variants.map(
                (variant) =>
                  html`<li>
                    <div class="variant">
                      <span>${variant.name}</span
                      ><span>${this.#price(variant.unitPrice ?? price, unitId)}</span
                      >${variant.active ? nothing : html`<wt-lozenge>${t("product.variant_archived_badge")}</wt-lozenge>`}
                    </div>
                  </li>`,
              )}
            </ul>`
          : null,
      )}
      ${this.#field(
        t("product.allergens"),
        allergens === null
          ? null
          : Object.keys(allergens).length
            ? html`<ul>
                ${Object.entries(allergens).map(([code, declaration]) => html`<li>${allergenName(code)} · ${t(declaration.presence === "contains" ? "allergen.contains" : "allergen.may_contain")}</li>`)}
              </ul>`
            : t("editor.allergens_none"),
      )}
      ${this.#field(t("options.title"), attached("options"))}
      ${this.#field(t("extras.title"), attached("extras"))}
    </dl>`;
  }

  override render() {
    return html`<wt-modal
      size="compact"
      .open=${this.open && this.value !== null}
      heading=${this.value?.name ?? ""}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      <div class="dismiss">
        <wt-button
          variant="secondary"
          data-test="modal-close"
          aria-label=${t("action.close")}
          @click=${() => this.#close()}
          ><wt-icon name="close"></wt-icon
        ></wt-button>
      </div>
      <p class="notice">${t("product.archived_notice")}</p>
      ${this.value ? this.#details(this.value) : nothing}
      <div slot="footer" class="footer">
        <wt-button variant="secondary" data-test="close" @click=${() => this.#close()}
          >${t("action.close")}</wt-button
        >
      </div>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-details": ProductDetails;
  }
}
