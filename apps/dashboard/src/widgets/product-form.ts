import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
// Value imports (not `import type`): pull in the child widget modules for their `@customElement`
// side effects, so `<dashboard-allergen-picker>` and `<dashboard-image-upload>` are registered
// before this form renders them (the `staff-screen.ts` widget-registration pattern).
import "./allergen-picker.js";
import "./image-upload.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { unitName, vatClassName } from "../i18n/domain.js";
import type { ImageUploader } from "./image-upload.js";
import type {
  AllergenDeclaration,
  AllergenEntry,
  CategorySummary,
  PricingUnit,
  Product,
  ProductPatch,
  VatClass,
} from "../api/client.js";
import { selectStyles } from "../select-styles.js";

// Re-export so composing views (the a11y test, the catalogue screen) can name the category shape the
// form consumes without a second import path.
export type { CategorySummary } from "../api/client.js";

/** The VAT bands the form offers, in the `products.vat_class` CHECK-set order (`schema/catalogue.ts`). */
const VAT_CLASSES: readonly VatClass[] = ["general", "reduced", "super_reduced", "zero"];
/** The pricing bases the form offers, in the `products.pricing_unit` CHECK-set order. */
const PRICING_UNITS: readonly PricingUnit[] = ["each", "weight"];

/**
 * The `create-product` event detail — the whole form assembled. `allergens` is OMITTED (never sent as
 * `null`) when the picker is PENDING, because the server's `createProduct` throws `allergen.invalid_code`
 * on an explicit `allergens: null` (the create-vs-patch asymmetry); `image` is the same — it is
 * OMITTED when unset and never emitted as `null` (the POST route rejects a literal `null`), so it is
 * typed `string`, not `string | null`. `active` is always carried and threaded straight through the
 * create, so a product created INACTIVE is one atomic request (`createProduct` accepts `active`),
 * never a create-then-patch. `{}` is a REVIEWED-NONE declaration, distinct from PENDING, and IS sent.
 */
export interface CreateProductDetail {
  catalogueId: string;
  categoryId: string | null;
  descriptions: Record<string, string>;
  unitPrice: string;
  vatClass: VatClass;
  pricingUnit: PricingUnit;
  allergens?: Record<string, AllergenEntry>;
  image?: string;
  active: boolean;
}

/** The `update-product` event detail: the product id + a patch of its mutable slice (`ProductPatch`). */
export interface UpdateProductDetail {
  id: string;
  patch: ProductPatch;
}

/**
 * The management dashboard's PRODUCT FORM: a `wt-dialog` (create + edit) composing the product's own
 * fields with the two landed catalogue widgets — `<dashboard-allergen-picker>` and
 * `<dashboard-image-upload>`. The catalogue screen (a later task) drives it by setting `.open`,
 * `.catalogueId`, `.categories`, `.api` and (for an edit) `.product`, and hears one of two events:
 * `create-product` (create mode) or `update-product { id, patch }` (edit mode). Like `person-form`,
 * the form does NOT call the API and does NOT close itself on confirm — the screen closes it on a
 * successful create/update, so a rejected write leaves the entered values in place.
 *
 * SEEDING. `willUpdate` reseeds every field from `product` whenever `product` changes or the dialog
 * opens, so opening the form for an edit pre-fills it and opening it for a create (`product` null)
 * starts it blank. The allergen picker is seeded through its `declaration` property (a separate
 * `seedAllergens` bound ONLY on reseed, never to the live value, so it does not fight the operator's
 * edits) and the image control through its `image` property; both children also announce their own
 * changes back through `allergens-changed` / `image-changed`, which this form captures (with
 * `stopPropagation`, the house pattern) into `allergens` / `image`.
 *
 * THE CREATE-VS-PATCH ALLERGEN ASYMMETRY is load-bearing. On CREATE a PENDING picker (`value === null`)
 * OMITS the `allergens` key entirely — an explicit `allergens: null` makes `createProduct` throw
 * `allergen.invalid_code`. On PATCH `allergens: null` is legal and clears the declaration back to
 * PENDING, so the edit patch always carries the current value, null included. `image` is omitted on
 * create when unset and always carried on patch (null clears the photo).
 *
 * A non-empty PRIMARY-locale (`locales[0]`) description is REQUIRED client-side — the column is NOT
 * NULL and a nameless product is a UI error — so confirm is blocked and a `role="alert"` shown when it
 * is empty. A single-flight `busy` property (set by the screen while a create/update round-trips)
 * makes confirm a no-op and disables the control, mirroring the staff screen's create guard — the
 * mutations are not server-idempotent.
 */
@customElement("dashboard-product-form")
export class ProductForm extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-4);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** Whether the dialog is showing. The screen sets this to open the form; it clears on close. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The catalogue new products are created under — set by the screen (a create needs a catalogue). */
  @property() catalogueId = "";

  /** The categories the category `<select>` offers (loaded by the screen), plus a "— none —" option. */
  @property({ attribute: false }) categories: CategorySummary[] = [];

  /** The locales a description field is rendered for; default `["es"]` (tenant-locale seeding deferred). */
  @property({ attribute: false }) locales: readonly string[] = ["es"];

  /** The product being edited, or null for a create. Setting it pre-fills every field on the next open. */
  @property({ attribute: false }) product: Product | null = null;

  /** The upload dependency threaded down to the image control (the `DashboardApi`, or a stub in tests). */
  @property({ attribute: false }) api?: ImageUploader;

  /** Single-flight gate: the screen sets it true while a create/update is in flight; confirm is a no-op. */
  @property({ type: Boolean }) busy = false;

  @state() private descriptions: Record<string, string> = {};
  @state() private unitPrice = "";
  @state() private vatClass: VatClass = "general";
  @state() private pricingUnit: PricingUnit = "each";
  @state() private categoryId: string | null = null;
  @state() private active = true;
  // The live allergen value (seeded, then updated by the picker's event). Kept SEPARATE from the
  // picker's `declaration` seed (`seedAllergens`) so a user edit — which changes this — never re-seeds
  // the picker and resets its per-code source inputs mid-typing.
  @state() private allergens: AllergenDeclaration = null;
  @state() private seedAllergens: AllergenDeclaration = null;
  @state() private image: string | null = null;
  @state() private validationError: string | null = null;

  /**
   * Reseed every field from `product` on an open or a product change. Runs before render, so the
   * pre-filled values are in place for the first paint. A create (`product` null) resets to blanks +
   * defaults; an edit fills from the loaded product. Allergens are seeded from the MANUAL overlay
   * (`manualAllergens`), NOT the published `allergens` union: the published value folds in any
   * recipe-derived floor, so seeding — and re-saving — from it would double-count the derived
   * allergens into the manual overlay. Seeded into BOTH the live value (`allergens`, what a save
   * emits) and the picker's `declaration` seed (`seedAllergens`); the picker does not emit on seed,
   * so the form must seed its own live copy too, or an untouched edit would re-save the wrong value.
   */
  override willUpdate(changed: PropertyValues): void {
    if (!changed.has("product") && !(changed.has("open") && this.open)) return;
    const p = this.product;
    this.descriptions = { ...(p?.descriptions ?? {}) };
    this.unitPrice = p?.unitPrice ?? "";
    this.vatClass = p?.vatClass ?? "general";
    this.pricingUnit = p?.pricingUnit ?? "each";
    this.categoryId = p?.categoryId ?? null;
    this.active = p?.active ?? true;
    this.allergens = p?.manualAllergens ?? null;
    this.seedAllergens = p?.manualAllergens ?? null;
    this.image = p?.image ?? null;
    this.validationError = null;
  }

  #onDescriptionChange(event: CustomEvent<{ value: string }>, locale: string): void {
    event.stopPropagation();
    this.descriptions = { ...this.descriptions, [locale]: event.detail.value };
    if (this.validationError) this.validationError = null;
  }

  #onUnitPriceChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.unitPrice = event.detail.value;
  }

  // Native `change` is `composed: false`, so `stopPropagation` on the three `<select>` handlers is
  // defensive consistency with the composed handlers, not a boundary guard (the person-form pattern).
  #onVatClassChange(event: Event): void {
    event.stopPropagation();
    this.vatClass = (event.target as HTMLSelectElement).value as VatClass;
  }

  #onPricingUnitChange(event: Event): void {
    event.stopPropagation();
    this.pricingUnit = (event.target as HTMLSelectElement).value as PricingUnit;
  }

  #onCategoryChange(event: Event): void {
    event.stopPropagation();
    const value = (event.target as HTMLSelectElement).value;
    this.categoryId = value === "" ? null : value;
  }

  #onActiveChange(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    this.active = event.detail.checked;
  }

  /** Capture the picker's declaration; `stopPropagation` keeps its composed event inside this form. */
  #onAllergensChanged(event: CustomEvent<{ value: AllergenDeclaration }>): void {
    event.stopPropagation();
    this.allergens = event.detail.value;
  }

  /** Capture the uploaded image reference; `stopPropagation` keeps its composed event inside this form. */
  #onImageChanged(event: CustomEvent<{ image: string }>): void {
    event.stopPropagation();
    this.image = event.detail.image;
  }

  /** The description map to emit: every locale whose value is non-empty (trimmed), value kept as typed. */
  #buildDescriptions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [locale, text] of Object.entries(this.descriptions)) {
      if (text.trim() !== "") out[locale] = text;
    }
    return out;
  }

  /**
   * Assemble and emit the create/update event. `stopPropagation` keeps the confirm button's own
   * composed `click` inside this shadow boundary. Blocks (no event) on a `busy` gate and on an empty
   * primary-locale description (a `role="alert"` is shown instead). Then, for an edit, emits
   * `update-product { id, patch }` carrying every mutable field (allergens/image null included, both
   * legal to clear on a patch); for a create, emits `create-product` OMITTING `allergens` when the
   * picker is PENDING and `image` when unset (the create-vs-patch asymmetry).
   */
  #confirm(event: Event): void {
    event.stopPropagation();
    if (this.busy) return; // single-flight: a second confirm while one is in flight is ignored
    const primary = this.locales[0];
    if ((this.descriptions[primary] ?? "").trim() === "") {
      this.validationError = "product.description_required";
      return;
    }
    this.validationError = null;
    const descriptions = this.#buildDescriptions();

    if (this.product) {
      const patch: ProductPatch = {
        categoryId: this.categoryId,
        descriptions,
        unitPrice: this.unitPrice,
        vatClass: this.vatClass,
        pricingUnit: this.pricingUnit,
        allergens: this.allergens,
        image: this.image,
        active: this.active,
      };
      this.dispatchEvent(
        new CustomEvent<UpdateProductDetail>("update-product", {
          detail: { id: this.product.id, patch },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    const body: CreateProductDetail = {
      catalogueId: this.catalogueId,
      categoryId: this.categoryId,
      descriptions,
      unitPrice: this.unitPrice,
      vatClass: this.vatClass,
      pricingUnit: this.pricingUnit,
      active: this.active,
    };
    if (this.allergens !== null) body.allergens = this.allergens;
    if (this.image !== null) body.image = this.image;
    this.dispatchEvent(
      new CustomEvent<CreateProductDetail>("create-product", {
        detail: body,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * The dialog closed. Drop our own `open` to stay self-consistent, and — like `person-form` —
   * deliberately do NOT `stopPropagation`: the composed `wt-close` must bubble on to the screen (the
   * owner of the open state). Fields are NOT reset here; `willUpdate` reseeds them on the next open.
   */
  #onClose(): void {
    this.open = false;
  }

  override render() {
    return html`
      <wt-dialog
        heading=${this.product ? t("product.edit") : t("product.new")}
        .open=${this.open}
        @wt-close=${() => this.#onClose()}
      >
        ${this.locales.map(
          (locale) => html`
            <wt-input
              class="field"
              data-test=${`description-${locale}`}
              label=${`${t("product.description")} (${locale})`}
              .value=${this.descriptions[locale] ?? ""}
              @wt-change=${(e: CustomEvent<{ value: string }>) =>
                this.#onDescriptionChange(e, locale)}
            ></wt-input>
          `,
        )}
        <wt-input
          class="field"
          data-test="unit-price"
          label=${t("product.price")}
          .value=${this.unitPrice}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onUnitPriceChange(e)}
        ></wt-input>
        <label class="field"
          >${t("product.vat")}
          <select data-test="vat-class" @change=${(e: Event) => this.#onVatClassChange(e)}>
            ${VAT_CLASSES.map(
              (v) =>
                html`<option value=${v} .selected=${v === this.vatClass}>
                  ${vatClassName(v)}
                </option>`,
            )}
          </select>
        </label>
        <label class="field"
          >${t("product.unit")}
          <select data-test="pricing-unit" @change=${(e: Event) => this.#onPricingUnitChange(e)}>
            ${PRICING_UNITS.map(
              (u) =>
                html`<option value=${u} .selected=${u === this.pricingUnit}>
                  ${unitName(u)}
                </option>`,
            )}
          </select>
        </label>
        <label class="field"
          >${t("product.category")}
          <select data-test="category" @change=${(e: Event) => this.#onCategoryChange(e)}>
            <option value="" .selected=${this.categoryId === null}>
              ${t("product.no_category")}
            </option>
            ${this.categories.map(
              (c) =>
                html`<option value=${c.id} .selected=${c.id === this.categoryId}>
                  ${c.name}
                </option>`,
            )}
          </select>
        </label>
        <wt-switch
          class="field"
          data-test="active"
          label=${t("product.active")}
          .checked=${this.active}
          @wt-change=${(e: CustomEvent<{ checked: boolean }>) => this.#onActiveChange(e)}
        ></wt-switch>
        <dashboard-allergen-picker
          data-test="allergens"
          .declaration=${this.seedAllergens}
          @allergens-changed=${(e: CustomEvent<{ value: AllergenDeclaration }>) =>
            this.#onAllergensChanged(e)}
        ></dashboard-allergen-picker>
        <dashboard-image-upload
          data-test="image"
          .api=${this.api}
          .image=${this.image}
          @image-changed=${(e: CustomEvent<{ image: string }>) => this.#onImageChanged(e)}
        ></dashboard-image-upload>
        ${
          this.validationError
            ? html`<p class="error" role="alert" data-test="error">
                ${codeMessage(this.validationError)}
              </p>`
            : nothing
        }
        <wt-button
          slot="footer"
          variant="primary"
          data-test="confirm"
          ?disabled=${this.busy}
          @click=${(e: Event) => this.#confirm(e)}
          >${this.product ? t("action.save") : t("action.create")}</wt-button
        >
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-form": ProductForm;
  }
}
