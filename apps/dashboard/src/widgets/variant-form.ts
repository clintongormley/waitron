import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "./image-upload.js";
import type { ImageUploader } from "./image-upload.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import {
  nonBlankNames,
  optionalTextFields,
  priceLabel,
  switchField,
  textField,
  type FieldContext,
} from "./form-fields.js";

/**
 * The pricing unit is the PRODUCT's, so this window names it beside the price and offers no control
 * for it. The whole variant travels back to the product editor as one `wt-submit`, so a variant is
 * only saved when the product is.
 */
@customElement("dashboard-variant-form")
export class VariantForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) locales: string[] = [];
  @property({ attribute: false }) value: ProductEditorVariant | null = null;
  @property() unitLabel = "";
  /** The product's price, which a blank price sells at. */
  @property() basePrice = "";
  /** The product's photo, which a variant with no photo of its own shows. */
  @property({ attribute: false }) inheritedImage: string | null = null;
  @property({ attribute: false }) api?: ImageUploader;
  @state() private errors: Record<string, string> = {};
  @state() private name = "";
  @state() private unitPrice = "";
  @state() private available = true;
  @state() private kitchenName = "";
  @state() private customerName: Record<string, string> = {};
  @state() private image: string | null = null;
  /** The saved variant's id, or undefined for one that has never been stored. */
  #variantId: string | undefined;
  /** Carried through unchanged: this window never makes a variant Active or Inactive. */
  #active = true;
  /** The field a refused submit puts focus in, applied in `updated` so the message beside it is on
   * screen by the time the keyboard lands there. */
  #focusField: string | null = null;

  override updated(): void {
    const name = this.#focusField;
    if (name === null) return;
    this.#focusField = null;
    this.shadowRoot?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!(changed.has("open") && this.open) && !changed.has("value")) return;
    const value = this.value;
    this.#variantId = value?.id;
    this.#active = value?.active ?? true;
    this.name = value?.name ?? "";
    this.unitPrice = value?.unitPrice ?? "";
    this.available = value?.available ?? true;
    this.kitchenName = value?.kitchenName ?? "";
    this.customerName = { ...value?.customerName };
    this.image = value?.image ?? null;
    this.errors = {};
    this.#focusField = null;
  }

  #fields(): FieldContext {
    return {
      busy: this.busy,
      locales: this.locales,
      error: (key) => this.errors[key] ?? "",
    };
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  #save(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const errors: Record<string, string> = {};
    if (!this.name.trim()) errors.name = t("editor.variant_name_required");
    const unitPrice = this.unitPrice.trim() === "" ? null : this.unitPrice;
    if (unitPrice !== null && !isProductPrice(unitPrice))
      errors.unitPrice = t("editor.price_invalid");
    this.errors = errors;
    // A refused submit leaves every field as it was, so one bad value is corrected on its own rather
    // than retyped with the rest — and focus MOVES to the first one reported, in render order,
    // because a refusal that leaves the keyboard on Save says nothing a keyboard user can act on.
    const [first] = Object.keys(errors);
    if (first !== undefined) {
      this.#focusField = first;
      return;
    }
    const customerName = nonBlankNames(this.customerName);
    const value: ProductEditorVariant = {
      ...(this.#variantId === undefined ? {} : { id: this.#variantId }),
      name: this.name.trim(),
      customerName: Object.keys(customerName).length ? customerName : null,
      kitchenName: this.kitchenName.trim() || null,
      image: this.image,
      unitPrice,
      available: this.available,
      active: this.#active,
    };
    this.dispatchEvent(
      new CustomEvent("wt-submit", { detail: { value }, bubbles: true, composed: true }),
    );
  }

  #imageField() {
    if (!this.api) return nothing;
    return html`<dashboard-image-upload
      .api=${this.api}
      .image=${this.image}
      .inheritedImage=${this.inheritedImage}
      @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
        event.stopPropagation();
        this.image = event.detail.image;
      }}
      @image-picker-state=${(event: Event) => {
        // The library picker opens over THIS window, so its open state stops here: the product
        // editor behind it suspends itself on its own image picker, not on a variant's.
        event.stopPropagation();
      }}
    ></dashboard-image-upload>`;
  }

  override render() {
    const fields = this.#fields();
    return html`<wt-modal
      .open=${this.open}
      heading=${this.value ? t("editor.edit_variant") : t("editor.add_variant")}
      @wt-close=${(event: Event) => this.#cancel(event)}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>('[data-test="variant-save"]'),
        );
      }}
    >
      <wt-form-error-summary
        heading=${t("form.error_heading")}
        .errors=${Object.values(this.errors)}
      ></wt-form-error-summary>
      <div class="fields">
        ${textField(
          fields,
          "name",
          t("editor.name"),
          this.name,
          (name) => {
            this.name = name;
          },
          true,
        )}
        ${textField(
          fields,
          "unitPrice",
          priceLabel(this.unitLabel),
          this.unitPrice,
          (unitPrice) => {
            this.unitPrice = unitPrice;
          },
          false,
          this.basePrice,
        )}
        ${switchField(fields, "available", t("editor.available"), this.available, (available) => {
          this.available = available;
        })}
        ${textField(fields, "kitchenName", t("editor.kitchen_name"), this.kitchenName, (name) => {
          this.kitchenName = name;
        })}
        ${optionalTextFields(
          fields,
          "customerName",
          t("editor.customer_name"),
          this.customerName,
          (customerName) => {
            this.customerName = customerName;
          },
        )}
        ${this.#imageField()}
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          data-test="variant-cancel"
          slot="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="variant-save"
          variant="primary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#save(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      ></wt-modal
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-variant-form": VariantForm;
  }
}
